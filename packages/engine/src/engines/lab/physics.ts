// Physics of the lab experiments: pure functions of (variables, physical time tau), no three.js.
//
// Closed form where it exists (free fall, projectile, circuit, heating); otherwise a fixed-step
// integration from tau = 0, extended lazily and cached per parameter set (SimCache), so a state
// only depends on (variables, tau) whatever the order of the queries.
//
// Experiment-local coordinates are metres: x to the right, y up, y = 0 on the bench.
// Material constants (verified 2026-11-04):
// - water c = 4186 J/(kg·K), ice c = 2090 J/(kg·K): it.wikipedia.org/wiki/Calore_specifico
// - water latent heat: fusion 333.5 kJ/kg (0 °C), vaporisation 2272 kJ/kg (100 °C): it.wikipedia.org/wiki/Calore_latente
// - standard gravity 9.80665 m/s² (we use 9.81 by default): it.wikipedia.org/wiki/Accelerazione_di_gravità
import { VESSEL_DEFAULTS, type LabKind, type LabSetup } from "@pv/scene-spec";
import { decimalMark, engineText as L } from "@pv/scene-spec/i18n";
import { LAB_VESSEL, TOWER, VESSEL_LAYOUTS, VESSEL_SHAPES, VesselSim, type VesselShape, type VesselsState } from "./vessels.ts";

export const G_DEFAULT = 9.81;
export const C_WATER = 4186;
export const C_ICE = 2090;
export const L_FUSION = 333_500;
export const L_VAPOUR = 2_272_000;

export type Vars = Record<string, number>;

/** Numeric variables of a setup, with defaults filled in. */
export function varsOf(setup: LabSetup): Vars {
  const out: Vars = {};
  for (const [k, x] of Object.entries(setup)) if (typeof x === "number") out[k] = x;
  if (out.g === undefined && setup.kind !== "circuit" && setup.kind !== "heat" && setup.kind !== "spring") out.g = G_DEFAULT;
  if (setup.kind === "projectile") out.height ??= 0;
  if (setup.kind === "pendulum" || setup.kind === "spring") out.damping ??= 0;
  if (setup.kind === "ramp") {
    out.flat ??= out.length! / 2;
    out.valley = setup.track === "valley" ? 1 : 0;
  }
  if (setup.kind === "vessels") {
    // The layout travels as a number so frames and caches can key on Vars alone.
    out.layout = VESSEL_LAYOUTS.indexOf(setup.layout);
    out.count ??= (setup.shapes ?? VESSEL_SHAPES).length;
    out.into ??= -1; // -1 = the last container
    for (const [k, x] of Object.entries(VESSEL_DEFAULTS)) out[k] ??= x;
  }
  return out;
}

/** Common energy bookkeeping (joules). E is the initial total: Ep + Ec + Q = E. */
export interface Energy {
  Ep: number;
  Ec: number;
  Q: number;
  E: number;
}

const ZERO_E: Energy = { Ep: 0, Ec: 0, Q: 0, E: 0 };

/** One labelled force on a body: direction in metres-space (unit vector) and size in newtons. */
export interface Force {
  id: "P" | "N" | "A" | "F" | "S";
  /** Body the force acts on (default 0). */
  at?: number;
  dx: number;
  dy: number;
  n: number;
}

// ---------------------------------------------------------------- fixed-step integration cache

/** Samples state[] every `dt` from tau = 0, extended lazily; linear interpolation in between. */
export class SimCache {
  private samples: number[][];
  constructor(
    y0: number[],
    private readonly dt: number,
    private readonly step: (y: number[], dt: number) => number[],
    /** Physical seconds simulated at most (later queries return the last state). */
    private readonly maxTau = 900,
  ) {
    this.samples = [y0.slice()];
  }

  at(tau: number): number[] {
    const t = Math.min(Math.max(tau, 0), this.maxTau);
    const f = t / this.dt;
    const i = Math.floor(f);
    while (this.samples.length < i + 2) this.samples.push(this.step(this.samples[this.samples.length - 1]!, this.dt));
    const a = this.samples[i]!;
    const b = this.samples[i + 1]!;
    const p = f - i;
    return a.map((x, k) => x + (b[k]! - x) * p);
  }
}

