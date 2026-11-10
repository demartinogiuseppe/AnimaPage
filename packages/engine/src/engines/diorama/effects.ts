// Particle-like effects of the diorama. Every particle position is a closed-form function of
// (t - start) and a seeded hash: nothing is integrated frame by frame.
import * as THREE from "three";
import type { DioramaAction } from "@pv/scene-spec";
import { hash } from "../../util/math.ts";
import { baseSize, type Evaluator } from "./state.ts";
import { glowTexture, type CanvasFactory } from "./shapes.ts";

export interface Fx {
  chapter: string;
  objects: THREE.Object3D[];
  update(chapter: string, t: number): void;
}

const G = 9.8;
const HIDDEN = -1e4;
const v = new THREE.Vector3();
const dummy = new THREE.Object3D();
const origin = new THREE.Vector3();

type Act<K extends DioramaAction["do"]> = Extract<DioramaAction, { do: K }>;

function sparksPoints(n: number, color: string, cc: CanvasFactory, size: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const map = glowTexture(cc);
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...(map ? { map } : {}) }),
  );
  pts.frustumCulled = false;
  pts.visible = false;
  return pts;
}

/** Writes spark i (born `age` seconds ago) into `arr`. */
function spark(arr: Float32Array, i: number, seed: number, o: THREE.Vector3, age: number, speed: number): void {
  const th = hash(i, seed) * Math.PI * 2;
  const up = 0.3 + hash(i, seed + 1) * 0.9;
  const sp = speed * (0.6 + hash(i, seed + 2) * 0.8);
  arr[i * 3] = o.x + Math.cos(th) * sp * 0.7 * age;
  arr[i * 3 + 1] = o.y + up * sp * age - 0.5 * G * age * age;
  arr[i * 3 + 2] = o.z + Math.sin(th) * sp * 0.7 * age;
}

export function buildSparks(chapter: string, a: Act<"sparks">, ev: Evaluator, cc: CanvasFactory): Fx {
  const n = a.count ?? 30;
  const seed = a.seed ?? 11;
  const pts = sparksPoints(n, a.color ?? "#ffe27a", cc, 0.16);
  const life = 0.7;
  return {
    chapter,
    objects: [pts],
    update(ch, t) {
      pts.visible = ch === chapter && t >= a.from && t <= a.to + life && ev.resolvePoint(a.at, ch, t, origin);
      if (!pts.visible) return;
      const arr = pts.geometry.attributes.position!.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const age = (t - a.from + hash(i, seed + 5) * life) % life;
        const born = t - age;
        if (born < a.from || born > a.to) arr[i * 3 + 1] = HIDDEN;
        else spark(arr, i, seed, origin, age, 2.6);
      }
      pts.geometry.attributes.position!.needsUpdate = true;
    },
  };
}

/** Puffs (smoke) or flames (fire) rising from a point. */
export function buildPuffs(chapter: string, a: Act<"smoke"> | Act<"fire">, ev: Evaluator): Fx {
  const fire = a.do === "fire";
  const n = fire ? 18 : 12;
  const size = a.size ?? 1;
  const life = fire ? 0.9 : 2.6;
  const height = (fire ? 1.3 : 3) * size;
  const seed = a.seed ?? 5;
  const material = fire
    ? new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })
    : new THREE.MeshLambertMaterial({ color: (a as Act<"smoke">).color ?? "#8d9096", transparent: true, opacity: 0.6, depthWrite: false });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, n);
  mesh.frustumCulled = false;
  mesh.visible = false;
  if (fire) {
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) mesh.setColorAt(i, c.set(hash(i, seed + 3) < 0.5 ? "#ff7a1a" : "#ffc23a"));
  }
  const light = fire ? new THREE.PointLight("#ff8a33", 0, 8 * size, 1.5) : null;
  const objects: THREE.Object3D[] = light ? [mesh, light] : [mesh];
  return {
    chapter,
    objects,
    update(ch, t) {
      mesh.visible = ch === chapter && t >= a.from && t <= a.to + life && ev.resolvePoint(a.at, ch, t, origin);
      if (light) light.intensity = 0;
      if (!mesh.visible) return;
      for (let i = 0; i < n; i++) {
        const f = ((t - a.from) / life + hash(i, seed)) % 1;
        const born = t - f * life;
        let s = 0;
        if (born >= a.from && born <= a.to) s = (fire ? 0.35 * (1 - f) : 0.25 + 0.9 * f) * size * (f > 0.85 && !fire ? (1 - f) / 0.15 : 1);
        const ang = hash(i, seed + 1) * Math.PI * 2;
        const r = (fire ? 0.25 : 0.35) * size * hash(i, seed + 2);
        dummy.position.set(origin.x + Math.cos(ang) * r + Math.sin(t * 1.3 + i) * 0.1 * f, origin.y + f * height, origin.z + Math.sin(ang) * r);
        dummy.scale.setScalar(Math.max(s, 1e-4));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (light) {
        light.position.set(origin.x, origin.y + 0.6 * size, origin.z);
        light.intensity = (6 + Math.sin(t * 13) * 1.5 + Math.sin(t * 7.3) * 1) * size;
      }
    },
  };
}

