// `battle` engine: battles, sieges and landings from declarative BattleData.
//
// update(chapterId, t) recomputes every transform from (chapterId, t) through the pure
// Motion evaluator: nothing is integrated over time, randomness is a seeded hash.
//
// Anchor entities ({ entity, index?, part?, offset? }), all in root-local coordinates:
// - army id        soldier `index` (feet; add an offset for the head, ~0.65)
// - vehicle id     ship/chariot `index` (water line / ground)
// - figure id      the figure's feet; parts: head, helmet, cuirass, shield, spear (follow pose, spin, fall)
// - prop id        member `index`; part "top" = top of the model (follows growth)
// - city id        parts: center (default, above the roofs), gate (top of the gate), palace (roof)
// - hill / mountain / island id   top; river id   middle of the river
// - strata effect id   layer `index` (0 = oldest), point on the layer edge at `edgeAngle`
import * as THREE from "three";
import type { Anchor, BattleData, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../../types.ts";
import { ease, hash, lerp, seg } from "../../util/math.ts";
import {
  buildChariot,
  buildHut,
  buildPodium,
  buildShip,
  buildWarrior,
  buildWoodenHorse,
  glowTexture,
  lambert,
  soldierParts,
  WARRIOR_PARTS,
  type ChariotParts,
} from "./models.ts";
import { evalKeys, inWindows, Motion, type Pose } from "./motion.ts";
import { buildCity, buildTerrain, type CityObj, type Terrain } from "./world.ts";

type Effect = NonNullable<BattleData["effects"]>[number];
type Arrows = Extract<Effect, { type: "arrows" }>;
type Fire = Extract<Effect, { type: "fire" }>;
type Strata = Extract<Effect, { type: "strata" }>;
type CityFade = Extract<Effect, { type: "cityFade" }>;

/** r128 legacy light units -> physically based units (three >= r155). */
const LEGACY = Math.PI;

interface Member {
  obj: THREE.Object3D;
  sail?: THREE.Object3D;
  chariot?: ChariotParts;
  top?: number;
}

interface Built {
  ctx: EngineContext;
  data: BattleData;
  group: THREE.Group;
  terrain: Terrain;
  motion: Motion;
  cities: Map<string, { spec: NonNullable<BattleData["cities"]>[number]; obj: CityObj }>;
  armies: { id: string; count: number; meshes: THREE.InstancedMesh[] }[];
  members: Map<string, Member[]>;
  figureIds: Set<string>;
  arrows: { fx: Arrows; points: THREE.Points }[];
  fires: { fx: Fire; points: THREE.Points; light: THREE.PointLight; base: THREE.Vector3 }[];
  strata: { fx: Strata; meshes: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshLambertMaterial>[]; base: THREE.Vector3 }[];
  fades: CityFade[];
  lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; moon: THREE.DirectionalLight };
  sky: { day: THREE.Color; night: THREE.Color; fog: [number, number] };
  last: { chapter: string; t: number } | null;
}

const dummy = new THREE.Object3D();
const tmp = new THREE.Vector3();

