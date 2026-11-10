// Wikidata structured values (no key): one wbgetentities request for every candidate item.
// Parameters verified 2026-11-03 on https://www.wikidata.org/w/api.php?action=help&modules=wbgetentities
// (ids <= 50, props, languages). Data: CC0.
import { buildUrl, type HttpClient } from "./http.ts";

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const WIKIDATA_LICENSE = "CC0 1.0";
const MAX_IDS = 50;

/** Properties read, with the Italian label used in fact texts. */
export const PROPERTIES = {
  P1082: "popolazione",
  P2046: "superficie",
  P2044: "altitudine",
  P2043: "lunghezza",
  P625: "coordinate",
  P569: "data di nascita",
  P570: "data di morte",
  P585: "data",
  P580: "inizio",
  P582: "fine",
  P571: "fondazione o origine",
  P577: "data di pubblicazione",
} as const;
export type PropertyId = keyof typeof PROPERTIES;
const PROPERTY_IDS = Object.keys(PROPERTIES) as PropertyId[];

/** Wikidata unit items we can show. */
const UNITS: Record<string, string> = {
  Q11573: "m",
  Q828224: "km",
  Q712226: "km²",
  Q35852: "ha",
};

export type WdValue =
  | { kind: "quantity"; amount: number; unit?: string; pointInTime?: WdTime }
  | { kind: "time"; time: WdTime }
  | { kind: "coord"; lat: number; lon: number };

export interface WdTime {
  /** Signed year (negative = BC). */
  year: number;
  month?: number;
  day?: number;
  /** Wikidata precision: 9 year, 10 month, 11 day; 7 century. */
  precision: number;
}

export interface WdItem {
  id: string;
  labelIt?: string;
  labelEn?: string;
  /** Label in the user's language (non-Italian lessons, D21). */
  label?: string;
  values: Partial<Record<PropertyId, WdValue>>;
}

