// Openings and their trim: arches (voussoirs with a keystone, or a moulded archivolt, on imposts),
// windows (moulded frame, sill on corbels or a balustrade apron, mullion, pediment), portals (frame,
// pediment on brackets), niches, oculi and panels. The functions return the trim only; the hole in the
// wall comes from basic.ts. `windowTrim` and friends stand on the floor level y = 0 (the caller lifts
// them), `archOpening` takes the floor level.
import * as THREE from "three";
import type { FacadeCell } from "@pv/scene-spec";
import { arcPoints, box, merge, profile, runAlongX, slab, sweep, turned, type ProfileStep } from "../profiles.ts";
import { openingPath, roundOpening } from "./basic.ts";
import { balustrade, pediment } from "./crown.ts";

type Cell<K extends FacadeCell["el"]> = Extract<FacadeCell, { el: K }>;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------- arch ----------

/** Voussoirs and the archivolt take this fraction of the radius, outside the opening. */
const ARCH_BAND = 0.25;

/** Radius of an arch in a bay with `clear` metres between the members: the voussoirs fit in the bay too. */
export function archRadius(clear: number, floorHeight: number): number {
  return Math.max(0.1, Math.min((clear / 2 - 0.02) / (1 + ARCH_BAND), floorHeight - 0.3));
}

/** Springing height above the floor: as given, or 55% of the floor, kept under the floor's top. */
export function archSpring(spring: number | undefined, clear: number, floorHeight: number): number {
  const r = archRadius(clear, floorHeight);
  return Math.max(0.05, Math.min(spring ?? 0.55 * floorHeight, floorHeight - 0.15 - r * (1 + 1.4 * ARCH_BAND)));
}

/**
 * The stones of an arch of radius r springing at (cx, spring), left to right: an odd number of wedges,
 * the middle one the keystone. It stands out of the wall further than the others and rises above them
 * when `keystone` is true.
 */
export function voussoirs(cx: number, spring: number, r: number, width: number, keystone = true): THREE.BufferGeometry[] {
  const n = clamp(2 * Math.round(r * 2) + 1, 7, 17);
  const step = Math.PI / n;
  const gap = Math.min(0.012 / r, step / 4);
  const mid = (n - 1) / 2;
  return [...Array(n)].map((_, i) => {
    const hi = Math.PI - i * step - gap;
    const lo = Math.PI - (i + 1) * step + gap;
    const key = keystone && i === mid;
    const outer = r + width * (key ? 1.5 : 1);
    const pts = [...arcPoints(cx, spring, r, hi, lo, 2), ...arcPoints(cx, spring, outer, lo, hi, 2)];
    return slab(new THREE.Shape(pts), 0, key ? 0.19 : 0.1, 0.012);
  });
}

function archivoltProfile(width: number) {
  const q = Math.max(0.07, 0.5 * width);
  return profile(0, [["o", 0.4 * q], ["v", 0.3 * width], ["o", 0.8 * q], ["v", 0.2 * width], ["cyma", 0.3 * width, q], ["v", 0.2 * width]]);
}

/**
 * Hole and trim of an arch cell in a bay `clear` wide at x = cx, on a floor `floorHeight` high whose
 * level is y0. `cut` is the opening in the wall, `trim` the stones or archivolt with the imposts.
 */
export function archOpening(cell: Cell<"arch">, bay: { cx: number; clear: number }, floorHeight: number, y0 = 0): { cut: THREE.Path; trim: THREE.BufferGeometry } {
  const r = archRadius(bay.clear, floorHeight);
  const spring = y0 + archSpring(cell.spring, bay.clear, floorHeight);
  const band = ARCH_BAND * r;
  const parts: THREE.BufferGeometry[] =
    cell.archivolt === "moulded" ? [sweep(archivoltProfile(band).points, arcPoints(bay.cx, spring, r, Math.PI, 0, 28))] : voussoirs(bay.cx, spring, r, band, cell.keystone !== false);
  const ih = clamp(0.18 * r, 0.12, 0.3);
  const impost = profile(spring - ih, [["o", 0.06], ["v", 0.3 * ih], ["cyma", 0.3 * ih, 0.12], ["v", 0.4 * ih]]).points;
  parts.push(runAlongX(impost, bay.cx - r - band - 0.05, bay.cx - r), runAlongX(impost, bay.cx + r, bay.cx + r + band + 0.05));
  return { cut: openingPath(roundOpening(bay.cx, r, y0, spring)), trim: merge(parts) };
}

// ---------- frames ----------

const frameWidth = (w: number): number => clamp(0.11 * w + 0.04, 0.1, 0.22);

/** Frame moulding `fw` wide: fillet, fascia, bead and a cyma. */
function mould(fw: number, scale = 1) {
  const q = Math.max(0.07, 0.5 * fw) * scale;
  return profile(0, [["o", 0.4 * q], ["v", 0.45 * fw], ["o", 0.7 * q], ["v", 0.15 * fw], ["cyma", 0.4 * fw, q]]);
}

/** Path round an opening, clockwise from the bottom of the left jamb to the bottom of the right one. */
function contour(cx: number, w: number, y0: number, y1: number, round: boolean): THREE.Vector2[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  if (!round) return [new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)];
  const spring = y1 - w / 2;
  return [new THREE.Vector2(x0, y0), ...arcPoints(cx, spring, w / 2, Math.PI, 0, 20), new THREE.Vector2(x1, y0)];
}

