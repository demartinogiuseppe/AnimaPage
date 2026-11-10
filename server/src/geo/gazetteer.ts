// Offline gazetteer: place names (Italian first) -> kind + bounding box, so that the area of a
// page can be chosen without network (mock mode, tests). Built once from Natural Earth
// (public domain) and ISTAT (CC BY 4.0) and committed as data/gazetteer.json:
//
//   npx tsx server/src/geo/gazetteer.ts
//
// Historical and school names ("Gallia", "Italia settentrionale") map to modern areas through
// ALIASES below: they only choose the map extent, they are never shown as facts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cachedText } from "./net.ts";
import { ISTAT_URL, NE_URL } from "./sources.ts";
import type { Pt } from "./vector.ts";

export type PlaceKind =
  | "it-region"
  | "it-province"
  | "country"
  | "admin1"
  | "region" // physical/historical region: range, peninsula, desert, island...
  | "sea"
  | "lake"
  | "city"
  | "continent"
  | "ocean";

/** [lonMin, latMin, lonMax, latMax] */
export type BBox4 = [number, number, number, number];

export interface Place {
  /** Display name; for admin kinds it is the feature name written in the boundaries file. */
  name: string;
  kind: PlaceKind;
  bbox: BBox4;
  /** Normalised lookup keys. */
  keys: string[];
  /** ISO/NE country code (country, admin1) or ISTAT code (it-*). */
  ref?: string;
}

/** Kinds that only frame a map when nothing more precise is named (Africa, Atlantic...). */
export const SOFT_KINDS: ReadonlySet<PlaceKind> = new Set(["continent", "ocean"]);

/** Same name, several places: the first kind in this list wins. */
const KIND_PRIORITY: PlaceKind[] = ["it-region", "country", "it-province", "admin1", "sea", "region", "lake", "city", "continent", "ocean"];

/** Lower case, no accents/punctuation/leading article; "mare X" -> "mar X". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(il|lo|la|l|i|gli|le|the) /, "")
    .replace(/^mare /, "mar ");
}

/**
 * Historical / school names -> gazetteer names. `soft` marks vague macro-areas that frame the map
 * only when nothing more precise is named. Hand-written; extend when a page needs it.
 */
export const ALIASES: Record<string, { to: string[]; soft?: boolean }> = {
  gallia: { to: ["Francia"] },
  britannia: { to: ["Regno Unito"] },
  costantinopoli: { to: ["Istanbul"] },
  bisanzio: { to: ["Istanbul"] },
  "asia minore": { to: ["Anatolia"] },
  persia: { to: ["Iran"] },
  pannonia: { to: ["Ungheria"] },
  dacia: { to: ["Romania"] },
  cartagine: { to: ["Tunisia"] },
  fenicia: { to: ["Libano"] },
  "penisola iberica": { to: ["Spagna", "Portogallo"] },
  "italia settentrionale": {
    to: ["Piemonte", "Valle d'Aosta", "Lombardia", "Trentino-Alto Adige", "Veneto", "Friuli-Venezia Giulia", "Liguria", "Emilia-Romagna"],
  },
  "italia centrale": { to: ["Toscana", "Umbria", "Marche", "Lazio"] },
  "italia meridionale": { to: ["Abruzzo", "Molise", "Campania", "Puglia", "Basilicata", "Calabria"] },
  "magna grecia": { to: ["Campania", "Basilicata", "Calabria", "Puglia", "Sicilia"] },
  "europa del nord": { to: ["Scandinavia", "Danimarca"], soft: true },
};
for (const [alt, main] of [
  ["italia del nord", "italia settentrionale"],
  ["nord italia", "italia settentrionale"],
  ["italia del sud", "italia meridionale"],
  ["sud italia", "italia meridionale"],
  ["mezzogiorno", "italia meridionale"],
  ["europa settentrionale", "europa del nord"],
  ["nord europa", "europa del nord"],
] as const)
  ALIASES[alt] = ALIASES[main]!;

export class Gazetteer {
  private readonly byKey = new Map<string, Place[]>();
  private readonly byName = new Map<string, Place>();

