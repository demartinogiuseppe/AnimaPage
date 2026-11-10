// The three views of the `sky` engine. Each chapter gets its own view instance (its own group);
// update() places everything from a SkyState, so it is a pure function of the state.
import * as THREE from "three";
import type { Anchor, SkyChapter, SkyPlace } from "@pv/scene-spec";
import {
  aphelion,
  DEG,
  eclToStage,
  julianDay,
  MOON_INCLINATION,
  moonState,
  norm360,
  orbitPath,
  planetPosition,
  poleDirection,
  sunLongitude,
  type Planet,
  type Vec3,
} from "./astro.ts";
import { aimCap, basic, BODY_COLORS, type Body, loopTube, makeBody, makeSun, placeRod, PLANE_Y, rodGeometry } from "./meshes.ts";

export interface SkyState {
  ms: number;
  /** Displayed Earth rotation, radians. */
  spin: number;
  /** Axial tilt drawn, degrees. */
  tilt: number;
  /** Moon slider: elongation from the Sun in degrees, or null = the date's. */
  moon: number | null;
  /** Glow 0..1 of a highlight target at this time. */
  glow(target: string): number;
}

export interface View {
  group: THREE.Group;
  update(s: SkyState): void;
  /** Resolves entity anchors (after update with the same state); false if unknown here. */
  resolve(anchor: Extract<Anchor, { entity: string }>, out: THREE.Vector3): boolean;
  /** Elongation of the Moon shown now (earth-moon view), for the slider value. */
  moonElongation?(): number;
}

const GLOW = new THREE.Color("#ffb347");
const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);

function glowBody(b: Body, k: number) {
  b.node.userData.key = b.id === "sun" || k > 0.05;
  const m = b.mesh.material;
  if ("emissive" in m) m.emissive.copy(GLOW).multiplyScalar(0.45 * k);
}
function glowMat(o: THREE.Object3D, m: THREE.MeshBasicMaterial, base: THREE.Color, k: number) {
  m.color.copy(base).lerp(GLOW, 0.6 * k);
  o.userData.key = true;
}

// ------------------------------------------------------------------ Earth model (close-up views)

interface Earth extends Body {
  frame: THREE.Group;
  spin: THREE.Group;
  axis: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  rings: THREE.Group;
  ringMats: { equator: THREE.MeshBasicMaterial; tropics: THREE.MeshBasicMaterial; polar: THREE.MeshBasicMaterial };
  places: Map<string, THREE.Mesh>;
  tiltShown: number;
}

const RING_COLORS = { equator: new THREE.Color("#ffe066"), tropics: new THREE.Color("#ff8a3d"), polar: new THREE.Color("#bfe3ff") };

function makeEarth(radius: number, places: readonly SkyPlace[], latitudes: boolean): Earth {
  const b = makeBody("earth", radius, BODY_COLORS.earth!);
  const frame = new THREE.Group();
  frame.name = "earth-frame";
  const spin = new THREE.Group();
  spin.name = "earth-spin";
  b.node.add(frame);
  frame.add(spin);
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.035, radius * 0.035, radius * 3, 8), basic("#f4f1ea"));
  axis.name = "axis";
  frame.add(axis);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.08, 12, 8), basic("#e04848"));
  tip.position.y = radius * 1.5;
  axis.add(tip);
  // Meridians turn with the Earth so the rotation is visible (not real geography).
  const merMat = basic("#cfe3ff", 0.45);
  for (let k = 0; k < 6; k++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.004, radius * 0.007, 4, 72), merMat);
    m.rotation.y = (k * Math.PI) / 6;
    spin.add(m);
  }
  const placeMap = new Map<string, THREE.Mesh>();
  for (const p of places) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.075, 12, 8), basic(p.color ?? "#ff9f1c"));
    const phi = p.lat * DEG, lam = p.lon * DEG;
    dot.position.set(Math.cos(phi) * Math.cos(lam), Math.sin(phi), -Math.cos(phi) * Math.sin(lam)).multiplyScalar(radius * 1.01);
    dot.name = `place:${p.id}`;
    dot.userData.key = true;
    spin.add(dot);
    placeMap.set(p.id, dot);
  }
  const rings = new THREE.Group();
  rings.name = "latitudes";
  rings.visible = latitudes;
  frame.add(rings);
  const ringMats = { equator: basic(RING_COLORS.equator), tropics: basic(RING_COLORS.tropics), polar: basic(RING_COLORS.polar) };
  return { ...b, frame, spin, axis, rings, ringMats, places: placeMap, tiltShown: NaN };
}

