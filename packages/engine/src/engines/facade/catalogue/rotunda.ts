// The rotunda: a cylinder with recesses (niches) and an entrance, and a dome on top of it (smooth or
// coffered, with an oculus, a drum, stepped rings on the outside of its base, a lantern). Two closed solids,
// both double-sided for the section shader and plan shader:
//
// - rotundaWall: floor slab, wall with its niches, cornice. A stack of prisms whose internal faces are left
//   out (the faces where one layer rests on another), so the whole is ONE closed surface: a cut through it,
//   horizontal or vertical, shows poché and nothing z-fights.
// - domeShell: the shell between an outer profile (steps, sphere, oculus ring, lantern) and the inner
//   sphere, which carries the coffers as stepped recesses.
//
// Building-local metres. The rotunda stands on the axis x = 0; `zCentre` is the z of its axis. Plan angles run
// from the entrance (towards +z, the façade) round to +x: a point at angle a and radius r is (r sin a, r cos a)
// in plan coordinates (u, v) = (x, z - zCentre). Everything is deterministic.
import * as THREE from "three";
import { rotundaDims, type FacadeRotunda } from "@pv/scene-spec";

type P = [number, number];
type V3 = [number, number, number];

const TAU = 2 * Math.PI;
/** Segments round the plain wall. */
const WALL_SEGMENTS = 96;
/** Thickness of the floor slab under the rotunda, metres. */
const FLOOR = 0.4;
/**
 * The dome stands this far above the top of the wall. Wall and dome are two solids, each closed on its own; resting the
 * dome exactly on the wall would put the wall's top face and the dome's base face in one plane, facing each other (they
 * would z-fight where a plan cut passes above the wall top). Two centimetres is a hairline at any scale of the façade.
 */
export const DOME_SEAT = 0.02;
/** Niches and the entrance reach this share of the wall height. */
const NICHE_HEIGHT = 0.55;

// ---------- the niches ----------

export interface Niche {
  kind: "door" | "rect" | "semi";
  /** Angle from the entrance, radians, 0 for the door. */
  angle: number;
  /** Half the width of the mouth, metres. */
  half: number;
  /** How deep it cuts into the wall (a door goes through). */
  depth: number;
}

/**
 * The entrance on the axis (angle 0) and `niches` recesses spread evenly round the circle with it (a slot
 * every 2 pi / (niches + 1)); slot k from the entrance is rectangular when min(k, slots - k) is odd and
 * semicircular when it is even, so the layout is symmetric about the axis and the apse opposite the entrance
 * of an even number of slots is semicircular (the Pantheon: 7 niches, rectangular and semicircular in turn).
 */
export function nicheLayout(r: FacadeRotunda): Niche[] {
  const d = rotundaDims(r);
  const slots = (r.niches ?? 0) + 1;
  // the chord between two neighbouring slot centres limits what fits
  const chord = slots > 1 ? 2 * d.radius * Math.sin(Math.PI / slots) : Infinity;
  const door: Niche = { kind: "door", angle: 0, half: Math.min(0.09 * r.diameter, 0.38 * chord), depth: d.wall };
  const out: Niche[] = [door];
  const half = Math.min(0.075 * r.diameter, 0.34 * chord);
  for (let k = 1; k < slots; k++) {
    const kind = Math.min(k, slots - k) % 2 === 1 ? "rect" : "semi";
    out.push({ kind, angle: (TAU * k) / slots, half, depth: Math.min(0.6 * d.wall, kind === "semi" ? half : Infinity) });
  }
  return out;
}

// ---------- the dome's numbers ----------

interface DomeShape {
  radius: number;
  outer: number;
  /** Radius of the outer sphere (concentric with the inner one). */
  sphere: number;
  /** Polar angle of the oculus edge on the inner sphere, 0 when closed. */
  phiOculus: number;
  /** Radius of the oculus. */
  oculus: number;
  steps: number;
  stepHeight: number;
  lantern: number;
  /** Depths of the two recess steps of a coffer. */
  coffer: [number, number];
}

