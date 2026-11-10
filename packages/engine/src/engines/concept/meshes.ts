// three.js builders for the concept engine: tiles, text textures, labels, shapes, axes.
// Text needs ctx.createCanvas; without it (Node tests) only geometry is built.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { ConceptAxis, ConceptShape } from "@pv/scene-spec";
import type { EngineContext } from "../../types.ts";
import { SHAPE_T, SUB_H, TEXT_H, TILE_DEPTH, type Variant } from "./plan.ts";
import { maybeFormula } from "../../util/math-text.ts";

export const INK = "#28303c";
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Canvas pixels per scene unit for tile text (crisp on phones at DPR 3). */
const PX = 220;
/** Cap height / font size of a typical sans-serif. */
const CAP = 0.7;
const GLOW = "#ffcf3f";

export const standard = (color: THREE.ColorRepresentation) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** White text with a soft dark outline: readable on any role colour, so colours can change freely. */
function tileTexture(ctx: EngineContext, v: Variant, h: number): THREE.CanvasTexture | null {
  if (!ctx.createCanvas) return null;
  const cw = Math.min(4096, Math.ceil(v.width * PX));
  const ch = Math.ceil(h * PX);
  const canvas = ctx.createCanvas(cw, ch);
  const g = canvas.getContext("2d");
  if (!g) return null;
  const maxW = cw - 0.32 * h * PX;
  const line = (text: string, capH: number, cy: number, weight: number, alpha: number) => {
    let size = (capH * h * PX) / CAP;
    g.fillStyle = `rgba(255,255,255,${alpha})`;
    if (maybeFormula(ctx, g, text, cw / 2, cy, size * 1.05, { maxWidth: maxW, bold: weight >= 700, stroke: { width: size * 0.16, style: "rgba(15,20,30,0.38)" } })) return;
    g.font = `${weight} ${size}px ${FONT}`;
    const w = g.measureText(text).width;
    if (w > maxW) {
      size *= maxW / w;
      g.font = `${weight} ${size}px ${FONT}`;
    }
    g.lineJoin = "round";
    g.lineWidth = size * 0.16;
    g.strokeStyle = "rgba(15,20,30,0.38)";
    g.strokeText(text, cw / 2, cy);
    g.fillStyle = `rgba(255,255,255,${alpha})`;
    g.fillText(text, cw / 2, cy);
  };
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (v.sub) {
    line(v.text, TEXT_H, ch * 0.42, 800, 1);
    line(v.sub, SUB_H, ch * 0.78, 600, 0.95);
  } else line(v.text, TEXT_H, ch * 0.53, 800, 1);
  return canvasTexture(canvas);
}

/** Pill-shaped caption that always faces the camera; `height` in scene units. Null without canvas. */
export function labelSprite(ctx: EngineContext, text: string, height: number, ink = INK): THREE.Sprite | null {
  if (!ctx.createCanvas) return null;
  const ch = 112;
  const font = `700 ${ch * 0.5}px ${FONT}`;
  const probe = ctx.createCanvas(8, 8).getContext("2d");
  if (!probe) return null;
  probe.font = font;
  const cw = Math.ceil(probe.measureText(text).width + ch * 0.8);
  const canvas = ctx.createCanvas(cw, ch);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.roundRect(2, 2, cw - 4, ch - 4, (ch - 4) / 2);
  g.fill();
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = ink;
  if (!maybeFormula(ctx, g, text, cw / 2, ch * 0.5, ch * 0.52, { maxWidth: cw - ch * 0.5, bold: true })) g.fillText(text, cw / 2, ch * 0.53);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  sprite.scale.set((height * cw) / ch, height, 1);
  sprite.userData.aspect = cw / ch;
  return sprite;
}

export interface TileMesh {
  /** At the bottom-centre of the tile. */
  group: THREE.Group;
  /** At the tile centre; rotates for the text flip. */
  pivot: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  outline: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  geos: THREE.BufferGeometry[];
  faces: (THREE.Mesh | null)[];
  widths: number[];
  h: number;
  depth: number;
  shown: number;
}

