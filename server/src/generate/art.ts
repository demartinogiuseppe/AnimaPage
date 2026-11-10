// Artwork lookup for `art` pages (decision D14): PageAnalysis -> ResolvedArtwork before generation.
//
// The analysis gives the work and the artist as entities/topic, not a Wikipedia title, so this tries
// a few Italian Wikipedia title candidates ("Primavera (Botticelli)", "Ultima Cena (Leonardo)", the
// topic...) and keeps the first item whose creator matches the artist named on the page.
// Mock mode replays fixtures/art/ only (never the network); a miss returns undefined and the scene
// uses the placeholder frame.
import type { PageAnalysis } from "@pv/scene-spec";
import { resolveArtwork, ART_FIXTURES_DIR, type ResolvedArtwork } from "../art/resolve.ts";
import { loadConfig } from "../enrich/config.ts";
import { HttpClient } from "../enrich/http.ts";
import { wikiChain } from "../enrich/wikipedia.ts";
import type { Mode } from "../pipeline/types.ts";

const STOP = /^(il|lo|la|i|gli|le|l'|un|una|uno|di|del|della|dei|degli|delle)\s+/i;

/** Italian Wikipedia titles to try, most specific first. */
export function artTitleCandidates(a: PageAnalysis): string[] {
  const people = a.entities.filter((e) => e.type === "person").map((e) => e.name);
  const surnames = people.map((p) => p.split(/\s+/).pop()!).filter(Boolean);
  const works = [
    ...a.entities.filter((e) => e.type === "object" || e.type === "term" || e.type === "event").map((e) => e.name),
    a.topic.replace(/\s+di\s+[A-ZÀ-Ý][\p{L}' ]+$/u, ""),
  ];
  const out: string[] = [];
  const add = (t: string) => {
    const s = t.trim().replace(/^«|»$/g, "");
    if (s && !out.includes(s)) out.push(s);
  };
  for (const w of works) {
    const bare = w.replace(STOP, "");
    for (const s of surnames) add(`${bare} (${s})`);
  }
  for (const w of works) add(w.replace(STOP, ""));
  for (const w of works) add(w);
  add(a.topic);
  return out.slice(0, 12);
}

export interface ArtLookupOptions {
  mode: Mode;
  /** Live only: record the JSON responses and image bytes into fixtures/art/. */
  record?: boolean;
  http?: HttpClient;
  /** User's language (D21): titles are tried on its Wikipedia, then en, then it. */
  locale?: string;
}

export async function resolveArtForAnalysis(a: PageAnalysis, opts: ArtLookupOptions): Promise<ResolvedArtwork | undefined> {
  const cfg = loadConfig();
  const http =
    opts.http ??
    new HttpClient({
      mode: opts.mode,
      fixturesDir: `${ART_FIXTURES_DIR}http`,
      record: opts.mode === "live" && !!opts.record,
      userAgent: cfg.userAgent,
      requestsPerMinute: cfg.requestsPerMinute,
      cacheTtlDays: cfg.cacheTtlDays,
    });
  const surnames = a.entities.filter((e) => e.type === "person").map((e) => e.name.split(/\s+/).pop()!.toLowerCase());
  for (const lang of wikiChain(opts.locale))
    for (const title of artTitleCandidates(a)) {
      try {
        const art = await resolveArtwork({ title }, { mode: opts.mode, http, userAgent: cfg.userAgent, record: opts.record, ...(lang === "it" ? {} : { lang }) });
        const author = (art.author ?? "").toLowerCase();
        if (surnames.length === 0 || surnames.some((s) => author.includes(s))) return art;
      } catch {
        // not found / not recorded: try the next title
      }
    }
  return undefined;
}

/** Prompt section with the resolver's answer (the only image the scene may use). */
export function artSection(art: ResolvedArtwork | undefined): string {
  if (!art)
    return "ARTWORK RESOLVER: the work was not found on Wikidata. Do NOT set artwork.image: the engine shows the placeholder frame; give artwork.link only if a SOURCES url is about this work.";
  const lines = [
    "ARTWORK RESOLVER (Wikidata + Commons; copy these values)",
    `wikidataId: ${art.wikidataId} | title: ${art.title}${art.author ? ` | author: ${art.author}` : ""}${art.date ? ` | date: ${art.date}` : ""}${art.technique ? ` | technique: ${art.technique}` : ""}${art.location ? ` | location: ${art.location}` : ""}${art.sizeCm ? ` | sizeCm: [${art.sizeCm.join(", ")}]` : ""}`,
    art.publicDomain && art.image
      ? `PUBLIC DOMAIN: artwork.image = ${JSON.stringify(art.image)} (exactly these values).`
      : `NOT public domain or no image (${art.reasons.join("; ") || "no image"}): do NOT set artwork.image; set artwork.link = "${art.link}".`,
    art.regions.length
      ? `regions from Wikidata "depicts" (rect [x, y, w, h], y down; cite ${art.sources[0]?.id}): ${art.regions.map((r) => `${r.name} [${r.rect.map((v) => v.toFixed(3)).join(", ")}]`).join("; ")}`
      : "regions: none from Wikidata (draw generous rectangles yourself, without sourceIds).",
  ];
  return lines.join("\n");
}
