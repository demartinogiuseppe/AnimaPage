// Decision D22: the first chapter while the model is still writing (streaming, incremental JSON,
// first-chapter validation, pipeline flow, mock chunked replay, non-streaming providers unchanged).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkScene, type SceneSpec } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { checkFirstChapter, chooseEngine, GENERATE_FIXTURES_DIR, generateScene, generationRequest } from "../src/generate/index.ts";
import { loadPageInputs } from "../src/generate/inputs.ts";
import { firstChapterData, JsonStreamScanner } from "../src/generate/stream.ts";
import { StructuredDeltaReader } from "../src/llm/claude-cli.ts";
import { MockProvider, readRecordings, replayChunks, requestKey } from "../src/llm/mock.ts";
import type { LlmProvider, StreamOptions, StructuredResponse } from "../src/llm/types.ts";
import { PageCache, runPipeline } from "../src/pipeline/run.ts";
import { fakeStages, SCENE, syntheticPhoto } from "./pipeline-fakes.ts";

const LABEL = "lab_piano-inclinato";
const recording = () => readRecordings(GENERATE_FIXTURES_DIR).find((r) => r.label === `gen_${LABEL}`)!;

/** Feeds `text` to a scanner in chunks of `size` characters. */
function scanIn(text: string, size: number): JsonStreamScanner {
  const s = new JsonStreamScanner();
  for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
  return s;
}

describe("incremental JSON scanner", () => {
  const data = recording().response.data as Record<string, unknown>;
  const compact = JSON.stringify(data);
  const pretty = JSON.stringify(data, null, 2);

  for (const size of [1, 7, 333, 100_000])
    it(`finds every top-level value in chunks of ${size}`, () => {
      const s = scanIn(size === 7 ? pretty : compact, size);
      expect(s.done).toBe(true);
      expect(Object.fromEntries(s.fields)).toEqual(data);
      expect(s.items.get("chapters")).toEqual(data.chapters);
    });

  it("gives array elements before the array, and the object, are closed", () => {
    const chapters = data.chapters as unknown[];
    const cut = compact.indexOf(JSON.stringify(chapters[1])) + 10; // inside chapter 2
    const s = scanIn(compact.slice(0, cut), 50);
    expect(s.done).toBe(false);
    expect(s.items.get("chapters")).toEqual([chapters[0]]);
    expect(s.fields.has("chapters")).toBe(false);
    expect(s.fields.get("title")).toBe(data.title);
  });

  it("is not fooled by braces, brackets, commas and escaped quotes inside strings", () => {
    const obj = { a: 'x "}],{[" \\ y', list: [{ t: "]" }, "a,b", 3, null], n: -1.5e3, b: true, z: "ü€😀" };
    const s = scanIn(JSON.stringify(obj), 3);
    expect(Object.fromEntries(s.fields)).toEqual(obj);
    expect(s.items.get("list")).toEqual(obj.list);
  });

  it("skips a garbled value and keeps the others", () => {
    const s = scanIn('{"title": "Ok", "kind": nope, "chapters": [{"id": "a"}, {bad}, {"id": "c"}], "end": 1}', 4);
    expect(s.fields.get("title")).toBe("Ok");
    expect(s.fields.has("kind")).toBe(false);
    expect(s.items.get("chapters")).toEqual([{ id: "a" }, { id: "c" }]);
    expect(s.fields.get("end")).toBe(1);
  });

  it("starts over on reset (a new attempt of the model)", () => {
    const s = scanIn('{"title": "Primo", "chapters": [{"id": "a"}', 5);
    s.reset();
    s.push('{"title": "Secondo"}');
    expect(Object.fromEntries(s.fields)).toEqual({ title: "Secondo" });
    expect(s.items.size).toBe(0);
  });
});

