// Mesh builders for the `sky` engine (no canvas needed; works in Node).
import * as THREE from "three";
import type { SkyConstellation } from "@pv/scene-spec";
import { rng } from "../../util/math.ts";

export const UP = new THREE.Vector3(0, 1, 0);
/** Stage: space plate, backdrop and the orbital plane height. */
export const PLATE_R = 10;
export const PLATE_TOP = 0.25;
export const BACK_H = 9;
export const PLANE_Y = 3.4;
/** Backdrop arc: centred behind the stage (-z), ±BACK_ARC radians. */
export const BACK_ARC = 1.4;

export const BODY_COLORS: Record<string, string> = {
  sun: "#ffcf40",
  mercury: "#a39486",
  venus: "#e6c27a",
  earth: "#2f72d6",
  mars: "#cc5a3f",
  jupiter: "#d9a66f",
  saturn: "#e6d08f",
  uranus: "#8fd6df",
  neptune: "#4d6fdc",
  moon: "#cfcac0",
};

export function standard(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
}
export function basic(color: THREE.ColorRepresentation, opacity = 1, extra: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide, ...extra });
}

export interface Body {
  id: string;
  node: THREE.Group;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>;
  /** Night side: a dark hemisphere shell whose pole points away from the Sun. */
  cap: THREE.Mesh | null;
  radius: number;
  base: THREE.Color;
}

/** Sphere body with an optional night cap. */
export function makeBody(id: string, radius: number, color: string, cap = true): Body {
  const node = new THREE.Group();
  node.name = `body:${id}`;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), standard(color));
  node.add(mesh);
  let capMesh: THREE.Mesh | null = null;
  if (cap) {
    capMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), basic("#050a1c", 0.7));
    capMesh.name = `night:${id}`;
    capMesh.userData.key = true; // the night side is the point of the drawing: keep it in ink style
    node.add(capMesh);
  }
  return { id, node, mesh, cap: capMesh, radius, base: new THREE.Color(color) };
}

/** Sun halo: a radial-gradient sprite (browser) or a faint additive shell (Node, no canvas). `pulse` scales it. */
export interface Halo {
  object: THREE.Object3D;
  pulse(k: number): void;
}

/** Radial gradient for the Sun's glow; null without a canvas. */
export function glowTexture(createCanvas?: (w: number, h: number) => HTMLCanvasElement): THREE.Texture | null {
  const c = createCanvas?.(128, 128);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,230,140,1)");
  grad.addColorStop(0.35, "rgba(255,190,60,0.55)");
  grad.addColorStop(1, "rgba(255,150,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The Sun: a bright sphere with a soft glow. Always a key element. */
export function makeSun(radius: number, glow: THREE.Texture | null): { body: Body; halo: Halo } {
  const node = new THREE.Group();
  node.name = "body:sun";
  node.userData.key = true;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), basic(BODY_COLORS.sun!));
  let halo: Halo;
  if (glow) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const base = radius * 4.2;
    sprite.scale.setScalar(base);
    halo = { object: sprite, pulse: (k) => sprite.scale.setScalar(base * (1 + 0.3 * k)) };
  } else {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.3, 24, 12),
      new THREE.MeshBasicMaterial({ color: "#ffb020", transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo = { object: shell, pulse: (k) => shell.scale.setScalar(1 + 0.3 * k) };
  }
  halo.object.name = "sun-glow";
  // Sunlight on the sides of the bodies facing the Sun (lights in hidden views are skipped by three).
  const light = new THREE.PointLight(0xfff1d6, 1.6, 0, 0);
  light.name = "sunlight";
  node.add(mesh, halo.object, light);
  return { body: { id: "sun", node, mesh, cap: null, radius, base: new THREE.Color(BODY_COLORS.sun) }, halo };
}

/** Points the night cap away from the light. `away` is in the body's parent space (bodies are not rotated). */
export function aimCap(b: Body, away: THREE.Vector3): void {
  if (b.cap) b.cap.quaternion.setFromUnitVectors(UP, away.clone().normalize());
}

/** Closed tube through points (an orbit line). */
export function loopTube(points: THREE.Vector3[], radius: number, color: string, opacity = 0.75): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, true);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(64, points.length), radius, 5, true), basic(color, opacity));
  mesh.userData.key = true;
  return mesh;
}

