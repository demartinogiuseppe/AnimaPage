import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, checkSemantics, SceneSpec } from "@pv/scene-spec";
import { checkConceptData, ConceptData } from "../../scene-spec/src/engines/concept.ts";
import { createConceptEngine } from "../src/engines/concept/index.ts";
import { compilePlan, evalFlip, evalPos, evalPresence, tileWidth } from "../src/engines/concept/plan.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/grammatica-indicativo.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));
// Reference scene left out of the public copy (tools/publish/exclude.txt): the tests below skip when it is absent.
const present = existsSync(scenePath);

/** Small maths scene exercising shapes, axes in every direction, links and swap (not a fixture). */
function mathsScene(): unknown {
  const s = raw();
  s.title = "Prova";
  s.chapters = [
    { ...s.chapters[0], id: "a", pins: [], quiz: [], narration: [{ at: 0, text: "Prova.", highlight: [], sourceIds: [] }] },
    { ...s.chapters[1], id: "b", pins: [], quiz: [], narration: [{ at: 0, text: "Prova.", highlight: [], sourceIds: [] }] },
  ];
  s.chapters.forEach((c: { camera: unknown[] }) => (c.camera = [{ at: 0, target: { entity: "board" }, distance: 20, azimuth: 0, elevation: 30 }]));
  s.engineData = {
    board: { width: 16, depth: 12 },
    roles: [
      { id: "a", name: "cateto", color: "#2f6fd6" },
      { id: "b", name: "ipotenusa", color: "#e06a1b" },
    ],
    rows: [{ id: "r", origin: [0, 0, 4], gap: 0.1, tray: true, label: "somma" }],
    axes: [
      { id: "x", origin: [-6, 0, 0], direction: "x", length: 8, min: 0, max: 4, labels: [{ value: 1, text: "1" }], title: "x" },
      { id: "y", origin: [-6, 0, 0], direction: "y", length: 4, min: 0, max: 2, labels: [{ value: 1, text: "1" }] },
      { id: "z", origin: [-6, 0, 0], direction: "z", length: 4, min: 0, max: 2, labels: [], arrow: false },
    ],
    tiles: [
      { id: "t1", text: "a²", role: "a", place: { row: "r", index: 0 } },
      { id: "t2", text: "+", place: { row: "r", index: 1 } },
      { id: "t3", text: "b²", role: "a", place: { row: "r", index: 2 } },
      { id: "t4", text: "c²", role: "b", place: { axis: "x", value: 2, lane: -1 } },
    ],
    shapes: [
      { id: "tri", kind: "polygon", points: [[0, 0], [3, 0], [0, 4]], place: { pos: [2, 0, 0] }, role: "a" },
      { id: "sq", kind: "polygon", points: [[0, 0], [3, 0], [3, -3], [0, -3]], place: { pos: [2, 0, 0] }, role: "a", label: "a²" },
      { id: "pie", kind: "pie", radius: 1, parts: 4, filled: 3, place: { pos: [-3, 0, 3] }, role: "b", upright: true },
      { id: "bar", kind: "bar", length: 3, parts: 5, filled: 2, place: { pos: [5, 0, 4] }, role: "b" },
      { id: "ang", kind: "angle", radius: 1.5, from: 0, to: 60, place: { pos: [5, 0, -3] } },
      { id: "cir", kind: "circle", radius: 0.8, place: { row: "r", index: 3 } },
    ],
    links: [{ id: "l", from: "t1", to: "t4", label: "uguale" }],
    chapters: [
      {
        chapter: "a",
        actions: [
          { at: 0, do: "appear", ids: ["x", "y", "z", "tri", "sq", "pie", "bar", "ang"], stagger: 0.2 },
          { at: 2, do: "appear", ids: ["t1", "t2", "t3", "cir"], style: "drop", stagger: 0.2 },
          { at: 4, do: "appear", ids: ["t4", "l"] },
          { at: 6, do: "swap", a: "t1", b: "t3" },
          { at: 8, do: "move", id: "sq", to: { pos: [4, 0, -2] }, style: "slide" },
          { at: 9, do: "highlight", ids: ["sq", "l", "x"] },
          { at: 10, do: "bounce", ids: ["pie"] },
          { at: 11, do: "color", ids: ["tri"], role: "b" },
        ],
      },
      { chapter: "b", actions: [{ at: 1, do: "merge", ids: ["t1", "t2", "t3"], into: "t4" }, { at: 3, do: "hide", ids: ["l"] }] },
    ],
  };
  return s;
}