/** Rebuilds the equator, tropics and polar circles for a tilt (only when it changes). */
function setRings(e: Earth, tilt: number) {
  if (e.tiltShown === tilt) return;
  e.tiltShown = tilt;
  for (const c of [...e.rings.children]) {
    e.rings.remove(c);
    (c as THREE.Mesh).geometry.dispose();
  }
  const r = e.radius;
  const ring = (lat: number, mat: THREE.MeshBasicMaterial, name: string) => {
    const rr = Math.cos(lat * DEG) * r * 1.006;
    if (rr < r * 0.02) return;
    const m = new THREE.Mesh(new THREE.TorusGeometry(rr, r * 0.016, 4, 80), mat);
    m.rotation.x = Math.PI / 2;
    m.position.y = Math.sin(lat * DEG) * r * 1.006;
    m.name = name;
    e.rings.add(m);
  };
  ring(0, e.ringMats.equator, "equator");
  if (tilt > 0.05) {
    ring(tilt, e.ringMats.tropics, "tropic-n");
    ring(-tilt, e.ringMats.tropics, "tropic-s");
    ring(90 - tilt, e.ringMats.polar, "arctic");
    ring(-(90 - tilt), e.ringMats.polar, "antarctic");
  }
}

/** Orients the Earth (axis fixed in space at `tilt`, spun by `spin`) and its night side. */
function poseEarth(e: Earth, s: SkyState, away: THREE.Vector3) {
  e.frame.rotation.set(-s.tilt * DEG, 0, 0);
  e.spin.rotation.set(0, s.spin, 0);
  setRings(e, s.tilt);
  aimCap(e, away);
  const kAxis = s.glow("axis");
  glowMat(e.axis, e.axis.material, new THREE.Color("#f4f1ea"), kAxis);
  e.axis.userData.key = true;
  e.ringMats.equator.color.copy(RING_COLORS.equator).lerp(GLOW, 0.7 * s.glow("equator"));
  e.ringMats.tropics.color.copy(RING_COLORS.tropics).lerp(new THREE.Color("#ff3b1f"), 0.7 * s.glow("tropics"));
  e.rings.userData.key = s.glow("equator") > 0.05 || s.glow("tropics") > 0.05;
  glowBody(e, s.glow("earth"));
}

/** Earth anchors: poles, latitude points on the meridian facing the Sun, places. */
function resolveEarth(e: Earth, part: string | undefined, toSun: THREE.Vector3, tilt: number, out: THREE.Vector3): boolean {
  const c = e.node.position;
  if (part === undefined) return void out.copy(c), true;
  const pole = v3(poleDirection(tilt));
  if (part === "north" || part === "south") {
    out.copy(c).addScaledVector(pole, (part === "north" ? 1 : -1) * e.radius * 1.5);
    return true;
  }
  const lats: Record<string, number> = { equator: 0, "tropic-n": tilt, "tropic-s": -tilt, arctic: 90 - tilt, antarctic: tilt - 90 };
  const sun = toSun.clone().normalize();
  let lat: number | undefined = lats[part];
  if (part === "subsolar") lat = Math.asin(THREE.MathUtils.clamp(sun.dot(pole), -1, 1)) / DEG;
  else if (part.startsWith("lat:")) lat = Number(part.slice(4));
  if (lat === undefined || !Number.isFinite(lat)) return false;
  const m = sun.clone().addScaledVector(pole, -sun.dot(pole));
  if (m.lengthSq() < 1e-9) m.set(1, 0, 0);
  m.normalize();
  out.copy(c).addScaledVector(m, Math.cos(lat * DEG) * e.radius).addScaledVector(pole, Math.sin(lat * DEG) * e.radius);
  return true;
}

function resolvePlace(e: Earth, id: string | undefined, out: THREE.Vector3): boolean {
  const dot = id ? e.places.get(id) : undefined;
  if (!dot) return false;
  // World matrix of the dot relative to the view group: walk up to the earth node's parent.
  out.copy(dot.position);
  for (let n: THREE.Object3D | null = dot.parent; n && n !== e.node.parent; n = n.parent) {
    n.updateMatrix();
    out.applyMatrix4(n.matrix);
  }
  return true;
}

