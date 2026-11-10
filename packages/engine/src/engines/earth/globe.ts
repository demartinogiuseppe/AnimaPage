// The globe cut like a fruit: one coloured shell per layer, a depth probe with a readout, and
// earthquakes whose P and S rays cross the half globe (see rays.ts).
import * as THREE from "three";
import type { EarthChapter, EarthGlobe, EarthLayer } from "@pv/scene-spec";
import { earthKeyValue } from "@pv/scene-spec";
import { engineText } from "@pv/scene-spec/i18n";
import type { EngineContext } from "../../types.ts";
import { clamp, lerp } from "../../util/math.ts";
import { buildRays, rayAt, S_RATIO, sideOf, surfacePoint, type Ray, type RayModel } from "./rays.ts";
import { basic, fmt, Label, latest, nice, presence, setOpacity, std, windows } from "./util.ts";

/** Visual radius of the globe (scene units). */
export const GLOBE_R = 5;
const DEG = Math.PI / 180;
/** Thinnest drawn layer (share of the radius) when not to scale. */
const MIN_SHARE = 0.06;
const GLOW = new THREE.Color("#ffb347");
const P_COLOR = "#2f6fd6";
const S_COLOR = "#8a3fd1";

/** Visual radii of the layer boundaries (index 0 = surface = R, last = 0). Pure. */
export function visualRadii(g: EarthGlobe, R = GLOBE_R): number[] {
  const real = g.layers.map((l) => (l.bottom - l.top) / g.radius);
  let share = real.slice();
  if (!g.toScale) {
    const small = new Set<number>();
    for (let pass = 0; pass < real.length; pass++) {
      const minTotal = small.size * MIN_SHARE;
      const bigReal = real.reduce((s, x, i) => (small.has(i) ? s : s + x), 0);
      const k = (1 - minTotal) / bigReal;
      share = real.map((x, i) => (small.has(i) ? MIN_SHARE : x * k));
      const before = small.size;
      share.forEach((x, i) => x < MIN_SHARE && small.add(i));
      if (small.size === before) break;
    }
  }
  const out = [R];
  for (const s of share) out.push(Math.max(0, out[out.length - 1]! - s * R));
  out[out.length - 1] = 0;
  return out;
}

/** Layer index and visual radius at a real depth (km). Pure. */
export function depthToRadius(g: EarthGlobe, radii: number[], km: number): { layer: number; r: number } {
  const d = clamp(km, 0, g.radius);
  let i = g.layers.findIndex((l) => d < l.bottom);
  if (i < 0) i = g.layers.length - 1;
  const l = g.layers[i]!;
  return { layer: i, r: lerp(radii[i]!, radii[i + 1]!, (d - l.top) / (l.bottom - l.top)) };
}

/** Readout text for the probe (all numbers come from the scene's sourced layer data). */
export function probeText(l: EarthLayer, km: number): string {
  const p = (km - l.top) / (l.bottom - l.top);
  const lines = [engineText("earth.depth", { km: fmt(Math.round(km)) }), l.name + (l.state ? ` (${engineText(`earth.${l.state}`)})` : "")];
  const values: string[] = [];
  if (l.temp) values.push(`≈ ${fmt(nice(lerp(l.temp[0], l.temp[1], p)))} °C`);
  if (l.pressure) values.push(`≈ ${fmt(nice(lerp(l.pressure[0], l.pressure[1], p)))} GPa`);
  if (values.length) lines.push(values.join(" · "));
  return lines.join("\n");
}

interface Cut {
  group: THREE.Group;
  /** Direction (unit, x-z) of the right and left cut faces. */
  d1: THREE.Vector3;
  d2: THREE.Vector3;
}

interface QuakeView {
  group: THREE.Group;
  rays: { ray: Ray; tube: THREE.Mesh; cum: number[]; dot: THREE.Mesh; segs: number }[];
  stations: { mesh: THREE.Object3D; time: number }[];
  arcs: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; time: number }[];
  /** Ray-time units per chapter second. */
  rate: number;
  times: number[];
}

