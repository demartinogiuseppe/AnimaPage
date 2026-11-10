// Seismic rays across the half globe (pure geometry, 2D in the x-y plane, focus at the top (0, R)).
//
// Schematic but consistent with the scene's sourced shadow-zone angles:
// - mantle rays land at angular distances below pFrom (P) / sFrom (S); they dive as arcs whose
//   deepest point grows with the distance, so the ray landing at pFrom just grazes the core;
// - P rays that enter the liquid outer core bend at the core boundary (refraction) and land
//   between pTo and 180°, leaving the P shadow zone empty;
// - S rays aimed at the core stop at its boundary (S waves do not cross liquids).
// Wave speed is constant along a ray except in the core, where P slows down (CORE_P).
import * as THREE from "three";

const DEG = Math.PI / 180;
/** P speed in the outer core relative to the mantle (drop from >13 to ~8 km/s, it.wikipedia "Discontinuità di Gutenberg"). */
export const CORE_P = 8 / 13;
/** S speed relative to P (60–70 %, it.wikipedia "Terremoto"). */
export const S_RATIO = 0.6;

export interface Ray {
  wave: "P" | "S";
  /** Angular distance of the landing point, degrees (signed: + right, - left). */
  delta: number;
  pts: THREE.Vector3[];
  /** Travel time factor per point (cumulative "slowness-weighted" length), same length as pts. */
  time: number[];
  /** True when the ray ends at the core boundary (an S ray stopped). */
  stopped: boolean;
}

export interface RayModel {
  R: number;
  /** Visual radius of the core boundary (top of the first liquid layer). */
  rc: number;
  pFrom: number;
  pTo: number;
  sFrom: number;
}

const polar = (theta: number, r: number) => new THREE.Vector3(r * Math.sin(theta), r * Math.cos(theta), 0);

function arcRay(m: RayModel, delta: number, limit: number): THREE.Vector3[] {
  const D = delta * DEG;
  const L = limit * DEG;
  const f = (1 - Math.cos(D / 2)) / (1 - Math.cos(L / 2));
  const rb = m.R - (m.R - m.rc * 1.02) * f;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const th = (D * i) / 40;
    pts.push(polar(th, m.R - (m.R - rb) * Math.sin((Math.PI * i) / 40)));
  }
  return pts;
}

function line(a: THREE.Vector3, b: THREE.Vector3, n: number, out: THREE.Vector3[]): void {
  for (let i = 1; i <= n; i++) out.push(a.clone().lerp(b, i / n));
}

/** Entry angle (from the focus) at which a core ray landing at `delta` reaches the core. */
function entryAngle(m: RayModel, delta: number): number {
  const aMax = 0.8 * Math.acos(m.rc / m.R);
  return (aMax * (180 - delta)) / (180 - m.pTo);
}

/**
 * Rays fanning from the focus, `n` per side and per wave. With both waves, P rays go to the right
 * (+x, positive delta) and S rays to the left, so the two families never hide each other.
 */
export const sideOf = (wave: "P" | "S", waves: readonly ("P" | "S")[]): number[] =>
  waves.length > 1 ? [wave === "P" ? 1 : -1] : [1, -1];

export function buildRays(m: RayModel, n: number, waves: readonly ("P" | "S")[]): Ray[] {
  const rays: Ray[] = [];
  const nMantle = Math.max(2, Math.round(n * 0.6));
  const nCore = Math.max(2, n - nMantle);
  for (const wave of waves) {
    const limit = wave === "P" ? m.pFrom : m.sFrom;
    for (const side of sideOf(wave, waves)) {
      for (let i = 0; i < nMantle; i++) {
        const delta = (limit * (i + 1)) / (nMantle + 0.15);
        const pts = arcRay(m, delta, limit).map((p) => p.setX(p.x * side));
        rays.push(finish(wave, side * delta, pts, m, false));
      }
      for (let i = 0; i < nCore; i++) {
        // Core rays land from pTo to (almost) the antipode.
        const delta = m.pTo + ((180 - m.pTo) * i) / Math.max(1, nCore - 1) - (i === nCore - 1 ? 1.5 : 0);
        const a = entryAngle(m, delta);
        const focus = polar(0, m.R);
        const enter = polar(a, m.rc);
        const pts = [focus];
        line(focus, enter, 16, pts);
        if (wave === "S") {
          rays.push(finish(wave, side * delta, pts.map((p) => p.setX(p.x * side)), m, true));
          continue;
        }
        const exit = polar(delta * DEG - a, m.rc);
        line(enter, exit, 24, pts);
        line(exit, polar(delta * DEG, m.R), 16, pts);
        rays.push(finish(wave, side * delta, pts.map((p) => p.setX(p.x * side)), m, false));
      }
    }
  }
  return rays;
}

function finish(wave: "P" | "S", delta: number, pts: THREE.Vector3[], m: RayModel, stopped: boolean): Ray {
  const time = [0];
  const speed = wave === "P" ? 1 : S_RATIO;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const inCore = (a.length() + b.length()) / 2 < m.rc * 0.999;
    time.push(time[i - 1]! + a.distanceTo(b) / (speed * (inCore ? CORE_P : 1)));
  }
  return { wave, delta, pts, time, stopped };
}

/** Position of the wave along a ray at "time" tau (same units as Ray.time); null before start / after the end. */
export function rayAt(ray: Ray, tau: number, out: THREE.Vector3): { index: number; done: boolean } | null {
  if (tau < 0) return null;
  const T = ray.time;
  const last = T.length - 1;
  if (tau >= T[last]!) {
    out.copy(ray.pts[last]!);
    return { index: last + 1, done: true };
  }
  let i = 1;
  while (T[i]! < tau) i++;
  const p = (tau - T[i - 1]!) / (T[i]! - T[i - 1]!);
  out.lerpVectors(ray.pts[i - 1]!, ray.pts[i]!, p);
  return { index: i, done: false };
}

/** Surface point at angular distance delta (degrees, signed) from the focus. */
export function surfacePoint(R: number, delta: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(R * Math.sin(delta * DEG), R * Math.cos(delta * DEG), 0);
}
