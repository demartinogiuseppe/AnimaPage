// M4 generation: PageAnalysis + facts (+ geo) -> validated SceneSpec (brief §4.6).
//
// Pipeline: engine choice -> early chapter from the analysis (no LLM, for the first content)
// -> one structured LLM call constrained by the engine's SceneSpec schema -> zod parse ->
// server-side fixes -> checkScene + content checks -> if anything is wrong, ONE repair call
// with the issue list -> if still structurally invalid, the deterministic `card` fallback.
// One ledger line (kind "generate") per scene.
import { applyMusicCues, checkScene, SceneSpec, type Chapter, type EngineId } from "@pv/scene-spec";
import { appendLedger, sanitizeEntry, type LedgerEntry } from "../ledger.ts";
import type { LlmProvider, LlmUsage, StreamOptions, StructuredRequest, StructuredResponse } from "../llm/index.ts";
import type { GenerateInput, GenerateResult, Issue } from "../pipeline/types.ts";
import { checkAudio, checkGeoBounds, checkLessonParts, checkMathActivity, checkNumberProvenance, checkStyle, numberIndex, postprocess } from "./checks.ts";
import { cardFromAnalysis, earlyChapter } from "./fallback.ts";
import { chooseEngine, generationRequest, repairRequest, ASSET_BASE_DIR } from "./prompt.ts";
import { firstChapterData, JsonStreamScanner } from "./stream.ts";

export { chooseEngine, generationRequest, buildPrompt, GENERATE_PROMPT_VERSION, GENERATE_FIXTURES_DIR } from "./prompt.ts";
export { cardFromAnalysis, earlyChapter } from "./fallback.ts";
export { sceneJsonSchema } from "./schema.ts";
export { quickIntro } from "./quick.ts";

export interface GenerateOptions {
  provider: LlmProvider;
  /** null disables the ledger. */
  ledgerPath?: string | null;
  /** Called right away with a first chapter built from the analysis summary (first content, no LLM). */
  onEarly?: (chapter: Chapter) => void;
  /** Web asset base (GeoContext paths are relative to it); default fixtures/public. */
  assetDir?: string;
  /**
   * Decision D22: called at most once, while a streaming provider is still writing, with a validated
   * scene holding only the first chapter. Not called for providers that answer all at once, nor for a
   * regeneration after the visual check (input.feedback).
   */
  onFirstChapter?: (scene: SceneSpec) => void;
}

export type GenerateValidation = "ok" | "repaired" | "fallback";

export interface GenerateOutcome extends GenerateResult {
  /** Engine chosen before generation (the scene's engine is "card" after a fallback). */
  engine: EngineId;
  engineOverride?: string;
  validation: GenerateValidation;
  /** Content warnings for human review (audio, style, timing); not blocking. */
  warnings: Issue[];
  /** Server-side fixes applied to the generated scene. */
  fixes: string[];
  /** Why the fallback was used. */
  fallbackReason?: string;
  /** Problems of the first answer that triggered the repair call. */
  repairProblems: string[];
  model?: string;
  llmCalls: number;
  /** Sum of the durations reported by the provider (for recordings: the live time when recorded). */
  llmReportedMs: number;
  usage: LlmUsage;
  phasesMs: Record<string, number>;
  ledger: LedgerEntry;
}

interface Candidate {
  scene?: SceneSpec;
  /** Structural problems: zod, checkScene, geo bounds. A scene with errors is never shown. */
  errors: string[];
  /** Numbers that are neither on the page nor in a fact: repaired once, then reported. */
  content: Issue[];
  warnings: Issue[];
  fixes: string[];
}

const fmt = (i: Issue) => `${i.path}: ${i.message}`;

