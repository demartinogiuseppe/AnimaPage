import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePage } from "../src/analyze/index.ts";
import { LlmError, MockProvider } from "../src/llm/index.ts";
import { MESSAGES, PageCache, pageOnlyEnrichment, runPipeline, type RunOptions } from "../src/pipeline/run.ts";
import type { ProgressEvent } from "../src/pipeline/types.ts";
import { ANALYSIS, ENRICH, fakeStages, GEO, SCENE, syntheticPhoto } from "./pipeline-fakes.ts";

function run(photo: Buffer, opts: Partial<RunOptions> & Pick<RunOptions, "stages">) {
  const events: ProgressEvent[] = [];
  const done = runPipeline(photo, { mode: "live", onProgress: (e) => events.push(e), ...opts });
  return { events, done };
}

describe("runPipeline", () => {
  it("runs analyze -> enrich ‖ geo -> generate with Italian progress and the summary early", async () => {
    const stages = fakeStages();
    const { events, done } = run(await syntheticPhoto(), { stages });
    const r = await done;
    expect(r.status).toBe("scene");
    if (r.status !== "scene") return;
    expect(r.scene).toEqual(SCENE);
    expect(r.summary).toBe(ANALYSIS.summary);
    expect(events.map((e) => e.phase)).toEqual(["analyze", "enrich", "generate", "done"]);
    expect(events.map((e) => e.message)).toEqual([MESSAGES.analyze, MESSAGES.enrich, MESSAGES.generate, MESSAGES.done]);
    expect(events[0]!.summary).toBeUndefined();
    expect(events[1]!.summary).toBe(ANALYSIS.summary);
    expect(stages.calls.geo).toBe(1);
    expect(stages.calls.generate[0]).toEqual({ analysis: ANALYSIS, enrich: ENRICH, geo: GEO });
    expect(Object.keys(r.timingsMs)).toEqual(["image", "analyze", "enrich", "generate", "total"]);
  });

  it("asks for geodata only for map pages", async () => {
    const stages = fakeStages({ analyze: async () => ({ ...ANALYSIS, suggestedEngine: "timeline" }) });
    await run(await syntheticPhoto(), { stages }).done;
    expect(stages.calls.geo).toBe(0);
    expect(stages.calls.generate[0]!.geo).toBeUndefined();
  });

  it("live mode analyses the processed JPEG, mock mode the original bytes (recordings key)", async () => {
    const photo = await syntheticPhoto();
    const live = fakeStages();
    await run(photo, { stages: live }).done;
    expect(live.calls.analyze[0]!.equals(photo)).toBe(false);
    const mock = fakeStages();
    await run(photo, { stages: mock, mode: "mock" }).done;
    expect(mock.calls.analyze[0]!.equals(photo)).toBe(true);
  });

  it("stops with a retake result on unreadable pages or low confidence", async () => {
    const unreadable = fakeStages({
      analyze: async () => ({ ...ANALYSIS, readable: false, retake: { reason: "blurry", hint: "Tieni fermo il telefono." } }),
    });
    const { events, done } = run(await syntheticPhoto(), { stages: unreadable });
    const r = await done;
    expect(r).toMatchObject({ status: "retake", hint: "Tieni fermo il telefono.", summary: undefined });
    expect(events.map((e) => e.phase)).toEqual(["analyze", "done"]);
    expect(unreadable.calls.enrich + unreadable.calls.generate.length).toBe(0);

    const unsure = fakeStages({ analyze: async () => ({ ...ANALYSIS, confidence: 0.3 }) });
    expect(await run(await syntheticPhoto(), { stages: unsure }).done).toMatchObject({
      status: "retake",
      hint: MESSAGES.retakeHint,
    });
  });

  it("turns stage errors into Italian messages", async () => {
    const bad = await run(Buffer.from("not an image"), { stages: fakeStages() }).done;
    expect(bad).toEqual({ status: "error", stage: "image", message: MESSAGES.badImage });

    const missing = fakeStages({
      analyze: async () => {
        throw new LlmError("mock_missing", "no recording");
      },
    });
    const { events, done } = run(await syntheticPhoto(), { stages: missing });
    expect(await done).toEqual({ status: "error", stage: "analyze", message: MESSAGES.mockOnly });
    expect(events.at(-1)).toEqual({ phase: "error", message: MESSAGES.mockOnly });

    // analyzePage wraps provider errors in AnalysisError("<code>: <message>").
    const down = fakeStages({
      analyze: async () => {
        throw new Error("timeout: CLI did not answer");
      },
    });
    expect(await run(await syntheticPhoto(), { stages: down }).done).toMatchObject({ message: MESSAGES.analyzeDown });

    const gen = fakeStages({
      generate: async () => {
        throw new Error("generateScene not implemented yet");
      },
    });
    expect(await run(await syntheticPhoto(), { stages: gen }).done).toEqual({
      status: "error",
      stage: "generate",
      message: MESSAGES.generateFail,
    });
  });

  it("continues with the page alone when enrichment or geodata fail", async () => {
    const stages = fakeStages({
      enrich: async () => {
        throw new Error("enrich not implemented yet");
      },
      geo: async () => {
        throw new Error("geoContextFor not implemented yet");
      },
    });
    const { events, done } = run(await syntheticPhoto(), { stages });
    expect((await done).status).toBe("scene");
    expect(stages.calls.generate[0]).toEqual({ analysis: ANALYSIS, enrich: pageOnlyEnrichment(ANALYSIS), geo: undefined });
    expect(events.map((e) => e.message)).toContain(MESSAGES.noSources);
  });

  it("caches results per photo, except errors and fallback cards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-pages-"));
    const cache = new PageCache(dir);
    const photo = await syntheticPhoto(7);
    const stages = fakeStages();
    const first = await run(photo, { stages, cache }).done;
    expect(first).toMatchObject({ status: "scene", cached: false });
    const { events, done } = run(Buffer.from(photo), { stages, cache });
    expect(await done).toMatchObject({ status: "scene", cached: true, scene: SCENE });
    expect(events).toEqual([{ phase: "done", message: MESSAGES.cached, summary: ANALYSIS.summary }]);
    expect(stages.calls.analyze).toHaveLength(1);

    // On disk: a fresh cache instance (server restart) still hits; the file holds no photo.
    expect(await run(photo, { stages, cache: new PageCache(dir) }).done).toMatchObject({ cached: true });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, files[0]!), "utf8")).not.toMatch(/base64|ffd8ff/i);

    // The cache key includes the mode.
    await run(photo, { stages, cache, mode: "mock" }).done;
    expect(stages.calls.analyze).toHaveLength(2);

    const fallback = fakeStages({ fallback: true });
    const other = await syntheticPhoto(8);
    await run(other, { stages: fallback, cache }).done;
    await run(other, { stages: fallback, cache }).done;
    expect(fallback.calls.analyze).toHaveLength(2);
  });

  it("stores the processed photo only when asked", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pv-photos-")), "photos");
    await run(await syntheticPhoto(), { stages: fakeStages() }).done;
    expect(existsSync(dir)).toBe(false);
    await run(await syntheticPhoto(), { stages: fakeStages(), storePhotosDir: dir }).done;
    expect(readdirSync(dir)).toHaveLength(1);
  });
});

// Mock end-to-end with the real analysis stage replaying fixtures/llm. Book photos are
// git-ignored, so this only runs where fixtures/pages/ exists.
const PAGE = fileURLToPath(new URL("../../fixtures/pages/geografia_campania_p84.jpg", import.meta.url));
describe.skipIf(!existsSync(PAGE))("runPipeline in mock mode with recorded analysis", () => {
  it("analyses a fixture photo offline and reaches generation", async () => {
    const provider = new MockProvider();
    const stages = fakeStages({
      analyze: async (img) => (await analyzePage(img, { provider, cacheDir: null, ledgerPath: null })).analysis,
    });
    const r = await run(readFileSync(PAGE), { stages, mode: "mock" }).done;
    expect(r.status).toBe("scene");
    expect(stages.calls.generate[0]!.analysis.suggestedEngine).toBe("map");
    expect(stages.calls.geo).toBe(1);
  });
});
