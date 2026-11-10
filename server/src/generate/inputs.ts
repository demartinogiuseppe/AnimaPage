// Loads the generation inputs of a dataset page (fixtures/pages/<label>.jpg) for the
// generate CLI and tools/eval:
// - analysis: replayed from the recordings in fixtures/llm/ (MockProvider) unless a live provider is given;
//   pages without a photo use a saved analysis, fixtures/analyses/<label>.analysis.json;
// - enrichment: fixtures/enrich/<label>.json (EnrichResult written by the enrichment step), else
//   fixtures/llm/generate/enrich/<label>.json (enrichment run for generation), otherwise only the page source;
// - geo (map pages): geoContextFor() in mock mode (pre-built fixtures/public/geo/<key>/), otherwise
//   built from the geo folder whose name appears in the topic (terrain.json, regions.geojson, rivers.geojson).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SOURCE_ID, PageAnalysis, type Source } from "@pv/scene-spec";
import { analyzePage, type AnalyzeResult } from "../analyze/index.ts";
import { geoContextFor } from "../geo/context.ts";
import { MockProvider } from "../llm/mock.ts";
import type { LlmProvider } from "../llm/types.ts";
import type { EnrichResult, GenerateInput, GeoContext, Mode } from "../pipeline/types.ts";
import { resolveArtForAnalysis } from "./art.ts";
import { ASSET_BASE_DIR, chooseEngine } from "./prompt.ts";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
export const PAGES_DIR = join(FIXTURES, "pages");
export const ENRICH_DIR = join(FIXTURES, "enrich");
export const GENERATE_ENRICH_DIR = join(FIXTURES, "llm", "generate", "enrich");
export const ANALYSES_DIR = join(FIXTURES, "analyses");
export const GEO_DIR = join(ASSET_BASE_DIR, "geo");

export function pagePhoto(label: string): string {
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const f = join(PAGES_DIR, `${label}${ext}`);
    if (existsSync(f)) return f;
  }
  throw new Error(`No photo for page "${label}" in ${PAGES_DIR}`);
}

export async function loadAnalysis(label: string, provider: LlmProvider = new MockProvider()): Promise<AnalyzeResult> {
  const saved = join(ANALYSES_DIR, `${label}.analysis.json`);
  if (existsSync(saved) && !existsSync(join(PAGES_DIR, `${label}.jpg`))) {
    const raw = JSON.parse(readFileSync(saved, "utf8")) as { analysis?: unknown; model?: string };
    const analysis = PageAnalysis.parse(raw.analysis ?? raw);
    const ledger = { time: new Date().toISOString(), kind: "analyze" as const, model: raw.model, phasesMs: {}, cached: true, validation: "cached" as const };
    return { analysis, validation: "cached", imageSha256: "", ledger };
  }
  return analyzePage(pagePhoto(label), { provider, cacheDir: null, ledgerPath: null });
}

export function minimalEnrich(analysis: PageAnalysis): EnrichResult {
  const pages = analysis.pages.numbers.length ? `, p. ${analysis.pages.numbers.join("-")}` : "";
  return {
    sources: [{ id: PAGE_SOURCE_ID, kind: "page", title: `Pagina del libro${pages}: ${analysis.topic}` }],
    facts: [],
    discrepancies: [],
    videos: [],
    stats: { requests: 0, cached: 0, durationMs: 0 },
  };
}

export interface LoadedEnrich {
  enrich: EnrichResult;
  /** "file" = fixtures/enrich/<label>.json, "minimal" = page source only. */
  origin: "file" | "minimal";
}

