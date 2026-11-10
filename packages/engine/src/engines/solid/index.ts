// `solid` engine (Geometria solida): solids on a drawing mat with nets that unfold, figures that
// revolve into solids, sections, liquid poured from one solid into another, element counting
// (Euler), scaling, dimension lines and a formula board with live values; "Prova tu" sliders bind
// to dimensions or to the scale factor k. Schema, units and anchors: packages/scene-spec/src/engines/solid.ts.
//
// update(chapterId, t) is pure given the slider overrides: every channel (unfold, sweep, section,
// level, k, spin, counts) is recomputed from the chapter's acts at t (./acts.ts); geometry is
// rebuilt only when the dimensions change and is otherwise posed.
import * as THREE from "three";
import {
  SOLID_GRIDDED,
  SOLID_POLYHEDRA,
  solidCounts,
  splitDimPart,
  type Anchor,
  type SceneSpec,
  type SolidChapter,
  type SolidData,
  type SolidFormula,
  type SolidItem,
  type SolidShape,
  type SolidShowItem,
} from "@pv/scene-spec";
import { engineText } from "@pv/scene-spec/i18n";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp, ease, seg } from "../../util/math.ts";
import { key, mat, mesh, Panel, setRod, type Label } from "../lab/draw.ts";
import { fillLevel, pourState, solidState, type CountWhat, type SolidState } from "./acts.ts";
import { dimsOf, extentOf, netBox, type Dims } from "./geometry.ts";
import { SolidModel, type ModelRoles } from "./model.ts";
import { boardLines, COUNT_WORD, elementLines } from "./text.ts";

/** Default solid name in the lesson's language (Italian: SOLID_NAMES). */
const solidName = (s: SolidShape): string => engineText(`solid.${s}`);

const PAPER = "#f3f1ea";
const MAT = "#e6ecef";
const MAT_GAP = 0.025;
/** Drawing limits for a chapter row (scene units). */
const FIT = { height: 4.2, width: 11, halfDepth: 5.5 } as const;
const GAP = 1.3;
const PANEL = { y: 1.35, z: -1.2, h: 1.75 } as const;
const BASE_COLORS = ["#4f86c6", "#e07b39", "#4caf7a", "#b05fc4"];
const APEX: readonly string[] = ["cone", "pyramid"];

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

interface Overlay {
  windows: [number, number][];
  formulas?: SolidFormula[];
  compare?: string;
}

interface ChapterView {
  entry: SolidChapter;
  group: THREE.Group;
  models: Map<string, SolidModel>;
  s: number;
  x: Map<string, number>;
  /** Depth offset of each solid (centres its net on the mat). */
  z: Map<string, number>;
  sizes: { w: number; h: number; half: number; zc: number }[];
  /** Tallest solid (scene units) over every slider position. */
  hmax: number;
  shows: Map<string, Overlay>;
  boards: Map<string, Panel>;
  elements: Map<string, Panel>;
  stream: THREE.Mesh;
  states: Map<string, SolidState>;
  levels: Map<string, number>;
}

const showKey = (item: SolidShowItem, id: string) => `${item}:${id}`;
const inWindows = (w: [number, number][] | undefined, t: number) => !!w?.some(([a, b]) => t >= a && t < b);

/** Largest dimensions and scale factor a solid can reach (sliders, scale acts). */
function reach(entry: SolidChapter, item: SolidItem): { d: Dims; k: number } {
  const d = dimsOf(item);
  let k = item.scale ?? 1;
  for (const p of entry.params ?? []) {
    if (!p.solids.includes(item.id)) continue;
    if (p.dim === "k") k = Math.max(k, p.max);
    else d[p.dim] = Math.max(d[p.dim], p.max);
  }
  for (const a of entry.acts ?? []) if (a.do === "scale" && a.solid === item.id) k = Math.max(k, a.k);
  return { d, k };
}

/**
 * Largest footprint of a solid (real units, k applied): width along x, height, half-depth along z
 * around zc, where zc is how far the solid sits from z = 0 so that its net (if any) is centred.
 * The folded solid is sized for every slider position; the net (4× deeper than a cube) only for
 * the scene's own dimensions, so a chapter with an unfold does not shrink its solid for a net
 * opened at an extreme slider value (keep slider ranges close to the scene value there).
 */
