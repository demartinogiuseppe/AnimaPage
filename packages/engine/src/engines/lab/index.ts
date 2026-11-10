// `lab` engine (Laboratorio): one physics experiment per chapter on a lab bench, with live
// measurements (energy test tubes, formula board, timer, ruler, velocity/force arrows,
// stroboscope, temperature graph) and "Prova tu" sliders bound to the physical variables.
// Schema, units and anchors: packages/scene-spec/src/engines/lab.ts. Physics: ./physics.ts.
//
// update(chapterId, t) is pure given the slider overrides: the run in progress is found from
// t, physical time is (t - run.at) * speed and the state comes from Experiment.state(tau),
// which is closed-form or a cached fixed-step integration of the current variable set.
import * as THREE from "three";
import type { Anchor, LabChapter, LabData, LabShowItem, SceneSpec } from "@pv/scene-spec";
import { engineText } from "@pv/scene-spec/i18n";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp, ease, seg } from "../../util/math.ts";
import { Arrow, key, Label, mat, mesh, Panel, tickStep } from "./draw.ts";
import { boardLines, Experiment, frameOf, num, varsOf, type Frame, type LabState, type Vars } from "./physics.ts";
import { BODY_COLORS, RIGS, type Fit, type Rig, type RulerSpec } from "./rigs.ts";

const PAPER = "#f4efe6";
/** Apparatus area on the bench (scene units). */
const AREA = { x0: -7.0, x1: 2.8, h: 6.6 };
const TUBES = { x: [4.1, 5.0, 5.9, 7.1], base: 0.35, h: 3.2, r: 0.3 };
const ENERGY_COLORS = { Ep: "#2f6fd6", Ec: "#f08a24", Q: "#d63a3a" } as const;
const FORCE_COLORS: Record<string, string> = { P: "#2c5fa6", N: "#5d6d7e", A: "#d0452c", F: "#e08a1e", S: "#139c8c" };
const FORCE_NAMES: Record<string, string> = { P: "P", N: "N", A: "Fₐ", F: "Fₑ", S: "S" };
const VEL_COLOR = "#7a3db8";
const STROBE = 14;
const CACHE = 40;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Every variable set the sliders can reach: corners and middles of the ranges (frames, scales). */
function reachable(entry: LabChapter, base: Vars): Vars[] {
  let out: Vars[] = [base];
  for (const p of entry.params ?? []) {
    const next: Vars[] = [];
    for (const v of out) for (const x of [p.min, (p.min + p.max) / 2, p.max]) next.push({ ...v, [p.var]: x });
    out = next;
  }
  return out;
}

/** Vessels never use the energy tubes: they may take the bench up to the board's stand. */
function fitOf(frame: Frame, wide = false): Fit {
  const x1 = wide ? 3.8 : AREA.x1;
  const w = Math.max(1e-6, frame.x1 - frame.x0);
  const h = Math.max(1e-6, frame.y1 - frame.y0);
  const s = Math.min((x1 - AREA.x0) / w, AREA.h / h);
  return { s, ox: (AREA.x0 + x1) / 2 - ((frame.x0 + frame.x1) / 2) * s };
}

const keyOf = (v: Vars) =>
  Object.keys(v)
    .sort()
    .map((k) => `${k}=${v[k]}`)
    .join(";");

interface Tube {
  liquids: THREE.Mesh[];
  value: Label;
}

interface View {
  entry: LabChapter;
  group: THREE.Group;
  base: Vars;
  frame: Frame;
  rig: Rig;
  cache: Map<string, Experiment>;
  laidOut: string;
  ex: Experiment;
  st: LabState | null;
  shows: Map<LabShowItem, { group: THREE.Object3D; windows: [number, number][] }>;
  tubes: Tube[];
  board: Panel | null;
  timer: Panel | null;
  velocity: Arrow | null;
  forces: Map<string, Arrow>;
  strobe: THREE.InstancedMesh | null;
  graph: { line: THREE.Line; samples: number } | null;
  /** Scales of arrows for the current experiment (newtons / m/s at full length). */
  Fref: number;
  vref: number;
}

