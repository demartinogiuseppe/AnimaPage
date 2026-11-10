// The five orders as members: base, shaft (entasis, optional flutes) and capital, drawn as a column,
// a half-column (axis on the wall face) or a pilaster. Proportions follow Vignola: column height
// over lower diameter is 7 (tuscan), 8 (doric), 9 (ionic), 10 (corinthian, composite). The
// Opera drawing in art/orders.ts keeps its own table (ORDER_RATIO).
//
// Every geometry is baked in building-local metres, from y = 0 (the caller lifts it onto its floor).
import * as THREE from "three";
import type { FacadeMember } from "@pv/scene-spec";
import { Part, rusticBlocks, RELIEF, type MemberSite } from "./basic.ts";
import { arcPoints, box, loft, merge, profile, runAlongX, turned, type ProfileStep } from "../profiles.ts";

export type Order = NonNullable<FacadeMember["order"]>;

/** Column height over lower diameter. */
export const FACADE_ORDER_RATIO: Record<Order, number> = { tuscan: 7, doric: 8, ionic: 9, corinthian: 10, composite: 10 };
/** Capital height over lower diameter (the abacus included). */
const CAPITAL: Record<Order, number> = { tuscan: 0.55, doric: 0.6, ionic: 0.55, corinthian: 1.1, composite: 1.15 };
/** The shaft narrows to this fraction of its lower diameter. */
const DIMINISH = 5 / 6;
const SEGMENTS = 16;

export interface OrderDims {
  /** Lower diameter of the shaft (a pilaster's width). */
  d: number;
  baseH: number;
  capH: number;
  /** Heights of the shaft's bottom and top ring. */
  shaftY0: number;
  shaftY1: number;
  /** Vertical squeeze applied to base and capital when the member is too short for the full ones. */
  k: number;
}

/** Where base, shaft and capital lie on a member `height` high; the diameter is `width` or, if smaller, height / ratio. */
export function orderDims(order: Order, height: number, width: number): OrderDims {
  const d = Math.min(width, height / FACADE_ORDER_RATIO[order]);
  const full = (0.5 + CAPITAL[order]) * d;
  const k = Math.min(1, (0.4 * height) / full);
  return { d, baseH: 0.5 * d * k, capH: CAPITAL[order] * d * k, shaftY0: 0.5 * d * k, shaftY1: height - CAPITAL[order] * d * k, k };
}

// ---------- capital ----------

/** Steps of the capital: `p` is the radius (or the projection of a pilaster) where it starts. */
function capSteps(order: Order, h: number, d: number, p: number): ProfileStep[] {
  const e = p + 0.14 * d;
  switch (order) {
    case "tuscan":
      return [["o", p], ["v", 0.18 * h], ["o", p + 0.04 * d], ["v", 0.07 * h], ["ovolo", 0.45 * h, e], ["v", 0.05 * h], ["o", e + 0.05 * d], ["v", 0.25 * h]];
    case "doric":
      return [["o", p], ["v", 0.12 * h], ["o", p + 0.03 * d], ["v", 0.04 * h], ["o", p], ["v", 0.04 * h], ["o", p + 0.03 * d], ["v", 0.04 * h], ["ovolo", 0.4 * h, e], ["v", 0.05 * h], ["o", e + 0.05 * d], ["v", 0.31 * h]];
    case "ionic":
      return [["o", p], ["v", 0.12 * h], ["ovolo", 0.2 * h, e], ["v", 0.06 * h], ["o", e + 0.04 * d], ["v", 0.4 * h], ["cyma", 0.12 * h, e + 0.1 * d], ["v", 0.1 * h]];
    case "corinthian":
      return [["o", p], ["v", 0.08 * h], ["cavetto", 0.6 * h, p + 0.14 * d], ["v", 0.04 * h], ["o", e + 0.06 * d], ["v", 0.1 * h], ["cyma", 0.1 * h, e + 0.1 * d], ["v", 0.08 * h]];
    case "composite":
      return [["o", p], ["v", 0.08 * h], ["cavetto", 0.4 * h, p + 0.12 * d], ["v", 0.04 * h], ["o", e + 0.04 * d], ["v", 0.28 * h], ["cyma", 0.1 * h, e + 0.1 * d], ["v", 0.1 * h]];
  }
}

/** A cone for an acanthus leaf: base at the origin, tip up, then leaned outwards by `tilt` about `axis`. */
function leaf(r: number, h: number, tilt: number, axis: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, 5, 1);
  g.translate(0, h / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(axis, -tilt));
  return g;
}

/** A disc facing +z: the eye of a volute. */
function disc(x: number, y: number, z: number, r: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, 12);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * Leaves and volutes on a capital that starts at `y`: `ring` is true for a column (leaves all round,
 * volutes on a block front and back) and false for a pilaster (front only).
 */
