// Enrichment configuration: server/config/sources.yaml + video_channels.yaml.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const CONFIG_DIR = fileURLToPath(new URL("../../config/", import.meta.url));

export interface EnrichConfig {
  maxLookups: number;
  maxSearches: number;
  maxFacts: number;
  cacheTtlDays: number;
  judgeModel: string;
  userAgent: string;
  requestsPerMinute: number;
  videos: {
    maxVideos: number;
    maxDurationSec: number;
    minDurationSec: number;
    minRelevance: number;
    maxCandidates: number;
    commons: { enabled: boolean; maxQueries: number; resultsPerQuery: number; licenses: string[]; preferredCategories: string[] };
    youtube: YoutubeConfig;
    blockedTerms: string[];
  };
}

export interface YoutubeChannel {
  id: string;
  name: string;
}

export interface YoutubeConfig {
  /** "auto": on when YOUTUBE_API_KEY is set (live) / when recordings exist (mock); false: always off. */
  setting: "auto" | false;
  /** Server-side only; never logged, recorded or put in a recorded URL. */
  apiKey?: string;
  maxQueries: number;
  maxResults: number;
  safeSearch: string;
  regionCode: string;
  relevanceLanguage: string;
  channels: YoutubeChannel[];
  /** true: only videos from the listed channels; false: listed channels are preferred. */
  allowlistOnly: boolean;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseConfig(sourcesYaml: string, channelsYaml: string, env: Record<string, string | undefined> = {}): EnrichConfig {
  const s = obj(parse(sourcesYaml));
  const c = obj(parse(channelsYaml));
  const e = obj(s.enrich);
  const h = obj(s.http);
  const v = obj(s.videos);
  const vc = obj(v.commons);
  const yt = obj(v.youtube);
  const contact = env.PAGINAVIVA_HTTP_CONTACT?.trim();
  const ua = typeof h.user_agent === "string" ? h.user_agent : "animapage/0.1 (private educational prototype)";
  return {
    maxLookups: num(e.max_lookups, 12),
    maxSearches: num(e.max_searches, 4),
    maxFacts: num(e.max_facts, 40),
    cacheTtlDays: num(e.cache_ttl_days, 30),
    judgeModel: env.PAGINAVIVA_ENRICH_MODEL || (typeof e.judge_model === "string" ? e.judge_model : "sonnet"),
    // The contact goes inside the parentheses, as in the User-Agent policy's example.
    userAgent: contact ? ua.replace(/\)\s*$/, `; ${contact})`) : ua,
    requestsPerMinute: contact ? num(h.requests_per_minute_with_contact, 150) : num(h.requests_per_minute, 9),
    videos: {
      maxVideos: num(v.max_videos, 3),
      maxDurationSec: num(v.max_duration_minutes, 10) * 60,
      minDurationSec: num(v.min_duration_seconds, 10),
      minRelevance: num(v.min_relevance, 0.6),
      maxCandidates: num(v.max_candidates, 8),
      commons: {
        enabled: v.wikimedia_commons !== false,
        maxQueries: num(vc.max_queries, 2),
        resultsPerQuery: num(vc.results_per_query, 10),
        licenses: strs(obj(c.commons).licenses),
        preferredCategories: strs(obj(c.commons).preferred_categories),
      },
      youtube: {
        setting: yt.enabled === false ? false : "auto",
        apiKey: env.YOUTUBE_API_KEY?.trim() || undefined,
        maxQueries: num(yt.max_queries, 1),
        maxResults: num(yt.max_results, 10),
        safeSearch: "strict", // mandatory (brief §4.5): not configurable
        regionCode: typeof yt.region_code === "string" ? yt.region_code : "IT",
        relevanceLanguage: typeof yt.relevance_language === "string" ? yt.relevance_language : "it",
        channels: (Array.isArray(obj(c.youtube).channels) ? (obj(c.youtube).channels as unknown[]) : [])
          .map((x) => obj(x))
          .filter((x) => typeof x.id === "string" && /^UC[\w-]{22}$/.test(x.id) && typeof x.name === "string")
          .map((x) => ({ id: x.id as string, name: x.name as string })),
        allowlistOnly: obj(c.youtube).allowlist_only === true,
      },
      blockedTerms: strs(c.blocked_terms),
    },
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env, dir = CONFIG_DIR): EnrichConfig {
  return parseConfig(readFileSync(`${dir}sources.yaml`, "utf8"), readFileSync(`${dir}video_channels.yaml`, "utf8"), env);
}
