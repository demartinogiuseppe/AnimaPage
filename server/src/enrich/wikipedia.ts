// <lang>.wikipedia through the MediaWiki Action API (no key): it.wikipedia for Italian lessons; for
// another user language its own Wikipedia, then en and it for the titles it lacks (decision D21).
//
// One batched request resolves the page entities by exact title (redirects followed) and
// returns lead extracts + Wikidata ids; entities without a usable exact title get one
// full-text search each (generator=search, same props). Parameters verified 2026-11-03:
// API:Search, Extension:TextExtracts (exlimit <= 20, several extracts only with exintro),
// API:Etiquette (serial requests, batch titles with "|"). See docs/m3/report-2026-11-03.md.
import { baseLang, isItalian } from "@pv/scene-spec/i18n";
import { buildUrl, type HttpClient } from "./http.ts";

export const WIKIPEDIA_API = "https://it.wikipedia.org/w/api.php";

/** Wikipedia language edition of a locale ("en-GB" -> "en", "nb" -> "no"); Italian by default. */
export function wikiLang(locale?: string): string {
  if (isItalian(locale)) return "it";
  const b = baseLang(locale!);
  return ({ nb: "no", fil: "tl" } as Record<string, string>)[b] ?? b;
}

/** Action API of one Wikipedia edition (only a validated [a-z]{2,3} code reaches the host name). */
export function wikipediaApi(lang = "it"): string {
  return /^[a-z]{2,3}$/.test(lang) ? `https://${lang}.wikipedia.org/w/api.php` : WIKIPEDIA_API;
}

/** Editions to try for a locale: its own, then English, then Italian (Italian alone for Italian lessons). */
export function wikiChain(locale?: string): string[] {
  return [...new Set([wikiLang(locale), "en", "it"])].slice(0, isItalian(locale) ? 1 : 3);
}
export const WIKIPEDIA_LICENSE = "CC BY-SA 4.0";
const MAX_TITLES = 20;

export interface WpArticle {
  title: string;
  url: string;
  /** Plain-text lead section. */
  extract: string;
  wikibaseItem?: string;
  disambiguation: boolean;
  fetchedAt: string;
  /** Wikipedia edition ("it" when absent). */
  lang?: string;
}

const COMMON_PARAMS: [string, string | number][] = [
  ["action", "query"],
  ["format", "json"],
  ["formatversion", 2],
  ["redirects", 1],
  ["prop", "extracts|pageprops|info"],
  ["exintro", 1],
  ["explaintext", 1],
  ["exlimit", MAX_TITLES],
  ["ppprop", "wikibase_item|disambiguation"],
  ["inprop", "url"],
];

export function titlesUrl(titles: string[], lang = "it"): string {
  return buildUrl(wikipediaApi(lang), [...COMMON_PARAMS, ["titles", titles.join("|")]]);
}

export function searchUrl(query: string, limit = 4, lang = "it"): string {
  return buildUrl(wikipediaApi(lang), [
    ...COMMON_PARAMS,
    ["generator", "search"],
    ["gsrsearch", query],
    ["gsrnamespace", 0],
    ["gsrlimit", limit],
  ]);
}

interface RawPage {
  title?: string;
  missing?: boolean;
  invalid?: boolean;
  index?: number;
  extract?: string;
  fullurl?: string;
  pageprops?: { wikibase_item?: string; disambiguation?: string };
}
interface RawQuery {
  query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: RawPage[] };
}

function toArticle(p: RawPage, fetchedAt: string): WpArticle | undefined {
  if (p.missing || p.invalid || !p.title || !p.fullurl) return undefined;
  return {
    title: p.title,
    url: p.fullurl,
    extract: p.extract ?? "",
    wikibaseItem: p.pageprops?.wikibase_item && /^Q\d+$/.test(p.pageprops.wikibase_item) ? p.pageprops.wikibase_item : undefined,
    disambiguation: p.pageprops?.disambiguation !== undefined,
    fetchedAt,
  };
}

/** Maps each requested title to its article (after normalisation and redirects). */
export function parseTitles(body: unknown, requested: string[], fetchedAt: string): Map<string, WpArticle> {
  const q = (body as RawQuery).query ?? {};
  const hop = new Map<string, string>();
  for (const n of q.normalized ?? []) hop.set(n.from, n.to);
  for (const r of q.redirects ?? []) hop.set(r.from, r.to);
  const byTitle = new Map<string, WpArticle>();
  for (const p of q.pages ?? []) {
    const a = toArticle(p, fetchedAt);
    if (a) byTitle.set(a.title, a);
  }
  const out = new Map<string, WpArticle>();
  for (const t of requested) {
    let cur = t;
    for (let i = 0; i < 4 && hop.has(cur); i++) cur = hop.get(cur)!;
    const a = byTitle.get(cur);
    if (a) out.set(t, a);
  }
  return out;
}

/** Search results in rank order. */
export function parseSearch(body: unknown, fetchedAt: string): WpArticle[] {
  const pages = [...((body as RawQuery).query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map((p) => toArticle(p, fetchedAt)).filter((a): a is WpArticle => a !== undefined);
}

const tag = (a: WpArticle, lang: string): WpArticle => (lang === "it" ? a : { ...a, lang });

/** Exact titles, edition by edition along wikiChain(locale): each next edition gets only the missing titles. */
export async function fetchTitles(http: HttpClient, titles: string[], locale?: string): Promise<Map<string, WpArticle>> {
  const out = new Map<string, WpArticle>();
  for (const lang of wikiChain(locale)) {
    const todo = titles.filter((t) => !out.has(t));
    for (let i = 0; i < todo.length; i += MAX_TITLES) {
      const chunk = todo.slice(i, i + MAX_TITLES);
      const r = await http.getJson(titlesUrl(chunk, lang));
      for (const [k, v] of parseTitles(r.body, chunk, r.fetchedAt)) out.set(k, tag(v, lang));
    }
  }
  return out;
}

/** Full-text search in the first edition of wikiChain(locale) that finds something. */
export async function search(http: HttpClient, query: string, limit = 4, locale?: string): Promise<WpArticle[]> {
  for (const lang of wikiChain(locale)) {
    const r = await http.getJson(searchUrl(query, limit, lang));
    const found = parseSearch(r.body, r.fetchedAt).map((a) => tag(a, lang));
    if (found.length) return found;
  }
  return [];
}

const NUM = String.raw`(\d{1,3}(?:[ .  ]\d{3})+|\d+)(?:,(\d+))?`;

function toNumber(intPart: string, dec?: string): number {
  return Number(intPart.replace(/[ .  ]/g, "") + (dec ? `.${dec}` : ""));
}

/** Numbers stated in a Wikipedia lead ("Con 5 561 912 abitanti", "13 670,95 km²", "1 281 m s.l.m."). */
export function leadNumbers(extract: string): { population?: number; area?: number; elevation?: number } {
  const text = extract.replace(/\n/g, " ");
  const pick = (re: RegExp): number | undefined => {
    const m = re.exec(text);
    return m ? toNumber(m[1]!, m[2]) : undefined;
  };
  return {
    population: pick(new RegExp(`${NUM}\\s+abitanti`)),
    area: pick(new RegExp(`${NUM}\\s*km(?:²|2|q)`)),
    elevation: pick(new RegExp(`${NUM}\\s*m\\s*s\\.\\s*l\\.\\s*m\\.`)),
  };
}
