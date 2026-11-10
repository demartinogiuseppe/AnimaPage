import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec, SOUND_IDS } from "@pv/scene-spec";
import { ChartData, checkChartData } from "../../scene-spec/src/engines/chart.ts";
import { createChartEngine } from "../src/engines/chart/index.ts";
import { formatIt, formatValue, niceScale } from "../src/engines/chart/format.ts";
import { compilePlan, evalChart, sortSlots } from "../src/engines/chart/plan.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/dati-campania.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));
type ChartSpec = SceneSpec & { engine: "chart" };

async function build(json: unknown = raw()) {
  const spec = SceneSpec.parse(json) as ChartSpec;
  const engine = createChartEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Transforms, visibility, opacity, glow and instance matrices of everything rendered. */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const e: unknown[] = [o.name, ...o.matrixWorld.elements, o.userData.key ?? null];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      e.push(m.opacity, ...(m.emissive ? m.emissive.toArray() : []), o.geometry.getAttribute("position")?.count ?? 0);
    }
    if (o instanceof THREE.InstancedMesh) e.push(...o.instanceMatrix.array);
    out.push(e);
  });
  return out;
}

const anchor = (engine: Awaited<ReturnType<typeof build>>["engine"], a: object, ch: string, t: number) => {
  const v = new THREE.Vector3();
  engine.update(ch, t);
  expect(engine.resolveAnchor(a as never, ch, t, v)).toBe(true);
  return v.clone();
};

describe("dati-campania scene fixture", () => {
  it("passes SceneSpec, checkScene and the chart cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("chart");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "chart") throw new Error("unreachable");
    expect(checkChartData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["province", "territorio", "popolazione"]);
    for (const ch of spec.chapters) {
      expect(ch.book).toBeDefined();
      expect(ch.activity?.test.params?.length).toBeGreaterThan(0);
      expect(new Set(ch.quiz.map((q) => q.type))).toEqual(new Set(["choice", "pick"]));
      expect(ch.deep.length).toBeGreaterThan(0);
      expect(ch.pins.length).toBeGreaterThan(0);
      for (const c of ch.sounds?.cues ?? []) expect(SOUND_IDS).toContain(c.sound);
    }
  });

  it("keeps the book value and the source value side by side when they differ", () => {
    const d = (raw().engineData as ChartData).datasets.find((x) => x.id === "territorio")!;
    expect(d.series.map((s) => [s.label, s.values, s.sourceIds])).toEqual([
      ["Libro", [51, 34, 15], ["page"]],
      ["Wikipedia", [50.8, 34.6, 14.6], ["wp-campania"]],
    ]);
  });
});

describe("ChartData schema", () => {
  const base = () => raw().engineData;
  it("rejects bad references and inconsistent data", () => {
    const cases: ((d: any) => void)[] = [
      (d) => d.datasets[0].categories.push({ ...d.datasets[0].categories[0] }), // duplicate category (and count mismatch)
      (d) => d.datasets[0].series[0].values.pop(),
      (d) => (d.charts[0].dataset = "ghost"),
      (d) => (d.charts[0].series = ["ghost"]),
      (d) => (d.charts[1].series = ["libro", "wiki"]), // a pie draws one series
      (d) => (d.datasets[2].categories[3].x = undefined), // x on some categories only
      (d) => (d.datasets[2].categories[3].x = 1700), // x must increase
      (d) => (d.datasets[0].series[0].values[0] = -5), // bars need values >= 0
      (d) => d.chapters[0].actions.push({ do: "sort", chart: "popolazione-linea", at: 1, order: "asc" }), // not on stage, not sortable
      (d) => d.chapters[2].actions.push({ do: "sort", chart: "popolazione-linea", at: 1, order: "asc" }),
      (d) => d.chapters[0].actions.push({ do: "annotate", chart: "province-barre", at: 1, category: "ghost", text: "x", sourceIds: [] }),
      (d) => d.chapters[0].actions.push({ do: "compare", chart: "province-barre", at: 1, categories: ["napoli", "napoli"] }),
      (d) => d.chapters[0].actions.push({ do: "highlight", chart: "province-barre", at: 1 }),
      (d) => (d.charts[2].cursor = undefined), // the sweep in chapter 3 needs it
      (d) => (d.chapters[0].charts[0].until = 0),
      (d) => (d.charts[0].kind = "radar"),
    ];
    const ok = (d: unknown) => ChartData.safeParse(d).success;
    expect(ok(base())).toBe(true);
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(ok(d), mutate.toString()).toBe(false);
    }
  });

  it("cross-checks chapters, times, sources, sliders and anchors against the scene", () => {
    const spec = SceneSpec.parse(raw()) as ChartSpec;
    const data = structuredClone(spec.engineData);
    data.chapters[0]!.chapter = "ghost";
    data.chapters[1]!.actions[0]!.at = 999;
    data.chapters[2]!.actions.push({ do: "annotate", chart: "popolazione-linea", at: 1, text: "Nel 1900", sourceIds: [] });
    data.datasets[0]!.series[0]!.sourceIds = ["nope"];
    const scene = structuredClone(spec);
    scene.chapters[2]!.activity!.test.params = ["fascia"];
    scene.chapters[2]!.pins[0]!.anchor = { entity: "item", part: "popolazione-linea", index: 99 };
    scene.chapters[2]!.pins[1]!.anchor = { entity: "item", part: "province-barre", index: 0 };
    const messages = checkChartData(data, scene).map((i) => i.message);
    expect(messages).toContain('unknown chapter "ghost"');
    expect(messages.some((m) => m.includes("after the chapter ends"))).toBe(true);
    expect(messages).toContain('number or date without source: "Nel 1900"');
    expect(messages).toContain('unknown source id "nope"');
    expect(messages.some((m) => m.includes('"fascia" is not the cursor'))).toBe(true);
    expect(messages.some((m) => m.includes("index 99 out of range"))).toBe(true);
    expect(messages).toContain('chart "province-barre" is not on stage in this chapter');
    expect(messages).toContain('chapter "province" has no chart entry in engineData.chapters');
  });
});

