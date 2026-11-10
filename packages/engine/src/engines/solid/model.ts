// three.js model of one solid: faces/edges/vertices (polyhedra) or lathes (solids of revolution),
// its net, the revolving figure, liquid, section plane, unit grid, dimension lines and count labels.
// Geometry is in real units inside `group`, which the engine scales by (chapter scale · k); labels and
// dimension lines live in `overlay` (root coordinates, never scaled).
import * as THREE from "three";
import { SOLID_LABEL_DIMS, type SolidItem, type SolidShape } from "@pv/scene-spec";
import type { EngineContext } from "../../types.ts";
import { key, Label, mat, mesh, setRod } from "../lab/draw.ts";
import type { CountWhat, PourState, SolidState } from "./acts.ts";
import {
  coneNetPoint,
  cylinderNetPoint,
  cylinderTopMatrix,
  dimsOf,
  isCurved,
  measures,
  netMatrices,
  netTree,
  polyhedron,
  profile,
  profileRuns,
  sectionPlane,
  sectionPolygon,
  surfaceTriangles,
  type Dims,
  type Measures,
  type NetTree,
  type Poly,
} from "./geometry.ts";
import { dimLabel } from "./text.ts";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const HI = "#ff7a2f";
const EDGE = "#26323f";
const LIQUID = "#3d8fe0";
const FIGURE = "#f2b134";
const SECTION = "#e0453a";
const DIM = "#1d3557";
const SEG = 64;
/** Scene-unit sizes (divided by the chapter scale inside the group). */
const EDGE_R = 0.022;
const VERTEX_R = 0.075;
const DIM_OFF = 0.38;

const trisGeometry = (tris: number[]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
};

interface DimDef {
  dim: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Offset direction of the dimension line (zero = drawn on the solid itself). */
  off: THREE.Vector3;
  /** Label direction when off is zero. */
  side: THREE.Vector3;
}

function dimDefs(shape: SolidShape, d: Dims, sides: number, poly: Poly | null): DimDef[] {
  const z = V();
  const def = (dim: string, a: THREE.Vector3, b: THREE.Vector3, off: THREE.Vector3, side = V(0, 1, 0)): DimDef => ({ dim, a, b, off: off.normalize(), side: side.normalize() });
  switch (shape) {
    case "cube":
    case "cuboid": {
      const b = shape === "cube" ? d.a : d.b;
      const c = shape === "cube" ? d.a : d.c;
      const out = [def("a", V(-d.a / 2, 0, b / 2), V(d.a / 2, 0, b / 2), V(0, 0, 1))];
      if (shape === "cuboid")
        out.push(def("b", V(d.a / 2, 0, b / 2), V(d.a / 2, 0, -b / 2), V(1, 0, 0)), def("c", V(d.a / 2, 0, b / 2), V(d.a / 2, c, b / 2), V(1, 0, 1)));
      return out;
    }
    case "prism":
    case "pyramid": {
      const R = d.l / (2 * Math.sin(Math.PI / sides));
      const rho = R * Math.cos(Math.PI / sides);
      const out = [def("l", V(-d.l / 2, 0, rho), V(d.l / 2, 0, rho), V(0, 0, 1))];
      if (shape === "prism") out.push(def("h", V(d.l / 2, 0, rho), V(d.l / 2, d.h, rho), V(d.l / 2, 0, rho)));
      else out.push(def("h", V(), V(0, d.h, 0), z.clone(), V(-1, 0, 0)), def("ap", V(0, 0, rho), V(0, d.h, 0), z.clone(), V(0, rho, d.h)));
      return out;
    }
    case "cylinder":
      return [def("r", V(0, d.h, 0), V(d.r, d.h, 0), z.clone(), V(0, 1, 0.4)), def("h", V(d.r, 0, 0), V(d.r, d.h, 0), V(1, 0, 0))];
    case "cone":
      return [def("r", V(), V(d.r, 0, 0), z.clone(), V(0, -0.4, 1)), def("h", V(), V(0, d.h, 0), z.clone(), V(-1, 0, 0)), def("ap", V(d.r, 0, 0), V(0, d.h, 0), V(d.h, d.r, 0))];
    case "frustum":
      return [def("r", V(), V(d.r, 0, 0), z.clone(), V(0, -0.4, 1)), def("r2", V(0, d.h, 0), V(d.r2, d.h, 0), z.clone(), V(0, 1, 0.4)), def("h", V(), V(0, d.h, 0), z.clone(), V(-1, 0, 0))];
    case "sphere":
      return [def("r", V(0, d.r, 0), V(d.r, d.r, 0), z.clone(), V(0, 1, 0.4))];
    default: {
      // Platonic solids: the front edge of the base.
      const f = poly!.faces[0]!;
      let best: [THREE.Vector3, THREE.Vector3] = [poly!.verts[f[0]!]!, poly!.verts[f[1]!]!];
      for (let k = 0; k < f.length; k++) {
        const a = poly!.verts[f[k]!]!;
        const b = poly!.verts[f[(k + 1) % f.length]!]!;
        if (a.z + b.z > best[0].z + best[1].z + 1e-9) best = [a, b];
      }
      return [def("a", best[0].clone(), best[1].clone(), V(0, 0, 1))];
    }
  }
}

