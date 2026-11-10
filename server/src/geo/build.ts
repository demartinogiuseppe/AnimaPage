// Builds the geo assets of one map area: elevation grid, boundaries, rivers, context.json.
//
//   npx tsx server/src/geo/build.ts campania                      # hand-made preset
//   npx tsx server/src/geo/build.ts --analysis fixtures/llm/x.json  # area chosen from a page analysis
//   (both write to fixtures/public/geo/<key>/ unless --out <dir> is given)
//
// Needs network; downloads are cached in GEO_CACHE_DIR. The server calls buildArea() through
// geoContextFor() in live mode. Sources, URLs and licences: docs/data-sources.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageAnalysis } from "../pipeline/types.ts";
import { PRESETS, selectArea, slug, type AreaPlan, type RiverSpec } from "./areas.ts";
import { loadGazetteer } from "./gazetteer.ts";
import { cachedText, GEO_CACHE_DIR, overpass } from "./net.ts";
import { ISTAT_URL, NE_URL, type GeoSourceId } from "./sources.ts";
import { sampleGrid, type BBox } from "./terrarium.ts";
import { clipLine, clipRing, lineLength, mergeLines, round, sharedBorders, simplify, touches, type Pt } from "./vector.ts";

/** Written next to the assets; geoContextFor() turns it into a GeoContext. */
export interface BuiltContext {
  key: string;
  bbox: BBox;
  /** "" = no single subject area (all land in relief, faint borders). */
  focus: string;
  neighbors: string[];
  files: { terrain: string; boundaries: string; rivers?: string };
  /** River ids/names available in the rivers file (for MapData.rivers.items). */
  rivers: { id: string; name: string }[];
  /** Feature names in the boundaries file. */
  features: string[];
  sourceIds: GeoSourceId[];
  zoom: number;
  grid: { width: number; height: number };
  basis: string[];
  built: string;
}

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

const cosOf = (b: BBox) => Math.cos((((b.latMin + b.latMax) / 2) * Math.PI) / 180);

async function geojson(name: string, url: string): Promise<Feature[]> {
  return (JSON.parse(await cachedText(name, url)) as { features: Feature[] }).features;
}

const istat = (layer: "regions" | "provinces") => geojson(`limits_IT_${layer}.geojson`, ISTAT_URL(layer));
const ne = (layer: string) => geojson(`${layer}.geojson`, NE_URL(layer));

function polygons(g: Feature["geometry"]): Pt[][][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates as Pt[][]];
  if (g.type === "MultiPolygon") return g.coordinates as Pt[][][];
  return [];
}

