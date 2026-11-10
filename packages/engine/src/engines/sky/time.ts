// Chapter time -> date, and the Earth's displayed spin. Pure.
import type { SkyTimeKey } from "@pv/scene-spec";
import { DAY_MS, earthRotation, julianDay } from "./astro.ts";

export interface Track {
  at: number[];
  ms: number[];
}

export function track(keys: readonly SkyTimeKey[]): Track {
  return { at: keys.map((k) => k.at), ms: keys.map((k) => Date.parse(k.date)) };
}

/** Segment index i such that at[i] <= t < at[i+1] (clamped), and progress p in it. */
function locate(tr: Track, t: number): { i: number; p: number } {
  const n = tr.at.length;
  if (n === 1 || t <= tr.at[0]!) return { i: 0, p: 0 };
  if (t >= tr.at[n - 1]!) return { i: n - 2, p: 1 };
  let i = 0;
  while (i < n - 2 && t >= tr.at[i + 1]!) i++;
  const a = tr.at[i]!, b = tr.at[i + 1]!;
  return { i, p: b > a ? (t - a) / (b - a) : 1 };
}

/** Date (Unix ms, UTC) at chapter time t: piecewise linear between keys, clamped at the ends. */
export function dateAt(tr: Track, t: number): number {
  if (tr.ms.length === 1) return tr.ms[0]!;
  const { i, p } = locate(tr, t);
  return tr.ms[i]! + (tr.ms[i + 1]! - tr.ms[i]!) * p;
}

/** Fastest spin shown, turns per chapter second; faster segments are slowed down. */
export const MAX_SPIN = 0.25;

/**
 * Displayed rotation angle of the Earth (radians, unwrapped) at chapter time t. Real (Earth
 * Rotation Angle) when the segment turns at most MAX_SPIN turns per second; otherwise a calm spin
 * with a whole number of extra turns, so the angle is still exact at every key and continuous.
 */
export function spinAt(tr: Track, t: number): number {
  const real = (ms: number) => earthRotation(julianDay(ms));
  if (tr.ms.length === 1) return real(tr.ms[0]!);
  const { i, p } = locate(tr, t);
  const m0 = tr.ms[i]!, m1 = tr.ms[i + 1]!;
  const dur = tr.at[i + 1]! - tr.at[i]!;
  const turns = (real(m1) - real(m0)) / (2 * Math.PI);
  if (dur <= 0 || turns / dur <= MAX_SPIN) return real(m0 + (m1 - m0) * p);
  const frac = turns - Math.floor(turns);
  const shown = Math.max(0, Math.round(MAX_SPIN * dur - frac)) + frac;
  return real(m0) + 2 * Math.PI * shown * p;
}

/** Days of calendar time per chapter second at t (for the date label: hours are shown when slow). */
export function rateAt(tr: Track, t: number): number {
  if (tr.ms.length === 1) return 0;
  const { i } = locate(tr, t);
  const dur = tr.at[i + 1]! - tr.at[i]!;
  return dur > 0 ? (tr.ms[i + 1]! - tr.ms[i]!) / DAY_MS / dur : 0;
}
