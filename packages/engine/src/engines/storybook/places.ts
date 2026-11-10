// Storybook places: sea, meadow, rails and sky. Bright and simple; each has a gradient sky dome.
// Every place stands on a thin disc whose TOP is y = 0 (characters rest there) and whose bottom is the
// paper of the pop-up book; nothing sits lower than the disc. Anything that moves (sea crests) is a pure
// function of the chapter time, see placeUpdate.
import * as THREE from "three";
import { storyCharacter, type STORY_PLACES } from "@pv/scene-spec";
import { buildCharacter } from "./characters.ts";
import { addOutline, OUTLINE_PX, toonMaterial } from "./toon.ts";

type StoryPlace = (typeof STORY_PLACES)[number];

/** Thickness of the ground disc: its top is y = 0, its bottom is the paper. */
export const GROUND_THICKNESS = 0.08;
const CRESTS = 14;

/** Wave term of the sea at (x, z) and chapter time t, in -0.12..0.12. Pure. */
export function waveHeight(x: number, z: number, t: number): number {
  return 0.07 * Math.sin(x * 1.7 + t * 1.6) + 0.05 * Math.sin(z * 2.3 - t * 1.1 + x * 0.6);
}

/** Deterministic pseudo-random sequence (no Math.random: places are the same on every build). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function skyDome(top: string, bottom: string): THREE.Mesh {
  const g = new THREE.SphereGeometry(45, 24, 16);
  const a = g.getAttribute("position");
  const colours = new Float32Array(a.count * 3);
  const t = new THREE.Color(top);
  const b = new THREE.Color(bottom);
  const c = new THREE.Color();
  for (let i = 0; i < a.count; i++) {
    c.copy(b).lerp(t, THREE.MathUtils.clamp(a.getY(i) / 30, 0, 1));
    c.toArray(colours, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.name = "sky";
  m.renderOrder = -1;
  m.raycast = () => {};
  return m;
}

function solid(g: THREE.Object3D, geo: THREE.BufferGeometry, colour: string, at: [number, number, number], name: string, scale?: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(geo, toonMaterial(colour));
  m.name = name;
  m.position.set(...at);
  if (scale) m.scale.set(...scale);
  g.add(m);
  return m;
}

/** The ground disc: top at y = 0, bottom GROUND_THICKNESS below (the paper). */
function ground(g: THREE.Group, size: number, colour: string): void {
  solid(g, new THREE.CylinderGeometry(size * 0.6, size * 0.6, GROUND_THICKNESS, 64), colour, [0, -GROUND_THICKNESS / 2, 0], "ground");
}

/** A dome sitting on y = 0 (its flat side is open and rests on the ground). */
const dome = (): THREE.SphereGeometry => new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);

function hills(g: THREE.Group, size: number): void {
  const spots: [number, number, number, string][] = [
    [-0.28, -0.8, 2.6, "#58b247"],
    [0.05, -0.9, 3.4, "#4aa23b"],
    [0.36, -0.78, 2.8, "#63bd50"],
  ];
  for (const [x, z, r, c] of spots) solid(g, dome(), c, [x * size, 0, z * size * 0.5], "hill", [r * 1.4, r, r]);
}

function flowers(g: THREE.Group, size: number, avoidTrack: boolean): void {
  const rnd = rng(7);
  const colours = ["#ff5d8f", "#ffd23f", "#ffffff", "#ff8c42", "#b388eb"];
  for (let i = 0; i < 22; i++) {
    const x = (rnd() - 0.5) * size * 0.8;
    let z = (rnd() - 0.5) * size * 0.8;
    if (avoidTrack && Math.abs(z) < 1.6) z += z < 0 ? -2 : 2;
    const f = new THREE.Group();
    f.position.set(x, 0, z);
    f.scale.setScalar(0.8 + rnd() * 0.5);
    solid(f, new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6), "#3d9a3d", [0, 0.2, 0], "stem");
    const c = colours[i % colours.length]!;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      solid(f, new THREE.SphereGeometry(0.1, 10, 8), c, [Math.cos(a) * 0.13, 0.45, Math.sin(a) * 0.13], "petal");
    }
    solid(f, new THREE.SphereGeometry(0.08, 10, 8), "#ffb703", [0, 0.47, 0], "heart");
    g.add(f);
  }
}

function track(g: THREE.Group, size: number): void {
  const len = size * 1.1;
  solid(g, new THREE.BoxGeometry(len, 0.04, 1.5), "#b8a58c", [0, 0.02, 0], "ballast");
  for (let x = -len / 2 + 0.3; x < len / 2; x += 0.55) solid(g, new THREE.BoxGeometry(0.2, 0.07, 1.25), "#8d5a2b", [x, 0.06, 0], "sleeper");
  for (const z of [-0.42, 0.42]) solid(g, new THREE.BoxGeometry(len, 0.08, 0.07), "#6c757d", [0, 0.12, z], "rail");
}

