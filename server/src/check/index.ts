// Visual check (live mode): render the generated scene headless, let Claude compare the screenshots
// with the page photo, and report what to fix. Only a blocking problem makes the pipeline
// (server/src/pipeline/run.ts) regenerate, ONCE, with all the problems as feedback; that result is
// accepted without another check. Minor problems alone pass (D23).
//
// Never fails the run: no Chrome, no web server, a judge error or the time cap (CHECK_TIMEOUT_MS)
// give { status: "skipped" } with a ledger note. The photo and the screenshots stay in memory;
// the ledger line (kind "check") holds only timings, usage and the verdict.
import type { PageAnalysis, SceneSpec } from "@pv/scene-spec";
import { detectMediaType } from "../analyze/analyze.ts";
import { EffortCliProvider } from "../generate/provider.ts";
import { appendLedger, sanitizeEntry, type LedgerEntry } from "../ledger.ts";
import type { LlmProvider, StructuredResponse } from "../llm/types.ts";
import type { Mode } from "../pipeline/types.ts";
import { judgeRequest, parseVerdict, type Problem } from "./judge.ts";
import { renderScene, type Shot } from "./render.ts";

export { CHECK_VERSION, judgePrompt, judgeRequest, parseVerdict, type Problem, type Severity, type Verdict } from "./judge.ts";
export { renderScene, shotPlan, type Shot } from "./render.ts";

/** Render + judge; about 1 minute is expected. */
export const CHECK_TIMEOUT_MS = 90_000;

export type CheckOutcome =
  /** No blocking problem; `minor` = the cosmetic ones (logged, not fixed). */
  | { status: "ok"; minor?: Problem[] }
  /** At least one blocking problem; all the problems, blocking first. */
  | { status: "problems"; problems: Problem[] }
  | { status: "skipped"; reason: string };

export interface CheckInput {
  scene: SceneSpec;
  /** The page photo, in memory only. */
  photo?: Buffer;
  analysis?: PageAnalysis;
}

export interface CheckDeps {
  render(scene: SceneSpec, signal: AbortSignal): Promise<Shot[]>;
  judge: LlmProvider;
  timeoutMs?: number;
  /** null disables the ledger; undefined uses the default path. */
  ledgerPath?: string | null;
  /** Receives the screenshots (the CLI saves them for a person to look at; the pipeline does not). */
  onShots?: (shots: Shot[]) => void;
}

/** PAGINAVIVA_VISUAL_CHECK: default on in live mode, off in mock mode (and so in tests). */
export function visualCheckEnabled(env: Record<string, string | undefined>, mode: Mode): boolean {
  const v = env.PAGINAVIVA_VISUAL_CHECK?.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "on") return true;
  if (v === "false" || v === "0" || v === "off") return false;
  return mode === "live";
}

/** The problems as lines for the generation repair request. */
export function feedbackLines(problems: readonly Problem[]): string[] {
  return problems.map((p) => `visual check, chapter "${p.chapter}"${p.severity === "minor" ? " (minor, fix if easy)" : ""}: ${p.what} Fix: ${p.fix}`);
}

class Timeout extends Error {}

export async function visualCheck(input: CheckInput, deps: CheckDeps): Promise<CheckOutcome & { ledger: LedgerEntry }> {
  const t0 = performance.now();
  const phasesMs: Record<string, number> = {};
  const lap = (name: string, since: number) => (phasesMs[name] = Math.round(performance.now() - since));
  let res: StructuredResponse | undefined;

  const finish = (outcome: CheckOutcome, note?: string, found?: readonly Problem[]) => {
    phasesMs.total = Math.round(performance.now() - t0);
    const blocking = found?.filter((p) => p.severity === "blocking").length;
    const entry: LedgerEntry = {
      time: new Date().toISOString(),
      kind: "check",
      provider: deps.judge.name,
      model: res?.model ?? deps.judge.model,
      phasesMs,
      tokensIn: res?.usage?.inputTokens,
      tokensOut: res?.usage?.outputTokens,
      cacheReadTokens: res?.usage?.cacheReadInputTokens,
      cacheCreationTokens: res?.usage?.cacheCreationInputTokens,
      costUsdEstimate: res?.usage?.costUsdEstimate,
      llmCalls: res ? 1 : 0,
      engine: input.scene.engine,
      verdict: outcome.status,
      problems: found?.length,
      blocking,
      minor: found && blocking !== undefined ? found.length - blocking : undefined,
      note,
    };
    const ledger = deps.ledgerPath === null ? sanitizeEntry(entry) : appendLedger(entry, deps.ledgerPath);
    return { ...outcome, ledger };
  };

  if (input.scene.engine === "card") return finish({ status: "skipped", reason: "card scene: no 3D stage" }, "card scene");

  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Timeout(`visual check over ${deps.timeoutMs ?? CHECK_TIMEOUT_MS} ms`));
    }, deps.timeoutMs ?? CHECK_TIMEOUT_MS);
  });
  try {
    const work = (async () => {
      let t = performance.now();
      const shots = await deps.render(input.scene, abort.signal);
      lap("render", t);
      if (shots.length === 0) throw new Error("no screenshots");
      deps.onShots?.(shots);
      t = performance.now();
      const photo = input.photo ? { mediaType: detectMediaType(input.photo), data: input.photo } : undefined;
      res = await deps.judge.generateStructured(judgeRequest({ scene: input.scene, shots, photo, analysis: input.analysis }));
      lap("judge", t);
      return parseVerdict(res.data);
    })();
    work.catch(() => {}); // a late failure after the time cap is not an unhandled rejection
    const verdict = await Promise.race([work, cap]);
    const first = verdict.problems[0];
    const note = first ? `${first.severity === "minor" ? "minor " : ""}${first.chapter}: ${first.what}` : undefined;
    if (verdict.ok) return finish(first ? { status: "ok", minor: verdict.problems } : { status: "ok" }, note, verdict.problems);
    return finish({ status: "problems", problems: verdict.problems }, note, verdict.problems);
  } catch (e) {
    const reason = e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 160) : String(e);
    console.warn(`[check] skipped: ${reason}`);
    return finish({ status: "skipped", reason }, `skipped: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** The real check: Chrome + the Vite dev server + the Claude CLI judge. */
export function createVisualCheck(
  env: Record<string, string | undefined>,
  opts: { judge?: LlmProvider; ledgerPath?: string | null } = {},
): (input: CheckInput) => Promise<CheckOutcome> {
  const judge = opts.judge ?? new EffortCliProvider({ effort: "low", timeoutMs: CHECK_TIMEOUT_MS });
  const webUrl = env.PAGINAVIVA_WEB_URL || undefined;
  return (input) => visualCheck(input, { render: (scene, signal) => renderScene(scene, { webUrl, signal }), judge, ledgerPath: opts.ledgerPath });
}
