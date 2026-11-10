// Procedural apparatus per experiment kind. A rig owns its meshes inside `group`, rebuilds the
// shapes that depend on the variables in layout(), and poses everything from a physics state.
// Metric kinds map experiment metres to scene units with Fit: scene = (ox + x * s, y * s).
// Circuit and heat use a fixed layout in scene units (their sizes are not metric drawings).
import * as THREE from "three";
import { hash } from "../../util/math.ts";
import { key, mat, mesh, rod, setRod, type Label } from "./draw.ts";
import { vessels } from "./vessels-rig.ts";
import { trackPoint, type Experiment, type Frame, type LabState } from "./physics.ts";

export interface Fit {
  s: number;
  ox: number;
}

export interface RulerSpec {
  /** Scene start (the 0 mark), unit direction along the ruler, length in metres, tick side. */
  from: THREE.Vector3;
  dir: THREE.Vector3;
  metres: number;
  side: THREE.Vector3;
}

export interface Rig {
  group: THREE.Group;
  /** Shapes that depend on the variables (ramp angle, launch height...). Called when they change. */
  layout(ex: Experiment): void;
  /** Poses the apparatus for a state; `t` is chapter time (decorative motion: bubbles, glow pulse). */
  pose(st: LabState, t: number): void;
  body(i: number, out: THREE.Vector3): boolean;
  part(name: string, index: number, out: THREE.Vector3): boolean;
  ruler: RulerSpec | null;
  /** Builds a rig-specific overlay ("level", "pressure") into `g`; the engine shows/hides `g`, pose() moves its content. */
  overlay?(item: string, g: THREE.Group, label: LabelMaker): void;
  /** Owned extra disposables (geometries built in layout). */
  dispose(): void;
}

/** Text label factory handed to overlays (canvas text; an empty object in Node). */
export type LabelMaker = (height: number, ink?: string, pill?: boolean) => Label;

export const BODY_COLORS: Record<string, string> = {
  fall: "#d9483b",
  projectile: "#d9483b",
  pendulum: "#e0a020",
  spring: "#2f8a4c",
  ramp: "#c4692b",
  lever: "#5a6878",
  buoyancy: "#b0773a",
  vessels: "#3d8fd6",
};
const STEEL = "#9aa4ae";
const WOOD = "#b9925f";
const DARK = "#3b4552";
export const GLASS = () => new THREE.MeshStandardMaterial({ color: "#cfe6f2", transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sizeFor = (m: number, k: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, k * Math.cbrt(m)));

/** Scene point of an experiment point (metres). */
const P = (f: Fit, x: number, y: number, z = 0) => V(f.ox + x * f.s, y * f.s, z);

export type Builder = (fit: Fit, frame: Frame, ex: Experiment, color: string) => Rig;

export function base(group: THREE.Group, partial: Partial<Rig> & Pick<Rig, "pose" | "body" | "part">): Rig {
  return { group, layout: () => {}, ruler: null, dispose: () => {}, ...partial };
}

// ---------------------------------------------------------------- free fall

const fall: Builder = (fit, frame, ex, color) => {
  const g = new THREE.Group();
  const H = frame.y1 / 1.08;
  const two = ex.v.mass2 !== undefined;
  const poleX = P(fit, frame.x0 + 0.1, 0).x;
  const top = frame.y1 * fit.s + 0.4;
  g.add(rod(V(poleX, 0, -0.4), V(poleX, top, -0.4), 0.07, mat(STEEL), true));
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.12, 1.2).translate(poleX, 0.06, -0.4), mat(DARK)));
  const pad = mesh(new THREE.BoxGeometry(Math.max(1.6, Math.abs(frame.x0) * fit.s * 0.9), 0.06, 1.3), mat("#8a9aa6"), "floor");
  pad.position.set(P(fit, 0, 0).x, 0.03, 0);
  g.add(pad);
  const arm = rod(V(), V(1, 0, 0), 0.05, mat(STEEL), true);
  g.add(arm);
  const balls = (two ? [0, 1] : [0]).map((i) => {
    const b = key(mesh(new THREE.SphereGeometry(1, 28, 18), mat(i === 0 ? color : "#2f6fd6", { roughness: 0.35 }), `ball${i}`));
    g.add(b);
    return b;
  });
  const clamps = balls.map(() => {
    const c = mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), mat(DARK));
    g.add(c);
    return c;
  });
  let radii = balls.map(() => 0.3);
  let releaseY = 0;
  return base(g, {
    ruler: { from: V(poleX + 0.32, 0, -0.1), dir: V(0, 1, 0), metres: H, side: V(1, 0, 0) },
    layout(e) {
      radii = [e.v.mass!, ...(two ? [e.v.mass2!] : [])].map((m) => sizeFor(m, 0.24, 0.13, 0.48));
      balls.forEach((b, i) => b.scale.setScalar(radii[i]!));
      releaseY = e.v.height! * fit.s + 2 * Math.max(...radii) + 0.08;
      const cx = P(fit, 0, 0).x;
      const xs = two ? [cx - 0.7, cx + 0.7] : [cx];
      setRod(arm, V(poleX, releaseY + 0.08, -0.4), V(Math.max(...xs), releaseY + 0.08, -0.4));
      clamps.forEach((c, i) => c.position.set(xs[i]!, releaseY + 0.08, -0.2));
    },
    pose(st) {
      if (st.kind !== "fall") return;
      const cx = P(fit, 0, 0).x;
      st.bodies.forEach((b, i) => balls[i]!.position.set(two ? cx + (i === 0 ? -0.7 : 0.7) : cx, b.y * fit.s + radii[i]!, 0));
    },
    body(i, out) {
      const b = balls[i];
      return b ? (out.copy(b.position), true) : false;
    },
    part(name, _i, out) {
      if (name === "stand") out.set(poleX, top, -0.4);
      else if (name === "release") out.set(clamps[0]!.position.x, releaseY + 0.1, -0.2);
      else if (name === "floor") out.copy(pad.position);
      else if (name === "ruler") out.set(poleX + 0.32, (H * fit.s) / 2, -0.1);
      else return false;
      return true;
    },
  });
};

