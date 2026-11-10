// `workshop` engine (Officina, decision D19): any scene built from basic parts and helpers,
// animated by keyframes or safe formulas in t and the slider params. Schema, units and anchors:
// packages/scene-spec/src/engines/workshop.ts.
//
// update(chapterId, t) is pure given the slider overrides: every part is reset to its base state
// and the chapter's tracks are evaluated at t; spins and particle travel are integrals over [0, t]
// on a fixed grid (anim.ts), never accumulated between frames.
import * as THREE from "three";
import { dioramaModel, type Anchor, type SceneSpec, type WorkshopData, type WorkshopItem, type WorkshopPart } from "@pv/scene-spec";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp } from "../../util/math.ts";
import { instantiate, loadModels } from "../diorama/models.ts";
import { buildPlaceholder } from "../diorama/shapes.ts";
import { presence, windows } from "../process/motion.ts";
import { compileTrack, integrate, paramValues, type Compiled, type Value } from "./anim.ts";
import { buildPart, defaultAxis, type Built } from "./shapes.ts";

const PAPER = "#f4efe6";
const GLOW = new THREE.Color("#ffb347");
const DEG = Math.PI / 180;
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

interface PartObj {
  spec: WorkshopPart;
  node: THREE.Group;
  built: Built;
  parent: PartObj | null;
  basePos: THREE.Vector3;
  baseRot: THREE.Euler;
  baseScale: number;
  baseColor: THREE.Color;
  axis: THREE.Vector3;
  /** Set in update(): presence and glow (inherited by children), current level and particle travel. */
  eff: number;
  glow: number;
  level: number;
  travel: number;
}

interface ChapterPlan {
  items: Map<string, WorkshopItem>;
  tracks: Compiled[];
}

const vec = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

