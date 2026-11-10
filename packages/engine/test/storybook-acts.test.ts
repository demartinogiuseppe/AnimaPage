import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec, type StoryChapter } from "@pv/scene-spec";
import type { EngineContext } from "../src/index.ts";
import { castOf, spoutTimes, storyStateAt } from "../src/engines/storybook/acts.ts";
import { createStorybookEngine } from "../src/engines/storybook/index.ts";
import { storySoundsOf } from "../src/engines/storybook/sounds.ts";
import { STORY_LIBRARY } from "../src/engines/storybook/library.ts";
import { toonGradient } from "../src/engines/storybook/toon.ts";

const raw = (): any => JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/_dev-storie.scene.json", import.meta.url), "utf8"));
const specOf = (edit?: (j: any) => void): SceneSpec => {
  const j = raw();
  edit?.(j);
  return SceneSpec.parse(j);
};
const dataOf = (s: SceneSpec) => {
  if (s.engine !== "storybook") throw new Error("not a storybook");
  return s.engineData;
};
const chapterOf = (s: SceneSpec, id: string): StoryChapter => dataOf(s).chapters.find((c) => c.chapter === id)!;
const narrationOf = (s: SceneSpec, id: string) => s.chapters.find((c) => c.id === id)!.narration;
const state = (s: SceneSpec, id: string, t: number) => storyStateAt(chapterOf(s, id), dataOf(s).characters, narrationOf(s, id), t);
const snap = (m: Map<string, unknown>) => JSON.stringify([...m]);

async function built(spec: SceneSpec) {
  const engine = createStorybookEngine();
  const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
  await engine.build(ctx, spec);
  const content = ctx.root.children[0]!;
  return { engine, ctx, content };
}

