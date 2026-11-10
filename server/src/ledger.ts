// ledger.jsonl: one line per processing step (brief §4.8).
//
// Never contains keys, tokens, environment variables or the photo: entries are rebuilt
// field by field from an allowlist, strings are truncated and long opaque runs
// (base64, secrets) are redacted before writing.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_LEDGER_PATH = fileURLToPath(new URL("../ledger.jsonl", import.meta.url));

export interface LedgerEntry {
  time: string;
  kind: "analyze" | "enrich" | "geo" | "generate" | "check" | "pipeline";
  /** Video API quota units consumed (YouTube, when enabled). */
  videoQuota?: number;
  /** First 16 hex chars of the SHA-256 of the image bytes (not the image). */
  pageHash?: string;
  provider?: string;
  model?: string;
  /** Milliseconds per phase, e.g. { read, hash, llm, validate, repair, total }. */
  phasesMs: Record<string, number>;
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Client-side list-price estimate reported by the CLI (not billed on a subscription). */
  costUsdEstimate?: number;
  llmCalls?: number;
  externalRequests?: number;
  cached?: boolean;
  engine?: string;
  confidence?: number;
  validation?: "ok" | "repaired" | "failed" | "cached" | "error";
  error?: string;
  /** Visual check (server/src/check): the judge's verdict, never the images. */
  verdict?: "ok" | "problems" | "skipped";
  /** Number of problems the judge reported. */
  problems?: number;
  /** Of which blocking (they make the pipeline regenerate) and minor (logged only), D23. */
  blocking?: number;
  minor?: number;
  /** Short note, e.g. why the visual check was skipped. */
  note?: string;
}

const MAX_STRING = 200;

export function scrub(s: string): string {
  return s.replace(/[A-Za-z0-9+/=_-]{40,}/g, "[redacted]").slice(0, MAX_STRING);
}

const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round6 = (v: number | undefined): number | undefined => (v === undefined ? undefined : Math.round(v * 1e6) / 1e6);
const str = (v: unknown): string | undefined => (typeof v === "string" ? scrub(v) : undefined);

/** Copies only the known fields, with the right types. */
export function sanitizeEntry(e: LedgerEntry): LedgerEntry {
  const phasesMs: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.phasesMs ?? {})) {
    const n = finite(v);
    if (n !== undefined && /^[a-z][a-zA-Z]{0,30}$/.test(k)) phasesMs[k] = Math.round(n);
  }
  const out: LedgerEntry = {
    time: str(e.time) ?? new Date().toISOString(),
    kind: (["analyze", "enrich", "geo", "generate", "check", "pipeline"] as const).find((k) => k === e.kind) ?? "analyze",
    videoQuota: finite(e.videoQuota),
    pageHash: typeof e.pageHash === "string" && /^[0-9a-f]{1,16}$/.test(e.pageHash) ? e.pageHash : undefined,
    provider: str(e.provider),
    model: str(e.model),
    phasesMs,
    tokensIn: finite(e.tokensIn),
    tokensOut: finite(e.tokensOut),
    cacheReadTokens: finite(e.cacheReadTokens),
    cacheCreationTokens: finite(e.cacheCreationTokens),
    costUsdEstimate: round6(finite(e.costUsdEstimate)),
    llmCalls: finite(e.llmCalls),
    externalRequests: finite(e.externalRequests),
    cached: typeof e.cached === "boolean" ? e.cached : undefined,
    engine: str(e.engine),
    confidence: finite(e.confidence),
    validation: e.validation,
    error: str(e.error),
    verdict: (["ok", "problems", "skipped"] as const).find((v) => v === e.verdict),
    problems: finite(e.problems),
    blocking: finite(e.blocking),
    minor: finite(e.minor),
    note: str(e.note),
  };
  return JSON.parse(JSON.stringify(out)) as LedgerEntry; // drops undefined fields
}

export function appendLedger(entry: LedgerEntry, path = process.env.PAGINAVIVA_LEDGER || DEFAULT_LEDGER_PATH): LedgerEntry {
  const clean = sanitizeEntry(entry);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(clean) + "\n");
  return clean;
}
