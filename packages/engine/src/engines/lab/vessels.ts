// Communicating vessels (hydrostatics) for the lab engine: pure physics, no three.js.
//
// Model: N open containers joined at the bottom by one pipe with no storage (a manifold). The
// pipe node sits at the level that makes the flows balance, and each container exchanges water
// with it in proportion to the level difference: q_i = K_i (L_i - L_node). Volume is conserved
// exactly (the flows sum to zero; poured water is added). At rest every free surface is at the
// same height (principle of communicating vessels); the pressure at depth d is p = ρ·g·d (Stevino).
// The speed of the transient is illustrative (K is chosen for a ~1-4 s relaxation), the levels
// and pressures at rest are exact. A container (or closed riser) that is full takes no more water.
//
// Layouts (experiment-local metres, y up, y = 0 on the ground / bench):
// - "lab": up to 4 containers on a bench (beaker, cylinder, tube, flask), water poured into one.
// - "tower": an elevated tank piped to a house and a taller building; each riser fills up to the
//   tank level (or stays full and pressurised when its top is lower); taps above the level are dry.
// - "canal": two seas (level 0) and a dry channel between gates; the gates open, the channel
//   fills to sea level and a boat sails in once the water is deeper than its draft.
import { SimCache } from "./physics.ts";

export const VESSEL_LAYOUTS = ["lab", "tower", "canal"] as const;
export type VesselLayout = (typeof VESSEL_LAYOUTS)[number];
export const VESSEL_SHAPES = ["beaker", "cylinder", "tube", "flask"] as const;
export type VesselShape = (typeof VESSEL_SHAPES)[number];

/** Lab container sizes (m): height, and radius (flask: sphere radius, neck radius). */
export const LAB_VESSEL = { height: 0.32, spacing: 0.3, pipeY: 0.025, pipeR: 0.012, pourTime: 2 };
const RADIUS: Record<VesselShape, number> = { beaker: 0.07, cylinder: 0.035, tube: 0.012, flask: 0.1 };
const FLASK_NECK = 0.03;
/** Tower layout sizes (m). */
export const TOWER = { tankR: 3, tankH: 4, tankWater: 3, houseX: 14, houseW: 6, houseH: 6.5, buildingX: 25, buildingW: 7, riserR: 0.15, floor: 3 };
/** Canal layout sizes (m): channel plan area, sea depth below the deepest channel. */
export const CANAL = { channelArea: 2000, seaArea: 1e9, boatTime: 6, gateTime: 1 };

/** One container: horizontal section A(y) between `y0` and `top` (absolute heights, m). */
export interface Vessel {
  name: string;
  shape: VesselShape | "tank" | "riser" | "sea" | "channel";
  /** Centre x (m, layout-specific meaning for canal: index). */
  x: number;
  y0: number;
  top: number;
  /** Radius for round sections (flask: sphere radius). */
  r: number;
  /** Section area for "sea" / "channel" boxes. */
  area?: number;
  /** Conductance to the pipe node (m²/s). */
  K: number;
}

export function sectionArea(v: Vessel, y: number): number {
  if (y < v.y0 || y > v.top) return 0;
  if (v.area !== undefined) return v.area;
  if (v.shape === "flask") {
    const h = y - v.y0;
    const neck = 1.7 * v.r;
    if (h >= neck) return Math.PI * FLASK_NECK * FLASK_NECK;
    return Math.max(Math.PI * FLASK_NECK * FLASK_NECK, Math.PI * (2 * v.r * h - h * h));
  }
  return Math.PI * v.r * v.r;
}

/** Water volume (m³) with the free surface at absolute height L. */
export function volumeAt(v: Vessel, L: number): number {
  const h = Math.min(Math.max(L, v.y0), v.top) - v.y0;
  if (v.area !== undefined) return v.area * h;
  if (v.shape === "flask") {
    const neck = 1.7 * v.r;
    const cap = (x: number) => Math.PI * x * x * (v.r - x / 3);
    if (h <= neck) return Math.max(cap(h), Math.PI * FLASK_NECK * FLASK_NECK * h);
    return cap(neck) + Math.PI * FLASK_NECK * FLASK_NECK * (h - neck);
  }
  return Math.PI * v.r * v.r * h;
}

