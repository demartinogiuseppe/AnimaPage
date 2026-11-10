// Pure planning for graphs in the concept engine (no three.js, unit-tested).
//
// - Frame: maps maths coordinates to board coordinates (see the layout notes in
//   packages/scene-spec/src/engines/concept.ts).
// - Per chapter tracks, compiled once from the actions like plan.ts does for tiles: the drawn
//   x window of every plot ("appear" / "draw"), tracer x ("trace"), parameter values ("param")
//   and mirror ghosts ("mirror"). Presence and glow of graph entities live in plan.ts.
// State carries over between chapters exactly like plan.ts (carryOver, default true); mirror
// ghosts are chapter-local.
import {
  ACTION_DEFAULT_DUR,
  axisStep,
  compileGraph,
  GRAPH_APPEAR_DUR,
  initialParams,
  plotRange,
  sampleCurve,
  valueAxis,
  type ConceptData,
  type ConceptGraph,
  type SceneSpec,
} from "@pv/scene-spec";
import { ease, lerp, seg } from "../../util/math.ts";
import type { V3 } from "./plan.ts";

/** Panel margin around the plotting area (2D graphs), board units. */
export const PANEL_PAD = 0.7;

export interface Frame {
  graph: ConceptGraph;
  is3d: boolean;
  x: [number, number];
  /** Vertical (value) range: y in 2D, z in 3D. */
  v: [number, number];
  /** Depth range (maths y) of 3D graphs. */
  d: [number, number] | null;
  sx: number;
  sv: number;
  xStep: number;
  vStep: number;
  dStep: number;
  /** Board point of a curve point (u = maths x, v = value); 3D graphs: in the plane y = 0. */
  plane(u: number, v: number): V3;
  /** Board point of maths (x, y, z) in a 3D graph (2D graphs ignore y). */
  space(x: number, y: number, z: number): V3;
  /** Board-space bounding box [min, max]. */
  box: [V3, V3];
}

export function makeFrame(g: ConceptGraph): Frame {
  const sx = g.scale ?? 1;
  const sv = g.yScale ?? sx;
  const va = valueAxis(g);
  const xc = (g.x.min + g.x.max) / 2;
  const [px, py, pz] = g.pos;
  if (!g.z) {
    const lift = PANEL_PAD;
    const space = (x: number, _y: number, z: number): V3 => [px + (x - xc) * sx, py + lift + (z - va.min) * sv, pz];
    const w = (g.x.max - g.x.min) * sx;
    const h = (va.max - va.min) * sv;
    return {
      graph: g,
      is3d: false,
      x: [g.x.min, g.x.max],
      v: [va.min, va.max],
      d: null,
      sx,
      sv,
      xStep: axisStep(g.x),
      vStep: axisStep(va),
      dStep: 1,
      plane: (u, v) => space(u, 0, v),
      space,
      box: [
        [px - w / 2 - PANEL_PAD, py, pz - 0.3],
        [px + w / 2 + PANEL_PAD, py + h + 2 * PANEL_PAD, pz + 0.3],
      ],
    };
  }
  const yc = (g.y.min + g.y.max) / 2;
  const lift = 0.05;
  const space = (x: number, y: number, z: number): V3 => [px + (x - xc) * sx, py + lift + (z - va.min) * sv, pz - (y - yc) * sx];
  const y0 = Math.min(Math.max(0, g.y.min), g.y.max);
  const w = (g.x.max - g.x.min) * sx;
  const dd = (g.y.max - g.y.min) * sx;
  return {
    graph: g,
    is3d: true,
    x: [g.x.min, g.x.max],
    v: [va.min, va.max],
    d: [g.y.min, g.y.max],
    sx,
    sv,
    xStep: axisStep(g.x),
    vStep: axisStep(va),
    dStep: axisStep(g.y),
    plane: (u, v) => space(u, y0, v),
    space,
    box: [
      [px - w / 2 - 0.6, py, pz - dd / 2 - 0.6],
      [px + w / 2 + 0.6, py + lift + (va.max - va.min) * sv + 0.8, pz + dd / 2 + 0.6],
    ],
  };
}

