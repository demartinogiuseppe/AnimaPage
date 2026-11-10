// Photo preprocessing before analysis: EXIF auto-rotation, downscale, JPEG re-encode.
//
// Re-encoding also drops all metadata (EXIF, GPS, camera serials): sharp does not copy it
// unless asked. The processed bytes are the input of the page cache key.
import sharp from "sharp";
import { sha256 } from "./llm/mock.ts";

/**
 * Longest side after downscaling. Measured live on the Campania page (opus, 2026-11-03):
 * original 4080 px -> 8169 input tokens; 2000 px -> 8124 (same detail, all map heights read);
 * 1600 px -> 6788 (lost a small map label). Time ~30 s in all cases. See docs/dev-setup.md.
 */
export const DEFAULT_MAX_SIDE = 2000;
export const DEFAULT_JPEG_QUALITY = 85;
/**
 * Larger images are refused before decoding (docs/security.md, H2): a small, well-compressed PNG can
 * decode to gigabytes. The app scales phone photos to DEFAULT_MAX_SIDE before upload (live mode).
 */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Formats accepted as a photo (no SVG, TIFF, GIF, PDF... although sharp could decode them). */
const PHOTO_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif"]);

export interface PreparedPhoto {
  data: Buffer;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  /** SHA-256 (hex) of `data`: the page cache key. */
  sha256: string;
}

export interface PrepareOptions {
  maxSide?: number;
  quality?: number;
}

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

/** Header check (cheap: no full decode): "ok", "bad" (not a photo sharp can decode) or "tooBig" (pixels). */
export async function checkImage(data: Buffer): Promise<"ok" | "bad" | "tooBig"> {
  try {
    const m = await sharp(data, { limitInputPixels: false }).metadata();
    if (!m.width || !m.height || !PHOTO_FORMATS.has(m.format)) return "bad";
    return m.width * m.height > MAX_INPUT_PIXELS ? "tooBig" : "ok";
  } catch {
    return "bad";
  }
}

export async function preparePhoto(input: Buffer, opts: PrepareOptions = {}): Promise<PreparedPhoto> {
  const maxSide = opts.maxSide ?? DEFAULT_MAX_SIDE;
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // applies the EXIF orientation, then the tag is dropped
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: opts.quality ?? DEFAULT_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, mediaType: "image/jpeg", width: info.width, height: info.height, sha256: sha256(data) };
  } catch (e) {
    throw new ImageError(`Cannot decode image: ${e instanceof Error ? e.message : String(e)}`);
  }
}
