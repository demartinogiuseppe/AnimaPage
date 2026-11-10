// Rig of the communicating vessels (kind "vessels"): lab bench, water tower with buildings, canal
// between two seas. Physics and layouts: ./vessels.ts. Water surfaces are fixed-topology meshes
// updated in place (the ink outlines keep following them).
import * as THREE from "three";
import { engineText } from "@pv/scene-spec/i18n";
import { Arrow, key, mat, mesh, rod, setRod, type Label } from "./draw.ts";
import { num, type Experiment, type Frame, type LabState } from "./physics.ts";
import { base, GLASS, type Builder, type Fit, type LabelMaker, type Rig } from "./rigs.ts";
import { LAB_VESSEL, TOWER, type Vessel, type VesselsState } from "./vessels.ts";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WATER = "#3d8fd6";
/** Water keeps its colour in ink style (material-level key, see book/ink.ts). */
function waterMat(color = WATER): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.62, roughness: 0.2, depthWrite: false });
  m.userData.key = true;
  return m;
}
const LEVEL = "#d0302c";

/** Radius (m) of a container's section at height h above its base. */
function radiusAt(c: Vessel, h: number): number {
  if (c.shape !== "flask") return c.r;
  const neck = 1.7 * c.r;
  const r = h >= neck ? 0.03 : Math.sqrt(Math.max(0, 2 * c.r * h - h * h));
  return Math.max(0.03, r);
}

/** Lathe water body of fixed topology, refilled up to a height with set(). */
class WaterLathe {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly rings = 16;
  private readonly seg = 28;

  constructor(
    private readonly radius: (h: number) => number,
    m: THREE.Material,
  ) {
    const R = this.rings;
    const S = this.seg;
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(((R + 1) * (S + 1) + S + 2) * 3), 3));
    const idx: number[] = [];
    for (let r = 0; r < R; r++)
      for (let s = 0; s < S; s++) {
        const a = r * (S + 1) + s;
        const b = a + S + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const c0 = (R + 1) * (S + 1);
    for (let s = 0; s < S; s++) idx.push(c0, c0 + 2 + s, c0 + 1 + s);
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, m);
    this.mesh.renderOrder = 2;
    this.set(0.001);
  }

  /** Fills up to height h (scene units, from the base); radius() takes scene units too. */
  set(h: number): void {
    const p = this.geo.getAttribute("position") as THREE.BufferAttribute;
    const R = this.rings;
    const S = this.seg;
    const H = Math.max(h, 1e-4);
    for (let r = 0; r <= R; r++) {
      const y = (H * r) / R;
      const rad = this.radius(y) * 0.94;
      for (let s = 0; s <= S; s++) {
        const a = (s / S) * Math.PI * 2;
        p.setXYZ(r * (S + 1) + s, Math.cos(a) * rad, y, Math.sin(a) * rad);
      }
    }
    const c0 = (R + 1) * (S + 1);
    const top = this.radius(H) * 0.94;
    p.setXYZ(c0, 0, H, 0);
    for (let s = 0; s <= S; s++) {
      const a = (s / S) * Math.PI * 2;
      p.setXYZ(c0 + 1 + s, Math.cos(a) * top, H, Math.sin(a) * top);
    }
    p.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  dispose(): void {
    this.geo.dispose();
  }
}

/** Dashed horizontal line (scene units), moved with position.y. */
function dashedLine(x0: number, x1: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: LEVEL });
  const geo = new THREE.BoxGeometry(0.22, 0.04, 0.04);
  for (let x = x0; x < x1; x += 0.36) {
    const d = new THREE.Mesh(geo, m);
    d.position.set(x + 0.11, 0, z);
    g.add(d);
  }
  return key(g);
}

interface Overlays {
  level: { line: THREE.Group; label: Label | null } | null;
  pressure: { arrows: Arrow[]; labels: Label[] } | null;
}

// ---------------------------------------------------------------- lab bench