const SEA_BLUES = ["#7fd6ff", "#4fb6ff", "#bdeeff"] as const;

/** A scalloped wave crest lying flat: a band with `n` round humps along x. */
function crestGeometry(n: number): THREE.ExtrudeGeometry {
  const w = 0.5;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  for (let i = 0; i < n; i++) s.absarc(w / 2 + i * w, 0, w / 2, Math.PI, 0, true);
  s.lineTo(n * w - 0.02, -0.1);
  s.lineTo(0.02, -0.1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 10 });
  // Shape y -> ground z, extrusion -> up.
  g.rotateX(-Math.PI / 2);
  g.translate(-(n * w) / 2, 0.02, 0.05);
  return g;
}

interface Crest {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  phase: number;
}

function sea(g: THREE.Group, size: number): void {
  ground(g, size, "#2a8cf0");
  const crests: Crest[] = [];
  const rnd = rng(5);
  const radius = size * 0.6 * 0.82;
  for (let i = 0; i < CRESTS; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const mesh = solid(g, crestGeometry(2 + (i % 2)), SEA_BLUES[i % SEA_BLUES.length]!, [0, 0.03, 0], "crest", [1.8, 1.8, 1.8]);
    mesh.rotation.y = (rnd() - 0.5) * 0.6;
    crests.push({ mesh, x: Math.cos(a) * r, z: Math.sin(a) * r, phase: rnd() * Math.PI * 2 });
  }
  g.userData.crests = crests;
  // A sunny sandy bank at the back.
  solid(g, dome(), "#f7d58b", [0, 0, -size * 0.4], "sand", [size * 0.28, 0.35, 1.8]);
}

function skyFloor(g: THREE.Group, size: number): void {
  ground(g, size, "#eaf6ff");
  const rnd = rng(11);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = size * (0.46 + rnd() * 0.08);
    solid(g, dome(), "#ffffff", [Math.cos(a) * r, 0, Math.sin(a) * r], "cloud-lump", [0.9 + rnd() * 0.5, 0.6, 0.9 + rnd() * 0.5]);
  }
}

function decor(g: THREE.Group, id: string, at: [number, number, number], scale: number): void {
  const def = storyCharacter(id);
  if (!def) return;
  const { obj } = buildCharacter(def, new Map());
  obj.position.set(...at);
  obj.scale.setScalar(scale);
  obj.name = `decor-${id}`;
  g.add(obj);
}

/** Builds a place, `size` units across. The ground's top is y = 0; nothing is lower than its bottom. */
export function buildPlace(place: StoryPlace, size: number): THREE.Group {
  const g = new THREE.Group();
  g.name = `place-${place}`;
  switch (place) {
    case "sea":
      g.add(skyDome("#4aa8ff", "#bfe6ff"));
      sea(g, size);
      break;
    case "meadow":
      g.add(skyDome("#4aa8ff", "#d6f0ff"));
      ground(g, size, "#6cc24a");
      hills(g, size);
      flowers(g, size, false);
      break;
    case "rails":
      g.add(skyDome("#4aa8ff", "#d6f0ff"));
      ground(g, size, "#6cc24a");
      hills(g, size);
      track(g, size);
      flowers(g, size, true);
      break;
    case "sky":
      g.add(skyDome("#2f7fe0", "#a8dcff"));
      skyFloor(g, size);
      // Big, near and inside the page: the layout hides only things far bigger than the content.
      decor(g, "sun", [size * 0.22, 0, -size * 0.3], 2.2);
      decor(g, "cloud", [-size * 0.26, 0, -size * 0.22], 2);
      decor(g, "cloud", [size * 0.05, 0, -size * 0.42], 1.6);
      break;
  }
  // Lines on the small things; the sky and the big discs stay line-free.
  const bare = new Set(["sky", "ground"]);
  const list: THREE.Mesh[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !o.userData.outline && !bare.has(m.name) && !m.children.some((c) => c.userData.outline)) list.push(m);
  });
  for (const m of list) addOutline(m, OUTLINE_PX);
  placeUpdate(g, 0);
  return g;
}

/** Puts the place in its state for chapter time `t`: the sea crests drift and bob. Pure in t. */
export function placeUpdate(g: THREE.Group, t: number): void {
  const crests = g.userData.crests as Crest[] | undefined;
  if (!crests) return;
  for (const c of crests) {
    const x = c.x + 0.35 * Math.sin(t * 0.9 + c.phase);
    c.mesh.position.set(x, 0.04 + waveHeight(x, c.z, t) * 0.4, c.z);
  }
}
