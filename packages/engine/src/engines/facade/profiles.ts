// Moulding profiles and the solids built from them. Every geometry is baked in building-local
// coordinates (x along the façade, y up, +z towards the viewer, the wall face at z = 0).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type ProfileStep = ["o", number] | ["v", number] | ["ovolo" | "cavetto" | "cyma" | "torus" | "scotia", number, number];

export interface Profile {
  /** [out, y] pairs: out is the projection from the wall (+z); the loop closes back on the wall. */
  points: Array<[number, number]>;
  top: number;
  projection: number;
}

const SAMPLES = 10;

/**
 * Moulding profile starting at `y0`: ["o", out] steps out to a projection, ["v", dh] rises on a
 * fillet, [kind, dh, out] rises dh along a curve ending at projection `out`. A torus bulges out to
 * `out` and returns to where it started; a scotia is a concave recess ending at `out`.
 */
export function profile(y0: number, steps: ProfileStep[], back = 0.05): Profile {
  const points: Array<[number, number]> = [
    [-back, y0],
    [0, y0],
  ];
  let y = y0;
  let o = 0;
  let projection = 0;
  for (const s of steps) {
    if (s[0] === "o") {
      o = s[1];
      points.push([o, y]);
    } else if (s[0] === "v") {
      y += s[1];
      points.push([o, y]);
    } else {
      const [kind, dh, o1] = s;
      const o0 = o;
      for (let i = 1; i <= SAMPLES; i++) {
        const t = i / SAMPLES;
        let out: number;
        if (kind === "torus") out = o0 + (o1 - o0) * Math.sin(Math.PI * t);
        else if (kind === "scotia") {
          const dip = Math.min(0.4 * dh, 0.5 * Math.max(o0, o1));
          out = Math.max(0, o0 + (o1 - o0) * t - dip * Math.sin(Math.PI * t));
        } else {
          const f = kind === "ovolo" ? Math.sin((t * Math.PI) / 2) : kind === "cavetto" ? 1 - Math.cos((t * Math.PI) / 2) : (1 - Math.cos(t * Math.PI)) / 2;
          out = o0 + (o1 - o0) * f;
        }
        points.push([out, y + dh * t]);
        projection = Math.max(projection, out);
      }
      y += dh;
      if (kind !== "torus") o = o1;
    }
    projection = Math.max(projection, o);
  }
  points.push([-back, y]);
  return { points, top: y, projection };
}

/** A profile (out = +z, y) run along x from x0 to x1 (mouldings, vault mass). */
export function runAlongX(points: Array<[number, number]>, x0: number, x1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([o, y]) => new THREE.Vector2(-o, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 40 });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return g;
}

/**
 * A moulding run around an opening with mitred corners. The profile's y is the distance from the
 * opening edge (outwards), its out the projection from the wall. "no-bottom" leaves the sill side
 * open: the legs end square at the opening's bottom edge.
 */
