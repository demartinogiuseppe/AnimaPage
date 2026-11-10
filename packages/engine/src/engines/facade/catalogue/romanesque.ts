// The Romanesque front: aisle roofs that run up to the nave, the loggetta (small arches on
// colonnettes) and the splayed portal (nested receding arches on shafts). Blind arcades are plain
// `arch` cells with `open: false` between half-columns (openings.ts and orders.ts); the round window is
// a `window` with a round top. Geometry in building-local metres, the wall face at z = 0; the trim
// functions stand on the floor level y = 0 (the caller lifts them).
import * as THREE from "three";
import type { FacadeCell } from "@pv/scene-spec";
import { arcPoints, merge, profile, runAlongX, slab, sweep, turned } from "../profiles.ts";
import { lightOpening, openingPath, WALL, type Opening } from "./basic.ts";
import { portalTrim } from "./openings.ts";

type Cell<K extends FacadeCell["el"]> = Extract<FacadeCell, { el: K }>;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;

// ---------- aisle slopes ----------

/**
 * The roofs of the aisles beside a narrower upper floor: on each side a wedge standing on y0 that rises
 * from the outer edge of the lower floor (width `lower`) to the side of the upper one (width `upper`) at
 * `pitch` degrees, so its slope ends exactly on the upper wall. The wedge is a closed prism that runs from
 * the wall face back to z = -depth (default: the thickness of the wall), flush with the wall below. `gap` (default 0)
 * keeps it that far from the upper floor's side, on the same slope line: the model leaves 2 mm so that the
 * upper walls' end faces and the wedge's inner face are never coplanar in a section.
 */
export function aisleSlopes(lower: number, upper: number, y0: number, pitch: number, depth = WALL, gap = 0): THREE.BufferGeometry {
  const out = (lower - upper) / 2;
  if (out <= 0) throw new Error("aisleSlopes: the lower floor must be wider than the upper one");
  const t = Math.tan(pitch * RAD);
  return merge(
    ([-1, 1] as const).map((side) => {
      const s = new THREE.Shape();
      s.moveTo(side * (upper / 2 + gap), y0).lineTo(side * (lower / 2), y0).lineTo(side * (upper / 2 + gap), y0 + (out - gap) * t).closePath();
      return slab(s, -depth, 0);
    }),
  );
}

// ---------- gallery ----------

/** Where the colonnettes of a gallery stand in a bay `clear` wide: the span, their pitch and the width of each opening. */
export function galleryLayout(columns: number, clear: number): { total: number; pitch: number; w: number } {
  const total = Math.max(0.5, clear - 0.2);
  const pitch = total / (columns - 1);
  return { total, pitch, w: pitch - 0.12 };
}

const COLONNETTE = 0.05;
const ARCH_STEPS: Array<["o", number] | ["v", number]> = [["o", 0.02], ["v", 0.03], ["o", 0.035], ["v", 0.015]];

/**
 * The loggetta of a gallery cell standing on y = 0: `columns` colonnettes with a base and a block capital,
 * a small arched moulding over each opening between two of them (columns - 1 arches, the ends are closed by
 * the wall) and a ledge under them. The openings themselves are cut by the model (`galleryLayout`).
 */
export function gallery(cell: Cell<"gallery">, bay: { cx: number; clear: number }, floorHeight: number): THREE.BufferGeometry {
  const { total, pitch, w } = galleryLayout(cell.columns, bay.clear);
  const y0 = cell.sill;
  const y1 = Math.min(cell.sill + cell.h, floorHeight);
  const parts: THREE.BufferGeometry[] = [runAlongX(profile(y0 - 0.06, [["o", 0.06], ["v", 0.06]]).points, bay.cx - total / 2 - 0.1, bay.cx + total / 2 + 0.1)];
  if (w < 0.1) return merge(parts);
  const round = y1 - w / 2 > y0;
  const spring = round ? y1 - w / 2 : y1;
  const r = COLONNETTE;
  const lathe: Array<[number, number]> = [[0, y0], [1.3 * r, y0], [1.3 * r, y0 + 0.04], [r, y0 + 0.07], [0.9 * r, spring - 0.1], [r, spring - 0.07], [1.4 * r, spring - 0.06], [1.4 * r, spring], [0, spring]];
  for (let i = 0; i < cell.columns; i++) parts.push(turned(lathe, 10).translate(bay.cx - total / 2 + pitch * i, 0, 0.03));
  for (let i = 0; i < cell.columns - 1; i++) {
    const cx = bay.cx - total / 2 + pitch * (i + 0.5);
    const path = round
      ? arcPoints(cx, spring, w / 2, Math.PI, 0, 10)
      : [new THREE.Vector2(cx - w / 2, y0), new THREE.Vector2(cx - w / 2, y1), new THREE.Vector2(cx + w / 2, y1), new THREE.Vector2(cx + w / 2, y0)];
    parts.push(sweep(profile(0, ARCH_STEPS).points, path));
  }
  return merge(parts);
}