function domeShape(r: FacadeRotunda): DomeShape {
  const d = rotundaDims(r);
  const R = d.radius;
  const od = r.dome.oculus ?? 0;
  const phiOculus = od > 0 ? Math.asin(Math.min(0.95, od / 2 / R)) : 0;
  const sphere = R + Math.min(0.06 * r.diameter, 0.7 * d.wall);
  const steps = r.dome.steps ?? 0;
  // the steps rise to where the outer sphere is still well clear of the inner one
  const clear = Math.sqrt(Math.max(0, sphere ** 2 - (R + 0.25 * (sphere - R)) ** 2));
  const stepHeight = steps > 0 ? Math.min(0.025 * r.diameter, clear / steps) : 0;
  const deep = Math.min(0.024 * r.diameter, 0.4 * (sphere - R));
  return { radius: R, outer: d.outer, sphere, phiOculus, oculus: R * Math.sin(phiOculus), steps, stepHeight, lantern: d.lantern, coffer: [deep / 2, deep] };
}

/** Depths of the two steps of a coffer's recess below the dome's inner surface (the second is the floor of the coffer). */
export function cofferDepths(r: FacadeRotunda): [number, number] {
  return domeShape(r).coffer;
}

/** Where things stand: the axis, the top of the wall, the springing of the dome and its crown (building-local). */
export function rotundaFrame(r: FacadeRotunda, bodyDepth: number): { zc: number; vOut: number; doorHalf: number; wallTop: number; spring: number; crown: number; centre: THREE.Vector3 } {
  const d = rotundaDims(r);
  const doorHalf = nicheLayout(r)[0]!.half;
  // the front of the rotunda is the chord of the entrance, which touches the back of the body (plus gap)
  const vOut = Math.sqrt(d.outer ** 2 - doorHalf ** 2);
  const zc = -(bodyDepth + (r.gap ?? 0) + vOut);
  const wallTop = (r.level ?? 0) + r.height;
  const spring = wallTop + DOME_SEAT + d.drum;
  const s = domeShape(r);
  const cutoff = domeCutoff(s);
  const crown = s.lantern > 0 ? spring + s.sphere * Math.cos(cutoff.phiLantern) + 1.1 * s.lantern : spring + s.sphere * Math.cos(cutoff.phiTop);
  return { zc, vOut, doorHalf, wallTop, spring, crown, centre: new THREE.Vector3(0, spring, zc) };
}

/** Polar angles on the outer sphere where the steps end, where the oculus ring begins and where the lantern stands. */
function domeCutoff(s: DomeShape): { phiSteps: number; phiTop: number; phiLantern: number } {
  const phiSteps = Math.acos(Math.min(1, (s.steps * s.stepHeight) / s.sphere));
  let phiTop = 0;
  if (s.phiOculus > 0) {
    const rim = Math.min(0.97 * phiSteps, Math.asin(Math.min(0.98, (s.oculus + 0.04 * s.radius * 2) / s.sphere)));
    phiTop = Math.max(rim, Math.asin(Math.min(0.98, s.oculus / s.sphere)) + 0.02);
    phiTop = Math.min(phiTop, 0.97 * phiSteps);
  }
  return { phiSteps, phiTop, phiLantern: Math.asin(Math.min(0.98, (0.07 * s.radius * 2) / s.sphere)) };
}

// ---------- triangles ----------

/** Triangles with a stated outward side: each is wound so that its normal has a non-negative dot with the given direction. */
class Soup {
  readonly pos: number[] = [];

  tri(a: V3, b: V3, c: V3, dir: V3): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-18) return;
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) this.pos.push(...a, ...b, ...c);
    else this.pos.push(...a, ...c, ...b);
  }

  quad(a: V3, b: V3, c: V3, d: V3, dir: V3): void {
    this.tri(a, b, c, dir);
    this.tri(a, c, d, dir);
  }

  geometry(name: string): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    g.name = name;
    return g;
  }
}