export function buildTile(ctx: EngineContext, id: string, variants: Variant[], h: number, color: string): TileMesh {
  const depth = TILE_DEPTH * h;
  const group = new THREE.Group();
  group.name = `tile:${id}`;
  const pivot = new THREE.Group();
  pivot.position.y = h / 2;
  group.add(pivot);
  const geos = variants.map((v) => new RoundedBoxGeometry(v.width, h, depth, 4, 0.14 * h));
  const body = new THREE.Mesh(geos[0]!, standard(color));
  const outline = new THREE.Mesh(
    geos[0]!,
    new THREE.MeshBasicMaterial({ color: GLOW, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }),
  );
  pivot.add(body, outline);
  const faces = variants.map((v) => {
    const tex = tileTexture(ctx, v, h);
    if (!tex) return null;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(v.width, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    face.position.z = depth / 2 + 0.004;
    face.visible = false;
    pivot.add(face);
    return face;
  });
  return { group, pivot, body, outline, geos, faces, widths: variants.map((v) => v.width), h, depth, shown: -1 };
}

/** Swaps geometry and text to variant i (idempotent). */
export function showVariant(m: TileMesh, i: number): void {
  if (m.shown === i) return;
  m.shown = i;
  m.body.geometry = m.geos[i]!;
  m.outline.geometry = m.geos[i]!;
  const pad = 0.16;
  m.outline.scale.set((m.widths[i]! + pad) / m.widths[i]!, (m.h + pad) / m.h, (m.depth + pad) / m.depth);
  m.faces.forEach((f, k) => f && (f.visible = k === i));
}

// ---------- shapes ----------

const LIGHT = "#ece6da";

function shape2d(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}
function sector(r: number, a0: number, a1: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.absarc(0, 0, r, a0, a1, false);
  s.closePath();
  return s;
}
const DEG = Math.PI / 180;

/** Group at the place point; `main` is the role-coloured material (glow, colour changes). */
export function buildShape(def: ConceptShape, color: string): { group: THREE.Group; main: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  group.name = `shape:${def.id}`;
  const main = standard(color);
  const light = standard(LIGHT);
  const parts: { shape: THREE.Shape; mat: THREE.Material; lift?: number }[] = [];
  switch (def.kind) {
    case "polygon":
      parts.push({ shape: shape2d(def.points), mat: main });
      break;
    case "circle":
      parts.push({ shape: sector(def.radius, 0, 2 * Math.PI), mat: main });
      break;
    case "pie": {
      const step = (2 * Math.PI) / def.parts;
      for (let i = 0; i < def.parts; i++) {
        const a0 = Math.PI / 2 - (i + 1) * step;
        const s = sector(def.radius, a0, a0 + step);
        // Small gap between slices: push each slice out along its bisector.
        const mid = a0 + step / 2;
        const off = def.parts > 1 ? 0.04 * def.radius : 0;
        const moved = new THREE.Shape(s.getPoints(24).map((p) => new THREE.Vector2(p.x + off * Math.cos(mid), p.y + off * Math.sin(mid))));
        parts.push({ shape: moved, mat: i < def.filled ? main : light });
      }
      break;
    }
    case "bar": {
      const cell = def.length / def.parts;
      const hh = cell * 0.5;
      for (let i = 0; i < def.parts; i++) {
        const x0 = -def.length / 2 + i * cell + 0.03;
        const x1 = x0 + cell - 0.06;
        parts.push({ shape: shape2d([[x0, 0], [x1, 0], [x1, hh * 2], [x0, hh * 2]]), mat: i < def.filled ? main : light });
      }
      break;
    }
    case "angle": {
      const arm = 0.06 * def.radius;
      parts.push({ shape: sector(def.radius * 0.6, def.from * DEG, def.to * DEG), mat: main });
      for (const a of [def.from, def.to]) {
        const c = Math.cos(a * DEG);
        const s = Math.sin(a * DEG);
        parts.push({
          shape: shape2d([[-s * arm, c * arm], [def.radius * c - s * arm, def.radius * s + c * arm], [def.radius * c + s * arm, def.radius * s - c * arm], [s * arm, -c * arm]]),
          mat: standard(INK),
          lift: 0.02,
        });
      }
      break;
    }
  }
  for (const p of parts) {
    const geo = new THREE.ExtrudeGeometry(p.shape, { depth: SHAPE_T, bevelEnabled: false });
    if (def.upright) geo.translate(0, 0, -SHAPE_T / 2);
    else geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, p.mat);
    if (p.lift) mesh.position[def.upright ? "z" : "y"] = p.lift;
    group.add(mesh);
  }
  return { group, main };
}

