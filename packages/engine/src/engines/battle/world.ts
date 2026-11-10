// Terrain (areas, hills, mountains, islands, rivers) and the parametric fortified city.
import * as THREE from "three";
import type { BattleData } from "@pv/scene-spec";
import { hash } from "../../util/math.ts";
import { lambert } from "./models.ts";

type World = BattleData["world"];
type City = NonNullable<BattleData["cities"]>[number];

export interface Terrain {
  group: THREE.Group;
  height(x: number, z: number): number;
  /** Afloat (not beached): inside a water area, more than 1.2 units from its edge. */
  isDeepWater(x: number, z: number): boolean;
  /** Water materials with their day/night colours. */
  water: { mat: THREE.MeshPhongMaterial; day: THREE.Color; night: THREE.Color }[];
  /** Top points for anchors: hills, mountains, islands; river mid points. */
  tops: Map<string, THREE.Vector3>;
}

export function buildTerrain(w: World): Terrain {
  const group = new THREE.Group();
  const hills = w.hills ?? [];
  const height = (x: number, z: number) => {
    let h = 0;
    for (const hl of hills) {
      const r = Math.hypot(x - hl.center[0], z - hl.center[1]);
      const v = r <= hl.topRadius ? hl.height : r < hl.footRadius ? (hl.height * (hl.footRadius - r)) / (hl.footRadius - hl.topRadius) : 0;
      if (v > h) h = v;
    }
    return h;
  };
  const waterAreas = w.areas.filter((a) => a.water);
  const isDeepWater = (x: number, z: number) =>
    waterAreas.some((a) => {
      const dx = a.size[0] / 2 - Math.abs(x - a.center[0]);
      const dz = a.size[1] / 2 - Math.abs(z - a.center[1]);
      return Math.min(dx, dz) > 1.2;
    });

  const water: Terrain["water"] = [];
  w.areas.forEach((a, i) => {
    const mat = a.water
      ? new THREE.MeshPhongMaterial({ color: a.color, shininess: 70, specular: 0x6fa8cc })
      : lambert(a.color);
    if (a.water) {
      const m = mat as THREE.MeshPhongMaterial;
      water.push({ mat: m, day: new THREE.Color(a.color), night: new THREE.Color(a.nightColor ?? a.color) });
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(a.size[0], a.size[1]), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(a.center[0], a.water ? -0.02 : i * 0.004, a.center[1]);
    group.add(mesh);
  });

  const tops = new Map<string, THREE.Vector3>();
  for (const h of hills) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(h.topRadius, h.footRadius, h.height, 48), lambert(h.color));
    m.position.set(h.center[0], h.height / 2, h.center[1]);
    group.add(m);
    tops.set(h.id, new THREE.Vector3(h.center[0], h.height, h.center[1]));
  }
  for (const mt of w.mountains ?? []) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(mt.radius, mt.height, 20), lambert(mt.color));
    m.position.set(mt.center[0], mt.height / 2 - 0.1, mt.center[1]);
    group.add(m);
    tops.set(mt.id, new THREE.Vector3(mt.center[0], mt.height - 0.1, mt.center[1]));
  }
  for (const is of w.islands ?? []) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(is.radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lambert(is.color));
    m.scale.set(1, is.height / is.radius, 1);
    m.position.set(is.center[0], -0.05, is.center[1]);
    group.add(m);
    tops.set(is.id, new THREE.Vector3(is.center[0], is.height - 0.05, is.center[1]));
  }
  for (const rv of w.rivers ?? []) {
    const curve = new THREE.CatmullRomCurve3(rv.points.map((p) => new THREE.Vector3(p[0], 0.01, p[1])));
    const pts = curve.getPoints(80);
    const pos: number[] = [];
    const idx: number[] = [];
    pts.forEach((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)]!;
      const o = pts[Math.max(i - 1, 0)]!;
      const dx = q.x - o.x;
      const dz = q.z - o.z;
      const L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * rv.halfWidth;
      const nz = (dx / L) * rv.halfWidth;
      pos.push(p.x + nx, 0.012, p.z + nz, p.x - nx, 0.012, p.z - nz);
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, lambert(rv.color, { side: THREE.DoubleSide })));
    const mid = pts[Math.floor(pts.length / 2)]!;
    tops.set(rv.id, new THREE.Vector3(mid.x, 0.05, mid.z));
  }
  return { group, height, isDeepWater, water, tops };
}

export interface CityObj {
  id: string;
  group: THREE.Group;
  /** Gate leaves: pivot and side (+1/-1). */
  leaves: { pivot: THREE.Object3D; s: number }[];
  materials: THREE.Material[];
  anchors: Record<string, THREE.Vector3>;
}

