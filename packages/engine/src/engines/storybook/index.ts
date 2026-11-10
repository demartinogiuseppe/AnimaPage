// `storybook` engine (Storie): children's stories with procedural cartoon characters and sounds on
// words. Grammar and checks: packages/scene-spec/src/engines/storybook.ts. It builds the look (toon
// characters, places) and acts it out in chapter time (acts.ts); update(chapterId, t) is pure in its
// arguments, so the timeline scrubs both ways.
import * as THREE from "three";
import { dioramaModel, storyCharacter, type Anchor, type SceneSpec, type StoryChapter } from "@pv/scene-spec";
import type { Engine, EngineContext, TouchPlayView } from "../../types.ts";
import { loadModels } from "../diorama/models.ts";
import { isShown, smooth, spoutTimes, storyStateAt, type StoryState } from "./acts.ts";
import { buildCharacter } from "./characters.ts";
import { PALETTE, PLAY_SLACK, PlayRun, type Verdict } from "./play.ts";
import { buildPlace, placeUpdate } from "./places.ts";
import { lessonSeed, pickVariant, sentenceWordTimes, storySoundsOf, tapGroupOf, type ChapterStorySounds } from "./sounds.ts";
import { toonGradient, toonMaterial } from "./toon.ts";
import { bounceAt, BOUNCE_SECONDS, hitDistance, hitRadius, SOUND_GAP_MS, WOBBLE_SECONDS, wobbleAt, type Squash } from "./touch.ts";

type Id = string;

/** Edge of a place in world units: the stage and its bounding sphere come from this one number. */
const PLACE_SIZE = 16;

const SPRAY_COUNT = 14;
/** Seconds a spout lasts, from its start to the last drop falling. */
const SPRAY_LIFE = 2.2;
const SPRAY_GRAVITY = 3;

/** A small fountain of drops over the whale's back: every drop is a function of the time since the spout began. */
interface Spray {
  mesh: THREE.InstancedMesh;
  origin: THREE.Vector3;
  /** Per drop: sideways direction (x, z), launch speed, delay, size. Fixed numbers, no randomness at run time. */
  seeds: { dx: number; dz: number; vy: number; delay: number; size: number }[];
}

interface Rig {
  obj: THREE.Group;
  base: number;
  /** Unscaled height of the character, for anchors. */
  height: number;
  /** Unscaled half depth (z): leaning about the forward axis lifts the character by this much times sin(lean). */
  halfDepth: number;
  /** Spins about its centre when it rolls (the ball). */
  pivot?: THREE.Group;
  wheels: THREE.Object3D[];
  spray?: Spray;
  /** Height of the middle of the unscaled box and the radius a finger may hit (see touch.ts). */
  centreY: number;
  hit: number;
  /** Transient reactions: start times in ms (-Infinity = none), last tap sound, taps so far. */
  bounceFrom: number;
  wobbleFrom: number;
  soundAt: number;
  taps: number;
  /** The catalogue sound group of the character; "boing" when it has none. */
  group: string;
  /** Colourable parts by name (procedural characters; the toon materials are this character's own). */
  parts: Map<string, THREE.Mesh[]>;
}

/** With reduced motion the small reactions keep this fraction of their size. */
const CALM = 0.3;

function buildSpray(obj: THREE.Group, box: THREE.Box3): Spray {
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 7), toonMaterial("#bfe3ff"), SPRAY_COUNT);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = "spray";
  mesh.raycast = () => {};
  obj.add(mesh);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // Fixed fan of drops: golden-angle directions, a few speeds.
  const seeds = Array.from({ length: SPRAY_COUNT }, (_, i) => {
    const a = i * 2.399963;
    const r = 0.12 + 0.28 * ((i * 7) % SPRAY_COUNT) / SPRAY_COUNT;
    return { dx: Math.cos(a) * r, dz: Math.sin(a) * r * 0.6, vy: 2.3 + 0.7 * (((i * 5) % SPRAY_COUNT) / SPRAY_COUNT), delay: (i % 5) * 0.06, size: 0.75 + 0.5 * (((i * 3) % SPRAY_COUNT) / SPRAY_COUNT) };
  });
  // At rest every drop is a point on the ground (nothing sticks out below y = 0).
  dummy.position.set(0, 0, 0);
  dummy.scale.setScalar(0);
  dummy.updateMatrix();
  for (let i = 0; i < SPRAY_COUNT; i++) mesh.setMatrixAt(i, dummy.matrix);
  return { mesh, origin: new THREE.Vector3(centre.x + size.x * 0.1, box.max.y * 0.97, 0), seeds };
}

