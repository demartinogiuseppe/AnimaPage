// Procedural schematic parts for the process engine ("textbook illustration in 3D"):
// smooth shading, soft colours, cut-away faces in a slightly darker tone.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { ProcessPart } from "@pv/scene-spec";
import { rng } from "../../util/math.ts";
import { smooth } from "./motion.ts";

export const DEFAULT_COLOR = "#d9cfc4";
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** A sub-part with its own id (a layer of a `layers` block). */
export interface SubPart {
  id: string;
  object: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  label: THREE.Vector3;
}

export interface BuiltShape {
  object: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  /** Centre line in part-local coordinates (tube, spiral, torus), for flows and waves `along` it. */
  curve?: THREE.Vector3[];
  subs: SubPart[];
}

const v3 = (a: readonly [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

export function material(color: THREE.ColorRepresentation, opacity = 1, side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0,
    side,
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
  });
}

/** Mesh builder that records materials; `open` shapes show their inside (innerColor or same colour). */
class Builder {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  constructor(private p: ProcessPart) {}

  get color() {
    return this.p.color ?? DEFAULT_COLOR;
  }

  mesh(geo: THREE.BufferGeometry, open = false, color: THREE.ColorRepresentation = this.color, parent: THREE.Object3D = this.group) {
    const op = this.p.opacity ?? 1;
    const inner = this.p.innerColor;
    if (open && inner) {
      const front = material(color, op, THREE.FrontSide);
      const back = material(inner, op, THREE.BackSide);
      this.materials.push(front, back);
      parent.add(new THREE.Mesh(geo, front), new THREE.Mesh(geo, back));
      return;
    }
    const m = material(color, op, open ? THREE.DoubleSide : THREE.FrontSide);
    this.materials.push(m);
    const mesh = new THREE.Mesh(geo, m);
    parent.add(mesh);
    return mesh;
  }
}

/** Cylinder of radius r between two points (bones, ray-like rods, arrow shafts). */
function between(a: THREE.Vector3, b: THREE.Vector3, r: number, rTop = r): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 1e-4);
  const geo = new THREE.CylinderGeometry(rTop, r, len, 16).translate(0, len / 2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return geo.translate(a.x, a.y, a.z);
}

function lathe(profile: [number, number][], segments = 48) {
  return new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  );
}

function curveTube(b: Builder, pts: THREE.Vector3[], radius: number, closed: boolean) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, "centripetal");
  b.mesh(new THREE.TubeGeometry(curve, Math.max(32, pts.length), radius, 14, closed));
  if (!closed) {
    for (const end of [pts[0]!, pts[pts.length - 1]!]) b.mesh(new THREE.SphereGeometry(radius, 14, 10).translate(end.x, end.y, end.z));
  }
}

