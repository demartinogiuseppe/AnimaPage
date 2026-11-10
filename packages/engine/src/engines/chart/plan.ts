// Time model of the chart engine: compiles each chapter's items and actions once, then
// evaluates the state of a chart at (chapter, t) as a pure function (no accumulated state).
import type { Chart, ChartAction, ChartData, ChartDataset, ChartItem, SceneSpec } from "@pv/scene-spec";
import { chartSeries, isTimeAxis } from "@pv/scene-spec";
import { clamp, ease, seg } from "../../util/math.ts";

/** Fade of a chart entering/leaving and of highlight windows, seconds. */
export const FADE = 0.4;
/** Seconds a sort or a series switch takes. */
export const MORPH = 1.1;
export const DEFAULT_GROW = 2;

export interface ChartInfo {
  chart: Chart;
  dataset: ChartDataset;
  /** Series drawn at the start (single-series kinds: one). */
  series: string[];
  /** One series at a time: switch morphs it. */
  single: boolean;
  /** Category positions come from `x` (bars, lines, climographs on a time axis). */
  time: boolean;
  n: number;
  /** Cursor domain: [x0, xN] on a time axis, [1, n] otherwise. */
  cursorMin: number;
  cursorMax: number;
}

interface Switch {
  at: number;
  from: string;
  to: string;
}
interface Sort {
  at: number;
  from: number[];
  to: number[];
}
interface Window {
  at: number;
  until: number;
}

export interface ChapterChart {
  item: ChartItem;
  at: number;
  until: number;
  grow: number;
  switches: Switch[];
  sorts: Sort[];
  /** Display slots when the chart appears (grow order). */
  slots0: number[];
  highlights: (Window & { cats: number[]; series: string[] })[];
  compares: (Window & { a: number; b: number })[];
  annotations: (Window & { action: Extract<ChartAction, { do: "annotate" }>; index: number })[];
  sweeps: Window[];
}

export interface Plan {
  charts: Map<string, ChartInfo>;
  /** chapter id -> chart id -> compiled timeline (only charts on stage). */
  chapters: Map<string, Map<string, ChapterChart>>;
}

export function chartInfo(chart: Chart, dataset: ChartDataset): ChartInfo {
  const series = chartSeries(chart, dataset);
  const time = isTimeAxis(dataset) && (chart.kind === "bars" || chart.kind === "line" || chart.kind === "climograph");
  const n = dataset.categories.length;
  const xs = dataset.categories.map((c) => c.x ?? 0);
  return {
    chart,
    dataset,
    series,
    single: chart.kind !== "climograph" && series.length === 1,
    time,
    n,
    cursorMin: time ? xs[0]! : 1,
    cursorMax: time ? xs[n - 1]! : n,
  };
}

export const valuesOf = (info: ChartInfo, seriesId: string): number[] =>
  (info.dataset.series.find((s) => s.id === seriesId)?.values ?? []).map((v) => v ?? 0);

/** Display order for a sort: slot of each category. */
export function sortSlots(values: number[], order: "desc" | "asc" | "original"): number[] {
  const idx = values.map((_, i) => i);
  if (order !== "original") idx.sort((a, b) => (order === "desc" ? values[b]! - values[a]! : values[a]! - values[b]!) || a - b);
  const slots = new Array<number>(values.length);
  idx.forEach((cat, slot) => (slots[cat] = slot));
  return slots;
}

