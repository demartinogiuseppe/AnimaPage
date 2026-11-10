import { readFileSync, existsSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkDioramaData, checkScene, DIORAMA_CATALOG, dioramaCatalogPrompt, DioramaData, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../src/index.ts";
import { createDioramaEngine } from "../src/engines/diorama/index.ts";
import { Evaluator } from "../src/engines/diorama/state.ts";

const PUBLIC = new URL("../../../fixtures/public/", import.meta.url);
// Reference scene left out of the public copy (tools/publish/exclude.txt): the tests that need it skip when it is absent.
const present = existsSync(new URL("scenes/racconto-elettricista.scene.json", PUBLIC));
const raw = present ? JSON.parse(readFileSync(new URL("scenes/racconto-elettricista.scene.json", PUBLIC), "utf8")) : undefined;

async function build(json: unknown = raw): Promise<{ engine: Engine; ctx: EngineContext; spec: SceneSpec }> {
  const spec = SceneSpec.parse(json);
  // No createCanvas: Node mode, GLB files are not loaded and catalog items are placeholders.
  const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
  const engine = createDioramaEngine();
  await engine.build(ctx, spec);
  return { engine, ctx, spec };
}

/** Everything update() can touch. */
function snapshot(ctx: EngineContext): string {
  const out: unknown[] = [];
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  ctx.scene.add(ctx.root);
  ctx.scene.traverse((o) => {
    const e: unknown[] = [o.name, o.type, o.visible, ...o.position.toArray().map(r), ...o.quaternion.toArray().map(r), ...o.scale.toArray().map(r)];
    if (o instanceof THREE.InstancedMesh && o.visible) e.push(Array.from(o.instanceMatrix.array as Float32Array, r));
    if (o instanceof THREE.Points && o.visible) e.push(Array.from(o.geometry.attributes.position!.array as Float32Array, r));
    if (o instanceof THREE.Light) e.push(r(o.intensity));
    const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (mat && !Array.isArray(mat)) e.push(r(mat.opacity), mat.color?.getHexString(), mat.emissive?.getHexString());
    if (o instanceof THREE.Mesh && o.geometry.attributes.position) e.push(o.geometry.attributes.position.count);
    out.push(JSON.stringify(e));
  });
  out.push((ctx.scene.background as THREE.Color).getHexString());
  ctx.scene.remove(ctx.root);
  return out.join("\n");
}

describe.skipIf(!present)("racconto-elettricista scene", () => {
  it("passes SceneSpec.parse, checkScene and checkDioramaData with zero issues", () => {
    const spec = SceneSpec.parse(raw);
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "diorama") throw new Error("not a diorama");
    expect(checkDioramaData(spec.engineData, spec)).toEqual([]);
    expect(spec.kind).toBe("mixed");
    expect(spec.videos).toEqual([]);
    expect(spec.chapters.length).toBeGreaterThanOrEqual(3);
    for (const s of spec.sources) if (s.kind !== "page") expect(s.url).toMatch(/^https:\/\/it\.wikipedia\.org\//);
    const types = new Set(spec.chapters.flatMap((c) => c.quiz.map((q) => q.type)));
    expect(types).toEqual(new Set(["choice", "pick"]));
  });

  it("checkDioramaData reports unknown models, items, clips and anchors", () => {
    const bad = structuredClone(raw);
    bad.engineData.items.push({ id: "x", model: "no-such-model", pos: [0, 0, 0] });
    bad.engineData.chapters[0].actions.push({ do: "anim", target: "antonio", from: 0, clip: "moonwalk" });
    bad.engineData.chapters[0].actions.push({ do: "show", target: "ghost", at: 1 });
    bad.chapters[0].pins[0].anchor = { entity: "item", part: "antonio.tail" };
    const spec = SceneSpec.parse(bad);
    if (spec.engine !== "diorama") throw new Error("not a diorama");
    const msgs = checkDioramaData(spec.engineData, spec).map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining(['unknown catalog model "no-such-model"', 'item "antonio" has no clip "moonwalk"', 'unknown item "ghost"', 'item "antonio" has no part "tail"']),
    );
  });

  it("DioramaData rejects unknown fields, bad colours and dotted ids", () => {
    expect(DioramaData.safeParse({ ...raw.engineData, extra: 1 }).success).toBe(false);
    const bad = structuredClone(raw.engineData);
    bad.items[0].model.color = "grey";
    expect(DioramaData.safeParse(bad).success).toBe(false);
    const dotted = structuredClone(raw.engineData);
    dotted.items[0].id = "a.b";
    expect(DioramaData.safeParse(dotted).success).toBe(false);
  });
});

