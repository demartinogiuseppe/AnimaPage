// Pure geometry for the solid engine (no rendering): polyhedra from convex hulls with a stable
// element order, net unfolding transforms, lathe profiles of the solids of revolution, the nets of
// cylinder and cone, measures (closed forms) and plane sections. Lengths are real units; every solid
// stands on y = 0 centred on the y axis, front towards +z.
import * as THREE from "three";
import type { SolidItem, SolidShape } from "@pv/scene-spec";

export type Dims = { a: number; b: number; c: number; l: number; h: number; r: number; r2: number };

/** Dimension values of an item (missing ones 0) with overrides. */
export function dimsOf(item: SolidItem, over: Partial<Dims> = {}): Dims {
  const d = item.dims;
  return { a: d.a ?? 0, b: d.b ?? 0, c: d.c ?? 0, l: d.l ?? 0, h: d.h ?? 0, r: d.r ?? 0, r2: d.r2 ?? 0, ...over };
}

export const isCurved = (s: SolidShape) => s === "cylinder" || s === "cone" || s === "sphere" || s === "frustum";

// ------------------------------------------------------------ polyhedra

export interface Poly {
  verts: THREE.Vector3[];
  /** Vertex loops, counter-clockwise seen from outside. faces[0] is the base on the mat. */
  faces: number[][];
  edges: [number, number][];
  normals: THREE.Vector3[];
  centroids: THREE.Vector3[];
}

const PHI = (1 + Math.sqrt(5)) / 2;
const EPS = 1e-6;

/** Faces of the convex hull of `pts` (brute force: fine for ≤ 20 points). */
export function hullFaces(pts: THREE.Vector3[]): number[][] {
  const n = pts.length;
  const seen = new Set<string>();
  const faces: number[][] = [];
  const size = pts.reduce((m, p) => Math.max(m, p.length()), 1e-9);
  const eps = EPS * size;
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const nrm = new THREE.Vector3().crossVectors(ab.subVectors(pts[j]!, pts[i]!), ac.subVectors(pts[k]!, pts[i]!));
        if (nrm.length() < eps * size) continue;
        nrm.normalize();
        let pos = false;
        let neg = false;
        const on: number[] = [];
        for (let m = 0; m < n; m++) {
          const d = nrm.dot(ab.subVectors(pts[m]!, pts[i]!));
          if (d > eps) pos = true;
          else if (d < -eps) neg = true;
          else on.push(m);
        }
        if (pos && neg) continue;
        if (pos) nrm.negate();
        const id = on.join(",");
        if (seen.has(id)) continue;
        seen.add(id);
        // Order counter-clockwise around the outward normal.
        const c = on.reduce((s, m) => s.add(pts[m]!), new THREE.Vector3()).divideScalar(on.length);
        const u = pts[on[0]!]!.clone().sub(c).normalize();
        const v = new THREE.Vector3().crossVectors(nrm, u);
        const angle = (m: number) => {
          const d = pts[m]!.clone().sub(c);
          return Math.atan2(d.dot(v), d.dot(u));
        };
        faces.push([...on].sort((x, y) => angle(x) - angle(y)));
      }
  return faces;
}

/** Azimuth from the front (+z) towards +x, in [0, 2π): counter-clockwise seen from above. */
function azimuth(p: THREE.Vector3): number {
  if (Math.hypot(p.x, p.z) < 1e-7) return 0;
  const a = Math.atan2(p.x, p.z);
  return a < -1e-9 ? a + 2 * Math.PI : Math.max(0, a);
}
const byLevel = (p: THREE.Vector3, q: THREE.Vector3) => (Math.abs(p.y - q.y) > 1e-6 ? p.y - q.y : azimuth(p) - azimuth(q));

