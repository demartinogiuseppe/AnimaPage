import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec, type LabSetup } from "@pv/scene-spec";
import { checkLabData, LAB_KINDS, LAB_PARTS, LAB_SHOW_KINDS, LAB_SHOWS, LAB_VESSEL_PARTS, LabData } from "../../scene-spec/src/engines/lab.ts";
import { createLabEngine } from "../src/engines/lab/index.ts";
import { boardLines, C_ICE, C_WATER, Experiment, frameOf, L_FUSION, L_VAPOUR, num, varsOf, type LabState } from "../src/engines/lab/physics.ts";
import { levelOf, volumeAt } from "../src/engines/lab/vessels.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/laboratorio-energia.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function buildEngine(json = raw()) {
  const spec = SceneSpec.parse(json);
  const engine = createLabEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Transforms, visibility, opacity/emissive and instance matrices of everything rendered. */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      entry.push(m.opacity, m.emissiveIntensity ?? 0);
    }
    if (o instanceof THREE.InstancedMesh) entry.push(o.count, ...o.instanceMatrix.array);
    out.push(entry);
  });
  return out;
}

const experiment = (setup: LabSetup) => {
  const v = varsOf(setup);
  return new Experiment(setup, v, frameOf(setup.kind, [v]));
};

describe("laboratorio-energia scene fixture", () => {
  it("passes SceneSpec, checkScene and the lab cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("lab");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "lab") throw new Error("unreachable");
    expect(checkLabData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["caduta", "pendolo", "attrito"]);
    for (const ch of spec.chapters) {
      expect(ch.book, ch.id).toBeDefined();
      expect(ch.activity?.test.params?.length, ch.id).toBeGreaterThan(0);
      expect(new Set(ch.quiz.map((q) => q.type)), ch.id).toEqual(new Set(["choice", "pick"]));
      expect(ch.sounds?.cues.length, ch.id).toBeGreaterThan(0);
    }
  });
});

