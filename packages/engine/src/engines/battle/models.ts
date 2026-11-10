// Procedural low-poly models for the battle engine (ported from micenei-troia.html).
// Every model faces +z (yaw 0) and stands on y = 0.
import * as THREE from "three";
import { hash } from "../../util/math.ts";

const PI = Math.PI;

export type CanvasFactory = ((w: number, h: number) => HTMLCanvasElement) | undefined;

export const lambert = (color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

function canvasTexture(createCanvas: CanvasFactory, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  if (!createCanvas) return null;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Ox-hide spots for the figure-of-eight shield. */
const hideTexture = (cc: CanvasFactory) =>
  canvasTexture(cc, 128, 128, (g) => {
    g.fillStyle = "#efe5cf";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#6b3f22";
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.ellipse(hash(i, 1) * 128, hash(i, 2) * 128, 10 + hash(i, 3) * 18, 8 + hash(i, 4) * 14, hash(i, 5) * 3, 0, 7);
      g.fill();
    }
  });

/** Cream sail with red stripes. */
export const sailTexture = (cc: CanvasFactory) =>
  canvasTexture(cc, 64, 64, (g) => {
    g.fillStyle = "#efe6d2";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#a3402a";
    for (let i = 0; i < 4; i++) g.fillRect(0, 6 + i * 16, 64, 5);
  });

/** Soft round sprite for fire particles. */
export const glowTexture = (cc: CanvasFactory) =>
  canvasTexture(cc, 64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.4, "rgba(255,255,255,.6)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });

function adder(g: THREE.Object3D) {
  return (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
}

/** Local anchor points of the detailed warrior (unscaled model units). */
export const WARRIOR_PARTS: Record<string, THREE.Vector3> = {
  head: new THREE.Vector3(0, 0.98, 0),
  helmet: new THREE.Vector3(0, 1.12, 0),
  cuirass: new THREE.Vector3(0.06, 0.74, 0.15),
  shield: new THREE.Vector3(-0.1, 0.64, 0.28),
  spear: new THREE.Vector3(0.24, 1.6, 0.04),
};

/** Detailed Mycenaean warrior: greaves, banded cuirass, boar's-tusk helmet, figure-of-eight shield, spear. */
export function buildWarrior(o: { tunic: string; crest: string }, cc: CanvasFactory): THREE.Group {
  const g = new THREE.Group();
  const add = adder(g);
  const bronze = lambert("#b98a3e");
  const skin = lambert("#cf9a6e");
  const ivory = lambert("#efe6cf");
  const dark = lambert("#5a4430");
  const tunic = lambert(o.tunic);
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.05, 0.042, 0.42, 10), skin, s * 0.07, 0.21, 0);
    add(new THREE.CylinderGeometry(0.058, 0.05, 0.2, 10), bronze, s * 0.07, 0.14, 0);
  }
  add(new THREE.CylinderGeometry(0.12, 0.17, 0.16, 14), tunic, 0, 0.47, 0);
  for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.15 + k * 0.012, 0.16 + k * 0.014, 0.06, 18), bronze, 0, 0.585 - k * 0.055, 0);
  add(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 18), bronze, 0, 0.74, 0);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.075, 12, 8, 0, PI * 2, 0, PI / 2), bronze, s * 0.15, 0.82, 0);
    add(new THREE.CylinderGeometry(0.035, 0.03, 0.32, 8), skin, s * 0.19, 0.66, 0, 0, 0, s * 0.15);
  }
  add(new THREE.CylinderGeometry(0.07, 0.11, 0.07, 14), bronze, 0, 0.89, 0);
  add(new THREE.SphereGeometry(0.075, 14, 10), skin, 0, 0.98, 0.005);
  for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.068 - k * 0.012, 0.084 - k * 0.012, 0.036, 16), k % 2 ? dark : ivory, 0, 1.02 + k * 0.034, 0);
  add(new THREE.SphereGeometry(0.02, 8, 6), bronze, 0, 1.17, 0);
  add(new THREE.ConeGeometry(0.03, 0.12, 8), lambert(o.crest), 0, 1.24, 0);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.07, 0.05), ivory, s * 0.078, 0.96, 0.02);
  // figure-of-eight shield
  const sh = new THREE.Group();
  const tex = hideTexture(cc);
  const hm = tex ? lambert("#ffffff", { map: tex }) : lambert("#d9c7a3");
  for (const y of [0.2, -0.2]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), hm);
    m.scale.set(1, 1.05, 0.28);
    m.position.y = y;
    sh.add(m);
  }
  sh.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.06), hm));
  sh.position.set(-0.08, 0.64, 0.2);
  sh.rotation.y = 0.2;
  g.add(sh);
  add(new THREE.CylinderGeometry(0.012, 0.012, 1.7, 6), dark, 0.24, 0.82, 0.04);
  add(new THREE.ConeGeometry(0.026, 0.14, 6), bronze, 0.24, 1.73, 0.04);
  add(new THREE.BoxGeometry(0.03, 0.3, 0.05), bronze, 0.17, 0.42, 0.08, 0, 0, 0.4);
  return g;
}