export function compilePlan(spec: SceneSpec & { engine: "chart" }, data: ChartData = spec.engineData): Plan {
  const datasets = new Map(data.datasets.map((d) => [d.id, d]));
  const charts = new Map(data.charts.map((c) => [c.id, chartInfo(c, datasets.get(c.dataset)!)]));
  const chapters = new Map<string, Map<string, ChapterChart>>();
  for (const cc of data.chapters) {
    const duration = spec.chapters.find((c) => c.id === cc.chapter)?.duration ?? Infinity;
    const byChart = new Map<string, ChapterChart>();
    for (const item of cc.charts) {
      const info = charts.get(item.id);
      if (!info) continue;
      const catIndex = new Map(info.dataset.categories.map((c, i) => [c.id, i]));
      const actions = cc.actions.filter((a) => a.chart === item.id).sort((a, b) => a.at - b.at);
      const end = (a: { until?: number }) => a.until ?? duration;
      // Switches first: sorts order by the series shown at their time.
      const switches: Switch[] = [];
      let current = info.series[0]!;
      for (const a of actions) if (a.do === "switch" && info.single) {
        switches.push({ at: a.at, from: current, to: a.series });
        current = a.series;
      }
      const seriesAt = (t: number) => {
        let s = info.series[0]!;
        for (const w of switches) if (w.at <= t) s = w.to;
        return s;
      };
      const identity = info.dataset.categories.map((_, i) => i);
      const sorts: Sort[] = [];
      let slots = identity;
      for (const a of actions) if (a.do === "sort") {
        const to = sortSlots(sumShown(info, seriesAt(a.at)), a.order);
        sorts.push({ at: a.at, from: slots, to });
        slots = to;
      }
      const at = item.at ?? 0;
      byChart.set(item.id, {
        item,
        at,
        until: item.until ?? Infinity,
        grow: item.grow ?? DEFAULT_GROW,
        switches,
        sorts,
        slots0: slotsAt(sorts, identity, at),
        highlights: actions.flatMap((a) =>
          a.do === "highlight"
            ? [{ at: a.at, until: end(a), cats: (a.categories ?? []).map((id) => catIndex.get(id)!).filter((i) => i !== undefined), series: a.series ?? [] }]
            : [],
        ),
        compares: actions.flatMap((a) =>
          a.do === "compare" ? [{ at: a.at, until: end(a), a: catIndex.get(a.categories[0])!, b: catIndex.get(a.categories[1])! }] : [],
        ),
        annotations: actions.flatMap((a) =>
          a.do === "annotate" ? [{ at: a.at, until: end(a), action: a, index: a.category ? catIndex.get(a.category) ?? -1 : -1 }] : [],
        ),
        sweeps: actions.flatMap((a) => (a.do === "sweep" ? [{ at: a.at, until: a.until }] : [])),
      });
    }
    chapters.set(cc.chapter, byChart);
  }
  return { charts, chapters };
}

/** Values that decide sorting: the single series, or the sum of the drawn series. */
function sumShown(info: ChartInfo, single: string): number[] {
  if (info.single) return valuesOf(info, single);
  const out = new Array<number>(info.n).fill(0);
  for (const s of info.series) valuesOf(info, s).forEach((v, i) => (out[i]! += v));
  return out;
}

/** Final (integer) slots in force at time t. */
function slotsAt(sorts: Sort[], identity: number[], t: number): number[] {
  let s = identity;
  for (const x of sorts) if (x.at <= t) s = x.to;
  return s;
}

/** Envelope of a window [at, until] with soft edges. */
export function env(t: number, at: number, until: number): number {
  if (t < at || t > until) return 0;
  return Math.min(seg(t, at, at + FADE), until === Infinity ? 1 : 1 - seg(t, until - FADE, until));
}

export interface ChartState {
  /** 0..1 opacity of the whole chart. */
  presence: number;
  /** Growth 0..1 per category. */
  grow: number[];
  /** Fractional display slot per category. */
  slots: number[];
  /** Current values per drawn series (single-series kinds: key = the series shown). */
  values: Map<string, number[]>;
  /** Single-series kinds: the series in force (labels, readouts); else the first drawn. */
  active: string;
  /** Raw cursor value, null when the chart has no active cursor. */
  cursor: number | null;
  /** Time axis: x reached by the drawing. Infinity when everything is drawn. */
  reach: number;
  /** Category focused by the cursor (or the last one reached on a time axis), -1 none. */
  focus: number;
  /** Highlight 0..1 per category / per series, and the strongest active highlight (dims the rest). */
  hiCat: number[];
  hiSeries: Map<string, number>;
  dim: number;
  compare: { a: number; b: number; k: number } | null;
  annotations: { action: Extract<ChartAction, { do: "annotate" }>; index: number; k: number }[];
}

/** Cursor value from the chapter's sweeps at t (null when no sweep has started). */
export function sweepCursor(info: ChartInfo, cc: ChapterChart, t: number): number | null {
  let w: Window | null = null;
  for (const s of cc.sweeps) if (s.at <= t) w = s;
  if (!w) return cc.sweeps.length && info.time ? info.cursorMin : null;
  if (!info.time && t > w.until) return null; // focus sweeps let go at the end
  // Linear on a time axis, so narration can be timed to the year reached.
  const p = seg(t, w.at, w.until);
  return info.cursorMin + (info.cursorMax - info.cursorMin) * (info.time ? p : ease.inOutQuad(p));
}