describe("model catalog", () => {
  it("has 80-150 entries with unique ids, sizes, bilingual text and existing self-contained GLB files", () => {
    expect(DIORAMA_CATALOG.length).toBeGreaterThanOrEqual(80);
    expect(DIORAMA_CATALOG.length).toBeLessThanOrEqual(150);
    expect(new Set(DIORAMA_CATALOG.map((m) => m.id)).size).toBe(DIORAMA_CATALOG.length);
    let bytes = 0;
    for (const m of DIORAMA_CATALOG) {
      expect(m.it.length && m.en.length && m.tags.length, m.id).toBeTruthy();
      expect(m.size.every((v) => v >= 0) && m.size[1] > 0, m.id).toBe(true);
      if (!m.file) continue;
      const url = new URL(m.file, PUBLIC);
      expect(existsSync(url), m.file).toBe(true);
      const buf = readFileSync(url);
      bytes += buf.length;
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8"));
      for (const img of json.images ?? []) expect(img.uri, `${m.file} has an external texture`).toBeUndefined();
      const clips = new Set((json.animations ?? []).map((a: { name: string }) => a.name));
      for (const a of m.anims ?? []) expect(clips.has(a), `${m.id}: ${a}`).toBe(true);
    }
    expect(bytes).toBeLessThan(25 * 1024 * 1024);
  });

  it("produces a compact prompt listing", () => {
    const p = dioramaCatalogPrompt();
    expect(p.split("\n")).toHaveLength(DIORAMA_CATALOG.length);
    expect(p).toContain("traffic-light | semaforo");
  });
});

describe.skipIf(!present)("diorama engine", () => {
  it("builds in Node without WebGL, canvas or GLB loading", async () => {
    const { engine, ctx } = await build();
    expect(engine.bounds().radius).toBeGreaterThan(10);
    expect(ctx.root.getObjectByName("elettricista")?.getObjectByName("placeholder")).toBeDefined();
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
  });

  it("update is a pure function of (chapter, t): t1 -> t2 -> t1 gives identical state", async () => {
    const { engine, ctx, spec } = await build();
    const probes: [string, number][] = spec.chapters.flatMap((c) => [0, 0.37, 11.2, 15.6, c.duration / 2 + 0.11, 26, 32.8, c.duration].map((t) => [c.id, t] as [string, number]));
    const first = new Map<string, string>();
    for (const [ch, t] of probes) {
      engine.update(ch, t);
      first.set(`${ch}@${t}`, snapshot(ctx));
    }
    for (const [ch, t] of [...probes].reverse()) {
      engine.update("pomeriggio", 10.1);
      engine.update(ch, t);
      const a = first.get(`${ch}@${t}`)!.split("\n");
      const b = snapshot(ctx).split("\n");
      const i = a.findIndex((l, k) => l !== b[k]);
      expect(i === -1 ? null : [a[i], b[i]], `${ch}@${t}`).toBeNull();
    }
    engine.dispose();
  });

  it("resolves every pin and camera anchor to a finite position", async () => {
    const { engine, spec } = await build();
    const v = new THREE.Vector3();
    for (const ch of spec.chapters) {
      for (const t of [0, ch.duration * 0.3, ch.duration * 0.6, ch.duration]) {
        engine.update(ch.id, t);
        for (const a of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
          expect(engine.resolveAnchor(a, ch.id, t, v), `${ch.id}@${t} ${JSON.stringify(a)}`).toBe(true);
          expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
        }
      }
    }
    expect(engine.resolveAnchor({ entity: "item", part: "nobody" }, "mattina", 0, v)).toBe(false);
    engine.dispose();
  });

  it("anchors follow their items: the B flies up, the electrician walks and falls", async () => {
    const { engine } = await build();
    const at = (part: string, ch: string, t: number) => {
      const v = new THREE.Vector3();
      engine.update(ch, t);
      expect(engine.resolveAnchor({ entity: "item", part }, ch, t, v)).toBe(true);
      return v;
    };
    expect(at("L_B", "mezzogiorno", 20).y - at("L_B", "mezzogiorno", 14).y).toBeGreaterThan(15);
    expect(at("elettricista", "mattina", 6).x - at("elettricista", "mattina", 0).x).toBeGreaterThan(8);
    const standing = at("elettricista.head", "mezzogiorno", 31);
    const fallen = at("elettricista.head", "mezzogiorno", 35);
    expect(standing.y - fallen.y).toBeGreaterThan(2);
    expect(fallen.y).toBeLessThan(0.6);
    engine.dispose();
  });
});

