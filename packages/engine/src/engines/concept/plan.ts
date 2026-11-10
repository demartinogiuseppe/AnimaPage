// Pure planning for the concept engine (no three.js, unit-tested).
//
// The declarative actions of every chapter are compiled once, at build time, into per-entity
// keyframe tracks (presence, position, text variant, colour, glow/bounce windows). update(t)
// then only evaluates tracks, so the scene is a pure function of (chapterId, t).
//
// Layout model: see packages/scene-spec/src/engines/concept.ts. Row slots are re-packed at every
// action time ("keyframe") from the logical state, so neighbours slide aside automatically.
import {
  ACTION_DEFAULT_DUR,
  GRAPH_APPEAR_DUR,
  graphEntities,
  type ConceptAction,
  type ConceptData,
  type ConceptPlace,
  type ConceptShape,
  type SceneSpec,
} from "@pv/scene-spec";
import { ease, lerp, seg } from "../../util/math.ts";

export type V3 = [number, number, number];

export const TILE_H = { s: 0.8, m: 1, l: 1.3 } as const;
/** Tile thickness along z, relative to its height. */
export const TILE_DEPTH = 0.55;
/** Main text and sub-line cap height relative to the tile height. */
export const TEXT_H = 0.42;
export const SUB_H = 0.2;
/** Average glyph advance / font size for a bold sans-serif (deterministic width estimate). */
const CHAR_W = 0.56;
export const SHAPE_T = 0.16;
/** Neighbours sliding to new row slots. */
export const SHIFT_DUR = 0.6;
export const HOP_H = 1.3;
export const HOP_LOW_H = 0.45;
export const DROP_H = 3.2;
export const SQUASH_DUR = 0.28;
export const DEFAULT_COLOR = "#66788a";
const ROW_GAP = 0.25;

export type MoveStyle = "set" | "slide" | "hop" | "hopLow";
export type PresenceStyle = "set" | "pop" | "drop" | "shrink";

export interface Key<T, S extends string = string> {
  at: number;
  dur: number;
  from: T;
  to: T;
  style: S;
}
export interface Track<T, S extends string = string> {
  init: T;
  keys: Key<T, S>[];
}

export interface Variant {
  text: string;
  sub: string;
  width: number;
}

export interface EntityPlan {
  presence: Track<number, PresenceStyle>;
  pos: Track<V3, MoveStyle>;
  variant: Track<number>;
  color: Track<string>;
  glow: [number, number][];
  bounce: [number, number][];
}
export interface RowPlan {
  presence: Track<number, PresenceStyle>;
  extent: Track<[number, number], MoveStyle>;
}
export interface ChapterPlan {
  entities: Map<string, EntityPlan>;
  rows: Map<string, RowPlan>;
}
export interface Plan {
  chapters: Map<string, ChapterPlan>;
  /** Text variants per tile; index 0 is the declared text. */
  variants: Map<string, Variant[]>;
  /** Fallback for unknown chapter ids: everything hidden. */
  empty: ChapterPlan;
}

// ---------- sizes ----------

/** CJK, Hangul and full-width characters are about one em wide: ~1.8 average Latin glyphs (D21). */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const glyphs = (s: string) => [...s].reduce((n, c) => n + (WIDE.test(c) ? 1.8 : 1), 0);

export function tileWidth(text: string, sub: string, size: keyof typeof TILE_H = "m"): number {
  const h = TILE_H[size];
  const main = glyphs(text) * CHAR_W * TEXT_H * h;
  const small = glyphs(sub) * CHAR_W * SUB_H * h;
  return Math.max(h * 0.9, Math.max(main, small) + 0.6 * h);
}

/** Width along x used for row packing, and height of the top above the place point. */
export function shapeExtent(s: ConceptShape): { width: number; height: number } {
  let w: number;
  let h: number;
  switch (s.kind) {
    case "polygon": {
      const xs = s.points.map((p) => p[0]);
      const ys = s.points.map((p) => p[1]);
      w = Math.max(...xs) - Math.min(...xs);
      h = Math.max(...ys);
      break;
    }
    case "circle":
    case "pie":
    case "angle":
      w = 2 * s.radius;
      h = s.radius;
      break;
    case "bar":
      w = s.length;
      h = s.length / Math.max(s.parts, 1) / 2;
      break;
  }
  return { width: w, height: s.upright ? Math.max(h, SHAPE_T) : SHAPE_T };
}

