// Pure evaluation of BattleData groups: pose(group, member, chapter, t).
// No three.js here, no state carried between calls (the memo is cleared every frame
// and only caches results of the pure function).
import type { BattleData } from "@pv/scene-spec";
import { clamp, ease, hash, lerp, seg } from "../../util/math.ts";

type Phase = BattleData["armies"][number]["phases"][number];
type Target = Phase["start"];
type Move = NonNullable<Phase["moves"]>[number];
type Formation = BattleData["formations"][string];
type Keys = NonNullable<BattleData["night"]>[number]["keys"];
type Vec2 = [number, number];

export const DEG = Math.PI / 180;

export type GroupKind = "army" | "vehicle" | "figure" | "prop";

export interface Group {
  id: string;
  kind: GroupKind;
  count: number;
  phases: Phase[];
  /** Vehicles: "ship" | "chariot". */
  type?: string;
  scale: number;
}

export interface Pose {
  x: number;
  z: number;
  /** Height above the terrain. */
  yOff: number;
  yaw: number;
  tilt: number;
  vis: boolean;
  moving: boolean;
  /** Prop growth 0..1 (scale.y). */
  grow: number;
}

export interface CityGeom {
  id: string;
  center: Vec2;
  radius: number;
  /** Terrain height at the centre (hill top). */
  base: number;
  wallHeight: number;
  gateAngle: number; // radians
  gateHalfWidth: number;
}

/** Point on a slot plus its facing. */
interface Spot {
  x: number;
  z: number;
  yOff: number;
  yaw: number | null;
  moving: boolean;
  vis: boolean;
}

const HIDDEN: Pose = { x: 0, z: 0, yOff: 0, yaw: 0, tilt: 0, vis: false, moving: false, grow: 1 };

/** Deck slot spacing along the hull and deck height, per vehicle type (model units). */
const DECK: Record<string, { along: number; side: number; y: number }> = {
  ship: { along: 0.14, side: 0.17, y: 0.32 },
  chariot: { along: 0.0, side: 0.12, y: 0.32 },
};

export function evalKeys(keys: Keys, t: number): number {
  const first = keys[0]!;
  if (t <= first.at) return first.value;
  for (let k = 1; k < keys.length; k++) {
    const a = keys[k - 1]!;
    const b = keys[k]!;
    if (t < b.at) return lerp(a.value, b.value, ease[b.ease ?? "inOutQuad"](seg(t, a.at, b.at)));
  }
  return keys[keys.length - 1]!.value;
}

export const inWindows = (w: [number, number][] | undefined, t: number) => !w || w.some(([a, b]) => t >= a && t <= b);

const inMembers = (r: [number, number] | undefined, m: number) => !r || (m >= r[0] && m < r[1]);

export class Motion {
  readonly groups = new Map<string, Group>();
  readonly cities = new Map<string, CityGeom>();
  readonly places = new Map<string, Vec2>();
  private memo = new Map<string, Pose>();
  private depth = 0;

  constructor(
    readonly data: BattleData,
    readonly height: (x: number, z: number) => number,
    readonly isDeepWater: (x: number, z: number) => boolean,
  ) {
    for (const [k, v] of Object.entries(data.places ?? {})) this.places.set(k, v);
    for (const c of data.cities ?? []) {
      const a = c.gate.angle * DEG;
      const g: CityGeom = {
        id: c.id,
        center: c.center,
        radius: c.wall.radius,
        base: height(c.center[0], c.center[1]),
        wallHeight: c.wall.height,
        gateAngle: a,
        gateHalfWidth: (Math.PI * c.wall.radius) / c.wall.segments,
      };
      this.cities.set(c.id, g);
      this.places.set(`${c.id}.gate`, [c.center[0] + Math.cos(a) * c.wall.radius, c.center[1] + Math.sin(a) * c.wall.radius]);
      this.places.set(`${c.id}.center`, c.center);
    }
    const add = (g: Group) => {
      if (this.groups.has(g.id)) throw new Error(`battle: duplicate group id "${g.id}"`);
      this.groups.set(g.id, g);
    };
    for (const a of data.armies) add({ id: a.id, kind: "army", count: a.count, phases: a.phases, scale: 1 });
    for (const v of data.vehicles ?? []) add({ id: v.id, kind: "vehicle", count: v.count, phases: v.phases, type: v.type, scale: v.scale ?? 1 });
    for (const f of data.figures ?? []) add({ id: f.id, kind: "figure", count: 1, phases: f.phases, scale: f.scale ?? 1 });
    for (const p of data.props ?? []) add({ id: p.id, kind: "prop", count: p.count ?? 1, phases: p.phases, scale: p.scale ?? 1 });
    this.validate();
  }

