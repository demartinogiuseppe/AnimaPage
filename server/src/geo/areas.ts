// Which area does a page need on a map? Pure functions of the PageAnalysis and the offline
// gazetteer, so mock mode and live mode pick the same area (and the same cache key).
import type { PageAnalysis } from "../pipeline/types.ts";
import { norm, SOFT_KINDS, type BBox4, type Gazetteer, type Place, type PlaceKind } from "./gazetteer.ts";
import { tileRange, type BBox } from "./terrarium.ts";

/** A river picked by hand from OpenStreetMap (presets only). */
export interface RiverSpec {
  id: string;
  name: string;
  wikidata: string;
  /** Overpass QL statement(s) that leave the river's ways (with geometry) or its relation in the result. */
  query: string;
}

export type BoundaryLayer = "istat-regions" | "istat-provinces" | "ne-countries" | "ne-admin1";
export type RiverLayer = "osm" | "ne10" | "ne50" | { preset: RiverSpec[] };

export interface AreaPlan {
  /** Cache/fixture folder name: the focus slug, or "area_<lonMin>_<latMin>_<lonMax>_<latMax>". */
  key: string;
  bbox: BBox;
  /** Feature drawn in colour with a dashed border; undefined = all land in relief, faint borders. */
  focus?: { name: string; kind: PlaceKind; ref?: string };
  boundaries: BoundaryLayer;
  rivers: RiverLayer;
  /** Terrarium zoom and grid nodes across (west-east). */
  zoom: number;
  gridWidth: number;
  /** Douglas–Peucker tolerances in degrees of latitude. */
  regionTolDeg: number;
  riverTolDeg: number;
  /** Names on the page that decided the extent (for logs and tests). */
  basis: string[];
}

/** Areas built by hand before M4, kept identical so existing scenes keep working. */
export const PRESETS: Record<string, AreaPlan> = {
  campania: {
    key: "campania",
    bbox: { lonMin: 13.65, lonMax: 15.9, latMin: 39.9, latMax: 41.6 },
    focus: { name: "Campania", kind: "it-region", ref: "15" },
    boundaries: "istat-regions",
    gridWidth: 256,
    zoom: 10,
    regionTolDeg: 0.002,
    riverTolDeg: 0.0015,
    basis: ["Campania"],
    rivers: {
      preset: [
        // Relation ids found with: rel["waterway"="river"]["name"~"^(Volturno|Sele)$"](39.9,13.6,41.7,15.9); out tags;
        { id: "volturno", name: "Volturno", wikidata: "Q572191", query: "rel(2570012);out geom;" },
        { id: "sele", name: "Sele", wikidata: "Q937958", query: "rel(2569984);out geom;" },
        { id: "calore", name: "Calore Irpino", wikidata: "Q857589", query: "rel(2570005);out geom;" },
        // The Garigliano has no waterway relation: its ways are tagged name=Garigliano.
        { id: "garigliano", name: "Garigliano", wikidata: "Q287568", query: 'way["waterway"="river"]["name"="Garigliano"](41.1,13.6,41.5,14.0);out geom;' },
      ],
    },
  },
};

const FOCUS_KINDS: ReadonlySet<PlaceKind> = new Set(["it-region", "it-province", "country", "admin1"]);
const MAP_SUBJECTS = /geograf|storia|history|geograph/i;

