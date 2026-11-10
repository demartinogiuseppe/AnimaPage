// Numeric helpers on compiled formulas, shared by the concept engine (drawing) and by the
// scene checks (verifying declared points and the numbers in the narration).
// Everything is deterministic: uniform sampling, bisection, golden-section search.

export type Fn = (x: number) => number;
export type Range = readonly [number, number];
export type XY = [number, number];

const finite = Number.isFinite;

/** Largest/smallest x of [a, b] where f is finite, given f(a) finite and f(b) NaN (or vice versa). */
function domainEdge(f: Fn, good: number, bad: number): number {
  for (let i = 0; i < 52; i++) {
    const m = (good + bad) / 2;
    if (finite(f(m))) good = m;
    else bad = m;
  }
  return good;
}

/**
 * True when the gap between f(x0) and f(x1) does not shrink with the interval: a pole or a jump
 * (1/x, tan x, floor x), as opposed to a steep but continuous stretch. Returns the break x too.
 */
function findBreak(f: Fn, x0: number, y0: number, x1: number, y1: number, minGap: number): number | null {
  for (let i = 0; i < 60 && x1 - x0 > 1e-13 * (1 + Math.abs(x0)); i++) {
    const xm = (x0 + x1) / 2;
    const ym = f(xm);
    if (!finite(ym)) return xm;
    if (Math.abs(ym - y0) > Math.abs(y1 - ym)) (x1 = xm), (y1 = ym);
    else (x0 = xm), (y0 = ym);
  }
  return Math.abs(y1 - y0) > minGap ? (x0 + x1) / 2 : null;
}

/** x in [a, b] where the continuous f crosses level `v` (f(a) - v and f(b) - v of opposite sign). */
function crossing(f: Fn, a: number, b: number, v: number): number {
  let fa = f(a) - v;
  for (let i = 0; i < 52; i++) {
    const m = (a + b) / 2;
    const fm = f(m) - v;
    if (!finite(fm)) break;
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) (a = m), (fa = fm);
    else b = m;
  }
  return (a + b) / 2;
}

export interface SampleOptions {
  /** Cut the curve where it leaves [lo, hi] (exact crossing points). */
  yClip?: Range;
}

/**
 * Samples f on [a, b] into continuous pieces of [x, y] points. The curve breaks where f is
 * undefined (NaN) and at poles and jumps; piece ends are refined to the domain edge, and
 * near a pole extended towards it until the curve leaves the clip range.
 */
export function sampleCurve(f: Fn, range: Range, n = 200, opts: SampleOptions = {}): XY[][] {
  const [a, b] = range;
  const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const ys = xs.map(f);
  const good = ys.filter(finite);
  const span = opts.yClip ? opts.yClip[1] - opts.yClip[0] : good.length ? Math.max(...good) - Math.min(...good) : 1;
  const jumpTol = 0.02 * (span || 1);
  const minGap = 1e-4 * (span || 1);
  const limit = opts.yClip ? Math.max(Math.abs(opts.yClip[0]), Math.abs(opts.yClip[1])) * 2 + span : 1e6;

  const pieces: XY[][] = [];
  let cur: XY[] = [];
  const close = () => {
    if (cur.length >= 2 && cur[cur.length - 1]![0] - cur[0]![0] > 1e-9 * (b - a)) pieces.push(cur);
    cur = [];
  };
  /** Points approaching a pole at xb from x0 (direction given by the sign of xb - x0). */
  const approach = (x0: number, xb: number): XY[] => {
    const out: XY[] = [];
    for (let k = 1; k <= 40; k++) {
      const x = xb - (xb - x0) * 2 ** -k;
      const y = f(x);
      if (!finite(y)) break;
      out.push([x, y]);
      if (Math.abs(y) > limit) break;
    }
    return out;
  };

  for (let i = 0; i <= n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (!finite(y)) {
      if (cur.length && i > 0) {
        const e = domainEdge(f, xs[i - 1]!, x);
        if (e > cur[cur.length - 1]![0]) cur.push([e, f(e)]);
      }
      close();
      continue;
    }
    if (!cur.length && i > 0 && !finite(ys[i - 1]!)) {
      const e = domainEdge(f, x, xs[i - 1]!);
      if (e < x) cur.push([e, f(e)]);
    }
    if (cur.length && i > 0 && finite(ys[i - 1]!) && Math.abs(y - ys[i - 1]!) > jumpTol) {
      const xb = findBreak(f, xs[i - 1]!, ys[i - 1]!, x, y, minGap);
      if (xb !== null) {
        cur.push(...approach(xs[i - 1]!, xb));
        close();
        cur.push(...approach(x, xb).reverse());
      }
    }
    cur.push([x, y]);
  }
  close();
  return opts.yClip ? pieces.flatMap((p) => clipPiece(f, p, opts.yClip!)) : pieces;
}

