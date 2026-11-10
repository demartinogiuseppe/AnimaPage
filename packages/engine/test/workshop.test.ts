import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec, WorkshopData } from "@pv/scene-spec";
import { createWorkshopEngine } from "../src/engines/workshop/index.ts";
import { integrate, keyed } from "../src/engines/workshop/anim.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/officina-mulino.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function buildEngine() {
  const spec = SceneSpec.parse(raw());
  const engine = createWorkshopEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, ...o.matrixWorld.elements.map((v) => Math.round(v * 1e6))];
    if (o instanceof THREE.Mesh) entry.push((o.material as THREE.Material).opacity);
    if (o instanceof THREE.InstancedMesh) entry.push(...Array.from(o.instanceMatrix.array, (v) => Math.round(v * 1e6)));
    out.push(entry);
  });
  return out;
}

const node = (root: THREE.Object3D, id: string) => root.getObjectByName(`part:${id}`)!;

describe("officina-mulino reference scene", () => {
  it("passes SceneSpec and checkScene with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("workshop");
    expect(checkScene(spec)).toEqual([]);
  });
});

describe("WorkshopData schema", () => {
  const base = () => raw().engineData;
  it("rejects bad parts, references, formulas and keys", () => {
    const cases: ((d: any) => void)[] = [
      (d) => d.parts.push({ ...d.parts[0] }), // duplicate id
      (d) => (d.parts[0].parent = "ghost"),
      (d) => d.parts.push({ id: "b2", shape: "box" }), // box without size
      (d) => d.parts.push({ id: "m2", shape: "model", model: "unicorn", height: 1 }),
      (d) => d.chapters[0].items.push({ id: "nope" }),
      (d) => d.chapters[0].tracks.push({ part: "ruota", prop: "spin", expr: "k*t" }), // undeclared variable
      (d) => d.chapters[0].tracks.push({ part: "ruota", prop: "spin", expr: "alert(1)" }),
      (d) => d.chapters[0].tracks.push({ part: "ruota", prop: "level", expr: "t" }), // level only on liquids
      (d) => d.chapters[0].tracks.push({ part: "ruota", prop: "pos", keys: [{ at: 0, v: 3 }] }),
      (d) => d.chapters[0].tracks.push({ part: "ruota", prop: "x", keys: [{ at: 2, v: 1 }, { at: 1, v: 0 }] }),
      (d) => d.chapters[0].tracks.push({ part: "ruota", prop: "x", keys: [{ at: 0, v: 1 }], expr: "t" }),
      (d) => (d.params[0].value = 500),
      (d) => (d.params[0].id = "sin"),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(WorkshopData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(WorkshopData.safeParse(base()).success).toBe(true);
  });

  it("cross-checks chapters, times, sliders and anchors", () => {
    const s = raw();
    s.engineData.chapters[0].tracks.push({ part: "ruota", prop: "x", keys: [{ at: 0, v: 0 }, { at: 99, v: 1 }] });
    s.chapters[0].activity.test.params = ["ghost"];
    s.chapters[0].pins[0].anchor = { entity: "ghost" };
    const msgs = checkScene(SceneSpec.parse(s)).map((i) => i.path);
    expect(msgs).toEqual(expect.arrayContaining(["engineData.chapters[0].tracks[3]", "chapters[0].activity.test.params[0]", "chapters[0].pins[0].anchor"]));
  });
});

describe("workshop engine", () => {
  it("is pure: same (chapter, t) gives the same scene whatever came before", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("ruota", 20);
    const a = snapshot(ctx.root);
    engine.update("macina", 30);
    engine.update("ruota", 2);
    engine.update("ruota", 20);
    expect(snapshot(ctx.root)).toEqual(a);
  });

  it("shows only the chapter's items and reveals them at their time", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("ruota", 1);
    expect(node(ctx.root, "acqua").visible).toBe(false);
    expect(node(ctx.root, "grano").visible).toBe(false);
    engine.update("ruota", 6);
    expect(node(ctx.root, "acqua").visible).toBe(true);
    expect(node(ctx.root, "lubecchio").visible).toBe(true); // child of a listed part
    // Materials transparent by nature (particles, glass, canvas text) stay transparent when fully shown.
    expect(((node(ctx.root, "acqua").children[0] as THREE.Mesh).material as THREE.Material).transparent).toBe(true);
  });

  it("spins by the integral of the formula and follows the slider", async () => {
    const { engine, ctx } = await buildEngine();
    const angle = () => {
      engine.update("ruota", 20);
      return new THREE.Euler().setFromQuaternion(node(ctx.root, "ruota").quaternion).z;
    };
    const slow = angle();
    expect(engine.params!("ruota")).toEqual([{ id: "q", label: "Portata dell'acqua", min: 20, max: 120, step: 5, value: 60 }]);
    engine.setParams!({ q: 100, nope: 3 });
    expect(engine.params!("ruota")[0]!.value).toBe(100);
    expect(angle()).not.toBeCloseTo(slow, 3);
    engine.setParams!(null);
    expect(angle()).toBeCloseTo(slow, 9);
  });

  it("fills liquids and anchors pins to parts", async () => {
    const { engine, ctx } = await buildEngine();
    const out = new THREE.Vector3();
    engine.update("macina", 18);
    expect(engine.resolveAnchor({ entity: "sacco" }, "macina", 18, out)).toBe(true);
    const low = out.y;
    engine.update("macina", 31);
    engine.resolveAnchor({ entity: "sacco" }, "macina", 31, out);
    expect(out.y).toBeGreaterThan(low + 0.2);
    expect(engine.resolveAnchor({ entity: "ghost" }, "macina", 31, out)).toBe(false);
    expect(engine.resolveAnchor({ entity: "acqua", index: 100 }, "ruota", 5, out)).toBe(true);
    expect(out.x).toBeCloseTo(5.5, 1);
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(4);
    expect(b.radius).toBeLessThan(12);
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
  });
});