/** Names on the page that may be places: place entities, labels of the book's own maps. */
export function candidateNames(a: PageAnalysis): string[] {
  const names = [
    ...a.entities.filter((e) => e.type === "place").map((e) => e.name),
    ...a.illustrations.filter((i) => i.kind === "map").flatMap((i) => i.labels),
  ];
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = norm(n);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface Resolved {
  name: string;
  places: Place[];
  soft: boolean;
}

export function resolveNames(names: string[], gaz: Gazetteer): { resolved: Resolved[]; unresolved: string[] } {
  const resolved: Resolved[] = [], unresolved: string[] = [];
  for (const name of names) {
    const r = gaz.lookup(name);
    if (r.places.length) resolved.push({ name, ...r });
    else unresolved.push(name);
  }
  return { resolved, unresolved };
}

/** Stories, poems, grammar, science without places: no map. */
export function wantsMap(a: PageAnalysis, hardPlaces: number): boolean {
  if (!a.readable) return false;
  if (a.suggestedEngine === "map") return true;
  if (a.literary.isLiterary || a.contentType === "narrative" || a.contentType === "poem") return false;
  if (a.illustrations.some((i) => i.kind === "map") && hardPlaces > 0) return true;
  return MAP_SUBJECTS.test(a.subject) && hardPlaces >= 3;
}

const words = (s: string) => ` ${norm(s)} `;

/** The subject area: the topic itself, or a place named in the topic ("Regioni d'Italia: la Campania"). */
export function findFocus(a: PageAnalysis, gaz: Gazetteer): Place | undefined {
  const topic = gaz.lookup(a.topic);
  if (topic.places.length === 1 && FOCUS_KINDS.has(topic.places[0]!.kind)) return topic.places[0];
  const t = words(a.topic);
  for (const e of a.entities) {
    if (e.type !== "place" || !t.includes(words(e.name))) continue;
    const r = gaz.lookup(e.name);
    if (r.places.length === 1 && FOCUS_KINDS.has(r.places[0]!.kind)) return r.places[0];
  }
  return undefined;
}

const union = (boxes: BBox4[]): BBox4 =>
  boxes.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);

const KM_PER_DEG = 111.32;

/** Width and height in km at the box's mid latitude. */
export function sizeKm(b: BBox): { w: number; h: number } {
  const cos = Math.cos((((b.latMin + b.latMax) / 2) * Math.PI) / 180);
  return { w: (b.lonMax - b.lonMin) * cos * KM_PER_DEG, h: (b.latMax - b.latMin) * KM_PER_DEG };
}

/** Margin (6 %, at least 0.1°), aspect ratio clamped to 0.75..2 (w/h), outward rounding, Mercator-safe latitudes. */
export function frame(b4: BBox4): BBox {
  let [lonMin, latMin, lonMax, latMax] = b4;
  const minSpan = 0.5;
  if (lonMax - lonMin < minSpan) (lonMin -= (minSpan - (lonMax - lonMin)) / 2), (lonMax = lonMin + minSpan);
  if (latMax - latMin < minSpan) (latMin -= (minSpan - (latMax - latMin)) / 2), (latMax = latMin + minSpan);
  const mx = Math.max(0.1, 0.06 * (lonMax - lonMin)), my = Math.max(0.1, 0.06 * (latMax - latMin));
  let b: BBox = { lonMin: lonMin - mx, lonMax: lonMax + mx, latMin: latMin - my, latMax: latMax + my };
  const { w, h } = sizeKm(b);
  const cos = Math.cos((((b.latMin + b.latMax) / 2) * Math.PI) / 180);
  if (w / h < 0.75) {
    const extra = (0.75 * h - w) / (cos * KM_PER_DEG) / 2;
    b = { ...b, lonMin: b.lonMin - extra, lonMax: b.lonMax + extra };
  } else if (w / h > 2) {
    const extra = (w / 2 - h) / KM_PER_DEG / 2;
    b = { ...b, latMin: b.latMin - extra, latMax: b.latMax + extra };
  }
  const span = Math.max(b.lonMax - b.lonMin, b.latMax - b.latMin);
  const step = span > 20 ? 1 : span > 4 ? 0.25 : 0.05;
  const down = (v: number) => Number((Math.floor(v / step + 1e-9) * step).toFixed(2));
  const up = (v: number) => Number((Math.ceil(v / step - 1e-9) * step).toFixed(2));
  return {
    lonMin: Math.max(-180, down(b.lonMin)),
    lonMax: Math.min(180, up(b.lonMax)),
    latMin: Math.max(-80, down(b.latMin)),
    latMax: Math.min(84, up(b.latMax)),
  };
}

/** Terrarium zoom: ~4 tile pixels per grid node (Campania z10, Europe z5), at most 64 tiles. */
export function chooseZoom(b: BBox, gridWidth: number): number {
  let z = Math.ceil(Math.log2((gridWidth * 4 * 360) / (256 * (b.lonMax - b.lonMin))));
  z = Math.min(12, Math.max(1, z));
  while (z > 1 && tileRange(b, z).count > 64) z--;
  return z;
}