function rawVertices(shape: SolidShape, d: Dims, sides: number): THREE.Vector3[] {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (shape) {
    case "cube":
      return rawVertices("cuboid", { ...d, b: d.a, c: d.a }, sides);
    case "cuboid": {
      const out: THREE.Vector3[] = [];
      for (const x of [-d.a / 2, d.a / 2]) for (const y of [0, d.c]) for (const z of [-d.b / 2, d.b / 2]) out.push(V(x, y, z));
      return out;
    }
    case "prism":
    case "pyramid": {
      const R = d.l / (2 * Math.sin(Math.PI / sides));
      const base = Array.from({ length: sides }, (_, k) => {
        const al = -Math.PI / sides + (2 * Math.PI * k) / sides;
        return V(R * Math.sin(al), 0, R * Math.cos(al));
      });
      if (shape === "pyramid") return [...base, V(0, d.h, 0)];
      return [...base, ...base.map((p) => V(p.x, d.h, p.z))];
    }
    case "tetrahedron":
      return [V(1, 1, 1), V(1, -1, -1), V(-1, 1, -1), V(-1, -1, 1)];
    case "octahedron":
      return [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)];
    case "icosahedron": {
      const out: THREE.Vector3[] = [];
      for (const s of [-1, 1]) for (const t of [-1, 1]) out.push(V(0, s, t * PHI), V(s, t * PHI, 0), V(t * PHI, 0, s));
      return out;
    }
    case "dodecahedron": {
      const out: THREE.Vector3[] = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(V(x, y, z));
      for (const s of [-1, 1]) for (const t of [-1, 1]) out.push(V(0, s / PHI, t * PHI), V(s / PHI, t * PHI, 0), V(t * PHI, 0, s / PHI));
      return out;
    }
    default:
      throw new Error(`${shape} is not a polyhedron`);
  }
}

/** Polyhedron with its base face on y = 0, a base edge facing the front, real dimensions. */
export function polyhedron(shape: SolidShape, d: Dims, sides = 4): Poly {
  let verts = rawVertices(shape, d, sides);
  let faces = hullFaces(verts);
  const normalOf = (f: number[], vs: THREE.Vector3[]) =>
    new THREE.Vector3().crossVectors(vs[f[1]!]!.clone().sub(vs[f[0]!]!), vs[f[2]!]!.clone().sub(vs[f[0]!]!)).normalize();
  const regular = shape === "tetrahedron" || shape === "octahedron" || shape === "icosahedron" || shape === "dodecahedron";
  if (regular) {
    // Lay the lowest face on the mat, turn a base edge to the front, scale to edge `a`.
    const centroid = (f: number[]) => f.reduce((s, i) => s.add(verts[i]!), new THREE.Vector3()).divideScalar(f.length);
    const low = faces.reduce((best, f) => (centroid(f).y < centroid(best).y - 1e-9 ? f : best), faces[0]!);
    const q = new THREE.Quaternion().setFromUnitVectors(normalOf(low, verts), new THREE.Vector3(0, -1, 0));
    verts = verts.map((p) => p.clone().applyQuaternion(q));
    const c = centroid(low);
    let front = 0;
    let best = -Infinity;
    for (let k = 0; k < low.length; k++) {
      const m = verts[low[k]!]!.clone().add(verts[low[(k + 1) % low.length]!]!).multiplyScalar(0.5).sub(c);
      if (m.z > best + 1e-9) {
        best = m.z;
        front = k;
      }
    }
    const m = verts[low[front]!]!.clone().add(verts[low[(front + 1) % low.length]!]!).multiplyScalar(0.5).sub(c);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(m.x, m.z));
    const edge = verts[low[0]!]!.distanceTo(verts[low[1]!]!);
    const s = d.a / edge;
    verts = verts.map((p) => p.clone().sub(c).applyQuaternion(turn).multiplyScalar(s));
    // Snap rounding noise so element levels sort reliably.
    const miny = Math.min(...verts.map((p) => p.y));
    verts = verts.map((p) => new THREE.Vector3(p.x, p.y - miny, p.z));
    for (const p of verts) for (const k of ["x", "y", "z"] as const) if (Math.abs(p[k]) < 1e-9 * d.a) p[k] = 0;
  }
  // Stable order: vertices bottom-up and counter-clockwise from the front.
  const order = verts.map((_, i) => i).sort((i, j) => byLevel(verts[i]!, verts[j]!));
  verts = order.map((i) => verts[i]!);
  faces = hullFaces(verts);
  const normals0 = faces.map((f) => normalOf(f, verts));
  const centroids0 = faces.map((f) => f.reduce((s, i) => s.add(verts[i]!), new THREE.Vector3()).divideScalar(f.length));
  const idx = faces.map((_, i) => i);
  const bottom = idx.reduce((b, i) => (normals0[i]!.y < normals0[b]!.y ? i : b), 0);
  const top = idx.find((i) => normals0[i]!.y > 0.999999);
  const rest = idx.filter((i) => i !== bottom && i !== top).sort((i, j) => byLevel(centroids0[i]!, centroids0[j]!));
  const fOrder = [bottom, ...(top !== undefined ? [top] : []), ...rest];
  faces = fOrder.map((i) => faces[i]!);
  const normals = fOrder.map((i) => normals0[i]!);
  const centroids = fOrder.map((i) => centroids0[i]!);
  const keyOf = (i: number, j: number) => (i < j ? `${i},${j}` : `${j},${i}`);
  const edgeSet = new Map<string, [number, number]>();
  for (const f of faces)
    for (let k = 0; k < f.length; k++) {
      const i = f[k]!;
      const j = f[(k + 1) % f.length]!;
      edgeSet.set(keyOf(i, j), i < j ? [i, j] : [j, i]);
    }
  const mid = (e: [number, number]) => verts[e[0]]!.clone().add(verts[e[1]]!).multiplyScalar(0.5);
  const edges = [...edgeSet.values()].sort((e, f) => byLevel(mid(e), mid(f)));
  return { verts, faces, edges, normals, centroids };
}