// ---------- easing and track evaluation ----------

const outBack = (p: number, s = 1.9) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;
const inBack = (p: number, s = 1.7) => (s + 1) * p ** 3 - s * p ** 2;
export function outBounce(p: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

/** Last key started at or before t, with its progress. */
export function activeKey<T, S extends string>(tr: Track<T, S>, t: number): { key: Key<T, S>; p: number } | null {
  let found: Key<T, S> | null = null;
  for (const k of tr.keys) {
    if (k.at <= t) found = k;
    else break;
  }
  return found ? { key: found, p: seg(t, found.at, found.at + found.dur) } : null;
}

export function mixPos(a: V3, b: V3, p: number, style: MoveStyle): V3 {
  if (p >= 1) return [...b];
  if (style === "set") return [...a];
  if (style === "slide") {
    const e = ease.inOutCubic(p);
    return [lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e)];
  }
  // Hop: a snappy arc that overshoots a little horizontally and lands with a squash (engine).
  const e = outBack(p, 1.2);
  const lift = Math.sin(Math.PI * p) * (style === "hop" ? HOP_H : HOP_LOW_H);
  return [lerp(a[0], b[0], e), lerp(a[1], b[1], ease.inOutQuad(p)) + lift, lerp(a[2], b[2], e)];
}

export function evalPos(tr: Track<V3, MoveStyle>, t: number): V3 {
  const k = activeKey(tr, t);
  return k ? mixPos(k.key.from, k.key.to, k.p, k.key.style) : [...tr.init];
}

/** Presence as a scale factor (pop overshoots) plus the vertical offset of a "drop". */
export function evalPresence(tr: Track<number, PresenceStyle>, t: number): { scale: number; drop: number; p: number } {
  const k = activeKey(tr, t);
  if (!k) return { scale: tr.init, drop: 0, p: 1 };
  const { key, p } = k;
  switch (key.style) {
    case "set":
      return { scale: key.to, drop: 0, p: 1 };
    case "pop":
      return { scale: Math.max(0, lerp(key.from, key.to, outBack(p))), drop: 0, p };
    case "drop":
      return p <= 0 ? { scale: key.from, drop: 0, p } : { scale: 1, drop: (1 - outBounce(p)) * DROP_H, p };
    case "shrink":
      return { scale: Math.max(0, lerp(key.from, key.to, inBack(p))), drop: 0, p };
  }
}

/** Plain 0..1 progress of presence (axes and arrows draw themselves with it). */
export function evalGrow(tr: Track<number, PresenceStyle>, t: number): number {
  const k = activeKey(tr, t);
  if (!k) return tr.init;
  return lerp(k.key.from, k.key.to, k.key.style === "set" ? 1 : ease.inOutCubic(k.p));
}

/** Squash after landing: 0..1 envelope right after a non-"set" move ends. */
export function landing(tr: Track<V3, MoveStyle>, t: number): number {
  const k = activeKey(tr, t);
  if (!k || k.key.style === "set") return 0;
  const end = k.key.at + k.key.dur;
  if (t < end || t > end + SQUASH_DUR) return 0;
  return Math.sin(Math.PI * seg(t, end, end + SQUASH_DUR));
}

/** Text flip: shown variant and rotation angle (radians about x). */
export function evalFlip(tr: Track<number>, t: number): { variant: number; angle: number } {
  const k = activeKey(tr, t);
  if (!k) return { variant: tr.init, angle: 0 };
  const { key, p } = k;
  if (p >= 1) return { variant: key.to, angle: 0 };
  const e = ease.inOutQuad(p);
  return e < 0.5 ? { variant: key.from, angle: e * Math.PI } : { variant: key.to, angle: (e - 1) * Math.PI };
}

/** 0..1 envelope inside any window, with short fades at the edges. */
export function windowEnv(windows: [number, number][], t: number): number {
  let env = 0;
  for (const [a, b] of windows) {
    const f = Math.min(0.3, (b - a) / 2);
    if (f > 0) env = Math.max(env, seg(t, a, a + f) * (1 - seg(t, b - f, b)));
  }
  return env;
}

/** Bounce height: two decaying hops inside the window. */
export function bounceAt(windows: [number, number][], t: number): number {
  for (const [a, b] of windows) {
    if (t < a || t > b || b <= a) continue;
    const q = (t - a) / (b - a);
    return Math.abs(Math.sin(2 * Math.PI * q)) * 0.6 * (1 - q);
  }
  return 0;
}