describe("Claude CLI partial messages", () => {
  const line = (event: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "stream_event", event, parent_tool_use_id: null, ...extra }) + "\n";
  const start = (index: number, block: unknown) => line({ type: "content_block_start", index, content_block: block });
  const delta = (index: number, partial_json: string) => line({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } });
  const tool = { type: "tool_use", id: "toolu_1", name: "StructuredOutput", input: {} };

  it("passes on the StructuredOutput JSON across split lines and split UTF-8 characters", () => {
    const got: [string, boolean][] = [];
    const reader = new StructuredDeltaReader({ onJsonDelta: (d, r) => got.push([d, r]) });
    const out = Buffer.from(
      JSON.stringify({ type: "system", subtype: "init", model: "x" }) +
        "\n" +
        start(0, { type: "thinking", thinking: "" }) +
        line({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "{\"no\":1}" } }) +
        start(1, tool) +
        delta(1, '{"title": "Perché') +
        delta(1, ' è così"}') +
        line({ type: "content_block_stop", index: 1 }) +
        JSON.stringify({ type: "result", subtype: "success", structured_output: { title: "Perché è così" } }) +
        "\n",
    );
    for (let i = 0; i < out.length; i += 5) reader.push(out.subarray(i, i + 5));
    expect(got[0]).toEqual(["", true]);
    expect(got.slice(1).map((g) => g[0]).join("")).toBe('{"title": "Perché è così"}');
    expect(got.slice(1).every((g) => !g[1])).toBe(true);
  });

  it("restarts on a second StructuredOutput call and ignores other blocks", () => {
    const got: string[] = [];
    const reader = new StructuredDeltaReader({ onJsonDelta: (d, r) => got.push(r ? "<restart>" : d) });
    reader.push(start(0, tool) + delta(0, '{"a":') + start(1, { type: "text", text: "" }) + delta(1, "ignored") + start(2, tool) + delta(2, '{"b":1}'));
    expect(got).toEqual(["<restart>", '{"a":', "<restart>", '{"b":1}']);
  });

  it("survives a listener that throws", () => {
    const reader = new StructuredDeltaReader({
      onJsonDelta: () => {
        throw new Error("boom");
      },
    });
    expect(() => reader.push(start(0, tool) + delta(0, "{}"))).not.toThrow();
  });
});

describe("mock chunked replay", () => {
  it("replays the recorded answer in chunks before resolving, after a restart", async () => {
    const rec = recording();
    const { input } = await loadPageInputs(LABEL);
    const req = generationRequest(input, chooseEngine(input.analysis, input.geo).engine);
    expect(requestKey(req)).toBe(rec.key);
    const parts: string[] = [];
    let restarts = 0;
    const res = await new MockProvider(GENERATE_FIXTURES_DIR, { chunkChars: 64 }).generateStructured(req, {
      onJsonDelta: (d, r) => (r ? restarts++ : parts.push(d)),
    });
    expect(restarts).toBe(1);
    expect(parts.length).toBeGreaterThan(50);
    expect(parts.join("")).toBe(JSON.stringify(rec.response.data));
    expect(res).toEqual(await new MockProvider(GENERATE_FIXTURES_DIR).generateStructured(req));
  });
});