async function buildEngine(json: unknown = raw(), withCanvas = false) {
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

/** Minimal 2D-canvas stand-in so the text/label code paths run in Node. */
function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  const g = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 30 }) },
    { get: (o, k) => (k in o ? o[k as keyof typeof o] : () => undefined), set: () => true },
  );
  return { width, height, getContext: () => g } as unknown as HTMLCanvasElement;
}

/** Every transform, visibility and colour value under root. */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverse((o) => {
    const entry: unknown[] = [o.name, o.visible, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      entry.push(m.opacity, ...(m.color ? m.color.toArray() : []), ...(m.emissive ? m.emissive.toArray() : []));
      entry.push(o.geometry.drawRange.count, o.geometry.uuid === undefined);
    }
    out.push(entry);
  });
  return out;
}

describe.skipIf(!present)("grammatica-indicativo scene fixture", () => {
  it("passes SceneSpec, checkScene and the concept cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("concept");
    expect(checkSemantics(spec)).toEqual([]);
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "concept") throw new Error("unreachable");
    expect(checkConceptData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters).toHaveLength(3);
    expect(spec.kind).toBe("mixed");
    expect(spec.videos).toEqual([]);
    const quizTypes = new Set(spec.chapters.flatMap((c) => c.quiz.map((q) => q.type)));
    expect(quizTypes).toEqual(new Set(["choice", "pick"]));
  });
});

describe.skipIf(!present)("ConceptData schema", () => {
  const base = () => raw().engineData;

  it("accepts the maths test scene", () => {
    expect(SceneSpec.safeParse(mathsScene()).success).toBe(true);
  });

  it("rejects unknown references, duplicate ids and impossible fractions", () => {
    const cases: ((d: ReturnType<typeof base>) => void)[] = [
      (d) => (d.tiles[0].role = "nope"),
      (d) => (d.tiles[0].place = { row: "nope", index: 0 }),
      (d) => (d.tiles[0].place = { axis: "nope", value: 0 }),
      (d) => (d.tiles[1].id = d.tiles[0].id),
      (d) => (d.tiles[0].id = d.rows[0].id),
      (d) => d.chapters[0].actions.push({ at: 1, do: "morph", id: "freccia", text: "x" }),
      (d) => d.chapters[0].actions.push({ at: 1, do: "appear", ids: ["ghost"] }),
      (d) => d.chapters[0].actions.push({ at: 1, do: "explode", ids: ["titolo"] }),
      (d) => d.links.push({ id: "l2", from: "freccia", to: "titolo" }),
      (d) => (d.axes[0].max = d.axes[0].min),
      (d) => d.shapes.push({ id: "p", kind: "pie", radius: 1, parts: 2, filled: 3, place: { pos: [0, 0, 0] } }),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(ConceptData.safeParse(d).success, mutate.toString()).toBe(false);
    }
  });

  it("cross-checks chapters, sources and numbers shown on tiles", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "concept") throw new Error("unreachable");
    const data = structuredClone(spec.engineData);
    data.chapters[0]!.chapter = "ghost";
    data.tiles.find((t) => t.id === "a-coniug")!.sourceIds = [];
    data.tiles[0]!.sourceIds = ["missing"];
    const messages = checkConceptData(data, spec).map((i) => i.message);
    expect(messages).toContain('unknown chapter "ghost"');
    expect(messages).toContain('unknown source id "missing"');
    expect(messages.some((m) => m.startsWith("number without source"))).toBe(true);
  });
});