function labRig(fit: Fit, frame: Frame, _ex: Experiment): Rig {
  const g = new THREE.Group();
  const parts = new THREE.Group();
  g.add(parts);
  const s = fit.s;
  let cups: { glass: THREE.Mesh; water: WaterLathe; x: number; c: Vessel }[] = [];
  let pipe: { glass: THREE.Mesh; water: THREE.Mesh; x0: number; x1: number } | null = null;
  const dots = key(new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }), 24));
  dots.frustumCulled = false;
  const tap = new THREE.Group();
  tap.add(mesh(new THREE.BoxGeometry(0.9, 0.16, 0.22).translate(-0.3, 0, 0), mat("#9aa4ae", { metalness: 0.5 })));
  tap.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 12).translate(0, -0.14, 0), mat("#9aa4ae", { metalness: 0.5 })));
  const stream = key(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10).translate(0, -0.5, 0), waterMat(), "stream"));
  g.add(dots, tap, stream);
  const ov: Overlays = { level: null, pressure: null };
  let into = 0;
  const pipeY = LAB_VESSEL.pipeY * s;
  const pipeR = Math.max(0.05, LAB_VESSEL.pipeR * s);
  const top = LAB_VESSEL.height * s;
  const X = (c: Vessel) => fit.ox + c.x * s;

  const clear = () => {
    for (const c of cups) {
      c.glass.geometry.dispose();
      c.water.dispose();
    }
    if (pipe) {
      pipe.glass.geometry.dispose();
      pipe.water.geometry.dispose();
    }
    parts.clear();
    cups = [];
  };

  return base(g, {
    ruler: { from: V(fit.ox - 0.55, 0, 0), dir: V(0, 1, 0), metres: LAB_VESSEL.height, side: V(-1, 0, 0) },
    layout(e) {
      clear();
      const st = e.state(0) as VesselsState;
      const glassM = GLASS();
      const waterM = waterMat();
      cups = st.vessels.map((c, i) => {
        const pts: THREE.Vector2[] = [];
        for (let k = 0; k <= 24; k++) {
          const h = (top * k) / 24;
          pts.push(new THREE.Vector2(radiusAt(c, h / s) * s + 0.02, h));
        }
        const glass = mesh(new THREE.LatheGeometry(pts, 32), glassM, `container${i}`);
        glass.position.set(X(c), 0, 0);
        glass.renderOrder = 3;
        const water = new WaterLathe((h) => radiusAt(c, h / s) * s, waterM);
        water.mesh.position.set(X(c), 0, 0);
        parts.add(glass, water.mesh);
        return { glass, water, x: X(c), c };
      });
      const x0 = cups[0]!.x;
      const x1 = cups[cups.length - 1]!.x;
      const pg = mesh(new THREE.CylinderGeometry(pipeR + 0.025, pipeR + 0.025, x1 - x0, 16).rotateZ(Math.PI / 2), glassM, "pipe");
      const pw = mesh(new THREE.CylinderGeometry(pipeR, pipeR, x1 - x0, 16).rotateZ(Math.PI / 2), waterM);
      pg.position.set((x0 + x1) / 2, pipeY, 0);
      pw.position.copy(pg.position);
      parts.add(pg, pw);
      pipe = { glass: pg, water: pw, x0, x1 };
      into = Math.min(cups.length - 1, Math.max(0, (e.v.into ?? -1) < 0 ? cups.length - 1 : e.v.into!));
      tap.position.set(cups[into]!.x + 0.05, top * 1.3, 0);
      if (ov.level) ov.level.line.scale.x = 1;
    },
    pose(st0: LabState) {
      const st = st0 as VesselsState;
      st.levels.forEach((L, i) => cups[i]?.water.set(Math.max(0.001, L * s)));
      stream.visible = st.pouring;
      if (st.pouring && cups[into]) {
        const surf = st.levels[into]! * s;
        stream.position.set(tap.position.x, tap.position.y - 0.25, 0);
        stream.scale.y = Math.max(0.01, tap.position.y - 0.25 - surf);
      }
      // Markers in the pipe drift with the water that crossed each segment (left -> right positive).
      const mtx = new THREE.Matrix4();
      let n = 0;
      if (pipe)
        for (let k = 0; k < cups.length - 1; k++) {
          const a = cups[k]!.x;
          const b = cups[k + 1]!.x;
          const len = b - a;
          const step = len / 3;
          const off = ((((st.transfer[k] ?? 0) * 0.9) % step) + step) % step;
          for (let j = 0; j < 3 && n < 24; j++) {
            const x = a + ((off + j * step) % len);
            mtx.makeTranslation(x, pipeY, pipeR * 0.7);
            dots.setMatrixAt(n++, mtx);
          }
        }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
      if (ov.level) {
        ov.level.line.position.y = st.eq * s;
        ov.level.label?.object.position.set(fit.ox - 0.3, st.eq * s + 0.25, 0.3);
      }
      if (ov.pressure) {
        const pmax = Math.max(1, ...st.pressures);
        ov.pressure.arrows.forEach((a, i) => {
          const c = cups[i];
          a.group.visible = !!c;
          if (!c) return;
          a.set(V(c.x - 0.25, 0.02, 0.45), V(0, 1, 0), 0.15 + (1.2 * st.pressures[i]!) / pmax);
        });
        ov.pressure.labels.forEach((l, i) => {
          const c = cups[i];
          l.object.visible = !!c;
          if (!c) return;
          l.set(`${num(st.pressures[i]! / 1000, 2)} kPa`);
          l.object.position.set(c.x, -0.28, 0.6);
        });
      }
    },
    overlay(item, og, label) {
      if (item === "level") {
        const line = dashedLine(fit.ox - 0.4, fit.ox + (frame.x1 + 0.1) * s, 0.05);
        const l = label(0.26, LEVEL);
        l.set(engineText("lab.sameLevel"));
        og.add(line, l.object);
        ov.level = { line, label: l };
      } else if (item === "pressure") {
        const arrows = [0, 1, 2, 3].map(() => new Arrow("#c0392b", 0.05));
        const labels = [0, 1, 2, 3].map(() => label(0.24, "#c0392b"));
        for (const a of arrows) og.add(a.group);
        for (const l of labels) og.add(l.object);
        ov.pressure = { arrows, labels };
      }
    },
    body(_i, out) {
      const c = cups[into];
      if (!c) return false;
      const p = c.water.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      return out.set(c.x, p.getY(p.count - 1), 0), true;
    },
    part(name, index, out) {
      if (name === "container") {
        const c = cups[index];
        if (!c) return false;
        out.set(c.x, top + 0.1, 0);
      } else if (name === "pipe" && pipe) out.set((pipe.x0 + pipe.x1) / 2, pipeY, 0);
      else if (name === "pour") out.copy(tap.position);
      else if (name === "level") out.set(fit.ox - 0.3, (ov.level?.line.position.y ?? 0) + 0.05, 0);
      else return false;
      return true;
    },
    dispose() {
      clear();
      for (const a of ov.pressure?.arrows ?? []) a.dispose();
    },
  });
}

