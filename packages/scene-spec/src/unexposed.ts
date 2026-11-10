// Schema parts the SceneSpec already accepts but the generation schema does not offer to the model yet.
//
// The JSON Schema sent with every generation request is part of the recorded request hashes
// (fixtures/llm/). New optional fields and union variants are wrapped in `unexposed(...)`: zod still
// validates them (a scene may carry them: hand-written, server-set, or from a later prompt), while
// server/src/generate/schema.ts drops every marked node from the model's schema, which therefore stays
// byte-identical. Exposing one to the model = removing the wrapper (and re-recording the fixtures).
//
// Rule for wrapped schemas: build them from fresh zod instances (no constants shared with exposed
// parts), so zod's reuse detection (`definitions`) is the same with or without them.
import type { z } from "zod";

const marked = new WeakSet<object>();

/** JSON Schema key that marks a node to drop (set by the generator's `override`). */
export const UNEXPOSED_KEY = "x-pv-unexposed";

export function unexposed<T extends z.ZodType>(schema: T): T {
  marked.add(schema);
  return schema;
}

export function isUnexposed(schema: unknown): boolean {
  return typeof schema === "object" && schema !== null && marked.has(schema);
}