  constructor(readonly places: Place[]) {
    for (const p of places) {
      for (const k of p.keys) {
        const list = this.byKey.get(k) ?? [];
        list.push(p);
        this.byKey.set(k, list);
      }
      if (!this.byName.has(p.name)) this.byName.set(p.name, p);
    }
    for (const list of this.byKey.values()) list.sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind));
  }

  /** Best place for a name as written on a page, aliases included; [] when unknown. */
  lookup(name: string): { places: Place[]; soft: boolean } {
    const k = norm(name);
    const alias = ALIASES[k];
    if (alias) {
      const places = alias.to.map((n) => this.byKey.get(norm(n))?.[0]).filter((p): p is Place => !!p);
      return { places, soft: !!alias.soft };
    }
    const best = this.byKey.get(k)?.[0];
    return best ? { places: [best], soft: SOFT_KINDS.has(best.kind) } : { places: [], soft: false };
  }

  /** All places sharing a key (e.g. a province and a city), best first. */
  all(name: string): Place[] {
    return this.byKey.get(norm(name)) ?? [];
  }
}

const DATA_FILE = resolve(import.meta.dirname, "data/gazetteer.json");
let cached: Gazetteer | undefined;

export function loadGazetteer(file = DATA_FILE): Gazetteer {
  if (file === DATA_FILE && cached) return cached;
  const raw = JSON.parse(readFileSync(file, "utf8")) as { places: [string, PlaceKind, BBox4, string[], string?][] };
  const g = new Gazetteer(raw.places.map(([name, kind, bbox, keys, ref]) => ({ name, kind, bbox, keys, ...(ref ? { ref } : {}) })));
  if (file === DATA_FILE) cached = g;
  return g;
}

// ---------------------------------------------------------------- build (network)

interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

/** Outer rings of each polygon part. */
export function polygonParts(geometry: Feature["geometry"]): Pt[][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [(geometry.coordinates as Pt[][])[0]!];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as Pt[][][]).map((p) => p[0]!);
  return [];
}

const ringBox = (r: Pt[]): BBox4 => {
  const b: BBox4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of r) (b[0] = Math.min(b[0], x)), (b[1] = Math.min(b[1], y)), (b[2] = Math.max(b[2], x)), (b[3] = Math.max(b[3], y));
  return b;
};

/**
 * Bbox of the main body of a feature: the largest part plus the parts close to it, so that
 * overseas territories (French Guiana for France) and antimeridian slivers are left out.
 */
export function mainBBox(parts: Pt[][]): BBox4 | undefined {
  if (!parts.length) return undefined;
  const boxes = parts.map(ringBox);
  const area = (b: BBox4) => (b[2] - b[0]) * (b[3] - b[1]);
  let main = boxes.reduce((a, b) => (area(b) > area(a) ? b : a));
  const used = new Set<BBox4>([main]);
  for (let grown = true; grown; ) {
    grown = false;
    const d = Math.max(3, 0.15 * Math.max(main[2] - main[0], main[3] - main[1]));
    for (const b of boxes) {
      if (used.has(b)) continue;
      if (b[0] > main[2] + d || b[2] < main[0] - d || b[1] > main[3] + d || b[3] < main[1] - d) continue;
      main = [Math.min(main[0], b[0]), Math.min(main[1], b[1]), Math.max(main[2], b[2]), Math.max(main[3], b[3])];
      used.add(b);
      grown = true;
    }
  }
  return main.map((v) => Number(v.toFixed(2))) as BBox4;
}

