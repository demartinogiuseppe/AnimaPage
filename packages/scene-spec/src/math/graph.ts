// Graph maths shared by the concept engine (what it draws) and the scene checks (what the
// generation step verifies): compiled formulas with parameters, live notable points, labels,
// checkConceptMath (declared points/lines really are what they claim) and conceptMathNumbers
// (every number the graphs imply, to check the narration against).
import type { ConceptData, ConceptGraph, GraphAxis, GraphLine, GraphPlot, GraphPoint, ParamNum } from "../engines/concept.ts";
import {
  derivative,
  findExtrema,
  findInflections,
  findZeros,
  isAsymptote,
  isSymmetryAxis,
  notablePoints,
  resolvePoint,
  sampleCurve,
  xTolerance,
  type Fn,
  type PointKind,
  type Range,
} from "./calculus.ts";
import { compileExpr, exprLiterals, parseExpr, type CompiledExpr, type ExprNode } from "./expr.ts";
import { formatFixed, formatNum, formatPoint, prettyExpr } from "./format.ts";

export type ParamValues = Readonly<Record<string, number>>;

export const is3dGraph = (g: ConceptGraph) => g.z !== undefined;
/** The vertical axis: y in 2D graphs, z in 3D graphs. */
export const valueAxis = (g: ConceptGraph): GraphAxis => g.z ?? g.y;

/** Round tick step (1, 2 or 5 × 10^k) giving at most ~12 ticks. */
export function niceStep(min: number, max: number): number {
  const raw = (max - min) / 10;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw * 0.999) return m * p;
  return 10 * p;
}
export const axisStep = (a: GraphAxis) => a.step ?? niceStep(a.min, a.max);

export function initialParams(g: ConceptGraph): Record<string, number> {
  return Object.fromEntries((g.params ?? []).map((p) => [p.id, p.value]));
}

// ---------- numbers that may be parameter formulas ----------

const paramFns = new Map<string, CompiledExpr | null>();

/**
 * Value of a numeric field that is a number or a formula of the parameters ("a", "-b/(2a)").
 * Unknown parameters / invalid formulas give NaN (the schema rejects them); undefined stays undefined.
 */
export function paramNum(v: ParamNum | undefined, values: ParamValues): number | undefined {
  if (v === undefined || typeof v === "number") return v;
  const ids = Object.keys(values).sort();
  const key = `${ids.join(",")}|${v}`;
  let fn = paramFns.get(key);
  if (fn === undefined) {
    try {
      fn = compileExpr(v, { vars: ids });
    } catch {
      fn = null;
    }
    if (paramFns.size > 500) paramFns.clear();
    paramFns.set(key, fn);
  }
  return fn ? fn(...ids.map((id) => values[id]!)) : NaN;
}

/** Replaces "{expr}" placeholders of a label by their values ("x < {a}" -> "x < 2,5"). */
export function fillLabel(label: string, values: ParamValues): string {
  return label.replace(/\{([^}]*)\}/g, (_, src: string) => formatNum(paramNum(src, values) ?? NaN));
}

/** x interval where a plot is drawn: the graph's x range, cut by the plot's domain. */
export function plotRange(g: ConceptGraph, p: GraphPlot, values: ParamValues = initialParams(g)): Range {
  const lo = Math.max(g.x.min, paramNum(p.domain?.[0], values) ?? -Infinity);
  const hi = Math.min(g.x.max, paramNum(p.domain?.[1], values) ?? Infinity);
  return lo < hi ? [lo, hi] : [g.x.min, g.x.max];
}

export interface CompiledGraph {
  graph: ConceptGraph;
  paramIds: string[];
  ast: Map<string, ExprNode>;
  /** y = f(x) of a plot with the given parameter values (missing ones: initial values). */
  plot(id: string, values?: ParamValues): Fn;
  /** z = f(x, y) of a surface. */
  surface(id: string, values?: ParamValues): (x: number, y: number) => number;
}

