// analyze: photo -> PageAnalysis (brief §4.4), with cache, one repair retry and a ledger line.
//
// Cache key: SHA-256 of the image bytes + PROMPT_VERSION. The brief (§4.8) asks for a
// perceptual hash so that a re-photographed page also hits the cache; v0.1 uses an exact
// byte hash (only the very same file hits), see docs/m2/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PageAnalysis, pageAnalysisJsonSchema } from "@pv/scene-spec";
import { appendLedger, sanitizeEntry, type LedgerEntry } from "../ledger.ts";
import { sha256 } from "../llm/mock.ts";
import type { ImageInput, ImageMediaType, LlmProvider, LlmUsage, StructuredRequest } from "../llm/types.ts";
import { isItalian } from "@pv/scene-spec/i18n";
import { ANALYSIS_PROMPT, analysisSystem, PROMPT_VERSION, repairPrompt } from "./prompt.ts";

export const DEFAULT_ANALYSIS_CACHE_DIR = fileURLToPath(new URL("../../.cache/analysis/", import.meta.url));
/** The API accepts up to 10 MB of base64 per image; no resizing library in v0.1. */
export const MAX_IMAGE_BYTES = 7_000_000;

export interface AnalyzeOptions {
  provider: LlmProvider;
  /** null disables the ledger; undefined uses the default path. */
  ledgerPath?: string | null;
  /** null disables the cache; undefined uses server/.cache/analysis. */
  cacheDir?: string | null;
  /** User's language (validated BCP-47, D21); undefined/Italian = the original prompt. */
  locale?: string;
}

export type AnalyzeValidation = "ok" | "repaired" | "cached";

export interface AnalyzeResult {
  analysis: PageAnalysis;
  validation: AnalyzeValidation;
  imageSha256: string;
  ledger: LedgerEntry;
}

export class AnalysisError extends Error {
  readonly ledger: LedgerEntry;
  constructor(message: string, ledger: LedgerEntry) {
    super(message);
    this.name = "AnalysisError";
    this.ledger = ledger;
  }
}

export function detectMediaType(data: Buffer): ImageMediaType {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (data.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  throw new Error("Unsupported image format (expected JPEG, PNG, WebP or GIF)");
}

export function analysisRequest(image: ImageInput, prompt = ANALYSIS_PROMPT, locale?: string): StructuredRequest {
  return { system: analysisSystem(locale), prompt, images: [image], jsonSchema: pageAnalysisJsonSchema() };
}

export function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.slice(0, 20).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
}

function addUsage(acc: LlmUsage, u: LlmUsage | undefined): void {
  if (!u) return;
  for (const k of Object.keys(u) as (keyof LlmUsage)[]) {
    const v = u[k];
    if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
  }
}

function readCache(dir: string, key: string): PageAnalysis | undefined {
  const file = join(dir, `${key}.json`);
  if (!existsSync(file)) return undefined;
  const parsed = PageAnalysis.safeParse((JSON.parse(readFileSync(file, "utf8")) as { analysis?: unknown }).analysis);
  return parsed.success ? parsed.data : undefined;
}

function writeCache(dir: string, key: string, analysis: PageAnalysis, model: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify({ createdAt: new Date().toISOString(), model, analysis }, null, 2));
}

export async function analyzePage(input: string | Buffer, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const t0 = performance.now();
  const phasesMs: Record<string, number> = {};
  const lap = (name: string, since: number) => (phasesMs[name] = Math.round(performance.now() - since));
  const usage: LlmUsage = {};
  let llmCalls = 0;
  let model: string | undefined;
  let pageHash: string | undefined;

  const ledger = (fields: Partial<LedgerEntry>): LedgerEntry => {
    phasesMs.total = Math.round(performance.now() - t0);
    const entry: LedgerEntry = {
      time: new Date().toISOString(),
      kind: "analyze",
      pageHash,
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
      ...fields,
    };
    return opts.ledgerPath === null ? sanitizeEntry(entry) : appendLedger(entry, opts.ledgerPath);
  };

  try {
    let t = performance.now();
    const data = typeof input === "string" ? readFileSync(input) : input;
    lap("read", t);
    if (data.length > MAX_IMAGE_BYTES) throw new Error(`Image too large (${data.length} bytes, max ${MAX_IMAGE_BYTES})`);
    const image: ImageInput = { mediaType: detectMediaType(data), data };

    t = performance.now();
    const imageSha256 = sha256(data);
    pageHash = imageSha256.slice(0, 16);
    lap("hash", t);

    const cacheDir = opts.cacheDir === undefined ? DEFAULT_ANALYSIS_CACHE_DIR : opts.cacheDir;
    const cacheKey = isItalian(opts.locale) ? `${PROMPT_VERSION}-${imageSha256}` : `${PROMPT_VERSION}-${opts.locale}-${imageSha256}`;
    if (cacheDir) {
      const hit = readCache(cacheDir, cacheKey);
      if (hit) {
        const entry = ledger({ cached: true, validation: "cached", engine: hit.suggestedEngine, confidence: hit.confidence });
        return { analysis: hit, validation: "cached", imageSha256, ledger: entry };
      }
    }

    t = performance.now();
    const first = await opts.provider.generateStructured(analysisRequest(image, ANALYSIS_PROMPT, opts.locale));
    lap("llm", t);
    llmCalls++;
    model = first.model;
    addUsage(usage, first.usage);

    t = performance.now();
    let parsed = PageAnalysis.safeParse(first.data);
    lap("validate", t);
    let validation: AnalyzeValidation = "ok";

    if (!parsed.success) {
      t = performance.now();
      const issues = formatIssues(parsed.error.issues);
      const second = await opts.provider.generateStructured(analysisRequest(image, repairPrompt(first.data, issues), opts.locale));
      llmCalls++;
      model = second.model;
      addUsage(usage, second.usage);
      parsed = PageAnalysis.safeParse(second.data);
      lap("repair", t);
      if (!parsed.success) {
        const entry = ledger({ validation: "failed", error: formatIssues(parsed.error.issues).join("; ") });
        throw new AnalysisError("PageAnalysis invalid after one repair attempt", entry);
      }
      validation = "repaired";
    }

    const analysis = parsed.data;
    if (cacheDir) writeCache(cacheDir, cacheKey, analysis, model);
    const entry = ledger({ cached: false, validation, engine: analysis.suggestedEngine, confidence: analysis.confidence });
    return { analysis, validation, imageSha256, ledger: entry };
  } catch (e) {
    if (e instanceof AnalysisError) throw e;
    const msg = e instanceof Error ? `${(e as { code?: string }).code ?? e.name}: ${e.message}` : String(e);
    throw new AnalysisError(msg, ledger({ validation: "error", error: msg }));
  }
}