// ---------------------------------------------------------------- water tower and buildings

function towerRig(fit: Fit, frame: Frame, _ex: Experiment): Rig {
  const g = new THREE.Group();
  const dyn = new THREE.Group();
  g.add(dyn);
  const s = fit.s;
  const X = (x: number) => fit.ox + x * s;
  const groundY = 0.08;
  g.add(mesh(new THREE.BoxGeometry((frame.x1 - frame.x0) * s, groundY, 2.2).translate(X((frame.x0 + frame.x1) / 2), groundY / 2, 0), mat("#8b6a4a"), "ground"));
  const tankW = waterMat();
  const glass = GLASS();
  const R = TOWER.tankR * s;
  const tank = mesh(new THREE.CylinderGeometry(R, R, TOWER.tankH * s, 32, 1, true).translate(0, (TOWER.tankH * s) / 2, 0), glass, "tank");
  const tankBottom = mesh(new THREE.CylinderGeometry(R, R, 0.06, 32), mat("#9aa4ae"));
  const tankWater = key(mesh(new THREE.CylinderGeometry(R * 0.96, R * 0.96, 1, 32).translate(0, 0.5, 0), tankW, "tankWater"));
  tankWater.renderOrder = 2;
  const legs = [-0.7, 0.7].map((dx) => {
    const l = mesh(new THREE.BoxGeometry(0.12, 1, 0.5).translate(0, 0.5, 0), mat("#7d8590"));
    l.position.x = X(0) + dx * R;
    g.add(l);
    return l;
  });
  const riserR = Math.max(0.05, TOWER.riserR * s * 3);
  const pipeY = groundY + riserR;
  const risers = [TOWER.houseX - TOWER.houseW / 2 - 0.8, TOWER.buildingX - TOWER.buildingW / 2 - 0.8].map((x) => {
    const glassM = mesh(new THREE.CylinderGeometry(riserR + 0.02, riserR + 0.02, 1, 12).translate(0, 0.5, 0), glass);
    const water = key(mesh(new THREE.CylinderGeometry(riserR, riserR, 1, 12).translate(0, 0.5, 0), tankW));
    glassM.position.set(X(x), groundY, 0.6);
    water.position.set(X(x), groundY, 0.6);
    g.add(glassM, water);
    return { x: X(x), glass: glassM, water };
  });
  const mainPipe = mesh(new THREE.CylinderGeometry(riserR, riserR, 1, 12), tankW, "pipe");
  const downPipe = mesh(new THREE.CylinderGeometry(riserR, riserR, 1, 12), tankW);
  g.add(tank, tankBottom, tankWater, mainPipe, downPipe);
  // House (fixed) and building (height follows the slider).
  const hx = X(TOWER.houseX);
  const hw = TOWER.houseW * s;
  const hh = TOWER.houseH * s;
  g.add(mesh(new THREE.BoxGeometry(hw, hh, 1.4).translate(hx, groundY + hh / 2, 0), mat("#f2e3c6"), "house"));
  const roof = new THREE.Shape([new THREE.Vector2(-hw / 2 - 0.1, 0), new THREE.Vector2(hw / 2 + 0.1, 0), new THREE.Vector2(0, hh * 0.45)]);
  g.add(mesh(new THREE.ExtrudeGeometry(roof, { depth: 1.5, bevelEnabled: false }).translate(hx, groundY + hh, -0.75), mat("#e07a3a")));
  const building = mesh(new THREE.BoxGeometry(TOWER.buildingW * s, 1, 1.4).translate(0, 0.5, 0), mat("#e6e1d6"), "building");
  building.position.set(X(TOWER.buildingX), groundY, 0);
  g.add(building);
  let taps: { box: THREE.Mesh; stream: THREE.Mesh; y: number; b: 0 | 1 }[] = [];
  const ov: Overlays = { level: null, pressure: null };
  let tankBase = 0;
  let winGeo: THREE.BufferGeometry | null = null;
  let bTop = 0;
  const yOf = (m: number) => groundY + m * s;
  return base(g, {
    ruler: { from: V(X(frame.x0) - 0.1, groundY, -0.6), dir: V(0, 1, 0), metres: Math.floor(frame.y1 / 1.08), side: V(1, 0, 0) },
    layout(e) {
      for (const t of taps) {
        t.box.geometry.dispose();
        t.stream.geometry.dispose();
      }
      winGeo?.dispose();
      dyn.clear();
      const st = e.state(0) as VesselsState;
      const tk = st.vessels[0]!;
      tankBase = tk.y0;
      tank.position.set(X(0), yOf(tankBase), 0);
      tankBottom.position.set(X(0), yOf(tankBase), 0);
      tankWater.position.set(X(0), yOf(tankBase) + 0.03, 0);
      for (const l of legs) l.scale.y = Math.max(0.01, yOf(tankBase) - groundY);
      for (const l of legs) l.position.y = groundY;
      setRod(downPipe, V(X(0), yOf(tankBase), 0.6), V(X(0), pipeY, 0.6));
      setRod(mainPipe, V(X(0), pipeY, 0.6), V(risers[1]!.x, pipeY, 0.6));
      bTop = e.v.buildingHeight! + 2;
      building.scale.y = bTop * s;
      risers[0]!.glass.scale.y = st.vessels[1]!.top * s;
      risers[1]!.glass.scale.y = st.vessels[2]!.top * s;
      const tapM = mat("#7d8590", { metalness: 0.5 });
      taps = st.taps.map((tp) => {
        const x = tp.building === 0 ? hx - hw / 2 - 0.15 : X(TOWER.buildingX) - (TOWER.buildingW * s) / 2 - 0.15;
        const box = mesh(new THREE.BoxGeometry(0.3, 0.1, 0.12), tapM, "tap");
        box.position.set(x, yOf(tp.y), 0.75);
        const stream = key(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8).translate(0, -0.36, 0), waterMat()));
        stream.position.set(x - 0.1, yOf(tp.y), 0.75);
        dyn.add(box, stream);
        return { box, stream, y: tp.y, b: tp.building };
      });
      // Windows: one row per floor (a tap per floor), like the book's drawing.
      const winM = mat("#f6d55c");
      const win = new THREE.BoxGeometry(0.22, 0.26, 0.04);
      for (const tp of st.taps) {
        const cx = tp.building === 0 ? hx : X(TOWER.buildingX);
        const w = (tp.building === 0 ? TOWER.houseW : TOWER.buildingW) * s;
        for (const dx of [-0.22, 0.22]) {
          const m = new THREE.Mesh(win, winM);
          m.position.set(cx + dx * w, yOf(tp.y + 0.8), 0.72);
          dyn.add(m);
        }
      }
      winGeo = win;
    },
    pose(st0: LabState) {
      const st = st0 as VesselsState;
      tankWater.scale.y = Math.max(0.01, (st.levels[0]! - tankBase) * s - 0.03);
      risers.forEach((r, i) => (r.water.scale.y = Math.max(0.001, st.levels[i + 1]! * s)));
      st.taps.forEach((tp, i) => {
        const t = taps[i];
        if (!t) return;
        t.stream.visible = tp.wet;
        key(t.box, tp.wet);
      });
      if (ov.level) {
        ov.level.line.position.y = yOf(st.levels[0]!);
        ov.level.label?.object.position.set(X(TOWER.buildingX) + (TOWER.buildingW * s) / 2 + 0.3, yOf(st.levels[0]!) + 0.3, 0.3);
      }
      if (ov.pressure) {
        const shown = pressureTaps(st);
        ov.pressure.labels.forEach((l, k) => {
          const tp = shown[k];
          l.object.visible = !!tp;
          if (!tp) return;
          const t = taps[st.taps.indexOf(tp)]!;
          l.set(tp.wet ? `${num(tp.p / 1000, 0)} kPa` : "0 kPa");
          l.object.position.copy(t.box.position).add(V(-0.9, 0, 0.2));
        });
      }
    },
    overlay(item, og, label) {
      if (item === "level") {
        const line = dashedLine(X(0) - R, X(frame.x1) + 0.2, 0.9);
        const l = label(0.3, LEVEL);
        l.set(engineText("lab.tank"));
        og.add(line, l.object);
        ov.level = { line, label: l };
      } else if (item === "pressure") {
        const labels = [0, 1, 2].map(() => label(0.26, "#c0392b"));
        for (const l of labels) og.add(l.object);
        ov.pressure = { arrows: [], labels };
      }
    },
    body(_i, out) {
      return out.set(X(0), tankWater.position.y + tankWater.scale.y, 0), true;
    },
    part(name, index, out) {
      if (name === "tank") out.set(X(0), yOf(tankBase + TOWER.tankH) + 0.1, 0);
      else if (name === "tower") out.set(X(0) + R * 0.7, (groundY + yOf(tankBase)) / 2, 0.3);
      else if (name === "house") out.set(hx, groundY + hh * 1.45, 0);
      else if (name === "building") out.set(X(TOWER.buildingX), yOf(bTop) + 0.05, 0);
      else if (name === "pipe") out.set((X(0) + risers[1]!.x) / 2, pipeY, 0.6);
      else if (name === "level") out.set(X(frame.x1), (ov.level?.line.position.y ?? yOf(tankBase)) + 0.05, 0.9);
      else if (name === "tap") {
        const t = taps[index];
        if (!t) return false;
        out.copy(t.box.position);
      } else return false;
      return true;
    },
    dispose() {
      for (const t of taps) {
        t.box.geometry.dispose();
        t.stream.geometry.dispose();
      }
    },
  });
}

