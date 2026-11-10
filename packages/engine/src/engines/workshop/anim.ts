// Pure track evaluation for the workshop engine: every value is a function of (t, params), so
// update(chapterId, t) can be scrubbed in both directions. Formulas use the safe parser of
// @pv/scene-spec (no eval).
import { compileExpr, workshopVars, type WorkshopKey, type WorkshopParam, type WorkshopTrack } from "@pv/scene-spec";
import { clamp, ease } from "../../util/math.ts";

export type Value = number | [number, number, number] | string;

/** A track compiled once: value(t, vars) or null outside its window. */
export interface Compiled {
  part: string;
  prop: WorkshopTrack["prop"];
  value(t: number, vars: readonly number[]): Value | null;
}

const hex = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: readonly number[]) => `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;

function mix(a: Value, b: Value, p: number): Value {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  if (typeof a === "string" && typeof b === "string") {
    const x = hex(a);
    const y = hex(b);
    return toHex(x.map((v, i) => v + (y[i]! - v) * p));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v + (b[i]! - v) * p) as [number, number, number];
  // number scale key next to a vector key: promote the number.
  const va = typeof a === "number" ? ([a, a, a] as [number, number, number]) : a;
  const vb = typeof b === "number" ? ([b, b, b] as [number, number, number]) : b;
  return Array.isArray(va) && Array.isArray(vb) ? mix(va, vb, p) : p < 1 ? a : b;
}

/** Keyed value at t: held before the first and after the last key, eased in between. */
export function keyed(keys: readonly WorkshopKey[], t: number): Value {
  if (t <= keys[0]!.at) return keys[0]!.v;
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]!;
    if (t < k.at) {
      const prev = keys[i - 1]!;
      const p = (t - prev.at) / Math.max(k.at - prev.at, 1e-9);
      const e = k.ease ?? "inOut";
      return e === "step" ? prev.v : mix(prev.v, k.v, e === "linear" ? p : ease.inOutQuad(p));
    }
  }
  return keys[keys.length - 1]!.v;
}

export function compileTrack(tr: WorkshopTrack, params: readonly WorkshopParam[] | undefined): Compiled {
  const win = tr.window;
  const inside = (t: number) => !win || (t >= win[0] && t <= win[1]);
  if (tr.keys) {
    const keys = tr.keys;
    return { part: tr.part, prop: tr.prop, value: (t) => (inside(t) ? keyed(keys, t) : null) };
  }
  const f = compileExpr(tr.expr!, { vars: workshopVars(params) });
  return {
    part: tr.part,
    prop: tr.prop,
    value: (t, vars) => {
      if (!inside(t)) return null;
      const v = f(t, ...vars);
      return Number.isFinite(v) ? v : null;
    },
  };
}

/** Integration step for rates (spin, speed), seconds. */
const STEP = 1 / 30;
const MAX_STEPS = 3000;

/**
 * Integral over [0, t] of a rate (turns/s, units/s), trapezoid rule on a fixed grid: the same
 * (t, vars) always gives the same angle/offset. `rate` returns null where its track is inactive:
 * then `base` (the part's own constant) applies.
 */
export function integrate(rate: (t: number) => number | null, base: number, t: number): number {
  if (t <= 0) return 0;
  const n = Math.min(MAX_STEPS, Math.max(1, Math.ceil(t / STEP)));
  const h = t / n;
  const r = (x: number) => rate(x) ?? base;
  let sum = (r(0) + r(t)) / 2;
  for (let i = 1; i < n; i++) sum += r(i * h);
  return sum * h;
}

/** Slider values in params order: user override, else the param's own value. */
export function paramValues(params: readonly WorkshopParam[] | undefined, overrides: Record<string, number> | null): number[] {
  return (params ?? []).map((p) => clamp(overrides?.[p.id] ?? p.value, p.min, p.max));
}
