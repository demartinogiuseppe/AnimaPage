// Pop-up and page-turn animation as pure functions (decision D12).
//
// - The pop-up is tied to chapter time t, so scrubbing back to 0 folds the content flat again.
// - The page turn is a chapter-change transition on its own clock (like the camera tween): it does
//   not replay while scrubbing inside a chapter.
// - The camera starts on the book overview and joins the scene's own camera keys after the pop-up.
import { ease, seg } from "../util/math.ts";

/** Chapter-time windows, seconds. */
export const POP_WINDOW: readonly [number, number] = [0.2, 1.8];
export const CAMERA_JOIN: readonly [number, number] = [2.0, 3.8];
/** Page turn length on the transition clock. */
export const TURN_SECONDS = 0.95;
/** Pins and labels appear once the content is (almost) standing. */
export const PINS_FROM = 0.85;

/** Flattest the content gets (a fully flat mesh would break normals and outlines). */
const FLAT = 0.06;
/** Max backward lean of upright content while it unfolds, radians. */
const LEAN = 0.95;

export interface PopState {
  /** 0 = folded flat on the page, 1 = standing (no overshoot). */
  p: number;
  /** Vertical scale of the content (overshoots a little above 1, like paper springing up). */
  rise: number;
  /** Rotation about the x axis at the hinge (negative = leaning back towards the spine of the fold). */
  lean: number;
  /** Contact shadow strength under the content, 0..1. */
  shadow: number;
}

/** Overshoot easing (paper springing up and settling). */
export function easeOutBack(p: number, k = 1.5): number {
  const q = p - 1;
  return 1 + (k + 1) * q * q * q + k * q * q;
}

export function popAt(t: number, upright: boolean, reducedMotion = false): PopState {
  if (reducedMotion) return { p: 1, rise: 1, lean: 0, shadow: 1 };
  const p = seg(t, POP_WINDOW[0], POP_WINDOW[1]);
  const e = easeOutBack(p);
  const rise = FLAT + (1 - FLAT) * e;
  // Upright pieces hinge up from the page; reliefs (maps) only rise.
  const lean = upright ? -LEAN * (1 - ease.inOutCubic(Math.min(1, p * 1.25))) : 0;
  return { p, rise: Math.max(FLAT, rise), lean: lean || 0, shadow: ease.inOutQuad(p) };
}

/** The entry pop-up starts while the turning page is landing. */
export const ENTRY_POP_DELAY = 0.5;

/**
 * Pop-up state shown by the stage: the content unfolds on chapter entry on its own clock (like the page
 * turn), so it stands even while the lesson waits paused at t = 0; afterwards chapter time can only keep
 * it up. Pure in (t, entryClock).
 */
export function entryPopAt(t: number, entryClock: number, upright: boolean, reducedMotion = false): PopState {
  return popAt(Math.max(t, entryClock - ENTRY_POP_DELAY), upright, reducedMotion);
}

/** Weight of the scene's camera keys against the book overview, 0..1. */
export function cameraJoinAt(t: number): number {
  return ease.inOutCubic(seg(t, CAMERA_JOIN[0], CAMERA_JOIN[1]));
}

/**
 * Camera join on the same entry clock as the pop-up: after the book overview the camera reaches the
 * chapter's own view even while the lesson waits paused at t = 0 (a Prevedi question), instead of
 * holding the whole book, where wide flat content (a timeline) is a thin strip. Pure in (t, entryClock).
 */
export function entryJoinAt(t: number, entryClock: number): number {
  return cameraJoinAt(Math.max(t, entryClock - ENTRY_POP_DELAY));
}

/**
 * Page-turn angle in radians on the transition clock: 0 = lying on the right page, PI = on the left.
 * Forward (dir 1) goes right -> left; backward (dir -1, an earlier chapter) left -> right.
 */
export function turnAngleAt(clock: number, reducedMotion = false, dir: 1 | -1 = 1): number {
  const p = reducedMotion ? 1 : ease.inOutCubic(seg(clock, 0, TURN_SECONDS));
  return dir === 1 ? Math.PI * p : Math.PI * (1 - p);
}

/**
 * Shape of the turning sheet: points (x, y) along its width for `n` segments, from the spine (u = 0)
 * to the outer edge (u = 1), for angle `theta`. The outer part leads (the hand lifts the edge) and
 * the sheet keeps its length, so it bends like paper instead of rotating as a rigid board.
 */
export function sheetProfile(theta: number, width: number, n: number, curl = 0.9, dir: 1 | -1 = 1): Array<[number, number]> {
  const pts: Array<[number, number]> = [[0, 0]];
  let x = 0;
  let y = 0;
  const lift = Math.sin(theta);
  for (let i = 1; i <= n; i++) {
    const u = (i - 0.5) / n;
    const a = Math.min(Math.PI, Math.max(0, theta + dir * curl * lift * u));
    x += (Math.cos(a) * width) / n;
    y += (Math.sin(a) * width) / n;
    pts.push([x, y]);
  }
  return pts;
}