/** Glowing trail behind a moving item: the item's own past positions. */
export function buildTrail(chapter: string, a: Act<"trail">, ev: Evaluator): Fx {
  const n = 28;
  const len = a.length ?? 1.2;
  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: a.color ?? "#2f7fe0", transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    n,
  );
  mesh.frustumCulled = false;
  mesh.visible = false;
  const item = ev.items.get(a.target);
  const w = item ? Math.max(0.1, Math.min(baseSize(item, null)[0], baseSize(item, null)[1]) * 0.22) : 0.15;
  return {
    chapter,
    objects: [mesh],
    update(ch, t) {
      mesh.visible = ch === chapter && t >= a.from && t <= a.to + len;
      if (!mesh.visible) return;
      for (let k = 0; k < n; k++) {
        const tk = t - (k / n) * len;
        let s = 0;
        if (tk >= a.from && tk <= a.to && ev.point(a.target, "center", ch, tk, v)) {
          s = w * (1 - k / n);
          dummy.position.copy(v);
        }
        dummy.scale.setScalar(Math.max(s, 1e-4));
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Fragments flying out of an item (one Fx per target), with a burst of sparks. */
export function buildExplosion(chapter: string, a: Act<"explode">, target: string, ev: Evaluator, cc: CanvasFactory): Fx {
  const n = a.pieces ?? 14;
  const seed = a.seed ?? 3;
  const force = a.force ?? 1;
  const colors = a.colors ?? ["#3b3f45", "#9aa3ab", "#f2c230", "#d8382c", "#5fbf5a"];
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: "#ffffff" }), n);
  mesh.frustumCulled = false;
  mesh.visible = false;
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) mesh.setColorAt(i, c.set(colors[i % colors.length]!));
  const sparks = sparksPoints(40, "#fff2a8", cc, 0.2);
  const item = ev.items.get(target);
  const base = item ? baseSize(item, null) : ([1, 1, 1] as [number, number, number]);
  const piece = Math.cbrt(Math.max(base[0] * base[1] * base[2], 1e-3)) / 5;
  return {
    chapter,
    objects: [mesh, sparks],
    update(ch, t) {
      const on = ch === chapter && t >= a.at;
      mesh.visible = on;
      sparks.visible = on && t <= a.at + 0.8;
      if (!on) return;
      const s0 = ev.state(target, ch, Math.max(0, a.at - 1e-3));
      const h = base[1] * s0.scale.y;
      origin.copy(s0.pos).add(s0.shake);
      const tau = t - a.at;
      for (let i = 0; i < n; i++) {
        const ox = (hash(i, seed) - 0.5) * base[0];
        const oy = hash(i, seed + 1) * h;
        const oz = (hash(i, seed + 2) - 0.5) * base[2];
        const sz = piece * (0.5 + hash(i, seed + 3));
        const dir = v.set(ox, h * 0.4, oz).normalize();
        const sp = (2.5 + hash(i, seed + 4) * 3.5) * force;
        const vx = dir.x * sp + (hash(i, seed + 5) - 0.5) * 2 * force;
        const vy = 2 + dir.y * sp;
        const vz = dir.z * sp + (hash(i, seed + 6) - 0.5) * 2 * force;
        const y0 = origin.y + oy;
        const floor = sz / 2;
        const land = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, y0 - floor))) / G;
        const tc = Math.min(tau, land);
        dummy.position.set(origin.x + ox + vx * tc, Math.max(floor, y0 + vy * tc - 0.5 * G * tc * tc), origin.z + oz + vz * tc);
        dummy.rotation.set(tc * (3 + hash(i, seed + 7) * 6), tc * 4, tc * (2 + hash(i, seed + 8) * 5));
        dummy.scale.setScalar(sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (sparks.visible) {
        const arr = sparks.geometry.attributes.position!.array as Float32Array;
        v.copy(origin).setY(origin.y + h * 0.6);
        for (let i = 0; i < 40; i++) spark(arr, i, seed + 20, v, tau * (0.6 + hash(i, seed + 21) * 0.4), 5 * force);
        sparks.geometry.attributes.position!.needsUpdate = true;
      }
    },
  };
}
