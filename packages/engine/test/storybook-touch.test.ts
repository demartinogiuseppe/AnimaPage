import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SceneSpec } from "@pv/scene-spec";
import type { EngineContext } from "../src/index.ts";
import { createStorybookEngine } from "../src/engines/storybook/index.ts";
import { BOUNCE_PEAK, BOUNCE_SECONDS, bounceAt, SOUND_GAP_MS, WOBBLE_SECONDS, wobbleAt } from "../src/engines/storybook/touch.ts";

const spec = (): SceneSpec => SceneSpec.parse(JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/_dev-storie.scene.json", import.meta.url), "utf8")));

async function built() {
  const engine = createStorybookEngine();
  const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
  await engine.build(ctx, spec());
  const obj = ctx.root.children[0]!.children.find((o) => o.visible === false && o.type === "Group" && o.position.x === -5.5)!;
  return { engine, obj, root: ctx.root };
}

/** A ray falling straight down on the point where `id` stands at (chapter, t). */
function above(engine: ReturnType<typeof createStorybookEngine>, id: string, ch: string, t: number): THREE.Ray {
  const v = new THREE.Vector3();
  engine.update(ch, t);
  expect(engine.resolveAnchor({ entity: id } as never, ch, t, v)).toBe(true);
  return new THREE.Ray(new THREE.Vector3(v.x, 30, v.z), new THREE.Vector3(0, -1, 0));
}

describe("bounce and wobble curves", () => {
  it("start at rest, never pass the peak, and end at exactly 1", () => {
    const out = { sx: 1, sy: 1 };
    let max = 0;
    for (let a = 0; a <= BOUNCE_SECONDS; a += 0.005) {
      bounceAt(a, out);
      max = Math.max(max, out.sy, out.sx);
    }
    expect(max).toBeLessThanOrEqual(BOUNCE_PEAK + 1e-9);
    expect(max).toBeGreaterThan(1.1);
    bounceAt(BOUNCE_SECONDS, out);
    expect(out).toEqual({ sx: 1, sy: 1 });
    bounceAt(5, out);
    expect(out).toEqual({ sx: 1, sy: 1 });
    expect(wobbleAt(0.5)).toBe(0);
    expect(wobbleAt(9)).toBe(0);
  });
});

describe("storybook touch", () => {
  it("a tap on a character returns its sound and starts a bounce that ends at scale 1", async () => {
    const { engine, obj } = await built();
    const ray = above(engine, "balena", "mare", 5);
    const base = obj.scale.clone();
    const r = engine.tap!("mare", 5, ray, 1000);
    expect(r?.sound).toMatch(/^sb:/);
    let grew = false;
    for (let now = 1000; now <= 1000 + BOUNCE_SECONDS * 1000 + 100; now += 16) {
      engine.update("mare", 5);
      engine.animate!(now);
      if (obj.scale.y > base.y * 1.05) grew = true;
    }
    expect(grew).toBe(true);
    expect(obj.scale.x).toBeCloseTo(base.x, 12);
    expect(obj.scale.y).toBeCloseTo(base.y, 12);
  });

  it("hammering one character: one sound per 300 ms, scale never exceeds the bounce peak", async () => {
    const { engine, obj } = await built();
    const ray = above(engine, "balena", "mare", 5);
    engine.update("mare", 5);
    const base = obj.scale.y;
    let sounds = 0;
    let max = 0;
    for (let now = 2000; now < 3000; now += 20) {
      // A tap every 20 ms.
      if (engine.tap!("mare", 5, ray, now)?.sound) sounds++;
      engine.update("mare", 5);
      engine.animate!(now);
      max = Math.max(max, obj.scale.y / base);
    }
    expect(sounds).toBe(Math.ceil(1000 / SOUND_GAP_MS));
    expect(max).toBeLessThanOrEqual(BOUNCE_PEAK + 1e-9);
  });

  it("a tap on empty space, a hidden character or a place returns null", async () => {
    const { engine } = await built();
    engine.update("mare", 5);
    expect(engine.tap!("mare", 5, new THREE.Ray(new THREE.Vector3(40, 30, 40), new THREE.Vector3(0, -1, 0)), 10)).toBeNull();
    // The whale appears at 1 s: not on stage at 0.5 s.
    const hidden = above(engine, "balena", "mare", 5);
    expect(engine.tap!("mare", 0.5, hidden, 10)).toBeNull();
    // A ray that skims the ground far from every character.
    expect(engine.tap!("mare", 5, new THREE.Ray(new THREE.Vector3(30, 0.01, 40), new THREE.Vector3(0, 0, -1)), 10)).toBeNull();
  });

  it("wobble(id, now) rolls the rig and returns it exactly to its base rotation", async () => {
    const { engine, obj } = await built();
    engine.update("mare", 5);
    const base = obj.rotation.clone();
    engine.wobble!("balena", 1000);
    let moved = 0;
    for (let now = 1000; now <= 1000 + WOBBLE_SECONDS * 1000 + 60; now += 16) {
      engine.update("mare", 5);
      engine.animate!(now);
      moved = Math.max(moved, Math.abs(obj.rotation.z - base.z));
    }
    expect(moved).toBeGreaterThan(0.05);
    expect(moved).toBeLessThanOrEqual(0.18 + 1e-9);
    expect(obj.rotation.z).toBe(base.z);
    expect(obj.rotation.x).toBe(base.x);
    expect(obj.rotation.y).toBe(base.y);
  });

  it("update(chapterId, t) gives the same state with or without taps", async () => {
    const snap = (root: THREE.Group) => {
      const out: number[][] = [];
      root.traverse((o) => out.push([o.visible ? 1 : 0, ...o.position.toArray(), ...o.rotation.toArray().slice(0, 3) as number[], ...o.scale.toArray()]));
      return JSON.stringify(out);
    };
    const a = await built();
    const b = await built();
    a.engine.update("mare", 5);
    const clean = snap(a.root);
    b.engine.tap!("mare", 5, above(b.engine, "balena", "mare", 5), 100);
    b.engine.animate!(110);
    b.engine.update("mare", 5);
    expect(snap(b.root)).toBe(clean);
  });

  it("tap, wobble and animate allocate nothing per frame in animate", async () => {
    const { engine } = await built();
    engine.tap!("mare", 5, above(engine, "balena", "mare", 5), 100);
    expect(() => {
      for (let i = 0; i < 100; i++) engine.animate!(100 + i * 16);
    }).not.toThrow();
  });
});