  /** Throws on dangling references, so a bad spec fails at build time and not mid-animation. */
  private validate() {
    const sides = new Set(this.data.sides.map((s) => s.id));
    const need = (ok: boolean, what: string) => {
      if (!ok) throw new Error(`battle: unknown ${what}`);
    };
    for (const a of this.data.armies) need(sides.has(a.side), `side "${a.side}" in army "${a.id}"`);
    const checkTarget = (tg: Target, where: string) => {
      if ("formation" in tg && !("follow" in tg)) {
        need(tg.formation in this.data.formations, `formation "${tg.formation}" in ${where}`);
        if (typeof tg.at === "string") need(this.places.has(tg.at), `place "${tg.at}" in ${where}`);
      }
      if ("place" in tg) need(this.places.has(tg.place), `place "${tg.place}" in ${where}`);
      if ("vehicle" in tg) need(this.groups.get(tg.vehicle)?.kind === "vehicle", `vehicle "${tg.vehicle}" in ${where}`);
      if ("follow" in tg) {
        need(this.groups.has(tg.follow), `follow target "${tg.follow}" in ${where}`);
        if (tg.formation) need(tg.formation in this.data.formations, `formation "${tg.formation}" in ${where}`);
      }
      if ("orbit" in tg && typeof tg.orbit.center === "string") need(this.places.has(tg.orbit.center), `place "${tg.orbit.center}" in ${where}`);
    };
    for (const g of this.groups.values())
      g.phases.forEach((p, i) => {
        const where = `${g.id}.phases[${i}]`;
        checkTarget(p.start, where);
        p.moves?.forEach((m) => checkTarget(m.target, where));
        if (p.hideInside) need(this.cities.has(p.hideInside), `city "${p.hideInside}" in ${where}`);
      });
    for (const f of Object.values(this.data.formations))
      if (f.type === "arc") {
        if (f.city) need(this.cities.has(f.city), `city "${f.city}" in an arc formation`);
        else need(!!f.center && !!f.radius, "arc formation without city needs center and radius");
      }
  }

  /** Clears the memo: call once per update(). */
  beginFrame() {
    this.memo.clear();
  }

  resolvePoint(p: Vec2 | string | undefined): Vec2 {
    if (p === undefined) return [0, 0];
    if (typeof p !== "string") return p;
    const v = this.places.get(p);
    if (!v) throw new Error(`battle: unknown place "${p}"`);
    return v;
  }

  phaseFor(g: Group, chapter: string, m: number): Phase | undefined {
    const own = g.phases.filter((p) => p.chapters?.includes(chapter));
    if (own.length) return own.find((p) => inMembers(p.members, m));
    return g.phases.find((p) => !p.chapters && inMembers(p.members, m));
  }

