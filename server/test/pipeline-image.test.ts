import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkImage, ImageError, preparePhoto } from "../src/image.ts";

/** Synthetic JPEG (never a book photo) with an EXIF orientation tag. */
async function synthetic(width: number, height: number, orientation?: number): Promise<Buffer> {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg();
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer();
}

describe("preparePhoto", () => {
  it("applies the EXIF rotation and drops the metadata", async () => {
    const input = await synthetic(400, 200, 6); // 6 = rotate 90° clockwise to display
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const p = await preparePhoto(input);
    expect([p.width, p.height]).toEqual([200, 400]);
    const meta = await sharp(p.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([200, 400]);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it("downscales the longest side and never enlarges", async () => {
    const big = await preparePhoto(await synthetic(3200, 1000), { maxSide: 1600 });
    expect([big.width, big.height]).toEqual([1600, 500]);
    const small = await preparePhoto(await synthetic(300, 200), { maxSide: 1600 });
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it("gives the same cache key for the same photo", async () => {
    const input = await synthetic(800, 600, 3);
    const [a, b] = await Promise.all([preparePhoto(input), preparePhoto(Buffer.from(input))]);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sha256).toBe(b.sha256);
    expect((await preparePhoto(await synthetic(800, 601))).sha256).not.toBe(a.sha256);
  });

  it("rejects files that are not images", async () => {
    const junk = Buffer.from("definitely not an image");
    await expect(preparePhoto(junk)).rejects.toBeInstanceOf(ImageError);
    expect(await checkImage(junk)).toBe("bad");
    expect(await checkImage(await synthetic(10, 10))).toBe("ok");
  });
});
