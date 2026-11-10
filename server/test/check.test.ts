// Visual check: decision logic with fakes (no browser, no CLI).
import { describe, expect, it } from "vitest";
import { feedbackLines, judgeRequest, parseVerdict, shotPlan, visualCheck, visualCheckEnabled, type CheckDeps, type Problem, type Shot } from "../src/check/index.ts";
import { sanitizeEntry } from "../src/ledger.ts";
import type { LlmProvider, StructuredRequest } from "../src/llm/types.ts";
import { MESSAGES, PageCache, pageCacheKey, PIPELINE_VERSION, runPipeline } from "../src/pipeline/run.ts";
import type { GenerateInput, ProgressEvent } from "../src/pipeline/types.ts";
import { ANALYSIS, fakeStages, SCENE, syntheticPhoto } from "./pipeline-fakes.ts";

const STAGE_SCENE = { ...SCENE, engine: "concept" } as unknown as typeof SCENE;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const shots = (scene = STAGE_SCENE): Shot[] => shotPlan(scene).map((p) => ({ ...p, jpeg: JPEG }));

function judge(answer: unknown | (() => Promise<unknown>)): LlmProvider & { requests: StructuredRequest[] } {
  const requests: StructuredRequest[] = [];
  return {
    name: "mock",
    requests,
    async generateStructured(req) {
      requests.push(req);
      const data = typeof answer === "function" ? await (answer as () => Promise<unknown>)() : answer;
      return { data, durationMs: 1, model: "fake" };
    },
  };
}

const deps = (over: Partial<CheckDeps> = {}): CheckDeps => ({
  render: async (scene) => shots(scene),
  judge: judge({ problems: [] }),
  ledgerPath: null,
  ...over,
});

const PROBLEM: Problem = { chapter: "c1", severity: "blocking", what: "A lone cube floats above the book.", fix: "Draw two connected vessels." };
const MINOR: Problem = { chapter: "c2", severity: "minor", what: "The 'Tubo' label sits a bit above the tube.", fix: "Move the label onto the tube." };

describe("visual check pieces", () => {
  it("is on by default in live mode only, and the env flag overrides", () => {
    expect(visualCheckEnabled({}, "live")).toBe(true);
    expect(visualCheckEnabled({}, "mock")).toBe(false);
    expect(visualCheckEnabled({ PAGINAVIVA_VISUAL_CHECK: "false" }, "live")).toBe(false);
    expect(visualCheckEnabled({ PAGINAVIVA_VISUAL_CHECK: "true" }, "mock")).toBe(true);
  });

  it("plans the middle and the end of each chapter", () => {
    const plan = shotPlan(STAGE_SCENE);
    expect(plan).toHaveLength(STAGE_SCENE.chapters.length * 2);
    const c = STAGE_SCENE.chapters[0]!;
    expect(plan[0]).toEqual({ chapterId: c.id, t: Math.round(c.duration * 5) / 10, moment: "middle" });
    expect(plan[1]!.t).toBeLessThan(c.duration);
  });

  it("sends the photo first, then the screenshots, with the chapter summary", () => {
    const req = judgeRequest({ scene: STAGE_SCENE, shots: shots(), photo: { mediaType: "image/jpeg", data: JPEG }, analysis: ANALYSIS });
    expect(req.images).toHaveLength(1 + shots().length);
    expect(req.prompt).toContain(`chapter "${STAGE_SCENE.chapters[0]!.id}"`);
    expect(req.prompt).toContain("Image 2:");
    expect(req.prompt).toMatch(/Layout and physics/);
    expect(req.prompt).toMatch(/- blocking: .*- minor: /s);
    expect(req.jsonSchema.required).toEqual(["problems"]);
    const item = (req.jsonSchema.properties as { problems: { items: { required: string[]; properties: Record<string, { enum?: string[] }> } } }).problems.items;
    expect(item.required).toContain("severity");
    expect(item.properties.severity!.enum).toEqual(["blocking", "minor"]);
  });

  it("parses severities: ok means no blocking problem, blocking first, empty problems dropped", () => {
    expect(parseVerdict({ problems: [] })).toEqual({ ok: true, problems: [] });
    expect(parseVerdict({ problems: [MINOR, PROBLEM] })).toEqual({ ok: false, problems: [PROBLEM, MINOR] });
    expect(parseVerdict({ problems: [MINOR] })).toEqual({ ok: true, problems: [MINOR] });
    expect(parseVerdict({ problems: [{ ...PROBLEM, what: "", fix: "" }] })).toEqual({ ok: true, problems: [] });
  });

  it("malformed answers never block: unknown severity = minor, no problems array = error (check skipped)", () => {
    const { severity: _drop, ...noSeverity } = PROBLEM;
    expect(parseVerdict({ problems: [noSeverity, { ...PROBLEM, severity: "critical" }, null] })).toEqual({
      ok: true,
      problems: [{ ...PROBLEM, severity: "minor" }, { ...PROBLEM, severity: "minor" }],
    });
    expect(() => parseVerdict({ ok: false })).toThrow();
    expect(() => parseVerdict(null)).toThrow();
    expect(() => parseVerdict("problems")).toThrow();
  });

  it("keeps the verdict and the blocking/minor counts, never images, in the ledger", () => {
    const e = sanitizeEntry({ time: "t", kind: "check", phasesMs: { render: 1 }, verdict: "problems", problems: 3, blocking: 1, minor: 2, note: "c1: cube" });
    expect(e).toMatchObject({ kind: "check", verdict: "problems", problems: 3, blocking: 1, minor: 2, note: "c1: cube" });
    expect(sanitizeEntry({ time: "t", kind: "check", phasesMs: {}, blocking: "1" as unknown as number }).blocking).toBeUndefined();
  });
});

