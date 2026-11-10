// Core pieces of the façade catalogue: walls with openings, rustication, the base with steps, the
// portico vault, the body block and the gable. The orders, bands, trim of the openings and crowns,
// with their mouldings, live in the sibling catalogue files.
//
// A `Part` collects solids in building-local metres and flushes them as ONE merged geometry (a paper
// mesh, a hull mesh and a crease-line set), which keeps the draw calls per part constant.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { addFineLines, addInked, type FacadeInk } from "../ink.ts";
import { runAlongX, slab } from "../profiles.ts";

/** Thickness of the façade wall. */
export const WALL = 0.5;
/** How far plain members and rusticated blocks stand out of the wall. */
export const RELIEF = 0.12;
const BODY_WALL = 0.3;
// The body behind the façade is built for the section view: side and back walls 0.6 m thick, floor and roof
// slabs 0.4 m. All closed solids, so a cut through them shows grey poché bands (and the inside as paper).
const BODY_THICK = 0.6;
const SLAB = 0.4;

/** Position and normal only, non-indexed: what mergeGeometries needs from mixed primitives. */
function prepare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
  flat.clearGroups();
  return flat;
}

export class Part {
  private readonly solids: THREE.BufferGeometry[] = [];
  private readonly fine: number[] = [];

  add(g: THREE.BufferGeometry): void {
    this.solids.push(prepare(g));
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g);
  }

  slab(shape: THREE.Shape, z0: number, z1: number, bevel = 0): void {
    this.add(slab(shape, z0, z1, bevel));
  }

  fineLine(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.fine.push(x0, y0, z0, x1, y1, z1);
  }

  get empty(): boolean {
    return this.solids.length === 0 && this.fine.length === 0;
  }

  /** Merge everything into `group` (one inked solid, one fine-line set) and forget it. */
  flush(group: THREE.Group, ink: FacadeInk, name: string): void {
    if (this.solids.length) {
      const merged = mergeGeometries(this.solids);
      if (!merged) throw new Error(`facade part "${name}": geometries could not be merged`);
      merged.name = name;
      for (const g of this.solids) g.dispose();
      this.solids.length = 0;
      addInked(group, merged, ink);
    }
    if (this.fine.length) {
      addFineLines(group, new Float32Array(this.fine), ink);
      this.fine.length = 0;
    }
  }
}

// ---------- openings ----------

export type Opening =
  | { kind: "rect"; x0: number; x1: number; y0: number; y1: number }
  | { kind: "round"; cx: number; r: number; y0: number; spring: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

export const rectOpening = (x0: number, x1: number, y0: number, y1: number): Opening => ({ kind: "rect", x0, x1, y0, y1 });
export const roundOpening = (cx: number, r: number, y0: number, spring: number): Opening => ({ kind: "round", cx, r, y0, spring });

/** A rectangle of width `w` whose top is a semicircle when `round` (and the height allows it). */
export function lightOpening(cx: number, w: number, y0: number, y1: number, round: boolean): Opening {
  if (round && y1 - w / 2 > y0) return roundOpening(cx, w / 2, y0, y1 - w / 2);
  return rectOpening(cx - w / 2, cx + w / 2, y0, y1);
}

export function openingPath(o: Opening): THREE.Path {
  const p = new THREE.Path();
  if (o.kind === "rect") {
    p.moveTo(o.x0, o.y0).lineTo(o.x1, o.y0).lineTo(o.x1, o.y1).lineTo(o.x0, o.y1).lineTo(o.x0, o.y0);
  } else if (o.kind === "round") {
    p.moveTo(o.cx - o.r, o.y0).lineTo(o.cx + o.r, o.y0).lineTo(o.cx + o.r, o.spring);
    p.absarc(o.cx, o.spring, o.r, 0, Math.PI, false);
    p.lineTo(o.cx - o.r, o.y0);
  } else {
    p.absarc(o.cx, o.cy, o.r, 0, Math.PI * 2, false);
  }
  return p;
}

/** Centre and half-width of the opening at height y (half-width 0 outside it). */
function span(o: Opening, y: number): { cx: number; hw: number } {
  if (o.kind === "rect") return { cx: (o.x0 + o.x1) / 2, hw: y > o.y0 && y < o.y1 ? (o.x1 - o.x0) / 2 : 0 };
  if (o.kind === "round") {
    if (y <= o.y0 || y >= o.spring + o.r) return { cx: o.cx, hw: 0 };
    return { cx: o.cx, hw: y <= o.spring ? o.r : Math.sqrt(o.r * o.r - (y - o.spring) ** 2) };
  }
  return { cx: o.cx, hw: Math.abs(y - o.cy) < o.r ? Math.sqrt(o.r * o.r - (y - o.cy) ** 2) : 0 };
}

const rectShape = (x0: number, y0: number, x1: number, y1: number): THREE.Shape => {
  const s = new THREE.Shape();
  s.moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).lineTo(x0, y0);
  return s;
};

