// three.js helpers for the lab engine: materials, text (canvas; skipped in Node), arrows, tubes.
import * as THREE from "three";
import type { EngineContext } from "../../types.ts";
import { maybeFormula } from "../../util/math-text.ts";

export const INK = "#28303c";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra });

/** Marks an object as a key element (keeps its colours in china style, see book/ink.ts). */
export function key<T extends THREE.Object3D>(o: T, on = true): T {
  o.userData.key = on;
  return o;
}

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material, name = ""): THREE.Mesh {
  const x = new THREE.Mesh(geo, m);
  x.name = name;
  return x;
}

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Camera-facing text that redraws only when its text changes. Without a canvas (Node) it is an empty object. */
export class Label {
  readonly object: THREE.Object3D;
  private canvas: HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private text = "";

  constructor(
    ctx: EngineContext,
    private readonly height: number,
    private readonly ink = INK,
    private readonly pill = true,
  ) {
    const canvas = ctx.createCanvas?.(512, 112) ?? null;
    if (!canvas || !canvas.getContext("2d")) {
      this.object = new THREE.Object3D();
      return;
    }
    this.canvas = canvas;
    this.tex = texture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    sprite.renderOrder = 5;
    this.object = sprite;
  }

  set(text: string): void {
    if (text === this.text || !this.canvas || !this.tex) return;
    this.text = text;
    const g = this.canvas.getContext("2d")!;
    const ch = 112;
    const font = `700 ${ch * 0.5}px ${FONT}`;
    g.font = font;
    const cw = Math.min(2048, Math.ceil(g.measureText(text).width + ch * 0.8));
    if (this.canvas.width !== cw) {
      this.canvas.width = cw;
      this.tex.dispose();
      this.tex = texture(this.canvas);
      (this.object as THREE.Sprite).material.map = this.tex;
    }
    g.clearRect(0, 0, cw, ch);
    if (this.pill) {
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.roundRect(2, 2, cw - 4, ch - 4, (ch - 4) / 2);
      g.fill();
    }
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = this.ink;
    g.fillText(text, cw / 2, ch * 0.53);
    this.tex.needsUpdate = true;
    this.object.scale.set((this.height * cw) / ch, this.height, 1);
  }

  dispose(): void {
    this.tex?.dispose();
    (this.object as THREE.Sprite).material?.dispose();
  }
}

/** Flat panel with lines of text (the formula board, the timer face). Redraws only on change. */
export class Panel {
  readonly mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement | null;
  private tex: THREE.CanvasTexture | null = null;
  private text = "";

  private typeset: boolean;

  constructor(
    ctx: EngineContext,
    readonly width: number,
    readonly height: number,
    private readonly bg: string,
    private readonly ink: string,
    private readonly px = 200,
  ) {
    this.typeset = !!ctx.typesetFormulas;
    this.canvas = ctx.createCanvas?.(Math.ceil(width * px), Math.ceil(height * px)) ?? null;
    if (this.canvas && !this.canvas.getContext("2d")) this.canvas = null;
    if (this.canvas) this.tex = texture(this.canvas);
    const m = new THREE.MeshStandardMaterial({ color: this.tex ? "#ffffff" : bg, map: this.tex, roughness: 0.9 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
  }

  set(lines: string[]): void {
    const text = lines.join("\n");
    if (text === this.text || !this.canvas || !this.tex) return;
    this.text = text;
    const g = this.canvas.getContext("2d")!;
    const { width: cw, height: ch } = this.canvas;
    g.fillStyle = this.bg;
    g.fillRect(0, 0, cw, ch);
    const n = Math.max(1, lines.length);
    const lh = ch / (n + 0.6);
    const size = lh * 0.62;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = this.ink;
    lines.forEach((l, i) => {
      if (maybeFormula({ typesetFormulas: this.typeset }, g, l, cw / 2, lh * (i + 0.8), size * 1.08, { maxWidth: cw * 0.94, bold: i === 0 })) return;
      g.font = `${i === 0 ? 800 : 650} ${size}px ${FONT}`;
      const w = g.measureText(l).width;
      const s = w > cw * 0.94 ? size * ((cw * 0.94) / w) : size;
      g.font = `${i === 0 ? 800 : 650} ${s}px ${FONT}`;
      g.fillText(l, cw / 2, lh * (i + 0.8));
    });
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex?.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Arrow (shaft + head) of unit geometry, posed with set(). Key element. */
export class Arrow {
  readonly group = new THREE.Group();
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  label: Label | null = null;

  constructor(color: THREE.ColorRepresentation, private readonly radius = 0.06) {
    this.material = mat(color, { emissive: new THREE.Color(color), emissiveIntensity: 0.25 });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0), this.material);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 14).translate(0, 0.5, 0), this.material);
    this.group.add(this.shaft, this.head);
    key(this.group);
  }

  /** From `from` along `dir` (any length) for `length` scene units; length ~0 hides it. */
  set(from: THREE.Vector3, dir: THREE.Vector3, length: number): void {
    const show = length > 0.03 && dir.lengthSq() > 1e-12;
    this.group.visible = show;
    if (!show) return;
    const r = this.radius;
    const headL = Math.min(length * 0.45, r * 4.5);
    this.group.position.copy(from);
    this.group.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    this.shaft.scale.set(r, Math.max(1e-4, length - headL), r);
    this.head.position.set(0, length - headL, 0);
    this.head.scale.set(r * 2.4, headL, r * 2.4);
    if (this.label) this.label.object.position.set(r * 4, length + 0.25, 0);
  }

  dispose(): void {
    this.shaft.geometry.dispose();
    this.head.geometry.dispose();
    this.material.dispose();
    this.label?.dispose();
  }
}

/** Box between two points (wires, rods, strings), thickness `r`. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, round = false): THREE.Mesh {
  const geo = round ? new THREE.CylinderGeometry(r, r, 1, 10) : new THREE.BoxGeometry(r * 2, 1, r * 2);
  const x = new THREE.Mesh(geo, m);
  setRod(x, a, b);
  return x;
}

export function setRod(x: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  x.position.copy(a).addScaledVector(d, 0.5);
  x.scale.set(1, Math.max(len, 1e-4), 1);
  if (len > 1e-9) x.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
}

/** Nice tick step for a ruler of `len` metres (about 10 major ticks). */
export function tickStep(len: number): number {
  const raw = len / 8;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const k of [1, 2, 5, 10]) if (raw <= k * p) return k * p;
  return 10 * p;
}