describe("visualCheck", () => {
  it("returns ok or the problems, with a check ledger line", async () => {
    const ok = await visualCheck({ scene: STAGE_SCENE, photo: JPEG }, deps());
    expect(ok).toMatchObject({ status: "ok", ledger: { kind: "check", verdict: "ok", llmCalls: 1, problems: 0, blocking: 0, minor: 0 } });
    expect(ok).not.toHaveProperty("minor");
    expect(Object.keys(ok.ledger.phasesMs)).toEqual(["render", "judge", "total"]);

    const bad = await visualCheck({ scene: STAGE_SCENE, photo: JPEG }, deps({ judge: judge({ problems: [MINOR, PROBLEM] }) }));
    expect(bad).toMatchObject({
      status: "problems",
      problems: [PROBLEM, MINOR],
      ledger: { verdict: "problems", problems: 2, blocking: 1, minor: 1, note: `c1: ${PROBLEM.what}` },
    });
  });

  it("minor problems only: passes (ok) and logs them", async () => {
    const r = await visualCheck({ scene: STAGE_SCENE, photo: JPEG }, deps({ judge: judge({ problems: [MINOR] }) }));
    expect(r).toMatchObject({ status: "ok", minor: [MINOR], ledger: { verdict: "ok", problems: 1, blocking: 0, minor: 1, note: `minor c2: ${MINOR.what}` } });
  });

  it("a malformed judge answer is skipped, never a regeneration", async () => {
    for (const answer of [{ ok: false }, null, "no", { problems: "c1 is wrong" }]) {
      const r = await visualCheck({ scene: STAGE_SCENE }, deps({ judge: judge(answer) }));
      expect(r).toMatchObject({ status: "skipped", ledger: { verdict: "skipped", llmCalls: 1 } });
      expect(r.ledger.blocking).toBeUndefined();
    }
  });

  it("skips gracefully: no browser or web server, judge failure, time cap, card scenes", async () => {
    const noChrome = await visualCheck({ scene: STAGE_SCENE }, deps({ render: async () => Promise.reject(new Error("chrome not found")) }));
    expect(noChrome).toMatchObject({ status: "skipped", reason: "chrome not found", ledger: { verdict: "skipped", note: "skipped: chrome not found" } });

    const judgeDown = await visualCheck({ scene: STAGE_SCENE }, deps({ judge: judge(async () => Promise.reject(new Error("cli_failed"))) }));
    expect(judgeDown.status).toBe("skipped");

    let aborted = false;
    const slow = await visualCheck(
      { scene: STAGE_SCENE },
      deps({
        timeoutMs: 20,
        render: (_s, signal) => new Promise((resolve) => signal.addEventListener("abort", () => ((aborted = true), resolve([])))),
      }),
    );
    expect(slow).toMatchObject({ status: "skipped" });
    expect(aborted).toBe(true);

    const fake = judge({ problems: [] });
    const card = await visualCheck({ scene: SCENE }, deps({ judge: fake }));
    expect(card.status).toBe("skipped");
    expect(fake.requests).toHaveLength(0);
  });

  it("turns problems into feedback lines for the repair request, minor ones marked", () => {
    expect(feedbackLines([PROBLEM, MINOR])).toEqual([
      `visual check, chapter "c1": ${PROBLEM.what} Fix: ${PROBLEM.fix}`,
      `visual check, chapter "c2" (minor, fix if easy): ${MINOR.what} Fix: ${MINOR.fix}`,
    ]);
  });
});

