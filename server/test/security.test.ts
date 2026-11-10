// Security review fixes (docs/security.md): the request guard of the local API (M1).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { CATALOGS, ENGLISH } from "@pv/scene-spec/i18n";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, PIPELINES_BUSY, RATE_LIMITED, TOO_MANY_PIXELS, type ServerOptions } from "../src/http/app.ts";
import { CatalogTranslator } from "../src/i18n.ts";
import { MAX_INPUT_PIXELS, preparePhoto } from "../src/image.ts";
import type { LlmProvider } from "../src/llm/types.ts";
import { allowedHost, bindRefusal, clientAddress } from "../src/http/guard.ts";
import { PageCache } from "../src/pipeline/run.ts";
import { LessonStore } from "../src/lessons/store.ts";
import { ANALYSIS, fakeStages, SCENE, syntheticPhoto } from "./pipeline-fakes.ts";

const BOUNDARY = "----pvsecboundary";
function photoBody(data: Buffer) {
  const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
  return {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function server(over: Partial<ServerOptions> = {}): Promise<FastifyInstance> {
  app = await buildServer({ mode: "mock", stages: fakeStages(), cache: new PageCache(null), geoDir: mkdtempSync(join(tmpdir(), "pv-geo-")), ...over });
  return app;
}

describe("allowedHost (DNS rebinding)", () => {
  it("accepts loopback names, IP literals and this PC's name", () => {
    for (const h of ["localhost", "localhost:5173", "127.0.0.1:8787", "[::1]:8787", "192.168.1.5:5443", "10.0.0.2", "MyPC:5173", "mypc.local:5173"])
      expect(allowedHost(h, "MyPC"), h).toBe(true);
  });
  it("refuses other names and malformed values", () => {
    for (const h of [undefined, "", "evil.example", "evil.example:8787", "localhost.evil.example", "127.0.0.1.nip.io", "a@localhost", "localhost/x", "mypc.evil"])
      expect(allowedHost(h, "MyPC"), String(h)).toBe(false);
  });
});

describe("clientAddress", () => {
  it("is the socket address, or the last X-Forwarded-For entry when the socket is the local proxy", () => {
    expect(clientAddress("192.168.1.9", undefined)).toBe("192.168.1.9");
    expect(clientAddress("192.168.1.9", "127.0.0.1")).toBe("192.168.1.9"); // spoofed by a LAN client
    expect(clientAddress("127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(clientAddress("::ffff:127.0.0.1", "1.2.3.4, 192.168.1.20")).toBe("192.168.1.20");
  });
});

describe("request guard (CSRF, DNS rebinding)", () => {
  it("refuses a foreign Host header", async () => {
    const s = await server();
    expect((await s.inject({ method: "GET", url: "/api/health", headers: { host: "evil.example" } })).statusCode).toBe(403);
    expect((await s.inject({ method: "GET", url: "/cache/geo/x.bin", headers: { host: "evil.example:8787" } })).statusCode).toBe(403);
    expect((await s.inject({ method: "GET", url: "/api/health", headers: { host: "192.168.1.5:5443" } })).statusCode).toBe(200);
  });

  it("refuses cross-site requests (Sec-Fetch-Site)", async () => {
    const s = await server();
    for (const site of ["cross-site", "same-site"])
      expect((await s.inject({ method: "GET", url: "/api/health", headers: { "sec-fetch-site": site } })).statusCode).toBe(403);
    for (const site of ["same-origin", "none"])
      expect((await s.inject({ method: "GET", url: "/api/health", headers: { "sec-fetch-site": site } })).statusCode).toBe(200);
  });

  it("state-changing calls need the X-AnimaPage header and the app's own Origin", async () => {
    const s = await server();
    const photo = photoBody(await syntheticPhoto());
    const post = (headers: Record<string, string>) => s.inject({ method: "POST", url: "/api/pages", payload: photo.payload, headers: { ...photo.headers, ...headers } });
    expect((await post({})).statusCode).toBe(403);
    expect((await post({ "x-animapage": "1", origin: "http://evil.example" })).statusCode).toBe(403);
    expect((await post({ "x-animapage": "1", origin: "null" })).statusCode).toBe(403);
    expect((await post({ "x-animapage": "1", host: "192.168.1.5:5443", origin: "https://192.168.1.5:5443" })).statusCode).toBe(202);
  });

  it("guards renames and deletes of lessons too", async () => {
    const lessons = new LessonStore(mkdtempSync(join(tmpdir(), "pv-lessons-")));
    const l = lessons.save(SCENE, { fallback: false });
    const s = await server({ lessons });
    expect((await s.inject({ method: "PATCH", url: `/api/lessons/${l.id}`, payload: { title: "x" } })).statusCode).toBe(403);
    expect((await s.inject({ method: "DELETE", url: `/api/lessons/${l.id}` })).statusCode).toBe(403);
    expect(lessons.has(l.id)).toBe(true);
    expect((await s.inject({ method: "DELETE", url: `/api/lessons/${l.id}`, headers: { "x-animapage": "1" } })).statusCode).toBe(204);
  });

  it("GET /api/i18n (it may start a translation) needs the header too", async () => {
    const s = await server();
    expect((await s.inject({ method: "GET", url: "/api/i18n/en" })).statusCode).toBe(403);
    expect((await s.inject({ method: "GET", url: "/api/i18n/en", headers: { "x-animapage": "1" } })).statusCode).not.toBe(403);
  });

  it("never sends internal error messages to the client", async () => {
    const s = await server();
    s.get("/api/boom", async () => {
      throw new Error("C:\\secret\\path failed");
    });
    const res = await s.inject({ method: "GET", url: "/api/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/secret/);
  });
});

// ---------------------------------------------------------------- H2: caps

const API = { "x-animapage": "1" };
const post = (s: FastifyInstance, data: Buffer, headers: Record<string, string> = {}) => {
  const b = photoBody(data);
  return s.inject({ method: "POST", url: "/api/pages", payload: b.payload, headers: { ...b.headers, ...API, ...headers } });
};

/** A PNG header that claims `w` x `h` pixels (sharp reads only the header for metadata). */
function pngHeader(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(16))), chunk("IEND", Buffer.alloc(0))]);
}

describe("caps (cost and resource use)", () => {
  it("runs at most maxPipelines pipelines at once; the next upload gets 429 + Retry-After", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = await server({ maxPipelines: 1, stages: fakeStages({ analyze: async () => (await gate, ANALYSIS) }) });
    const first = await post(s, await syntheticPhoto(1));
    expect(first.statusCode).toBe(202);
    const busy = await post(s, await syntheticPhoto(2));
    expect(busy.statusCode).toBe(429);
    expect(Number(busy.headers["retry-after"])).toBeGreaterThan(0);
    expect(busy.json()).toEqual({ error: PIPELINES_BUSY });
    release();
    await s.inject({ method: "GET", url: `/api/pages/${(first.json() as { id: string }).id}/events` });
    expect((await post(s, await syntheticPhoto(3))).statusCode).toBe(202);
  });

  it("limits uploads per client address", async () => {
    const s = await server({ maxPipelines: 10, pagesPerHour: 2 });
    const photo = await syntheticPhoto();
    expect((await post(s, photo)).statusCode).toBe(202);
    expect((await post(s, photo)).statusCode).toBe(202);
    const limited = await post(s, photo);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.json()).toEqual({ error: RATE_LIMITED });
    // Another device behind the Vite proxy (X-Forwarded-For appended by the proxy) has its own budget.
    expect((await post(s, photo, { "x-forwarded-for": "192.168.1.30" })).statusCode).toBe(202);
  });

  it("refuses images over the pixel limit, and formats that are not photos", async () => {
    const s = await server();
    const big = await post(s, pngHeader(8000, 6000));
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ error: TOO_MANY_PIXELS });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>');
    expect((await post(s, svg)).statusCode).toBe(415);
  });

  it("preparePhoto refuses to decode more than MAX_INPUT_PIXELS", async () => {
    expect(MAX_INPUT_PIXELS).toBe(40_000_000);
    await expect(preparePhoto(pngHeader(8000, 6000))).rejects.toThrow(/pixel/i);
  });
});

