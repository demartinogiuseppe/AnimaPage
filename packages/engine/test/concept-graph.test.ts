import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkConceptData, checkConceptMath, checkScene, ConceptData, conceptMathNumbers, SceneSpec } from "@pv/scene-spec";
import { createConceptEngine } from "../src/engines/concept/index.ts";
import { compileGraphPlan, evalScalar, evalWindow, makeFrame } from "../src/engines/concept/graph-plan.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/matematica-parabola.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));
const parsed = () => {
  const spec = SceneSpec.parse(raw());
  if (spec.engine !== "concept") throw new Error("unreachable");
  return spec;
};

/** Minimal 2D-canvas stand-in so the text/label code paths run in Node. */
function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  const g = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 30 }) },
    { get: (o, k) => (k in o ? o[k as keyof typeof o] : () => undefined), set: () => true },
  );
  return { width, height, getContext: () => g } as unknown as HTMLCanvasElement;
}

async function build(json: unknown = raw(), withCanvas = false) {
  const spec = SceneSpec.parse(json);
  const engine = createConceptEngine();
  const ctx = {
    root: new THREE.Group(),
    scene: new THREE.Scene(),
    loadAsset: () => Promise.reject(new Error("no assets")),
    ...(withCanvas ? { createCanvas: fakeCanvas } : {}),
  };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Transforms, visibility, colours, draw ranges and dynamic vertex data under root. */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverse((o) => {
    const entry: unknown[] = [o.name, o.visible, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      entry.push(m.opacity, ...(m.color ? m.color.toArray() : []), ...(m.emissive ? m.emissive.toArray() : []));
      const g = o.geometry as THREE.BufferGeometry;
      entry.push(g.drawRange.start, g.drawRange.count);
      const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (pos && pos.usage === THREE.DynamicDrawUsage) entry.push(Array.from((pos.array as Float32Array).slice(0, 300)));
    }
    out.push(entry);
  });
  return out;
}