describe("first chapter", () => {
  it("is ready once title, kind, engineData and chapters[0] are complete, filtered to that chapter", async () => {
    const data = recording().response.data as { chapters: { id: string }[]; engineData: { chapters: { chapter: string }[] } };
    const { input } = await loadPageInputs(LABEL);
    const text = JSON.stringify(data);
    // Not before engineData is complete (the model writes it last here).
    expect(firstChapterData(scanIn(text.slice(0, text.indexOf('"engineData"')), 200), "lab")).toBeUndefined();
    const ready = firstChapterData(scanIn(text, 200), "lab")!;
    const chapters = ready.chapters as { id: string }[];
    expect(chapters).toEqual([data.chapters[0]]);
    expect((ready.engineData as typeof data.engineData).chapters.map((c) => c.chapter)).toEqual([data.chapters[0]!.id]);
    const scene = checkFirstChapter(ready, "lab", input)!;
    expect(scene.chapters).toHaveLength(1);
    expect(checkScene(scene)).toEqual([]);
    expect(scene.videos).toEqual(input.enrich.videos);
  });

  it("is refused when chapter 1 itself is wrong", async () => {
    const data = structuredClone(recording().response.data) as { chapters: { narration: { at: number }[] }[] };
    const { input } = await loadPageInputs(LABEL);
    data.chapters[0]!.narration[1]!.at = -5;
    expect(checkFirstChapter(firstChapterData(scanIn(JSON.stringify(data), 500), "lab"), "lab", input)).toBeUndefined();
  });

  it("generateScene sends it once, during the streamed answer, and records the time", async () => {
    const { input } = await loadPageInputs(LABEL);
    const seen: SceneSpec[] = [];
    let done = false;
    const r = await generateScene(input, {
      provider: new MockProvider(GENERATE_FIXTURES_DIR, { chunkChars: 128 }),
      ledgerPath: null,
      onFirstChapter: (s) => {
        expect(done).toBe(false);
        seen.push(s);
      },
    });
    done = true;
    expect(seen).toHaveLength(1);
    expect(seen[0]!.chapters).toEqual([r.scene.chapters[0]]);
    expect(r.validation).toBe("ok");
    expect(r.phasesMs.firstChapter).toBeGreaterThanOrEqual(0);
    expect(r.ledger.phasesMs.firstChapter).toBe(r.phasesMs.firstChapter);
  });

  it("providers that answer all at once keep the old behaviour (no first chapter, same scene)", async () => {
    const { input } = await loadPageInputs(LABEL);
    const mock = new MockProvider(GENERATE_FIXTURES_DIR);
    let streamArg: StreamOptions | undefined | null = null;
    const allAtOnce: LlmProvider = {
      name: "openai:test",
      async generateStructured(req, stream): Promise<StructuredResponse> {
        streamArg ??= stream;
        return mock.generateStructured(req); // ignores the stream, like gemini-cli / openai-compatible
      },
    };
    const calls: SceneSpec[] = [];
    const a = await generateScene(input, { provider: allAtOnce, ledgerPath: null, onFirstChapter: (s) => calls.push(s) });
    const b = await generateScene(input, { provider: mock, ledgerPath: null });
    expect(streamArg).toBeDefined();
    expect(calls).toEqual([]);
    expect(a.scene).toEqual(b.scene);
    expect(a.phasesMs.firstChapter).toBeUndefined();
  });

  it("a regeneration after the visual check streams nothing", async () => {
    const { input } = await loadPageInputs(LABEL);
    let streamed = false;
    const p: LlmProvider = {
      name: "spy",
      async generateStructured(_req, stream) {
        streamed ||= !!stream;
        throw new Error("offline");
      },
    };
    await generateScene({ ...input, feedback: { previous: SCENE, problems: ["x"] } }, { provider: p, ledgerPath: null, onFirstChapter: () => {} });
    expect(streamed).toBe(false);
  });
});

describe("pipeline flow", () => {
  it("emits the first chapter before the result, times it, and caches/saves only the complete lesson", async () => {
    const first = { ...SCENE, chapters: [SCENE.chapters[0]!] };
    const order: string[] = [];
    const cache = new PageCache(null);
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "pv-ledger-")), "ledger.jsonl");
    const r = await runPipeline(await syntheticPhoto(7), {
      mode: "mock",
      cache,
      ledgerPath,
      stages: fakeStages({
        generate: async (_input, hooks) => {
          hooks?.onFirstChapter?.(first);
          await new Promise((res) => setTimeout(res, 20));
          order.push("generated");
          return { scene: SCENE, issues: [], fallback: false, repaired: false, durationMs: 1 };
        },
      }),
      onFirstChapter: (s) => order.push(`first:${s.chapters.length}`),
      onProgress: (e) => order.push(e.phase),
    });
    expect(order).toEqual(["analyze", "enrich", "generate", "first:1", "generated", "done"]);
    expect(r.status).toBe("scene");
    if (r.status !== "scene") return;
    expect(r.scene).toEqual(SCENE);
    expect(r.timingsMs.firstChapter).toBeLessThan(r.timingsMs.total!);
    expect(cache.get(r.key)).toMatchObject({ status: "scene", scene: SCENE });
    const line = JSON.parse(readFileSync(ledgerPath, "utf8").trim()) as { kind: string; phasesMs: Record<string, number> };
    expect(line.kind).toBe("pipeline");
    expect(line.phasesMs.firstChapter).toBe(r.timingsMs.firstChapter);
    expect(line.phasesMs.total).toBe(r.timingsMs.total);
  });

  it("replayChunks sends a restart and then the whole text", async () => {
    const got: string[] = [];
    await replayChunks("abcdefghij", { onJsonDelta: (d, r) => got.push(r ? "|" : d) }, { chunkChars: 4 });
    expect(got).toEqual(["|", "abcd", "efgh", "ij"]);
  });
});
