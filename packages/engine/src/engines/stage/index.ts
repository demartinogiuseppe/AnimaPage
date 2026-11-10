// `stage` engine ("Palcoscenico"): characters in dialogue on a small theatre stage.
//
// A procedural set (floor, proscenium, curtains that open at the start of each chapter, footlights,
// a layered backdrop: piazza, aula, casa, bosco, palazzo, porto, vuoto) with catalog people as
// characters and catalog models or shapes as props. Who speaks comes from the narration (Sentence.speaker,
// see stage.ts in scene-spec): the speaker gets a spotlight and a speech bubble, the house lights dim,
// listeners turn towards them. Blocking (enter, walk, exit, face, gesture, sit, take/give/put) is
// evaluated by the pure StageEvaluator (blocking.ts); clips are set with mixer time = f(t).
//
// Anchors: { pos }, { entity: "character", part: "<id>[.base|center|head|top|hand|bubble]" },
// { entity: "prop", part: "<id>[.base|center|top|front]" }, { entity: "set", part: "center|front|backdrop|left|right" }.
//
// In Node (no ctx.createCanvas) GLB files are not loaded: characters and catalog props are placeholders of
// the catalog size. Everything update() computes is independent of the loaded meshes.
import * as THREE from "three";
import { dioramaModel, stageSize, type Anchor, type SceneSpec, type StageData } from "@pv/scene-spec";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { instantiate, loadModels } from "../diorama/models.ts";
import { buildPlaceholder, buildShape, glowTexture } from "../diorama/shapes.ts";
import type { ClockObj } from "../diorama/clock.ts";
import { StageEvaluator } from "./blocking.ts";
import { buildSet, OPENING_H, setCurtains, type StageSet } from "./set.ts";

/** Light intensities (three >= r155 physical units). */
const HEMI = 1.7;
const KEY = 2.2;
const SPOT = 70;
const SPOT_HEIGHT = 6.2;
const SPOT_FRONT = 3.2;
const POOL_R = 0.8;

interface Actor {
  id: string;
  outer: THREE.Group;
  mixer?: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current?: THREE.AnimationAction;
  bubble: THREE.Group;
  dots: THREE.Mesh[];
  blob?: THREE.Mesh;
}

interface PropObj {
  id: string;
  outer: THREE.Group;
  clock?: ClockObj;
}

interface Built {
  ctx: EngineContext;
  data: StageData;
  ev: StageEvaluator;
  group: THREE.Group;
  set: StageSet;
  actors: Actor[];
  props: PropObj[];
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  spot: THREE.SpotLight;
  beam: THREE.Mesh;
  pool: THREE.Mesh;
}

const tmp = { x: 0, y: 0, z: 0 };
const up = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();

function buildBubble(): { bubble: THREE.Group; dots: THREE.Mesh[] } {
  const bubble = new THREE.Group();
  bubble.name = "bubble";
  bubble.userData.key = true;
  const white = new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.25 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 12), white);
  ball.scale.set(1.3, 0.85, 0.4);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 8), white);
  tail.position.set(-0.2, -0.22, 0);
  tail.rotation.z = -0.7;
  tail.rotation.x = Math.PI;
  tail.name = "tail";
  bubble.add(ball, tail);
  const ink = new THREE.MeshLambertMaterial({ color: "#2b2b2b" });
  const dots = [-1, 0, 1].map((i) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), ink);
    d.position.set(i * 0.12, 0, 0.1);
    bubble.add(d);
    return d;
  });
  return { bubble, dots };
}

