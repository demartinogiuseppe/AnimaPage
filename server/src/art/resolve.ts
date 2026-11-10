// Artwork resolver for the `art` engine (decision D14): Wikidata item -> facts + Commons file info,
// and a resized local copy of the image ONLY when the work is in the public domain.
//
// Requests (no key; parameters verified on the live APIs 2026-11-04):
// - it.wikipedia  action=query&prop=pageprops&titles=<title>&redirects=1  -> pageprops.wikibase_item
// - Wikidata      action=wbgetentities&ids=<Q>&props=labels|claims&languages=it|en
//                 (same API as enrich/wikidata.ts; claims P18 image, P170 creator, P571 inception with
//                 P580/P582 qualifiers, P195 collection, P276 location, P186 material, P2048/P2049
//                 height/width, P6216 copyright status, P180 depicts with P2677 relative position)
// - Commons       action=query&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=<w>
//                 (API:Imageinfo; extmetadata LicenseShortName, License, Copyrighted, Artist, UsageTerms).
//                 The thumbnail server may answer with a larger standard size than iiurlwidth (observed
//                 2026-11-04: 2048 -> a 3840 px file), so the copy is always resized here with sharp.
//
// Public-domain gate (both must hold, otherwise nothing is downloaded and the engine shows a
// placeholder with a link): Wikidata P6216 = Q19652 ("public domain") and the Commons file says
// Copyrighted = False or has a PD / CC0 licence.
//
// Modes: live = network (JSON through HttpClient with its disk cache and optional recording; image
// bytes recorded under fixtures/art/files/ when `record` is set); mock = recordings only, never the network.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Source } from "@pv/scene-spec";
import sharp from "sharp";
import { buildUrl, HttpError, type HttpClient } from "../enrich/http.ts";
import { stripHtml } from "../enrich/text.ts";
import { parseTime, WIKIDATA_API, WIKIDATA_LICENSE } from "../enrich/wikidata.ts";
import { wikipediaApi } from "../enrich/wikipedia.ts";
import type { Mode } from "../pipeline/types.ts";

export const ART_CACHE_DIR = fileURLToPath(new URL("../../.cache/art/", import.meta.url));
export const ART_FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/art/", import.meta.url));
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
export const ITWIKI_API = "https://it.wikipedia.org/w/api.php";
/** Wikidata item "public domain" (value of P6216 copyright status). */
export const PUBLIC_DOMAIN = "Q19652";
export const MAX_SIZE = 2048;
const META_KEYS = "LicenseShortName|License|Copyrighted|Artist|UsageTerms|AttributionRequired";

export interface ArtRegionHint {
  /** Wikidata item of the depicted thing (P180) and its Italian label. */
  wikidataId: string;
  name: string;
  /** Normalised [x, y, w, h] from P2677 "pct:x,y,w,h". */
  rect: [number, number, number, number];
}

export interface ResolvedArtwork {
  wikidataId: string;
  title: string;
  author?: string;
  /** "1494-1498" from P571 (+ P580/P582), or a single year. */
  date?: string;
  /** Where the work is now: the current collection (P195), else the current location (P276); one label. */
  location?: string;
  technique?: string;
  /** [width, height] in cm (P2049, P2048) when given in centimetres. */
  sizeCm?: [number, number];
  publicDomain: boolean;
  /** Why the gate said no (empty when public domain). */
  reasons: string[];
  /** Commons file name of P18, if any. */
  file?: string;
  /** Present only for public-domain works: served path and pixel size of the local copy. */
  image?: { asset: string; width: number; height: number; sourceId: string };
  /** Page to link when the image cannot be shown. */
  link: string;
  /** Regions of depicted figures with a relative position in the P18 image. */
  regions: ArtRegionHint[];
  sources: Source[];
}

