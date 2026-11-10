import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec, STORY_CHARACTERS, STORY_PLACES, storyCharacter } from "@pv/scene-spec";
import { backdropsOf } from "../src/book/layout.ts";
import type { EngineContext } from "../src/index.ts";
import { InkStyler } from "../src/book/ink.ts";
import { createStorybookEngine } from "../src/engines/storybook/index.ts";
import { buildCharacter } from "../src/engines/storybook/characters.ts";
import { buildPlace, GROUND_THICKNESS, placeUpdate, waveHeight } from "../src/engines/storybook/places.ts";
import { addOutline, toonGradient, toonMaterial } from "../src/engines/storybook/toon.ts";

const procs = STORY_CHARACTERS.filter((c) => "proc" in c.source);
const meshesOf = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((x) => {
    if ((x as THREE.Mesh).isMesh && !x.userData.outline) out.push(x as THREE.Mesh);
  });
  return out;
};

describe("storybook look", () => {
  it("every procedural character builds, has its named parts, and is centred on its base", () => {
    expect(procs.length).toBe(8);
    for (const def of procs) {
      const { obj, parts } = buildCharacter(def, new Map());
      for (const p of def.parts ?? []) expect(parts.get(p)?.length, `${def.id}.${p}`).toBeGreaterThan(0);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      expect(box.min.y, def.id).toBeCloseTo(0, 3);
      expect(c.x, def.id).toBeCloseTo(0, 3);
      expect(c.z, def.id).toBeCloseTo(0, 3);
      expect(box.getSize(new THREE.Vector3()).y).toBeGreaterThan(0.2);
    }
  });

  it("the caterpillar has 5 to 7 body spheres", () => {
    const { parts } = buildCharacter(procs.find((c) => c.id === "caterpillar")!, new Map());
    expect(parts.get("body")!.length).toBeGreaterThanOrEqual(5);
    expect(parts.get("body")!.length).toBeLessThanOrEqual(7);
  });

  it("the caterpillar has a face: eyes, a smile, antennae", () => {
    const { obj } = buildCharacter(procs.find((c) => c.id === "caterpillar")!, new Map());
    const names = meshesOf(obj).map((m) => (m.material as THREE.MeshToonMaterial).color.getHexString());
    expect(names.filter((c) => c === "fffaf0").length).toBeGreaterThanOrEqual(2);
    expect(meshesOf(obj).filter((m) => m.geometry instanceof THREE.TorusGeometry).length).toBeGreaterThanOrEqual(1);
    expect(names.filter((c) => c === "e63946").length).toBeGreaterThanOrEqual(2);
  });

  it("toon materials have at most two tones", () => {
    const g = toonGradient();
    expect(g.image.width).toBeLessThanOrEqual(2);
    expect(toonGradient()).toBe(g);
    const m = toonMaterial("#ff0000");
    expect(m).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(m.gradientMap).toBe(g);
    for (const def of procs) for (const mesh of meshesOf(buildCharacter(def, new Map()).obj)) expect((mesh.material as THREE.MeshToonMaterial).gradientMap).toBe(g);
  });

  it("every character mesh has an outline", () => {
    for (const def of procs) {
      const { obj } = buildCharacter(def, new Map());
      const ms = meshesOf(obj);
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) {
        const hull = m.children.find((c) => c.userData.outline) as THREE.Mesh | undefined;
        expect(hull, `${def.id}/${m.name}`).toBeDefined();
        expect((hull!.material as THREE.ShaderMaterial).side).toBe(THREE.BackSide);
      }
    }
    const lone = new THREE.Mesh(new THREE.SphereGeometry(1), toonMaterial("#fff"));
    addOutline(lone, 2.5);
    expect(lone.children.length).toBe(1);
  });

  it("China style leaves storybook content alone", async () => {
    const engine = createStorybookEngine();
    const spec = SceneSpec.parse(JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/_dev-storie.scene.json", import.meta.url), "utf8")));
    const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
    await engine.build(ctx, spec);
    expect(ctx.root.children[0]!.userData.inkSelf).toBe(true);
    const before = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    for (const m of meshesOf(ctx.root)) before.set(m, m.material);
    expect(before.size).toBeGreaterThan(20);
    ctx.root.updateMatrixWorld(true);
    const styler = new InkStyler(ctx.root);
    styler.setEnabled(true);
    styler.begin({ keyPoints: [], radius: 1, width: 1280, height: 800, pixelRatio: 1 });
    for (const [m, mat] of before) expect(m.material).toBe(mat);
    expect(styler.overlay.children.filter((c) => (c as THREE.Mesh).isMesh).length).toBe(0);
    styler.end();
    styler.dispose();
  });

  it("places build, and sea crests are a pure function of t", () => {
    for (const p of STORY_PLACES) {
      const g = buildPlace(p, 16);
      expect(meshesOf(g).length, p).toBeGreaterThanOrEqual(3);
    }
    expect(waveHeight(1.2, -3, 4.5)).toBe(waveHeight(1.2, -3, 4.5));
    expect(waveHeight(1.2, -3, 0)).not.toBe(waveHeight(1.2, -3, 1));
    const sea = buildPlace("sea", 16);
    const crests = meshesOf(sea).filter((m) => m.name === "crest");
    expect(crests.length).toBeGreaterThanOrEqual(8);
    const at = (t: number) => {
      placeUpdate(sea, t);
      return crests.map((m) => m.position.toArray());
    };
    const a = at(2);
    at(7);
    expect(at(2)).toEqual(a);
    expect(at(3)).not.toEqual(a);
    // 2-3 blues, each crest outlined.
    expect(new Set(crests.map((m) => (m.material as THREE.MeshToonMaterial).color.getHexString())).size).toBeLessThanOrEqual(3);
    for (const m of crests) expect(m.children.some((c) => c.userData.outline)).toBe(true);
  });

  it("every place's ground top is y = 0, nothing is lower than the ground, and the sky is the only backdrop", () => {
    for (const p of STORY_PLACES) {
      const g = buildPlace(p, 16);
      for (const t of [0, 1.7, 9]) {
        placeUpdate(g, t);
        g.updateMatrixWorld(true);
        const ground = meshesOf(g).find((m) => m.name === "ground")!;
        expect(new THREE.Box3().setFromObject(ground).max.y, p).toBeCloseTo(0, 6);
        const low = new THREE.Box3();
        for (const m of meshesOf(g)) if (m.name !== "sky") low.union(new THREE.Box3().setFromObject(m));
        expect(low.min.y, p).toBeGreaterThanOrEqual(-GROUND_THICKNESS - 1e-6);
      }
      expect(backdropsOf(g, 8).map((o) => o.name), p).toEqual(["sky"]);
    }
    const sky = buildPlace("sky", 16);
    expect(sky.getObjectByName("decor-sun")).toBeDefined();
    expect(sky.children.filter((c) => c.name === "decor-cloud").length).toBeGreaterThanOrEqual(2);
  });

  it("characters rest on the ground (y = 0) and the content is flagged to sit on the page", async () => {
    const spec = SceneSpec.parse(JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/_dev-storie.scene.json", import.meta.url), "utf8")));
    const engine = createStorybookEngine();
    const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
    await engine.build(ctx, spec);
    const content = ctx.root.children[0]!;
    expect(content.userData.onPage).toBe(true);
    ctx.root.updateMatrixWorld(true);
    const named = content.children.filter((c) => spec.engine === "storybook" && spec.engineData.characters.some((x) => storyCharacter(x.model)?.id === c.name));
    expect(named.length).toBeGreaterThanOrEqual(8);
    for (const c of named) expect(new THREE.Box3().setFromObject(c).min.y, c.name).toBeCloseTo(0, 3);
  });

  it("the dev scene builds with placeholders in Node", async () => {
    const spec = SceneSpec.parse(JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/_dev-storie.scene.json", import.meta.url), "utf8")));
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "storybook") throw new Error("not a storybook");
    expect(new Set(spec.engineData.chapters.map((c) => c.place))).toEqual(new Set(STORY_PLACES));
    const engine = createStorybookEngine();
    const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
    await engine.build(ctx, spec);
    for (const ch of spec.chapters) {
      engine.update(ch.id, 3);
      engine.update(ch.id, 3);
    }
    const fish = buildCharacter(STORY_CHARACTERS.find((c) => c.id === "fish")!, new Map([["models/fish.glb", null]]));
    expect(meshesOf(fish.obj).length).toBeGreaterThan(0);
    engine.dispose();
  });
});