// ---------- tracks ----------

export interface ScalarKey {
  at: number;
  dur: number;
  from: number;
  to: number;
}
export interface ScalarTrack {
  init: number;
  keys: ScalarKey[];
}
export interface WindowKey {
  at: number;
  dur: number;
  from: [number, number];
  to: [number, number];
}
export interface WindowTrack {
  init: [number, number];
  keys: WindowKey[];
}
export interface MirrorKey {
  at: number;
  dur: number;
  about: "y-axis" | "origin";
}

export interface GraphChapterPlan {
  /** Drawn x window of every plot. */
  reveal: Map<string, WindowTrack>;
  tracers: Map<string, ScalarTrack>;
  params: Map<string, ScalarTrack>;
  mirrors: Map<string, MirrorKey[]>;
}
export interface GraphPlan {
  chapters: Map<string, GraphChapterPlan>;
  empty: GraphChapterPlan;
}

function lastKey<K extends { at: number }>(keys: K[], t: number): K | null {
  let found: K | null = null;
  for (const k of keys) {
    if (k.at <= t) found = k;
    else break;
  }
  return found;
}

export function evalScalar(tr: ScalarTrack, t: number): number {
  const k = lastKey(tr.keys, t);
  return k ? lerp(k.from, k.to, ease.inOutCubic(seg(t, k.at, k.at + k.dur))) : tr.init;
}

/** Drawn window and whether the pen is still moving. */
export function evalWindow(tr: WindowTrack, t: number): { win: [number, number]; drawing: boolean } {
  const k = lastKey(tr.keys, t);
  if (!k) return { win: [...tr.init], drawing: false };
  const p = seg(t, k.at, k.at + k.dur);
  const e = ease.inOutQuad(p);
  return { win: [lerp(k.from[0], k.to[0], e), lerp(k.from[1], k.to[1], e)], drawing: p > 0 && p < 1 };
}

/**
 * Mirror ghost: rotation progress 0..1 (null = no ghost). With `about`, only that test: the
 * reflection in the y axis and the half-turn about the origin are separate ghosts that can be
 * on together (trying both shows "neither even nor odd").
 */
export function evalMirror(
  keys: MirrorKey[] | undefined,
  t: number,
  about?: MirrorKey["about"],
): { about: MirrorKey["about"]; p: number } | null {
  const k = keys ? lastKey(about ? keys.filter((q) => q.about === about) : keys, t) : null;
  return k ? { about: k.about, p: ease.inOutCubic(seg(t, k.at, k.at + k.dur)) } : null;
}

interface GraphState {
  present: Map<string, boolean>;
  win: Map<string, [number, number]>;
  tracer: Map<string, number>;
  param: Map<string, number>;
}