// ------------------------------------------------------------------ system view

/** Radius of the outermost orbit on stage. */
const SYSTEM_R = 9;
const PLANET_SIZE: Record<Planet, number> = {
  mercury: 0.16, venus: 0.25, earth: 0.27, mars: 0.2, jupiter: 0.6, saturn: 0.5, uranus: 0.37, neptune: 0.36,
};

export function systemScale(bodies: readonly Planet[], distances: "linear" | "compressed"): (r: number) => number {
  const g = distances === "compressed" ? (r: number) => Math.pow(r, 0.4) : (r: number) => r;
  const rmax = Math.max(...bodies.map(aphelion));
  return (r) => (SYSTEM_R * g(r)) / g(rmax);
}

/** Heliocentric ecliptic position (au) -> stage, scaled radially. */
export function systemPoint(p: Vec3, scale: (r: number) => number): THREE.Vector3 {
  const r = Math.hypot(p[0], p[1], p[2]);
  const k = r > 0 ? scale(r) / r : 0;
  const s = eclToStage(p);
  return new THREE.Vector3(s[0] * k, PLANE_Y + s[1] * k, s[2] * k);
}

export function createSystemView(c: SkyChapter, startMs: number, glow: THREE.Texture | null = null): View {
  const group = new THREE.Group();
  group.name = `view:system:${c.chapter}`;
  const bodies = (c.bodies ?? ["mercury", "venus", "earth", "mars"]) as Planet[];
  const scale = systemScale(bodies, c.distances ?? "linear");
  const { body: sun, halo } = makeSun(bodies.some((b) => aphelion(b) > 2) ? 0.85 : 1.1, glow);
  sun.node.position.set(0, PLANE_Y, 0);
  group.add(sun.node);
  const planets = bodies.map((p) => {
    const b = makeBody(p, PLANET_SIZE[p], BODY_COLORS[p]!);
    if (p === "saturn") {
      const ring = new THREE.Mesh(new THREE.RingGeometry(PLANET_SIZE.saturn * 1.35, PLANET_SIZE.saturn * 2.1, 48), basic("#d8c58a", 0.8));
      ring.rotation.x = -Math.PI / 2 + 0.47;
      b.node.add(ring);
    }
    group.add(b.node);
    const pts = orbitPath(p, julianDay(startMs), 240).map((q) => systemPoint(q, scale));
    const orbit = loopTube(pts, 0.025, "#8ea2d8", 0.6);
    orbit.name = `orbit:${p}`;
    orbit.visible = c.orbits !== false;
    group.add(orbit);
    return { p, b, orbit, orbitMat: orbit.material as THREE.MeshBasicMaterial };
  });
  const orbitBase = new THREE.Color("#8ea2d8");
  return {
    group,
    update(s) {
      const jd = julianDay(s.ms);
      glowBody(sun, s.glow("sun"));
      halo.pulse(s.glow("sun"));
      const kOrbit = s.glow("orbit");
      for (const { p, b, orbit, orbitMat } of planets) {
        b.node.position.copy(systemPoint(planetPosition(p, jd), scale));
        aimCap(b, b.node.position.clone().sub(sun.node.position));
        glowBody(b, s.glow(p));
        glowMat(orbit, orbitMat, orbitBase, Math.max(kOrbit, s.glow(p)));
      }
    },
    resolve(a, out) {
      if (a.entity === "sun") return void out.copy(sun.node.position), true;
      if (a.entity === "orbit") {
        const pl = planets.find((x) => x.p === a.part);
        if (!pl) return false;
        // Point of the orbit at ecliptic longitude `index`: nearest sampled point.
        const lon = norm360(a.index ?? 0);
        const pts = orbitPath(pl.p, julianDay(startMs), 360);
        let best = pts[0]!;
        let bestD = Infinity;
        for (const q of pts) {
          const d = Math.abs(norm360(Math.atan2(q[1], q[0]) / DEG - lon + 180) - 180);
          if (d < bestD) (bestD = d), (best = q);
        }
        out.copy(systemPoint(best, scale));
        return true;
      }
      const pl = planets.find((x) => x.p === a.entity);
      if (!pl || a.part !== undefined) return false;
      out.copy(pl.b.node.position);
      return true;
    },
  };
}

