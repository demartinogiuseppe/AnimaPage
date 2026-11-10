import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ArtData, checkArtData, checkScene, perspectivePoint, SceneSpec, vanishingPointOf } from "@pv/scene-spec";
import { createArtEngine } from "../src/engines/art/index.ts";
import { fallbackPalette, paletteFromPixels } from "../src/engines/art/image.ts";
import { buildColumn, buildElement, ORDER_RATIO, stoneMaterial } from "../src/engines/art/orders.ts";
import { overlayStrokes, strokeFraction } from "../src/engines/art/strokes.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/arte-ultima-cena.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function buildEngine(json: unknown = raw()) {
  const spec = SceneSpec.parse(json);
  const engine = createArtEngine();
  const loads: string[] = [];
  const ctx = {
    root: new THREE.Group(),
    scene: new THREE.Scene(),
    loadAsset: (p: string) => {
      loads.push(p);
      return Promise.reject(new Error("no assets in Node"));
    },
  };
  await engine.build(ctx, spec);
  return { spec, engine, ctx, loads };
}

function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, o.userData.key === true, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        entry.push(m.opacity);
        if (m instanceof THREE.ShaderMaterial) entry.push(m.uniforms.uDim!.value, ...(m.uniforms.uRect!.value as THREE.Vector4).toArray());
      }
    }
    out.push(entry);
  });
  return out;
}

describe("arte-ultima-cena scene fixture", () => {
  it("passes SceneSpec, checkScene and checkArtData with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("art");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "art") throw new Error("unreachable");
    expect(checkArtData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["momento", "prospettiva", "gruppi"]);
    expect(new Set(spec.chapters.flatMap((c) => c.quiz.map((q) => q.type)))).toEqual(new Set(["choice", "pick"]));
    expect(spec.chapters.every((c) => c.activity && c.book && c.sounds)).toBe(true);
  });

  it("the traced perspective lines converge on Christ's head", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "art") throw new Error("unreachable");
    const p = spec.engineData.overlays.find((o) => o.kind === "perspective");
    if (p?.kind !== "perspective") throw new Error("no perspective");
    const vp = perspectivePoint(p)!;
    const christ = spec.engineData.regions.find((r) => r.id === "cristo")!.rect;
    expect(vp[0]).toBeGreaterThan(christ[0]);
    expect(vp[0]).toBeLessThan(christ[0] + christ[2]);
    // upper part of Christ's rectangle: the head
    expect(vp[1]).toBeGreaterThan(christ[1]);
    expect(vp[1]).toBeLessThan(christ[1] + christ[3] * 0.3);
  });
});