/** Taps whose pressure is labelled: the house ground floor, the lowest and the highest of the building. */
function pressureTaps(st: VesselsState): VesselsState["taps"] {
  const b = st.taps.filter((t) => t.building === 1);
  const out = [st.taps.find((t) => t.building === 0), b[b.length - 1], b[0]].filter((t): t is VesselsState["taps"][number] => !!t);
  return [...new Set(out)];
}

// ---------------------------------------------------------------- canal between two seas

function canalRig(fit: Fit, frame: Frame, _ex: Experiment): Rig {
  const g = new THREE.Group();
  const s = fit.s;
  const D = frame.maxDepth!;
  const y = (m: number) => (m - frame.y0) * s;
  const Z = 1.6;
  const seaL = [-7.0, -3.7];
  const seaR = [1.1, 3.6];
  const sand = mat("#d9c08a");
  const land = mat("#8b6a4a");
  const water = waterMat();
  const sea = waterMat("#1f5f9e");
  const box = (x0: number, x1: number, y0: number, y1: number, m: THREE.Material, name = "") => {
    const b = mesh(new THREE.BoxGeometry(x1 - x0, 1, Z).translate(0, 0.5, 0), m, name);
    b.position.set((x0 + x1) / 2, y0, 0);
    b.scale.y = Math.max(0.001, y1 - y0);
    g.add(b);
    return b;
  };
  for (const [a, b] of [seaL, seaR]) {
    box(a!, b!, 0, 0.08, sand);
    box(a!, b!, 0.08, y(0), sea, "sea").renderOrder = 2;
  }
  // The land the channel is dug into, from one sea to the other; the gates close its two ends.
  const floor = box(seaL[1]!, seaR[0]!, 0, 1, land, "channelFloor");
  const chWater = key(box(seaL[1]!, seaR[0]!, 1, 2, water, "channel"));
  chWater.renderOrder = 2;
  let gateH = 1;
  const housings = [seaL[1]! + 0.07, seaR[0]! - 0.07].map((x) => {
    const h = mesh(new THREE.BoxGeometry(0.34, 0.22, Z + 0.2), mat("#3b4552"));
    h.position.x = x;
    g.add(h);
    return h;
  });
  const gates = [seaL[1]! + 0.07, seaR[0]! - 0.07].map((x, i) => {
    const gm = mesh(new THREE.BoxGeometry(0.14, 1, Z + 0.1).translate(0, 0.5, 0), mat("#5b4a3a"), `gate${i}`);
    gm.position.x = x;
    g.add(gm);
    return gm;
  });
  // Boat: hull drawn to its draft below the waterline, cabin above.
  const boat = new THREE.Group();
  const hull = key(mesh(new THREE.BoxGeometry(1.3, 1, 0.55).translate(0, 0.5, 0), mat("#c0392b"), "boat"));
  const cabin = key(mesh(new THREE.BoxGeometry(0.55, 0.32, 0.4).translate(-0.15, 0, 0), mat("#f4f1e8")));
  boat.add(hull, cabin);
  boat.position.z = 0.2;
  g.add(boat);
  let draftU = 0.5;
  let floorY = 0;
  const ov: Overlays = { level: null, pressure: null };
  const xSea = -5.4;
  const xIn = (seaL[1]! + seaR[0]!) / 2;
  return base(g, {
    ruler: { from: V(seaL[1]! + 0.45, y(0), Z / 2 + 0.05), dir: V(0, -1, 0), metres: Math.floor(D), side: V(1, 0, 0) },
    layout(e) {
      floorY = y(-e.v.depth!);
      floor.scale.y = Math.max(0.001, floorY);
      chWater.position.y = floorY;
      draftU = e.v.draft! * s;
      hull.scale.y = draftU + 0.3;
      cabin.position.y = draftU + 0.3 + 0.16;
      gateH = y(0) + 0.35 - floorY;
      for (const gm of gates) gm.scale.y = gateH;
      for (const h of housings) h.position.y = floorY + gateH + 0.11;
    },
    pose(st0: LabState) {
      const st = st0 as VesselsState;
      const lvl = y(st.levels[1]!);
      chWater.scale.y = Math.max(0.001, lvl - floorY);
      chWater.visible = lvl - floorY > 0.005;
      // Lock gates roll up into their housing above the water.
      for (const gm of gates) {
        gm.scale.y = Math.max(0.05, gateH * (1 - st.gate));
        gm.position.y = floorY + gateH - gm.scale.y;
      }
      boat.position.x = xSea + (xIn - xSea) * st.boat;
      boat.position.y = (st.boat > 0 ? lvl : y(0)) - draftU;
      if (ov.level) {
        ov.level.line.position.y = y(0);
        ov.level.label?.object.position.set(seaR[1]! - 0.6, y(0) + 0.3, 1);
      }
      if (ov.pressure) {
        const [l] = ov.pressure.labels;
        l!.set(`p = ${num(st.pressures[1]! / 1000, 0)} kPa`);
        l!.object.position.set(xIn, floorY + 0.25, Z / 2 + 0.1);
        l!.object.visible = st.levels[1]! - st.vessels[1]!.y0 > 0.05;
      }
    },
    overlay(item, og, label) {
      if (item === "level") {
        const line = dashedLine(seaL[0]!, seaR[1]!, Z / 2 + 0.05);
        const l = label(0.3, LEVEL);
        l.set(engineText("lab.sea"));
        og.add(line, l.object);
        ov.level = { line, label: l };
      } else if (item === "pressure") {
        const l = label(0.28, "#c0392b");
        og.add(l.object);
        ov.pressure = { arrows: [], labels: [l] };
      }
    },
    body(_i, out) {
      return out.copy(boat.position).add(V(0, draftU + 0.3, 0)), true;
    },
    part(name, index, out) {
      if (name === "sea") out.set(index === 1 ? (seaR[0]! + seaR[1]!) / 2 : (seaL[0]! + seaL[1]!) / 2, y(0), 0);
      else if (name === "channel") out.set(xIn, (floorY + chWater.position.y + chWater.scale.y) / 2, 0);
      else if (name === "gate") out.set(gates[index === 1 ? 1 : 0]!.position.x, floorY + gateH + 0.1, 0);
      else if (name === "boat") out.copy(boat.position).add(V(0, draftU + 0.5, 0));
      else if (name === "level") out.set(seaR[1]!, y(0) + 0.05, Z / 2);
      else return false;
      return true;
    },
  });
}

export const vessels: Builder = (fit, frame, ex) => {
  const layout = ex.setup.kind === "vessels" ? ex.setup.layout : "lab";
  if (layout === "tower") return towerRig(fit, frame, ex);
  if (layout === "canal") return canalRig(fit, frame, ex);
  return labRig(fit, frame, ex);
};
