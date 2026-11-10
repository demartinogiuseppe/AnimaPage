import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkSemantics, SceneSpec } from "@pv/scene-spec";
import { createMapEngine, type MapEngine } from "../src/engines/map/index.ts";

const PUBLIC = resolve(import.meta.dirname, "../../../fixtures/public");
// Reference scene left out of the public copy (tools/publish/exclude.txt): the tests that need it skip when it is absent.
const present = existsSync(resolve(PUBLIC, "scenes/campania.scene.json"));
const raw = present ? JSON.parse(readFileSync(resolve(PUBLIC, "scenes/campania.scene.json"), "utf8")) : undefined;

async function buildEngine(): Promise<{ engine: MapEngine; root: THREE.Group; spec: SceneSpec }> {
  const spec = SceneSpec.parse(raw);
  const root = new THREE.Group();
  const engine = createMapEngine();
  await engine.build(
    {
      root,
      scene: new THREE.Scene(),
      loadAsset: async (path) => {
        const b = readFileSync(resolve(PUBLIC, path));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    },
    spec,
  );
  return { engine, root, spec };
}

/** Everything update() may touch: transforms, visibility, opacities, light intensity, colour/particle buffers. */
function snapshot(root: THREE.Object3D): string {
  const out: unknown[] = [];
  root.traverse((o) => {
    const row: unknown[] = [o.name, o.visible, ...o.position.toArray(), ...o.scale.toArray()];
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mat && !Array.isArray(mat)) row.push(mat.opacity);
    if (o instanceof THREE.Light) row.push(o.intensity);
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    for (const name of ["color", "position"]) {
      const a = geo?.getAttribute(name);
      if (!a || (name === "position" && !(o instanceof THREE.Points))) continue;
      let sum = 0;
      const arr = a.array as Float32Array;
      for (let i = 0; i < arr.length; i++) sum += arr[i]! * ((i % 97) + 1);
      row.push(sum);
    }
    out.push(row);
  });
  return JSON.stringify(out);
}