export interface ModelRoles {
  /** Filled by a fill act: glass walls and liquid. */
  container: boolean;
  /** Pours into another solid. */
  pourer: boolean;
  /** Has unfold/fold acts. */
  net: boolean;
  /** Has a revolve act. */
  revolve: boolean;
  /** Has section acts. */
  section: boolean;
  /** Kinds of elements it counts (labels). */
  counts: Set<CountWhat>;
}

export interface PoseInput {
  st: SolidState;
  level: number;
  pour: PourState | null;
  /** Position of the base centre and z rotation, root coordinates. */
  pos: THREE.Vector3;
  rotZ: number;
  /** Chapter drawing scale (scene units per real unit). */
  s: number;
  dims: boolean;
  units: boolean;
  /** The F/V/S panel is on screen (vertices shown as dots). */
  elements: boolean;
}

export class SolidModel {
  readonly group = new THREE.Group();
  readonly overlay = new THREE.Group();
  readonly shape: SolidShape;
  readonly sides: number;
  readonly color: THREE.Color;
  d: Dims;
  poly: Poly | null = null;
  tree: NetTree | null = null;
  /** Real measures at k = 1. */
  m: Measures;
  private body = new THREE.Group();
  private faceMeshes: THREE.Mesh[] = [];
  private faceMats: THREE.MeshStandardMaterial[] = [];
  private edgeMeshes: THREE.Mesh[] = [];
  private vertexMeshes: THREE.Mesh[] = [];
  private grids: THREE.LineSegments[] = [];
  private gridKey = "";
  private lathes: THREE.Mesh[] = [];
  private rims: THREE.Line[] = [];
  private netParts: { lateral: THREE.Mesh; rows: number; cols: number; base: THREE.Mesh; top: THREE.Mesh | null } | null = null;
  private netU = -1;
  private figure: THREE.Group | null = null;
  private liquid: THREE.Mesh | null = null;
  private carried: THREE.Mesh | null = null;
  private plane: THREE.Mesh | null = null;
  private cut: THREE.Mesh | null = null;
  private cutKey = "";
  private tris: number[] = [];
  private dimLines: THREE.LineSegments;
  private dims: { def: DimDef; label: Label }[] = [];
  private countLabels = new Map<CountWhat, Label[]>();
  readonly counter: Label;
  private laidOut = "";
  /** Last pose: matrix group-local -> root. */
  readonly matrix = new THREE.Matrix4();
  private faceM: THREE.Matrix4[] = [];
  private mats: {
    hi: THREE.MeshStandardMaterial;
    edge: THREE.MeshStandardMaterial;
    vertex: THREE.MeshStandardMaterial;
    lathe: THREE.MeshStandardMaterial;
    liquid: THREE.MeshStandardMaterial;
    figure: THREE.MeshStandardMaterial;
    cut: THREE.MeshStandardMaterial;
    plane: THREE.MeshStandardMaterial;
    line: THREE.LineBasicMaterial;
    grid: THREE.LineBasicMaterial;
    dim: THREE.LineBasicMaterial;
  };