  pose(id: string, m: number, chapter: string, t: number): Pose {
    const key = `${id}|${m}|${chapter}|${t}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const g = this.groups.get(id);
    if (!g) throw new Error(`battle: unknown group "${id}"`);
    if (++this.depth > 12) throw new Error(`battle: circular follow/vehicle reference at "${id}"`);
    try {
      const phase = this.phaseFor(g, chapter, m);
      const p = phase ? this.evalPhase(g, phase, m, chapter, t, true) : HIDDEN;
      this.memo.set(key, p);
      return p;
    } finally {
      this.depth--;
    }
  }

  private evalPhase(g: Group, ph: Phase, m: number, chapter: string, t: number, withFalls: boolean): Pose {
    const start = this.target(ph.start, g, m, chapter, t);
    let x = start.x;
    let z = start.z;
    let yOff = start.yOff;
    let yaw = start.yaw ?? (ph.face ?? 0) * DEG;
    let moving = start.moving;
    let vis = start.vis;

    for (const mv of ph.moves ?? []) {
      const d = this.delay(mv, g, m);
      const t0 = mv.from + d;
      const t1 = mv.to + d;
      if (t <= t0) {
        if (mv.appear) vis = false;
        break;
      }
      const b = this.target(mv.target, g, m, chapter, t);
      const p = ease[mv.ease ?? "inOutQuad"](seg(t, t0, t1));
      const dx = b.x - x;
      const dz = b.z - z;
      const travel = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : yaw;
      x += dx * p;
      z += dz * p;
      yOff = lerp(yOff, b.yOff, p);
      vis = b.vis;
      if (t < t1) {
        moving = true;
        yaw = travel;
      } else {
        moving = b.moving;
        yaw = mv.face !== undefined ? mv.face * DEG : (b.yaw ?? travel);
        if (mv.vanish) vis = false;
      }
    }

    let tilt = 0;
    if (ph.melee && t >= ph.melee.from && t <= ph.melee.to && inMembers(ph.melee.members, m)) {
      const s = Math.sin(t * 6 + m) * ph.melee.amplitude;
      x += Math.sin(yaw) * s;
      z += Math.cos(yaw) * s;
      moving = true;
    }

    const c = ph.casualties;
    if (withFalls && c && inMembers(c.members, m) && hash(m, c.seed) < c.fraction) {
      const tf = c.from + hash(m, c.seed + 1) * (c.to - c.from);
      if (t > tf) {
        const fallen = this.evalPhase(g, ph, m, chapter, tf, false);
        return { ...fallen, tilt: -Math.min(1, (t - tf) / 0.4) * (Math.PI / 2), moving: false, vis: fallen.vis && inWindows(ph.visible, t) };
      }
    }

    if (!inWindows(ph.visible, t)) vis = false;
    if (ph.hideInside) {
      const city = this.cities.get(ph.hideInside)!;
      if (Math.hypot(x - city.center[0], z - city.center[1]) < city.radius - 0.05) vis = false;
    }
    if (ph.spin) yaw += ph.spin.amplitude * DEG * Math.sin(t * ph.spin.speed);
    if (g.kind === "vehicle" && g.type === "ship" && this.isDeepWater(x, z)) yOff += Math.sin(t * 1.6 + m) * 0.03;
    const grow = ph.grow ? Math.max(0.01, ease.inOutQuad(seg(t, ph.grow[0], ph.grow[1]))) : 1;
    return { x, z, yOff, yaw, tilt, vis, moving, grow };
  }

  private delay(mv: Move, g: Group, m: number): number {
    const s = mv.stagger;
    if (!s) return 0;
    if (s.random) return hash(m, 97) * s.spread;
    if (s.mod) return ((m % s.mod) / s.mod) * s.spread;
    return (m / g.count) * s.spread;
  }

  /** Slot of member m of a group of n in a formation placed at `at`. */
  slot(f: Formation, m: number, n: number, at: Vec2): Spot {
    if (f.type === "grid") {
      const yaw = f.facing * DEG;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const r = Math.floor(m / f.perRow);
      const col = m % f.perRow;
      const across = (col - (f.perRow - 1) / 2) * f.spacing[0] + (r % 2 ? (f.rowShift ?? 0) : 0);
      const back = r * f.spacing[1];
      let x = at[0] - fz * across - fx * back;
      let z = at[1] + fx * across - fz * back;
      if (f.jitter) {
        x += (hash(m, 41) - 0.5) * f.jitter[0];
        z += (hash(m, 42) - 0.5) * f.jitter[1];
      }
      return { x, z, yOff: 0, yaw, moving: false, vis: true };
    }
    const city = f.city ? this.cities.get(f.city)! : undefined;
    const center = city ? city.center : f.center!;
    const radius = city ? city.radius : f.radius!;
    let a = (f.from + (f.to - f.from) * (n > 1 ? m / (n - 1) : 0.5)) * DEG;
    if (city) {
      // Keep the gate opening free: push members to its edges.
      const half = city.gateHalfWidth / radius;
      const d = Math.atan2(Math.sin(a - city.gateAngle), Math.cos(a - city.gateAngle));
      if (Math.abs(d) < half) a = city.gateAngle + (d >= 0 ? half : -half);
    }
    const x = center[0] + Math.cos(a) * radius;
    const z = center[1] + Math.sin(a) * radius;
    const yOff = city ? city.base + city.wallHeight - this.height(x, z) : 0;
    return { x, z, yOff, yaw: Math.atan2(Math.cos(a), Math.sin(a)), moving: false, vis: true };
  }

  private target(tg: Target, g: Group, m: number, chapter: string, t: number): Spot {
    if ("formation" in tg && !("follow" in tg)) return this.slot(this.data.formations[tg.formation]!, m, g.count, this.resolvePoint(tg.at));
    if ("point" in tg) {
      const p = tg.point;
      const [x, z] = p.length === 3 ? [p[0], p[2]] : [p[0], p[1]];
      const yOff = p.length === 3 ? p[1] - this.height(x, z) : 0;
      return { x, z, yOff, yaw: null, moving: false, vis: true };
    }
    if ("place" in tg) {
      const [x, z] = this.resolvePoint(tg.place);
      return { x, z, yOff: 0, yaw: null, moving: false, vis: true };
    }
    if ("vehicle" in tg) {
      const v = this.groups.get(tg.vehicle)!;
      const s = m % v.count;
      const k = Math.floor(m / v.count);
      const slots = Math.ceil(g.count / v.count);
      const vp = this.pose(v.id, s, chapter, t);
      const deck = DECK[v.type ?? "ship"]!;
      const fx = Math.sin(vp.yaw);
      const fz = Math.cos(vp.yaw);
      const along = (k - (slots - 1) / 2) * deck.along * v.scale;
      const side = ((k % 2) - 0.5) * deck.side * v.scale;
      return { x: vp.x + fx * along + fz * side, z: vp.z + fz * along - fx * side, yOff: vp.yOff + deck.y * v.scale, yaw: vp.yaw, moving: false, vis: vp.vis };
    }
    if ("follow" in tg) {
      const fp = this.pose(tg.follow, tg.index ?? 0, chapter, t);
      const off = tg.formation ? this.slot(this.data.formations[tg.formation]!, m, g.count, tg.at ?? [0, 0]) : { x: tg.at?.[0] ?? 0, z: tg.at?.[1] ?? 0 };
      return { x: fp.x + off.x, z: fp.z + off.z, yOff: 0, yaw: fp.yaw, moving: fp.moving, vis: fp.vis };
    }
    if ("orbit" in tg) {
      const o = tg.orbit;
      const c = this.resolvePoint(o.center);
      const th = (o.startAngle + (o.lead ?? 0)) * DEG + seg(t, o.from, o.to) * o.turns * Math.PI * 2;
      const dir = Math.sign(o.turns) || 1;
      return {
        x: c[0] + Math.cos(th) * o.radius,
        z: c[1] + Math.sin(th) * o.radius,
        yOff: 0,
        yaw: Math.atan2(-Math.sin(th) * dir, Math.cos(th) * dir),
        moving: t > o.from && t < o.to,
        vis: true,
      };
    }
    const pa = tg.path;
    const pts = pa.points;
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
    const total = lens.reduce((s, l) => s + l, 0);
    let d = ease[pa.ease ?? "inOutQuad"](seg(t, pa.from, pa.to)) * total;
    for (let k = 0; k < lens.length; k++) {
      const l = lens[k]!;
      if (d <= l || k === lens.length - 1) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const q = l > 0 ? clamp(d / l) : 1;
        return {
          x: lerp(a[0], b[0], q),
          z: lerp(a[1], b[1], q),
          yOff: 0,
          yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
          moving: t > pa.from && t < pa.to,
          vis: true,
        };
      }
      d -= l;
    }
    return { x: pts[0]![0], z: pts[0]![1], yOff: 0, yaw: null, moving: false, vis: true };
  }
}
