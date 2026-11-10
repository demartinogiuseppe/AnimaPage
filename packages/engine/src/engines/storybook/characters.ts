// Storybook characters: Kenney models (toon-shaded) and the eight procedural ones, built from round
// primitives in bright flat colours. Every character stands on y = 0, centred in x/z, facing +x.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { dioramaModel, type StoryCharacterEntry, type StoryProcId } from "@pv/scene-spec";
import { instantiate, type LoadedModel } from "../diorama/models.ts";
import { addOutline, OUTLINE_PX, toonMaterial } from "./toon.ts";

export interface BuiltCharacter {
  obj: THREE.Group;
  /** Colourable parts by catalogue name (procedural characters only). */
  parts: Map<string, THREE.Mesh[]>;
}

/** Height in world units of a Kenney model, by catalogue size 1..5. */
const MODEL_HEIGHT = [0.5, 0.9, 1.4, 2.2, 3.2] as const;

const WHITE = "#fffaf0";
const BLACK = "#1f1a17";

type V3 = [number, number, number];

class Builder {
  readonly root = new THREE.Group();
  readonly parts = new Map<string, THREE.Mesh[]>();

  mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, colour: string, at: V3, opts: { scale?: V3; rot?: V3; part?: string; name?: string; double?: boolean } = {}): THREE.Mesh {
    const mat = toonMaterial(colour);
    if (opts.double) mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...at);
    if (opts.scale) m.scale.set(...opts.scale);
    if (opts.rot) m.rotation.set(...opts.rot);
    if (opts.part) {
      m.name = opts.part;
      const list = this.parts.get(opts.part) ?? [];
      list.push(m);
      this.parts.set(opts.part, list);
    } else if (opts.name) m.name = opts.name;
    parent.add(m);
    return m;
  }
}

const sphere = (r = 1, seg = 24): THREE.SphereGeometry => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7));
const cyl = (rt: number, rb: number, h: number, seg = 16): THREE.CylinderGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);

function triangle(base: number, height: number, depth: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(base, 0);
  s.lineTo(0, height);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function eyes(b: Builder, parent: THREE.Object3D, x: number, y: number, z: number, r: number): void {
  for (const s of [-1, 1]) {
    b.mesh(parent, sphere(r, 16), WHITE, [x, y, z * s]);
    b.mesh(parent, sphere(r * 0.55, 12), BLACK, [x + r * 0.45, y, z * s + r * 0.12 * s]);
  }
}

function whale(): Builder {
  const b = new Builder();
  const blue = "#3b82f6";
  b.mesh(b.root, sphere(1), blue, [0, 0, 0], { scale: [1.7, 0.85, 0.85], part: "body" });
  b.mesh(b.root, sphere(1), "#dbeafe", [0.12, -0.28, 0], { scale: [1.5, 0.58, 0.88], part: "belly" });
  // Tail: a stem rising behind the body and two flukes.
  b.mesh(b.root, sphere(1), blue, [-1.7, 0.3, 0], { scale: [0.6, 0.3, 0.3], rot: [0, 0, 0.5] });
  for (const s of [-1, 1]) b.mesh(b.root, sphere(1), blue, [-2.15, 0.62, 0.3 * s], { scale: [0.25, 0.1, 0.4], rot: [0.35 * s, 0, 0.3] });
  // Side fins.
  for (const s of [-1, 1]) b.mesh(b.root, sphere(1), blue, [0.3, -0.5, 0.85 * s], { scale: [0.4, 0.1, 0.22], rot: [0.5 * s, 0, 0.5] });
  eyes(b, b.root, 1.12, 0.22, 0.52, 0.14);
  return b;
}

function sailboat(): Builder {
  const b = new Builder();
  const hull = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  b.mesh(b.root, hull, "#e63946", [0, 0.6, 0], { scale: [1.5, 0.7, 0.62], part: "hull", double: true });
  b.mesh(b.root, new THREE.CircleGeometry(1, 28), "#f4d58d", [0, 0.5, 0], { scale: [1.25, 0.5, 1], rot: [-Math.PI / 2, 0, 0] });
  b.mesh(b.root, cyl(0.05, 0.05, 2.3), "#8d5a2b", [0, 1.62, 0]);
  b.mesh(b.root, triangle(1.15, 1.9, 0.07), WHITE, [0.1, 0.75, 0], { part: "sail" });
  b.mesh(b.root, triangle(0.65, 1.1, 0.06), "#f4a261", [-0.1, 0.9, 0], { scale: [-1, 1, 1], name: "jib" });
  b.mesh(b.root, triangle(0.4, 0.26, 0.05), "#ffd23f", [0.03, 2.55, 0], { name: "flag" });
  return b;
}

function caterpillar(): Builder {
  const b = new Builder();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const r = 0.4 - i * 0.012;
    b.mesh(b.root, sphere(r, 20), "#7cc242", [-i * 0.62, r + (i % 2) * 0.05, 0], { part: "body" });
  }
  const r = 0.6;
  const centre = new THREE.Vector3(0.66, r + 0.06, 0);
  b.mesh(b.root, sphere(r, 24), "#f6a21e", [centre.x, centre.y, 0], { part: "head" });
  // The face is on the top of the head, turned to the chapter camera (up and towards +z), so it reads
  // from above: eyes side by side, a smile below them.
  const nrm = new THREE.Vector3(0.2, 0.74, 0.64).normalize();
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(nrm, right).normalize();
  const dir = (a: number, b: number) => nrm.clone().addScaledVector(right, a).addScaledVector(up, b).normalize();
  const at = (d: THREE.Vector3, out: number) => centre.clone().addScaledVector(d, r + out);
  for (const s of [-1, 1]) {
    const eyeDir = dir(0.36 * s, 0.3);
    const p = at(eyeDir, 0.02);
    b.mesh(b.root, sphere(0.19, 16), WHITE, [p.x, p.y, p.z]);
    const q = at(eyeDir, 0.15);
    b.mesh(b.root, sphere(0.1, 12), BLACK, [q.x, q.y, q.z]);
    const cheek = at(dir(0.62 * s, -0.12), 0.01);
    b.mesh(b.root, sphere(0.08, 10), "#ff8fa3", [cheek.x, cheek.y, cheek.z], { scale: [1, 0.5, 1] });
  }
  const sd = dir(0, -0.3);
  const sp = at(sd, 0.02);
  const smile = b.mesh(b.root, new THREE.TorusGeometry(0.22, 0.05, 8, 20, Math.PI).rotateZ(Math.PI), BLACK, [sp.x, sp.y, sp.z]);
  smile.lookAt(centre.clone().addScaledVector(sd, 10));
  // Antennae: thick, long, splayed to the sides, with big red tips.
  for (const s of [-1, 1]) {
    const stalk = new THREE.Group();
    stalk.position.set(0.5, 1.1, 0.32 * s);
    stalk.rotation.set(0.5 * s, 0, 0.4);
    b.root.add(stalk);
    b.mesh(stalk, cyl(0.05, 0.05, 0.7, 8), BLACK, [0, 0.35, 0]);
    b.mesh(stalk, sphere(0.13, 12), "#e63946", [0, 0.74, 0]);
  }
  return b;
}