// ------------------------------------------------------------------ earth-sun view

export const EARTH_ORBIT_R = 7;
const ES_EARTH_R = 0.9;
const ES_SUN_R = 1.4;
const RAY_OFFSETS = [-0.8, -0.4, 0, 0.4, 0.8];

export function createEarthSunView(c: SkyChapter, startMs: number, places: readonly SkyPlace[], glow: THREE.Texture | null = null): View {
  const group = new THREE.Group();
  group.name = `view:earth-sun:${c.chapter}`;
  const { body: sun, halo } = makeSun(ES_SUN_R, glow);
  sun.node.position.set(0, PLANE_Y, 0);
  const earth = makeEarth(ES_EARTH_R, places, c.latitudes ?? true);
  group.add(sun.node, earth.node);
  const orbitPts = orbitPath("earth", julianDay(startMs), 240).map((q) => {
    const s = eclToStage(q);
    return new THREE.Vector3(s[0] * EARTH_ORBIT_R, PLANE_Y + s[1] * EARTH_ORBIT_R, s[2] * EARTH_ORBIT_R);
  });
  const orbit = loopTube(orbitPts, 0.03, "#8ea2d8", 0.6);
  orbit.name = "orbit:earth";
  orbit.visible = c.orbits !== false;
  group.add(orbit);
  const orbitBase = new THREE.Color("#8ea2d8");
  const rays = new THREE.Group();
  rays.name = "rays";
  rays.visible = c.rays === true;
  rays.userData.key = true;
  const rayGeo = rodGeometry(0.035);
  const rayBase = new THREE.Color("#ffd23f");
  const rayMats = RAY_OFFSETS.map((h) => basic(h === 0 ? "#fff1a8" : "#ffd23f", 0.9));
  const rayMeshes = RAY_OFFSETS.map((_, i) => new THREE.Mesh(rayGeo, rayMats[i]!));
  rays.add(...rayMeshes);
  group.add(rays);
  const rayEnds = RAY_OFFSETS.map(() => new THREE.Vector3());
  let tilt = 23.44;

  const earthPos = (ms: number) => {
    const s = eclToStage(planetPosition("earth", julianDay(ms)));
    return new THREE.Vector3(s[0] * EARTH_ORBIT_R, PLANE_Y + s[1] * EARTH_ORBIT_R, s[2] * EARTH_ORBIT_R);
  };

  return {
    group,
    update(s) {
      tilt = s.tilt;
      earth.node.position.copy(earthPos(s.ms));
      const away = earth.node.position.clone().sub(sun.node.position);
      poseEarth(earth, s, away);
      glowBody(sun, s.glow("sun"));
      halo.pulse(s.glow("sun"));
      glowMat(orbit, orbit.material as THREE.MeshBasicMaterial, orbitBase, s.glow("orbit"));
      // Parallel rays from the Sun hitting the Earth, in the plane of the Sun direction and the axis.
      const u = away.clone().normalize();
      const pole = v3(poleDirection(s.tilt));
      const w = pole.clone().addScaledVector(u, -pole.dot(u));
      if (w.lengthSq() < 1e-9) w.set(0, 1, 0);
      w.normalize();
      const dist = away.length();
      const kRays = s.glow("rays");
      RAY_OFFSETS.forEach((h, i) => {
        const hh = h * ES_EARTH_R;
        const end = earth.node.position.clone().addScaledVector(w, hh).addScaledVector(u, -Math.sqrt(ES_EARTH_R ** 2 - hh * hh));
        const start = earth.node.position.clone().addScaledVector(w, hh).addScaledVector(u, -(dist - ES_SUN_R - 0.15));
        placeRod(rayMeshes[i]!, start, end);
        rayEnds[i]!.copy(end);
        rayMats[i]!.color.copy(h === 0 ? new THREE.Color("#fff1a8") : rayBase).lerp(GLOW, 0.5 * kRays);
      });
    },
    resolve(a, out) {
      switch (a.entity) {
        case "sun":
          return void out.copy(sun.node.position), true;
        case "earth":
          return resolveEarth(earth, a.part, sun.node.position.clone().sub(earth.node.position), tilt, out);
        case "place":
          return resolvePlace(earth, a.part, out);
        case "ray":
          return void out.copy(rayEnds[Math.min(4, Math.max(0, a.index ?? 2))]!), true;
        case "orbit": {
          if (a.part !== "earth") return false;
          const lon = (a.index ?? 0) * DEG;
          out.set(Math.cos(lon) * EARTH_ORBIT_R, PLANE_Y, -Math.sin(lon) * EARTH_ORBIT_R);
          return true;
        }
        default:
          return false;
      }
    },
  };
}

