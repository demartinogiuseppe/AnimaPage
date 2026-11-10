// Pure state of each solid at chapter time t, from the chapter's declarative acts.
// Every channel is recomputed from scratch for (t, slider values): no accumulated state.
import { SOLID_ACT_DEFAULTS, type SolidAct, type SolidChapter, type SolidItem } from "@pv/scene-spec";
import { clamp, ease, lerp, seg } from "../../util/math.ts";

export type CountWhat = "faces" | "edges" | "vertices";

/** Seconds a count stays lit after it ends (unless the next count starts earlier). */
export const COUNT_HOLD = 2.5;
/** Pour phases (fractions of the act): travel, flip, pour, flip back, return. */
export const POUR = { travel: 0.22, flip: 0.36, pour: 0.76, back: 0.86 } as const;

export function durOf(a: SolidAct, elements = 1): number {
  if (a.dur !== undefined) return a.dur;
  if (a.do === "count") return SOLID_ACT_DEFAULTS.count * Math.max(1, elements);
  if (a.do === "fill" && a.from !== undefined) return SOLID_ACT_DEFAULTS.pour;
  return SOLID_ACT_DEFAULTS[a.do];
}

const actsOf = (entry: SolidChapter, id: string) => (entry.acts ?? []).filter((a) => a.solid === id).sort((x, y) => x.at - y.at);

/** Keyframed channel: each act eases the value from where it was to its target over its window. */
function channel(acts: SolidAct[], t: number, init: number, target: (a: SolidAct) => number, easing = ease.inOutCubic): number {
  let v = init;
  for (const a of acts) {
    if (t < a.at) break;
    v = lerp(v, target(a), easing(seg(t, a.at, a.at + durOf(a))));
  }
  return v;
}

export interface CountState {
  what: CountWhat;
  /** Elements lit so far (1..total). */
  lit: number;
  total: number;
}

export interface SolidState {
  /** Pop-in of a solid with `appear` (0 hidden .. 1 shown). */
  shown: number;
  unfold: number;
  /** Revolve sweep 0..1; 1 when the solid has no revolve act. */
  sweep: number;
  /** The generating figure is on screen. */
  figure: boolean;
  section: { y: number; tilt: number } | null;
  k: number;
  spin: number;
  count: CountState | null;
  /** Counts revealed for the elements panel (null = not yet). */
  known: Record<CountWhat, number | null>;
  /** Some act of this solid is running now (ink style key). */
  busy: boolean;
}