// ---------------------------------------------------------------- projectile

const projectile: Builder = (fit, frame, _ex, color) => {
  const g = new THREE.Group();
  const pedestal = mesh(new THREE.BoxGeometry(0.7, 1, 0.9).translate(0, 0.5, 0), mat(WOOD));
  const pivot = new THREE.Group();
  const barrel = mesh(new THREE.CylinderGeometry(0.13, 0.15, 1, 16).rotateZ(-Math.PI / 2).translate(0.5, 0, 0), mat(DARK, { metalness: 0.3 }));
  pivot.add(barrel);
  const ball = key(mesh(new THREE.SphereGeometry(0.17, 24, 16), mat(color, { roughness: 0.35 }), "ball"));
  const flag = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24), mat("#f2c14e"), "landing");
  const pathMat = new THREE.LineDashedMaterial({ color: color, dashSize: 0.18, gapSize: 0.12 });
  const path = key(new THREE.Line(new THREE.BufferGeometry(), pathMat));
  g.add(pedestal, pivot, ball, flag, path);
  const origin = P(fit, 0, 0);
  let st0: LabState | null = null;
  let apex = V();
  let landing = V();
  return base(g, {
    ruler: { from: V(origin.x, 0.02, 1.2), dir: V(1, 0, 0), metres: frame.x1 / 1.04, side: V(0, 1, 0) },
    layout(e) {
      const h = e.v.height! * fit.s;
      pedestal.position.set(origin.x - 0.2, 0, 0);
      pedestal.scale.y = Math.max(0.02, h);
      pivot.position.set(origin.x, h + 0.02, 0);
      pivot.rotation.z = (e.v.angle! * Math.PI) / 180;
      st0 = e.state(0);
      const T = st0.kind === "projectile" ? st0.T : 1;
      const pts = Array.from({ length: 65 }, (_, k) => {
        const s = e.state((T * k) / 64);
        return P(fit, s.bodies[0]!.x, s.bodies[0]!.y).setY(s.bodies[0]!.y * fit.s + 0.17);
      });
      path.geometry.dispose();
      path.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      path.computeLineDistances();
      if (st0.kind === "projectile") {
        apex = P(fit, st0.apex.x, st0.apex.y).setY(st0.apex.y * fit.s + 0.17);
        landing = P(fit, st0.range, 0).setY(0.02);
      }
      flag.position.copy(landing);
    },
    pose(st) {
      const b = st.bodies[0]!;
      ball.position.copy(P(fit, b.x, b.y)).setY(b.y * fit.s + 0.17);
      path.visible = st.running;
    },
    body(_i, out) {
      return out.copy(ball.position), true;
    },
    part(name, _i, out) {
      if (name === "launcher") out.copy(pivot.position).add(V(Math.cos(pivot.rotation.z), Math.sin(pivot.rotation.z), 0));
      else if (name === "apex") out.copy(apex);
      else if (name === "landing") out.copy(landing);
      else if (name === "ground") out.set(origin.x + (frame.x1 * fit.s) / 2, 0, 0);
      else return false;
      return true;
    },
    dispose() {
      path.geometry.dispose();
      pathMat.dispose();
    },
  });
};

// ---------------------------------------------------------------- pendulum