describe("i18n translations are bounded", () => {
  const counting = () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider: LlmProvider = {
      name: "fake",
      model: "fake",
      generateStructured: async (req) => {
        calls.push(req.prompt.slice(0, 80));
        await gate;
        return { data: { messages: ENGLISH }, model: "fake", durationMs: 1 };
      },
    };
    return { calls, release, provider };
  };

  it("never translates for tags that are not a known language and script", () => {
    const f = counting();
    const tr = new CatalogTranslator(() => f.provider, mkdtempSync(join(tmpdir(), "pv-i18n-")), () => {});
    for (const tag of ["xx", "qaa", "ko-Abcd", "zz-Qaaa"]) expect(tr.get(tag).status, tag).toBe("unavailable");
    expect(f.calls).toHaveLength(0);
  });

  it("one translation at a time, at most maxCatalogs on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-i18n-"));
    writeFileSync(join(dir, "nl.json"), "{}");
    const f = counting();
    const tr = new CatalogTranslator(() => f.provider, dir, () => {}, { maxCatalogs: 2 });
    expect(tr.get("ko").status).toBe("pending");
    expect(tr.get("ja").status).toBe("pending"); // waits: another translation is running
    expect(f.calls).toHaveLength(1);
    f.release();
    await tr.settle("ko");
    expect(tr.get("ko").status).toBe("ready");
    expect(tr.get("ja").status).toBe("unavailable"); // nl + ko = 2 catalogs: the cap
    expect(f.calls).toHaveLength(1);
  });
});

describe("the app translates the new server messages", () => {
  it("each message is the Italian text of a server.* catalog key", () => {
    expect(CATALOGS.it!["server.busy"]).toBe(PIPELINES_BUSY);
    expect(CATALOGS.it!["server.rateLimited"]).toBe(RATE_LIMITED);
    expect(CATALOGS.it!["server.tooManyPixels"]).toBe(TOO_MANY_PIXELS);
  });
});

describe("bind address (H1)", () => {
  it("the server listens beyond this PC only with PAGINAVIVA_ALLOW_REMOTE=1", () => {
    for (const host of ["127.0.0.1", "::1", "localhost"]) expect(bindRefusal(host, {}), host).toBeNull();
    for (const host of ["0.0.0.0", "::", "192.168.1.5"]) expect(bindRefusal(host, {}), host).toMatch(/PAGINAVIVA_ALLOW_REMOTE/);
    expect(bindRefusal("0.0.0.0", { PAGINAVIVA_ALLOW_REMOTE: "1" })).toBeNull();
  });
});
