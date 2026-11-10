// Pure layout helpers for the timeline engine (no three.js), unit-tested.
import { engineText } from "@pv/scene-spec/i18n";

/** Length of the time axis in scene units; everything else is sized relative to it. */
export const AXIS_LENGTH = 40;
/** z distance between event lanes; lane +1 is in front of the axis (towards +z, the default camera side). */
export const LANE_STEP = 2.3;
/** Minimum x gap between two symbols on the same lane. */
export const MIN_GAP = 1.8;

export function yearToX(year: number, from: number, to: number): number {
  return ((year - from) / (to - from) - 0.5) * AXIS_LENGTH;
}

/**
 * "era", in the language of the lesson on screen: -753 -> "753 a.C." / "753 BC", 476 -> "476 d.C." /
 * "AD 476" (English for every language but Italian); "plain": the number. Year 0 does not exist: returns "".
 */
export function formatYear(year: number, labels: "era" | "plain"): string {
  if (labels === "plain") return String(year);
  if (year === 0) return "";
  return year < 0 ? engineText("timeline.bce", { y: -year }) : engineText("timeline.ce", { y: year });
}

/**
 * Assigns each x (in input order, which need not be sorted) a lane in {+1, -1, +2, -2}.
 * Greedy over x-sorted items, alternating the preferred side so neighbours face each other
 * across the axis; falls back to the least crowded lane when all are taken.
 */
export function assignLanes(xs: number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const lastX = new Map<number, number>();
  const out = new Array<number>(xs.length).fill(1);
  order.forEach(({ x, i }, k) => {
    const side = k % 2 === 0 ? 1 : -1;
    const candidates = [side, -side, 2 * side, -2 * side];
    let lane = candidates.find((l) => x - (lastX.get(l) ?? -Infinity) >= MIN_GAP);
    if (lane === undefined) {
      lane = candidates.reduce((best, l) => ((lastX.get(l) ?? -Infinity) < (lastX.get(best) ?? -Infinity) ? l : best));
    }
    lastX.set(lane, x);
    out[i] = lane;
  });
  return out;
}

/** Year of a sliding marker at time t: eased (inOutQuad) between consecutive keys, clamped at the ends. */
export function cursorYear(keys: { at: number; year: number }[], t: number, ease: (p: number) => number): number | null {
  if (keys.length === 0) return null;
  const first = keys[0]!;
  if (t <= first.at) return first.year;
  for (let k = 1; k < keys.length; k++) {
    const a = keys[k - 1]!;
    const b = keys[k]!;
    if (t < b.at) return a.year + (b.year - a.year) * ease(b.at > a.at ? (t - a.at) / (b.at - a.at) : 1);
  }
  return keys[keys.length - 1]!.year;
}

/** Ticks from the first multiple of `step` >= from up to `to`. */
export function ticks(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) out.push(y);
  return out;
}