export function loadEnrich(label: string, analysis: PageAnalysis, dirs = [ENRICH_DIR, GENERATE_ENRICH_DIR]): LoadedEnrich {
  const file = dirs.map((d) => join(d, `${label}.json`)).find((f) => existsSync(f));
  if (!file) return { enrich: minimalEnrich(analysis), origin: "minimal" };
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<EnrichResult> & { result?: EnrichResult };
  const e = (raw.result ?? raw) as EnrichResult;
  const sources = e.sources ?? [];
  const page = minimalEnrich(analysis).sources[0]!;
  return {
    enrich: {
      sources: sources.some((s) => s.id === PAGE_SOURCE_ID) ? sources : [page, ...sources],
      facts: e.facts ?? [],
      discrepancies: e.discrepancies ?? [],
      videos: e.videos ?? [],
      stats: e.stats ?? { requests: 0, cached: 0, durationMs: 0 },
    },
    origin: "file",
  };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Geo context for a map page from the prepared folders in fixtures/public/geo/. */
export function loadGeo(analysis: PageAnalysis, dir = GEO_DIR): GeoContext | undefined {
  if (!existsSync(dir)) return undefined;
  const topic = norm(`${analysis.topic} ${analysis.summary}`);
  const key = readdirSync(dir).find((k) => topic.includes(norm(k).replace(/[-_]/g, " ")));
  if (!key) return undefined;
  const folder = join(dir, key);

  const terrain = JSON.parse(readFileSync(join(folder, "terrain.json"), "utf8")) as { bbox: GeoContext["bbox"]; attribution?: string };
  const regionsFile = join(folder, "regions.geojson");
  if (!existsSync(regionsFile)) return undefined;
  const regions = JSON.parse(readFileSync(regionsFile, "utf8")) as { attribution?: string; features: { properties: { name: string } }[] };
  const names = regions.features.map((f) => f.properties.name);
  const focus = names.find((n) => norm(n) === norm(key)) ?? names.find((n) => topic.includes(norm(n)));
  if (!focus) return undefined;
  const hasRivers = existsSync(join(folder, "rivers.geojson"));
  const urlIn = (s: string | undefined, dflt: string) => {
    const m = s?.match(/(?:https?:\/\/)?((?:github\.com|www\.openstreetmap\.org)\/[^\s;,]*[^\s;,.])/);
    return m ? `https://${m[1]}` : dflt;
  };
  const sources: Source[] = [];
  if (regions.attribution)
    sources.push({ id: "geo-boundaries", kind: "dataset", title: regions.attribution.slice(0, 160), url: urlIn(regions.attribution, "https://www.istat.it/") });
  if (terrain.attribution) sources.push({ id: "geo-terrain", kind: "dataset", title: "Terrain Tiles (AWS Open Data)", url: "https://registry.opendata.aws/terrain-tiles/" });
  if (hasRivers) {
    const rivers = JSON.parse(readFileSync(join(folder, "rivers.geojson"), "utf8")) as { attribution?: string };
    sources.push({ id: "geo-rivers", kind: "dataset", title: (rivers.attribution ?? "Fiumi: © OpenStreetMap contributors (ODbL)").slice(0, 160), url: "https://www.openstreetmap.org/copyright" });
  }
  return {
    bbox: terrain.bbox,
    terrainAsset: `geo/${key}/terrain.json`,
    boundariesAsset: `geo/${key}/regions.geojson`,
    ...(hasRivers ? { riversAsset: `geo/${key}/rivers.geojson` } : {}),
    focus,
    neighbors: names.filter((n) => n !== focus),
    sources,
  };
}

export interface PageInputs {
  label: string;
  analysis: AnalyzeResult;
  input: GenerateInput;
  enrichOrigin: LoadedEnrich["origin"];
}

export async function loadPageInputs(label: string, analysisProvider?: LlmProvider, artMode: Mode = "mock"): Promise<PageInputs> {
  const analysis = await loadAnalysis(label, analysisProvider);
  const { enrich, origin } = loadEnrich(label, analysis.analysis);
  let geo: GeoContext | undefined;
  if (analysis.analysis.suggestedEngine === "map") {
    try {
      geo = await geoContextFor(analysis.analysis, { mode: "mock" });
    } catch {
      geo = undefined;
    }
    geo ??= loadGeo(analysis.analysis);
  }
  const art =
    chooseEngine(analysis.analysis, geo).engine === "art"
      ? await resolveArtForAnalysis(analysis.analysis, { mode: artMode, record: artMode === "live" })
      : undefined;
  return { label, analysis, input: { analysis: analysis.analysis, enrich, ...(geo ? { geo } : {}), ...(art ? { art } : {}) }, enrichOrigin: origin };
}
