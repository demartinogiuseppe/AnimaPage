// Minimal YAML reader for fixtures/pages/*.expected.yaml (tools/eval has no YAML dependency):
// top-level `key: value`, block lists (`- item`), flow collections ({ a: 1, b: [x, y] }),
// quoted or plain scalars, booleans, numbers and `#` comments.

type Value = string | number | boolean | null | Value[] | { [k: string]: Value };

/** A quote opens a quoted scalar only at the start of a value (not an apostrophe inside a word). */
const opensQuote = (s: string, i: number) => i === 0 || /[\s:[{,]/.test(s[i - 1]!);

function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === q) q = null;
    } else if ((c === '"' || c === "'") && opensQuote(line, i)) q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

function scalar(s: string): Value {
  const t = s.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** Parses a flow collection or scalar starting at s[i]; returns the value and the next index. */
function flow(s: string, i: number): [Value, number] {
  const skip = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  skip();
  if (s[i] === "[" || s[i] === "{") {
    const map = s[i] === "{";
    const close = map ? "}" : "]";
    i++;
    const arr: Value[] = [];
    const obj: Record<string, Value> = {};
    skip();
    while (i < s.length && s[i] !== close) {
      if (map) {
        const colon = s.indexOf(":", i);
        const key = s.slice(i, colon).trim();
        const [v, j] = flow(s, colon + 1);
        obj[key] = v;
        i = j;
      } else {
        const [v, j] = flow(s, i);
        arr.push(v);
        i = j;
      }
      skip();
      if (s[i] === ",") i++;
      skip();
    }
    return [map ? obj : arr, i + 1];
  }
  let j = i;
  let q: string | null = null;
  while (j < s.length) {
    const c = s[j]!;
    if (q) {
      if (c === q) q = null;
    } else if ((c === '"' || c === "'") && opensQuote(s, j)) q = c;
    else if (c === "," || c === "]" || c === "}") break;
    j++;
  }
  return [scalar(s.slice(i, j)), j];
}

function value(s: string): Value {
  const t = s.trim();
  return t.startsWith("[") || t.startsWith("{") ? flow(t, 0)[0] : scalar(t);
}

export function parseYamlLite(text: string): Record<string, Value> {
  const out: Record<string, Value> = {};
  let listKey: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(.*)$/) ?? line.match(/^-\s+(.*)$/);
    if (item && listKey) {
      (out[listKey] as Value[]).push(value(item[1]!));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv as unknown as [string, string, string];
    if (rest === "") {
      out[key] = [];
      listKey = key;
    } else {
      out[key] = value(rest);
      listKey = null;
    }
  }
  return out;
}