/** Grid nodes across: the long side has 256 nodes (regions) or 384 (countries, continents). */
export function chooseGridWidth(b: BBox): number {
  const { w, h } = sizeKm(b);
  const long = Math.max(w, h) < 600 ? 256 : 384;
  return w >= h ? long : Math.max(64, Math.round((long * w) / h));
}

/** Vertical exaggeration that keeps relief readable: 10 for a region like Campania, up to 50 for a continent. */
export function suggestedExaggeration(b: BBox): number {
  const { w } = sizeKm(b);
  return Math.min(50, Math.max(1, Math.round(10 * Math.sqrt(w / 190))));
}

export const slug = (s: string) => norm(s).replace(/ /g, "-");
const fmt = (v: number) => String(v).replace("-", "m").replace(".", "p");

export function planFor(bbox: BBox, focus: Place | undefined, hard: Place[], basis: string[]): AreaPlan {
  const preset = focus && PRESETS[slug(focus.name)];
  if (preset) return preset;
  const span = Math.max(sizeKm(bbox).w, sizeKm(bbox).h) / KM_PER_DEG;
  const allItalian = hard.length > 0 && hard.every((p) => p.kind === "it-region" || p.kind === "it-province");
  const boundaries: BoundaryLayer =
    focus?.kind === "it-region"
      ? "istat-regions"
      : focus?.kind === "it-province"
        ? "istat-provinces"
        : focus?.kind === "admin1"
          ? "ne-admin1"
          : !focus && allItalian
            ? "istat-regions"
            : "ne-countries";
  const gridWidth = chooseGridWidth(bbox);
  const lonSpan = bbox.lonMax - bbox.lonMin;
  return {
    key: focus ? slug(focus.name) : `area_${fmt(bbox.lonMin)}_${fmt(bbox.latMin)}_${fmt(bbox.lonMax)}_${fmt(bbox.latMax)}`,
    bbox,
    ...(focus ? { focus: { name: focus.name, kind: focus.kind, ...(focus.ref ? { ref: focus.ref } : {}) } } : {}),
    boundaries,
    rivers: span < 3 ? "osm" : span < 20 ? "ne10" : "ne50",
    zoom: chooseZoom(bbox, gridWidth),
    gridWidth,
    regionTolDeg: Number((lonSpan / 1125).toPrecision(2)),
    riverTolDeg: Number((lonSpan / 1500).toPrecision(2)),
    basis,
  };
}

export interface Selection {
  plan?: AreaPlan;
  /** Place names the gazetteer does not know: geocode them (live) only when nothing else is known. */
  unresolved: string[];
}

/**
 * Chooses the map area of a page, or none. `points` are geocoded extra places (live mode), used
 * only when the gazetteer knows none of the page's places.
 */
export function selectArea(a: PageAnalysis, gaz: Gazetteer, points: { name: string; lon: number; lat: number }[] = []): Selection {
  const { resolved, unresolved } = resolveNames(candidateNames(a), gaz);
  const hardRes = resolved.filter((r) => !r.soft);
  const hard = hardRes.flatMap((r) => r.places);
  const usable = hard.length + points.length;
  if (!wantsMap(a, usable || resolved.length)) return { unresolved };

  const focus = findFocus(a, gaz);
  let boxes: BBox4[], basis: string[];
  if (focus) (boxes = [focus.bbox]), (basis = [focus.name]);
  else if (hard.length) (boxes = hard.map((p) => p.bbox)), (basis = hardRes.map((r) => r.name));
  else if (points.length) (boxes = points.map((p) => [p.lon, p.lat, p.lon, p.lat])), (basis = points.map((p) => p.name));
  else if (resolved.length) (boxes = resolved.flatMap((r) => r.places.map((p) => p.bbox))), (basis = resolved.map((r) => r.name));
  else return { unresolved };

  const preset = focus && PRESETS[slug(focus.name)];
  const bbox = preset ? preset.bbox : frame(union(boxes));
  return { plan: planFor(bbox, focus, hard, basis), unresolved };
}
