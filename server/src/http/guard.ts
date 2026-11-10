// Request guard of the local API (docs/security.md, M1): stops other web sites the user has open from
// driving the server (CSRF) and DNS-rebinding pages from reading it. Same idea as tools/sounds/listen.ts.
//
// - Host must be localhost, an IP literal (a rebinding attack needs a domain name) or this PC's name.
// - Sec-Fetch-Site, when the browser sends it, must not be cross-site / same-site.
// - POST/PUT/PATCH/DELETE: an Origin header, when present, must be the request's own host, and the
//   custom header `X-AnimaPage: 1` is required. A cross-site form or <img> cannot send it, and a cross-site
//   fetch with it needs a CORS preflight, which this server never answers. GET /api/i18n/* (it may start
//   an LLM translation) needs the header too.
import os from "node:os";
import type { FastifyInstance } from "fastify";

export const CLIENT_HEADER = "x-animapage";
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FORBIDDEN = { error: "Richiesta non consentita." };

const isLoopback = (addr: string | undefined): boolean => !!addr && /^(127\.|::1$|::ffff:127\.)/.test(addr);

/** The host name of a Host / Origin authority, lowercased; null when it is not a plain host[:port]. */
function hostName(authority: string): string | null {
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(authority)) return null;
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True for localhost, an IPv4/IPv6 literal, or this PC's host name (also as <name>.local). */
export function allowedHost(host: string | undefined, pcName = os.hostname()): boolean {
  const name = host ? hostName(host) : null;
  if (!name) return false;
  const pc = pcName.toLowerCase();
  return name === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.startsWith("[") || name === pc || name === `${pc}.local`;
}

/**
 * The client's address. Behind the Vite proxy (xfwd, apps/web/vite.config.ts) the socket is loopback and
 * the proxy appended the real address as the last X-Forwarded-For entry; any other client's own
 * X-Forwarded-For is ignored.
 */
export function clientAddress(socketAddress: string | undefined, forwardedFor: string | string[] | undefined): string {
  const xff = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  if (isLoopback(socketAddress) && xff) return xff.split(",").at(-1)!.trim();
  return socketAddress ?? "";
}

/**
 * Why the server must not listen on `host`, or null. Beyond this PC it has no authentication (the LAN
 * token lives in the Vite server, apps/web/scripts/lan.ts): only with PAGINAVIVA_ALLOW_REMOTE=1.
 */
export function bindRefusal(host: string, env: NodeJS.ProcessEnv): string | null {
  if (host === "localhost" || isLoopback(host) || env.PAGINAVIVA_ALLOW_REMOTE === "1") return null;
  return `PAGINAVIVA_HOST=${host} would expose the API, which has no authentication, beyond this PC. Use pnpm dev:phone for the phone (docs/security.md), or set PAGINAVIVA_ALLOW_REMOTE=1 if you really mean it.`;
}

export function registerGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    const h = req.headers;
    if (!allowedHost(h.host)) return reply.code(403).send(FORBIDDEN);
    const site = h["sec-fetch-site"];
    if (site === "cross-site" || site === "same-site") return reply.code(403).send(FORBIDDEN);
    const path = req.url.split("?")[0]!;
    const changing = STATE_CHANGING.has(req.method);
    if (changing && h.origin !== undefined) {
      const origin = (() => {
        try {
          return new URL(h.origin).host.toLowerCase();
        } catch {
          return null;
        }
      })();
      if (origin !== h.host!.toLowerCase()) return reply.code(403).send(FORBIDDEN);
    }
    if ((changing && path.startsWith("/api/")) || path.startsWith("/api/i18n/")) {
      if (h[CLIENT_HEADER] !== "1") return reply.code(403).send(FORBIDDEN);
    }
  });

  // Internal error texts (paths, library messages) stay in the log (security review L9).
  app.setErrorHandler((err, req, reply) => {
    const code = (err as { statusCode?: unknown }).statusCode;
    const status = typeof code === "number" && code >= 400 && code < 500 ? code : 500;
    if (status === 500) req.log.error(err);
    return reply.code(status).send({ error: status === 500 ? "Errore interno del server." : "Richiesta non valida." });
  });
}
