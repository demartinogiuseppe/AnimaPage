// Projection, elevation grid and polygon rasterising for the map engine.
// Pure functions of the loaded data: no three.js scene objects here.

export type LonLat = [number, number];

export interface BBox {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Mean metres per degree of latitude. */
const M_PER_DEG = 111_320;

/**
 * Equirectangular projection around the bbox centre, longitude scaled by cos(lat0).
 * The bbox is `widthUnits` wide; +x east, -z north; y = metres * vs (vs includes the exaggeration).
 */
export class Projection {
  readonly lon0: number;
  readonly lat0: number;
  readonly cos0: number;
  /** Scene units per degree of latitude. */
  readonly k: number;
  /** Scene units per metre of elevation, exaggeration included. */
  readonly vs: number;
  readonly width: number;
  readonly depth: number;

  constructor(readonly bbox: BBox, widthUnits: number, readonly exaggeration: number) {
    this.lon0 = (bbox.lonMin + bbox.lonMax) / 2;
    this.lat0 = (bbox.latMin + bbox.latMax) / 2;
    this.cos0 = Math.cos((this.lat0 * Math.PI) / 180);
    this.k = widthUnits / ((bbox.lonMax - bbox.lonMin) * this.cos0);
    this.vs = (this.k / M_PER_DEG) * exaggeration;
    this.width = widthUnits;
    this.depth = (bbox.latMax - bbox.latMin) * this.k;
  }

  x(lon: number): number {
    return (lon - this.lon0) * this.cos0 * this.k;
  }
  z(lat: number): number {
    return -(lat - this.lat0) * this.k;
  }
  /** Kilometres between two points (equirectangular, fine at regional scale). */
  km(a: LonLat, b: LonLat): number {
    return (Math.hypot((a[0] - b[0]) * this.cos0, a[1] - b[1]) * M_PER_DEG) / 1000;
  }
  inside(lon: number, lat: number): boolean {
    const b = this.bbox;
    return lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;
  }
}

/** Header written by server/src/geo/build.ts next to the Int16 grid. */
export interface TerrainHeader {
  format: "int16le";
  data: string;
  width: number;
  height: number;
  bbox: BBox;
}

/** Regular lon/lat grid of node values; row 0 = north. */
export class Grid {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly bbox: BBox,
    readonly values: Float32Array,
  ) {}

  lon(i: number): number {
    return this.bbox.lonMin + (i / (this.width - 1)) * (this.bbox.lonMax - this.bbox.lonMin);
  }
  lat(j: number): number {
    return this.bbox.latMax - (j / (this.height - 1)) * (this.bbox.latMax - this.bbox.latMin);
  }
  /** Fractional grid coordinates of a point, clamped to the grid. */
  fij(lon: number, lat: number): [number, number] {
    const b = this.bbox;
    const fi = ((lon - b.lonMin) / (b.lonMax - b.lonMin)) * (this.width - 1);
    const fj = ((b.latMax - lat) / (b.latMax - b.latMin)) * (this.height - 1);
    return [Math.min(this.width - 1, Math.max(0, fi)), Math.min(this.height - 1, Math.max(0, fj))];
  }
  /** Bilinear sample of `arr` (defaults to the grid values). */
  sample(lon: number, lat: number, arr: ArrayLike<number> = this.values): number {
    const [fi, fj] = this.fij(lon, lat);
    const i = Math.min(this.width - 2, Math.floor(fi)), j = Math.min(this.height - 2, Math.floor(fj));
    const a = fi - i, b = fj - j;
    const w = this.width;
    const top = arr[j * w + i]! * (1 - a) + arr[j * w + i + 1]! * a;
    const bot = arr[(j + 1) * w + i]! * (1 - a) + arr[(j + 1) * w + i + 1]! * a;
    return top * (1 - b) + bot * b;
  }
}

