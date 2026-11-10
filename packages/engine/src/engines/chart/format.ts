// Number formatting in the lesson's locale (Italian by default, D21) and "nice" axis scales for the
// chart engine. Pure, no DOM.
import { decimalMark, groupMark } from "@pv/scene-spec/i18n";

/** 5590076 -> "5.590.076"; 13.5 (1 decimal) -> "13,5"; -2 -> "−2". */
export function formatIt(v: number, decimals = 0): string {
  const fixed = Math.abs(v).toFixed(decimals);
  const [int, frac] = fixed.split(".") as [string, string | undefined];
  const grouped = int.length > 3 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, groupMark()) : int;
  const sign = v < 0 && Number(fixed) !== 0 ? "−" : "";
  return sign + grouped + (frac ? `${decimalMark()}${frac}` : "");
}

/** Short units are written after the number ("13,5 %", "21 °C", "120 mm"); long ones ("abitanti") go on the axis title. */
export function formatValue(v: number, unit: string, decimals = 0): string {
  const n = formatIt(v, decimals);
  return unit.length <= 4 ? `${n} ${unit}` : n;
}

/** Step of 1, 2 or 5 times a power of ten close to `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export interface Scale {
  lo: number;
  hi: number;
  step: number;
  ticks: number[];
}

/** Axis from 0 (or below, for negative data) to a round value above `max`, with ~`count` ticks. */
export function niceScale(min: number, max: number, count = 4): Scale {
  const lo0 = Math.min(0, min);
  const hi0 = Math.max(max, lo0 + 1e-9);
  const step = niceStep((hi0 - lo0) / count);
  const lo = Math.floor(lo0 / step + 1e-9) * step;
  const hi = Math.max(Math.ceil(hi0 / step - 1e-9) * step, lo + step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, step, ticks };
}

/** Decimals needed to write the ticks of a scale (0 for integer steps). */
export const tickDecimals = (s: Scale) => Math.max(0, Math.min(3, -Math.floor(Math.log10(s.step) + 1e-9)));
