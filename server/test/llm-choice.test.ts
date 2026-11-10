// Per-phase model choice over HTTP (decision D20): GET /api/providers, the "llm" upload field
// (validated against the registry, ignored in mock mode) and its part in the page cache key.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, MODEL_REJECTED, type ServerOptions } from "../src/http/app.ts";
import { parseRegistry, PHASES, type AvailabilityChecker, type LlmChoice, type ProviderStatus } from "../src/llm/registry.ts";
import { PageCache, pageCacheKey, PIPELINE_VERSION, runPipeline } from "../src/pipeline/run.ts";
import { fakeStages, syntheticPhoto, type FakeStages } from "./pipeline-fakes.ts";

const REG = parseRegistry(`
providers:
  - { id: claude, label: Claude, kind: claude-cli, models: [opus, sonnet], vision: true, jsonSchema: true }
  - { id: ollama, label: Ollama, kind: openai, baseUrl: "http://localhost:11434/v1", models: [gemma3:4b], vision: true, jsonSchema: true }
  - { id: writer, label: Solo testo, kind: openai, baseUrl: "http://localhost:1234/v1", models: [t1], vision: false, jsonSchema: false }
`);
const DEFAULT = { provider: "claude", model: "opus" };
const STATUS: ProviderStatus[] = [
  { id: "claude", label: "Claude", kind: "claude-cli", vision: true, jsonSchema: true, available: true, models: [{ id: "opus", available: true }] },
];

const BOUNDARY = "----pvllmboundary";
function multipart(photo: Buffer, llm?: string) {
  const parts: Buffer[] = [];
  if (llm !== undefined) parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="llm"\r\n\r\n${llm}\r\n`));
  parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), photo, Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return { headers: { "x-animapage": "1", "content-type": `multipart/form-data; boundary=${BOUNDARY}` }, payload: Buffer.concat(parts) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function setup(mode: "live" | "mock", over: Partial<ServerOptions> = {}) {
  const base = fakeStages();
  const chosen: { choice: LlmChoice; stages: FakeStages }[] = [];
  const opts: ServerOptions = {
    mode,
    stages: base,
    cache: new PageCache(null),
    geoDir: mkdtempSync(join(tmpdir(), "pv-geo-")),
    llm: {
      registry: REG,
      defaults: DEFAULT,
      availability: { status: async () => STATUS } as unknown as AvailabilityChecker,
      stagesFor: (choice) => {
        const stages = fakeStages();
        chosen.push({ choice, stages });
        return stages;
      },
    },
    ...over,
  };
  return { opts, base, chosen };
}

async function run(s: FastifyInstance, photo: Buffer, llm?: string) {
  const up = await s.inject({ method: "POST", url: "/api/pages", ...multipart(photo, llm) });
  if (up.statusCode === 202) await s.inject({ method: "GET", url: `/api/pages/${(up.json() as { id: string }).id}/events` });
  return up;
}

describe("GET /api/providers", () => {
  it("lists phases, the server default and the providers' status", async () => {
    const { opts } = setup("live");
    app = await buildServer(opts);
    const res = (await app.inject({ method: "GET", url: "/api/providers" })).json();
    expect(res).toEqual({ mode: "live", phases: PHASES, defaults: { analyze: DEFAULT, generate: DEFAULT, check: DEFAULT }, providers: STATUS });
  });
  it("works without a registry (no choice possible)", async () => {
    const { opts } = setup("mock", { llm: undefined });
    app = await buildServer(opts);
    expect((await app.inject({ method: "GET", url: "/api/providers" })).json()).toMatchObject({ mode: "mock", providers: [] });
  });
});

describe("POST /api/pages with a model choice", () => {
  it("rejects unlisted providers or models and non-vision models for vision phases (live)", async () => {
    const { opts, base, chosen } = setup("live");
    app = await buildServer(opts);
    const photo = await syntheticPhoto(1);
    for (const llm of [
      JSON.stringify({ analyze: { provider: "http://evil.example/v1", model: "x" } }),
      JSON.stringify({ generate: { provider: "ollama", model: "llama-evil" } }),
      JSON.stringify({ check: { provider: "writer", model: "t1" } }),
      "{broken",
    ]) {
      const res = await run(app, photo, llm);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: MODEL_REJECTED });
    }
    expect(chosen).toHaveLength(0);
    expect(base.calls.analyze).toHaveLength(0);
  });

  it("uses stages for the choice, and the choice is part of the cache key", async () => {
    const { opts, base, chosen } = setup("live");
    app = await buildServer(opts);
    const photo = await syntheticPhoto(2);
    const llm = JSON.stringify({ analyze: { provider: "ollama", model: "gemma3:4b" }, generate: { provider: "writer", model: "t1" }, check: DEFAULT });
    expect((await run(app, photo, llm)).statusCode).toBe(202);
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.choice).toEqual({ analyze: { provider: "ollama", model: "gemma3:4b" }, generate: { provider: "writer", model: "t1" } });
    expect(chosen[0]!.stages.calls.analyze).toHaveLength(1);
    expect(base.calls.analyze).toHaveLength(0);
    // The same photo with the server default is a different cache entry: it runs again.
    await run(app, photo);
    expect(base.calls.analyze).toHaveLength(1);
    // The same choice again hits the cache.
    await run(app, photo, llm);
    expect(chosen[1]!.stages.calls.analyze).toHaveLength(0);
  });

  it("a choice equal to the server default keeps the default stages", async () => {
    const { opts, base, chosen } = setup("live");
    app = await buildServer(opts);
    await run(app, await syntheticPhoto(3), JSON.stringify({ analyze: DEFAULT, generate: DEFAULT, check: DEFAULT }));
    expect(chosen).toHaveLength(0);
    expect(base.calls.analyze).toHaveLength(1);
  });

  it("mock mode ignores the field, even an invalid one", async () => {
    const { opts, base, chosen } = setup("mock");
    app = await buildServer(opts);
    expect((await run(app, await syntheticPhoto(4), JSON.stringify({ analyze: { provider: "nope", model: "x" } }))).statusCode).toBe(202);
    expect(chosen).toHaveLength(0);
    expect(base.calls.analyze).toHaveLength(1);
  });
});

describe("page cache key", () => {
  it("is unchanged for the default and differs per model choice", async () => {
    expect(pageCacheKey("live", "abc")).toBe(`live-${PIPELINE_VERSION}-abc`);
    expect(pageCacheKey("live", "abc", PIPELINE_VERSION, "")).toBe(`live-${PIPELINE_VERSION}-abc`);
    const a = pageCacheKey("live", "abc", PIPELINE_VERSION, "analyze=ollama/gemma3:4b");
    const b = pageCacheKey("live", "abc", PIPELINE_VERSION, "analyze=ollama/qwen2.5vl:3b");
    expect(a).toMatch(new RegExp(`^live-${PIPELINE_VERSION.replace(/\./g, "\\.")}-llm[0-9a-f]{12}-abc$`));
    expect(a).not.toBe(b);
    const r = await runPipeline(await syntheticPhoto(5), { mode: "live", stages: fakeStages(), llmTag: "generate=ollama/gemma3:4b" });
    expect(r.status === "scene" && r.key).toMatch(/-llm[0-9a-f]{12}-[0-9a-f]{64}$/);
  });
});
