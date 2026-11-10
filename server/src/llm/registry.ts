// AI model choice per pipeline phase (decision D20): the configured providers
// (server/config/llm_providers.yaml), what the browser may choose, their availability for
// GET /api/providers, and a provider instance for an entry + model.
//
// Security: the browser sends only { provider: <id>, model: <name> } per phase; both must be in the
// configuration (parseChoice). Base URLs and key variable names come only from the YAML file; key
// values only from the server's environment.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { findOnPath } from "./bin.ts";
import { ClaudeCliProvider } from "./claude-cli.ts";
import { GeminiCliProvider } from "./gemini-cli.ts";
import { OpenAiCompatProvider } from "./openai-compat.ts";
import type { LlmProvider } from "./types.ts";

export const DEFAULT_PROVIDERS_FILE = fileURLToPath(new URL("../../config/llm_providers.yaml", import.meta.url));

export type PhaseId = "analyze" | "generate" | "check";

export interface PhaseInfo {
  id: PhaseId;
  /** Italian label shown in the settings. */
  label: string;
  needsVision: boolean;
}

/** Enrich's small LLM judge follows the "analyze" choice. */
export const PHASES: readonly PhaseInfo[] = [
  { id: "analyze", label: "Lettura della foto", needsVision: true },
  { id: "generate", label: "Creazione della scena", needsVision: false },
  { id: "check", label: "Controllo visivo", needsVision: true },
];

export type ProviderKind = "claude-cli" | "gemini-cli" | "openai";

export interface ProviderEntry {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl?: string;
  /** Name of the env var with the key (never the key). */
  apiKeyEnv?: string;
  models: string[];
  vision: boolean;
  jsonSchema: boolean;
}

export interface PhaseChoice {
  provider: string;
  model: string;
}

/** A missing phase means "the server's default" (PAGINAVIVA_LLM, as before D20). */
export type LlmChoice = Partial<Record<PhaseId, PhaseChoice>>;

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const KINDS: readonly ProviderKind[] = ["claude-cli", "gemini-cli", "openai"];

type Obj = Record<string, unknown>;

/** Parses and checks the YAML; a bad entry is a startup error, not something to guess around. */
export function parseRegistry(yamlText: string): ProviderEntry[] {
  const root = (parse(yamlText) ?? {}) as Obj;
  const list = Array.isArray(root.providers) ? (root.providers as Obj[]) : [];
  const seen = new Set<string>();
  return list.map((p, i) => {
    const where = `llm_providers.yaml, entry ${i + 1}`;
    const id = String(p.id ?? "");
    if (!ID_RE.test(id)) throw new Error(`${where}: invalid id '${id}'`);
    if (seen.has(id)) throw new Error(`${where}: duplicate id '${id}'`);
    seen.add(id);
    const kind = p.kind as ProviderKind;
    if (!KINDS.includes(kind)) throw new Error(`${where}: kind must be ${KINDS.join(" | ")}`);
    const models = Array.isArray(p.models) ? p.models.map(String) : [];
    if (models.length === 0 || models.some((m) => !MODEL_RE.test(m))) throw new Error(`${where}: models must be a non-empty list of model names`);
    const entry: ProviderEntry = {
      id,
      label: typeof p.label === "string" && p.label.trim() ? p.label.trim() : id,
      kind,
      models,
      vision: p.vision === true,
      jsonSchema: p.jsonSchema === true,
    };
    if (kind === "openai") {
      const url = String(p.baseUrl ?? "");
      if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error(`${where}: openai entries need a baseUrl (http/https)`);
      entry.baseUrl = url.replace(/\/+$/, "");
      if (p.apiKeyEnv !== undefined && p.apiKeyEnv !== null) {
        const name = String(p.apiKeyEnv);
        if (!ENV_RE.test(name)) throw new Error(`${where}: apiKeyEnv must be an environment variable NAME`);
        entry.apiKeyEnv = name;
      }
    }
    return entry;
  });
}

export function loadRegistry(file = DEFAULT_PROVIDERS_FILE): ProviderEntry[] {
  return parseRegistry(readFileSync(file, "utf8"));
}

/** What PAGINAVIVA_LLM gives every phase, as a registry choice (null when it is not in the registry, e.g. `local`). */
export function defaultChoice(env: Record<string, string | undefined>, registry: readonly ProviderEntry[]): PhaseChoice | null {
  const llm = env.PAGINAVIVA_LLM || "claude-cli";
  if (llm === "claude-cli") {
    const e = registry.find((r) => r.kind === "claude-cli");
    return e ? { provider: e.id, model: env.PAGINAVIVA_CLAUDE_MODEL || "opus" } : null;
  }
  if (llm === "gemini-cli") {
    const e = registry.find((r) => r.kind === "gemini-cli");
    return e ? { provider: e.id, model: env.PAGINAVIVA_GEMINI_MODEL || e.models[0]! } : null;
  }
  return null;
}

export type ChoiceResult = { ok: true; choice: LlmChoice } | { ok: false; error: string };

/**
 * Checks the browser's choice (JSON text of { analyze?, generate?, check? }). Only listed providers
 * and models; vision phases only vision entries. Phases equal to the server default are dropped, so
 * the default keeps the cache keys it had before D20.
 */