export function solidState(
  entry: SolidChapter,
  item: SolidItem,
  t: number,
  totals: Record<CountWhat, number>,
  kOverride: number | undefined,
): SolidState {
  const acts = actsOf(entry, item.id);
  const of = (...names: SolidAct["do"][]) => acts.filter((a) => names.includes(a.do));
  const appear = item.appear ?? 0;
  const shown = appear > 0 ? ease.inOutQuad(seg(t, appear, appear + 0.6)) : 1;
  const unfold = channel(of("unfold", "fold"), t, 0, (a) => (a.do === "unfold" ? 1 : 0));
  const revolves = of("revolve");
  const sweep = revolves.length ? channel(revolves, t, 0, () => 1, ease.linear) : 1;
  const figure = revolves.length > 0 && (sweep < 1 || revolves.some((a) => t >= a.at && t < a.at + durOf(a) + 1.5));
  // Section: the latest started section act that is still open.
  let section: SolidState["section"] = null;
  let prev: { y: number; tilt: number } | null = null;
  for (const a of of("section")) {
    if (a.do !== "section" || t < a.at) break;
    const from: { y: number; tilt: number } = prev ?? { y: a.to, tilt: a.tilt ?? 0 };
    const p = ease.inOutCubic(seg(t, a.at, a.at + durOf(a)));
    const now: { y: number; tilt: number } = { y: lerp(from.y, a.to, p), tilt: lerp(from.tilt, a.tilt ?? 0, p) };
    section = a.until !== undefined && t >= a.until ? null : now;
    prev = now;
  }
  const k = kOverride ?? channel(of("scale"), t, item.scale ?? 1, (a) => (a.do === "scale" ? a.k : 1));
  const spin = of("spin").reduce((s, a) => s + (a.do === "spin" ? (a.turns ?? 1) * 2 * Math.PI * ease.inOutQuad(seg(t, a.at, a.at + durOf(a))) : 0), 0);
  // Counting.
  const counts = of("count").filter((a): a is Extract<SolidAct, { do: "count" }> => a.do === "count");
  let count: CountState | null = null;
  const known: Record<CountWhat, number | null> = counts.length
    ? { faces: null, edges: null, vertices: null }
    : { faces: totals.faces, edges: totals.edges, vertices: totals.vertices };
  counts.forEach((a, i) => {
    const total = totals[a.what];
    const d = durOf(a, total);
    if (t >= a.at + d) known[a.what] = total;
    const next = counts[i + 1]?.at ?? Infinity;
    if (t >= a.at && t < Math.min(next, a.at + d + COUNT_HOLD)) {
      const lit = Math.min(total, Math.floor(((t - a.at) / d) * total) + 1);
      count = { what: a.what, lit, total };
      known[a.what] = Math.max(known[a.what] ?? 0, lit);
    }
  });
  // Counting keys only the lit elements, so it does not make the whole solid key.
  const busy = acts.some((a) => a.do !== "count" && t >= a.at && t < a.at + durOf(a) + 0.5) || pourBusy(entry, item.id, t);
  return { shown, unfold, sweep, figure, section, k, spin, count, known, busy };
}

const pourBusy = (entry: SolidChapter, id: string, t: number) =>
  (entry.acts ?? []).some((a) => a.do === "fill" && a.from === id && t >= a.at && t < a.at + durOf(a));

/** Fill level of a container: volume fraction 0..1. `ratio(from)` = V_from / V_container. */
export function fillLevel(entry: SolidChapter, id: string, t: number, ratio: (from: string) => number): number {
  let level = 0;
  for (const a of actsOf(entry, id)) {
    if (a.do !== "fill") continue;
    if (t < a.at) break;
    const next = a.from !== undefined ? Math.min(1, level + ratio(a.from)) : (a.level ?? 0);
    const p = seg(t, a.at, a.at + durOf(a));
    const q = a.from !== undefined ? ease.inOutQuad(seg(p, POUR.flip, POUR.pour)) : ease.inOutQuad(p);
    level = lerp(level, next, q);
  }
  return clamp(level);
}

export interface PourState {
  /** Target container id. */
  into: string;
  /** Act progress 0..1. */
  p: number;
  /** Travel progress towards the container (0 at home, 1 above it). */
  travel: number;
  /** Flip angle progress (0 upright, 1 upside down). */
  flip: number;
  /** Liquid left in the pourer, 0..1. */
  left: number;
  /** Liquid stream visible. */
  stream: boolean;
}

/** The pour currently carried out by solid `id` (it is the `from` of a running fill act), if any. */
export function pourState(entry: SolidChapter, id: string, t: number): PourState | null {
  for (const a of entry.acts ?? []) {
    if (a.do !== "fill" || a.from !== id) continue;
    const d = durOf(a);
    if (t < a.at || t >= a.at + d) continue;
    const p = seg(t, a.at, a.at + d);
    const travel = p < POUR.back ? ease.inOutCubic(seg(p, 0, POUR.travel)) : 1 - ease.inOutCubic(seg(p, POUR.back, 1));
    const flip = p < POUR.pour ? ease.inOutCubic(seg(p, POUR.travel, POUR.flip)) : 1 - ease.inOutCubic(seg(p, POUR.pour, POUR.back));
    const left = 1 - ease.inOutQuad(seg(p, POUR.flip, POUR.pour));
    return { into: a.solid, p, travel, flip, left, stream: p > POUR.flip && p < POUR.pour };
  }
  return null;
}
