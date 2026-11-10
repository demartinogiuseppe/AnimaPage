import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, type ServerOptions } from "../src/http/app.ts";
import { MESSAGES, PageCache, type PipelineStages } from "../src/pipeline/run.ts";
import { ANALYSIS, fakeStages, SCENE, syntheticPhoto } from "./pipeline-fakes.ts";

const BOUNDARY = "----pvtestboundary";

function multipart(field: string, data: Buffer, filename = "pagina.jpg") {
  const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
  return {
    headers: { "x-animapage": "1", "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
  };
}

/** Parses a text/event-stream body into { event, data } pairs. */
function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter((b) => b.includes("data:"))
    .map((b) => {
      const event = /^event: (.*)$/m.exec(b)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.*)$/m.exec(b)![1]!);
      return { event, data };
    });
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function server(stages: PipelineStages, over: Partial<ServerOptions> = {}): Promise<FastifyInstance> {
  app = await buildServer({
    mode: "mock",
    stages,
    cache: new PageCache(null),
    geoDir: mkdtempSync(join(tmpdir(), "pv-geo-")),
    ...over,
  });
  return app;
}

async function upload(s: FastifyInstance, data: Buffer) {
  return s.inject({ method: "POST", url: "/api/pages", ...multipart("photo", data) });
}

describe("http server", () => {
  it("answers the health check", async () => {
    const s = await server(fakeStages());
    const res = await s.inject({ method: "GET", url: "/api/health" });
    expect(res.json()).toEqual({ ok: true, mode: "mock" });
  });

  it("upload -> events -> scene", async () => {
    const s = await server(fakeStages());
    const up = await upload(s, await syntheticPhoto());
    expect(up.statusCode).toBe(202);
    const { id } = up.json() as { id: string };
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const ev = await s.inject({ method: "GET", url: `/api/pages/${id}/events` });
    expect(ev.statusCode).toBe(200);
    expect(ev.headers["content-type"]).toMatch(/^text\/event-stream/);
    const msgs = parseSse(ev.body);
    expect(msgs.map((m) => m.event)).toEqual(["progress", "progress", "progress", "progress", "result"]);
    expect(msgs[0]!.data).toEqual({ phase: "analyze", message: MESSAGES.analyze });
    expect(msgs[1]!.data).toMatchObject({ phase: "enrich", summary: ANALYSIS.summary });
    expect(msgs[4]!.data).toEqual({ status: "scene", summary: ANALYSIS.summary, fallback: false, cached: false });

    const scene = await s.inject({ method: "GET", url: `/api/pages/${id}/scene` });
    expect(scene.statusCode).toBe(200);
    expect(scene.json()).toEqual(SCENE);

    // Reconnecting replays everything and ends.
    const again = await s.inject({ method: "GET", url: `/api/pages/${id}/events` });
    expect(parseSse(again.body)).toEqual(msgs);
  });

  it("streams events live while the job runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stages = fakeStages({
      generate: async () => {
        await gate;
        return { scene: SCENE, issues: [], fallback: false, repaired: false, durationMs: 1 };
      },
    });
    const s = await server(stages);
    const { id } = (await upload(s, await syntheticPhoto())).json() as { id: string };
    const pending = await s.inject({ method: "GET", url: `/api/pages/${id}/scene` });
    expect(pending.statusCode).toBe(202);
    const ev = s.inject({ method: "GET", url: `/api/pages/${id}/events` });
    setTimeout(release, 30);
    const msgs = parseSse((await ev).body);
    expect(msgs.at(-1)!.event).toBe("result");
    expect(msgs.filter((m) => m.event === "progress")).toHaveLength(4);
  });

  it("sends the first chapter ahead of the result, also on reconnect (D22)", async () => {
    const first = { ...SCENE, chapters: [SCENE.chapters[0]!] };
    const s = await server(
      fakeStages({
        generate: async (_input, hooks) => {
          hooks?.onFirstChapter?.(first);
          return { scene: SCENE, issues: [], fallback: false, repaired: false, durationMs: 1 };
        },
      }),
    );
    const { id } = (await upload(s, await syntheticPhoto())).json() as { id: string };
    const msgs = parseSse((await s.inject({ method: "GET", url: `/api/pages/${id}/events` })).body);
    expect(msgs.map((m) => m.event)).toEqual(["progress", "progress", "progress", "chapter", "progress", "result"]);
    expect(msgs[3]!.data).toEqual({ scene: first });
    // The scene route serves the complete lesson only.
    expect((await s.inject({ method: "GET", url: `/api/pages/${id}/scene` })).json()).toEqual(SCENE);
    const again = parseSse((await s.inject({ method: "GET", url: `/api/pages/${id}/events` })).body);
    expect(again.map((m) => m.event)).toEqual(["progress", "progress", "progress", "progress", "chapter", "result"]);
  });

  it("reports retake and errors on the scene route", async () => {
    const s = await server(
      fakeStages({ analyze: async () => ({ ...ANALYSIS, readable: false, retake: { reason: "glare", hint: "Evita i riflessi." } }) }),
    );
    const { id } = (await upload(s, await syntheticPhoto())).json() as { id: string };
    const msgs = parseSse((await s.inject({ method: "GET", url: `/api/pages/${id}/events` })).body);
    expect(msgs.at(-1)!.data).toEqual({ status: "retake", hint: "Evita i riflessi.", cached: false });
    const scene = await s.inject({ method: "GET", url: `/api/pages/${id}/scene` });
    expect(scene.statusCode).toBe(422);
    expect(scene.json()).toMatchObject({ status: "retake" });
  });

  it("rejects bad uploads with Italian messages", async () => {
    const s = await server(fakeStages(), { maxUploadBytes: 50_000 });
    const notImage = await upload(s, Buffer.from("ciao"));
    expect(notImage.statusCode).toBe(415);
    expect(notImage.json()).toEqual({ error: MESSAGES.badImage });

    const big = await upload(s, Buffer.alloc(60_000, 1));
    expect(big.statusCode).toBe(413);
    expect((big.json() as { error: string }).error).toMatch(/troppo grande/);

    const noFile = await s.inject({ method: "POST", url: "/api/pages", payload: { photo: "x" }, headers: { "x-animapage": "1" } });
    expect(noFile.statusCode).toBe(400);

    for (const url of ["/api/pages/nope/events", "/api/pages/nope/scene"]) {
      expect((await s.inject({ method: "GET", url })).statusCode).toBe(404);
    }
  });

  it("serves built geodata under /cache/geo/", async () => {
    const geoDir = mkdtempSync(join(tmpdir(), "pv-geo-"));
    mkdirSync(join(geoDir, "campania"));
    writeFileSync(join(geoDir, "campania", "terrain.json"), '{"ok":true}');
    const s = await server(fakeStages(), { geoDir });
    const res = await s.inject({ method: "GET", url: "/cache/geo/campania/terrain.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect((await s.inject({ method: "GET", url: "/cache/geo/../package.json" })).statusCode).toBe(404);
  });
});
