// Graphs of the concept engine: Cartesian whiteboards (2D) and 3D boxes with plots, notable
// points, lines, regions, intervals, tracers and surfaces. Data model: ConceptGraph in
// packages/scene-spec/src/engines/concept.ts; maths in packages/scene-spec/src/math.
// update() is a pure function of (chapter plans, t, parameter overrides): geometry that depends
// on parameters is rebuilt in place only when the parameter values change.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  compileGraph,
  derivative,
  fillLabel,
  initialParams,
  paramNum,
  parity,
  lineForm,
  lineLabel,
  livePoint,
  plotLabel,
  plotName,
  plotRange,
  pointLabel,
  pointSlot,
  sampleCurve,
  surfaceLabel,
  tracerReadout,
  formatNum,
  type CompiledGraph,
  type ConceptData,
  type ConceptGraph,
  type GraphInterval,
  type GraphLine,
  type GraphPlot,
  type GraphPoint,
  type GraphRegion,
  type GraphSurface,
  type GraphTracer,
  type PointSlot,
} from "@pv/scene-spec";
import type { EngineContext } from "../../types.ts";
import { clamp } from "../../util/math.ts";
import {
  DynGeo,
  GRAPH_COLORS as C,
  haloTexture,
  heightColor,
  LiveLabel,
  textSprite,
  windowRange,
  writeTube,
  type TubeSegments,
} from "./graph-meshes.ts";
import { evalMirror, evalScalar, evalWindow, makeFrame, PANEL_PAD, type Frame, type GraphChapterPlan } from "./graph-plan.ts";
import { labelSprite, standard } from "./meshes.ts";
import { activeKey, evalGrow, evalPresence, windowEnv, type ChapterPlan, type V3 } from "./plan.ts";

const TINY = 1e-4;
const CURVE_SAMPLES = 360;
const CURVE_CAP = 900;
const Z_GRID = -0.13;
const Z_AXIS = -0.1;
const Z_REGION = -0.06;
const Z_FRONT = 0.14;

type Values = Record<string, number>;

interface PlotObj {
  def: GraphPlot;
  frame: Frame;
  cg: CompiledGraph;
  index: number;
  mat: THREE.MeshStandardMaterial;
  dg: DynGeo;
  mesh: THREE.Mesh;
  segs: TubeSegments;
  ribbon: { dg: DynGeo; mesh: THREE.Mesh; segs: TubeSegments } | null;
  tip: THREE.Mesh;
  label: LiveLabel;
  labelPos: THREE.Vector3;
  ghosts: Map<"y-axis" | "origin", { dg: DynGeo; mesh: THREE.Mesh; pivot: THREE.Group; label: LiveLabel | null; labelAt: THREE.Vector3 }>;
  f: (x: number) => number;
}
interface PointObj {
  def: GraphPoint;
  frame: Frame;
  plot: PlotObj;
  slot: PointSlot;
  group: THREE.Group;
  bead: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  halo: THREE.Sprite | null;
  label: LiveLabel;
  cur: { x: number; y: number } | null;
}
interface LineObj {
  def: GraphLine;
  frame: Frame;
  dg: DynGeo;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  segs: TubeSegments;
  label: LiveLabel;
  /** Null when the line is outside the frame with the current parameters. */
  labelPos: THREE.Vector3 | null;
}
interface RegionObj {
  def: GraphRegion;
  frame: Frame;
  plot: PlotObj;
  other: PlotObj | null;
  group: THREE.Group;
  pos: DynGeo;
  neg: DynGeo;
  mats: THREE.MeshBasicMaterial[];
  signs: { sprite: THREE.Sprite; positive: boolean }[];
  label: LiveLabel | null;
  labelPos: THREE.Vector3;
  y0: number;
}
interface IntervalObj {
  def: GraphInterval;
  frame: Frame;
  group: THREE.Group;
  band: THREE.Mesh;
  length: number;
  start: THREE.Object3D;
  end: THREE.Object3D;
  label: LiveLabel | null;
  labelPos: THREE.Vector3;
  mats: THREE.MeshStandardMaterial[];
  /** False when the ends are not a valid interval with the current parameters. */
  ok: boolean;
}
interface TracerObj {
  def: GraphTracer;
  frame: Frame;
  plot: PlotObj;
  group: THREE.Group;
  bead: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  tangent: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  readout: LiveLabel;
  pos: THREE.Vector3;
}
interface SurfaceObj {
  def: GraphSurface;
  frame: Frame;
  cg: CompiledGraph;
  group: THREE.Group;
  dg: DynGeo;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  wire: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
  label: LiveLabel;
  y0: number;
  top: THREE.Vector3;
}
interface GraphObj {
  def: ConceptGraph;
  frame: Frame;
  cg: CompiledGraph;
  group: THREE.Group;
  key: string;
}

export interface GraphRuntime {
  update(cp: ChapterPlan, gp: GraphChapterPlan, t: number, overrides: Readonly<Values> | null): void;
  /** Anchor of a graph entity in board coordinates, from the last update. */
  resolve(entity: string, part: string, index: number | undefined, out: THREE.Vector3): boolean;
  box: THREE.Box3;
}

const v3 = (p: V3, dz = 0) => new THREE.Vector3(p[0], p[1], p[2] + dz);

/** Pill caption drawn after the translucent regions. */
function pill(ctx: EngineContext, text: string, height: number, ink: string): THREE.Sprite | null {
  const s = labelSprite(ctx, text, height, ink);
  if (s) s.renderOrder = 6;
  return s;
}

/** Flat rectangles (grid lines) merged into one geometry, facing +z. */
function rectsGeometry(rects: [number, number, number, number][], z: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [x0, y0, x1, y1] of rects) {
    const b = pos.length / 3;
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Arrow (cylinder + cone) from a to b, in a group's local coordinates. */
function arrow(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, head = true): THREE.Group {
  const g = new THREE.Group();
  const dir = b.clone().sub(a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const hl = head ? Math.min(0.42, len * 0.3) : 0;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len - hl, 10).translate(0, (len - hl) / 2, 0), mat);
  shaft.position.copy(a);
  shaft.quaternion.copy(q);
  g.add(shaft);
  if (head) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 3.4, hl, 16).translate(0, hl / 2, 0), mat);
    cone.position.copy(a).addScaledVector(dir.normalize(), len - hl);
    cone.quaternion.copy(q);
    g.add(cone);
  }
  return g;
}

/** Tick values of an axis range, skipping 0 (the origin gets "O"). */
function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.round((max - min) / step);
  const every = n > 14 ? 2 : 1;
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + 1e-9; k++) {
    const v = Math.round(k * step * 1e9) / 1e9;
    if (Math.abs(v) > 1e-9 && k % every === 0) out.push(v);
  }
  return out;
}

