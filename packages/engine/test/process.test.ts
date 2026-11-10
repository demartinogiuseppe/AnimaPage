import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec } from "@pv/scene-spec";
import { checkProcessData, ProcessData } from "../../scene-spec/src/engines/process.ts";
import { createProcessEngine } from "../src/engines/process/index.ts";
import { flowInterval, frontDistances, particleDistance, Polyline, presence, windows } from "../src/engines/process/motion.ts";
import { buildShape } from "../src/engines/process/shapes.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/scienze-sensi.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));
// Reference scene left out of the public copy (tools/publish/exclude.txt): the tests below skip when it is absent.
const present = existsSync(scenePath);

async function buildEngine() {
  const spec = SceneSpec.parse(raw());
  const engine = createProcessEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Every transform, opacity, glow and instance matrix of what is rendered (visible subtrees). */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, o.visible, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      entry.push(m.opacity, ...(m.emissive ? m.emissive.toArray() : []));
    }
    if (o instanceof THREE.InstancedMesh) entry.push(...o.instanceMatrix.array);
    out.push(entry);
  });
  return out;
}

describe.skipIf(!present)("scienze-sensi scene fixture", () => {
  it("passes SceneSpec, checkScene and the process cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("process");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "process") throw new Error("unreachable");
    expect(checkProcessData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["vista", "udito", "tatto"]);
    const quizTypes = new Set(spec.chapters.flatMap((c) => c.quiz.map((q) => q.type)));
    expect(quizTypes).toEqual(new Set(["choice", "pick"]));
    expect(spec.videos).toEqual([]);
  });
});

describe.skipIf(!present)("ProcessData schema", () => {
  const base = () => raw().engineData;

  it("rejects bad references, duplicate ids and inconsistent items", () => {
    const cases: ((d: any) => void)[] = [
      (d) => d.parts.push({ ...d.parts[0] }), // duplicate id
      (d) => (d.parts[0].parent = "ghost"),
      (d) => (d.flows[0].along = "iride"), // not a curve part
      (d) => (d.flows[0].path = [[0, 0, 0], [1, 0, 0]]), // both path and along
      (d) => d.chapters[0].items.push({ id: "nope" }),
      (d) => d.chapters[0].items.push({ id: "iride", vibrate: [[1, 2]] }), // listed twice, and no vibrate settings
      (d) => (d.chapters[0].items[0].until = 0),
      (d) => (d.parts[0].shape = "teapot"),
      (d) => d.chapters[1].items.push({ id: "suono", from: [0, 1, 0] }),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(ProcessData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(ProcessData.safeParse(base()).success).toBe(true);
  });

  it("cross-checks chapter ids and times against the scene", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "process") throw new Error("unreachable");
    const data = structuredClone(spec.engineData);
    data.chapters[0]!.chapter = "ghost";
    data.chapters[1]!.items[0]!.at = 999;
    const messages = checkProcessData(data, spec).map((i) => i.message);
    expect(messages).toContain('unknown chapter "ghost"');
    expect(messages.some((m) => m.includes("after the chapter ends"))).toBe(true);
  });
});

