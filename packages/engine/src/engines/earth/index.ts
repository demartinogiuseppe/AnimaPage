// `earth` engine (Terra in sezione): the globe cut like a fruit (layers, depth probe, seismic rays
// and shadow zones) and a landscape block-diagram (plate boundaries, volcano, fault and wave fronts,
// water cycle, strata). Schema, units and anchors: packages/scene-spec/src/engines/earth.ts.
//
// update(chapterId, t) is pure given the slider overrides: every moving thing is a closed-form
// function of t (keyed values, latest quake/eruption start, conveyor offsets modulo a period) and
// randomness is seeded at build time.
import * as THREE from "three";
import type { Anchor, EarthChapter, EarthVar, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp } from "../../util/math.ts";
import { buildBlock, DEP, HW, HZ, SKY, type BlockObj } from "./block.ts";
import { buildGlobe, GLOBE_R, type GlobeObj } from "./globe.ts";

const PAPER = "#f4efe6";
/** Side-by-side layout when a scene uses both drawings. */
const BLOCK_X = -9.5;
const GLOBE_X = 8;

export function createEarthEngine(): Engine {
  let ctx: EngineContext | null = null;
  let spec: SceneSpec | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let entries = new Map<string, EarthChapter>();
  let globe: GlobeObj | null = null;
  let blocks = new Map<string, BlockObj>();
  let overrides: Record<string, number> | null = null;
  let bound = { center: new THREE.Vector3(), radius: 1 };
  /** Last update time per chapter, for params() ("value the scene would use now"). */
  const lastT = new Map<string, number>();

  /** Slider overrides of a chapter by variable. */
  function varsOf(chapterId: string): Partial<Record<EarthVar, number>> {
    const out: Partial<Record<EarthVar, number>> = {};
    if (!overrides) return out;
    for (const p of entries.get(chapterId)?.params ?? []) if (overrides[p.id] !== undefined) out[p.var] = overrides[p.id];
    return out;
  }

  return {
    async build(c, s: SceneSpec) {
      if (s.engine !== "earth") throw new Error(`earth engine got a "${s.engine}" scene`);
      ctx = c;
      spec = s;
      const data = s.engineData;
      entries = new Map(data.chapters.map((e) => [e.chapter, e]));
      world = new THREE.Group();
      world.name = "earth";
      c.root.add(world);

      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(data.background ?? PAPER);
      const key = new THREE.DirectionalLight(0xffffff, 0.95 * Math.PI);
      key.position.set(8, 14, 16);
      const rim = new THREE.DirectionalLight(0xffe8d0, 0.35 * Math.PI);
      rim.position.set(-12, 5, -10);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.75 * Math.PI), key, rim];
      for (const l of lights) c.scene.add(l);

      const usesGlobe = !!data.globe && data.chapters.some((e) => e.globe);
      const usesBlock = data.chapters.some((e) => e.block);
      const both = usesGlobe && usesBlock;
      const box = new THREE.Box3();
      if (usesGlobe) {
        globe = buildGlobe(c, data.globe!, data.chapters);
        globe.group.position.x = both ? GLOBE_X : 0;
        world.add(globe.group);
        const x = globe.group.position.x;
        box.expandByPoint(new THREE.Vector3(x - GLOBE_R * 1.15, -GLOBE_R * 1.15, -GLOBE_R)).expandByPoint(new THREE.Vector3(x + GLOBE_R * 1.15, GLOBE_R + 2, GLOBE_R));
      }
      for (const e of data.chapters) {
        if (!e.block) continue;
        const b = buildBlock(c, e.block);
        b.group.name = `block:${e.chapter}`;
        b.group.position.x = both ? BLOCK_X : 0;
        b.group.visible = false;
        world.add(b.group);
        blocks.set(e.chapter, b);
      }
      if (usesBlock) {
        const x = both ? BLOCK_X : 0;
        box.expandByPoint(new THREE.Vector3(x - HW, -DEP, -HZ)).expandByPoint(new THREE.Vector3(x + HW, SKY + 1, HZ));
      }
      if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      bound = { center: sphere.center, radius: Math.max(1, sphere.radius) };
    },

    update(chapterId, t) {
      lastT.set(chapterId, t);
      const e = entries.get(chapterId);
      const v = varsOf(chapterId);
      for (const [id, b] of blocks) {
        if (id !== chapterId) b.group.visible = false;
        else b.update(t, { speed: v.speed, time: v.time, magnitude: v.magnitude });
      }
      if (globe) {
        if (e?.globe) globe.update(e, t, v.depth ?? null);
        else globe.group.visible = false;
      }
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || anchor.part === undefined) return false;
      const e = entries.get(chapterId);
      if (!e) return false;
      let ok = false;
      if (anchor.entity === "globe" && globe) ok = globe.anchor(anchor.part, anchor.index, e, t, varsOf(chapterId).depth ?? null, out);
      else if (anchor.entity === "block") ok = blocks.get(chapterId)?.anchor(anchor.part, anchor.index, t, out) ?? false;
      if (ok && anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
      return ok;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    params(chapterId): EngineParam[] {
      const e = entries.get(chapterId);
      const ids = spec?.chapters.find((c) => c.id === chapterId)?.activity?.test.params ?? [];
      if (!e) return [];
      const t = lastT.get(chapterId) ?? 0;
      const scene = blocks.get(chapterId)?.values(t) ?? {};
      return ids.flatMap((id) => {
        const p = e.params?.find((q) => q.id === id);
        if (!p) return [];
        const own = p.var === "depth" ? (globe?.probeDepth(e, t) ?? undefined) : scene[p.var];
        const value = clamp(overrides?.[id] ?? own ?? p.min, p.min, p.max);
        return [{ id, label: p.label, min: p.min, max: p.max, step: p.step ?? (p.max - p.min) / 100, value }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      const defs = new Map([...entries.values()].flatMap((e) => (e.params ?? []).map((p) => [p.id, p] as const)));
      overrides = {};
      for (const [id, x] of Object.entries(values)) {
        const p = defs.get(id);
        if (p && Number.isFinite(x)) overrides[id] = clamp(x, p.min, p.max);
      }
    },

    dispose() {
      if (!ctx || !world) return;
      globe?.dispose();
      for (const b of blocks.values()) b.dispose();
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      spec = null;
      world = null;
      lights = [];
      globe = null;
      blocks = new Map();
      entries = new Map();
      overrides = null;
      lastT.clear();
    },
  };
}