describe.skipIf(!present)("concept plan", () => {
  const plan = () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "concept") throw new Error("unreachable");
    return { spec, plan: compilePlan(spec, spec.engineData) };
  };

  it("estimates wider tiles for longer text and sizes", () => {
    expect(tileWidth("trapassato prossimo", "")).toBeGreaterThan(tileWidth("presente", ""));
    expect(tileWidth("ho", "presente")).toBeGreaterThan(tileWidth("ho", ""));
    expect(tileWidth("x", "", "l")).toBeGreaterThan(tileWidth("x", "", "s"));
  });

  it("packs a row centred on its origin and slides neighbours when one leaves", () => {
    const { plan: p } = plan();
    const ch = p.chapters.get("come-si-forma")!;
    const x = (id: string, t: number) => evalPos(ch.entities.get(id)!.pos, t)[0];
    // aux | + | part: centred around 0 with the "+" in the middle.
    const left = x("aux", 5);
    const right = x("part", 5);
    expect(left).toBeLessThan(x("piu", 5));
    expect(right).toBeGreaterThan(x("piu", 5));
    const wAux = tileWidth("avere / essere", "ausiliare");
    const wPart = tileWidth("participio passato", "del verbo");
    const wPlus = tileWidth("+", "", "s");
    expect(left - wAux / 2).toBeCloseTo(-(wAux + wPlus + wPart + 2 * 0.12) / 2, 5);
    // After "+" hides, aux and part snap together, gap 0.12.
    expect(x("part", 9) - wPart / 2 - (x("aux", 9) + wAux / 2)).toBeCloseTo(0.12, 5);
  });

  it("starts split pieces where the source tile was and lands them in their places", () => {
    const { plan: p } = plan();
    const ch = p.chapters.get("analisi")!;
    const src = evalPos(ch.entities.get("parola")!.pos, 11.9);
    const a = evalPos(ch.entities.get("w-aux")!.pos, 12);
    const b = evalPos(ch.entities.get("w-part")!.pos, 12);
    expect(a[0]).toBeLessThan(src[0]);
    expect(b[0]).toBeGreaterThan(src[0]);
    expect(a[1]).toBeCloseTo(src[1]);
    expect(evalPresence(ch.entities.get("parola")!.presence, 14).scale).toBe(0);
    expect(evalPresence(ch.entities.get("w-aux")!.presence, 14).scale).toBe(1);
    const end = evalPos(ch.entities.get("w-aux")!.pos, 15);
    expect(end[1]).toBeCloseTo(5.4);
  });

  it("flies merged tiles into the target without jumps while they shrink away", () => {
    const { plan: p } = plan();
    const ch = p.chapters.get("analisi")!;
    const into = evalPos(ch.entities.get("parola2")!.pos, 47)[0];
    let prev = evalPos(ch.entities.get("w-aux")!.pos, 46)[0];
    for (let t = 46.05; t <= 47.2; t += 0.05) {
      const x = evalPos(ch.entities.get("w-aux")!.pos, t)[0];
      expect(Math.abs(x - prev), `t=${t}`).toBeLessThan(0.3);
      prev = x;
    }
    expect(Math.abs(prev - into)).toBeLessThan(Math.abs(evalPos(ch.entities.get("w-aux")!.pos, 45)[0] - into));
    expect(evalPresence(ch.entities.get("w-aux")!.presence, 47.2).scale).toBe(0);
    expect(evalPresence(ch.entities.get("parola2")!.presence, 47.5).scale).toBe(1);
  });

  it("flips text at the middle of a morph", () => {
    const { plan: p } = plan();
    const tr = p.chapters.get("analisi")!.entities.get("a-coniug")!.variant;
    const variants = p.variants.get("a-coniug")!;
    expect(variants[evalFlip(tr, 22).variant]!.text).toBe("2ª coniug.");
    expect(variants[evalFlip(tr, 23.5).variant]!.text).toBe("1ª coniug.");
    expect(evalFlip(tr, 22.5 + 0.35).angle).not.toBe(0);
    expect(evalFlip(tr, 30).angle).toBe(0);
  });

  it("carries the previous chapter's end state over unless carryOver is false", () => {
    const { plan: p } = plan();
    const shown = (ch: string, id: string, t: number) => evalPresence(p.chapters.get(ch)!.entities.get(id)!.presence, t).scale;
    expect(shown("otto-tempi", "presente", 0)).toBe(0);
    expect(shown("otto-tempi", "presente", 51)).toBe(1);
    expect(shown("come-si-forma", "presente", 0)).toBe(0);
    const m = SceneSpec.parse(mathsScene());
    if (m.engine !== "concept") throw new Error("unreachable");
    const mp = compilePlan(m, m.engineData);
    expect(evalPresence(mp.chapters.get("b")!.entities.get("tri")!.presence, 0).scale).toBe(1);
  });
});