/** Classic RK4 step for y' = f(y). */
export function rk4(f: (y: number[]) => number[]) {
  return (y: number[], dt: number): number[] => {
    const k1 = f(y);
    const k2 = f(y.map((x, i) => x + (dt / 2) * k1[i]!));
    const k3 = f(y.map((x, i) => x + (dt / 2) * k2[i]!));
    const k4 = f(y.map((x, i) => x + dt * k3[i]!));
    return y.map((x, i) => x + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
  };
}

/** Arithmetic-geometric mean (exact pendulum period). */
function agm(a: number, b: number): number {
  for (let i = 0; i < 30 && Math.abs(a - b) > 1e-15; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return a;
}

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- states per kind

interface Base {
  /** Physical time since the run started (0 before the first run). */
  tau: number;
  /** A run has started (false: the apparatus waits in its start state). */
  running: boolean;
  /** Motion is over (landed, stopped, settled, boiled away). */
  done: boolean;
  energy: Energy;
  forces: Force[];
}
/** A body point in metres plus its velocity. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface FallState extends Base {
  kind: "fall";
  bodies: Body[];
  /** Fall time and impact speed. */
  T: number;
  vImpact: number;
}
export interface ProjectileState extends Base {
  kind: "projectile";
  bodies: Body[];
  T: number;
  range: number;
  apex: { x: number; y: number };
}
export interface PendulumState extends Base {
  kind: "pendulum";
  bodies: Body[];
  /** Angle from the vertical (rad, + = right) and pivot height (m). */
  theta: number;
  pivotY: number;
  Tsmall: number;
  Texact: number;
}
export interface SpringState extends Base {
  kind: "spring";
  bodies: Body[];
  /** Displacement from equilibrium (m, + = stretched) and the equilibrium x of the cart centre. */
  x: number;
  x0: number;
  T: number;
}
export interface RampState extends Base {
  kind: "ramp";
  bodies: Body[];
  /** Distance along the track and local slope (rad, + = uphill towards +s). */
  s: number;
  slope: number;
  /** Acceleration on the first ramp (m/s², <= 0: the block does not move) and friction power (W). */
  a: number;
  heatRate: number;
  track: Track;
}
export interface LeverState extends Base {
  kind: "lever";
  bodies: Body[];
  /** Beam angle (rad, + = right side down), its limit, and the two moments m·d (kg·m). */
  phi: number;
  phiMax: number;
  left: number;
  right: number;
}
export interface BuoyancyState extends Base {
  kind: "buoyancy";
  bodies: Body[];
  /** Cube side (m), bottom height above the beaker floor (m), submerged depth (m), water level (m). */
  side: number;
  bottom: number;
  depth: number;
  level: number;
  weight: number;
  buoyant: number;
  /** Final verdict from the densities: floating fraction (< 1) or 1 = sinks. */
  fraction: number;
}
export interface CircuitState extends Base {
  kind: "circuit";
  bodies: Body[];
  closed: boolean;
  /** Equivalent resistance (Ω), total current (A), per-bulb current (A), power (W) and brightness 0..2. */
  R: number;
  I: number;
  currents: number[];
  powers: number[];
  brightness: number[];
  /** Total current relative to one bulb r1 alone at the scene's voltage (ammeter needle). */
  load: number;
  /** Distance travelled by the moving charges of each bulb's branch (arbitrary units, grows with the current). */
  flows: number[];
}
export interface HeatState extends Base {
  kind: "heat";
  bodies: Body[];
  /** Temperature (°C), heat given (J), ice and vaporised fractions, phase name. */
  T: number;
  heat: number;
  ice: number;
  steam: number;
  phase: "ghiaccio" | "fusione" | "acqua" | "ebollizione" | "evaporata";
  /** Physical time to boil everything away (s). */
  total: number;
}
export type LabState =
  | FallState
  | ProjectileState
  | PendulumState
  | SpringState
  | RampState
  | LeverState
  | BuoyancyState
  | CircuitState
  | HeatState
  | VesselsState;

// ---------------------------------------------------------------- frames (constant geometry per chapter)

/** Geometry that must not change with the sliders (stand height, beam length, beaker size), metres. */
export interface Frame {
  /** Bounding box of everything the experiment can draw, metres. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  [k: string]: number;
}

const max = (all: Vars[], k: string) => Math.max(...all.map((v) => v[k] ?? 0));

/** Frame from all the variable sets the sliders can reach (corners of the ranges). */
export function frameOf(kind: LabKind, all: Vars[]): Frame {
  switch (kind) {
    case "fall": {
      const h = max(all, "height");
      return { x0: -0.35 * h - 0.2, x1: 0.35 * h + 0.2, y0: 0, y1: h * 1.08 };
    }
    case "projectile": {
      let x1 = 1;
      let y1 = 0.5;
      for (const v of all) {
        const p = projectile(v, 0);
        x1 = Math.max(x1, p.range);
        y1 = Math.max(y1, p.apex.y, v.height!);
      }
      return { x0: -0.08 * x1, x1: x1 * 1.04, y0: 0, y1: y1 * 1.1 };
    }
    case "pendulum": {
      const L = max(all, "length");
      const pivotY = L * 1.15;
      return { x0: -L * 1.05, x1: L * 1.05, y0: 0, y1: pivotY * 1.05, pivotY };
    }
    case "spring": {
      const A = max(all, "amplitude");
      const rest = Math.max(2.2 * A, 0.3);
      return { x0: -0.1 * rest, x1: rest + 1.6 * A + 0.25 * rest, y0: 0, y1: rest * 0.5, rest };
    }
    case "ramp": {
      let span = 0.5;
      let h = 0.1;
      for (const v of all) {
        const tr = track(v);
        span = Math.max(span, tr.span);
        h = Math.max(h, tr.H);
      }
      return { x0: 0, x1: span, y0: 0, y1: h * 1.15 };
    }
    case "lever": {
      const B = Math.max(max(all, "armLeft"), max(all, "armRight")) * 1.1;
      const hF = B * 0.32;
      return { x0: -B * 1.05, x1: B * 1.05, y0: 0, y1: hF + B * 0.9, B, hF };
    }
    case "buoyancy": {
      const a = Math.cbrt(max(all, "volume") / 1000);
      const R = a * 1.25;
      const depth = a * 1.35;
      const level = depth + a ** 3 / (Math.PI * R * R);
      const height = level + a * 1.15;
      return { x0: -R * 1.6, x1: R * 1.6, y0: 0, y1: height * 1.25, a, R, depth, height };
    }
    case "circuit":
      return { x0: -1, x1: 1, y0: 0, y1: 1.2 };
    case "heat":
      return { x0: -0.6, x1: 0.6, y0: 0, y1: 1.2 };
    case "vessels": {
      const layout = VESSEL_LAYOUTS[all[0]?.layout ?? 0] ?? "lab";
      if (layout === "lab") {
        const n = max(all, "count");
        return { x0: -0.16, x1: (n - 1) * LAB_VESSEL.spacing + 0.16, y0: 0, y1: LAB_VESSEL.height * 1.45 };
      }
      if (layout === "tower") {
        const top = Math.max(max(all, "tankHeight") + TOWER.tankH - TOWER.tankWater, max(all, "buildingHeight") + 3, TOWER.houseH + 2);
        return { x0: -TOWER.tankR - 3, x1: TOWER.buildingX + TOWER.buildingW / 2 + 2, y0: 0, y1: top * 1.08 };
      }
      // Canal: schematic plan in x (the rig lays it out), real depths in y below sea level.
      const D = Math.max(max(all, "depth"), max(all, "draft"));
      return { x0: 0, x1: 0.001, y0: -D * 1.3, y1: D * 0.55, maxDepth: D };
    }
  }
}

// ---------------------------------------------------------------- closed forms

function fall(v: Vars, tau: number): FallState {
  const { height: h, mass: m, g } = v as Required<typeof v>;
  const T = Math.sqrt((2 * h!) / g!);
  const t = Math.max(0, tau);
  const landed = t >= T;
  const y = landed ? 0 : h! - 0.5 * g! * t * t;
  const vy = landed ? 0 : -g! * t;
  const E = m! * g! * h!;
  const Ep = m! * g! * y;
  const Ec = 0.5 * m! * vy * vy;
  // Side by side: the rig spaces the two balls; physics only needs their heights.
  const bodies = [{ x: 0, y, vx: 0, vy }];
  if (v.mass2 !== undefined) bodies.push({ x: 0, y, vx: 0, vy });
  const forces: Force[] = landed ? [] : [{ id: "P", dx: 0, dy: -1, n: m! * g! }];
  return { kind: "fall", tau: t, running: tau >= 0, done: landed, energy: { Ep, Ec, Q: landed ? E : Math.max(0, E - Ep - Ec), E }, forces, bodies, T, vImpact: g! * T };
}

function projectile(v: Vars, tau: number): ProjectileState {
  const { speed: s, angle, height: h, mass: m, g } = v as Record<string, number>;
  const vx = s! * Math.cos(angle! * DEG);
  const vy0 = s! * Math.sin(angle! * DEG);
  const T = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g! * h!)) / g!;
  const t = Math.min(Math.max(0, tau), T);
  const landed = tau >= T;
  const y = landed ? 0 : h! + vy0 * t - 0.5 * g! * t * t;
  const body = { x: vx * t, y: Math.max(0, y), vx: landed ? 0 : vx, vy: landed ? 0 : vy0 - g! * t };
  const E = m! * g! * h! + 0.5 * m! * s! * s!;
  const Ep = m! * g! * body.y;
  const Ec = 0.5 * m! * (body.vx ** 2 + body.vy ** 2);
  const tA = Math.max(0, vy0 / g!);
  const apex = { x: vx * tA, y: h! + vy0 * tA - 0.5 * g! * tA * tA };
  return {
    kind: "projectile", tau: Math.max(0, tau), running: tau >= 0, done: landed, bodies: [body], T, range: vx * T, apex,
    energy: { Ep, Ec, Q: landed ? E : Math.max(0, E - Ep - Ec), E }, forces: [],
  };
}

