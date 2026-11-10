// three.js helpers for the music engine: materials, meshes, flat canvas text (skipped in Node).
import * as THREE from "three";
import type { EngineContext } from "../../types.ts";

export const INK = "#222a35";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra });

export function mesh(geo: THREE.BufferGeometry, m: THREE.Material, name = ""): THREE.Mesh {
  const x = new THREE.Mesh(geo, m);
  x.name = name;
  return x;
}

/** Box from its size and centre. */
export const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, name = "") =>
  mesh(new THREE.BoxGeometry(w, h, d).translate(x, y, z), m, name);

/** Colour of a pitch class (one colour per note letter, shared by heads, keys and rhythm blocks). */
export const NOTE_COLORS: Record<string, string> = {
  C: "#e53935",
  D: "#fb8c00",
  E: "#f2c200",
  F: "#43a047",
  G: "#00a3b4",
  A: "#3949ab",
  B: "#8e24aa",
};
export const noteColor = (pitch: string | null) => (pitch ? (NOTE_COLORS[pitch[0]!] ?? INK) : "#9aa4ae");

/**
 * Flat text on a plane of fixed height (width follows the text), redrawn only when the text changes.
 * Without a canvas (Node tests) it is an empty object.
 */
export class TextPlane {
  readonly object: THREE.Object3D;
  private canvas: HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private text = "";

  constructor(
    ctx: EngineContext,
    private readonly height: number,
    private ink = INK,
    private readonly weight = 700,
    private readonly bg: string | null = null,
  ) {
    const canvas = ctx.createCanvas?.(256, 96) ?? null;
    if (!canvas || !canvas.getContext("2d")) {
      this.object = new THREE.Object3D();
      return;
    }
    this.canvas = canvas;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    m.renderOrder = 4;
    this.object = m;
  }

  set(text: string, ink = this.ink): void {
    if ((text === this.text && ink === this.ink) || !this.canvas || !this.tex) return;
    this.text = text;
    this.ink = ink;
    const g = this.canvas.getContext("2d")!;
    const ch = 96;
    const font = `${this.weight} ${ch * 0.66}px ${FONT}`;
    g.font = font;
    const cw = Math.min(2048, Math.max(ch, Math.ceil(g.measureText(text).width + ch * 0.5)));
    if (this.canvas.width !== cw) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.tex.dispose();
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.material!.map = this.tex;
    }
    g.clearRect(0, 0, cw, ch);
    if (this.bg) {
      g.fillStyle = this.bg;
      g.beginPath();
      g.roundRect(2, 2, cw - 4, ch - 4, 18);
      g.fill();
    }
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = ink;
    g.fillText(text, cw / 2, ch * 0.54);
    this.tex.needsUpdate = true;
    this.object.scale.set((this.height * cw) / ch, this.height, 1);
  }

  dispose(): void {
    this.tex?.dispose();
    this.material?.dispose();
    (this.object as THREE.Mesh).geometry?.dispose();
  }
}