export function evalChart(info: ChartInfo, cc: ChapterChart, t: number, override?: number): ChartState {
  const n = info.n;
  // A chart there from the start is visible at t = 0 (the scene waits there during "Prevedi").
  const fadeIn = cc.at <= 0 ? 1 : seg(t, cc.at, cc.at + FADE);
  const presence = Math.min(fadeIn, cc.until === Infinity ? 1 : 1 - seg(t, cc.until - FADE, cc.until));

  // Display slots (sort morphs).
  let slots = info.dataset.categories.map((_, i) => i);
  for (const s of cc.sorts) {
    if (t < s.at) break;
    const p = ease.inOutCubic(seg(t, s.at, s.at + MORPH));
    slots = s.from.map((f, i) => f + (s.to[i]! - f) * p);
  }

  // Values (switch morphs for single-series charts).
  const values = new Map<string, number[]>();
  let active = info.series[0]!;
  if (info.single) {
    let v = valuesOf(info, active);
    for (const w of cc.switches) {
      if (t < w.at) break;
      const p = ease.inOutCubic(seg(t, w.at, w.at + MORPH));
      const to = valuesOf(info, w.to);
      v = v.map((a, i) => a + (to[i]! - a) * p);
      if (p >= 0.5) active = w.to;
    }
    values.set(info.series[0]!, v);
  } else for (const s of info.series) values.set(s, valuesOf(info, s));

  // Growth: one category after the other, in display order at the moment the chart appears.
  const stagger = n > 1 ? (cc.grow * 0.5) / (n - 1) : 0;
  const dur = n > 1 ? cc.grow * 0.5 : cc.grow;
  const grow = cc.slots0.map((slot) => ease.inOutCubic(seg(t, cc.at + slot * stagger, cc.at + slot * stagger + dur)));

  // Cursor.
  const raw = override ?? sweepCursor(info, cc, t);
  const cursor = raw === null ? null : clamp(raw, info.cursorMin, info.cursorMax);
  let reach = Infinity;
  let focus = -1;
  const xs = info.dataset.categories.map((c) => c.x ?? 0);
  if (info.time) {
    // Without a cursor the drawing follows the growth along the axis.
    if (cursor === null) {
      const g = seg(t, cc.at, cc.at + cc.grow);
      reach = g >= 1 ? Infinity : xs[0]! + (xs[n - 1]! - xs[0]!) * ease.inOutQuad(g);
    } else reach = cursor;
    if (cursor !== null) for (let i = 0; i < n; i++) if (xs[i]! <= cursor + 1e-6) focus = i;
    for (let i = 0; i < n; i++) if (reach !== Infinity && xs[i]! > reach + 1e-6) grow[i] = 0;
    else if (reach !== Infinity || cursor !== null) grow[i] = Math.max(grow[i]!, 1);
  } else if (cursor !== null) {
    const want = Math.round(cursor) - 1;
    const final = slots.map((s) => Math.round(s));
    focus = final.indexOf(want);
  }

  // Highlights, compare, focus.
  const hiCat = new Array<number>(n).fill(0);
  const hiSeries = new Map<string, number>();
  let dim = 0;
  for (const h of cc.highlights) {
    const k = env(t, h.at, h.until);
    if (k <= 0) continue;
    dim = Math.max(dim, k);
    for (const c of h.cats) hiCat[c] = Math.max(hiCat[c]!, k);
    for (const s of h.series) hiSeries.set(s, Math.max(hiSeries.get(s) ?? 0, k));
  }
  let compare: ChartState["compare"] = null;
  for (const c of cc.compares) {
    const k = env(t, c.at, c.until);
    if (k <= 0) continue;
    dim = Math.max(dim, k);
    hiCat[c.a] = Math.max(hiCat[c.a]!, k);
    hiCat[c.b] = Math.max(hiCat[c.b]!, k);
    compare = { a: c.a, b: c.b, k };
  }
  if (focus >= 0 && !info.time) {
    dim = Math.max(dim, 1);
    hiCat[focus] = 1;
  }

  const annotations = cc.annotations.flatMap((a) => {
    const k = env(t, a.at, a.until);
    return k > 0 ? [{ action: a.action, index: a.index, k }] : [];
  });

  return { presence, grow, slots, values, active, cursor, reach, focus, hiCat, hiSeries, dim, compare, annotations };
}
