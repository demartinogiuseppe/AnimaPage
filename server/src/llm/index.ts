// Provider selection by environment (the server-wide default; the app can override it per phase,
// see registry.ts and decision D20):
// - PAGINAVIVA_MODE != "live"  -> mock (default: everything works offline);
// - PAGINAVIVA_MODE == "live"  -> PAGINAVIVA_LLM: "claude-cli" (default) | "gemini-cli" | "mock" | "local".
import { readMode } from "../index.ts";
import { ClaudeCliProvider, type ClaudeCliOptions } from "./claude-cli.ts";
import { GeminiCliProvider } from "./gemini-cli.ts";
import { LocalProvider } from "./local.ts";
import { MockProvider } from "./mock.ts";
import type { LlmProvider, ProviderName } from "./types.ts";

export * from "./types.ts";
export { ClaudeCliProvider } from "./claude-cli.ts";
export { GeminiCliProvider } from "./gemini-cli.ts";
export { OpenAiCompatProvider } from "./openai-compat.ts";
export { LocalProvider } from "./local.ts";
export { MockProvider, RecordingProvider, requestKey, readRecordings, DEFAULT_FIXTURES_DIR } from "./mock.ts";

const NAMES: readonly ProviderName[] = ["mock", "claude-cli", "gemini-cli", "local"];

export function providerNameFromEnv(env: Record<string, string | undefined>): ProviderName {
  if (readMode(env) !== "live") return "mock";
  const v = env.PAGINAVIVA_LLM || "claude-cli";
  if ((NAMES as readonly string[]).includes(v)) return v as ProviderName;
  throw new Error(`Unknown PAGINAVIVA_LLM '${v}' (expected ${NAMES.join(" | ")})`);
}

export interface ProviderOptions {
  fixturesDir?: string;
  claudeCli?: ClaudeCliOptions;
}

export function createProvider(env: Record<string, string | undefined>, opts: ProviderOptions = {}): LlmProvider {
  switch (providerNameFromEnv(env)) {
    case "mock":
      return new MockProvider(opts.fixturesDir);
    case "claude-cli":
      return new ClaudeCliProvider(opts.claudeCli);
    case "gemini-cli":
      return new GeminiCliProvider();
    case "local":
      return new LocalProvider(env.PAGINAVIVA_LOCAL_LLM_URL || undefined, env.PAGINAVIVA_LOCAL_LLM_MODEL || undefined);
  }
}