export interface NetTree {
  /** Parent face per face (-1 for the base). */
  parent: number[];
  /** Hinge edge per face: point on the hinge and unit axis (folded coordinates). */
  hinge: { p: THREE.Vector3; axis: THREE.Vector3; angle: number }[];
  /** Faces in breadth-first order (parents before children). */
  order: number[];
}

/** Spanning tree of face adjacency from the base: the net. */
export function netTree(poly: Poly): NetTree {
  const n = poly.faces.length;
  const parent = new Array<number>(n).fill(-2);
  const hinge = Array.from({ length: n }, () => ({ p: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), angle: 0 }));
  const shared = (f: number[], g: number[]): [number, number] | null => {
    for (let k = 0; k < f.length; k++) {
      const i = f[k]!;
      const j = f[(k + 1) % f.length]!;
      if (g.includes(i) && g.includes(j)) return [i, j];
    }
    return null;
  };
  parent[0] = -1;
  const order = [0];
  for (let q = 0; q < order.length; q++) {
    const f = order[q]!;
    for (let g = 0; g < n; g++) {
      if (parent[g] !== -2) continue;
      const e = shared(poly.faces[f]!, poly.faces[g]!);
      if (!e) continue;
      parent[g] = f;
      order.push(g);
      const p = poly.verts[e[0]]!.clone();
      const axis = poly.verts[e[1]]!.clone().sub(p).normalize();
      const nc = poly.normals[g]!;
      const np = poly.normals[f]!;
      const angle = Math.atan2(new THREE.Vector3().crossVectors(nc, np).dot(axis), nc.dot(np));
      hinge[g] = { p, axis, angle };
    }
  }
  return { parent, hinge, order };
}

/** Face transforms at unfold amount u (0 folded, 1 flat net), in solid-local coordinates. */
export function netMatrices(tree: NetTree, u: number): THREE.Matrix4[] {
  const out = tree.parent.map(() => new THREE.Matrix4());
  const tmp = new THREE.Matrix4();
  for (const f of tree.order) {
    const par = tree.parent[f]!;
    if (par < 0) continue;
    const { p, axis, angle } = tree.hinge[f]!;
    const local = new THREE.Matrix4()
      .makeTranslation(p.x, p.y, p.z)
      .multiply(tmp.makeRotationAxis(axis, angle * u))
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    out[f]!.multiplyMatrices(out[par]!, local);
  }
  return out;
}

// ------------------------------------------------------------ solids of revolution

