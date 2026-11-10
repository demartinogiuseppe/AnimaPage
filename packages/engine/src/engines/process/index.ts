// `process` engine: schematic science illustrations (organs, devices, cycles) with flows,
// light rays, waves and vibrations. Schema, units and anchors: packages/scene-spec/src/engines/process.ts.
import * as THREE from "three";
import type { Anchor, ProcessData, ProcessItem, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../../types.ts";
import { ease, hash, seg } from "../../util/math.ts";
import { flowInterval, frontDistances, particleDistance, Polyline, presence, REVEAL, smooth, windows } from "./motion.ts";
import { buildShape } from "./shapes.ts";

const PAPER = "#f4efe6";
const GLOW = new THREE.Color("#ffb347");
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
/** Fronts are spherical caps: curvature radius = size * FRONT_CURVE. */
const FRONT_CURVE = 1.7;

interface PartObj {
  id: string;
  node: THREE.Object3D;
  parent: PartObj | null;
  /** Layers are static inside their block: only opacity/glow change. */
  isSub: boolean;
  basePos: THREE.Vector3;
  baseScale: THREE.Vector3;
  mats: { m: THREE.MeshStandardMaterial; opacity: number }[];
  label: THREE.Vector3;
  vibrate?: { axis?: THREE.Vector3; amplitude: number; freq: number };
  /** Computed in update(): effective presence and glow, inherited by children. */
  eff: number;
  glow: number;
}
interface FlowObj {
  id: string;
  path: Polyline;
  mesh: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  jitter: THREE.Vector3[];
  speed: number;
  size: number;
  once: boolean;
}
interface RayObj {
  id: string;
  path: Polyline;
  segs: { mesh: THREE.Mesh; from: number; len: number }[];
  head: THREE.Mesh;
  photons: THREE.Mesh[];
  mats: THREE.MeshBasicMaterial[];
  speed: number;
}
interface WaveObj {
  id: string;
  kind: "fronts" | "rings";
  path: Polyline | null;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  pool: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  size: number;
  endSize: number;
  spacing: number;
  speed: number;
  max: number;
}

type ChapterItems = Map<string, ProcessItem>;

const vec = (a: readonly [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

/** Where an element is in time: seconds since it started (pre-rolled when already there at t=0). */
const elapsed = (it: ProcessItem, t: number, preroll: number) => (it.at === undefined ? t + preroll : t - it.at);

function basic(color: THREE.ColorRepresentation, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

function setOpacity(m: THREE.Material, opacity: number, baseTransparent: boolean) {
  m.opacity = opacity;
  const transparent = baseTransparent || opacity < 0.999;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
}

export function createProcessEngine(): Engine {
  let ctx: EngineContext | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let chapters = new Map<string, ChapterItems>();
  let parts: PartObj[] = [];
  let partById = new Map<string, PartObj>();
  /** Centre lines of tube/spiral/torus parts in part-local coordinates. */
  const curves = new Map<string, THREE.Vector3[]>();
  let flows: FlowObj[] = [];
  let rays: RayObj[] = [];
  let waves: WaveObj[] = [];
  let bound = { center: new THREE.Vector3(), radius: 1 };
  const tmp = new THREE.Vector3();
  const mtx = new THREE.Matrix4();

  /** Part-local point -> world-group coordinates, using the current transforms. */
  const toWorld = (o: THREE.Object3D, out: THREE.Vector3) => {
    for (let n: THREE.Object3D | null = o; n && n !== world; n = n.parent) {
      n.updateMatrix();
      out.applyMatrix4(n.matrix);
    }
    return out;
  };

  function buildParts(data: ProcessData) {
    for (const p of data.parts) {
      const shape = buildShape(p);
      const node = new THREE.Group();
      node.name = `part:${p.id}`;
      node.add(shape.object);
      const parent = p.parent ? partById.get(p.parent)! : null;
      (parent?.node ?? world!).add(node);
      const basePos = vec(p.pos ?? [0, 0, 0]);
      const s = p.scale ?? 1;
      const baseScale = typeof s === "number" ? new THREE.Vector3(s, s, s) : vec(s);
      node.position.copy(basePos);
      node.rotation.set(...((p.rot ?? [0, 0, 0]).map((a) => a * DEG) as [number, number, number]));
      node.scale.copy(baseScale);
      const obj: PartObj = {
        id: p.id,
        node,
        parent,
        isSub: false,
        basePos,
        baseScale,
        mats: shape.materials.map((m) => ({ m, opacity: m.opacity })),
        label: vec(p.label ?? [0, 0, 0]),
        vibrate: p.vibrate && {
          axis: p.vibrate.axis && vec(p.vibrate.axis).normalize(),
          amplitude: p.vibrate.amplitude,
          freq: p.vibrate.freq,
        },
        eff: 0,
        glow: 0,
      };
      parts.push(obj);
      partById.set(p.id, obj);
      for (const sub of shape.subs) {
        sub.object.name = `part:${sub.id}`;
        const so: PartObj = {
          id: sub.id,
          node: sub.object,
          parent: obj,
          isSub: true,
          basePos: sub.object.position.clone(),
          baseScale: sub.object.scale.clone(),
          mats: sub.materials.map((m) => ({ m, opacity: m.opacity })),
          label: sub.label,
          eff: 0,
          glow: 0,
        };
        parts.push(so);
        partById.set(sub.id, so);
      }
      if (shape.curve) curves.set(p.id, shape.curve);
    }
  }

  /** A flow/wave path in world-group coordinates: explicit (smoothed) or along a part at rest. */
  function pathOf(e: { path?: [number, number, number][]; along?: string; reverse?: boolean }): Polyline {
    let pts: THREE.Vector3[];
    if (e.along) {
      const node = partById.get(e.along)!.node;
      pts = curves.get(e.along)!.map((p) => toWorld(node, p.clone()));
    } else {
      pts = smooth(e.path!.map(vec));
    }
    const line = new Polyline(pts);
    return e.reverse ? line.reversed() : line;
  }

  function buildFlows(data: ProcessData) {
    for (const f of data.flows) {
      const size = f.size ?? 0.08;
      const mat = new THREE.MeshBasicMaterial({ color: f.color, transparent: true });
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), mat, f.count);
      mesh.name = `flow:${f.id}`;
      mesh.frustumCulled = false;
      const seed = f.seed ?? 1;
      const spread = f.spread ?? 0;
      const jitter = Array.from({ length: f.count }, (_, i) =>
        new THREE.Vector3(hash(i, seed) - 0.5, hash(i, seed + 1) - 0.5, hash(i, seed + 2) - 0.5).multiplyScalar(2 * spread),
      );
      world!.add(mesh);
      flows.push({ id: f.id, path: pathOf(f), mesh, jitter, speed: f.speed, size, once: f.once ?? false });
    }
  }

  function buildRays(data: ProcessData) {
    for (const r of data.rays) {
      const path = new Polyline(r.path.map(vec));
      const width = r.width ?? 0.035;
      const mat = basic(r.color, 0.95);
      const group = new THREE.Group();
      group.name = `ray:${r.id}`;
      const unit = new THREE.CylinderGeometry(width, width, 1, 8).translate(0, 0.5, 0);
      const segs = path.pts.slice(1).map((b, i) => {
        const a = path.pts[i]!;
        const mesh = new THREE.Mesh(unit, mat);
        mesh.position.copy(a);
        mesh.quaternion.setFromUnitVectors(UP, tmp.subVectors(b, a).normalize());
        group.add(mesh);
        return { mesh, from: path.cum[i]!, len: path.cum[i + 1]! - path.cum[i]! };
      });
      const dotMat = basic("#ffffff", 1);
      const dot = new THREE.SphereGeometry(width * 2.6, 12, 8);
      const head = new THREE.Mesh(dot, dotMat);
      const photons = Array.from({ length: r.photons ?? 2 }, () => new THREE.Mesh(dot, dotMat));
      group.add(head, ...photons);
      world!.add(group);
      rays.push({ id: r.id, path, segs, head, photons, mats: [mat, dotMat], speed: r.speed ?? 6 });
    }
  }

  function buildWaves(data: ProcessData) {
    // Unit front: spherical cap of half-width 1 whose apex is at the origin, bulging along +y.
    const R = FRONT_CURVE;
    const capGeo = new THREE.SphereGeometry(R, 28, 6, 0, Math.PI * 2, 0, Math.asin(1 / R)).translate(0, -R, 0);
    const ringGeo = new THREE.RingGeometry(0.93, 1, 64);
    for (const w of data.waves) {
      const group = new THREE.Group();
      group.name = `wave:${w.id}`;
      world!.add(group);
      if (w.kind === "fronts") {
        const path = pathOf(w);
        const n = Math.ceil(path.length / w.spacing) + 2;
        const pool = Array.from({ length: n }, () => new THREE.Mesh(capGeo, basic(w.color, 0.6)));
        group.add(...pool);
        waves.push({
          id: w.id, kind: "fronts", path, pos: path.pts[0]!.clone(), quat: new THREE.Quaternion(), pool,
          size: w.size, endSize: w.endSize ?? w.size, spacing: w.spacing, speed: w.speed, max: path.length,
        });
      } else {
        const n = Math.ceil(w.radius / w.spacing) + 2;
        const pool = Array.from({ length: n }, () => new THREE.Mesh(ringGeo, basic(w.color, 0.6)));
        group.add(...pool);
        const quat = new THREE.Quaternion().setFromUnitVectors(Z, vec(w.normal ?? [0, 0, 1]).normalize());
        waves.push({
          id: w.id, kind: "rings", path: null, pos: vec(w.pos), quat, pool,
          size: 1, endSize: 1, spacing: w.spacing, speed: w.speed, max: w.radius,
        });
      }
    }
  }

  function computeBounds() {
    world!.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const p of parts) if (!p.isSub) box.expandByObject(p.node);
    for (const l of [...flows.map((f) => f.path), ...rays.map((r) => r.path)]) for (const pt of l.pts) box.expandByPoint(pt);
    for (const w of waves) {
      if (w.path) for (const pt of w.path.pts) box.expandByPoint(pt);
      else box.expandByPoint(tmp.copy(w.pos).addScalar(w.max)).expandByPoint(tmp.copy(w.pos).addScalar(-w.max));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    bound = { center: sphere.center, radius: Math.max(sphere.radius, 0.5) };
  }

  function updateParts(items: ChapterItems, t: number) {
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.8);
    for (const p of parts) {
      const it = items.get(p.id);
      const own = it ? presence(t, it.at, it.until, it.reveal) : p.parent ? 1 : 0;
      p.eff = own * (p.parent ? p.parent.eff : 1);
      p.glow = Math.max(windows(t, it?.glow), p.parent?.glow ?? 0);
      p.node.visible = p.eff > 0.001;
      if (!p.isSub) {
        const shown = it?.at === undefined ? 1 : ease.inOutQuad(seg(t, it.at, it.at + (it.reveal ?? REVEAL)));
        p.node.position.copy(p.basePos);
        p.node.scale.copy(p.baseScale);
        if (it?.from) p.node.position.addScaledVector(vec(it.from), 1 - shown);
        else if (it) p.node.scale.multiplyScalar(0.85 + 0.15 * shown);
        if (p.vibrate) {
          const s = Math.sin(t * Math.PI * 2 * p.vibrate.freq) * p.vibrate.amplitude * windows(t, it?.vibrate);
          if (p.vibrate.axis) p.node.position.addScaledVector(p.vibrate.axis, s);
          else p.node.scale.multiplyScalar(1 + s);
        }
      }
      const k = p.glow * (0.16 + 0.2 * pulse);
      // China style (player): a glowing part keeps its colours for the whole glow window (no blinking with the pulse).
      p.node.userData.key = p.glow > 0.05;
      for (const { m, opacity } of p.mats) {
        setOpacity(m, opacity * p.eff, opacity < 1);
        m.emissive.copy(GLOW).multiplyScalar(k);
      }
    }
  }

  function updateFlows(items: ChapterItems, t: number) {
    for (const f of flows) {
      const it = items.get(f.id);
      const pres = it ? presence(t, it.at, it.until, it.reveal) : 0;
      f.mesh.visible = pres > 0.001;
      f.mesh.userData.key = true; // flows, rays and waves are always key elements (china style)
      if (!it || !f.mesh.visible) continue;
      f.mesh.material.opacity = pres;
      const len = f.path.length;
      const interval = flowInterval(f.jitter.length, f.speed, len, f.once);
      const tau = elapsed(it, t, f.once ? 0 : len / f.speed);
      for (let i = 0; i < f.jitter.length; i++) {
        const d = particleDistance(i, tau, f.speed, len, interval, f.once);
        if (d === null) mtx.makeScale(0, 0, 0);
        else {
          f.path.at(d, tmp).add(f.jitter[i]!);
          mtx.makeScale(f.size, f.size, f.size).setPosition(tmp);
        }
        f.mesh.setMatrixAt(i, mtx);
      }
      f.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function updateRays(items: ChapterItems, t: number) {
    for (const r of rays) {
      const it = items.get(r.id);
      const pres = it ? presence(t, it.at, it.until, it.reveal) : 0;
      const group = r.head.parent!;
      group.visible = pres > 0.001;
      group.userData.key = true;
      if (!it || !group.visible) continue;
      for (const m of r.mats) m.opacity = pres * (m === r.mats[0] ? 0.95 : 1);
      const total = r.path.length;
      const drawn = it.at === undefined ? total : Math.min(total, (t - it.at) * r.speed);
      for (const s of r.segs) {
        const frac = Math.min(1, Math.max(0, (drawn - s.from) / s.len));
        s.mesh.visible = frac > 0;
        s.mesh.scale.set(1, Math.max(frac * s.len, 1e-4), 1);
      }
      r.head.visible = drawn > 0 && drawn < total;
      r.path.at(drawn, r.head.position);
      // Photons run along the finished ray, so the direction of the light stays visible.
      const tau = elapsed(it, t, total / r.speed) - total / r.speed;
      const interval = total / r.speed / Math.max(1, r.photons.length);
      r.photons.forEach((ph, i) => {
        const d = particleDistance(i, tau, r.speed * 0.6, total, interval / 0.6, false);
        ph.visible = d !== null;
        if (d !== null) r.path.at(d, ph.position);
      });
    }
  }

  function updateWaves(items: ChapterItems, t: number) {
    for (const w of waves) {
      const it = items.get(w.id);
      const pres = it ? presence(t, it.at, it.until, it.reveal) : 0;
      const group = w.pool[0]!.parent!;
      group.visible = pres > 0.001;
      group.userData.key = true;
      if (!it || !group.visible) continue;
      const p = elapsed(it, t, w.max / w.speed) * w.speed;
      const ds = frontDistances(p, w.spacing, w.max);
      w.pool.forEach((m, i) => {
        const d = ds[i];
        m.visible = d !== undefined;
        if (d === undefined) return;
        const edge = Math.min(1, d / (0.5 * w.spacing), (w.max - d) / (0.5 * w.spacing));
        if (w.path) {
          const size = w.size + (w.endSize - w.size) * (d / w.max);
          w.path.at(d, m.position);
          m.quaternion.setFromUnitVectors(UP, w.path.tangent(d, tmp));
          m.scale.setScalar(size);
          m.material.opacity = 0.45 * pres * Math.max(0, edge);
        } else {
          m.position.copy(w.pos);
          m.quaternion.copy(w.quat);
          m.scale.setScalar(Math.max(d, 1e-3));
          m.material.opacity = 0.7 * pres * Math.max(0, Math.min(1, d / (0.5 * w.spacing))) * (1 - d / w.max);
        }
      });
    }
  }

  return {
    async build(c, spec: SceneSpec) {
      if (spec.engine !== "process") throw new Error(`process engine got a "${spec.engine}" scene`);
      ctx = c;
      const data = spec.engineData;
      chapters = new Map(data.chapters.map((ch) => [ch.chapter, new Map(ch.items.map((it) => [it.id, it]))]));
      world = new THREE.Group();
      world.name = "process";
      c.root.add(world);

      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(data.background ?? PAPER);
      const key = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
      key.position.set(6, 10, 14);
      const rim = new THREE.DirectionalLight(0xffe8d0, 0.35 * Math.PI);
      rim.position.set(-10, 4, -8);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.75 * Math.PI), key, rim];
      for (const l of lights) c.scene.add(l);

      buildParts(data);
      world.updateMatrixWorld(true);
      buildFlows(data);
      buildRays(data);
      buildWaves(data);
      computeBounds();
    },

    update(chapterId, t) {
      const items = chapters.get(chapterId) ?? new Map<string, ProcessItem>();
      updateParts(items, t);
      updateFlows(items, t);
      updateRays(items, t);
      updateWaves(items, t);
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || !world || anchor.part === undefined) return false;
      const pct = anchor.index === undefined ? null : Math.min(100, anchor.index) / 100;
      switch (anchor.entity) {
        case "part": {
          const p = partById.get(anchor.part);
          if (!p) return false;
          toWorld(p.node, out.copy(p.label));
          break;
        }
        case "flow": {
          const f = flows.find((x) => x.id === anchor.part);
          if (!f) return false;
          if (pct !== null) f.path.at(pct * f.path.length, out);
          else {
            const it = chapters.get(chapterId)?.get(f.id);
            const len = f.path.length;
            const tau = it ? elapsed(it, t, f.once ? 0 : len / f.speed) : -1;
            const d = particleDistance(0, tau, f.speed, len, 1, f.once);
            f.path.at(d ?? (f.once && tau > 0 ? len : 0), out);
          }
          break;
        }
        case "ray": {
          const r = rays.find((x) => x.id === anchor.part);
          if (!r) return false;
          r.path.at((pct ?? 1) * r.path.length, out);
          break;
        }
        case "wave": {
          const w = waves.find((x) => x.id === anchor.part);
          if (!w) return false;
          if (w.path) w.path.at((pct ?? 0) * w.path.length, out);
          else out.copy(w.pos);
          break;
        }
        default:
          return false;
      }
      if (anchor.offset) out.add(tmp.set(...anchor.offset));
      return true;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    dispose() {
      if (!ctx || !world) return;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geos.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
      });
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      world = null;
      lights = [];
      parts = [];
      partById = new Map();
      curves.clear();
      flows = [];
      rays = [];
      waves = [];
      chapters = new Map();
    },
  };
}