/** Compiles every formula of a graph once. Throws ExprError on invalid formulas (the schema rejects those). */
export function compileGraph(g: ConceptGraph): CompiledGraph {
  const paramIds = (g.params ?? []).map((p) => p.id);
  const init = initialParams(g);
  const ast = new Map<string, ExprNode>();
  const fns = new Map<string, CompiledExpr>();
  for (const p of g.plots ?? []) {
    const vars = ["x", ...paramIds];
    ast.set(p.id, parseExpr(p.expr, { vars }));
    fns.set(p.id, compileExpr(ast.get(p.id)!, { vars }));
  }
  for (const s of g.surfaces ?? []) {
    const vars = ["x", "y", ...paramIds];
    ast.set(s.id, parseExpr(s.expr, { vars }));
    fns.set(s.id, compileExpr(ast.get(s.id)!, { vars }));
  }
  const vals = (values?: ParamValues) => paramIds.map((id) => values?.[id] ?? init[id]!);
  return {
    graph: g,
    paramIds,
    ast,
    plot(id, values) {
      const f = fns.get(id);
      if (!f) return () => NaN;
      const v = vals(values);
      if (!v.length) return (x) => f(x);
      return (x) => f(x, ...v);
    },
    surface(id, values) {
      const f = fns.get(id);
      if (!f) return () => NaN;
      const v = vals(values);
      return (x, y) => f(x, y, ...v);
    },
  };
}

// ---------- notable points, live ----------

/** Sorted x of the points of a kind (fixed kinds return []). */
export function pointCandidates(f: Fn, kind: PointKind, range: Range): number[] {
  const tol = xTolerance(range);
  const r: Range = [range[0] - 2 * tol, range[1] + 2 * tol];
  switch (kind) {
    case "zero":
      return findZeros(f, r);
    case "inflection":
      return findInflections(f, r);
    case "max":
    case "min":
      return findExtrema(f, r).filter((e) => e.kind === kind).map((e) => e.x);
    case "vertex":
      return findExtrema(f, r).map((e) => e.x);
    default:
      return [];
  }
}

/** How a declared point follows parameter changes: the k-th point of its kind, or a fixed x. */
export interface PointSlot {
  kind: PointKind;
  /** Index among pointCandidates; -1 for fixed-x kinds ("point", "y-intercept"). */
  index: number;
  x: number;
}

/** Slot of a declared point at the initial parameters (null when the point does not check out). */
export function pointSlot(cg: CompiledGraph, p: GraphPoint): PointSlot | null {
  const plot = cg.graph.plots?.find((q) => q.id === p.plot);
  if (!plot) return null;
  const f = cg.plot(plot.id);
  const range = plotRange(cg.graph, plot);
  const r = resolvePoint(f, p.kind, paramNum(p.x, initialParams(cg.graph)), range);
  if (!r.ok) return null;
  if (p.kind === "point" || p.kind === "y-intercept") return { kind: p.kind, index: -1, x: r.x };
  const c = pointCandidates(f, p.kind, range);
  let best = 0;
  c.forEach((x, i) => Math.abs(x - r.x) < Math.abs(c[best]! - r.x) && (best = i));
  return { kind: p.kind, index: best, x: r.x };
}

/**
 * Where the point is with these parameters; null when it does not exist (e.g. no real zeros).
 * `fixedX` is the live value of a "point"'s x formula.
 */
export function livePoint(f: Fn, slot: PointSlot, range: Range, fixedX?: number): { x: number; y: number } | null {
  const x = slot.index < 0 ? (slot.kind === "point" && fixedX !== undefined ? fixedX : slot.x) : pointCandidates(f, slot.kind, range)[slot.index];
  if (x === undefined) return null;
  const y = f(x);
  return Number.isFinite(y) ? { x, y } : null;
}

// ---------- labels ----------

export const plotName = (p: GraphPlot) => p.name ?? "f";

export function plotLabel(cg: CompiledGraph, p: GraphPlot, values?: ParamValues): string | null {
  if (p.label === false) return null;
  if (p.label) return p.label;
  const ast = cg.ast.get(p.id);
  if (!ast) return null;
  const v = { ...initialParams(cg.graph), ...values };
  return `${plotName(p)}(x) = ${prettyExpr(ast, { values: v, digits: 2 })}`;
}

export function surfaceLabel(cg: CompiledGraph, id: string, values?: ParamValues): string | null {
  const s = cg.graph.surfaces?.find((q) => q.id === id);
  if (!s || s.label === false) return null;
  if (s.label) return s.label;
  return `z = ${prettyExpr(cg.ast.get(id)!, { values: { ...initialParams(cg.graph), ...values }, digits: 2 })}`;
}

export function pointLabel(p: GraphPoint, x: number, y: number, values: ParamValues = {}): string | null {
  if (p.label === false) return null;
  return p.label !== undefined ? fillLabel(p.label, values) : formatPoint(p.name, x, y);
}