describe.skipIf(!present)("process motion helpers", () => {
  it("fades elements in and out and builds window envelopes", () => {
    expect(presence(5, undefined, undefined)).toBe(1);
    expect(presence(0.9, 1, undefined)).toBe(0);
    expect(presence(3, 1, undefined)).toBe(1);
    expect(presence(10, 1, 10)).toBe(0);
    expect(presence(9, 1, 10)).toBe(1);
    expect(windows(5, [[4, 6]])).toBe(1);
    expect(windows(7, [[4, 6]])).toBe(0);
  });

  it("measures polylines by arc length", () => {
    const p = new Polyline([new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0), new THREE.Vector3(3, 4, 0)]);
    expect(p.length).toBeCloseTo(7);
    expect(p.at(5, new THREE.Vector3()).toArray()).toEqual([3, 2, 0]);
    expect(p.at(99, new THREE.Vector3()).toArray()).toEqual([3, 4, 0]);
    expect(p.reversed().at(0, new THREE.Vector3()).toArray()).toEqual([3, 4, 0]);
  });

  it("emits flow particles and wave fronts from the source", () => {
    const interval = flowInterval(4, 2, 10, false);
    expect(interval).toBeCloseTo(1.25);
    expect(particleDistance(0, 1, 2, 10, interval, false)).toBeCloseTo(2);
    expect(particleDistance(1, 1, 2, 10, interval, false)).toBeNull();
    expect(particleDistance(0, 6, 2, 10, interval, false)).toBeCloseTo(2); // wrapped
    expect(particleDistance(0, 6, 2, 10, interval, true)).toBeNull(); // a signal goes once
    expect(frontDistances(-1, 1, 5)).toEqual([]);
    expect(frontDistances(2.5, 1, 5)).toEqual([0.5, 1.5, 2.5]);
    expect(frontDistances(20.5, 1, 5)).toHaveLength(5);
  });
});

describe.skipIf(!present)("process shapes", () => {
  it("builds every shape kind with materials, and curves for tube/spiral/torus", () => {
    const shapes = [
      { shape: "sphere", radius: 1, cut: 180, wall: 0.1, cap: 120 },
      { shape: "lens", radius: 1, thickness: 0.4 },
      { shape: "disc", radius: 1, inner: 0.3 },
      { shape: "cylinder", radius: 0.5, height: 2, radiusTop: 0, open: true },
      { shape: "funnel", radiusIn: 0.2, radiusOut: 1, length: 1 },
      { shape: "box", size: [1, 2, 3] },
      { shape: "tube", path: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], radius: 0.1 },
      { shape: "spiral", radius: 1, turns: 2.5, tube: 0.2, height: 0.5 },
      { shape: "torus", radius: 1, tube: 0.1, arc: 270 },
      { shape: "bone", from: [0, 0, 0], to: [1, 0, 0], radius: 0.1 },
      { shape: "arrow", from: [0, 0, 0], to: [0, 2, 0] },
      { shape: "blob", radius: 1, bumps: 1 },
      { shape: "dots", size: [1, 1, 1], count: 20, radius: 0.05 },
      { shape: "layers", width: 2, depth: 1, layers: [{ id: "a", thickness: 0.2, color: "#ffffff" }, { thickness: 1, color: "#000000" }] },
    ] as const;
    for (const s of shapes) {
      const built = buildShape({ id: "x", ...s } as never);
      expect(built.materials.length, s.shape).toBeGreaterThan(0);
      const box = new THREE.Box3().setFromObject(built.object);
      expect(box.isEmpty(), s.shape).toBe(false);
      expect(Boolean(built.curve), s.shape).toBe(["tube", "spiral", "torus"].includes(s.shape));
    }
    expect(buildShape({ id: "x", ...shapes[13] } as never).subs.map((s) => s.id)).toEqual(["a"]);
  });
});