export function frameAround(
  points: Array<[number, number]>,
  rect: { x0: number; y0: number; x1: number; y1: number },
  sides: "all" | "no-bottom",
): THREE.BufferGeometry {
  const { x0, y0, x1, y1 } = rect;
  // A ring is the profile placed at a corner; d is the direction the profile's y offsets it
  // (a corner offsets diagonally, which is the 45 degree mitre for equal-width sides).
  const rings: Array<{ c: [number, number]; d: [number, number] }> =
    sides === "all"
      ? [
          { c: [x0, y0], d: [-1, -1] },
          { c: [x1, y0], d: [1, -1] },
          { c: [x1, y1], d: [1, 1] },
          { c: [x0, y1], d: [-1, 1] },
          { c: [x0, y0], d: [-1, -1] },
        ]
      : [
          { c: [x0, y0], d: [-1, 0] },
          { c: [x0, y1], d: [-1, 1] },
          { c: [x1, y1], d: [1, 1] },
          { c: [x1, y0], d: [1, 0] },
        ];
  const n = points.length;
  const pos: number[] = [];
  for (const r of rings) for (const [o, d] of points) pos.push(r.c[0] + r.d[0] * d, r.c[1] + r.d[1] * d, o);
  const idx = (ring: number, k: number) => ring * n + (k % n);
  const vert = (i: number) => new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);

  // Orientation of the profile loop, to wind every face outwards (checked on one quad, used for all).
  let area = 0;
  for (let k = 0; k < n; k++) {
    const a = points[k]!;
    const b = points[(k + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  let k0 = 0;
  while (k0 < n - 1 && Math.hypot(points[k0 + 1]![0] - points[k0]![0], points[k0 + 1]![1] - points[k0]![1]) < 1e-9) k0++;
  const eo = points[k0 + 1]![0] - points[k0]![0];
  const ed = points[k0 + 1]![1] - points[k0]![1];
  // outward in the (out, d) plane; 3D: out along z, d along the first run's offset direction
  const [po, pd] = area > 0 ? [ed, -eo] : [-ed, eo];
  // the first run is the bottom side (offset down) or, without a bottom, the left leg (offset left)
  const side = sides === "all" ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(-1, 0, 0);
  const outward = new THREE.Vector3(0, 0, po).addScaledVector(side, pd);
  const q0 = vert(idx(0, k0));
  const normal = new THREE.Vector3().subVectors(vert(idx(1, k0)), q0).cross(new THREE.Vector3().subVectors(vert(idx(1, k0 + 1)), q0));
  const flip = normal.dot(outward) < 0;

  const tri: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const a = idx(i, k);
      const b = idx(i + 1, k);
      const c = idx(i + 1, k + 1);
      const d = idx(i, k + 1);
      if (flip) tri.push(a, c, b, a, d, c);
      else tri.push(a, b, c, a, c, d);
    }
  }
  if (sides === "no-bottom") {
    const cap = THREE.ShapeUtils.triangulateShape(
      points.map(([o, d]) => new THREE.Vector2(o, d)),
      [],
    );
    const last = rings.length - 1;
    const ends: Array<[number, THREE.Vector3]> = [
      [0, new THREE.Vector3().subVectors(vert(idx(0, 0)), vert(idx(1, 0))).normalize()],
      [last, new THREE.Vector3().subVectors(vert(idx(last, 0)), vert(idx(last - 1, 0))).normalize()],
    ];
    for (const [ring, out] of ends) {
      for (const [a, b, c] of cap) {
        const ia = idx(ring, a!);
        const ib = idx(ring, b!);
        const ic = idx(ring, c!);
        const nrm = new THREE.Vector3().subVectors(vert(ib), vert(ia)).cross(new THREE.Vector3().subVectors(vert(ic), vert(ia)));
        if (nrm.dot(out) >= 0) tri.push(ia, ib, ic);
        else tri.push(ia, ic, ib);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(tri);
  // Face normals (the hull and the crease lines want a non-indexed mesh).
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

/** A shape drawn in the façade plane (x, y), extruded from z0 to z1, with an optional small bevel. */
export function slab(shape: THREE.Shape, z0: number, z1: number, bevel = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: z1 - z0 - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    curveSegments: 40,
  });
  g.translate(0, 0, z0 + bevel);
  return g;
}

// ---------- solids shared by the catalogue files ----------

/** Position and normal only, non-indexed, merged into one geometry (the inputs are disposed). */
export function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = gs.map((g) => {
    const f = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(f.attributes)) if (name !== "position" && name !== "normal") f.deleteAttribute(name);
    f.clearGroups();
    return f;
  });
  const out = mergeGeometries(flat);
  if (!out) throw new Error("catalogue geometries could not be merged");
  for (const g of [...flat, ...gs]) g.dispose();
  return out;
}