describe("ArtData schema and checks", () => {
  const base = () => raw().engineData;

  it("rejects bad references and inconsistent data", () => {
    const cases: ((d: any) => void)[] = [
      (d) => d.regions.push({ ...d.regions[0] }), // duplicate id
      (d) => (d.regions[0].rect = [0.9, 0.5, 0.2, 0.1]), // outside the image
      (d) => (d.layers[0].region = "ghost"),
      (d) => (d.overlays[1].perspective = "asse"), // guess on a non-perspective
      (d) => d.overlays.push({ id: "ax2", kind: "axis", x: 0.5, y: 0.5 }),
      (d) => d.overlays.push({ id: "pal2", kind: "palette" }),
      (d) => (d.chapters[0].actions[0].target = "prospettiva"), // tour on an overlay
      (d) => (d.chapters[0].actions[0].until = 1), // until before at
      (d) => (d.params[0].target = "prospettiva"), // guess-x on a perspective
      (d) => (d.params[0].max = -1),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(ArtData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(ArtData.safeParse(base()).success).toBe(true);
  });

  it("checkArtData: public-domain gate, anchors, chapters and convergence", () => {
    const scene = SceneSpec.parse(raw());
    if (scene.engine !== "art") throw new Error("unreachable");
    const issues = (mutate: (s: any) => void) => {
      const s = structuredClone(scene) as any;
      mutate(s);
      return checkArtData(ArtData.parse(s.engineData), s).map((i) => i.message).join("\n");
    };
    expect(issues((s) => (s.sources.find((x: any) => x.id === "commons-cenacolo").license = "CC BY-SA 4.0"))).toMatch(/public-domain licence/);
    expect(issues((s) => delete s.sources.find((x: any) => x.id === "commons-cenacolo").license)).toMatch(/public-domain licence/);
    expect(issues((s) => (delete s.engineData.artwork.image, delete s.engineData.artwork.link))).toMatch(/link/);
    expect(issues((s) => (s.chapters[0].pins[0].anchor = { entity: "region", part: "ghost" }))).toMatch(/unresolvable anchor/);
    expect(issues((s) => (s.chapters[1].camera[0].target = { entity: "layer", part: "nope" }))).toMatch(/unresolvable anchor/);
    expect(issues((s) => (s.engineData.chapters[0].chapter = "ghost"))).toMatch(/unknown chapter/);
    expect(issues((s) => (s.engineData.chapters[0].actions[0].at = 500, s.engineData.chapters[0].actions[0].until = 600))).toMatch(/after the chapter ends/);
    expect(issues((s) => (s.chapters[1].activity.test.params = ["ghost"]))).toMatch(/not an art param/);
    expect(issues((s) => (s.engineData.overlays[0].lines[0] = [0.0, 0.9, 0.2, 0.95]))).toMatch(/does not pass near/);
    expect(issues((s) => (s.engineData.artwork.kind = "sculpture", delete s.engineData.artwork.image))).toMatch(/needs an image/);
  });

  it("vanishingPointOf finds the intersection and rejects parallel lines", () => {
    const vp = vanishingPointOf([
      [0, 0, 0.25, 0.25],
      [1, 0, 0.75, 0.25],
      [0, 1, 0.25, 0.75],
    ]);
    expect(vp![0]).toBeCloseTo(0.5, 9);
    expect(vp![1]).toBeCloseTo(0.5, 9);
    expect(vanishingPointOf([[0, 0, 1, 0], [0, 0.5, 1, 0.5]])).toBeNull();
  });
});

describe("art engine (Node: no image decoding)", () => {
  it("builds without decoding or loading the image, with sane bounds", async () => {
    const { engine, ctx, loads } = await buildEngine();
    expect(loads).toEqual([]);
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(6);
    expect(b.radius).toBeLessThan(12);
    const canvas = ctx.root.getObjectByName("canvas") as THREE.Mesh;
    expect(canvas).toBeTruthy();
    expect(canvas.userData.key).toBe(true);
    // real proportions: 2048 x 1067 image on a 12-unit canvas
    const g = canvas.geometry as THREE.PlaneGeometry;
    expect(g.parameters.width).toBe(12);
    expect(g.parameters.height).toBeCloseTo((12 * 1067) / 2048, 9);
  });

  it("update is a pure function of (chapter, t): t1 -> t2 -> t1 gives the same state", async () => {
    const { engine, ctx } = await buildEngine();
    for (const [ch, t1, t2] of [
      ["momento", 33, 62],
      ["prospettiva", 12, 50],
      ["gruppi", 20, 60],
    ] as const) {
      engine.update(ch, t1);
      const a = snapshot(ctx.root);
      engine.update(ch, t2);
      const b = snapshot(ctx.root);
      engine.update("gruppi", 3);
      engine.update(ch, t1);
      expect(snapshot(ctx.root)).toEqual(a);
      expect(b).not.toEqual(a);
    }
  });

  it("perspective lines grow towards the vanishing point and become key", async () => {
    const { engine, ctx } = await buildEngine();
    const group = ctx.root.getObjectByName("overlay:prospettiva")!;
    engine.update("prospettiva", 5);
    expect(group.visible).toBe(false);
    const lengths = () => group.children.filter((c) => c instanceof THREE.Mesh && c.visible).map((c) => c.scale.x);
    engine.update("prospettiva", 11);
    const early = lengths();
    engine.update("prospettiva", 20);
    const late = lengths();
    expect(group.visible).toBe(true);
    expect(group.userData.key).toBe(true);
    expect(late.length).toBe(6);
    expect(Math.max(...early)).toBeLessThan(Math.max(...late));
    expect(ctx.root.getObjectByName("vanishing-point:prospettiva")!.visible).toBe(true);
  });

  it("overlays are thin (≤ 0.4% of the width), semi-transparent and fade out after their window", async () => {
    const json = raw();
    // a generated-style show without until: it must not stay on for the rest of the chapter
    json.engineData.overlays.push({ id: "riga", kind: "arrow", from: [0.92, 0.5], to: [0.06, 0.5], style: "light" });
    json.engineData.chapters[1].actions.push({ do: "show", target: "riga", at: 1, draw: 4 });
    const { engine, ctx } = await buildEngine(json);
    const group = ctx.root.getObjectByName("overlay:riga")!;
    engine.update("prospettiva", 6);
    expect(group.visible).toBe(true);
    const strips = group.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
    for (const m of strips) expect(m.scale.y).toBeLessThanOrEqual(12 * 0.004 + 1e-9);
    expect((strips[0]!.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(0.9);
    engine.update("prospettiva", 1 + 4 + 8 + 0.1);
    expect(group.visible).toBe(false);
    engine.update("prospettiva", 6);
    expect(group.visible).toBe(true);
  });

  it("resolves region, vanishing-point, layer and artwork anchors on the canvas", async () => {
    const { engine } = await buildEngine();
    const v = new THREE.Vector3();
    engine.update("prospettiva", 30);
    expect(engine.resolveAnchor({ entity: "vanishing-point" }, "prospettiva", 30, v)).toBe(true);
    const vp = v.clone();
    expect(engine.resolveAnchor({ entity: "region", part: "cristo" }, "prospettiva", 30, v)).toBe(true);
    expect(Math.abs(v.x - vp.x)).toBeLessThan(0.3); // the vanishing point is on Christ's vertical
    expect(vp.y).toBeGreaterThan(v.y); // above the centre of his rectangle (the head)
    expect(engine.resolveAnchor({ entity: "artwork" }, "prospettiva", 30, v)).toBe(true);
    expect(v.x).toBeCloseTo(0, 9);
    expect(engine.resolveAnchor({ entity: "region", part: "ghost" }, "prospettiva", 30, v)).toBe(false);
    // layers come off the canvas while lifted
    engine.update("gruppi", 2);
    engine.resolveAnchor({ entity: "layer", part: "l-gruppo-2" }, "gruppi", 2, v);
    const flat = v.z;
    engine.update("gruppi", 20);
    engine.resolveAnchor({ entity: "layer", part: "l-gruppo-2" }, "gruppi", 20, v);
    expect(v.z - flat).toBeCloseTo(0.55, 6);
  });

  it("guess sliders move the guessed point; null restores the scene", async () => {
    const { engine, ctx } = await buildEngine();
    const params = engine.params!("prospettiva");
    expect(params.map((p) => p.id)).toEqual(["fuga-x", "fuga-y"]);
    expect(params[0]!.value).toBeCloseTo(0.3, 9);
    expect(engine.params!("momento")).toEqual([]);
    const v = new THREE.Vector3();
    engine.update("prospettiva", 40);
    expect(ctx.root.getObjectByName("overlay:ipotesi")!.visible).toBe(false);
    engine.resolveAnchor({ entity: "vanishing-point", part: "ipotesi" }, "prospettiva", 40, v);
    const before = v.clone();
    engine.setParams!({ "fuga-x": 0.494, "fuga-y": 2 }); // y clamped to 1
    expect(engine.params!("prospettiva").map((p) => p.value)).toEqual([0.494, 1]);
    engine.update("prospettiva", 40);
    expect(ctx.root.getObjectByName("overlay:ipotesi")!.visible).toBe(true);
    engine.resolveAnchor({ entity: "vanishing-point", part: "ipotesi" }, "prospettiva", 40, v);
    expect(v.x).toBeGreaterThan(before.x);
    expect(v.y).toBeLessThan(before.y);
    engine.setParams!(null);
    engine.update("prospettiva", 40);
    expect(ctx.root.getObjectByName("overlay:ipotesi")!.visible).toBe(false);
  });

  it("depth slider lifts its layer", async () => {
    const { engine } = await buildEngine();
    const v = new THREE.Vector3();
    engine.update("gruppi", 2);
    engine.resolveAnchor({ entity: "layer", part: "l-gruppo-2" }, "gruppi", 2, v);
    const flat = v.z;
    engine.setParams!({ rilievo: 1.2 });
    engine.update("gruppi", 2);
    engine.resolveAnchor({ entity: "layer", part: "l-gruppo-2" }, "gruppi", 2, v);
    expect(v.z - flat).toBeCloseTo(1.2, 6);
  });

  it("a non-public-domain work gets a placeholder canvas and never loads an image", async () => {
    const json = raw();
    delete json.engineData.artwork.image;
    const { engine, ctx, loads } = await buildEngine(json);
    expect(loads).toEqual([]);
    expect(ctx.root.getObjectByName("canvas")).toBeTruthy();
    engine.update("momento", 25);
    expect(engine.bounds().radius).toBeGreaterThan(1);
  });

  it("dispose removes everything it added", async () => {
    const { engine, ctx } = await buildEngine();
    engine.dispose();
    expect(ctx.root.children.length).toBe(0);
    expect(ctx.scene.children.length).toBe(0);
  });
});

describe("art helpers", () => {
  it("palette k-means is deterministic and sorted by size", () => {
    const px: number[] = [];
    for (let i = 0; i < 60; i++) px.push(200, 30, 30, 255);
    for (let i = 0; i < 30; i++) px.push(20, 40, 210, 255);
    for (let i = 0; i < 10; i++) px.push(240, 240, 240, 255);
    const a = paletteFromPixels(px, 3);
    expect(a).toEqual(paletteFromPixels(px, 3));
    expect(a).toEqual(["#c81e1e", "#1428d2", "#f0f0f0"]);
    expect(fallbackPalette(4)).toHaveLength(4);
  });

  it("strokes: perspective lines end at the vanishing point; draw progress windows", () => {
    const toPlane = (u: number, v: number): [number, number] => [u, 1 - v];
    const s = overlayStrokes({ id: "p", kind: "perspective", lines: [[0, 0, 0.1, 0.1], [1, 0, 0.9, 0.1]] }, [0.5, 0.5], toPlane, 1, 1);
    expect(s.map((x) => x.b)).toEqual([[0.5, 0.5], [0.5, 0.5]]);
    expect(strokeFraction(s[1]!, 0)).toBe(0);
    expect(strokeFraction(s[0]!, 1)).toBe(1);
    const grid = overlayStrokes({ id: "g", kind: "grid", grid: "thirds" }, null, toPlane, 1, 1);
    expect(grid).toHaveLength(2 * 20 + 2 * 30); // dashed: 20 dashes per vertical, 30 per horizontal line
  });

  it("classical orders: column height = ratio x lower diameter, elements build in Node", () => {
    for (const order of ["doric", "ionic", "corinthian"] as const) {
      const col = buildColumn(order, 7, stoneMaterial());
      const box = new THREE.Box3().setFromObject(col);
      expect(box.max.y).toBeCloseTo(7, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
      const shaft = col.children.find((c) => c instanceof THREE.Mesh && (c.geometry as THREE.BufferGeometry).index && c.position.y >= 0)!;
      expect(shaft).toBeTruthy();
      expect(ORDER_RATIO[order]).toBeGreaterThanOrEqual(7);
    }
    const els = [
      buildElement({ id: "a", type: "arch", pos: [0, 0], span: 2, height: 2, depth: 1 }),
      buildElement({ id: "d", type: "dome", pos: [0, 0], radius: 2, y: 3, drum: 1 }),
      buildElement({ id: "p", type: "pediment", from: [-3, 0], to: [3, 0], y: 5, depth: 1 }),
      buildElement({ id: "e", type: "entablature", from: [-3, 0], to: [3, 0], y: 4, depth: 1 }),
    ];
    expect(els[0]!.top.y).toBeCloseTo(2 + 1 + 0.56 * 0.8, 6);
    expect(els[1]!.top.y).toBeGreaterThan(6);
    expect(els.every((e) => new THREE.Box3().setFromObject(e.object).isEmpty() === false)).toBe(true);
  });

  it("architecture scene: columns rise with show actions and resolve element anchors", async () => {
    const json = raw();
    json.engineData.artwork.kind = "architecture";
    delete json.engineData.artwork.image;
    json.engineData.presentation = { mount: "plinth" };
    json.engineData.regions = [];
    json.engineData.layers = [];
    json.engineData.params = [];
    json.engineData.overlays = [];
    json.engineData.architecture = [
      { id: "c1", type: "column", order: "doric", pos: [-2, 0], height: 4 },
      { id: "c2", type: "column", order: "doric", pos: [2, 0], height: 4 },
      { id: "tr", type: "entablature", from: [-2.5, 0], to: [2.5, 0], y: 4, depth: 1 },
    ];
    json.engineData.chapters = [{ chapter: "momento", actions: [{ do: "show", target: "tr", at: 5 }] }];
    for (const ch of json.chapters) {
      ch.pins = [];
      ch.quiz = ch.quiz.filter((q: any) => q.type === "choice");
      ch.camera = [{ at: 0, target: { entity: "element", part: "tr" }, distance: 12, azimuth: 0, elevation: 10 }];
      if (ch.activity) delete ch.activity.test.params;
      for (const s of ch.narration) s.highlight = [];
    }
    const spec = SceneSpec.parse(json);
    if (spec.engine !== "art") throw new Error("unreachable");
    expect(checkArtData(spec.engineData, spec)).toEqual([]);
    const { engine, ctx } = await buildEngine(json);
    expect(ctx.root.getObjectByName("canvas")).toBeFalsy();
    engine.update("momento", 1);
    expect(ctx.root.getObjectByName("element:tr")!.visible).toBe(false);
    expect(ctx.root.getObjectByName("element:c1")!.visible).toBe(true);
    engine.update("momento", 9);
    expect(ctx.root.getObjectByName("element:tr")!.visible).toBe(true);
    const v = new THREE.Vector3();
    expect(engine.resolveAnchor({ entity: "element", part: "tr" }, "momento", 9, v)).toBe(true);
    expect(v.y).toBeCloseTo(4.8, 6);
  });
});
