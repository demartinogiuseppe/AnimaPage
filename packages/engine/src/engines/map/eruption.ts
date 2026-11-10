// Volcanic eruption effect: seeded particles whose state is a closed-form function of
// T = t - start (from campania-ar.html, made deterministic). Choreography for the default
// duration of 7.6 s: lava spurts with a flickering light until 4.5 s (out by 5.5 s), ash
// arcs mostly downwind, everything fades from 5.5 s to 7.5 s. Times scale with `duration`.
import * as THREE from "three";
import type { MapData } from "@pv/scene-spec";
import { clamp, rng, seg } from "../../util/math.ts";

// The scene-spec package index exports only MapData, so the parts are derived from it.
type Eruption = MapData["effects"][number];

export interface Ground {
  /** Scene x/z of a lon/lat. */
  xz(lon: number, lat: number): [number, number];
  /** Surface height (scene units) at lon/lat. */
  y(lon: number, lat: number): number;
  isLand(lon: number, lat: number): boolean;
  /** Degrees of longitude per km and of latitude per km at the area centre. */
  degPerKm: [number, number];
}

export class EruptionFx {
  readonly points: THREE.Points;
  readonly light: THREE.PointLight;
  private readonly start: Float32Array; // crater xyz (shared, kept per particle for simplicity)
  private readonly target: Float32Array;
  private readonly apex: Float32Array;
  private readonly delay: Float32Array;
  private readonly dur: Float32Array;
  private readonly k: number;
  private readonly crater: THREE.Vector3;

  constructor(readonly spec: Eruption, ground: Ground, sprite: THREE.Texture | null) {
    const n = spec.lava + spec.ash;
    const r = rng(spec.seed);
    this.k = spec.duration / 7.6;
    const [cx, cz] = ground.xz(spec.geo[0], spec.geo[1]);
    this.crater = new THREE.Vector3(cx, ground.y(spec.geo[0], spec.geo[1]) + 0.02, cz);
    this.start = new Float32Array(n * 3);
    this.target = new Float32Array(n * 3);
    this.apex = new Float32Array(n);
    this.delay = new Float32Array(n);
    this.dur = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    const wind = (spec.windDeg * Math.PI) / 180;
    const [dLon, dLat] = ground.degPerKm;

    for (let i = 0; i < n; i++) {
      const lava = i < spec.lava;
      let lon = spec.geo[0], lat = spec.geo[1];
      // Rejection-sample a landing point on land (at most 8 tries, then keep the last).
      for (let tries = 0; tries < 8; tries++) {
        const km = lava ? 0.6 + r() * 3.4 : 3 + r() * (spec.ashRadiusKm - 3);
        const bearing = lava || r() >= 0.7 ? r() * Math.PI * 2 : wind + (r() - 0.5) * 1.8;
        lon = spec.geo[0] + Math.sin(bearing) * km * dLon;
        lat = spec.geo[1] + Math.cos(bearing) * km * dLat;
        if (ground.isLand(lon, lat)) break;
      }
      const [tx, tz] = ground.xz(lon, lat);
      this.start.set([this.crater.x, this.crater.y, this.crater.z], i * 3);
      this.target.set([tx, Math.max(0, ground.y(lon, lat)) + 0.01, tz], i * 3);
      this.apex[i] = lava ? 0.15 + r() * 0.35 : 0.9 + r() * 1.4;
      this.delay[i] = (lava ? r() * 2.2 : 0.2 + r() * 1.8) * this.k;
      this.dur[i] = (lava ? 0.9 + r() * 0.6 : 2 + r() * 1.2) * this.k;
      c.set(lava ? (r() < 0.5 ? 0xff6a1a : 0xffb020) : r() < 0.5 ? 0x6d6a66 : 0x9a958e);
      colors.set([c.r, c.g, c.b], i * 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false, map: sprite ?? null });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.light = new THREE.PointLight(0xff6a1a, 0, 1.6, 1);
    this.light.position.copy(this.crater).add(new THREE.Vector3(0, 0.15, 0));
  }

  /** Puts the effect in its state at chapter time t (pure). */
  update(chapterId: string, t: number): void {
    const T = t - this.spec.at;
    const on = chapterId === this.spec.chapter && T >= 0 && T <= this.spec.duration;
    this.points.visible = on;
    const k = this.k;
    this.light.intensity = on ? (T < 4.5 * k ? 2.5 * (0.7 + 0.3 * Math.sin(18 * T)) : 2.5 * (1 - seg(T, 4.5 * k, 5.5 * k))) : 0;
    if (!on) return;
    const pos = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.apex.length; i++) {
      const p = clamp((T - this.delay[i]!) / this.dur[i]!);
      const o = i * 3;
      if (p <= 0) {
        // Not launched yet: parked inside the cone, hidden by the terrain.
        arr[o] = this.start[o]!;
        arr[o + 1] = this.start[o + 1]! - 0.05;
        arr[o + 2] = this.start[o + 2]!;
        continue;
      }
      arr[o] = this.start[o]! + (this.target[o]! - this.start[o]!) * p;
      arr[o + 1] = this.start[o + 1]! + (this.target[o + 1]! - this.start[o + 1]!) * p + 4 * p * (1 - p) * this.apex[i]!;
      arr[o + 2] = this.start[o + 2]! + (this.target[o + 2]! - this.start[o + 2]!) * p;
    }
    pos.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 1 - seg(T, 5.5 * k, 7.5 * k);
  }

  /** Fertility ramp 0..1 at (chapter, t): 0 outside the effect's chapter, then held until the chapter ends. */
  fertility(chapterId: string, t: number): number {
    const f = this.spec.fertility;
    if (!f || chapterId !== this.spec.chapter) return 0;
    return seg(t - this.spec.at, f.from, f.to);
  }
}
