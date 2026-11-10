// Procedural theatre set of the `stage` engine: wooden floor, proscenium, curtains, footlights and a
// backdrop made of layered flats (like the cut-out layers of a pop-up book). Plain meshes only, so it
// builds in Node without canvas.
import * as THREE from "three";
import type { StageBackdrop } from "@pv/scene-spec";
import { rng } from "../../util/math.ts";

/** Opening height of the proscenium, metres. */
export const OPENING_H = 3.4;
const PLATFORM_H = 0.3;
const CURTAIN_OPEN_W = 0.55;

export interface StageSet {
  group: THREE.Group;
  /** Left and right curtains: pivot on the outer edge, scale.x = closed..open. */
  curtains: THREE.Group[];
  /** Closed width of one curtain. */
  curtainW: number;
  footlights: THREE.MeshLambertMaterial;
  materials: THREE.Material[];
}

interface Palette {
  wall: string;
  accents: string[];
}

const PALETTES: Record<StageBackdrop, Palette> = {
  piazza: { wall: "#a8d4ec", accents: ["#e3a869", "#d9785b", "#efd08f", "#c96f4a", "#e8bd7d", "#b9654a"] },
  aula: { wall: "#d6e4c8", accents: ["#2f5141", "#8a5a32", "#f2f0e6", "#9cc7e0"] },
  casa: { wall: "#f0d9b5", accents: ["#8a5a3a", "#d98f8f", "#9cc7e0", "#6d8a5a"] },
  bosco: { wall: "#b9dcea", accents: ["#2f6b3f", "#3f8a4c", "#5aa35a", "#7a5434"] },
  palazzo: { wall: "#dccba8", accents: ["#f1e8d6", "#c9b48c", "#9a2f2f"] },
  porto: { wall: "#a8d4ec", accents: ["#3f7fb8", "#6aa5d6", "#f1efe8", "#c0392b", "#7a5434"] },
  vuoto: { wall: "#3a2230", accents: ["#2a1822"] },
};

export function buildSet(opts: { backdrop: StageBackdrop; width: number; depth: number; curtain?: string; floor?: string; wall?: string }): StageSet {
  const { width: W, depth: D } = opts;
  const group = new THREE.Group();
  group.name = "set";
  const materials: THREE.Material[] = [];
  const cache = new Map<string, THREE.MeshLambertMaterial>();
  const mat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
    const key = color + JSON.stringify(extra);
    let m = cache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, ...extra });
      cache.set(key, m);
      materials.push(m);
    }
    return m;
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number, name?: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    if (name) m.name = name;
    parent.add(m);
    return m;
  };

  // Floor: a wooden platform reaching into the wings, with planks.
  const floor = opts.floor ?? "#b98a5a";
  box(group, W + 2 * 0.9 + 0.4, PLATFORM_H, D + 0.3, floor, 0, -PLATFORM_H / 2, 0.15, "floor");
  const plankC = "#" + new THREE.Color(floor).multiplyScalar(0.78).getHexString();
  for (let z = -D / 2 + 0.45; z < D / 2; z += 0.45) box(group, W + 2.2, 0.006, 0.025, plankC, 0, 0.003, z);
  box(group, W + 2.2, 0.12, 0.08, "#6b4a2e", 0, -0.06, D / 2 + 0.3);

  // Proscenium (gold frame) at the front.
  const zf = D / 2 - 0.05;
  const gold = "#c9a14a";
  for (const s of [-1, 1]) box(group, 0.45, OPENING_H + 0.7, 0.35, gold, s * (W / 2 + 0.42), (OPENING_H + 0.7) / 2, zf, s < 0 ? "pillar-left" : "pillar-right");
  box(group, W + 1.3, 0.55, 0.35, gold, 0, OPENING_H + 0.42, zf, "header");
  box(group, W + 1.3, 0.08, 0.4, "#a07a32", 0, OPENING_H + 0.12, zf);

  // Curtains: pleated planes, pivot at the outer edge.
  const red = opts.curtain ?? "#a3242c";
  const curtainMat = mat(red, { side: THREE.DoubleSide });
  const curtainW = W / 2 + 0.15;
  const curtains: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.name = s < 0 ? "curtain-left" : "curtain-right";
    g.position.set(s * (W / 2 + 0.2), 0, zf - 0.3);
    const geo = pleats(curtainW, OPENING_H + 0.15, 22, 0.07);
    geo.translate((-s * curtainW) / 2, (OPENING_H + 0.15) / 2, 0);
    g.add(new THREE.Mesh(geo, curtainMat));
    group.add(g);
    curtains.push(g);
  }
  const valance = new THREE.Mesh(pleats(W + 0.9, 0.55, 40, 0.05), curtainMat);
  valance.position.set(0, OPENING_H - 0.22, zf - 0.22);
  valance.name = "valance";
  group.add(valance);

  // Footlights.
  const footlights = mat("#ffe7a8", { emissive: "#ffcf6a", emissiveIntensity: 0.6 });
  const n = Math.max(5, Math.round(W / 1.1));
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), footlights);
    b.position.set(-W / 2 + 0.5 + (i * (W - 1)) / (n - 1), 0, D / 2 - 0.12);
    group.add(b);
  }

  // Backdrop.
  const back = new THREE.Group();
  back.name = "backdrop";
  back.position.z = -D / 2;
  group.add(back);
  const pal = PALETTES[opts.backdrop];
  box(back, W + 0.6, OPENING_H + 0.3, 0.06, opts.wall ?? pal.wall, 0, (OPENING_H + 0.3) / 2, 0, "wall");
  buildBackdrop(opts.backdrop, pal, W, back, box, mat);

  return { group, curtains, curtainW, footlights, materials };
}