describe("runPipeline with the visual check", () => {
  const SECOND = { ...STAGE_SCENE, title: "Seconda versione" } as typeof SCENE;
  const gen = (input: GenerateInput, fallbackSecond = false) => ({
    scene: input.feedback ? (fallbackSecond ? SCENE : SECOND) : STAGE_SCENE,
    issues: [],
    fallback: !!input.feedback && fallbackSecond,
    repaired: false,
    durationMs: 1,
  });

  async function run(check: NonNullable<ReturnType<typeof fakeStages>["check"]>, fallbackSecond = false) {
    const checks: unknown[] = [];
    const stages = fakeStages({ generate: async (i) => gen(i, fallbackSecond) });
    stages.check = async (input) => {
      checks.push(input);
      return check(input);
    };
    const events: ProgressEvent[] = [];
    const r = await runPipeline(await syntheticPhoto(), { mode: "live", stages, onProgress: (e) => events.push(e) });
    return { r, events, stages, checks };
  }

  it("ok: keeps the first scene, one generation, check phase shown", async () => {
    const { r, events, stages, checks } = await run(async () => ({ status: "ok" }));
    expect(r).toMatchObject({ status: "scene", scene: STAGE_SCENE });
    expect(stages.calls.generate).toHaveLength(1);
    expect(checks).toHaveLength(1);
    expect((checks[0] as { photo: Buffer }).photo.length).toBeGreaterThan(0);
    expect(events.map((e) => e.phase)).toEqual(["analyze", "enrich", "generate", "check", "done"]);
    expect(events[3]!.message).toBe(MESSAGES.check);
    if (r.status === "scene") expect(Object.keys(r.timingsMs)).toContain("check");
  });

  it("minor problems only: keeps the first scene, no regeneration", async () => {
    const { r, events, stages } = await run(async () => ({ status: "ok", minor: [MINOR] }));
    expect(r).toMatchObject({ status: "scene", scene: STAGE_SCENE });
    expect(stages.calls.generate).toHaveLength(1);
    expect(events.map((e) => e.message)).not.toContain(MESSAGES.fix);
  });

  it("blocking problems: regenerates once with all the feedback and accepts it without another check", async () => {
    const { r, events, stages, checks } = await run(async () => ({ status: "problems", problems: [PROBLEM, MINOR] }));
    expect(r).toMatchObject({ status: "scene", scene: SECOND });
    expect(checks).toHaveLength(1);
    expect(stages.calls.generate).toHaveLength(2);
    expect(stages.calls.generate[1]!.feedback).toEqual({ previous: STAGE_SCENE, problems: feedbackLines([PROBLEM, MINOR]) });
    expect(events.map((e) => e.message)).toContain(MESSAGES.fix);
  });

  it("keeps the first scene when the regeneration falls back to a card", async () => {
    const { r } = await run(async () => ({ status: "problems", problems: [PROBLEM] }), true);
    expect(r).toMatchObject({ status: "scene", scene: STAGE_SCENE, fallback: false });
  });

  it("skipped or crashed check: the pipeline continues with the first scene", async () => {
    for (const check of [async () => ({ status: "skipped" as const, reason: "no chrome" }), async () => Promise.reject(new Error("boom"))]) {
      const { r, stages } = await run(check);
      expect(r).toMatchObject({ status: "scene", scene: STAGE_SCENE });
      expect(stages.calls.generate).toHaveLength(1);
    }
  });

  it("does not check fallback cards", async () => {
    const stages = fakeStages({ fallback: true });
    let checked = 0;
    stages.check = async () => (checked++, { status: "ok" });
    await runPipeline(await syntheticPhoto(), { mode: "live", stages });
    expect(checked).toBe(0);
  });
});

describe("page cache key", () => {
  it("includes the prompt and check versions", () => {
    expect(PIPELINE_VERSION).toMatch(/^an-\d+\.gen-\d+\.check-\d+$/);
    expect(pageCacheKey("live", "abc")).toBe(`live-${PIPELINE_VERSION}-abc`);
    expect(pageCacheKey("live", "abc", "an-1.gen-1.check-1")).not.toBe(pageCacheKey("live", "abc", "an-2.gen-1.check-1"));
  });

  it("serves results cached with the current versions, not those of older versions", async () => {
    const photo = await syntheticPhoto(7);
    const cache = new PageCache();
    const first = await runPipeline(photo, { mode: "live", stages: fakeStages(), cache });
    if (first.status !== "scene") throw new Error("expected a scene");
    expect(first.key).toBe(pageCacheKey("live", first.key.split("-").at(-1)!));

    const again = fakeStages();
    expect(await runPipeline(photo, { mode: "live", stages: again, cache })).toMatchObject({ cached: true });
    expect(again.calls.analyze).toHaveLength(0);

    // An entry written under an older version (or the old unversioned key) is not reused.
    const sha = first.key.split("-").at(-1)!;
    const old = new PageCache();
    old.set(`live-${sha}`, { ...first, summary: "vecchia" });
    old.set(pageCacheKey("live", sha, "an-0.gen-0.check-0"), { ...first, summary: "vecchia" });
    const fresh = fakeStages();
    const r = await runPipeline(photo, { mode: "live", stages: fresh, cache: old });
    expect(r).toMatchObject({ cached: false, summary: ANALYSIS.summary });
    expect(fresh.calls.analyze).toHaveLength(1);
  });
});