/** Generating figure (x = distance from the axis, y = height), counter-clockwise, on the axis at x = 0. */
export function profile(shape: SolidShape, d: Dims): THREE.Vector2[] {
  const P = (x: number, y: number) => new THREE.Vector2(x, y);
  switch (shape) {
    case "cylinder":
      return [P(0, 0), P(d.r, 0), P(d.r, d.h), P(0, d.h)];
    case "cone":
      return [P(0, 0), P(d.r, 0), P(0, d.h)];
    case "frustum":
      return [P(0, 0), P(d.r, 0), P(d.r2, d.h), P(0, d.h)];
    case "sphere":
      return Array.from({ length: 33 }, (_, i) => {
        const t = (Math.PI * i) / 32;
        return P(d.r * Math.sin(t), d.r - d.r * Math.cos(t));
      });
    default:
      throw new Error(`${shape} is not a solid of revolution`);
  }
}

/** Profile split into smooth runs (each one lathe), so flat caps keep flat normals. */
export function profileRuns(shape: SolidShape, d: Dims): THREE.Vector2[][] {
  const p = profile(shape, d);
  if (shape === "sphere") return [p];
  return p.slice(0, -1).map((a, i) => [a, p[i + 1]!]);
}

// ------------------------------------------------------------ curved nets

/** Unrolling phases of curved nets: unroll into the front tangent plane, then lay it on the mat. */
const UNROLL = 0.6;

/** Cylinder lateral point at angle phi (from the front, towards +x) and height y, unfold amount u. */
export function cylinderNetPoint(r: number, phi: number, y: number, u: number, out = new THREE.Vector3()): THREE.Vector3 {
  const v = Math.min(1, u / UNROLL);
  const s = r * phi;
  if (v >= 1 - 1e-9) out.set(s, y, r);
  else {
    const R = r / (1 - v);
    const psi = s / R;
    out.set(R * Math.sin(psi), y, r - 2 * R * Math.sin(psi / 2) ** 2);
  }
  return tipDown(out, r, u);
}

/** Phase 2: rotate about the front-bottom tangent line (y = 0, z = r) onto the mat by `full` radians. */
function tipDown(p: THREE.Vector3, r: number, u: number, full = Math.PI / 2): THREE.Vector3 {
  const w = Math.max(0, (u - UNROLL) / (1 - UNROLL));
  if (w <= 0) return p;
  const th = full * w;
  const y = p.y;
  const z = p.z - r;
  p.y = y * Math.cos(th) - z * Math.sin(th);
  p.z = r + y * Math.sin(th) + z * Math.cos(th);
  return p;
}

/** Cylinder top disc: hinge about the top-front tangent line, then tip down with the rectangle. */
export function cylinderTopMatrix(r: number, h: number, u: number): THREE.Matrix4 {
  const v = Math.min(1, u / UNROLL);
  const w = Math.max(0, (u - UNROLL) / (1 - UNROLL));
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const hingeTop = T(0, h, r).multiply(new THREE.Matrix4().makeRotationX((Math.PI / 2) * v)).multiply(T(0, -h, -r));
  const tip = T(0, 0, r).multiply(new THREE.Matrix4().makeRotationX((Math.PI / 2) * w)).multiply(T(0, 0, -r));
  return tip.multiply(hingeTop);
}

/** Cone lateral point at distance l from the apex along the generatrix at angle phi, unfold amount u. */
export function coneNetPoint(r: number, h: number, l: number, phi: number, u: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = Math.hypot(r, h);
  const v = Math.min(1, u / UNROLL);
  const R = r + (a - r) * v;
  const H = Math.sqrt(Math.max(0, a * a - R * R));
  const ph = (phi * r) / R;
  const rho = (l * R) / a;
  // Partial cone (apex at the origin, axis down), turned about x so its front generatrix stays put.
  const y0 = (-l * H) / a;
  const z0 = rho * Math.cos(ph);
  const th = Math.atan2(r, -h) - Math.atan2(R, -H);
  const y = y0 * Math.cos(th) - z0 * Math.sin(th);
  const z = y0 * Math.sin(th) + z0 * Math.cos(th);
  out.set(rho * Math.sin(ph), h + y, z);
  return tipDown(out, r, u, Math.PI / 2 + Math.atan2(r, h));
}

// ------------------------------------------------------------ measures

export interface Measures {
  V: number;
  A: number;
  Al: number;
  Ab: number;
  /** Apothem (pyramid: of a lateral face; cone and frustum: slant height). */
  ap: number;
  height: number;
}

