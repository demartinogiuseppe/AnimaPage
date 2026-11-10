// Pipeline orchestrator: photo -> analyze -> (enrich ‖ geo) -> generate -> [visual check -> regenerate once] -> SceneSpec.
//
// Stages are injected (tests use fakes); defaultStages() wires the real modules.
// The photo lives only in memory: it is written to disk only when `storePhotosDir`
// is set (PAGINAVIVA_STORE_PHOTOS=true), and never logged.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SceneSpec } from "@pv/scene-spec";
import { isItalian } from "@pv/scene-spec/i18n";
import { analyzePage } from "../analyze/index.ts";
import { PROMPT_VERSION as ANALYZE_PROMPT_VERSION } from "../analyze/prompt.ts";
import { CHECK_TIMEOUT_MS, CHECK_VERSION, createVisualCheck, feedbackLines, visualCheckEnabled, type CheckInput, type CheckOutcome } from "../check/index.ts";
import { enrich } from "../enrich/index.ts";
import type { ResolvedArtwork } from "../art/resolve.ts";
import type { LessonStore } from "../lessons/store.ts";
import { resolveArtForAnalysis } from "../generate/art.ts";
import { GENERATE_FIXTURES_DIR, GENERATE_PROMPT_VERSION, generateScene } from "../generate/index.ts";
import { EffortCliProvider } from "../generate/provider.ts";
import { geoContextFor } from "../geo/context.ts";
import { preparePhoto, type PreparedPhoto, type PrepareOptions } from "../image.ts";
import { createProvider, GeminiCliProvider, LlmError, MockProvider, providerNameFromEnv, type LlmProvider } from "../llm/index.ts";
import { sha256 } from "../llm/mock.ts";
import { createEntryProvider, type LlmChoice, type PhaseId, type ProviderEntry } from "../llm/registry.ts";
import { appendLedger } from "../ledger.ts";
import type {
  EnrichResult,
  GenerateInput,
  GenerateResult,
  GeoContext,
  Mode,
  PageAnalysis,
  ProgressEvent,
} from "./types.ts";

export const DEFAULT_PAGE_CACHE_DIR = fileURLToPath(new URL("../../.cache/pages/", import.meta.url));
export const DEFAULT_GEO_OUT_DIR = fileURLToPath(new URL("../../.cache/geo/", import.meta.url));
/** Below this analysis confidence the app asks for a new photo. */
export const MIN_CONFIDENCE = 0.5;

export const MESSAGES = {
  analyze: "Leggo la pagina…",
  enrich: "Cerco fonti e video…",
  generate: "Preparo la scena…",
  done: "La lezione è pronta.",
  cached: "Questa pagina l'ho già preparata.",
  retake: "Non riesco a leggere bene la pagina.",
  retakeHint: "Rifai la foto con più luce, tenendo il telefono fermo e inquadrando tutta la pagina.",
  noSources: "Non trovo fonti esterne: preparo la lezione solo con la pagina.",
  badImage: "Il file non sembra una foto. Prova con un'immagine JPEG o PNG.",
  mockOnly:
    "In modalità di prova riconosco solo le pagine di esempio. Per analizzare altre foto avvia il server in modalità live.",
  analyzeDown: "Il servizio che legge la pagina non risponde. Riprova tra qualche minuto.",
  analyzeFail: "Non sono riuscito a leggere la pagina. Riprova, magari con un'altra foto.",
  generateFail: "Non sono riuscito a preparare la scena. Riprova tra poco.",
  check: "Controllo la scena…",
  fix: "Correggo la scena…",
} as const;

/**
 * Versions of everything that shapes a cached result (analysis prompt, generation prompt, visual
 * check): a change makes already-seen photos run again instead of reopening an outdated lesson.
 */
export const PIPELINE_VERSION = `${ANALYZE_PROMPT_VERSION}.${GENERATE_PROMPT_VERSION}.${CHECK_VERSION}`;

/**
 * `llmTag` (registry.ts choiceTag): the AI models chosen in the app per phase (D20). Empty for the
 * server default, which keeps the keys of the results cached before D20.
 */