/** Drops repeated points and points on the straight line between their neighbours (a cap's triangulation would skip them). */
function tidy(loop: P[]): P[] {
  let pts = loop.filter((p, i) => Math.hypot(p[0] - loop[(i + 1) % loop.length]![0], p[1] - loop[(i + 1) % loop.length]![1]) > 1e-9);
  const straight = (i: number): boolean => {
    const a = pts[(i + pts.length - 1) % pts.length]!;
    const p = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) < 1e-9;
  };
  for (let i = pts.findIndex((_, k) => straight(k)); i >= 0 && pts.length > 3; i = pts.findIndex((_, k) => straight(k))) pts = pts.filter((_, k) => k !== i);
  return pts;
}

/** A prism's side walls: `loop` is in plan (u, v) with the material on its left, so the outside is on the right. */
function sides(s: Soup, loop: P[], zc: number, y0: number, y1: number): void {
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length]!;
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    if (Math.hypot(du, dv) < 1e-9) return;
    s.quad([a[0], y0, zc + a[1]], [b[0], y0, zc + b[1]], [b[0], y1, zc + b[1]], [a[0], y1, zc + a[1]], [dv, 0, -du]);
  });
}

/** A horizontal face over a plan region (a contour and its holes), looking up or down. */
function cap(s: Soup, outer: P[], holes: P[][], zc: number, y: number, up: boolean): void {
  const flat = [outer, ...holes].flat();
  const tris = THREE.ShapeUtils.triangulateShape(
    outer.map((p) => new THREE.Vector2(p[0], p[1])),
    holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))),
  );
  const at = (i: number): V3 => [flat[i]![0], y, zc + flat[i]![1]];
  for (const [a, b, c] of tris) s.tri(at(a!), at(b!), at(c!), [0, up ? 1 : -1, 0]);
}

const polar = (rad: number, a: number): P => [rad * Math.sin(a), rad * Math.cos(a)];

// ---------- the wall ----------

/**
 * Floor slab, wall with the entrance and the niches, cornice: one closed solid (see the file header). From the
 * bottom, the layers are the floor disc, the wall up to NICHE_HEIGHT of its height (the plan has the niches and the
 * entrance cut into it), the plain wall, and the cornice, which stands out a little. The front of the rotunda is the
 * chord of the entrance, so its front plane is flat against the body of the building.
 */