function clipPiece(f: Fn, pts: XY[], [lo, hi]: Range): XY[][] {
  const out: XY[][] = [];
  let cur: XY[] = [];
  const inside = (y: number) => y >= lo && y <= hi;
  const level = (y: number) => (y > hi ? hi : lo);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]!;
    const prev = pts[i - 1];
    if (inside(y)) {
      if (prev && !inside(prev[1])) {
        const v = level(prev[1]);
        cur.push([crossing(f, prev[0], x, v), v]);
      }
      cur.push([x, y]);
    } else if (prev && inside(prev[1])) {
      const v = level(y);
      cur.push([crossing(f, prev[0], x, v), v]);
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

// ---------- derivatives ----------

/** Central difference f'(x); NaN where f is undefined around x. */
export function derivative(f: Fn, x: number): number {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (f(x + h) - f(x - h)) / (2 * h);
}

export function secondDerivative(f: Fn, x: number): number {
  const h = 1e-4 * Math.max(1, Math.abs(x));
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
}

// ---------- roots, extrema, inflections ----------

interface RootOptions {
  n?: number;
  /** Also accept touching zeros (local minima of |g| that reach 0), e.g. (x − 2)². */
  touching?: boolean;
  /** Ignore sign changes between samples smaller than this (numeric noise). */
  noise?: number;
}

function bisect(g: Fn, a: number, b: number): number {
  let ga = g(a);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const gm = g(m);
    if (gm === 0) return m;
    if (!finite(gm)) return NaN;
    if (Math.sign(gm) === Math.sign(ga)) (a = m), (ga = gm);
    else b = m;
  }
  return (a + b) / 2;
}

function goldenMinAbs(g: Fn, a: number, b: number): number {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a);
  let d = a + r * (b - a);
  for (let i = 0; i < 80; i++) {
    if (Math.abs(g(c)) < Math.abs(g(d))) b = d;
    else a = c;
    c = b - r * (b - a);
    d = a + r * (b - a);
  }
  return (a + b) / 2;
}

/** Sign changes of g in the range (and optionally touching zeros), with the sign before each root. */
function roots(g: Fn, [a, b]: Range, opts: RootOptions = {}): { x: number; from: number }[] {
  const n = opts.n ?? 400;
  const noise = opts.noise ?? 0;
  const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const gs = xs.map(g);
  const scale = Math.max(1e-12, ...gs.filter(finite).map(Math.abs));
  const out: { x: number; from: number }[] = [];
  const push = (x: number, from: number) => {
    if (!finite(x) || x < a || x > b) return;
    if (out.some((r) => Math.abs(r.x - x) < 1e-7 * (b - a))) return;
    out.push({ x, from });
  };
  for (let i = 0; i <= n; i++) {
    const g0 = gs[i]!;
    const g1 = gs[i + 1];
    if (g0 === 0) {
      const before = gs[i - 1] ?? NaN;
      const after = g1 ?? NaN;
      if (opts.touching || Math.sign(before) * Math.sign(after) < 0) push(xs[i]!, Math.sign(before));
      continue;
    }
    if (g1 === undefined || !finite(g0) || !finite(g1)) continue;
    if (g0 * g1 < 0 && Math.abs(g0) > noise && Math.abs(g1) > noise) {
      const r = bisect(g, xs[i]!, xs[i + 1]!);
      // A sign change across a pole is not a root: g must be small there.
      const gr = g(r);
      if (finite(gr) && Math.abs(gr) <= Math.max(1e-6 * scale, 1e-3 * Math.min(Math.abs(g0), Math.abs(g1)))) push(r, Math.sign(g0));
    } else if (opts.touching && i > 0 && finite(gs[i - 1]!) && Math.abs(g0) < Math.abs(gs[i - 1]!) && Math.abs(g0) <= Math.abs(g1) && g0 * gs[i - 1]! > 0 && g0 * g1 > 0) {
      const m = goldenMinAbs(g, xs[i - 1]!, xs[i + 1]!);
      if (Math.abs(g(m)) < 1e-9 * Math.max(1, scale)) push(m, Math.sign(g0));
    }
  }
  return out.sort((p, q) => p.x - q.x);
}

export interface DomainEdge {
  x: number;
  y: number;
  /** +1: f is defined to the right of x, −1: to the left. */
  side: 1 | -1;
}

/**
 * Closed ends of the domain inside the range: where f stops being defined but has a finite
 * value at the edge (sqrt(x + 2) at −2, sqrt(4 − x²) at ±2). Edges where f runs off to
 * infinity (ln x at 0) are not closed and are skipped.
 */
