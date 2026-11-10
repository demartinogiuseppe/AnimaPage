// YouTube provider (YouTube Data API v3, API key server-side only). Verified 2026-11-03 in the
// official docs and the live discovery document (revision 20261102); see docs/m3/youtube.md.
//
// - search.list (GET youtube/v3/search): part=snippet, q, type=video, safeSearch=strict,
//   videoEmbeddable=true (requires type=video), relevanceLanguage=it, regionCode=IT,
//   maxResults 0..50. Quota: 1 unit in the separate search.list bucket (100 calls/day default).
// - videos.list (GET youtube/v3/videos): part=snippet,contentDetails,status, id=<comma list>.
//   Quota: 1 unit (10,000 units/day for the other endpoints).
// - Fields read: contentDetails.duration (ISO 8601), contentDetails.contentRating.ytRating
//   ("ytAgeRestricted"), contentDetails.regionRestriction.{allowed,blocked}, status.embeddable,
//   status.privacyStatus, status.license, snippet.liveBroadcastContent, snippet.defaultAudioLanguage,
//   snippet.defaultLanguage, snippet.channelId, snippet.channelTitle, snippet.title/description.
// Live/upcoming broadcasts are dropped through snippet.liveBroadcastContent (eventType would
// restrict the search to broadcasts only). The key travels only as a `secret` parameter of the
// HTTP client: recorded URLs, cache keys and errors never contain it. Embedding: youtube-nocookie.
import type { EnrichConfig } from "../config.ts";
import { buildUrl, type HttpClient } from "../http.ts";
import type { VideoCandidate, VideoProvider, VideoQuery } from "./types.ts";

export const YOUTUBE_API = "https://youtube.googleapis.com/youtube/v3";
export const SEARCH_QUOTA = 1;
export const VIDEOS_QUOTA = 1;

export function youtubeSearchUrl(q: string, cfg: EnrichConfig): string {
  const y = cfg.videos.youtube;
  return buildUrl(`${YOUTUBE_API}/search`, [
    ["part", "snippet"],
    ["q", q],
    ["type", "video"],
    ["safeSearch", "strict"],
    ["videoEmbeddable", "true"],
    ["relevanceLanguage", y.relevanceLanguage],
    // No region for a locale without one (D21).
    ...(y.regionCode ? [["regionCode", y.regionCode] as [string, string]] : []),
    ["maxResults", y.maxResults],
  ]);
}

export function youtubeVideosUrl(ids: string[]): string {
  return buildUrl(`${YOUTUBE_API}/videos`, [
    ["part", "snippet,contentDetails,status"],
    ["id", ids.join(",")],
  ]);
}

/** ISO 8601 duration ("PT15M33S", "PT1H2M", "P1DT2H") -> seconds. */
export function parseIsoDuration(d: string): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(d);
  if (!m || d === "P" || d === "PT") return undefined;
  const [, days, h, min, s] = m;
  return Number(days ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function parseSearchIds(body: unknown): string[] {
  const items = o(body).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => str(o(o(it).id).videoId))
    .filter((id): id is string => !!id && /^[\w-]{11}$/.test(id));
}

export function parseVideos(body: unknown, fetchedAt: string, cfg: EnrichConfig): VideoCandidate[] {
  const items = o(body).items;
  if (!Array.isArray(items)) return [];
  const y = cfg.videos.youtube;
  const preferred = new Set(y.channels.map((c) => c.id));
  return items.flatMap((raw): VideoCandidate[] => {
    const it = o(raw);
    const id = str(it.id);
    const sn = o(it.snippet);
    const cd = o(it.contentDetails);
    const st = o(it.status);
    if (!id || !/^[\w-]{11}$/.test(id)) return [];
    const rr = o(cd.regionRestriction);
    const region = y.regionCode;
    const regionBlocked =
      !!region &&
      ((Array.isArray(rr.blocked) && rr.blocked.includes(region)) || (Array.isArray(rr.allowed) && !rr.allowed.includes(region)));
    const channelId = str(sn.channelId) ?? "";
    return [
      {
        provider: "youtube",
        ref: id,
        title: str(sn.title) ?? id,
        description: (str(sn.description) ?? "").replace(/\s+/g, " ").slice(0, 400),
        categories: [],
        durationSec: typeof cd.duration === "string" ? parseIsoDuration(cd.duration) : undefined,
        license: st.license === "creativeCommon" ? "CC BY (YouTube)" : "Licenza standard YouTube (solo incorporamento)",
        author: str(sn.channelTitle),
        pageUrl: `https://www.youtube.com/watch?v=${id}`,
        fetchedAt,
        youtube: {
          channelId,
          preferredChannel: preferred.has(channelId),
          language: str(sn.defaultAudioLanguage) ?? str(sn.defaultLanguage),
          embeddable: st.embeddable === true,
          privacyStatus: str(st.privacyStatus),
          liveBroadcastContent: str(sn.liveBroadcastContent),
          ageRestricted: o(cd.contentRating).ytRating === "ytAgeRestricted",
          regionBlocked,
          license: str(st.license),
        },
      },
    ];
  });
}

export const youtubeProvider: VideoProvider = {
  name: "youtube",
  // Live needs the key; mock replays whatever was recorded (see enrich/index.ts).
  enabled: (cfg) => cfg.videos.youtube.setting !== false,
  async search(http: HttpClient, queries: VideoQuery[], cfg: EnrichConfig): Promise<VideoCandidate[]> {
    const y = cfg.videos.youtube;
    const secret = y.apiKey ? { key: y.apiKey } : undefined;
    const out: VideoCandidate[] = [];
    for (const q of queries.slice(0, y.maxQueries)) {
      const s = await http.getJson(youtubeSearchUrl(q.textIt, cfg), undefined, { secret, quotaCost: SEARCH_QUOTA });
      const ids = parseSearchIds(s.body).filter((id) => !out.some((c) => c.ref === id));
      if (ids.length === 0) continue;
      const v = await http.getJson(youtubeVideosUrl(ids), undefined, { secret, quotaCost: VIDEOS_QUOTA });
      out.push(...parseVideos(v.body, v.fetchedAt, cfg));
    }
    return out;
  },
};
