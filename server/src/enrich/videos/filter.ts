// Cheap, deterministic video pre-filter, applied before the LLM judgement.
// Fails closed: anything not clearly allowed is dropped.
import type { EnrichConfig } from "../config.ts";
import { fold, overlap } from "../text.ts";
import type { VideoCandidate } from "./types.ts";

export type RejectReason =
  | "not_video"
  | "duration"
  | "license"
  | "blocked_term"
  | "off_topic"
  | "not_embeddable"
  | "not_public"
  | "live"
  | "age_restricted"
  | "region"
  | "channel";

/** YouTube status checks; undefined = fine. */
function youtubeReject(c: VideoCandidate, cfg: EnrichConfig): RejectReason | undefined {
  const y = c.youtube;
  if (!y) return "not_video";
  if (!y.embeddable) return "not_embeddable";
  if (y.privacyStatus !== "public") return "not_public";
  if (y.liveBroadcastContent !== "none") return "live";
  if (y.ageRestricted) return "age_restricted";
  if (y.regionBlocked) return "region";
  if (cfg.videos.youtube.allowlistOnly && !y.preferredChannel) return "channel";
  return undefined;
}

export interface Prefiltered {
  kept: { c: VideoCandidate; score: number }[];
  rejected: { ref: string; reason: RejectReason; detail?: string }[];
}

export function blockedTerm(text: string, terms: string[]): string | undefined {
  const t = fold(text);
  for (const term of terms) {
    const w = fold(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`(^|[^a-z])${w}[a-z]{0,3}(?![a-z])`).test(t)) return term;
  }
  return undefined;
}

export function licenseAllowed(license: string | undefined, allowed: string[]): boolean {
  if (!license) return false;
  const l = fold(license).trim();
  if (/\b(nc|nd)\b|non-?commercial|no-?deriv/.test(l)) return false;
  return allowed.some((a) => l.startsWith(fold(a)));
}

export function prefilter(cands: VideoCandidate[], keywords: Set<string>, cfg: EnrichConfig): Prefiltered {
  const v = cfg.videos;
  const out: Prefiltered = { kept: [], rejected: [] };
  for (const c of cands) {
    const isVideo = c.mediaType === "VIDEO" || /^video\//.test(c.mime ?? "") || c.provider === "youtube";
    if (!isVideo) {
      out.rejected.push({ ref: c.ref, reason: "not_video" });
      continue;
    }
    if (c.durationSec === undefined || c.durationSec < v.minDurationSec || c.durationSec > v.maxDurationSec) {
      out.rejected.push({ ref: c.ref, reason: "duration", detail: String(c.durationSec) });
      continue;
    }
    const yt = c.provider === "youtube" ? youtubeReject(c, cfg) : undefined;
    if (yt) {
      out.rejected.push({ ref: c.ref, reason: yt });
      continue;
    }
    if (c.provider === "commons" && !licenseAllowed(c.license, v.commons.licenses)) {
      out.rejected.push({ ref: c.ref, reason: "license", detail: c.license });
      continue;
    }
    const text = [c.ref, c.title, c.description, ...c.categories].join(" \n ");
    const bad = blockedTerm(text, v.blockedTerms);
    if (bad) {
      out.rejected.push({ ref: c.ref, reason: "blocked_term", detail: bad });
      continue;
    }
    const rel = overlap([c.ref, c.title, c.description, ...c.categories].join(" "), keywords);
    if (rel === 0) {
      out.rejected.push({ ref: c.ref, reason: "off_topic" });
      continue;
    }
    const cats = fold(c.categories.join("|"));
    const bonus = v.commons.preferredCategories.some((p) => cats.includes(fold(p))) || c.youtube?.preferredChannel ? 1 : 0;
    out.kept.push({ c, score: rel + bonus });
  }
  out.kept.sort((a, b) => b.score - a.score);
  return out;
}
