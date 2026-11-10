// Artwork image: decoding to a texture (browser only) and the colour palette computed from it.
//
// In Node (tests) there is no canvas and no createImageBitmap: the engine then builds the same
// geometry without a texture, and computed palettes fall back to neutral greys. Nothing here throws.
import * as THREE from "three";
import type { EngineContext } from "../../types.ts";

export interface ArtImageData {
  texture: THREE.Texture;
  bitmap: ImageBitmap;
}

/** True when this environment can decode images into textures. */
export function canDecode(ctx: EngineContext): boolean {
  return ctx.createCanvas !== undefined && typeof globalThis.createImageBitmap === "function";
}

/**
 * Loads and decodes the image. The bitmap is not flipped: the texture uses flipY = false and the
 * engine's UVs put the image's top row at v = 0. sRGB colour space, mipmaps, anisotropic filtering.
 * Returns null (and logs) on any failure: the engine then shows the canvas without the picture.
 */
export async function loadArtImage(ctx: EngineContext, asset: string): Promise<ArtImageData | null> {
  if (!canDecode(ctx)) return null;
  try {
    const buf = await ctx.loadAsset(asset);
    const bitmap = await createImageBitmap(new Blob([buf]));
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return { texture, bitmap };
  } catch (e) {
    console.warn(`[art] image ${asset} unavailable:`, e);
    return null;
  }
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
export const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/**
 * Deterministic k-means palette of RGBA pixels: farthest-point initialisation (starting from the
 * pixel nearest to the mean), fixed iterations, clusters sorted by size (largest first). Pure.
 */
export function paletteFromPixels(data: ArrayLike<number>, count: number, iterations = 12): string[] {
  const px: [number, number, number][] = [];
  for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3]! > 127) px.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  if (px.length === 0) return [];
  const d2 = (a: readonly number[], b: readonly number[]) => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
  const mean = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c]!, 0) / px.length);
  let first = 0;
  for (let i = 1; i < px.length; i++) if (d2(px[i]!, mean) < d2(px[first]!, mean)) first = i;
  const centres: number[][] = [[...px[first]!]];
  const k = Math.min(count, px.length);
  while (centres.length < k) {
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < px.length; i++) {
      const d = Math.min(...centres.map((c) => d2(px[i]!, c)));
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    centres.push([...px[best]!]);
  }
  const assign = new Int32Array(px.length);
  for (let it = 0; it < iterations; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      let bi = 0;
      for (let c = 1; c < centres.length; c++) if (d2(px[i]!, centres[c]!) < d2(px[i]!, centres[bi]!)) bi = c;
      assign[i] = bi;
      const s = sum[bi]!;
      s[0]! += px[i]![0];
      s[1]! += px[i]![1];
      s[2]! += px[i]![2];
      s[3]! += 1;
    }
    sum.forEach((s, c) => {
      if (s[3]! > 0) centres[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
  }
  const sizes = centres.map((_, c) => ({ c, n: 0 }));
  for (let i = 0; i < px.length; i++) sizes[assign[i]!]!.n++;
  return sizes
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || a.c - b.c)
    .map(({ c }) => toHex(centres[c]![0]!, centres[c]![1]!, centres[c]![2]!));
}

/** Palettes already computed in this page, by asset and colour count. */
const paletteCache = new Map<string, string[]>();

/** Neutral greys used when the palette cannot be computed (Node, decoding failure). */
export function fallbackPalette(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const v = 70 + (150 * i) / Math.max(1, count - 1);
    return toHex(v, v * 0.97, v * 0.92);
  });
}

/** Palette of a decoded image, sampled on a small canvas (64 px wide); cached per asset. */
export function computePalette(ctx: EngineContext, asset: string, img: ArtImageData | null, count: number): string[] {
  const key = `${asset}|${count}`;
  const hit = paletteCache.get(key);
  if (hit) return hit;
  if (!img || !ctx.createCanvas) return fallbackPalette(count);
  try {
    const w = 64;
    const h = Math.max(1, Math.round((w * img.bitmap.height) / img.bitmap.width));
    const canvas = ctx.createCanvas(w, h);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return fallbackPalette(count);
    g.drawImage(img.bitmap, 0, 0, w, h);
    const colours = paletteFromPixels(g.getImageData(0, 0, w, h).data, count);
    const out = colours.length ? colours : fallbackPalette(count);
    paletteCache.set(key, out);
    return out;
  } catch (e) {
    console.warn("[art] palette not computed:", e);
    return fallbackPalette(count);
  }
}