export interface ResolveOptions {
  mode: Mode;
  http: HttpClient;
  userAgent: string;
  /** Where the resized copies go (default server/.cache/art/). */
  cacheDir?: string;
  /** Recorded image bytes (default fixtures/art/files/). */
  filesDir?: string;
  /** Save downloaded bytes into filesDir (live only). */
  record?: boolean;
  /** Thumbnail width asked to Commons and maximum side of the local copy (default 2048). */
  maxSize?: number;
  /** Binary GET (tests); default global fetch. */
  fetchBytes?: (url: string, headers: Record<string, string>) => Promise<ArrayBuffer>;
  /** Access date for the Sources (default: today). */
  today?: string;
  /** Wikipedia edition for title lookups and labels (wikipedia.ts wikiLang, D21); default "it". */
  lang?: string;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function pagepropsUrl(title: string, lang = "it"): string {
  return buildUrl(lang === "it" ? ITWIKI_API : wikipediaApi(lang), [
    ["action", "query"],
    ["format", "json"],
    ["formatversion", 2],
    ["prop", "pageprops"],
    ["titles", title],
    ["redirects", 1],
  ]);
}

export function entityUrl(ids: string[], props = "labels|claims", lang = "it"): string {
  return buildUrl(WIKIDATA_API, [
    ["action", "wbgetentities"],
    ["format", "json"],
    ["formatversion", 2],
    ["ids", ids.join("|")],
    ["props", props],
    ["languages", lang === "it" || lang === "en" ? "it|en" : `${lang}|it|en`],
  ]);
}

export function imageinfoUrl(file: string, width: number): string {
  return buildUrl(COMMONS_API, [
    ["action", "query"],
    ["format", "json"],
    ["formatversion", 2],
    ["titles", `File:${file}`],
    ["prop", "imageinfo"],
    ["iiprop", "url|size|mime|extmetadata"],
    ["iiurlwidth", width],
    ["iiextmetadatafilter", META_KEYS],
  ]);
}

const KEEP = ["P18", "P170", "P571", "P195", "P276", "P186", "P2048", "P2049", "P6216", "P180", "P31"];

/** Keeps labels and the claims we read (main value, rank and qualifiers): small recordings. */
export function slimArtEntity(body: unknown): unknown {
  const out: Obj = {};
  for (const [id, raw] of Object.entries(o(o(body).entities))) {
    const e = o(raw);
    const claims: Obj = {};
    for (const p of KEEP) {
      const list = arr(o(e.claims)[p]);
      if (list.length)
        claims[p] = list.map((c) => ({ rank: o(c).rank, mainsnak: { datavalue: o(o(c).mainsnak).datavalue }, qualifiers: o(c).qualifiers ?? {} }));
    }
    out[id] = { id: e.id ?? id, labels: e.labels ?? {}, claims };
  }
  return { entities: out };
}

/** Label in `lang` (the user's Wikipedia language, D21), else Italian, else English. */
const label = (e: Obj, lang = "it"): string | undefined => {
  const l = o(e.labels);
  const v = o(l[lang]).value ?? o(l.it).value ?? o(l.en).value;
  return typeof v === "string" ? v : undefined;
};
const claimsOf = (e: Obj, p: string) => arr(o(e.claims)[p]).filter((c) => o(c).rank !== "deprecated").map(o);
const valueOf = (c: Obj) => o(o(o(c).mainsnak).datavalue).value;
const itemIds = (e: Obj, p: string) => claimsOf(e, p).map((c) => o(valueOf(c)).id).filter((x): x is string => typeof x === "string");

/** "pct:x,y,w,h" (P2677) -> normalised rectangle, or null. */
export function parsePct(s: unknown): [number, number, number, number] | null {
  const m = typeof s === "string" ? /^pct:([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/.exec(s) : null;
  if (!m) return null;
  const v = m.slice(1).map((x) => Number(x) / 100) as [number, number, number, number];
  return v.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) && v[2] > 0 && v[3] > 0 ? v : null;
}

/** Commons extmetadata says the file is free of copyright (PD or CC0). */
export function commonsIsPublicDomain(meta: Obj): boolean {
  const m = (k: string) => stripHtml(String(o(meta[k]).value ?? "")).trim();
  if (m("Copyrighted").toLowerCase() === "false") return true;
  return /^(pd|cc0)\b/i.test(m("License")) || /public domain|cc0/i.test(m("LicenseShortName"));
}

function yearOf(v: unknown): number | undefined {
  return parseTime(v)?.year;
}

/**
 * The current value of a place property: statements with an end time (P582) are past ones; among the
 * rest, preferred rank first, then the latest start time (P580). Returns its label, or undefined.
 */
export function currentPlace(e: Obj, p: string, labels: ReadonlyMap<string, string>): string | undefined {
  const time = (c: Obj, q: string) => parseTime(o(o(arr(o(c.qualifiers)[q])[0]).datavalue).value);
  const key = (c: Obj) => {
    const t = time(c, "P580");
    return t ? t.year * 10_000 + (t.month ?? 0) * 100 + (t.day ?? 0) : -Infinity;
  };
  const best = claimsOf(e, p)
    .filter((c) => typeof o(valueOf(c)).id === "string" && !time(c, "P582"))
    .sort((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred") || key(b) - key(a))[0];
  const id = best ? (o(valueOf(best)).id as string) : undefined;
  return id ? labels.get(id) : undefined;
}

/** Item id for an Italian Wikipedia title (null if the page or its item does not exist). */
export async function wikidataIdForTitle(http: HttpClient, title: string, lang = "it"): Promise<string | null> {
  const r = await http.getJson(pagepropsUrl(title, lang));
  const page = o(arr(o(o(r.body).query).pages)[0]);
  const id = o(page.pageprops).wikibase_item;
  return typeof id === "string" && /^Q\d+$/.test(id) ? id : null;
}

async function getBytes(url: string, o2: ResolveOptions): Promise<Buffer> {
  const dir = o2.filesDir ?? join(ART_FIXTURES_DIR, "files");
  const key = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const rec = join(dir, `${key}.bin`);
  if (o2.mode === "mock") {
    if (!existsSync(rec)) throw new HttpError("fixture_missing", `No recorded file for ${url} (key ${key}).`);
    return readFileSync(rec);
  }
  const headers = { "User-Agent": o2.userAgent };
  const buf = o2.fetchBytes
    ? await o2.fetchBytes(url, headers)
    : await fetch(url, { headers }).then((res) => {
        if (!res.ok) throw new HttpError("http_status", `${url}: HTTP ${res.status}`);
        return res.arrayBuffer();
      });
  const out = Buffer.from(buf);
  if (o2.record) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(rec, out);
  }
  return out;
}

const safeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80);

/**
 * Resolves an artwork by Wikidata id ("Q128910") or Italian Wikipedia title. Never downloads a file
 * that fails the public-domain gate. Throws HttpError when a recording/network response is missing.
 */
export async function resolveArtwork(query: { wikidataId?: string; title?: string }, opts: ResolveOptions): Promise<ResolvedArtwork> {
  const http = opts.http;
  const lang = opts.lang ?? "it";
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const qid = query.wikidataId ?? (query.title ? await wikidataIdForTitle(http, query.title, lang) : null);
  if (!qid || !/^Q\d+$/.test(qid)) throw new Error(`artwork not found: ${query.title ?? query.wikidataId ?? "(empty query)"}`);

  const main = await http.getJson(entityUrl([qid], undefined, lang), slimArtEntity);
  const e = o(o(o(main.body).entities)[qid]);
  const linked = [...new Set([...itemIds(e, "P170"), ...itemIds(e, "P276"), ...itemIds(e, "P195"), ...itemIds(e, "P186"), ...itemIds(e, "P180")])];
  const labels = new Map<string, string>();
  for (let i = 0; i < linked.length; i += 50) {
    const r = await http.getJson(entityUrl(linked.slice(i, i + 50), "labels", lang));
    for (const [id, x] of Object.entries(o(o(r.body).entities))) {
      const l = label(o(x), lang);
      if (l) labels.set(id, l);
    }
  }
  const names = (p: string) => itemIds(e, p).map((id) => labels.get(id)).filter((x): x is string => !!x);

  const inception = claimsOf(e, "P571")[0];
  const qual = (p: string) => yearOf(o(o(arr(o(inception?.qualifiers)[p])[0]).datavalue).value);
  const from = qual("P580");
  const to = qual("P582");
  const date = from && to ? `${from}-${to}` : inception ? String(yearOf(valueOf(inception)) ?? "") || undefined : undefined;

  const cm = (p: string) => {
    const v = o(valueOf(claimsOf(e, p)[0] ?? {}));
    return typeof v.unit === "string" && v.unit.endsWith("/Q174728") ? Number(v.amount) : undefined; // Q174728 = centimetre
  };
  const w = cm("P2049");
  const h = cm("P2048");

  const status = itemIds(e, "P6216");
  const reasons: string[] = [];
  if (!status.includes(PUBLIC_DOMAIN)) reasons.push(status.length ? `Wikidata copyright status ${[...new Set(status)].join(", ")}` : "no copyright status on Wikidata");
  const p18 = claimsOf(e, "P18").map(valueOf).find((v): v is string => typeof v === "string");
  if (!p18) reasons.push("no image (P18)");

  const wdSource: Source = {
    id: `wd-${qid.toLowerCase()}`,
    kind: "wikidata",
    title: `${label(e, lang) ?? qid} (${qid})`,
    url: `https://www.wikidata.org/wiki/${qid}`,
    publisher: "Wikidata",
    accessed: (main.fetchedAt || today).slice(0, 10),
    wikidataId: qid,
    license: WIKIDATA_LICENSE,
  };
  const sources: Source[] = [wdSource];
  const link = `https://www.wikidata.org/wiki/${qid}`;

  let image: ResolvedArtwork["image"];
  if (p18) {
    const maxSize = opts.maxSize ?? MAX_SIZE;
    const info = await http.getJson(imageinfoUrl(p18, maxSize));
    const page = o(arr(o(o(info.body).query).pages)[0]);
    const ii = o(arr(page.imageinfo)[0]);
    const meta = o(ii.extmetadata);
    const pdFile = commonsIsPublicDomain(meta);
    if (!pdFile) reasons.push(`Commons licence ${stripHtml(String(o(meta.LicenseShortName).value ?? "unknown"))}`);
    const author = stripHtml(String(o(meta.Artist).value ?? "")).trim();
    const commonsSource: Source = {
      id: `commons-${qid.toLowerCase()}`,
      kind: "web",
      title: `${author ? `${author}, ` : ""}${label(e, lang) ?? qid} (File:${p18})`,
      url: typeof ii.descriptionurl === "string" ? ii.descriptionurl : `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(p18.replace(/ /g, "_"))}`,
      publisher: "Wikimedia Commons",
      accessed: (info.fetchedAt || today).slice(0, 10),
      license: stripHtml(String(o(meta.LicenseShortName).value ?? "")) || undefined,
    };
    sources.push(commonsSource);
    if (reasons.length === 0) {
      const url = typeof ii.thumburl === "string" ? ii.thumburl : typeof ii.url === "string" ? ii.url : null;
      if (!url) reasons.push("no file url on Commons");
      else {
        const bytes = await getBytes(url, opts);
        const dir = join(opts.cacheDir ?? ART_CACHE_DIR, qid);
        mkdirSync(dir, { recursive: true });
        const file = `${safeName(p18.replace(/\.[a-z0-9]+$/i, ""))}.jpg`;
        const out = await sharp(bytes)
          .rotate()
          .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 84, mozjpeg: true })
          .toFile(join(dir, file));
        image = { asset: `/cache/art/${qid}/${file}`, width: out.width, height: out.height, sourceId: commonsSource.id };
      }
    }
  }

  const regions: ArtRegionHint[] = claimsOf(e, "P180").flatMap((c) => {
    const id = o(valueOf(c)).id;
    const rect = parsePct(o(o(arr(o(c.qualifiers).P2677)[0]).datavalue).value);
    return typeof id === "string" && rect ? [{ wikidataId: id, name: labels.get(id) ?? id, rect }] : [];
  });

  return {
    wikidataId: qid,
    title: label(e, lang) ?? qid,
    author: names("P170").join(", ") || undefined,
    date,
    location: currentPlace(e, "P195", labels) ?? currentPlace(e, "P276", labels),
    technique: names("P186").join(", ") || undefined,
    sizeCm: w && h ? [w, h] : undefined,
    publicDomain: reasons.length === 0,
    reasons,
    file: p18,
    image,
    link,
    regions,
    sources,
  };
}