/** `rated`: power of a fully lit bulb (W); `Iref`: current that makes the charges run at full speed (A). */
function circuit(v: Vars, tau: number, layout: "series" | "parallel", rated: number, Iref: number): CircuitState {
  const rs = [v.r1!, v.r2, v.r3].filter((r): r is number => r !== undefined);
  const V = v.voltage!;
  const closed = tau >= 0;
  const R = layout === "series" ? rs.reduce((a, b) => a + b, 0) : 1 / rs.reduce((a, r) => a + 1 / r, 0);
  const I = closed ? V / R : 0;
  const currents = rs.map((r) => (closed ? (layout === "series" ? I : V / r) : 0));
  const powers = rs.map((r, i) => currents[i]! ** 2 * r);
  const brightness = powers.map((p) => Math.min(2, p / rated));
  return {
    kind: "circuit", tau: Math.max(0, tau), running: tau >= 0, done: false, energy: ZERO_E, forces: [], bodies: [],
    closed, R, I, currents, powers, brightness, load: I / Iref, flows: currents.map((c) => (c > 0 ? tau * (0.25 + 0.75 * Math.min(1.5, c / Iref)) : 0)),
  };
}

function heat(v: Vars, tau: number): HeatState {
  const { power: P, mass: m, startTemp: T0 } = v as Record<string, number>;
  const stages: { q: number; phase: HeatState["phase"] }[] = [];
  if (T0! < 0) stages.push({ q: m! * C_ICE * -T0!, phase: "ghiaccio" }, { q: m! * L_FUSION, phase: "fusione" });
  stages.push({ q: m! * C_WATER * (100 - Math.max(0, T0!)), phase: "acqua" }, { q: m! * L_VAPOUR, phase: "ebollizione" });
  const totalQ = stages.reduce((a, s) => a + s.q, 0);
  const t = Math.max(0, tau);
  const Q = Math.min(P! * t, totalQ);
  let rest = Q;
  let T = T0!;
  let ice = T0! < 0 ? 1 : 0;
  let steam = 0;
  let phase: HeatState["phase"] = stages[0]!.phase;
  for (const s of stages) {
    const used = Math.min(rest, s.q);
    const p = s.q > 0 ? used / s.q : 1;
    if (s.phase === "ghiaccio") T = T0! + (0 - T0!) * p;
    if (s.phase === "fusione") ice = 1 - p;
    if (s.phase === "acqua") T = Math.max(0, T0!) + (100 - Math.max(0, T0!)) * p;
    if (s.phase === "ebollizione") steam = p;
    phase = s.phase;
    rest -= used;
    if (rest <= 0 && used < s.q) break;
  }
  const done = Q >= totalQ;
  if (done) phase = "evaporata";
  return { kind: "heat", tau: t, running: tau >= 0, done, energy: ZERO_E, forces: [], bodies: [], T, heat: Q, ice, steam, phase, total: totalQ / P! };
}