const pendulum: Builder = (fit, frame, _ex, color) => {
  const g = new THREE.Group();
  const pivot = P(fit, 0, frame.pivotY!, -0.2);
  const poleX = P(fit, frame.x0, 0).x;
  const steel = mat(STEEL);
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.12, 1.4).translate(poleX, 0.06, -0.2), mat(DARK)));
  g.add(rod(V(poleX, 0, -0.2), V(poleX, pivot.y + 0.1, -0.2), 0.08, steel, true));
  g.add(rod(V(poleX, pivot.y + 0.1, -0.2), V(pivot.x + 0.15, pivot.y + 0.1, -0.2), 0.06, steel, true));
  const knob = mesh(new THREE.SphereGeometry(0.09, 16, 10), mat(DARK));
  knob.position.copy(pivot);
  const string = rod(V(), V(0, -1, 0), 0.018, mat("#444444"), true);
  const bob = key(mesh(new THREE.SphereGeometry(1, 28, 18), mat(color, { roughness: 0.3, metalness: 0.2 }), "bob"));
  g.add(knob, string, bob);
  let r = 0.25;
  let L = 1;
  return base(g, {
    ruler: { from: V(poleX + 0.35, pivot.y, -0.2), dir: V(0, -1, 0), metres: (frame.pivotY! / 1.15) * 1.05, side: V(1, 0, 0) },
    layout(e) {
      r = sizeFor(e.v.mass!, 0.32, 0.18, 0.55);
      bob.scale.setScalar(r);
      L = e.v.length! * fit.s;
    },
    pose(st) {
      if (st.kind !== "pendulum") return;
      const dir = V(Math.sin(st.theta), -Math.cos(st.theta), 0);
      const end = pivot.clone().addScaledVector(dir, L);
      setRod(string, pivot, end);
      bob.position.copy(end).addScaledVector(dir, r * 0.9);
    },
    body(_i, out) {
      return out.copy(bob.position), true;
    },
    part(name, _i, out) {
      if (name === "pivot") out.copy(pivot);
      else if (name === "string") out.copy(string.position);
      else if (name === "rest") out.copy(pivot).add(V(0, -L - r, 0));
      else if (name === "stand") out.set(poleX, pivot.y * 0.6, -0.2);
      else return false;
      return true;
    },
  });
};

// ---------------------------------------------------------------- spring

const spring: Builder = (fit, frame, _ex, color) => {
  const g = new THREE.Group();
  const y = 0.42;
  const wallX = P(fit, 0, 0).x;
  const endX = P(fit, frame.x1, 0).x;
  g.add(mesh(new THREE.BoxGeometry(0.3, 1.4, 1.2).translate(wallX - 0.15, 0.7, 0), mat(WOOD), "wall"));
  g.add(mesh(new THREE.BoxGeometry(endX - wallX, 0.08, 0.9).translate((wallX + endX) / 2, 0.04, 0), mat("#c9ced4"), "track"));
  // Unit helix along +x (0..1); scaling x stretches it like a real spring.
  const turns = 14;
  const helix = new THREE.CatmullRomCurve3(
    Array.from({ length: turns * 16 + 1 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return V(i / (turns * 16), 0.16 * Math.sin(a), 0.16 * Math.cos(a));
    }),
  );
  const coil = key(mesh(new THREE.TubeGeometry(helix, turns * 24, 0.028, 8), mat("#7a7f87", { metalness: 0.5, roughness: 0.3 }), "spring"));
  coil.position.set(wallX, y, 0);
  const cart = new THREE.Group();
  const cw = 0.8;
  const body = key(mesh(new THREE.BoxGeometry(cw, 0.45, 0.62).translate(cw / 2, 0.36, 0), mat(color), "cart"));
  cart.add(body);
  for (const [dx, dz] of [[0.18, 0.33], [0.62, 0.33], [0.18, -0.33], [0.62, -0.33]] as const) {
    const w = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16).rotateX(Math.PI / 2).translate(dx, 0.1, dz), mat(DARK));
    cart.add(w);
  }
  const mark = mesh(new THREE.BoxGeometry(0.03, 1.1, 0.03), mat("#2c5fa6"), "equilibrium");
  mark.position.set(P(fit, frame.rest!, 0).x, 0.55, 0.47);
  g.add(coil, cart, mark);
  return base(g, {
    ruler: { from: V(wallX, 0.02, 0.75), dir: V(1, 0, 0), metres: frame.x1, side: V(0, 1, 0) },
    pose(st) {
      if (st.kind !== "spring") return;
      const x = P(fit, st.bodies[0]!.x, 0).x;
      cart.position.set(x, 0, 0);
      coil.scale.set(Math.max(0.05, x - wallX), 1, 1);
    },
    body(_i, out) {
      return out.copy(cart.position).add(V(cw / 2, 0.36, 0)), true;
    },
    part(name, _i, out) {
      if (name === "wall") out.set(wallX - 0.15, 1.2, 0);
      else if (name === "spring") out.set((wallX + cart.position.x) / 2, y, 0);
      else if (name === "equilibrium") out.copy(mark.position).setY(1.1);
      else if (name === "track") out.set((wallX + endX) / 2, 0.08, 0);
      else return false;
      return true;
    },
  });
};

// ---------------------------------------------------------------- inclined plane