export function pageCacheKey(mode: Mode, photoSha256: string, version = PIPELINE_VERSION, llmTag = "", locale?: string): string {
  // A non-Italian lesson is another result for the same photo (D21); Italian keeps the old keys.
  const lang = isItalian(locale) ? "" : `-${locale}`;
  return llmTag ? `${mode}-${version}-llm${sha256(llmTag).slice(0, 12)}${lang}-${photoSha256}` : `${mode}-${version}${lang}-${photoSha256}`;
}

export type ErrorStage = "image" | "analyze" | "generate";

export type PipelineResult =
  | {
      status: "scene";
      key: string;
      scene: SceneSpec;
      summary: string;
      fallback: boolean;
      cached: boolean;
      timingsMs: Record<string, number>;
      /** Id in the lesson archive (server/src/lessons), when one is configured. */
      lessonId?: string;
    }
  | { status: "retake"; key: string; hint: string; summary?: string; cached: boolean }
  | { status: "error"; stage: ErrorStage; message: string };

/** `locale`: the user's language (validated BCP-47, D21); undefined = Italian. */
export interface PipelineStages {
  analyze(image: Buffer, locale?: string): Promise<PageAnalysis>;
  enrich(analysis: PageAnalysis, locale?: string): Promise<EnrichResult>;
  /** Called only for pages whose suggested engine is `map`. */
  geo(analysis: PageAnalysis, locale?: string): Promise<GeoContext | undefined>;
  /** `hooks.onFirstChapter` (D22): the first chapter alone, while a streaming provider still writes the rest. */
  generate(input: GenerateInput, hooks?: GenerateHooks): Promise<GenerateResult>;
  /** Called only for `art` pages: the artwork (image only when public domain). */
  art?(analysis: PageAnalysis, locale?: string): Promise<ResolvedArtwork | undefined>;
  /**
   * Visual check of a generated 3D scene (server/src/check); absent = no check (mock mode, tests,
   * PAGINAVIVA_VISUAL_CHECK=false). "problems" makes the pipeline regenerate once with them as feedback.
   */
  check?(input: CheckInput): Promise<CheckOutcome>;
}

export interface GenerateHooks {
  onFirstChapter?: (scene: SceneSpec) => void;
}

/** Results by cache key, in memory and optionally on disk (derived data only, never the photo). */
export class PageCache {
  private readonly mem = new Map<string, PipelineResult>();
  constructor(private readonly dir: string | null = null) {}

  get(key: string): PipelineResult | undefined {
    const hit = this.mem.get(key);
    if (hit || !this.dir) return hit;
    const file = join(this.dir, `${key}.json`);
    if (!existsSync(file)) return undefined;
    try {
      const r = JSON.parse(readFileSync(file, "utf8")) as PipelineResult;
      if (r.status === "scene" && !SceneSpec.safeParse(r.scene).success) return undefined;
      this.mem.set(key, r);
      return r;
    } catch {
      return undefined;
    }
  }

  set(key: string, r: PipelineResult): void {
    this.mem.set(key, r);
    if (!this.dir) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(r));
  }
}

export interface RunOptions {
  mode: Mode;
  onProgress?: (e: ProgressEvent) => void;
  stages: PipelineStages;
  cache?: PageCache;
  image?: PrepareOptions;
  /** Directory for the processed photo; only when PAGINAVIVA_STORE_PHOTOS=true. */
  storePhotosDir?: string | null;
  /** Lesson archive: every scene result (fallback cards too) is saved there. */
  lessons?: LessonStore;
  /** Part of the cache key: the per-phase model choice (registry.ts choiceTag); "" = server default. */
  llmTag?: string;
  /** User's language (validated BCP-47, D21); undefined/Italian = today's Italian lessons. Part of the cache key. */
  locale?: string;
  /**
   * Decision D22: the first chapter of a scene still being generated (validated on its own). The final
   * result follows as usual; only that one is cached and saved.
   */
  onFirstChapter?: (scene: SceneSpec) => void;
  /** Ledger file for one "pipeline" line per generated scene (time to the first chapter and to the lesson); absent = none. */
  ledgerPath?: string;
}