export function createWorkshopEngine(): Engine {
  let ctx: EngineContext | null = null;
  let spec: SceneSpec | null = null;
  let data: WorkshopData | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let parts: PartObj[] = [];
  let byId = new Map<string, PartObj>();
  let plans = new Map<string, ChapterPlan>();
  let overrides: Record<string, number> | null = null;
  let bound = { center: new THREE.Vector3(), radius: 1 };
  const tmp = new THREE.Vector3();
  const color = new THREE.Color();
  const mtx = new THREE.Matrix4();

  /** Part-local point -> world-group coordinates with the current transforms. */
  const toWorld = (o: THREE.Object3D, out: THREE.Vector3) => {
    for (let n: THREE.Object3D | null = o; n && n !== world; n = n.parent) {
      n.updateMatrix();
      out.applyMatrix4(n.matrix);
    }
    return out;
  };

  async function buildModels(c: EngineContext, list: WorkshopPart[]) {
    const files = list.flatMap((p) => dioramaModel(p.model!)?.file ?? []);
    const loaded = await loadModels(files, c.loadAsset, !!c.createCanvas);
    for (const p of list) {
      const o = byId.get(p.id)!;
      const entry = dioramaModel(p.model!)!;
      const model = entry.file ? loaded.get(entry.file) : null;
      const h = p.height!;
      if (model) {
        const inst = instantiate(model, h, p.color);
        o.built.object.add(inst.obj);
        o.built.mats.push(...inst.mats.filter((m): m is THREE.MeshStandardMaterial => "emissive" in m).map((m) => ({ m, opacity: m.opacity })));
      } else {
        const k = h / entry.size[1];
        const ph = buildPlaceholder(entry.size.map((v) => v * k) as [number, number, number]);
        o.built.object.add(ph.obj);
        o.built.mats.push(...ph.mats.map((m) => ({ m: m as THREE.MeshStandardMaterial, opacity: (m as THREE.Material).opacity })));
      }
      o.built.anchor.set(0, h, 0);
    }
  }

  function computeBounds() {
    world!.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const p of parts) if (!p.parent) box.expandByObject(p.node);
    for (const p of parts) if (p.built.particles) for (const pt of p.built.particles.path.pts) box.expandByPoint(toWorld(p.node, pt.clone()));
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    bound = { center: sphere.center, radius: Math.max(sphere.radius, 0.5) };
  }

  function apply(p: PartObj, prop: Compiled["prop"], v: Value) {
    const n = p.node;
    const num = typeof v === "number" ? v : 0;
    switch (prop) {
      case "pos":
        if (Array.isArray(v)) n.position.set(...v);
        break;
      case "rot":
        if (Array.isArray(v)) n.rotation.set(v[0] * DEG, v[1] * DEG, v[2] * DEG);
        break;
      case "scale":
        if (Array.isArray(v)) n.scale.set(...v);
        else n.scale.setScalar(num);
        break;
      case "x":
      case "y":
      case "z":
        n.position[prop] = num;
        break;
      case "rx":
      case "ry":
      case "rz":
        n.rotation[prop[1] as "x" | "y" | "z"] = num * DEG;
        break;
      case "sx":
      case "sy":
      case "sz":
        n.scale[prop[1] as "x" | "y" | "z"] = num;
        break;
      case "size":
        n.scale.setScalar(num);
        break;
      case "opacity":
        p.eff *= clamp(num);
        break;
      case "level":
        p.level = clamp(num);
        break;
      case "visible":
        if (num <= 0.5) p.eff = 0;
        break;
      case "color":
        if (typeof v === "string") p.built.main.color.set(v);
        break;
    }
  }

  function updateParts(plan: ChapterPlan, t: number) {
    const vars = paramValues(data!.params, overrides);
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.8);
    const byPart = new Map<string, Compiled[]>();
    for (const tr of plan.tracks) byPart.set(tr.part, [...(byPart.get(tr.part) ?? []), tr]);
    for (const p of parts) {
      const it = plan.items.get(p.spec.id);
      const own = it ? presence(t, it.at, it.until) : p.parent ? 1 : 0;
      p.eff = own * (p.parent ? p.parent.eff : 1);
      p.glow = Math.max(windows(t, it?.glow), p.parent?.glow ?? 0);
      const n = p.node;
      n.position.copy(p.basePos);
      n.rotation.copy(p.baseRot);
      n.scale.setScalar(p.baseScale);
      p.built.main.color.copy(p.baseColor);
      p.level = p.spec.level ?? 0;
      // Appear: fly in from `from`, or a small pop.
      if (it?.at !== undefined) {
        const shown = clamp((t - it.at) / 0.8);
        const e = shown < 0.5 ? 2 * shown * shown : 1 - (-2 * shown + 2) ** 2 / 2;
        if (it.from) n.position.addScaledVector(vec(it.from), 1 - e);
        else n.scale.multiplyScalar(0.85 + 0.15 * e);
      }
      let spinTrack: Compiled | undefined;
      let speedTrack: Compiled | undefined;
      for (const tr of byPart.get(p.spec.id) ?? []) {
        if (tr.prop === "spin") spinTrack = tr;
        else if (tr.prop === "speed") speedTrack = tr;
        else {
          const v = tr.value(t, vars);
          if (v !== null) apply(p, tr.prop, v);
        }
      }
      const spin = spinTrack
        ? integrate((x) => spinTrack!.value(x, vars) as number | null, p.spec.spin ?? 0, t)
        : (p.spec.spin ?? 0) * t;
      if (spin) n.rotateOnAxis(p.axis, spin * Math.PI * 2);
      if (p.built.particles) {
        p.travel = speedTrack ? integrate((x) => speedTrack!.value(x, vars) as number | null, p.spec.speed ?? 0, t) : (p.spec.speed ?? 0) * t;
      }
    }
    // Presence of children follows the parent's final presence (opacity/visible tracks included).
    for (const p of parts) {
      if (p.parent && !plan.items.has(p.spec.id)) p.eff = Math.min(p.eff, p.parent.eff);
      p.node.visible = p.eff > 0.001;
      p.node.userData.key = !!p.spec.key || p.glow > 0.05;
      const k = p.glow * (0.16 + 0.2 * pulse);
      for (const { m, opacity } of p.built.mats) {
        m.opacity = opacity * p.eff;
        // Materials transparent by nature (glass, canvas text) stay so; opaque ones only while fading.
        const transparent = m.userData.ownTransparent === true || opacity < 0.999 || p.eff < 0.999;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        if ("emissive" in m) m.emissive.copy(GLOW).multiplyScalar(k);
      }
      const liq = p.built.liquid;
      if (liq) {
        liq.column.scale.y = Math.max(p.level * liq.height, 1e-3);
        liq.column.visible = p.level > 0.001;
        p.built.anchor.set(0, p.level * liq.height, 0);
      }
      const pt = p.built.particles;
      if (pt && p.node.visible) {
        const count = pt.mesh.count;
        const len = pt.path.length;
        for (let i = 0; i < count; i++) {
          const d = (((p.travel + (i * len) / count) % len) + len) % len;
          pt.path.at(d, tmp);
          mtx.makeScale(pt.size, pt.size, pt.size).setPosition(tmp);
          pt.mesh.setMatrixAt(i, mtx);
        }
        pt.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // Lines that follow a part: last point = the part's anchor, in the line's frame (after all transforms).
    for (const p of parts) {
      const target = p.spec.follow ? byId.get(p.spec.follow) : undefined;
      if (!target || !p.node.visible) continue;
      const line = p.built.object as THREE.Line;
      const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      toWorld(target.node, tmp.copy(target.built.anchor));
      world!.updateWorldMatrix(true, false);
      line.updateWorldMatrix(true, false);
      line.worldToLocal(world!.localToWorld(tmp));
      attr.setXYZ(attr.count - 1, tmp.x, tmp.y, tmp.z);
      attr.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      if ((line.material as THREE.Material).type === "LineDashedMaterial") line.computeLineDistances();
    }
  }

  return {
    async build(c, s: SceneSpec) {
      if (s.engine !== "workshop") throw new Error(`workshop engine got a "${s.engine}" scene`);
      ctx = c;
      spec = s;
      data = s.engineData;
      world = new THREE.Group();
      world.name = "workshop";
      c.root.add(world);

      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(data.background ?? PAPER);
      const key = new THREE.DirectionalLight(0xffffff, 0.95 * Math.PI);
      key.position.set(6, 12, 14);
      const rim = new THREE.DirectionalLight(0xffe8d0, 0.35 * Math.PI);
      rim.position.set(-10, 5, -8);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.75 * Math.PI), key, rim];
      for (const l of lights) c.scene.add(l);

      for (const p of data.parts) {
        const built = buildPart(p, c);
        const node = new THREE.Group();
        node.name = `part:${p.id}`;
        node.add(built.object);
        const parent = p.parent ? byId.get(p.parent)! : null;
        (parent?.node ?? world).add(node);
        const basePos = vec(p.pos ?? [0, 0, 0]);
        const baseRot = new THREE.Euler(...((p.rot ?? [0, 0, 0]).map((a) => a * DEG) as [number, number, number]));
        node.position.copy(basePos);
        node.rotation.copy(baseRot);
        node.scale.setScalar(p.scale ?? 1);
        const o: PartObj = {
          spec: p, node, built, parent, basePos, baseRot, baseScale: p.scale ?? 1, baseColor: built.main.color.clone(),
          axis: AXES[defaultAxis(p)], eff: 0, glow: 0, level: p.level ?? 0, travel: 0,
        };
        for (const { m } of built.mats) m.userData.ownTransparent = m.transparent && m.opacity >= 0.999;
        parts.push(o);
        byId.set(p.id, o);
      }
      await buildModels(c, data.parts.filter((p) => p.shape === "model"));
      plans = new Map(
        data.chapters.map((ch) => [ch.chapter, { items: new Map(ch.items.map((it) => [it.id, it])), tracks: ch.tracks.map((tr) => compileTrack(tr, data!.params)) }]),
      );
      computeBounds();
    },

    update(chapterId, t) {
      if (!world) return;
      updateParts(plans.get(chapterId) ?? { items: new Map(), tracks: [] }, t);
    },

    resolveAnchor(anchor: Anchor, _chapterId, _t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || !world) return false;
      const p = byId.get(anchor.entity);
      if (!p) return false;
      const pt = p.built.particles;
      if (pt) {
        const d = anchor.index !== undefined ? (Math.min(100, anchor.index) / 100) * pt.path.length : ((p.travel % pt.path.length) + pt.path.length) % pt.path.length;
        toWorld(p.node, pt.path.at(d, out));
      } else toWorld(p.node, out.copy(p.built.anchor));
      if (anchor.offset) out.add(tmp.set(...anchor.offset));
      return true;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    params(chapterId): EngineParam[] {
      const ids = spec?.chapters.find((ch) => ch.id === chapterId)?.activity?.test.params ?? [];
      return ids.flatMap((id) => {
        const p = data?.params?.find((q) => q.id === id);
        if (!p) return [];
        const value = clamp(overrides?.[id] ?? p.value, p.min, p.max);
        return [{ id, label: p.label, min: p.min, max: p.max, step: p.step ?? (p.max - p.min) / 100, value }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      const defs = new Map((data?.params ?? []).map((p) => [p.id, p]));
      const next: Record<string, number> = {};
      for (const [id, v] of Object.entries(values)) {
        const p = defs.get(id);
        if (p && Number.isFinite(v)) next[id] = clamp(v, p.min, p.max);
      }
      overrides = Object.keys(next).length ? next : null;
    },

    dispose() {
      if (!ctx || !world) return;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
      });
      for (const g of geos) g.dispose();
      for (const m of mats) {
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      spec = null;
      data = null;
      world = null;
      lights = [];
      parts = [];
      byId = new Map();
      plans = new Map();
      overrides = null;
    },
  };
}
