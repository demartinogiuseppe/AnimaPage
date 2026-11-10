// Procedural parts of the workshop engine. Each builder returns the object to add under the part's
// node, the materials the engine animates (opacity, colour, glow) and, for the helpers, the extra
// handles update() needs (liquid column, particle instances, path).
import * as THREE from "three";
import type { WorkshopPart } from "@pv/scene-spec";
import type { EngineContext } from "../../types.ts";
import { Polyline, smooth } from "../process/motion.ts";
import { maybeFormula } from "../../util/math-text.ts";

const DEFAULT = "#c9bfae";
const GLASS = "#cfe6f2";
const WATER = "#3f8fd8";
const INK = "#28303c";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export interface Built {
  object: THREE.Object3D;
  /** Materials with their own base opacity; the engine multiplies by presence and track opacity. */
  mats: { m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.LineBasicMaterial; opacity: number }[];
  /** Material whose colour a `color` track drives (the main one). */
  main: THREE.Material & { color: THREE.Color };
  liquid?: { column: THREE.Mesh; height: number };
  particles?: { mesh: THREE.InstancedMesh; path: Polyline; size: number };
  /** Anchor point in the part frame (liquid: its surface is moved by the engine). */
  anchor: THREE.Vector3;
}

const vec = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

function material(p: WorkshopPart): THREE.MeshStandardMaterial {
  if (p.glass) {
    return new THREE.MeshStandardMaterial({
      color: p.color ?? GLASS, roughness: 0.08, metalness: 0, transparent: true, opacity: p.opacity ?? 0.28,
      depthWrite: false, side: THREE.DoubleSide,
    });
  }
  const opacity = p.opacity ?? 1;
  return new THREE.MeshStandardMaterial({
    color: p.color ?? DEFAULT, roughness: 0.65, metalness: 0, transparent: opacity < 1, opacity, side: THREE.DoubleSide,
  });
}

function curveOf(path: readonly (readonly number[])[]): THREE.Vector3[] {
  return smooth(path.map(vec));
}

/** Tooth/paddle wheel standing in the x-y plane, axle along z. */
function wheel(p: WorkshopPart, m: THREE.MeshStandardMaterial): THREE.Group {
  const r = p.radius!;
  const w = p.height!;
  const g = new THREE.Group();
  const teeth = p.teeth ?? 0;
  const spokes = p.spokes ?? (teeth > 0 ? 0 : 6);
  const rim = spokes > 0 ? new THREE.Mesh(new THREE.TorusGeometry(r * 0.94, Math.max(r * 0.06, 0.02), 8, 48), m) : null;
  if (rim) {
    rim.scale.z = Math.max(1, w / (r * 0.12));
    g.add(rim);
  } else {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 48), m);
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.14, r * 0.14, w * 1.4, 16), m);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < spokes; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, Math.max(r * 0.05, 0.02), w * 0.5), m);
    const a = (i / spokes) * Math.PI;
    s.rotation.z = a;
    s.scale.x = 2.05;
    g.add(s);
  }
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const len = r * (teeth <= 16 ? 0.32 : 0.16);
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(len, Math.max((Math.PI * r) / teeth * 0.8, 0.02), w), m);
    tooth.position.set(Math.cos(a) * (r + len / 2 - 0.02), Math.sin(a) * (r + len / 2 - 0.02), 0);
    tooth.rotation.z = a;
    g.add(tooth);
  }
  return g;
}

function helix(p: WorkshopPart): THREE.BufferGeometry {
  const r = p.radius!;
  const h = p.height!;
  const turns = p.turns!;
  const n = Math.ceil(turns * 24);
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * turns * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, (i / n) * h, Math.sin(a) * r);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, Math.max(r * 0.08, 0.015), 6, false);
}

function textTile(p: WorkshopPart, ctx: EngineContext, m: THREE.MeshStandardMaterial): { obj: THREE.Group; ink: THREE.MeshBasicMaterial | null } {
  const h = p.height!;
  const text = p.text!;
  const w = h * (0.62 * [...text].length + 0.8);
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h * 1.5, h * 0.12), m);
  g.add(plate);
  const canvas = ctx.createCanvas?.(Math.min(2048, Math.ceil(w / h) * 96), 144) ?? null;
  const c2 = canvas?.getContext("2d");
  if (!canvas || !c2) return { obj: g, ink: null };
  c2.clearRect(0, 0, canvas.width, canvas.height);
  c2.font = `700 ${Math.round(canvas.height * 0.52)}px ${FONT}`;
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.fillStyle = p.color ?? INK;
  if (!maybeFormula(ctx, c2, text, canvas.width / 2, canvas.height * 0.5, canvas.height * 0.56, { maxWidth: canvas.width * 0.94, bold: true }))
    c2.fillText(text, canvas.width / 2, canvas.height * 0.54, canvas.width * 0.94);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ink = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 1.5), ink);
  face.position.z = h * 0.061;
  g.add(face);
  return { obj: g, ink };
}

