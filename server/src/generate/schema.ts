// JSON Schema of one SceneSpec variant, sized for `claude --json-schema`.
//
// The schema travels on the command line. On Windows a whole command line is limited to
// 32 767 characters (CreateProcess) and every `"` of the JSON is escaped as `\"`, so the
// schema is made compact: reused sub-schemas become `definitions` + `$ref` (the CLI
// accepts them, verified live), descriptions are dropped (the guides carry the meaning),
// and `io: "input"` keeps fields with zod defaults optional. If the result is still too
// long, engineData is relaxed to a plain object: zod and the semantic checks still
// validate it after the call, and the repair round reports what is wrong.
import { isUnexposed, SceneSpec, UNEXPOSED_KEY, type EngineId } from "@pv/scene-spec";

/**
 * Order of the scene's top-level fields in the schema and in the prompt's example (decision D25): the
 * model writes them in this order, and chapter 1 can play (stream.ts) once engineData and chapters[0]
 * are complete, so engineData comes before chapters and what the first chapter does not need comes last.
 */
export const SCENE_FIELD_ORDER = ["version", "engine", "title", "page", "kind", "style", "music", "voices", "engineData", "chapters", "sources", "videos", "disclaimers"];

/** `obj`'s keys in SCENE_FIELD_ORDER (others after them, in their own order). */
export function inFieldOrder<T extends Record<string, unknown>>(obj: T): T {
  const rank = (k: string) => (SCENE_FIELD_ORDER.includes(k) ? SCENE_FIELD_ORDER.indexOf(k) : SCENE_FIELD_ORDER.length);
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => rank(a) - rank(b))) as T;
}

/** Budget for system prompt + schema on the command line (escaped), leaving room for the other flags. */
export const COMMAND_LINE_BUDGET = 30_000;

type Json = Record<string, unknown>;

/**
 * Drops descriptions and rewrites tuples. The CLI checks the schema with a strict draft-07
 * validator (it rejects `prefixItems`), while the API requires a valid draft 2020-12 schema
 * (it rejects draft-07 tuple `items: [...]`, verified live). A tuple therefore becomes
 * `items: <schema>` (or anyOf of the distinct item schemas) with minItems = maxItems = length,
 * which both drafts accept; zod still checks the exact positions afterwards.
 */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => !marked(x)).map(strip);
  if (v && typeof v === "object") {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) if (k !== "description" && k !== "$schema") out[k] = strip(x);
    // Schema parts not offered to the model yet (scene-spec unexposed.ts): dropped from properties and unions.
    if (out.properties && typeof out.properties === "object") {
      const props = out.properties as Json;
      const gone = Object.keys(props).filter((k) => marked(props[k]));
      for (const k of gone) delete props[k];
      if (gone.length && Array.isArray(out.required)) out.required = (out.required as string[]).filter((k) => !gone.includes(k));
    }
    if (Array.isArray(out.items)) {
      const list = out.items as unknown[];
      const distinct = [...new Map(list.map((s) => [JSON.stringify(s), s])).values()];
      out.items = distinct.length === 1 ? distinct[0] : { anyOf: distinct };
      out.minItems ??= list.length;
      out.maxItems ??= list.length;
      delete out.additionalItems;
    }
    return out;
  }
  return v;
}

const marked = (v: unknown): boolean => !!v && typeof v === "object" && UNEXPOSED_KEY in v;

function variant(engine: EngineId) {
  const v = SceneSpec.options.find((o) => o.shape.engine.value === engine);
  if (!v) throw new Error(`No SceneSpec variant for engine "${engine}"`);
  return v;
}