/** `lang`: the user's Wikipedia language (wikipedia.ts wikiLang); Italian keeps "it|en". */
export function entitiesUrl(ids: string[], lang = "it"): string {
  return buildUrl(WIKIDATA_API, [
    ["action", "wbgetentities"],
    ["format", "json"],
    ["formatversion", 2],
    ["ids", ids.join("|")],
    ["props", "labels|claims"],
    ["languages", lang === "it" || lang === "en" || !/^[a-z]{2,3}$/.test(lang) ? "it|en" : `${lang}|it|en`],
  ]);
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** Keeps only labels and the claims of PROPERTIES (rank, value, P585 qualifier): small fixtures. */
export function slimEntities(body: unknown): unknown {
  const entities = o(o(body).entities);
  const out: Obj = {};
  for (const [id, raw] of Object.entries(entities)) {
    const e = o(raw);
    const claims = o(e.claims);
    const keep: Obj = {};
    for (const p of PROPERTY_IDS) {
      const list = claims[p];
      if (!Array.isArray(list)) continue;
      keep[p] = list.map((c) => {
        const cc = o(c);
        const q = o(cc.qualifiers);
        return {
          rank: cc.rank,
          mainsnak: { datavalue: o(cc.mainsnak).datavalue },
          ...(q.P585 ? { qualifiers: { P585: q.P585 } } : {}),
        };
      });
    }
    out[id] = { id: e.id ?? id, labels: e.labels ?? {}, claims: keep, ...(e.missing !== undefined ? { missing: "" } : {}) };
  }
  return { entities: out };
}

export function parseTime(v: unknown): WdTime | undefined {
  const t = o(v);
  const m = typeof t.time === "string" ? /^([+-])(\d+)-(\d\d)-(\d\d)T/.exec(t.time) : null;
  const precision = typeof t.precision === "number" ? t.precision : 0;
  if (!m || precision < 7) return undefined;
  const year = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  const month = Number(m[3]);
  const day = Number(m[4]);
  return { year, precision, ...(precision >= 10 && month ? { month } : {}), ...(precision >= 11 && day ? { day } : {}) };
}

function parseValue(dv: unknown): WdValue | undefined {
  const d = o(dv);
  const v = o(d.value);
  if (d.type === "quantity") {
    const amount = Number(v.amount);
    if (!Number.isFinite(amount)) return undefined;
    const unitId = typeof v.unit === "string" ? v.unit.split("/").pop() : undefined;
    if (unitId && unitId !== "1" && !UNITS[unitId]) return undefined;
    return { kind: "quantity", amount, unit: unitId && unitId !== "1" ? UNITS[unitId] : undefined };
  }
  if (d.type === "time") {
    const time = parseTime(v);
    return time ? { kind: "time", time } : undefined;
  }
  if (d.type === "globecoordinate") {
    if (typeof v.globe === "string" && !v.globe.endsWith("/Q2")) return undefined; // Earth only
    if (typeof v.latitude !== "number" || typeof v.longitude !== "number") return undefined;
    return { kind: "coord", lat: v.latitude, lon: v.longitude };
  }
  return undefined;
}

const timeKey = (t?: WdTime): number => (t ? t.year * 10_000 + (t.month ?? 0) * 100 + (t.day ?? 0) : -Infinity);

/** Best statement: preferred rank first, then (for populations) the latest P585, never deprecated. */
export function bestValue(claims: unknown[]): WdValue | undefined {
  const parsed = claims
    .map((c) => {
      const cc = o(c);
      const value = parseValue(o(cc.mainsnak).datavalue);
      const pit = Array.isArray(o(cc.qualifiers).P585) ? parseTime(o(o((o(cc.qualifiers).P585 as unknown[])[0]).datavalue).value) : undefined;
      if (value?.kind === "quantity" && pit) value.pointInTime = pit;
      return { rank: cc.rank, value };
    })
    .filter((x): x is { rank: unknown; value: WdValue } => x.value !== undefined && x.rank !== "deprecated");
  if (parsed.length === 0) return undefined;
  const preferred = parsed.filter((x) => x.rank === "preferred");
  const pool = preferred.length ? preferred : parsed;
  const sorted = [...pool].sort((a, b) => {
    const ta = a.value.kind === "quantity" ? timeKey(a.value.pointInTime) : -Infinity;
    const tb = b.value.kind === "quantity" ? timeKey(b.value.pointInTime) : -Infinity;
    return tb - ta;
  });
  return sorted[0]!.value;
}

export function parseEntities(body: unknown, lang = "it"): Map<string, WdItem> {
  const out = new Map<string, WdItem>();
  for (const [id, raw] of Object.entries(o(o(body).entities))) {
    const e = o(raw);
    if (e.missing !== undefined || !/^Q\d+$/.test(id)) continue;
    const labels = o(e.labels);
    const claims = o(e.claims);
    const values: WdItem["values"] = {};
    for (const p of PROPERTY_IDS) {
      const list = claims[p];
      if (!Array.isArray(list)) continue;
      const v = bestValue(list);
      if (v) values[p] = v;
    }
    const label = (lang: string): string | undefined => {
      const l = o(labels[lang]).value;
      return typeof l === "string" ? l : undefined;
    };
    const own = lang === "it" ? undefined : label(lang);
    out.set(id, { id, labelIt: label("it"), labelEn: label("en"), ...(own ? { label: own } : {}), values });
  }
  return out;
}

export async function fetchEntities(http: HttpClient, ids: string[], lang = "it"): Promise<{ items: Map<string, WdItem>; fetchedAt?: string }> {
  const items = new Map<string, WdItem>();
  let fetchedAt: string | undefined;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += MAX_IDS) {
    const r = await http.getJson(entitiesUrl(unique.slice(i, i + MAX_IDS), lang), slimEntities);
    fetchedAt ??= r.fetchedAt;
    for (const [k, v] of parseEntities(r.body, lang)) items.set(k, v);
  }
  return { items, fetchedAt };
}

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** Italian date: "24 agosto 410", "1947", "753 a.C.", "V secolo". */
export function formatTimeIt(t: WdTime): string {
  const abs = Math.abs(t.year);
  const era = t.year < 0 ? " a.C." : abs < 1000 ? " d.C." : "";
  if (t.precision === 7) {
    const c = Math.ceil(abs / 100);
    return `${toRoman(c)} secolo${t.year < 0 ? " a.C." : c < 10 ? " d.C." : ""}`;
  }
  if (t.precision === 8) return `anni ${Math.floor(abs / 10) * 10}${era}`;
  const parts = [t.day, t.month ? MONTHS[t.month - 1] : undefined, `${abs}${era}`].filter((x) => x !== undefined);
  return parts.join(" ");
}

function toRoman(n: number): string {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