const ramp: Builder = (fit, frame, _ex, color) => {
  const g = new THREE.Group();
  const wood = mat(WOOD);
  const depth = 1.3;
  let shapes: THREE.Mesh[] = [];
  const stop = mesh(new THREE.BoxGeometry(0.16, 0.5, depth), mat(DARK), "stop");
  const B = { w: 0.56, h: 0.36 };
  const block = key(mesh(new THREE.BoxGeometry(B.w, B.h, 0.5), mat(color, { emissive: new THREE.Color("#ff3b1f"), emissiveIntensity: 0 }), "block"));
  g.add(stop, block);
  let st0: LabState | null = null;
  let maxHeat = 1;
  let H = 0;
  const prism = (pts: [number, number][]) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
  };
  const tp = (s: number) => {
    const tr = st0?.kind === "ramp" ? st0.track : null;
    return tr ? trackPoint(tr, s) : { x: 0, y: 0, slope: 0 };
  };
  return base(g, {
    ruler: { from: V(fit.ox - 0.35, 0, 0.75), dir: V(0, 1, 0), metres: frame.y1 / 1.15, side: V(-1, 0, 0) },
    layout(e) {
      for (const m of shapes) {
        m.geometry.dispose();
        g.remove(m);
      }
      st0 = e.state(0);
      if (st0.kind !== "ramp") return;
      const tr = st0.track;
      H = tr.H * fit.s;
      shapes = tr.segs
        .filter((sg) => sg.slope !== 0)
        .map((sg) => {
          const a = P(fit, sg.x0, sg.y0);
          const b = P(fit, sg.x0 + sg.len * Math.cos(sg.slope), sg.y0 + sg.len * Math.sin(sg.slope));
          const low = a.y < b.y ? a : b;
          const high = a.y < b.y ? b : a;
          return mesh(prism([[low.x, 0], [high.x, high.y], [high.x, 0]]), wood, "ramp");
        });
      for (const m of shapes) g.add(m);
      const end = P(fit, tr.span, 0);
      stop.visible = !tr.valley;
      stop.position.set(end.x + 0.08, 0.25, 0);
      // Friction power peaks around the bottom of the first ramp.
      maxHeat = 1e-9;
      for (let k = 1; k <= 40; k++) {
        const s = e.state(k * 0.1);
        if (s.kind === "ramp") maxHeat = Math.max(maxHeat, s.heatRate);
      }
    },
    pose(st, t) {
      if (st.kind !== "ramp") return;
      const p = trackPoint(st.track, st.s + Math.sign(st.bodies[0]!.vx || 0) * 1e-9);
      const n = V(-Math.sin(p.slope), Math.cos(p.slope), 0);
      block.position.copy(P(fit, p.x, p.y)).addScaledVector(n, B.h / 2 + 0.01);
      block.rotation.z = p.slope;
      const heat = Math.min(1, st.heatRate / maxHeat);
      const m = block.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = heat * (0.55 + 0.1 * Math.sin(t * 12));
    },
    body(_i, out) {
      return out.copy(block.position), true;
    },
    part(name, _i, out) {
      const tr = st0?.kind === "ramp" ? st0.track : null;
      if (!tr) return false;
      const L = tr.segs[0]!.len;
      const at = (s: number) => {
        const q = tp(s);
        return P(fit, q.x, q.y);
      };
      if (name === "top") out.copy(at(0)).setY(H + 0.1);
      else if (name === "slope") out.copy(at(L / 2));
      else if (name === "bottom") out.copy(at(L));
      else if (name === "flat") out.copy(at(L + tr.segs[1]!.len / 2));
      else if (name === "end") out.copy(at(tr.total));
      else return false;
      return true;
    },
    dispose() {
      for (const m of shapes) m.geometry.dispose();
    },
  });
};

// ---------------------------------------------------------------- lever