// ---------------------------------------------------------------- integrated kinds

export interface Track {
  /** Segments along s: length (m) and slope (rad, + = uphill along +s). */
  segs: { len: number; slope: number; s0: number; x0: number; y0: number }[];
  total: number;
  H: number;
  span: number;
  /** "ramp" ends with a stop; "valley" with the second ramp's top. */
  valley: boolean;
}

export function track(v: Vars): Track {
  const valley = v.valley === 1;
  const th = v.angle! * DEG;
  const L = v.length!;
  const parts = [
    { len: L, slope: -th },
    { len: v.flat ?? L / 2, slope: 0 },
    ...(valley ? [{ len: L, slope: th }] : []),
  ];
  const H = L * Math.sin(th);
  let s0 = 0;
  let x0 = 0;
  let y0 = H;
  const segs = parts.map((p) => {
    const seg = { ...p, s0, x0, y0 };
    s0 += p.len;
    x0 += p.len * Math.cos(p.slope);
    y0 += p.len * Math.sin(p.slope);
    return seg;
  });
  return { segs, total: s0, H, span: x0, valley };
}

export function trackPoint(tr: Track, s: number): { x: number; y: number; slope: number } {
  const c = Math.min(Math.max(s, 0), tr.total);
  let seg = tr.segs[0]!;
  for (const g of tr.segs) if (c >= g.s0) seg = g;
  const d = c - seg.s0;
  return { x: seg.x0 + d * Math.cos(seg.slope), y: seg.y0 + d * Math.sin(seg.slope), slope: seg.slope };
}