/** The line with its parameter formulas evaluated. */
export function lineForm(l: GraphLine, values: ParamValues = {}): { x: number } | { y: number } | { m: number; q: number } {
  if (l.x !== undefined) return { x: paramNum(l.x, values)! };
  if (l.y !== undefined) return { y: paramNum(l.y, values)! };
  return { m: paramNum(l.m, values) ?? 0, q: paramNum(l.q, values) ?? 0 };
}

export function lineLabel(l: GraphLine, values: ParamValues = {}): string | null {
  if (l.label === false) return null;
  if (l.label) return fillLabel(l.label, values);
  const f = lineForm(l, values);
  if ("x" in f) return `x = ${formatNum(f.x)}`;
  if ("y" in f) return `y = ${formatNum(f.y)}`;
  return `y = ${prettyExpr("m*x + q", { vars: ["x", "m", "q"], digits: 2, values: f })}`;
}

/** Live readout lines of a tracer at x. */
export function tracerReadout(readout: "slope" | "value" | "both" | "none", name: string, f: Fn, x: number): string[] {
  if (readout === "none") return [];
  const lines = [`x = ${formatFixed(x)}`];
  if (readout === "value" || readout === "both") lines.push(`${name}(x) = ${formatFixed(f(x))}`);
  if (readout === "slope" || readout === "both") lines.push(`${name}′(x) = ${formatFixed(derivative(f, x))}`);
  return lines;
}

// ---------- parameters over chapters ----------

/**
 * Parameter values after every "param" keyframe, in scene order (carryOver like the engine):
 * the states a narration may describe ("con a = −1 il vertice è...").
 */
export function paramStates(data: ConceptData, chapterIds: string[]): { chapter: string; at: number; values: Record<string, number> }[] {
  const init = Object.fromEntries((data.graphs ?? []).flatMap((g) => Object.entries(initialParams(g))));
  const out: { chapter: string; at: number; values: Record<string, number> }[] = [];
  let prev: Record<string, number> | null = null;
  for (const id of chapterIds) {
    const def = data.chapters.find((c) => c.chapter === id);
    const cur: Record<string, number> = { ...((def?.carryOver ?? true) && prev ? prev : init) };
    const actions = [...(def?.actions ?? [])].sort((a, b) => a.at - b.at);
    for (const a of actions)
      if (a.do === "param") {
        cur[a.id] = a.to;
        out.push({ chapter: id, at: a.at, values: { ...cur } });
      }
    prev = cur;
  }
  return out;
}

// ---------- checks ----------

interface Issue {
  path: string;
  message: string;
}

/**
 * Recomputes every declared point, asymptote and symmetry axis at the initial parameter values
 * and reports the ones that are not what they claim, plus anything that would be invisible.
 */
