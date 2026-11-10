// `concept` engine: abstract topics (grammar, maths...) as 3D building blocks that appear,
// hop, snap together, split, merge and flip to new text. Data model, units and anchors:
// packages/scene-spec/src/engines/concept.ts. All motion is precompiled in plan.ts (tiles,
// presence of everything) and graph-plan.ts (plots, tracers, parameters); graphs are drawn by graph.ts.
import * as THREE from "three";
import type { Anchor, ConceptData, ConceptShape, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { buildGraphs, type GraphRuntime } from "./graph.ts";
import { compileGraphPlan, evalScalar, type GraphPlan } from "./graph-plan.ts";
import { clamp } from "../../util/math.ts";
import {
  axisLabelPos,
  axisPoint,
  buildAxis,
  buildShape,
  buildTile,
  INK,
  labelSprite,
  showVariant,
  standard,
  type AxisMesh,
  type TileMesh,
} from "./meshes.ts";
import {
  bounceAt,
  compilePlan,
  DEFAULT_COLOR,
  evalExtent,
  evalFlip,
  evalGrow,
  evalPos,
  evalPresence,
  landing,
  shapeExtent,
  TILE_H,
  windowEnv,
  type ChapterPlan,
  type Plan,
  type Track,
} from "./plan.ts";

const SKY = "#dce7f2";
const BOARD = "#f7f0e3";
const SKIRT = "#d9c6a5";
const TRAY = "#cdb48c";
const TRAY_DEPTH = 1.0;
const ROW_LABEL_H = 0.55;
const TINY = 1e-4;
const LINK_SEGMENTS = 32;
const LINK_RADIAL = 6;

interface ShapeObj {
  def: ConceptShape;
  group: THREE.Group;
  main: THREE.MeshStandardMaterial;
  width: number;
  height: number;
}
interface LinkObj {
  def: ConceptData["links"][number];
  tube: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  head: THREE.Mesh | null;
  label: THREE.Sprite | null;
  key: string;
  mid: THREE.Vector3;
}
interface RowObj {
  def: ConceptData["rows"][number];
  tray: THREE.Mesh | null;
  label: THREE.Sprite | null;
}
interface Box {
  c: THREE.Vector3;
  w: number;
  h: number;
  d: number;
}

const tmpColor2 = new THREE.Color();

function evalColor(tr: Track<string>, t: number, out: THREE.Color): THREE.Color {
  let k: Track<string>["keys"][number] | null = null;
  for (const key of tr.keys) {
    if (key.at <= t) k = key;
    else break;
  }
  if (!k) return out.set(tr.init);
  const p = k.dur <= 0 ? 1 : clamp((t - k.at) / k.dur);
  return out.set(k.from).lerp(tmpColor2.set(k.to), p);
}

/** Arrow path between two boxes: side to side (arching up) or top to bottom (bulging to the camera). */
function linkCurve(a: Box, b: Box, bend: number): THREE.QuadraticBezierCurve3 {
  const dx = b.c.x - a.c.x;
  const dy = b.c.y - a.c.y;
  const z = Math.max(a.c.z + a.d / 2, b.c.z + b.d / 2) + 0.15;
  const gap = 0.1;
  let s: THREE.Vector3;
  let e: THREE.Vector3;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = Math.sign(dx) || 1;
    s = new THREE.Vector3(a.c.x + sx * (a.w / 2 + gap), a.c.y, z);
    e = new THREE.Vector3(b.c.x - sx * (b.w / 2 + gap), b.c.y, z);
  } else {
    const sy = Math.sign(dy) || 1;
    s = new THREE.Vector3(a.c.x, a.c.y + sy * (a.h / 2 + gap), z);
    e = new THREE.Vector3(b.c.x, b.c.y - sy * (b.h / 2 + gap), z);
  }
  const dist = s.distanceTo(e);
  const ctrl = s.clone().add(e).multiplyScalar(0.5);
  if (Math.abs(dx) >= Math.abs(dy)) ctrl.y += bend * (0.22 * dist + 0.4);
  else ctrl.z += bend * (0.25 * dist + 0.4);
  return new THREE.QuadraticBezierCurve3(s, ctrl, e);
}