function blobGeometry(radius: number, bumps: number, seed: number) {
  // Merge the UV seam so the displaced surface gets smooth normals everywhere.
  const sphere = new THREE.SphereGeometry(radius, 96, 64);
  sphere.deleteAttribute("normal");
  sphere.deleteAttribute("uv");
  const geo = mergeVertices(sphere);
  sphere.dispose();
  const r = rng(seed);
  // Broad lumps for the overall shape, then fine folds whose depth grows with `bumps` (a brain at ~1).
  const wave = (freq: number, amp: number) => ({
    dir: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
    freq: freq * (1 + r()),
    phase: r() * Math.PI * 2,
    amp,
  });
  const waves = [
    ...Array.from({ length: 5 }, () => wave(2.5, 0.05 * bumps)),
    ...Array.from({ length: 10 }, () => wave(8, 0.022 * bumps * bumps)),
  ];
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    let k = 1;
    for (const w of waves) k += w.amp * Math.sin(n.dot(w.dir) * w.freq + w.phase);
    pos.setXYZ(i, n.x * radius * k, n.y * radius * k, n.z * radius * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildShape(p: ProcessPart): BuiltShape {
  const b = new Builder(p);
  let curve: THREE.Vector3[] | undefined;
  const subs: SubPart[] = [];

  switch (p.shape) {
    case "sphere": {
      const cap = (p.cap ?? 180) * DEG;
      const cut = (p.cut ?? 0) * DEG;
      const phiStart = cut > 0 ? Math.PI / 2 + cut / 2 : 0;
      const phiLen = Math.PI * 2 - cut;
      const open = cut > 0 || cap < Math.PI;
      b.mesh(new THREE.SphereGeometry(p.radius, 56, 36, phiStart, phiLen, 0, cap), open);
      if (cut > 0 && p.wall) {
        // Section faces: half-rings in the two cut planes, a bit darker than the part.
        const face = new THREE.Color(b.color).multiplyScalar(0.82);
        const inner = Math.max(p.radius - p.wall, 0.001);
        for (const phi of [phiStart, phiStart + phiLen]) {
          const ring = new THREE.RingGeometry(inner, p.radius, 40, 1, Math.PI / 2 - cap, cap).rotateY(phi + Math.PI);
          const m = material(face, p.opacity ?? 1, THREE.DoubleSide);
          b.materials.push(m);
          b.group.add(new THREE.Mesh(ring, m));
        }
      }
      break;
    }
    case "lens": {
      const h = p.thickness / 2;
      const n = 16;
      const prof: [number, number][] = [];
      for (let i = 0; i <= n; i++) prof.push([(p.radius * i) / n, -h * (1 - (i / n) ** 2)]);
      for (let i = n - 1; i >= 0; i--) prof.push([(p.radius * i) / n, h * (1 - (i / n) ** 2)]);
      b.mesh(lathe(prof));
      break;
    }
    case "disc": {
      const h = (p.thickness ?? 0.05) / 2;
      if (p.inner) {
        b.mesh(lathe([[p.inner, -h], [p.radius, -h], [p.radius, h], [p.inner, h], [p.inner, -h]], 64));
      } else {
        b.mesh(new THREE.CylinderGeometry(p.radius, p.radius, h * 2, 48));
      }
      break;
    }
    case "cylinder":
      b.mesh(new THREE.CylinderGeometry(p.radiusTop ?? p.radius, p.radius, p.height, 32, 1, p.open ?? false), p.open ?? false);
      break;
    case "funnel": {
      const prof: [number, number][] = [];
      for (let i = 0; i <= 20; i++) {
        const v = i / 20;
        prof.push([p.radiusIn + (p.radiusOut - p.radiusIn) * (1 - v) ** 2, v * p.length]);
      }
      b.mesh(lathe(prof), true);
      break;
    }
    case "box":
      b.mesh(new THREE.BoxGeometry(...p.size));
      break;
    case "tube": {
      curve = smooth(p.path.map(v3), p.closed ?? false);
      curveTube(b, curve, p.radius, p.closed ?? false);
      break;
    }
    case "spiral": {
      const h = p.height ?? 0;
      const n = Math.max(48, Math.round(p.turns * 64));
      curve = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const a = u * p.turns * Math.PI * 2;
        const r = p.radius * (1 - 0.72 * u);
        curve.push(new THREE.Vector3(r * Math.cos(a), h * u, r * Math.sin(a)));
      }
      curveTube(b, curve, p.tube, false);
      break;
    }
    case "torus": {
      const arc = (p.arc ?? 360) * DEG;
      b.mesh(new THREE.TorusGeometry(p.radius, p.tube, 14, 72, arc).rotateX(-Math.PI / 2));
      const n = Math.max(16, Math.round(arc * 12));
      curve = Array.from({ length: n + 1 }, (_, i) => {
        const a = (arc * i) / n;
        return new THREE.Vector3(p.radius * Math.cos(a), 0, -p.radius * Math.sin(a));
      });
      if (arc < Math.PI * 2) {
        for (const end of [curve[0]!, curve[n]!]) b.mesh(new THREE.SphereGeometry(p.tube, 12, 8).translate(end.x, end.y, end.z));
      }
      break;
    }
    case "bone": {
      const a = v3(p.from);
      const c = v3(p.to);
      b.mesh(between(a, c, p.radius));
      for (const end of [a, c]) b.mesh(new THREE.SphereGeometry(p.radius * 1.6, 16, 12).translate(end.x, end.y, end.z));
      break;
    }
    case "arrow": {
      const a = v3(p.from);
      const c = v3(p.to);
      const r = p.radius ?? 0.08;
      const len = a.distanceTo(c);
      const head = Math.min(r * 5, len * 0.4);
      const neck = c.clone().sub(a).setLength(Math.max(len - head, 1e-4)).add(a);
      b.mesh(between(a, neck, r));
      b.mesh(between(neck, c, r * 2.6, 0));
      break;
    }
    case "blob":
      b.mesh(blobGeometry(p.radius, p.bumps ?? 0.5, p.seed ?? 1));
      break;
    case "dots": {
      const m = material(b.color, p.opacity ?? 1);
      b.materials.push(m);
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(p.radius, 10, 8), m, p.count);
      const r = rng(p.seed ?? 7);
      const mat = new THREE.Matrix4();
      for (let i = 0; i < p.count; i++) {
        mat.makeTranslation((r() - 0.5) * p.size[0], (r() - 0.5) * p.size[1], (r() - 0.5) * p.size[2]);
        mesh.setMatrixAt(i, mat);
      }
      mesh.computeBoundingSphere();
      b.group.add(mesh);
      break;
    }
    case "layers": {
      const total = p.layers.reduce((s, l) => s + l.thickness, 0);
      let y = total / 2;
      for (const l of p.layers) {
        const node = new THREE.Group();
        node.position.y = y - l.thickness / 2;
        node.updateMatrix();
        b.group.add(node);
        const before = b.materials.length;
        b.mesh(new THREE.BoxGeometry(p.width, l.thickness, p.depth), false, l.color, node);
        if (l.id) subs.push({ id: l.id, object: node, materials: b.materials.slice(before), label: new THREE.Vector3(0, 0, p.depth / 2) });
        y -= l.thickness;
      }
      break;
    }
  }
  return { object: b.group, materials: b.materials, curve, subs };
}
