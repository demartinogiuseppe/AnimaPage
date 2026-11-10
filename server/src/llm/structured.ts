// Structured output for the providers that answer with text (decision D20): Gemini CLI and the
// OpenAI-compatible endpoints. Claude CLI has `--json-schema` and does not use this.
//
//  1. native schema when the endpoint has one (the adapter sends it), else the schema goes in the
//     prompt with a "JSON only" instruction (adapter-side tweak: the shared prompts stay neutral);
//  2. markdown fences and stray prose around the object are stripped, then JSON.parse;
//  3. the object is checked against the request's JSON Schema (jsonschema.ts);
//  4. if parsing or the schema check failed: ONE repair call with the errors and the previous answer;
//  5. a repaired answer that parses is returned even if the schema still complains: the caller's
//     zod parse is the authority and runs its own repair/fallback (analyze: one repair; generate:
//     one repair, then the `card` fallback). An answer that never parses throws
//     `no_structured_output`, the same failure the Claude CLI reports.
import { validateJsonSchema } from "./jsonschema.ts";
import { LlmError, type ImageInput, type LlmUsage, type StructuredRequest, type StructuredResponse } from "./types.ts";

/** One text turn for the adapter: what to send, with the images. */
export interface TextTurn {
  system: string;
  prompt: string;
  images: ImageInput[];
}

export interface TextAnswer {
  text: string;
  usage?: LlmUsage;
  model?: string;
}

export const JSON_ONLY_SYSTEM = "Answer with exactly one JSON object: no markdown code fences, no text before or after it.";

/** Longest previous answer quoted back in the repair turn. */
const MAX_QUOTED = 24_000;

export function schemaInPrompt(prompt: string, schema: Record<string, unknown>): string {
  return [
    prompt,
    "",
    "Output format: ONE JSON object that validates against this JSON Schema (draft-07, `$ref` points into `definitions`). Output only the JSON object.",
    "JSON Schema:",
    JSON.stringify(schema),
  ].join("\n");
}

export type Extracted = { ok: true; value: unknown } | { ok: false; error: string };

/** The JSON object in a model's text answer: fences and surrounding prose are ignored. */
export function extractJson(text: string): Extracted {
  const t = text.trim();
  const candidates: string[] = [t];
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(t);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  let error = "empty answer";
  for (const c of candidates) {
    if (!c) continue;
    try {
      return { ok: true, value: JSON.parse(c) };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: `not valid JSON (${error})` };
}

function problemsOf(x: Extracted, schema: Record<string, unknown>): string[] {
  if (!x.ok) return [x.error];
  if (typeof x.value !== "object" || x.value === null || Array.isArray(x.value)) return ["(root): expected a JSON object"];
  return validateJsonSchema(x.value, schema);
}

export function repairTurnPrompt(basePrompt: string, previous: string, problems: string[]): string {
  const quoted = previous.length > MAX_QUOTED ? `${previous.slice(0, MAX_QUOTED)}…` : previous;
  return [
    basePrompt,
    "",
    "Your previous answer cannot be used:",
    ...problems.slice(0, 20).map((p) => `- ${p}`),
    "",
    "Previous answer:",
    quoted,
    "",
    "Answer again with the complete, corrected JSON object only.",
  ].join("\n");
}

function addUsage(acc: LlmUsage, u: LlmUsage | undefined): void {
  if (!u) return;
  for (const k of Object.keys(u) as (keyof LlmUsage)[]) {
    const v = u[k];
    if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
  }
}

/**
 * Runs the shared structured-output flow over an adapter's text `complete` call.
 * `nativeSchema`: the adapter sends the schema itself (OpenAI `json_schema`), so it is not repeated in the prompt.
 */
export async function completeStructured(
  req: StructuredRequest,
  opts: { nativeSchema: boolean; fallbackModel: string },
  complete: (turn: TextTurn) => Promise<TextAnswer>,
): Promise<StructuredResponse> {
  const started = performance.now();
  const usage: LlmUsage = {};
  const system = opts.nativeSchema ? req.system : `${req.system}\n\n${JSON_ONLY_SYSTEM}`;
  const basePrompt = opts.nativeSchema ? req.prompt : schemaInPrompt(req.prompt, req.jsonSchema);
  const images = req.images ?? [];

  const first = await complete({ system, prompt: basePrompt, images });
  addUsage(usage, first.usage);
  let model = first.model;
  let extracted = extractJson(first.text);
  const problems = problemsOf(extracted, req.jsonSchema);

  if (problems.length > 0) {
    const second = await complete({ system, prompt: repairTurnPrompt(basePrompt, first.text, problems), images });
    addUsage(usage, second.usage);
    model = second.model ?? model;
    const repaired = extractJson(second.text);
    // The first answer may have parsed (schema errors only): keep whichever parses, preferring the repair.
    if (repaired.ok) extracted = repaired;
  }
  if (!extracted.ok) throw new LlmError("no_structured_output", `the model did not answer with JSON: ${extracted.error}`);
  return {
    data: extracted.value,
    usage: Object.keys(usage).length ? usage : undefined,
    durationMs: Math.round(performance.now() - started),
    model: model ?? opts.fallbackModel,
  };
}