/** Inverse of volumeAt (monotonic): free-surface height for a volume. */
export function levelOf(v: Vessel, V: number): number {
  if (V <= 0) return v.y0;
  const full = volumeAt(v, v.top);
  if (V >= full) return v.top;
  if (v.area !== undefined) return v.y0 + V / v.area;
  if (v.shape !== "flask") return v.y0 + V / (Math.PI * v.r * v.r);
  let lo = v.y0;
  let hi = v.top;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (volumeAt(v, mid) < V) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Variables used by this module (see LAB_VARS.vessels). */
export interface VesselVars {
  layout: VesselLayout;
  shapes: readonly VesselShape[];
  count: number;
  into: number;
  volume: number;
  level: number;
  tankHeight: number;
  buildingHeight: number;
  depth: number;
  draft: number;
  rho: number;
  g: number;
  /** Deepest channel any slider can reach (canal sea floor). */
  maxDepth: number;
}

export interface Tap {
  building: 0 | 1;
  y: number;
}

export interface VesselsState {
  kind: "vessels";
  tau: number;
  running: boolean;
  done: boolean;
  energy: { Ep: number; Ec: number; Q: number; E: number };
  forces: never[];
  bodies: { x: number; y: number; vx: number; vy: number }[];
  layout: VesselLayout;
  vessels: Vessel[];
  /** Free-surface heights (m), volumes (L) and flows to the pipe (L/s, + = out of the container). */
  levels: number[];
  volumes: number[];
  flows: number[];
  /** Litres that crossed the pipe between container k and k+1 (left to right), for moving markers. */
  transfer: number[];
  /** Level all surfaces reach at rest (m) and pressure ρ·g·h at the pipe under each container (Pa). */
  eq: number;
  pressures: number[];
  /** Lab: pouring now, litres poured so far. */
  pouring: boolean;
  poured: number;
  /** Lab: litres poured by each run. */
  toPour: number;
  /** Tower: taps with water now and the static pressure there (Pa, 0 = dry). */
  taps: (Tap & { wet: boolean; p: number })[];
  /** Canal: gate opening 0..1, boat progress 0..1 into the channel, navigable at rest. */
  gate: number;
  boat: number;
  navigable: boolean;
}

/** The containers of a layout (absolute geometry, metres). */
export function vesselsOf(v: VesselVars): { vessels: Vessel[]; initial: number[]; taps: Tap[] } {
  if (v.layout === "lab") {
    const n = Math.max(2, Math.min(v.shapes.length, Math.round(v.count)));
    const vessels = v.shapes.slice(0, n).map((shape, i): Vessel => {
      const r = RADIUS[shape];
      const A = shape === "flask" ? Math.PI * r * r : Math.PI * r * r;
      return { name: `container${i}`, shape, x: i * LAB_VESSEL.spacing, y0: 0, top: LAB_VESSEL.height, r, K: A / 1.2 };
    });
    return { vessels, initial: vessels.map((c) => volumeAt(c, v.level)), taps: [] };
  }
  if (v.layout === "tower") {
    const base = v.tankHeight - TOWER.tankWater;
    const tank: Vessel = { name: "tank", shape: "tank", x: 0, y0: base, top: base + TOWER.tankH, r: TOWER.tankR, K: 50 };
    const taps: Tap[] = [];
    for (const y of [1, 4]) taps.push({ building: 0, y });
    for (let y = v.buildingHeight; y >= 1; y -= TOWER.floor) taps.push({ building: 1, y });
    const riserA = Math.PI * TOWER.riserR ** 2;
    const house: Vessel = { name: "house", shape: "riser", x: TOWER.houseX, y0: 0, top: 4.5, r: TOWER.riserR, K: riserA / 2 };
    const building: Vessel = { name: "building", shape: "riser", x: TOWER.buildingX, y0: 0, top: v.buildingHeight + 0.5, r: TOWER.riserR, K: riserA / 2 };
    return { vessels: [tank, house, building], initial: [volumeAt(tank, v.tankHeight), 0, 0], taps };
  }
  const sea = (name: string, x: number): Vessel => ({ name, shape: "sea", x, y0: -v.maxDepth * 1.3, top: 2, r: 0, area: CANAL.seaArea, K: CANAL.channelArea / 4 });
  const channel: Vessel = { name: "channel", shape: "channel", x: 1, y0: -v.depth, top: 2, r: 0, area: CANAL.channelArea, K: 1e6 };
  const seas = [sea("sea0", 0), channel, sea("sea1", 2)];
  return { vessels: seas, initial: seas.map((s) => (s.shape === "sea" ? volumeAt(s, 0) : 0)), taps: [] };
}

/** Flows to the shared pipe node (m³/s, + = out of the container), full containers excluded from inflow. */
export function pipeFlows(vessels: Vessel[], levels: number[], open: number[]): number[] {
  const active = vessels.map((_, i) => open[i]! > 0);
  for (let pass = 0; pass < vessels.length + 1; pass++) {
    let num = 0;
    let den = 0;
    vessels.forEach((c, i) => {
      if (!active[i]) return;
      num += c.K * open[i]! * levels[i]!;
      den += c.K * open[i]!;
    });
    if (den === 0) return vessels.map(() => 0);
    const node = num / den;
    let changed = false;
    vessels.forEach((c, i) => {
      // A full container cannot take more water: it drops out of the balance.
      if (active[i] && levels[i]! >= c.top - 1e-9 && node > levels[i]!) {
        active[i] = false;
        changed = true;
      }
    });
    if (!changed) return vessels.map((c, i) => (active[i] ? c.K * open[i]! * (levels[i]! - node) : 0));
  }
  return vessels.map(() => 0);
}

/** Level shared at rest by all containers holding `total` m³ (bisection on the summed volume). */
export function restLevel(vessels: Vessel[], total: number): number {
  let lo = Math.min(...vessels.map((c) => c.y0));
  let hi = Math.max(...vessels.map((c) => c.top));
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vessels.reduce((a, c) => a + volumeAt(c, mid), 0) < total) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export class VesselSim {
  readonly vessels: Vessel[];
  readonly taps: Tap[];
  private readonly initial: number[];
  private readonly cache: SimCache;
  private readonly pourRate: number;
  /** Canal: physical time at which the channel becomes deep enough for the boat (Infinity = never). */
  readonly tNav: number;
  /** Container that receives the pour (lab). */
  readonly into: number;

  constructor(readonly v: VesselVars) {
    const { vessels, initial, taps } = vesselsOf(v);
    this.vessels = vessels;
    this.taps = taps;
    this.initial = initial;
    this.pourRate = v.layout === "lab" ? v.volume / 1000 / LAB_VESSEL.pourTime : 0;
    const n = vessels.length;
    const into = Math.min(n - 1, Math.max(0, Math.round(v.into)));
    this.into = into;
    // The pour is on or off for a whole step (steps end exactly at the pour time), so it is integrated exactly.
    const deriv = (y: number[], pourOn: boolean): number[] => {
      const t = y[n]!;
      const levels = vessels.map((c, i) => levelOf(c, y[i]!));
      const open = vessels.map((c) => (v.layout === "canal" && c.shape === "sea" ? Math.min(1, Math.max(0, t / CANAL.gateTime)) : 1));
      const q = pipeFlows(vessels, levels, open);
      const d = q.map((x) => -x);
      if (pourOn && this.pourRate > 0 && levels[into]! < vessels[into]!.top - 1e-9) d[into]! += this.pourRate;
      return [...d, 1];
    };
    const rk = (y: number[], dt: number): number[] => {
      const on = y[n]! < LAB_VESSEL.pourTime - dt / 2;
      const k1 = deriv(y, on);
      const k2 = deriv(y.map((x, i) => x + (dt / 2) * k1[i]!), on);
      const k3 = deriv(y.map((x, i) => x + (dt / 2) * k2[i]!), on);
      const k4 = deriv(y.map((x, i) => x + dt * k3[i]!), on);
      return y.map((x, i) => Math.max(i < n ? 0 : -Infinity, x + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)));
    };
    this.cache = new SimCache([...initial, 0], v.layout === "canal" ? 1 / 50 : 1 / 200, rk, 600);
    this.tNav = Infinity;
    if (v.layout === "canal" && v.depth >= v.draft) {
      for (let t = 0; t <= 300; t += 0.02) {
        // The approach to sea level is asymptotic: a draft equal to the depth counts once 99% is reached.
        if (levelOf(vessels[1]!, this.cache.at(t)[1]!) + v.depth >= Math.min(v.draft, 0.99 * v.depth)) {
          this.tNav = t;
          break;
        }
      }
    }
  }

  state(tau: number): VesselsState {
    const v = this.v;
    const n = this.vessels.length;
    const running = tau >= 0;
    const y = running ? this.cache.at(tau) : [...this.initial, 0];
    const t = running ? tau : 0;
    const vols = y.slice(0, n);
    const levels = this.vessels.map((c, i) => levelOf(c, vols[i]!));
    const open = this.vessels.map((c) => (v.layout === "canal" && c.shape === "sea" ? Math.min(1, Math.max(0, t / CANAL.gateTime)) : 1));
    const flows = running ? pipeFlows(this.vessels, levels, open) : this.vessels.map(() => 0);
    const pouring = running && v.layout === "lab" && t < LAB_VESSEL.pourTime;
    const poured = v.layout === "lab" && running ? (v.volume * Math.min(t, LAB_VESSEL.pourTime)) / LAB_VESSEL.pourTime : 0;
    // Pipe transfer left -> right between neighbours: what left the containers on the left side.
    const transfer: number[] = [];
    let acc = 0;
    const into = this.into;
    for (let k = 0; k < n - 1; k++) {
      acc += this.initial[k]! - vols[k]! + (k === into ? poured / 1000 : 0);
      transfer.push(acc * 1000);
    }
    // Water present now plus what is still to be poured (an overflowing container loses the excess).
    const total = vols.reduce((a, x) => a + x, 0) + (v.layout === "lab" ? (v.volume - poured) / 1000 : 0);
    const eq = v.layout === "lab" ? restLevel(this.vessels, total) : v.layout === "tower" ? levels[0]! : 0;
    const pipeY = v.layout === "lab" ? LAB_VESSEL.pipeY : 0;
    const pressures = levels.map((L) => v.rho * v.g * Math.max(0, L - (v.layout === "canal" ? -v.depth : pipeY)));
    const risers = [levels[1] ?? 0, levels[2] ?? 0];
    const taps = this.taps.map((tp) => {
      const wet = running && v.layout === "tower" && risers[tp.building]! >= tp.y - 1e-6 && levels[0]! > tp.y;
      return { ...tp, wet, p: wet ? v.rho * v.g * (levels[0]! - tp.y) : 0 };
    });
    // At rest: every open container within 1 mm of the pipe node.
    const settled = running && !pouring && flows.every((q, i) => Math.abs(q) / this.vessels[i]!.K < 1e-3);
    const gate = v.layout === "canal" && running ? Math.min(1, t / CANAL.gateTime) : 0;
    const boat = v.layout === "canal" && running && t >= this.tNav ? Math.min(1, (t - this.tNav) / CANAL.boatTime) : 0;
    const navigable = v.layout === "canal" && v.depth >= v.draft;
    const into0 = v.layout === "lab" ? into : 0;
    const body =
      v.layout === "canal"
        ? { x: boat, y: levels[1]!, vx: 0, vy: 0 }
        : { x: this.vessels[into0]!.x, y: levels[into0]!, vx: 0, vy: 0 };
    return {
      kind: "vessels", tau: Math.max(0, tau), running, done: settled && (v.layout !== "canal" || boat >= 1 || !navigable),
      energy: { Ep: 0, Ec: 0, Q: 0, E: 0 }, forces: [], bodies: [body], layout: v.layout, vessels: this.vessels,
      levels, volumes: vols.map((x) => x * 1000), flows: flows.map((q) => q * 1000), transfer, eq, pressures,
      pouring, poured, toPour: v.layout === "lab" ? v.volume : 0, taps, gate, boat, navigable,
    };
  }
}