export function createBattleEngine(): Engine {
  let b: Built | null = null;

  const placePose = (obj: THREE.Object3D, p: Pose, terrain: Terrain, scale: number) => {
    obj.visible = p.vis;
    obj.position.set(p.x, terrain.height(p.x, p.z) + p.yOff, p.z);
    obj.rotation.set(p.tilt, p.yaw, 0, "YXZ");
    obj.scale.set(scale, scale * p.grow, scale);
  };

  function update(chapter: string, t: number) {
    if (!b) return;
    const { motion, terrain, data } = b;
    motion.beginFrame();
    b.last = { chapter, t };

    // Day / night.
    const nk = data.night?.find((n) => n.chapter === chapter);
    const night = nk ? evalKeys(nk.keys, t) : 0;
    const bg = b.ctx.scene.background as THREE.Color;
    bg.copy(b.sky.day).lerp(b.sky.night, night);
    const fog = b.ctx.scene.fog as THREE.Fog;
    fog.color.copy(bg);
    b.ctx.root.updateWorldMatrix(true, false);
    const s = tmp.setFromMatrixScale(b.ctx.root.matrixWorld).x || 1;
    fog.near = b.sky.fog[0] * s;
    fog.far = b.sky.fog[1] * s;
    b.lights.hemi.intensity = lerp(0.65, 0.16, night) * LEGACY;
    b.lights.sun.intensity = lerp(0.8, 0.05, night) * LEGACY;
    b.lights.moon.intensity = night * 0.35 * LEGACY;
    for (const w of terrain.water) w.mat.color.copy(w.day).lerp(w.night, night);

    // Cities: gates and fading.
    for (const { spec, obj } of b.cities.values()) {
      const ok = spec.gate.open?.find((g) => g.chapter === chapter);
      const open = ok ? evalKeys(ok.keys, t) : 0;
      for (const l of obj.leaves) l.pivot.rotation.y = l.s * open * 1.35;
      const fade = b.fades.find((f) => f.chapter === chapter && f.city === spec.id);
      const op = fade ? 1 - seg(t, fade.ramp[0], fade.ramp[1]) : 1;
      obj.group.visible = op > 0.01;
      for (const m of obj.materials) m.opacity = op;
    }

    // Armies (instanced).
    // China style (player): the side that is moving now keeps its colours (userData.key).
    for (const a of b.armies) {
      let active = false;
      for (let m = 0; m < a.count; m++) {
        const p = motion.pose(a.id, m, chapter, t);
        if (p.moving && p.vis) active = true;
        let y = terrain.height(p.x, p.z) + p.yOff;
        if (p.moving) y += Math.abs(Math.sin(t * 11 + m)) * 0.025;
        dummy.position.set(p.x, y, p.z);
        dummy.rotation.set(p.tilt, p.yaw, 0, "YXZ");
        dummy.scale.setScalar(p.vis ? 1 : 0);
        dummy.updateMatrix();
        for (const im of a.meshes) im.setMatrixAt(m, dummy.matrix);
      }
      for (const im of a.meshes) {
        im.instanceMatrix.needsUpdate = true;
        im.userData.key = active;
      }
    }

    // Vehicles, figures, props.
    for (const [id, list] of b.members) {
      const g = motion.groups.get(id)!;
      list.forEach((mem, m) => {
        const p = motion.pose(id, m, chapter, t);
        placePose(mem.obj, p, terrain, g.scale);
        mem.obj.userData.key = p.moving && p.vis;
        if (mem.sail) mem.sail.visible = p.moving;
        if (mem.chariot) {
          for (const w of mem.chariot.wheels) w.rotation.x = p.moving ? t * 9 : 0;
          mem.chariot.legs.forEach((l, n) => (l.rotation.x = p.moving ? Math.sin(t * 14 + n * 1.7) * 0.6 : 0));
        }
      });
    }

    // Effects.
    for (const { fx, points } of b.arrows) {
      points.visible = fx.chapter === chapter && inWindows(fx.visible, t);
      if (!points.visible) continue;
      const army = motion.groups.get(fx.army)!;
      const arr = points.geometry.attributes.position!.array as Float32Array;
      for (let k = 0; k < fx.count; k++) {
        const src = motion.pose(fx.army, Math.floor(hash(k, fx.seed) * army.count), chapter, t);
        const sy = terrain.height(src.x, src.z) + src.yOff + 0.3;
        const per = fx.period[0] + hash(k, fx.seed + 1) * (fx.period[1] - fx.period[0]);
        const p = ((t + hash(k, fx.seed + 2) * per) % per) / per;
        const tx = fx.target.center[0] + (hash(k, fx.seed + 3) - 0.5) * fx.target.size[0];
        const tz = fx.target.center[1] + (hash(k, fx.seed + 4) - 0.5) * fx.target.size[1];
        arr[k * 3] = lerp(src.x, tx, p);
        arr[k * 3 + 1] = lerp(sy, 0.2, p) + Math.sin(p * Math.PI) * fx.arc;
        arr[k * 3 + 2] = lerp(src.z, tz, p);
      }
      points.geometry.attributes.position!.needsUpdate = true;
    }
    for (const { fx, points, light, base } of b.fires) {
      const fire = fx.chapter === chapter ? evalKeys(fx.intensity, t) : 0;
      points.visible = fire > 0;
      light.intensity = fire * (3 + Math.sin(t * 13) * 0.6) * LEGACY;
      (points.material as THREE.PointsMaterial).opacity = fire * 0.9;
      if (!points.visible) continue;
      const fp = points.geometry.attributes.position!.array as Float32Array;
      for (let i = 0; i < fx.particles; i++) {
        const r = Math.sqrt(hash(i, fx.seed)) * fx.radius;
        const a = hash(i, fx.seed + 1) * Math.PI * 2;
        const ph = (t * 0.7 + hash(i, fx.seed + 2)) % 1;
        fp[i * 3] = base.x + Math.cos(a) * r + Math.sin(t * 2 + i) * 0.05;
        fp[i * 3 + 1] = base.y + 0.2 + ph * fx.height * fire;
        fp[i * 3 + 2] = base.z + Math.sin(a) * r;
      }
      points.geometry.attributes.position!.needsUpdate = true;
    }
    for (const { fx, meshes } of b.strata) {
      const show = fx.chapter === chapter;
      meshes.forEach((m, k) => {
        const g = show ? ease.inOutQuad(seg(t, fx.grow.from + k * fx.grow.step, fx.grow.from + k * fx.grow.step + fx.grow.duration)) : 0;
        m.visible = g > 0.01;
        m.scale.set(1, Math.max(0.01, g), 1);
        m.material.emissive.setRGB(0, 0, 0);
        if (show && fx.glow && fx.layers[k]!.id === fx.glow.layer && t > fx.glow.from) {
          const p = 0.25 + 0.25 * Math.sin(t * 4);
          m.material.emissive.setRGB(p, p * 0.25, 0);
        }
      });
    }
  }

  return {
    async build(ctx: EngineContext, spec: SceneSpec) {
      if (spec.engine !== "battle") throw new Error(`battle engine got a "${spec.engine}" scene`);
      const data = spec.engineData;
      const cc = ctx.createCanvas;
      const group = new THREE.Group();
      group.name = "battle";
      ctx.root.add(group);

      const terrain = buildTerrain(data.world);
      group.add(terrain.group);
      const motion = new Motion(data, terrain.height, terrain.isDeepWater);

      const cities: Built["cities"] = new Map();
      for (const c of data.cities ?? []) {
        const obj = buildCity(c, terrain.height(c.center[0], c.center[1]));
        group.add(obj.group);
        cities.set(c.id, { spec: c, obj });
      }

      const sides = new Map(data.sides.map((s) => [s.id, s]));
      const armies: Built["armies"] = data.armies.map((a) => {
        const meshes = soldierParts(sides.get(a.side)!).map(([geo, color]) => {
          const im = new THREE.InstancedMesh(geo, lambert(color), a.count);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.frustumCulled = false;
          group.add(im);
          return im;
        });
        return { id: a.id, count: a.count, meshes };
      });

      const members: Built["members"] = new Map();
      const addMember = (id: string, mem: Member) => {
        group.add(mem.obj);
        const list = members.get(id) ?? [];
        list.push(mem);
        members.set(id, list);
      };
      for (const v of data.vehicles ?? []) {
        const side = v.side ? sides.get(v.side) : undefined;
        for (let i = 0; i < v.count; i++) {
          if (v.type === "ship") {
            const s = buildShip(cc);
            addMember(v.id, { obj: s.obj, sail: s.sail });
          } else {
            const c = buildChariot(v.color ?? side?.color ?? "#7a5232", v.horseColor ?? "#e7dfd2");
            addMember(v.id, { obj: c.obj, chariot: c.parts });
          }
        }
      }
      const figureIds = new Set<string>();
      for (const f of data.figures ?? []) {
        const outer = new THREE.Group();
        outer.add(buildWarrior({ tunic: f.tunic, crest: f.crest }, cc));
        addMember(f.id, { obj: outer });
        figureIds.add(f.id);
      }
      for (const p of data.props ?? []) {
        for (let i = 0; i < (p.count ?? 1); i++) {
          const outer = new THREE.Group();
          const model = p.model === "woodenHorse" ? buildWoodenHorse(p.color) : p.model === "podium" ? buildPodium(p.color) : buildHut(p.color);
          outer.add(model);
          const top = new THREE.Box3().setFromObject(model).max.y;
          addMember(p.id, { obj: outer, top });
        }
      }

      const arrows: Built["arrows"] = [];
      const fires: Built["fires"] = [];
      const strata: Built["strata"] = [];
      const fades: CityFade[] = [];
      const point = (p: [number, number] | string) => {
        const [x, z] = motion.resolvePoint(p);
        return new THREE.Vector3(x, terrain.height(x, z), z);
      };
      for (const fx of data.effects ?? []) {
        if (fx.type === "arrows") {
          if (!motion.groups.has(fx.army)) throw new Error(`battle: unknown army "${fx.army}" in arrows`);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fx.count * 3), 3));
          const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x2a1d12, size: 0.07 }));
          pts.frustumCulled = false;
          group.add(pts);
          arrows.push({ fx, points: pts });
        } else if (fx.type === "fire") {
          const pos = new Float32Array(fx.particles * 3);
          const col = new Float32Array(fx.particles * 3);
          const c = new THREE.Color();
          for (let i = 0; i < fx.particles; i++) {
            c.set(hash(i, fx.seed + 3) < 0.5 ? "#ff7a1a" : "#ffc23a");
            col.set([c.r, c.g, c.b], i * 3);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          const map = glowTexture(cc);
          const mat = new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...(map ? { map } : {}) });
          const pts = new THREE.Points(geo, mat);
          pts.frustumCulled = false;
          pts.visible = false;
          group.add(pts);
          const base = point(fx.center);
          const light = new THREE.PointLight(0xff7a2a, 0, 16, 1);
          light.position.set(base.x, base.y + 2.2, base.z);
          group.add(light);
          fires.push({ fx, points: pts, light, base });
        } else if (fx.type === "strata") {
          const base = point(fx.center);
          const meshes = fx.layers.map((l, k) => {
            const lh = fx.layerHeight;
            const m = new THREE.Mesh(
              new THREE.CylinderGeometry(fx.radius - k * 0.06, fx.radius + 0.05 - k * 0.06, lh, 40),
              new THREE.MeshLambertMaterial({ color: l.color, emissive: 0x000000 }),
            );
            m.position.set(base.x, base.y + lh / 2 + k * (lh + 0.01), base.z);
            m.visible = false;
            group.add(m);
            return m;
          });
          strata.push({ fx, meshes, base });
        } else {
          if (!cities.has(fx.city)) throw new Error(`battle: unknown city "${fx.city}" in cityFade`);
          fades.push(fx);
        }
      }

      const hemi = new THREE.HemisphereLight(0xfff6e8, 0x8a7a60, 0.65 * LEGACY);
      const sun = new THREE.DirectionalLight(0xfff1d6, 0.8 * LEGACY);
      sun.position.set(-10, 16, 8);
      const moon = new THREE.DirectionalLight(0x7f9cff, 0);
      moon.position.set(10, 12, -10);
      ctx.scene.add(hemi, sun, moon);
      const sky = { day: new THREE.Color(data.world.sky.day), night: new THREE.Color(data.world.sky.night), fog: data.world.sky.fog ?? [45, 115] };
      ctx.scene.background = sky.day.clone();
      ctx.scene.fog = new THREE.Fog(sky.day.clone(), sky.fog[0], sky.fog[1]);

      b = { ctx, data, group, terrain, motion, cities, armies, members, figureIds, arrows, fires, strata, fades, lights: { hemi, sun, moon }, sky, last: null };
    },

    update,

    resolveAnchor(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3): boolean {
      if (!b) return false;
      if ("pos" in anchor) {
        out.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]);
        return true;
      }
      if ("geo" in anchor) return false;
      if (!b.last || b.last.chapter !== chapterId || b.last.t !== t) update(chapterId, t);
      const { entity, index = 0, part } = anchor;
      const ok = entityPoint(b, entity, index, part, chapterId, t, out);
      if (ok && anchor.offset) out.add(tmp.set(anchor.offset[0], anchor.offset[1], anchor.offset[2]));
      return ok;
    },

    bounds() {
      if (!b) return { center: new THREE.Vector3(), radius: 1 };
      const e = b.data.world.extent;
      const center = new THREE.Vector3((e.x[0] + e.x[1]) / 2, 0, (e.z[0] + e.z[1]) / 2);
      return { center, radius: Math.hypot(e.x[1] - e.x[0], e.z[1] - e.z[0]) / 2 };
    },

    dispose() {
      if (!b) return;
      const { ctx, group, lights } = b;
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const m of mats) {
          (m as THREE.MeshLambertMaterial).map?.dispose();
          m.dispose();
        }
      });
      ctx.root.remove(group);
      ctx.scene.remove(lights.hemi, lights.sun, lights.moon);
      ctx.scene.fog = null;
      ctx.scene.background = null;
      b = null;
    },
  };
}

