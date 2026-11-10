// Generates the PWA icons from apps/web/icons/icon.svg into fixtures/public/icons/ (Vite's publicDir).
// Run from the repo root: `pnpm icons:web` (tsx). sharp is a dependency of @pv/server, resolved from there.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
interface Sharp {
  resize(w: number, h: number): Sharp;
  png(): Sharp;
  toBuffer(): Promise<Buffer>;
}
const sharp = createRequire(here("../../../server/package.json"))("sharp") as (input: Buffer, o?: { density: number }) => Sharp;

const svg = readFileSync(here("../icons/icon.svg"), "utf8");
const outDir = here("../../../fixtures/public/icons/");
mkdirSync(outDir, { recursive: true });

/** Full-bleed square with the drawing scaled into the maskable safe zone (centre circle, r = 40%). */
function fullBleed(scale: number): string {
  return svg
    .replace('rx="112"', 'rx="0"')
    .replace('<g id="art">', `<g id="art" transform="translate(256 256) scale(${scale}) translate(-256 -256)">`);
}

async function png(source: string, size: number, name: string): Promise<void> {
  const buf = await sharp(Buffer.from(source), { density: 300 }).resize(size, size).png().toBuffer();
  writeFileSync(outDir + name, buf);
  console.log(`${name}  ${size}x${size}  ${buf.length} B`);
}

writeFileSync(outDir + "icon.svg", svg);
await png(svg, 192, "icon-192.png");
await png(svg, 512, "icon-512.png");
await png(fullBleed(0.8), 512, "icon-maskable-512.png");
await png(fullBleed(0.9), 180, "apple-touch-icon.png");