export function compileGraphPlan(spec: SceneSpec, data: ConceptData): GraphPlan {
  const graphs = data.graphs ?? [];
  /** `range`: the whole drawable x range; `shown`: where the curve is inside the frame. */
  const plotOf = new Map<string, { g: ConceptGraph; range: [number, number]; shown: [number, number] }>();
  for (const g of graphs) {
    const cg = compileGraph(g);
    const va = valueAxis(g);
    for (const p of g.plots ?? []) {
      // Default drawing window: where the curve is inside the frame (at the initial parameters),
      // so the pen does not spend time drawing nothing.
      const pieces = sampleCurve(cg.plot(p.id), plotRange(g, p), 200, { yClip: [va.min, va.max] });
      const range: [number, number] = [...plotRange(g, p)];
      const shown: [number, number] = pieces.length
        ? [pieces[0]![0]![0], pieces[pieces.length - 1]![pieces[pieces.length - 1]!.length - 1]![0]]
        : range;
      plotOf.set(p.id, { g, range, shown });
    }
  }

  const base = (): GraphState => ({
    present: new Map([...plotOf.keys()].map((id) => [id, false])),
    win: new Map([...plotOf].map(([id, { range }]) => [id, [range[0], range[0]] as [number, number]])),
    tracer: new Map(graphs.flatMap((g) => (g.tracers ?? []).map((t) => [t.id, t.x] as const))),
    param: new Map(graphs.flatMap((g) => Object.entries(initialParams(g)))),
  });
  const clone = (s: GraphState): GraphState => ({
    present: new Map(s.present),
    win: new Map(s.win),
    tracer: new Map(s.tracer),
    param: new Map(s.param),
  });

  const compile = (actions: ConceptData["chapters"][number]["actions"], start: GraphState) => {
    const st = clone(start);
    const plan: GraphChapterPlan = {
      reveal: new Map([...st.win].map(([id, w]) => [id, { init: [...w] as [number, number], keys: [] }])),
      tracers: new Map([...st.tracer].map(([id, x]) => [id, { init: x, keys: [] }])),
      params: new Map([...st.param].map(([id, v]) => [id, { init: v, keys: [] }])),
      mirrors: new Map(),
    };
    const sorted = actions.map((a, i) => ({ a, i })).sort((x, y) => x.a.at - y.a.at || x.i - y.i);
    for (const { a } of sorted) {
      const T = a.at;
      const draw = (id: string, from: number, to: number, dur: number) => {
        const tr = plan.reveal.get(id)!;
        tr.keys.push({ at: T, dur, from: [from, from], to: [from, to] });
        st.win.set(id, [from, to]);
        st.present.set(id, true);
      };
      /** Whole curve: the pen draws only the part inside the frame, then the window silently opens to the full range (parameters may move the curve later). */
      const drawAll = (id: string, dur: number) => {
        const p = plotOf.get(id)!;
        draw(id, p.shown[0], p.shown[1], dur);
        plan.reveal.get(id)!.keys.push({ at: T + dur, dur: 0, from: [...p.shown], to: [...p.range] });
        st.win.set(id, [...p.range]);
      };
      switch (a.do) {
        case "appear":
          for (const id of a.ids) {
            const p = plotOf.get(id);
            if (p && !st.present.get(id)) drawAll(id, a.dur ?? GRAPH_APPEAR_DUR.plot!);
          }
          break;
        case "hide":
          for (const id of a.ids) if (plotOf.has(id)) st.present.set(id, false);
          break;
        case "draw": {
          const p = plotOf.get(a.id);
          if (!p) break;
          if (a.from === undefined && a.to === undefined) drawAll(a.id, a.dur ?? ACTION_DEFAULT_DUR.draw);
          else draw(a.id, a.from ?? p.shown[0], a.to ?? p.shown[1], a.dur ?? ACTION_DEFAULT_DUR.draw);
          break;
        }
        case "trace": {
          const tr = plan.tracers.get(a.id);
          if (!tr) break;
          tr.keys.push({ at: T, dur: a.dur ?? ACTION_DEFAULT_DUR.trace, from: evalScalar(tr, T), to: a.to });
          st.tracer.set(a.id, a.to);
          break;
        }
        case "param": {
          const tr = plan.params.get(a.id);
          if (!tr) break;
          tr.keys.push({ at: T, dur: a.dur ?? ACTION_DEFAULT_DUR.param, from: evalScalar(tr, T), to: a.to });
          st.param.set(a.id, a.to);
          break;
        }
        case "mirror":
          if (plotOf.has(a.id))
            plan.mirrors.set(a.id, [...(plan.mirrors.get(a.id) ?? []), { at: T, dur: a.dur ?? ACTION_DEFAULT_DUR.mirror, about: a.about }]);
          break;
      }
    }
    for (const tr of plan.reveal.values()) tr.keys.sort((x, y) => x.at - y.at);
    return { plan, end: st };
  };

  const chapters = new Map<string, GraphChapterPlan>();
  let prev: GraphState | null = null;
  for (const ch of spec.chapters) {
    const def = data.chapters.find((c) => c.chapter === ch.id);
    const start = (def?.carryOver ?? true) && prev ? prev : base();
    const { plan, end } = compile(def?.actions ?? [], start);
    chapters.set(ch.id, plan);
    prev = end;
  }
  return { chapters, empty: compile([], base()).plan };
}