function umbrella(): Builder {
  const b = new Builder();
  const colours = ["#e63946", "#ffd23f", "#2a9d8f", "#4d9de0", "#e63946", "#ffd23f", "#2a9d8f", "#4d9de0"];
  const dome = new THREE.Group();
  dome.position.y = 0.95;
  dome.scale.set(1, 0.62, 1);
  b.root.add(dome);
  for (let i = 0; i < 8; i++) {
    const g = new THREE.SphereGeometry(1, 4, 10, (i * Math.PI) / 4, Math.PI / 4, 0, Math.PI / 2);
    b.mesh(dome, g, colours[i]!, [0, 0, 0], { part: "canopy", double: true });
  }
  b.mesh(b.root, cyl(0.04, 0.04, 1.1, 10), "#6b4423", [0, 0.7, 0]);
  b.mesh(b.root, sphere(0.07, 10), "#ffd23f", [0, 1.6, 0]);
  b.mesh(b.root, new THREE.TorusGeometry(0.15, 0.04, 8, 16, Math.PI), "#6b4423", [0.15, 0.15, 0], { rot: [0, 0, Math.PI] });
  return b;
}

function ball(): Builder {
  const b = new Builder();
  const r = 0.5;
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    const g = new THREE.SphereGeometry(r, 4, 14, (i * Math.PI * 2) / stripes, (Math.PI * 2) / stripes);
    b.mesh(b.root, g, i % 2 ? WHITE : "#e63946", [0, r, 0], i % 2 ? { name: "stripe" } : { part: "ball" });
  }
  return b;
}

function train(): Builder {
  const b = new Builder();
  const red = "#e63946";
  const dark = "#343a40";
  const wheelAt = (x: number, r: number) => {
    for (const s of [-1, 1]) b.mesh(b.root, cyl(r, r, 0.12, 16), dark, [x, r, 0.42 * s], { rot: [Math.PI / 2, 0, 0], name: "wheel" });
  };
  // Locomotive: boiler, cab, chimney, front lamp.
  b.mesh(b.root, cyl(0.42, 0.42, 1.5, 20), red, [0.35, 0.72, 0], { rot: [0, 0, Math.PI / 2], part: "engine" });
  b.mesh(b.root, new RoundedBoxGeometry(0.8, 1.05, 0.9, 4, 0.1), red, [-0.75, 0.82, 0], { part: "engine" });
  b.mesh(b.root, new RoundedBoxGeometry(0.95, 0.12, 1.05, 3, 0.05), dark, [-0.75, 1.4, 0], { name: "roof" });
  b.mesh(b.root, cyl(0.12, 0.17, 0.45, 14), red, [0.75, 1.3, 0], { part: "engine" });
  b.mesh(b.root, cyl(0.22, 0.12, 0.12, 14), dark, [0.75, 1.58, 0], { name: "chimney-cap" });
  b.mesh(b.root, sphere(0.1, 12), "#ffd23f", [1.12, 0.75, 0], { name: "lamp" });
  wheelAt(-0.75, 0.3);
  wheelAt(0.55, 0.24);
  wheelAt(0.05, 0.24);
  // Two wagons.
  ["#4d9de0", "#ffd23f"].forEach((c, i) => {
    const x = -2.2 - i * 1.5;
    b.mesh(b.root, new RoundedBoxGeometry(1.2, 0.8, 0.88, 4, 0.1), c, [x, 0.7, 0], { part: "wagon" });
    b.mesh(b.root, cyl(0.03, 0.03, 0.3, 8), dark, [x + 0.75, 0.36, 0], { rot: [0, 0, Math.PI / 2], name: "link" });
    wheelAt(x - 0.35, 0.22);
    wheelAt(x + 0.35, 0.22);
  });
  b.mesh(b.root, cyl(0.03, 0.03, 0.3, 8), dark, [-1.35, 0.36, 0], { rot: [0, 0, Math.PI / 2], name: "link" });
  return b;
}