const lever: Builder = (fit, frame, _ex, color) => {
  const g = new THREE.Group();
  const hF = frame.hF! * fit.s;
  const B = frame.B! * fit.s;
  const c = P(fit, 0, 0);
  const tri = new THREE.Shape([new THREE.Vector2(-0.55, 0), new THREE.Vector2(0.55, 0), new THREE.Vector2(0, hF)]);
  g.add(mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.8, bevelEnabled: false }).translate(c.x, 0, -0.4), mat(DARK), "fulcrum"));
  const beam = new THREE.Group();
  beam.position.set(c.x, hF + 0.07, 0);
  beam.add(mesh(new THREE.BoxGeometry(2 * B, 0.14, 0.5), mat(WOOD), "beam"));
  const step = frame.B! > 1.5 ? 0.5 : frame.B! > 0.6 ? 0.1 : 0.05;
  for (let d = step; d <= frame.B! + 1e-9; d += step)
    for (const sgn of [-1, 1]) beam.add(mesh(new THREE.BoxGeometry(0.025, 0.16, 0.52).translate(sgn * d * fit.s, 0, 0), mat("#2a2a2a")));
  g.add(beam);
  const hooks = [0, 1].map(() => {
    const r = rod(V(), V(0, -1, 0), 0.015, mat("#444444"), true);
    g.add(r);
    return r;
  });
  const weights = [0, 1].map((i) => {
    const w = key(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1, 20).translate(0, -0.5, 0), mat(i === 0 ? color : "#c4692b", { metalness: 0.4, roughness: 0.4 }), `weight${i}`));
    g.add(w);
    return w;
  });
  const drop = 0.45;
  let heights = [0.4, 0.4];
  return base(g, {
    layout(e) {
      const mMax = Math.max(1e-9, e.v.massLeft!, e.v.massRight!);
      heights = [e.v.massLeft!, e.v.massRight!].map((m) => 0.2 + 0.7 * Math.cbrt(m / mMax));
      [e.v.massLeft!, e.v.massRight!].forEach((m, i) => {
        weights[i]!.visible = hooks[i]!.visible = m > 0;
        weights[i]!.scale.set(1, heights[i]!, 1);
      });
    },
    pose(st) {
      if (st.kind !== "lever") return;
      beam.rotation.z = -st.phi;
      st.bodies.forEach((b, i) => {
        const top = P(fit, b.x, b.y).setY(b.y * fit.s + 0.07);
        const end = top.clone().add(V(0, -drop, 0));
        setRod(hooks[i]!, top, end);
        weights[i]!.position.copy(end);
      });
    },
    body(i, out) {
      const w = weights[i];
      return w ? (out.copy(w.position).add(V(0, -heights[i]! / 2, 0)), true) : false;
    },
    part(name, _i, out) {
      if (name === "fulcrum") out.set(c.x, hF, 0);
      else if (name === "beam") out.copy(beam.position);
      else if (name === "left" || name === "right") out.copy(hooks[name === "left" ? 0 : 1]!.position).add(V(0, drop / 2, 0));
      else return false;
      return true;
    },
  });
};

// ---------------------------------------------------------------- buoyancy

const buoyancy: Builder = (fit, frame, _ex, color) => {
  const g = new THREE.Group();
  const R = frame.R! * fit.s;
  const Hb = frame.height! * fit.s;
  const c = P(fit, 0, 0);
  const glass = mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, Hb, 40, 1, true).translate(c.x, Hb / 2, 0), GLASS(), "beaker");
  const floor = mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.05, 40).translate(c.x, 0.025, 0), GLASS());
  const water = mesh(new THREE.CylinderGeometry(R, R, 1, 40).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: "#5aa9e6", transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.2 }), "water");
  water.position.set(c.x, 0.05, 0);
  water.renderOrder = 2;
  const cube = key(mesh(new THREE.BoxGeometry(1, 1, 1), mat(color), "cube"));
  g.add(cube, water, glass, floor);
  let a = 1;
  return base(g, {
    layout(e) {
      a = Math.cbrt(e.v.volume! / 1000) * fit.s;
      cube.scale.setScalar(a);
      const m = cube.material as THREE.MeshStandardMaterial;
      m.color.set(e.v.density! < 1000 ? color : e.v.density! < 5000 ? "#8c8f94" : "#c9a43b");
    },
    pose(st) {
      if (st.kind !== "buoyancy") return;
      cube.position.set(c.x, st.bottom * fit.s + a / 2 + 0.05, 0);
      water.scale.y = Math.max(0.01, st.level * fit.s);
    },
    body(_i, out) {
      return out.copy(cube.position), true;
    },
    part(name, _i, out) {
      if (name === "beaker") out.set(c.x + R, Hb, 0);
      else if (name === "water") out.set(c.x - R * 0.6, water.scale.y * 0.5, 0);
      else if (name === "surface") out.set(c.x, water.scale.y + 0.05, 0);
      else if (name === "bottom") out.set(c.x, 0.05, 0);
      else return false;
      return true;
    },
  });
};

// ---------------------------------------------------------------- circuit (fixed layout, scene units)

