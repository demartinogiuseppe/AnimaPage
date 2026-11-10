// The original example lessons (fixtures/public/scenes/esempio-*.scene.json): written for AnimaPage,
// not taken from a book page, so they ship in the public copy. They stand in as prompt examples for
// the engines whose reference scene is left out there (server/src/generate/example.ts, EXAMPLE_FALLBACKS).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../src/types.ts";
import { createConceptEngine } from "../src/engines/concept/index.ts";
import { createDioramaEngine } from "../src/engines/diorama/index.ts";
import { createMapEngine } from "../src/engines/map/index.ts";
import { createProcessEngine } from "../src/engines/process/index.ts";

const PUBLIC = resolve(import.meta.dirname, "../../../fixtures/public");

const EXAMPLES: [file: string, engine: string, create: () => Engine][] = [
  ["esempio-mappa-fiumi-europa", "map", createMapEngine],
  ["esempio-diorama-torta-volante", "diorama", createDioramaEngine],
  ["esempio-processo-ciclo-acqua", "process", createProcessEngine],
  ["esempio-concetto-nome", "concept", createConceptEngine],
];

const raw = (file: string) => JSON.parse(readFileSync(resolve(PUBLIC, `scenes/${file}.scene.json`), "utf8"));

async function build(file: string, create: () => Engine): Promise<{ engine: Engine; ctx: EngineContext; spec: SceneSpec }> {
  const spec = SceneSpec.parse(raw(file));
  const ctx: EngineContext = {
    root: new THREE.Group(),
    scene: new THREE.Scene(),
    // Map geodata come from fixtures/public; diorama GLBs are not loaded in Node (placeholders).
    loadAsset: async (path) => {
      if (!path.startsWith("geo/")) return new ArrayBuffer(0);
      const b = readFileSync(resolve(PUBLIC, path));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
  };
  const engine = create();
  await engine.build(ctx, spec);
  return { engine, ctx, spec };
}

/** Transforms, visibility and opacities of the whole tree. */
function snapshot(root: THREE.Object3D): string {
  const out: unknown[] = [];
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  root.traverse((o) => {
    const row: unknown[] = [o.name, o.visible, ...o.position.toArray().map(r), ...o.quaternion.toArray().map(r), ...o.scale.toArray().map(r)];
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mat && !Array.isArray(mat)) row.push(r(mat.opacity));
    if (o instanceof THREE.InstancedMesh) row.push(Array.from(o.instanceMatrix.array as Float32Array, r));
    out.push(row);
  });
  return JSON.stringify(out);
}

describe.each(EXAMPLES)("%s (original example, %s engine)", (file, engineId, create) => {
  it("passes SceneSpec.parse and checkScene with zero issues and cites no book page", () => {
    const spec = SceneSpec.parse(raw(file));
    expect(spec.engine).toBe(engineId);
    expect(checkScene(spec)).toEqual([]);
    expect(spec.page.bookPage).toBeUndefined();
    expect(spec.disclaimers.join(" ")).toMatch(/scritt[oa] per AnimaPage/);
    expect(spec.chapters.length).toBeGreaterThanOrEqual(3);
    // Chapter 0 is the prompt example: it must show every part of a chapter.
    const ch = spec.chapters[0]!;
    expect(ch.narration.length).toBeGreaterThanOrEqual(5);
    expect(ch.pins.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ch.quiz.map((q) => q.type))).toEqual(new Set(["choice", "pick"]));
    expect(ch.book && ch.activity && ch.sounds && ch.deep.length > 0).toBeTruthy();
  });

  it("builds in Node and resolves every pin and camera anchor", async () => {
    const { engine, spec } = await build(file, create);
    const out = new THREE.Vector3();
    for (const ch of spec.chapters)
      for (const t of [0, ch.duration / 2, ch.duration - 0.2]) {
        engine.update(ch.id, t);
        for (const anchor of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
          expect(engine.resolveAnchor(anchor, ch.id, t, out), `${ch.id}@${t} ${JSON.stringify(anchor)}`).toBe(true);
          expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
        }
      }
    engine.dispose();
  });

  it("update(chapter, t) is a pure function of its arguments", async () => {
    const { engine, ctx, spec } = await build(file, create);
    for (const ch of spec.chapters) {
      const [t1, t2] = [ch.duration * 0.6, ch.duration * 0.25];
      engine.update(ch.id, t1);
      const a = snapshot(ctx.root);
      engine.update(ch.id, t2);
      expect(snapshot(ctx.root), `${ch.id}: nothing moves`).not.toBe(a);
      engine.update(spec.chapters[0]!.id, 1.3);
      engine.update(ch.id, t1);
      expect(snapshot(ctx.root), ch.id).toBe(a);
    }
    engine.dispose();
  });
});