function ornament(order: Order, y: number, h: number, d: number, p: number, x: number, z: number, ring: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const tiers = order === "corinthian" ? [0.1, 0.38] : order === "composite" ? [0.1] : [];
  tiers.forEach((t, tier) => {
    const lh = 0.36 * h;
    const rad = 0.075 * d;
    const spots = ring ? 8 : 3;
    for (let i = 0; i < spots; i++) {
      const a = ring ? ((i + tier / 2) / spots) * Math.PI * 2 : 0;
      const dx = ring ? Math.cos(a) : (i - 1) * 0.3 * d;
      const dz = ring ? Math.sin(a) : 1;
      const reach = ring ? p + (tier ? 0.1 : 0.03) * d : p + 0.02 * d;
      const axis = ring ? new THREE.Vector3(-dz, 0, dx) : new THREE.Vector3(-1, 0, 0);
      const g = leaf(rad, lh, 0.28, axis);
      g.translate(x + (ring ? dx * reach : dx), y + t * h, z + (ring ? dz * reach : reach));
      out.push(g);
    }
  });
  if (order === "ionic" || order === "composite") {
    const bandY = y + (order === "ionic" ? 0.58 : 0.7) * h;
    const rv = (order === "ionic" ? 0.2 : 0.12) * h;
    const xv = 0.55 * d;
    if (ring) {
      const zv = 0.42 * d;
      const top = order === "ionic" ? 0.4 * h : 0.28 * h;
      out.push(box(x - 0.62 * d, x + 0.62 * d, bandY - top / 2, bandY + top / 2, z - zv, z + zv));
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) out.push(disc(x + sx * xv, bandY, z + sz * zv, rv, 0.06 * d));
    } else {
      for (const sx of [-1, 1]) out.push(disc(x + sx * xv, bandY, z + p + 0.04 * d, rv, 0.08 * d));
    }
  }
  return out;
}

// ---------- shaft ----------

// Each flute is a shallow V: an arris and the bottom of the groove. Few flutes, so the crease lines read as lines.
const FLUTE_AT = [0, 0.5];
const FLUTE_R = [1, 0.9];

function columnSection(order: Order, flutes: boolean, r0: number, cx: number, cz: number) {
  const count = order === "doric" ? 12 : 8;
  return (t: number): Array<[number, number]> => {
    // entasis: a slight swelling in the lower third on top of the straight taper
    const r = r0 * (1 - (1 - DIMINISH) * t) * (1 + 0.014 * Math.sin(Math.PI * Math.pow(t, 0.7)));
    const pts: Array<[number, number]> = [];
    if (!flutes) {
      for (let i = 0; i < SEGMENTS; i++) pts.push([cx + r * Math.cos((i / SEGMENTS) * Math.PI * 2), cz + r * Math.sin((i / SEGMENTS) * Math.PI * 2)]);
      return pts;
    }
    for (let f = 0; f < count; f++)
      FLUTE_AT.forEach((at, j) => {
        const a = ((f + at) / count) * Math.PI * 2;
        pts.push([cx + r * FLUTE_R[j]! * Math.cos(a), cz + r * FLUTE_R[j]! * Math.sin(a)]);
      });
    return pts;
  };
}

/** The front face of a pilaster: three V grooves when fluted; x narrows with t like the column, z stays. */
function pilasterSection(flutes: boolean, hw0: number, p: number, cx: number) {
  return (t: number): Array<[number, number]> => {
    const s = 1 - (1 - DIMINISH) * t;
    const hw = hw0 * s;
    const pts: Array<[number, number]> = [[cx - hw, -0.05], [cx + hw, -0.05], [cx + hw, p]];
    if (flutes) {
      const gw = 0.1 * hw0 * s;
      for (let g = 2; g >= 0; g--) {
        const xg = cx - hw + ((g + 0.5) * 2 * hw) / 3;
        pts.push([xg + gw, p], [xg, p - 0.04 * hw0 * 2], [xg - gw, p]);
      }
    }
    pts.push([cx - hw, p]);
    return pts;
  };
}

// ---------- base ----------

/** Torus, scotia, torus on a plinth: radial profile from the plinth top up to the shaft. */
function baseLathe(d: number, ph: number, k: number): Array<[number, number]> {
  const y = (v: number) => ph + v * d * k;
  const arc = (cr: number, cy: number, r: number): Array<[number, number]> =>
    arcPoints(0, 0, 1, -Math.PI / 2, Math.PI / 2, 6).map((v): [number, number] => [(cr + r * v.x) * d, y(cy) + r * v.y * d * k]);
  return [[0, y(0)], [0.575 * d, y(0)], ...arc(0.575, 0.06, 0.06), [0.54 * d, y(0.12)], [0.52 * d, y(0.14)], [0.505 * d, y(0.17)], [0.51 * d, y(0.2)], ...arc(0.54, 0.255, 0.05), [0.5 * d, y(0.305)], [0.5 * d, y(0.35)], [0, y(0.35)]];
}