export function rotundaWall(r: FacadeRotunda, zCentre: number): THREE.BufferGeometry {
  const d = rotundaDims(r);
  const R = d.radius;
  const Ro = d.outer;
  const zc = zCentre;
  const list = nicheLayout(r);
  const door = list[0]!;
  const ae = door.half;
  const mouth = (half: number) => Math.sqrt(R * R - half * half);
  const vOut = Math.sqrt(Ro * Ro - ae * ae);
  const y0 = r.level ?? 0;
  const y1 = y0 + NICHE_HEIGHT * r.height;
  const top = y0 + r.height;
  const ch = Math.min(0.03 * r.diameter, 0.1 * r.height);
  const Rc = Ro + 0.02 * r.diameter;
  const beta = (half: number, rad: number) => Math.asin(half / rad);

  // outer boundary, round from the right corner of the entrance chord to its left corner (clockwise in plan)
  const outerCw: P[] = [[ae, vOut]];
  const a0 = beta(ae, Ro);
  const n0 = Math.max(3, Math.round(((TAU - 2 * a0) / TAU) * WALL_SEGMENTS));
  for (let i = 1; i < n0; i++) outerCw.push(polar(Ro, a0 + ((TAU - 2 * a0) * i) / n0));
  outerCw.push([-ae, vOut]);
  const outerCcw = [...outerCw].reverse();

  // inner boundary clockwise from the right corner of the entrance: arcs, and at every niche its mouth chord
  // (`chord`) or its pocket (`pocket`)
  const ring = list.slice(1);
  const corner = (n: Niche, side: -1 | 1): P => {
    const m = mouth(n.half);
    const rx = Math.sin(n.angle);
    const rz = Math.cos(n.angle);
    // tangent: the direction of growing angle
    return [m * rx + side * n.half * rz, m * rz - side * n.half * rx];
  };
  const pocketOf = (n: Niche): P[] => {
    const m = mouth(n.half);
    const rx = Math.sin(n.angle);
    const rz = Math.cos(n.angle);
    const at = (along: number, out: number): P => [(m + out) * rx + along * rz, (m + out) * rz - along * rx];
    if (n.kind === "rect") return [at(-n.half, n.depth), at(n.half, n.depth)];
    const pts: P[] = [];
    const seg = 12;
    for (let i = 1; i < seg; i++) {
      const t = Math.PI - (Math.PI * i) / seg;
      pts.push(at(n.half * Math.cos(t), n.depth * Math.sin(t)));
    }
    return pts;
  };
  const chordPath: P[] = [corner(door, 1)];
  const pocketPath: P[] = [corner(door, 1)];
  const pockets: P[][] = [];
  let from = beta(ae, R);
  const arc = (to: number): P[] => {
    const n = Math.max(1, Math.round(((to - from) / TAU) * WALL_SEGMENTS));
    return Array.from({ length: n - 1 }, (_, i) => polar(R, from + ((to - from) * (i + 1)) / n));
  };
  for (const n of ring) {
    const start = corner(n, -1);
    const end = corner(n, 1);
    const between = arc(n.angle - beta(n.half, R));
    chordPath.push(...between, start, end);
    const inside = pocketOf(n);
    pocketPath.push(...between, start, ...inside, end);
    pockets.push([start, ...inside, end]);
    from = n.angle + beta(n.half, R);
  }
  const lastArc = arc(TAU - beta(ae, R));
  chordPath.push(...lastArc, corner(door, -1));
  pocketPath.push(...lastArc, corner(door, -1));

  // the cornice: the outer circle a little bigger, cut off flat just in front of the entrance chord (clear of it, so no edge is shared)
  const corniceCcw = tidy(
    Array.from({ length: WALL_SEGMENTS }, (_, i) => {
      const p = polar(Rc, -(TAU * i) / WALL_SEGMENTS);
      return [p[0], Math.min(p[1], vOut + 0.02)] as P;
    }),
  );

  const s = new Soup();
  // floor disc
  // (a rotunda raised on the body's level stands on a solid podium down to the ground)
  const yFloor = y0 > FLOOR ? 0 : y0 - FLOOR;
  sides(s, outerCcw, zc, yFloor, y0);
  cap(s, outerCcw, [], zc, yFloor, false);
  cap(s, [...pocketPath, [-ae, vOut], [ae, vOut]], [], zc, y0, true);
  // wall with the niches and the entrance: one boundary, a "C" in plan
  sides(s, [...pocketPath, ...outerCcw], zc, y0, y1);
  // the ceilings of the niches and of the entrance, where the plain wall begins
  for (const p of pockets) cap(s, p, [], zc, y1, false);
  cap(s, [corner(door, 1), [ae, vOut], [-ae, vOut], corner(door, -1)], [], zc, y1, false);
  // plain wall
  sides(s, outerCcw, zc, y1, top - ch);
  sides(s, chordPath, zc, y1, top);
  // cornice
  sides(s, corniceCcw, zc, top - ch, top);
  cap(s, corniceCcw, [outerCcw], zc, top - ch, false);
  cap(s, corniceCcw, [chordPath], zc, top, true);
  return s.geometry("rotunda");
}

// ---------- the dome ----------

/** The lines of the coffer grid inside one coffer (fractions of its width): rib, first step, second step. */
const COFFER_LINES = [0, 0.1, 0.22, 0.78, 0.9, 1];

/**
 * The dome shell. Hemispherical on the inside (radius = the rotunda's, centred at the springing), with the oculus
 * cut out of the top; coffers are stepped recesses in the inner sphere (`rings` x `perRing`, each ring a little
 * lower than the one below); outside, a drum, stepped rings at the base, the outer sphere, the ring around the
 * oculus (or a lantern on a closed dome). Counting rule: every coffer has one floor quad at the deepest step, on the
 * sphere of radius `radius + cofferDepths(r)[1]`, so the floors are 2 x rings x perRing triangles.
 */
