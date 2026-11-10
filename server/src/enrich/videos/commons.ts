// Wikimedia Commons video search (no key), embed-only.
//
// generator=search in the File namespace (6) with the CirrusSearch keyword
// `filetype:video` (Help:CirrusSearch, "File properties search"), plus prop=imageinfo with
// iiprop=size|mime|mediatype|url|extmetadata (API:Imageinfo). For audio/video files
// `iiprop=size` also returns `duration` in seconds (observed on the live API 2026-11-03;
// the doc page only mentions page count). extmetadata is filtered to the keys we read.
import type { EnrichConfig } from "../config.ts";
import { buildUrl, type HttpClient } from "../http.ts";
import { stripHtml } from "../text.ts";
import type { VideoCandidate, VideoProvider, VideoQuery } from "./types.ts";

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const META_KEYS = "ObjectName|ImageDescription|Categories|LicenseShortName|Artist|Restrictions";

export function commonsSearchUrl(text: string, limit: number): string {
  return buildUrl(COMMONS_API, [
    ["action", "query"],
    ["format", "json"],
    ["formatversion", 2],
    ["generator", "search"],
    ["gsrsearch", `${text} filetype:video`],
    ["gsrnamespace", 6],
    ["gsrlimit", limit],
    ["prop", "imageinfo"],
    ["iiprop", "size|mime|mediatype|url|extmetadata"],
    ["iiextmetadatafilter", META_KEYS],
    ["iiextmetadatalanguage", "it"],
  ]);
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const meta = (m: Obj, k: string): string => {
  const v = o(m[k]).value;
  return typeof v === "string" ? v : "";
};

export function parseCommons(body: unknown, fetchedAt: string): VideoCandidate[] {
  const pages = o(o(body).query).pages;
  if (!Array.isArray(pages)) return [];
  return [...pages]
    .sort((a, b) => Number(o(a).index ?? 0) - Number(o(b).index ?? 0))
    .flatMap((p): VideoCandidate[] => {
      const page = o(p);
      const info = o(Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined);
      const title = typeof page.title === "string" ? page.title : "";
      if (!title.startsWith("File:") || typeof info.descriptionurl !== "string") return [];
      const m = o(info.extmetadata);
      const name = stripHtml(meta(m, "ObjectName")) || title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
      return [
        {
          provider: "commons",
          ref: title,
          title: name,
          description: stripHtml(meta(m, "ImageDescription")).slice(0, 400),
          categories: meta(m, "Categories").split("|").map((c) => c.trim()).filter(Boolean),
          durationSec: typeof info.duration === "number" ? info.duration : undefined,
          license: stripHtml(meta(m, "LicenseShortName")) || undefined,
          author: stripHtml(meta(m, "Artist")).slice(0, 120) || undefined,
          pageUrl: info.descriptionurl,
          mediaType: typeof info.mediatype === "string" ? info.mediatype : undefined,
          mime: typeof info.mime === "string" ? info.mime : undefined,
          fetchedAt,
        },
      ];
    });
}

export const commonsProvider: VideoProvider = {
  name: "commons",
  enabled: (cfg) => cfg.videos.commons.enabled,
  async search(http: HttpClient, queries: VideoQuery[], cfg: EnrichConfig): Promise<VideoCandidate[]> {
    const out: VideoCandidate[] = [];
    const seen = new Set<string>();
    for (const q of queries.slice(0, cfg.videos.commons.maxQueries)) {
      const r = await http.getJson(commonsSearchUrl(q.text, cfg.videos.commons.resultsPerQuery));
      for (const c of parseCommons(r.body, r.fetchedAt)) {
        if (!seen.has(c.ref)) {
          seen.add(c.ref);
          out.push(c);
        }
      }
    }
    return out;
  },
};