function entityPoint(b: Built, entity: string, index: number, part: string | undefined, chapter: string, t: number, out: THREE.Vector3): boolean {
  const g = b.motion.groups.get(entity);
  if (g) {
    if (index >= g.count) return false;
    if (g.kind === "army") {
      const p = b.motion.pose(entity, index, chapter, t);
      out.set(p.x, b.terrain.height(p.x, p.z) + p.yOff, p.z);
      return true;
    }
    const mem = b.members.get(entity)![index]!;
    mem.obj.updateMatrix();
    if (part && b.figureIds.has(entity)) {
      const local = WARRIOR_PARTS[part];
      if (!local) return false;
      out.copy(local).applyMatrix4(mem.obj.matrix);
      return true;
    }
    if (part === "top" && mem.top !== undefined) {
      out.set(0, mem.top, 0).applyMatrix4(mem.obj.matrix);
      return true;
    }
    if (part) return false;
    out.copy(mem.obj.position);
    return true;
  }
  const city = b.cities.get(entity);
  if (city) {
    const a = city.obj.anchors[part ?? "center"];
    if (!a) return false;
    out.copy(a);
    return true;
  }
  const top = b.terrain.tops.get(entity);
  if (top) {
    out.copy(top);
    return true;
  }
  const st = b.strata.find((s) => s.fx.id === entity);
  if (st) {
    const m = st.meshes[index];
    if (!m) return false;
    const a = ((st.fx.edgeAngle ?? 180) * Math.PI) / 180;
    const r = st.fx.radius - index * 0.06;
    out.set(st.base.x + Math.cos(a) * r, m.position.y, st.base.z + Math.sin(a) * r);
    return true;
  }
  return false;
}