export function createLabEngine(): Engine {
  let ctx: EngineContext | null = null;
  let spec: SceneSpec | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let views = new Map<string, View>();
  let labels: (Label | Panel)[] = [];
  let overrides: Record<string, number> | null = null;
  let last = { chapter: "", t: Number.NaN, key: "" };
  let bound = { center: new THREE.Vector3(), radius: 1 };
  const tmp = new THREE.Vector3();

  const label = (h: number, ink = "#28303c", pill = true) => {
    const l = new Label(ctx!, h, ink, pill);
    labels.push(l);
    return l;
  };

  // ------------------------------------------------------------ overlays

  function buildTubes(view: View, g: THREE.Group): void {
    const glass = new THREE.MeshStandardMaterial({ color: "#d8ecf5", transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false });
    g.add(mesh(new THREE.BoxGeometry(4.0, 0.3, 1.0).translate(5.45, 0.15, 0.5), mat("#b9925f")));
    const ids = ["Ep", "Ec", "Q", "E"] as const;
    ids.forEach((id, i) => {
      const x = TUBES.x[i]!;
      const r = id === "E" ? TUBES.r * 1.2 : TUBES.r;
      const tube = mesh(new THREE.CylinderGeometry(r, r, TUBES.h, 28, 1, true).translate(x, TUBES.base + TUBES.h / 2, 0.5), glass, `tube:${id}`);
      tube.renderOrder = 3;
      g.add(tube);
      const parts = id === "E" ? (["Ep", "Ec", "Q"] as const) : [id];
      const liquids = parts.map((p) => {
        const m = key(mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 1, 24).translate(0, 0.5, 0), mat(ENERGY_COLORS[p], { roughness: 0.3 }), `liquid:${id}:${p}`));
        m.position.set(x, TUBES.base, 0.5);
        g.add(m);
        return m;
      });
      const name = label(0.36, id === "E" ? "#28303c" : ENERGY_COLORS[id]);
      name.set(id === "Q" ? "Q calore" : id === "E" ? "totale" : id);
      name.object.position.set(x, TUBES.base - 0.05, 1.3);
      const value = label(0.42);
      value.object.position.set(x, TUBES.base + TUBES.h + 0.35, 0.5);
      g.add(name.object, value.object);
      view.tubes.push({ liquids, value });
    });
  }

  function buildRuler(spec: RulerSpec, s: number, g: THREE.Group): void {
    const len = spec.metres * s;
    const ruler = new THREE.Group();
    const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), spec.dir);
    const strip = mesh(new THREE.BoxGeometry(len, 0.22, 0.03).translate(len / 2, 0, 0), mat("#f3e7b5"), "ruler");
    strip.quaternion.copy(q);
    strip.position.copy(spec.from).addScaledVector(spec.side, 0.11);
    ruler.add(strip);
    const step = tickStep(spec.metres);
    const ink = mat("#222222");
    for (let k = 0; k * step <= spec.metres + 1e-9; k++) {
      const major = k % 5 === 0 || step >= spec.metres / 6;
      const tick = mesh(new THREE.BoxGeometry(0.025, major ? 0.16 : 0.08, 0.04), ink);
      tick.quaternion.copy(q);
      tick.position.copy(spec.from).addScaledVector(spec.dir, k * step * s).addScaledVector(spec.side, major ? 0.08 : 0.04);
      ruler.add(tick);
      if (major) {
        const l = label(0.22, "#222222", false);
        l.set(`${num(k * step, step < 0.1 ? 2 : step < 1 ? 1 : 0)} m`);
        l.object.position.copy(tick.position).addScaledVector(spec.side, 0.36);
        ruler.add(l.object);
      }
    }
    g.add(ruler);
  }

  function buildView(entry: LabChapter): View {
    const group = new THREE.Group();
    group.name = `lab:${entry.chapter}`;
    world!.add(group);
    const base = varsOf(entry.setup);
    const frame = frameOf(entry.setup.kind, reachable(entry, base));
    const fit = fitOf(frame, entry.setup.kind === "vessels");
    const ex = new Experiment(entry.setup, base, frame);
    const color = entry.color ?? BODY_COLORS[entry.setup.kind] ?? "#d9483b";
    const rig = RIGS[entry.setup.kind]!(fit, frame, ex, color);
    group.add(rig.group);
    const view: View = {
      entry, group, base, frame, rig, cache: new Map([[keyOf(base), ex]]), laidOut: "", ex, st: null, shows: new Map(),
      tubes: [], board: null, timer: null, velocity: null, forces: new Map(), strobe: null, graph: null, Fref: 1, vref: 1,
    };
    const windows = (item: LabShowItem) =>
      (entry.show ?? []).filter((s) => s.item === item).map((s) => [s.at ?? 0, s.until ?? Infinity] as [number, number]);
    const add = (item: LabShowItem, build: (g: THREE.Group) => void) => {
      const w = windows(item);
      if (w.length === 0) return;
      const g = new THREE.Group();
      g.name = `show:${item}`;
      build(g);
      group.add(g);
      view.shows.set(item, { group: g, windows: w });
    };
    add("energy", (g) => buildTubes(view, g));
    add("board", (g) => {
      const p = new Panel(ctx!, 4.6, 1.75, "#fbfaf4", "#1f2a36");
      labels.push(p);
      p.mesh.position.set(5.6, 5.9, -1.3);
      p.mesh.name = "board";
      g.add(mesh(new THREE.BoxGeometry(4.8, 1.95, 0.08).translate(5.6, 5.9, -1.36), mat("#5b4a3a")));
      g.add(mesh(new THREE.BoxGeometry(0.1, 5.0, 0.1).translate(5.6, 2.5, -1.42), mat("#5b4a3a")));
      g.add(p.mesh);
      view.board = p;
    });
    add("timer", (g) => {
      const p = new Panel(ctx!, 1.6, 0.62, "#1d2228", "#8dffa8", 240);
      labels.push(p);
      p.mesh.position.set(2.2, 0.45, 2.111);
      p.mesh.name = "timer";
      g.add(key(mesh(new THREE.BoxGeometry(1.8, 0.82, 0.5).translate(2.2, 0.41, 1.85), mat("#3b4552"))), key(p.mesh));
      view.timer = p;
    });
    if (rig.ruler) add("ruler", (g) => buildRuler(rig.ruler!, fit.s, g));
    add("velocity", (g) => {
      view.velocity = new Arrow(VEL_COLOR, 0.06);
      const l = label(0.3, VEL_COLOR);
      l.set("v");
      view.velocity.label = l;
      view.velocity.group.add(l.object);
      g.add(view.velocity.group);
    });
    add("forces", (g) => {
      for (const id of ["P0", "P1", "N0", "A0", "F0", "S0"]) {
        const a = new Arrow(FORCE_COLORS[id[0]!]!, 0.055);
        const l = label(0.3, FORCE_COLORS[id[0]!]!);
        l.set(FORCE_NAMES[id[0]!]!);
        a.label = l;
        a.group.add(l.object);
        g.add(a.group);
        view.forces.set(id, a);
      }
    });
    add("strobe", (g) => {
      const m = key(new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }), STROBE));
      m.frustumCulled = false;
      g.add(m);
      view.strobe = m;
    });
    for (const item of ["level", "pressure"] as const) add(item, (g) => rig.overlay?.(item, g, (h, ink, pill) => label(h, ink, pill)));
    add("graph", (g) => {
      const ink = mat("#28303c");
      g.add(mesh(new THREE.BoxGeometry(4.2, 0.04, 0.04).translate(5.8, 0.6, 0), ink), mesh(new THREE.BoxGeometry(0.04, 3.7, 0.04).translate(3.7, 2.45, 0), ink));
      for (const [T, name] of [[0, "0 °C"], [100, "100 °C"]] as const) {
        const y = 0.6 + ((T + 30) / 140) * 3.6;
        g.add(mesh(new THREE.BoxGeometry(4.2, 0.015, 0.02).translate(5.8, y, -0.02), mat("#9aa4ae")));
        const l = label(0.24, "#28303c", false);
        l.set(name);
        l.object.position.set(3.15, y, 0);
        g.add(l.object);
      }
      for (const [text, x, y] of [["T (°C)", 3.7, 4.55], [engineText("lab.time"), 7.6, 0.3]] as const) {
        const l = label(0.26, "#28303c", false);
        l.set(text);
        l.object.position.set(x, y, 0);
        g.add(l.object);
      }
      const line = key(new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#d63a3a", linewidth: 2 })));
      line.name = "graph";
      g.add(line);
      view.graph = { line, samples: 0 };
    });
    return view;
  }

  // ------------------------------------------------------------ state

  function varsFor(view: View): Vars {
    const v = { ...view.base };
    if (overrides) for (const p of view.entry.params ?? []) if (overrides[p.id] !== undefined) v[p.var] = overrides[p.id]!;
    return v;
  }

  function experiment(view: View, v: Vars): Experiment {
    const k = keyOf(v);
    let ex = view.cache.get(k);
    if (!ex) {
      ex = new Experiment(view.entry.setup, v, view.frame);
      view.cache.set(k, ex);
      if (view.cache.size > CACHE) view.cache.delete(view.cache.keys().next().value!);
    }
    return ex;
  }

  /** Run in progress at chapter time t: physical time and speed (tau -1 = waiting for the first run). */
  function runAt(entry: LabChapter, t: number): { tau: number; speed: number } {
    let run: { at: number; speed?: number } | null = null;
    for (const r of entry.runs) if (r.at <= t) run = r;
    if (!run) return { tau: -1, speed: entry.runs[0]?.speed ?? 1 };
    const speed = run.speed ?? 1;
    return { tau: (t - run.at) * speed, speed };
  }

  /** Arrow scales for a new experiment: largest force and speed over its first seconds. */
  function scales(view: View, ex: Experiment): void {
    let F = 1e-9;
    let vmax = 1e-9;
    for (let k = 0; k <= 60; k++) {
      const st = ex.state(k * 0.1);
      for (const f of st.forces) F = Math.max(F, f.n);
      for (const b of st.bodies) vmax = Math.max(vmax, Math.hypot(b.vx, b.vy));
    }
    const m = ex.v.mass ?? 1;
    if (ex.kind === "fall" || ex.kind === "projectile" || ex.kind === "pendulum" || ex.kind === "spring" || ex.kind === "ramp")
      vmax = Math.max(vmax, Math.sqrt((2 * ex.state(0).energy.E) / m));
    view.Fref = F;
    view.vref = vmax;
  }

  function layout(view: View, ex: Experiment): void {
    const k = keyOf(ex.v);
    if (view.laidOut === k) return;
    view.laidOut = k;
    view.ex = ex;
    view.rig.layout(ex);
    scales(view, ex);
    if (view.graph) {
      const st0 = ex.state(0);
      const total = st0.kind === "heat" ? st0.total : 1;
      const n = 160;
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const s = ex.state((total * i) / n);
        const T = s.kind === "heat" ? s.T : 0;
        return V(3.7 + (4.1 * i) / n, 0.6 + ((T + 30) / 140) * 3.6, 0.03);
      });
      view.graph.line.geometry.dispose();
      view.graph.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      view.graph.samples = n + 1;
    }
  }

  const visibleAt = (w: [number, number][], t: number) => w.some(([a, b]) => t >= a && t < b);

  function pose(view: View, t: number): void {
    const v = varsFor(view);
    const ex = experiment(view, v);
    layout(view, ex);
    const { tau, speed } = runAt(view.entry, t);
    const st = ex.state(tau);
    view.st = st;
    view.rig.pose(st, t);
    for (const [, s] of view.shows) {
      const start = s.windows.find(([a, b]) => t >= a && t < b)?.[0];
      s.group.visible = start !== undefined;
      s.group.scale.setScalar(start === undefined ? 1 : 0.9 + 0.1 * ease.inOutQuad(seg(t, start, start + 0.5)));
    }
    // Energy tubes: each tube is full at the total E; the last one stacks the three.
    if (view.tubes.length) {
      const E = st.energy.E;
      const parts = [st.energy.Ep, st.energy.Ec, st.energy.Q];
      const frac = (x: number) => (E > 0 ? clamp(x / E) : 0);
      view.tubes.forEach((tube, i) => {
        if (i < 3) {
          tube.liquids[0]!.scale.y = Math.max(1e-3, frac(parts[i]!) * TUBES.h);
          tube.liquids[0]!.visible = frac(parts[i]!) > 0.002;
          tube.value.set(`${num(parts[i]!, parts[i]! >= 100 ? 0 : 1)} J`);
        } else {
          let y = TUBES.base;
          tube.liquids.forEach((m, k) => {
            const h = Math.max(1e-3, frac(parts[k]!) * TUBES.h);
            m.position.y = y;
            m.scale.y = h;
            m.visible = frac(parts[k]!) > 0.002;
            y += h;
          });
          tube.value.set(`${num(E, E >= 100 ? 0 : 1)} J`);
        }
      });
    }
    view.board?.set(boardLines(ex, st, view.shows.has("energy")));
    if (view.timer) {
      const tt = Math.max(0, st.tau);
      const time = tt >= 120 ? `${Math.floor(tt / 60)} min ${num(tt % 60, 0)} s` : `${num(tt, 2)} s`;
      const how = speed < 1 ? engineText("lab.slowed", { x: num(1 / speed, 0) }) : speed > 1 ? engineText("lab.faster", { x: num(speed, 0) }) : engineText("lab.realTime");
      view.timer.set([`t = ${time}`, how]);
    }
    if (view.velocity) {
      const b = st.bodies[0];
      const ok = b && view.rig.body(0, tmp);
      const speedNow = b ? Math.hypot(b.vx, b.vy) : 0;
      if (ok && b) view.velocity.set(tmp.clone(), V(b.vx, b.vy, 0), speedNow > 1e-6 ? 0.3 + (2.0 * speedNow) / view.vref : 0);
      else view.velocity.set(tmp, V(), 0);
    }
    if (view.forces.size) {
      for (const a of view.forces.values()) a.group.visible = false;
      for (const f of st.forces) {
        const a = view.forces.get(`${f.id}${f.id === "P" ? (f.at ?? 0) : 0}`);
        if (!a || !view.rig.body(f.at ?? 0, tmp)) continue;
        // Opposite forces on one body (weight and normal/push) would overlap: weight a little left, the others right.
        const side = ex.kind === "lever" || st.forces.length < 2 ? 0 : f.id === "P" ? -0.14 : 0.14;
        a.set(tmp.clone().add(V(side, 0, 0.32)), V(f.dx, f.dy, 0), 0.15 + (1.8 * f.n) / view.Fref);
      }
    }
    if (view.strobe) {
      const dt = strobeStep(ex);
      const m = view.strobe;
      const mtx = new THREE.Matrix4();
      let n = 0;
      if (dt > 0 && st.running)
        for (let k = 1; k < STROBE && k * dt <= st.tau; k++) {
          view.rig.pose(ex.state(k * dt), t);
          if (!view.rig.body(0, tmp)) break;
          mtx.makeTranslation(tmp.x, tmp.y, tmp.z - 0.05);
          m.setMatrixAt(n++, mtx);
        }
      if (n > 0) view.rig.pose(st, t);
      // Unused slots are cleared too, so the frame never keeps ghosts from another time.
      mtx.makeScale(0, 0, 0);
      for (let k = n; k < STROBE; k++) m.setMatrixAt(k, mtx);
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    if (view.graph) {
      const total = st.kind === "heat" ? st.total : 1;
      const p = st.running ? clamp(st.tau / total) : 0;
      view.graph.line.geometry.setDrawRange(0, Math.max(0, Math.round(p * (view.graph.samples - 1)) + 1));
    }
  }

  function strobeStep(ex: Experiment): number {
    const s0 = ex.state(0);
    if (s0.kind === "fall") return s0.T / 6;
    if (s0.kind === "projectile") return s0.T / 8;
    if (s0.kind === "ramp") return s0.a > 0 ? Math.sqrt((2 * s0.track.segs[0]!.len) / s0.a) / 6 : 0;
    return 0;
  }

  function apply(chapterId: string, t: number): View | undefined {
    const view = views.get(chapterId);
    for (const [id, w] of views) w.group.visible = id === chapterId;
    if (!view) return undefined;
    last = { chapter: chapterId, t, key: keyOf(varsFor(view)) };
    pose(view, t);
    return view;
  }

  return {
    async build(c, s) {
      if (s.engine !== "lab") throw new Error(`lab engine got a "${s.engine}" scene`);
      ctx = c;
      spec = s;
      const data: LabData = s.engineData;
      world = new THREE.Group();
      world.name = "lab";
      c.root.add(world);
      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(data.background ?? PAPER);
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
      keyLight.position.set(6, 12, 12);
      const rim = new THREE.DirectionalLight(0xffe8d0, 0.35 * Math.PI);
      rim.position.set(-10, 5, -8);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.75 * Math.PI), keyLight, rim];
      for (const l of lights) c.scene.add(l);
      // The lab bench: a wooden top with a darker front edge.
      const bench = new THREE.Group();
      bench.name = "bench";
      bench.add(mesh(new THREE.BoxGeometry(16.8, 0.36, 5.4).translate(0.2, -0.18, 0), mat("#d8c3a0")));
      bench.add(mesh(new THREE.BoxGeometry(16.8, 0.08, 0.1).translate(0.2, -0.04, 2.72), mat("#a88a63")));
      world.add(bench);
      views = new Map(data.chapters.map((e) => [e.chapter, buildView(e)]));
      for (const v of views.values()) pose(v, 0);
      world.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(world);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      bound = { center: sphere.center, radius: Math.max(1, sphere.radius) };
    },

    update(chapterId, t) {
      apply(chapterId, t);
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor)) return false;
      const view = views.get(chapterId);
      if (!view) return false;
      if (last.chapter !== chapterId || last.t !== t || last.key !== keyOf(varsFor(view))) apply(chapterId, t);
      let ok = false;
      if (anchor.entity === "body") ok = view.rig.body(anchor.index ?? 0, out);
      else if (anchor.entity === "part") ok = !!anchor.part && view.rig.part(anchor.part, anchor.index ?? 0, out);
      else if (anchor.entity === "gauge") {
        const st = view.st;
        const E = st?.energy.E ?? 0;
        const level = (x: number) => TUBES.base + (E > 0 ? clamp(x / E) : 0) * TUBES.h;
        ok = true;
        if (anchor.part === "energy") out.set((TUBES.x[0]! + TUBES.x[3]!) / 2, TUBES.base + TUBES.h + 0.4, 0.5);
        else if (anchor.part === "Ep") out.set(TUBES.x[0]!, level(st?.energy.Ep ?? 0), 0.5);
        else if (anchor.part === "Ec") out.set(TUBES.x[1]!, level(st?.energy.Ec ?? 0), 0.5);
        else if (anchor.part === "Q") out.set(TUBES.x[2]!, level(st?.energy.Q ?? 0), 0.5);
        else if (anchor.part === "board") out.set(5.6, 6.8, -1.3);
        else if (anchor.part === "timer") out.set(2.2, 0.8, 2.0);
        else ok = false;
      }
      if (ok && anchor.offset) out.add(tmp.set(...anchor.offset));
      return ok;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    params(chapterId): EngineParam[] {
      const view = views.get(chapterId);
      const ids = spec?.chapters.find((c) => c.id === chapterId)?.activity?.test.params ?? [];
      if (!view) return [];
      return ids.flatMap((id) => {
        const p = view.entry.params?.find((q) => q.id === id);
        if (!p) return [];
        const value = overrides?.[id] ?? view.base[p.var] ?? p.min;
        return [{ id, label: p.label, min: p.min, max: p.max, step: p.step ?? (p.max - p.min) / 100, value }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      const defs = new Map([...views.values()].flatMap((v) => (v.entry.params ?? []).map((p) => [p.id, p] as const)));
      overrides = {};
      for (const [id, x] of Object.entries(values)) {
        const p = defs.get(id);
        if (p && Number.isFinite(x)) overrides[id] = clamp(x, p.min, p.max);
      }
    },

    dispose() {
      if (!ctx || !world) return;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
      });
      for (const v of views.values()) v.rig.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const l of labels) l.dispose();
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      spec = null;
      world = null;
      lights = [];
      labels = [];
      views = new Map();
      overrides = null;
    },
  };
}