// ---------- compiling ----------

interface LogicalState {
  present: boolean;
  place: ConceptPlace;
  variant: number;
  role: string | undefined;
}
type State = Map<string, LogicalState>;

const near = (a: V3, b: V3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-6;
const lastTo = <T>(tr: Track<T, string>): T => (tr.keys.length ? tr.keys[tr.keys.length - 1]!.to : tr.init);

/** Inserts a key in time order (after keys with the same `at`) and recomputes every `from`. */
function addKey<T, S extends string>(
  tr: Track<T, S>,
  key: Omit<Key<T, S>, "from">,
  evalAt: (tr: Track<T, S>, t: number) => T,
): void {
  let i = tr.keys.length;
  while (i > 0 && tr.keys[i - 1]!.at > key.at) i--;
  tr.keys.splice(i, 0, { ...key, from: tr.init });
  for (let k = 0; k < tr.keys.length; k++) {
    tr.keys[k]!.from = evalAt({ init: tr.init, keys: tr.keys.slice(0, k) }, tr.keys[k]!.at);
  }
}
const presenceValue = (tr: Track<number, PresenceStyle>, t: number) => {
  const k = activeKey(tr, t);
  return k ? lerp(k.key.from, k.key.to, k.key.style === "set" ? 1 : k.p) : tr.init;
};
const lastValue = <T>(tr: Track<T>, t: number): T => {
  const k = activeKey(tr, t);
  return k ? (k.p >= 1 ? k.key.to : k.key.from) : tr.init;
};
const extentAt = (tr: Track<[number, number], MoveStyle>, t: number): [number, number] => {
  const k = activeKey(tr, t);
  if (!k) return [...tr.init];
  const e = k.key.style === "set" ? 1 : ease.inOutCubic(k.p);
  return [lerp(k.key.from[0], k.key.to[0], e), lerp(k.key.from[1], k.key.to[1], e)];
};

export function compilePlan(spec: SceneSpec, data: ConceptData): Plan {
  const roleColor = new Map(data.roles.map((r) => [r.id, r.color]));
  const colorOf = (role: string | undefined) => (role && roleColor.get(role)) || DEFAULT_COLOR;
  const rowById = new Map(data.rows.map((r) => [r.id, r]));
  const axisById = new Map(data.axes.map((a) => [a.id, a]));
  const tileById = new Map(data.tiles.map((t) => [t.id, t]));
  const shapeById = new Map(data.shapes.map((s) => [s.id, s]));
  const order = new Map<string, number>();
  [...data.tiles, ...data.shapes].forEach((e, i) => order.set(e.id, i));
  const movable = [...data.tiles.map((t) => t.id), ...data.shapes.map((s) => s.id)];
  // Graph entities (frames, plots, points...) only get presence and glow tracks here; their own
  // motion (drawing, tracers, parameters, mirror) is compiled in graph-plan.ts.
  const graphKinds = new Map(graphEntities(data.graphs).filter((e) => e.kind !== "param").map((e) => [e.id, e.kind]));
  const all = [...movable, ...data.axes.map((a) => a.id), ...data.links.map((l) => l.id), ...graphKinds.keys()];
  const appearDur = (id: string, dur: number | undefined) => dur ?? GRAPH_APPEAR_DUR[graphKinds.get(id)!] ?? ACTION_DEFAULT_DUR.appear;

  const variants = new Map<string, Variant[]>(
    data.tiles.map((t) => [t.id, [{ text: t.text, sub: t.sub ?? "", width: tileWidth(t.text, t.sub ?? "", t.size) }]]),
  );
  const variantIndex = (id: string, text: string, sub: string) => {
    const list = variants.get(id)!;
    let i = list.findIndex((v) => v.text === text && v.sub === sub);
    if (i < 0) {
      i = list.push({ text, sub, width: tileWidth(text, sub, tileById.get(id)!.size) }) - 1;
    }
    return i;
  };
  const widthOf = (id: string, st: LogicalState) => {
    const tile = tileById.get(id);
    if (tile) return variants.get(id)![st.variant]!.width;
    return shapeExtent(shapeById.get(id)!).width;
  };

  /** Bottom-centre target of every movable entity for a logical state. */
  const resolveAll = (state: State): Map<string, V3> => {
    const out = new Map<string, V3>();
    const members = new Map<string, string[]>();
    for (const id of movable) {
      const st = state.get(id)!;
      const pl = st.place;
      if ("pos" in pl) out.set(id, [...pl.pos]);
      else if ("axis" in pl) {
        const ax = axisById.get(pl.axis)!;
        const d = ((pl.value - ax.min) / (ax.max - ax.min)) * ax.length;
        const p: V3 = [...ax.origin];
        const lane = pl.lane ?? 0;
        if (ax.direction === "x") (p[0] += d), (p[2] += lane);
        if (ax.direction === "y") (p[1] += d), (p[2] += lane);
        if (ax.direction === "z") (p[2] += d), (p[0] += lane);
        p[1] += pl.height ?? 0;
        out.set(id, p);
      } else if (st.present) members.set(pl.row, [...(members.get(pl.row) ?? []), id]);
    }
    const pack = (rowId: string, ids: string[]): Map<string, V3> => {
      const row = rowById.get(rowId)!;
      const sorted = [...ids].sort((a, b) => {
        const pa = state.get(a)!.place as { index: number };
        const pb = state.get(b)!.place as { index: number };
        return pa.index - pb.index || order.get(a)! - order.get(b)!;
      });
      const gap = row.gap ?? ROW_GAP;
      const widths = sorted.map((id) => widthOf(id, state.get(id)!));
      const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, sorted.length - 1);
      let x = row.origin[0] - total / 2;
      const res = new Map<string, V3>();
      sorted.forEach((id, i) => {
        res.set(id, [x + widths[i]! / 2, row.origin[1], row.origin[2]]);
        x += widths[i]! + gap;
      });
      return res;
    };
    for (const [rowId, ids] of members) for (const [id, p] of pack(rowId, ids)) out.set(id, p);
    // Hidden row entities: the slot they would take if they appeared now.
    for (const id of movable) {
      if (out.has(id)) continue;
      const pl = state.get(id)!.place as { row: string };
      out.set(id, pack(pl.row, [...(members.get(pl.row) ?? []), id]).get(id)!);
    }
    return out;
  };

  const rowExtent = (rowId: string, state: State, pos: Map<string, V3>): [number, number] | null => {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const id of movable) {
      const st = state.get(id)!;
      if (!st.present || !("row" in st.place) || st.place.row !== rowId) continue;
      const w = widthOf(id, st);
      x0 = Math.min(x0, pos.get(id)![0] - w / 2);
      x1 = Math.max(x1, pos.get(id)![0] + w / 2);
    }
    return x0 <= x1 ? [x0, x1] : null;
  };

  const baseState = (): State => {
    const s: State = new Map();
    for (const t of data.tiles) s.set(t.id, { present: false, place: t.place, variant: 0, role: t.role });
    for (const sh of data.shapes) s.set(sh.id, { present: false, place: sh.place, variant: 0, role: sh.role });
    for (const a of data.axes) s.set(a.id, { present: false, place: { pos: a.origin }, variant: 0, role: a.role });
    for (const l of data.links) s.set(l.id, { present: false, place: { pos: [0, 0, 0] }, variant: 0, role: l.role });
    for (const id of graphKinds.keys()) s.set(id, { present: false, place: { pos: [0, 0, 0] }, variant: 0, role: undefined });
    return s;
  };
  const cloneState = (s: State): State => new Map([...s].map(([k, v]) => [k, { ...v }]));

  const compileChapter = (actions: ConceptAction[], start: State): { plan: ChapterPlan; end: State } => {
    const state = cloneState(start);
    const pos0 = resolveAll(state);
    const entities = new Map<string, EntityPlan>();
    for (const id of all) {
      const st = state.get(id)!;
      entities.set(id, {
        presence: { init: st.present ? 1 : 0, keys: [] },
        pos: { init: pos0.get(id) ?? [0, 0, 0], keys: [] },
        variant: { init: st.variant, keys: [] },
        color: { init: colorOf(st.role), keys: [] },
        glow: [],
        bounce: [],
      });
    }
    const rows = new Map<string, RowPlan>();
    for (const r of data.rows) {
      const ext = rowExtent(r.id, state, pos0);
      rows.set(r.id, {
        presence: { init: ext ? 1 : 0, keys: [] },
        extent: { init: ext ?? [r.origin[0], r.origin[0]], keys: [] },
      });
    }

    // Graph frames (whiteboards, 3D boxes) are scaffolding: the player pops the content up on its
    // own clock at chapter entry, so a frame shown anywhere in the chapter stands from t = 0
    // (its "appear" is hoisted and instantaneous). Curves, points... keep their timeline.
    // A frame that the chapter also hides keeps its timeline (hide/re-appear stays in order).
    const hidden = new Set(actions.flatMap((a) => (a.do === "hide" ? a.ids : [])));
    const hoist = (id: string) => graphKinds.get(id) === "graph" && !hidden.has(id);
    const frames = new Set<string>();
    const rest: ConceptAction[] = [];
    for (const a of actions) {
      if (a.do !== "appear") {
        rest.push(a);
        continue;
      }
      const ids = a.ids.filter((id) => !hoist(id));
      a.ids.forEach((id) => hoist(id) && frames.add(id));
      if (ids.length) rest.push(ids.length === a.ids.length ? a : { ...a, ids });
    }
    const hoisted: ConceptAction[] = frames.size ? [{ at: 0, do: "appear", ids: [...frames], dur: 0 }] : [];
    const sorted = [...hoisted, ...rest].map((a, i) => ({ a, i })).sort((x, y) => x.a.at - y.a.at || x.i - y.i);
    let g = 0;
    while (g < sorted.length) {
      const T = sorted[g]!.a.at;
      const group: ConceptAction[] = [];
      while (g < sorted.length && sorted[g]!.a.at === T) group.push(sorted[g++]!.a);

      const wasPresent = new Map(all.map((id) => [id, state.get(id)!.present]));
      const intents = new Map<string, { dur: number; style: MoveStyle }>();
      const splitFrom = new Map<string, { origin: V3; dur: number }>();
      const mergeTo = new Map<string, { into: string; dur: number; dx: number }>();
      const presenceKey = (id: string, at: number, dur: number, to: number, style: PresenceStyle) =>
        addKey(entities.get(id)!.presence, { at, dur, to, style }, presenceValue);

      for (const a of group) {
        const dur = a.dur ?? ACTION_DEFAULT_DUR[a.do];
        switch (a.do) {
          case "appear":
            a.ids.forEach((id, i) => {
              const st = state.get(id)!;
              if (st.present) return;
              st.present = true;
              presenceKey(id, T + i * (a.stagger ?? 0), appearDur(id, a.dur), 1, a.style ?? "pop");
            });
            break;
          case "hide":
            for (const id of a.ids) {
              const st = state.get(id)!;
              if (!st.present) continue;
              st.present = false;
              presenceKey(id, T, dur, 0, "shrink");
            }
            break;
          case "move":
            state.get(a.id)!.place = a.to;
            intents.set(a.id, { dur, style: a.style ?? "hop" });
            break;
          case "swap": {
            const sa = state.get(a.a)!;
            const sb = state.get(a.b)!;
            [sa.place, sb.place] = [sb.place, sa.place];
            intents.set(a.a, { dur, style: "hop" });
            intents.set(a.b, { dur, style: "hopLow" });
            break;
          }
          case "split": {
            const src = state.get(a.id)!;
            const origin = evalPos(entities.get(a.id)!.pos, T);
            if (src.present) presenceKey(a.id, T, dur * 0.3, 0, "shrink");
            src.present = false;
            // Pieces start side by side where the source tile was, then fly to their slots.
            const widths = a.into.map((id) => widthOf(id, state.get(id)!));
            let x = origin[0] - widths.reduce((s, w) => s + w, 0) / 2;
            a.into.forEach((id, i) => {
              const st = state.get(id)!;
              splitFrom.set(id, { origin: [x + widths[i]! / 2, origin[1], origin[2]], dur });
              x += widths[i]!;
              if (!st.present) presenceKey(id, T, dur * 0.35, 1, "pop");
              st.present = true;
            });
            break;
          }
          case "merge": {
            const into = state.get(a.into)!;
            const widths = a.ids.map((id) => widthOf(id, state.get(id)!));
            let x = -widths.reduce((s, w) => s + w, 0) / 2;
            a.ids.forEach((id, i) => {
              const st = state.get(id)!;
              // Squeeze towards the centre of `into` (at 40% of their side-by-side offsets).
              mergeTo.set(id, { into: a.into, dur: dur * 0.75, dx: 0.4 * (x + widths[i]! / 2) });
              x += widths[i]!;
              if (st.present) presenceKey(id, T + dur * 0.7, dur * 0.3, 0, "shrink");
              st.present = false;
            });
            if (!into.present) presenceKey(a.into, T + dur * 0.65, 0.55, 1, "pop");
            into.present = true;
            break;
          }
          case "morph": {
            const st = state.get(a.id)!;
            const cur = variants.get(a.id)![st.variant]!;
            const v = variantIndex(a.id, a.text, a.sub ?? cur.sub);
            addKey(entities.get(a.id)!.variant, { at: T, dur, to: v, style: "flip" }, lastValue);
            st.variant = v;
            if (a.role !== undefined) {
              st.role = a.role;
              addKey(entities.get(a.id)!.color, { at: T, dur, to: colorOf(a.role), style: "fade" }, lastValue);
            }
            break;
          }
          case "color":
            for (const id of a.ids) {
              state.get(id)!.role = a.role;
              addKey(entities.get(id)!.color, { at: T, dur, to: colorOf(a.role), style: "fade" }, lastValue);
            }
            break;
          case "highlight":
            for (const id of a.ids) entities.get(id)!.glow.push([T, T + dur]);
            break;
          case "bounce":
            for (const id of a.ids) entities.get(id)!.bounce.push([T, T + dur]);
            break;
          case "draw":
          case "trace": {
            // Drawing a hidden plot or moving a hidden tracer shows it.
            const st = state.get(a.id)!;
            if (!st.present) presenceKey(a.id, T, 0.3, 1, "pop");
            st.present = true;
            break;
          }
        }
      }

      const after = resolveAll(state);
      for (const id of movable) {
        const tr = entities.get(id)!.pos;
        const target = after.get(id)!;
        const st = state.get(id)!;
        const split = splitFrom.get(id);
        const merge = mergeTo.get(id);
        const intent = intents.get(id);
        if (split) {
          addKey(tr, { at: T, dur: 0, to: split.origin, style: "set" }, evalPos);
          addKey(tr, { at: T, dur: split.dur, to: target, style: "hop" }, evalPos);
        } else if (merge) {
          const dest = after.get(merge.into)!;
          addKey(tr, { at: T, dur: merge.dur, to: [dest[0] + merge.dx, dest[1], dest[2]], style: "hop" }, evalPos);
        } else if (st.present && !wasPresent.get(id)) {
          addKey(tr, { at: T, dur: 0, to: target, style: "set" }, evalPos);
        } else if (intent) {
          addKey(tr, { at: T, dur: intent.dur, to: target, style: intent.style }, evalPos);
        } else if (st.present && !near(lastTo(tr), target)) {
          addKey(tr, { at: T, dur: SHIFT_DUR, to: target, style: "slide" }, evalPos);
        }
        // Hidden entities keep their last position (they may still be shrinking away there).
      }
      for (const r of data.rows) {
        const rp = rows.get(r.id)!;
        const ext = rowExtent(r.id, state, after);
        const shown = lastTo(rp.presence) > 0;
        if (ext && !shown) {
          addKey(rp.extent, { at: T, dur: 0, to: ext, style: "set" }, extentAt);
          addKey(rp.presence, { at: T, dur: 0.5, to: 1, style: "pop" }, presenceValue);
        } else if (ext) {
          const last = lastTo(rp.extent);
          if (Math.abs(last[0] - ext[0]) + Math.abs(last[1] - ext[1]) > 1e-6)
            addKey(rp.extent, { at: T, dur: SHIFT_DUR, to: ext, style: "slide" }, extentAt);
        } else if (shown) {
          addKey(rp.presence, { at: T + 0.3, dur: 0.4, to: 0, style: "shrink" }, presenceValue);
        }
      }
    }
    return { plan: { entities, rows }, end: state };
  };

  const chapters = new Map<string, ChapterPlan>();
  let prevEnd: State | null = null;
  for (const ch of spec.chapters) {
    const def = data.chapters.find((c) => c.chapter === ch.id);
    const start = (def?.carryOver ?? true) && prevEnd ? prevEnd : baseState();
    const { plan, end } = compileChapter(def?.actions ?? [], start);
    chapters.set(ch.id, plan);
    prevEnd = end;
  }
  return { chapters, variants, empty: compileChapter([], baseState()).plan };
}

export { extentAt as evalExtent };
