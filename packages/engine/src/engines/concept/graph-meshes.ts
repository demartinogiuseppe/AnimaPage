// three.js helpers for graphs: fixed-capacity dynamic geometry (curves and surfaces are rebuilt
// in place when parameters move, without reallocating), planar tubes with per-segment x for
// progressive drawing, text sprites (static and live), colours.
import * as THREE from "three";
import type { EngineContext } from "../../types.ts";
import { FONT, INK } from "./meshes.ts";
import { maybeFormula } from "../../util/math-text.ts";
import type { V3 } from "./plan.ts";

/** Geometry with preallocated position/normal(/colour) and index buffers, refilled in place. */
export class DynGeo {
  readonly geometry = new THREE.BufferGeometry();
  readonly pos: Float32Array;
  readonly nor: Float32Array;
  readonly col: Float32Array | null;
  readonly idx: Uint32Array;
  nv = 0;
  ni = 0;

  constructor(maxVerts: number, maxIndices: number, colors = false) {
    this.pos = new Float32Array(maxVerts * 3);
    this.nor = new Float32Array(maxVerts * 3);
    this.col = colors ? new Float32Array(maxVerts * 3) : null;
    this.idx = new Uint32Array(maxIndices);
    const usage = THREE.DynamicDrawUsage;
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(usage));
    this.geometry.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3).setUsage(usage));
    if (this.col) this.geometry.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(usage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(usage));
    this.geometry.setDrawRange(0, 0);
  }
  get vertexCapacity() {
    return this.pos.length / 3;
  }
  begin(): void {
    this.nv = 0;
    this.ni = 0;
  }
  /** Returns the vertex index, or -1 when full. */
  vertex(x: number, y: number, z: number, nx = 0, ny = 0, nz = 1): number {
    if (this.nv >= this.vertexCapacity) return -1;
    const o = this.nv * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.nor[o] = nx;
    this.nor[o + 1] = ny;
    this.nor[o + 2] = nz;
    return this.nv++;
  }
  color(i: number, c: THREE.Color): void {
    if (!this.col || i < 0) return;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
  }
  tri(a: number, b: number, c: number): void {
    if (a < 0 || b < 0 || c < 0 || this.ni + 3 > this.idx.length) return;
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }
  end(): void {
    const g = this.geometry;
    for (const name of ["position", "normal", "color"]) {
      const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (a) {
        a.needsUpdate = true;
        a.clearUpdateRanges();
      }
    }
    g.index!.needsUpdate = true;
    g.setDrawRange(0, this.ni);
  }
}

/** Per-segment x range and first index of a tube, for drawing a partial x window. */
export interface TubeSegments {
  u0: number[];
  u1: number[];
  idx: number[];
  /** Indices per segment. */
  stride: number;
}

export const TUBE_RADIAL = 10;
const DASH = 0.22;

/**
 * Fills `dg` with a tube along planar pieces (the plane normal is board +z). `us` holds the
 * maths x of every point, so a partial x window maps to an index range (segments are written
 * in x order). Dashed tubes skip every other DASH of arc length.
 */
export function writeTube(dg: DynGeo, pieces: V3[][], us: number[][], radius: number, dashed = false): TubeSegments {
  dg.begin();
  const seg: TubeSegments = { u0: [], u1: [], idx: [], stride: TUBE_RADIAL * 6 };
  const R = TUBE_RADIAL;
  pieces.forEach((pts, pi) => {
    const u = us[pi]!;
    let s = 0;
    let base = -1;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      // In-plane normal (−ty, tx, 0) and the plane normal (0, 0, 1).
      const first = dg.nv;
      for (let k = 0; k < R; k++) {
        const th = (2 * Math.PI * k) / R;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        const nx = -ty * c;
        const ny = tx * c;
        const nz = sn;
        dg.vertex(p[0] + radius * nx, p[1] + radius * ny, p[2] + radius * nz, nx, ny, nz);
      }
      if (i > 0 && base >= 0) {
        const q = pts[i - 1]!;
        const len = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const mid = s + len / 2;
        s += len;
        if (!dashed || Math.floor(mid / DASH) % 2 === 0) {
          seg.u0.push(u[i - 1]!);
          seg.u1.push(u[i]!);
          seg.idx.push(dg.ni);
          for (let k = 0; k < R; k++) {
            const a0 = base + k;
            const a1 = base + ((k + 1) % R);
            const b0 = first + k;
            const b1 = first + ((k + 1) % R);
            dg.tri(a0, b0, a1);
            dg.tri(a1, b0, b1);
          }
        }
      }
      base = first;
    }
  });
  dg.end();
  return seg;
}

/** Draw range covering the segments inside the x window [a, b]. */
export function windowRange(seg: TubeSegments, a: number, b: number): { start: number; count: number } {
  const eps = 1e-9;
  let i0 = -1;
  let i1 = -1;
  for (let i = 0; i < seg.u0.length; i++) {
    if (seg.u0[i]! >= a - eps && seg.u1[i]! <= b + eps) {
      if (i0 < 0) i0 = i;
      i1 = i;
    }
  }
  if (i0 < 0) return { start: 0, count: 0 };
  return { start: seg.idx[i0]!, count: seg.idx[i1]! + seg.stride - seg.idx[i0]! };
}

