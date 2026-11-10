// On-demand geodata for map scenes, for any area (region, country, continent, historical area).
//
// 1. selectArea() picks the area from the PageAnalysis with the offline gazetteer (areas.ts).
// 2. mock: the assets must already exist in fixtures/public/geo/<key>/ (paths "/geo/<key>/...").
//    live: built once into <outDir>/<key>/ (default server/.cache/geo, served at /cache/geo/)
//    and reused; paths "/cache/geo/<key>/...".
// Pages whose places are all unknown to the gazetteer are geocoded with Wikidata (live only).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GeoContext, Mode, PageAnalysis } from "../pipeline/types.ts";
import { selectArea, wantsMap } from "./areas.ts";
import { buildArea, type BuiltContext } from "./build.ts";
import { geocodeNames } from "./geocode.ts";
import { loadGazetteer } from "./gazetteer.ts";
import { GEO_SOURCES, type GeoSourceId } from "./sources.ts";

export { suggestedExaggeration } from "./areas.ts";

export interface GeoOptions {
  mode: Mode;
  /** Where built assets are written; served by the http server under the asset base. */
  outDir?: string;
  /** User's language (D21): place names are looked up on that Wikipedia first. */
  locale?: string;
}

/** Pre-built assets for mock mode, served by the web app at /geo/. */
export const FIXTURE_GEO_DIR = resolve(import.meta.dirname, "../../../fixtures/public/geo");
/** Live builds, served by the http server at /cache/geo/. */
export const CACHE_GEO_DIR = resolve(import.meta.dirname, "../../.cache/geo");

/** Reads <dir>/<key>/context.json; asset paths become `${urlBase}/<key>/<file>`. */
export function readContext(dir: string, key: string, urlBase: string, extraSources: GeoSourceId[] = []): GeoContext | undefined {
  const file = join(dir, key, "context.json");
  if (!existsSync(file)) return undefined;
  const c = JSON.parse(readFileSync(file, "utf8")) as BuiltContext;
  const url = (f: string) => `${urlBase}/${key}/${f}`;
  return {
    bbox: c.bbox,
    terrainAsset: url(c.files.terrain),
    boundariesAsset: url(c.files.boundaries),
    ...(c.files.rivers ? { riversAsset: url(c.files.rivers) } : {}),
    focus: c.focus,
    neighbors: c.neighbors,
    sources: [...new Set([...c.sourceIds, ...extraSources])].map((id) => GEO_SOURCES[id]),
  };
}

/** Returns undefined when the page has no mappable area (or, in mock mode, no pre-built assets for it). */
export async function geoContextFor(analysis: PageAnalysis, opts: GeoOptions): Promise<GeoContext | undefined> {
  const gaz = loadGazetteer();
  let sel = selectArea(analysis, gaz);
  if (opts.mode === "mock") return sel.plan ? readContext(FIXTURE_GEO_DIR, sel.plan.key, "/geo") : undefined;

  let geocoded = false;
  if (!sel.plan && sel.unresolved.length && wantsMap(analysis, sel.unresolved.length)) {
    const points = await geocodeNames(sel.unresolved, opts.locale);
    if (points.length) {
      sel = selectArea(analysis, gaz, points);
      geocoded = !!sel.plan;
    }
  }
  if (!sel.plan) return undefined;
  const dir = opts.outDir ?? CACHE_GEO_DIR;
  if (!existsSync(join(dir, sel.plan.key, "context.json"))) await buildArea(sel.plan, join(dir, sel.plan.key));
  return readContext(dir, sel.plan.key, "/cache/geo", geocoded ? ["data-wikidata"] : []);
}