export function buildHorse(mat: THREE.Material, legsOut?: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
  };
  add(new THREE.BoxGeometry(0.18, 0.2, 0.55), 0, 0.55, 0);
  add(new THREE.BoxGeometry(0.11, 0.3, 0.12), 0, 0.72, 0.3, -0.5);
  add(new THREE.BoxGeometry(0.1, 0.1, 0.22), 0, 0.85, 0.42);
  add(new THREE.BoxGeometry(0.04, 0.22, 0.04), 0, 0.5, -0.3, 0.5);
  for (const [x, z] of [
    [-0.06, 0.22],
    [0.06, 0.22],
    [-0.06, -0.22],
    [0.06, -0.22],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.46, z);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), mat);
    l.position.y = -0.23;
    pivot.add(l);
    g.add(pivot);
    legsOut?.push(pivot);
  }
  return g;
}

export interface ChariotParts {
  wheels: THREE.Object3D[];
  legs: THREE.Object3D[];
}

/** Two-wheeled chariot with two horses and a standing driver. */
export function buildChariot(panelColor: string, horseColor: string): { obj: THREE.Group; parts: ChariotParts } {
  const g = new THREE.Group();
  const add = adder(g);
  const wood = lambert("#7a5232");
  const panel = lambert(panelColor);
  const legs: THREE.Object3D[] = [];
  const wheels: THREE.Object3D[] = [];
  add(new THREE.BoxGeometry(0.5, 0.05, 0.42), wood, 0, 0.32, 0);
  add(new THREE.BoxGeometry(0.52, 0.26, 0.04), panel, 0, 0.47, 0.2);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.18, 0.4), panel, s * 0.25, 0.43, 0);
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.31, 0.26, -0.05);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 6, 20), wood);
    rim.rotation.y = PI / 2;
    w.add(rim);
    for (let k = 0; k < 4; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.46, 0.015), wood);
      sp.rotation.x = (k * PI) / 4;
      w.add(sp);
    }
    g.add(w);
    wheels.push(w);
  }
  add(new THREE.BoxGeometry(0.66, 0.025, 0.025), wood, 0, 0.26, -0.05);
  add(new THREE.BoxGeometry(0.03, 0.03, 0.95), wood, 0, 0.4, 0.65);
  const hm = lambert(horseColor);
  for (const s of [-1, 1]) {
    const h = buildHorse(hm, legs);
    h.position.set(s * 0.13, 0, 1.05);
    g.add(h);
  }
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.34, 10), panel, 0, 0.52, -0.02);
  add(new THREE.SphereGeometry(0.055, 10, 8), lambert("#cf9a6e"), 0, 0.74, -0.02);
  add(new THREE.ConeGeometry(0.06, 0.09, 10), lambert("#efe6cf"), 0, 0.81, -0.02);
  return { obj: g, parts: { wheels, legs } };
}

