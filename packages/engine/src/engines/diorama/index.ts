// `diorama` engine: the generalist engine (stories, everyday life, jobs, descriptive science).
//
// Items are catalog GLB models (fixtures/public/models, see docs/assets-3d.md) or procedural shapes,
// animated by declarative per-chapter actions. update(chapterId, t) recomputes everything from the pure
// Evaluator (state.ts): positions, power, clips (mixer time = f(t), never accumulated), effects.
//
// Anchors: { pos } and { entity: "item", part: "<itemId>" | "<itemId>.<part>", offset? } (see diorama.ts).
//
// In Node (no ctx.createCanvas) GLB files are not loaded, because their textures cannot be decoded there:
// catalog items are drawn as placeholders of the catalog size. Transforms, anchors and effects do not
// depend on the loaded meshes, so tests in Node see the same state as the browser.
import * as THREE from "three";
import { dioramaModel, type Anchor, type DioramaData, type DioramaItem, type SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../../types.ts";
import { buildExplosion, buildPuffs, buildSparks, buildTrail, type Fx } from "./effects.ts";
import { instantiate, loadModels } from "./models.ts";
import { buildLadder, buildPlaceholder, buildShape, glowTexture, layoutText, wireGeometry, type ShapeObj } from "./shapes.ts";
import { buildSkyDome, newSkyState, skyAt } from "./sky.ts";
import { baseSize, Evaluator } from "./state.ts";

/** An action of the item covers t (with a short tail so the colour does not blink). */
function actingAt(acts: readonly object[], t: number): boolean {
  return acts.some((a) => {
    const r = a as { at?: unknown; from?: unknown; to?: unknown; dur?: unknown };
    const start = typeof r.at === "number" ? r.at : typeof r.from === "number" ? r.from : null;
    if (start === null) return false;
    const end = typeof r.to === "number" ? r.to : start + (typeof r.dur === "number" ? r.dur : 0);
    return t >= start - 0.3 && t <= end + 2;
  });
}

const GROUND: Record<DioramaData["stage"]["ground"]["type"], string> = {
  grass: "#8cc66d",
  asphalt: "#7a7e85",
  pavement: "#cfc6b6",
  sand: "#e8d7a8",
  dirt: "#b48a5a",
  snow: "#f1f5fa",
  water: "#5aa8d8",
  floor: "#c8a27a",
};

/** Light intensities (three >= r155 physical units) for intensity 1 in the spec. */
const SUN = 2.8;
const HEMI = 1.9;
const POINT = 10;

interface MatState {
  m: THREE.Material & { opacity: number; transparent: boolean; emissive?: THREE.Color; color?: THREE.Color };
  opacity: number;
  transparent: boolean;
}

interface ItemObj {
  item: DioramaItem;
  outer: THREE.Group;
  mats: MatState[];
  /** Emissive colour at full power. */
  glow: THREE.Color | null;
  /** Neon text: base colour, dimmed when off. */
  neon: { color: THREE.Color; mat: THREE.MeshLambertMaterial; halo?: THREE.Mesh } | null;
  light?: { l: THREE.PointLight; i: number };
  mixer?: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current?: THREE.AnimationAction;
  shape?: ShapeObj;
  text?: string;
  blob?: THREE.Mesh;
  wireKey?: string;
}

interface Built {
  ctx: EngineContext;
  data: DioramaData;
  ev: Evaluator;
  group: THREE.Group;
  items: ItemObj[];
  fx: Fx[];
  sky: ReturnType<typeof buildSkyDome>;
  lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; moon: THREE.DirectionalLight };
  fog: { near: number; far: number } | null;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const skyState = newSkyState();

export function createDioramaEngine(): Engine {
  let b: Built | null = null;

  function update(chapter: string, t: number): void {
    if (!b) return;
    const { ev, ctx } = b;
    ev.beginFrame();

    // Sky, sun, fog.
    const sky = skyAt(ev.hour(chapter, t), skyState);
    if (b.data.stage.sky) {
      sky.top.set(b.data.stage.sky.top);
      sky.bottom.set(b.data.stage.sky.bottom);
    }
    b.sky.uniforms.top.value.copy(sky.top);
    b.sky.uniforms.bottom.value.copy(sky.bottom);
    (b.sky.stars.material as THREE.PointsMaterial).opacity = sky.dark * 0.9;
    b.sky.stars.visible = sky.dark > 0.02;
    (ctx.scene.background as THREE.Color).copy(sky.bottom);
    b.lights.sun.color.copy(sky.sun);
    b.lights.sun.intensity = sky.sunI * SUN;
    b.lights.sun.position.copy(sky.sunDir).multiplyScalar(30);
    b.lights.hemi.intensity = sky.hemiI * HEMI;
    b.lights.moon.intensity = sky.dark * 0.9;
    if (b.fog && ctx.scene.fog instanceof THREE.Fog) {
      ctx.scene.fog.color.copy(sky.bottom);
      ctx.root.updateWorldMatrix(true, false);
      const s = tmpA.setFromMatrixScale(ctx.root.matrixWorld).x || 1;
      ctx.scene.fog.near = b.fog.near * s;
      ctx.scene.fog.far = b.fog.far * s;
    }

    // Items.
    for (const o of b.items) {
      const s = ev.state(o.item.id, chapter, t);
      // China style (player): characters acting in this chapter and items acting around t keep their colours.
      const acts = ev.actionsOf(chapter, o.item.id);
      const person = typeof o.item.model === "string" && !!dioramaModel(o.item.model)?.tags.includes("person");
      o.outer.userData.key = (person && acts.length > 0) || actingAt(acts, t);
      const vis = s.visible && s.pop > 1e-3 && s.opacity > 0.01;
      o.outer.visible = vis;
      if (o.light) o.light.l.intensity = vis ? o.light.i * s.power : 0;
      if (o.blob) o.blob.visible = vis;
      if (o.shape?.wireMesh) {
        updateWire(o, chapter, t);
        continue;
      }
      // Transforms and materials are written even when hidden: the whole scene graph is a function of (chapter, t).
      o.outer.position.copy(s.pos).add(s.shake);
      ev.quat(s, o.outer.quaternion);
      o.outer.scale.copy(s.scale).multiplyScalar(Math.max(s.pop, 1e-4));
      for (const ms of o.mats) {
        ms.m.opacity = ms.opacity * s.opacity;
        ms.m.transparent = ms.transparent || s.opacity < 1;
        if (o.glow && ms.m.emissive) ms.m.emissive.copy(o.glow).multiplyScalar(s.power);
      }
      if (o.neon) {
        o.neon.mat.color.copy(o.neon.color).multiplyScalar(0.35 + 0.45 * s.power);
        o.neon.mat.emissive.copy(o.neon.color).multiplyScalar(0.55 * s.power);
        if (o.neon.halo) (o.neon.halo.material as THREE.MeshBasicMaterial).opacity = s.power * (0.12 + 0.22 * sky.dark) * s.opacity;
      }
      if (o.shape?.clock) o.shape.clock.set(ev.clockMinutes(o.item.id, chapter, t) ?? o.shape.clock.minutes);
      if (o.shape && s.text !== null && s.text !== o.text) {
        const m = o.item.model as Extract<DioramaItem["model"], { shape: "text" }>;
        layoutText(o.shape, s.text, m.height, m.depth);
        o.text = s.text;
      }
      if (!vis) continue;
      if (o.mixer) {
        const act = s.clip ? o.actions.get(s.clip) : undefined;
        if (act !== o.current) {
          o.current?.stop();
          o.current = act;
        }
        if (act) {
          act.reset();
          act.setLoop(s.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
          act.clampWhenFinished = true;
          act.play();
          o.mixer.setTime(Math.max(0, s.clipTime));
        }
      }
      if (o.blob) {
        const lift = Math.max(0, s.pos.y);
        o.blob.position.set(s.pos.x, 0.015, s.pos.z);
        const f = Math.max(0, 1 - lift / 3);
        o.blob.scale.setScalar(Math.max(1e-3, f * s.pop));
        o.blob.rotation.z = (-s.yaw * Math.PI) / 180;
      }
    }

    for (const f of b.fx) f.update(chapter, t);
  }

  function updateWire(o: ItemObj, chapter: string, t: number): void {
    const m = o.item.model as Extract<DioramaItem["model"], { shape: "wire" }>;
    if (!b!.ev.resolvePoint(m.from, chapter, t, tmpA) || !b!.ev.resolvePoint(m.to, chapter, t, tmpB)) {
      o.outer.visible = false;
      return;
    }
    const key = [...tmpA.toArray(), ...tmpB.toArray()].map((x) => x.toFixed(3)).join(",");
    if (key === o.wireKey) return;
    o.wireKey = key;
    const mesh = o.shape!.wireMesh!;
    mesh.geometry.dispose();
    mesh.geometry = wireGeometry(tmpA, tmpB, m.sag ?? 0.3, m.thickness ?? 0.04);
  }

  return {
    async build(ctx: EngineContext, spec: SceneSpec) {
      if (spec.engine !== "diorama") throw new Error(`diorama engine got a "${spec.engine}" scene`);
      const data = spec.engineData;
      const cc = ctx.createCanvas;
      const ev = new Evaluator(data);
      const group = new THREE.Group();
      group.name = "diorama";
      ctx.root.add(group);

      const files = data.items.flatMap((it) => (typeof it.model === "string" ? [dioramaModel(it.model)?.file].filter((f): f is string => !!f) : []));
      const models = await loadModels(files, ctx.loadAsset, !!cc);
      const blobTex = glowTexture(cc);

      const items: ItemObj[] = data.items.map((item) => {
        const size = baseSize(item, null);
        let obj: THREE.Object3D;
        let mats: THREE.Material[];
        let mixer: THREE.AnimationMixer | undefined;
        let actions = new Map<string, THREE.AnimationAction>();
        let shape: ShapeObj | undefined;
        if (typeof item.model === "string") {
          const cat = dioramaModel(item.model);
          const loaded = cat?.file ? models.get(cat.file) : null;
          if (loaded) {
            const inst = instantiate(loaded, size[1], item.tint);
            ({ obj, mats, actions } = inst);
            mixer = inst.mixer;
          } else if (item.model === "ladder") {
            ({ obj, mats } = buildLadder(size[1]));
          } else {
            ({ obj, mats } = buildPlaceholder(size));
          }
        } else {
          shape = buildShape(item.model, cc);
          ({ obj, mats } = shape);
          if (item.model.shape !== "wire") obj.scale.setScalar(item.scale ?? 1);
        }
        const outer = new THREE.Group();
        outer.name = item.id;
        outer.add(obj);
        group.add(outer);

        const o: ItemObj = {
          item,
          outer,
          mats: mats.map((m) => {
            const mm = m as MatState["m"];
            return { m: mm, opacity: mm.opacity, transparent: mm.transparent };
          }),
          glow: item.glow ? new THREE.Color(item.glow) : null,
          neon: null,
          actions,
          ...(mixer ? { mixer } : {}),
          ...(shape ? { shape } : {}),
        };
        if (typeof item.model !== "string" && item.model.shape === "text" && item.model.neon !== false) {
          o.neon = { color: new THREE.Color(item.model.color), mat: shape!.textMesh!.material as THREE.MeshLambertMaterial, ...(shape?.halo ? { halo: shape.halo } : {}) };
          o.text = item.model.text;
        }
        if (typeof item.model !== "string" && item.model.shape === "bulb") o.glow = new THREE.Color(item.model.color);
        if (item.light) {
          const l = new THREE.PointLight(item.light.color ?? "#ffd9a0", 0, item.light.distance ?? 8, 1.6);
          l.position.set(...(item.light.offset ?? [0, size[1], 0]));
          outer.add(l);
          o.light = { l, i: (item.light.intensity ?? 1) * POINT };
        }
        const cat = typeof item.model === "string" ? dioramaModel(item.model) : undefined;
        if (blobTex && cat && cat.tags.some((tg) => tg === "person" || tg === "animal" || tg === "vehicle")) {
          const r = Math.max(size[0], size[2]) * 0.75;
          o.blob = new THREE.Mesh(
            new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: "#000000", map: blobTex, transparent: true, opacity: 0.32, depthWrite: false }),
          );
          group.add(o.blob);
        }
        return o;
      });

      // Ground: the stage plus a wide apron that fades into the fog.
      const [w, d] = data.stage.size;
      const gColor = data.stage.ground.color ?? GROUND[data.stage.ground.type];
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: gColor }));
      const span = Math.max(w, d);
      const apron = new THREE.Mesh(
        new THREE.CircleGeometry(span * 3, 48).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(gColor).multiplyScalar(0.88) }),
      );
      apron.position.y = -0.02;
      group.add(ground, apron);

      // Effects (one per action; explosions one per target).
      const fx: Fx[] = [];
      for (const c of data.chapters) {
        for (const a of c.actions) {
          if (a.do === "sparks") fx.push(buildSparks(c.chapter, a, ev, cc));
          else if (a.do === "smoke" || a.do === "fire") fx.push(buildPuffs(c.chapter, a, ev));
          else if (a.do === "trail") fx.push(buildTrail(c.chapter, a, ev));
          else if (a.do === "explode") for (const id of typeof a.target === "string" ? [a.target] : a.target) fx.push(buildExplosion(c.chapter, a, id, ev, cc));
        }
      }
      for (const f of fx) group.add(...f.objects);

      const skyDome = buildSkyDome(span * 3.2);
      group.add(skyDome.dome, skyDome.stars);
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f6a, HEMI);
      const sun = new THREE.DirectionalLight(0xffffff, SUN);
      const moon = new THREE.DirectionalLight(0x8fa8ff, 0);
      moon.position.set(-12, 20, 10);
      ctx.scene.add(hemi, sun, moon);
      ctx.scene.background = new THREE.Color();
      const fogOn = data.stage.fog ?? true;
      if (fogOn) ctx.scene.fog = new THREE.Fog(0xffffff, span * 1.1, span * 3.1);

      b = { ctx, data, ev, group, items, fx, sky: skyDome, lights: { hemi, sun, moon }, fog: fogOn ? { near: span * 1.1, far: span * 3.1 } : null };
      update(spec.chapters[0]!.id, 0);
    },

    update,

    resolveAnchor(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3): boolean {
      if (!b) return false;
      if ("pos" in anchor) {
        out.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]);
        return true;
      }
      if ("geo" in anchor || anchor.entity !== "item" || !anchor.part) return false;
      const [id, part] = anchor.part.split(".") as [string, string | undefined];
      if (!b.ev.point(id, part, chapterId, t, out)) return false;
      if (anchor.offset) out.add(tmpA.set(anchor.offset[0], anchor.offset[1], anchor.offset[2]));
      return true;
    },

    bounds() {
      if (!b) return { center: new THREE.Vector3(), radius: 1 };
      const [w, d] = b.data.stage.size;
      return { center: new THREE.Vector3(0, 0, 0), radius: Math.hypot(w, d) / 2 };
    },

    dispose() {
      if (!b) return;
      const { ctx, group, lights } = b;
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const m of mats) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
      for (const o of b.items) o.mixer?.stopAllAction();
      ctx.root.remove(group);
      ctx.scene.remove(lights.hemi, lights.sun, lights.moon);
      ctx.scene.fog = null;
      ctx.scene.background = null;
      b = null;
    },
  };
}
