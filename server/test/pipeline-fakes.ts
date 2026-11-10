// Shared fakes for pipeline and http tests (not a test file itself).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SceneSpec, type PageAnalysis } from "@pv/scene-spec";
import sharp from "sharp";
import type { PipelineStages } from "../src/pipeline/run.ts";
import type { EnrichResult, GenerateInput, GeoContext } from "../src/pipeline/types.ts";

export const SCENE: SceneSpec = SceneSpec.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../fixtures/public/scenes/card-esempio.scene.json", import.meta.url)), "utf8")),
);

export const ANALYSIS: PageAnalysis = {
  readable: true,
  confidence: 0.9,
  language: "it",
  pages: { visible: 1, numbers: [84] },
  orientation: "upright",
  subject: "geografia",
  topic: "La Campania",
  contentType: "explanation",
  literary: { isLiterary: false },
  summary: "La Campania è una regione dell'Italia meridionale.",
  concepts: ["territorio"],
  entities: [{ name: "Vesuvio", type: "place", onPage: true }],
  claims: [{ text: "Il Vesuvio è un vulcano attivo.", kind: "fact", onPage: true }],
  exercises: [],
  illustrations: [],
  suggestedEngine: "map",
  engineReason: "Una regione.",
};

export const ENRICH: EnrichResult = {
  sources: [{ id: "page", kind: "page", title: "La Campania" }],
  facts: [],
  discrepancies: [],
  videos: [],
  stats: { requests: 0, cached: 0, durationMs: 1 },
};

export const GEO: GeoContext = {
  bbox: { lonMin: 13.7, lonMax: 15.8, latMin: 39.9, latMax: 41.6 },
  terrainAsset: "cache/geo/campania/terrain.bin",
  boundariesAsset: "cache/geo/campania/regions.geojson",
  focus: "Campania",
  neighbors: ["Lazio"],
  sources: [],
};

export async function syntheticPhoto(seed = 0): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: { r: (seed * 40) % 256, g: 90, b: 160 } } })
    .jpeg()
    .toBuffer();
}

export interface FakeStages extends PipelineStages {
  calls: { analyze: Buffer[]; enrich: number; geo: number; generate: GenerateInput[] };
}

export function fakeStages(over: Partial<PipelineStages> & { fallback?: boolean } = {}): FakeStages {
  const calls: FakeStages["calls"] = { analyze: [], enrich: 0, geo: 0, generate: [] };
  return {
    calls,
    analyze: async (img) => {
      calls.analyze.push(img);
      return over.analyze ? over.analyze(img) : ANALYSIS;
    },
    enrich: async (a) => {
      calls.enrich++;
      return over.enrich ? over.enrich(a) : ENRICH;
    },
    geo: async (a) => {
      calls.geo++;
      return over.geo ? over.geo(a) : GEO;
    },
    generate: async (input, hooks) => {
      calls.generate.push(input);
      if (over.generate) return over.generate(input, hooks);
      return { scene: SCENE, issues: [], fallback: over.fallback ?? false, repaired: false, durationMs: 1 };
    },
  };
}