describe("storybook acts", () => {
  it("the dev scene is valid", () => {
    expect(checkScene(specOf())).toEqual([]);
  });

  it("appear: absent before, popping during, present after", () => {
    const s = specOf();
    // mare: the whale appears at 1 s.
    expect(state(s, "mare", 0.5).get("balena")!.shown).toBe(0);
    const during = state(s, "mare", 1.2).get("balena")!.shown;
    expect(during).toBeGreaterThan(0);
    expect(during).not.toBe(1);
    let peak = 0;
    for (let t = 1; t <= 1.5; t += 0.01) peak = Math.max(peak, state(s, "mare", t).get("balena")!.shown);
    expect(peak).toBeGreaterThan(1.1);
    expect(peak).toBeLessThan(1.2);
    expect(state(s, "mare", 1.6).get("balena")!.shown).toBe(1);
    expect(state(s, "mare", 19).get("balena")!.shown).toBe(1);
  });

  it("scrubbing backwards gives the same scene", () => {
    const s = specOf();
    for (const id of ["mare", "tuffo", "prato", "cielo", "treno", "amici"]) {
      const fresh = snap(state(s, id, 4));
      const ch = chapterOf(s, id);
      const out = storyStateAt(ch, dataOf(s).characters, narrationOf(s, id), 4);
      storyStateAt(ch, dataOf(s).characters, narrationOf(s, id), 9, out);
      storyStateAt(ch, dataOf(s).characters, narrationOf(s, id), 4, out);
      expect(snap(out), id).toBe(fresh);
    }
  });

  it("only the chapter's own cast is on stage", async () => {
    const s = specOf();
    const data = dataOf(s);
    expect(castOf(chapterOf(s, "mare"), data.characters).sort()).toEqual(["balena", "barca", "bruco"]);
    expect(castOf(chapterOf(s, "prato"), data.characters)).toEqual(["bruco"]);
    expect([...state(s, "prato", 3).keys()]).toEqual(["bruco"]);
    const { engine, content } = await built(s);
    const shown = (): string[] => content.children.filter((c) => c.visible && data.characters.some((x) => x.model === c.name)).map((c) => c.name).sort();
    engine.update("prato", 5);
    expect(shown()).toEqual(["caterpillar"]);
    engine.update("mare", 15);
    expect(shown()).toEqual(["caterpillar", "sailboat", "whale"]);
    engine.update("amici", 15);
    expect(shown().length).toBe(8);
    engine.dispose();
  });

  it("a chapter that names nobody shows every character", () => {
    const s = specOf((j) => {
      j.engineData.chapters[4].acts = [];
    });
    expect(castOf(chapterOf(s, "treno"), dataOf(s).characters).length).toBe(dataOf(s).characters.length);
  });

  it("characters named without an appear act stand there from t = 0", () => {
    const s = specOf();
    expect(state(s, "mare", 0).get("bruco")!.shown).toBe(1);
    expect(state(s, "mare", 0).get("barca")!.shown).toBe(0);
  });

  it("row items appear one by one, each with its cue", () => {
    const s = specOf((j) => {
      const row = j.engineData.chapters[1].acts.find((a: any) => a.do === "row");
      row.who = ["balena", "barca", "ombrello"];
    });
    const row = chapterOf(s, "tuffo").acts!.find((a) => a.do === "row")!;
    if (row.do !== "row") throw new Error();
    const at = (k: number) => row.at + k * row.every;
    expect(state(s, "tuffo", at(0) - 0.1).get("balena")!.shown).toBe(0);
    expect(state(s, "tuffo", at(0) + 0.1).get("balena")!.shown).toBeGreaterThan(0);
    expect(state(s, "tuffo", at(1) - 0.1).get("barca")!.shown).toBe(0);
    expect(state(s, "tuffo", at(1) + 0.1).get("barca")!.shown).toBeGreaterThan(0);
    expect(state(s, "tuffo", at(2) - 0.1).get("ombrello")!.shown).toBe(0);
    expect(state(s, "tuffo", at(2) + 0.1).get("ombrello")!.shown).toBeGreaterThan(0);
    const cues = storySoundsOf(s).get("tuffo")!.cues;
    expect(cues.map((c) => c.at)).toEqual([at(0), at(1), at(2)]);
    expect(cues[0]!.sound).toMatch(/^sb:/);
  });

  it("appear with sound: false gives no cue; react sounds become cues", () => {
    const s = specOf();
    const mare = storySoundsOf(s).get("mare")!;
    // The whale appears at 1 (its own sound); the boat at 6 says sound: false.
    expect(mare.cues.map((c) => c.at)).toEqual([1]);
    const prato = storySoundsOf(s).get("prato")!.cues;
    expect(prato.map((c) => c.at)).toEqual([9]);
    expect(STORY_LIBRARY[prato[0]!.sound.slice(3)]!.group).toBe("boing");
    expect(STORY_LIBRARY[mare.cues[0]!.sound.slice(3)]!.group).toBe("whale-spout");
  });

  it("the speaker bobs only during its own sentences", () => {
    const s = specOf((j) => {
      const ch = j.chapters.find((c: any) => c.id === "prato");
      j.voices = [{ id: "bruco", name: "Bruco", lang: "it" }];
      ch.narration[0].speaker = "bruco";
    });
    const bob = (t: number) => state(s, "prato", t).get("bruco")!.bob;
    // Sentence 0 runs 0..5 (the caterpillar hops from 3 s: look before it moves).
    let during = 0;
    for (let t = 0; t < 1; t += 0.01) during = Math.max(during, bob(t));
    expect(during).toBeGreaterThan(0.005);
    // Sentence 1 (no speaker) from 5 s: no hop is under way between 8.5 and 9 s either.
    for (let t = 8.5; t < 9; t += 0.05) expect(bob(t), String(t)).toBe(0);
    // It is periodic at 3 Hz.
    expect(bob(0.1)).toBeCloseTo(bob(0.1 + 1 / 3), 6);
  });

  it("move: eased, ends on the target, and gaits add their own motion", () => {
    const s = specOf();
    // mare: the boat rocks while it sails 7..13 s to [3.5, 2].
    const mid = state(s, "mare", 10).get("barca")!;
    expect(Math.abs(mid.roll)).toBeGreaterThan(0.01);
    expect(Math.abs(mid.roll)).toBeLessThanOrEqual((8 * Math.PI) / 180 + 1e-9);
    const end = state(s, "mare", 14).get("barca")!;
    expect(end.pos[0]).toBeCloseTo(3.5, 6);
    expect(end.pos[1]).toBeCloseTo(2, 6);
    expect(end.roll).toBe(0);
    // prato: the caterpillar hops (lifted, never below the ground).
    let max = 0;
    for (let t = 3; t < 8; t += 0.02) {
      const b = state(s, "prato", t).get("bruco")!.bob;
      expect(b).toBeGreaterThanOrEqual(0);
      max = Math.max(max, b);
    }
    expect(max).toBeGreaterThan(0.05);
    // tuffo: the fish swims.
    const f = state(s, "tuffo", 10).get("pesce")!;
    expect(f.bob).toBeGreaterThanOrEqual(0);
    // treno: the train rolls: the wheel angle grows with the way travelled.
    expect(state(s, "treno", 8).get("treno")!.spin).toBeGreaterThan(state(s, "treno", 4).get("treno")!.spin);
  });

  it("a move that starts with the character's appearance is a placement", () => {
    const s = specOf();
    // tuffo: the whale is placed at t = 0 and appears at 1 s, where it stands (no sliding).
    const a = state(s, "tuffo", 1.2).get("balena")!.pos;
    const b = state(s, "tuffo", 12).get("balena")!.pos;
    expect(a).toEqual(b);
    expect(a).not.toEqual(dataOf(s).characters.find((c) => c.id === "balena")!.at);
  });

  it("reactions last 0.6 s and leave the character as before", () => {
    const s = specOf();
    expect(state(s, "cielo", 5.9).get("sole")!.yaw).toBe(0);
    expect(state(s, "cielo", 6.3).get("sole")!.yaw).not.toBe(0);
    expect(state(s, "cielo", 6.7).get("sole")!.yaw).toBeCloseTo(0, 6);
    expect(Math.abs(state(s, "cielo", 7.3).get("nuvola")!.roll)).toBeGreaterThan(0);
    expect(state(s, "cielo", 7.7).get("nuvola")!.roll).toBe(0);
  });

  it("the whale spouts on its appearance and its reactions", () => {
    const s = specOf();
    const chars = dataOf(s).characters;
    expect(spoutTimes(chapterOf(s, "mare"), chars, "balena")).toEqual([1, 12]);
    expect(spoutTimes(chapterOf(s, "mare"), chars, "barca")).toEqual([]);
  });

  it("anchors on characters resolve and wait for their appear act", async () => {
    const s = specOf();
    const { engine } = await built(s);
    const out = new THREE.Vector3();
    const top = { entity: "balena", part: "top" };
    const centre = { entity: "balena", part: "center" };
    engine.update("mare", 0.5);
    expect(engine.anchorShown!(top, "mare", 0.5)).toBe(false);
    engine.update("mare", 3);
    expect(engine.anchorShown!(top, "mare", 3)).toBe(true);
    expect(engine.resolveAnchor(top, "mare", 3, out)).toBe(true);
    const topY = out.y;
    expect(engine.resolveAnchor(centre, "mare", 3, out)).toBe(true);
    expect(out.y).toBeGreaterThan(0);
    expect(out.y).toBeLessThan(topY);
    const head = { entity: "balena", part: "head" };
    expect(engine.resolveAnchor(head, "mare", 3, out)).toBe(true);
    expect(engine.resolveAnchor({ entity: "balena", offset: [0, 1, 0] }, "mare", 3, out)).toBe(true);
    expect(engine.resolveAnchor({ entity: "nobody" }, "mare", 3, out)).toBe(false);
    // Not on stage in this chapter.
    expect(engine.resolveAnchor({ entity: "treno" }, "mare", 3, out)).toBe(false);
    expect(engine.anchorShown!({ entity: "treno" }, "mare", 3)).toBe(false);
    // A pin on an appear-later character waits, even without update() having been called for it.
    expect(engine.anchorShown!({ entity: "barca" }, "mare", 2)).toBe(false);
    expect(engine.anchorShown!({ entity: "barca" }, "mare", 7)).toBe(true);
    engine.dispose();
  });

  it("update is pure: the engine shows the same thing after scrubbing", async () => {
    const s = specOf();
    const { engine, content } = await built(s);
    const look = (): string =>
      JSON.stringify(content.children.filter((c) => c.visible).map((c) => [c.name, c.visible, c.position.toArray(), c.rotation.toArray().slice(0, 3), c.scale.toArray()]));
    engine.update("mare", 4);
    const a = look();
    engine.update("mare", 9);
    engine.update("tuffo", 2);
    engine.update("mare", 4);
    expect(look()).toBe(a);
    engine.dispose();
  });

  it("the whale's spout is driven by t alone and rests on the ground plane", async () => {
    const s = specOf();
    const { engine, content } = await built(s);
    const whale = content.children.find((c) => c.name === "whale")!;
    const spray = (): THREE.InstancedMesh => {
      let m: THREE.InstancedMesh | undefined;
      whale.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) m = o as THREE.InstancedMesh;
      });
      return m!;
    };
    expect(spray()).toBeDefined();
    engine.update("mare", 1.6);
    const a = spray().instanceMatrix.array.slice();
    expect(spray().visible).toBe(true);
    engine.update("mare", 8);
    expect(spray().visible).toBe(false);
    engine.update("mare", 1.6);
    expect(Array.from(spray().instanceMatrix.array)).toEqual(Array.from(a));
    // At rest and while spouting, nothing of the whale (drops included) is below the ground plane.
    for (const t of [8, 1.2, 1.6, 2.4, 3]) {
      engine.update("mare", t);
      content.updateMatrixWorld(true);
      expect(new THREE.Box3().setFromObject(whale, true).min.y, String(t)).toBeGreaterThanOrEqual(-1e-6);
    }
    engine.dispose();
  });

  it("dispose frees geometries and materials; build starts from clean places; bounds follow the place size", async () => {
    const s = specOf();
    const { engine, ctx, content } = await built(s);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    content.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
      geos.add(m.geometry);
      if (!o.userData.outline) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
    });
    expect(geos.size).toBeGreaterThan(20);
    const disposed = { geo: 0, mat: 0 };
    for (const g of geos) g.addEventListener("dispose", () => disposed.geo++);
    for (const m of mats) m.addEventListener("dispose", () => disposed.mat++);
    const b = engine.bounds();
    expect(b.radius).toBe(8);
    expect(b.center.y).toBe(1);
    // Building again on the same engine starts from clean places and frees the old content.
    await engine.build(ctx, s);
    expect(ctx.root.children.length).toBe(1);
    expect(ctx.root.children[0]).not.toBe(content);
    expect(disposed.geo).toBe(geos.size);
    expect(disposed.mat).toBe(mats.size);
    engine.dispose();
    expect(ctx.root.children.length).toBe(0);
  });

  it("after a chapter switch nobody from the previous cast is left on stage", async () => {
    const s = specOf();
    const data = dataOf(s);
    const out = storyStateAt(chapterOf(s, "mare"), data.characters, narrationOf(s, "mare"), 3);
    expect(out.has("bruco")).toBe(true);
    storyStateAt(chapterOf(s, "tuffo"), data.characters, narrationOf(s, "tuffo"), 3, out);
    expect(out.has("bruco")).toBe(false);
    expect([...out.keys()].sort()).toEqual(castOf(chapterOf(s, "tuffo"), data.characters).sort());
    const look = (content: THREE.Object3D): string =>
      JSON.stringify(content.children.map((c) => [c.name, c.visible, c.visible ? c.position.toArray() : 0, c.visible ? c.scale.toArray() : 0]));
    const a = await built(s);
    for (const id of ["mare", "tuffo", "prato", "cielo"]) a.engine.update(id, 3);
    const b = await built(s);
    b.engine.update("cielo", 3);
    expect(look(a.content)).toBe(look(b.content));
    a.engine.update("mare", 3);
    a.engine.update("tuffo", 3);
    expect(a.content.children.find((c) => c.name === "caterpillar")!.visible).toBe(false);
    a.engine.dispose();
    b.engine.dispose();
  });

  it("the speaker stops bobbing when its sentence ends", () => {
    const s = specOf((j) => {
      j.voices = [{ id: "bruco", name: "Bruco", lang: "it" }];
      const ch = j.chapters.find((c: any) => c.id === "prato");
      ch.narration[1].speaker = "bruco";
      ch.narration[1].text = "Ciao.";
    });
    const bob = (t: number) => state(s, "prato", t).get("bruco")!.bob;
    // The last sentence starts at 5 s and is one short word: long over by 11 s (the caterpillar is not moving then).
    let early = 0;
    for (let t = 5; t < 5.5; t += 0.01) early = Math.max(early, bob(t));
    expect(early).toBeGreaterThan(0.005);
    for (let t = 11; t < 12; t += 0.05) expect(bob(t), String(t)).toBe(0);
  });

  it("leaning (rock, wobble) never sinks a part below the ground", async () => {
    const s = specOf();
    const { engine, content } = await built(s);
    const lowest = (name: string): number => {
      content.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(content.children.find((c) => c.name === name)!, true).min.y;
    };
    let leaned = 0;
    for (let t = 7; t < 13; t += 0.2) {
      engine.update("mare", t);
      leaned = Math.max(leaned, Math.abs(state(s, "mare", t).get("barca")!.roll));
      expect(lowest("sailboat"), `boat ${t}`).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(leaned).toBeGreaterThan(0.05);
    leaned = 0;
    for (let t = 7; t < 7.7; t += 0.05) {
      engine.update("cielo", t);
      leaned = Math.max(leaned, Math.abs(state(s, "cielo", t).get("nuvola")!.roll));
      expect(lowest("cloud"), `cloud ${t}`).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(leaned).toBeGreaterThan(0.1);
    engine.dispose();
  });

  it("the ball rolls about an axis perpendicular to its travel", async () => {
    const s = specOf((j) => {
      j.engineData.chapters[2].acts.push({ do: "appear", who: "palla", at: 0 }, { do: "move", who: "palla", at: 0, dur: 1, to: [0, 0] }, { do: "move", who: "palla", at: 1, dur: 4, to: [0, 5], gait: "roll" });
    });
    const { engine, content } = await built(s);
    engine.update("prato", 3);
    const ball = content.children.find((c) => c.name === "ball")!;
    const pivot = ball.children[0] as THREE.Group;
    expect(pivot.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);
    // The ball travels along the depth (towards +z): it turns about x, not about z.
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(pivot.quaternion);
    expect(axis.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-6);
    engine.dispose();
  });

  it("two overlapping builds leave one stage", async () => {
    const s = specOf();
    const engine = createStorybookEngine();
    const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
    await Promise.all([engine.build(ctx, s), engine.build(ctx, s)]);
    expect(ctx.root.children.length).toBe(1);
    expect(ctx.root.children[0]!.children.filter((c) => c.name === "whale").length).toBe(1);
    engine.dispose();
  });

  it("a hidden character neither resolves nor counts as shown", async () => {
    const s = specOf();
    const { engine } = await built(s);
    const out = new THREE.Vector3();
    engine.update("mare", 0.5);
    expect(engine.anchorShown!({ entity: "balena" }, "mare", 0.5)).toBe(false);
    expect(engine.resolveAnchor({ entity: "balena" }, "mare", 0.5, out)).toBe(false);
    engine.dispose();
  });

  it("disposing one engine leaves the shared gradient and outline material alone for the next", async () => {
    const s = specOf();
    const first = await built(s);
    const hulls = new Set<THREE.Material>();
    first.content.traverse((o) => {
      if (o.userData.outline) hulls.add((o as THREE.Mesh).material as THREE.Material);
    });
    expect(hulls.size).toBeGreaterThan(0);
    let freed = 0;
    toonGradient().addEventListener("dispose", () => freed++);
    for (const m of hulls) m.addEventListener("dispose", () => freed++);
    first.engine.dispose();
    expect(freed).toBe(0);
    const second = await built(s);
    second.engine.update("mare", 3);
    let toon = 0;
    second.content.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.outline) return;
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
        const g = (x as THREE.MeshToonMaterial).gradientMap;
        if (g) {
          toon++;
          expect(g).toBe(toonGradient());
        }
      }
    });
    expect(toon).toBeGreaterThan(20);
    expect(freed).toBe(0);
    second.engine.dispose();
  });
});
