// Builds fixtures/public/models/*.glb and the generated catalog block in
// packages/scene-spec/src/engines/diorama.ts from the Kenney kits listed in docs/assets-3d.md.
//
// Usage (Node >= 24, no dependencies):
//   node build-models.mjs <extracted-kits-dir> <repo-root>
// <extracted-kits-dir> holds one folder per kit, named as in PACKS[*].dir (the unzipped Kenney downloads).
//
// What it does per model: copies the GLB, embeds its external textures (Kenney GLBs point to
// Textures/colormap.png) so every file is self-contained, measures the bounding box (node transforms
// applied) and lists the animation clips. Then it rewrites the block between the
// "<catalog:generated>" markers in diorama.ts.
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROWS, PROCEDURAL } from "./catalog-source.mjs";

export const PACKS = {
  ch: { id: "kenney-mini-characters", dir: "mini-characters/Models/GLB format" },
  pet: { id: "kenney-cube-pets", dir: "cube-pets/Models/GLB format" },
  com: { id: "kenney-city-kit-commercial", dir: "city-kit-commercial/Models/GLB format" },
  sub: { id: "kenney-city-kit-suburban", dir: "city-kit-suburban/Models/GLB format" },
  road: { id: "kenney-city-kit-roads", dir: "city-kit-roads/Models/GLB format" },
  fur: { id: "kenney-furniture-kit", dir: "furniture-kit/Models/GLTF format" },
  food: { id: "kenney-food-kit", dir: "food-kit/Models/GLB format" },
  nat: { id: "kenney-nature-kit", dir: "nature-kit/Models/GLTF format" },
  car: { id: "kenney-car-kit", dir: "car-kit/Models/GLB format" },
  surv: { id: "kenney-survival-kit", dir: "survival-kit/Models/GLB format" },
};

/** Clips not exposed in the catalog (wheelchair/shooting poses, the bind pose). */
const HIDDEN_CLIP = /^(static|wheelchair-.*|.*-shoot)$/;

const [, , kitsDir, repo] = process.argv;
if (!kitsDir || !repo) throw new Error("usage: node build-models.mjs <extracted-kits-dir> <repo-root>");
const outDir = join(repo, "fixtures/public/models");
mkdirSync(outDir, { recursive: true });

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len;
  }
  return { json, bin };
}

function writeGlb(json, bin) {
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const j = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const b = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const ch = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([head, ch(j.length, 0x4e4f534a), j, ch(b.length, 0x004e4942), b]);
}

/** Moves external image files into the BIN chunk. */
function embedImages(json, bin, baseDir) {
  for (const img of json.images ?? []) {
    if (!img.uri || img.uri.startsWith("data:")) continue;
    const data = readFileSync(join(baseDir, decodeURIComponent(img.uri)));
    const offset = Math.ceil(bin.length / 4) * 4;
    bin = Buffer.concat([bin, Buffer.alloc(offset - bin.length), data]);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    img.bufferView = json.bufferViews.length - 1;
    img.mimeType = img.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    delete img.uri;
  }
  if (!json.buffers?.length) json.buffers = [{ byteLength: 0 }];
  json.buffers[0].byteLength = bin.length;
  delete json.buffers[0].uri;
  return bin;
}

// --- bounding box with node transforms (column-major 4x4) ---
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function bbox(json) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  const visit = (i, parent) => {
    const n = json.nodes[i];
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const a = json.accessors[p.attributes.POSITION];
        for (let c = 0; c < 8; c++) {
          const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
          for (let k = 0; k < 3; k++) {
            const w = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k];
            mn[k] = Math.min(mn[k], w);
            mx[k] = Math.max(mx[k], w);
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes[json.scene ?? 0].nodes) visit(r, id);
  return mx.map((v, k) => v - mn[k]);
}

const r2 = (v) => Math.round(v * 100) / 100;
const written = new Map(); // "pack/src" -> file
const entries = [];
let total = 0;
for (const [id, pack, src, height, it, en, tags] of ROWS) {
  const p = PACKS[pack];
  if (!p) throw new Error(`unknown pack ${pack}`);
  const key = `${pack}/${src}`;
  const srcPath = join(kitsDir, p.dir, `${src}.glb`);
  const { json, bin } = readGlb(readFileSync(srcPath));
  let file = written.get(key);
  if (!file) {
    file = `models/${id}.glb`;
    const out = writeGlb(json, embedImages(json, bin, dirname(srcPath)));
    writeFileSync(join(repo, "fixtures/public", file), out);
    total += out.length;
    written.set(key, file);
  }
  const box = bbox(json);
  const k = height / box[1];
  // Skinned characters are measured in T-pose: give them a body footprint instead of the arm span.
  const size = tags.includes("person") ? [r2(height * 0.36), height, r2(height * 0.24)] : [r2(box[0] * k), height, r2(box[2] * k)];
  const anims = (json.animations ?? []).map((a) => a.name).filter((n) => !HIDDEN_CLIP.test(n));
  entries.push({ id, file, pack: p.id, it, en, tags, size, ...(anims.length ? { anims } : {}) });
}
for (const [id, pack, , height, it, en, tags] of PROCEDURAL) entries.push({ id, pack, it, en, tags, size: [0.6, height, 1.0] });

const ts = entries.map((e) => `  ${JSON.stringify(e)},`).join("\n");
const specPath = join(repo, "packages/scene-spec/src/engines/diorama.ts");
const spec = readFileSync(specPath, "utf8");
const re = /(\/\/ <catalog:generated>\n)[\s\S]*?( *\/\/ <\/catalog:generated>)/;
if (!re.test(spec)) throw new Error("catalog markers not found in diorama.ts");
writeFileSync(specPath, spec.replace(re, (_m, open, close) => `${open}${ts}\n${close}`));
console.log(`${entries.length} catalog entries, ${written.size} GLB files, ${(total / 1048576).toFixed(2)} MB`);
for (const f of written.values()) if (!statSync(join(repo, "fixtures/public", f)).size) throw new Error(`empty ${f}`);
