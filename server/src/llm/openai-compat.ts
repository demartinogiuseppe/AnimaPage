// OpenAI-compatible chat completions adapter (decision D20): OpenAI, Mistral, OpenRouter, Groq,
// Gemini's OpenAI endpoint, and the local servers Ollama (/v1) and LM Studio.
//
// - Images: `image_url` content parts with base64 data URLs (Ollama accepts only base64).
// - Structured output: `response_format: { type: "json_schema", json_schema: { name, schema } }`
//   when the entry says `jsonSchema: true` (OpenAI, LM Studio, Ollama), else
//   `{ type: "json_object" }` (JSON mode) with the schema in the prompt; then the shared
//   validation/repair of structured.ts in both cases.
// - The API key comes from the env var named by the entry's `apiKeyEnv` (server/.env); it is only
//   ever put in the Authorization header and is scrubbed from every error message.
import { LlmError, type LlmProvider, type LlmUsage, type StructuredRequest, type StructuredResponse } from "./types.ts";
import { completeStructured, type TextAnswer, type TextTurn } from "./structured.ts";

export interface OpenAiCompatOptions {
  /** Registry id (server/config/llm_providers.yaml); the ledger shows `openai:<id>`. */
  id: string;
  baseUrl: string;
  model: string;
  /** The key itself, resolved server-side from `apiKeyEnv`. Never logged. */
  apiKey?: string;
  vision: boolean;
  jsonSchema: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export const OPENAI_DEFAULT_TIMEOUT_MS = 240_000;

type Json = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function buildChatBody(turn: TextTurn, model: string, jsonSchema: Json | null): Json {
  const content =
    turn.images.length === 0
      ? turn.prompt
      : [
          ...turn.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data.toString("base64")}` } })),
          { type: "text", text: turn.prompt },
        ];
  return {
    model,
    stream: false,
    messages: [
      { role: "system", content: turn.system },
      { role: "user", content },
    ],
    response_format: jsonSchema ? { type: "json_schema", json_schema: { name: "answer", schema: jsonSchema } } : { type: "json_object" },
  };
}

/** The assistant text of a chat completion (string content, or the text parts of an array). */
export function parseChatResponse(body: unknown): TextAnswer & { finishReason?: string } {
  const b = (body ?? {}) as Json;
  const choice = (Array.isArray(b.choices) ? b.choices[0] : undefined) as Json | undefined;
  const msg = (choice?.message ?? {}) as Json;
  const text =
    typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((p) => (typeof (p as Json).text === "string" ? ((p as Json).text as string) : "")).join("")
        : "";
  const u = (b.usage ?? {}) as Json;
  const usage: LlmUsage = { inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens) };
  return {
    text,
    model: typeof b.model === "string" ? b.model : undefined,
    usage: usage.inputTokens === undefined && usage.outputTokens === undefined ? undefined : usage,
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
  };
}

export class OpenAiCompatProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly opts: OpenAiCompatOptions;

  constructor(opts: OpenAiCompatOptions) {
    this.opts = opts;
    this.name = `openai:${opts.id}`;
    this.model = opts.model;
  }

  private scrub(s: string): string {
    const k = this.opts.apiKey;
    const t = s.replace(/\s+/g, " ").trim().slice(0, 300);
    return k ? t.split(k).join("[key]") : t;
  }

  async generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
    if (!this.opts.vision && (req.images?.length ?? 0) > 0)
      throw new LlmError("not_configured", `model ${this.opts.model} (${this.opts.id}) does not accept images`);
    return completeStructured(req, { nativeSchema: this.opts.jsonSchema, fallbackModel: this.opts.model }, (turn) =>
      this.complete(turn, this.opts.jsonSchema ? req.jsonSchema : null),
    );
  }

  private async complete(turn: TextTurn, schema: Json | null): Promise<TextAnswer> {
    const timeoutMs = this.opts.timeoutMs ?? OPENAI_DEFAULT_TIMEOUT_MS;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(chatCompletionsUrl(this.opts.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify(buildChatBody(turn, this.opts.model, schema)),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      if (err.name === "TimeoutError" || err.name === "AbortError")
        throw new LlmError("timeout", `${this.opts.id} did not answer within ${timeoutMs} ms`);
      throw new LlmError("http_failed", `cannot reach ${this.opts.id}: ${this.scrub(err.cause?.code ?? err.message)}`);
    }
    const raw = await res.text().catch(() => "");
    if (!res.ok) throw new LlmError("http_failed", `${this.opts.id} answered HTTP ${res.status}: ${this.scrub(raw)}`);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new LlmError("http_failed", `${this.opts.id} answered with something that is not JSON: ${this.scrub(raw)}`);
    }
    const answer = parseChatResponse(body);
    if (!answer.text) throw new LlmError("no_structured_output", `${this.opts.id} returned an empty answer${answer.finishReason ? ` (${answer.finishReason})` : ""}`);
    return answer;
  }
}