export function domeShell(r: FacadeRotunda, zCentre: number): THREE.BufferGeometry {
  const s = domeShape(r);
  const R = s.radius;
  const Ro = s.outer;
  const zc = zCentre;
  const y1 = (r.level ?? 0) + r.height + DOME_SEAT;
  const ys = y1 + (r.dome.drum ?? 0);
  const cut = domeCutoff(s);
  const D = r.diameter;
  const coffers = r.dome.type === "coffered" ? (r.dome.coffers ?? [5, 28]) : null;
  const perRing = coffers?.[1] ?? 0;
  const rings = coffers?.[0] ?? 0;

  // sectors round the axis: the lattice of the coffers when there are some
  const cols = coffers ? COFFER_LINES.length - 1 : 0;
  const theta: number[] = coffers
    ? Array.from({ length: perRing * cols }, (_, i) => (TAU * (Math.floor(i / cols) - 0.5 + COFFER_LINES[i % cols]!)) / perRing)
    : Array.from({ length: 96 }, (_, i) => (TAU * i) / 96);
  const N = theta.length;

  const sph = (rho: number, phi: number, th: number): V3 => [rho * Math.sin(phi) * Math.sin(th), ys + (phi === Math.PI / 2 ? 0 : rho * Math.cos(phi)), zc + rho * Math.sin(phi) * Math.cos(th)];
  const prof = (rad: number, y: number, th: number): V3 => [rad * Math.sin(th), y, zc + rad * Math.cos(th)];
  const soup = new Soup();

  // ---- outer profile, counter-clockwise (r, y) with the material on the left: bottom, outside, top
  // (without drum and steps the base is just the annulus up to the outer sphere: going out to Ro and back in would fold)
  const chain: P[] = [[R, y1]];
  if (ys > y1 || s.steps > 0) chain.push([Ro, y1]);
  if (ys > y1) chain.push([Ro, ys]);
  const yEnd = s.steps * s.stepHeight;
  const rEnd = Math.sqrt(s.sphere ** 2 - yEnd ** 2);
  const ledge = (Ro - rEnd) / Math.max(1, s.steps);
  for (let k = 1; k <= s.steps; k++) chain.push([Ro - (k - 1) * ledge, ys + k * s.stepHeight], [k === s.steps ? rEnd : Ro - k * ledge, ys + k * s.stepHeight]);
  if (s.steps === 0) chain.push([rEnd, ys]);
  const phiEnd = s.lantern > 0 ? Math.asin(Math.min(0.98, (0.07 * D) / s.sphere)) : cut.phiTop;
  const arcN = Math.max(4, Math.ceil(((cut.phiSteps - phiEnd) * 180) / Math.PI / 4));
  for (let i = 1; i <= arcN; i++) {
    const phi = cut.phiSteps + ((phiEnd - cut.phiSteps) * i) / arcN;
    chain.push([s.sphere * Math.sin(phi), ys + s.sphere * Math.cos(phi)]);
  }
  const yInner = ys + R * Math.cos(s.phiOculus);
  if (s.lantern > 0) {
    const ya = ys + s.sphere * Math.cos(phiEnd);
    const rl = 0.07 * D;
    chain.push([rl, ya + s.lantern], [1.25 * rl, ya + s.lantern], [1.25 * rl, ya + 1.1 * s.lantern], [0, ya + 1.1 * s.lantern], [0, ys + R]);
  } else if (s.phiOculus > 0) {
    chain.push([s.oculus, chain[chain.length - 1]![1]], [s.oculus, yInner]);
  } else {
    chain.push([0, ys + R]);
  }
  // the drum's inner face
  const inner: P[] = ys > y1 ? [[R, ys], [R, y1]] : [];

  const revolve = (pts: P[]): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [r0, h0] = pts[i]!;
      const [r1, h1] = pts[i + 1]!;
      const nr = h1 - h0;
      const nh = -(r1 - r0);
      for (let j = 0; j < N; j++) {
        const t0 = theta[j]!;
        const t1 = theta[(j + 1) % N]!;
        const tm = (t0 + (j + 1 === N ? t1 + TAU : t1)) / 2;
        soup.quad(prof(r0, h0, t0), prof(r1, h1, t0), prof(r1, h1, t1), prof(r0, h0, t1), [nr * Math.sin(tm), nh, nr * Math.cos(tm)]);
      }
    }
  };
  revolve(chain);
  revolve(inner);

  // ---- inner sphere: rows of polar angles from the oculus to the springing; each row says what a coffer's lines do there
  const rows: number[] = [s.phiOculus];
  /** For each row interval: -1 plain, else 0..4 the interval inside its coffer. */
  const kind: number[] = [];
  const plain = (to: number): void => {
    const from = rows[rows.length - 1]!;
    const n = Math.max(1, Math.ceil(((to - from) * 180) / Math.PI / 4));
    for (let i = 1; i <= n; i++) {
      rows.push(from + ((to - from) * i) / n);
      kind.push(-1);
    }
  };
  if (coffers) {
    const first = s.phiOculus + 0.15;
    plain(first);
    const weight = (i: number): number => 1 - (0.35 * i) / rings;
    const total = Array.from({ length: rings }, (_, i) => weight(i)).reduce((a, b) => a + b, 0);
    let at = first;
    for (let i = rings - 1; i >= 0; i--) {
      const h = ((Math.PI / 2 - first) * weight(i)) / total;
      const start = at;
      for (let k = 0; k < cols; k++) {
        at = i === 0 && k === cols - 1 ? Math.PI / 2 : start + h * COFFER_LINES[k + 1]!;
        rows.push(at);
        kind.push(k);
      }
      at = i === 0 ? Math.PI / 2 : start + h;
    }
  } else {
    plain(Math.PI / 2);
  }
  const level = (a: number, b: number): number => {
    if (!coffers) return 0;
    const col = a % cols;
    const row = kind[b]!;
    if (row < 0 || col === 0 || col === cols - 1 || row === 0 || row === cols - 1) return 0;
    return col === 2 && row === 2 ? 2 : 1;
  };
  const rho = (a: number, b: number): number => R + [0, s.coffer[0], s.coffer[1]][level(a, b)]!;
  const centre: V3 = [0, ys, zc];
  const mid = (pts: V3[]): V3 => [0, 1, 2].map((k) => pts.reduce((m, p) => m + p[k]!, 0) / pts.length) as V3;
  const patch = (a: number, b: number): V3[] => {
    const ra = rho(a, b);
    return [sph(ra, rows[b]!, theta[a]!), sph(ra, rows[b + 1]!, theta[a]!), sph(ra, rows[b + 1]!, theta[(a + 1) % N]!), sph(ra, rows[b]!, theta[(a + 1) % N]!)];
  };
  for (let b = 0; b + 1 < rows.length; b++)
    for (let a = 0; a < N; a++) {
      const q = patch(a, b);
      const c = mid(q);
      soup.quad(q[0]!, q[1]!, q[2]!, q[3]!, [centre[0] - c[0], centre[1] - c[1], centre[2] - c[2]]);
      // walls between this patch and the next one round the dome, and the next one up the dome
      const a2 = (a + 1) % N;
      if (level(a, b) !== level(a2, b)) {
        const [p, o] = [rho(a, b), rho(a2, b)];
        const deeper = o > p ? mid(patch(a2, b)) : c;
        const w: V3[] = [sph(p, rows[b]!, theta[a2]!), sph(p, rows[b + 1]!, theta[a2]!), sph(o, rows[b + 1]!, theta[a2]!), sph(o, rows[b]!, theta[a2]!)];
        const m = mid(w);
        soup.quad(w[0]!, w[1]!, w[2]!, w[3]!, [deeper[0] - m[0], deeper[1] - m[1], deeper[2] - m[2]]);
      }
      if (b + 2 < rows.length && level(a, b) !== level(a, b + 1)) {
        const [p, o] = [rho(a, b), rho(a, b + 1)];
        const deeper = o > p ? mid(patch(a, b + 1)) : c;
        const w: V3[] = [sph(p, rows[b + 1]!, theta[a]!), sph(p, rows[b + 1]!, theta[a2]!), sph(o, rows[b + 1]!, theta[a2]!), sph(o, rows[b + 1]!, theta[a]!)];
        const m = mid(w);
        soup.quad(w[0]!, w[1]!, w[2]!, w[3]!, [deeper[0] - m[0], deeper[1] - m[1], deeper[2] - m[2]]);
      }
    }
  return soup.geometry("dome");
}