/** A flat wall slab with the openings cut out of it. */
export function wallWithHoles(part: Part, x0: number, x1: number, y0: number, y1: number, holes: Opening[], z0: number, z1: number): void {
  const s = rectShape(x0, y0, x1, y1);
  for (const h of holes) s.holes.push(openingPath(h));
  part.slab(s, z0, z1);
}

/** The x ranges of [x0, x1] left free by the openings over the height band [ya, yb]. */
function freeRuns(x0: number, x1: number, holes: Opening[], ya: number, yb: number): Array<[number, number]> {
  const cuts: Array<[number, number]> = [];
  for (const h of holes) {
    let hw = 0;
    let cx = 0;
    for (let i = 0; i < 6; i++) {
      const s = span(h, ya + ((yb - ya) * (i + 0.5)) / 6);
      cx = s.cx;
      hw = Math.max(hw, s.hw);
    }
    if (hw > 0) cuts.push([cx - hw, cx + hw]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const runs: Array<[number, number]> = [];
  let at = x0;
  for (const [a, b] of cuts) {
    if (a > at) runs.push([at, Math.min(a, x1)]);
    at = Math.max(at, b);
  }
  if (at < x1) runs.push([at, x1]);
  return runs;
}

/**
 * Courses of bevelled blocks standing out of the wall over [x0, x1] x [y0, y1], broken by the openings
 * (where an arch curves the blocks stop short; the wall behind shows the rest). Odd courses are staggered.
 */
export function rusticBlocks(part: Part, x0: number, x1: number, y0: number, y1: number, course: number, holes: Opening[], relief = RELIEF): void {
  const gap = 0.012;
  const len = course * 2.2;
  for (let i = 0, ya = y0; ya < y1 - 0.1; i++, ya += course) {
    const yb = Math.min(ya + course, y1);
    for (const [a, b] of freeRuns(x0, x1, holes, ya, yb)) {
      const joints = [a];
      const shift = (i % 2) * (len / 2);
      for (let x = shift + Math.ceil((a + 0.15 - shift) / len) * len; x < b - 0.15; x += len) joints.push(x);
      joints.push(b);
      for (let k = 0; k < joints.length - 1; k++) {
        const bx0 = joints[k]! + gap;
        const bx1 = joints[k + 1]! - gap;
        if (bx1 - bx0 < 0.1) continue;
        part.slab(rectShape(bx0, ya + gap, bx1, yb - gap), 0, relief, Math.min(0.03, relief / 4));
      }
    }
  }
}

// ---------- members ----------

export interface MemberSite {
  x: number;
  /** Drawn width. */
  w: number;
  /** Interior site with two members side by side. */
  pair: boolean;
}

// ---------- bands, base, portico, body, crown ----------

/** Height of the band at the top of a floor; an entablature over an order is a quarter of the column (Vignola). */
export function bandHeight(top: "string-course" | "entablature" | "none" | undefined, floorHeight: number, ordered = false): number {
  if (top === "string-course") return 0.22;
  if (top === "entablature") return ordered ? Math.min(1.8, Math.max(0.4, 0.2 * floorHeight)) : Math.min(1.2, Math.max(0.35, 0.1 * floorHeight));
  return 0;
}

/**
 * Plinth of the whole building (y 0..h), with `steps` steps in front of `front` (default just in front of the
 * wall): ONE closed solid, the stepped profile (z, y) extruded along x, so a section cuts a single band.
 */
export function base(part: Part, width: number, depth: number, h: number, steps: number, front = 0.15): void {
  const tread = 0.4;
  const pts: Array<[number, number]> = [[-depth, 0]];
  for (let j = 1; j <= steps; j++) pts.push([front + tread * (steps + 1 - j), (h * (j - 1)) / (steps + 1)], [front + tread * (steps + 1 - j), (h * j) / (steps + 1)]);
  pts.push([front, steps ? (h * steps) / (steps + 1) : 0], [front, h], [-depth, h]);
  part.add(runAlongX(pts, -width / 2, width / 2));
}

/**
 * Covered passage behind the arches: back wall, side walls, paving lines and the vault mass above it
 * (one solid up to the top of the floor, so the upper floor stands on it).
 */
export function portico(part: Part, x0: number, x1: number, y0: number, y1: number, spring: number, depth: number, vault: "barrel" | "segmental"): void {
  const zf = -WALL;
  const zb = -depth;
  if (zf - zb < 0.2) return;
  part.box(x0, x1, y0, y1, zb - BODY_WALL, zb);
  part.box(x0, x0 + BODY_WALL, y0, y1, zb, zf);
  part.box(x1 - BODY_WALL, x1, y0, y1, zb, zf);
  // vault: profile (z, y) run along x
  const hz = (zf - zb) / 2;
  const zc = (zf + zb) / 2;
  const room = Math.max(0.1, y1 - spring - 0.3);
  const sag = Math.min(vault === "barrel" ? hz : 0.35 * hz, room);
  const pts: Array<[number, number]> = [
    [zf, spring],
    [zf, y1],
    [zb, y1],
    [zb, spring],
  ];
  for (let i = 1; i < 40; i++) {
    const a = (i / 40) * Math.PI;
    pts.push([zc - hz * Math.cos(a), spring + sag * Math.sin(a)]);
  }
  part.add(vaultMass(pts, x0 + BODY_WALL, x1 - BODY_WALL));
  // paving joints
  const yp = y0 + 0.01;
  for (let x = Math.ceil(x0 / 0.75) * 0.75; x < x1; x += 0.75) part.fineLine(x, yp, zb, x, yp, 0);
  for (let z = -0.75; z > zb; z -= 0.75) part.fineLine(x0, yp, z, x1, yp, z);
}

/** A (z, y) profile run along x: the vault. Same convention as runAlongX with out = z. */
function vaultMass(pts: Array<[number, number]>, x0: number, x1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 40 });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return g;
}