const circuit: Builder = (_fit, _frame, ex) => {
  const g = new THREE.Group();
  if (ex.setup.kind !== "circuit") return base(g, { pose: () => {}, body: () => false, part: () => false });
  const setup = ex.setup;
  const n = setup.r3 !== undefined ? 3 : setup.r2 !== undefined ? 2 : 1;
  const series = setup.layout === "series";
  const X0 = -6.2;
  const X1 = 1.8;
  const Y0 = 1.0;
  const Y1 = 4.6;
  const z = 0;
  g.add(mesh(new THREE.BoxGeometry(X1 - X0 + 1.6, Y1 - Y0 + 1.6, 0.12).translate((X0 + X1) / 2, (Y0 + Y1) / 2, -0.35), mat("#e8dcc4"), "panel"));
  g.add(mesh(new THREE.BoxGeometry(X1 - X0 + 2, 0.3, 1.2).translate((X0 + X1) / 2, 0.15, -0.2), mat(WOOD)));
  const wire = mat("#b5562c", { metalness: 0.4, roughness: 0.4 });
  const W = (pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) g.add(rod(V(pts[i - 1]![0], pts[i - 1]![1], z), V(pts[i]![0], pts[i]![1], z), 0.045, wire, true));
  };
  // Battery on the left edge, + at the top.
  const bat = new THREE.Group();
  bat.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.5, 24), mat("#2b2f36")));
  bat.add(mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.5, 24).translate(0, 0.5, 0), mat("#d9a521")));
  bat.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12).translate(0, 0.82, 0), mat(STEEL)));
  const batY = (Y0 + Y1) / 2;
  bat.position.set(X0, batY, z);
  g.add(bat);
  const swX = X0 + 1.6;
  const amX = X0 + 3.0;
  const rungs = series ? [] : [X1 - 2 * 1.9, X1 - 1.9, X1].slice(3 - n);
  const bulbXY: [number, number][] = series
    ? Array.from({ length: n }, (_, i) => [X0 + 2.4 + ((X1 - 1.2 - (X0 + 2.4)) * (n === 1 ? 0.5 : i / (n - 1))), Y1])
    : rungs.map((x) => [x, (Y0 + Y1) / 2]);
  W([[X0, batY + 0.9], [X0, Y1], [X1, Y1], [X1, Y0], [X0, Y0], [X0, batY - 0.75]]);
  if (!series) for (const x of rungs.slice(0, -1)) W([[x, Y1], [x, Y0]]);
  // Switch: a lever on the bottom wire, open (raised) before the run.
  const swBase = mesh(new THREE.BoxGeometry(0.7, 0.14, 0.4), mat("#444b55"));
  swBase.position.set(swX, Y0, z + 0.05);
  const swLever = new THREE.Group();
  swLever.position.set(swX - 0.3, Y0 + 0.1, z + 0.12);
  swLever.add(mesh(new THREE.BoxGeometry(0.62, 0.05, 0.08).translate(0.31, 0, 0), mat(STEEL, { metalness: 0.6 })));
  g.add(swBase, swLever);
  // Ammeter: a box on the bottom wire (its reading goes on the board and its pin).
  const am = mesh(new THREE.BoxGeometry(0.9, 0.7, 0.35), mat("#f4f1e8"), "ammeter");
  am.position.set(amX, Y0, z + 0.05);
  const needle = new THREE.Group();
  needle.position.set(amX, Y0 - 0.2, z + 0.24);
  needle.add(key(mesh(new THREE.BoxGeometry(0.03, 0.42, 0.02).translate(0, 0.21, 0), mat("#c0392b"))));
  g.add(am, needle);
  const bulbs = bulbXY.map(([x, y]) => {
    const b = new THREE.Group();
    b.position.set(x, y, z);
    b.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 16).translate(0, -0.35, 0), mat(STEEL, { metalness: 0.6 })));
    const glassM = new THREE.MeshStandardMaterial({ color: "#fff6d8", transparent: true, opacity: 0.55, emissive: new THREE.Color("#ffcc33"), emissiveIntensity: 0, roughness: 0.1 });
    const bulb = mesh(new THREE.SphereGeometry(0.42, 24, 16).translate(0, 0.15, 0), glassM, "bulb");
    const haloM = new THREE.MeshBasicMaterial({ color: "#ffd75a", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const halo = mesh(new THREE.SphereGeometry(0.42, 20, 12).translate(0, 0.15, 0), haloM);
    b.add(bulb, halo);
    g.add(b);
    return { group: b, glassM, halo, haloM };
  });
  // Charge paths (conventional current, from + round to -): one loop per bulb's branch.
  const loops: THREE.Vector3[][] = series
    ? [[[X0, batY + 0.9], [X0, Y1], [X1, Y1], [X1, Y0], [X0, Y0], [X0, batY - 0.75]].map(([x, y]) => V(x, y, z + 0.06))]
    : rungs.map((x) => [[X0, batY + 0.9], [X0, Y1], [x, Y1], [x, Y0], [X0, Y0], [X0, batY - 0.75]].map(([px, py]) => V(px, py, z + 0.06)));
  const lengths = loops.map((l) => l.slice(1).reduce((a, p, i) => a + p.distanceTo(l[i]!), 0));
  const SPACING = 0.55;
  const dotGeo = new THREE.SphereGeometry(0.07, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: "#ffe066" });
  const dots = loops.map((_, i) => {
    const count = Math.floor(lengths[i]! / SPACING);
    const m = key(new THREE.InstancedMesh(dotGeo, dotMat, count));
    m.frustumCulled = false;
    g.add(m);
    return m;
  });
  const at = (loop: THREE.Vector3[], d: number, out: THREE.Vector3) => {
    for (let i = 1; i < loop.length; i++) {
      const L = loop[i]!.distanceTo(loop[i - 1]!);
      if (d <= L) return out.lerpVectors(loop[i - 1]!, loop[i]!, d / L);
      d -= L;
    }
    return out.copy(loop[loop.length - 1]!);
  };
  const mtx = new THREE.Matrix4();
  const tmp = V();
  return base(g, {
    pose(st) {
      if (st.kind !== "circuit") return;
      swLever.rotation.z = st.closed ? 0 : 0.6;
      needle.rotation.z = 0.6 - Math.min(1.2, st.load * 0.6);
      bulbs.forEach((b, i) => {
        const k = st.brightness[i] ?? 0;
        b.glassM.emissiveIntensity = 1.6 * k;
        b.haloM.opacity = Math.min(0.6, 0.45 * k);
        b.halo.scale.setScalar(1 + 0.7 * k);
        key(b.group, k > 0.02);
      });
      dots.forEach((m, i) => {
        m.visible = st.closed && (st.currents[i] ?? 0) > 0;
        const off = ((st.flows[i] ?? 0) * 1.4) % SPACING;
        for (let k = 0; k < m.count; k++) {
          at(loops[i]!, k * SPACING + off, tmp);
          mtx.makeTranslation(tmp.x, tmp.y, tmp.z);
          m.setMatrixAt(k, mtx);
        }
        m.instanceMatrix.needsUpdate = true;
      });
    },
    body: () => false,
    part(name, index, out) {
      if (name === "battery") out.copy(bat.position).add(V(0, 0.9, 0));
      else if (name === "switch") out.copy(swBase.position).add(V(0, 0.2, 0));
      else if (name === "ammeter") out.copy(am.position).add(V(0, 0.4, 0));
      else if (name === "wire") out.set(X1, Y1, z);
      else if (name === "bulb") {
        const b = bulbs[index];
        if (!b) return false;
        out.copy(b.group.position).add(V(0, 0.6, 0));
      } else return false;
      return true;
    },
    dispose() {
      dotGeo.dispose();
      dotMat.dispose();
    },
  });
};