/** An axis-aligned block. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Flips the triangles of a closed mesh that is wound inwards (negative volume); returns a non-indexed copy. */
export function outward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const p = flat.getAttribute("position");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) volume += a.fromBufferAttribute(p, i).dot(b.fromBufferAttribute(p, i + 1).cross(c.fromBufferAttribute(p, i + 2)));
  if (volume >= 0) return flat;
  for (const attr of Object.values(flat.attributes)) {
    const at = attr as THREE.BufferAttribute;
    for (let i = 0; i < at.count; i += 3)
      for (let k = 0; k < at.itemSize; k++) {
        const x = at.array[(i + 1) * at.itemSize + k]!;
        at.array[(i + 1) * at.itemSize + k] = at.array[(i + 2) * at.itemSize + k]!;
        at.array[(i + 2) * at.itemSize + k] = x;
      }
  }
  const n = flat.getAttribute("normal");
  if (n) for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i]!;
  return flat;
}

/** Surface of revolution about the y axis from (radius, y) points, bottom to top on the outside. */
export function turned(points: Array<[number, number]>, segments = 14): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (const [r, y] of points) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(r - q.x, y - q.y) > 1e-7) pts.push(new THREE.Vector2(r, y));
  }
  return outward(new THREE.LatheGeometry(pts, segments));
}

/** Points on an arc of the circle (cx, cy, r) from angle a0 to a1 (radians, either direction), both ends included. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, n: number): THREE.Vector2[] {
  return [...Array(n + 1)].map((_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a));
  });
}

const faceNormal = (pos: number[], t: [number, number, number]): THREE.Vector3 => {
  const v = (i: number) => new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
  const a = v(t[0]);
  return v(t[1]).sub(a).cross(v(t[2]).sub(a));
};

/** The triangle, wound so that its normal has a non-negative dot with `dir`. */
function facing(pos: number[], t: [number, number, number], dir: THREE.Vector3): [number, number, number] {
  return faceNormal(pos, t).dot(dir) < 0 ? [t[0], t[2], t[1]] : t;
}

function finish(pos: number[], tri: number[], smooth = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(tri);
  if (smooth) g.computeVertexNormals();
  const flat = g.toNonIndexed();
  if (!smooth) flat.computeVertexNormals();
  g.dispose();
  return flat;
}

/**
 * A moulding profile swept along a path in the façade plane. The profile's y is the distance to the left
 * of the direction of travel (so walk clockwise around an opening to put the moulding outside), its out
 * the projection from the wall. Corners are mitred; an open path ends in flat caps. Same profile
 * convention as frameAround, but the path may curve (arches, pediments, circles).
 */
