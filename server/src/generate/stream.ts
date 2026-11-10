// Incremental reading of the SceneSpec JSON while the model writes it (decision D22).
//
// The scanner only tracks structure (depth, strings, escapes) over the text received so far and
// remembers where each top-level value and each element of a top-level array begins and ends. A
// value is parsed once it is complete; a slice that does not parse is skipped (the final answer is
// still validated as a whole). Nothing here trusts the partial text: it only finds the moment the
// first chapter's inputs are complete.

type Json = Record<string, unknown>;

export class JsonStreamScanner {
  private buf = "";
  private pos = 0;
  private depth = 0;
  private inString = false;
  private escape = false;
  /** Top level (depth 1): what comes next. */
  private expect: "key" | "colon" | "value" | "inValue" = "key";
  private keyStart = -1;
  private key = "";
  private valueStart = -1;
  /** Element of the top-level array being written (depth 2). */
  private arrayKey: string | null = null;
  private elemStart = -1;
  /** Complete top-level values, in the order written. */
  readonly fields = new Map<string, unknown>();
  /** Complete elements of top-level arrays, also while the array is still open. */
  readonly items = new Map<string, unknown[]>();
  /** The root object is closed. */
  done = false;
  /** Bumped every time a field or an array element completes (cheap change detection). */
  version = 0;

  reset(): void {
    this.buf = "";
    this.pos = 0;
    this.depth = 0;
    this.inString = this.escape = this.done = false;
    this.expect = "key";
    this.keyStart = this.valueStart = this.elemStart = -1;
    this.key = "";
    this.arrayKey = null;
    this.fields.clear();
    this.items.clear();
    this.version++;
  }

  push(text: string): void {
    this.buf += text;
    for (; this.pos < this.buf.length && !this.done; this.pos++) this.step(this.buf[this.pos]!, this.pos);
  }

  private parse(from: number, to: number): { ok: true; value: unknown } | { ok: false } {
    try {
      return { ok: true, value: JSON.parse(this.buf.slice(from, to)) };
    } catch {
      return { ok: false };
    }
  }

  private endValue(i: number): void {
    if (this.valueStart >= 0) {
      const v = this.parse(this.valueStart, i);
      if (v.ok) {
        this.fields.set(this.key, v.value);
        this.version++;
      }
    }
    this.valueStart = -1;
    this.arrayKey = null;
    this.expect = "key";
  }

  private endElement(i: number): void {
    if (this.elemStart >= 0 && this.arrayKey !== null) {
      const v = this.parse(this.elemStart, i);
      if (v.ok) {
        const list = this.items.get(this.arrayKey) ?? [];
        list.push(v.value);
        this.items.set(this.arrayKey, list);
        this.version++;
      }
    }
    this.elemStart = -1;
  }

  private step(c: string, i: number): void {
    if (this.inString) {
      if (this.escape) this.escape = false;
      else if (c === "\\") this.escape = true;
      else if (c === '"') {
        this.inString = false;
        if (this.depth === 1 && this.expect === "key" && this.keyStart >= 0) {
          const k = this.parse(this.keyStart, i + 1);
          this.key = k.ok && typeof k.value === "string" ? k.value : "";
          this.keyStart = -1;
          this.expect = "colon";
        }
      }
      return;
    }
    if (c === " " || c === "\n" || c === "\r" || c === "\t") return;
    if (this.depth === 0) {
      if (c === "{") this.depth = 1;
      return;
    }
    if (this.depth === 1) {
      if (this.expect === "key") {
        if (c === '"') {
          this.inString = true;
          this.keyStart = i;
        } else if (c === "}") this.close();
        return;
      }
      if (this.expect === "colon") {
        if (c === ":") this.expect = "value";
        return;
      }
      if (this.expect === "value") {
        this.valueStart = i;
        this.expect = "inValue";
        if (c === '"') this.inString = true;
        else if (c === "{" || c === "[") {
          this.depth = 2;
          if (c === "[") {
            this.arrayKey = this.key;
            this.items.set(this.key, []);
          }
        }
        return;
      }
      // inValue at depth 1: a primitive, or just after a closed object/array/string.
      if (c === ",") this.endValue(i);
      else if (c === "}") {
        this.endValue(i);
        this.close();
      }
      return;
    }
    // depth >= 2
    if (this.depth === 2 && this.arrayKey !== null) {
      if (c === "," || c === "]") {
        this.endElement(i);
        if (c === "]") this.depth = 1;
        return;
      }
      if (this.elemStart < 0) this.elemStart = i;
    }
    if (c === '"') this.inString = true;
    else if (c === "{" || c === "[") this.depth++;
    else if (c === "}" || c === "]") this.depth--;
  }

  private close(): void {
    this.depth = 0;
    this.done = true;
    this.version++;
  }
}

/** Top-level keys the first chapter cannot do without (the server fills page, sources, videos, notices). */
const NEEDED = ["title", "kind", "engineData"] as const;

/**
 * The scene of the first chapter alone, once the text written so far holds everything it needs:
 * title, kind, engineData (and the voices of a dialogue) and the complete chapters[0]. Engine data
 * kept per chapter (`engineData.chapters[].chapter`) is filtered to that chapter; the parts the
 * server rebuilds anyway (page, sources, videos, disclaimers) get neutral placeholders.
 * Undefined while something is missing.
 */
export function firstChapterData(scan: JsonStreamScanner, engine: string): Json | undefined {
  const first = scan.items.get("chapters")?.[0] ?? (scan.fields.get("chapters") as unknown[] | undefined)?.[0];
  if (!first || typeof first !== "object") return undefined;
  if (NEEDED.some((k) => !scan.fields.has(k))) return undefined;
  if (engine === "stage" && !scan.fields.has("voices")) return undefined;
  const d = structuredClone(Object.fromEntries(scan.fields)) as Json;
  const ch0 = structuredClone(first) as Json;
  const ed = d.engineData as Json | undefined;
  if (ed && Array.isArray(ed.chapters)) ed.chapters = ed.chapters.filter((e) => (e as Json | null)?.chapter === ch0.id);
  return {
    version: "0.1",
    page: { subject: "", topic: "", language: "it" },
    sources: [],
    videos: [],
    disclaimers: [],
    ...d,
    engine,
    chapters: [ch0],
  };
}
