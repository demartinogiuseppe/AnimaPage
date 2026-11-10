import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDisplayLocale } from "@pv/scene-spec/i18n";
import { buildingSize, checkFacadeData, checkScene, FacadeBuilding, FacadeData, floorLayout, SceneSpec } from "@pv/scene-spec";
import { createFacadeEngine } from "../src/engines/facade/index.ts";
import { FACADE_LINE, FacadeInk } from "../src/engines/facade/ink.ts";
import { buildModel } from "../src/engines/facade/model.ts";

const built = vi.hoisted(() => [] as Array<{ group: { traverse(f: (o: any) => void): void } }>);
vi.mock("../src/engines/facade/model.ts", async (orig) => {
  const m = await orig<typeof import("../src/engines/facade/model.ts")>();
  return {
    ...m,
    buildModel: (...a: Parameters<typeof m.buildModel>) => {
      const r = m.buildModel(...a);
      built.push(r);
      return r;
    },
  };
});

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/_dev-facciata.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));
type Raw = Record<string, any>;

/** The "palazzo" building of the dev scene, as raw JSON to tweak. */
const palazzoRaw = (): Raw => structuredClone(raw().engineData.buildings[0]);
const model = (b: Raw) => buildModel(FacadeBuilding.parse(b), new FacadeInk());

/** The dev scene without the catalogue chapters: the lesson scale (one for all buildings) follows the largest building. */
const palazzoAndCasa = () => {
  const j = raw();
  j.engineData.buildings = j.engineData.buildings.slice(0, 2);
  j.engineData.chapters = j.engineData.chapters.slice(0, 2);
  j.chapters = j.chapters.slice(0, 2);
  return j;
};

async function buildEngine(json = raw()) {
  const spec = SceneSpec.parse(json);
  const engine = createFacadeEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Distances (z of the hits, nearest first) of a ray along -z at (x, y) over everything in the group. */
function hitsAlongZ(group: THREE.Object3D, x: number, y: number): number[] {
  group.updateMatrixWorld(true);
  const r = new THREE.Raycaster(new THREE.Vector3(x, y, 100), new THREE.Vector3(0, 0, -1));
  return r.intersectObject(group, true).filter((h) => h.object instanceof THREE.Mesh).map((h) => h.point.z);
}

describe("dev scene _dev-facciata", () => {
  it("passes SceneSpec, checkScene and the facade cross-checks", () => {
    const spec = SceneSpec.parse(raw());
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "facade") throw new Error("unreachable");
    expect(checkFacadeData(spec.engineData as FacadeData, spec)).toEqual([]);
  });
});