// ---------- text ----------

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Plain text with a white halo (tick numbers, axis names). Null without canvas. */
export function textSprite(ctx: EngineContext, text: string, height: number, ink = INK, weight = 700): THREE.Sprite | null {
  if (!ctx.createCanvas) return null;
  const ch = 96;
  const font = `${weight} ${ch * 0.62}px ${FONT}`;
  const probe = ctx.createCanvas(8, 8).getContext("2d");
  if (!probe) return null;
  probe.font = font;
  const cw = Math.ceil(probe.measureText(text).width + ch * 0.4);
  const canvas = ctx.createCanvas(cw, ch);
  const g = canvas.getContext("2d")!;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = ch * 0.14;
  g.strokeStyle = "rgba(255,255,255,0.92)";
  g.fillStyle = ink;
  if (!maybeFormula(ctx, g, text, cw / 2, ch * 0.5, ch * 0.64, { maxWidth: cw - ch * 0.3, bold: weight >= 700, stroke: { width: ch * 0.14, style: "rgba(255,255,255,0.92)" } })) {
    g.strokeText(text, cw / 2, ch * 0.54);
    g.fillText(text, cw / 2, ch * 0.54);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(canvas), transparent: true, depthWrite: false }));
  sprite.scale.set((height * cw) / ch, height, 1);
  sprite.userData.aspect = cw / ch;
  sprite.renderOrder = 5;
  return sprite;
}

/**
 * Pill label whose text can change every frame (live coordinates, readouts): one canvas of
 * fixed size, redrawn only when the text changes. Lines are drawn centred; `accent` colours
 * the pill border.
 */
export class LiveLabel {
  readonly sprite: THREE.Sprite | null;
  private readonly g: CanvasRenderingContext2D | null = null;
  private readonly tex: THREE.CanvasTexture | null = null;
  private readonly cw: number;
  private readonly ch: number;
  private text = "\u0000";
  readonly height: number;
  private readonly typeset: boolean;

  constructor(
    ctx: EngineContext,
    height: number,
    private readonly lines: number,
    private readonly accent: string,
    widthEm = 14,
  ) {
    this.height = height;
    this.typeset = !!ctx.typesetFormulas;
    const lh = 80;
    this.ch = Math.round(lh * lines + 30);
    this.cw = Math.round(widthEm * lh * 0.5);
    const canvas = ctx.createCanvas?.(this.cw, this.ch);
    const g = canvas?.getContext("2d") ?? null;
    if (!canvas || !g) {
      this.sprite = null;
      return;
    }
    this.g = g;
    this.tex = texture(canvas);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false }));
    this.sprite.renderOrder = 10;
    this.sprite.scale.set((height * this.cw) / this.ch, height, 1);
  }

  set(text: string): void {
    if (text === this.text || !this.g || !this.tex) return;
    this.text = text;
    const g = this.g;
    const rows = text.split("\n").slice(0, this.lines);
    const lh = (this.ch - 30) / this.lines;
    const font = `700 ${lh * 0.62}px ${FONT}`;
    g.clearRect(0, 0, this.cw, this.ch);
    g.font = font;
    let w = 0;
    for (const r of rows) w = Math.max(w, g.measureText(r).width);
    w = Math.min(this.cw - 8, w + lh * 0.8);
    const h = lh * rows.length + 18;
    const x0 = (this.cw - w) / 2;
    const y0 = (this.ch - h) / 2;
    if (rows.length && text) {
      g.fillStyle = "rgba(255,255,255,0.94)";
      g.strokeStyle = this.accent;
      g.lineWidth = 6;
      g.beginPath();
      g.roundRect(x0, y0, w, h, Math.min(h / 2, lh * 0.5));
      g.fill();
      g.stroke();
      g.fillStyle = INK;
      g.textAlign = "center";
      g.textBaseline = "middle";
      rows.forEach((r, i) => {
        const y = y0 + 9 + lh * (i + 0.5);
        if (!maybeFormula({ typesetFormulas: this.typeset }, g, r, this.cw / 2, y, lh * 0.66, { maxWidth: w - lh * 0.5, bold: true })) g.fillText(r, this.cw / 2, y0 + 9 + lh * (i + 0.54));
      });
    }
    this.tex.needsUpdate = true;
  }
}

/** Soft round glow (beads). Null without canvas. */
export function haloTexture(ctx: EngineContext): THREE.CanvasTexture | null {
  const canvas = ctx.createCanvas?.(64, 64);
  const g = canvas?.getContext("2d");
  if (!canvas || !g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32) as CanvasGradient | undefined;
  if (!grad) return null;
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return texture(canvas);
}

// ---------- colours ----------

export const GRAPH_COLORS = {
  panel: "#f9fbfe",
  rim: "#3e4c5e",
  gridMinor: "#dbe4ee",
  gridMajor: "#b9c7d6",
  axis: "#263241",
  plots: ["#2f6fd6", "#e0603a", "#8a4fd0", "#1c9a6c"],
  ghost: "#a78bfa",
  positive: "#22a565",
  negative: "#e5484d",
  interval: "#0f9fa8",
  tracer: "#ff8c1a",
  flat: "#16a34a",
  asymptote: "#d1495b",
  symmetry: "#7a5cc4",
  guide: "#7b8794",
  point: {
    zero: "#e0603a",
    vertex: "#d6336c",
    max: "#d6336c",
    min: "#d6336c",
    inflection: "#8a4fd0",
    "y-intercept": "#1c9a6c",
    point: "#2f6fd6",
  },
} as const;

const RAMP = ["#2c3e9e", "#2476c9", "#17a2b8", "#3fbf7f", "#b8d43a", "#f6b93b", "#f0743b"].map((c) => new THREE.Color(c));

/** Height colormap, t in 0..1 (deep blue -> teal -> green -> yellow -> orange). */
export function heightColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return out.copy(RAMP[i]!).lerp(RAMP[i + 1]!, x - i);
}