/** One sliding step with kinetic friction (static coefficient = kinetic, as on the page). State [s, v, work]. */
function rampStep(v: Vars, tr: Track) {
  const g = v.g!;
  const mu = v.friction!;
  const m = v.mass!;
  return (y: number[], dt: number): number[] => {
    let [s, vel, W] = y as [number, number, number];
    const { slope } = trackPoint(tr, s + Math.sign(vel) * 1e-9);
    const drive = -g * Math.sin(slope);
    const fric = mu * g * Math.cos(slope);
    let a: number;
    if (vel === 0) {
      if (Math.abs(drive) <= fric + 1e-12) return [s, 0, W];
      a = drive - Math.sign(drive) * fric;
    } else a = drive - Math.sign(vel) * fric;
    let nv = vel + a * dt;
    // A turning point (friction or gravity) stops the block for one step; it starts again only if gravity beats static friction.
    if (vel !== 0 && Math.sign(nv) !== Math.sign(vel)) nv = 0;
    let ns = s + nv * dt;
    W += fric * m * Math.abs(nv) * dt;
    if (ns <= 0) [ns, nv] = [0, Math.max(0, nv)];
    if (ns >= tr.total) [ns, nv] = [tr.total, 0];
    return [ns, nv, W];
  };
}

// ---------------------------------------------------------------- the simulator

/** Physics of one chapter's experiment for one variable set; state(tau) is pure and cached. */
export class Experiment {
  readonly kind: LabKind;
  private cache: SimCache | null = null;
  private tr: Track | null = null;
  /** Circuit: a bulb is fully lit at the power one bulb r1 gets alone at the scene's voltage. */
  private rated = 1;
  private Iref = 1;
  private vessels: VesselSim | null = null;

  constructor(
    readonly setup: LabSetup,
    readonly v: Vars,
    readonly frame: Frame,
  ) {
    this.kind = setup.kind;
    const f = frame;
    switch (setup.kind) {
      case "vessels": {
        const shapes: readonly VesselShape[] = setup.shapes ?? VESSEL_SHAPES;
        this.vessels = new VesselSim({
          layout: setup.layout, shapes, count: v.count!, into: v.into! < 0 ? shapes.length : v.into!, volume: v.volume!, level: v.level!,
          tankHeight: v.tankHeight!, buildingHeight: v.buildingHeight!, depth: v.depth!, draft: v.draft!, rho: v.fluidDensity!, g: v.g!,
          maxDepth: f.maxDepth ?? Math.max(v.depth!, v.draft!),
        });
        break;
      }
      case "circuit": {
        const V = setup.voltage > 0 ? setup.voltage : 4.5;
        this.rated = (V * V) / setup.r1;
        this.Iref = V / setup.r1;
        break;
      }
      case "pendulum": {
        const { length: L, g, damping: b } = v as Record<string, number>;
        this.cache = new SimCache([v.angle! * DEG, 0], 1 / 500, rk4(([th, w]) => [w!, -(g! / L!) * Math.sin(th!) - b! * w!]));
        break;
      }
      case "spring": {
        const { k, mass: m, damping: b } = v as Record<string, number>;
        this.cache = new SimCache([v.amplitude!, 0], 1 / 500, rk4(([x, w]) => [w!, -(k! / m!) * x! - (b! / m!) * w!]));
        break;
      }
      case "ramp": {
        this.tr = track(v);
        this.cache = new SimCache([0, 0, 0], 1 / 1000, rampStep(v, this.tr));
        break;
      }
      case "lever": {
        const { massLeft: m1, armLeft: d1, massRight: m2, armRight: d2, g } = v as Record<string, number>;
        const I = m1! * d1! ** 2 + m2! * d2! ** 2 + (0.5 * (2 * f.B!) ** 2) / 12;
        const net = m2! * d2! - m1! * d1!;
        const lim = Math.asin(Math.min(1, f.hF! / f.B!));
        const step = rk4(([p, w]) => [w!, (g! * Math.cos(p!) * net) / I]);
        this.cache = new SimCache([0, 0], 1 / 500, (y, dt) => {
          const n = step(y, dt);
          return Math.abs(n[0]!) >= lim ? [Math.sign(n[0]!) * lim, 0] : n;
        });
        break;
      }
      case "buoyancy": {
        const { density: rho, fluidDensity: rf, volume, g } = v as Record<string, number>;
        const a = Math.cbrt(volume! / 1000);
        const m = rho! * a ** 3;
        const k = rf! * g! * a * a;
        const c = 2 * 0.35 * Math.sqrt(k * m);
        this.cache = new SimCache([f.depth!, 0], 1 / 500, (y, dt) => {
          const n = rk4(([yb, w]) => {
            const d = this.submerged(yb!);
            return [w!, (-m * g! + rf! * g! * a * a * d - c * (d / a) * w!) / m];
          })(y, dt);
          return n[0]! <= 0 ? [0, 0] : n;
        });
        break;
      }
      default:
        break;
    }
  }