describe("facade model", () => {
  it("buildModel size matches buildingSize", () => {
    for (const b of raw().engineData.buildings) {
      const spec = FacadeBuilding.parse(b);
      const m = buildModel(spec, new FacadeInk());
      const want = buildingSize(spec);
      expect(Math.abs(m.size.width - want.width)).toBeLessThan(0.01);
      expect(Math.abs(m.size.height - want.height)).toBeLessThan(0.01);
      expect(m.size.depth).toBeCloseTo(spec.depth ?? Math.min(0.8 * want.width, 20), 6);
    }
    const b = palazzoRaw();
    b.depth = 7;
    expect(model(b).size.depth).toBe(7);
  });

  it("an open arch is a passage, a wall is not", () => {
    const b = palazzoRaw();
    b.floors[1].bays[1].cell = { el: "wall" };
    const m = model(b);
    // bay b1 (an open arch) at 1 m above the floor level (the base is 1 m high)
    const arch = hitsAlongZ(m.group, 0, 2);
    expect(arch.length).toBeGreaterThan(0);
    expect(arch[0]!).toBeLessThan(-1);
    // bay c1 is now a wall: the ray meets the front face
    const wall = hitsAlongZ(m.group, 0, 1 + 6 + 1);
    expect(wall[0]!).toBeCloseTo(0, 2);
  });

  it("forward moves a bay's front", () => {
    const b = palazzoRaw();
    b.floors[1].bays[1].cell = { el: "wall" };
    b.floors[1].bays[1].forward = 0.6;
    const m = model(b);
    expect(hitsAlongZ(m.group, 0, 1 + 6 + 1)[0]!).toBeCloseTo(0.6, 2);
    expect(hitsAlongZ(m.group, -4.5, 1 + 6 + 1)[0]!).toBeLessThan(0.3);
    expect(m.front).toBeGreaterThanOrEqual(0.6);
    expect(model(palazzoRaw()).front).toBeLessThan(0.6);
  });

  it("parts exist for every id", () => {
    const m = model(palazzoRaw());
    for (const id of ["palazzo", "f0", "f1", "b0", "b1", "b2", "c0", "c1", "c2", "f0.members", "f1.members", "crown", "base"]) expect(m.parts.get(id), id).toBeInstanceOf(THREE.Group);
    // every bay part draws at least its own outline (named "<bay>.outline"), whatever its cell
    for (const f of m.layout.floors) for (const bay of f.bays) {
      const lines = m.parts.get(bay.id)!.children.filter((o): o is THREE.LineSegments => o instanceof THREE.LineSegments && o.geometry.name === `${bay.id}.outline`);
      expect(lines.length, `bay ${bay.id} outline`).toBe(1);
      expect(lines[0]!.geometry.getAttribute("position").count, `bay ${bay.id} segments`).toBeGreaterThan(0);
    }
    expect(m.group.userData.inkSelf).toBe(true);
    expect(m.parts.get("palazzo")).toBe(m.group);
    // a building without base or crown still has those parts (empty)
    const casa = model(structuredClone(raw().engineData.buildings[1]));
    expect(casa.parts.get("g0.members")).toBeInstanceOf(THREE.Group);
    const bare = palazzoRaw();
    delete bare.base;
    delete bare.crown;
    const m2 = model(bare);
    expect(m2.parts.get("base")).toBeInstanceOf(THREE.Group);
    expect(m2.parts.get("crown")).toBeInstanceOf(THREE.Group);
  });

  it("draw calls stay low", () => {
    const bays = (p: string) => [...Array(7)].map((_, i) => ({ id: `${p}${i}`, width: 3, cell: { el: "window", w: 1, h: 1.6, sill: 1, top: "round", mullion: true } }));
    const m = model({
      id: "wide",
      name: "Largo",
      style: "classical",
      base: { height: 0.8, steps: 3 },
      floors: ["a", "b", "c"].map((f) => ({ id: f, height: 4, wall: f === "a" ? "rusticated" : "smooth", top: "entablature", members: { type: "pilaster", order: "doric", width: 0.4 }, bays: bays(f) })),
      crown: { type: "pediment" },
    });
    let n = 0;
    m.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) n++;
    });
    // per floor: wall, members, 7 bays (paper + hull + crease lines of the trim, plus the outline) and the
    // band parts; plus the crown and the base
    expect(n).toBeLessThanOrEqual(3 * (7 * 4 + 4) + 12);
  });

  it("builds a 1-bay and a 15-bay floor without throwing", () => {
    const one = { id: "e", width: 1, cell: { el: "window", w: 0.5, h: 1, sill: 0.5 } };
    const many = [...Array(15)].map((_, i) => ({ id: `m${i}`, width: 1.5, cell: i % 3 === 0 ? { el: "arch" } : { el: "gallery", columns: 3, h: 1, sill: 1 } }));
    const mk = (bays: Raw[], members?: Raw) => ({ id: "x", name: "X", style: "baroque", floors: [{ id: "x0", height: 4, bays, ...(members ? { members } : {}), portico: { depth: 3 } }, { id: "x1", height: 3, wall: "rusticated", bays: bays.map((b) => ({ ...b, id: `${b.id}u` })) }] });
    expect(() => model(mk([one]))).not.toThrow();
    expect(() => model(mk([one], { type: "pier", width: 0.2, rusticated: true }))).not.toThrow();
    expect(() => model(mk(many, { type: "half-column", order: "tuscan", width: 0.3, paired: true }))).not.toThrow();
  });

  it("floorLayout and the model agree on the façade x range", () => {
    const b = FacadeBuilding.parse(palazzoRaw());
    const box = new THREE.Box3().setFromObject(buildModel(b, new FacadeInk()).group);
    const w = floorLayout(b.floors[0]!).width;
    expect(box.min.x).toBeGreaterThanOrEqual(-w / 2 - 0.5);
    expect(box.max.x).toBeLessThanOrEqual(w / 2 + 0.5);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.35);
  });
});