// ------------------------------------------------------------------ earth-moon view (Sun-fixed frame)

export const EM_EARTH = new THREE.Vector3(2, PLANE_Y, 0);
export const EM_SUN = new THREE.Vector3(-9, PLANE_Y, 0);
export const MOON_ORBIT_R = 5.5;
export const EM_EARTH_R = 0.7;
export const EM_MOON_R = 0.25;
/** Length at which the Earth's umbra cone would close (true ratio: 0.72 Earth radii left at the Moon's distance). */
const UMBRA_TIP = MOON_ORBIT_R / (1 - 0.72);
const UMBRA_DRAWN = 7.6;
export const PHASE_POS = new THREE.Vector3(3.6, 6.7, -7.6);
const PHASE_R = 0.85;
const MOON_GREY = new THREE.Color(BODY_COLORS.moon);
const MOON_RED = new THREE.Color("#9a3f22");

/** Direction in the orbital plane at angle psi from the Sun direction (0 = towards the Sun, counter-clockwise from above). */
const planeDir = (psi: number) => new THREE.Vector3(-Math.cos(psi), 0, Math.sin(psi));

export interface MoonPlacement {
  /** Moon position (stage). */
  pos: THREE.Vector3;
  /** Elongation actually drawn, degrees (differs from the true one by a few degrees: exaggerated tilt). */
  elongation: number;
  /** Elongation of the date (or the slider), degrees. */
  trueElongation: number;
  /** Orbit orientation: node direction and the "after the node" direction (tilted). */
  node: THREE.Vector3;
  ahead: THREE.Vector3;
}

/**
 * Moon on its drawn orbit: the orbit is a circle tilted by `moonTilt` × 5.145° about the line of
 * nodes; the Moon sits at the orbit angle whose true latitude matches the date's (so eclipses come
 * at the right dates), on the side of the node its longitude says. `override` = elongation slider.
 */
export function placeMoon(ms: number, moonTilt: number, override: number | null): MoonPlacement {
  const jd = julianDay(ms);
  const m = moonState(jd);
  const lsun = sunLongitude(jd);
  const nodePsi = (m.node - lsun) * DEG;
  const i = MOON_INCLINATION * DEG;
  const iD = Math.min(80, MOON_INCLINATION * moonTilt) * DEG;
  const node = planeDir(nodePsi);
  const along = planeDir(nodePsi + Math.PI / 2);
  const ahead = along.clone().multiplyScalar(Math.cos(iD)).add(new THREE.Vector3(0, Math.sin(iD), 0));
  const delta = (m.elongation * DEG - nodePsi) % (2 * Math.PI);
  const su = THREE.MathUtils.clamp(Math.sin(m.lat * DEG) / Math.sin(i), -1, 1);
  let u = Math.atan2(su, Math.sign(Math.cos(delta) || 1) * Math.sqrt(1 - su * su));
  if (override !== null) u += override * DEG - m.elongation * DEG;
  const pos = EM_EARTH.clone().addScaledVector(node, Math.cos(u) * MOON_ORBIT_R).addScaledVector(ahead, Math.sin(u) * MOON_ORBIT_R);
  const rel = pos.clone().sub(EM_EARTH);
  const elongation = norm360(Math.atan2(rel.z, -rel.x) / DEG);
  return { pos, elongation, node, ahead, trueElongation: override ?? m.elongation };
}

export interface EclipseState {
  /** 0..1: how much of the Moon is inside the Earth's umbra. */
  lunar: number;
  /** Distance of the Moon's shadow axis from the Earth's centre (Earth radii), Infinity if it misses. */
  solarOffset: number;
  /** Where the Moon's shadow axis meets the Earth's day side, if it does. */
  spot: THREE.Vector3 | null;
}

