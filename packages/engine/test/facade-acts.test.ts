import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FacadeData, SceneSpec, checkFacadeData, checkScene } from "@pv/scene-spec";
import { facadeStateAt } from "../src/engines/facade/acts.ts";
import { createFacadeEngine } from "../src/engines/facade/index.ts";
import { FACADE_LINE } from "../src/engines/facade/ink.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/_dev-facciata.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function build(json = raw()) {
  const spec = SceneSpec.parse(json);
  const engine = createFacadeEngine();
  const root = new THREE.Group();
  await engine.build({ root, scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("none")) }, spec);
  if (spec.engine !== "facade") throw new Error("unreachable");
  const data = spec.engineData as FacadeData;
  const chapter = data.chapters.find((c) => c.chapter === "occhio")!;
  const building = data.buildings.find((b) => b.id === chapter.building)!;
  return { spec, engine, root, chapter, building };
}

/** Everything that shows: visibility, draw ranges, material kind and opacity, vertex data (no uuids: engines differ). */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      const g = o.geometry as THREE.BufferGeometry;
      const m = o.material as THREE.ShaderMaterial;
      entry.push(m.transparent, m.uniforms?.uAlpha?.value, m.uniforms?.uColor?.value?.getHex(), g.drawRange.start, g.drawRange.count, ...((g.getAttribute("position")?.array as Float32Array | undefined) ?? []));
    }
    out.push(entry);
  });
  return out;
}

const part = (root: THREE.Object3D, building: string, id: string): THREE.Object3D => {
  const found = root.getObjectByName(building)!.children.find((c) => c.name === id && c instanceof THREE.Group);
  if (!found) throw new Error(`no part ${id}`);
  return found;
};

const overlay = (root: THREE.Object3D, name: string): THREE.LineSegments => {
  let hit: THREE.LineSegments | undefined;
  root.traverse((o) => {
    if (o.name === name && o.parent?.visible) hit = o as THREE.LineSegments;
  });
  if (!hit) throw new Error(`no visible ${name}`);
  return hit;
};

describe("occhio chapter of the dev scene", () => {
  it("passes the spec and cross-checks", async () => {
    const { spec } = await build();
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "facade") throw new Error("unreachable");
    expect(checkFacadeData(spec.engineData as FacadeData, spec)).toEqual([]);
  });
});

describe("facadeStateAt", () => {
  it("a drawn part is absent before its act and complete after", async () => {
    const { chapter, building } = await build();
    // f1 is drawn 5..8 s
    expect(facadeStateAt(chapter, building, 4, null).drawn.get("f1")).toBe(0);
    const mid = facadeStateAt(chapter, building, 6.5, null).drawn.get("f1")!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(facadeStateAt(chapter, building, 9, null).drawn.get("f1")).toBe(1);
    // a floor takes its members and bays with it; the building group itself is not a part to draw
    const s = facadeStateAt(chapter, building, 4, null);
    expect(s.drawn.get("f1.members")).toBe(0);
    expect(s.drawn.get("c1")).toBe(0);
    expect(s.drawn.has("palazzo")).toBe(false);
  });

  it("highlight lasts until until", async () => {
    const { chapter, building } = await build();
    const at = (t: number) => facadeStateAt(chapter, building, t, null).highlighted.has("f1.members");
    expect([at(10.9), at(11), at(15.9), at(16), at(19)]).toEqual([false, true, true, false, false]);
  });

  it("highlight without until lasts to the end of the chapter", async () => {
    const { chapter, building } = await build();
    const ch = { ...chapter, acts: [{ do: "highlight" as const, target: "crown", at: 2 }] };
    expect(facadeStateAt(ch, building, 1, null).highlighted.size).toBe(0);
    expect(facadeStateAt(ch, building, 1000, null).highlighted.has("crown")).toBe(true);
  });

  it("cut: the latest started cut slides from the one before it", async () => {
    const { chapter, building } = await build();
    const ch = { ...chapter, acts: [{ do: "cut" as const, bay: "b2", at: 10, dur: 2 }, { do: "cut" as const, bay: "b1", at: 4, dur: 2 }] };
    expect(facadeStateAt(ch, building, 0, null).cut).toEqual({ bay: "b1", p: 0, from: null });
    expect(facadeStateAt(ch, building, 5, null).cut).toEqual({ bay: "b1", p: 0.5, from: null });
    expect(facadeStateAt(ch, building, 9, null).cut).toEqual({ bay: "b1", p: 1, from: null });
    expect(facadeStateAt(ch, building, 11, null).cut).toEqual({ bay: "b2", p: 0.5, from: "b1" });
    expect(facadeStateAt(chapter, building, 9, null).cut).toBeNull();
  });

  it("eye act moves the eye over its duration; sliders override it", async () => {
    const { chapter, building } = await build();
    // eye act 14..18 s towards height 8, x 3, from the defaults 1.6 / 0
    expect(facadeStateAt(chapter, building, 13, null).eye).toEqual({ height: 1.6, x: 0 });
    const mid = facadeStateAt(chapter, building, 16, null).eye;
    expect(mid.height).toBeCloseTo(4.8, 6);
    expect(mid.x).toBeCloseTo(1.5, 6);
    expect(facadeStateAt(chapter, building, 19, null).eye).toEqual({ height: 8, x: 3 });
    expect(facadeStateAt(chapter, building, 19, { "eye-height": 3 }).eye).toEqual({ height: 3, x: 3 });
    expect(facadeStateAt(chapter, building, 0, { "eye-height": 3, "eye-x": -2 }).eye).toEqual({ height: 3, x: -2 });
  });
});