export function parseTerrain(header: TerrainHeader, bin: ArrayBuffer): Grid {
  if (header.format !== "int16le") throw new Error(`terrain format ${header.format} not supported`);
  const view = new DataView(bin);
  const n = header.width * header.height;
  if (bin.byteLength !== n * 2) throw new Error(`terrain: expected ${n * 2} bytes, got ${bin.byteLength}`);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = view.getInt16(i * 2, true);
  return new Grid(header.width, header.height, header.bbox, values);
}

// ---------- GeoJSON (only what server/src/geo writes) ----------

export interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry:
    | { type: "Polygon"; coordinates: LonLat[][] }
    | { type: "MultiPolygon"; coordinates: LonLat[][][] }
    | { type: "LineString"; coordinates: LonLat[] }
    | { type: "MultiLineString"; coordinates: LonLat[][] };
}
export interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/** All rings (outer and holes) of a polygon feature. */
export function rings(f: GeoFeature): LonLat[][] {
  const g = f.geometry;
  if (g.type === "Polygon") return g.coordinates;
  if (g.type === "MultiPolygon") return g.coordinates.flat();
  return [];
}

export function lines(f: GeoFeature): LonLat[][] {
  const g = f.geometry;
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

/**
 * Even-odd scanline fill of polygon rings on the grid nodes: writes `value` into `out`
 * for every node inside. Holes work because all rings toggle the parity.
 */
export function rasterize(grid: Grid, polyRings: LonLat[][], value: number, out: Uint8Array): void {
  const xs: number[] = [];
  for (let j = 0; j < grid.height; j++) {
    const lat = grid.lat(j);
    xs.length = 0;
    for (const ring of polyRings) {
      for (let k = 0, n = ring.length; k < n; k++) {
        const p = ring[k]!, q = ring[(k + 1) % n]!;
        if (p[1] > lat !== q[1] > lat) xs.push(p[0] + ((lat - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const [i0] = grid.fij(xs[k]!, lat), [i1] = grid.fij(xs[k + 1]!, lat);
      for (let i = Math.ceil(i0); i <= Math.floor(i1); i++) out[j * grid.width + i] = value;
    }
  }
}

/** Distance in degrees (longitude scaled by `c`) from p to segment ab. */
export function segDist(p: LonLat, a: LonLat, b: LonLat, c: number): number {
  const px = p[0] * c, ax = a[0] * c, bx = b[0] * c;
  const dx = bx - ax, dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy));
}

/** Inserts points so that no step is longer than `step` degrees. */
export function densify(line: LonLat[], step: number): LonLat[] {
  const out: LonLat[] = [];
  for (let k = 0; k < line.length - 1; k++) {
    const a = line[k]!, b = line[k + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 0; s < n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  if (line.length) out.push(line[line.length - 1]!);
  return out;
}

/**
 * Parts of the focus outline that run along another land feature (the land border),
 * leaving out the coast. A point counts as border if it is within `tol` degrees of a
 * neighbour's edge.
 */
export function landBorder(focusRings: LonLat[][], otherRings: LonLat[][], tol: number, cos0: number, step: number): LonLat[][] {
  const edges: [LonLat, LonLat][] = [];
  for (const r of otherRings) for (let k = 0; k < r.length - 1; k++) edges.push([r[k]!, r[k + 1]!]);
  const near = (p: LonLat) => {
    for (const [a, b] of edges) {
      if (Math.min(a[0], b[0]) - tol > p[0] || Math.max(a[0], b[0]) + tol < p[0]) continue;
      if (Math.min(a[1], b[1]) - tol > p[1] || Math.max(a[1], b[1]) + tol < p[1]) continue;
      if (segDist(p, a, b, cos0) < tol) return true;
    }
    return false;
  };
  const parts: LonLat[][] = [];
  for (const ring of focusRings) {
    let cur: LonLat[] = [];
    for (const p of densify(ring, step)) {
      if (near(p)) cur.push(p);
      else if (cur.length) {
        if (cur.length > 1) parts.push(cur);
        cur = [];
      }
    }
    if (cur.length > 1) parts.push(cur);
  }
  return parts;
}
