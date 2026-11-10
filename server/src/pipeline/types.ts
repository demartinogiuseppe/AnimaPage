// Contract between the pipeline stages: analyze (M2) -> enrich + geo (M3) -> generate (M4) -> http.
// Each stage is implemented in its own folder behind these types.
import type { Issue, PageAnalysis, SceneSpec, Source, Video } from "@pv/scene-spec";
import type { ResolvedArtwork } from "../art/resolve.ts";

export type Mode = "live" | "mock";

/** A verified fact from an external source (Wikipedia, Wikidata...). */
export interface Fact {
  id: string;
  /** Short Italian statement, e.g. "Il Vesuvio è alto 1281 m". */
  text: string;
  /** Name of the PageAnalysis entity the fact is about. */
  entity?: string;
  /** Structured value for quantities and dates, used for cross-checks. */
  value?: string | number;
  unit?: string;
  wikidataId?: string;
  /** Wikidata property id, e.g. "P2044" (elevation). */
  property?: string;
  sourceId: string;
}

/** A number on the page that differs from the sources: shown with both values, never silently corrected. */
export interface Discrepancy {
  /** The claim as written on the page. */
  claim: string;
  bookValue: string;
  sourceValue: string;
  sourceId: string;
  /** E.g. "dato più recente". */
  note?: string;
}

export interface EnrichResult {
  /** Every source the facts and videos refer to, including the "page" source. */
  sources: Source[];
  facts: Fact[];
  discrepancies: Discrepancy[];
  /** Child-safe, relevant, embeddable only (decision D7: Wikimedia Commons first). */
  videos: Video[];
  stats: { requests: number; cached: number; durationMs: number };
}

/** Geodata prepared for a `map` scene; asset paths are relative to the web asset base. */
export interface GeoContext {
  bbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  terrainAsset: string;
  boundariesAsset: string;
  riversAsset?: string;
  /** Feature name of the subject area in the boundaries file, and its neighbours. */
  focus: string;
  neighbors: string[];
  /** Sources/licences of the geodata, to be cited in the scene. */
  sources: Source[];
}

export interface GenerateInput {
  analysis: PageAnalysis;
  enrich: EnrichResult;
  geo?: GeoContext;
  /** `art` pages: the artwork found by server/src/art/resolve.ts (image only when public domain). */
  art?: ResolvedArtwork;
  /**
   * Visual check (server/src/check): the scene it rejected and what to fix. Generation then starts
   * from the repair request (previous answer + problems) instead of the plain request.
   */
  feedback?: { previous: SceneSpec; problems: string[] };
  /** User's language (validated BCP-47, decision D21); undefined = Italian. */
  locale?: string;
}

export interface GenerateResult {
  scene: SceneSpec;
  /** Semantic issues left after the repair attempt (should be empty). */
  issues: Issue[];
  /** True when generation failed and the `card` fallback was produced. */
  fallback: boolean;
  repaired: boolean;
  durationMs: number;
}

export type PipelinePhase = "analyze" | "enrich" | "generate" | "check" | "done" | "error";

/** Progress for the app ("Leggo la pagina…", "Cerco fonti…", "Preparo la scena…"). */
export interface ProgressEvent {
  phase: PipelinePhase;
  /** Italian, user-facing. */
  message: string;
  /** Available early content, e.g. the analysis summary to read aloud while the scene is generated. */
  summary?: string;
  /** Language the summary is written in when not Italian (BCP-47): the app reads it with that voice (D21). */
  summaryLang?: string;
}

export type { Issue, PageAnalysis, SceneSpec, Source, Video };