function sun(): Builder {
  const b = new Builder();
  const face = new THREE.Group();
  face.position.y = 1.2;
  b.root.add(face);
  b.mesh(face, sphere(0.8, 28), "#ffcf1f", [0, 0, 0], { part: "disc" });
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    b.mesh(face, new THREE.ConeGeometry(0.17, 0.5, 10), i % 2 ? "#ffb703" : "#ffd23f", [Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0], { rot: [0, 0, a - Math.PI / 2], name: "ray" });
  }
  for (const s of [-1, 1]) {
    b.mesh(face, sphere(0.1, 12), BLACK, [0.28 * s, 0.18, 0.72], { scale: [1, 1.3, 0.6] });
    b.mesh(face, sphere(0.12, 12), "#ff8fa3", [0.5 * s, -0.12, 0.64], { scale: [1.2, 0.8, 0.5] });
  }
  b.mesh(face, new THREE.TorusGeometry(0.26, 0.04, 8, 18, Math.PI), BLACK, [0, -0.08, 0.76], { rot: [0, 0, Math.PI] });
  return b;
}

function cloud(): Builder {
  const b = new Builder();
  const puffs: [number, number, number, number][] = [
    [0, 0.5, 0, 0.55],
    [0.7, 0.42, 0.05, 0.45],
    [-0.7, 0.4, -0.05, 0.42],
    [0.3, 0.85, 0, 0.5],
    [-0.3, 0.78, 0.05, 0.42],
    [1.15, 0.3, 0, 0.3],
    [-1.1, 0.3, 0, 0.3],
  ];
  for (const [x, y, z, r] of puffs) b.mesh(b.root, sphere(r, 20), WHITE, [x, y, z], { part: "cloud" });
  return b;
}

const PROC: Record<StoryProcId, () => Builder> = { whale, sailboat, caterpillar, umbrella, ball, train, sun, cloud };

/** Stands the group on y = 0 and centres it in x/z. */
function ground(inner: THREE.Object3D): THREE.Group {
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  wrap.add(inner);
  inner.position.set(-c.x, -box.min.y, -c.z);
  return wrap;
}

function outlineAll(root: THREE.Object3D): void {
  const list: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.outline) list.push(o as THREE.Mesh);
  });
  for (const m of list) addOutline(m, OUTLINE_PX);
}

/** Stand-in for a Kenney model that is not loaded (Node, or a failed download): a coloured blob. */
function placeholder(def: StoryCharacterEntry, height: number): THREE.Group {
  let h = 0;
  for (const ch of def.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const g = new THREE.Group();
  const m = new THREE.Mesh(sphere(0.5, 20), toonMaterial(new THREE.Color().setHSL(h / 360, 0.7, 0.58)));
  m.scale.setScalar(height);
  m.position.y = height / 2;
  g.add(m);
  return g;
}

export function buildCharacter(def: StoryCharacterEntry, models: Map<string, LoadedModel | null>): BuiltCharacter {
  const parts = new Map<string, THREE.Mesh[]>();
  let inner: THREE.Object3D;
  if ("proc" in def.source) {
    const b = PROC[def.source.proc]();
    inner = b.root;
    for (const [k, v] of b.parts) parts.set(k, v);
  } else {
    const file = dioramaModel(def.source.model)?.file;
    const loaded = file ? models.get(file) : null;
    const height = MODEL_HEIGHT[def.size - 1]!;
    if (loaded) {
      const inst = instantiate(loaded, height);
      inst.obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const swap = (m: THREE.Material) => {
          const std = m as THREE.MeshStandardMaterial;
          return toonMaterial(std.color ?? "#cccccc", std.map ?? undefined);
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
      });
      inner = inst.obj;
    } else inner = placeholder(def, height);
  }
  const obj = ground(inner);
  obj.name = def.id;
  outlineAll(obj);
  return { obj, parts };
}
