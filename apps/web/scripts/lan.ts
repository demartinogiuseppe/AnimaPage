// LAN mode of the web server (docs/security.md, H1). The app server (`pnpm dev:web`) listens on
// localhost only; other devices reach it only in LAN mode: `pnpm dev:phone` (HTTPS preview) or
// PAGINAVIVA_LAN=1 for `pnpm dev:web`. In LAN mode a random access token is made at start and the
// API (/api, /cache, proxied to the AnimaPage server) answers other devices only when they carry it:
// they open <url>/api/lan?t=<token> once (the launcher prints that link), which sets an HttpOnly
// cookie. Requests from this PC (loopback) need no token. The app's own files are public (MIT source).
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Visited once by another device. Under /api/ so the PWA service worker never answers it from cache. */
export const UNLOCK_PATH = "/api/lan";
export const LAN_COOKIE = "animapage_lan";
/** Same text as the catalog key "server.lanLocked" (the app shows it translated). */
export const LAN_LOCKED = "Questo dispositivo non è autorizzato: apri il link di accesso mostrato sul PC (pnpm dev:phone), poi riprova.";
const COOKIE_MAX_AGE_S = 30 * 86400;

export const newLanToken = (): string => randomBytes(18).toString("base64url");

/**
 * LAN mode from the environment: the token handed over by `pnpm dev:phone` (PAGINAVIVA_LAN_TOKEN), a
 * fresh one for PAGINAVIVA_LAN=1, or null (localhost only).
 */
export function lanToken(env: NodeJS.ProcessEnv): string | null {
  if (env.PAGINAVIVA_LAN_TOKEN) return env.PAGINAVIVA_LAN_TOKEN;
  return env.PAGINAVIVA_LAN === "1" ? newLanToken() : null;
}

export const isLoopback = (addr: string | undefined): boolean => !!addr && /^(127\.|::1$|::ffff:127\.)/.test(addr);

function same(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

type Next = () => void;

/** Connect middleware for the Vite dev and preview servers; it must run before the /api proxy. */
export function lanGuard(token: string, opts: { secure: boolean }) {
  return (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === UNLOCK_PATH) {
      if (!same(url.searchParams.get("t") ?? undefined, token)) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end(`${LAN_LOCKED}\n`);
        return;
      }
      const flags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}${opts.secure ? "; Secure" : ""}`;
      res.writeHead(302, { "set-cookie": `${LAN_COOKIE}=${token}; ${flags}`, location: "/", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (isLoopback(req.socket.remoteAddress)) return next();
    const p = url.pathname;
    const api = p === "/api" || p.startsWith("/api/") || p === "/cache" || p.startsWith("/cache/");
    if (!api || same(cookie(req.headers.cookie, LAN_COOKIE), token)) return next();
    res.writeHead(401, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: LAN_LOCKED }));
  };
}