const SILL: ProfileStep[] = [["o", 0.1], ["v", 0.04], ["cyma", 0.03, 0.14], ["v", 0.03]];
const SILL_H = 0.1;

/** A small bracket under a sill, `x` its centre, hanging from `top`. */
function corbel(x: number, top: number): THREE.BufferGeometry {
  const pts: Array<[number, number]> = [[-0.02, top], [0.13, top], [0.13, top - 0.05], [0.08, top - 0.1], [0.06, top - 0.22], [0.02, top - 0.3], [-0.02, top - 0.3]];
  return runAlongX(pts, x - 0.07, x + 0.07);
}

/** A colonnette between the two lights of a bifora, from y0 to yt, on the wall. */
function colonnette(cx: number, y0: number, yt: number): THREE.BufferGeometry {
  const pts: Array<[number, number]> = [[0, y0], [0.065, y0], [0.065, y0 + 0.04], [0.045, y0 + 0.08], [0.04, yt - 0.12], [0.05, yt - 0.08], [0.07, yt - 0.04], [0.07, yt], [0, yt]];
  return turned(pts, 10).translate(cx, 0, 0.03);
}

export function windowTrim(c: Cell<"window">, cx: number): THREE.BufferGeometry {
  const { w, h, sill } = c;
  const y1 = sill + h;
  const fw = frameWidth(w);
  const round = c.top === "round" && !c.mullion && h > w / 2;
  const sx0 = cx - w / 2 - fw - 0.08;
  const sx1 = cx + w / 2 + fw + 0.08;
  const sillTop = sill;
  const parts: THREE.BufferGeometry[] = [sweep(mould(fw).points, contour(cx, w, sill, y1, round)), runAlongX(profile(sillTop - SILL_H, SILL).points, sx0, sx1)];
  if (c.balustrade && sill > 0.45) {
    const post = 0.18;
    parts.push(balustrade(sx0 + 0.05, sx1 - 0.05, 0.02, sill - SILL_H - 0.02, [sx0 + post, sx1 - post], { zc: 0.12, depth: 0.22 }));
  } else if (c.corbels) {
    parts.push(corbel(sx0 + 0.14, sillTop - SILL_H), corbel(sx1 - 0.14, sillTop - SILL_H));
  }
  if (c.mullion) {
    const w2 = (w - 0.12) / 2;
    parts.push(colonnette(cx, sill, c.top === "round" ? y1 - w2 / 2 : y1));
  }
  if (c.pediment) parts.push(pediment(c.pediment, sx0, sx1, y1 + fw, c.pediment === "triangular" ? 24 : 26));
  return merge(parts);
}

export function portalTrim(c: Cell<"portal">, cx: number): THREE.BufferGeometry {
  const { w, h } = c;
  const fw = clamp(0.1 * w + 0.08, 0.14, 0.3);
  const round = c.top === "round" && h > w / 2;
  const parts: THREE.BufferGeometry[] = [sweep(mould(fw, 1.4).points, contour(cx, w, 0, h, round))];
  if (c.pediment) {
    const bracket = 0.2;
    const shelf = h + fw;
    const xa = cx - w / 2 - fw - bracket - 0.05;
    const xb = cx + w / 2 + fw + bracket + 0.05;
    const console: Array<[number, number]> = [[-0.02, shelf], [0.26, shelf], [0.26, shelf - 0.06], [0.2, shelf - 0.12], [0.12, shelf - 0.3], [0.1, shelf - 0.5], [-0.02, shelf - 0.55]];
    parts.push(runAlongX(console, xa + 0.05, xa + 0.05 + bracket), runAlongX(console, xb - 0.05 - bracket, xb - 0.05));
    parts.push(pediment(c.pediment, xa, xb, shelf, c.pediment === "triangular" ? 22 : 24));
  }
  return merge(parts);
}

export function nicheTrim(c: Cell<"niche">, cx: number): THREE.BufferGeometry {
  const fw = 0.08;
  const y1 = c.sill + c.h;
  return merge([sweep(mould(fw, 0.8).points, contour(cx, c.w, c.sill, y1, false)), runAlongX(profile(c.sill - SILL_H, SILL).points, cx - c.w / 2 - fw - 0.05, cx + c.w / 2 + fw + 0.05)]);
}

export function panelTrim(c: Cell<"panel">, cx: number): THREE.BufferGeometry {
  const fw = 0.08;
  const y1 = c.sill + c.h;
  const x0 = cx - c.w / 2;
  const x1 = cx + c.w / 2;
  const path = [new THREE.Vector2(x0, c.sill), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, c.sill)];
  return sweep(mould(fw, 0.6).points, path, true);
}

/** A moulded ring round an oculus, with a block at each quarter. */
export function oculusTrim(c: Cell<"oculus">, cx: number): THREE.BufferGeometry {
  const fw = clamp(0.2 * c.r, 0.1, 0.25);
  const parts = [sweep(mould(fw).points, arcPoints(cx, c.y, c.r, Math.PI * 2, 0, 32), true)];
  const k = 0.5 * fw;
  const reach = c.r + 1.7 * fw;
  parts.push(box(cx - k, cx + k, c.y + c.r - 0.02, c.y + reach, 0, 0.12), box(cx - k, cx + k, c.y - reach, c.y - c.r + 0.02, 0, 0.12));
  parts.push(box(cx + c.r - 0.02, cx + reach, c.y - k, c.y + k, 0, 0.12), box(cx - reach, cx - c.r + 0.02, c.y - k, c.y + k, 0, 0.12));
  return merge(parts);
}
