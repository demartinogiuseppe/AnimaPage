import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec } from "@pv/scene-spec";
import { checkEarthData, EarthData, earthKeyValue } from "../../scene-spec/src/engines/earth.ts";
import { createEarthEngine } from "../src/engines/earth/index.ts";
import { depthToRadius, probeText, visualRadii } from "../src/engines/earth/globe.ts";
import { buildRays, rayAt, S_RATIO } from "../src/engines/earth/rays.ts";
import { displacementKm, surfaceAt } from "../src/engines/earth/block.ts";
import { fmt, latest, presence } from "../src/engines/earth/util.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/terra-sezione.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function buildEngine() {
  const spec = SceneSpec.parse(raw());
  const engine = createEarthEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Every transform, opacity, emissive and instance matrix of what is rendered (visible subtrees). */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      entry.push(m.opacity, ...(m.emissive ? m.emissive.toArray() : []), o.geometry.drawRange.count);
    }
    if (o instanceof THREE.InstancedMesh) entry.push(...o.instanceMatrix.array);
    out.push(entry);
  });
  return out;
}

describe("terra-sezione scene fixture", () => {
  it("passes SceneSpec, checkScene and the earth cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("earth");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "earth") throw new Error("unreachable");
    expect(checkEarthData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["dentro", "placche", "terremoto"]);
    for (const ch of spec.chapters) {
      expect(ch.book).toBeDefined();
      expect(ch.activity?.test.params?.length).toBeGreaterThan(0);
      expect(ch.sounds?.cues.length).toBeGreaterThan(0);
      expect(ch.deep.length).toBeGreaterThan(0);
      expect(new Set(ch.quiz.map((q) => q.type))).toEqual(new Set(["choice", "pick"]));
    }
  });
});

describe("EarthData schema", () => {
  const base = () => raw().engineData;

  it("rejects inconsistent layers, references and settings", () => {
    const cases: ((d: any) => void)[] = [
      (d) => (d.globe.layers[1].top = 40), // not contiguous
      (d) => (d.globe.layers[3].bottom = 6000), // does not reach the centre
      (d) => (d.globe.layers[1].id = "crosta"), // duplicate id
      (d) => (d.chapters[0].globe.glow[0].layer = "ghost"),
      (d) => (d.chapters[0].globe.probe[1].at = 1), // keys out of order
      (d) => (d.chapters[0].globe.probe[0].value = 9000), // deeper than the centre
      (d) => (d.chapters[2].globe.cut = 90), // quakes need a half globe
      (d) => delete d.globe.shadow, // quakes need sourced shadow angles
      (d) => (d.chapters[1].block.strata = [{ id: "a", name: "A", thickness: 1, color: "#000000" }]), // strata only for "none"
      (d) => (d.chapters[2].block.motion = { speed: 2, time: [{ at: 0, value: 1 }] }), // "none" has no plates
      (d) => (d.chapters[0].params[0].var = "speed"), // no block.motion in that chapter
      (d) => (d.chapters[1].params[1].max = 900), // beyond 500 Ma
      (d) => (d.chapters[1].block.glow[0].part = "ghost"),
      (d) => (d.chapters[1].block.boundary = "volcanic"),
      (d) => d.chapters.push({ chapter: "vuoto" }), // neither globe nor block
      (d) => (d.chapters[1].chapter = "dentro"), // duplicate chapter
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(EarthData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(EarthData.safeParse(base()).success).toBe(true);
  });

  it("cross-checks chapters, times, slider ids and anchors against the scene", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "earth") throw new Error("unreachable");
    const data = structuredClone(spec.engineData);
    data.chapters[1]!.block!.fault = { kind: "normal", quakes: [999], magnitude: 5 };
    const scene = structuredClone(spec);
    scene.chapters[0]!.activity!.test.params = ["ghost"];
    scene.chapters[0]!.pins[0]!.anchor = { entity: "globe", part: "mantle-x" };
    scene.chapters[0]!.camera[0]!.target = { entity: "block", part: "surface" };
    scene.chapters[1]!.pins[0]!.anchor = { entity: "block", part: "ridge" }; // no ridge on a subduction block
    scene.chapters[0]!.pins[1]!.anchor = { entity: "globe", part: "focus" }; // no quake in chapter 1
    const messages = checkEarthData(data, scene).map((i) => i.message);
    expect(messages).toContain('unknown earth param "ghost"');
    expect(messages.some((m) => m.includes('unknown globe part "mantle-x"'))).toBe(true);
    expect(messages).toContain("block anchor in a chapter without a block");
    expect(messages.some((m) => m.includes('unknown block part "ridge"'))).toBe(true);
    expect(messages).toContain('"focus" needs globe.quake');
    expect(messages).toContain("a block quake starts after the chapter ends");
    data.chapters[0]!.chapter = "ghost";
    expect(checkEarthData(data, spec).map((i) => i.message)).toContain('unknown chapter "ghost"');
  });
});