export function createStageEngine(): Engine {
  let b: Built | null = null;

  function update(chapter: string, t: number): void {
    if (!b) return;
    const { ev } = b;
    setCurtains(b.set, ev.curtain(t));

    for (const a of b.actors) {
      const s = ev.character(a.id, chapter, t);
      a.outer.visible = s.visible;
      a.outer.position.set(s.x, s.y, s.z);
      a.outer.rotation.set(0, (s.yaw * Math.PI) / 180, 0);
      a.outer.userData.key = s.acting;
      if (a.blob) {
        a.blob.visible = s.visible;
        a.blob.position.set(s.x, 0.012 + s.y, s.z);
      }
      // Speech bubble: pops in for the line, dots bounce.
      const cue = ev.cueAt(chapter, t);
      const on = s.speaking && cue ? Math.min(1, (t - cue.from) / 0.25) * Math.min(1, Math.max(0, (cue.to - t) / 0.2)) : 0;
      ev.characterPart(a.id, "bubble", chapter, t, tmp);
      a.bubble.position.set(tmp.x, tmp.y, tmp.z);
      a.bubble.scale.set(tmp.x < s.x ? -Math.max(on, 1e-4) : Math.max(on, 1e-4), Math.max(on, 1e-4), Math.max(on, 1e-4));
      a.bubble.visible = on > 0.01;
      a.dots.forEach((d, i) => (d.position.y = 0.035 * Math.max(0, Math.sin((t * 2.2 - i / 3) * Math.PI * 2))));
      if (a.mixer) {
        const act = s.clip ? a.actions.get(s.clip) : undefined;
        if (act !== a.current) {
          a.current?.stop();
          a.current = act;
        }
        if (act) {
          act.reset();
          act.setLoop(s.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
          act.clampWhenFinished = true;
          act.play();
          a.mixer.setTime(Math.max(0, s.clipTime));
        }
      }
    }

    for (const p of b.props) {
      const s = ev.prop(p.id, chapter, t)!;
      p.outer.visible = s.pop > 1e-3;
      p.outer.position.set(s.x, s.y, s.z);
      p.outer.rotation.set(0, (s.yaw * Math.PI) / 180, 0);
      p.outer.scale.setScalar(Math.max(s.pop, 1e-4));
      p.outer.userData.key = s.acting;
      if (p.clock) p.clock.set(ev.clockMinutes(p.id, chapter, t) ?? p.clock.minutes);
    }

    // Spotlight on the speaker, house lights dimmed under it.
    const sp = ev.spot(chapter, t);
    const house = ev.house(chapter, t);
    b.hemi.intensity = HEMI * house;
    b.key.intensity = KEY * house;
    b.spot.intensity = SPOT * sp.intensity;
    b.spot.position.set(sp.x * 0.6, SPOT_HEIGHT, sp.z + SPOT_FRONT);
    b.spot.target.position.set(sp.x, 0, sp.z);
    b.pool.position.set(sp.x, 0.01, sp.z);
    b.pool.visible = sp.intensity > 0.01;
    (b.pool.material as THREE.MeshBasicMaterial).opacity = 0.42 * sp.intensity;
    dir.copy(b.spot.target.position).sub(b.spot.position);
    const len = dir.length();
    b.beam.visible = sp.intensity > 0.01;
    b.beam.position.copy(b.spot.position).addScaledVector(dir, 0.5);
    b.beam.scale.set(1, len, 1);
    b.beam.quaternion.setFromUnitVectors(up, dir.normalize().negate());
    (b.beam.material as THREE.MeshBasicMaterial).opacity = 0.1 * sp.intensity;
    b.set.footlights.emissiveIntensity = 0.3 + 0.5 * house;
  }

  return {
    async build(ctx: EngineContext, spec: SceneSpec) {
      if (spec.engine !== "stage") throw new Error(`stage engine got a "${spec.engine}" scene`);
      const data = spec.engineData;
      const cc = ctx.createCanvas;
      const ev = new StageEvaluator(data, spec.chapters);
      const [W, D] = stageSize(data);
      const group = new THREE.Group();
      group.name = "stage";
      ctx.root.add(group);

      const set = buildSet({ ...data.set, width: W, depth: D });
      group.add(set.group);

      const files = [...data.characters.map((c) => c.model), ...data.props.flatMap((p) => (typeof p.model === "string" ? [p.model] : []))]
        .map((id) => dioramaModel(id)?.file)
        .filter((f): f is string => !!f);
      const models = await loadModels(files, ctx.loadAsset, !!cc);
      const blobTex = glowTexture(cc);

      const actors: Actor[] = data.characters.map((c) => {
        const cat = dioramaModel(c.model);
        const size = (cat?.size ?? [0.6, 1.7, 0.4]).map((v) => v * (c.scale ?? 1)) as [number, number, number];
        const loaded = cat?.file ? models.get(cat.file) : null;
        const outer = new THREE.Group();
        outer.name = c.id;
        let actions = new Map<string, THREE.AnimationAction>();
        let mixer: THREE.AnimationMixer | undefined;
        if (loaded) {
          const inst = instantiate(loaded, size[1], c.tint);
          outer.add(inst.obj);
          actions = inst.actions;
          mixer = inst.mixer;
        } else outer.add(buildPlaceholder(size).obj);
        group.add(outer);
        const { bubble, dots } = buildBubble();
        bubble.name = `${c.id}-bubble`;
        group.add(bubble);
        const a: Actor = { id: c.id, outer, actions, bubble, dots, ...(mixer ? { mixer } : {}) };
        if (blobTex) {
          a.blob = new THREE.Mesh(
            new THREE.PlaneGeometry(size[0] * 1.6, size[0] * 1.6).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: "#000000", map: blobTex, transparent: true, opacity: 0.35, depthWrite: false }),
          );
          group.add(a.blob);
        }
        return a;
      });

      const props: PropObj[] = data.props.map((p) => {
        const outer = new THREE.Group();
        outer.name = p.id;
        const inner = new THREE.Group();
        outer.add(inner);
        let clock: ClockObj | undefined;
        if (typeof p.model === "string") {
          const cat = dioramaModel(p.model);
          const size = ev.propSize(p);
          const loaded = cat?.file ? models.get(cat.file) : null;
          inner.add(loaded ? instantiate(loaded, size[1], p.tint).obj : buildPlaceholder(size).obj);
        } else {
          const s = buildShape(p.model, cc);
          s.obj.scale.multiplyScalar(p.scale ?? 1);
          inner.add(s.obj);
          clock = s.clock;
        }
        group.add(outer);
        return { id: p.id, outer, ...(clock ? { clock } : {}) };
      });

      // Lights: house (hemisphere + key from the front) and the follow spot.
      const hemi = new THREE.HemisphereLight(0xfff6e8, 0x6a5040, HEMI);
      const key = new THREE.DirectionalLight(0xffffff, KEY);
      key.position.set(-3, 7, 9);
      const spot = new THREE.SpotLight(0xfff1cf, 0, 0, 0.3, 0.55, 1);
      spot.name = "spot";
      group.add(spot, spot.target);
      ctx.scene.add(hemi, key);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, POOL_R, 1, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: "#fff1cf", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.name = "beam";
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(POOL_R, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: "#fff1cf", map: blobTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      pool.name = "pool";
      group.add(beam, pool);
      ctx.scene.background = new THREE.Color("#241a20");

      b = { ctx, data, ev, group, set, actors, props, hemi, key, spot, beam, pool };
      update(spec.chapters[0]!.id, 0);
    },

    update,

    resolveAnchor(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3): boolean {
      if (!b) return false;
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if ("geo" in anchor) return false;
      const [W, D] = stageSize(b.data);
      let ok = false;
      if (anchor.entity === "set") {
        const pts: Record<string, [number, number, number]> = {
          center: [0, 1, 0],
          front: [0, 0.5, D / 2],
          backdrop: [0, OPENING_H / 2, -D / 2],
          left: [-W / 2 + 0.6, 1, 0],
          right: [W / 2 - 0.6, 1, 0],
        };
        const p = pts[anchor.part ?? "center"];
        if (p) {
          out.set(...p);
          ok = true;
        }
      } else if ((anchor.entity === "character" || anchor.entity === "prop") && anchor.part) {
        const [id, part] = anchor.part.split(".") as [string, string | undefined];
        ok = anchor.entity === "character" ? b.ev.characterPart(id, part, chapterId, t, tmp) : b.ev.propPart(id, part, chapterId, t, tmp);
        if (ok) out.set(tmp.x, tmp.y, tmp.z);
      }
      if (ok && anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
      return ok;
    },

    bounds() {
      if (!b) return { center: new THREE.Vector3(), radius: 1 };
      const [W, D] = stageSize(b.data);
      return { center: new THREE.Vector3(0, OPENING_H / 2, 0), radius: Math.hypot(W + 1.8, D + 0.5, OPENING_H + 0.8) / 2 };
    },

    params(chapterId: string): EngineParam[] {
      if (!b) return [];
      return b.ev.params(chapterId).map((p) => ({ id: p.id, label: p.label, min: p.min, max: p.max, step: p.step, value: p.value }));
    },

    setParams(values: Record<string, number> | null) {
      b?.ev.setOverrides(values);
    },

    dispose() {
      if (!b) return;
      const { ctx, group } = b;
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const m of mats) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
      for (const a of b.actors) a.mixer?.stopAllAction();
      ctx.root.remove(group);
      ctx.scene.remove(b.hemi, b.key);
      ctx.scene.background = null;
      b = null;
    },
  };
}