function intersects(polys: Pt[][][], b: BBox): boolean {
  for (const poly of polys) for (const p of poly[0] ?? []) if (p[0] >= b.lonMin && p[0] <= b.lonMax && p[1] >= b.latMin && p[1] <= b.latMax) return true;
  // A box fully inside one big polygon has no vertex inside: test the box centre too.
  return polys.some((poly) => pointInRing([(b.lonMin + b.lonMax) / 2, (b.latMin + b.latMax) / 2], poly[0] ?? []));
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, c = ring[j]!;
    if (a[1] > p[1] !== c[1] > p[1] && p[0] < ((c[0] - a[0]) * (p[1] - a[1])) / (c[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- terrain

async function buildTerrain(plan: AreaPlan, outDir: string): Promise<{ width: number; height: number }> {
  const { bbox } = plan;
  const widthDeg = (bbox.lonMax - bbox.lonMin) * cosOf(bbox);
  const height = Math.round(((plan.gridWidth - 1) * (bbox.latMax - bbox.latMin)) / widthDeg) + 1;
  const grid = await sampleGrid(bbox, plan.gridWidth, height, plan.zoom, GEO_CACHE_DIR);
  const i16 = new Int16Array(grid.length);
  let min = Infinity, max = -Infinity;
  grid.forEach((v, i) => {
    i16[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
    min = Math.min(min, i16[i]!);
    max = Math.max(max, i16[i]!);
  });
  // Int16Array is little-endian on every platform we run on (x86, ARM).
  writeFileSync(join(outDir, "terrain.bin"), new Uint8Array(i16.buffer));
  const header = {
    format: "int16le",
    data: "terrain.bin",
    width: plan.gridWidth,
    height,
    bbox,
    unit: "m",
    layout: "row-major, row 0 = latMax (north), column 0 = lonMin (west); node (i,j) at lon = lonMin + i/(width-1)*(lonMax-lonMin), lat = latMax - j/(height-1)*(latMax-latMin)",
    min,
    max,
    source: `Terrarium tiles z${plan.zoom}, bilinear`,
    attribution:
      "Terrain Tiles (AWS Open Data, Tilezen/Mapzen). Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers; SRTM and GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1 U.S. National Oceanic and Atmospheric Administration.",
  };
  writeFileSync(join(outDir, "terrain.json"), JSON.stringify(header, null, 2) + "\n");
  console.log(`terrain ${plan.gridWidth}x${height} z${plan.zoom}, ${min}..${max} m`);
  return { width: plan.gridWidth, height };
}

// ---------------------------------------------------------------- boundaries

interface Named {
  props: Record<string, unknown>;
  polys: Pt[][][];
}

const ISTAT_ATTR = "Confini amministrativi ISTAT (1 gennaio 2026), CC BY 4.0, via github.com/guglielmo/geojson-italy; clipped and simplified.";
const NE_ATTR = "Natural Earth (public domain, naturalearthdata.com); clipped and simplified.";

/** Natural Earth countries, named by their Italian name (as in the gazetteer). */
async function countries(scale: "10m" | "50m", except?: string): Promise<Named[]> {
  return (await ne(`ne_${scale}_admin_0_countries`))
    .filter((f) => f.properties.ADM0_A3 !== except)
    .map((f) => ({ props: { name: f.properties.NAME_IT || f.properties.NAME, iso: f.properties.ADM0_A3 }, polys: polygons(f.geometry) }));
}

async function boundarySet(plan: AreaPlan): Promise<{ named: Named[]; sources: GeoSourceId[]; attribution: string; borders: boolean }> {
  const lonSpan = plan.bbox.lonMax - plan.bbox.lonMin;
  switch (plan.boundaries) {
    case "istat-regions":
    case "istat-provinces": {
      const layer = plan.boundaries === "istat-regions" ? "regions" : "provinces";
      const it = (await istat(layer)).map((f) => ({
        props:
          layer === "regions"
            ? { name: f.properties.reg_name, istat: f.properties.reg_istat_code }
            : { name: f.properties.prov_name, istat: f.properties.prov_istat_code },
        polys: polygons(f.geometry),
      }));
      const foreign = (await countries("10m", "ITA")).filter((n) => intersects(n.polys, plan.bbox));
      return {
        named: [...it, ...foreign],
        sources: foreign.length ? ["data-istat", "data-naturalearth"] : ["data-istat"],
        attribution: foreign.length ? `${ISTAT_ATTR} Other countries: ${NE_ATTR}` : ISTAT_ATTR,
        borders: false,
      };
    }
    case "ne-admin1": {
      const ref = plan.focus?.ref;
      const a1 = (await ne("ne_10m_admin_1_states_provinces"))
        .filter((f) => f.properties.adm0_a3 === ref)
        .map((f) => ({ props: { name: f.properties.name_it || f.properties.name, iso: f.properties.adm0_a3 }, polys: polygons(f.geometry) }));
      return { named: [...a1, ...(await countries("10m", ref))], sources: ["data-naturalearth"], attribution: NE_ATTR, borders: false };
    }
    case "ne-countries":
      return { named: await countries(lonSpan < 20 ? "10m" : "50m"), sources: ["data-naturalearth"], attribution: NE_ATTR, borders: !plan.focus };
  }
}

async function buildBoundaries(plan: AreaPlan, outDir: string) {
  const { named, sources, attribution, borders } = await boundarySet(plan);
  const { bbox } = plan;
  const cosLat = cosOf(bbox);
  const near = named.filter((n) => intersects(n.polys, bbox));
  const features: Feature[] = [];
  const rings = new Map<string, Pt[][]>();
  for (const n of near) {
    const out: Pt[][][] = [];
    for (const poly of n.polys) {
      const kept: Pt[][] = [];
      for (const [k, ring] of poly.entries()) {
        const clipped = clipRing(ring.slice(0, -1), bbox);
        if (clipped.length < 3) continue;
        const simple = simplify([...clipped, clipped[0]!], plan.regionTolDeg, cosLat).map((p) => round(p));
        if (simple.length < 4) {
          if (k === 0) break; // outer ring vanished: drop the polygon
          continue;
        }
        kept.push(simple);
      }
      if (kept.length) out.push(kept);
    }
    if (!out.length) continue;
    const name = String(n.props.name);
    if (rings.has(name)) continue; // duplicate names (rare in NE): keep the first
    rings.set(name, out.flat());
    features.push({ type: "Feature", properties: n.props, geometry: { type: "MultiPolygon", coordinates: out } });
  }
  if (borders) {
    const lines = sharedBorders(near.map((n) => n.polys.flat()))
      .flatMap((l) => clipLine(l, bbox))
      .map((l) => simplify(l, plan.regionTolDeg, cosLat).map((p) => round(p)))
      .filter((l) => l.length > 1);
    if (lines.length) features.push({ type: "Feature", properties: { kind: "border" }, geometry: { type: "MultiLineString", coordinates: lines } });
    console.log(`borders: ${lines.length} lines`);
  }
  writeFileSync(join(outDir, "regions.geojson"), JSON.stringify({ type: "FeatureCollection", attribution, features }) + "\n");

  const names = features.filter((f) => f.properties.kind !== "border").map((f) => String(f.properties.name));
  let neighbors: string[] = [];
  const focus = plan.focus?.name;
  if (focus) {
    const fr = rings.get(focus);
    if (!fr) throw new Error(`focus "${focus}" not in the boundaries`);
    const tol = Math.max(0.01, plan.regionTolDeg * 5);
    neighbors = names.filter((n) => n !== focus && touches(fr, rings.get(n)!, tol, cosLat));
  }
  console.log(`boundaries: ${names.length} features; focus ${focus ?? "-"}; neighbours ${neighbors.join(", ")}`);
  return { names, neighbors, sources };
}

// ---------------------------------------------------------------- rivers

interface OsmGeomPoint {
  lat: number;
  lon: number;
}
interface OsmElement {
  type: string;
  id: number;
  role?: string;
  tags?: Record<string, string>;
  geometry?: OsmGeomPoint[];
  members?: OsmElement[];
}

/** Ways of an Overpass result; relations keep their main stream only (role "" or "main_stream"), not side channels. */
function osmWays(el: OsmElement): Pt[][] {
  const parts = el.type === "relation" ? (el.members ?? []).filter((m) => m.type === "way" && (m.role === "" || m.role === "main_stream")) : [el];
  return parts.filter((p) => p.geometry?.length).map((p) => p.geometry!.map((g) => [g.lon, g.lat] as Pt));
}

const RIVER_ATTR_OSM = "© OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright); merged, clipped and simplified.";

function riverLines(ways: Pt[][], plan: AreaPlan): Pt[][] {
  return mergeLines(ways)
    .flatMap((l) => clipLine(l, plan.bbox))
    .map((l) => simplify(l, plan.riverTolDeg, cosOf(plan.bbox)).map((p) => round(p)))
    .filter((l) => l.length > 1);
}

async function presetRivers(plan: AreaPlan, specs: RiverSpec[]): Promise<Feature[]> {
  const features: Feature[] = [];
  for (const r of specs) {
    const json = JSON.parse(await overpass(`osm-river-${r.id}.json`, r.query)) as { elements: OsmElement[] };
    const ways = json.elements.flatMap(osmWays);
    const lines = riverLines(ways, plan);
    if (!lines.length) throw new Error(`river ${r.id}: no geometry`);
    features.push({ type: "Feature", properties: { id: r.id, name: r.name, wikidata: r.wikidata }, geometry: { type: "MultiLineString", coordinates: lines } });
    console.log(`river ${r.id}: ${ways.length} ways -> ${lines.length} lines, ${lines.reduce((s, l) => s + l.length, 0)} pts`);
  }
  return features;
}

/** Small areas: named OSM river relations in the bbox (one Overpass query), the 8 longest inside it. */
async function osmRivers(plan: AreaPlan): Promise<Feature[]> {
  const b = plan.bbox;
  const box = `${b.latMin},${b.lonMin},${b.latMax},${b.lonMax}`;
  const json = JSON.parse(await overpass(`osm-rivers-${plan.key}.json`, `rel["waterway"="river"]["name"](${box});out geom(${box});`)) as { elements: OsmElement[] };
  return topRivers(
    json.elements.map((el) => ({ id: slug(el.tags?.name ?? String(el.id)), props: { name: el.tags?.name, wikidata: el.tags?.wikidata }, lines: riverLines(osmWays(el), plan) })),
    plan,
    8,
  );
}

/** Larger areas: Natural Earth river centrelines (English names), merged by name. */
async function neRivers(plan: AreaPlan, scale: "10m" | "50m"): Promise<Feature[]> {
  const byId = new Map<string, { id: string; props: Record<string, unknown>; ways: Pt[][]; rank: number }>();
  for (const f of await ne(`ne_${scale}_rivers_lake_centerlines`)) {
    const name = String(f.properties.name_en || f.properties.name || "");
    if (!name || f.properties.featurecla !== "River" || !f.geometry) continue;
    const id = slug(name);
    const ways = f.geometry.type === "LineString" ? [f.geometry.coordinates as Pt[]] : (f.geometry.coordinates as Pt[][]);
    const r = byId.get(id) ?? { id, props: { name }, ways: [], rank: Number(f.properties.scalerank ?? 99) };
    r.ways.push(...ways);
    byId.set(id, r);
  }
  return topRivers(
    [...byId.values()].sort((a, b) => a.rank - b.rank).map((r) => ({ id: r.id, props: r.props, lines: riverLines(r.ways, plan) })),
    plan,
    25,
  );
}

function topRivers(list: { id: string; props: Record<string, unknown>; lines: Pt[][] }[], plan: AreaPlan, max: number): Feature[] {
  const cosLat = cosOf(plan.bbox);
  const minLen = 0.03 * (plan.bbox.lonMax - plan.bbox.lonMin) * cosLat;
  const seen = new Set<string>();
  return list
    .map((r) => ({ ...r, len: r.lines.reduce((s, l) => s + lineLength(l, cosLat), 0) }))
    .filter((r) => r.len >= minLen && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => b.len - a.len)
    .slice(0, max)
    .map((r) => ({ type: "Feature", properties: { id: r.id, ...r.props }, geometry: { type: "MultiLineString", coordinates: r.lines } }));
}

async function buildRivers(plan: AreaPlan, outDir: string): Promise<{ rivers: { id: string; name: string }[]; source?: GeoSourceId }> {
  const r = plan.rivers;
  const features =
    typeof r === "object" ? await presetRivers(plan, r.preset) : r === "osm" ? await osmRivers(plan) : await neRivers(plan, r === "ne10" ? "10m" : "50m");
  if (!features.length) return { rivers: [] };
  const fromOsm = typeof r === "object" || r === "osm";
  const attribution = fromOsm ? RIVER_ATTR_OSM : "Natural Earth river centerlines (public domain); clipped and simplified.";
  writeFileSync(join(outDir, "rivers.geojson"), JSON.stringify({ type: "FeatureCollection", attribution, features }) + "\n");
  console.log(`rivers: ${features.map((f) => f.properties.id).join(", ")}`);
  return {
    rivers: features.map((f) => ({ id: String(f.properties.id), name: String(f.properties.name) })),
    source: fromOsm ? "data-osm" : "data-naturalearth",
  };
}

// ---------------------------------------------------------------- area

export async function buildArea(plan: AreaPlan, outDir: string): Promise<BuiltContext> {
  mkdirSync(outDir, { recursive: true });
  const grid = await buildTerrain(plan, outDir);
  const b = await buildBoundaries(plan, outDir);
  const r = await buildRivers(plan, outDir);
  const sourceIds = [...new Set<GeoSourceId>(["data-terrain", ...b.sources, ...(r.source ? [r.source] : [])])];
  const ctx: BuiltContext = {
    key: plan.key,
    bbox: plan.bbox,
    focus: plan.focus?.name ?? "",
    neighbors: b.neighbors,
    files: { terrain: "terrain.json", boundaries: "regions.geojson", ...(r.rivers.length ? { rivers: "rivers.geojson" } : {}) },
    rivers: r.rivers,
    features: b.names,
    sourceIds,
    zoom: plan.zoom,
    grid,
    basis: plan.basis,
    built: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(outDir, "context.json"), JSON.stringify(ctx, null, 2) + "\n");
  return ctx;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let plan: AreaPlan | undefined;
  const analysisFile = opt("--analysis");
  if (analysisFile) {
    const raw = JSON.parse(readFileSync(analysisFile, "utf8")) as { response?: { data?: PageAnalysis } } & PageAnalysis;
    plan = selectArea(raw.response?.data ?? raw, loadGazetteer()).plan;
    if (!plan) throw new Error(`${analysisFile}: no map area for this page`);
  } else plan = PRESETS[args[0] ?? ""];
  if (!plan) throw new Error(`usage: build.ts <${Object.keys(PRESETS).join("|")}> | --analysis <file.json>  [--out <dir>]`);
  const outDir = resolve(opt("--out") ?? resolve(import.meta.dirname, "../../../fixtures/public/geo", plan.key));
  console.log(`area ${plan.key}: ${JSON.stringify(plan.bbox)} from ${plan.basis.join(", ")}`);
  await buildArea(plan, outDir);
  console.log(`written to ${outDir} (cache: ${GEO_CACHE_DIR})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