/** Page-only enrichment used when the enrich stage fails: the lesson relies on the page alone. */
export function pageOnlyEnrichment(analysis: PageAnalysis): EnrichResult {
  return {
    sources: [{ id: "page", kind: "page", title: `${analysis.subject} · ${analysis.topic}` }],
    facts: [],
    discrepancies: [],
    videos: [],
    stats: { requests: 0, cached: 0, durationMs: 0 },
  };
}

export function needsRetake(a: PageAnalysis): boolean {
  return !a.readable || a.retake !== undefined || a.confidence < MIN_CONFIDENCE;
}

/** Key of the analysis failure message in MESSAGES (and "server.<key>" in the UI catalog). */
function analyzeErrorCode(e: unknown): keyof typeof MESSAGES {
  // analyzePage wraps provider errors as "<code>: <message>"; the LlmError itself is lost.
  const text = e instanceof Error ? e.message : String(e);
  const code = e instanceof LlmError ? e.code : /^([a-z_]+):/.exec(text)?.[1];
  if (code === "mock_missing") return "mockOnly";
  if (code === "cli_missing" || code === "cli_failed" || code === "timeout" || code === "not_configured" || code === "http_failed")
    return "analyzeDown";
  return "analyzeFail";
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Saves the scene in the archive; a failure to save never fails the run. */
function saveLesson(opts: RunOptions, scene: SceneSpec, fallback: boolean): string | undefined {
  if (!opts.lessons) return undefined;
  try {
    return opts.lessons.save(scene, { fallback }).id;
  } catch (e) {
    console.warn(`[pipeline] could not save the lesson: ${errMsg(e).slice(0, 300)}`);
    return undefined;
  }
}

export async function runPipeline(photo: Buffer, opts: RunOptions): Promise<PipelineResult> {
  const locale = isItalian(opts.locale) ? undefined : opts.locale;
  // Messages stay Italian on the wire: the app shows them in its own language through the "server.*"
  // keys of its catalog (D21).
  const emit = (e: ProgressEvent) => opts.onProgress?.(e);
  const timingsMs: Record<string, number> = {};
  const t0 = performance.now();
  const lap = (name: string, since: number) => (timingsMs[name] = Math.round(performance.now() - since));
  const fail = (stage: ErrorStage, code: keyof typeof MESSAGES, cause: unknown): PipelineResult => {
    // Only the error text: never the photo or the environment.
    console.warn(`[pipeline] ${stage} failed: ${errMsg(cause).slice(0, 300)}`);
    const message = MESSAGES[code];
    emit({ phase: "error", message });
    return { status: "error", stage, message };
  };

  let t = performance.now();
  let prepared: PreparedPhoto;
  try {
    prepared = await preparePhoto(photo, opts.image);
  } catch (e) {
    return fail("image", "badImage", e);
  }
  lap("image", t);
  const key = pageCacheKey(opts.mode, prepared.sha256, PIPELINE_VERSION, opts.llmTag ?? "", locale);

  const hit = opts.cache?.get(key);
  if (hit && hit.status !== "error") {
    let out: PipelineResult = hit;
    // The same page again opens the lesson already in the archive (a new one if it was deleted).
    if (hit.status === "scene" && opts.lessons && !(hit.lessonId && opts.lessons.has(hit.lessonId))) {
      const lessonId = saveLesson(opts, hit.scene, hit.fallback);
      out = { ...hit, ...(lessonId ? { lessonId } : {}) };
      opts.cache?.set(key, out);
    }
    emit({ phase: "done", message: MESSAGES.cached, summary: hit.summary, ...(locale ? { summaryLang: locale } : {}) });
    return { ...out, cached: true };
  }

  if (opts.storePhotosDir) {
    mkdirSync(opts.storePhotosDir, { recursive: true });
    writeFileSync(join(opts.storePhotosDir, `${prepared.sha256}.jpg`), prepared.data);
  }

  // Mock recordings are keyed by the bytes of the original fixture photos, so mock mode
  // analyses the upload as-is; live mode sends the smaller processed JPEG.
  emit({ phase: "analyze", message: MESSAGES.analyze });
  t = performance.now();
  let analysis: PageAnalysis;
  try {
    analysis = await opts.stages.analyze(opts.mode === "mock" ? photo : prepared.data, locale);
  } catch (e) {
    return fail("analyze", analyzeErrorCode(e), e);
  }
  lap("analyze", t);
  // The Italian prompt writes the summary in the page's language; other locales get it in theirs.
  const summaryLang = locale ?? (analysis.language || "it");
  const said = { summary: analysis.summary, ...(isItalian(summaryLang) ? {} : { summaryLang }) };

  if (needsRetake(analysis)) {
    const result: PipelineResult = {
      status: "retake",
      key,
      hint: analysis.retake?.hint ?? MESSAGES.retakeHint,
      summary: analysis.readable ? analysis.summary : undefined,
      cached: false,
    };
    emit({ phase: "done", message: MESSAGES.retake });
    opts.cache?.set(key, result);
    return result;
  }

  emit({ phase: "enrich", message: MESSAGES.enrich, ...said });
  t = performance.now();
  const [enriched, geo, art] = await Promise.all([
    opts.stages.enrich(analysis, locale).catch((e: unknown) => {
      console.warn(`[pipeline] enrich failed, using the page only: ${errMsg(e).slice(0, 300)}`);
      emit({ phase: "enrich", message: MESSAGES.noSources, ...said });
      return pageOnlyEnrichment(analysis);
    }),
    analysis.suggestedEngine === "map"
      ? opts.stages.geo(analysis, locale).catch((e: unknown) => {
          console.warn(`[pipeline] geo failed, continuing without geodata: ${errMsg(e).slice(0, 300)}`);
          return undefined;
        })
      : Promise.resolve(undefined),
    analysis.suggestedEngine === "art" && opts.stages.art
      ? opts.stages.art(analysis, locale).catch((e: unknown) => {
          console.warn(`[pipeline] artwork lookup failed, using the placeholder frame: ${errMsg(e).slice(0, 300)}`);
          return undefined;
        })
      : Promise.resolve(undefined),
  ]);
  lap("enrich", t);

  emit({ phase: "generate", message: MESSAGES.generate, ...said });
  t = performance.now();
  let generated: GenerateResult;
  const input: GenerateInput = { analysis, enrich: enriched, geo, ...(art ? { art } : {}), ...(locale ? { locale } : {}) };
  const onFirstChapter = opts.onFirstChapter;
  const hooks: GenerateHooks | undefined = onFirstChapter
    ? {
        onFirstChapter: (scene) => {
          timingsMs.firstChapter = Math.round(performance.now() - t0);
          onFirstChapter(scene);
        },
      }
    : undefined;
  try {
    generated = await opts.stages.generate(input, hooks);
  } catch (e) {
    return fail("generate", "generateFail", e);
  }
  lap("generate", t);

  // Visual check: one look at the rendered scene, at most one regeneration, never a loop.
  if (opts.stages.check && !generated.fallback && generated.scene.engine !== "card") {
    emit({ phase: "check", message: MESSAGES.check, ...said });
    t = performance.now();
    const verdict: CheckOutcome = await opts.stages
      .check({ scene: generated.scene, photo: prepared.data, analysis })
      .catch((e: unknown) => ({ status: "skipped" as const, reason: errMsg(e) }));
    lap("check", t);
    if (verdict.status === "problems") {
      emit({ phase: "check", message: MESSAGES.fix, ...said });
      t = performance.now();
      try {
        const second = await opts.stages.generate({ ...input, feedback: { previous: generated.scene, problems: feedbackLines(verdict.problems) } });
        // Accepted without another check; a fallback card would be worse than the first scene.
        if (!second.fallback) generated = second;
      } catch (e) {
        console.warn(`[pipeline] regeneration after the visual check failed, keeping the first scene: ${errMsg(e).slice(0, 300)}`);
      }
      lap("fix", t);
    }
  }
  timingsMs.total = Math.round(performance.now() - t0);

  const lessonId = saveLesson(opts, generated.scene, generated.fallback);
  const result: PipelineResult = {
    status: "scene",
    key,
    scene: generated.scene,
    summary: analysis.summary,
    fallback: generated.fallback,
    cached: false,
    timingsMs,
    ...(lessonId ? { lessonId } : {}),
  };
  // A fallback card is not cached: the next attempt may produce the real scene.
  if (!generated.fallback) opts.cache?.set(key, result);
  if (opts.ledgerPath)
    appendLedger(
      { time: new Date().toISOString(), kind: "pipeline", pageHash: prepared.sha256.slice(0, 16), phasesMs: timingsMs, engine: generated.scene.engine, validation: generated.fallback ? "failed" : "ok" },
      opts.ledgerPath,
    );
  emit({ phase: "done", message: MESSAGES.done, ...said });
  return result;
}

/** Same cap as the Claude generation call (generate/provider.ts). */
const GENERATE_TIMEOUT_MS = 400_000;

/** The per-phase model choice made in the app (D20), already checked against the registry. */
export interface StageChoice {
  registry: readonly ProviderEntry[];
  choice: LlmChoice;
}

/**
 * The real stages, configured from the environment (server/.env). With `llm` (live mode only) the
 * phases chosen in the app use their own provider; the others keep the environment's default.
 */
export function defaultStages(env: Record<string, string | undefined>, mode: Mode, llm?: StageChoice): PipelineStages {
  const provider = createProvider(env);
  const name = providerNameFromEnv(env);
  // Generation has its own recordings (fixtures/llm/generate) and, live, the faster `--effort low` CLI call.
  const generator: LlmProvider =
    name === "mock"
      ? new MockProvider(GENERATE_FIXTURES_DIR)
      : name === "claude-cli"
        ? new EffortCliProvider()
        : name === "gemini-cli"
          ? new GeminiCliProvider({ timeoutMs: GENERATE_TIMEOUT_MS })
          : provider;
  const ledgerPath = env.PAGINAVIVA_LEDGER || undefined;

  const pick = (phase: PhaseId) => {
    const c = mode === "live" ? llm?.choice[phase] : undefined;
    const entry = c && llm?.registry.find((e) => e.id === c.provider);
    return c && entry ? { entry, model: c.model } : undefined;
  };
  const a = pick("analyze");
  const g = pick("generate");
  const c = pick("check");
  const analyzer = a ? createEntryProvider(a.entry, a.model, { env }) : provider;
  // Enrich's small judge follows the analysis choice (a Claude choice keeps its configured judge_model).
  const enricher = a && a.entry.kind !== "claude-cli" ? analyzer : undefined;
  const sceneMaker = g
    ? g.entry.kind === "claude-cli"
      ? new EffortCliProvider({ model: g.model })
      : createEntryProvider(g.entry, g.model, { env, timeoutMs: GENERATE_TIMEOUT_MS })
    : generator;
  const judge = c
    ? c.entry.kind === "claude-cli"
      ? new EffortCliProvider({ model: c.model, effort: "low", timeoutMs: CHECK_TIMEOUT_MS })
      : createEntryProvider(c.entry, c.model, { env, timeoutMs: CHECK_TIMEOUT_MS })
    : name === "claude-cli"
      ? undefined // createVisualCheck's default: the Claude CLI with --effort low
      : provider;
  return {
    analyze: async (image, locale) => (await analyzePage(image, { provider: analyzer, ledgerPath, ...(locale ? { locale } : {}) })).analysis,
    enrich: (analysis, locale) => enrich(analysis, { mode, ledgerPath, ...(enricher ? { provider: enricher } : {}), ...(locale ? { locale } : {}) }),
    geo: (analysis, locale) => geoContextFor(analysis, { mode, outDir: DEFAULT_GEO_OUT_DIR, ...(locale ? { locale } : {}) }),
    generate: (input, hooks) => generateScene(input, { provider: sceneMaker, ledgerPath, ...(hooks?.onFirstChapter ? { onFirstChapter: hooks.onFirstChapter } : {}) }),
    art: (analysis, locale) => resolveArtForAnalysis(analysis, { mode, ...(locale ? { locale } : {}) }),
    // Live only by default (PAGINAVIVA_VISUAL_CHECK).
    ...(visualCheckEnabled(env, mode) ? { check: createVisualCheck(env, { ledgerPath, ...(judge ? { judge } : {}) }) } : {}),
  };
}