describe("workshop ropes", () => {
  it("a line with follow ends at the followed part as it moves", async () => {
    const s = raw();
    s.engineData.parts.push({ id: "fune", shape: "line", path: [[3, 6, -0.6], [1.6, 3, -0.6]], follow: "sacco" });
    s.engineData.chapters[2].items.push({ id: "fune" });
    const spec = SceneSpec.parse(s);
    expect(checkScene(spec)).toEqual([]);
    const engine = createWorkshopEngine();
    const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
    await engine.build(ctx, spec);
    for (const t of [18, 31]) {
      engine.update("macina", t);
      const want = new THREE.Vector3();
      engine.resolveAnchor({ entity: "sacco" }, "macina", t, want);
      const line = node(ctx.root, "fune").children[0] as THREE.Line;
      ctx.root.updateMatrixWorld(true);
      const end = new THREE.Vector3().fromBufferAttribute(line.geometry.getAttribute("position") as THREE.BufferAttribute, 1).applyMatrix4(line.matrixWorld);
      expect(end.distanceTo(want)).toBeLessThan(1e-6);
    }
    const bad = raw();
    bad.engineData.parts.push({ id: "fune", shape: "box", size: [1, 1, 1], follow: "sacco" });
    expect(WorkshopData.safeParse(bad.engineData).success).toBe(false);
  });
});

describe("workshop animation helpers", () => {
  it("eases keyframes, holds the ends and steps", () => {
    const keys = [{ at: 0, v: 0 }, { at: 2, v: 10, ease: "linear" as const }, { at: 4, v: [1, 2, 3] as [number, number, number], ease: "step" as const }];
    expect(keyed(keys, -1)).toBe(0);
    expect(keyed(keys, 1)).toBe(5);
    expect(keyed([{ at: 0, v: "#000000" }, { at: 1, v: "#ffffff", ease: "linear" }], 0.5)).toBe("#808080");
    expect(keyed(keys, 3)).toBe(10);
    expect(keyed(keys, 9)).toEqual([1, 2, 3]);
  });

  it("integrates rates deterministically", () => {
    expect(integrate(() => 2, 0, 3)).toBeCloseTo(6, 9);
    expect(integrate((t) => (t < 1 ? null : 1), 0, 3)).toBeCloseTo(2, 1);
    expect(integrate(() => 1, 0, 0)).toBe(0);
  });
});