  /** Submerged depth of the cube (m) with its bottom at `yb`, the water level rising with it. */
  submerged(yb: number): number {
    const { R, depth: D0 } = this.frame;
    const a = Math.cbrt(this.v.volume! / 1000);
    const A = Math.PI * R! * R!;
    const d = (D0! - yb) / (1 - (a * a) / A);
    return Math.min(a, Math.max(0, d));
  }

  state(tau: number): LabState {
    const v = this.v;
    const f = this.frame;
    switch (this.setup.kind) {
      case "fall":
        return fall(v, tau);
      case "projectile":
        return projectile(v, tau);
      case "circuit":
        return circuit(v, tau, this.setup.layout, this.rated, this.Iref);
      case "heat":
        return heat(v, tau);
      case "vessels":
        return this.vessels!.state(tau);
      case "pendulum": {
        const [th, w] = this.cache!.at(tau) as [number, number];
        const { length: L, mass: m, g } = v as Record<string, number>;
        const pivotY = f.pivotY!;
        const E = m! * g! * L! * (1 - Math.cos(v.angle! * DEG));
        const Ep = m! * g! * L! * (1 - Math.cos(th));
        const Ec = 0.5 * m! * (L! * w) ** 2;
        const body = { x: L! * Math.sin(th), y: pivotY - L! * Math.cos(th), vx: L! * w * Math.cos(th), vy: L! * w * Math.sin(th) };
        const Tsmall = 2 * Math.PI * Math.sqrt(L! / g!);
        return {
          kind: "pendulum", tau: Math.max(0, tau), running: tau >= 0, done: false, bodies: [body], theta: th, pivotY, Tsmall,
          Texact: Tsmall / agm(1, Math.cos((v.angle! * DEG) / 2)), energy: { Ep, Ec, Q: Math.max(0, E - Ep - Ec), E }, forces: [],
        };
      }
      case "spring": {
        const [x, w] = this.cache!.at(tau) as [number, number];
        const { k, mass: m, amplitude: A } = v as Record<string, number>;
        const E = 0.5 * k! * A! * A!;
        const Ep = 0.5 * k! * x * x;
        const Ec = 0.5 * m! * w * w;
        const x0 = f.rest!;
        const F = -k! * x;
        return {
          kind: "spring", tau: Math.max(0, tau), running: tau >= 0, done: false, bodies: [{ x: x0 + x, y: 0, vx: w, vy: 0 }], x, x0,
          T: 2 * Math.PI * Math.sqrt(m! / k!), energy: { Ep, Ec, Q: Math.max(0, E - Ep - Ec), E },
          forces: Math.abs(F) > 1e-9 ? [{ id: "F", dx: Math.sign(F), dy: 0, n: Math.abs(F) }] : [],
        };
      }
      case "ramp": {
        const tr = this.tr!;
        const [s, vel] = this.cache!.at(tau) as [number, number];
        const later = this.cache!.at(tau + 0.05)[0]!;
        const { mass: m, g, friction: mu, angle } = v as Record<string, number>;
        const p = trackPoint(tr, s + Math.sign(vel) * 1e-9);
        const E = m! * g! * tr.H;
        const Ep = m! * g! * p.y;
        const Ec = 0.5 * m! * vel * vel;
        const th = angle! * DEG;
        const a = g! * (Math.sin(th) - mu! * Math.cos(th));
        const nx = -Math.sin(p.slope);
        const ny = Math.cos(p.slope);
        const W = m! * g!;
        const forces: Force[] = [
          { id: "P", dx: 0, dy: -1, n: W },
          { id: "N", dx: nx, dy: ny, n: W * Math.cos(p.slope) },
        ];
        // Friction opposes the motion; at rest on a slope (static) it holds the block up the slope.
        const dir = vel !== 0 ? -Math.sign(vel) : Math.sign(Math.sin(p.slope));
        const fn = vel !== 0 ? mu! * W * Math.cos(p.slope) : Math.min(mu! * W * Math.cos(p.slope), W * Math.abs(Math.sin(p.slope)));
        if (mu! > 0 && fn > 1e-9 && dir !== 0) forces.push({ id: "A", dx: dir * Math.cos(p.slope), dy: dir * Math.sin(p.slope), n: fn });
        const done = vel === 0 && Math.abs(later - s) < 1e-9 && tau > 0;
        return {
          kind: "ramp", tau: Math.max(0, tau), running: tau >= 0, done, bodies: [{ x: p.x, y: p.y, vx: vel * Math.cos(p.slope), vy: vel * Math.sin(p.slope) }],
          s, slope: p.slope, a, heatRate: vel !== 0 ? mu! * W * Math.cos(p.slope) * Math.abs(vel) : 0, track: tr,
          energy: { Ep, Ec, Q: Math.max(0, E - Ep - Ec), E }, forces,
        };
      }
      case "lever": {
        const [phi, w] = this.cache!.at(tau) as [number, number];
        const { massLeft: m1, armLeft: d1, massRight: m2, armRight: d2, g } = v as Record<string, number>;
        const lim = Math.asin(Math.min(1, f.hF! / f.B!));
        const cx = (d: number) => d * Math.cos(phi);
        const cy = (d: number) => f.hF! - d * Math.sin(phi);
        const bodies = [
          { x: -cx(d1!), y: cy(-d1!), vx: 0, vy: 0 },
          { x: cx(d2!), y: cy(d2!), vx: 0, vy: 0 },
        ];
        const forces: Force[] = [];
        if (m1! > 0) forces.push({ id: "P", dx: 0, dy: -1, n: m1! * g!, at: 0 });
        if (m2! > 0) forces.push({ id: "P", dx: 0, dy: -1, n: m2! * g!, at: 1 });
        return {
          kind: "lever", tau: Math.max(0, tau), running: tau >= 0, done: Math.abs(w) < 1e-9 && tau > 0, energy: ZERO_E, forces, bodies,
          phi, phiMax: lim, left: m1! * d1!, right: m2! * d2!,
        };
      }
      case "buoyancy": {
        const [yb, w] = this.cache!.at(tau) as [number, number];
        const { density: rho, fluidDensity: rf, volume, g } = v as Record<string, number>;
        const a = Math.cbrt(volume! / 1000);
        const d = this.submerged(yb);
        const A = Math.PI * f.R! * f.R!;
        const level = f.depth! + (a * a * d) / A;
        const weight = rho! * a ** 3 * g!;
        const buoyant = rf! * g! * a * a * d;
        const forces: Force[] = [{ id: "P", dx: 0, dy: -1, n: weight }];
        if (buoyant > 1e-9) forces.push({ id: "S", dx: 0, dy: 1, n: buoyant });
        if (yb <= 0 && weight > buoyant) forces.push({ id: "N", dx: 0, dy: 1, n: weight - buoyant });
        const later = this.cache!.at(tau + 0.5);
        return {
          kind: "buoyancy", tau: Math.max(0, tau), running: tau >= 0, done: tau > 0 && Math.abs(later[0]! - yb) < 1e-4, energy: ZERO_E, forces,
          bodies: [{ x: 0, y: yb + a / 2, vx: 0, vy: w }], side: a, bottom: yb, depth: d, level, weight, buoyant,
          fraction: rho! < rf! ? rho! / rf! : 1,
        };
      }
    }
  }
}