describe("earth helpers", () => {
  it("interpolates keyed values and finds the latest start", () => {
    const keys = [{ at: 2, value: 0 }, { at: 4, value: 10 }];
    expect(earthKeyValue(keys, 0)).toBe(0);
    expect(earthKeyValue(keys, 3)).toBeCloseTo(5);
    expect(earthKeyValue(keys, 9)).toBe(10);
    expect(latest([8, 20], 5)).toBeNull();
    expect(latest([8, 20], 25)).toBe(20);
    expect(presence(0.4, 0, undefined)).toBeCloseTo(0.5);
    expect(fmt(6371)).toBe("6.371");
    expect(fmt(7.55, 2)).toBe("7,55");
    expect(displacementKm(7.55, 20)).toBeCloseTo(1510);
  });

  it("maps real depths onto the drawn shells (thin crust widened, centre at 0)", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "earth") throw new Error("unreachable");
    const g = spec.engineData.globe!;
    const radii = visualRadii(g);
    expect(radii[0]).toBe(5);
    expect(radii[radii.length - 1]).toBe(0);
    expect(radii[0]! - radii[1]!).toBeGreaterThan(0.25); // the 35 km crust is visible
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeLessThan(radii[i - 1]!);
    expect(depthToRadius(g, radii, 2890).layer).toBe(2);
    expect(depthToRadius(g, radii, 6371).r).toBeCloseTo(0);
    expect(visualRadii({ ...g, toScale: true })[1]).toBeCloseTo(5 * (1 - 35 / 6371));
    // Readout numbers come from the layer data: half way down the outer core.
    expect(probeText(g.layers[2]!, 4020)).toContain("4.700 °C");
    expect(probeText(g.layers[2]!, 4020)).toContain("liquido");
  });

  it("builds rays that respect the shadow zones: S stops at the core, no P lands in the P shadow", () => {
    const m = { R: 5, rc: 2.7, pFrom: 103, pTo: 150, sFrom: 103 };
    const rays = buildRays(m, 9, ["P", "S"]);
    const landed = rays.filter((r) => !r.stopped).map((r) => Math.abs(r.delta));
    for (const r of rays.filter((x) => x.wave === "P")) {
      const d = Math.abs(r.delta);
      expect(d < 103 || d >= 150).toBe(true);
      expect(r.pts[r.pts.length - 1]!.length()).toBeCloseTo(5); // lands on the surface
    }
    for (const r of rays.filter((x) => x.wave === "S")) {
      if (r.stopped) expect(r.pts[r.pts.length - 1]!.length()).toBeCloseTo(2.7);
      else expect(Math.abs(r.delta)).toBeLessThan(103);
      for (const p of r.pts) expect(p.length()).toBeGreaterThan(2.7 - 1e-6); // never inside the core
    }
    expect(Math.max(...landed)).toBeGreaterThan(170);
    // S is slower than P on the same path.
    const p = rays.find((r) => r.wave === "P" && r.delta > 0)!;
    const s = rays.find((r) => r.wave === "S" && Math.abs(Math.abs(r.delta) - p.delta) < 1e-9)!;
    expect(s.delta).toBeLessThan(0); // with both waves, S rays fan out on the other side
    expect(s.time[s.time.length - 1]!).toBeCloseTo(p.time[p.time.length - 1]! / S_RATIO);
    const out = new THREE.Vector3();
    expect(rayAt(p, -1, out)).toBeNull();
    expect(rayAt(p, 1e9, out)?.done).toBe(true);
  });

  it("draws every boundary's surface", () => {
    for (const boundary of ["none", "divergent", "subduction", "collision", "transform"] as const) {
      const ys = [-8, -4, 0, 4, 8].map((x) => surfaceAt({ boundary }, x));
      for (const y of ys) expect(Number.isFinite(y)).toBe(true);
    }
    expect(surfaceAt({ boundary: "subduction" }, -1.2)).toBeLessThan(surfaceAt({ boundary: "subduction" }, -6)); // trench
    expect(surfaceAt({ boundary: "collision" }, 0, 1)).toBeGreaterThan(surfaceAt({ boundary: "collision" }, 0, 0)); // mountains grow
  });
});

