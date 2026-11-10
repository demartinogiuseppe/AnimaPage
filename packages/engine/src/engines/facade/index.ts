// `facade` engine (Facciate): building facades drawn with lines only. The grammar and its checks live
// in packages/scene-spec/src/engines/facade.ts, the drawing kit in ink.ts / profiles.ts, the assembly
// in model.ts. This file stages the buildings: one scale for the whole lesson, one building visible
// per chapter, anchors on the façade.
import * as THREE from "three";
import { FACADE_VIEWS, type Anchor, type FacadeBuilding, type FacadeChapter, type SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext, EngineParam, EngineView } from "../../types.ts";
import { rotundaDims } from "@pv/scene-spec";
import { engineText } from "@pv/scene-spec/i18n";
import { seg } from "../../util/math.ts";
import { facadeStateAt, type FacadeState } from "./acts.ts";
import { FacadeInk } from "./ink.ts";
import { buildModel, cellCentre, facadeLayout, type FacadeLayout, type FacadeModel } from "./model.ts";
import { createOverlays, type Overlays } from "./overlays.ts";
import { blendViews, resolveKeys, viewOf, type Eye, type FacadeFrame } from "./views.ts";

/** Scene units the largest building (its width or height) is fitted to. */
export const FACADE_FIT = 6;

/** What the acts touch in one part: its line sets (with the material they normally wear) and its paper and hull meshes. */
interface PartNodes {
  lines: Array<{ o: THREE.LineSegments; base: THREE.Material; total: number }>;
  /** `fade` is made the first time the part fades in: a copy of the shared material with its own alpha. */
  meshes: Array<{ o: THREE.Mesh; kind: "paper" | "hull"; fade: THREE.ShaderMaterial | null }>;
}

interface Staged {
  building: FacadeBuilding;
  model: FacadeModel;
  layout: FacadeLayout;
  /** Real bounds in root units (what the views frame). */
  frame: FacadeFrame;
  overlays: Overlays;
  /** Default cut bay: the middle bay of the ground floor. */
  cutX: number;
  nodes: Map<string, PartNodes>;
}

/** Default distance of the perspective eye: 1.2 building widths from the façade (height: EYE_HEIGHT, on the axis). */
const EYE_DISTANCE = 1.2;
/** Lowest eye the slider offers, metres. */
const EYE_MIN = 0.5;
/**
 * Plan view only: a depth bias on back faces, `PLAN_LIFT` metres towards the eye along the view ray, so that looking down on the
 * cut the underside of a cut solid wins over the top of what it rests on (see PAPER_SOLID_VS). The cut test itself uses the
 * unmoved position. It must exceed SINK (how far a wall sinks into its plinth) and stay under GROUND_SLAB (the thinnest slab);
 * facade-rotunda.test.ts pins both. It fades in with the weight of the pianta.
 */
export const PLAN_LIFT = 0.15;
/** A part is fully drawn at the end of its act; its paper and hull fade in over the last 30 %. */
const FADE_FROM = 0.7;

type SizedRenderer = Pick<THREE.WebGLRenderer, "getDrawingBufferSize" | "getPixelRatio">;

/** The ground is y = 0, so the frame runs from there to the highest point (a crown can rise above buildingSize). */
function frameOf(box: THREE.Box3): FacadeFrame {
  const size = box.getSize(new THREE.Vector3());
  return { center: new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y / 2, (box.min.z + box.max.z) / 2), width: size.x, height: box.max.y, depth: size.z, front: box.max.z };
}

/** Finds what the acts move in each part of a model (the building group itself holds only parts). */
function partNodes(model: FacadeModel, ink: FacadeInk): Map<string, PartNodes> {
  const nodes = new Map<string, PartNodes>();
  for (const [id, g] of model.parts) {
    if (g === model.group) continue;
    const n: PartNodes = { lines: [], meshes: [] };
    for (const o of g.children) {
      if (o instanceof THREE.LineSegments) n.lines.push({ o, base: o.material as THREE.Material, total: o.geometry.getAttribute("position").count });
      else if (o instanceof THREE.Mesh) n.meshes.push({ o, kind: o.material === ink.hull ? "hull" : "paper", fade: null });
    }
    nodes.set(id, n);
  }
  return nodes;
}

