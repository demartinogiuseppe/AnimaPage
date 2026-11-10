// Clock part: an analog (and/or digital) clock whose hands are computed from the time, for lessons on
// telling the time. Shared by the `stage` props and the `diorama` items (a procedural Shape), set per
// chapter by a "time" action (stage blocking / diorama actions).
//
// Geometry (engine): the dial stands upright facing +z, bottom-centred on the part's position (like the
// other shapes); `radius` in metres (default 0.35). Analog hands: the hour hand advances with the
// minutes (7:30 = halfway between 7 and 8). A "time" action with `dur` runs the hands forward to the
// new time over `dur` seconds (always forward: 11:45 -> 12:15 is half an hour, not 11.5 hours back);
// without `dur` the clock jumps to it.
//
// Offered to the model since gen-6 (decision D25): guides/stage.ts and guides/diorama.ts.
import { z } from "zod";

export const CLOCK_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
export const CLOCK_DEFAULT_RADIUS = 0.35;
const DAY = 24 * 60;

export const ClockShape = z
  .object({
    shape: z.literal("clock"),
    /** Time shown at the start of every chapter, "HH:MM" (24 h: "07:15", "19:30"). */
    time: z.string().regex(CLOCK_TIME_RE),
    /** analog (default), digital, or both (a small digital window under the hands). */
    face: z.enum(["analog", "digital", "both"]).optional(),
    /** Digital display: 24 h ("19:30", default) or 12 h ("7:30"). */
    hours: z.union([z.literal(12), z.literal(24)]).optional(),
    /** Dial radius in metres (default 0.35). */
    radius: z.number().positive().max(3).optional(),
    /** Dial colour. */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** Hands and numerals colour. */
    hands: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .strict();
export type ClockShape = z.infer<typeof ClockShape>;

/** "HH:MM" -> minutes after midnight (0..1439). Throws on a malformed time. */
export function clockMinutes(time: string): number {
  if (!CLOCK_TIME_RE.test(time)) throw new Error(`bad clock time "${time}"`);
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Minutes (any real number, wrapped to the day) -> "19:30" (24 h) or "7:30" (12 h). */
export function formatClock(minutes: number, hours: 12 | 24 = 24): string {
  const m = Math.floor((((minutes % DAY) + DAY) % DAY) + 1e-6) % DAY;
  let h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  if (hours === 12) return `${h % 12 === 0 ? 12 : h % 12}:${mm}`;
  h = h % 24;
  return `${String(h).padStart(2, "0")}:${mm}`;
}

/** Hand angles in degrees, clockwise from 12. The hour hand moves with the minutes. */
export function clockHands(minutes: number): { hour: number; minute: number } {
  const wrap = (v: number, n: number) => ((v % n) + n) % n;
  return { hour: wrap(minutes / 60, 12) * 30, minute: wrap(minutes, 60) * 6 };
}

export interface ClockKey {
  /** Chapter time of the change, seconds. */
  at: number;
  /** Target time, minutes after midnight. */
  minutes: number;
  /** Seconds the hands take to run there (0 / undefined = jump). */
  dur?: number;
}

const smooth = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/**
 * Clock time (minutes, not wrapped: hands only ever move forward) at chapter time t, starting from
 * `base` and applying the keys in time order. A run interrupted by the next key continues from where
 * it was. Pure.
 */
export function clockAt(base: number, keys: readonly ClockKey[], t: number): number {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  let v = base;
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i]!;
    if (k.at > t) break;
    const next = sorted[i + 1];
    const end = next && next.at <= t ? next.at : t;
    const delta = ((((k.minutes - v) % DAY) + DAY) % DAY);
    const p = k.dur && k.dur > 0 ? smooth(Math.min(1, Math.max(0, (end - k.at) / k.dur))) : 1;
    v += delta * p;
  }
  return v;
}

/** Size [width, height, depth] in metres of a clock shape (bottom-centred). */
export function clockSize(c: ClockShape): [number, number, number] {
  const r = c.radius ?? CLOCK_DEFAULT_RADIUS;
  if (c.face === "digital") return [2 * r, 0.8 * r, 0.25 * r];
  return [2 * r, 2 * r, 0.25 * r];
}