function buildFrame(ctx: EngineContext, g: ConceptGraph, fr: Frame): THREE.Group {
  const group = new THREE.Group();
  group.name = `graph:${g.id}`;
  group.position.set(...g.pos);
  const P = new THREE.Vector3(...g.pos);
  const loc = (p: V3, dz = 0) => v3(p, dz).sub(P);
  const ink = standard(C.axis);
  ink.roughness = 0.4;
  const grid = new THREE.MeshBasicMaterial({ color: C.gridMinor });
  const v0 = clamp(0, fr.v[0], fr.v[1]);
  const u0 = clamp(0, fr.x[0], fr.x[1]);
  const lab = (text: string, at: THREE.Vector3, h = 0.36, ink2: string = C.axis) => {
    const s = textSprite(ctx, text, h, ink2);
    if (s) {
      s.position.copy(at);
      group.add(s);
    }
  };
  if (!fr.is3d) {
    const w = (fr.x[1] - fr.x[0]) * fr.sx;
    const h = (fr.v[1] - fr.v[0]) * fr.sv;
    const W = w + 2 * PANEL_PAD;
    const H = h + 2 * PANEL_PAD;
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(W, H, 0.12, 3, 0.1),
      new THREE.MeshStandardMaterial({ color: C.panel, roughness: 0.25, metalness: 0, emissive: "#ffffff", emissiveIntensity: 0.22 }),
    );
    panel.position.set(0, H / 2, -0.2);
    const rim = new THREE.Mesh(new RoundedBoxGeometry(W + 0.18, H + 0.18, 0.08, 3, 0.12), standard(C.rim));
    rim.position.set(0, H / 2, -0.28);
    const stand = new THREE.Mesh(new RoundedBoxGeometry(W + 0.5, 0.2, 0.9, 3, 0.08), standard(C.rim));
    stand.position.set(0, 0.1, -0.25);
    group.add(rim, panel, stand);
    if (g.grid ?? true) {
      const rects: [number, number, number, number][] = [];
      const lw = 0.022;
      const xs: number[] = [];
      for (let k = Math.ceil(fr.x[0] / fr.xStep - 1e-9); k * fr.xStep <= fr.x[1] + 1e-9; k++) xs.push(k * fr.xStep);
      const vs: number[] = [];
      for (let k = Math.ceil(fr.v[0] / fr.vStep - 1e-9); k * fr.vStep <= fr.v[1] + 1e-9; k++) vs.push(k * fr.vStep);
      const lb = loc(fr.plane(fr.x[0], fr.v[0]));
      const rt = loc(fr.plane(fr.x[1], fr.v[1]));
      for (const x of xs) {
        const X = loc(fr.plane(x, 0)).x;
        rects.push([X - lw, lb.y, X + lw, rt.y]);
      }
      for (const v of vs) {
        const Y = loc(fr.plane(0, v)).y;
        rects.push([lb.x, Y - lw, rt.x, Y + lw]);
      }
      group.add(new THREE.Mesh(rectsGeometry(rects, Z_GRID), grid));
    }
    // Axes through the origin (or along the frame edge when 0 is outside the range).
    const ext = 0.45;
    const xa = loc(fr.plane(fr.x[0], v0), Z_AXIS).setX(loc(fr.plane(fr.x[0], v0)).x - 0.2);
    const xb = loc(fr.plane(fr.x[1], v0), Z_AXIS).setX(loc(fr.plane(fr.x[1], v0)).x + ext);
    const ya = loc(fr.plane(u0, fr.v[0]), Z_AXIS).setY(loc(fr.plane(u0, fr.v[0])).y - 0.2);
    const yb = loc(fr.plane(u0, fr.v[1]), Z_AXIS).setY(loc(fr.plane(u0, fr.v[1])).y + ext);
    group.add(arrow(xa, xb, 0.032, ink), arrow(ya, yb, 0.032, ink));
    for (const x of ticks(fr.x[0], fr.x[1], fr.xStep)) lab(formatNum(x), loc(fr.plane(x, v0), 0.02).add(new THREE.Vector3(0, -0.3, 0)));
    for (const v of ticks(fr.v[0], fr.v[1], fr.vStep)) lab(formatNum(v), loc(fr.plane(u0, v), 0.02).add(new THREE.Vector3(-0.32, 0, 0)));
    if (u0 === 0 && v0 === 0) lab("O", loc(fr.plane(0, 0), 0.02).add(new THREE.Vector3(-0.3, -0.3, 0)), 0.34);
    lab(g.x.label ?? "x", xb.clone().add(new THREE.Vector3(0.05, -0.38, 0.02)), 0.5);
    lab(g.y.label ?? "y", yb.clone().add(new THREE.Vector3(0.38, -0.05, 0.02)), 0.5);
    return group;
  }
  // 3D: a floor with a grid at value v0, three axes through the origin.
  const d = fr.d!;
  const y00 = clamp(0, d[0], d[1]);
  const c00 = loc(fr.space(fr.x[0], d[0], v0));
  const c11 = loc(fr.space(fr.x[1], d[1], v0));
  const fw = Math.abs(c11.x - c00.x);
  const fd = Math.abs(c11.z - c00.z);
  const floor = new THREE.Mesh(
    new RoundedBoxGeometry(fw + 0.8, 0.08, fd + 0.8, 3, 0.04),
    new THREE.MeshStandardMaterial({ color: C.panel, roughness: 0.3, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  floor.renderOrder = -1;
  floor.position.set((c00.x + c11.x) / 2, c00.y - 0.06, (c00.z + c11.z) / 2);
  const base = new THREE.Mesh(new RoundedBoxGeometry(fw + 1.0, 0.06, fd + 1.0, 3, 0.03), standard(C.rim));
  base.position.copy(floor.position).setY(c00.y - 0.12);
  group.add(base, floor);
  if (g.grid ?? true) {
    const rects: [number, number, number, number][] = [];
    const lw = 0.02;
    for (let k = Math.ceil(fr.x[0] / fr.xStep - 1e-9); k * fr.xStep <= fr.x[1] + 1e-9; k++) {
      const X = loc(fr.space(k * fr.xStep, 0, v0)).x;
      rects.push([X - lw, -c00.z, X + lw, -c11.z]);
    }
    for (let k = Math.ceil(d[0] / fr.dStep - 1e-9); k * fr.dStep <= d[1] + 1e-9; k++) {
      const Z = loc(fr.space(0, k * fr.dStep, v0)).z;
      rects.push([c00.x, -Z - lw, c11.x, -Z + lw]);
    }
    // rotateX(−90°) maps (x, y, 0) -> (x, 0, −y) facing up: rects were given as [x, −z] pairs.
    const geo = rectsGeometry(rects, 0).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, grid);
    m.position.y = c00.y + 0.002;
    group.add(m);
  }
  const o = loc(fr.space(u0, y00, v0), 0);
  const ax = (to: THREE.Vector3) => arrow(o.clone(), to, 0.032, ink);
  const xEnd = loc(fr.space(fr.x[1], y00, v0)).add(new THREE.Vector3(0.5, 0, 0));
  const yEnd = loc(fr.space(u0, d[1], v0)).add(new THREE.Vector3(0, 0, -0.5));
  const zEnd = loc(fr.space(u0, y00, fr.v[1])).add(new THREE.Vector3(0, 0.5, 0));
  group.add(ax(xEnd), ax(yEnd), ax(zEnd));
  group.add(arrow(loc(fr.space(fr.x[0], y00, v0)), o.clone(), 0.032, ink, false));
  group.add(arrow(loc(fr.space(u0, d[0], v0)), o.clone(), 0.032, ink, false));
  for (const x of ticks(fr.x[0], fr.x[1], fr.xStep)) lab(formatNum(x), loc(fr.space(x, y00, v0)).add(new THREE.Vector3(0, 0.05, 0.4)), 0.32);
  for (const y of ticks(d[0], d[1], fr.dStep)) lab(formatNum(y), loc(fr.space(u0, y, v0)).add(new THREE.Vector3(0.4, 0.05, 0)), 0.32);
  for (const z of ticks(fr.v[0], fr.v[1], fr.vStep)) lab(formatNum(z), loc(fr.space(u0, y00, z)).add(new THREE.Vector3(-0.35, 0, 0)), 0.32);
  lab(g.x.label ?? "x", xEnd.clone().add(new THREE.Vector3(0.35, 0.1, 0)), 0.5);
  lab(g.y.label ?? "y", yEnd.clone().add(new THREE.Vector3(0, 0.1, -0.35)), 0.5);
  lab(g.z?.label ?? "z", zEnd.clone().add(new THREE.Vector3(0, 0.35, 0)), 0.5);
  return group;
}

/** Visible part of a line inside the frame rectangle, as maths (u, v) end points. */
function clipLine(l: GraphLine, fr: Frame, values: Values): [[number, number], [number, number]] | null {
  const f = lineForm(l, values);
  if (!Object.values(f).every(Number.isFinite)) return null;
  const [x0, x1] = fr.x;
  const [v0, v1] = fr.v;
  if ("x" in f) return f.x >= x0 && f.x <= x1 ? [[f.x, v0], [f.x, v1]] : null;
  if ("y" in f) return f.y >= v0 && f.y <= v1 ? [[x0, f.y], [x1, f.y]] : null;
  let a = x0;
  let b = x1;
  if (f.m !== 0) {
    const ua = (v0 - f.q) / f.m;
    const ub = (v1 - f.q) / f.m;
    a = Math.max(a, Math.min(ua, ub));
    b = Math.min(b, Math.max(ua, ub));
  } else if (f.q < v0 || f.q > v1) return null;
  return a < b ? [[a, f.m * a + f.q], [b, f.m * b + f.q]] : null;
}

export function buildGraphs(ctx: EngineContext, world: THREE.Group, data: ConceptData, roleColor: (r?: string) => string | null): GraphRuntime {
  const graphs: GraphObj[] = [];
  const plots = new Map<string, PlotObj>();
  const points = new Map<string, PointObj>();
  const lines = new Map<string, LineObj>();
  const regions = new Map<string, RegionObj>();
  const intervals = new Map<string, IntervalObj>();
  const tracers = new Map<string, TracerObj>();
  const surfaces = new Map<string, SurfaceObj>();
  const box = new THREE.Box3();
  const halo = data.graphs?.length ? haloTexture(ctx) : null;
  const mirrored = new Map<string, Set<"y-axis" | "origin">>();
  for (const c of data.chapters)
    for (const a of c.actions) if (a.do === "mirror") mirrored.set(a.id, (mirrored.get(a.id) ?? new Set()).add(a.about));

  const beadMesh = (r: number, color: string) => {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.3 });
    return new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
  };
  const haloSprite = (color: string, size: number) => {
    if (!halo) return null;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color, transparent: true, depthWrite: false, opacity: 0.55 }));
    s.scale.setScalar(size);
    return s;
  };

  for (const g of data.graphs ?? []) {
    const frame = makeFrame(g);
    const cg = compileGraph(g);
    const group = buildFrame(ctx, g, frame);
    world.add(group);
    graphs.push({ def: g, frame, cg, group, key: "" });
    box.expandByPoint(v3(frame.box[0])).expandByPoint(v3(frame.box[1]));

    (g.plots ?? []).forEach((p, i) => {
      const color = roleColor(p.role) ?? C.plots[i % C.plots.length]!;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.05, transparent: true });
      const dg = new DynGeo(CURVE_CAP * 10, CURVE_CAP * 60);
      const mesh = new THREE.Mesh(dg.geometry, mat);
      mesh.name = `plot:${p.id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      world.add(mesh);
      let ribbon: PlotObj["ribbon"] = null;
      if (p.extrude) {
        const rdg = new DynGeo(CURVE_CAP * 2, CURVE_CAP * 6);
        const rm = new THREE.Mesh(
          rdg.geometry,
          new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, roughness: 0.5 }),
        );
        rm.frustumCulled = false;
        rm.renderOrder = 1;
        world.add(rm);
        ribbon = { dg: rdg, mesh: rm, segs: { u0: [], u1: [], idx: [], stride: 6 } };
      }
      const tip = beadMesh(0.13, color);
      world.add(tip);
      const label = new LiveLabel(ctx, 0.62, 1, color, 18);
      if (label.sprite) world.add(label.sprite);
      // Formula labels stand above the frame like a heading, one row per plot.
      const v = frame.plane((frame.x[0] + frame.x[1]) / 2, frame.v[1]);
      const labelPos = new THREE.Vector3(v[0], v[1] + (frame.is3d ? 1.2 : PANEL_PAD + 0.5) + i * 0.8, v[2] + 0.1);
      const ghosts: PlotObj["ghosts"] = new Map();
      for (const about of mirrored.get(p.id) ?? []) {
        const gdg = new DynGeo(CURVE_CAP * 10, CURVE_CAP * 60);
        const gm = new THREE.Mesh(gdg.geometry, new THREE.MeshStandardMaterial({ color: C.ghost, transparent: true, opacity: 0.7, roughness: 0.4 }));
        gm.frustumCulled = false;
        gm.name = `ghost:${p.id}:${about}`;
        const pivot = new THREE.Group();
        pivot.position.copy(v3(frame.plane(0, 0)));
        gm.position.copy(pivot.position).negate();
        pivot.add(gm);
        world.add(pivot);
        // The verdict of the test is computed live: "f(−x) ≠ f(x)" or "f(−x) = f(x): pari".
        const gl = frame.is3d ? null : new LiveLabel(ctx, 0.5, 1, C.symmetry, 14);
        if (gl?.sprite) world.add(gl.sprite);
        ghosts.set(about, { dg: gdg, mesh: gm, pivot, label: gl, labelAt: new THREE.Vector3() });
      }
      plots.set(p.id, {
        def: p,
        frame,
        cg,
        index: i,
        mat,
        dg,
        mesh,
        segs: { u0: [], u1: [], idx: [], stride: 60 },
        ribbon,
        tip,
        label,
        labelPos,
        ghosts,
        f: cg.plot(p.id),
      });
    });

    for (const pd of g.points ?? []) {
      const plot = plots.get(pd.plot)!;
      const color = roleColor(pd.role) ?? C.point[pd.kind];
      const group = new THREE.Group();
      group.name = `point:${pd.id}`;
      const bead = beadMesh(0.17, color);
      group.add(bead);
      const hs = haloSprite(color, 0.95);
      if (hs) group.add(hs);
      world.add(group);
      const label = new LiveLabel(ctx, 0.55, 1, color, 9);
      if (label.sprite) world.add(label.sprite);
      const slot = pointSlot(cg, pd) ?? { kind: pd.kind, index: -1, x: paramNum(pd.x, initialParams(g)) ?? 0 };
      points.set(pd.id, { def: pd, frame, plot, slot, group, bead, halo: hs, label, cur: null });
    }

    for (const ld of g.lines ?? []) {
      const meaning = ld.meaning ?? "asymptote";
      const color = roleColor(ld.role) ?? (meaning === "asymptote" ? C.asymptote : meaning === "symmetry" ? C.symmetry : C.guide);
      const dg = new DynGeo(70 * 10, 70 * 60);
      const mesh = new THREE.Mesh(dg.geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
      mesh.name = `line:${ld.id}`;
      mesh.frustumCulled = false;
      world.add(mesh);
      const label = new LiveLabel(ctx, 0.48, 1, color, 9);
      if (label.sprite) world.add(label.sprite);
      lines.set(ld.id, { def: ld, frame, dg, mesh, segs: { u0: [], u1: [], idx: [], stride: 60 }, label, labelPos: null });
    }

    for (const rd of g.regions ?? []) {
      const plot = plots.get(rd.plot)!;
      const other = rd.with ? plots.get(rd.with) ?? null : null;
      const y0 = frame.plane(0, clamp(0, frame.v[0], frame.v[1]))[1];
      const group = new THREE.Group();
      group.name = `region:${rd.id}`;
      group.position.y = y0;
      const single = roleColor(rd.role) ?? C.positive;
      const mats = [
        new THREE.MeshBasicMaterial({ color: rd.sign ? C.positive : single, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
        new THREE.MeshBasicMaterial({ color: C.negative, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
      ];
      const pos = new DynGeo(1200, 1800);
      const neg = new DynGeo(1200, 1800);
      for (const [dg, m] of [[pos, mats[0]!], [neg, mats[1]!]] as const) {
        const mesh = new THREE.Mesh(dg.geometry, m);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        group.add(mesh);
      }
      world.add(group);
      const signs: RegionObj["signs"] = [];
      if (rd.sign)
        for (let k = 0; k < 6; k++)
          for (const positive of [true, false]) {
            const s = textSprite(ctx, positive ? "+" : "−", 0.75, positive ? "#13804a" : "#b42328", 800);
            if (s) {
              world.add(s);
              signs.push({ sprite: s, positive });
            }
          }
      const label = rd.label ? new LiveLabel(ctx, 0.48, 1, rd.sign ? C.axis : single, 10) : null;
      if (label?.sprite) world.add(label.sprite);
      regions.set(rd.id, { def: rd, frame, plot, other, group, pos, neg, mats, signs, label, labelPos: new THREE.Vector3(), y0 });
    }

    for (const iv of g.intervals ?? []) {
      const color = roleColor(iv.role) ?? C.interval;
      const group = new THREE.Group();
      group.name = `interval:${iv.id}`;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, transparent: true, opacity: 0.9 });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 12).rotateZ(-Math.PI / 2).translate(0.5, 0, 0), mat);
      group.add(band);
      const end = (finite: boolean, closed: boolean, dir: 1 | -1): THREE.Object3D => {
        if (!finite) return new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 16).rotateZ((-dir * Math.PI) / 2), mat);
        if (closed) return new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat);
        const ring = new THREE.Group();
        ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 10, 24), mat));
        ring.add(new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), new THREE.MeshBasicMaterial({ color: "#ffffff" })));
        return ring;
      };
      const start = end(iv.from !== undefined, iv.fromClosed ?? false, -1);
      const stop = end(iv.to !== undefined, iv.toClosed ?? false, 1);
      group.add(start, stop);
      world.add(group);
      const label = iv.label ? new LiveLabel(ctx, 0.46, 1, color, 10) : null;
      if (label?.sprite) world.add(label.sprite);
      intervals.set(iv.id, { def: iv, frame, group, band, length: 1, start, end: stop, label, labelPos: new THREE.Vector3(), mats: [mat], ok: false });
    }

    for (const td of g.tracers ?? []) {
      const plot = plots.get(td.plot)!;
      const color = roleColor(td.role) ?? C.tracer;
      const group = new THREE.Group();
      group.name = `tracer:${td.id}`;
      const bead = beadMesh(0.22, color);
      group.add(bead);
      const hs = haloSprite(color, 1.2);
      if (hs) group.add(hs);
      let tangent: TracerObj["tangent"] = null;
      if (td.tangent ?? true) {
        tangent = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 1, 10).rotateZ(Math.PI / 2),
          new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, opacity: 0.9 }),
        );
        tangent.scale.x = 4;
        group.add(tangent);
      }
      world.add(group);
      const readout = new LiveLabel(ctx, 0.95, 2, color, 9);
      if (readout.sprite) world.add(readout.sprite);
      tracers.set(td.id, { def: td, frame, plot, group, bead, tangent, readout, pos: new THREE.Vector3() });
    }

    for (const sd of g.surfaces ?? []) {
      const res = sd.resolution ?? 48;
      const y0 = frame.space(0, 0, frame.v[0])[1];
      const group = new THREE.Group();
      group.name = `surface:${sd.id}`;
      group.position.y = y0;
      const dg = new DynGeo((res + 1) ** 2, res * res * 6, true);
      const mesh = new THREE.Mesh(
        dg.geometry,
        new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.42, metalness: 0.05, transparent: true, opacity: 0.96 }),
      );
      mesh.frustumCulled = false;
      group.add(mesh);
      let wire: SurfaceObj["wire"] = null;
      if (sd.wireframe ?? true) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 2 * (res + 1) * res * 3), 3).setUsage(THREE.DynamicDrawUsage));
        wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: "#1d2a3a", transparent: true, opacity: 0.35 }));
        wire.frustumCulled = false;
        group.add(wire);
      }
      world.add(group);
      const label = new LiveLabel(ctx, 0.6, 1, "#2476c9", 14);
      if (label.sprite) world.add(label.sprite);
      surfaces.set(sd.id, { def: sd, frame, cg, group, dg, mesh, wire, label, y0, top: new THREE.Vector3() });
    }
  }

  // ---------- rebuilds (only when parameter values change) ----------

  const rebuildPlot = (p: PlotObj, values: Values) => {
    const fr = p.frame;
    const f = p.cg.plot(p.def.id, values);
    p.f = f;
    const range = plotRange(fr.graph, p.def, values);
    const pieces = sampleCurve(f, range, CURVE_SAMPLES, { yClip: fr.v });
    const pts = pieces.map((pc) => pc.map(([u, v]) => fr.plane(u, v)));
    const us = pieces.map((pc) => pc.map(([u]) => u));
    p.segs = writeTube(p.dg, pts, us, p.def.width ?? 0.08, p.def.dashed ?? false);
    if (p.ribbon) {
      const r = p.ribbon;
      const half = p.def.extrude! / 2;
      r.dg.begin();
      r.segs = { u0: [], u1: [], idx: [], stride: 6 };
      pts.forEach((pc, pi) => {
        let prev = -1;
        pc.forEach((q, i) => {
          const a = r.dg.vertex(q[0], q[1], q[2] - half, 0, 0, 1);
          r.dg.vertex(q[0], q[1], q[2] + half, 0, 0, 1);
          if (prev >= 0 && a >= 0) {
            r.segs.u0.push(us[pi]![i - 1]!);
            r.segs.u1.push(us[pi]![i]!);
            r.segs.idx.push(r.dg.ni);
            r.dg.tri(prev, prev + 1, a);
            r.dg.tri(a, prev + 1, a + 1);
          }
          prev = a;
        });
      });
      r.dg.end();
    }
    p.label.set(plotLabel(p.cg, p.def, values) ?? "");
    for (const [about, gh] of p.ghosts) {
      // Source part that lands inside the frame once mirrored.
      const lo = Math.max(range[0], -fr.x[1]);
      const hi = Math.min(range[1], -fr.x[0]);
      const clip: [number, number] = about === "origin" ? [-fr.v[1], -fr.v[0]] : fr.v;
      const gp = lo < hi ? sampleCurve(f, [lo, hi], CURVE_SAMPLES, { yClip: clip }) : [];
      writeTube(gh.dg, gp.map((pc) => pc.map(([u, v]) => fr.plane(u, v))), gp.map((pc) => pc.map(([u]) => u)), (p.def.width ?? 0.08) * 0.9);
      // Label next to the leftmost end of the mirrored copy (away from the original curve).
      let end: [number, number] | null = null;
      for (const [u, v] of gp.flat()) if (!end || -u < end[0]) end = [-u, about === "origin" ? -v : v];
      if (end) {
        const m = fr.plane(end[0], end[1]);
        gh.labelAt.set(m[0] + 1.4, m[1] + 0.6, m[2] + 0.3);
      }
      if (gh.label) {
        const n = plotName(p.def);
        const par = parity(f, range);
        gh.label.set(
          about === "y-axis"
            ? par === "even" ? `${n}(−x) = ${n}(x): pari` : `${n}(−x) ≠ ${n}(x)`
            : par === "odd" ? `−${n}(−x) = ${n}(x): dispari` : `−${n}(−x) ≠ ${n}(x)`,
        );
      }
    }
  };

  const rebuildPoint = (pt: PointObj, values: Values) => {
    const fr = pt.frame;
    const f = pt.plot.f;
    const c = livePoint(f, pt.slot, plotRange(fr.graph, pt.plot.def, values), paramNum(pt.def.x, values));
    pt.cur = c && c.y >= fr.v[0] - 1e-9 && c.y <= fr.v[1] + 1e-9 ? c : null;
    if (!pt.cur) {
      pt.label.set("");
      pt.group.position.set(0, 0, 0);
      return;
    }
    const { x, y } = pt.cur;
    const p = fr.plane(x, y);
    pt.group.position.set(p[0], p[1], p[2] + Z_FRONT);
    pt.label.set(pointLabel(pt.def, x, y, values) ?? "");
    let kind = pt.def.kind;
    if (kind === "vertex") kind = f(x + 1e-3 * (fr.x[1] - fr.x[0])) > y ? "min" : "max";
    const off: Record<string, [number, number]> = {
      zero: [0, -0.62],
      min: [0, -0.62],
      max: [0, 0.62],
      "y-intercept": [-1.05, 0.1],
      inflection: [0.95, 0.45],
      point: [0.95, 0.45],
    };
    const [dx, dy] = off[kind] ?? [0.95, 0.45];
    pt.label.sprite?.position.set(p[0] + dx, p[1] + dy, p[2] + Z_FRONT + 0.3);
  };

  const rebuildRegion = (r: RegionObj, values: Values) => {
    const fr = r.frame;
    const f = r.plot.f;
    const g = r.other ? r.other.f : () => 0;
    const range = plotRange(fr.graph, r.plot.def, values);
    const a = Math.max(range[0], paramNum(r.def.over?.[0], values) ?? -Infinity);
    const b = Math.min(range[1], paramNum(r.def.over?.[1], values) ?? Infinity);
    const [vlo, vhi] = fr.v;
    const z = fr.plane(0, 0)[2] + Z_REGION;
    const Y = (v: number) => fr.plane(0, clamp(v, vlo, vhi))[1] - r.y0;
    const X = (u: number) => fr.plane(u, 0)[0];
    r.pos.begin();
    r.neg.begin();
    const runs: { u0: number; u1: number; positive: boolean }[] = [];
    const quad = (dg: DynGeo, u0: number, b0: number, t0: number, u1: number, b1: number, t1: number) => {
      const i0 = dg.vertex(X(u0), Y(b0), z);
      const i1 = dg.vertex(X(u0), Y(t0), z);
      const i2 = dg.vertex(X(u1), Y(b1), z);
      const i3 = dg.vertex(X(u1), Y(t1), z);
      dg.tri(i0, i2, i1);
      dg.tri(i1, i2, i3);
    };
    const n = 240;
    let prev: { u: number; b: number; t: number } | null = null;
    const add = (u0: number, b0: number, t0: number, u1: number, b1: number, t1: number) => {
      const positive = t0 + t1 - b0 - b1 >= 0;
      quad(r.def.sign && !positive ? r.neg : r.pos, u0, b0, t0, u1, b1, t1);
      const last = runs[runs.length - 1];
      if (last && last.positive === positive && Math.abs(last.u1 - u0) < 1e-9) last.u1 = u1;
      else runs.push({ u0, u1, positive });
    };
    // Shade only where the curve itself is inside the frame: an off-frame curve would
    // otherwise leave a large clipped block that reads as a shape of its own.
    const spans = a < b ? sampleCurve(f, [a, b], n, { yClip: fr.v }).map((pc) => [pc[0]![0], pc[pc.length - 1]![0]] as const) : [];
    for (const [sa, sb] of spans) {
      prev = null;
      const m = Math.max(8, Math.ceil((n * (sb - sa)) / (b - a)));
      for (let i = 0; i <= m; i++) {
        const u = sa + ((sb - sa) * i) / m;
        const t = f(u);
        const bb = g(u);
        if (!Number.isFinite(t) || !Number.isFinite(bb)) {
          prev = null;
          continue;
        }
        if (prev) {
          const d0 = prev.t - prev.b;
          const d1 = t - bb;
          if (d0 * d1 < 0) {
            const s = d0 / (d0 - d1);
            const uc = prev.u + (u - prev.u) * s;
            const vc = prev.b + (bb - prev.b) * s;
            add(prev.u, prev.b, prev.t, uc, vc, vc);
            add(uc, vc, vc, u, bb, t);
          } else add(prev.u, prev.b, prev.t, u, bb, t);
        }
        prev = { u, b: bb, t };
      }
    }
    r.pos.end();
    r.neg.end();
    // "+" / "−" in the middle of every signed run wide enough to hold one.
    for (const s of r.signs) s.sprite.userData.on = false;
    for (const run of runs) {
      if (run.u1 - run.u0 < 0.25) continue;
      const s = r.signs.find((q) => q.positive === run.positive && !q.sprite.userData.on);
      if (!s) continue;
      const um = (run.u0 + run.u1) / 2;
      const p = fr.plane(um, clamp((f(um) + g(um)) / 2, vlo + 0.3, vhi - 0.3));
      s.sprite.position.set(p[0], p[1], p[2] + Z_REGION + 0.05);
      s.sprite.userData.on = true;
    }
    if (r.label) {
      const um = (a + b) / 2;
      const p = fr.plane(um, clamp(Math.min(f(um), g(um)) || 0, vlo, vhi));
      r.labelPos.set(p[0], p[1] - 0.5, p[2] + 0.4);
      r.label.set(fillLabel(r.def.label!, values));
    }
  };

  const rebuildLine = (ln: LineObj, values: Values) => {
    const fr = ln.frame;
    const seg = clipLine(ln.def, fr, values);
    ln.labelPos = null;
    if (!seg) {
      ln.dg.begin();
      ln.dg.end();
      ln.segs = { u0: [], u1: [], idx: [], stride: 60 };
      ln.label.set("");
      return;
    }
    const pts: V3[] = [];
    const us: number[] = [];
    for (let k = 0; k <= 60; k++) {
      const s = k / 60;
      const p = fr.plane(seg[0][0] + (seg[1][0] - seg[0][0]) * s, seg[0][1] + (seg[1][1] - seg[0][1]) * s);
      pts.push([p[0], p[1], p[2] + Z_AXIS + 0.06]);
      us.push(s);
    }
    ln.segs = writeTube(ln.dg, [pts], [us], 0.034, true);
    const vertical = "x" in lineForm(ln.def, values);
    const end = pts[pts.length - 1]!;
    ln.labelPos = new THREE.Vector3(end[0] + (vertical ? 0.9 : -0.9), end[1] + (vertical ? -0.35 : 0.35), end[2] + 0.2);
    ln.label.set(lineLabel(ln.def, values) ?? "");
  };

  const rebuildInterval = (iv: IntervalObj, values: Values) => {
    const fr = iv.frame;
    const d = iv.def;
    const v0 = clamp(0, fr.v[0], fr.v[1]);
    const from = paramNum(d.from, values);
    const to = paramNum(d.to, values);
    // Ends follow the parameters; an end outside the frame is drawn at the frame edge.
    const a = clamp(from ?? fr.x[0], fr.x[0], fr.x[1]);
    const b = clamp(to ?? fr.x[1], fr.x[0], fr.x[1]);
    iv.ok = Number.isFinite(a) && Number.isFinite(b) && a < b;
    const pa = fr.plane(iv.ok ? a : fr.x[0], v0);
    const pb = fr.plane(iv.ok ? b : fr.x[0], v0);
    const lane = d.lane ?? 0;
    const y = pa[1] - lane * 0.5 - (lane ? 0.3 : 0);
    const extra = 0.45;
    const x0 = pa[0] - (from === undefined ? extra * 0.5 : 0);
    const x1 = pb[0] + (to === undefined ? extra : 0);
    iv.group.position.set(x0, y, pa[2] + Z_FRONT + 0.04);
    iv.length = Math.max(x1 - x0, TINY);
    iv.start.position.x = from === undefined ? 0 : pa[0] - x0;
    iv.end.position.x = to === undefined ? iv.length : pb[0] - x0;
    if (iv.label) {
      const text = fillLabel(d.label!, values);
      iv.label.set(text);
      // Above the right end of the band: the middle of the axis is where curves usually cross.
      const w = 0.46 * 0.32 * text.length;
      iv.labelPos.set(Math.max((pa[0] + pb[0]) / 2, x1 - w / 2 - 0.5), y + 0.45, pa[2] + Z_FRONT + 0.3);
    }
  };

  const tmpColor = new THREE.Color();
  const rebuildSurface = (s: SurfaceObj, values: Values) => {
    const fr = s.frame;
    const f = s.cg.surface(s.def.id, values);
    const res = s.def.resolution ?? 48;
    const [x0, x1] = s.def.x;
    const [y0, y1] = s.def.y;
    const [vlo, vhi] = fr.v;
    const dg = s.dg;
    dg.begin();
    const ok: boolean[] = [];
    let zTop = -Infinity;
    for (let j = 0; j <= res; j++)
      for (let i = 0; i <= res; i++) {
        const x = x0 + ((x1 - x0) * i) / res;
        const y = y0 + ((y1 - y0) * j) / res;
        const zv = f(x, y);
        const good = Number.isFinite(zv) && zv >= vlo - 1e-9 && zv <= vhi + 1e-9;
        ok.push(good);
        const p = fr.space(x, y, good ? zv : vlo);
        const vi = dg.vertex(p[0], p[1] - s.y0, p[2]);
        dg.color(vi, heightColor(good ? (zv - vlo) / (vhi - vlo) : 0, tmpColor));
        if (good) zTop = Math.max(zTop, zv);
      }
    const at = (i: number, j: number) => j * (res + 1) + i;
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i, j + 1);
        const d = at(i + 1, j + 1);
        if (ok[a] && ok[b] && ok[c] && ok[d]) {
          dg.tri(a, c, b);
          dg.tri(b, c, d);
        }
      }
    dg.end();
    dg.geometry.computeVertexNormals();
    if (s.wire) {
      const arr = (s.wire.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      let n = 0;
      const every = Math.max(1, Math.round(res / 12));
      const seg = (p: number, q: number) => {
        if (!ok[p] || !ok[q]) return;
        for (const v of [p, q]) {
          arr[n++] = dg.pos[v * 3]!;
          arr[n++] = dg.pos[v * 3 + 1]! + 0.004;
          arr[n++] = dg.pos[v * 3 + 2]!;
        }
      };
      for (let j = 0; j <= res; j += every) for (let i = 0; i < res; i++) seg(at(i, j), at(i + 1, j));
      for (let i = 0; i <= res; i += every) for (let j = 0; j < res; j++) seg(at(i, j), at(i, j + 1));
      const attr = s.wire.geometry.getAttribute("position") as THREE.BufferAttribute;
      attr.needsUpdate = true;
      s.wire.geometry.setDrawRange(0, n / 3);
    }
    const top = fr.space((x0 + x1) / 2, (y0 + y1) / 2, Number.isFinite(zTop) ? zTop : vhi);
    s.top.set(top[0], top[1], top[2]);
    s.label.set(surfaceLabel(s.cg, s.def.id, values) ?? "");
  };

  // ---------- per frame ----------

  const glowOf = (cp: ChapterPlan, id: string, t: number) => windowEnv(cp.entities.get(id)?.glow ?? [], t);
  const presence = (cp: ChapterPlan, id: string, t: number) => {
    const e = cp.entities.get(id);
    if (!e) return { scale: 0, grow: 0, hiding: false };
    const k = activeKey(e.presence, t);
    return { scale: evalPresence(e.presence, t).scale, grow: evalGrow(e.presence, t), hiding: !!k && k.key.to === 0 };
  };
  const setLabel = (s: THREE.Sprite | null | undefined, visible: boolean, scale = 1) => {
    if (!s) return;
    s.visible = visible && scale > TINY;
    const aspect = (s.userData.aspect as number | undefined) ?? s.scale.x / Math.max(s.scale.y, TINY);
    if (s.userData.h === undefined) s.userData.h = s.scale.y;
    if (s.userData.aspect === undefined) s.userData.aspect = aspect;
    const h = (s.userData.h as number) * Math.max(scale, TINY);
    s.scale.set(h * (s.userData.aspect as number), h, 1);
  };

  let pulse = 0;
  return {
    box,
    update(cp, gp, t, overrides) {
      pulse = 0.5 + 0.5 * Math.sin(6 * t);
      for (const go of graphs) {
        const values: Values = {};
        for (const [id] of Object.entries(initialParams(go.def))) {
          const tr = gp.params.get(id);
          values[id] = overrides?.[id] ?? (tr ? evalScalar(tr, t) : initialParams(go.def)[id]!);
        }
        const key = JSON.stringify(values);
        if (key !== go.key) {
          go.key = key;
          for (const p of plots.values()) if (p.frame === go.frame) rebuildPlot(p, values);
          for (const pt of points.values()) if (pt.frame === go.frame) rebuildPoint(pt, values);
          for (const r of regions.values()) if (r.frame === go.frame) rebuildRegion(r, values);
          for (const ln of lines.values()) if (ln.frame === go.frame) rebuildLine(ln, values);
          for (const iv of intervals.values()) if (iv.frame === go.frame) rebuildInterval(iv, values);
          for (const s of surfaces.values()) if (s.frame === go.frame) rebuildSurface(s, values);
        }
        const pr = presence(cp, go.def.id, t);
        go.group.visible = pr.scale > TINY;
        go.group.scale.setScalar(Math.max(pr.scale, TINY));
      }

      for (const [id, p] of plots) {
        const pr = presence(cp, id, t);
        const visible = pr.scale > TINY;
        const tr = gp.reveal.get(id);
        const { win, drawing } = tr ? evalWindow(tr, t) : { win: [0, 0] as [number, number], drawing: false };
        const r = windowRange(p.segs, win[0], win[1]);
        p.dg.geometry.setDrawRange(r.start, r.count);
        p.mesh.visible = visible && r.count > 0;
        p.mesh.userData.key = p.mesh.visible;
        p.mat.opacity = pr.hiding ? clamp(pr.scale) : 1;
        const glow = glowOf(cp, id, t);
        p.mat.emissive.set(p.mat.color).multiplyScalar(0.3 + glow * (0.25 + 0.35 * pulse));
        if (p.ribbon) {
          const rr = windowRange(p.ribbon.segs, win[0], win[1]);
          p.ribbon.dg.geometry.setDrawRange(rr.start, rr.count);
          p.ribbon.mesh.visible = p.mesh.visible;
        }
        const y = p.f(win[1]);
        const tipOk = visible && drawing && Number.isFinite(y) && y >= p.frame.v[0] && y <= p.frame.v[1];
        p.tip.visible = tipOk;
        // Hidden objects get a fixed pose too, so the scene graph is a pure function of t.
        if (tipOk) p.tip.position.copy(v3(p.frame.plane(win[1], y), 0.02));
        else p.tip.position.set(0, 0, 0);
        if (p.label.sprite) {
          p.label.sprite.position.copy(p.labelPos);
          setLabel(p.label.sprite, visible && win[1] - win[0] > 0.3 * (p.frame.x[1] - p.frame.x[0]), pr.hiding ? pr.scale : 1);
        }
        // Both tests can be on at once (reflection in the y axis, half-turn about the origin).
        for (const [about, gh] of p.ghosts) {
          const m = evalMirror(gp.mirrors.get(id), t, about);
          const on = visible && !!m;
          gh.mesh.visible = on;
          gh.mesh.userData.key = on;
          gh.pivot.rotation.set(0, 0, 0);
          if (on) {
            // Swing towards the camera (+z), in front of the whiteboard.
            if (about === "y-axis") gh.pivot.rotation.y = -Math.PI * m.p;
            else gh.pivot.rotation.z = Math.PI * m.p;
          }
          if (gh.label?.sprite) {
            // With both ghosts shown, the second label goes one row lower.
            const both = about === "origin" && !!evalMirror(gp.mirrors.get(id), t, "y-axis") && visible;
            gh.label.sprite.position.copy(gh.labelAt).add(new THREE.Vector3(0, both ? -0.7 : 0, 0));
            setLabel(gh.label.sprite, on && m.p >= 1);
          }
        }
      }

      for (const [id, pt] of points) {
        const pr = presence(cp, id, t);
        const glow = glowOf(cp, id, t);
        const ok = !!pt.cur && pr.scale > TINY;
        pt.group.visible = ok;
        pt.group.userData.key = ok;
        pt.group.scale.setScalar(Math.max(pr.scale * (1 + 0.35 * glow * pulse), TINY));
        pt.bead.material.emissiveIntensity = 0.35 + glow * 0.6 * pulse;
        if (pt.halo) pt.halo.material.opacity = 0.45 + 0.4 * glow * pulse;
        setLabel(pt.label.sprite, ok, pr.scale);
      }

      for (const [id, ln] of lines) {
        const g = presence(cp, id, t).grow;
        const r = windowRange(ln.segs, 0, g);
        ln.mesh.geometry.setDrawRange(r.start, r.count);
        ln.mesh.visible = g > TINY && r.count > 0;
        ln.mesh.userData.key = ln.mesh.visible;
        const glow = glowOf(cp, id, t);
        ln.mesh.material.emissive.set(ln.mesh.material.color).multiplyScalar(glow * 0.5 * pulse);
        if (ln.label.sprite) {
          if (ln.labelPos) ln.label.sprite.position.copy(ln.labelPos);
          else ln.label.sprite.position.set(0, 0, 0);
          setLabel(ln.label.sprite, g >= 0.999 && !!ln.labelPos);
        }
      }

      for (const [id, r] of regions) {
        const g = presence(cp, id, t).grow;
        r.group.visible = g > TINY;
        r.group.scale.y = r.other ? 1 : Math.max(g, TINY);
        const glow = glowOf(cp, id, t);
        r.mats.forEach((m) => (m.opacity = (0.3 + 0.25 * glow * pulse) * (r.other ? g : 1)));
        r.group.userData.key = r.group.visible;
        for (const s of r.signs) setLabel(s.sprite, g >= 0.999 && !!s.sprite.userData.on);
        if (r.label?.sprite) {
          r.label.sprite.position.copy(r.labelPos);
          setLabel(r.label.sprite, g >= 0.999);
        }
      }

      for (const [id, iv] of intervals) {
        const g = iv.ok ? presence(cp, id, t).grow : 0;
        iv.group.visible = g > TINY;
        iv.group.userData.key = iv.group.visible;
        iv.band.scale.x = Math.max(g * iv.length, TINY);
        iv.start.visible = g > TINY;
        iv.end.visible = g >= 0.98;
        const glow = glowOf(cp, id, t);
        for (const m of iv.mats) m.emissive.set(m.color).multiplyScalar(glow * 0.5 * pulse);
        if (iv.label?.sprite) {
          iv.label.sprite.position.copy(iv.labelPos);
          setLabel(iv.label.sprite, g >= 0.999);
        }
      }

      for (const [id, tr] of tracers) {
        const pr = presence(cp, id, t);
        const track = gp.tracers.get(id);
        const x = track ? evalScalar(track, t) : tr.def.x;
        const f = tr.plot.f;
        const y = f(x);
        const fr = tr.frame;
        const ok = pr.scale > TINY && Number.isFinite(y) && y >= fr.v[0] - 1e-9 && y <= fr.v[1] + 1e-9;
        tr.group.visible = ok;
        tr.group.userData.key = ok;
        tr.group.scale.setScalar(Math.max(pr.scale, TINY));
        if (!ok) {
          if (tr.readout.sprite) tr.readout.sprite.visible = false;
          tr.group.position.set(0, 0, 0);
          tr.tangent?.material.color.set(roleColor(tr.def.role) ?? C.tracer);
          tr.tangent?.rotation.set(0, 0, 0);
          tr.readout.sprite?.position.set(0, 0, 0);
          continue;
        }
        const p = fr.plane(x, y);
        tr.pos.set(p[0], p[1], p[2] + Z_FRONT + 0.02);
        tr.group.position.copy(tr.pos);
        const m = derivative(f, x);
        const flat = Math.abs(m) < 0.03;
        if (tr.tangent) {
          tr.tangent.rotation.z = Math.atan2(m * fr.sv, fr.sx);
          tr.tangent.visible = Number.isFinite(m);
          tr.tangent.material.color.set(flat ? C.flat : (roleColor(tr.def.role) ?? C.tracer));
        }
        tr.readout.set(tracerReadout(tr.def.readout ?? "slope", plotName(tr.plot.def), f, x).join("\n"));
        if (tr.readout.sprite) {
          tr.readout.sprite.position.set(p[0] + 1.5, p[1] + 1.55, p[2] + Z_FRONT + 0.4);
          setLabel(tr.readout.sprite, (tr.def.readout ?? "slope") !== "none", pr.scale);
        }
      }

      for (const [id, s] of surfaces) {
        const pr = presence(cp, id, t);
        s.group.visible = pr.grow > TINY;
        s.group.userData.key = s.group.visible;
        s.group.scale.y = Math.max(pr.grow, TINY);
        const glow = glowOf(cp, id, t);
        s.mesh.material.emissive.setScalar(glow * 0.15 * pulse);
        if (s.label.sprite) {
          s.label.sprite.position.copy(s.top).add(new THREE.Vector3(0, 1.9, 0));
          setLabel(s.label.sprite, pr.grow >= 0.999);
        }
      }
    },

    resolve(entity, part, index, out) {
      switch (entity) {
        case "graph": {
          const go = graphs.find((g) => g.def.id === part);
          if (!go) return false;
          out.set(...go.frame.box[0]).add(new THREE.Vector3(...go.frame.box[1])).multiplyScalar(0.5);
          return true;
        }
        case "plot": {
          const p = plots.get(part);
          if (!p) return false;
          if (index === undefined) {
            out.copy(p.labelPos);
            return true;
          }
          const u = p.frame.x[0] + index * p.frame.xStep;
          const y = p.f(u);
          if (u > p.frame.x[1] + 1e-9 || !Number.isFinite(y) || y < p.frame.v[0] || y > p.frame.v[1]) return false;
          out.copy(v3(p.frame.plane(u, y)));
          return true;
        }
        case "point": {
          const pt = points.get(part);
          if (!pt?.cur) return false;
          out.copy(pt.group.position);
          return true;
        }
        case "tracer": {
          const tr = tracers.get(part);
          if (!tr) return false;
          out.copy(tr.pos);
          return true;
        }
        case "surface": {
          const s = surfaces.get(part);
          if (!s) return false;
          out.copy(s.top);
          return true;
        }
        default:
          return false;
      }
    },
  };
}