function evaluate(data: unknown, engine: EngineId, input: GenerateInput): Candidate {
  const parsed = SceneSpec.safeParse(data);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 30).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
    return { errors, content: [], warnings: [], fixes: [] };
  }
  // Instrument cues of music scenes are computed from the score, never written by the model.
  const scene = parsed.data.engine === "music" ? applyMusicCues(parsed.data, parsed.data.engineData) : parsed.data;
  if (scene.engine !== engine) return { errors: [`engine: expected "${engine}", got "${scene.engine}"`], content: [], warnings: [], fixes: [] };
  const { applied } = postprocess(scene, input);
  const dropped = dropUnknownSliders(scene);
  const errors = [...checkScene(scene), ...checkGeoBounds(scene, input)].map(fmt);
  const content = [...checkNumberProvenance(scene, numberIndex(input, scene)), ...checkLessonParts(scene), ...checkMathActivity(scene, input)];
  const warnings = [...checkAudio(scene), ...checkStyle(scene, input), ...dropped];
  return { scene, errors, content, warnings, fixes: applied };
}

/** Parts of the scene still to come in the stream or rebuilt by the server: no reason to hold back chapter 1. */
const LATER = /^(disclaimers|sources|videos|music)/;

/**
 * The first-chapter scene (D22) through the same parse, fixes and checks as a whole answer; undefined
 * if anything that concerns it is wrong. Lesson-wide content rules (path "chapters", e.g. "no chapter
 * has a Prova tu") are left to the complete scene.
 */
export function checkFirstChapter(data: unknown, engine: EngineId, input: GenerateInput): SceneSpec | undefined {
  const c = evaluate(data, engine, input);
  if (!c.scene) return undefined;
  if (c.errors.some((e) => !LATER.test(e))) return undefined;
  if (c.content.some((i) => i.path !== "chapters")) return undefined;
  return c.scene;
}

/**
 * Slider ids the engines do not know (checkScene: "...activity.test.params...") are dropped with a
 * warning instead of costing a repair: the rest of the activity still works without the slider.
 */
export function dropUnknownSliders(scene: SceneSpec): Issue[] {
  const dropped: Issue[] = [];
  for (const i of checkScene(scene)) {
    const m = /^chapters\[(\d+)\]\.activity\.test\.params/.exec(i.path);
    const id = /"([^"]+)"/.exec(i.message)?.[1];
    const test = m ? scene.chapters[Number(m[1])]?.activity?.test : undefined;
    if (!test?.params || !id || !test.params.includes(id)) continue;
    test.params = test.params.filter((p) => p !== id);
    if (test.params.length === 0) delete test.params;
    dropped.push({ path: i.path, message: `slider "${id}" dropped: ${i.message}` });
  }
  return dropped;
}

function addUsage(acc: LlmUsage, u: LlmUsage | undefined): void {
  if (!u) return;
  for (const k of Object.keys(u) as (keyof LlmUsage)[]) {
    const v = u[k];
    if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
  }
}

const errText = (e: unknown) => (e instanceof Error ? `${(e as { code?: string }).code ?? e.name}: ${e.message}` : String(e));