export function domainEdges(f: Fn, [a, b]: Range, n = 400): DomainEdge[] {
  const out: DomainEdge[] = [];
  const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const ys = xs.map(f);
  const delta = 1e-6 * (b - a);
  for (let i = 0; i < n; i++) {
    const g0 = finite(ys[i]!);
    const g1 = finite(ys[i + 1]!);
    if (g0 === g1) continue;
    const side: 1 | -1 = g1 ? 1 : -1;
    const x = g1 ? domainEdge(f, xs[i + 1]!, xs[i]!) : domainEdge(f, xs[i]!, xs[i + 1]!);
    const y = f(x);
    const near = f(x + side * delta);
    if (finite(y) && finite(near) && Math.abs(near - y) < 1e-2 * (1 + Math.abs(y))) out.push({ x, y, side });
  }
  return out;
}

/** Scale of |f| over the range (tolerances relative to the size of the values). */
function valueScale(f: Fn, [a, b]: Range): number {
  let m = 0;
  for (let i = 0; i <= 100; i++) {
    const y = f(a + ((b - a) * i) / 100);
    if (finite(y)) m = Math.max(m, Math.abs(y));
  }
  return m;
}

const dedupe = (xs: number[], eps: number) => xs.sort((p, q) => p - q).filter((x, i, all) => i === 0 || x - all[i - 1]! > eps);

/** Zeros of f in the range (crossing, touching, and at a closed end of the domain such as sqrt(x + 2) at −2). */
export function findZeros(f: Fn, range: Range, n = 400): number[] {
  const tol = 1e-6 * (1 + valueScale(f, range));
  const edges = domainEdges(f, range, n).filter((e) => Math.abs(e.y) <= tol).map((e) => e.x);
  return dedupe([...roots(f, range, { n, touching: true }).map((r) => r.x), ...edges], 1e-7 * (range[1] - range[0]));
}

export interface Extremum {
  x: number;
  y: number;
  kind: "max" | "min";
}

/**
 * Relative maxima/minima: sign changes of f' (including corners such as |x| at 0) and closed
 * ends of the domain, where the extremum is one-sided (sqrt(x + 2) has its minimum at −2).
 */
export function findExtrema(f: Fn, range: Range, n = 400): Extremum[] {
  const inner = roots((x) => derivative(f, x), range, { n })
    .filter((r) => finite(f(r.x)))
    .map((r) => ({ x: r.x, y: f(r.x), kind: r.from > 0 ? ("max" as const) : ("min" as const) }));
  const h = (range[1] - range[0]) / n;
  const edges = domainEdges(f, range, n).flatMap((e): Extremum[] => {
    const next = f(e.x + e.side * h);
    if (!finite(next) || next === e.y) return [];
    return [{ x: e.x, y: e.y, kind: next > e.y ? "min" : "max" }];
  });
  const eps = 1e-7 * (range[1] - range[0]);
  return [...inner, ...edges.filter((e) => !inner.some((q) => Math.abs(q.x - e.x) < eps))].sort((p, q) => p.x - q.x);
}

/** Inflection points (sign changes of f''). */
export function findInflections(f: Fn, range: Range, n = 400): number[] {
  const g = (x: number) => secondDerivative(f, x);
  return roots(g, range, { n, noise: 1e-6 }).map((r) => r.x).filter((x) => finite(f(x)));
}

export interface NotablePoints {
  zeros: number[];
  extrema: Extremum[];
  inflections: number[];
  /** f(0) when 0 is in the range and in the domain. */
  yIntercept: number | null;
}

export function notablePoints(f: Fn, range: Range): NotablePoints {
  const y0 = range[0] <= 0 && range[1] >= 0 ? f(0) : NaN;
  return {
    zeros: findZeros(f, range),
    extrema: findExtrema(f, range),
    inflections: findInflections(f, range),
    yIntercept: finite(y0) ? y0 : null,
  };
}

// ---------- point kinds, asymptotes, symmetry ----------

export type PointKind = "zero" | "vertex" | "max" | "min" | "inflection" | "y-intercept" | "point";

export interface ResolvedPoint {
  /** False when the declared x is not a point of that kind (within tolerance). */
  ok: boolean;
  /** x snapped to the computed point (or the declared x). */
  x: number;
  y: number;
  /** English reason when !ok. */
  problem?: string;
}

/** Tolerance on a declared x: 0.2% of the range width. */
export const xTolerance = ([a, b]: Range) => Math.max(1e-6, 2e-3 * (b - a));