// ---------- splayed portal ----------

/** Receding step of one splay ring, in plan (x) and in depth (z); the ring faces stay inside the wall. */
function splay(cell: Cell<"portal">): { n: number; step: number; ds: number } {
  const n = cell.splay ?? 0;
  return { n, step: Math.min(clamp(0.08 * cell.w, 0.07, 0.25), (0.3 * cell.w) / Math.max(1, n)), ds: Math.min(0.12, 0.4 / Math.max(1, n)) };
}

/** The wall hole of a portal cell and the jamb outline (open at the bottom) of its ring i: 0 = the hole, `splay` = the doorway. */
function ringOutline(cell: Cell<"portal">, cx: number, i: number, step: number, density = 24): THREE.Vector2[] {
  const hw = cell.w / 2 - i * step;
  if (cell.top === "round" && cell.h > cell.w / 2) return [new THREE.Vector2(cx - hw, 0), ...arcPoints(cx, cell.h - cell.w / 2, hw, Math.PI, 0, density), new THREE.Vector2(cx + hw, 0)];
  const top = cell.h - i * step;
  return [new THREE.Vector2(cx - hw, 0), new THREE.Vector2(cx - hw, top), new THREE.Vector2(cx + hw, top), new THREE.Vector2(cx + hw, 0)];
}

/** The hole in the wall of a portal cell: the outermost ring, the same as a plain portal's. */
export function portalHole(cell: Cell<"portal">, cx: number, y0 = 0): Opening {
  return lightOpening(cx, cell.w, y0, y0 + cell.h, cell.top === "round");
}

/**
 * A portal whose reveal steps back in `splay` rings of nested arches. `cut` is the hole through the wall (cell
 * w x h); the trim fills it: each ring i (1..splay) is a flat step, narrower by two steps than the one before
 * and set back by `ds` more, with a shaft (and, in a round portal, a bead over it) in the corner where it
 * meets the riser of the ring before. The innermost opening is the doorway. A plain moulded frame stands
 * round the hole. Without splay it is just the frame of `portalTrim`.
 */
export function splayedPortal(cell: Cell<"portal">, cx: number): { cut: THREE.Path; trim: THREE.BufferGeometry } {
  const cut = openingPath(portalHole(cell, cx));
  const { n, step, ds } = splay(cell);
  const frame = portalTrim({ ...cell, pediment: undefined }, cx);
  if (n === 0) return { cut, trim: frame };
  const parts: THREE.BufferGeometry[] = [frame];
  const rs = clamp(0.2 * step, 0.03, 0.06);
  const round = cell.top === "round" && cell.h > cell.w / 2;
  const spring = cell.h - cell.w / 2;
  for (let i = 1; i <= n; i++) {
    // face of ring i: the band between outline i - 1 and outline i, from the back of the wall to z = -i ds
    const face = new THREE.Shape([...ringOutline(cell, cx, i - 1, step), ...ringOutline(cell, cx, i, step).reverse()]);
    parts.push(slab(face, -WALL, -i * ds));
  }
  for (let i = 0; i < n; i++) {
    // nook shaft on face i + 1, against the riser of ring i
    const hw = cell.w / 2 - i * step;
    const z = -(i + 1) * ds + 0.9 * rs;
    const top = round ? spring : cell.h - (i + 1) * step;
    const lathe: Array<[number, number]> = [[0, 0], [1.3 * rs, 0], [1.3 * rs, 0.05], [rs, 0.09], [rs, top - 0.1], [1.3 * rs, top - 0.05], [1.3 * rs, top], [0, top]];
    for (const s of [-1, 1]) parts.push(turned(lathe, 10).translate(cx + s * (hw - rs), 0, z));
    if (round) {
      const bead = sweep(profile(0, [["torus", 2 * rs, rs]]).points, arcPoints(cx, spring, hw - 2 * rs, Math.PI, 0, 24));
      parts.push(bead.translate(0, 0, -(i + 1) * ds));
    }
  }
  return { cut, trim: merge(parts) };
}