/**
 * Side and back walls of one floor of the body, up to the slab that closes it (`SLAB` below y1).
 * The back wall spans the full width and the side walls stand between it and the façade wall, so the
 * solids neither overlap nor share a face a section ray crosses: each cut band is one closed solid.
 */
export function bodyFloor(part: Part, x0: number, x1: number, y0: number, y1: number, depth: number, door?: { half: number; height: number }): void {
  if (door) {
    // a doorway in the back wall (the rotunda's entrance stands behind it): the wall is one slab with a hole, starting a little below the floor like the façade wall
    const s = new THREE.Shape();
    s.moveTo(x0, y0 - 0.05).lineTo(x1, y0 - 0.05).lineTo(x1, y1 - SLAB).lineTo(x0, y1 - SLAB).lineTo(x0, y0 - 0.05);
    s.holes.push(openingPath(rectOpening(-door.half, door.half, y0, y0 + door.height)));
    part.slab(s, -depth, -depth + BODY_THICK);
  } else part.box(x0, x1, y0, y1 - SLAB, -depth, -depth + BODY_THICK);
  part.box(x0, x0 + BODY_THICK, y0, y1 - SLAB, -depth + BODY_THICK, -WALL);
  part.box(x1 - BODY_THICK, x1, y0, y1 - SLAB, -depth + BODY_THICK, -WALL);
}

/** The slab at the top of a floor (the floor of the next one, or the roof): full width, below `y`. */
export function floorSlab(part: Part, x0: number, x1: number, y: number, depth: number): void {
  part.box(x0, x1, y - SLAB, y, -depth, -WALL);
}

/** Thickness of the ground slab: the thinnest slab of the façade, so more than the plan view's lift of the back faces (PLAN_LIFT in index.ts) with margin. */
export const GROUND_SLAB = 0.3;

/** Ground slab under the whole footprint. */
export function groundSlab(part: Part, x0: number, x1: number, depth: number): void {
  part.box(x0, x1, -GROUND_SLAB, 0, -depth, 0);
}

/** Triangular gable end with the roof behind it (a prism running from the wall face `z1` back to z = -depth). */
export function gable(part: Part, x0: number, x1: number, y: number, h: number, depth: number, z1 = 0): void {
  const s = new THREE.Shape();
  s.moveTo(x0, y).lineTo((x0 + x1) / 2, y + h).lineTo(x1, y).lineTo(x0, y);
  part.slab(s, -depth, z1);
}