const dummy = new THREE.Object3D();

/** Lays the drops of one spout out at `age` seconds after it began (null = no spout now). Pure in age. */
function sprayAt(sp: Spray, age: number | null): void {
  sp.mesh.visible = age !== null;
  if (age === null) return;
  sp.seeds.forEach((d, i) => {
    const a = age - d.delay;
    if (a < 0 || a > SPRAY_LIFE - 0.4) {
      dummy.position.set(0, 0, 0);
      dummy.scale.setScalar(0);
    } else {
      const fade = 1 - smooth((a - 1.1) / 0.7);
      dummy.position.set(sp.origin.x + d.dx * a, sp.origin.y + d.vy * a - 0.5 * SPRAY_GRAVITY * a * a, sp.origin.z + d.dz * a);
      dummy.scale.setScalar(d.size * fade);
    }
    dummy.updateMatrix();
    sp.mesh.setMatrixAt(i, dummy.matrix);
  });
  sp.mesh.instanceMatrix.needsUpdate = true;
}

/** Frees every geometry and material under `root` once (the outline hulls share one cached material: left alone). */
export function disposeTree(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const inst: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    geos.add(m.geometry);
    if ((o as THREE.InstancedMesh).isInstancedMesh) inst.push(o as THREE.InstancedMesh);
    if (o.userData.outline) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
  });
  // A GLB's own textures (map, normalMap, ...) belong to the cloned materials too; the shared toon gradient does not.
  const texs = new Set<THREE.Texture>();
  for (const m of mats) for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture && v !== toonGradient()) texs.add(v as THREE.Texture);
  texs.forEach((t) => t.dispose());
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  inst.forEach((m) => m.dispose());
}