describe.skipIf(!present)("concept engine", () => {
  it("is a pure function of (chapterId, t)", async () => {
    for (const [json, moving] of [[raw(), true], [mathsScene(), false]] as const) {
      const { spec, engine, ctx } = await buildEngine(json);
      const ids = spec.chapters.map((c) => c.id);
      for (const ch of ids) {
        const dur = spec.chapters.find((c) => c.id === ch)!.duration;
        for (const [t1, t2] of [
          [dur * 0.25, dur * 0.8],
          [dur * 0.6, 0.2],
          [dur - 0.1, dur * 0.4],
        ] as const) {
          engine.update(ch, t1);
          const a = snapshot(ctx.root);
          engine.update(ch, t2);
          const between = snapshot(ctx.root);
          engine.update(ids[0]!, 3.3);
          engine.update(ch, t1);
          expect(snapshot(ctx.root)).toEqual(a);
          if (moving) expect(between).not.toEqual(a);
        }
      }
    }
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
    const a = new THREE.Vector3();
    expect(engine.resolveAnchor({ entity: "tile", part: "nope" }, "analisi", 1, a)).toBe(false);
    expect(engine.resolveAnchor({ entity: "row", part: "nope" }, "analisi", 1, a)).toBe(false);
    expect(engine.resolveAnchor({ entity: "axis", part: "freccia", index: 9 }, "analisi", 1, a)).toBe(false);
    expect(engine.resolveAnchor({ geo: [12, 41] }, "analisi", 1, a)).toBe(false);
    expect(engine.resolveAnchor({ entity: "axis", part: "freccia", index: 1 }, "otto-tempi", 10, a)).toBe(true);
    expect(a.x).toBeCloseTo(0);
    expect(engine.resolveAnchor({ entity: "link", part: "l-tempo" }, "analisi", 29, a)).toBe(true);
  });

  it("puts tile anchors on top of the tile, following its hop", async () => {
    const { engine } = await buildEngine();
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    engine.update("come-si-forma", 17.4);
    engine.resolveAnchor({ entity: "tile", part: "part1" }, "come-si-forma", 17.4, before);
    engine.update("come-si-forma", 20);
    engine.resolveAnchor({ entity: "tile", part: "part1" }, "come-si-forma", 20, after);
    expect(before.y).toBeCloseTo(7 + 1 + 0.15, 1);
    expect(after.y).toBeCloseTo(4.2 + 1 + 0.15, 1);
    expect(after.x).toBeLessThan(before.x + 3);
  });

  it("builds shapes, axes and arrows in Node, with and without a canvas", async () => {
    for (const withCanvas of [false, true]) {
      const { engine, ctx } = await buildEngine(mathsScene(), withCanvas);
      engine.update("a", 12);
      expect(ctx.root.getObjectByName("shape:pie")!.visible).toBe(true);
      expect(ctx.root.getObjectByName("link:l")!.visible).toBe(true);
      const sprites: THREE.Sprite[] = [];
      ctx.root.traverse((o) => o instanceof THREE.Sprite && sprites.push(o));
      expect(sprites.length > 0).toBe(withCanvas);
      engine.update("b", 5);
      expect(ctx.root.getObjectByName("tile:t4")!.visible).toBe(true);
      expect(ctx.root.getObjectByName("tile:t1")!.visible).toBe(false);
      expect(ctx.root.getObjectByName("link:l")!.visible).toBe(false);
      engine.dispose();
    }
  });

  it("marks highlighted tiles as key for the ink style", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("otto-tempi", 21);
    expect(ctx.root.getObjectByName("tile:imperfetto")!.userData.key).toBe(true);
    expect(ctx.root.getObjectByName("tile:presente")!.userData.key).toBe(false);
    engine.update("otto-tempi", 30);
    expect(ctx.root.getObjectByName("tile:imperfetto")!.userData.key).toBe(false);
  });

  it("reports bounds that contain the content and cleans up on dispose", async () => {
    const { spec, engine, ctx } = await buildEngine();
    const { center, radius } = engine.bounds();
    for (const ch of spec.chapters) {
      engine.update(ch.id, ch.duration);
      const box = new THREE.Box3().setFromObject(ctx.root);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      expect(center.distanceTo(sphere.center) + sphere.radius, ch.id).toBeLessThanOrEqual(radius * 1.1);
    }
    expect(ctx.scene.children.length).toBeGreaterThan(0);
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
    expect(ctx.scene.children).toHaveLength(0);
  });
});