describe("Italian number format and scales", () => {
  it("formats like an Italian textbook", () => {
    expect(formatIt(5590076)).toBe("5.590.076");
    expect(formatIt(1171)).toBe("1.171");
    expect(formatIt(409)).toBe("409");
    expect(formatIt(13.5, 1)).toBe("13,5");
    expect(formatIt(50.84, 1)).toBe("50,8");
    expect(formatIt(-2.5, 1)).toBe("−2,5");
    expect(formatIt(-0.01, 0)).toBe("0");
    expect(formatValue(13.5, "%", 1)).toBe("13,5 %");
    expect(formatValue(21, "°C")).toBe("21 °C");
    expect(formatValue(2951375, "abitanti")).toBe("2.951.375");
  });

  it("builds round axes from zero", () => {
    expect(niceScale(0, 2951375)).toMatchObject({ lo: 0, hi: 3000000, step: 1000000 });
    expect(niceScale(-3, 24).lo).toBeLessThan(-2);
    expect(niceScale(0, 0).hi).toBeGreaterThan(0);
  });
});

describe("chart time model", () => {
  const spec = SceneSpec.parse(raw()) as ChartSpec;
  const plan = compilePlan(spec);
  const info = (id: string) => plan.charts.get(id)!;
  const cc = (ch: string, id: string) => plan.chapters.get(ch)!.get(id)!;

  it("grows, sorts and switches as pure functions of t", () => {
    expect(sortSlots([3, 1, 2], "desc")).toEqual([0, 2, 1]);
    expect(sortSlots([3, 1, 2], "original")).toEqual([0, 1, 2]);
    const bars = info("province-barre");
    const c1 = cc("province", "province-barre");
    expect(evalChart(bars, c1, 0).grow.every((g) => g === 0)).toBe(true);
    expect(evalChart(bars, c1, 4).grow.every((g) => g === 1)).toBe(true);
    // Alphabetical first, then sorted: Napoli (index 3) moves to the first slot.
    expect(evalChart(bars, c1, 10).slots).toEqual([0, 1, 2, 3, 4]);
    expect(evalChart(bars, c1, 25).slots).toEqual([3, 4, 2, 0, 1]);
    expect(evalChart(bars, c1, 14).hiCat[3]).toBe(1);
    const pie = info("territorio-ciambella");
    const c2 = cc("territorio", "territorio-ciambella");
    expect(evalChart(pie, c2, 20).values.get("libro")).toEqual([51, 34, 15]);
    expect(evalChart(pie, c2, 30).values.get("libro")).toEqual([50.8, 34.6, 14.6]);
    expect(evalChart(pie, c2, 30).active).toBe("wiki");
    expect(evalChart(pie, c2, 0).presence).toBe(1); // on stage from the start: visible while predicting
    expect(evalChart(pie, c2, 0).grow).toEqual([0, 0, 0]);
  });

  it("sweeps the year cursor and lets the slider override it", () => {
    const line = info("popolazione-linea");
    const c3 = cc("popolazione", "popolazione-linea");
    expect(evalChart(line, c3, 5).cursor).toBe(1861);
    expect(evalChart(line, c3, 24).cursor).toBeCloseTo(1951);
    expect(evalChart(line, c3, 24).focus).toBe(8);
    expect(evalChart(line, c3, 50).cursor).toBe(2021);
    const st = evalChart(line, c3, 50, 1900);
    expect(st.focus).toBe(2); // 1881 is the last census reached
    expect(st.grow.slice(0, 3)).toEqual([1, 1, 1]);
    expect(st.grow.slice(3).every((g) => g === 0)).toBe(true);
    // Focus cursor on categories: position in display order.
    const bars = info("province-barre");
    expect(evalChart(bars, cc("province", "province-barre"), 30, 1).focus).toBe(3);
  });
});