describe("evaluator rules", () => {
  const data = (actions: unknown[], extra: object = {}) =>
    DioramaData.parse({
      stage: { size: [10, 10], ground: { type: "grass" } },
      items: [
        { id: "a", model: { shape: "box", size: [1, 2, 1], color: "#ff0000" }, pos: [0, 0, 0], ...extra },
        { id: "p", model: "man-a", pos: [3, 0, 0] },
      ],
      chapters: [{ chapter: "c", actions }],
    });

  it("an item whose first show/hide is a show starts hidden", () => {
    const ev = new Evaluator(data([{ do: "show", target: "a", at: 2 }]));
    expect(ev.state("a", "c", 1).visible).toBe(false);
    ev.beginFrame();
    expect(ev.state("a", "c", 3).visible).toBe(true);
  });

  it("move walks the path at constant speed, faces the travel direction and plays its clip", () => {
    const ev = new Evaluator(data([{ do: "move", target: "p", from: 0, to: 4, path: [[3, 0, 4], [7, 0, 4]], ease: "linear", anim: "walk" }]));
    const s = ev.state("p", "c", 2);
    expect(s.pos.toArray().map((x) => Math.round(x * 1e6) / 1e6)).toEqual([3, 0, 4]);
    expect(s.clip).toBe("walk");
    expect(s.clipTime).toBe(2);
    expect(Math.round(ev.state("p", "c", 3).yaw)).toBe(90);
    expect(ev.state("p", "c", 5).clip).toBe("idle");
  });

  it("attach follows the parent, then stays where it was detached", () => {
    const ev = new Evaluator(
      data([
        { do: "move", target: "p", from: 0, to: 10, path: [[13, 0, 0]], ease: "linear" },
        { do: "attach", target: "a", from: 0, to: 5, parent: "p", offset: [0, 1, 0] },
      ]),
    );
    expect(ev.state("a", "c", 2).pos.x).toBeCloseTo(5);
    expect(ev.state("a", "c", 2).pos.y).toBeCloseTo(1);
    expect(ev.state("a", "c", 8).pos.x).toBeCloseTo(8);
  });

  it("power 'night' follows the hour and blink is deterministic", () => {
    const night = DioramaData.parse({ ...data([]), chapters: [{ chapter: "c", hour: [{ at: 0, value: 12 }, { at: 10, value: 23 }], actions: [] }] });
    night.items[0]!.power = "night";
    const ev = new Evaluator(night);
    expect(ev.state("a", "c", 0).power).toBe(0);
    expect(ev.state("a", "c", 10).power).toBe(1);
    const ev2 = new Evaluator(data([{ do: "blink", target: "a", from: 0, to: 10, mode: "flicker", seed: 3 }]));
    const seq = [0.1, 0.5, 1.3, 2.2].map((t) => ev2.state("a", "c", t).power);
    ev2.beginFrame();
    expect([0.1, 0.5, 1.3, 2.2].map((t) => ev2.state("a", "c", t).power)).toEqual(seq);
  });
});