describe.skipIf(!present)("campania.scene.json", () => {
  it("passes SceneSpec.parse and checkSemantics with zero issues", () => {
    const spec = SceneSpec.parse(raw);
    expect(spec.engine).toBe("map");
    expect(checkSemantics(spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["intro", "rilievi", "vesuvio", "pianure", "isole", "eco", "pop"]);
  });

  it("declares the vertical exaggeration it uses", () => {
    const spec = SceneSpec.parse(raw);
    if (spec.engine !== "map") throw new Error("not a map scene");
    const x = spec.engineData.terrain.verticalExaggeration;
    expect(spec.disclaimers.some((d) => d.includes(`esagerate ${x} volte`))).toBe(true);
  });

  it("references only known chapters, pins and sources in its engine data", () => {
    const spec = SceneSpec.parse(raw);
    if (spec.engine !== "map") throw new Error("not a map scene");
    const d = spec.engineData;
    const chapters = new Set(spec.chapters.map((c) => c.id));
    const sources = new Set(spec.sources.map((s) => s.id));
    const pop = spec.chapters.find((c) => c.id === "pop")!;
    for (const e of d.effects) expect(chapters.has(e.chapter)).toBe(true);
    for (const w of d.columns!.show) expect(chapters.has(w.chapter)).toBe(true);
    for (const c of d.columns!.items) {
      expect(pop.pins.some((p) => p.id === c.pinId)).toBe(true);
      for (const s of c.sourceIds) expect(sources.has(s)).toBe(true);
    }
    for (const ch of Object.keys(d.colorModeTrack)) expect(chapters.has(ch)).toBe(true);
  });
});

describe.skipIf(!present)("map engine", () => {
  it("builds in Node without canvas or WebGL", async () => {
    const { engine, root } = await buildEngine();
    expect(root.getObjectByName("terrain")).toBeDefined();
    expect(root.getObjectByName("river:volturno")).toBeDefined();
    expect(root.getObjectByName("outline")).toBeDefined();
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(6);
    expect(b.radius).toBeLessThan(10);
  });

  it("update(chapter, t) is a pure function of its arguments", async () => {
    const { engine, root } = await buildEngine();
    const cases: [string, number, number][] = [
      ["vesuvio", 11.3, 3],
      ["vesuvio", 14, 25],
      ["pop", 13, 9],
      ["pianure", 25, 1],
      ["intro", 20, 2],
    ];
    for (const [ch, t1, t2] of cases) {
      engine.update(ch, t1);
      const a = snapshot(root);
      engine.update(ch, t2);
      expect(snapshot(root)).not.toBe(a);
      engine.update(ch, t1);
      expect(snapshot(root)).toBe(a);
    }
  });

  it("does not leak the eruption's fertility tint into other chapters", async () => {
    const { engine, root } = await buildEngine();
    engine.update("pianure", 5);
    const before = snapshot(root);
    engine.update("vesuvio", 24); // after the eruption: plain fully green
    engine.update("pianure", 5);
    expect(snapshot(root)).toBe(before);
  });

  it("is deterministic across engine instances (seeded eruption)", async () => {
    const a = await buildEngine();
    const b = await buildEngine();
    a.engine.update("vesuvio", 11);
    b.engine.update("vesuvio", 11);
    expect(snapshot(a.root)).toBe(snapshot(b.root));
  });

  it("projects geo anchors onto the terrain surface", async () => {
    const { engine, spec } = await buildEngine();
    if (spec.engine !== "map") throw new Error("not a map scene");
    const v = new THREE.Vector3();
    // Vesuvius summit: 1281 m real; the ~750 m DEM grid gives a bit less. With 10x exaggeration
    // and 1 unit = ~19 km, the true summit would sit at ~0.69 units.
    expect(engine.resolveAnchor({ geo: [14.4265, 40.8236] }, "vesuvio", 0, v)).toBe(true);
    expect(v.y).toBeGreaterThan(0.55);
    expect(v.y).toBeLessThan(0.75);
    const summit = v.y;
    // alt is metres above the ground, exaggerated like the terrain.
    engine.resolveAnchor({ geo: [14.4265, 40.8236], alt: 1000 }, "vesuvio", 0, v);
    expect(v.y - summit).toBeCloseTo((1000 / 111_320) * 10 * (10 / (2.25 * Math.cos((40.75 * Math.PI) / 180))), 6);
    // Sea pins sit on the water surface; outside the area there is nothing to resolve.
    engine.resolveAnchor({ geo: [14.35, 40.25] }, "intro", 0, v);
    expect(v.y).toBe(0);
    expect(engine.resolveAnchor({ geo: [12, 42] }, "intro", 0, v)).toBe(false);
    // Area is 10 units wide, centred: Napoli is west of centre and north of it.
    engine.resolveAnchor({ geo: [14.25, 40.85] }, "intro", 0, v);
    expect(v.x).toBeLessThan(0);
    expect(v.z).toBeLessThan(0);
  });

  it("resolves column-top anchors that follow the column growth", async () => {
    const { engine, spec } = await buildEngine();
    if (spec.engine !== "map") throw new Error("not a map scene");
    const from = spec.engineData.columns!.show[0]!.from!;
    const v = new THREE.Vector3();
    const top = (t: number) => {
      engine.update("pop", t);
      expect(engine.resolveAnchor({ entity: "column", part: "p_napoli" }, "pop", t, v)).toBe(true);
      return v.y;
    };
    const low = top(0);
    const high = top(from + 5);
    expect(high - low).toBeCloseTo(spec.engineData.columns!.maxHeight, 5);
    expect(engine.resolveAnchor({ entity: "column", part: "nope" }, "pop", 0, v)).toBe(false);
  });

  it("follows the colour-mode track, and lets the user override it", async () => {
    const { engine, spec } = await buildEngine();
    const typeAt = spec.chapters[0]!.narration[4]!.at;
    expect(engine.colorModeAt("intro", 0)).toBe("alt");
    expect(engine.colorModeAt("intro", typeAt)).toBe("type");
    expect(engine.colorModeAt("pop", 10)).toBe("alt");
    engine.setColorMode("type");
    expect(engine.colorModeAt("pop", 10)).toBe("type");
  });
});
