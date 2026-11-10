// The chapter acts of the façade theatre as a pure function of (chapter, t): which parts are drawn and how
// far, which are highlighted, where the cut is, where the eye is. No state is kept here, so scrubbing
// backwards gives the same scene. Parts are the ids of FacadeModel.parts.
import type { FacadeBuilding, FacadeChapter } from "@pv/scene-spec";
import { ease, seg } from "../../util/math.ts";

/** Default eye height of the perspective, metres. */
export const EYE_HEIGHT = 1.6;
const DRAW_DUR = 3;
const CUT_DUR = 2;
const EYE_DUR = 2;

export interface FacadeState {
  /** Part id -> how much of it is traced, 0..1. A part that is not here is drawn in full. */
  drawn: Map<string, number>;
  highlighted: Set<string>;
  /** The section plane slides from the bay of the previous cut (`from`; null = the building's edge) to `bay` as p goes 0..1. */
  cut: { bay: string; p: number; from: string | null } | null;
  /** Metres. */
  eye: { height: number; x: number };
}

/**
 * The parts a target stands for: a floor takes its members and bays with it, the building takes everything.
 * "base" is the plinth and the body shell together; "rotunda" and "dome" exist when the building has a rotunda. Unknown targets give nothing.
 */
export function partsOf(b: FacadeBuilding, target: string): string[] {
  const floorParts = (f: FacadeBuilding["floors"][number]): string[] => [f.id, `${f.id}.members`, ...f.bays.map((x) => x.id)];
  const round = b.rotunda ? ["rotunda", "dome"] : [];
  if (target === b.id) return [...b.floors.flatMap(floorParts), "crown", "base", ...round];
  const floor = b.floors.find((f) => f.id === target);
  if (floor) return floorParts(floor);
  const isPart = target === "crown" || target === "base" || round.includes(target) || target.endsWith(".members") || b.floors.some((f) => f.bays.some((x) => x.id === target));
  return isPart ? [target] : [];
}

/** `overrides` are the user's sliders (metres): "eye-height", "eye-x". */
export function facadeStateAt(ch: FacadeChapter, b: FacadeBuilding, t: number, overrides: Record<string, number> | null): FacadeState {
  const drawn = new Map<string, number>();
  const highlighted = new Set<string>();
  const acts = ch.acts ?? [];
  for (const a of acts) {
    if (a.do === "draw") {
      const p = seg(t, a.at, a.at + (a.dur ?? DRAW_DUR));
      for (const id of partsOf(b, a.target)) drawn.set(id, p);
    } else if (a.do === "highlight") {
      if (t >= a.at && t < (a.until ?? Infinity)) for (const id of partsOf(b, a.target)) highlighted.add(id);
    }
  }
  // The latest cut that has started, else the first one; it slides from the cut before it (none: from the building's edge).
  const cuts = acts.flatMap((a) => (a.do === "cut" ? [a] : [])).sort((x, y) => x.at - y.at);
  const k = Math.max(0, cuts.findLastIndex((a) => a.at <= t));
  const c = cuts[k];
  const cut = c ? { bay: c.bay, p: seg(t, c.at, c.at + (c.dur ?? CUT_DUR)), from: cuts[k - 1]?.bay ?? null } : null;
  const eye = { height: ch.eye?.height ?? EYE_HEIGHT, x: ch.eye?.x ?? 0 };
  const moves = acts.flatMap((a) => (a.do === "eye" ? [a] : [])).sort((x, y) => x.at - y.at);
  for (const a of moves) {
    const p = ease.inOutCubic(seg(t, a.at, a.at + (a.dur ?? EYE_DUR)));
    if (a.height !== undefined) eye.height += (a.height - eye.height) * p;
    if (a.x !== undefined) eye.x += (a.x - eye.x) * p;
  }
  const h = overrides?.["eye-height"];
  const x = overrides?.["eye-x"];
  if (h !== undefined && Number.isFinite(h)) eye.height = h;
  if (x !== undefined && Number.isFinite(x)) eye.x = x;
  return { drawn, highlighted, cut, eye };
}