/** Unit rod along +y from y = 0 to y = 1; place with placeRod. */
export function rodGeometry(radius: number): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 8, 1);
  g.translate(0, 0.5, 0);
  return g;
}
const tmpDir = new THREE.Vector3();
export function placeRod(m: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  tmpDir.subVectors(to, from);
  const len = tmpDir.length();
  m.position.copy(from);
  if (len > 1e-9) m.quaternion.setFromUnitVectors(UP, tmpDir.multiplyScalar(1 / len));
  m.scale.set(1, Math.max(len, 1e-4), 1);
}

/** Space plate + curved backdrop + seeded decorative stars. */
export function makeStage(color: string, starCount: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "stage";
  const mat = standard(color, { roughness: 1, side: THREE.DoubleSide });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(PLATE_R, PLATE_R, PLATE_TOP, 72, 1), mat);
  plate.position.y = PLATE_TOP / 2;
  plate.name = "plate";
  const back = new THREE.Mesh(new THREE.CylinderGeometry(PLATE_R, PLATE_R, BACK_H, 64, 1, true, Math.PI - BACK_ARC, 2 * BACK_ARC), mat);
  back.position.y = BACK_H / 2;
  back.name = "backdrop";
  g.add(plate, back);
  if (starCount > 0) {
    const r = rng(seed);
    const pos: number[] = [];
    for (let i = 0; i < starCount; i++) {
      if (i % 3 === 0) {
        // On the plate.
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * (PLATE_R - 0.3);
        pos.push(Math.sin(a) * d, PLATE_TOP + 0.01, Math.cos(a) * d);
      } else {
        const th = Math.PI - BACK_ARC + r() * 2 * BACK_ARC;
        const rr = PLATE_R - 0.04;
        pos.push(Math.sin(th) * rr, 0.5 + r() * (BACK_H - 0.7), Math.cos(th) * rr);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#f3f0ff", size: 0.075, sizeAttenuation: true, transparent: true, opacity: 0.85 }));
    pts.name = "stars";
    g.add(pts);
  }
  return g;
}

export interface ConstellationObj {
  id: string;
  group: THREE.Group;
  stars: THREE.Vector3[];
  center: THREE.Vector3;
}

/** A constellation drawn on the inside of the backdrop (east to the left, as on a sky chart). */
export function makeConstellation(c: SkyConstellation): ConstellationObj {
  const group = new THREE.Group();
  group.name = `constellation:${c.id}`;
  group.userData.key = true;
  const [u, v] = c.at ?? [0, 0.7];
  const size = c.size ?? 4;
  const ra0 = c.stars.reduce((s, x) => s + x.ra, 0) / c.stars.length;
  const dec0 = c.stars.reduce((s, x) => s + x.dec, 0) / c.stars.length;
  // RA differences wrap around 24 h.
  const flat = c.stars.map((s) => {
    let dra = s.ra - ra0;
    if (dra > 12) dra -= 24;
    if (dra < -12) dra += 24;
    return [-dra * 15 * Math.cos(dec0 * (Math.PI / 180)), s.dec - dec0] as const;
  });
  const extent = Math.max(1e-6, ...flat.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) * 2));
  const k = size / extent;
  const R = PLATE_R - 0.12;
  const thC = Math.PI - u * BACK_ARC * 0.85;
  const yC = 1 + v * (BACK_H - 2);
  const at = (x: number, y: number) => {
    const th = thC - (x * k) / R;
    return new THREE.Vector3(Math.sin(th) * R, yC + y * k, Math.cos(th) * R);
  };
  const stars = flat.map(([x, y]) => at(x, y));
  const starMat = basic("#fff4c2");
  c.stars.forEach((s, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + 0.03 * Math.max(0, 4 - (s.mag ?? 2)), 12, 8), starMat);
    m.position.copy(stars[i]!);
    group.add(m);
  });
  const rod = rodGeometry(0.018);
  const lineMat = basic("#9fb8ff", 0.8);
  for (const [a, b] of c.lines) {
    const m = new THREE.Mesh(rod, lineMat);
    placeRod(m, stars[a]!, stars[b]!);
    group.add(m);
  }
  return { id: c.id, group, stars, center: at(0, 0) };
}