function baseSteps(d: number, k: number, p: number): ProfileStep[] {
  const u = d * k;
  return [["o", p + 0.04 * d], ["torus", 0.1 * u, p + 0.075 * d], ["v", 0.03 * u], ["scotia", 0.08 * u, p + 0.04 * d], ["v", 0.02 * u], ["torus", 0.07 * u, p + 0.06 * d], ["o", p], ["v", 0.05 * u]];
}

// ---------- members ----------

/**
 * One member `height` high standing on y = 0 at (x, z): a column or half-column (z is the axis) or a
 * pilaster (its back on the wall z = 0). The lower diameter is height / Vignola ratio, or `m.width` if
 * that is smaller. Shafts are fluted except the tuscan one, unless `flutes` is false. A column without
 * a base (`base: false`, the Greek doric) stands directly on y = 0 with its shaft.
 */
export function orderMember(m: FacadeMember, height: number, x: number, z: number, opts: { flutes?: boolean; base?: boolean } = {}): THREE.BufferGeometry {
  const order: Order = m.order ?? "tuscan";
  const dims = orderDims(order, height, m.width);
  const { d, k } = dims;
  const flutes = (opts.flutes ?? true) && order !== "tuscan";
  const ph = 0.15 * d * k;
  const parts: THREE.BufferGeometry[] = [];
  const r0 = d / 2;
  const r1 = r0 * DIMINISH;
  const capOf = (p: number) => profile(dims.shaftY1, capSteps(order, dims.capH, d, p), 0).points.map(([o, y]): [number, number] => [Math.max(0, o), y]);

  if (m.type === "pilaster") {
    const p = 0.22 * d;
    parts.push(box(x - 0.62 * d, x + 0.62 * d, 0, ph, -0.05, p + 0.07 * d));
    parts.push(runAlongX(profile(ph, baseSteps(d, k, p)).points, x - 0.58 * d, x + 0.58 * d));
    parts.push(loft(pilasterSection(flutes, r0, p, x), dims.shaftY0, dims.shaftY1, 6, x, z));
    const cap = runAlongX(profile(dims.shaftY1, capSteps(order, dims.capH, d, p)).points, x - 0.62 * d, x + 0.62 * d);
    parts.push(cap, ...ornament(order, dims.shaftY1, dims.capH, d, p, x, z, false));
  } else {
    const based = opts.base !== false;
    if (based) {
      parts.push(box(x - 0.65 * d, x + 0.65 * d, 0, ph, z - 0.65 * d, z + 0.65 * d));
      parts.push(turned(baseLathe(d, ph, k), SEGMENTS).translate(x, 0, z));
    }
    parts.push(loft(columnSection(order, flutes, r0, x, z), based ? dims.shaftY0 : 0, dims.shaftY1, 8, x, z));
    parts.push(turned(capOf(r1), SEGMENTS).translate(x, 0, z));
    parts.push(...ornament(order, dims.shaftY1, dims.capH, d, r1, x, z, true));
  }
  return merge(parts);
}

/**
 * z of the axis of a member: pilasters and half-columns on the wall face, a column on its `freeZ` (a
 * colonnade) or, without one, clear of the wall with its abacus just touching it.
 */
export function memberAxisZ(m: FacadeMember, height: number, freeZ?: number): number {
  if (m.type !== "column") return 0;
  return freeZ ?? 0.62 * orderDims(m.order ?? "tuscan", height, m.width).d;
}

/**
 * The members of one site between the bays, from y0 to y1: orders for pilasters and columns, plain
 * (optionally rusticated) piers. A paired site draws two members side by side.
 */
export function memberSet(part: Part, m: FacadeMember, site: MemberSite, y0: number, y1: number, opts: { course: number; freeZ?: number }): void {
  const centres = site.pair ? [site.x - site.w / 2, site.x + site.w / 2] : [site.x];
  const w = site.pair ? site.w - 0.06 : site.w;
  for (const x of centres) {
    if (m.type === "pier") {
      if (m.rusticated) rusticBlocks(part, x - w / 2, x + w / 2, y0, y1, opts.course, [], RELIEF + 0.04);
      else part.box(x - w / 2, x + w / 2, y0, y1, 0, RELIEF);
    } else {
      const g = orderMember({ ...m, width: w }, y1 - y0, x, memberAxisZ({ ...m, width: w }, y1 - y0, opts.freeZ));
      g.translate(0, y0, 0);
      part.add(g);
    }
  }
}