export function sweep(points: Array<[number, number]>, path: THREE.Vector2[], closed = false): THREE.BufferGeometry {
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) < 1e-7;
  const prof: Array<[number, number]> = [];
  for (const p of points) {
    const q = prof[prof.length - 1];
    if (!q || !near(p[0], p[1], q[0], q[1])) prof.push(p);
  }
  if (prof.length > 1 && near(prof[0]![0], prof[0]![1], prof[prof.length - 1]![0], prof[prof.length - 1]![1])) prof.pop();
  const pts: THREE.Vector2[] = [];
  for (const p of path) {
    const q = pts[pts.length - 1];
    if (!q || !near(p.x, p.y, q.x, q.y)) pts.push(p);
  }
  if (closed && pts.length > 1 && near(pts[0]!.x, pts[0]!.y, pts[pts.length - 1]!.x, pts[pts.length - 1]!.y)) pts.pop();
  const n = prof.length;
  const m = pts.length;
  const segs = closed ? m : m - 1;
  const tangent: THREE.Vector2[] = [];
  const left: THREE.Vector2[] = [];
  for (let i = 0; i < segs; i++) {
    const t = pts[(i + 1) % m]!.clone().sub(pts[i]!).normalize();
    tangent.push(t);
    left.push(new THREE.Vector2(-t.y, t.x));
  }
  // offset direction per path point: the mitre of the neighbouring edge normals
  const off = pts.map((_, i) => {
    const prev = closed ? left[(i - 1 + m) % m] : left[i - 1];
    const next = left[i];
    if (!prev) return next!.clone();
    if (!next) return prev.clone();
    const v = prev.clone().add(next).multiplyScalar(1 / (1 + prev.dot(next)));
    if (v.length() > 2.5) v.setLength(2.5);
    return v;
  });
  const pos: number[] = [];
  for (let i = 0; i < m; i++) for (const [o, d] of prof) pos.push(pts[i]!.x + off[i]!.x * d, pts[i]!.y + off[i]!.y * d, o);
  const idx = (ring: number, k: number) => (ring % m) * n + (k % n);

  // orientation of the profile loop gives the outward side of its first edge (checked on one quad, used for all)
  let area = 0;
  for (let k = 0; k < n; k++) area += prof[k]![0] * prof[(k + 1) % n]![1] - prof[(k + 1) % n]![0] * prof[k]![1];
  const eo = prof[1]![0] - prof[0]![0];
  const ed = prof[1]![1] - prof[0]![1];
  const [po, pd] = area > 0 ? [ed, -eo] : [-ed, eo];
  const want = new THREE.Vector3(off[0]!.x * pd, off[0]!.y * pd, po);
  const flip = faceNormal(pos, [idx(0, 0), idx(1, 0), idx(1, 1)]).dot(want) < 0;

  const tri: number[] = [];
  for (let i = 0; i < segs; i++)
    for (let k = 0; k < n; k++) {
      const a = idx(i, k);
      const b = idx(i + 1, k);
      const c = idx(i + 1, k + 1);
      const d = idx(i, k + 1);
      if (flip) tri.push(a, c, b, a, d, c);
      else tri.push(a, b, c, a, c, d);
    }
  if (!closed) {
    const cap = THREE.ShapeUtils.triangulateShape(
      prof.map(([o, d]) => new THREE.Vector2(o, d)),
      [],
    );
    const ends: Array<[number, THREE.Vector3]> = [
      [0, new THREE.Vector3(-tangent[0]!.x, -tangent[0]!.y, 0)],
      [m - 1, new THREE.Vector3(tangent[segs - 1]!.x, tangent[segs - 1]!.y, 0)],
    ];
    for (const [ring, dir] of ends) for (const [a, b, c] of cap) tri.push(...facing(pos, [idx(ring, a!), idx(ring, b!), idx(ring, c!)], dir));
  }
  return outward(finish(pos, tri));
}

/**
 * A prism along y whose cross-section (x, z points around the axis) changes with t = 0..1 from the bottom
 * to the top: column shafts and pilasters, with entasis, taper and flutes. Smooth normals; the sections
 * must all have the same point count and wind around (cx, cz).
 */
export function loft(section: (t: number) => Array<[number, number]>, y0: number, y1: number, stations: number, cx: number, cz: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const rings = [...Array(stations + 1)].map((_, i) => section(i / stations));
  const n = rings[0]!.length;
  rings.forEach((r, i) => {
    const y = y0 + ((y1 - y0) * i) / stations;
    for (const [x, z] of r) pos.push(x, y, z);
  });
  const tri: number[] = [];
  for (let i = 0; i < stations; i++)
    for (let k = 0; k < n; k++) {
      const a = i * n + k;
      const b = (i + 1) * n + k;
      const c = (i + 1) * n + ((k + 1) % n);
      const d = i * n + ((k + 1) % n);
      // every side triangle faces away from the axis
      for (const t of [[a, b, c], [a, c, d]] as Array<[number, number, number]>) {
        const away = new THREE.Vector3();
        for (const v of t) away.add(new THREE.Vector3(pos[v * 3]! - cx, 0, pos[v * 3 + 2]! - cz));
        tri.push(...facing(pos, t, away));
      }
    }
  // caps: a fan around the middle of the end ring
  for (const [ring, up] of [[0, -1], [stations, 1]] as Array<[number, number]>) {
    const mid = pos.length / 3;
    pos.push(cx, y0 + ((y1 - y0) * ring) / stations, cz);
    // own copy of the ring, so the cap is not smoothed into the side
    for (let k = 0; k < n; k++) pos.push(pos[(ring * n + k) * 3]!, pos[(ring * n + k) * 3 + 1]!, pos[(ring * n + k) * 3 + 2]!);
    for (let k = 0; k < n; k++) tri.push(...facing(pos, [mid, mid + 1 + k, mid + 1 + ((k + 1) % n)], new THREE.Vector3(0, up, 0)));
  }
  return outward(finish(pos, tri, true));
}
