// Pure time/path helpers for the process engine: everything here is a function of its inputs,
// so update(chapterId, t) can be scrubbed in both directions.
import * as THREE from "three";
import { ease, seg } from "../../util/math.ts";

/** Default reveal and fade-out durations, seconds. */
export const REVEAL = 0.8;
export const FADE_OUT = 0.6;
const WINDOW_FADE = 0.3;

/** Presence 0..1 of an element listed with (at, until, reveal); `at` undefined = there from t=0. */
export function presence(t: number, at: number | undefined, until: number | undefined, reveal = REVEAL): number {
  const fadeIn = at === undefined ? 1 : ease.inOutQuad(seg(t, at, at + reveal));
  const fadeOut = until === undefined ? 1 : 1 - seg(t, until - Math.min(FADE_OUT, until - (at ?? 0)), until);
  return fadeIn * fadeOut;
}

/** 0..1 envelope inside [a, b] with short fades at the edges; max over all windows. */
export function windows(t: number, ws: readonly (readonly [number, number])[] | undefined): number {
  let env = 0;
  for (const [a, b] of ws ?? []) {
    const f = Math.min(WINDOW_FADE, (b - a) / 2);
    const e = f <= 0 ? (t === a ? 1 : 0) : seg(t, a, a + f) * (1 - seg(t, b - f, b));
    env = Math.max(env, e);
  }
  return env;
}

/** Polyline with arc-length parametrisation. */
export class Polyline {
  readonly pts: THREE.Vector3[];
  readonly cum: number[];
  readonly length: number;

  constructor(pts: THREE.Vector3[]) {
    if (pts.length < 2) throw new Error("a path needs at least 2 points");
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    this.length = Math.max(this.cum[this.cum.length - 1]!, 1e-6);
  }

  private find(d: number): number {
    let lo = 0;
    let hi = this.pts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid]! <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Point at distance d from the start (clamped). */
  at(d: number, out: THREE.Vector3): THREE.Vector3 {
    const x = Math.min(this.length, Math.max(0, d));
    const i = this.find(x);
    const a = this.pts[i]!;
    const b = this.pts[i + 1]!;
    const l = this.cum[i + 1]! - this.cum[i]!;
    return out.copy(a).lerp(b, l > 0 ? (x - this.cum[i]!) / l : 0);
  }

  /** Unit direction at distance d. */
  tangent(d: number, out: THREE.Vector3): THREE.Vector3 {
    const i = this.find(Math.min(this.length, Math.max(0, d)));
    out.subVectors(this.pts[i + 1]!, this.pts[i]!);
    return out.lengthSq() > 0 ? out.normalize() : out.set(1, 0, 0);
  }

  reversed(): Polyline {
    return new Polyline([...this.pts].reverse());
  }
}

/** Dense points on a smooth curve through `points`. */
export function smooth(points: THREE.Vector3[], closed = false, samples = 160): THREE.Vector3[] {
  if (points.length === 2 && !closed) return points.map((p) => p.clone());
  return new THREE.CatmullRomCurve3(points, closed, "centripetal").getSpacedPoints(samples);
}

/**
 * Distance travelled along the path by particle i of a flow, or null when not on the path.
 * Particles leave the start every `interval` seconds from tau = 0; a stream wraps around,
 * a one-off signal disappears at the end.
 */
export function particleDistance(
  i: number,
  tau: number,
  speed: number,
  length: number,
  interval: number,
  once: boolean,
): number | null {
  const d = (tau - i * interval) * speed;
  if (d < 0) return null;
  if (once) return d > length ? null : d;
  return d % length;
}

/** Seconds between particles: an evenly filled stream, or a short train for a signal. */
export function flowInterval(count: number, speed: number, length: number, once: boolean): number {
  const fill = length / speed / count;
  return once ? Math.min(fill, 0.35) : fill;
}

/**
 * Distances of the wave fronts (or ring radii) currently alive: fronts leave the source every
 * `spacing` units of travel starting at p = 0, and die at `max`.
 */
export function frontDistances(p: number, spacing: number, max: number): number[] {
  if (p < 0) return [];
  const out: number[] = [];
  for (let d = p % spacing; d <= Math.min(p, max); d += spacing) out.push(d);
  return out;
}