describe("matematica-parabola scene fixture", () => {
  it("passes SceneSpec, checkScene and the maths checks with zero issues", () => {
    const spec = parsed();
    expect(checkScene(spec)).toEqual([]);
    expect(checkConceptData(spec.engineData, spec)).toEqual([]);
    expect(checkConceptMath(spec.engineData)).toEqual([]);
    expect(spec.page.subject).toBe("Matematica");
    expect(spec.kind).toBe("mixed");
    expect(spec.videos).toEqual([]);
    expect(spec.sources.find((s) => s.id === "calc")).toMatchObject({ kind: "computed", title: "Calcoli svolti nella lezione" });
    expect(spec.sources.find((s) => s.id === "calc")!.url).toBeUndefined();
    const quizTypes = new Set(spec.chapters.flatMap((c) => c.quiz.map((q) => q.type)));
    expect(quizTypes).toEqual(new Set(["choice", "pick"]));
    for (const c of spec.chapters) {
      expect(c.book, c.id).toBeDefined();
      expect(c.activity, c.id).toBeDefined();
    }
    expect(spec.chapters.find((c) => c.id === "parametri")!.activity!.test.params).toEqual(["a", "b", "c"]);
  });

  it("lists the numbers the graphs imply, including the parameter keyframes", () => {
    const nums = conceptMathNumbers(parsed().engineData);
    const has = (what: RegExp, value: number) => nums.some((n) => what.test(n.what) && Math.abs(n.value - value) < 1e-6);
    expect(has(/^point "V" x$/, 2)).toBe(true);
    expect(has(/^point "V" y$/, -1)).toBe(true);
    expect(has(/^point "C" y$/, 3)).toBe(true);
    expect(has(/^plot "f" zero x$/, 1)).toBe(true);
    expect(has(/^plot "f" zero x$/, 3)).toBe(true);
    expect(has(/^tracer "tr" slope at x = 2$/, 0)).toBe(true);
    expect(has(/^plot "f" max y \(a = -1/, 7)).toBe(true);
    expect(nums.find((n) => n.value === -1)!.text).toBe("−1");
  });
});

describe("graph schema and maths checks", () => {
  const base = () => raw().engineData;
  const graph = (d: ReturnType<typeof base>) => d.graphs[0];

  it("rejects invalid formulas, references and shapes", () => {
    const cases: ((d: ReturnType<typeof base>) => void)[] = [
      (d) => (graph(d).plots[0].expr = "alert(1)"),
      (d) => (graph(d).plots[0].expr = "x^2 + k"),
      (d) => (graph(d).plots[0].expr = "0,5x"),
      (d) => (graph(d).points[0].plot = "nope"),
      (d) => (graph(d).points[0].plot = "p3"),
      (d) => delete graph(d).points[0].x,
      (d) => (graph(d).lines[0] = { id: "l", x: 1, y: 2, plot: "f" }),
      (d) => (graph(d).lines[0] = { id: "l", y: 2, meaning: "symmetry", plot: "f" }),
      (d) => (graph(d).lines[0] = { id: "l", x: 2 }),
      (d) => (graph(d).surfaces = [{ id: "s", expr: "x*y", x: [0, 1], y: [0, 1] }]),
      (d) => (graph(d).params[0].id = "sin"),
      (d) => (graph(d).params[0].value = 9),
      (d) => (graph(d).x.max = graph(d).x.min),
      (d) => (graph(d).plots[0].id = "g3"),
      (d) => d.chapters[0].actions.push({ at: 1, do: "draw", id: "A" }),
      (d) => d.chapters[0].actions.push({ at: 1, do: "trace", id: "f", to: 1 }),
      (d) => d.chapters[0].actions.push({ at: 1, do: "param", id: "a", to: 10 }),
      (d) => d.chapters[0].actions.push({ at: 1, do: "mirror", id: "f", about: "x-axis" }),
      (d) => d.chapters[0].actions.push({ at: 1, do: "bounce", ids: ["f"] }),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(ConceptData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(ConceptData.safeParse(base()).success).toBe(true);
  });

  it("recomputes declared points and lines and reports the wrong ones", () => {
    const d = ConceptData.parse(base());
    const g = d.graphs![0]!;
    g.points![0]!.x = 2; // not a zero
    g.points![3]!.kind = "max"; // the vertex is a minimum
    g.lines![0]!.x = 1; // not the axis of symmetry
    g.lines!.push({ id: "as", x: 0, plot: "f" }); // not an asymptote
    g.tracers![0]!.x = -3.5; // f(−3.5) = 33.25, outside the frame
    const messages = checkConceptMath(d).map((i) => `${i.path}: ${i.message}`);
    expect(messages.some((m) => /points\[0\].*not a zero \(nearest at x ≈ 1\)/.test(m))).toBe(true);
    expect(messages.some((m) => /points\[3\].*not a max/.test(m))).toBe(true);
    expect(messages.some((m) => /lines\[0\].*not an axis of symmetry/.test(m))).toBe(true);
    expect(messages.some((m) => /lines\[1\].*not an asymptote/.test(m))).toBe(true);
    expect(messages.some((m) => /tracers\[0\]/.test(m))).toBe(true);
    expect(messages).toHaveLength(5);
  });

  it("asks a source for numbers shown on graph labels and checks activity params", () => {
    const spec = parsed();
    const data = structuredClone(spec.engineData);
    data.graphs![0]!.points![0]!.sourceIds = [];
    const scene = structuredClone(spec);
    scene.chapters[4]!.activity!.test.params = ["a", "zz"];
    const messages = checkConceptData(data, scene).map((i) => i.message);
    expect(messages.some((m) => m.startsWith("number without source"))).toBe(true);
    expect(messages).toContain('"zz" is not a graph parameter');
  });
});

describe("graph plan", () => {
  it("maps maths to board coordinates (2D whiteboard and 3D box)", () => {
    const spec = parsed();
    const [g, g3] = spec.engineData.graphs!;
    const fr = makeFrame(g!);
    expect(fr.plane(1, 0)[0] - fr.plane(0, 0)[0]).toBeCloseTo(1);
    expect(fr.plane(0, 1)[1] - fr.plane(0, 0)[1]).toBeCloseTo(1);
    expect(fr.plane(-4, -2)[1]).toBeGreaterThan(g!.pos[1]);
    const f3 = makeFrame(g3!);
    expect(f3.is3d).toBe(true);
    expect(f3.space(0, 1, 0)[2]).toBeLessThan(f3.space(0, 0, 0)[2]); // maths y goes into depth
    expect(f3.space(0, 0, 1)[1] - f3.space(0, 0, 0)[1]).toBeCloseTo(0.6); // yScale
  });

  it("draws plots, moves tracers and animates parameters as pure tracks", () => {
    const spec = parsed();
    const gp = compileGraphPlan(spec, spec.engineData);
    const reveal = gp.chapters.get("funzione")!.reveal.get("f")!;
    expect(evalWindow(reveal, 6.9).win[1] - evalWindow(reveal, 6.9).win[0]).toBe(0);
    const mid = evalWindow(reveal, 9.5);
    expect(mid.drawing).toBe(true);
    expect(mid.win[0]).toBeCloseTo(-1, 3); // the pen starts where the curve enters the frame
    expect(evalWindow(reveal, 30).win).toEqual([-4, 6]);
    // Carried over: already fully drawn in the next chapter.
    expect(evalWindow(gp.chapters.get("intersezioni")!.reveal.get("f")!, 0).win).toEqual([-4, 6]);
    const tr = gp.chapters.get("segno-vertice")!.tracers.get("tr")!;
    expect(evalScalar(tr, 19)).toBe(0);
    expect(evalScalar(tr, 25.5)).toBeCloseTo(1, 5);
    expect(evalScalar(tr, 40)).toBe(2);
    const a = gp.chapters.get("parametri")!.params.get("a")!;
    expect(evalScalar(a, 0)).toBe(1);
    expect(evalScalar(a, 14)).toBe(-1);
    expect(evalScalar(a, 30)).toBe(1);
    // carryOver: false starts from scratch.
    const w = evalWindow(gp.chapters.get("bonus-3d")!.reveal.get("f")!, 10).win;
    expect(w[1] - w[0]).toBe(0);
  });
});

describe("concept engine with graphs", () => {
  it("is a pure function of (chapterId, t)", async () => {
    const { spec, engine, ctx } = await build();
    const ids = spec.chapters.map((c) => c.id);
    for (const c of spec.chapters) {
      for (const [t1, t2] of [
        [c.duration * 0.3, c.duration * 0.8],
        [c.duration * 0.7, 0.4],
        [c.duration - 0.2, c.duration * 0.45],
      ] as const) {
        engine.update(c.id, t1);
        const a = snapshot(ctx.root);
        engine.update(c.id, t2);
        const between = snapshot(ctx.root);
        engine.update(ids[(ids.indexOf(c.id) + 2) % ids.length]!, 3.3);
        engine.update(c.id, t1);
        expect(snapshot(ctx.root), `${c.id} ${t1}`).toEqual(a);
        expect(between).not.toEqual(a);
      }
    }
  });

  it("recomputes points live with the parameters and with user overrides", async () => {
    const { engine } = await build();
    const out = new THREE.Vector3();
    const at = (ch: string, t: number) => {
      engine.update(ch, t);
      return engine.resolveAnchor({ entity: "point", part: "V" }, ch, t, out) ? out.clone() : null;
    };
    const v0 = at("parametri", 1)!;
    const v1 = at("parametri", 14)!; // a = −1: V(−2; 7)
    expect(v1.x - v0.x).toBeCloseTo(-4, 3);
    expect(v1.y - v0.y).toBeCloseTo(8, 3);
    expect(at("parametri", 33)).not.toBeNull(); // b = −2: no zeros, vertex still there
    engine.update("parametri", 33);
    expect(engine.resolveAnchor({ entity: "point", part: "A" }, "parametri", 33, out)).toBe(false);

    expect(engine.params!("parametri").map((p) => [p.id, p.label, p.min, p.max, p.step])).toEqual([
      ["a", "a", -3, 3, 0.1],
      ["b", "b", -6, 6, 0.1],
      ["c", "c", -4, 6, 0.1],
    ]);
    expect(engine.params!("funzione")).toEqual([]);
    engine.setParams!({ c: 5, nope: 1, a: 99 }); // a is clamped to 3
    expect(engine.params!("parametri").find((p) => p.id === "a")!.value).toBe(3);
    const lifted = at("parametri", 1)!;
    expect(lifted.y).not.toBeCloseTo(v0.y, 3);
    engine.setParams!(null);
    expect(at("parametri", 1)!.toArray()).toEqual(v0.toArray());
  });

  it("resolves every anchor used by pins and camera keys, and graph anchors", async () => {
    const { spec, engine } = await build();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters) {
      for (const t of [ch.duration * 0.5, ch.duration - 0.5]) {
        engine.update(ch.id, t);
        for (const anchor of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
          expect(engine.resolveAnchor(anchor, ch.id, t, out), `${ch.id} ${JSON.stringify(anchor)}`).toBe(true);
          expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
        }
      }
    }
    engine.update("segno-vertice", 30);
    expect(engine.resolveAnchor({ entity: "tracer", part: "tr" }, "segno-vertice", 30, out)).toBe(true);
    expect(engine.resolveAnchor({ entity: "plot", part: "f", index: 6 }, "segno-vertice", 30, out)).toBe(true); // x = 2
    const v = new THREE.Vector3();
    engine.resolveAnchor({ entity: "point", part: "V" }, "segno-vertice", 30, v);
    expect(out.distanceTo(v)).toBeLessThan(0.3);
    expect(engine.resolveAnchor({ entity: "plot", part: "f", index: 0 }, "segno-vertice", 30, out)).toBe(false); // f(−4) off frame
    expect(engine.resolveAnchor({ entity: "surface", part: "par" }, "bonus-3d", 30, out)).toBe(true);
    expect(engine.resolveAnchor({ entity: "plot", part: "nope" }, "bonus-3d", 30, out)).toBe(false);
  });

  it("builds in Node without a canvas (and with one), then cleans up", async () => {
    for (const withCanvas of [false, true]) {
      const { engine, ctx } = await build(raw(), withCanvas);
      engine.update("segno-vertice", 30);
      expect(ctx.root.getObjectByName("plot:f")!.visible).toBe(true);
      expect(ctx.root.getObjectByName("tracer:tr")!.visible).toBe(true);
      expect(ctx.root.getObjectByName("point:V")!.visible).toBe(false); // appears at 39
      engine.update("segno-vertice", 45);
      expect(ctx.root.getObjectByName("point:V")!.visible).toBe(true);
      engine.update("bonus-3d", 30);
      expect(ctx.root.getObjectByName("surface:par")!.visible).toBe(true);
      expect(ctx.root.getObjectByName("plot:f")!.visible).toBe(false);
      engine.update("simmetria", 22);
      expect(ctx.root.getObjectByName("ghost:f:y-axis")!.visible).toBe(true);
      const sprites: THREE.Sprite[] = [];
      ctx.root.traverse((o) => o instanceof THREE.Sprite && sprites.push(o));
      expect(sprites.length > 0).toBe(withCanvas);
      const { center, radius } = engine.bounds();
      const box = new THREE.Box3().setFromObject(ctx.root.getObjectByName("graph:g")!);
      expect(center.distanceTo(box.getCenter(new THREE.Vector3()))).toBeLessThan(radius);
      engine.dispose();
      expect(ctx.root.children).toHaveLength(0);
    }
  });
});

/** Hyperbola y = 1/(x − a) whose asymptote and domain bands follow the slider a. */
function hyperbolaScene(): unknown {
  const s = raw();
  s.chapters = [{ ...s.chapters[0], id: "h", pins: [], quiz: [], book: undefined, activity: { ...s.chapters[0].activity, test: { prompt: "Muovi a.", params: ["a"] } } }];
  s.chapters[0].camera = [{ at: 0, target: { entity: "graph", part: "h" }, distance: 20, azimuth: 0, elevation: 8 }];
  s.chapters[0].narration = [{ at: 0, text: "Prova.", highlight: [], sourceIds: [] }];
  delete s.chapters[0].book;
  s.engineData = {
    board: { width: 16, depth: 8 },
    roles: [],
    rows: [],
    axes: [],
    tiles: [],
    shapes: [],
    links: [],
    graphs: [
      {
        id: "h",
        pos: [0, 0, 0],
        x: { min: -5, max: 5 },
        y: { min: -5, max: 5 },
        params: [{ id: "a", min: -3, max: 3, value: 1 }],
        plots: [{ id: "f", expr: "1/(x - a)", sourceIds: ["calc"] }],
        points: [{ id: "P", plot: "f", kind: "point", x: "a + 1", sourceIds: ["calc"] }],
        lines: [
          { id: "va", x: "a", plot: "f", sourceIds: ["calc"] },
          { id: "ha", y: 0, plot: "f", sourceIds: ["calc"] },
        ],
        intervals: [
          { id: "lt", to: "a", label: "x < {a}", sourceIds: ["calc"] },
          { id: "gt", from: "a", lane: 1, label: "x > {a}", sourceIds: ["calc"] },
        ],
        regions: [{ id: "r", plot: "f", over: ["a + 0.5", "a + 2"], sourceIds: ["calc"] }],
      },
    ],
    chapters: [
      {
        chapter: "h",
        actions: [
          { at: 0, do: "appear", ids: ["h", "f", "P", "va", "ha", "lt", "gt", "r"], dur: 0.5 },
          { at: 10, do: "param", id: "a", to: -2, dur: 4 },
        ],
      },
    ],
  };
  return s;
}

describe("parameter formulas in numeric fields", () => {
  it("validates them: parameters only, no x", () => {
    const spec = SceneSpec.parse(hyperbolaScene());
    if (spec.engine !== "concept") throw new Error("unreachable");
    expect(checkScene(spec)).toEqual([]);
    for (const bad of [{ x: "x + 1" }, { x: "k" }, { x: "a +" }]) {
      const d = structuredClone((hyperbolaScene() as { engineData: { graphs: { lines: object[] }[] } }).engineData);
      d.graphs[0]!.lines[0] = { id: "va", plot: "f", ...bad };
      expect(ConceptData.safeParse(d).success, JSON.stringify(bad)).toBe(false);
    }
    const d = structuredClone(spec.engineData);
    d.graphs![0]!.lines![0]!.x = "a + 1"; // no longer the asymptote
    expect(checkConceptMath(d).map((i) => i.message).join()).toMatch(/not an asymptote/);
    const nums = conceptMathNumbers(spec.engineData);
    expect(nums.some((n) => n.what === 'line "va" x' && n.value === 1)).toBe(true);
    expect(nums.some((n) => n.what === 'line "va" x (a = -2)' && n.value === -2)).toBe(true);
    expect(nums.some((n) => n.what === 'interval "gt" from (a = -2)' && n.value === -2)).toBe(true);
    expect(nums.some((n) => n.what === 'point "P" x (a = -2)' && n.value === -1)).toBe(true);
  });

  it("moves asymptotes, bands, regions and points with keyframes and with the slider", async () => {
    const { engine, ctx } = await build(hyperbolaScene());
    const lineX = () => {
      const m = ctx.root.getObjectByName("line:va") as THREE.Mesh;
      const pos = (m.geometry as THREE.BufferGeometry).getAttribute("position");
      let s = 0;
      for (let i = 0; i < 10; i++) s += pos.getX(i);
      return s / 10;
    };
    const bandEnd = (id: string) => {
      const g = ctx.root.getObjectByName(`interval:${id}`)!;
      return g.position.x;
    };
    const P = new THREE.Vector3();
    engine.update("h", 5);
    expect(lineX()).toBeCloseTo(1, 3); // pos.x = 0, x range centred on 0, scale 1
    expect(bandEnd("gt")).toBeCloseTo(1, 3);
    engine.resolveAnchor({ entity: "point", part: "P" }, "h", 5, P);
    expect(P.x).toBeCloseTo(2, 3);
    engine.update("h", 20); // a = −2
    expect(lineX()).toBeCloseTo(-2, 3);
    expect(bandEnd("gt")).toBeCloseTo(-2, 3);
    engine.resolveAnchor({ entity: "point", part: "P" }, "h", 20, P);
    expect(P.x).toBeCloseTo(-1, 3);
    expect(engine.params!("h").map((p) => p.id)).toEqual(["a"]);
    engine.setParams!({ a: 2.5 });
    engine.update("h", 20);
    expect(lineX()).toBeCloseTo(2.5, 3);
    expect(bandEnd("gt")).toBeCloseTo(2.5, 3);
    engine.setParams!(null);
    engine.update("h", 5);
    expect(lineX()).toBeCloseTo(1, 3);
  });
});

describe("parity tests and ink keys", () => {
  it("shows both mirror ghosts together and marks key objects for the ink style", async () => {
    const { engine, ctx } = await build();
    engine.update("simmetria", 20);
    expect(ctx.root.getObjectByName("ghost:f:y-axis")!.visible).toBe(true);
    expect(ctx.root.getObjectByName("ghost:f:origin")!.visible).toBe(false);
    engine.update("simmetria", 40);
    expect(ctx.root.getObjectByName("ghost:f:y-axis")!.visible).toBe(true);
    expect(ctx.root.getObjectByName("ghost:f:origin")!.visible).toBe(true);
    expect(ctx.root.getObjectByName("ghost:f:origin")!.userData.key).toBe(true);

    engine.update("segno-vertice", 30);
    expect(ctx.root.getObjectByName("plot:f")!.userData.key).toBe(true);
    expect(ctx.root.getObjectByName("tracer:tr")!.userData.key).toBe(true);
    expect(ctx.root.getObjectByName("point:A")!.userData.key).toBe(true);
    expect(ctx.root.getObjectByName("point:V")!.userData.key).toBe(false); // not shown yet
    expect(ctx.root.getObjectByName("graph:g")!.userData.key).toBeUndefined(); // the whiteboard is paper
  });
});

describe("graph frames at rest", () => {
  it("stand upright from t = 0 of the chapters that show them", async () => {
    const { engine, ctx } = await build();
    for (const [ch, id] of [["funzione", "graph:g"], ["bonus-3d", "graph:g3"]] as const) {
      engine.update(ch, 0);
      const frame = ctx.root.getObjectByName(id)!;
      expect(frame.visible, ch).toBe(true);
      expect(frame.scale.y, ch).toBeCloseTo(1, 6);
    }
    engine.update("funzione", 0);
    expect(ctx.root.getObjectByName("plot:f")!.visible).toBe(false); // the curve still draws on the timeline
  });
});
