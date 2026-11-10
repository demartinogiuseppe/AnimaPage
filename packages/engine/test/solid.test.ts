import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec } from "@pv/scene-spec";
import { checkSolidData, SOLID_POLYHEDRA, SOLID_SHAPES, solidCounts, SolidData } from "../../scene-spec/src/engines/solid.ts";
import { createSolidEngine } from "../src/engines/solid/index.ts";
import {
  coneNetPoint,
  cylinderNetPoint,
  measures,
  netMatrices,
  netTree,
  polyhedron,
  sectionPlane,
  sectionPolygon,
  surfaceTriangles,
  type Dims,
} from "../src/engines/solid/geometry.ts";
import { boardLines, elementLines, num } from "../src/engines/solid/text.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/geometria-solidi.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function buildEngine(json = raw()) {
  const spec = SceneSpec.parse(json);
  const engine = createSolidEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Transforms, visibility, draw ranges, materials and vertex data of everything rendered. */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, o.userData.key === true, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      const g = o.geometry as THREE.BufferGeometry;
      const m = o.material as THREE.MeshStandardMaterial;
      entry.push(m.uuid, m.opacity, g.drawRange.start, g.drawRange.count, ...((g.getAttribute("position")?.array as Float32Array | undefined) ?? []));
    }
    out.push(entry);
  });
  return out;
}

const D = (o: Partial<Dims>): Dims => ({ a: 0, b: 0, c: 0, l: 0, h: 0, r: 0, r2: 0, ...o });

describe("geometria-solidi scene fixture", () => {
  it("passes SceneSpec, checkScene and the solid cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("solid");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "solid") throw new Error("unreachable");
    expect(checkSolidData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["cubo", "cilindro-cono", "scala"]);
    for (const ch of spec.chapters) {
      expect(ch.book, ch.id).toBeDefined();
      expect(ch.activity?.test.params?.length, ch.id).toBeGreaterThan(0);
      expect(new Set(ch.quiz.map((q) => q.type)), ch.id).toEqual(new Set(["choice", "pick"]));
      expect(ch.sounds?.cues.length, ch.id).toBeGreaterThan(0);
      expect(ch.pins.length, ch.id).toBeGreaterThan(2);
      expect(ch.deep.length, ch.id).toBeGreaterThan(0);
    }
  });
});

