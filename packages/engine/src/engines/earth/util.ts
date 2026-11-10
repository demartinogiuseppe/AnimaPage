// Small pure helpers of the earth engine: presence envelopes, polylines, Italian number format,
// canvas labels (skipped in Node), material helpers.
import * as THREE from "three";
import { decimalMark, groupMark } from "@pv/scene-spec/i18n";
import type { EngineContext } from "../../types.ts";
import { clamp } from "../../util/math.ts";

export const FADE = 0.8;

/** 0..1 presence of an element with optional fade-in `at` and fade-out `until`. */
export function presence(t: number, at: number | undefined, until: number | undefined): number {
  const a = at === undefined ? 1 : clamp((t - at) / FADE);
  const b = until === undefined ? 1 : clamp((until - t) / FADE);
  return Math.min(a, b);
}

/** 1 inside any window (with soft edges), else 0. */
export function windows(t: number, ws: readonly (readonly [number, number])[] | undefined, edge = 0.4): number {
  let v = 0;
  for (const [a, b] of ws ?? []) v = Math.max(v, Math.min(clamp((t - a) / edge + 1), clamp((b - t) / edge + 1)));
  return v;
}

/** Latest start time <= t, or null. */
export function latest(times: readonly number[] | undefined, t: number): number | null {
  let best: number | null = null;
  for (const x of times ?? []) if (x <= t && (best === null || x > best)) best = x;
  return best;
}

/** Arc-length parametrised polyline. */
export class Polyline {
  readonly cum: number[] = [0];
  constructor(readonly pts: THREE.Vector3[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  }
  get length(): number {
    return this.cum[this.cum.length - 1]!;
  }
  /** Point at distance d (clamped). */
  at(d: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.pts.length;
    if (n === 1 || d <= 0) return out.copy(this.pts[0]!);
    if (d >= this.length) return out.copy(this.pts[n - 1]!);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const span = this.cum[hi]! - this.cum[lo]!;
    return out.lerpVectors(this.pts[lo]!, this.pts[hi]!, span > 0 ? (d - this.cum[lo]!) / span : 0);
  }
  /** Number of leading points within distance d (for drawRange). */
  countTo(d: number): number {
    let i = 0;
    while (i < this.cum.length && this.cum[i]! <= d) i++;
    return i;
  }
}

/** Number in the lesson's locale; Italian: thousands with ".", decimals with ",". */
export function fmt(x: number, decimals = 0): string {
  const s = Math.abs(x).toFixed(decimals);
  const [int, dec] = s.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, groupMark());
  return `${x < 0 && Number(s) !== 0 ? "−" : ""}${grouped}${dec ? `${decimalMark()}${dec}` : ""}`;
}

/** Up to 2 decimals, trailing zeros dropped (7.55 -> "7,55", 7.5 -> "7,5", 3 -> "3"). */
export function fmtDec(x: number): string {
  const r = Math.round(x * 100) / 100;
  return fmt(r, Math.abs(r - Math.round(r)) < 1e-9 ? 0 : Math.abs(r * 10 - Math.round(r * 10)) < 1e-9 ? 1 : 2);
}

/** Rounds to a "nice" value for a readout (2 significant digits above 100). */
export function nice(x: number): number {
  if (Math.abs(x) < 100) return Math.round(x);
  const p = 10 ** (Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(x / p) * p;
}

export const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, ...extra });

export const basic = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: opacity >= 1 });

export function setOpacity(m: THREE.Material, base: number, k: number): void {
  m.opacity = base * k;
  const transparent = base < 1 || k < 0.999;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Camera-facing text panel (1–2 lines) that redraws only when its text changes. Empty Object3D in Node. */
export class Label {
  readonly object: THREE.Object3D;
  private canvas: HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private text = "";

  /** `height`: scene units per text line. */
  constructor(ctx: EngineContext, private readonly height: number) {
    const canvas = ctx.createCanvas?.(512, 128) ?? null;
    this.object = new THREE.Object3D();
    if (!canvas || !canvas.getContext("2d")) return;
    this.canvas = canvas;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false }));
    sprite.renderOrder = 6;
    this.object = sprite;
  }

  set(text: string): void {
    if (text === this.text || !this.canvas || !this.tex) return;
    this.text = text;
    let g = this.canvas.getContext("2d")!;
    const lines = text.split("\n");
    const size = 64;
    g.font = `700 ${size}px ${FONT}`;
    // Fit the canvas to the text (no squeezed glyphs), padding included.
    const W = Math.min(2048, Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width)) + 64));
    const H = Math.ceil(lines.length * size * 1.25 + 40);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
      this.tex.dispose();
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      (this.object as THREE.Sprite).material.map = this.tex;
      g = this.canvas.getContext("2d")!;
    }
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(255,253,247,0.94)";
    g.strokeStyle = "#28303c";
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(3, 3, W - 6, H - 6, 26);
    g.fill();
    g.stroke();
    g.font = `700 ${size}px ${FONT}`;
    g.fillStyle = "#28303c";
    g.textAlign = "center";
    g.textBaseline = "middle";
    lines.forEach((l, i) => g.fillText(l, W / 2, 20 + size * 1.25 * (i + 0.5)));
    this.tex.needsUpdate = true;
    const h = this.height * (lines.length * 1.25 * size + 40) / (1.25 * size + 40);
    (this.object as THREE.Sprite).scale.set((h * W) / H, h, 1);
  }

  dispose(): void {
    this.tex?.dispose();
    if (this.object instanceof THREE.Sprite) this.object.material.dispose();
  }
}
