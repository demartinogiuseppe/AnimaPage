// Text sprites for the chart engine (titles, axis ticks, category and value labels, legend,
// callouts). They need ctx.createCanvas: without it (Node tests) every builder returns null.
import * as THREE from "three";
import type { EngineContext } from "../../types.ts";

export const INK = "#2a2f38";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface LabelStyle {
  ink?: string;
  /** Pill background; omitted = plain text with a white halo. */
  bg?: string;
  /** Coloured square before the text (legend). */
  swatch?: string;
  weight?: number;
  /** Sprite anchor (0.5, 0.5 = centre; 0.5, 0 = bottom centre). */
  center?: [number, number];
}

/** Camera-facing text of `height` scene units. Null without a canvas. */
export function textSprite(ctx: EngineContext, text: string, height: number, style: LabelStyle = {}): THREE.Sprite | null {
  if (!ctx.createCanvas) return null;
  const ch = 96;
  const size = ch * 0.56;
  const font = `${style.weight ?? 700} ${size}px ${FONT}`;
  const probe = ctx.createCanvas(8, 8).getContext("2d");
  if (!probe) return null;
  probe.font = font;
  const pad = style.bg ? ch * 0.42 : ch * 0.14;
  const sw = style.swatch ? ch * 0.62 : 0;
  const cw = Math.ceil(probe.measureText(text).width + 2 * pad + sw);
  const canvas = ctx.createCanvas(cw, ch);
  const g = canvas.getContext("2d")!;
  if (style.bg) {
    g.fillStyle = style.bg;
    g.beginPath();
    g.roundRect(2, 2, cw - 4, ch - 4, (ch - 4) / 2);
    g.fill();
  }
  if (style.swatch) {
    g.fillStyle = style.swatch;
    g.beginPath();
    g.roundRect(pad, ch * 0.24, ch * 0.48, ch * 0.48, ch * 0.1);
    g.fill();
  }
  g.font = font;
  g.textAlign = "left";
  g.textBaseline = "middle";
  if (!style.bg) {
    g.lineJoin = "round";
    g.lineWidth = size * 0.22;
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.strokeText(text, pad + sw, ch * 0.54);
  }
  g.fillStyle = style.ink ?? INK;
  g.fillText(text, pad + sw, ch * 0.54);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set((height * cw) / ch, height, 1);
  if (style.center) sprite.center.set(...style.center);
  sprite.userData.aspect = cw / ch;
  return sprite;
}

/** Shows/hides a label with an opacity; tolerates null (no canvas). */
export function showLabel(s: THREE.Sprite | null | undefined, opacity: number): void {
  if (!s) return;
  s.visible = opacity > 0.01;
  s.material.opacity = Math.min(1, opacity);
}