async function geojson(name: string, url: string): Promise<Feature[]> {
  return (JSON.parse(await cachedText(name, url)) as { features: Feature[] }).features;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const keysOf = (...names: (string | undefined)[]) => [...new Set(names.filter((n): n is string => !!n).flatMap((n) => n.split("/")).map(norm).filter(Boolean))];

export async function buildGazetteer(): Promise<Place[]> {
  const out: Place[] = [];
  const add = (name: string | undefined, kind: PlaceKind, bbox: BBox4 | undefined, keys: string[], ref?: string) => {
    if (name && bbox && keys.length) out.push({ name, kind, bbox, keys, ...(ref ? { ref } : {}) });
  };

  for (const f of await geojson("limits_IT_regions.geojson", ISTAT_URL("regions"))) {
    const n = str(f.properties.reg_name);
    add(n, "it-region", mainBBox(polygonParts(f.geometry)), keysOf(n), str(f.properties.reg_istat_code));
  }
  for (const f of await geojson("limits_IT_provinces.geojson", ISTAT_URL("provinces"))) {
    const n = str(f.properties.prov_name);
    add(n, "it-province", mainBBox(polygonParts(f.geometry)), keysOf(n), str(f.properties.prov_istat_code));
  }
  // Countries: the boundaries file names them by NAME_IT, so that is the display name.
  for (const f of await geojson("ne_10m_admin_0_countries.geojson", NE_URL("ne_10m_admin_0_countries"))) {
    const p = f.properties;
    const n = str(p.NAME_IT) ?? str(p.NAME);
    add(n, "country", mainBBox(polygonParts(f.geometry)), keysOf(n, str(p.NAME), str(p.NAME_EN), str(p.ADMIN)), str(p.ADM0_A3));
  }
  for (const f of await geojson("ne_10m_admin_1_states_provinces.geojson", NE_URL("ne_10m_admin_1_states_provinces"))) {
    const p = f.properties;
    if (p.adm0_a3 === "ITA") continue; // ISTAT is used for Italy
    const n = str(p.name_it) ?? str(p.name);
    add(n, "admin1", mainBBox(polygonParts(f.geometry)), keysOf(n, str(p.name), str(p.name_en)), str(p.adm0_a3));
  }
  for (const f of await geojson("ne_10m_geography_regions_polys.geojson", NE_URL("ne_10m_geography_regions_polys"))) {
    const p = f.properties;
    const n = str(p.NAME_IT) ?? str(p.NAME);
    add(n, p.FEATURECLA === "Continent" ? "continent" : "region", mainBBox(polygonParts(f.geometry)), keysOf(n, str(p.NAME_EN)));
  }
  for (const f of await geojson("ne_10m_geography_marine_polys.geojson", NE_URL("ne_10m_geography_marine_polys"))) {
    const p = f.properties;
    const n = str(p.name_it) ?? str(p.name);
    add(n, p.featurecla === "ocean" ? "ocean" : "sea", mainBBox(polygonParts(f.geometry)), keysOf(n, str(p.name_en)));
  }
  for (const f of await geojson("ne_50m_lakes.geojson", NE_URL("ne_50m_lakes"))) {
    const p = f.properties;
    const n = str(p.name_it) ?? str(p.name);
    add(n, "lake", mainBBox(polygonParts(f.geometry)), keysOf(n, str(p.name_en)));
  }
  // Large cities only (scalerank 0..4, about 1100): NE has no Italian names here.
  for (const f of await geojson("ne_10m_populated_places_simple.geojson", NE_URL("ne_10m_populated_places_simple"))) {
    const p = f.properties;
    if (typeof p.scalerank !== "number" || p.scalerank > 4) continue;
    const lon = Number(p.longitude), lat = Number(p.latitude);
    add(str(p.name), "city", [lon, lat, lon, lat].map((v) => Number(v.toFixed(2))) as BBox4, keysOf(str(p.name), str(p.nameascii)), str(p.adm0_a3));
  }
  return out;
}

async function main() {
  const places = await buildGazetteer();
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  const rows = places.map((p) => JSON.stringify([p.name, p.kind, p.bbox, p.keys, ...(p.ref ? [p.ref] : [])]));
  const header = {
    note: "Built by server/src/geo/gazetteer.ts from ISTAT (CC BY 4.0) and Natural Earth (public domain). Row: [name, kind, [lonMin,latMin,lonMax,latMax], keys, ref?].",
    built: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(DATA_FILE, `{"meta":${JSON.stringify(header)},"places":[\n${rows.join(",\n")}\n]}\n`);
  const counts: Record<string, number> = {};
  for (const p of places) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  console.log(`${places.length} places`, counts, "->", DATA_FILE);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