/** Walls, towers, a two-leaf gate, seeded houses and a palace, on top of the terrain at the centre. */
export function buildCity(c: City, base: number): CityObj {
  const group = new THREE.Group();
  const [cx, cz] = c.center;
  const R = c.wall.radius;
  const H = c.wall.height;
  const segs = c.wall.segments;
  const gate = (c.gate.angle * Math.PI) / 180;
  const step = (Math.PI * 2) / segs;
  const angDist = (a: number) => Math.abs(Math.atan2(Math.sin(a - gate), Math.cos(a - gate)));
  const stone = lambert(c.wall.color);
  const towerMat = lambert(c.towers?.color ?? c.wall.color);
  // Index of the wall segment replaced by the gate.
  let gateK = 0;
  for (let k = 1; k < segs; k++) if (angDist(k * step) < angDist(gateK * step)) gateK = k;
  for (let k = 0; k < segs; k++) {
    const a = k * step;
    const px = cx + Math.cos(a) * R;
    const pz = cz + Math.sin(a) * R;
    if (k !== gateK) {
      const m = new THREE.Mesh(new THREE.BoxGeometry((2 * Math.PI * R) / segs + 0.02, H, c.wall.thickness), stone);
      m.position.set(px, base + H / 2, pz);
      m.rotation.y = -a + Math.PI / 2;
      group.add(m);
    }
    const t = c.towers;
    const flanks = Math.abs(((k - gateK + segs + segs / 2) % segs) - segs / 2) === 1;
    if (t && k !== gateK && (k % t.every === 1 % t.every || flanks)) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(t.size[0], t.size[1], t.size[0]), towerMat);
      tw.position.set(px, base + t.size[1] / 2, pz);
      tw.rotation.y = -a;
      group.add(tw);
    }
  }
  // Gate: local x = outwards, local z = along the wall.
  const gx = cx + Math.cos(gate) * R;
  const gz = cz + Math.sin(gate) * R;
  const gateFrame = new THREE.Group();
  gateFrame.position.set(gx, base, gz);
  gateFrame.rotation.y = -gate;
  group.add(gateFrame);
  const hw = (Math.PI * R) / segs;
  const leafMat = lambert(c.gate.color);
  const leaves: CityObj["leaves"] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, s * hw);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.12, H * 0.9, hw), leafMat);
    leaf.position.set(0, H * 0.45, (-s * hw) / 2);
    pivot.add(leaf);
    gateFrame.add(pivot);
    leaves.push({ pivot, s });
  }
  const anchors: Record<string, THREE.Vector3> = {
    center: new THREE.Vector3(cx, base + H + 0.6, cz),
    gate: new THREE.Vector3(gx, base + H, gz),
  };
  // Houses (prototype hash: R(i, 7..12) with seed 0), leaving the street to the gate free.
  const h = c.houses;
  if (h) {
    const mats = h.colors.map((col) => lambert(col));
    const off = h.seed * 1000;
    const ux = Math.cos(gate);
    const uz = Math.sin(gate);
    for (let i = 0; i < h.count; i++) {
      const r = h.innerRadius + hash(i + off, 7) * (h.outerRadius - h.innerRadius);
      const a = hash(i + off, 8) * Math.PI * 2;
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r;
      const along = dx * ux + dz * uz;
      const lateral = Math.abs(dx * uz - dz * ux);
      if (along > h.outerRadius * 0.74 && lateral < 0.9) continue;
      const w = 0.35 + hash(i + off, 9) * 0.45;
      const ht = 0.22 + hash(i + off, 10) * 0.35;
      const d = 0.35 + hash(i + off, 11) * 0.45;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), mats[i % mats.length]!);
      m.position.set(cx + dx, base + ht / 2, cz + dz);
      m.rotation.y = hash(i + off, 12) * Math.PI;
      group.add(m);
    }
  }
  const p = c.palace;
  if (p) {
    const pal = new THREE.Mesh(new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]), lambert(p.color));
    pal.position.set(cx + p.offset[0], base + p.size[1] / 2, cz + p.offset[1]);
    group.add(pal);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(p.size[0] + 0.1, 0.06, p.size[2] + 0.1), lambert(p.roofColor));
    roof.position.set(cx + p.offset[0], base + p.size[1] + 0.03, cz + p.offset[1]);
    group.add(roof);
    anchors.palace = new THREE.Vector3(cx + p.offset[0], base + p.size[1] + 0.1, cz + p.offset[1]);
  }
  const materials: THREE.Material[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.Material;
    if (mesh.isMesh && !materials.includes(m)) {
      m.transparent = true;
      materials.push(m);
    }
  });
  return { id: c.id, group, leaves, materials, anchors };
}