  constructor(
    private readonly ctx: EngineContext,
    readonly item: SolidItem,
    private readonly unit: string,
    private readonly roles: ModelRoles,
    private readonly labels: (Label | { dispose(): void })[],
  ) {
    this.shape = item.shape;
    this.sides = item.sides ?? 4;
    this.color = new THREE.Color(item.color ?? "#4f86c6");
    this.group.name = `solid:${item.id}`;
    this.group.rotation.order = "ZYX";
    this.overlay.name = `overlay:${item.id}`;
    this.d = dimsOf(item);
    this.m = measures(this.shape, this.d, this.sides);
    const glow = (c: THREE.ColorRepresentation, e = 0.35) => mat(c, { emissive: new THREE.Color(c), emissiveIntensity: e, side: THREE.DoubleSide });
    this.mats = {
      hi: glow(HI),
      edge: mat(EDGE, { roughness: 0.5 }),
      vertex: mat(EDGE, { roughness: 0.4 }),
      lathe: mat(this.color, { side: THREE.DoubleSide, roughness: 0.45 }),
      liquid: mat(LIQUID, { transparent: true, opacity: 0.8, roughness: 0.15, emissive: new THREE.Color(LIQUID), emissiveIntensity: 0.15 }),
      figure: glow(FIGURE, 0.3),
      cut: glow(SECTION, 0.4),
      plane: new THREE.MeshStandardMaterial({ color: "#9fd3f0", transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, roughness: 0.2 }),
      line: new THREE.LineBasicMaterial({ color: EDGE }),
      grid: new THREE.LineBasicMaterial({ color: "#14202b", transparent: true, opacity: 0.8 }),
      dim: new THREE.LineBasicMaterial({ color: DIM, depthTest: false, transparent: true }),
    };
    this.group.add(this.body);
    this.dimLines = key(new THREE.LineSegments(new THREE.BufferGeometry(), this.mats.dim));
    this.dimLines.name = `dims:${item.id}`;
    this.dimLines.renderOrder = 4;
    this.dimLines.frustumCulled = false;
    this.overlay.add(this.dimLines);
    this.counter = this.label(0.42, "#b4471b");
    this.overlay.add(this.counter.object);
  }

  private label(h: number, ink = DIM, pill = true): Label {
    const l = new Label(this.ctx, h, ink, pill);
    this.labels.push(l);
    return l;
  }

  /** Real dimensions at scale factor k. */
  real(k: number): Dims {
    const d = this.d;
    return { a: d.a * k, b: d.b * k, c: d.c * k, l: d.l * k, h: d.h * k, r: d.r * k, r2: d.r2 * k };
  }

  /** Real measures at scale factor k. */
  measuresAt(k: number): Measures {
    return { V: this.m.V * k ** 3, A: this.m.A * k * k, Al: this.m.Al * k * k, Ab: this.m.Ab * k * k, ap: this.m.ap * k, height: this.m.height * k };
  }

  /** Rebuilds the geometry for new dimensions (sliders). `s` = chapter scale. */
  layout(d: Dims, s: number): void {
    const k = `${Object.values(d).join(",")}|${s}`;
    if (k === this.laidOut) return;
    this.laidOut = k;
    this.d = d;
    this.disposeBody();
    this.netU = -1;
    this.gridKey = "";
    this.cutKey = "";
    const curved = isCurved(this.shape);
    this.poly = curved ? null : polyhedron(this.shape, d, this.sides);
    this.tree = this.poly ? netTree(this.poly) : null;
    this.m = measures(this.shape, d, this.sides, this.poly ?? undefined);
    this.tris = this.roles.section ? surfaceTriangles(this.shape, d, this.sides, this.poly ?? undefined) : [];
    if (this.poly) this.buildPoly(this.poly, s);
    else this.buildCurved(d);
    if (this.roles.container) this.buildLiquid(d);
    if (this.roles.pourer) this.buildCarried(d);
    if (this.roles.section) this.buildSection(d);
    this.buildDims();
    this.buildCountLabels();
  }