export async function generateScene(input: GenerateInput, opts: GenerateOptions): Promise<GenerateOutcome> {
  const t0 = performance.now();
  const phasesMs: Record<string, number> = {};
  const lap = (name: string, since: number) => (phasesMs[name] = Math.round(performance.now() - since));
  const usage: LlmUsage = {};
  let llmCalls = 0;
  let llmReportedMs = 0;
  let model: string | undefined;
  const assetDir = opts.assetDir ?? ASSET_BASE_DIR;

  const { engine, override } = chooseEngine(input.analysis, input.geo);

  let t = performance.now();
  opts.onEarly?.(earlyChapter(input));
  lap("early", t);

  const call = async (req: StructuredRequest, phase: string, stream?: StreamOptions): Promise<StructuredResponse> => {
    const ts = performance.now();
    try {
      const res = await opts.provider.generateStructured(req, stream);
      model = res.model;
      llmReportedMs += res.durationMs;
      addUsage(usage, res.usage);
      return res;
    } finally {
      llmCalls++;
      lap(phase, ts);
    }
  };

  // D22: the first chapter goes out as soon as the stream holds it complete and valid.
  const firstChapterStream = (): StreamOptions | undefined => {
    const onFirst = opts.onFirstChapter;
    if (!onFirst) return undefined;
    const scan = new JsonStreamScanner();
    let seen = -1;
    let sent = false;
    return {
      onJsonDelta(delta, restart) {
        if (sent) return;
        try {
          if (restart) scan.reset();
          scan.push(delta);
          if (scan.version === seen) return;
          seen = scan.version;
          const data = firstChapterData(scan, engine);
          if (!data) return;
          // Tried once: what it needs is complete and will not change in this attempt.
          sent = true;
          const scene = checkFirstChapter(data, engine, input);
          if (!scene) return;
          phasesMs.firstChapter = Math.round(performance.now() - t0);
          onFirst(scene);
        } catch (e) {
          sent = true;
          console.warn(`[generate] first chapter skipped: ${errText(e).slice(0, 300)}`);
        }
      },
    };
  };

  let chosen: Candidate | undefined;
  let validation: GenerateValidation = "ok";
  let fallbackReason: string | undefined;
  let llmError: string | undefined;
  let repairProblems: string[] = [];

  t = performance.now();
  const req = generationRequest(input, engine, assetDir);
  lap("prompt", t);

  try {
    // After a visual check: the rejected scene and its problems, through the repair request.
    const fb = input.feedback;
    const first = await call(fb ? repairRequest(req, fb.previous, fb.problems) : req, "llm", fb ? undefined : firstChapterStream());
    t = performance.now();
    const c1 = evaluate(first.data, engine, input);
    lap("validate", t);
    if (c1.errors.length === 0 && c1.content.length === 0) chosen = c1;
    else {
      const problems = [...c1.errors, ...c1.content.map(fmt)];
      repairProblems = problems;
      let c2: Candidate | undefined;
      try {
        const second = await call(repairRequest(req, first.data, problems), "repair");
        t = performance.now();
        c2 = evaluate(second.data, engine, input);
        lap("validateRepair", t);
      } catch (e) {
        llmError = errText(e);
      }
      if (c2 && c2.errors.length === 0) {
        chosen = c2;
        validation = "repaired";
      } else if (c1.errors.length === 0) chosen = c1; // the repair made it worse: keep the first answer
      else fallbackReason = `invalid after repair: ${(c2?.errors ?? c1.errors).slice(0, 5).join("; ")}${llmError ? `; ${llmError}` : ""}`;
    }
  } catch (e) {
    llmError = errText(e);
    fallbackReason = `generation failed: ${llmError}`;
  }

  let scene: SceneSpec;
  let issues: Issue[];
  let warnings: Issue[] = [];
  let fixes: string[] = [];
  if (chosen?.scene) {
    scene = chosen.scene;
    issues = chosen.content;
    warnings = chosen.warnings;
    fixes = chosen.fixes;
  } else {
    t = performance.now();
    scene = cardFromAnalysis(input);
    issues = checkScene(scene);
    validation = "fallback";
    lap("fallback", t);
  }
  const durationMs = Math.round(performance.now() - t0);
  phasesMs.total = durationMs;

  const entry: LedgerEntry = {
    time: new Date().toISOString(),
    kind: "generate",
    provider: opts.provider.name,
    model: model ?? opts.provider.model,
    phasesMs,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    cacheReadTokens: usage.cacheReadInputTokens,
    cacheCreationTokens: usage.cacheCreationInputTokens,
    costUsdEstimate: usage.costUsdEstimate,
    llmCalls,
    externalRequests: 0,
    engine: scene.engine,
    validation: validation === "fallback" ? (llmError && !chosen ? "error" : "failed") : validation,
    error: fallbackReason ? `fallback card (${engine}): ${fallbackReason}` : undefined,
  };
  const ledger = opts.ledgerPath === null ? sanitizeEntry(entry) : appendLedger(entry, opts.ledgerPath);

  return {
    scene,
    issues,
    fallback: validation === "fallback",
    repaired: validation === "repaired",
    durationMs,
    engine,
    engineOverride: override,
    validation,
    warnings,
    fixes,
    fallbackReason,
    repairProblems,
    model,
    llmCalls,
    llmReportedMs,
    usage,
    phasesMs,
    ledger,
  };
}
