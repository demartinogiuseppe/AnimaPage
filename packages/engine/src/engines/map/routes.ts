// Animated route arrows for the map engine (migrations, invasions, journeys).
//
// A route is a tube along a smoothed polyline that floats above the relief, revealed from start
// to end; the arrow head rides the tip, growing in as the route starts. Everything is a pure
// function of (chapterId, t): progress and opacity come from the route's chapter windows.
import * as THREE from "three";
import type { MapData } from "@pv/scene-spec";
import { ease, seg } from "../../util/math.ts";
import { densify, type LonLat } from "./geo.ts";

type Route = MapData["routes"][number];

const FADE = 0.6;
const RADIAL = 6;
/** Scene units (the map is `widthUnits`, default 10, wide). */
const RADIUS = 0.032;
const HEAD_RADIUS = 0.11;
const HEAD_LENGTH = 0.3;
const LIFT = 0.07;

export interface RouteState {
  /** 0..1 opacity. */
  level: number;
  /** 0..1 share of the path drawn. */
  progress: number;
}

/** Opacity and progress at (chapterId, t); null when the route has no window in this chapter. */
export function routeState(route: Pick<Route, "show">, chapterId: string, t: number): RouteState | null {
  let best: RouteState | null = null;
  for (const w of route.show) {
    if (w.chapter !== chapterId) continue;
    const from = w.from ?? 0, to = w.to ?? Infinity;
    const appear = w.draw > 0 ? (t >= from ? 1 : 0) : seg(t, from, from + FADE);
    const level = appear * (1 - seg(t, to - FADE, to));
    const progress = ease.inOutQuad(seg(t, from, from + w.draw));
    if (!best || level > best.level || (level === best.level && progress > best.progress)) best = { level, progress };
  }
  return best;
}

export interface RouteGround {
  /** Scene x, z of a point. */
  xz(lon: number, lat: number): [number, number];
  /** Surface y (sea level = 0 or below). */
  y(lon: number, lat: number): number;
  /** Degrees between densified samples. */
  step: number;
}

export class RouteFx {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  private readonly shaft: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly segs: number;
  private readonly length: number;
  private readonly mats: THREE.MeshLambertMaterial[];
  /** Lifted scene position of each `path` point. */
  private readonly vertices: THREE.Vector3[];

  constructor(
    readonly spec: Route,
    ground: RouteGround,
  ) {
    // Densify segment by segment, remembering where each original point lands.
    const pts: LonLat[] = [];
    const at: number[] = [];
    spec.path.forEach((p, k) => {
      at.push(pts.length);
      if (k + 1 < spec.path.length) pts.push(...densify([p, spec.path[k + 1]!] as LonLat[], ground.step).slice(0, -1));
      else pts.push(p as LonLat);
    });
    // Float over the relief: running max of the ground over ±4 samples, so the line does not
    // dive into every valley, plus a constant lift.
    const ys = pts.map(([lon, lat]) => Math.max(0, ground.y(lon, lat)));
    const lifted = pts.map(([lon, lat], i) => {
      let y = 0;
      for (let k = Math.max(0, i - 4); k <= Math.min(ys.length - 1, i + 4); k++) y = Math.max(y, ys[k]!);
      const [x, z] = ground.xz(lon, lat);
      return new THREE.Vector3(x, y + LIFT, z);
    });
    this.vertices = at.map((i) => lifted[i]!.clone());
    this.curve = new THREE.CatmullRomCurve3(lifted, false, "centripetal");
    this.length = this.curve.getLength();
    this.segs = Math.max(8, Math.min(400, Math.round(this.length * 40)));
    const mat = () => new THREE.MeshLambertMaterial({ color: spec.color, transparent: true, opacity: 0, emissive: new THREE.Color(spec.color).multiplyScalar(0.25) });
    this.mats = [mat(), mat()];
    this.shaft = new THREE.Mesh(new THREE.TubeGeometry(this.curve, this.segs, RADIUS * spec.width, RADIAL), this.mats[0]);
    this.shaft.name = `route:${spec.id}`;
    const cone = new THREE.ConeGeometry(HEAD_RADIUS * spec.width, HEAD_LENGTH * spec.width, 16).translate(0, (-HEAD_LENGTH * spec.width) / 2, 0);
    this.head = new THREE.Mesh(cone, this.mats[1]);
    this.head.name = `route-head:${spec.id}`;
    this.group.add(this.shaft, this.head);
    this.group.name = `routes:${spec.id}`;
    this.group.userData.key = true; // visible only while the route is drawn

    this.update("", 0);
  }

  update(chapterId: string, t: number): void {
    const s = routeState(this.spec, chapterId, t);
    const level = s?.level ?? 0;
    this.group.visible = level > 0.001 && s!.progress > 0;
    for (const m of this.mats) m.opacity = level;
    const p = s?.progress ?? 0;
    // The shaft stops where the head's base begins.
    const shaftEnd = Math.max(0, p - (HEAD_LENGTH * this.spec.width * 0.8) / this.length);
    this.shaft.geometry.setDrawRange(0, Math.floor(shaftEnd * this.segs) * RADIAL * 6);
    const tip = this.curve.getPointAt(Math.max(1e-4, p));
    const tangent = this.curve.getTangentAt(Math.max(1e-4, p));
    this.head.position.copy(tip);
    this.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    // The head grows in over the first part of the path.
    const grow = ease.inOutQuad(seg(p, 0, 0.06));
    this.head.scale.setScalar(Math.max(1e-4, grow));
  }

  /**
   * Arrow tip at (chapterId, t), or the fixed `path[index]` point when `index` is given;
   * false when the route is not part of this chapter (or the index does not exist).
   */
  tip(chapterId: string, t: number, out: THREE.Vector3, index?: number): boolean {
    const s = routeState(this.spec, chapterId, t);
    if (!s) return false;
    if (index !== undefined) {
      const v = this.vertices[index];
      if (!v) return false;
      out.copy(v);
    } else out.copy(this.curve.getPointAt(s.progress));
    return true;
  }
}