describe("SolidData schema", () => {
  const base = () => raw().engineData;

  it("rejects bad shapes, dimensions, acts, overlays and sliders", () => {
    const cases: ((d: any) => void)[] = [
      (d) => (d.chapters[0].solids[0].shape = "teapot"),
      (d) => (d.chapters[0].solids[0].dims = { r: 2 }), // a cube needs a, has no r
      (d) => (d.chapters[0].solids[0].dims.a = 500), // beyond the hard limit
      (d) => (d.chapters[0].solids[0].sides = 5), // sides only for prism/pyramid
      (d) => d.chapters[0].solids.push({ ...d.chapters[0].solids[0] }), // duplicate id
      (d) => d.chapters[0].acts.push({ do: "revolve", solid: "cubo", at: 1 }), // a cube is not a solid of revolution
      (d) => d.chapters[1].acts.push({ do: "count", solid: "cono", what: "faces", at: 1 }), // not a polyhedron
      (d) => d.chapters[1].acts.push({ do: "fill", solid: "cono", from: "cil", at: 1 }), // a cone is not a container
      (d) => d.chapters[1].acts.push({ do: "fill", solid: "cil", at: 1 }), // neither from nor level
      (d) => d.chapters[1].acts.push({ do: "fill", solid: "cil", from: "cil", at: 1 }),
      (d) => d.chapters[1].acts.push({ do: "unfold", solid: "ghost", at: 1 }),
      (d) => d.chapters[1].show.push({ item: "elements", solid: "cil" }),
      (d) => d.chapters[1].show.push({ item: "dims", formulas: ["V"] }),
      (d) => d.chapters[1].show.push({ item: "board", solid: "cil", compare: "ghost" }),
      (d) => (d.chapters[1].params[0].dim = "a"), // a cylinder has no a
      (d) => (d.chapters[1].params[0].min = 2.5), // base r = 2 outside the slider range
      (d) => (d.chapters[1].params[1].max = 500),
      (d) => d.chapters[2].params.push({ ...d.chapters[1].params[0], solids: ["piccolo"] }), // duplicate id across the scene
      (d) => (d.chapters[2].params[0].solids = ["ghost"]),
      (d) => d.chapters.push({ ...d.chapters[0] }), // duplicate chapter
      (d) => d.chapters[0].show.push({ item: "board", at: 5, until: 2 }),
      (d) => d.chapters[0].solids.push({ id: "t", shape: "frustum", dims: { r: 1, r2: 2, h: 1 } }), // top wider than base
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(SolidData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(SolidData.safeParse(base()).success).toBe(true);
  });

  it("cross-checks chapters, times, slider ids and anchors against the scene", () => {
    const json = raw();
    json.engineData.chapters[0].chapter = "ghost";
    json.engineData.chapters[1].acts[0].at = 999;
    json.chapters[2].activity.test.params = ["nope"];
    json.chapters[2].pins[2].anchor = { entity: "face", part: "grande", index: 6 };
    json.chapters[2].camera[1].target = { entity: "gauge" };
    json.chapters[1].pins[3].anchor = { entity: "dim", part: "cil.a" };
    json.chapters[1].pins[1].anchor = { entity: "solid", part: "sfera" };
    const spec = SceneSpec.parse(json);
    if (spec.engine !== "solid") throw new Error("unreachable");
    const messages = checkSolidData(spec.engineData, spec).map((i) => i.message);
    expect(messages).toContain('unknown chapter "ghost"');
    expect(messages).toContain('chapter "cubo" has no solid entry (empty mat)');
    expect(messages).toContain('"revolve" starts after the chapter ends');
    expect(messages).toContain('unknown solid param "nope"');
    expect(messages).toContain("face index 6 does not exist (cube has 6)");
    expect(messages.some((m) => m.startsWith('unknown solid entity "gauge"'))).toBe(true);
    expect(messages.some((m) => m.startsWith('cylinder has no dimension line "a"'))).toBe(true);
    expect(messages).toContain('unknown solid "sfera"');
  });
});

describe("solid geometry", () => {
  const d = D({ a: 2, b: 3, c: 4, l: 2, h: 3, r: 1.5, r2: 0.7 });

  it("polyhedra: element counts match the table and Euler's formula, base on the mat", () => {
    for (const shape of SOLID_POLYHEDRA)
      for (const sides of [3, 5, 8]) {
        const p = polyhedron(shape, d, sides);
        const c = solidCounts(shape, sides);
        expect([p.faces.length, p.edges.length, p.verts.length], `${shape} ${sides}`).toEqual([c.faces, c.edges, c.vertices]);
        expect(p.faces.length + p.verts.length - p.edges.length).toBe(2);
        expect(Math.min(...p.verts.map((v) => v.y))).toBeCloseTo(0, 9);
        expect(p.normals[0]!.y).toBeCloseTo(-1, 9);
      }
  });

  it("measures: closed forms, and exact Platonic volumes from the mesh", () => {
    const close = (x: number, y: number) => expect(x).toBeCloseTo(y, 9);
    close(measures("cube", d).V, 8);
    close(measures("cube", d).A, 24);
    close(measures("cuboid", d).V, 24);
    close(measures("cuboid", d).A, 2 * (6 + 12 + 8));
    close(measures("cylinder", d).V, Math.PI * 2.25 * 3);
    close(measures("cone", d).V, measures("cylinder", d).V / 3);
    close(measures("cone", d).A, Math.PI * 1.5 * (1.5 + Math.hypot(1.5, 3)));
    close(measures("sphere", d).V, (4 / 3) * Math.PI * 1.5 ** 3);
    close(measures("frustum", d).V, (Math.PI * 3 * (1.5 ** 2 + 1.5 * 0.7 + 0.7 ** 2)) / 3);
    const ab = (4 * 4) / (4 * Math.tan(Math.PI / 4)); // square base of side 2
    close(measures("pyramid", d, 4).V, (ab * 3) / 3);
    close(measures("prism", d, 4).V, ab * 3);
    close(measures("tetrahedron", d).V, 8 / (6 * Math.SQRT2));
    close(measures("octahedron", d).V, (Math.SQRT2 / 3) * 8);
    close(measures("icosahedron", d).V, ((5 * (3 + Math.sqrt(5))) / 12) * 8);
    close(measures("dodecahedron", d).V, ((15 + 7 * Math.sqrt(5)) / 4) * 8);
  });

  it("nets: every face lies flat at u = 1 and the folded state is the identity", () => {
    for (const shape of SOLID_POLYHEDRA) {
      const p = polyhedron(shape, d, 5);
      const tree = netTree(p);
      const flat = netMatrices(tree, 1);
      p.faces.forEach((f, i) => f.forEach((v) => expect(Math.abs(p.verts[v]!.clone().applyMatrix4(flat[i]!).y), shape).toBeLessThan(1e-9)));
      for (const m of netMatrices(tree, 0)) expect(m.equals(new THREE.Matrix4())).toBe(true);
    }
    // Cylinder: the lateral surface becomes a 2πr × h rectangle on the mat; cone: a sector of radius a.
    const top = cylinderNetPoint(1.5, Math.PI, 3, 1);
    expect([top.x, top.y, top.z].map((x) => +x.toFixed(9))).toEqual([+(1.5 * Math.PI).toFixed(9), 0, 4.5]);
    const a = Math.hypot(1.5, 3);
    const apex = coneNetPoint(1.5, 3, 0, 0, 1);
    for (const phi of [-3, -1, 0.5, 2.9]) {
      const q = coneNetPoint(1.5, 3, a, phi, 1);
      expect(q.y).toBeCloseTo(0, 9);
      expect(q.distanceTo(apex)).toBeCloseTo(a, 9);
    }
    expect(coneNetPoint(1.5, 3, a, 1, 0).distanceTo(new THREE.Vector3(1.5 * Math.sin(1), 0, 1.5 * Math.cos(1)))).toBeLessThan(1e-9);
  });

  it("sections: square through a cube, circle across a cone, triangle through its axis", () => {
    const cube = sectionPolygon(surfaceTriangles("cube", d), sectionPlane(1, 0));
    expect(cube).toHaveLength(4);
    const cone = sectionPolygon(surfaceTriangles("cone", d), sectionPlane(1.5, 0));
    for (const p of cone) expect(Math.hypot(p.x, p.z)).toBeCloseTo(0.75, 2);
    const axial = sectionPolygon(surfaceTriangles("cone", d), sectionPlane(1, 90));
    expect(axial).toHaveLength(3);
  });

  it("text: Italian numbers, board lines and Euler's panel", () => {
    expect(num(62.8318)).toBe("62,83");
    expect(num(8)).toBe("8");
    const m = measures("cylinder", D({ r: 2, h: 4 }));
    const lines = boardLines({ title: "Cilindro", shape: "cylinder", sides: 4, formulas: ["V"], d: D({ r: 2, h: 4 }), m, k: 1, unit: "cm" });
    expect(lines).toEqual(["Cilindro", "V = π · r² · h = π · 2² · 4 ≈ 50,27 cm³"]);
    expect(elementLines({ faces: 6, vertices: 8, edges: 12 })[3]).toBe("F + V − S = 6 + 8 − 12 = 2");
    expect(elementLines({ faces: 6, vertices: null, edges: null })[1]).toBe("Vertici V = ?");
  });
});

describe("solid engine", () => {
  it("builds in Node without WebGL or canvas, every shape", async () => {
    const json = raw();
    json.engineData.chapters[0].solids = SOLID_SHAPES.map((shape, i) => ({
      id: `s${i}`,
      shape,
      dims: Object.fromEntries((({ cube: ["a"], cuboid: ["a", "b", "c"], prism: ["l", "h"], pyramid: ["l", "h"], cylinder: ["r", "h"], cone: ["r", "h"], sphere: ["r"], frustum: ["r", "r2", "h"], tetrahedron: ["a"], octahedron: ["a"], dodecahedron: ["a"], icosahedron: ["a"] }) as Record<string, string[]>)[shape]!.map((k) => [k, k === "r2" ? 0.5 : 1])),
    })).slice(0, 4);
    json.engineData.chapters[0].acts = [];
    json.engineData.chapters[0].params = [];
    json.engineData.chapters[0].show = [];
    json.chapters[0].activity.test.params = [];
    json.chapters[0].pins = [];
    json.chapters[0].camera = [];
    const { engine, ctx } = await buildEngine(json);
    for (const id of ["cubo", "cilindro-cono", "scala"]) for (const t of [0, 10, 30, 50]) engine.update(id, t);
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(1);
    expect(ctx.root.children.length).toBe(1);
    engine.dispose();
    expect(ctx.root.children.length).toBe(0);
    // The other shapes too.
    const rest = SOLID_SHAPES.slice(4);
    for (let i = 0; i < rest.length; i += 4) {
      const j = raw();
      j.engineData.chapters[0] = { chapter: "cubo", solids: rest.slice(i, i + 4).map((shape, k) => ({ id: `x${k}`, shape, dims: shape === "frustum" ? { r: 1, r2: 0.5, h: 1 } : shape === "cylinder" || shape === "cone" ? { r: 1, h: 2 } : shape === "sphere" ? { r: 1 } : { a: 1 } })) };
      j.chapters[0].activity.test.params = [];
      j.chapters[0].pins = [];
      j.chapters[0].camera = [];
      const e = await buildEngine(j);
      e.engine.update("cubo", 5);
      e.engine.dispose();
    }
  });

  it("update is pure: t1 -> t2 -> t1 gives the same frame, also across chapters and with sliders", async () => {
    const { engine, ctx } = await buildEngine();
    const frames: [string, number, number][] = [
      ["cubo", 11, 34],
      ["cubo", 23, 45.5],
      ["cilindro-cono", 3, 27],
      ["cilindro-cono", 33.7, 12],
      ["scala", 12.5, 27],
    ];
    for (const [ch, t1, t2] of frames) {
      engine.update(ch, t1);
      const a = snapshot(ctx.root);
      engine.update(ch, t2);
      engine.update("scala", 42);
      engine.update(ch, t1);
      expect(snapshot(ctx.root), `${ch} ${t1}`).toEqual(a);
    }
    engine.setParams!({ r: 2.6, h: 5 });
    engine.update("cilindro-cono", 28);
    const a = snapshot(ctx.root);
    engine.update("cilindro-cono", 40);
    engine.update("cilindro-cono", 28);
    expect(snapshot(ctx.root)).toEqual(a);
    engine.setParams!(null);
    engine.update("cilindro-cono", 28);
    expect(snapshot(ctx.root)).not.toEqual(a);
    engine.dispose();
  });

  it("acts: the net unfolds, the cone pours a third of the cylinder each time, k scales the cube", async () => {
    const { engine, ctx } = await buildEngine();
    const find = (name: string) => {
      let o: THREE.Object3D | undefined;
      ctx.root.traverse((x) => {
        if (x.name === name && x.visible) o = x;
      });
      return o;
    };
    engine.update("cubo", 40);
    const box = new THREE.Box3();
    ctx.root.updateMatrixWorld(true);
    ctx.root.traverseVisible((o) => o.name.startsWith("face:") && box.expandByObject(o));
    expect(box.max.y - box.min.y).toBeLessThan(0.05); // flat on the mat
    expect(box.max.x - box.min.x).toBeGreaterThan(5);
    // Liquid level after 1, 2, 3 pours (scene units: s · h).
    const tmp = new THREE.Vector3();
    const levels = [30.6, 37.6, 44.6].map((t) => {
      engine.update("cilindro-cono", t);
      engine.resolveAnchor({ entity: "liquid", part: "cil" }, "cilindro-cono", t, tmp);
      return tmp.y;
    });
    engine.resolveAnchor({ entity: "solid", part: "cil" }, "cilindro-cono", 44.6, tmp);
    const H = tmp.y;
    expect(levels[0]! / H).toBeCloseTo(1 / 3, 6);
    expect(levels[1]! / H).toBeCloseTo(2 / 3, 6);
    expect(levels[2]! / H).toBeCloseTo(1, 6);
    // Same with different sliders: the cone still fills a third.
    engine.setParams!({ r: 1.3, h: 5.5 });
    engine.update("cilindro-cono", 30.6);
    engine.resolveAnchor({ entity: "liquid", part: "cil" }, "cilindro-cono", 30.6, tmp);
    const l1 = tmp.y;
    engine.resolveAnchor({ entity: "solid", part: "cil" }, "cilindro-cono", 30.6, tmp);
    expect(l1 / tmp.y).toBeCloseTo(1 / 3, 6);
    engine.setParams!(null);
    // During a pour the cone is above the cylinder.
    engine.update("cilindro-cono", 27);
    const cone = new THREE.Vector3();
    const cyl = new THREE.Vector3();
    engine.resolveAnchor({ entity: "solid", part: "cono" }, "cilindro-cono", 27, cone);
    engine.resolveAnchor({ entity: "solid", part: "cil" }, "cilindro-cono", 27, cyl);
    expect(cone.x).toBeCloseTo(cyl.x, 6);
    expect(cone.y).toBeGreaterThan(cyl.y);
    expect(find("stream")).toBeDefined();
    // Scaling: k = 2 doubles the height.
    const h1 = new THREE.Vector3();
    const h2 = new THREE.Vector3();
    engine.resolveAnchor({ entity: "solid", part: "piccolo" }, "scala", 20, h1);
    engine.resolveAnchor({ entity: "solid", part: "grande" }, "scala", 20, h2);
    expect(h2.y / h1.y).toBeCloseTo(2, 9);
    engine.dispose();
  });

  it("anchors resolve for every pin and camera key of the scene", async () => {
    const { spec, engine } = await buildEngine();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters)
      for (const t of [0, ch.duration / 2, ch.duration - 0.01]) {
        engine.update(ch.id, t);
        for (const p of ch.pins) {
          expect(engine.resolveAnchor(p.anchor, ch.id, t, out), `${ch.id} ${p.id}`).toBe(true);
          expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
        }
        for (const k of ch.camera) expect(engine.resolveAnchor(k.target, ch.id, t, out), `${ch.id} camera ${k.at}`).toBe(true);
      }
    // Elements follow the net: a vertex moves when the cube unfolds.
    const folded = new THREE.Vector3();
    const flat = new THREE.Vector3();
    engine.resolveAnchor({ entity: "vertex", part: "cubo", index: 7 }, "cubo", 0, folded);
    engine.resolveAnchor({ entity: "vertex", part: "cubo", index: 7 }, "cubo", 40, flat);
    expect(flat.y).toBeLessThan(0.01);
    expect(folded.y).toBeGreaterThan(1);
    expect(engine.resolveAnchor({ entity: "face", part: "cubo", index: 6 }, "cubo", 0, out)).toBe(false);
    expect(engine.resolveAnchor({ entity: "dim", part: "cil.x" }, "cilindro-cono", 0, out)).toBe(false);
    engine.dispose();
  });

  it("params: sliders from the activity, clamped overrides, live dimensions", async () => {
    const { engine } = await buildEngine();
    expect(engine.params!("cilindro-cono").map((p) => [p.id, p.value, p.min, p.max])).toEqual([
      ["r", 2, 1, 3],
      ["h", 4, 2, 6],
    ]);
    expect(engine.params!("scala")[0]).toMatchObject({ id: "k", value: 1, step: 0.5 });
    engine.setParams!({ r: 99, nope: 3 });
    expect(engine.params!("cilindro-cono")[0]!.value).toBe(3);
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    engine.setParams!(null);
    engine.resolveAnchor({ entity: "solid", part: "cubo" }, "cubo", 1, before);
    engine.setParams!({ lato: 3.5 });
    engine.resolveAnchor({ entity: "solid", part: "cubo" }, "cubo", 1, after);
    expect(after.y / before.y).toBeCloseTo(3.5 / 3, 9);
    // k slider overrides the scale acts.
    engine.setParams!({ k: 3 });
    const small = new THREE.Vector3();
    engine.resolveAnchor({ entity: "solid", part: "grande" }, "scala", 20, after);
    engine.resolveAnchor({ entity: "solid", part: "piccolo" }, "scala", 20, small);
    expect(after.y / small.y).toBeCloseTo(3, 9);
    engine.dispose();
  });

  it("sections, revolutions and curved nets run in Node and stay pure", async () => {
    const json = raw();
    json.engineData.chapters[0] = {
      chapter: "cubo",
      solids: [
        { id: "sf", shape: "sphere", dims: { r: 1.5 } },
        { id: "tc", shape: "frustum", dims: { r: 1.5, r2: 0.8, h: 2 } },
        { id: "cy", shape: "cylinder", dims: { r: 1, h: 2 } },
        { id: "co", shape: "cone", dims: { r: 1, h: 2 } },
      ],
      acts: [
        { do: "revolve", solid: "sf", at: 1, dur: 4 },
        { do: "section", solid: "tc", at: 2, to: 0.5, tilt: 30 },
        { do: "section", solid: "tc", at: 8, to: 0.2, tilt: 90, until: 20 },
        { do: "unfold", solid: "cy", at: 3, dur: 4 },
        { do: "unfold", solid: "co", at: 3, dur: 4 },
        { do: "fold", solid: "co", at: 30, dur: 4 },
      ],
      show: [{ item: "dims" }, { item: "board", formulas: ["V", "A", "Al", "Ab"] }],
    };
    json.chapters[0].activity.test.params = [];
    json.chapters[0].pins = [
      { id: "s", name: "Sezione", info: "La sezione.", kind: "data", anchor: { entity: "section", part: "tc" }, sourceIds: [] },
      { id: "f", name: "Semicerchio", info: "La figura.", kind: "data", anchor: { entity: "figure", part: "sf" }, sourceIds: [] },
      { id: "n", name: "Sviluppo", info: "Il cono aperto.", kind: "data", anchor: { entity: "net", part: "co" }, sourceIds: [] },
      { id: "d", name: "Raggio", info: "Il raggio.", kind: "data", anchor: { entity: "dim", part: "co.ap" }, sourceIds: [] },
    ];
    json.chapters[0].narration.forEach((s: { highlight: string[] }) => (s.highlight = []));
    json.chapters[0].quiz = json.chapters[0].quiz.filter((q: { type: string }) => q.type === "choice");
    json.chapters[0].camera = [];
    const spec = SceneSpec.parse(json);
    if (spec.engine !== "solid") throw new Error("unreachable");
    expect(checkSolidData(spec.engineData, spec)).toEqual([]);
    const { engine, ctx } = await buildEngine(json);
    const out = new THREE.Vector3();
    for (const t of [0, 3, 5, 9, 12, 25]) {
      engine.update("cubo", t);
      for (const p of spec.chapters[0]!.pins) expect(engine.resolveAnchor(p.anchor, "cubo", t, out), `${p.id} ${t}`).toBe(true);
    }
    engine.update("cubo", 12);
    const a = snapshot(ctx.root);
    engine.update("cubo", 3.5);
    engine.update("cubo", 12);
    expect(snapshot(ctx.root)).toEqual(a);
    // The section of the frustum through its axis is a trapezoid (4 corners) centred on the axis.
    engine.resolveAnchor({ entity: "section", part: "tc" }, "cubo", 12, out);
    const top = new THREE.Vector3();
    engine.resolveAnchor({ entity: "solid", part: "tc" }, "cubo", 12, top);
    expect(out.x).toBeCloseTo(top.x, 6);
    engine.dispose();
  });

  it("ink style: what is being counted is key, the rest is not", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("cubo", 11);
    const keyed: string[] = [];
    ctx.root.traverseVisible((o) => {
      if (o.userData.key === true && o.name.startsWith("face:")) keyed.push(o.name);
    });
    expect(keyed.length).toBeGreaterThan(0);
    expect(keyed.length).toBeLessThan(6);
    let group: THREE.Object3D | undefined;
    ctx.root.traverse((o) => o.name === "solid:cubo" && (group = o));
    expect(group?.userData.key).toBe(false);
    engine.update("cubo", 3);
    const none: string[] = [];
    ctx.root.traverseVisible((o) => o.userData.key === true && o.name.startsWith("face:") && none.push(o.name));
    expect(none).toEqual([]);
    engine.dispose();
  });
});