/** Computes y for a declared point and checks it numerically against its kind. */
export function resolvePoint(f: Fn, kind: PointKind, x: number | undefined, range: Range): ResolvedPoint {
  const tol = xTolerance(range);
  const fail = (px: number, problem: string): ResolvedPoint => ({ ok: false, x: px, y: f(px), problem });
  if (kind === "y-intercept") {
    if (x !== undefined && Math.abs(x) > tol) return fail(x, `y-intercept must have x = 0, not ${x}`);
    const y = f(0);
    return finite(y) ? { ok: true, x: 0, y } : fail(0, "x = 0 is not in the domain");
  }
  if (x === undefined) return fail(NaN, `a "${kind}" point needs x`);
  if (x < range[0] - tol || x > range[1] + tol) return fail(x, `x = ${x} is outside the graph`);
  // Not defined at x but on both sides: a hole (x²/x at 0, finite limit) or a pole/jump (1/x at 0).
  // Neither is a point of the graph.
  if (!finite(f(x)) && finite(f(x - tol)) && finite(f(x + tol))) {
    const l = f(x - tol / 1000);
    const r = f(x + tol / 1000);
    return Math.abs(l - r) < 1e-3 * (1 + Math.abs(l))
      ? fail(x, `x = ${x} is a hole: f is not defined there (the curve has a gap, limit ≈ ${+((l + r) / 2).toFixed(4)})`)
      : fail(x, `x = ${x} is not in the domain (vertical asymptote or jump)`);
  }
  if (kind === "point") return finite(f(x)) ? { ok: true, x, y: f(x) } : fail(x, `x = ${x} is not in the domain`);
  // Search a little beyond the range so points on the edge are found.
  const r: Range = [range[0] - 2 * tol, range[1] + 2 * tol];
  let candidates: number[];
  if (kind === "zero") candidates = findZeros(f, r);
  else if (kind === "inflection") candidates = findInflections(f, r);
  else candidates = findExtrema(f, r).filter((e) => kind === "vertex" || e.kind === kind).map((e) => e.x);
  let best = NaN;
  for (const c of candidates) if (!(Math.abs(c - x) >= Math.abs(best - x))) best = c;
  if (!finite(best) || Math.abs(best - x) > tol) {
    const near = finite(best) ? ` (nearest at x ≈ ${+best.toFixed(4)})` : ` (none in the graph range)`;
    return fail(x, `x = ${x} is not a ${kind === "vertex" ? "vertex (max or min)" : kind}${near}`);
  }
  return { ok: true, x: best, y: f(best) };
}

export type Line = { x: number } | { y: number } | { m: number; q: number };

/** Is `line` an asymptote of f (vertical: |f| grows without bound; else f − line → 0 at ±∞)? */
export function isAsymptote(f: Fn, line: Line, range: Range): boolean {
  const w = range[1] - range[0];
  if ("x" in line) {
    const a = line.x;
    for (const side of [-1, 1]) {
      const v = (k: number) => Math.abs(f(a + side * w * 10 ** -k));
      const v2 = v(2);
      let max = -Infinity;
      for (let k = 3; k <= 9; k++) if (finite(v(k))) max = Math.max(max, v(k));
      if (finite(v2) && max >= 2 * v2 + 5) return true;
    }
    return false;
  }
  const [m, q] = "y" in line ? [0, line.y] : [line.m, line.q];
  for (const dir of [-1, 1]) {
    const gap = (X: number) => Math.abs(f(X) - (m * X + q));
    const far = [3, 4, 5, 6].map((k) => gap(dir * 10 ** k * Math.max(1, w / 10)));
    if (far.every(finite) && far[3]! < 1e-2 * Math.max(1, Math.abs(q)) && far[3]! <= far[0]! + 1e-12) return true;
  }
  return false;
}

/** Is x = a an axis of symmetry of f: f(a + h) = f(a − h) wherever both are defined in the range? */
export function isSymmetryAxis(f: Fn, a: number, range: Range): boolean {
  const half = Math.max(a - range[0], range[1] - a);
  let checked = 0;
  for (let i = 1; i <= 100; i++) {
    const h = (half * i) / 100;
    const p = f(a + h);
    const m = f(a - h);
    if (finite(p) !== finite(m)) return false;
    if (!finite(p)) continue;
    if (Math.abs(p - m) > 1e-6 * (1 + Math.abs(p))) return false;
    checked++;
  }
  return checked >= 5;
}

/** "even" (f(−x) = f(x)), "odd" (f(−x) = −f(x)) or "neither", tested on [−r, r] with r = max |range|. */
export function parity(f: Fn, range: Range): "even" | "odd" | "neither" {
  const r = Math.max(Math.abs(range[0]), Math.abs(range[1]));
  let even = true;
  let odd = true;
  let checked = 0;
  for (let i = 1; i <= 100; i++) {
    const x = (r * i) / 100 + 1e-3 * r * Math.sin(i);
    const p = f(x);
    const m = f(-x);
    if (finite(p) !== finite(m)) return "neither";
    if (!finite(p)) continue;
    checked++;
    const tol = 1e-6 * (1 + Math.abs(p));
    if (Math.abs(m - p) > tol) even = false;
    if (Math.abs(m + p) > tol) odd = false;
  }
  if (!checked) return "neither";
  return even ? "even" : odd ? "odd" : "neither";
}