describe("facade engine acts", () => {
  it("scrubbing backwards gives the same scene", async () => {
    const a = await build();
    a.engine.update("occhio", 4);
    const want = snapshot(a.root);
    a.engine.update("occhio", 9);
    a.engine.update("occhio", 12);
    a.engine.update("occhio", 4);
    expect(snapshot(a.root)).toEqual(want);
    const fresh = await build();
    fresh.engine.update("occhio", 4);
    expect(snapshot(fresh.root)).toEqual(want);
  });

  it("traces lines in proportion and fades the paper in at the end", async () => {
    const { engine, root } = await build();
    engine.update("occhio", 4);
    const f1 = part(root, "palazzo", "f1");
    const lines = f1.children.filter((c): c is THREE.LineSegments => c instanceof THREE.LineSegments);
    const paper = f1.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(lines.length).toBeGreaterThan(0);
    expect(paper.length).toBeGreaterThan(0);
    expect(lines.every((l) => !l.visible || l.geometry.drawRange.count === 0)).toBe(true);
    expect(paper.every((m) => !m.visible)).toBe(true);
    engine.update("occhio", 5 + 3 * 0.4);
    const l0 = lines[0]!;
    const total = l0.geometry.getAttribute("position").count;
    expect(l0.geometry.drawRange.count).toBeGreaterThan(0);
    expect(l0.geometry.drawRange.count).toBeLessThan(total);
    expect(l0.geometry.drawRange.count % 2).toBe(0);
    expect(paper.every((m) => !m.visible)).toBe(true);
    engine.update("occhio", 5 + 3 * 0.85);
    expect(paper.every((m) => m.visible && (m.material as THREE.ShaderMaterial).transparent)).toBe(true);
    const alpha = (paper[0]!.material as THREE.ShaderMaterial).uniforms.uAlpha!.value as number;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
    engine.update("occhio", 9);
    expect(paper.every((m) => m.visible && !(m.material as THREE.ShaderMaterial).transparent)).toBe(true);
    expect(l0.geometry.drawRange.count).toBe(Infinity);
  });

  it("highlight swaps the line material and swaps it back, creating nothing", async () => {
    const { engine, root } = await build();
    const lines = part(root, "palazzo", "f1.members").children.filter((c): c is THREE.LineSegments => c instanceof THREE.LineSegments);
    expect(lines.length).toBeGreaterThan(0);
    const hex = (l: THREE.LineSegments) => (l.material as THREE.ShaderMaterial).uniforms.uColor!.value.getHex() as number;
    engine.update("occhio", 12);
    const red = lines.map((l) => l.material);
    expect(lines.every((l) => hex(l) === FACADE_LINE.overlay)).toBe(true);
    engine.update("occhio", 13);
    lines.forEach((l, i) => expect(l.material).toBe(red[i]));
    engine.update("occhio", 17);
    expect(lines.every((l) => hex(l) === FACADE_LINE.ink)).toBe(true);
  });

  it("params report metres and the chapter's current values", async () => {
    const { engine } = await build();
    engine.update("occhio", 0);
    const [h, x] = engine.params!("occhio");
    // palazzo: 13 m wide, 1 + 6 + 5 + 1 = 13 m high
    expect(h).toEqual({ id: "eye-height", label: "Altezza degli occhi (m)", min: 0.5, max: 13, step: 0.1, value: 1.6 });
    expect(x).toEqual({ id: "eye-x", label: "Posizione dell'occhio (m)", min: -6.5, max: 6.5, step: 0.1, value: 0 });
    engine.update("occhio", 19);
    expect(engine.params!("occhio").map((p) => p.value)).toEqual([8, 3]);
    expect(engine.params!("palazzo")).toEqual([]);
    engine.setParams!({ "eye-height": 5 });
    expect(engine.params!("occhio")[0]!.value).toBe(5);
  });

  it("setParams(null) restores the scene's own eye", async () => {
    const { engine, root } = await build();
    engine.update("occhio", 0);
    const before = snapshot(root);
    const view0 = engine.view!("occhio", 0, 1.6)!;
    engine.setParams!({ "eye-height": 9, "eye-x": 4 });
    engine.update("occhio", 0);
    expect(snapshot(root)).not.toEqual(before);
    engine.setParams!(null);
    engine.update("occhio", 0);
    expect(snapshot(root)).toEqual(before);
    expect(engine.view!("occhio", 0, 1.6)!.position.toArray()).toEqual(view0.position.toArray());
  });

  it("while a slider is set the view is the perspective and the overlays follow the eye", async () => {
    const { engine, root } = await build();
    engine.update("occhio", 0);
    expect(engine.view!("occhio", 0, 1.6)!.fov).toBeLessThan(10);
    engine.setParams!({ "eye-height": 9, "eye-x": 2 });
    engine.update("occhio", 0);
    const v = engine.view!("occhio", 0, 1.6)!;
    expect(v.fov).toBeGreaterThan(10);
    const persp = overlay(root, "overlay-perspective");
    expect((persp.material as THREE.LineBasicMaterial).opacity).toBe(1);
    // the horizon is the first segment, at the eye height (building-local metres)
    expect(persp.geometry.getAttribute("position").getY(0)).toBeCloseTo(9, 4);
    // the camera looks along the eye axis
    const scale = root.getObjectByName("palazzo")!.scale.x;
    expect(v.target.y).toBeCloseTo(9 * scale, 4);
    expect(v.target.x).toBeCloseTo(2 * scale, 4);
  });

  it("slider extremes keep overlays finite", async () => {
    const { engine, root } = await build();
    const W = 13;
    const H = 13;
    for (const [h, x] of [[0.5, 0], [H, 0], [1.6, -W / 2], [1.6, W / 2], [H, W / 2], [0.5, -W / 2]] as const) {
      engine.setParams!({ "eye-height": h, "eye-x": x });
      engine.update("occhio", 0);
      const pos = overlay(root, "overlay-perspective").geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        expect(p.every(Number.isFinite), `${h} ${x}`).toBe(true);
        expect(Math.abs(p[0]!)).toBeLessThanOrEqual(0.7 * W);
        expect(p[1]!).toBeGreaterThanOrEqual(-0.1 * H);
        expect(p[1]!).toBeLessThanOrEqual(1.1 * H);
      }
      const v = engine.view!("occhio", 0, 1.6)!;
      expect([...v.position.toArray(), ...v.target.toArray(), v.fov, v.shiftY].every(Number.isFinite)).toBe(true);
    }
  });

  it("the section plane slides to the bay of each cut act", async () => {
    // occhio seen as a sezione from the start, with two cuts: palazzo is 13 m wide, so the edge is x = 7.5 and the bays b0, b1, b2 are at -4.5, 0, 4.5
    const json = raw();
    const ch = json.engineData.chapters.find((c: { chapter: string }) => c.chapter === "occhio");
    ch.views = [{ at: 0, view: "sezione" }];
    ch.acts = [
      { do: "cut", bay: "b0", at: 4, dur: 2 },
      { do: "cut", bay: "b2", at: 10, dur: 4 },
    ];
    const { engine, root } = await build(json);
    const plane = (t: number): number => {
      engine.update("occhio", t);
      let found: THREE.Vector4 | undefined;
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (!found && m?.uniforms?.uSection) found = m.uniforms.uSection.value as THREE.Vector4;
      });
      return -found!.w;
    };
    // the view is a sezione from t = 0, so the plane is the cut position itself
    expect(plane(0)).toBeCloseTo(7.5, 6);
    expect(plane(4)).toBeCloseTo(7.5, 6);
    expect(plane(5)).toBeCloseTo(1.5, 6);
    expect(plane(6)).toBeCloseTo(-4.5, 6);
    expect(plane(9)).toBeCloseTo(-4.5, 6);
    expect(plane(12)).toBeCloseTo(0, 6);
    expect(plane(14)).toBeCloseTo(4.5, 6);
    expect(plane(19)).toBeCloseTo(4.5, 6);
    // scrubbing back gives the same plane
    expect(plane(5)).toBeCloseTo(1.5, 6);
  });

  it("sliders only act in the chapters that offer them", async () => {
    const { engine } = await build();
    engine.setParams!({ "eye-height": 9, "eye-x": 2 });
    engine.update("viste", 0);
    expect(engine.view!("viste", 0, 1.6)!.fov).toBeLessThan(10);
    expect(engine.params!("viste")).toEqual([]);
    engine.update("occhio", 0);
    expect(engine.view!("occhio", 0, 1.6)!.fov).toBeGreaterThan(10);
    // the vanishing-point anchor of another chapter keeps that chapter's eye too
    const out = new THREE.Vector3();
    engine.resolveAnchor({ entity: "horizon" }, "viste", 0, out);
    const scale = out.y / 1.6;
    expect(scale).toBeGreaterThan(0);
    engine.resolveAnchor({ entity: "horizon" }, "occhio", 0, out);
    expect(out.y / scale).toBeCloseTo(9, 4);
  });

  it("scrubbing back from a fading part gives the same scene", async () => {
    const a = await build();
    // f1 is drawn 5..8 s: at 7.6 its paper is mid-fade with fader materials made
    for (const back of [4, 9]) {
      a.engine.update("occhio", 7.6);
      a.engine.update("occhio", back);
      const fresh = await build();
      fresh.engine.update("occhio", back);
      expect(snapshot(a.root), `back to ${back}`).toEqual(snapshot(fresh.root));
    }
  });

  it("anchorShown waits for the draw act", async () => {
    const { engine } = await build();
    const floor = { entity: "floor", part: "f1" } as const;
    const bay = { entity: "bay", part: "c1" } as const;
    const member = { entity: "member", part: "f1" } as const;
    for (const a of [floor, bay, member]) {
      expect(engine.anchorShown!(a, "occhio", 4), "not started").toBe(false);
      expect(engine.anchorShown!(a, "occhio", 6.5), "mid-draw").toBe(false);
      expect(engine.anchorShown!(a, "occhio", 9), "drawn").toBe(true);
      expect(engine.anchorShown!(a, "occhio", 4), "scrubbed back").toBe(false);
    }
    expect(engine.anchorShown!({ entity: "horizon" }, "occhio", 0)).toBe(true);
    expect(engine.anchorShown!({ entity: "building" }, "occhio", 0)).toBe(true);
    // chapters without draw acts show everything
    expect(engine.anchorShown!(floor, "viste", 0)).toBe(true);
  });
});