// ---------------------------------------------------------------- board text (lesson language, live values)

/** Number with fixed decimals and the lesson's decimal mark (Italian: comma), no "-0". */
export function num(x: number, d = 2): string {
  const s = (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d);
  return s.replace(".", decimalMark());
}

/** Digits that keep about three significant figures. */
const sig = (x: number) => (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);
const n3 = (x: number) => num(x, sig(x));

/** The formula board: 2–3 lines with the current values (computed source "calc"). */
export function boardLines(ex: Experiment, st: LabState, energy: boolean): string[] {
  const v = ex.v;
  const sum = `Ep + Ec + Q = ${n3(st.energy.E)} J`;
  const tail = energy ? [sum] : [];
  switch (st.kind) {
    case "fall":
      return [
        `t = √(2h/g) = ${num(st.T)} s`,
        st.done ? L("lab.impact", { v: num(st.vImpact, 1) }) : `v = g·t = ${num(Math.abs(st.bodies[0]!.vy), 1)} m/s`,
        ...tail,
      ];
    case "projectile":
      return [
        L("lab.range", { r: n3(st.range), h: n3(st.apex.y) }),
        `vx = ${num(st.bodies[0]!.vx, 1)} m/s · vy = ${num(st.bodies[0]!.vy, 1)} m/s`,
        ...tail,
      ];
    case "pendulum":
      return [`T ≈ 2π√(L/g) = ${num(st.Tsmall)} s`, `θ = ${num(st.theta / DEG, 0)}° · v = ${num(Math.hypot(st.bodies[0]!.vx, st.bodies[0]!.vy), 1)} m/s`, ...tail];
    case "spring":
      return [`T = 2π√(m/k) = ${num(st.T)} s`, `F = −k·x = ${n3(-v.k! * st.x)} N`, ...tail];
    case "ramp":
      return [
        st.a > 0 ? `a = g·(sin θ − μ·cos θ) = ${num(st.a)} m/s²` : L("lab.stuck"),
        L("lab.heatLoss", { v: num(Math.hypot(st.bodies[0]!.vx, st.bodies[0]!.vy), 1), q: n3(st.energy.Q) }),
        ...tail,
      ];
    case "lever": {
      const verdict = L(Math.abs(st.left - st.right) < 1e-9 ? "lab.balance" : st.right > st.left ? "lab.rightDown" : "lab.leftDown");
      return [`m₁·d₁ = ${num(v.massLeft!, 1)} · ${num(v.armLeft!)} = ${num(st.left)}`, `m₂·d₂ = ${num(v.massRight!, 1)} · ${num(v.armRight!)} = ${num(st.right)}`, verdict];
    }
    case "buoyancy":
      return [
        `P = m·g = ${n3(st.weight)} N`,
        `S = ρ·V·g = ${n3(st.buoyant)} N`,
        st.fraction < 1 ? L("lab.floats", { p: num(st.fraction * 100, 0) }) : L("lab.sinks"),
      ];
    case "circuit": {
      const rs = [v.r1!, v.r2, v.r3].filter((r): r is number => r !== undefined);
      const how = rs.length === 1 ? "" : L(ex.setup.kind === "circuit" && ex.setup.layout === "series" ? "lab.series" : "lab.parallel");
      return [`R = ${n3(st.R)} Ω${how}`, `I = V/R = ${num(st.closed ? v.voltage! / st.R : 0)} A`, `P = ${st.powers.map((p) => n3(p)).join(" · ")} W`];
    }
    case "vessels":
      return vesselBoard(st);
    case "heat":
      return [
        `Q = P·t = ${n3(st.heat / 1000)} kJ`,
        `T = ${num(st.T, 1)} °C · ${L(`lab.phase.${st.phase}`)}`,
        st.phase === "fusione" || st.phase === "ebollizione" ? L("lab.changeState") : `Q = m·c·ΔT`,
      ];
  }
}