export function checkConceptMath(data: ConceptData): Issue[] {
  const issues: Issue[] = [];
  data.graphs?.forEach((g, gi) => {
    const at = `engineData.graphs[${gi}]`;
    const add = (path: string, message: string) => issues.push({ path: `${at}.${path}`, message });
    let cg: CompiledGraph;
    try {
      cg = compileGraph(g);
    } catch {
      return; // invalid formulas are reported by the schema
    }
    const plots = new Map((g.plots ?? []).map((p) => [p.id, p]));
    const v = valueAxis(g);
    const vRange: Range = [v.min, v.max];
    const visible = (y: number) => y >= v.min - 1e-9 && y <= v.max + 1e-9;
    const init = initialParams(g);
    const num = (x: ParamNum | undefined) => paramNum(x, init);

    g.plots?.forEach((p, i) => {
      if (!sampleCurve(cg.plot(p.id), plotRange(g, p), 200, { yClip: vRange }).length)
        add(`plots[${i}]`, `plot "${p.id}" is never inside the graph frame`);
    });
    g.points?.forEach((pt, i) => {
      const plot = plots.get(pt.plot);
      if (!plot) return;
      const r = resolvePoint(cg.plot(plot.id), pt.kind, num(pt.x), plotRange(g, plot));
      if (!r.ok) add(`points[${i}]`, `point "${pt.id}": ${r.problem}`);
      else if (!visible(r.y)) add(`points[${i}]`, `point "${pt.id}" (y = ${+r.y.toFixed(4)}) is outside the graph frame`);
    });
    g.lines?.forEach((l, i) => {
      const plot = l.plot ? plots.get(l.plot) : undefined;
      const meaning = l.meaning ?? "asymptote";
      if (!plot || meaning === "guide") return;
      const f = cg.plot(plot.id);
      const range = plotRange(g, plot);
      if (meaning === "asymptote" && !isAsymptote(f, lineForm(l, init), range))
        add(`lines[${i}]`, `line "${l.id}" (${lineLabel({ ...l, label: undefined }, init)}) is not an asymptote of "${plot.id}"`);
      if (meaning === "symmetry" && l.x !== undefined && !isSymmetryAxis(f, num(l.x)!, range))
        add(`lines[${i}]`, `x = ${num(l.x)} is not an axis of symmetry of "${plot.id}"`);
    });
    g.regions?.forEach((r, i) => {
      if (r.over && (num(r.over[0])! < g.x.min || num(r.over[1])! > g.x.max)) add(`regions[${i}]`, `region "${r.id}" goes outside the x range`);
    });
    g.intervals?.forEach((iv, i) => {
      for (const e of [num(iv.from), num(iv.to)])
        if (e !== undefined && !(e >= g.x.min && e <= g.x.max)) add(`intervals[${i}]`, `interval end ${e} is outside the x range`);
    });
    const tracerX = new Map<string, number[]>();
    g.tracers?.forEach((t) => tracerX.set(t.id, [t.x]));
    for (const c of data.chapters) for (const a of c.actions) if (a.do === "trace" && tracerX.has(a.id)) tracerX.get(a.id)!.push(a.to);
    g.tracers?.forEach((t, i) => {
      const plot = plots.get(t.plot);
      if (!plot) return;
      const f = cg.plot(plot.id);
      const [a, b] = plotRange(g, plot);
      for (const x of tracerX.get(t.id)!)
        if (!(x >= a && x <= b && Number.isFinite(f(x)) && visible(f(x))))
          add(`tracers[${i}]`, `tracer "${t.id}" at x = ${x} is outside the domain or the graph frame`);
    });
    g.surfaces?.forEach((s, i) => {
      const f = cg.surface(s.id);
      let any = false;
      for (let a = 0; a <= 8 && !any; a++)
        for (let b = 0; b <= 8 && !any; b++) {
          const z = f(s.x[0] + ((s.x[1] - s.x[0]) * a) / 8, s.y[0] + ((s.y[1] - s.y[0]) * b) / 8);
          any = Number.isFinite(z) && visible(z);
        }
      if (!any) add(`surfaces[${i}]`, `surface "${s.id}" is never inside the graph frame`);
    });
  });
  data.chapters.forEach((c, ci) =>
    c.actions.forEach((a, k) => {
      if (a.do !== "draw") return;
      const g = data.graphs?.find((q) => q.plots?.some((p) => p.id === a.id));
      const plot = g?.plots?.find((p) => p.id === a.id);
      if (!g || !plot) return;
      const [lo, hi] = plotRange(g, plot);
      for (const x of [a.from, a.to])
        if (x !== undefined && (x < lo - 1e-9 || x > hi + 1e-9))
          issues.push({ path: `engineData.chapters[${ci}].actions[${k}]`, message: `draw: x = ${x} is outside [${lo}, ${hi}]` });
    }),
  );
  return issues;
}

export interface MathNumber {
  value: number;
  /** Italian display ("−1", "1,5"). */
  text: string;
  /** What the number is (English), e.g. 'plot "f" zero x', 'point "V" y'. */
  what: string;
}

/**
 * Every number the graphs imply: axis ranges, parameters, coefficients as written, notable
 * points (computed, also with the parameter values each chapter ends with), declared points,
 * lines, interval and region ends, tracer positions with value and slope, surface ranges.
 * The generation step checks that numbers in the narration are among these.
 */