describe("earth engine", () => {
  it("builds in Node without WebGL or canvas, with bounds around both drawings", async () => {
    const { engine, ctx } = await buildEngine();
    expect(ctx.root.children).toHaveLength(1);
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(10);
    expect(ctx.scene.background).toBeInstanceOf(THREE.Color);
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
  });

  it("is a pure function of (chapter, t): t1 -> t2 -> t1 gives the same frame", async () => {
    const { spec, engine, ctx } = await buildEngine();
    for (const ch of spec.chapters) {
      const t1 = ch.duration * 0.62;
      const t2 = ch.duration * 0.21;
      engine.update(ch.id, t1);
      const a = snapshot(ctx.root);
      engine.update(ch.id, t2);
      const mid = snapshot(ctx.root);
      engine.update("dentro", 3);
      engine.update(ch.id, t1);
      expect(snapshot(ctx.root)).toEqual(a);
      expect(mid).not.toEqual(a);
    }
  });

  it("shows only the current chapter's drawings", async () => {
    const { engine, ctx } = await buildEngine();
    const visible = (name: string) => ctx.root.getObjectByName(name)!.visible;
    engine.update("dentro", 20);
    expect(visible("globe")).toBe(true);
    expect(visible("block:placche")).toBe(false);
    engine.update("placche", 20);
    expect(visible("globe")).toBe(false);
    expect(visible("block:placche")).toBe(true);
    engine.update("terremoto", 35);
    expect(visible("globe")).toBe(true);
    expect(visible("block:terremoto")).toBe(true);
    expect(visible("quake:terremoto")).toBe(true);
    engine.update("terremoto", 10);
    expect(visible("quake:terremoto")).toBe(false); // before the globe quake
  });

  it("resolves every pin and camera anchor of the fixture", async () => {
    const { spec, engine } = await buildEngine();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters) {
      for (const t of [0, ch.duration / 2, ch.duration - 0.5]) {
        engine.update(ch.id, t);
        for (const a of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
          expect(engine.resolveAnchor(a, ch.id, t, out), JSON.stringify(a)).toBe(true);
          expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
        }
      }
    }
    // The probe follows the depth: deeper = closer to the globe centre.
    engine.update("dentro", 12);
    engine.resolveAnchor({ entity: "globe", part: "probe" }, "dentro", 12, out);
    const centre = new THREE.Vector3();
    engine.resolveAnchor({ entity: "globe", part: "centre" }, "dentro", 12, centre);
    const shallow = out.distanceTo(centre);
    engine.update("dentro", 45);
    engine.resolveAnchor({ entity: "globe", part: "probe" }, "dentro", 45, out);
    expect(out.distanceTo(centre)).toBeLessThan(shallow);
    // Hypocentre below the epicentre.
    const hypo = new THREE.Vector3();
    const epi = new THREE.Vector3();
    engine.resolveAnchor({ entity: "block", part: "hypocentre" }, "terremoto", 5, hypo);
    engine.resolveAnchor({ entity: "block", part: "epicentre" }, "terremoto", 5, epi);
    expect(hypo.x).toBeCloseTo(epi.x);
    expect(hypo.y).toBeLessThan(epi.y);
    expect(engine.resolveAnchor({ entity: "block", part: "ghost" }, "placche", 5, out)).toBe(false);
    expect(engine.resolveAnchor({ entity: "globe", part: "probe" }, "placche", 5, out)).toBe(false);
  });

  it("exposes the chapter's sliders and applies overrides purely", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("dentro", 40);
    const [prof] = engine.params!("dentro");
    expect(prof).toMatchObject({ id: "prof", min: 0, max: 6371, step: 10 });
    expect(prof!.value).toBeCloseTo(5100);
    engine.update("placche", 50);
    expect(engine.params!("placche").map((p) => [p.id, p.value])).toEqual([["vel", 7.55], ["ma", 20]]);
    expect(engine.params!("terremoto").map((p) => p.id)).toEqual(["mag"]);

    // Depth override moves the probe; null restores the keyframes.
    const out = new THREE.Vector3();
    engine.update("dentro", 40);
    engine.resolveAnchor({ entity: "globe", part: "probe" }, "dentro", 40, out);
    const own = out.clone();
    engine.setParams!({ prof: 100, ghost: 3 });
    engine.update("dentro", 40);
    engine.resolveAnchor({ entity: "globe", part: "probe" }, "dentro", 40, out);
    expect(out.distanceTo(own)).toBeGreaterThan(1);
    expect(engine.params!("dentro")[0]!.value).toBe(100);
    engine.setParams!({ prof: 99999 });
    expect(engine.params!("dentro")[0]!.value).toBe(6371); // clamped

    // Plate sliders change the frame deterministically.
    engine.setParams!(null);
    engine.update("placche", 30);
    const a = snapshot(ctx.root);
    engine.setParams!({ vel: 2, ma: 5 });
    engine.update("placche", 30);
    const b = snapshot(ctx.root);
    expect(b).not.toEqual(a);
    engine.update("placche", 10);
    engine.update("placche", 30);
    expect(snapshot(ctx.root)).toEqual(b);
    engine.setParams!(null);
    engine.update("placche", 30);
    expect(snapshot(ctx.root)).toEqual(a);
  });

  it("marks key elements for the china style", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("dentro", 30); // mantle glowing
    const keyed: string[] = [];
    ctx.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (o.userData.key === true || m?.userData?.key === true) keyed.push(o.name);
    });
    expect(keyed).toContain("probe");
    expect(keyed).toContain("layer:mantello");
  });
});