function footprint(entry: SolidChapter, item: SolidItem, net: boolean): { w: number; h: number; half: number; zc: number } {
  const { d, k } = reach(entry, item);
  const e = extentOf(item.shape, d, item.sides);
  let hx = e.hx;
  let z0 = -e.hz;
  let z1 = e.hz;
  if (net) {
    const box = netBox(item.shape, dimsOf(item), item.sides);
    hx = Math.max(hx, -box.min.x, box.max.x);
    z0 = Math.min(z0, box.min.z);
    z1 = Math.max(z1, box.max.z);
  }
  return { w: 2 * hx * k, h: e.h * k, half: ((z1 - z0) / 2) * k, zc: (-(z0 + z1) / 2) * k };
}

export function createSolidEngine(): Engine {
  let ctx: EngineContext | null = null;
  let spec: SceneSpec | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let views = new Map<string, ChapterView>();
  let labels: (Label | Panel | { dispose(): void })[] = [];
  let overrides: Record<string, number> | null = null;
  let unit = "cm";
  let last = { chapter: "", t: Number.NaN, key: "" };
  let bound = { center: new THREE.Vector3(), radius: 1 };
  const tmp = new THREE.Vector3();

  function rolesOf(entry: SolidChapter, item: SolidItem): ModelRoles {
    const acts = entry.acts ?? [];
    const mine = acts.filter((a) => a.solid === item.id);
    return {
      container: mine.some((a) => a.do === "fill"),
      pourer: acts.some((a) => a.do === "fill" && a.from === item.id),
      net: mine.some((a) => a.do === "unfold" || a.do === "fold"),
      revolve: mine.some((a) => a.do === "revolve"),
      section: mine.some((a) => a.do === "section"),
      counts: new Set(mine.flatMap((a) => (a.do === "count" ? [a.what] : []))),
    };
  }

  function buildView(entry: SolidChapter): ChapterView {
    const group = new THREE.Group();
    group.name = `chapter:${entry.chapter}`;
    world!.add(group);
    // One drawing scale for the chapter: every solid fits for every slider position.
    const sizes = entry.solids.map((item) => footprint(entry, item, rolesOf(entry, item).net));
    const sumW = sizes.reduce((s, x) => s + x.w, 0);
    const s = Math.min(FIT.height / Math.max(...sizes.map((x) => x.h)), (FIT.width - GAP * (sizes.length - 1)) / sumW, FIT.halfDepth / Math.max(...sizes.map((x) => x.half)));
    const x = new Map<string, number>();
    const z = new Map(entry.solids.map((item, i) => [item.id, sizes[i]!.zc * s] as const));
    let cursor = -(sumW * s + GAP * (sizes.length - 1)) / 2;
    entry.solids.forEach((item, i) => {
      x.set(item.id, cursor + (sizes[i]!.w * s) / 2);
      cursor += sizes[i]!.w * s + GAP;
    });
    const hmax = Math.max(...sizes.map((q) => q.h)) * s;
    const models = new Map<string, SolidModel>();
    entry.solids.forEach((item, i) => {
      const it = item.color ? item : { ...item, color: BASE_COLORS[i % BASE_COLORS.length] };
      const m = new SolidModel(ctx!, it, unit, rolesOf(entry, item), labels);
      m.layout(dimsOf(item), s);
      group.add(m.group, m.overlay);
      models.set(item.id, m);
    });
    // Overlays: windows per (item, solid).
    const shows = new Map<string, Overlay>();
    for (const sh of entry.show ?? []) {
      const ids = sh.solid
        ? [sh.solid]
        : entry.solids
            .filter((it) => (sh.item === "elements" ? SOLID_POLYHEDRA.includes(it.shape) : sh.item === "units" ? SOLID_GRIDDED.includes(it.shape) : true))
            .map((it) => it.id);
      for (const id of ids) {
        const k = showKey(sh.item, id);
        const o = shows.get(k) ?? { windows: [], formulas: sh.formulas, compare: sh.compare };
        o.windows.push([sh.at ?? 0, sh.until ?? Infinity]);
        shows.set(k, o);
      }
    }
    const boards = new Map<string, Panel>();
    const elements = new Map<string, Panel>();
    const slotW = (id: string) => sizes[entry.solids.findIndex((it) => it.id === id)]!.w * s + GAP * 0.8;
    const panel = (id: string, w: number, h: number, y: number) => {
      const p = new Panel(ctx!, w, h, "#fbfaf4", "#1f2a36");
      labels.push(p);
      const g = new THREE.Group();
      g.name = `panel:${id}`;
      p.mesh.position.set(0, 0, 0.045);
      g.add(mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.06), mat("#5b4a3a")), key(p.mesh));
      g.position.set(x.get(id)!, y, PANEL.z);
      group.add(g);
      return p;
    };
    // Boards never overlap: at most the distance to the neighbouring solids.
    const centres = entry.solids.map((it) => x.get(it.id)!);
    for (const [i, it] of entry.solids.entries()) {
      const room = Math.min(...centres.filter((_, j) => j !== i).map((c) => Math.abs(c - centres[i]!) - 0.2), Infinity);
      const w = Math.min(room, clamp(slotW(it.id), 3.4, 5.6));
      let y = hmax + PANEL.y + PANEL.h / 2;
      if (shows.has(showKey("board", it.id))) {
        boards.set(it.id, panel(it.id, w, PANEL.h, y));
        y += PANEL.h + 0.3;
      }
      if (shows.has(showKey("elements", it.id))) elements.set(it.id, panel(it.id, Math.min(w, 4.2), PANEL.h, y));
    }
    const stream = key(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 10), mat("#3d8fe0", { transparent: true, opacity: 0.85 }), "stream"));
    stream.visible = false;
    group.add(stream);
    return { entry, group, models, s, x, z, sizes, hmax, shows, boards, elements, stream, states: new Map(), levels: new Map() };
  }

  // ------------------------------------------------------------ state

  function dimsFor(view: ChapterView, item: SolidItem): { d: Dims; k: number | undefined } {
    const d = dimsOf(item);
    let k: number | undefined;
    if (overrides)
      for (const p of view.entry.params ?? []) {
        const v = overrides[p.id];
        if (v === undefined || !p.solids.includes(item.id)) continue;
        if (p.dim === "k") k = v;
        else d[p.dim] = v;
      }
    return { d, k };
  }

  function pose(view: ChapterView, t: number): void {
    const { entry } = view;
    // Layout and state of every solid.
    for (const item of entry.solids) {
      const m = view.models.get(item.id)!;
      const { d, k } = dimsFor(view, item);
      m.layout(d, view.s);
      const c = solidCounts(item.shape, item.sides);
      view.states.set(item.id, solidState(entry, item, t, c, k));
    }
    const volume = (id: string) => {
      const m = view.models.get(id)!;
      return m.measuresAt(view.states.get(id)!.k).V;
    };
    for (const item of entry.solids) view.levels.set(item.id, fillLevel(entry, item.id, t, (from) => (view.models.has(from) ? volume(from) / volume(item.id) : 0)));
    view.stream.visible = false;
    for (const item of entry.solids) {
      const m = view.models.get(item.id)!;
      const st = view.states.get(item.id)!;
      const pour = pourState(entry, item.id, t);
      const pos = V(view.x.get(item.id)!, 0, view.z.get(item.id)!);
      let rotZ = 0;
      if (pour) {
        const into = view.models.get(pour.into)!;
        const intoSt = view.states.get(pour.into)!;
        const HF = view.s * st.k * m.m.height;
        const HT = view.s * intoSt.k * into.m.height;
        const apex = APEX.includes(item.shape);
        const pivotHome = V(pos.x, HF / 2, pos.z);
        const pivotTop = V(view.x.get(pour.into)!, HT + 0.3 + HF / 2, view.z.get(pour.into)!);
        const pivot = pivotHome.clone().lerp(pivotTop, pour.travel);
        pivot.y += Math.sin(Math.PI * pour.travel) * 1.2;
        rotZ = apex ? 0 : Math.PI * pour.flip;
        pos.set(pivot.x + (HF / 2) * Math.sin(rotZ), pivot.y - (HF / 2) * Math.cos(rotZ), pivot.z);
        if (pour.stream) {
          const mouth = V(pivotTop.x, HT + 0.3, pivotTop.z);
          const surface = Math.max(0, view.levels.get(pour.into)! * HT);
          setRod(view.stream, mouth, V(mouth.x, surface, mouth.z));
          view.stream.visible = true;
        }
      }
      m.pose({
        st,
        level: view.levels.get(item.id)!,
        pour,
        pos,
        rotZ,
        s: view.s,
        dims: inWindows(view.shows.get(showKey("dims", item.id))?.windows, t),
        units: inWindows(view.shows.get(showKey("units", item.id))?.windows, t),
        elements: inWindows(view.shows.get(showKey("elements", item.id))?.windows, t),
      });
      if (st.count) m.counter.set(`${COUNT_WORD[st.count.what]}: ${st.count.lit}`);
      m.top(m.counter.object.position).add(tmp.set(0, 0.7, 0));
    }
    // Panels.
    for (const item of entry.solids) {
      const m = view.models.get(item.id)!;
      const st = view.states.get(item.id)!;
      const board = view.boards.get(item.id);
      if (board) {
        const o = view.shows.get(showKey("board", item.id))!;
        const g = board.mesh.parent!;
        const start = o.windows.find(([a, b]) => t >= a && t < b)?.[0];
        g.visible = start !== undefined;
        g.scale.setScalar(start === undefined ? 1 : 0.85 + 0.15 * ease.inOutQuad(seg(t, start, start + 0.5)));
        const ref = o.compare ? view.models.get(o.compare) : undefined;
        const refSt = o.compare ? view.states.get(o.compare) : undefined;
        board.set(
          boardLines({
            title: item.name ?? solidName(item.shape),
            shape: item.shape,
            sides: item.sides ?? 4,
            formulas: o.formulas ?? ["V", "A"],
            d: m.real(st.k),
            m: m.measuresAt(st.k),
            k: st.k,
            unit,
            ref: ref && refSt ? { name: (ref.item.name ?? solidName(ref.shape)).toLowerCase(), m: ref.measuresAt(refSt.k), k: refSt.k } : undefined,
          }),
        );
      }
      const el = view.elements.get(item.id);
      if (el) {
        const o = view.shows.get(showKey("elements", item.id))!;
        el.mesh.parent!.visible = inWindows(o.windows, t);
        el.set(elementLines(st.known));
      }
    }
  }

  function apply(chapterId: string, t: number): ChapterView | undefined {
    const view = views.get(chapterId);
    for (const [id, w] of views) w.group.visible = id === chapterId;
    if (!view) return undefined;
    last = { chapter: chapterId, t, key: JSON.stringify(overrides) };
    pose(view, t);
    return view;
  }

  function modelOf(view: ChapterView, part: string | undefined): SolidModel | undefined {
    return part === undefined ? view.models.get(view.entry.solids[0]!.id) : view.models.get(part);
  }

  return {
    async build(c, s) {
      if (s.engine !== "solid") throw new Error(`solid engine got a "${s.engine}" scene`);
      ctx = c;
      spec = s;
      const data: SolidData = s.engineData;
      unit = data.unit ?? "cm";
      world = new THREE.Group();
      world.name = "solid";
      c.root.add(world);
      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(data.background ?? PAPER);
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.95 * Math.PI);
      keyLight.position.set(5, 11, 9);
      const rim = new THREE.DirectionalLight(0xe8f0ff, 0.35 * Math.PI);
      rim.position.set(-9, 6, -7);
      lights = [new THREE.HemisphereLight(0xffffff, 0xc9c4b8, 0.8 * Math.PI), keyLight, rim];
      for (const l of lights) c.scene.add(l);
      views = new Map(data.chapters.map((e) => [e.chapter, buildView(e)]));
      // The drawing mat, sized for the widest row and the deepest net.
      let halfX = 3;
      let halfZ = 2.6;
      for (const v of views.values()) {
        v.entry.solids.forEach((item, i) => {
          const f = v.sizes[i]!;
          halfX = Math.max(halfX, Math.abs(v.x.get(item.id)!) + (f.w / 2) * v.s + 0.8);
          halfZ = Math.max(halfZ, (f.half + Math.abs(f.zc)) * v.s + 0.8);
        });
      }
      const matG = new THREE.Group();
      matG.name = "mat";
      // The mat top sits just below y = 0 so flat nets (at y = 0) never z-fight with it.
      matG.add(mesh(new THREE.BoxGeometry(2 * halfX, 0.12, 2 * halfZ).translate(0, -0.06 - MAT_GAP, 0), mat(MAT, { roughness: 0.85 })));
      matG.add(mesh(new THREE.BoxGeometry(2 * halfX + 0.2, 0.08, 2 * halfZ + 0.2).translate(0, -0.1 - MAT_GAP, 0), mat("#9fb3c1")));
      world.add(matG);
      for (const v of views.values()) pose(v, 0);
      world.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(matG);
      for (const v of views.values()) box.expandByPoint(V(0, v.hmax + 0.5, 0));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      bound = { center: sphere.center, radius: Math.max(1, sphere.radius) };
    },

    update(chapterId, t) {
      apply(chapterId, t);
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor)) return false;
      const view = views.get(chapterId);
      if (!view) return false;
      if (last.chapter !== chapterId || last.t !== t || last.key !== JSON.stringify(overrides)) apply(chapterId, t);
      let ok = true;
      if (anchor.entity === "dim") {
        const sp = splitDimPart(anchor.part);
        const m = sp ? view.models.get(sp.solid) : undefined;
        ok = !!m && !!sp && m.dimPoint(sp.dim, out);
      } else {
        const m = modelOf(view, anchor.part);
        if (!m) return false;
        const st = view.states.get(m.item.id)!;
        const i = anchor.index ?? 0;
        const counts = solidCounts(m.shape, m.sides);
        switch (anchor.entity) {
          case "solid":
            m.top(out);
            break;
          case "face":
          case "edge":
          case "vertex": {
            const what = (anchor.entity === "face" ? "faces" : anchor.entity === "edge" ? "edges" : "vertices") as CountWhat;
            ok = i < counts[what];
            if (ok) m.elementPoint(what, i, out);
            break;
          }
          case "section":
            m.sectionPoint(out);
            break;
          case "liquid":
            m.liquidPoint(view.levels.get(m.item.id) ?? 0, out);
            break;
          case "figure":
            m.figurePoint(st.sweep, out);
            break;
          case "net":
            m.netPoint(out);
            break;
          case "board":
          case "elements": {
            const p = (anchor.entity === "board" ? view.boards : view.elements).get(m.item.id);
            ok = !!p;
            // Panels sit in the chapter group, which shares root coordinates.
            if (p) out.copy(p.mesh.parent!.position).add(tmp.set(0, PANEL.h / 2, 0));
            break;
          }
          default:
            ok = false;
        }
      }
      if (ok && anchor.offset) out.add(tmp.set(...anchor.offset));
      return ok;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    params(chapterId): EngineParam[] {
      const view = views.get(chapterId);
      const ids = spec?.chapters.find((c) => c.id === chapterId)?.activity?.test.params ?? [];
      if (!view) return [];
      return ids.flatMap((id) => {
        const p = view.entry.params?.find((q) => q.id === id);
        if (!p) return [];
        const item = view.entry.solids.find((it) => it.id === p.solids[0])!;
        const base = p.dim === "k" ? (item.scale ?? 1) : (item.dims[p.dim] ?? p.min);
        return [{ id, label: p.label, min: p.min, max: p.max, step: p.step ?? (p.max - p.min) / 100, value: overrides?.[id] ?? base }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      const defs = new Map([...views.values()].flatMap((v) => (v.entry.params ?? []).map((p) => [p.id, p] as const)));
      overrides = {};
      for (const [id, x] of Object.entries(values)) {
        const p = defs.get(id);
        if (p && Number.isFinite(x)) overrides[id] = clamp(x, p.min, p.max);
      }
    },

    dispose() {
      if (!ctx || !world) return;
      for (const v of views.values()) for (const m of v.models.values()) m.dispose();
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
      });
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const l of labels) l.dispose();
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      spec = null;
      world = null;
      lights = [];
      labels = [];
      views = new Map();
      overrides = null;
    },
  };
}