export function createConceptEngine(): Engine {
  let ctx: EngineContext | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let data: ConceptData | null = null;
  let plan: Plan | null = null;
  let tiles = new Map<string, TileMesh>();
  let shapes = new Map<string, ShapeObj>();
  let axes = new Map<string, AxisMesh>();
  let links = new Map<string, LinkObj>();
  let rows = new Map<string, RowObj>();
  /** Geometries not always attached to a mesh (tile text variants): disposed explicitly. */
  let owned = new Set<THREE.BufferGeometry>();
  let box = { center: new THREE.Vector3(), radius: 1 };
  let spec: SceneSpec | null = null;
  let graphPlan: GraphPlan | null = null;
  let graphs: GraphRuntime | null = null;
  /** User slider values (setParams); null = the scene's own keyframes. */
  let overrides: Record<string, number> | null = null;
  let last = { chapter: "", t: 0 };

  const chapterPlan = (id: string): ChapterPlan => plan!.chapters.get(id) ?? plan!.empty;
  const roleColor = (role?: string) => (role && data?.roles.find((r) => r.id === role)?.color) || DEFAULT_COLOR;

  /** Bottom-centre position (with drop/bounce), presence scale and landing squash of a tile or shape. */
  const pose = (cp: ChapterPlan, id: string, t: number) => {
    const e = cp.entities.get(id)!;
    const pr = evalPresence(e.presence, t);
    const p = evalPos(e.pos, t);
    return {
      pos: new THREE.Vector3(p[0], p[1] + pr.drop + bounceAt(e.bounce, t), p[2]),
      scale: pr.scale,
      squash: landing(e.pos, t),
      glow: windowEnv(e.glow, t),
    };
  };

  /** Current bounding box of a tile or shape (for arrows). */
  const boxOf = (cp: ChapterPlan, id: string, t: number): Box | null => {
    const tile = tiles.get(id);
    const shape = shapes.get(id);
    if (!tile && !shape) return null;
    const { pos, scale } = pose(cp, id, t);
    const s = Math.max(scale, TINY);
    if (tile) {
      const v = evalFlip(cp.entities.get(id)!.variant, t).variant;
      return { c: pos.setY(pos.y + (tile.h * s) / 2), w: tile.widths[v]! * s, h: tile.h * s, d: tile.depth * s };
    }
    return { c: pos.setY(pos.y + (shape!.height * s) / 2), w: shape!.width * s, h: shape!.height * s, d: 0.2 };
  };

  return {
    async build(c, sceneSpec) {
      if (sceneSpec.engine !== "concept") throw new Error(`concept engine got a "${sceneSpec.engine}" scene`);
      ctx = c;
      spec = sceneSpec;
      data = sceneSpec.engineData;
      plan = compilePlan(sceneSpec, data);
      graphPlan = compileGraphPlan(sceneSpec, data);
      world = new THREE.Group();
      world.name = "concept";
      c.root.add(world);

      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(SKY);
      const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
      sun.position.set(-6, 14, 12);
      const fill = new THREE.DirectionalLight(0xdfe9ff, 0.8);
      fill.position.set(8, 6, 10);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcbb894, 1.6), sun, fill];
      for (const l of lights) c.scene.add(l);

      const { width: bw, depth: bd } = data.board;
      world.add(new THREE.Mesh(new THREE.BoxGeometry(bw, 0.4, bd), standard(BOARD)).translateY(-0.2));
      world.add(new THREE.Mesh(new THREE.BoxGeometry(bw + 0.4, 0.2, bd + 0.4), standard(SKIRT)).translateY(-0.45));

      for (const r of data.rows) {
        let tray: THREE.Mesh | null = null;
        if (r.tray) {
          tray = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, TRAY_DEPTH).translate(0, -0.08, 0), standard(r.role ? roleColor(r.role) : TRAY));
          tray.name = `row:${r.id}`;
          tray.position.set(...r.origin);
          world.add(tray);
        }
        const label = r.label ? labelSprite(c, r.label, ROW_LABEL_H, INK) : null;
        if (label) world.add(label);
        rows.set(r.id, { def: r, tray, label });
      }

      for (const a of data.axes) {
        const m = buildAxis(c, a, roleColor(a.role), roleColor);
        world.add(m.group);
        axes.set(a.id, m);
      }

      for (const tdef of data.tiles) {
        const m = buildTile(c, tdef.id, plan.variants.get(tdef.id)!, TILE_H[tdef.size ?? "m"], roleColor(tdef.role));
        for (const g of m.geos) owned.add(g);
        world.add(m.group);
        tiles.set(tdef.id, m);
      }

      for (const sdef of data.shapes) {
        const { group, main } = buildShape(sdef, roleColor(sdef.role));
        const ext = shapeExtent(sdef);
        if (sdef.label) {
          const label = labelSprite(c, sdef.label, 0.45);
          if (label) {
            label.position.set(0, ext.height + 0.5, 0);
            group.add(label);
          }
        }
        world.add(group);
        shapes.set(sdef.id, { def: sdef, group, main, width: ext.width, height: ext.height });
      }

      for (const l of data.links) {
        const mat = standard(roleColor(l.role));
        const tube = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        tube.name = `link:${l.id}`;
        let head: THREE.Mesh | null = null;
        if (l.arrow ?? true) {
          head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 14).translate(0, -0.225, 0), mat);
          world.add(head);
        }
        const label = l.label ? labelSprite(c, l.label, 0.42) : null;
        if (label) world.add(label);
        world.add(tube);
        links.set(l.id, { def: l, tube, head, label, key: "", mid: new THREE.Vector3() });
      }

      const roles = new Map(data.roles.map((r) => [r.id, r.color]));
      graphs = buildGraphs(c, world, data, (r) => (r ? (roles.get(r) ?? null) : null));

      // Bounds: board plus every place any entity ever rests at.
      const bb = new THREE.Box3(new THREE.Vector3(-bw / 2, -0.5, -bd / 2), new THREE.Vector3(bw / 2, 1.5, bd / 2));
      for (const cp of plan.chapters.values()) {
        for (const [id, e] of cp.entities) {
          const tile = tiles.get(id);
          const shape = shapes.get(id);
          if (!tile && !shape) continue;
          const w = tile ? Math.max(...tile.widths) : shape!.width;
          const h = tile ? tile.h : shape!.height;
          for (const p of [e.pos.init, ...e.pos.keys.map((k) => k.to)]) {
            bb.expandByPoint(new THREE.Vector3(p[0] - w / 2, p[1], p[2]));
            bb.expandByPoint(new THREE.Vector3(p[0] + w / 2, p[1] + h, p[2]));
          }
        }
      }
      for (const a of data.axes) bb.expandByPoint(axisPoint(a, 1));
      if (!graphs.box.isEmpty()) bb.union(graphs.box);
      const sphere = bb.getBoundingSphere(new THREE.Sphere());
      box = { center: sphere.center, radius: sphere.radius };
    },

    update(chapterId, t) {
      if (!plan || !data) return;
      const cp = chapterPlan(chapterId);
      const pulse = 0.5 + 0.5 * Math.sin(6 * t);
      last = { chapter: chapterId, t };
      graphs?.update(cp, graphPlan!.chapters.get(chapterId) ?? graphPlan!.empty, t, overrides);

      for (const [id, m] of tiles) {
        const e = cp.entities.get(id)!;
        const ps = pose(cp, id, t);
        const s = ps.scale * (1 + 0.06 * ps.glow * pulse);
        const sq = 0.18 * ps.squash;
        m.group.visible = ps.scale > TINY;
        // Ink style (book/ink.ts): highlighted tiles keep their colours.
        m.group.userData.key = ps.glow > 0;
        m.group.position.copy(ps.pos);
        m.group.scale.set(Math.max(s * (1 + 0.6 * sq), TINY), Math.max(s * (1 - sq), TINY), Math.max(s * (1 + 0.6 * sq), TINY));
        const flip = evalFlip(e.variant, t);
        showVariant(m, flip.variant);
        m.pivot.rotation.x = flip.angle;
        evalColor(e.color, t, m.body.material.color);
        const k = ps.glow * (0.04 + 0.07 * pulse);
        m.body.material.emissive.setRGB(k, k * 0.82, k * 0.3);
        m.outline.visible = ps.glow > 0;
        m.outline.material.opacity = ps.glow * (0.6 + 0.4 * pulse);
      }

      for (const [id, sh] of shapes) {
        const e = cp.entities.get(id)!;
        const ps = pose(cp, id, t);
        const s = ps.scale * (1 + 0.06 * ps.glow * pulse);
        const sq = 0.18 * ps.squash;
        sh.group.visible = ps.scale > TINY;
        sh.group.userData.key = ps.glow > 0;
        sh.group.position.copy(ps.pos);
        sh.group.scale.set(Math.max(s * (1 + 0.6 * sq), TINY), Math.max(s * (1 - sq), TINY), Math.max(s, TINY));
        evalColor(e.color, t, sh.main.color);
        const k = ps.glow * (0.04 + 0.07 * pulse);
        sh.main.emissive.setRGB(k, k * 0.82, k * 0.3);
      }

      for (const [id, ax] of axes) {
        const e = cp.entities.get(id)!;
        const def = data.axes.find((a) => a.id === id)!;
        const g = evalGrow(e.presence, t);
        ax.group.visible = g > TINY;
        ax.bar.scale.x = Math.max(g * def.length, TINY);
        if (ax.head) {
          const hs = clamp((g - 0.94) / 0.06);
          ax.head.visible = hs > 0;
          ax.head.scale.setScalar(Math.max(hs, TINY));
        }
        for (const tk of ax.ticks) tk.mesh.visible = g >= tk.frac - 1e-6 && g > TINY;
        for (const l of ax.labels) {
          const ls = clamp(((g - l.frac) * def.length) / 0.8 + (g >= 1 ? 1 : 0));
          l.sprite.visible = ls > 0 && g > TINY;
          l.sprite.position.copy(l.pos);
          l.sprite.scale.set(l.h * (l.sprite.userData.aspect as number) * Math.max(ls, TINY), l.h * Math.max(ls, TINY), 1);
        }
        evalColor(e.color, t, ax.mat.color);
        const k = windowEnv(e.glow, t) * (0.04 + 0.07 * pulse);
        ax.mat.emissive.setRGB(k, k * 0.82, k * 0.3);
      }

      for (const [id, ln] of links) {
        const e = cp.entities.get(id)!;
        const g = evalGrow(e.presence, t);
        const a = boxOf(cp, ln.def.from, t);
        const b = boxOf(cp, ln.def.to, t);
        const visible = g > TINY && !!a && !!b;
        ln.tube.visible = visible;
        if (ln.head) ln.head.visible = visible && g > 0.97;
        if (ln.label) ln.label.visible = visible && g > 0.5;
        if (!visible) continue;
        const curve = linkCurve(a!, b!, ln.def.bend ?? 1);
        const key = [curve.v0, curve.v1, curve.v2].map((v) => v.toArray().map((n) => n.toFixed(4)).join(",")).join(";");
        if (key !== ln.key) {
          ln.tube.geometry.dispose();
          ln.tube.geometry = new THREE.TubeGeometry(curve, LINK_SEGMENTS, 0.07, LINK_RADIAL, false);
          ln.key = key;
        }
        ln.tube.geometry.setDrawRange(0, Math.round(g * LINK_SEGMENTS) * LINK_RADIAL * 6);
        curve.getPoint(0.5, ln.mid);
        if (ln.head) {
          ln.head.position.copy(curve.v2);
          ln.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1));
        }
        if (ln.label) ln.label.position.copy(ln.mid).add(new THREE.Vector3(0, 0.45, 0));
        evalColor(e.color, t, ln.tube.material.color);
        const k = windowEnv(e.glow, t) * (0.06 + 0.1 * pulse);
        ln.tube.material.emissive.setRGB(k, k * 0.82, k * 0.3);
      }

      for (const [id, r] of rows) {
        const rp = cp.rows.get(id)!;
        const pr = evalPresence(rp.presence, t);
        const [x0, x1] = evalExtent(rp.extent, t);
        const visible = pr.scale > TINY;
        if (r.tray) {
          r.tray.visible = visible;
          r.tray.position.x = (x0 + x1) / 2;
          r.tray.scale.set(Math.max((x1 - x0 + 0.5) * pr.scale, TINY), Math.max(pr.scale, TINY), Math.max(pr.scale, TINY));
        }
        if (r.label) {
          const h = ROW_LABEL_H * Math.max(pr.scale, TINY);
          const w = h * (r.label.userData.aspect as number);
          r.label.visible = visible;
          r.label.position.set(x0 - 0.3 - w / 2, r.def.origin[1] + 0.5, r.def.origin[2]);
          r.label.scale.set(w, h, 1);
        }
      }
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || !data || !plan) return false;
      const cp = chapterPlan(chapterId);
      const part = anchor.part ?? "";
      switch (anchor.entity) {
        case "tile":
        case "shape": {
          const b = anchor.entity === "tile" ? (tiles.has(part) ? boxOf(cp, part, t) : null) : shapes.has(part) ? boxOf(cp, part, t) : null;
          if (!b) return false;
          out.set(b.c.x, b.c.y + b.h / 2 + 0.15, b.c.z);
          break;
        }
        case "row": {
          const r = rows.get(part);
          if (!r) return false;
          const [x0, x1] = evalExtent(cp.rows.get(part)!.extent, t);
          out.set((x0 + x1) / 2, r.def.origin[1] + 0.5, r.def.origin[2]);
          break;
        }
        case "axis": {
          const a = data.axes.find((x) => x.id === part);
          if (!a) return false;
          if (anchor.index !== undefined) {
            const p = axisLabelPos(a, anchor.index);
            if (!p) return false;
            out.copy(p);
          } else axisPoint(a, 0.5, out);
          break;
        }
        case "link": {
          const ln = links.get(part);
          if (!ln) return false;
          const a = boxOf(cp, ln.def.from, t);
          const b = boxOf(cp, ln.def.to, t);
          if (!a || !b) return false;
          linkCurve(a, b, ln.def.bend ?? 1).getPoint(0.5, out);
          break;
        }
        case "board":
          out.set(0, 0, 0);
          break;
        case "graph":
        case "plot":
        case "point":
        case "tracer":
        case "surface":
          if (!graphs?.resolve(anchor.entity, part, anchor.index, out)) return false;
          break;
        default:
          return false;
      }
      if (anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
      return true;
    },

    bounds() {
      return { center: box.center.clone(), radius: box.radius };
    },

    params(chapterId): EngineParam[] {
      const ids = spec?.chapters.find((c) => c.id === chapterId)?.activity?.test.params ?? [];
      const gp = graphPlan?.chapters.get(chapterId);
      const defs = (data?.graphs ?? []).flatMap((g) => g.params ?? []);
      return ids.flatMap((id) => {
        const p = defs.find((q) => q.id === id);
        if (!p) return [];
        const tr = gp?.params.get(id);
        const t = last.chapter === chapterId ? last.t : 0;
        const value = overrides?.[id] ?? (tr ? evalScalar(tr, t) : p.value);
        return [{ id, label: p.label ?? id, min: p.min, max: p.max, step: p.step ?? (p.max - p.min) / 100, value }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      const defs = new Map((data?.graphs ?? []).flatMap((g) => g.params ?? []).map((p) => [p.id, p]));
      overrides = {};
      for (const [id, v] of Object.entries(values)) {
        const p = defs.get(id);
        if (p && Number.isFinite(v)) overrides[id] = clamp(v, p.min, p.max);
      }
    },

    dispose() {
      if (!ctx || !world) return;
      const geos = new Set<THREE.BufferGeometry>(owned);
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        if (o instanceof THREE.Mesh) geos.add(o.geometry);
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
      });
      for (const g of geos) g.dispose();
      for (const m of mats) {
        if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
        m.dispose();
      }
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      world = null;
      lights = [];
      data = null;
      plan = null;
      tiles = new Map();
      shapes = new Map();
      axes = new Map();
      links = new Map();
      rows = new Map();
      owned = new Set();
      spec = null;
      graphPlan = null;
      graphs = null;
      overrides = null;
    },
  };
}

