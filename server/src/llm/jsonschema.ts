// Minimal JSON Schema validator for the providers without native schema support (decision D20).
//
// Covers the keywords our schemas use (PageAnalysis, SceneSpec variants, judge verdicts; listed
// by walking them): type, properties, required, additionalProperties, propertyNames, items,
// min/maxItems, enum, const, anyOf, oneOf, allOf, min/maxLength, pattern, minimum, maximum,
// exclusiveMinimum, and local `$ref` into `definitions` / `$defs`. `format` and `default` are
// ignored. The callers still parse the answer with zod: this only produces the error list for
// the one format-repair round in structured.ts.

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

function resolveRef(root: Json, ref: string): Json | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = isObj(node) ? node[key] : undefined;
  }
  return isObj(node) ? node : undefined;
}

const MAX_ERRORS = 30;

/** Errors as "path: message" (path in dot notation, "(root)" for the top level); empty = valid. */
export function validateJsonSchema(data: unknown, schema: Json): string[] {
  const errors: string[] = [];
  const add = (path: string, msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(`${path || "(root)"}: ${msg}`);
  };
  walk(data, schema, "", schema, add, 0);
  return errors;
}

function walk(v: unknown, s: unknown, path: string, root: Json, add: (p: string, m: string) => void, depth: number): void {
  if (s === false) return add(path, "not allowed");
  if (!isObj(s) || depth > 64) return;
  if (typeof s.$ref === "string") {
    const target = resolveRef(root, s.$ref);
    if (target) walk(v, target, path, root, add, depth + 1);
  }

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => typeMatches(v, t))) return add(path, `expected ${types.join(" | ")}, got ${typeOf(v)}`);
  }
  if ("const" in s && JSON.stringify(v) !== JSON.stringify(s.const)) add(path, `expected ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v)))
    add(path, `expected one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}`.slice(0, 200));

  if (Array.isArray(s.allOf)) for (const sub of s.allOf) walk(v, sub, path, root, add, depth + 1);
  for (const key of ["anyOf", "oneOf"] as const) {
    const list = s[key];
    if (!Array.isArray(list)) continue;
    const results = list.map((sub) => {
      const errs: string[] = [];
      walk(v, sub, path, root, (p, m) => errs.push(`${p || "(root)"}: ${m}`), depth + 1);
      return errs;
    });
    const passing = results.filter((r) => r.length === 0).length;
    if (passing === 0) {
      // The closest alternative's errors are the most useful hint for the repair.
      const best = results.reduce((a, b) => (b.length < a.length ? b : a), results[0] ?? []);
      add(path, `does not match any allowed alternative${best[0] ? ` (closest: ${best.slice(0, 3).join("; ")})` : ""}`);
    } else if (key === "oneOf" && passing > 1) add(path, "matches more than one alternative");
  }

  if (typeof v === "string") {
    if (typeof s.minLength === "number" && v.length < s.minLength) add(path, `shorter than ${s.minLength} characters`);
    if (typeof s.maxLength === "number" && v.length > s.maxLength) add(path, `longer than ${s.maxLength} characters`);
    if (typeof s.pattern === "string") {
      try {
        if (!new RegExp(s.pattern, "u").test(v)) add(path, `does not match /${s.pattern}/`);
      } catch {
        /* a pattern JavaScript cannot compile is skipped */
      }
    }
  }
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) add(path, `less than ${s.minimum}`);
    if (typeof s.maximum === "number" && v > s.maximum) add(path, `greater than ${s.maximum}`);
    if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) add(path, `not greater than ${s.exclusiveMinimum}`);
    if (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) add(path, `not less than ${s.exclusiveMaximum}`);
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === "number" && v.length < s.minItems) add(path, `fewer than ${s.minItems} items`);
    if (typeof s.maxItems === "number" && v.length > s.maxItems) add(path, `more than ${s.maxItems} items`);
    if (s.items !== undefined && !Array.isArray(s.items)) v.forEach((x, i) => walk(x, s.items, `${path}${path ? "." : ""}${i}`, root, add, depth + 1));
  }
  if (isObj(v)) {
    const props = isObj(s.properties) ? s.properties : {};
    if (Array.isArray(s.required)) for (const r of s.required) if (typeof r === "string" && !(r in v)) add(path, `missing required property "${r}"`);
    for (const [k, x] of Object.entries(v)) {
      const p = `${path}${path ? "." : ""}${k}`;
      if (k in props) walk(x, props[k], p, root, add, depth + 1);
      else if (s.additionalProperties === false) add(path, `unknown property "${k}"`);
      else if (isObj(s.additionalProperties)) walk(x, s.additionalProperties, p, root, add, depth + 1);
      if (isObj(s.propertyNames)) walk(k, s.propertyNames, p, root, add, depth + 1);
    }
  }
}