describe("facade engine", () => {
  it("anchors resolve on the façade", async () => {
    const { engine, ctx } = await buildEngine(palazzoAndCasa());
    const scale = 6 / 13;
    const out = new THREE.Vector3();
    expect(engine.resolveAnchor({ entity: "bay", part: "c2" }, "palazzo", 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(4.5 * scale, 6);
    expect(out.z).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeGreaterThan(0);
    expect(engine.resolveAnchor({ entity: "bay", part: "c2", offset: [1, 0, 0] }, "palazzo", 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(4.5 * scale + 1, 6);
    expect(engine.resolveAnchor({ entity: "bay", part: "nope" }, "palazzo", 0, out)).toBe(false);
    expect(engine.resolveAnchor({ entity: "bay", part: "d0" }, "palazzo", 0, out)).toBe(false);
    expect(engine.resolveAnchor({ entity: "floor", part: "f1" }, "palazzo", 0, out)).toBe(true);
    expect(out.y).toBeCloseTo((1 + 6 + 2.5) * scale, 6);
    expect(engine.resolveAnchor({ entity: "building" }, "palazzo", 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(13 * scale, 6);
    // member i from the left: the floor's pilasters sit on the bay edges (x = -6.5 .. 6.5)
    expect(engine.resolveAnchor({ entity: "member", part: "f1", index: 3 }, "palazzo", 0, out)).toBe(true);
    expect(out.x).toBeCloseTo((6.5 - 0.125) * scale, 6);
    expect(engine.resolveAnchor({ entity: "member", part: "f1", index: 9 }, "palazzo", 0, out)).toBe(false);
    expect(engine.resolveAnchor({ pos: [1, 2, 3] }, "palazzo", 0, out)).toBe(true);
    void ctx;
  });

  it("only the chapter's building is visible", async () => {
    const { engine, ctx } = await buildEngine();
    const palazzo = ctx.root.getObjectByName("palazzo")!;
    const casa = ctx.root.getObjectByName("casa")!;
    engine.update("palazzo", 0);
    expect([palazzo.visible, casa.visible]).toEqual([true, false]);
    engine.update("casa", 3);
    expect([palazzo.visible, casa.visible]).toEqual([false, true]);
    engine.update("palazzo", 0);
    expect([palazzo.visible, casa.visible]).toEqual([true, false]);
  });

  it("bounds cover the largest building", async () => {
    const { engine, ctx } = await buildEngine(palazzoAndCasa());
    ctx.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const palazzo = ctx.root.getObjectByName("palazzo")!;
    box.setFromObject(palazzo);
    const { center, radius } = engine.bounds();
    const corners = [box.min, box.max].flatMap((a) => [a.x, a.y, a.z]);
    void corners;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) expect(new THREE.Vector3(x, y, z).distanceTo(center)).toBeLessThanOrEqual(radius + 1e-6);
    expect(radius).toBeLessThan(10);
  });

  it("update is a pure function of the chapter (no state between calls)", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("casa", 5);
    engine.update("palazzo", 1);
    const snap = () => ctx.root.children.map((c) => c.visible);
    const a = snap();
    engine.update("palazzo", 1);
    expect(snap()).toEqual(a);
  });

  it("keeps the ink resolution in step with the renderer", async () => {
    const { ctx } = await buildEngine();
    const hull = ((): THREE.Mesh => {
      let found: THREE.Mesh | undefined;
      ctx.root.traverse((o) => {
        if (!found && o instanceof THREE.Mesh && (o.material as THREE.ShaderMaterial).side === THREE.BackSide) found = o;
      });
      return found!;
    })();
    const material = hull.material as THREE.ShaderMaterial;
    const fakeRenderer = {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 900),
      getPixelRatio: () => 2,
    };
    (hull.onBeforeRender as (r: unknown) => void)(fakeRenderer);
    expect((material.uniforms.uRes!.value as THREE.Vector2).toArray()).toEqual([1600, 900]);
    expect(material.uniforms.uWidth!.value).toBeCloseTo(FACADE_LINE.silhouettePx * 2, 6);
  });
});

describe("facade body as a section sees it", () => {
  /** Hits of a ray over the paper meshes (the ones with poché), nearest first, with whether the face turns away. */
  const paperHits = (group: THREE.Object3D, origin: THREE.Vector3, dir: THREE.Vector3) => {
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(origin, dir);
    return ray
      .intersectObject(group, true)
      .filter((h) => h.object instanceof THREE.Mesh && "uPoche" in ((h.object.material as THREE.ShaderMaterial).uniforms ?? {}))
      .map((h) => ({ point: h.point, back: h.face!.normal.dot(dir) > 0, normal: h.face!.normal }));
  };

  it("a cut shows the walls and slabs as poché and the inside as paper", () => {
    const m = model(palazzoRaw());
    const upper = m.layout.floors[1]!;
    const y = (upper.y0 + upper.y1) / 2;
    const cx = 0;
    const left = new THREE.Vector3(-1, 0, 0);
    // inside the back wall, looking along -x from the cut: the wall's own inside, a back face (poché)
    const wall = paperHits(m.group, new THREE.Vector3(cx, y, -m.size.depth + 0.2), left);
    expect(wall[0]!.back).toBe(true);
    // through the slab bands (the roof, and the floor of the upper floor): one closed solid, poché
    const roof = m.layout.floors[m.layout.floors.length - 1]!;
    for (const band of [roof.y1 - 0.2, upper.y0 - 0.2]) {
      const slab = paperHits(m.group, new THREE.Vector3(cx, band, -m.size.depth / 2), left);
      expect(slab[0]!.back, `slab band at y ${band}`).toBe(true);
    }
    // in the room: the far side wall's inner face, a front face (paper), at least 0.6 m thick
    const room = paperHits(m.group, new THREE.Vector3(cx, y, -m.size.depth / 2), left);
    expect(room[0]!.back).toBe(false);
    expect(room[0]!.point.x - upper.x0).toBeGreaterThanOrEqual(0.6 - 1e-6);
    // a floor slab at the upper floor's line: its top face is paper at y0
    const down = paperHits(m.group, new THREE.Vector3(cx, 100, -m.size.depth / 2), new THREE.Vector3(0, -1, 0));
    expect(down.some((h) => !h.back && Math.abs(h.point.y - upper.y0) < 1e-6)).toBe(true);
    // and the slab is a closed solid at least 0.4 m thick: the next hit down is its underside, a back face
    const top = down.findIndex((h) => !h.back && Math.abs(h.point.y - upper.y0) < 1e-6);
    expect(down[top + 1]!.back).toBe(true);
    expect(upper.y0 - down[top + 1]!.point.y).toBeGreaterThanOrEqual(0.4 - 1e-6);
  });
});


describe.each([
  ["facciata-palazzo-rucellai", ["disegno", "ordini", "strada", "sezione"]],
  ["facciata-tempio-chiesa", ["nettuno", "miniato", "pantheon"]],
] as const)("%s scene fixture", (name, chapterIds) => {
  const path = fileURLToPath(new URL(`../../../fixtures/public/scenes/${name}.scene.json`, import.meta.url));
  const load = () => JSON.parse(readFileSync(path, "utf8"));

  it("parses and passes checkScene and checkFacadeData with zero issues", () => {
    const spec = SceneSpec.parse(load());
    expect(spec.engine).toBe("facade");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "facade") throw new Error("unreachable");
    expect(checkFacadeData(spec.engineData as FacadeData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(chapterIds);
    for (const ch of spec.chapters) {
      expect(ch.book, ch.id).toBeDefined();
      expect(ch.pins.length, ch.id).toBeGreaterThan(0);
      expect(new Set(ch.quiz.map((q) => q.type)), ch.id).toEqual(new Set(["choice", "pick"]));
    }
  });

  it("builds, and every chapter updates from 0 to its duration in 0.5 s steps", async () => {
    const { spec, engine } = await buildEngine(load());
    for (const ch of spec.chapters) {
      for (let t = 0; t <= ch.duration + 1e-9; t += 0.5) expect(() => engine.update(ch.id, t), `${ch.id} at ${t}`).not.toThrow();
    }
  });

  it("resolves every pin anchor at its chapter's mid-time", async () => {
    const { spec, engine } = await buildEngine(load());
    for (const ch of spec.chapters) {
      engine.update(ch.id, ch.duration / 2);
      for (const p of ch.pins) {
        const out = new THREE.Vector3();
        expect(engine.resolveAnchor?.(p.anchor, ch.id, ch.duration / 2, out), `${ch.id}/${p.id}`).toBe(true);
        expect([out.x, out.y, out.z].every(Number.isFinite), `${ch.id}/${p.id}`).toBe(true);
      }
    }
  });
});

describe("facciata-palazzo-rucellai lesson", () => {
  it("has the Prova with both eye sliders and a stamp", () => {
    const spec = SceneSpec.parse(JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/public/scenes/facciata-palazzo-rucellai.scene.json", import.meta.url)), "utf8")));
    const act = spec.chapters.find((c) => c.id === "strada")?.activity;
    expect(act?.test.params).toEqual(["eye-height", "eye-x"]);
    expect(act?.stamp).toBeTruthy();
  });
});

describe("facciata-tempio-chiesa lesson", () => {
  it("has three buildings, one per chapter, with a perspective and an axonometric view and the rotunda in section and plan", () => {
    const j = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/public/scenes/facciata-tempio-chiesa.scene.json", import.meta.url)), "utf8"));
    const d = FacadeData.parse(j.engineData);
    expect(d.buildings.map((b) => b.id)).toEqual(d.chapters.map((c) => c.building));
    const views = d.chapters.flatMap((c) => (c.views ?? []).map((v) => v.view));
    for (const v of ["prospettiva", "assonometria", "sezione", "pianta"]) expect(views).toContain(v);
    expect(d.buildings[2]!.rotunda?.dome.coffers).toEqual([5, 28]);
  });
});

describe("facade engine fixes of the final review", () => {
  afterEach(() => setDisplayLocale(null));

  it("the Prova slider labels follow the display language", async () => {
    const j = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/public/scenes/facciata-palazzo-rucellai.scene.json", import.meta.url)), "utf8"));
    const { engine } = await buildEngine(j);
    expect(engine.params!("strada").map((p) => p.label)).toEqual(["Altezza degli occhi (m)", "Posizione dell'occhio (m)"]);
    setDisplayLocale("en-GB");
    expect(engine.params!("strada").map((p) => p.label)).toEqual(["Eye height (m)", "Eye position (m)"]);
  });

  it("bounds contain the whole box of a deep building that is neither the widest nor the tallest", async () => {
    const j = palazzoAndCasa();
    j.engineData.buildings[1].rotunda = { diameter: 6, height: 3, gap: 60, dome: { type: "smooth" } };
    const { engine, ctx } = await buildEngine(j);
    ctx.root.updateMatrixWorld(true);
    const { center, radius } = engine.bounds();
    for (const id of ["palazzo", "casa"]) {
      const box = new THREE.Box3().setFromObject(ctx.root.getObjectByName(id)!);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) expect(new THREE.Vector3(x, y, z).distanceTo(center), id).toBeLessThanOrEqual(radius + 1e-6);
    }
  });

  it("a duplicate building id does not leak the first model", async () => {
    const j = palazzoAndCasa();
    j.engineData.buildings[1] = { ...structuredClone(j.engineData.buildings[0]), id: j.engineData.buildings[0].id };
    const disposed = new Set<unknown>();
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose").mockImplementation(function (this: unknown) {
      disposed.add(this);
    });
    built.length = 0;
    try {
      const { ctx } = await buildEngine(j);
      const first = new Set<unknown>();
      built[0]!.group.traverse((o) => o.geometry && first.add(o.geometry));
      expect(first.size).toBeGreaterThan(0);
      for (const g of first) expect(disposed.has(g)).toBe(true);
      expect(ctx.root.children.filter((c) => c.name === "palazzo")).toHaveLength(1);
    } finally {
      dispose.mockRestore();
    }
  });
});