describe("LabData schema", () => {
  const base = () => raw().engineData;

  it("rejects bad variables, ranges, overlays and run order", () => {
    const cases: ((d: any) => void)[] = [
      (d) => (d.chapters[0].setup.height = 500), // beyond the hard limit
      (d) => (d.chapters[0].setup.kind = "teapot"),
      (d) => (d.chapters[0].params[0].var = "colour"), // not a variable of "fall"
      (d) => (d.chapters[0].params[0].max = 80), // slider beyond the hard limit
      (d) => (d.chapters[0].params[0].min = 3), // setup value outside the slider range
      (d) => d.chapters[0].params.push({ ...d.chapters[0].params[0] }), // duplicate id
      (d) => d.chapters[1].show.push({ item: "strobe" }), // not available for pendulum
      (d) => d.chapters[0].runs.push({ at: 1 }), // out of order
      (d) => (d.chapters[2].setup.track = "loop"),
      (d) => d.chapters.push({ ...d.chapters[0] }), // duplicate chapter
      (d) => d.chapters[0].show.push({ item: "board", at: 5, until: 2 }),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(LabData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(LabData.safeParse(base()).success).toBe(true);
  });

  it("cross-checks chapters, times, slider ids and anchors against the scene", () => {
    const json = raw();
    json.engineData.chapters[0].chapter = "ghost";
    json.engineData.chapters[1].runs[0].at = 999;
    json.chapters[2].activity.test.params = ["nope"];
    json.chapters[2].pins[1].anchor = { entity: "part", part: "pivot" };
    json.chapters[2].camera[2].target = { entity: "gauge", part: "dial" };
    const spec = SceneSpec.parse(json);
    if (spec.engine !== "lab") throw new Error("unreachable");
    const messages = checkLabData(spec.engineData, spec).map((i) => i.message);
    expect(messages).toContain('unknown chapter "ghost"');
    expect(messages).toContain('chapter "caduta" has no lab entry (empty bench)');
    expect(messages).toContain("run starts after the chapter ends");
    expect(messages).toContain('unknown lab param "nope"');
    expect(messages.some((m) => m.startsWith('unknown part "pivot" for "ramp"'))).toBe(true);
    expect(messages.some((m) => m.startsWith('unknown gauge "dial"'))).toBe(true);
  });
});

describe("lab physics", () => {
  it("free fall: closed form, mass-independent time, energy conserved then turned into heat", () => {
    const a = experiment({ kind: "fall", height: 2, mass: 1 });
    const b = experiment({ kind: "fall", height: 2, mass: 5 });
    const sa = a.state(0.3);
    const sb = b.state(0.3);
    expect(sa.bodies[0]!.y).toBeCloseTo(2 - 0.5 * 9.81 * 0.09, 10);
    expect(sb.bodies[0]!.y).toBeCloseTo(sa.bodies[0]!.y, 12);
    if (sa.kind !== "fall") throw new Error("unreachable");
    expect(sa.T).toBeCloseTo(Math.sqrt(4 / 9.81), 12);
    expect(sa.energy.Ep + sa.energy.Ec).toBeCloseTo(1 * 9.81 * 2, 9);
    expect(sb.energy.E).toBeCloseTo(5 * 9.81 * 2, 9);
    const end = a.state(5);
    expect(end.done).toBe(true);
    expect(end.energy.Q).toBeCloseTo(end.energy.E, 12);
  });

  it("projectile: range and apex match the closed forms", () => {
    const s = experiment({ kind: "projectile", speed: 10, angle: 45, mass: 1 }).state(0);
    if (s.kind !== "projectile") throw new Error("unreachable");
    expect(s.range).toBeCloseTo((100 * Math.sin(Math.PI / 2)) / 9.81, 9);
    expect(s.apex.y).toBeCloseTo(50 / (2 * 9.81) / 1, 6);
  });

  it("pendulum: exact period, mass-independent, energy exchange with a constant sum", () => {
    const ex = experiment({ kind: "pendulum", length: 1, mass: 0.5, angle: 20 });
    const s0 = ex.state(0);
    if (s0.kind !== "pendulum") throw new Error("unreachable");
    expect(s0.Tsmall).toBeCloseTo(2 * Math.PI * Math.sqrt(1 / 9.81), 12);
    // Back at the start angle after one exact period.
    expect(ex.state(s0.Texact).kind === "pendulum" && (ex.state(s0.Texact) as { theta: number }).theta).toBeCloseTo((20 * Math.PI) / 180, 4);
    for (const t of [0.1, 0.37, 0.5, 1.3, 7.7]) {
      const s = ex.state(t);
      expect(s.energy.Ep + s.energy.Ec).toBeCloseTo(s0.energy.E, 7);
    }
    const heavy = experiment({ kind: "pendulum", length: 1, mass: 4, angle: 20 });
    expect(heavy.state(1.234).bodies[0]!.x).toBeCloseTo(ex.state(1.234).bodies[0]!.x, 10);
  });

  it("spring: SHM period and Hooke force", () => {
    const ex = experiment({ kind: "spring", k: 20, mass: 0.5, amplitude: 0.2 });
    const s = ex.state(0);
    if (s.kind !== "spring") throw new Error("unreachable");
    expect(s.T).toBeCloseTo(2 * Math.PI * Math.sqrt(0.5 / 20), 12);
    const later = ex.state(1.1);
    if (later.kind !== "spring") throw new Error("unreachable");
    expect(later.x).toBeCloseTo(0.2 * Math.cos(Math.sqrt(40) * 1.1), 6);
    expect(s.forces[0]).toMatchObject({ id: "F", dx: -1, n: 4 });
  });

  it("ramp: frictionless valley climbs back to the same height; friction heat equals friction work", () => {
    const free = experiment({ kind: "ramp", angle: 30, length: 2, mass: 1, friction: 0, flat: 1, track: "valley" });
    let top = 0;
    for (let t = 1.5; t < 2.6; t += 0.001) top = Math.max(top, free.state(t).bodies[0]!.y);
    expect(top).toBeCloseTo(1, 3);
    const fr = experiment({ kind: "ramp", angle: 30, length: 2, mass: 1, friction: 0.1, flat: 1, track: "valley" });
    const s = fr.state(0.6);
    if (s.kind !== "ramp") throw new Error("unreachable");
    expect(s.a).toBeCloseTo(9.81 * (0.5 - 0.1 * Math.cos(Math.PI / 6)), 9);
    // On the first ramp: Q = μ·m·g·cosθ·distance.
    expect(s.energy.Q).toBeCloseTo(0.1 * 9.81 * Math.cos(Math.PI / 6) * s.s, 2);
    const end = fr.state(30);
    expect(end.done).toBe(true);
    expect(end.energy.Q).toBeCloseTo(end.energy.E, 9);
    // tan θ <= μ: it never moves.
    const stuck = experiment({ kind: "ramp", angle: 15, length: 2, mass: 1, friction: 0.5 });
    expect(stuck.state(5).bodies[0]!.x).toBe(0);
  });

  it("lever balances when m1·d1 = m2·d2 and tips otherwise", () => {
    const even = experiment({ kind: "lever", massLeft: 2, armLeft: 0.5, massRight: 1, armRight: 1 }).state(3);
    const odd = experiment({ kind: "lever", massLeft: 2, armLeft: 0.5, massRight: 1, armRight: 0.6 }).state(3);
    if (even.kind !== "lever" || odd.kind !== "lever") throw new Error("unreachable");
    expect(even.phi).toBe(0);
    expect(odd.phi).toBeCloseTo(-odd.phiMax, 9);
  });

  it("buoyancy: a light cube floats with the immersed fraction ρ/ρ_liquid, a dense one sinks", () => {
    const wood = experiment({ kind: "buoyancy", density: 600, fluidDensity: 1000, volume: 1 }).state(20);
    if (wood.kind !== "buoyancy") throw new Error("unreachable");
    expect(wood.depth / wood.side).toBeCloseTo(0.6, 4);
    expect(wood.buoyant).toBeCloseTo(wood.weight, 3);
    const alu = experiment({ kind: "buoyancy", density: 2700, fluidDensity: 1000, volume: 1 }).state(20);
    if (alu.kind !== "buoyancy") throw new Error("unreachable");
    expect(alu.bottom).toBe(0);
    expect(alu.buoyant).toBeCloseTo(1000 * 0.001 * 9.81, 9);
  });

  it("circuit: Ohm's law in series and in parallel, switch open before the run", () => {
    const series = experiment({ kind: "circuit", voltage: 4.5, r1: 10, r2: 10, layout: "series" });
    const parallel = experiment({ kind: "circuit", voltage: 4.5, r1: 10, r2: 10, layout: "parallel" });
    const s = series.state(1);
    const p = parallel.state(1);
    if (s.kind !== "circuit" || p.kind !== "circuit") throw new Error("unreachable");
    expect(s.R).toBe(20);
    expect(s.I).toBeCloseTo(0.225, 12);
    expect(p.R).toBe(5);
    expect(p.currents).toEqual([0.45, 0.45]);
    // One bulb alone is "fully lit": two in series get a quarter of its power each, in parallel the same.
    expect(s.brightness[0]).toBeCloseTo(0.25, 12);
    expect(p.brightness[0]).toBeCloseTo(1, 12);
    const off = series.state(-1);
    expect(off.kind === "circuit" && off.closed).toBe(false);
  });

  it("heat: temperature plateaus while ice melts and water boils", () => {
    const ex = experiment({ kind: "heat", power: 1000, mass: 0.5, startTemp: -10 });
    const melt0 = (0.5 * C_ICE * 10) / 1000;
    const melt1 = melt0 + (0.5 * L_FUSION) / 1000;
    const boil0 = melt1 + (0.5 * C_WATER * 100) / 1000;
    const boil1 = boil0 + (0.5 * L_VAPOUR) / 1000;
    const at = (t: number) => ex.state(t) as Extract<LabState, { kind: "heat" }>;
    expect(at(melt0 / 2).T).toBeCloseTo(-5, 9);
    expect(at((melt0 + melt1) / 2)).toMatchObject({ T: 0, phase: "fusione" });
    expect(at((melt0 + melt1) / 2).ice).toBeCloseTo(0.5, 9);
    expect(at((melt1 + boil0) / 2).T).toBeCloseTo(50, 9);
    expect(at((boil0 + boil1) / 2)).toMatchObject({ T: 100, phase: "ebollizione" });
    expect(at(boil1 + 1)).toMatchObject({ phase: "evaporata", done: true });
    expect(at(0).total).toBeCloseTo(boil1, 9);
  });

  it("integrated states do not depend on the order of the queries", () => {
    const mk = () => experiment({ kind: "pendulum", length: 1.3, mass: 1, angle: 50, damping: 0.1 });
    const a = mk();
    const b = mk();
    const late = a.state(12.345);
    b.state(3);
    expect(b.state(12.345)).toEqual(late);
  });
});

describe("communicating vessels", () => {
  type VesselsState = Extract<LabState, { kind: "vessels" }>;
  const vessels = (setup: Omit<Extract<LabSetup, { kind: "vessels" }>, "kind">) => {
    const ex = experiment({ kind: "vessels", ...setup });
    return { ex, state: (t: number) => ex.state(t) as VesselsState };
  };

  it("lab: pouring raises one level, then all settle at the common level and the volume is conserved", () => {
    const ex = vessels({ layout: "lab", volume: 1, level: 0.08 });
    const before = ex.state(-1);
    const total = before.volumes.reduce((a, b) => a + b, 0);
    const mid = ex.state(1.5);
    expect(mid.pouring).toBe(true);
    expect(mid.levels[3]).toBeGreaterThan(mid.levels[0]! + 0.005); // the flask is poured into: it leads
    const end = ex.state(40);
    expect(end.done).toBe(true);
    expect(end.volumes.reduce((a, b) => a + b, 0)).toBeCloseTo(total + 1, 9);
    for (const L of end.levels) expect(L).toBeCloseTo(end.eq, 4);
    // Containers of different shapes, same level: same pressure ρ·g·h at the bottom.
    for (const p of end.pressures) expect(p).toBeCloseTo(1000 * 9.81 * (end.eq - 0.025), 0);
    expect(boardLines(ex.ex, end, false)[2]).toBe(`a riposo: tutti a ${num(end.eq * 100, 1)} cm`);
  });

  it("flask volume and level are inverse functions", () => {
    const flask = { name: "f", shape: "flask", x: 0, y0: 0, top: 0.32, r: 0.1, K: 1 } as const;
    for (const L of [0.01, 0.08, 0.169, 0.2, 0.3]) expect(levelOf(flask, volumeAt(flask, L))).toBeCloseTo(L, 9);
  });

  it("tower: risers fill up to the tank level, taps above it stay dry", () => {
    const st = vessels({ layout: "tower", tankHeight: 20, buildingHeight: 25 }).state(60);
    const L = st.levels[0]!;
    expect(L).toBeLessThan(20); // the tank feeds the risers
    expect(L).toBeGreaterThan(19.8);
    expect(st.levels[2]).toBeCloseTo(L, 3); // building riser: open to the level
    expect(st.levels[1]).toBeCloseTo(4.5, 9); // house riser: full, under pressure
    for (const t of st.taps) {
      expect(t.wet).toBe(t.y < L);
      if (t.wet) expect(t.p).toBeCloseTo(1000 * 9.81 * (L - t.y), 6);
    }
    expect(vessels({ layout: "tower", tankHeight: 20, buildingHeight: 25 }).state(-1).taps.every((t) => !t.wet)).toBe(true);
  });

  it("canal: the channel fills to sea level; the boat enters only if the water is deeper than its draft", () => {
    const deep = vessels({ layout: "canal", depth: 10, draft: 6 });
    expect(deep.state(0.5).boat).toBe(0);
    const end = deep.state(60);
    expect(end.levels[1]).toBeCloseTo(0, 3);
    expect(end.boat).toBe(1);
    expect(end.pressures[1]).toBeCloseTo(1000 * 9.81 * 10, -1);
    const shallow = vessels({ layout: "canal", depth: 4, draft: 6 }).state(60);
    expect(shallow.navigable).toBe(false);
    expect(shallow.boat).toBe(0);
  });

  it("schema: whole container counts, sliders of the right layout, parts of the right layout", () => {
    const json = raw();
    json.engineData.chapters[0].setup = { kind: "vessels", layout: "tower", tankHeight: 20, buildingHeight: 15 };
    json.engineData.chapters[0].params = [{ id: "h", var: "depth", label: "x", min: 1, max: 20 }];
    expect(LabData.safeParse(json.engineData).success).toBe(false); // depth is a canal variable (and missing)
    json.engineData.chapters[0].setup.count = 2.5;
    json.engineData.chapters[0].params = [];
    expect(LabData.safeParse(json.engineData).success).toBe(false);
    json.engineData.chapters[0].setup = { kind: "vessels", layout: "tower", tankHeight: 20, buildingHeight: 15 };
    json.engineData.chapters[0].show = [{ item: "level" }, { item: "board" }];
    json.chapters[0].activity.test.params = [];
    json.chapters[0].pins = [{ id: "p", name: "Nave", info: "La nave.", kind: "object", anchor: { entity: "part", part: "boat" }, sourceIds: [] }];
    json.chapters[0].narration.forEach((s: { highlight: string[] }) => (s.highlight = []));
    json.chapters[0].quiz = [];
    json.chapters[0].camera = [];
    const spec = SceneSpec.parse(json);
    if (spec.engine !== "lab") throw new Error("unreachable");
    expect(checkLabData(spec.engineData, spec).map((i) => i.message)).toContain(
      'unknown part "boat" for vessels layout "tower" (use tank, tower, house, building, tap, pipe, level)',
    );
  });
});

describe("lab engine", () => {
  it("builds in Node without WebGL or canvas, one bench for every chapter", async () => {
    const { ctx, engine } = await buildEngine();
    const names: string[] = [];
    ctx.root.traverse((o) => o.name && names.push(o.name));
    expect(names).toEqual(expect.arrayContaining(["bench", "lab:caduta", "lab:pendolo", "lab:attrito", "show:energy", "board"]));
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(5);
    expect(b.radius).toBeLessThan(20);
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
  });

  it("update is pure: t1 -> t2 -> t1 gives the same frame, also across chapters", async () => {
    const { ctx, engine } = await buildEngine();
    for (const [chapter, t1, t2] of [["caduta", 10.1, 30], ["pendolo", 14.2, 40], ["attrito", 12.5, 45]] as const) {
      engine.update(chapter, t1);
      const first = snapshot(ctx.root);
      engine.update(chapter, t2);
      expect(snapshot(ctx.root)).not.toEqual(first);
      engine.update("caduta", 3);
      engine.update(chapter, t1);
      expect(snapshot(ctx.root)).toEqual(first);
    }
  });

  it("shows only the chapter's own experiment and its overlays inside their windows", async () => {
    const { ctx, engine } = await buildEngine();
    engine.update("pendolo", 2);
    const visible = (name: string) => {
      let v = false;
      ctx.root.traverseVisible((o) => (v ||= o.name === name));
      return v;
    };
    expect(visible("lab:pendolo")).toBe(true);
    expect(visible("lab:caduta")).toBe(false);
    expect(visible("show:velocity")).toBe(false); // from t = 11
    engine.update("pendolo", 12);
    expect(visible("show:velocity")).toBe(true);
  });

  it("resolves every pin and camera anchor of the scene, following the moving body", async () => {
    const { spec, engine } = await buildEngine();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters) {
      for (const t of [0, ch.duration / 2]) {
        engine.update(ch.id, t);
        for (const a of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
          expect(engine.resolveAnchor(a, ch.id, t, out), `${ch.id} ${JSON.stringify(a)}`).toBe(true);
          expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
        }
      }
    }
    const ball = { entity: "body" } as const;
    engine.update("caduta", 9);
    engine.resolveAnchor(ball, "caduta", 9, out);
    const y0 = out.y;
    engine.update("caduta", 11);
    engine.resolveAnchor(ball, "caduta", 11, out);
    expect(out.y).toBeLessThan(y0);
    expect(engine.resolveAnchor({ entity: "part", part: "nope" }, "caduta", 0, out)).toBe(false);
    expect(engine.resolveAnchor({ entity: "body", index: 5 }, "caduta", 0, out)).toBe(false);
  });

  it("exposes the activity sliders and applies overrides (null = back to the scene)", async () => {
    const { engine } = await buildEngine();
    expect(engine.params!("caduta").map((p) => [p.id, p.value, p.min, p.max])).toEqual([
      ["h", 2, 0.5, 5],
      ["m1", 1, 0.1, 10],
    ]);
    const out = new THREE.Vector3();
    const ballAt = (t: number) => (engine.update("caduta", t), engine.resolveAnchor({ entity: "body" }, "caduta", t, out), out.y);
    const before = ballAt(9);
    engine.setParams!({ h: 4, ghost: 3 });
    expect(engine.params!("caduta")[0]!.value).toBe(4);
    expect(ballAt(9)).toBeGreaterThan(before);
    engine.setParams!({ h: 99 });
    expect(engine.params!("caduta")[0]!.value).toBe(5); // clamped
    engine.setParams!(null);
    expect(ballAt(9)).toBeCloseTo(before, 12);
    // The pendulum period follows the length slider (purity with overrides).
    engine.setParams!({ len: 2 });
    engine.update("pendolo", 20);
    const a = engine.resolveAnchor({ entity: "body" }, "pendolo", 20, out) && out.clone();
    engine.update("pendolo", 30);
    engine.update("pendolo", 20);
    engine.resolveAnchor({ entity: "body" }, "pendolo", 20, out);
    expect(out.toArray()).toEqual((a as THREE.Vector3).toArray());
  });

  it("builds and runs every experiment kind", async () => {
    const setups: LabSetup[] = [
      { kind: "fall", height: 3, mass: 1 },
      { kind: "projectile", speed: 8, angle: 40, height: 1, mass: 0.5 },
      { kind: "pendulum", length: 1, mass: 1, angle: 30, damping: 0.05 },
      { kind: "spring", k: 30, mass: 1, amplitude: 0.3, damping: 0.2 },
      { kind: "ramp", angle: 25, length: 3, mass: 2, friction: 0.2 },
      { kind: "lever", massLeft: 3, armLeft: 0.4, massRight: 1, armRight: 1 },
      { kind: "buoyancy", density: 800, fluidDensity: 1000, volume: 2 },
      { kind: "circuit", voltage: 6, r1: 12, r2: 12, r3: 6, layout: "parallel" },
      { kind: "heat", power: 1500, mass: 0.3, startTemp: -5 },
      { kind: "vessels", layout: "lab", volume: 1, count: 4 },
      { kind: "vessels", layout: "tower", tankHeight: 20, buildingHeight: 25 },
      { kind: "vessels", layout: "canal", depth: 10, draft: 6 },
    ];
    expect([...new Set(setups.map((s) => s.kind))]).toEqual([...LAB_KINDS]);
    const idOf = (s: LabSetup) => (s.kind === "vessels" ? `vessels-${s.layout}` : s.kind);
    const json = {
      version: "0.1", engine: "lab", title: "Prova", kind: "science", sources: [], videos: [], disclaimers: [],
      page: { subject: "Scienze", topic: "Prova", language: "it" },
      chapters: setups.map((s) => ({ id: idOf(s), title: s.kind, chip: s.kind, kind: "science", duration: 30, narration: [{ at: 0, text: "Prova.", highlight: [], sourceIds: [] }], camera: [], pins: [], deep: [], quiz: [] })),
      engineData: {
        chapters: setups.map((s) => ({
          chapter: idOf(s),
          setup: s,
          runs: [{ at: 1, speed: s.kind === "heat" ? 100 : 1 }],
          show: LAB_SHOWS.filter((item) => LAB_SHOW_KINDS[item].includes(s.kind)).map((item) => ({ item })),
        })),
      },
    };
    const { ctx, engine, spec } = await buildEngine(json);
    if (spec.engine !== "lab") throw new Error("unreachable");
    expect(checkLabData(spec.engineData, spec)).toEqual([]);
    const out = new THREE.Vector3();
    for (const s of setups) {
      const id = idOf(s);
      engine.update(id, 0);
      const a = snapshot(ctx.root);
      engine.update(id, 9);
      expect(snapshot(ctx.root), id).not.toEqual(a);
      engine.update(id, 0);
      expect(snapshot(ctx.root), id).toEqual(a);
      const parts: readonly string[] = s.kind === "vessels" ? LAB_VESSEL_PARTS[s.layout] : LAB_PARTS[s.kind];
      for (const part of parts) expect(engine.resolveAnchor({ entity: "part", part }, id, 9, out), `${id}.${part}`).toBe(true);
      expect(engine.resolveAnchor({ entity: "body" }, id, 9, out) || !["vessels"].includes(s.kind), id).toBe(true);
    }
    engine.dispose();
  });
});