describe.skipIf(!present)("process engine", () => {
  it("builds in Node without WebGL or canvas", async () => {
    const { ctx } = await buildEngine();
    expect(ctx.root.children).toHaveLength(1);
    expect(ctx.scene.background).toBeInstanceOf(THREE.Color);
  });

  it("is a pure function of (chapterId, t)", async () => {
    const { engine, ctx } = await buildEngine();
    for (const [ch, t1, t2] of [
      ["vista", 35, 10],
      ["vista", 53.3, 62],
      ["udito", 20.7, 33],
      ["udito", 56, 7],
      ["tatto", 36.2, 20],
    ] as const) {
      engine.update(ch, t1);
      const a = snapshot(ctx.root);
      engine.update(ch, t2);
      const between = snapshot(ctx.root);
      engine.update("udito", 40);
      engine.update(ch, t1);
      expect(snapshot(ctx.root)).toEqual(a);
      expect(between).not.toEqual(a);
    }
  });

  it("shows only each chapter's elements and swaps the eye for its cut-away", async () => {
    const { engine, ctx } = await buildEngine();
    const visible = (name: string) => ctx.root.getObjectByName(name)!.visible;
    engine.update("vista", 5);
    expect(visible("part:bulbo")).toBe(true);
    expect(visible("part:sclera")).toBe(false);
    expect(visible("part:coclea")).toBe(false);
    expect(visible("ray:raggio-alto-1")).toBe(false);
    engine.update("vista", 40);
    expect(visible("part:bulbo")).toBe(false);
    expect(visible("part:sclera")).toBe(true);
    expect(visible("ray:raggio-alto-1")).toBe(true);
    engine.update("udito", 20);
    expect(visible("part:sclera")).toBe(false);
    expect(visible("part:coclea")).toBe(true);
    expect(visible("wave:suono")).toBe(true);
    engine.update("tatto", 30);
    expect(visible("part:epidermide")).toBe(true);
    expect(visible("part:melanina")).toBe(true);
  });

  it("vibrates the eardrum only inside its window", async () => {
    const { engine } = await buildEngine();
    const at = (t: number) => {
      engine.update("udito", t);
      const v = new THREE.Vector3();
      engine.resolveAnchor({ entity: "part", part: "timpano" }, "udito", t, v);
      return v.x;
    };
    expect(at(10)).toBeCloseTo(at(12.1));
    const xs = [30, 30.08, 30.16, 30.24].map(at);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.05);
  });

  it("resolves every entity anchor used by pins and camera keys", async () => {
    const { spec, engine } = await buildEngine();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters) {
      for (const t of [0, ch.duration / 2, ch.duration - 0.5]) {
        engine.update(ch.id, t);
        for (const anchor of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
          expect(engine.resolveAnchor(anchor, ch.id, t, out), JSON.stringify(anchor)).toBe(true);
          expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
        }
      }
    }
  });

  it("follows the nerve signal and resolves points along flows, rays and waves", async () => {
    const { engine } = await buildEngine();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const signal = { entity: "flow", part: "segnale-ottico" } as const;
    engine.update("vista", 52.5);
    engine.resolveAnchor(signal, "vista", 52.5, a);
    engine.update("vista", 53.5);
    engine.resolveAnchor(signal, "vista", 53.5, b);
    expect(b.x).toBeGreaterThan(a.x);
    expect(engine.resolveAnchor({ entity: "flow", part: "segnale-ottico", index: 100 }, "vista", 0, a)).toBe(true);
    expect(engine.resolveAnchor({ entity: "ray", part: "raggio-alto-2" }, "vista", 40, a)).toBe(true);
    expect(a.y).toBeLessThan(0); // inverted image: the ray from the top of the apple ends low on the retina
    expect(engine.resolveAnchor({ entity: "wave", part: "suono", index: 50 }, "udito", 0, a)).toBe(true);
    expect(engine.resolveAnchor({ entity: "part", part: "derma", offset: [0, 1, 0] }, "tatto", 30, a)).toBe(true);
    expect(engine.resolveAnchor({ entity: "part", part: "nope" }, "vista", 0, a)).toBe(false);
    expect(engine.resolveAnchor({ entity: "event", part: "x" }, "vista", 0, a)).toBe(false);
    expect(engine.resolveAnchor({ geo: [12, 41] }, "vista", 0, a)).toBe(false);
  });

  it("reports bounds that contain the content and cleans up on dispose", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("udito", 30);
    const { center, radius } = engine.bounds();
    const sphere = new THREE.Box3().setFromObject(ctx.root).getBoundingSphere(new THREE.Sphere());
    expect(center.distanceTo(sphere.center) + sphere.radius).toBeLessThanOrEqual(radius * 1.1);
    expect(ctx.scene.children.length).toBeGreaterThan(0);
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
    expect(ctx.scene.children).toHaveLength(0);
  });
});