// ---------- axes ----------

export interface AxisMesh {
  group: THREE.Group;
  /** Unit-length bar scaled along local x by the draw progress. */
  bar: THREE.Mesh;
  head: THREE.Mesh | null;
  ticks: { mesh: THREE.Mesh; frac: number }[];
  labels: { sprite: THREE.Sprite; frac: number; pos: THREE.Vector3; h: number }[];
  mat: THREE.MeshStandardMaterial;
}

/** Local frame: the axis is built along +x and rotated to its direction. */
export function axisPoint(a: ConceptAxis, frac: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.set(...a.origin);
  const d = frac * a.length;
  if (a.direction === "x") out.x += d;
  if (a.direction === "y") out.y += d;
  if (a.direction === "z") out.z += d;
  return out;
}

/** Where an axis caption goes for a point of the axis (in front, or to the left of vertical axes). */
function captionPos(a: ConceptAxis, frac: number): THREE.Vector3 {
  const p = axisPoint(a, frac);
  if (a.direction === "x") return p.add(new THREE.Vector3(0, 0.4, 0.9));
  if (a.direction === "y") return p.add(new THREE.Vector3(-0.9, 0, 0));
  return p.add(new THREE.Vector3(-1.0, 0.32, 0));
}

export function buildAxis(ctx: EngineContext, a: ConceptAxis, color: string, roleColor: (r?: string) => string): AxisMesh {
  const group = new THREE.Group();
  group.name = `axis:${a.id}`;
  const dir = new THREE.Group();
  dir.position.set(...a.origin);
  if (a.direction === "y") dir.rotation.z = Math.PI / 2;
  if (a.direction === "z") dir.rotation.y = -Math.PI / 2;
  group.add(dir);
  const mat = standard(color);
  const T = 0.16;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1, T, T).translate(0.5, T / 2, 0), mat);
  dir.add(bar);
  let head: THREE.Mesh | null = null;
  if (a.arrow ?? true) {
    head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 16).rotateZ(-Math.PI / 2), mat);
    head.position.set(a.length + 0.3, T / 2, 0);
    dir.add(head);
  }
  const span = a.max - a.min;
  const ticks = a.labels.map((l) => {
    const frac = (l.value - a.min) / span;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.7), standard(roleColor(l.role ?? a.role)));
    mesh.position.set(frac * a.length, 0.17, 0);
    dir.add(mesh);
    return { mesh, frac };
  });
  const labels: AxisMesh["labels"] = [];
  a.labels.forEach((l) => {
    const frac = (l.value - a.min) / span;
    const sprite = labelSprite(ctx, l.text, 0.75);
    if (!sprite) return;
    const pos = captionPos(a, frac);
    group.add(sprite);
    labels.push({ sprite, frac, pos, h: 0.75 });
  });
  if (a.title) {
    const sprite = labelSprite(ctx, a.title, 0.5);
    if (sprite) {
      const pos = axisPoint(a, 1).add(a.direction === "y" ? new THREE.Vector3(0, 1.0, 0) : new THREE.Vector3(1.4, 0.6, 0));
      group.add(sprite);
      labels.push({ sprite, frac: 1, pos, h: 0.5 });
    }
  }
  return { group, bar, head, ticks, labels, mat };
}

/** Caption anchor of the k-th axis label. */
export function axisLabelPos(a: ConceptAxis, k: number): THREE.Vector3 | null {
  const l = a.labels[k];
  return l ? captionPos(a, (l.value - a.min) / (a.max - a.min)) : null;
}
