// The temple front: a stylobate with steps, a free-standing colonnade of one order at `colonnade.depth`
// in front of the cella wall, and (for the doric) the triglyphs of the frieze. The entablature itself
// is the one of bands.ts, pushed out over the columns; the pediment is the one of crown.ts.
// Geometry in building-local metres; the wall face is z = 0.
import type * as THREE from "three";
import type { floorLayout, FacadeFloor } from "@pv/scene-spec";
import { bandHeight, base, type Part } from "./basic.ts";
import { memberAxisZ, orderMember } from "./orders.ts";
import { box, merge } from "../profiles.ts";

/** Share of a doric entablature the frieze takes: tall enough for metopes that are not slits. */
export const DORIC_FRIEZE = 0.4;

/** x of the axis of every column: one at each end (half a column in from the edge) and one on each bay boundary. */
export function colonnadeAxes(floor: FacadeFloor, layout: ReturnType<typeof floorLayout>): number[] {
  const m = floor.members;
  if (!m) return [];
  const first = layout.bays[0]!;
  const last = layout.bays[layout.bays.length - 1]!;
  return [first.x0 + m.width / 2, ...layout.bays.slice(1).map((b) => b.x0), last.x1 - m.width / 2];
}

/**
 * The columns of a temple front standing on y0: one on each of `colonnadeAxes`, `colonnade.depth` in
 * front of the wall, as tall as the floor less its entablature. A doric column has no base (Greek).
 */
export function colonnade(floor: FacadeFloor, layout: ReturnType<typeof floorLayout>, y0: number): THREE.BufferGeometry {
  const m = floor.members;
  if (!m || !floor.colonnade) throw new Error(`floor "${floor.id}" has no colonnade`);
  const height = floor.height - bandHeight(floor.top, floor.height, true);
  const z = memberAxisZ(m, height, floor.colonnade.depth);
  return merge(colonnadeAxes(floor, layout).map((x) => orderMember(m, height, x, z, { base: m.order !== "doric" }).translate(0, y0, 0)));
}

/** How far a triglyph stands out of the frieze. */
const TRIGLYPH_RELIEF = 0.05;

/**
 * The triglyphs of a doric frieze `height` high from y0, resting on a frieze face at z = 0 (the caller
 * moves them to the face). One triglyph stands over each column axis and one in the middle of each span
 * between two axes, the metopes (blank) between them. A triglyph is three bars and two grooves; its width
 * is 0.62 of the frieze height. `width` is the length of the frieze: nothing is placed outside it.
 */
export function triglyphFrieze(width: number, height: number, y0: number, axes: number[]): THREE.BufferGeometry {
  if (!axes.length) throw new Error("triglyphFrieze needs at least one axis");
  const tw = Math.min(0.62 * height, width);
  const limit = width / 2 - tw / 2;
  // an end triglyph over a narrow end member is clamped inside the frieze; one that would overlap its neighbour is dropped
  const xs: number[] = [];
  for (const x of axes.flatMap((a, i) => (i + 1 < axes.length ? [a, (a + axes[i + 1]!) / 2] : [a])).map((x) => Math.min(limit, Math.max(-limit, x))))
    if (!xs.length || x - xs[xs.length - 1]! >= tw) xs.push(x);
  const bar = 0.2 * tw;
  const parts: THREE.BufferGeometry[] = [];
  for (const x of xs) for (const k of [-1, 0, 1]) parts.push(box(x + 2 * bar * k - bar / 2, x + 2 * bar * k + bar / 2, y0, y0 + height, 0, TRIGLYPH_RELIEF));
  return merge(parts);
}

/** The platform of the temple: a plinth `h` high that reaches `reach` in front of the wall, with `steps` steps before it. */
export function stylobate(part: Part, width: number, depth: number, h: number, steps: number, reach: number): void {
  base(part, width, depth, h, steps, reach);
}