/** Signed volume and area of a polyhedron (divergence theorem; exact). */
export function polyMeasures(poly: Poly): { V: number; A: number; faceAreas: number[] } {
  let V = 0;
  let A = 0;
  const faceAreas: number[] = [];
  const c = new THREE.Vector3();
  for (const f of poly.faces) {
    let fa = 0;
    const p0 = poly.verts[f[0]!]!;
    for (let k = 1; k + 1 < f.length; k++) {
      const p1 = poly.verts[f[k]!]!;
      const p2 = poly.verts[f[k + 1]!]!;
      c.crossVectors(p1, p2);
      V += p0.dot(c) / 6;
      fa += new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0)).length() / 2;
    }
    faceAreas.push(fa);
    A += fa;
  }
  return { V, A, faceAreas };
}

/** Volume, areas and apothem of a solid. Curved solids use the closed forms; polyhedra their mesh. */
export function measures(shape: SolidShape, d: Dims, sides = 4, poly?: Poly): Measures {
  const pi = Math.PI;
  switch (shape) {
    case "cylinder":
      return { V: pi * d.r * d.r * d.h, A: 2 * pi * d.r * d.r + 2 * pi * d.r * d.h, Al: 2 * pi * d.r * d.h, Ab: pi * d.r * d.r, ap: 0, height: d.h };
    case "cone": {
      const ap = Math.hypot(d.r, d.h);
      return { V: (pi * d.r * d.r * d.h) / 3, A: pi * d.r * (d.r + ap), Al: pi * d.r * ap, Ab: pi * d.r * d.r, ap, height: d.h };
    }
    case "frustum": {
      const ap = Math.hypot(d.h, d.r - d.r2);
      const Al = pi * (d.r + d.r2) * ap;
      return { V: (pi * d.h * (d.r * d.r + d.r * d.r2 + d.r2 * d.r2)) / 3, A: Al + pi * (d.r * d.r + d.r2 * d.r2), Al, Ab: pi * d.r * d.r, ap, height: d.h };
    }
    case "sphere":
      return { V: (4 / 3) * pi * d.r ** 3, A: 4 * pi * d.r * d.r, Al: 4 * pi * d.r * d.r, Ab: 0, ap: 0, height: 2 * d.r };
    default: {
      const p = poly ?? polyhedron(shape, d, sides);
      const m = polyMeasures(p);
      const Ab = m.faceAreas[0]!;
      const hasTop = p.normals[1]!.y > 0.999999;
      const Al = m.A - Ab - (hasTop ? m.faceAreas[1]! : 0);
      const height = Math.max(...p.verts.map((v) => v.y));
      const ap = shape === "pyramid" ? Math.hypot(d.h, d.l / (2 * Math.tan(pi / sides))) : 0;
      return { V: m.V, A: m.A, Al, Ab, ap, height };
    }
  }
}

/** Folded size of a solid: half-width along x, half-depth along z, height. */
export function extentOf(shape: SolidShape, d: Dims, sides = 4): { hx: number; hz: number; h: number } {
  if (isCurved(shape)) return { hx: d.r, hz: d.r, h: shape === "sphere" ? 2 * d.r : d.h };
  const p = polyhedron(shape, d, sides);
  return {
    hx: Math.max(...p.verts.map((v) => Math.abs(v.x))),
    hz: Math.max(...p.verts.map((v) => Math.abs(v.z))),
    h: Math.max(...p.verts.map((v) => v.y)),
  };
}

/** Bounding box of the flat net (u = 1) in solid-local coordinates. */
export function netBox(shape: SolidShape, d: Dims, sides = 4): THREE.Box3 {
  const box = new THREE.Box3();
  if (shape === "cylinder") {
    for (const phi of [-Math.PI, 0, Math.PI]) for (const y of [0, d.h]) box.expandByPoint(cylinderNetPoint(d.r, phi, y, 1));
    box.expandByPoint(new THREE.Vector3(-d.r, 0, -d.r)).expandByPoint(new THREE.Vector3(d.r, 0, d.r));
    const top = cylinderTopMatrix(d.r, d.h, 1);
    for (const [x, z] of [[-d.r, 0], [d.r, 0], [0, d.r], [0, -d.r]] as const) box.expandByPoint(new THREE.Vector3(x, d.h, z).applyMatrix4(top));
    return box;
  }
  if (shape === "cone") {
    const a = Math.hypot(d.r, d.h);
    for (let i = 0; i <= 16; i++) box.expandByPoint(coneNetPoint(d.r, d.h, a, -Math.PI + (2 * Math.PI * i) / 16, 1));
    box.expandByPoint(coneNetPoint(d.r, d.h, 0, 0, 1));
    box.expandByPoint(new THREE.Vector3(-d.r, 0, -d.r)).expandByPoint(new THREE.Vector3(d.r, 0, d.r));
    return box;
  }
  const p = polyhedron(shape, d, sides);
  const m = netMatrices(netTree(p), 1);
  p.faces.forEach((f, i) => f.forEach((v) => box.expandByPoint(p.verts[v]!.clone().applyMatrix4(m[i]!))));
  return box;
}