export function conceptMathNumbers(data: ConceptData, chapterIds: string[] = data.chapters.map((c) => c.chapter)): MathNumber[] {
  const out: MathNumber[] = [];
  const seen = new Set<string>();
  const add = (value: number, what: string) => {
    if (!Number.isFinite(value)) return;
    const v = Math.abs(value) < 1e-9 ? 0 : value;
    const key = `${what}|${v.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value: v, text: formatNum(v), what });
  };
  const states = paramStates(data, chapterIds);
  for (const g of data.graphs ?? []) {
    let cg: CompiledGraph;
    try {
      cg = compileGraph(g);
    } catch {
      continue;
    }
    for (const [axis, a] of [["x", g.x], ["y", g.y], ["z", g.z]] as const) {
      if (!a) continue;
      add(a.min, `graph "${g.id}" ${axis} min`);
      add(a.max, `graph "${g.id}" ${axis} max`);
    }
    for (const p of g.params ?? []) {
      add(p.value, `param ${p.id} start value`);
      add(p.min, `param ${p.id} min`);
      add(p.max, `param ${p.id} max`);
    }
    for (const c of data.chapters) for (const a of c.actions) if (a.do === "param" && g.params?.some((p) => p.id === a.id)) add(a.to, `param ${a.id} in chapter "${c.chapter}"`);
    const own = (vals: Record<string, number>) => Object.fromEntries(cg.paramIds.map((id) => [id, vals[id]!]));
    const variants: { values: Record<string, number>; tag: string }[] = [{ values: initialParams(g), tag: "" }];
    for (const st of states) {
      const mine = own(st.values);
      if (cg.paramIds.length && !variants.some((v) => cg.paramIds.every((id) => v.values[id] === mine[id])))
        variants.push({ values: mine, tag: ` (${cg.paramIds.map((id) => `${id} = ${mine[id]}`).join(", ")})` });
    }
    for (const p of g.plots ?? []) {
      for (const lit of exprLiterals(cg.ast.get(p.id)!)) add(lit, `plot "${p.id}" coefficient`);
      for (const { values, tag } of variants) {
        const f = cg.plot(p.id, values);
        const np = notablePoints(f, plotRange(g, p, values));
        np.zeros.forEach((x) => add(x, `plot "${p.id}" zero x${tag}`));
        np.extrema.forEach((e) => (add(e.x, `plot "${p.id}" ${e.kind} x${tag}`), add(e.y, `plot "${p.id}" ${e.kind} y${tag}`)));
        np.inflections.forEach((x) => (add(x, `plot "${p.id}" inflection x${tag}`), add(f(x), `plot "${p.id}" inflection y${tag}`)));
        if (np.yIntercept !== null) add(np.yIntercept, `plot "${p.id}" y-intercept${tag}`);
      }
    }
    // Everything that may follow the parameters, at the default values and at every keyframe.
    for (const { values, tag } of variants) {
      const num = (v: ParamNum | undefined) => paramNum(v, values);
      for (const pt of g.points ?? []) {
        const plot = g.plots?.find((q) => q.id === pt.plot);
        const slot = plot ? pointSlot(cg, pt) : null;
        if (!plot || !slot) continue;
        const live = livePoint(cg.plot(plot.id, values), slot, plotRange(g, plot, values), num(pt.x));
        if (!live) continue;
        add(live.x, `point "${pt.id}" x${tag}`);
        add(live.y, `point "${pt.id}" y${tag}`);
      }
      for (const l of g.lines ?? []) {
        const f = lineForm(l, values);
        if ("x" in f) add(f.x, `line "${l.id}" x${tag}`);
        else if ("y" in f) add(f.y, `line "${l.id}" y${tag}`);
        else (add(f.m, `line "${l.id}" slope${tag}`), add(f.q, `line "${l.id}" intercept${tag}`));
      }
      for (const iv of g.intervals ?? []) {
        if (iv.from !== undefined) add(num(iv.from)!, `interval "${iv.id}" from${tag}`);
        if (iv.to !== undefined) add(num(iv.to)!, `interval "${iv.id}" to${tag}`);
      }
      for (const r of g.regions ?? []) if (r.over) (add(num(r.over[0])!, `region "${r.id}" from${tag}`), add(num(r.over[1])!, `region "${r.id}" to${tag}`));
    }
    for (const t of g.tracers ?? []) {
      const xs = [t.x, ...data.chapters.flatMap((c) => c.actions.flatMap((a) => (a.do === "trace" && a.id === t.id ? [a.to] : [])))];
      const f = cg.plot(t.plot);
      for (const x of xs) {
        add(x, `tracer "${t.id}" x`);
        add(f(x), `tracer "${t.id}" value at x = ${x}`);
        add(Math.round(derivative(f, x) * 1e6) / 1e6, `tracer "${t.id}" slope at x = ${x}`);
      }
    }
    for (const s of g.surfaces ?? []) {
      for (const lit of exprLiterals(cg.ast.get(s.id)!)) add(lit, `surface "${s.id}" coefficient`);
      add(s.x[0], `surface "${s.id}" x from`);
      add(s.x[1], `surface "${s.id}" x to`);
      add(s.y[0], `surface "${s.id}" y from`);
      add(s.y[1], `surface "${s.id}" y to`);
    }
  }
  return out;
}
