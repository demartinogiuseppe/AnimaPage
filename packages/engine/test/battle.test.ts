import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BattleData, checkSemantics, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../src/index.ts";
import { createBattleEngine } from "../src/engines/battle/index.ts";

const raw = JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/troia.scene.json", import.meta.url), "utf8"));

async function buildTroia(): Promise<{ engine: Engine; ctx: EngineContext; spec: SceneSpec }> {
  const spec = SceneSpec.parse(raw);
  const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
  const engine = createBattleEngine();
  await engine.build(ctx, spec);
  return { engine, ctx, spec };
}

/** Everything update() can touch: transforms, visibility, instance matrices, point buffers, materials, lights. */
function snapshot(ctx: EngineContext): string {
  const out: unknown[] = [];
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  ctx.scene.add(ctx.root);
  ctx.scene.traverse((o) => {
    const e: unknown[] = [o.type, o.visible, ...o.position.toArray().map(r), ...o.quaternion.toArray().map(r), ...o.scale.toArray().map(r)];
    if (o instanceof THREE.InstancedMesh) e.push(Array.from(o.instanceMatrix.array as Float32Array, r));
    // Hidden particle systems are not rewritten (their buffers are never drawn).
    if (o instanceof THREE.Points && o.visible) e.push(Array.from(o.geometry.attributes.position!.array as Float32Array, r));
    if (o instanceof THREE.Light) e.push(r(o.intensity));
    const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (mat && !Array.isArray(mat)) e.push(r(mat.opacity), mat.color.getHexString(), mat.emissive?.getHexString());
    out.push(e);
  });
  out.push((ctx.scene.background as THREE.Color).getHexString(), (ctx.scene.fog as THREE.Fog).color.getHexString());
  ctx.scene.remove(ctx.root);
  return JSON.stringify(out);
}

describe("Troia scene spec", () => {
  it("passes SceneSpec.parse and checkSemantics with zero issues", () => {
    const spec = SceneSpec.parse(raw);
    expect(checkSemantics(spec)).toEqual([]);
    expect(spec.engine).toBe("battle");
    expect(spec.kind).toBe("mixed");
  });

  it("has the six chapters of the prototype with their myth/history kinds and 18 questions", () => {
    const spec = SceneSpec.parse(raw);
    expect(spec.chapters.map((c) => [c.id, c.kind])).toEqual([
      ["micenei", "history"],
      ["sbarco", "myth"],
      ["assedio", "myth"],
      ["scontro", "myth"],
      ["cavallo", "myth"],
      ["storia", "history"],
    ]);
    expect(spec.chapters.reduce((n, c) => n + c.quiz.length, 0)).toBe(18);
    expect(spec.videos).toEqual([]);
    for (const s of spec.sources) expect(s.url).toMatch(/^https:\/\/it\.wikipedia\.org\//);
  });

  it("BattleData rejects unknown fields and bad colours", () => {
    const bad = structuredClone(raw.engineData);
    bad.sides[0].color = "blue";
    expect(BattleData.safeParse(bad).success).toBe(false);
    expect(BattleData.safeParse({ ...raw.engineData, extra: 1 }).success).toBe(false);
  });
});

describe("battle engine", () => {
  it("builds in Node without a canvas factory", async () => {
    const { engine } = await buildTroia();
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(10);
    expect(Number.isFinite(b.center.x)).toBe(true);
    engine.dispose();
  });

  it("update is a pure function of (chapter, t), also across chapters", async () => {
    const { engine, ctx, spec } = await buildTroia();
    const probes: [string, number][] = spec.chapters.flatMap((c) => [0, 0.37, c.duration / 3, c.duration / 2 + 0.11, c.duration * 0.8, c.duration].map((t) => [c.id, t] as [string, number]));
    const first = new Map<string, string>();
    for (const [ch, t] of probes) {
      engine.update(ch, t);
      first.set(`${ch}@${t}`, snapshot(ctx));
    }
    // Scrub in reverse order and jump around: every state must be reproduced exactly.
    for (const [ch, t] of [...probes].reverse()) {
      engine.update("scontro", 17.3);
      engine.update(ch, t);
      expect(snapshot(ctx)).toBe(first.get(`${ch}@${t}`));
    }
    engine.update("cavallo", 30);
    const a = snapshot(ctx);
    engine.update("cavallo", 10);
    engine.update("micenei", 3);
    engine.update("cavallo", 30);
    expect(snapshot(ctx)).toBe(a);
    engine.dispose();
  });

  it("resolves every pin anchor to a finite position at several times", async () => {
    const { engine, spec } = await buildTroia();
    const v = new THREE.Vector3();
    for (const ch of spec.chapters) {
      for (const t of [0, ch.duration * 0.25, ch.duration * 0.5, ch.duration * 0.75, ch.duration]) {
        engine.update(ch.id, t);
        for (const p of ch.pins) {
          expect(engine.resolveAnchor(p.anchor, ch.id, t, v), `${ch.id}/${p.id}@${t}`).toBe(true);
          expect([v.x, v.y, v.z].every(Number.isFinite), `${ch.id}/${p.id}@${t}`).toBe(true);
        }
        for (const k of ch.camera) expect(engine.resolveAnchor(k.target, ch.id, t, v)).toBe(true);
      }
    }
    engine.dispose();
  });

  it("moving anchors follow their entities", async () => {
    const { engine } = await buildTroia();
    const at = (anchor: Parameters<Engine["resolveAnchor"]>[0], ch: string, t: number) => {
      const v = new THREE.Vector3();
      engine.update(ch, t);
      engine.resolveAnchor(anchor, ch, t, v);
      return v.clone();
    };
    // Ship 6 sails from far out to the beach.
    expect(at({ entity: "ships", index: 6 }, "sbarco", 0).x).toBeLessThan(-30);
    expect(at({ entity: "ships", index: 6 }, "sbarco", 12).x).toBeCloseTo(-11, 1);
    // The horse is pulled up the hill; its top grows while it is built.
    expect(at({ entity: "horse" }, "cavallo", 23).x).toBeCloseTo(11.4, 1);
    expect(at({ entity: "horse" }, "cavallo", 23).y).toBeCloseTo(1.4, 1);
    expect(at({ entity: "horse", part: "top" }, "cavallo", 2).y).toBeLessThan(at({ entity: "horse", part: "top" }, "cavallo", 6).y);
    // Hector's head drops when he falls.
    expect(at({ entity: "hector", part: "head" }, "scontro", 38.5).y).toBeLessThan(at({ entity: "hector", part: "head" }, "scontro", 36).y - 0.4);
    // Heroes orbit the city.
    const h = at({ entity: "hector" }, "scontro", 30);
    expect(Math.hypot(h.x - 13, h.z)).toBeCloseTo(7.4, 1);
    // Display-warrior helmet sits above the podium.
    expect(at({ entity: "displayWarrior", part: "helmet" }, "micenei", 4).y).toBeGreaterThan(1.6);
    engine.dispose();
  });

  it("drives visibility from the phases", async () => {
    const { engine, ctx } = await buildTroia();
    const trojans = ctx.root.getObjectByName("battle")!.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)[6]!;
    const scaleOf = (i: number) => new THREE.Vector3().setFromMatrixScale(new THREE.Matrix4().fromArray(trojans.instanceMatrix.array, i * 16)).x;
    engine.update("scontro", 2);
    expect(scaleOf(100)).toBe(0); // still inside the city
    engine.update("scontro", 12);
    expect(scaleOf(100)).toBe(1);
    engine.update("storia", 5);
    expect(scaleOf(100)).toBe(0);
    engine.dispose();
  });
});