export function createStorybookEngine(): Engine {
  let group: THREE.Group | null = null;
  let spec: SceneSpec | null = null;
  let sounds = new Map<string, ChapterStorySounds>();
  const places = new Map<string, THREE.Group>();
  const rigs = new Map<Id, Rig>();
  const states = new Map<Id, StoryState>();
  let stamp: { chapter: string; t: number } | null = null;
  /** Activity progress per chapter and the picked colour: kept for the whole lesson session, never saved. */
  const runs = new Map<string, PlayRun | null>();
  let picked: number | undefined;
  /** The views handed out by play(): the same object until a touch or a choice changes it. */
  const views = new Map<string, TouchPlayView>();
  let calm = false;
  const scratch = new Map<Id, StoryState>();
  const ray = new THREE.Ray();
  const raycaster = new THREE.Raycaster();
  const hits: THREE.Intersection[] = [];
  /** Counts builds and disposals: a build that finds it changed after its await is stale and stops. */
  let token = 0;
  const axis = new THREE.Vector3();
  const squash: Squash = { sx: 1, sy: 1 };
  const centre = new THREE.Vector3();

  function free(): void {
    token++;
    if (group) {
      group.removeFromParent();
      disposeTree(group);
    }
    group = null;
    places.clear();
    rigs.clear();
    states.clear();
    stamp = null;
    runs.clear();
    views.clear();
    picked = undefined;
  }

  const chapterOf = (chapterId: string): StoryChapter | undefined => (spec?.engine === "storybook" ? spec.engineData.chapters.find((c) => c.chapter === chapterId) : undefined);

  /** The chapter's activity run (made on first use), null when it has none. */
  function runOf(chapterId: string): PlayRun | null {
    const known = runs.get(chapterId);
    if (known !== undefined) return known;
    const ch = chapterOf(chapterId);
    const sc = spec?.chapters.find((c) => c.id === chapterId);
    let run: PlayRun | null = null;
    if (ch?.play && sc && spec?.engine === "storybook") {
      const chars = spec.engineData.characters;
      // Who is on stage when the chapter ends: the touchable cast.
      storyStateAt(ch, chars, sc.narration, sc.duration, scratch, spec.lang);
      const onStage = [...scratch].filter(([, st]) => isShown(st)).map(([id]) => id);
      scratch.clear();
      const who = ch.play.kind === "color" ? ch.play : null;
      const parts = who ? storyCharacter(chars.find((c) => c.id === who.who)?.model ?? "")?.parts ?? [] : [];
      run = new PlayRun(ch.play, onStage, parts);
      // Nothing the child could reach (targets that are not on stage, no colourable part): no activity is offered.
      if (run.total === 0) run = null;
    }
    runs.set(chapterId, run);
    return run;
  }

  /** Is the chapter's activity live at (chapterId, t)? From the end of the chapter on, until it is done. */
  function liveRun(chapterId: string, t: number): PlayRun | null {
    const sc = spec?.chapters.find((c) => c.id === chapterId);
    const run = runOf(chapterId);
    return run && sc && t >= sc.duration - PLAY_SLACK && !run.complete ? run : null;
  }

  /** The part of `rig` a touch paints: the one under the ray (a world ray is made from the root-local one), see PlayRun.target. */
  function partUnder(rig: Rig, localRay: THREE.Ray, run: PlayRun): string | undefined {
    const root = group?.parent;
    ray.copy(localRay);
    if (root) {
      root.updateWorldMatrix(true, false);
      ray.applyMatrix4(root.matrixWorld);
    }
    group?.updateWorldMatrix(true, true);
    raycaster.ray.copy(ray);
    raycaster.far = Infinity;
    let best: string | undefined;
    let bestD = Infinity;
    for (const [name, meshes] of rig.parts) {
      hits.length = 0;
      for (const m of meshes) m.raycast(raycaster, hits);
      for (const h of hits) if (h.distance < bestD) ((bestD = h.distance), (best = name));
    }
    hits.length = 0;
    return run.target(best);
  }

  /** The state of the cast at (chapterId, t). Shared by update and the anchors, so they agree and nothing is allocated per frame. */
  function statesAt(chapterId: string, t: number): Map<Id, StoryState> {
    if (stamp && stamp.chapter === chapterId && stamp.t === t) return states;
    const ch = chapterOf(chapterId);
    if (!ch || spec?.engine !== "storybook") states.clear();
    else storyStateAt(ch, spec.engineData.characters, spec.chapters.find((c) => c.id === chapterId)?.narration ?? [], t, states, spec.lang);
    if (stamp) {
      stamp.chapter = chapterId;
      stamp.t = t;
    } else stamp = { chapter: chapterId, t };
    return states;
  }

  return {
    async build(ctx: EngineContext, s: SceneSpec) {
      free();
      const mine = token;
      spec = s;
      calm = !!ctx.reducedMotion;
      sounds = storySoundsOf(s);
      group = new THREE.Group();
      // The content draws its own lines and colours: the China style must not restyle it.
      group.userData.inkSelf = true;
      // Its ground rests exactly on the paper of the pop-up book (no lift), see Stage / bookLayout.
      group.userData.onPage = true;
      ctx.root.add(group);
      group.add(new THREE.HemisphereLight(0xffffff, 0xb9c4d6, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(-6, 12, 8);
      group.add(key);
      if (s.engine !== "storybook") return;
      const data = s.engineData;
      for (const c of data.chapters) {
        if (places.has(c.place)) continue;
        const p = buildPlace(c.place, PLACE_SIZE);
        p.visible = false;
        places.set(c.place, p);
        group.add(p);
      }
      const defs = data.characters.map((c) => ({ c, def: storyCharacter(c.model) }));
      const files = defs.flatMap(({ def }) => (def && "model" in def.source ? [dioramaModel(def.source.model)?.file].filter((f): f is string => !!f) : []));
      const models = await loadModels(files, ctx.loadAsset, !!ctx.createCanvas);
      if (mine !== token || group === null) return;
      for (const { c, def } of defs) {
        if (!def) continue;
        const { obj, parts } = buildCharacter(def, models);
        const box = new THREE.Box3().setFromObject(obj);
        const rig: Rig = { obj, base: c.scale ?? 1, height: box.max.y, halfDepth: box.getSize(new THREE.Vector3()).z / 2, wheels: [], centreY: box.getCenter(new THREE.Vector3()).y, hit: hitRadius(box.getSize(new THREE.Vector3()).length(), c.scale ?? 1), bounceFrom: -Infinity, wobbleFrom: -Infinity, soundAt: -Infinity, taps: 0, group: tapGroupOf(def), parts: new Map() };
        rig.parts = parts;
        // Yaw first, then lean about the forward axis.
        obj.rotation.order = "YXZ";
        if (def.id === "ball") {
          const inner = obj.children[0]!;
          const cy = box.getCenter(new THREE.Vector3()).y;
          const pivot = new THREE.Group();
          pivot.position.y = cy;
          inner.position.y -= cy;
          pivot.add(inner);
          obj.add(pivot);
          rig.pivot = pivot;
        }
        obj.traverse((o) => {
          if (o.name === "wheel" && !o.userData.outline) {
            // Axle along z: spinning is a turn about the parent's z.
            o.rotation.order = "ZXY";
            rig.wheels.push(o);
          }
        });
        if (def.id === "whale") rig.spray = buildSpray(obj, box);
        obj.position.set(c.at[0], 0, c.at[1]);
        obj.scale.setScalar(rig.base);
        obj.visible = false;
        group.add(obj);
        rigs.set(c.id, rig);
      }
    },
    update(chapterId: string, t: number) {
      const ch = chapterOf(chapterId);
      for (const [id, p] of places) {
        p.visible = id === ch?.place;
        if (p.visible) placeUpdate(p, t);
      }
      if (spec?.engine !== "storybook") return;
      const now = statesAt(chapterId, t);
      for (const [id, rig] of rigs) {
        const st = now.get(id);
        const vis = isShown(st);
        rig.obj.visible = vis;
        if (!st || !vis) continue;
        const k = rig.base * st.shown;
        const wide = k * (1 - st.squash * 0.5);
        // A lean about the forward axis turns about the base: lift by what the low side would sink.
        const lift = rig.halfDepth * k * Math.sin(Math.abs(st.roll));
        rig.obj.position.set(st.pos[0], st.bob + lift, st.pos[1]);
        rig.obj.rotation.set(st.roll, st.yaw, 0);
        rig.obj.scale.set(wide, k * (1 + st.squash), wide);
        // The ball rolls across its heading: about the horizontal axis perpendicular to it.
        if (rig.pivot) rig.pivot.quaternion.setFromAxisAngle(axis.set(-Math.sin(st.heading), 0, -Math.cos(st.heading)), st.spin);
        for (const w of rig.wheels) w.rotation.z = -st.spin;
        if (rig.spray && ch) {
          // The latest spout that began at or before t, while it lasts.
          let age: number | null = null;
          for (const s of spoutTimes(ch, spec.engineData.characters, id)) if (s <= t && t - s < SPRAY_LIFE) age = t - s;
          sprayAt(rig.spray, age);
        }
      }
    },
    resolveAnchor(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3) {
      if (!("entity" in anchor)) return false;
      const st = statesAt(chapterId, t).get(anchor.entity);
      const rig = rigs.get(anchor.entity);
      if (!isShown(st) || !rig) return false;
      const h = rig.height * rig.base * (1 + st.squash) * Math.min(1, st.shown);
      const y = anchor.part === "top" ? h + 0.25 : anchor.part === "head" ? h * 0.85 : h * 0.5;
      const o = anchor.offset;
      out.set(st.pos[0] + (o?.[0] ?? 0), st.bob + y + (o?.[1] ?? 0), st.pos[1] + (o?.[2] ?? 0));
      return true;
    },
    anchorShown(anchor: Anchor, chapterId: string, t: number) {
      if (!("entity" in anchor)) return true;
      const st = statesAt(chapterId, t).get(anchor.entity);
      return isShown(st);
    },
    tap(chapterId, t, tapRay, now, canSound) {
      if (spec?.engine !== "storybook") return null;
      const all = statesAt(chapterId, t);
      let best: string | null = null;
      let bestD = Infinity;
      for (const [id, rig] of rigs) {
        const st = all.get(id);
        if (!isShown(st)) continue;
        centre.set(st.pos[0], st.bob + rig.centreY * rig.base * Math.min(1, st.shown) * (1 + st.squash), st.pos[1]);
        const d = hitDistance(tapRay, centre, rig.hit);
        if (d !== null && d < bestD) {
          bestD = d;
          best = id;
        }
      }
      const rig = best ? rigs.get(best) : undefined;
      if (!best || !rig) return null;
      const seed = lessonSeed(spec);
      // The activity takes the touch first (see play.ts); "ignore" = touch to hear.
      let verdict: Verdict = "ignore";
      let joy: string | null = null;
      let finished = false;
      const run = liveRun(chapterId, t);
      if (run && run.concerns(best)) {
        if (run.kind === "color") {
          const part = picked === undefined ? undefined : partUnder(rig, tapRay, run);
          if (part !== undefined && picked !== undefined) {
            verdict = run.paint(part);
            for (const m of rig.parts.get(part) ?? []) (m.material as THREE.MeshToonMaterial).color.set(PALETTE[picked]!);
            joy = "sparkle";
          }
        } else {
          verdict = run.tap(best);
          if (run.kind !== "touch") joy = "xylophone-up";
        }
        finished = verdict !== "ignore" && run.complete;
      }
      // The bounce always restarts from its beginning (a wobble for "not this one"); the sound is rate limited.
      if (verdict === "wobble") rig.wobbleFrom = now;
      else rig.bounceFrom = now;
      if (verdict !== "ignore") views.delete(chapterId);
      // The ta-da is the reward for finishing: it bypasses both tap limiters (the character's slot and the
      // player's global one), so a quick last touch never swallows it.
      if (finished) return { sound: pickVariant("ta-da", seed, 0), complete: true };
      // The character's own slot is spent only when the player's global limit lets the sound through.
      if (now - rig.soundAt < SOUND_GAP_MS) return {};
      if (canSound && !canSound(now)) return {};
      rig.soundAt = now;
      if (verdict === "wobble") return { sound: pickVariant("boing", seed, rig.taps++) };
      // A note that climbs with every character found; the colouring sparkles at every brush.
      if (verdict === "good" && joy) return { sound: pickVariant(joy, joy === "sparkle" ? seed : 0, run!.done - 1) };
      return { sound: pickVariant(rig.group, seed, rig.taps++) };
    },
    play(chapterId) {
      const run = runOf(chapterId);
      if (!run || spec?.engine !== "storybook") return null;
      const known = views.get(chapterId);
      if (known) return known;
      const p = run.play;
      const view: TouchPlayView = {
        kind: p.kind,
        prompt: p.prompt,
        ...(p.kind === "letter" && spec.engineData.letter ? { letter: spec.engineData.letter } : {}),
        ...(p.kind === "color" ? { palette: PALETTE, ...(picked !== undefined ? { picked } : {}) } : {}),
        progress: { done: run.done, total: run.total },
        stamp: p.stamp,
        complete: run.complete,
        marks: run.marks(),
      };
      views.set(chapterId, view);
      return view;
    },
    choose(_chapterId, value) {
      if (Number.isInteger(value) && value >= 0 && value < PALETTE.length && value !== picked) {
        picked = value;
        views.clear();
      }
    },
    wobble(id, now) {
      const rig = rigs.get(id);
      if (rig) rig.wobbleFrom = now;
    },
    animate(now) {
      for (const rig of rigs.values()) {
        if (!rig.obj.visible) continue;
        const bounce = (now - rig.bounceFrom) / 1000;
        if (bounce >= 0 && bounce < BOUNCE_SECONDS) {
          bounceAt(bounce, squash);
          // Reduced motion: a small nudge instead of the full squash and stretch.
          const k = calm ? CALM : 1;
          rig.obj.scale.x *= 1 + (squash.sx - 1) * k;
          rig.obj.scale.z *= 1 + (squash.sx - 1) * k;
          rig.obj.scale.y *= 1 + (squash.sy - 1) * k;
        }
        const wobble = (now - rig.wobbleFrom) / 1000;
        if (wobble >= 0 && wobble < WOBBLE_SECONDS) rig.obj.rotation.z += wobbleAt(wobble) * (calm ? CALM : 1);
      }
    },
    sounds: (chapterId) => sounds.get(chapterId) ?? null,
    words: (chapterId) => {
      const ch = spec?.chapters.find((c) => c.id === chapterId);
      return ch && spec ? ch.narration.map((_, i) => sentenceWordTimes(spec!, ch, i)) : null;
    },
    bounds: () => ({ center: new THREE.Vector3(0, 1, 0), radius: PLACE_SIZE / 2 }),
    dispose() {
      free();
    },
  };
}