export function createFacadeEngine(): Engine {
  let ink: FacadeInk | null = null;
  let scale = 1;
  let bound = { center: new THREE.Vector3(), radius: 1 };
  const staged = new Map<string, Staged>();
  const chapterBuilding = new Map<string, string>();
  const chapterData = new Map<string, FacadeChapter>();
  /** The sliders the chapter's activity offers, in its order. */
  const chapterParams = new Map<string, string[]>();
  /** User sliders in metres ("eye-height", "eye-x"); null = the scene's own eye. */
  let overrides: Record<string, number> | null = null;
  /** Last time each chapter was shown: what the sliders start from. Not scene state, only the UI's starting value. */
  const lastT = new Map<string, number>();

  /**
   * The hull's line width is in screen pixels, so it needs the drawing-buffer size. The Engine interface
   * has no renderer, but three.js hands it to `onBeforeRender` of every mesh it draws: the hull meshes
   * keep the shared ink in step with whatever renderer shows them (and a resize or pixel-ratio change).
   */
  const follow = (hull: THREE.Mesh, shared: FacadeInk): void => {
    const size = new THREE.Vector2();
    let w = 0;
    let h = 0;
    let pr = 0;
    hull.onBeforeRender = (renderer: SizedRenderer) => {
      renderer.getDrawingBufferSize(size);
      const ratio = renderer.getPixelRatio();
      if (size.x === w && size.y === h && ratio === pr) return;
      w = size.x;
      h = size.y;
      pr = ratio;
      shared.setResolution(w, h, pr);
    };
  };

  const disposeStaged = (s: Staged): void => {
    s.overlays.dispose();
    s.model.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    s.model.group.removeFromParent();
  };

  const show = (chapterId: string): void => {
    const id = chapterBuilding.get(chapterId);
    for (const [bid, s] of staged) s.model.group.visible = bid === id;
  };

  const find = (chapterId: string): Staged | undefined => {
    const id = chapterBuilding.get(chapterId);
    return id === undefined ? undefined : staged.get(id);
  };

  /** The user's sliders as far as this chapter offers them (a host may leave them set across chapters); null = none apply. */
  const overridesFor = (chapterId: string): Record<string, number> | null => {
    if (!overrides) return null;
    const own: Record<string, number> = {};
    let any = false;
    for (const id of chapterParams.get(chapterId) ?? []) {
      const v = overrides[id];
      if (v !== undefined) {
        own[id] = v;
        any = true;
      }
    }
    return any ? own : null;
  };

  const stateAt = (chapterId: string, s: Staged, t: number): FacadeState => facadeStateAt(chapterData.get(chapterId)!, s.building, t, overridesFor(chapterId));

  /** The eye of a chapter's perspective at t, metres: the chapter's own (moved by its eye acts) or the user's sliders. */
  const eyeOf = (chapterId: string, s: Staged, t: number): Eye => {
    const e = stateAt(chapterId, s, t).eye;
    return { height: e.height, x: e.x, distance: chapterData.get(chapterId)?.eye?.distance ?? EYE_DISTANCE * s.layout.size.width };
  };

  /** While a slider of this chapter is set the student is looking in perspective, whatever the view keys say. */
  const sliding = (chapterId: string): boolean => overridesFor(chapterId) !== null;

  /** Height of the plan cut, building-local metres: the chapter's `plan`, else one metre above the base; never above the building. */
  const planOf = (chapterId: string, s: Staged): number => Math.min(s.layout.size.height, chapterData.get(chapterId)?.plan ?? s.layout.baseHeight + 1);

  /** x just outside the whole building (the rotunda's cornice too): a vertical cut there takes nothing away. */
  const edgeOf = (s: Staged): number => {
    const r = s.building.rotunda;
    return Math.max(s.layout.size.width / 2, r ? rotundaDims(r).outer + 0.02 * r.diameter : 0) + 1;
  };

  /**
   * The section plane (building-local x) from the chapter's cut acts: it slides from the previous cut's bay (or
   * the building's edge) to the bay of the latest started cut over its duration. `target` is the bay it heads for
   * (the sezione camera looks there). Without a cut act the plane stands at the default bay.
   */
  const cutPlane = (st: FacadeState, s: Staged): { x: number; target: number } => {
    const bayX = (id: string): number | undefined => s.layout.floors.flatMap((f) => f.bays).find((b) => b.id === id)?.cx;
    if (!st.cut) return { x: s.cutX, target: s.cutX };
    const target = bayX(st.cut.bay) ?? s.cutX;
    const from = (st.cut.from === null ? undefined : bayX(st.cut.from)) ?? edgeOf(s);
    return { x: from + (target - from) * st.cut.p, target };
  };

  /** Puts the acts' state on the model: line tracing, fade-in of paper and hull, red highlight. Writes in place, creates nothing per frame. */
  const apply = (s: Staged, st: FacadeState, shared: FacadeInk): void => {
    for (const [id, n] of s.nodes) {
      const p = st.drawn.get(id) ?? 1;
      const red = st.highlighted.has(id);
      const alpha = seg(p, FADE_FROM, 1);
      for (const l of n.lines) {
        l.o.material = red ? shared.overlay : l.base;
        l.o.visible = p > 0;
        l.o.geometry.setDrawRange(0, p >= 1 ? Infinity : Math.min(l.total, Math.ceil((p * l.total) / 2) * 2));
      }
      for (const m of n.meshes) {
        m.o.visible = alpha > 0;
        if (alpha >= 1) {
          m.o.material = shared[m.kind];
        } else {
          m.fade ??= shared.fader(m.kind);
          m.fade.uniforms.uAlpha!.value = alpha;
          m.o.material = m.fade;
        }
      }
    }
  };

  /** Weight of each view (FACADE_VIEWS order) at (chapter, t); all zero in a chapter without view keys. */
  const viewWeights = (chapterId: string, t: number): number[] => {
    if (sliding(chapterId)) return FACADE_VIEWS.map((v) => (v === "prospettiva" ? 1 : 0));
    const keys = chapterData.get(chapterId)?.views;
    if (!keys?.length) return FACADE_VIEWS.map(() => 0);
    const one = (name: string): number[] => FACADE_VIEWS.map((v) => (v === name ? 1 : 0));
    return resolveKeys(keys, t, one, (a, b, p) => a.map((x, i) => x + (b[i]! - x) * p));
  };

  return {
    async build(c: EngineContext, spec: SceneSpec) {
      if (spec.engine !== "facade") throw new Error("facade engine needs a facade scene");
      ink = new FacadeInk();
      for (const ch of spec.engineData.chapters) {
        chapterBuilding.set(ch.chapter, ch.building);
        chapterData.set(ch.chapter, ch);
      }
      for (const ch of spec.chapters) chapterParams.set(ch.id, ch.activity?.test.params ?? []);
      for (const b of spec.engineData.buildings) {
        // The checker rejects duplicate building ids; if one gets through, the first is released, not leaked.
        const old = staged.get(b.id);
        if (old) disposeStaged(old);
        const model = buildModel(b, ink);
        const layout = facadeLayout(b);
        const ground = layout.floors[0]!.bays;
        const cutX = ground[Math.floor(ground.length / 2)]!.cx;
        staged.set(b.id, { building: b, model, layout, frame: { center: new THREE.Vector3(), width: 1, height: 1, depth: 1, front: 0 }, overlays: createOverlays(layout, cutX), cutX, nodes: partNodes(model, ink) });
      }
      // One scale for the lesson, so buildings keep their proportions from chapter to chapter.
      let largest = 0;
      for (const s of staged.values()) largest = Math.max(largest, s.model.size.width, s.model.size.height);
      scale = largest > 0 ? FACADE_FIT / largest : 1;
      for (const s of staged.values()) {
        s.model.group.scale.setScalar(scale);
        s.model.group.visible = false;
        s.overlays.group.scale.setScalar(scale);
        s.overlays.group.visible = false;
        s.model.group.updateMatrixWorld(true);
        s.frame = frameOf(new THREE.Box3().setFromObject(s.model.group));
        s.model.group.traverse((o) => {
          if (o instanceof THREE.Mesh && o.material === ink!.hull) follow(o, ink!);
        });
        c.root.add(s.model.group, s.overlays.group);
      }
      // Every building and its whole depth (rotunda included): the camera range and the AR scale follow this sphere.
      if (staged.size) {
        const all = new THREE.Box3();
        for (const s of staged.values()) all.union(new THREE.Box3().setFromObject(s.model.group));
        const sphere = all.getBoundingSphere(new THREE.Sphere());
        bound = { center: sphere.center, radius: Math.max(0.5, sphere.radius) };
      }
      const first = spec.chapters[0];
      if (first) show(first.id);
    },

    update(chapterId: string, t: number) {
      show(chapterId);
      lastT.set(chapterId, t);
      const s = find(chapterId);
      const w = viewWeights(chapterId, t);
      const weight = (name: (typeof FACADE_VIEWS)[number]) => w[FACADE_VIEWS.indexOf(name)]!;
      for (const o of staged.values()) o.overlays.group.visible = o === s;
      if (!s || !ink) return;
      const st = stateAt(chapterId, s, t);
      apply(s, st, ink);
      const cut = cutPlane(st, s).x;
      // The cut slides in from the building's right edge to the bay as the sezione takes over.
      const cutW = weight("sezione");
      const planW = weight("pianta");
      const edge = edgeOf(s);
      ink.setLift(PLAN_LIFT * planW);
      // Between a sezione and a pianta the vertical cut slides out first (its weight less the plan's), and only then the plan's
      // cut comes down: at the middle of the blend both stand outside the building, so the cut never jumps.
      const sideW = Math.max(0, cutW - planW);
      const downW = Math.max(0, planW - cutW);
      if (downW > 0.001) {
        // The plan's cut comes down from just above the building to the plan height; what is above it (y > plan) is discarded.
        const plan = planOf(chapterId, s);
        const above = s.layout.size.height + 1;
        ink.setSection(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(downW >= 1 ? plan : above + (plan - above) * downW)));
      } else ink.setSection(sideW > 0.001 ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -(edge + (cut - edge) * sideW)) : null);
      const hasCut = chapterData.get(chapterId)?.acts?.some((a) => a.do === "cut") ?? false;
      const e = eyeOf(chapterId, s, t);
      s.overlays.set({ height: e.height, x: e.x }, { perspective: weight("prospettiva"), sectionLine: hasCut ? weight("prospetto") : 0, levels: weight("sezione"), plan: weight("pianta") }, cutPlane(st, s).target);
    },

    view(chapterId: string, t: number, aspect: number): EngineView | null {
      const s = find(chapterId);
      const keys = chapterData.get(chapterId)?.views;
      const slid = sliding(chapterId);
      if (!s || (!keys?.length && !slid)) return null;
      const e = eyeOf(chapterId, s, t);
      const eye: Eye = { height: e.height * scale, x: e.x * scale, distance: e.distance * scale };
      if (slid) return viewOf("prospettiva", s.frame, eye, aspect, 0);
      const cutX = cutPlane(stateAt(chapterId, s, t), s).target * scale;
      const planY = planOf(chapterId, s) * scale;
      return resolveKeys(keys!, t, (name) => viewOf(name, s.frame, eye, aspect, cutX, planY), blendViews);
    },

    resolveAnchor(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor)) return false;
      const s = find(chapterId);
      if (!s) return false;
      const { layout } = s;
      switch (anchor.entity) {
        case "vanishing-point":
        case "horizon": {
          // One-point perspective: a single vanishing point, on the view axis at eye height.
          if (anchor.index) return false;
          const e = eyeOf(chapterId, s, t);
          out.set(anchor.entity === "horizon" ? 0 : e.x, e.height, layout.front);
          break;
        }
        case "rotunda":
        case "dome":
        case "oculus": {
          const rf = layout.rotunda;
          if (!rf) return false;
          out.set(0, anchor.entity === "rotunda" ? rf.wallTop : rf.crown, rf.zc);
          break;
        }
        case "building":
          if (anchor.part !== undefined && anchor.part !== s.building.id) return false;
          out.set(0, layout.size.height, layout.front);
          break;
        case "floor": {
          const f = layout.floors.find((x) => x.id === anchor.part);
          if (!f) return false;
          out.set(0, (f.y0 + f.y1) / 2, f.front);
          break;
        }
        case "bay": {
          for (const f of layout.floors) {
            const bay = f.bays.find((x) => x.id === anchor.part);
            if (bay) {
              out.set(bay.cx, f.y0 + cellCentre(bay.cell, f.floor.height), bay.forward);
              break;
            }
          }
          if (!layout.floors.some((f) => f.bays.some((x) => x.id === anchor.part))) return false;
          break;
        }
        case "member": {
          const f = layout.floors.find((x) => x.id === anchor.part);
          const site = f?.sites[anchor.index ?? 0];
          if (!f || !site) return false;
          out.set(site.x, f.y1 - f.band, f.floor.colonnade ? f.floor.colonnade.depth : 0.12);
          break;
        }
        default:
          return false;
      }
      out.multiplyScalar(scale);
      if (anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
      return true;
    },

    anchorShown(anchor: Anchor, chapterId: string, t: number): boolean {
      const s = find(chapterId);
      if (!s || !("entity" in anchor)) return true;
      const id = anchor.entity === "member" ? `${anchor.part}.members` : anchor.entity === "floor" || anchor.entity === "bay" ? anchor.part : anchor.entity === "rotunda" ? "rotunda" : anchor.entity === "dome" || anchor.entity === "oculus" ? "dome" : undefined;
      return id === undefined || (stateAt(chapterId, s, t).drawn.get(id) ?? 1) >= 1;
    },

    params(chapterId: string): EngineParam[] {
      const s = find(chapterId);
      if (!s) return [];
      const { width, height } = s.layout.size;
      const e = stateAt(chapterId, s, lastT.get(chapterId) ?? 0).eye;
      const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
      const all: EngineParam[] = [
        { id: "eye-height", label: engineText("facade.eyeHeight"), min: EYE_MIN, max: height, step: 0.1, value: clamp(e.height, EYE_MIN, height) },
        { id: "eye-x", label: engineText("facade.eyeX"), min: -width / 2, max: width / 2, step: 0.1, value: clamp(e.x, -width / 2, width / 2) },
      ];
      return (chapterParams.get(chapterId) ?? []).flatMap((id) => all.filter((p) => p.id === id));
    },

    setParams(values) {
      overrides = null;
      if (!values) return;
      for (const id of ["eye-height", "eye-x"]) {
        const v = values[id];
        if (v !== undefined && Number.isFinite(v)) (overrides ??= {})[id] = v;
      }
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    dispose() {
      for (const s of staged.values()) disposeStaged(s);
      staged.clear();
      chapterBuilding.clear();
      chapterData.clear();
      chapterParams.clear();
      lastT.clear();
      overrides = null;
      ink?.dispose();
      ink = null;
    },
  };
}
