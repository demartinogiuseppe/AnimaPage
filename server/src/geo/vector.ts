// Small vector helpers for the geo build: clip to a bbox, simplify, merge OSM ways.
// Coordinates are [lon, lat] degrees. Distances for simplification are in degrees of
// latitude, with longitude scaled by cos(lat0) so the tolerance is isotropic.
import type { BBox } from "./terrarium.ts";

export type Pt = [number, number];

/** Sutherland–Hodgman clip of a closed ring (first point not repeated) against a bbox. */
export function clipRing(ring: Pt[], b: BBox): Pt[] {
  const edges: [(p: Pt) => boolean, (p: Pt, q: Pt) => Pt][] = [
    [(p) => p[0] >= b.lonMin, (p, q) => atLon(p, q, b.lonMin)],
    [(p) => p[0] <= b.lonMax, (p, q) => atLon(p, q, b.lonMax)],
    [(p) => p[1] >= b.latMin, (p, q) => atLat(p, q, b.latMin)],
    [(p) => p[1] <= b.latMax, (p, q) => atLat(p, q, b.latMax)],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!, q = input[(i + 1) % input.length]!;
      const pin = inside(p), qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cut(p, q));
    }
    if (out.length === 0) return out;
  }
  return out;
}

const atLon = (p: Pt, q: Pt, lon: number): Pt => [lon, p[1] + ((q[1] - p[1]) * (lon - p[0])) / (q[0] - p[0])];
const atLat = (p: Pt, q: Pt, lat: number): Pt => [p[0] + ((q[0] - p[0]) * (lat - p[1])) / (q[1] - p[1]), lat];

/** Splits a polyline into the parts inside the bbox (points outside are dropped, crossings interpolated). */
export function clipLine(line: Pt[], b: BBox): Pt[][] {
  const inside = (p: Pt) => p[0] >= b.lonMin && p[0] <= b.lonMax && p[1] >= b.latMin && p[1] <= b.latMax;
  const parts: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i]!;
    if (inside(p)) {
      if (cur.length === 0 && i > 0) cur.push(edgePoint(line[i - 1]!, p, b));
      cur.push(p);
    } else if (cur.length) {
      cur.push(edgePoint(p, line[i - 1]!, b));
      parts.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) parts.push(cur);
  return parts.filter((p) => p.length > 1);
}

/** Point where segment outside->inside crosses the bbox (bisection: plenty for our tolerances). */
function edgePoint(outside: Pt, inside: Pt, b: BBox): Pt {
  let a = outside, c = inside;
  for (let k = 0; k < 30; k++) {
    const m: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    if (m[0] >= b.lonMin && m[0] <= b.lonMax && m[1] >= b.latMin && m[1] <= b.latMax) c = m;
    else a = m;
  }
  return c;
}

/** Douglas–Peucker. `tol` in degrees of latitude; `cosLat` scales longitude. */
export function simplify(line: Pt[], tol: number, cosLat: number): Pt[] {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1, bestD = tol;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(line[i]!, line[s]!, line[e]!, cosLat);
      if (d > bestD) (bestD = d), (best = i);
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

function segDist(p: Pt, a: Pt, b: Pt, c: number): number {
  const px = p[0] * c, ax = a[0] * c, bx = b[0] * c;
  const dx = bx - ax, dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy));
}

/** Joins polylines that share endpoints (OSM river ways) into as few lines as possible. */
export function mergeLines(lines: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const pool = lines.map((l) => [...l]);
  const out: Pt[][] = [];
  while (pool.length) {
    let cur = pool.pop()!;
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i]!;
        const h = key(cur[0]!), t = key(cur[cur.length - 1]!), lh = key(l[0]!), lt = key(l[l.length - 1]!);
        if (t === lh) cur = [...cur, ...l.slice(1)];
        else if (t === lt) cur = [...cur, ...l.slice(0, -1).reverse()];
        else if (h === lt) cur = [...l, ...cur.slice(1)];
        else if (h === lh) cur = [...l.slice(1).reverse(), ...cur];
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

export const round = (p: Pt, d = 4): Pt => [Number(p[0].toFixed(d)), Number(p[1].toFixed(d))];

const ptKey = (p: Pt) => `${p[0]},${p[1]}`;

/**
 * Land borders between polygons that share vertices exactly (Natural Earth admin-0 is
 * topologically consistent): every edge used by two different features, chained into lines.
 * `features[f]` = all rings of feature f (closed: first point repeated).
 */
export function sharedBorders(features: Pt[][][]): Pt[][] {
  const owners = new Map<string, { a: Pt; b: Pt; fs: Set<number> }>();
  features.forEach((rings, f) => {
    for (const ring of rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const a = ring[k]!, b = ring[k + 1]!;
        const ka = ptKey(a), kb = ptKey(b);
        if (ka === kb) continue;
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = owners.get(key) ?? { a, b, fs: new Set<number>() };
        e.fs.add(f);
        owners.set(key, e);
      }
    }
  });
  const edges = [...owners.values()].filter((e) => e.fs.size > 1);
  // Chain: walk from endpoints of degree != 2 first, then close the remaining loops.
  const adj = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const k = ptKey(p);
      adj.set(k, [...(adj.get(k) ?? []), i]);
    }
  });
  const used = new Uint8Array(edges.length);
  const lines: Pt[][] = [];
  const walk = (start: Pt) => {
    const line: Pt[] = [start];
    let cur = start;
    for (;;) {
      const next = (adj.get(ptKey(cur)) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = 1;
      const e = edges[next]!;
      cur = ptKey(e.a) === ptKey(cur) ? e.b : e.a;
      line.push(cur);
    }
    if (line.length > 1) lines.push(line);
  };
  for (const [k, list] of adj) if (list.length !== 2) for (let n = 0; n < list.length; n++) walk(k.split(",").map(Number) as Pt);
  edges.forEach((e, i) => {
    if (!used[i]) walk(e.a);
  });
  return lines;
}

/** Length in degrees (longitude scaled by cosLat). */
export function lineLength(line: Pt[], cosLat: number): number {
  let d = 0;
  for (let k = 1; k < line.length; k++) d += Math.hypot((line[k]![0] - line[k - 1]![0]) * cosLat, line[k]![1] - line[k - 1]![1]);
  return d;
}

/** True if some vertex of `a` lies within `tol` degrees of an edge of `b` (counts at least `min` vertices). */
export function touches(a: Pt[][], b: Pt[][], tol: number, cosLat: number, min = 3): boolean {
  let hits = 0;
  for (const ring of a) {
    for (const p of ring) {
      for (const r of b) {
        let near = false;
        for (let k = 0; k + 1 < r.length; k++) {
          const s = r[k]!, e = r[k + 1]!;
          if (Math.min(s[0], e[0]) - tol > p[0] || Math.max(s[0], e[0]) + tol < p[0]) continue;
          if (Math.min(s[1], e[1]) - tol > p[1] || Math.max(s[1], e[1]) + tol < p[1]) continue;
          if (segDist(p, s, e, cosLat) < tol) {
            near = true;
            break;
          }
        }
        if (near && ++hits >= min) return true;
        if (near) break;
      }
    }
  }
  return false;
}