/** Builds a part. Models are built by the engine (they need the loaded catalog). */
export function buildPart(p: WorkshopPart, ctx: EngineContext): Built {
  const m = material(p);
  const mats: Built["mats"] = [{ m, opacity: m.opacity }];
  const anchor = new THREE.Vector3();
  const mesh = (geo: THREE.BufferGeometry) => new THREE.Mesh(geo, m);
  let object: THREE.Object3D;
  const out: Partial<Built> = {};
  switch (p.shape) {
    case "box":
      object = mesh(new THREE.BoxGeometry(...p.size!));
      break;
    case "cylinder":
      object = mesh(new THREE.CylinderGeometry(p.radiusTop ?? p.radius!, p.radius!, p.height!, 40, 1, !!p.glass));
      break;
    case "cone":
      object = mesh(new THREE.ConeGeometry(p.radius!, p.height!, 40));
      break;
    case "sphere":
      object = mesh(new THREE.SphereGeometry(p.radius!, 32, 20));
      break;
    case "torus":
      object = mesh(new THREE.TorusGeometry(p.radius!, p.tube!, 12, 56));
      break;
    case "plane":
      object = mesh(new THREE.PlaneGeometry(p.size![0], p.size![2]).rotateX(-Math.PI / 2));
      break;
    case "tube": {
      const pts = curveOf(p.path!);
      object = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(16, pts.length), p.radius!, 12, false));
      break;
    }
    case "arrow": {
      const a = vec(p.path![0]!);
      const b = vec(p.path![1]!);
      const len = Math.max(a.distanceTo(b), 1e-3);
      const r = p.radius ?? Math.max(0.04, len * 0.035);
      const head = Math.min(len * 0.35, r * 5);
      const g = new THREE.Group();
      const shaft = mesh(new THREE.CylinderGeometry(r, r, len - head, 12).translate(0, (len - head) / 2, 0));
      const tip = mesh(new THREE.ConeGeometry(r * 2.4, head, 16).translate(0, len - head / 2, 0));
      g.add(shaft, tip);
      g.position.copy(a);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      const wrap = new THREE.Group();
      wrap.add(g);
      object = wrap;
      anchor.copy(b);
      break;
    }
    case "line": {
      const lm = p.dashed
        ? new THREE.LineDashedMaterial({ color: p.color ?? INK, dashSize: 0.18, gapSize: 0.12, transparent: true })
        : new THREE.LineBasicMaterial({ color: p.color ?? INK, transparent: true });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.path!.map(vec)), lm);
      if (p.dashed) line.computeLineDistances();
      object = line;
      mats.length = 0;
      mats.push({ m: lm, opacity: 1 });
      return { object, mats, main: lm, anchor: vec(p.path![0]!) };
    }
    case "text": {
      // `color` colours the letters; the plate stays paper so the text is always readable.
      m.color.set("#fbf8f1");
      const { obj, ink } = textTile(p, ctx, m);
      if (ink) mats.push({ m: ink, opacity: 1 });
      object = obj;
      obj.userData.key = true;
      break;
    }
    case "liquid": {
      const h = p.height!;
      const round = p.radius !== undefined;
      const glass = new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.08, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
      const wm = new THREE.MeshStandardMaterial({ color: p.color ?? WATER, roughness: 0.25, transparent: true, opacity: p.opacity ?? 0.85 });
      const inset = 0.96;
      const wall = round ? new THREE.CylinderGeometry(p.radius!, p.radius!, h, 40, 1, true) : new THREE.BoxGeometry(p.size![0], h, p.size![2]);
      const col = (round ? new THREE.CylinderGeometry(p.radius! * inset, p.radius! * inset, 1, 40) : new THREE.BoxGeometry(p.size![0] * inset, 1, p.size![2] * inset)).translate(0, 0.5, 0);
      const g = new THREE.Group();
      const shell = new THREE.Mesh(wall, glass);
      shell.position.y = h / 2;
      const column = new THREE.Mesh(col, wm);
      column.userData.key = true;
      g.add(shell, column);
      object = g;
      mats.length = 0;
      mats.push({ m: wm, opacity: wm.opacity }, { m: glass, opacity: glass.opacity });
      out.liquid = { column, height: h };
      return { object, mats, main: wm, anchor, ...out } as Built;
    }
    case "particles": {
      const size = p.radius ?? 0.08;
      const pm = new THREE.MeshBasicMaterial({ color: p.color ?? WATER, transparent: true });
      const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), pm, p.count!);
      inst.frustumCulled = false;
      inst.userData.key = true;
      const path = new Polyline(curveOf(p.path!));
      object = inst;
      mats.length = 0;
      mats.push({ m: pm, opacity: 1 });
      return { object, mats, main: pm, anchor: path.pts[0]!.clone(), particles: { mesh: inst, path, size } };
    }
    case "wheel":
      object = wheel(p, m);
      break;
    case "spring":
      object = mesh(helix(p));
      anchor.set(0, p.height!, 0);
      break;
    case "model":
      // Placeholder until the engine swaps in the catalog model.
      object = new THREE.Group();
      break;
  }
  return { object, mats, main: m, anchor, ...out } as Built;
}

/** Default spin axis of a shape (wheels and rings turn in the plane facing the camera). */
export const defaultAxis = (p: WorkshopPart): "x" | "y" | "z" => p.axis ?? (p.shape === "wheel" || p.shape === "torus" ? "z" : "y");
