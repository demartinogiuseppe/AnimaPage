// docs/security.md (H1): localhost by default; LAN mode only on request, with an access token for other devices.
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOGS } from "@pv/scene-spec/i18n";
import { LAN_COOKIE, LAN_LOCKED, lanGuard, lanToken, UNLOCK_PATH } from "../scripts/lan.ts";

const TOKEN = "tok-123";

function call(url: string, opts: { from?: string; cookie?: string; secure?: boolean } = {}) {
  const req = { url, headers: opts.cookie ? { cookie: opts.cookie } : {}, socket: { remoteAddress: opts.from ?? "192.168.1.20" } } as unknown as IncomingMessage;
  const out = { status: 0, headers: {} as Record<string, string>, body: "", next: false };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      out.status = status;
      out.headers = headers;
    },
    end(body?: string) {
      out.body = body ?? "";
    },
  } as unknown as ServerResponse;
  lanGuard(TOKEN, { secure: opts.secure ?? true })(req, res, () => void (out.next = true));
  return out;
}

describe("lanToken", () => {
  it("is off by default, random with PAGINAVIVA_LAN=1, or the one dev:phone hands over", () => {
    expect(lanToken({})).toBeNull();
    const a = lanToken({ PAGINAVIVA_LAN: "1" });
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(lanToken({ PAGINAVIVA_LAN: "1" })).not.toBe(a);
    expect(lanToken({ PAGINAVIVA_LAN_TOKEN: "given" })).toBe("given");
  });
});

describe("lanGuard", () => {
  it("lets this PC through without a token", () => {
    for (const from of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(call("/api/lessons", { from }).next, from).toBe(true);
  });

  it("refuses the API and /cache to other devices without the token", () => {
    for (const url of ["/api/lessons", "/api/pages", "/cache/geo/x.bin", "/api"]) {
      const r = call(url);
      expect(r.next, url).toBe(false);
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body)).toEqual({ error: LAN_LOCKED });
    }
    expect(call("/api/lessons", { cookie: `${LAN_COOKIE}=wrong` }).status).toBe(401);
  });

  it("lets other devices through with the cookie; the app's own files need none", () => {
    expect(call("/api/lessons", { cookie: `a=b; ${LAN_COOKIE}=${TOKEN}` }).next).toBe(true);
    for (const url of ["/", "/index.html", "/assets/index.js", "/pagina-viva-ca.crt", "/apis.js"]) expect(call(url).next, url).toBe(true);
  });

  it("the access link sets an HttpOnly cookie and goes to the app; a wrong token is refused", () => {
    const ok = call(`${UNLOCK_PATH}?t=${TOKEN}`);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe("/");
    expect(ok.headers["set-cookie"]).toMatch(new RegExp(`^${LAN_COOKIE}=${TOKEN}; .*HttpOnly; SameSite=Strict.*; Secure$`));
    expect(call(`${UNLOCK_PATH}?t=${TOKEN}`, { secure: false }).headers["set-cookie"]).not.toMatch(/Secure/);
    for (const url of [`${UNLOCK_PATH}?t=nope`, UNLOCK_PATH]) {
      const r = call(url);
      expect(r.status, url).toBe(403);
      expect(r.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("its message is the Italian text of the catalog key the app translates", () => {
    expect(CATALOGS.it!["server.lanLocked"]).toBe(LAN_LOCKED);
  });
});

describe("vite.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const load = async () => (await import("../vite.config.ts")).default as { server: { host?: unknown; fs: { deny: string[] }; proxy: Record<string, { xfwd?: boolean }> } };

  it("dev:web listens on localhost only unless PAGINAVIVA_LAN=1", async () => {
    vi.stubEnv("PAGINAVIVA_LAN", "");
    vi.stubEnv("PAGINAVIVA_LAN_TOKEN", "");
    expect((await load()).server.host).toBeUndefined();
    vi.resetModules();
    vi.stubEnv("PAGINAVIVA_LAN", "1");
    expect((await load()).server.host).toBe(true);
  });

  it("never serves private folders, and tells the server the device address", async () => {
    const cfg = await load();
    for (const p of ["**/fixtures/pages/**", "**/server/data/**", "**/server/.cache/**", "**/.cert/**", ".env", "**/.git/**"]) expect(cfg.server.fs.deny).toContain(p);
    expect(cfg.server.proxy["/api"]!.xfwd).toBe(true);
  });
});