export interface GlobeObj {
  group: THREE.Group;
  update(entry: EarthChapter, t: number, depth: number | null): void;
  anchor(part: string, index: number | undefined, entry: EarthChapter, t: number, depth: number | null, out: THREE.Vector3): boolean;
  /** Depth (km) the probe uses at t without sliders, or null. */
  probeDepth(entry: EarthChapter, t: number): number | null;
  dispose(): void;
}

const tube = (pts: THREE.Vector3[], r: number, mat: THREE.Material, segs = pts.length - 1) =>
  new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), Math.max(1, segs), r, 5, false), mat);

export function buildGlobe(ctx: EngineContext, model: EarthGlobe, entries: EarthChapter[]): GlobeObj {
  const group = new THREE.Group();
  group.name = "globe";
  const radii = visualRadii(model);
  const R = GLOBE_R;
  const coreIdx = Math.max(1, model.layers.findIndex((l) => l.state === "liquid"));
  const rc = radii[coreIdx]!;
  const layerMats = model.layers.map((l) => std(l.color, { emissive: new THREE.Color(0, 0, 0) }));
  const surfaceMat = std(model.surface ?? "#3f7fbf", { roughness: 0.55 });
  const cuts = new Map<number, Cut>();
  const quakes = new Map<string, QuakeView>();
  const labels: Label[] = [];

  const cutOf = (e: EarthChapter) => e.globe?.cut ?? (e.globe?.quake ? 180 : 90);

  for (const e of entries) {
    if (!e.globe) continue;
    const c = cutOf(e);
    if (cuts.has(c)) continue;
    const g = new THREE.Group();
    g.name = `globe-cut:${c}`;
    const cut = c * DEG;
    const phiStart = Math.PI / 2 + cut / 2;
    const phiLen = Math.PI * 2 - cut;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40, phiStart, phiLen), surfaceMat));
    for (const phi of [phiStart, phiStart + phiLen]) {
      model.layers.forEach((l, i) => {
        const inner = radii[i + 1]!;
        const geo = inner > 1e-3 ? new THREE.RingGeometry(inner, radii[i]!, 72, 1, -Math.PI / 2, Math.PI) : new THREE.CircleGeometry(radii[i]!, 72, -Math.PI / 2, Math.PI);
        const m = new THREE.Mesh(geo.rotateY(phi + Math.PI), layerMats[i]!);
        m.name = `layer:${l.id}`;
        g.add(m);
      });
    }
    const dir = (phi: number) => new THREE.Vector3(-Math.cos(phi), 0, Math.sin(phi));
    group.add(g);
    cuts.set(c, { group: g, d1: dir(phiStart), d2: dir(phiStart + phiLen) });
  }

  // Probe: a needle from the surface along a radius of the left face, a bead at the tip, a readout.
  const probeMat = basic("#222222", 1);
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, -0.5, 0), probeMat);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), std("#ffd23f", { emissive: new THREE.Color("#ffb000"), emissiveIntensity: 0.6 }));
  const probe = new THREE.Group();
  probe.name = "probe";
  probe.add(needle, bead);
  probe.userData.key = true;
  const readout = new Label(ctx, 0.62);
  labels.push(readout);
  readout.object.position.set(-R * 0.75, R + 1.3, 0);
  group.add(probe, readout.object);
  const PROBE_EL = 18 * DEG;

  // Quakes (rays depend on the chapter's settings).
  const model2: RayModel | null = model.shadow ? { R, rc, ...model.shadow } : null;
  for (const e of entries) {
    const q = e.globe?.quake;
    if (!q || !model2) continue;
    const g = new THREE.Group();
    g.name = `quake:${e.chapter}`;
    g.position.z = 0.06;
    g.userData.key = true;
    const rays = buildRays(model2, q.rays ?? 9, q.waves ?? ["P", "S"]).map((ray) => {
      const mat = basic(ray.wave === "P" ? P_COLOR : S_COLOR, 0.9);
      const segs = ray.pts.length - 1;
      const tb = tube(ray.pts, 0.05, mat, segs);
      const cum = [0];
      for (let i = 1; i < ray.pts.length; i++) cum.push(cum[i - 1]! + ray.pts[i]!.distanceTo(ray.pts[i - 1]!));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), basic(ray.wave === "P" ? P_COLOR : S_COLOR, 1));
      g.add(tb, dot);
      return { ray, tube: tb, cum, dot, segs };
    });
    const pRays = rays.filter((r) => r.ray.wave === "P");
    const anti = pRays.length ? Math.max(...pRays.map((r) => r.ray.time[r.ray.time.length - 1]!)) : 2 * R;
    const stations: QuakeView["stations"] = [];
    const arcs: QuakeView["arcs"] = [];
    if (q.stations ?? true) {
      // A station lights up where a ray lands; a stopped S ray leaves a dark mark on the core boundary.
      const stationGeo = new THREE.SphereGeometry(0.16, 12, 8);
      const stopGeo = new THREE.BoxGeometry(0.34, 0.08, 0.04);
      for (const r of rays) {
        const time = r.ray.time[r.ray.time.length - 1]!;
        if (r.ray.stopped) {
          const mesh = new THREE.Group();
          for (const a of [Math.PI / 4, -Math.PI / 4]) mesh.add(new THREE.Mesh(stopGeo, basic("#3b1a5c", 1)).rotateZ(a));
          mesh.position.copy(r.ray.pts[r.ray.pts.length - 1]!);
          g.add(mesh);
          stations.push({ mesh, time });
        } else {
          const mesh = new THREE.Mesh(stationGeo, basic(r.ray.wave === "P" ? P_COLOR : S_COLOR, 1));
          surfacePoint(R * 1.03, r.ray.delta, mesh.position);
          g.add(mesh);
          stations.push({ mesh, time });
        }
      }
      const waves = q.waves ?? ["P", "S"];
      const arc = (wave: "P" | "S", from: number, to: number, rr: number, color: string, time: number) => {
        for (const side of sideOf(wave, waves)) {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= 24; i++) surfacePoint(rr, side * lerp(from, to, i / 24), (pts[i] = new THREE.Vector3()));
          const mat = basic(color, 0.9);
          const mesh = tube(pts, 0.08, mat, 24);
          g.add(mesh);
          arcs.push({ mesh, mat, time });
        }
      };
      const { pFrom, pTo, sFrom } = model2;
      if (waves.includes("P")) arc("P", pFrom, pTo, R * 1.07, "#d63a3a", anti * 0.8);
      if (waves.includes("S")) arc("S", sFrom, 180, R * 1.07, S_COLOR, (anti * 0.8) / S_RATIO);
    }
    group.add(g);
    quakes.set(e.chapter, { group: g, rays, stations, arcs, rate: anti / (q.travel ?? 8), times: q.at });
  }

  const probeDepth = (e: EarthChapter, t: number) => (e.globe?.probe ? earthKeyValue(e.globe.probe, t) : null);

  /** Probe direction on the left face of the current cut. */
  const probeDir = (e: EarthChapter, out: THREE.Vector3) => {
    const c = cuts.get(cutOf(e))!;
    return out.copy(c.d2).multiplyScalar(Math.cos(PROBE_EL)).setY(Math.sin(PROBE_EL)).normalize();
  };

  const dir = new THREE.Vector3();

  return {
    group,
    probeDepth,

    update(e, t, depthOverride) {
      const gv = e.globe;
      group.visible = !!gv && presence(t, gv.at, gv.until) > 0.001;
      if (!gv || !group.visible) return;
      const pres = presence(t, gv.at, gv.until);
      const c = cutOf(e);
      for (const [k, cut] of cuts) cut.group.visible = k === c;
      for (const m of [...layerMats, surfaceMat]) setOpacity(m, 1, pres);
      // Probe.
      const depth = depthOverride ?? probeDepth(e, t);
      let probeLayer = -1;
      probe.visible = depth !== null;
      readout.object.visible = depth !== null;
      if (depth !== null) {
        const { layer, r } = depthToRadius(model, radii, depth);
        probeLayer = layer;
        probeDir(e, dir);
        const len = Math.max(0.001, R + 0.6 - r);
        needle.scale.set(1, len, 1);
        needle.position.copy(dir).multiplyScalar(R + 0.6);
        needle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        bead.position.copy(dir).multiplyScalar(r);
        readout.set(probeText(model.layers[layer]!, clamp(depth, 0, model.radius)));
      }
      // Layer glow (scene windows + the probed layer).
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.6);
      model.layers.forEach((l, i) => {
        const w = Math.max(windows(t, gv.glow?.filter((g) => g.layer === l.id).map((g) => g.window)), i === probeLayer ? 0.7 : 0);
        layerMats[i]!.emissive.copy(GLOW).multiplyScalar(w * (0.14 + 0.16 * pulse));
        layerMats[i]!.userData.key = w > 0.05;
      });
      // Quake.
      for (const [id, q] of quakes) q.group.visible = id === e.chapter;
      const q = quakes.get(e.chapter);
      if (!q) return;
      const start = latest(q.times, t);
      const tau = start === null ? -1 : (t - start) * q.rate;
      q.group.visible = tau >= 0;
      if (tau < 0) return;
      for (const r of q.rays) {
        const hit = rayAt(r.ray, tau, r.dot.position);
        const total = r.cum[r.cum.length - 1]!;
        const d = !hit ? 0 : hit.done ? total : r.cum[hit.index - 1]! + r.dot.position.distanceTo(r.ray.pts[hit.index - 1]!);
        const n = Math.min(r.segs, Math.ceil((r.segs * d) / total));
        r.tube.visible = n > 0;
        // TubeGeometry: radialSegments (5) * 6 indices per tubular segment.
        r.tube.geometry.setDrawRange(0, n * 5 * 6);
        r.dot.visible = hit !== null && !hit.done;
      }
      for (const s of q.stations) s.mesh.visible = tau >= s.time;
      for (const a of q.arcs) {
        a.mesh.visible = tau >= a.time;
        a.mat.opacity = 0.9 * clamp((tau - a.time) / (q.rate * 0.8));
      }
    },

    anchor(part, index, e, t, depthOverride, out) {
      const gv = e.globe;
      if (!gv) return false;
      const c = cuts.get(cutOf(e));
      if (!c) return false;
      const li = model.layers.findIndex((l) => l.id === part);
      if (li >= 0) {
        const el = (55 - 17 * li) * DEG;
        const rr = li === model.layers.length - 1 ? radii[li]! * 0.5 : (radii[li]! + radii[li + 1]!) / 2;
        out.copy(c.d1).multiplyScalar(Math.cos(el) * rr).setY(Math.sin(el) * rr);
      } else if (part === "centre") out.set(0, 0, 0);
      else if (part === "surface") out.set(0, R, 0);
      else if (part === "probe") {
        const depth = depthOverride ?? probeDepth(e, t);
        if (depth === null) return false;
        probeDir(e, out).multiplyScalar(depthToRadius(model, radii, depth).r);
      } else if (part === "readout") out.copy(readout.object.position);
      else if (part === "focus") out.set(0, R, 0.06);
      else if (part === "shadow" || part === "s-shadow") {
        if (!model.shadow) return false;
        const wave = part === "shadow" ? "P" : "S";
        const side = sideOf(wave, e.globe?.quake?.waves ?? ["P", "S"])[0]!;
        const d = part === "shadow" ? (model.shadow.pFrom + model.shadow.pTo) / 2 : (model.shadow.sFrom + 180) / 2;
        surfacePoint(R * 1.08, side * d, out).setZ(0.06);
      } else if (part === "P" || part === "S") {
        const q = quakes.get(e.chapter);
        if (!q) return false;
        const side = sideOf(part, e.globe?.quake?.waves ?? ["P", "S"])[0]!;
        const rays = q.rays.filter((r) => r.ray.wave === part && Math.sign(r.ray.delta) === side);
        const r = rays[Math.min(rays.length - 1, index ?? Math.floor(rays.length / 3))];
        if (!r) return false;
        const start = latest(q.times, t);
        rayAt(r.ray, start === null ? 0 : (t - start) * q.rate, out);
        out.z = 0.06;
      } else return false;
      out.add(group.position);
      return true;
    },

    dispose() {
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geos.add(o.geometry);
          mats.add(o.material as THREE.Material);
        }
      });
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const l of labels) l.dispose();
    },
  };
}