// ------------------------------------------------------------ sections

/** Plane through height `y0` tilted by `tilt` degrees about the x axis (0 = horizontal). */
export function sectionPlane(y0: number, tilt: number): THREE.Plane {
  const t = (tilt * Math.PI) / 180;
  const n = new THREE.Vector3(0, Math.cos(t), Math.sin(t));
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0, y0, 0));
}

/** Triangles (flat xyz list) of the closed solid surface, for sections. */
export function surfaceTriangles(shape: SolidShape, d: Dims, sides = 4, poly?: Poly): number[] {
  const out: number[] = [];
  if (!isCurved(shape)) {
    const p = poly ?? polyhedron(shape, d, sides);
    for (const f of p.faces)
      for (let k = 1; k + 1 < f.length; k++)
        for (const i of [f[0]!, f[k]!, f[k + 1]!]) out.push(p.verts[i]!.x, p.verts[i]!.y, p.verts[i]!.z);
    return out;
  }
  const prof = profile(shape, d);
  const N = 72;
  for (let j = 0; j + 1 < prof.length; j++)
    for (let i = 0; i < N; i++) {
      const a0 = (2 * Math.PI * i) / N;
      const a1 = (2 * Math.PI * (i + 1)) / N;
      const P = (q: THREE.Vector2, a: number) => [q.x * Math.sin(a), q.y, q.x * Math.cos(a)];
      const p00 = P(prof[j]!, a0);
      const p01 = P(prof[j]!, a1);
      const p10 = P(prof[j + 1]!, a0);
      const p11 = P(prof[j + 1]!, a1);
      out.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
  return out;
}

/** Section polygon (convex, ordered) of a convex surface with a plane; empty when the plane misses it. */
export function sectionPolygon(tris: number[], plane: THREE.Plane): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    for (let k = 0; k < 3; k++) P[k]!.set(tris[i + 3 * k]!, tris[i + 3 * k + 1]!, tris[i + 3 * k + 2]!);
    const dist = P.map((p) => plane.distanceToPoint(p));
    for (let k = 0; k < 3; k++) {
      const a = dist[k]!;
      const b = dist[(k + 1) % 3]!;
      if (Math.abs(a) < 1e-9) pts.push(P[k]!.clone());
      if ((a < -1e-9 && b > 1e-9) || (a > 1e-9 && b < -1e-9)) pts.push(P[k]!.clone().lerp(P[(k + 1) % 3]!, a / (a - b)));
    }
  }
  if (pts.length < 3) return [];
  const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const n = plane.normal;
  const u = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const flat = pts.map((p) => {
    const q = p.clone().sub(c);
    return { p, x: q.dot(u), y: q.dot(v) };
  });
  // Convex hull (monotone chain) in plane coordinates drops duplicates and inner points.
  flat.sort((A, B) => A.x - B.x || A.y - B.y);
  const cross = (o: (typeof flat)[0], A: (typeof flat)[0], B: (typeof flat)[0]) => (A.x - o.x) * (B.y - o.y) - (A.y - o.y) * (B.x - o.x);
  const hull: typeof flat = [];
  for (const pass of [flat, [...flat].reverse()]) {
    const start = hull.length;
    for (const q of pass) {
      while (hull.length >= start + 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, q) <= 1e-12) hull.pop();
      hull.push(q);
    }
    hull.pop();
  }
  return hull.length >= 3 ? hull.map((q) => q.p) : [];
}