/** Board lines of the communicating vessels (levels, ρ·g·h, what reaches the taps or the boat). */
function vesselBoard(st: VesselsState): string[] {
  const cm = (m: number) => num(m * 100, 1);
  if (st.layout === "lab") {
    const into = st.levels.indexOf(Math.max(...st.levels));
    return [
      L("lab.levels", { levels: st.levels.map(cm).join(" · ") }),
      L("lab.bottomPressure", { p: n3(st.pressures[into]!) }),
      !st.running ? L("lab.ready", { v: num(st.toPour, 2) }) : st.pouring ? L("lab.poured", { v: num(st.poured, 2) }) : L("lab.rest", { v: cm(st.eq) }),
    ];
  }
  if (st.layout === "tower") {
    const dry = st.taps.filter((t) => !t.wet).length;
    const low = st.taps.filter((t) => t.building === 1).reduce((a, t) => (t.y < a.y ? t : a), st.taps[st.taps.length - 1]!);
    return [
      L("lab.tankLevel", { v: num(st.levels[0]!, 1) }),
      L("lab.tapPressure", { p: n3(low.p / 1000), y: num(low.y, 0) }),
      !st.running ? L("lab.valveClosed") : dry === 0 ? L("lab.allTaps") : L("lab.dryTaps", { n: dry }),
    ];
  }
  const depth = st.levels[1]! - st.vessels[1]!.y0;
  return [
    L("lab.canal", { v: num(st.levels[1]!, 1) }),
    L("lab.deep", { d: num(depth, 1), p: n3(st.pressures[1]! / 1000) }),
    L(st.navigable ? (st.boat > 0 ? "lab.navigable" : "lab.boatWaits") : "lab.tooLow"),
  ];
}
