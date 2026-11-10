// Cross-check: numbers printed on the page vs the sources. A difference beyond rounding
// becomes a Discrepancy with both values; the book is never corrected silently.
import type { PageAnalysis } from "@pv/scene-spec";
import type { Discrepancy } from "../pipeline/types.ts";
import type { BookQuantity, QuantityKind } from "./select.ts";
import { formatNumberIt } from "./text.ts";

export interface SourceNumber {
  value: number;
  sourceId: string;
  /** Year the value refers to, when the source says it. */
  year?: number;
  from: "wikipedia" | "wikidata";
}

export interface CrossCheck {
  name: string;
  kind: QuantityKind;
  bookValue: string;
  book: number;
  source: SourceNumber;
  match: boolean;
}

/** Italian book numbers: "5590076", "5.590.076", "13 668 km²", "13.668,5", "410 d.C.", "753 a.C.". */
export function parseBookNumber(raw: string): number | undefined {
  const s = raw.replace(/ | /g, " ").trim();
  const m = /(\d{1,3}(?:[. ]\d{3})+|\d+)(?:,(\d+))?/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/[. ]/g, "") + (m[2] ? `.${m[2]}` : ""));
  if (!Number.isFinite(n)) return undefined;
  return /a\.\s*C\./i.test(s) ? -n : n;
}

/** Half a unit of the last significant digit of an integer written on the page. */
export function roundingTolerance(book: number): number {
  if (!Number.isInteger(book) || book === 0) return 0;
  let z = 0;
  for (let v = Math.abs(book); v % 10 === 0; v /= 10) z++;
  return z === 0 ? 0 : 10 ** z / 2;
}

export function valuesMatch(kind: QuantityKind, book: number, source: number): boolean {
  const d = Math.abs(book - source);
  const rel = book === 0 ? d : d / Math.abs(book);
  const rounding = d <= roundingTolerance(book);
  switch (kind) {
    case "year":
      return book === source;
    case "population":
      return rounding;
    case "area":
      return rounding || rel <= 0.001;
    case "elevation":
      return rounding || d <= 3;
    case "length":
      return rounding || rel <= 0.02;
  }
}

const UNIT: Record<QuantityKind, string> = { population: "abitanti", area: "km²", elevation: "m", length: "km", year: "" };

export function formatSourceValue(kind: QuantityKind, n: number): string {
  if (kind === "year") return n < 0 ? `${-n} a.C.` : `${n} d.C.`;
  return `${formatNumberIt(n)} ${UNIT[kind]}`;
}

function note(kind: QuantityKind, s: SourceNumber): string {
  switch (kind) {
    case "population":
      return s.year
        ? `dato riferito al ${s.year}: la popolazione cambia nel tempo, il libro usa probabilmente un dato di un altro anno`
        : "dato più recente: la popolazione cambia nel tempo, il libro usa probabilmente un dato di un altro anno";
    case "area":
      return "misurazioni diverse secondo le fonti";
    case "elevation":
      return "misurazioni diverse secondo le fonti";
    case "length":
      return "misurazioni diverse secondo le fonti";
    case "year":
      return "le fonti riportano una data diversa";
  }
}

const digits = (s: string): string => s.replace(/[^\d]/g, "");

/** The page claim that states the number, or "<name>: <value>". */
export function claimFor(a: PageAnalysis, q: Pick<BookQuantity, "name" | "value">): string {
  const d = digits(q.value);
  const numbersIn = (t: string): string[] => (t.match(/\d{1,3}(?:[. ]\d{3})+|\d+/g) ?? []).map(digits);
  const hit = d ? a.claims.find((c) => numbersIn(c.text).includes(d)) : undefined;
  return hit?.text ?? `${q.name}: ${q.value}`;
}

export function crossCheck(q: BookQuantity, source: SourceNumber | undefined): CrossCheck | undefined {
  const book = parseBookNumber(q.value);
  if (book === undefined || !source) return undefined;
  return { name: q.name, kind: q.kind, bookValue: q.value, book, source, match: valuesMatch(q.kind, book, source.value) };
}

export function toDiscrepancy(a: PageAnalysis, q: BookQuantity, c: CrossCheck): Discrepancy {
  return {
    claim: claimFor(a, q),
    bookValue: q.value,
    sourceValue: formatSourceValue(c.kind, c.source.value),
    sourceId: c.source.sourceId,
    note: note(c.kind, c.source),
  };
}