export function parseChoice(raw: string, registry: readonly ProviderEntry[], fallback: PhaseChoice | null): ChoiceResult {
  if (raw.length > 2000) return { ok: false, error: "choice too long" };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: "choice is not JSON" };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "choice must be an object" };
  const choice: LlmChoice = {};
  for (const [k, x] of Object.entries(v as Obj)) {
    const phase = PHASES.find((p) => p.id === k);
    if (!phase) return { ok: false, error: `unknown phase '${k.slice(0, 20)}'` };
    if (x === null) continue;
    const c = x as Obj;
    if (!c || typeof c !== "object" || typeof c.provider !== "string" || typeof c.model !== "string" || Object.keys(c).length !== 2)
      return { ok: false, error: `${k}: expected { provider, model }` };
    const entry = registry.find((r) => r.id === c.provider);
    if (!entry) return { ok: false, error: `${k}: provider not configured` };
    if (!entry.models.includes(c.model as string)) return { ok: false, error: `${k}: model not configured for ${entry.id}` };
    if (phase.needsVision && !entry.vision) return { ok: false, error: `${k}: ${entry.id} does not read images` };
    if (fallback && fallback.provider === c.provider && fallback.model === c.model) continue;
    choice[phase.id] = { provider: entry.id, model: c.model as string };
  }
  return { ok: true, choice };
}

/** Stable text of a choice for the page cache key; "" when every phase uses the server default. */
export function choiceTag(choice: LlmChoice | undefined): string {
  if (!choice) return "";
  return PHASES.filter((p) => choice[p.id])
    .map((p) => `${p.id}=${choice[p.id]!.provider}/${choice[p.id]!.model}`)
    .join(";");
}

export interface EntryProviderOptions {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

/** A provider for one entry + model (the pipeline adds Claude's `--effort` variants itself). */
export function createEntryProvider(entry: ProviderEntry, model: string, opts: EntryProviderOptions = {}): LlmProvider {
  const env = opts.env ?? process.env;
  switch (entry.kind) {
    case "claude-cli":
      return new ClaudeCliProvider({ model, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
    case "gemini-cli":
      return new GeminiCliProvider({ model, env: env as NodeJS.ProcessEnv, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
    case "openai":
      return new OpenAiCompatProvider({
        id: entry.id,
        baseUrl: entry.baseUrl!,
        model,
        apiKey: entry.apiKeyEnv ? env[entry.apiKeyEnv] || undefined : undefined,
        vision: entry.vision,
        jsonSchema: entry.jsonSchema,
        timeoutMs: opts.timeoutMs,
        fetch: opts.fetch,
      });
  }
}

// ---- availability (GET /api/providers) ----

export interface ModelStatus {
  id: string;
  available: boolean;
  reason?: string;
}

export interface ProviderStatus {
  id: string;
  label: string;
  kind: ProviderKind;
  vision: boolean;
  jsonSchema: boolean;
  available: boolean;
  /** Italian, user-facing. */
  reason?: string;
  models: ModelStatus[];
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\./.test(h);
  } catch {
    return false;
  }
}

/** Ollama lists "gemma3:latest" for "gemma3"; LM Studio lists the id as configured. */
function modelListed(model: string, listed: Set<string>): boolean {
  return listed.has(model) || (!model.includes(":") && listed.has(`${model}:latest`));
}

export interface AvailabilityOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Per local server ping. */
  timeoutMs?: number;
  /** How long a result is reused. */
  ttlMs?: number;
  now?: () => number;
}

export class AvailabilityChecker {
  private readonly cache = new Map<string, { at: number; value: Promise<ProviderStatus> }>();
  private readonly env: Record<string, string | undefined>;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: AvailabilityOptions = {}) {
    this.env = opts.env ?? process.env;
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 1500;
    this.ttlMs = opts.ttlMs ?? 15_000;
    this.now = opts.now ?? Date.now;
  }

  status(registry: readonly ProviderEntry[]): Promise<ProviderStatus[]> {
    return Promise.all(registry.map((e) => this.one(e)));
  }

  private one(e: ProviderEntry): Promise<ProviderStatus> {
    const hit = this.cache.get(e.id);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = this.check(e);
    this.cache.set(e.id, { at: this.now(), value });
    return value;
  }

  private async check(e: ProviderEntry): Promise<ProviderStatus> {
    const base = { id: e.id, label: e.label, kind: e.kind, vision: e.vision, jsonSchema: e.jsonSchema };
    const all = (available: boolean, reason?: string): ProviderStatus => ({
      ...base,
      available,
      ...(reason ? { reason } : {}),
      models: e.models.map((id) => ({ id, available, ...(reason ? { reason } : {}) })),
    });
    if (e.kind === "claude-cli") {
      const bin = this.env.PAGINAVIVA_CLAUDE_BIN || "claude";
      return findOnPath(bin, this.env) ? all(true) : all(false, "Claude Code non è installato su questo PC.");
    }
    if (e.kind === "gemini-cli") {
      const bin = this.env.PAGINAVIVA_GEMINI_BIN || "gemini";
      return findOnPath(bin, this.env) ? all(true) : all(false, "Gemini CLI non è installato su questo PC.");
    }
    if (e.apiKeyEnv && !this.env[e.apiKeyEnv]) return all(false, `Manca la chiave ${e.apiKeyEnv} in server/.env.`);
    if (!isLocalUrl(e.baseUrl!)) return all(true);
    // Local server: reachable, and which configured models are pulled.
    let listed: Set<string> | null = null;
    try {
      const res = await this.fetchFn(`${e.baseUrl}/models`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return all(false, "Il server locale non risponde come previsto.");
      const body = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
      const ids = (body.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string");
      if (ids.length) listed = new Set(ids);
    } catch {
      return all(false, "Il server locale non è avviato.");
    }
    if (!listed) return all(true);
    const models = e.models.map((id) =>
      modelListed(id, listed) ? { id, available: true } : { id, available: false, reason: "Modello non scaricato." },
    );
    const any = models.some((m) => m.available);
    return { ...base, available: any, ...(any ? {} : { reason: "Nessuno dei modelli configurati è scaricato." }), models };
  }
}