export function eclipseAt(moon: THREE.Vector3): EclipseState {
  const rel = moon.clone().sub(EM_EARTH);
  const off = Math.hypot(rel.y, rel.z);
  let lunar = 0;
  if (rel.x > 0) {
    const umbra = EM_EARTH_R * (1 - rel.x / UMBRA_TIP);
    lunar = THREE.MathUtils.clamp((umbra + EM_MOON_R - off) / (2 * EM_MOON_R), 0, 1);
  }
  let solarOffset = Infinity;
  let spot: THREE.Vector3 | null = null;
  if (rel.x < 0) {
    solarOffset = off / EM_EARTH_R;
    if (off < EM_EARTH_R) spot = new THREE.Vector3(EM_EARTH.x - Math.sqrt(EM_EARTH_R ** 2 - off * off) - 0.012, moon.y, moon.z);
  }
  return { lunar, solarOffset, spot };
}

export function createEarthMoonView(c: SkyChapter, places: readonly SkyPlace[], glow: THREE.Texture | null = null): View {
  const group = new THREE.Group();
  group.name = `view:earth-moon:${c.chapter}`;
  const moonTilt = c.moonTilt ?? 6;
  const { body: sun, halo } = makeSun(1.6, glow);
  sun.node.position.copy(EM_SUN);
  const earth = makeEarth(EM_EARTH_R, places, c.latitudes ?? false);
  earth.node.position.copy(EM_EARTH);
  const moon = makeBody("moon", EM_MOON_R, BODY_COLORS.moon!);
  group.add(sun.node, earth.node, moon.node);

  // Orbit: a unit circle in the x-z plane, oriented by a basis (node, normal, ahead) each update.
  const ring = new THREE.Group();
  ring.name = "orbit:moon";
  ring.visible = c.orbits !== false;
  const circle = Array.from({ length: 120 }, (_, k) => {
    const a = (k / 120) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * MOON_ORBIT_R, 0, Math.sin(a) * MOON_ORBIT_R);
  });
  const orbit = loopTube(circle, 0.022, "#8ea2d8", 0.6);
  ring.add(orbit);
  ring.position.copy(EM_EARTH);
  group.add(ring);
  const orbitBase = new THREE.Color("#8ea2d8");

  // Shadows: unit cones (base radius 1 at y = 0, tip at y = 1), pointing away from the Sun (+x).
  const shadows = new THREE.Group();
  shadows.name = "shadows";
  shadows.visible = c.shadows === true;
  shadows.userData.key = true;
  const shadowMat = basic("#000000", 0.3, { side: THREE.FrontSide });
  const cone = new THREE.CylinderGeometry(0, 1, 1, 40, 1, true).translate(0, 0.5, 0);
  const earthUmbra = new THREE.Mesh(new THREE.CylinderGeometry(EM_EARTH_R * (1 - UMBRA_DRAWN / UMBRA_TIP), EM_EARTH_R, UMBRA_DRAWN, 40, 1, true).translate(0, UMBRA_DRAWN / 2, 0), shadowMat);
  earthUmbra.name = "shadow:earth";
  earthUmbra.rotation.z = -Math.PI / 2;
  earthUmbra.position.copy(EM_EARTH);
  const moonUmbra = new THREE.Mesh(cone, shadowMat);
  moonUmbra.name = "shadow:moon";
  moonUmbra.rotation.z = -Math.PI / 2;
  const penumbra = new THREE.Mesh(new THREE.CircleGeometry(EM_EARTH_R * 0.42, 32), basic("#0a0f24", 0.45));
  const umbraSpot = new THREE.Mesh(new THREE.CircleGeometry(EM_EARTH_R * 0.1, 24), basic("#000000", 0.95));
  for (const m of [penumbra, umbraSpot]) m.rotation.y = -Math.PI / 2; // facing the Sun (-x)
  const spotGroup = new THREE.Group();
  spotGroup.name = "shadow-spot";
  spotGroup.add(penumbra, umbraSpot);
  umbraSpot.position.x = -0.004;
  shadows.add(earthUmbra, moonUmbra, spotGroup);
  group.add(shadows);

  // Phase window: the Moon as seen from Earth (the reader stands where the Earth is, looking at it).
  const phase = new THREE.Group();
  phase.name = "phase";
  phase.visible = c.phase !== false;
  phase.position.copy(PHASE_POS);
  const pmoon = makeBody("phase-moon", PHASE_R, BODY_COLORS.moon!);
  pmoon.node.userData.key = true;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(PHASE_R * 1.28, 0.05, 6, 64), basic("#e9dcc0"));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(PHASE_R * 1.26, 48), basic("#0b1230"));
  disc.position.z = -PHASE_R * 1.05;
  phase.add(disc, frame, pmoon.node);
  group.add(phase);
  const frameBase = new THREE.Color("#e9dcc0");

  let shownElong = 0;
  return {
    group,
    update(s) {
      const pl = placeMoon(s.ms, moonTilt, s.moon);
      shownElong = pl.trueElongation;
      moon.node.position.copy(pl.pos);
      const normal = pl.ahead.clone().cross(pl.node).normalize();
      ring.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(pl.node, normal, pl.ahead));
      const awayE = new THREE.Vector3(1, 0, 0);
      poseEarth(earth, s, awayE);
      const awayM = pl.pos.clone().sub(EM_SUN).normalize();
      aimCap(moon, awayM);
      glowBody(moon, s.glow("moon"));
      glowBody(sun, s.glow("sun"));
      halo.pulse(s.glow("sun"));
      glowMat(orbit, orbit.material as THREE.MeshBasicMaterial, orbitBase, s.glow("orbit"));

      const ecl = eclipseAt(pl.pos);
      const tint = MOON_GREY.clone().lerp(MOON_RED, shadows.visible ? ecl.lunar : 0);
      (moon.mesh.material as THREE.MeshStandardMaterial).color.copy(tint);
      (pmoon.mesh.material as THREE.MeshStandardMaterial).color.copy(tint);

      // Moon's umbra: from the Moon away from the Sun, its tip just reaching the Earth when the Moon is between.
      const len = pl.pos.x < EM_EARTH.x ? Math.max(0.5, EM_EARTH.x - pl.pos.x - EM_EARTH_R * 0.55) : 2.4;
      moonUmbra.position.copy(pl.pos);
      moonUmbra.scale.set(EM_MOON_R, len, EM_MOON_R);
      spotGroup.visible = ecl.spot !== null;
      if (ecl.spot) spotGroup.position.copy(ecl.spot);
      shadowMat.opacity = 0.3 + 0.2 * s.glow("shadow");

      // Phase window: rotate the scene so the Moon->Earth direction faces the reader (+z), ecliptic north up.
      const f = EM_EARTH.clone().sub(pl.pos).normalize();
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(f, -f.y).normalize();
      const right = up.clone().cross(f);
      const n = awayM;
      if (pmoon.cap) pmoon.cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(right.dot(n), up.dot(n), f.dot(n)).normalize());
      const kPhase = s.glow("phase");
      (frame.material as THREE.MeshBasicMaterial).color.copy(frameBase).lerp(GLOW, 0.7 * kPhase);
      phase.userData.key = true;
    },
    resolve(a, out) {
      switch (a.entity) {
        case "sun":
          return void out.copy(sun.node.position), true;
        case "moon":
          return a.part === undefined && (out.copy(moon.node.position), true);
        case "earth":
          return resolveEarth(earth, a.part, EM_SUN.clone().sub(EM_EARTH), earth.tiltShown, out);
        case "place":
          return resolvePlace(earth, a.part, out);
        case "phase":
          return void out.copy(PHASE_POS).add(new THREE.Vector3(0, PHASE_R * 1.5, 0)), true;
        case "shadow":
          if (a.part === "earth") return void out.copy(EM_EARTH).add(new THREE.Vector3(MOON_ORBIT_R, 0, 0)), true;
          if (a.part === "moon") {
            out.copy(spotGroup.visible ? spotGroup.position : EM_EARTH.clone().add(new THREE.Vector3(-EM_EARTH_R, 0, 0)));
            return true;
          }
          return false;
        case "orbit": {
          if (a.part !== "moon") return false;
          out.copy(EM_EARTH).addScaledVector(planeDir((a.index ?? 0) * DEG), MOON_ORBIT_R);
          return true;
        }
        default:
          return false;
      }
    },
    moonElongation: () => shownElong,
  };
}