// ---------------------------------------------------------------- heat and states of matter (fixed layout)

const heat: Builder = () => {
  const g = new THREE.Group();
  const cx = -3.4;
  const plateM = mat("#3a3f47", { emissive: new THREE.Color("#ff4a1c"), emissiveIntensity: 0 });
  const plate = mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.3, 32).translate(cx, 0.15, 0), plateM, "heater");
  const Hb = 2.6;
  const R = 1.0;
  const y0 = 0.32;
  const glass = mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, Hb, 40, 1, true).translate(cx, y0 + Hb / 2, 0), GLASS(), "beaker");
  const floor = mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.04, 40).translate(cx, y0, 0), GLASS());
  const water = mesh(new THREE.CylinderGeometry(R, R, 1, 40).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: "#5aa9e6", transparent: true, opacity: 0.5, depthWrite: false }), "water");
  water.position.set(cx, y0 + 0.02, 0);
  water.renderOrder = 2;
  const iceM = new THREE.MeshStandardMaterial({ color: "#e4f4ff", transparent: true, opacity: 0.85, roughness: 0.15 });
  const ice = [0, 1, 2, 3, 4].map((i) => {
    const m = mesh(new THREE.BoxGeometry(1, 1, 1), iceM, "ice");
    m.rotation.y = hash(i, 3) * 1.5;
    g.add(m);
    return m;
  });
  const bubbleM = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.7 });
  const bubbles = Array.from({ length: 16 }, () => {
    const b = mesh(new THREE.SphereGeometry(0.06, 10, 8), bubbleM);
    g.add(b);
    return b;
  });
  const steamM = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false });
  const steam = Array.from({ length: 12 }, () => {
    const b = mesh(new THREE.SphereGeometry(0.22, 12, 8), steamM);
    g.add(b);
    return b;
  });
  // Thermometer: glass tube dipping in the beaker, red column from -30 °C (bottom) to 110 °C (top).
  const tx = cx + 0.55;
  const tBottom = y0 + 0.25;
  const tLen = 3.2;
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, tLen, 12).translate(tx, tBottom + tLen / 2, 0.3), GLASS(), "thermometer"));
  const redM = mat("#d32f2f", { emissive: new THREE.Color("#d32f2f"), emissiveIntensity: 0.3 });
  g.add(key(mesh(new THREE.SphereGeometry(0.13, 14, 10).translate(tx, tBottom, 0.3), redM)));
  const column = key(mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 10).translate(0, 0.5, 0), redM));
  column.position.set(tx, tBottom, 0.3);
  // Particle view: a round "lens" with 25 molecules.
  const lens = V(0.4, 3.6, 0);
  const LR = 1.25;
  g.add(mesh(new THREE.CircleGeometry(LR, 48).translate(lens.x, lens.y, lens.z - 0.05), mat("#fbfaf6"), "molecules"));
  g.add(mesh(new THREE.TorusGeometry(LR, 0.06, 8, 48).translate(lens.x, lens.y, lens.z), mat(DARK)));
  g.add(rod(V(cx + 0.6, 2.2, 0), V(lens.x - LR * 0.8, lens.y - LR * 0.6, 0), 0.02, mat(DARK), true));
  const molGeo = new THREE.SphereGeometry(0.11, 12, 8);
  const molMat = mat("#2f6fd6");
  const N = 25;
  const mols = key(new THREE.InstancedMesh(molGeo, molMat, N));
  mols.frustumCulled = false;
  g.add(plate, water, glass, floor, column, mols);
  const mtx = new THREE.Matrix4();
  const tri = (x: number) => 1 - Math.abs(((x % 2) + 2) % 2 - 1) * 2; // triangle wave in -1..1
  return base(g, {
    pose(st, t) {
      if (st.kind !== "heat") return;
      plateM.emissiveIntensity = st.running && !st.done ? 0.9 : 0;
      key(plate, st.running && !st.done);
      const liquid = (1 - st.ice) * (1 - st.steam);
      const depth = 1.7 * (1 - st.steam);
      water.visible = liquid > 0.005;
      water.scale.y = Math.max(0.01, depth * (1 - st.ice) + 0.0001);
      ice.forEach((m, i) => {
        const s = 0.62 * Math.cbrt(st.ice);
        m.visible = st.ice > 0.005;
        m.scale.setScalar(Math.max(0.01, s));
        m.position.set(cx + (i - 2) * 0.36, y0 + 0.04 + s / 2 + (i % 2) * s * 0.9, (hash(i, 7) - 0.5) * 0.6);
      });
      const boiling = st.phase === "ebollizione";
      bubbles.forEach((b, i) => {
        b.visible = boiling && water.visible;
        const h = Math.max(0.05, water.scale.y);
        b.position.set(cx + (hash(i, 1) - 0.5) * 1.6, y0 + ((t * (0.5 + hash(i, 2)) + hash(i, 4)) % 1) * h, (hash(i, 5) - 0.5) * 1.2);
      });
      steam.forEach((b, i) => {
        b.visible = boiling;
        const p = (t * 0.35 + hash(i, 9)) % 1;
        b.position.set(cx + (hash(i, 8) - 0.5) * 1.4 + 0.3 * Math.sin(t + i), y0 + Hb * 0.7 + p * 2.2, (hash(i, 6) - 0.5) * 0.8);
        b.scale.setScalar(0.6 + p);
      });
      column.scale.y = Math.max(0.01, ((st.T + 30) / 140) * tLen);
      // Molecules: i < ice*N are in the solid, i >= (1-steam)*N have left as gas; the rest are liquid.
      const agitation = 0.4 + (st.T + 30) / 130;
      for (let i = 0; i < N; i++) {
        const gx = (i % 5) - 2;
        const gy = Math.floor(i / 5) - 2;
        let x: number;
        let y: number;
        const f = i / N;
        if (f < st.ice) {
          x = gx * 0.36 + 0.03 * agitation * Math.sin(t * 23 + i * 1.7);
          y = gy * 0.36 + 0.03 * agitation * Math.cos(t * 19 + i * 2.3);
        } else if (f >= 1 - st.steam) {
          x = tri(t * 0.6 * agitation + hash(i, 11) * 2) * LR * 0.75;
          y = tri(t * 0.47 * agitation + hash(i, 12) * 2) * LR * 0.75;
        } else {
          x = gx * 0.4 + 0.22 * Math.sin(t * 1.3 * agitation + i * 2.1) + 0.1 * Math.sin(t * 2.9 + i);
          y = -0.35 + gy * 0.22 + 0.15 * Math.cos(t * 1.1 * agitation + i * 1.3);
        }
        const r = Math.hypot(x, y);
        const lim = LR - 0.16;
        if (r > lim) [x, y] = [(x / r) * lim, (y / r) * lim];
        mtx.makeTranslation(lens.x + x, lens.y + y, lens.z + 0.05);
        mols.setMatrixAt(i, mtx);
      }
      mols.instanceMatrix.needsUpdate = true;
    },
    body: () => false,
    part(name, _i, out) {
      if (name === "beaker") out.set(cx + R, y0 + Hb, 0);
      else if (name === "heater") out.set(cx - 1.2, 0.3, 0);
      else if (name === "thermometer") out.set(tx, tBottom + column.scale.y, 0.3);
      else if (name === "molecules") out.copy(lens).add(V(0, LR, 0));
      else if (name === "graph") out.set(5.8, 2.4, 0);
      else return false;
      return true;
    },
    dispose() {
      molGeo.dispose();
      molMat.dispose();
    },
  });
};

export const RIGS: Record<string, Builder> = { fall, projectile, pendulum, spring, ramp, lever, buoyancy, circuit, heat, vessels };
