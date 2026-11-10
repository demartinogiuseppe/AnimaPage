// Small pure helpers for pins, status pill and time labels.
import type { Pin, PinKind, Status } from "@pv/scene-spec";
import { displayLocale, isItalian } from "@pv/scene-spec/i18n";
import { lerp, seg } from "../util/math.ts";

/** Pin visibility at chapter time t. During a "pick" question every chapter pin is visible. */
export function pinVisibleAt(pin: Pick<Pin, "visible">, t: number, picking: boolean): boolean {
  if (picking || !pin.visible) return true;
  return pin.visible.some(([from, to]) => t >= from && t <= to);
}

/** Map kinds drawn as atlas text (no pill), centred on the anchor. */
const TEXT_KINDS = new Set<PinKind>(["sea", "region", "river", "island", "area"]);
export const isTextPin = (kind: PinKind) => TEXT_KINDS.has(kind);

const formats = new Map<string, Intl.NumberFormat>();
/** Counter format of the lesson's locale (Latin digits); Italian by default. */
function numberFormat(): Intl.NumberFormat {
  const tag = displayLocale();
  let f = formats.get(tag);
  if (!f) formats.set(tag, (f = new Intl.NumberFormat(tag, isItalian(tag) ? undefined : { numberingSystem: "latn" })));
  return f;
}

/** Status pill text at t, with `{n}` counting from..to over the window. Null when no window covers t. */
export function statusAt(statuses: readonly Status[] | undefined, t: number): string | null {
  const s = statuses?.find((x) => t >= x.from && t <= x.to);
  if (!s) return null;
  if (!s.counter) return s.text;
  const n = Math.round(lerp(s.counter.from, s.counter.to, seg(t, s.from, s.to)));
  return s.text.replaceAll("{n}", numberFormat().format(n));
}

/** m:ss */
export function formatTime(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

/** NDC culling used for DOM labels: behind the camera or more than 15% outside the frame. */
export function ndcVisible(x: number, y: number, z: number, margin = 1.15): boolean {
  return z <= 1 && z >= -1 && Math.abs(x) <= margin && Math.abs(y) <= margin;
}