/** Characters the JSON takes once quoted as one Windows command-line argument. */
export function escapedLength(s: string): number {
  return s.length + (s.match(/["\\]/g)?.length ?? 0) + 2;
}

export interface SceneSchema {
  schema: Json;
  /** True when engineData was relaxed to `{ type: "object" }` to fit the command line. */
  relaxed: boolean;
  length: number;
}

/** Calls `fn` on every sub-schema position (not on property-name maps), letting it replace the node. */
function eachSchema(node: Json, fn: (s: Json) => Json | undefined): void {
  const visit = (v: unknown): unknown => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const rep = fn(v as Json);
    if (rep) return rep;
    walk(v as Json);
    return v;
  };
  const walk = (s: Json) => {
    for (const k of ["properties", "patternProperties"])
      if (s[k] && typeof s[k] === "object") for (const [name, sub] of Object.entries(s[k] as Json)) (s[k] as Json)[name] = visit(sub);
    // Definition roots are never replaced (that would make them refer to themselves): only their insides.
    if (s.definitions && typeof s.definitions === "object") for (const sub of Object.values(s.definitions as Json)) if (sub && typeof sub === "object") walk(sub as Json);
    for (const k of ["items", "additionalProperties", "not"]) if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) s[k] = visit(s[k]);
    for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(s[k])) s[k] = (s[k] as unknown[]).map(visit);
  };
  walk(node);
}

/**
 * Lifts sub-schemas that occur more than once (and are not tiny) into `definitions` with `$ref`,
 * on top of zod's own reuse detection, which misses structurally equal schemas built separately
 * (e.g. the number-or-formula union of every graph field).
 */
export function dedupeSchema(schema: Json, minLength = 40): Json {
  const defs = ((schema.definitions ??= {}) as Json);
  for (let round = 0; round < 4; round++) {
    const counts = new Map<string, number>();
    eachSchema(schema, (s) => {
      const k = JSON.stringify(s);
      if (k.length >= minLength && !("$ref" in s)) counts.set(k, (counts.get(k) ?? 0) + 1);
      return undefined;
    });
    const names = new Map<string, string>();
    let n = Object.keys(defs).length;
    for (const [k, c] of counts) if (c > 1) names.set(k, `r${n++}`);
    if (names.size === 0) break;
    eachSchema(schema, (s) => {
      const name = names.get(JSON.stringify(s));
      if (!name) return undefined;
      defs[name] ??= JSON.parse(JSON.stringify(s)) as Json;
      return { $ref: `#/definitions/${name}` };
    });
  }
  return schema;
}

/** The variant's schema as zod writes it, without descriptions and with tuples rewritten. */
export function rawSceneSchema(engine: EngineId): Json {
  const schema = strip(
    variant(engine).toJSONSchema({
      target: "draft-07",
      io: "input",
      reused: "ref",
      override: (ctx) => {
        if (isUnexposed(ctx.zodSchema)) (ctx.jsonSchema as Json)[UNEXPOSED_KEY] = true;
      },
    }),
  ) as Json;
  // SceneSpec.lang is set by the server (D21): the model never writes it, and the schema (part of the
  // recorded request hashes) stays as it was.
  delete (schema.properties as Json | undefined)?.lang;
  schema.properties = inFieldOrder(schema.properties as Json);
  const rank = Object.keys(schema.properties as Json);
  if (Array.isArray(schema.required)) schema.required = [...(schema.required as string[])].sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
  return schema;
}

export function sceneJsonSchema(engine: EngineId, systemLength = 0): SceneSchema {
  const full = dedupeSchema(rawSceneSchema(engine));
  const fullLen = escapedLength(JSON.stringify(full));
  if (fullLen + systemLength <= COMMAND_LINE_BUDGET) return { schema: full, relaxed: false, length: fullLen };
  const props = { ...(full.properties as Json), engineData: { type: "object" } };
  const relaxed = { ...full, properties: props };
  // Definitions only used by engineData are now unreferenced: keep the transitive closure of the rest.
  const all = (full.definitions ?? {}) as Json;
  const keep = new Set<string>();
  const visit = (node: unknown) => {
    for (const m of JSON.stringify(node).matchAll(/"#\/definitions\/([^"]+)"/g)) {
      const k = m[1]!;
      if (!keep.has(k) && k in all) {
        keep.add(k);
        visit(all[k]);
      }
    }
  };
  visit(props);
  const out = { ...relaxed, definitions: Object.fromEntries(Object.entries(all).filter(([k]) => keep.has(k))) };
  return { schema: out, relaxed: true, length: escapedLength(JSON.stringify(out)) };
}