  private buildPoly(p: Poly, s: number): void {
    p.faces.forEach((f, i) => {
      if (!this.faceMats[i]) {
        const c = this.color.clone().offsetHSL(0, 0, ((i % 3) - 1) * 0.055);
        this.faceMats[i] = mat(c, { side: THREE.DoubleSide, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      }
      const pos: number[] = [];
      for (let k = 1; k + 1 < f.length; k++) for (const v of [f[0]!, f[k]!, f[k + 1]!]) pos.push(p.verts[v]!.x, p.verts[v]!.y, p.verts[v]!.z);
      const m = mesh(trisGeometry(pos), this.faceMats[i]!, `face:${i}`);
      m.matrixAutoUpdate = false;
      const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(f.map((v) => p.verts[v]!)), this.mats.line);
      loop.name = "outline";
      m.add(loop);
      this.body.add(m);
      this.faceMeshes.push(m);
    });
    const er = EDGE_R / s;
    const egeo = new THREE.CylinderGeometry(er, er, 1, 8);
    for (const [i, j] of p.edges) {
      const e = mesh(egeo, this.mats.edge, "edge");
      setRod(e, p.verts[i]!, p.verts[j]!);
      this.body.add(e);
      this.edgeMeshes.push(e);
    }
    const vgeo = new THREE.SphereGeometry(VERTEX_R / s, 14, 10);
    for (const v of p.verts) {
      const x = mesh(vgeo, this.mats.vertex, "vertex");
      x.position.copy(v);
      this.body.add(x);
      this.vertexMeshes.push(x);
    }
  }

  private buildCurved(d: Dims): void {
    for (const run of profileRuns(this.shape, d)) {
      const m = mesh(new THREE.LatheGeometry(run, SEG, Math.PI / 2, Math.PI * 2), this.mats.lathe, "lathe");
      this.body.add(m);
      this.lathes.push(m);
    }
    const ring = (r: number, y: number) => {
      const pts = Array.from({ length: SEG + 1 }, (_, i) => V(r * Math.sin((2 * Math.PI * i) / SEG), y, r * Math.cos((2 * Math.PI * i) / SEG)));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.mats.line);
      l.name = "rim";
      this.body.add(l);
      this.rims.push(l);
    };
    if (this.shape === "cylinder") (ring(d.r, 0), ring(d.r, d.h));
    if (this.shape === "cone") ring(d.r, 0);
    if (this.shape === "frustum") (ring(d.r, 0), ring(d.r2, d.h));
    if (this.roles.net && (this.shape === "cylinder" || this.shape === "cone")) {
      const rows = this.shape === "cone" ? 8 : 1;
      const cols = SEG;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((rows + 1) * (cols + 1) * 3), 3));
      const idx: number[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const a = r * (cols + 1) + c;
          const b = a + cols + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      g.setIndex(idx);
      const lateral = mesh(g, this.mats.lathe, "net:lateral");
      lateral.frustumCulled = false;
      const disc = (y: number) => mesh(new THREE.CircleGeometry(d.r, SEG).rotateX(-Math.PI / 2).translate(0, y, 0), this.mats.lathe, "net:disc");
      const base = disc(0.0005);
      const top = this.shape === "cylinder" ? disc(d.h) : null;
      if (top) top.matrixAutoUpdate = false;
      this.body.add(lateral, base, ...(top ? [top] : []));
      this.netParts = { lateral, rows, cols, base, top };
    }
    if (this.roles.revolve) {
      const fig = new THREE.Group();
      fig.name = "figure";
      const shape = new THREE.Shape(profile(this.shape, d));
      fig.add(mesh(new THREE.ShapeGeometry(shape, 24), this.mats.figure, "figure:face"));
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(profile(this.shape, d).map((p) => V(p.x, p.y, 0))), this.mats.line);
      fig.add(outline);
      key(fig);
      const h = this.shape === "sphere" ? 2 * d.r : d.h;
      const axis = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([V(0, -0.18 * h, 0), V(0, 1.18 * h, 0)]),
        new THREE.LineDashedMaterial({ color: "#c0392b", dashSize: h * 0.06, gapSize: h * 0.04 }),
      );
      axis.computeLineDistances();
      axis.name = "axis";
      key(axis);
      const g = new THREE.Group();
      g.add(fig, axis);
      this.body.add(g);
      this.figure = g;
    }
  }

  private buildLiquid(d: Dims): void {
    const inset = 0.965;
    const unit: Partial<Dims> =
      this.shape === "cylinder" ? { r: d.r * inset, h: 1 } : this.shape === "prism" ? { l: d.l * inset, h: 1 } : { a: d.a * inset, b: (this.shape === "cube" ? d.a : d.b) * inset, c: 1 };
    const shape = this.shape === "cube" ? "cuboid" : this.shape;
    const liquid = key(mesh(trisGeometry(surfaceTriangles(shape, { ...d, ...unit }, this.sides)), this.mats.liquid, "liquid"));
    liquid.renderOrder = 2;
    this.body.add(liquid);
    this.liquid = liquid;
  }

  private buildCarried(d: Dims): void {
    const h = this.m.height;
    const top = V(0, h, 0);
    const tris = surfaceTriangles(this.shape, d, this.sides, this.poly ?? undefined);
    for (let i = 0; i < tris.length; i += 3) {
      const p = V(tris[i]!, tris[i + 1]!, tris[i + 2]!).sub(top).multiplyScalar(0.94);
      tris[i] = p.x;
      tris[i + 1] = p.y;
      tris[i + 2] = p.z;
    }
    const m = key(mesh(trisGeometry(tris), this.mats.liquid, "liquid:carried"));
    m.position.copy(top);
    m.renderOrder = 2;
    this.body.add(m);
    this.carried = m;
  }

  private buildSection(d: Dims): void {
    const size = 1.7 * Math.max(2 * Math.max(d.a, d.l, d.r, d.b) || 1, this.m.height);
    this.plane = mesh(new THREE.PlaneGeometry(size, size), this.mats.plane, "section:plane");
    this.plane.renderOrder = 3;
    this.cut = key(mesh(new THREE.BufferGeometry(), this.mats.cut, "section"));
    this.cut.renderOrder = 4;
    this.body.add(this.plane, this.cut);
  }

  private buildDims(): void {
    for (const x of this.dims) this.overlay.remove(x.label.object);
    const defs = dimDefs(this.shape, this.d, this.sides, this.poly).filter((x) => SOLID_LABEL_DIMS[this.shape].includes(x.dim));
    this.dims = defs.map((def, i) => {
      const old = this.dims[i];
      const label = old?.label ?? this.label(0.34, DIM);
      this.overlay.add(label.object);
      return { def, label };
    });
  }

  private buildCountLabels(): void {
    if (!this.poly) return;
    for (const what of this.roles.counts) {
      const n = what === "faces" ? this.poly.faces.length : what === "edges" ? this.poly.edges.length : this.poly.verts.length;
      const list = this.countLabels.get(what) ?? [];
      while (list.length < n) {
        const l = this.label(0.3, "#b4471b");
        l.set(String(list.length + 1));
        this.overlay.add(l.object);
        list.push(l);
      }
      this.countLabels.set(what, list);
    }
  }

  // ------------------------------------------------------------ pose

  pose(x: PoseInput): void {
    const { st } = x;
    const k = st.k;
    this.group.position.copy(x.pos);
    this.group.rotation.set(0, st.spin, x.rotZ, "ZYX");
    this.group.scale.setScalar(Math.max(1e-4, x.s * k * st.shown));
    this.group.visible = st.shown > 0.001;
    this.group.updateMatrix();
    this.matrix.copy(this.group.matrix);
    key(this.group, st.busy);
    const glass = this.roles.container || (this.roles.pourer && x.pour !== null);
    const opacity = glass || st.section ? 0.32 : st.sweep < 1 ? 0.7 : 1;
    const setOpacity = (m: THREE.MeshStandardMaterial) => {
      const tr = opacity < 0.999;
      if (m.opacity !== opacity || m.transparent !== tr) {
        m.opacity = opacity;
        m.transparent = tr;
        m.depthWrite = !tr;
        m.needsUpdate = true;
      }
    };
    for (const m of this.faceMats) setOpacity(m);
    setOpacity(this.mats.lathe);
    const folded = st.unfold < 1e-4;
    const lit = (what: CountWhat, i: number) => st.count?.what === what && i < st.count.lit;
    if (this.poly && this.tree) {
      this.faceM = netMatrices(this.tree, st.unfold);
      this.faceMeshes.forEach((m, i) => {
        m.matrix.copy(this.faceM[i]!);
        m.matrixWorldNeedsUpdate = true;
        const on = lit("faces", i);
        m.material = on ? this.mats.hi : this.faceMats[i]!;
        key(m, on || st.unfold > 0);
      });
      this.edgeMeshes.forEach((e, i) => {
        e.visible = folded;
        const on = lit("edges", i);
        e.material = on ? this.mats.hi : this.mats.edge;
        // Edges and dots keep their screen thickness whatever the scale factor k.
        e.scale.x = e.scale.z = (on ? 2.2 : 1) / k;
        key(e, on);
      });
      const showVerts = x.elements || st.count?.what === "vertices";
      this.vertexMeshes.forEach((v, i) => {
        const on = lit("vertices", i);
        v.visible = folded && (on || showVerts);
        v.material = on ? this.mats.hi : this.mats.vertex;
        v.scale.setScalar((on ? 1.6 : 1) / k);
        key(v, on);
      });
      this.poseGrid(x.units, k);
    } else this.poseCurved(st);
    this.poseLiquid(x);
    this.poseSection(st);
    this.poseDims(x, folded && st.sweep >= 1 && x.pour === null);
    this.poseCounts(st);
  }

  private poseCurved(st: SolidState): void {
    const folded = st.unfold < 1e-4;
    const swept = Math.max(0, Math.min(SEG, Math.round(st.sweep * SEG)));
    for (const m of this.lathes) {
      m.visible = folded && swept > 0;
      const pts = (m.geometry as THREE.LatheGeometry).parameters.points.length;
      m.geometry.setDrawRange(0, swept * (pts - 1) * 6);
      key(m, st.sweep < 1);
    }
    for (const r of this.rims) r.visible = folded && st.sweep >= 1;
    if (this.figure) {
      this.figure.visible = st.figure && folded;
      const fig = this.figure.children[0]!;
      fig.rotation.y = 2 * Math.PI * st.sweep;
    }
    const net = this.netParts;
    if (!net) return;
    for (const m of [net.lateral, net.base, ...(net.top ? [net.top] : [])]) m.visible = !folded;
    if (folded) return;
    key(net.lateral, true);
    key(net.base, true);
    if (net.top) key(net.top, true);
    if (this.netU === st.unfold) return;
    this.netU = st.unfold;
    const pos = net.lateral.geometry.getAttribute("position") as THREE.BufferAttribute;
    const p = V();
    const d = this.d;
    const a = Math.hypot(d.r, d.h);
    for (let r = 0; r <= net.rows; r++)
      for (let c = 0; c <= net.cols; c++) {
        const phi = -Math.PI + (2 * Math.PI * c) / net.cols;
        if (this.shape === "cylinder") cylinderNetPoint(d.r, phi, r * d.h, st.unfold, p);
        else coneNetPoint(d.r, d.h, (a * r) / net.rows, phi, st.unfold, p);
        pos.setXYZ(r * (net.cols + 1) + c, p.x, p.y, p.z);
      }
    pos.needsUpdate = true;
    net.lateral.geometry.computeVertexNormals();
    net.lateral.geometry.computeBoundingSphere();
    if (net.top) {
      net.top.matrix.copy(cylinderTopMatrix(d.r, d.h, st.unfold));
      net.top.matrixWorldNeedsUpdate = true;
    }
  }

  private poseGrid(show: boolean, k: number): void {
    const p = this.poly!;
    const want = show ? `${this.laidOut}|${k}` : "";
    if (want !== this.gridKey) {
      for (const g of this.grids) {
        g.parent?.remove(g);
        g.geometry.dispose();
      }
      this.grids = [];
      this.gridKey = want;
      if (show) {
        const cell = 1 / k;
        p.faces.forEach((f, i) => {
          if (f.length !== 4) return;
          const [v0, v1, , v3] = f.map((v) => p.verts[v]!);
          const e1 = v1!.clone().sub(v0!);
          const e2 = v3!.clone().sub(v0!);
          const n1 = e1.length() / cell;
          const n2 = e2.length() / cell;
          if (n1 > 24 || n2 > 24) return;
          const lift = p.normals[i]!.clone().multiplyScalar(0.004 * Math.max(e1.length(), e2.length()));
          const pts: THREE.Vector3[] = [];
          // Both sides of the face: the inner side faces up once the net is open.
          for (const side of [1, -1])
            for (const [ea, eb, n] of [[e1, e2, n1], [e2, e1, n2]] as const)
              for (let j = 1; j < n - 1e-6; j++) {
                const a = v0!.clone().addScaledVector(ea, j / n).addScaledVector(lift, side);
                pts.push(a, a.clone().add(eb));
              }
          if (!pts.length) return;
          const g = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), this.mats.grid);
          g.name = "units";
          key(g);
          this.faceMeshes[i]!.add(g);
          this.grids.push(g);
        });
      }
    }
  }

  private poseLiquid(x: PoseInput): void {
    const h = this.m.height;
    if (this.liquid) {
      this.liquid.visible = x.level > 0.002;
      this.liquid.scale.set(1, Math.max(1e-4, x.level * h * 0.985), 1);
      this.liquid.position.set(0, h * 0.004, 0);
    }
    if (this.carried) {
      const f = x.pour?.left ?? 0;
      this.carried.visible = x.pour !== null && f > 0.002;
      if (this.shape === "cone" || this.shape === "pyramid") this.carried.scale.setScalar(Math.max(1e-4, Math.cbrt(f)));
      else this.carried.scale.set(1, Math.max(1e-4, f), 1);
    }
  }

  private poseSection(st: SolidState): void {
    if (!this.plane || !this.cut) return;
    const on = st.section !== null && st.unfold < 1e-4;
    this.plane.visible = on;
    this.cut.visible = on;
    if (!on) return;
    const { y, tilt } = st.section!;
    const y0 = y * this.m.height;
    this.plane.position.set(0, y0, 0);
    this.plane.rotation.set(((tilt - 90) * Math.PI) / 180, 0, 0);
    const k = `${this.laidOut}|${y0.toFixed(5)}|${tilt.toFixed(3)}`;
    if (k === this.cutKey) return;
    this.cutKey = k;
    const poly = sectionPolygon(this.tris, sectionPlane(y0, tilt));
    const pos: number[] = [];
    for (let i = 1; i + 1 < poly.length; i++) for (const p of [poly[0]!, poly[i]!, poly[i + 1]!]) pos.push(p.x, p.y, p.z);
    this.cut.geometry.dispose();
    this.cut.geometry = trisGeometry(pos);
    this.sectionCentre = poly.length ? poly.reduce((s, p) => s.add(p), V()).divideScalar(poly.length) : V(0, y0, 0);
  }

  private sectionCentre = V();

  private poseDims(x: PoseInput, can: boolean): void {
    const show = x.dims && can;
    const pts: THREE.Vector3[] = [];
    const real = this.real(x.st.k);
    const m = this.measuresAt(x.st.k);
    const rot = new THREE.Matrix3().setFromMatrix4(this.matrix);
    for (const { def, label } of this.dims) {
      label.object.visible = show;
      if (!show) continue;
      const a = def.a.clone().applyMatrix4(this.matrix);
      const b = def.b.clone().applyMatrix4(this.matrix);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      if (def.off.lengthSq() > 0) {
        const o = def.off.clone().applyMatrix3(rot).normalize();
        const ao = a.clone().addScaledVector(o, DIM_OFF);
        const bo = b.clone().addScaledVector(o, DIM_OFF);
        pts.push(a.clone().addScaledVector(o, 0.08), a.clone().addScaledVector(o, DIM_OFF + 0.1), b.clone().addScaledVector(o, 0.08), b.clone().addScaledVector(o, DIM_OFF + 0.1), ao, bo);
        // Arrow ticks at both ends.
        const along = b.clone().sub(a).normalize();
        for (const [p, sgn] of [[ao, 1], [bo, -1]] as const) {
          pts.push(p, p.clone().addScaledVector(along, 0.14 * sgn).addScaledVector(o, 0.07), p, p.clone().addScaledVector(along, 0.14 * sgn).addScaledVector(o, -0.07));
        }
        label.object.position.copy(mid).addScaledVector(o, DIM_OFF + 0.36);
      } else {
        pts.push(a, b);
        const sd = def.side.clone().applyMatrix3(rot).normalize();
        label.object.position.copy(mid).addScaledVector(sd, 0.36);
      }
      label.set(dimLabel(this.shape, def.dim, real, m, this.unit));
    }
    this.dimLines.visible = show;
    this.dimLines.geometry.dispose();
    this.dimLines.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  private poseCounts(st: SolidState): void {
    for (const [what, list] of this.countLabels)
      list.forEach((l, i) => {
        const on = st.count?.what === what && i < st.count.lit && st.unfold < 1e-4;
        l.object.visible = on;
        if (!on) return;
        const p = this.elementPoint(what, i, V());
        const c = V(0, this.m.height / 2, 0).applyMatrix4(this.matrix);
        const dir = p.clone().sub(c);
        if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
        l.object.position.copy(p).addScaledVector(dir.normalize(), 0.32);
      });
    this.counter.object.visible = st.count !== null;
  }

  // ------------------------------------------------------------ anchors (root coordinates)

  private toRoot(p: THREE.Vector3, face = -1): THREE.Vector3 {
    if (face >= 0 && this.faceM[face]) p.applyMatrix4(this.faceM[face]!);
    return p.applyMatrix4(this.matrix);
  }

  top(out: THREE.Vector3): THREE.Vector3 {
    return this.toRoot(out.set(0, this.m.height, 0));
  }

  centre(out: THREE.Vector3): THREE.Vector3 {
    return this.toRoot(out.set(0, this.m.height / 2, 0));
  }

  elementPoint(what: CountWhat, i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.poly;
    const d = this.d;
    if (!p) {
      const lateral = this.shape === "cylinder" ? d.r : this.shape === "cone" ? d.r / 2 : this.shape === "frustum" ? (d.r + d.r2) / 2 : d.r;
      if (what === "faces") out.set(0, i === 0 ? 0 : i === 1 ? this.m.height / 2 : this.m.height, i === 1 ? lateral : 0);
      else if (what === "edges") out.set(0, i === 0 ? 0 : d.h, i === 0 ? d.r : this.shape === "frustum" ? d.r2 : d.r);
      else out.set(0, this.m.height, 0);
      return this.toRoot(out);
    }
    if (what === "faces") return this.toRoot(out.copy(p.centroids[i] ?? p.centroids[0]!), i);
    if (what === "vertices") {
      const f = p.faces.findIndex((loop) => loop.includes(i));
      return this.toRoot(out.copy(p.verts[i] ?? p.verts[0]!), f);
    }
    const e = p.edges[i] ?? p.edges[0]!;
    const f = p.faces.findIndex((loop) => loop.includes(e[0]) && loop.includes(e[1]));
    return this.toRoot(out.copy(p.verts[e[0]]!).add(p.verts[e[1]]!).multiplyScalar(0.5), f);
  }

  dimPoint(dim: string, out: THREE.Vector3): boolean {
    const x = this.dims.find((q) => q.def.dim === dim);
    if (!x) return false;
    if (x.label.object.visible) out.copy(x.label.object.position);
    else this.toRoot(out.copy(x.def.a).add(x.def.b).multiplyScalar(0.5));
    return true;
  }

  sectionPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.toRoot(out.copy(this.sectionCentre));
  }

  liquidPoint(level: number, out: THREE.Vector3): THREE.Vector3 {
    return this.toRoot(out.set(0, level * this.m.height, 0));
  }

  figurePoint(sweep: number, out: THREE.Vector3): THREE.Vector3 {
    const prof = profile(this.shape, this.d);
    const c = prof.reduce((s, p) => s.add(p), new THREE.Vector2()).divideScalar(prof.length);
    const th = 2 * Math.PI * sweep;
    return this.toRoot(out.set(c.x * Math.cos(th), c.y, -c.x * Math.sin(th)));
  }

  netPoint(out: THREE.Vector3): THREE.Vector3 {
    if (!this.poly) return this.toRoot(out.set(0, 0, this.d.r + (this.shape === "cone" ? Math.hypot(this.d.r, this.d.h) / 2 : this.d.h / 2)));
    const box = new THREE.Box3();
    this.poly.centroids.forEach((c, i) => box.expandByPoint(c.clone().applyMatrix4(this.faceM[i] ?? new THREE.Matrix4())));
    return this.toRoot(box.getCenter(out));
  }

  // ------------------------------------------------------------ cleanup

  private disposeBody(): void {
    const geos = new Set<THREE.BufferGeometry>();
    this.body.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) geos.add(g);
      const m = (o as THREE.Line).material;
      if (m instanceof THREE.LineDashedMaterial) m.dispose();
    });
    for (const g of geos) g.dispose();
    this.group.remove(this.body);
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.faceMeshes = [];
    this.edgeMeshes = [];
    this.vertexMeshes = [];
    this.grids = [];
    this.lathes = [];
    this.rims = [];
    this.netParts = null;
    this.figure = null;
    this.liquid = null;
    this.carried = null;
    this.plane = null;
    this.cut = null;
  }

  dispose(): void {
    this.disposeBody();
    this.dimLines.geometry.dispose();
    for (const m of [...this.faceMats, ...Object.values(this.mats)]) m.dispose();
  }
}
