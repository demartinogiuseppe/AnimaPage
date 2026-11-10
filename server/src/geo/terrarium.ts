// Terrarium elevation tiles (Tilezen / AWS Open Data "Terrain Tiles"), see docs/data-sources.md.
//
// Verified 2026-11-03 in https://github.com/tilezen/joerd/blob/master/docs/use-service.md
// and .../docs/formats.md:
//   URL:     https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png  (256 px, z 0..15)
//   decode:  (red * 256 + green + blue / 256) - 32768   metres
import { decode } from "fast-png";
import { cachedBytes } from "./net.ts";

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TILE = 256;

export interface BBox {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Global pixel coordinates (Web Mercator) at zoom z. */
export function lonLatToPixel(lon: number, lat: number, z: number): [number, number] {
  const n = TILE * 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Decodes one Terrarium PNG into a TILE x TILE Float32Array of metres. */
export function decodeTile(png: Uint8Array): Float32Array {
  const img = decode(png);
  if (img.width !== TILE || img.height !== TILE || img.depth !== 8) throw new Error(`unexpected tile ${img.width}x${img.height}@${img.depth}`);
  const out = new Float32Array(TILE * TILE);
  const c = img.channels;
  for (let i = 0; i < TILE * TILE; i++) out[i] = decodeTerrarium(img.data[i * c]!, img.data[i * c + 1]!, img.data[i * c + 2]!);
  return out;
}

async function loadTile(z: number, x: number, y: number, cacheDir: string): Promise<Float32Array> {
  const url = TERRARIUM_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  return decodeTile(await cachedBytes(`terrarium-${z}-${x}-${y}.png`, url, undefined, cacheDir));
}

/** Tile range covering a bbox at zoom z, with the one-pixel bilinear margin used by sampleGrid. */
export function tileRange(bbox: BBox, zoom: number): { tx0: number; tx1: number; ty0: number; ty1: number; count: number } {
  const [x0, y0] = lonLatToPixel(bbox.lonMin, bbox.latMax, zoom);
  const [x1, y1] = lonLatToPixel(bbox.lonMax, bbox.latMin, zoom);
  const tx0 = Math.floor((x0 - 1) / TILE), tx1 = Math.floor((x1 + 1) / TILE);
  const ty0 = Math.floor((y0 - 1) / TILE), ty1 = Math.floor((y1 + 1) / TILE);
  return { tx0, tx1, ty0, ty1, count: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) };
}

/**
 * Samples elevation (bilinear, in Mercator pixel space) on a regular lon/lat grid.
 * Node (i, j): lon = lonMin + i/(width-1)*(lonMax-lonMin), lat = latMax - j/(height-1)*(latMax-latMin)
 * (row 0 is the northern edge). Returns metres, row-major.
 */
export async function sampleGrid(bbox: BBox, width: number, height: number, zoom: number, cacheDir: string): Promise<Float32Array> {
  // One pixel of margin on every side for the bilinear neighbours.
  const { tx0, tx1, ty0, ty1 } = tileRange(bbox, zoom);
  const tiles = new Map<string, Float32Array>();
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.set(`${tx}/${ty}`, await loadTile(zoom, tx, ty, cacheDir));

  const px = (x: number, y: number): number => {
    const tile = tiles.get(`${Math.floor(x / TILE)}/${Math.floor(y / TILE)}`)!;
    return tile[(y % TILE) * TILE + (x % TILE)]!;
  };
  const out = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const lat = bbox.latMax - (j / (height - 1)) * (bbox.latMax - bbox.latMin);
    for (let i = 0; i < width; i++) {
      const lon = bbox.lonMin + (i / (width - 1)) * (bbox.lonMax - bbox.lonMin);
      const [x, y] = lonLatToPixel(lon, lat, zoom);
      // Pixel centres are at +0.5.
      const fx = x - 0.5, fy = y - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const ax = fx - ix, ay = fy - iy;
      const top = px(ix, iy) * (1 - ax) + px(ix + 1, iy) * ax;
      const bot = px(ix, iy + 1) * (1 - ax) + px(ix + 1, iy + 1) * ax;
      out[j * width + i] = top * (1 - ay) + bot * ay;
    }
  }
  return out;
}