describe("chart engine in Node (no canvas)", () => {
  it("is deterministic when scrubbing t1 -> t2 -> t1 in every chapter", async () => {
    const { spec, engine, ctx } = await build();
    for (const ch of spec.chapters) {
      for (const [t1, t2] of [[2, ch.duration - 1], [ch.duration * 0.6, 0.5]] as const) {
        engine.update(ch.id, t1);
        const a = snapshot(ctx.root);
        engine.update(ch.id, t2);
        const b = snapshot(ctx.root);
        engine.update(ch.id, t1);
        expect(snapshot(ctx.root)).toEqual(a);
        expect(b).not.toEqual(a);
      }
    }
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
  });

  it("resolves chart, item and cursor anchors that follow the data", async () => {
    const { engine } = await build();
    const napoli = { entity: "item", part: "province-barre", index: 3 };
    const benevento = { entity: "item", part: "province-barre", index: 1 };
    const before = anchor(engine, napoli, "province", 10);
    const after = anchor(engine, napoli, "province", 25);
    expect(before.y).toBeGreaterThan(anchor(engine, benevento, "province", 10).y * 5);
    expect(after.x).toBeLessThan(before.x); // sorted to the left
    expect(after.y).toBeCloseTo(before.y);
    expect(anchor(engine, { entity: "chart", part: "province-barre" }, "province", 10).y).toBeGreaterThan(0);
    const cur = (t: number) => anchor(engine, { entity: "cursor", part: "popolazione-linea" }, "popolazione", t);
    expect(cur(30).x).toBeGreaterThan(cur(10).x);
    const slice = anchor(engine, { entity: "item", part: "territorio-ciambella", index: 0, offset: [0, 1, 0] }, "territorio", 30);
    expect(slice.y).toBeGreaterThan(1);
    const v = new THREE.Vector3();
    expect(engine.resolveAnchor({ entity: "item", part: "ghost", index: 0 }, "province", 1, v)).toBe(false);
    expect(engine.resolveAnchor({ entity: "item", part: "province-barre:ghost", index: 0 }, "province", 1, v)).toBe(false);
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(5);
    expect(b.radius).toBeLessThan(30);
  });

  it("exposes the cursors as sliders and stays pure under overrides", async () => {
    const { engine, ctx } = await build();
    engine.update("popolazione", 50);
    expect(engine.params!("popolazione")).toEqual([{ id: "anno", label: "Anno", min: 1861, max: 2021, step: 1, value: 2021 }]);
    expect(engine.params!("province")).toMatchObject([{ id: "provincia", min: 1, max: 5, step: 1 }]);
    expect(engine.params!("territorio")).toMatchObject([{ id: "fascia", min: 1, max: 3 }]);
    const head = () => anchor(engine, { entity: "cursor", part: "popolazione-linea" }, "popolazione", 50);
    const full = head();
    engine.setParams!({ anno: 1901, ghost: 3 });
    expect(engine.params!("popolazione")[0]!.value).toBe(1901);
    const early = head();
    expect(early.x).toBeLessThan(full.x);
    // Points not reached yet have no anchor, so their pins hide.
    expect(engine.resolveAnchor({ entity: "item", part: "popolazione-linea", index: 15 }, "popolazione", 50, new THREE.Vector3())).toBe(false);
    const snap = snapshot(ctx.root);
    engine.update("popolazione", 20);
    engine.update("popolazione", 50);
    expect(snapshot(ctx.root)).toEqual(snap);
    engine.setParams!({ anno: 99999 });
    expect(engine.params!("popolazione")[0]!.value).toBe(2021);
    engine.setParams!(null);
    expect(head().x).toBeCloseTo(full.x);
    // Ink style: highlighted marks are key, dimmed ones are not.
    engine.update("province", 14);
    const keys = new Map<string, boolean>();
    ctx.root.traverse((o) => o.name.startsWith("bar:") && keys.set(o.name, o.userData.key === true));
    expect(keys.get("bar:province-barre:istat2026:3")).toBe(true);
    expect(keys.get("bar:province-barre:istat2026:0")).toBe(false);
  });

  it("builds and animates every chart kind", async () => {
    const s = raw();
    const ch = structuredClone(s.chapters[0]);
    Object.assign(ch, { id: "tutti", pins: [], quiz: [], activity: undefined, book: undefined, camera: [], narration: [{ at: 0, text: "Prova.", highlight: [], sourceIds: [] }] });
    s.chapters.push(ch);
    const months = ["gen", "feb", "mar", "apr"];
    // Synthetic numbers for the engine test only (not shown to users).
    s.engineData.datasets.push(
      { id: "clima", title: "Clima", unit: "mm", categories: months.map((m) => ({ id: m, label: m })), series: [
        { id: "pioggia", label: "Pioggia", unit: "mm", values: [100, 80, 60, null], sourceIds: ["calc"] },
        { id: "temp", label: "Temperatura", unit: "°C", values: [-2, 4.5, 9, 13], sourceIds: ["calc"] },
      ] },
      { id: "flussi", title: "Flussi", unit: "t", categories: [{ id: "ab", label: "A-B" }, { id: "bc", label: "B-C" }], series: [
        { id: "s1", label: "Uno", values: [10, 4], sourceIds: ["calc"] },
        { id: "s2", label: "Due", values: [2, 8], sourceIds: ["calc"] },
      ] },
    );
    s.engineData.charts.push(
      { id: "omini", kind: "pictogram", dataset: "province", icon: "person", per: 200000, pos: [0, 0, -8] },
      { id: "palle", kind: "bubbles", dataset: "province", pos: [0, 0, 8] },
      { id: "dischi", kind: "bubbles", dataset: "province", shape: "disc", pos: [14, 0, 8] },
      { id: "clima-g", kind: "climograph", dataset: "clima", rain: "pioggia", temp: "temp", pos: [14, 0, 0], values: true },
      { id: "frecce", kind: "flows", dataset: "flussi", pos: [-14, 0, 0], nodes: [{ id: "a", label: "A", pos: [-3, 0] }, { id: "b", label: "B", pos: [3, 0] }, { id: "c", label: "C", pos: [0, 3] }],
        links: [{ category: "ab", from: "a", to: "b" }, { category: "bc", from: "b", to: "c" }] },
      { id: "pila", kind: "bars", dataset: "flussi", layout: "stacked", pos: [-14, 0, 8], shape: "cylinder" },
      { id: "gruppi", kind: "bars", dataset: "flussi", pos: [-14, 0, -8] },
      { id: "torta", kind: "pie", dataset: "flussi", pos: [14, 0, -8] },
    );
    const ids = ["omini", "palle", "dischi", "clima-g", "frecce", "pila", "gruppi", "torta"];
    s.engineData.chapters.push({ chapter: "tutti", charts: ids.map((id) => ({ id, at: 1 })), actions: [
      { do: "sort", chart: "omini", at: 4, order: "asc" },
      { do: "switch", chart: "frecce", at: 5, series: "s2" },
      { do: "highlight", chart: "gruppi", at: 5, series: ["s2"] },
      { do: "compare", chart: "palle", at: 5, categories: ["napoli", "salerno"] },
      { do: "annotate", chart: "clima-g", at: 5, category: "feb", series: "temp", text: "Più caldo", sourceIds: [] },
      { do: "highlight", chart: "torta", at: 6, categories: ["ab"] },
    ] });
    const spec = SceneSpec.parse(s) as ChartSpec;
    expect(checkChartData(spec.engineData, spec)).toEqual([]);
    const { engine, ctx } = await build(s);
    engine.update("tutti", 8);
    const a = snapshot(ctx.root);
    engine.update("tutti", 2);
    engine.update("tutti", 8);
    expect(snapshot(ctx.root)).toEqual(a);
    const names = new Set<string>();
    ctx.root.traverseVisible((o) => names.add(o.name.split(":")[0]!));
    for (const n of ["icons", "bubble", "bar", "line", "point", "flow", "slice", "note", "level", "node"]) expect(names).toContain(n);
    // Icon count: Napoli 2.951.375 / 200.000 -> 15 icons.
    const icons = ctx.root.getObjectByName("icons:omini:3") as THREE.InstancedMesh;
    const shown = Array.from({ length: icons.count }, (_, i) => {
      const m = new THREE.Matrix4();
      icons.getMatrixAt(i, m);
      return m.elements[0]! > 0;
    }).filter(Boolean).length;
    expect(shown).toBe(15);
    const top = anchor(engine, { entity: "item", part: "clima-g:temp", index: 1 }, "tutti", 8);
    expect(top.x).toBeGreaterThan(8);
    engine.dispose();
  });
});
