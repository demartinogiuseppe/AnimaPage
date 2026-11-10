// Video providers (decision D7: Wikimedia Commons now, YouTube later behind the same interface).
import type { EnrichConfig } from "../config.ts";
import type { HttpClient } from "../http.ts";

/** A video found by a provider, before the safety/relevance filters. */
export interface VideoCandidate {
  provider: "commons" | "youtube";
  /** Commons file name ("File:....webm") or YouTube video id. */
  ref: string;
  title: string;
  /** Plain text. */
  description: string;
  categories: string[];
  durationSec?: number;
  license?: string;
  author?: string;
  /** Description page (Commons) or watch page. */
  pageUrl: string;
  mediaType?: string;
  mime?: string;
  fetchedAt: string;
  /** YouTube only. */
  youtube?: {
    channelId: string;
    /** Listed in video_channels.yaml. */
    preferredChannel: boolean;
    /** snippet.defaultAudioLanguage, else snippet.defaultLanguage. */
    language?: string;
    embeddable: boolean;
    privacyStatus?: string;
    /** snippet.liveBroadcastContent ("none" | "live" | "upcoming"). */
    liveBroadcastContent?: string;
    ageRestricted: boolean;
    /** Blocked (or not allowed) in the configured region. */
    regionBlocked: boolean;
    /** status.license: "youtube" | "creativeCommon". */
    license?: string;
  };
}

export interface VideoQuery {
  /** Search terms for Commons (English labels work best there). */
  text: string;
  /** Italian search terms (YouTube with relevanceLanguage=it). */
  textIt: string;
}

export interface VideoProvider {
  readonly name: "commons" | "youtube";
  enabled(cfg: EnrichConfig): boolean;
  search(http: HttpClient, queries: VideoQuery[], cfg: EnrichConfig): Promise<VideoCandidate[]>;
}