/** Bronze Age long ship: pitch hull, raked stem, mast, square sail, oars. */
export function buildShip(cc: CanvasFactory): { obj: THREE.Group; sail: THREE.Object3D } {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  g.rotation.y = -PI / 2; // bow along +z
  outer.add(g);
  const pitch = lambert("#2b231e");
  const wood = lambert("#6e4b2e");
  const add = adder(g);
  add(new THREE.BoxGeometry(2.0, 0.26, 0.46), pitch, 0, 0.18, 0);
  add(new THREE.ConeGeometry(0.23, 0.5, 4), pitch, 1.24, 0.18, 0, PI / 4, 0, -PI / 2);
  add(new THREE.BoxGeometry(0.06, 0.5, 0.06), pitch, 1.38, 0.45, 0, 0, 0, -0.35);
  add(new THREE.BoxGeometry(0.08, 0.62, 0.1), pitch, -1.08, 0.45, 0, 0, 0, 0.55);
  add(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), wood, 0.1, 0.95, 0);
  const tex = sailTexture(cc);
  const sailMat = lambert(tex ? "#ffffff" : "#efe6d2", { side: THREE.DoubleSide, ...(tex ? { map: tex } : {}) });
  const sail = add(new THREE.PlaneGeometry(0.9, 0.75), sailMat, 0.12, 1.18, 0, 0, PI / 2, 0);
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.02, 0.5), wood, -0.7 + k * 0.28, 0.2, s * 0.38, s * 0.5);
  return { obj: outer, sail };
}

/** Giant wooden horse on a wheeled platform. */
export function buildWoodenHorse(color = "#8a5a32"): THREE.Group {
  const g = new THREE.Group();
  const hb = buildHorse(lambert(color));
  hb.scale.setScalar(3.1);
  hb.position.y = 0.18;
  g.add(hb);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 2.1), lambert("#6b4425"));
  base.position.y = 0.18;
  g.add(base);
  const wheel = lambert("#4d311b");
  for (const [x, z] of [
    [-0.48, 0.75],
    [0.48, 0.75],
    [-0.48, -0.75],
    [0.48, -0.75],
  ] as const) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), wheel);
    w.rotation.z = PI / 2;
    w.position.set(x, 0.16, z);
    g.add(w);
  }
  return g;
}

export function buildPodium(color = "#e8e2d6"): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.16, 40), lambert(color));
  m.position.y = 0.08;
  g.add(m);
  return g;
}

export function buildHut(color = "#9c8462"): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.5), lambert(color));
  b.position.y = 0.16;
  g.add(b);
  const r = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.32, 4), lambert("#cdb47c"));
  r.position.y = 0.48;
  r.rotation.y = PI / 4;
  g.add(r);
  return g;
}

/** Simple soldier in 6 parts, each an InstancedMesh sharing one matrix per soldier. Height ≈ 0.55. */
export function soldierParts(side: { color: string; helmetColor: string; shieldColor: string }): [THREE.BufferGeometry, string][] {
  return [
    [new THREE.CylinderGeometry(0.045, 0.05, 0.2, 6).translate(0, 0.1, 0), "#a7834a"],
    [new THREE.CylinderGeometry(0.07, 0.09, 0.2, 8).translate(0, 0.3, 0), side.color],
    [new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0.45, 0), "#cf9a6e"],
    [new THREE.ConeGeometry(0.058, 0.09, 8).translate(0, 0.51, 0), side.helmetColor],
    [new THREE.SphereGeometry(0.12, 10, 8).scale(0.85, 1.25, 0.22).translate(0.02, 0.3, 0.11), side.shieldColor],
    [new THREE.CylinderGeometry(0.006, 0.006, 0.8, 4).rotateX(-0.22).translate(0.1, 0.42, 0.02), "#5a4430"],
  ];
}