/** Curtain closed (0) .. open (1): each curtain shrinks towards its outer edge. */
export function setCurtains(set: StageSet, open: number): void {
  const k = 1 - open * (1 - CURTAIN_OPEN_W / set.curtainW);
  for (const c of set.curtains) c.scale.x = k;
}

/** A plane with vertical pleats (sinus in z). */
function pleats(w: number, h: number, folds: number, amp: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, folds * 4, 1);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(((p.getX(i) + w / 2) / w) * folds * Math.PI * 2) * amp);
  g.computeVertexNormals();
  return g;
}

type Box = (parent: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number, name?: string) => THREE.Mesh;
type Mat = (color: string, extra?: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial;

function triangle(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-w / 2, 0);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
}

function buildBackdrop(kind: StageBackdrop, pal: Palette, W: number, back: THREE.Group, box: Box, mat: Mat): void {
  const a = pal.accents;
  const R = rng(kind.length * 977 + Math.round(W * 10));
  switch (kind) {
    case "piazza": {
      const n = 5;
      const bw = (W + 0.4) / n;
      const heights = [2.5, 3.05, 2.2, 2.8, 2.4];
      for (let i = 0; i < n; i++) {
        const h = heights[i]!;
        const x = -W / 2 - 0.2 + bw * (i + 0.5);
        const z = 0.12 + (i % 2) * 0.12;
        box(back, bw - 0.04, h, 0.12, a[i % a.length]!, x, h / 2, z);
        box(back, bw, 0.08, 0.18, "#8c5a40", x, h, z);
        const cols = 2;
        for (let r = 0; r < Math.floor((h - 0.6) / 0.62); r++)
          for (let c = 0; c < cols; c++) box(back, 0.24, 0.36, 0.03, "#4a3b35", x + (c - 0.5) * bw * 0.45, 0.85 + r * 0.62, z + 0.07);
      }
      // A bell tower behind.
      box(back, 0.6, 3.3, 0.1, "#c96f4a", W * 0.18, 1.65, 0.05);
      box(back, 0.34, 0.4, 0.03, "#4a3b35", W * 0.18, 2.85, 0.11);
      const roof = new THREE.Mesh(triangle(0.8, 0.45, 0.1), mat("#8c3f2e"));
      roof.position.set(W * 0.18, 3.3, 0.0);
      back.add(roof);
      break;
    }
    case "aula": {
      box(back, 3.0, 1.35, 0.05, a[0]!, 0, 1.75, 0.08, "blackboard");
      box(back, 3.16, 1.5, 0.03, a[1]!, 0, 1.75, 0.05);
      box(back, 3.0, 0.05, 0.12, a[1]!, 0, 1.05, 0.12);
      for (let i = 0; i < 3; i++) box(back, 0.5 + R() * 0.6, 0.02, 0.01, "#e8e8e0", -0.8 + i * 0.7, 2.0 - i * 0.22, 0.11);
      const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 24).rotateX(Math.PI / 2), mat(a[2]!));
      clock.position.set(W * 0.36, 2.75, 0.08);
      back.add(clock);
      box(back, 0.02, 0.15, 0.02, "#222222", W * 0.36, 2.8, 0.12);
      box(back, 0.11, 0.02, 0.02, "#222222", W * 0.36 + 0.05, 2.75, 0.12);
      box(back, 1.0, 1.25, 0.04, a[3]!, -W * 0.38, 2.0, 0.06);
      box(back, 1.1, 0.06, 0.08, "#f2f0e6", -W * 0.38, 2.0, 0.1);
      box(back, 0.06, 1.3, 0.08, "#f2f0e6", -W * 0.38, 2.0, 0.1);
      box(back, W + 0.6, 0.12, 0.04, "#9a8a6a", 0, 0.06, 0.05);
      break;
    }
    case "casa": {
      box(back, 1.3, 1.2, 0.04, a[2]!, -W * 0.2, 1.75, 0.06, "window");
      box(back, 1.4, 0.07, 0.08, "#f6f1e6", -W * 0.2, 1.75, 0.1);
      box(back, 0.07, 1.25, 0.08, "#f6f1e6", -W * 0.2, 1.75, 0.1);
      for (const s of [-1, 1]) box(back, 0.32, 1.45, 0.05, a[1]!, -W * 0.2 + s * 0.78, 1.72, 0.14);
      box(back, 0.95, 2.1, 0.06, a[0]!, W * 0.3, 1.05, 0.06, "door");
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat("#d9b44a"));
      knob.position.set(W * 0.3 + 0.32, 1.0, 0.12);
      back.add(knob);
      box(back, 0.7, 0.5, 0.04, "#8a5a3a", W * 0.05, 2.15, 0.06);
      box(back, 0.6, 0.4, 0.02, a[3]!, W * 0.05, 2.15, 0.09);
      box(back, W + 0.6, 0.16, 0.04, "#8a5a3a", 0, 0.08, 0.05);
      break;
    }
    case "bosco": {
      for (let layer = 0; layer < 3; layer++) {
        const n = 6 - layer;
        const z = 0.12 + layer * 0.2;
        const c = a[layer]!;
        for (let i = 0; i < n; i++) {
          const x = -W / 2 + (W * (i + 0.5 + (R() - 0.5) * 0.4)) / n;
          const h = 2.0 + R() * 1.1 - layer * 0.3;
          box(back, 0.14, h * 0.35, 0.1, a[3]!, x, h * 0.175, z);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5 - layer * 0.04, h * 0.75, 6), mat(c, { flatShading: true }));
          cone.position.set(x, h * 0.3 + h * 0.375, z);
          cone.scale.z = 0.35;
          back.add(cone);
        }
      }
      break;
    }
    case "palazzo": {
      box(back, W + 0.2, 0.22, 0.5, a[1]!, 0, 0.11, 0.25);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x = -W / 2 + 0.5 + (i * (W - 1)) / (n - 1);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 2.55, 14), mat(a[0]!));
        col.position.set(x, 0.22 + 1.275, 0.3);
        back.add(col);
        box(back, 0.42, 0.12, 0.42, a[1]!, x, 2.83, 0.3);
      }
      box(back, W + 0.2, 0.3, 0.5, a[0]!, 0, 3.04, 0.28);
      const ped = new THREE.Mesh(triangle(W * 0.7, 0.55, 0.3), mat(a[0]!));
      ped.position.set(0, 3.19, 0.12);
      back.add(ped);
      box(back, 0.9, 1.9, 0.03, a[2]!, 0, 1.17, 0.06, "drape");
      break;
    }
    case "porto": {
      box(back, W + 0.6, 0.95, 0.12, a[0]!, 0, 0.475, 0.1, "sea");
      for (let i = 0; i < 4; i++) box(back, 0.6 + R() * 0.6, 0.03, 0.02, a[1]!, -W / 2 + 0.6 + i * (W / 4) + R() * 0.3, 0.3 + (i % 2) * 0.35, 0.17);
      const sun = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), mat("#fbe3a0"));
      sun.position.set(-W * 0.3, 2.6, 0.04);
      back.add(sun);
      // Boat.
      box(back, 1.5, 0.3, 0.1, a[4]!, W * 0.1, 1.05, 0.12);
      box(back, 0.05, 1.3, 0.05, a[4]!, W * 0.1, 1.85, 0.12);
      const sail = new THREE.Mesh(triangle(0.8, 1.1, 0.03), mat(a[2]!));
      sail.position.set(W * 0.1 + 0.42, 1.35, 0.13);
      back.add(sail);
      // Lighthouse.
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - i * 0.02, 0.24 - i * 0.02, 0.6, 14), mat(i % 2 ? a[2]! : a[3]!));
        seg.position.set(W * 0.38, 0.95 + i * 0.6, 0.2);
        back.add(seg);
      }
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), mat("#fff3c4", { emissive: "#ffd36a", emissiveIntensity: 0.5 }));
      lamp.position.set(W * 0.38, 3.45, 0.2);
      back.add(lamp);
      // Quay.
      box(back, W + 0.6, 0.18, 0.5, "#9a8f80", 0, 0.09, 0.45);
      for (const x of [-W * 0.35, W * 0.25]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.35, 12), mat("#3b3f45"));
        b.position.set(x, 0.35, 0.55);
        back.add(b);
      }
      break;
    }
    case "vuoto": {
      const drape = new THREE.Mesh(pleats(W + 0.5, OPENING_H + 0.2, 30, 0.06), mat(a[0]!, { side: THREE.DoubleSide }));
      drape.position.set(0, (OPENING_H + 0.2) / 2, 0.1);
      back.add(drape);
      break;
    }
  }
}
