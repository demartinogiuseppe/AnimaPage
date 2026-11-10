// LlmProvider: the only way the server talks to a language model (decision D3).
// Implementations: mock (recorded fixtures), claude-cli (Claude Code CLI with the
// user's subscription), gemini-cli (Gemini CLI with the user's Google account), openai
// (any OpenAI-compatible chat completions endpoint, local servers included; "local" is
// the env-configured one). See decision D20 and server/config/llm_providers.yaml.

/** Values of PAGINAVIVA_LLM (the server-wide default). */
export type ProviderName = "mock" | "claude-cli" | "gemini-cli" | "local";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface ImageInput {
  mediaType: ImageMediaType;
  data: Buffer;
}

export interface StructuredRequest {
  system: string;
  prompt: string;
  images?: ImageInput[];
  /** JSON Schema (draft-07) the answer must satisfy. */
  jsonSchema: Record<string, unknown>;
}

export interface LlmUsage {
  /** Uncached input tokens. */
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /** Client-side list-price estimate reported by the CLI; not billed on a subscription. */
  costUsdEstimate?: number;
}

export interface StructuredResponse {
  data: unknown;
  usage?: LlmUsage;
  durationMs: number;
  model: string;
}

/**
 * Streaming of the answer while the model writes it (decision D22). Providers that cannot stream
 * ignore it and answer all at once, as before.
 */
export interface StreamOptions {
  /** A piece of the structured answer's JSON text; `restart`: a new attempt begins, drop the text so far. */
  onJsonDelta(delta: string, restart: boolean): void;
}

export interface LlmProvider {
  /** Recorded in the ledger, e.g. "claude-cli", "gemini-cli", "openai:ollama". */
  readonly name: string;
  /** Model asked for, when known before the call (the ledger shows it even after a failure). */
  readonly model?: string;
  generateStructured(req: StructuredRequest, stream?: StreamOptions): Promise<StructuredResponse>;
}

export type LlmErrorCode =
  | "not_configured"
  | "cli_missing"
  | "cli_failed"
  | "timeout"
  | "no_structured_output"
  | "http_failed"
  | "mock_missing";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}
