// The landscape block-diagram: a slab of ground cut open on its front face (z = +HZ), with a plate
// boundary or plain strata, moving plates, a volcano, a fault with wave fronts, the water cycle and
// free flows/arrows. One BlockObj per chapter that has a block (they share nothing but materials).
import * as THREE from "three";
import type { EarthBlockView } from "@pv/scene-spec";
import { earthKeyValue } from "@pv/scene-spec";
import { engineText } from "@pv/scene-spec/i18n";
import type { EngineContext } from "../../types.ts";
import { clamp, lerp } from "../../util/math.ts";
import { Band, FLOW_STYLES, Stream } from "./stream.ts";
import { basic, fmt, fmtDec, Label, latest, nice, Polyline, presence, setOpacity, std, windows } from "./util.ts";

/** Half width (x), depth below sea level (y) and sky height of the block, half depth (z). */
export const HW = 8;
export const DEP = 5;
export const SKY = 4;
export const HZ = 2;
const N = 129;
const XS = Array.from({ length: N }, (_, i) => -HW + (2 * HW * i) / (N - 1));
const FRONT = HZ + 0.035;
const GLOW = new THREE.Color("#ffb347");
const ARROW = "#e8552d";
const P_COLOR = "#2f6fd6";
const S_COLOR = "#8a3fd1";

const C = {
  continental: "#b9875a",
  oceanic: "#59656e",
  lith: "#8f9a62",
  asth: "#d9773e",
  water: "#3d8fd1",
  slab: "#4b555d",
};

/** [u, v] on the front face -> scene coordinates (z = front). */
export const uvToXYZ = (u: number, v: number, out: THREE.Vector3, z = FRONT) => out.set(u * HW, v < 0 ? v * DEP : v * SKY, z);

const smoothstep = (a: number, b: number, x: number) => {
  const p = clamp((x - a) / (b - a));
  return p * p * (3 - 2 * p);
};
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/** Default volcano / feature positions per boundary (scene x). */
const TRENCH = -1.2;
const ARC = 2.6;

/** Plate displacement in km (speed cm/yr × Ma × 10). Pure. */
export const displacementKm = (speedCmYr: number, ma: number) => speedCmYr * ma * 10;

/** Ground / sea-floor height at x (scene units, 0 = sea level); g = collision growth 0..1. Pure. */
export function surfaceAt(b: EarthBlockView, x: number, g = 1): number {
  switch (b.boundary) {
    case "divergent":
      return -0.75 + 0.45 * bump(x, 0, 2.6) - 0.12 * bump(x, 0, 0.35);
    case "subduction": {
      const oc = -0.7 - 0.45 * bump(x, TRENCH, 0.6);
      const land = 0.3 + 0.9 * bump(x, ARC, 1.3) + 0.05 * Math.sin(2 * x);
      return lerp(oc, land, smoothstep(TRENCH + 0.3, TRENCH + 1.6, x));
    }
    case "collision":
      return 0.25 + (0.25 + 1.5 * g) * bump(x, 0, 2) + 0.05 * Math.sin(1.7 * x);
    case "transform":
      return 0.3 + 0.12 * Math.sin(0.8 * x);
    case "none": {
      const relief = b.relief ?? "hills";
      const land =
        relief === "flat" ? 0.25 : relief === "hills" ? 0.3 + 0.18 * Math.sin(x * 0.7) + 0.08 * Math.sin(1.9 * x + 1) : 0.3 + 1.3 * bump(x, 3.5, 2) + 0.1 * Math.sin(1.3 * x);
      if (b.sea === undefined) return land;
      const xs = b.sea * HW;
      return lerp(-0.6, land, smoothstep(xs - 0.7, xs + 0.7, x));
    }
  }
}

/** Top of the subducting slab (x >= trench). */
const slabTop = (b: EarthBlockView, x: number) => {
  const y0 = surfaceAt(b, TRENCH);
  const d = Math.max(0, x - TRENCH);
  return y0 - 0.32 * d - 0.075 * d * d;
};

interface BandDef {
  id: string;
  color: string;
  top: (x: number) => number;
  bottom: (x: number) => number;
  opacity?: number;
  /** Re-evaluate every frame (collision mountains grow). */
  live?: boolean;
}

function bandDefs(b: EarthBlockView, g: { value: number }): BandDef[] {
  const s = (x: number) => surfaceAt(b, x, g.value);
  const water: BandDef = { id: "ocean", color: C.water, top: () => 0, bottom: (x) => Math.min(0, s(x)), opacity: 0.5 };
  const floor = -DEP;
  switch (b.boundary) {
    case "none": {
      const out: BandDef[] = [];
      if (b.strata) {
        const total = b.strata.reduce((a, x) => a + x.thickness, 0);
        let cum = 0;
        for (const st of b.strata) {
          const a = cum / total;
          cum += st.thickness;
          const c = cum / total;
          out.push({ id: st.id, color: st.color, top: (x) => lerp(s(x), floor, a), bottom: (x) => lerp(s(x), floor, c) });
        }
      } else {
        out.push(
          { id: "asthenosphere", color: C.asth, top: () => -2.4, bottom: () => floor },
          { id: "mantle", color: C.lith, top: () => -1.3, bottom: () => -2.4 },
          { id: "crust", color: C.continental, top: s, bottom: () => -1.3 },
        );
      }
      if (b.sea !== undefined) out.push(water);
      return out;
    }
    case "divergent": {
      const crustBot = (x: number) => s(x) - 0.3;
      const lithBot = (x: number) => crustBot(x) - (0.1 + 0.16 * Math.abs(x));
      return [
        { id: "asthenosphere", color: C.asth, top: (x) => lithBot(x) + 0.02, bottom: () => floor },
        { id: "mantle", color: C.lith, top: crustBot, bottom: lithBot },
        { id: "crust", color: C.oceanic, top: s, bottom: crustBot },
        water,
      ];
    }
    case "subduction": {
      const ocTop = (x: number) => (x < TRENCH ? s(x) : slabTop(b, x));
      const ccBot = (x: number) => Math.max(-1.4 - 0.5 * bump(x, ARC, 1.3), slabTop(b, x));
      const clBot = (x: number) => Math.max(-2.6, slabTop(b, x));
      const ocCrust = (x: number) => Math.max(floor, ocTop(x) - 0.28);
      return [
        { id: "asthenosphere", color: C.asth, top: (x) => (x < TRENCH ? ocTop(x) - 0.96 : -2.58), bottom: () => floor },
        { id: "mantle", color: C.lith, top: (x) => (x < TRENCH ? -10 : ccBot(x)), bottom: (x) => (x < TRENCH ? -10 : clBot(x)) },
        { id: "crust", color: C.continental, top: (x) => (x < TRENCH ? -10 : s(x)), bottom: (x) => (x < TRENCH ? -10 : ccBot(x)) },
        { id: "slab", color: C.slab, top: (x) => Math.max(floor, ocTop(x) - 0.28), bottom: (x) => Math.max(floor, ocTop(x) - 0.98) },
        { id: "slab-crust", color: C.oceanic, top: (x) => Math.max(floor, ocTop(x)), bottom: ocCrust },
        water,
      ];
    }
    case "collision": {
      const crustBot = (x: number) => -1.3 - 1.4 * g.value * bump(x, 0, 2.2);
      const lithBot = (x: number) => -2.5 - 0.5 * g.value * bump(x, 0, 2.2);
      return [
        { id: "asthenosphere", color: C.asth, top: (x) => lithBot(x) + 0.02, bottom: () => floor, live: true },
        { id: "mantle", color: C.lith, top: crustBot, bottom: lithBot, live: true },
        { id: "crust", color: C.continental, top: s, bottom: crustBot, live: true },
      ];
    }
    case "transform":
      return [
        { id: "asthenosphere", color: C.asth, top: () => -2.4, bottom: () => floor },
        { id: "mantle", color: C.lith, top: () => -1.3, bottom: () => -2.4 },
        { id: "crust", color: C.continental, top: s, bottom: () => -1.3 },
      ];
  }
}

function arrowMesh(mat: THREE.Material, len: number, r = 0.09): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(0.01, len - r * 4), 10).translate(0, (len - r * 4) / 2, 0), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(r * 2.6, r * 4, 14).translate(0, len - r * 2, 0), mat);
  g.add(shaft, head);
  g.userData.key = true;
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
function pointArrow(g: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  g.position.copy(from);
  g.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
}

interface Shown {
  object: THREE.Object3D;
  at?: number;
  until?: number;
  mats: THREE.Material[];
}

export interface BlockObj {
  group: THREE.Group;
  update(t: number, overrides: { speed?: number; time?: number; magnitude?: number }): void;
  anchor(part: string, index: number | undefined, t: number, out: THREE.Vector3): boolean;
  /** Keyed values the scene uses at t (for slider readouts). */
  values(t: number): { speed?: number; time?: number; magnitude?: number };
  dispose(): void;
}

export function buildBlock(ctx: EngineContext, b: EarthBlockView): BlockObj {
  const group = new THREE.Group();
  group.name = "block";
  const growth = { value: 1 };
  const width = b.width ?? 1000;
  const labels: Label[] = [];
  const streams: { s: Stream; win?: [number, number][]; at?: number; until?: number }[] = [];
  const glowMats = new Map<string, THREE.MeshStandardMaterial[]>();
  const addGlow = (id: string, ...m: THREE.MeshStandardMaterial[]) => glowMats.set(id, [...(glowMats.get(id) ?? []), ...m]);
  const shown: Shown[] = [];
  const s = (x: number) => surfaceAt(b, x, growth.value);
  const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  // ------------------------------------------------------------ layers
  const defs = bandDefs(b, growth);
  const bands = defs.map((d, i) => {
    const mat = std(d.color, { emissive: new THREE.Color(0, 0, 0), transparent: d.opacity !== undefined, opacity: d.opacity ?? 1, depthWrite: d.opacity === undefined });
    mat.userData.baseOpacity = d.opacity ?? 1;
    const band = new Band(XS, HZ, 0.004 * i, mat);
    band.mesh.name = `band:${d.id}`;
    if (d.opacity !== undefined) band.mesh.renderOrder = 2;
    band.set(d.top, d.bottom);
    group.add(band.mesh);
    addGlow(d.id === "slab-crust" ? "slab" : d.id, mat);
    return { def: d, band };
  });

  // ------------------------------------------------------------ plates: arrows and conveyor markers
  const arrowMat = std(ARROW, { emissive: new THREE.Color(ARROW), emissiveIntensity: 0.25 });
  const plateArrows: { g: THREE.Group; side: "plate-left" | "plate-right" }[] = [];
  if (b.boundary !== "none") {
    const az = HZ - 0.55;
    const put = (x: number, dx: number, dz: number, side: "plate-left" | "plate-right") => {
      const a = arrowMesh(arrowMat, 1.8);
      const y = s(x) + 0.35;
      pointArrow(a, v3(x - dx * 0.9, y, az - dz * 0.9), v3(x + dx, y, az + dz));
      group.add(a);
      plateArrows.push({ g: a, side });
    };
    if (b.boundary === "divergent") (put(-4, -1, 0, "plate-left"), put(4, 1, 0, "plate-right"));
    if (b.boundary === "subduction") (put(-5, 1, 0, "plate-left"), put(5.2, -1, 0, "plate-right"));
    if (b.boundary === "collision") (put(-5, 1, 0, "plate-left"), put(5, -1, 0, "plate-right"));
    if (b.boundary === "transform") (put(-4, 0, -1, "plate-left"), put(4, 0, 1, "plate-right"));
  }
  const markerMat = basic("#22282d", 1);
  const stripeMats = [std("#3f4a52"), std("#9db0bb")];
  const PERIOD = 1.1;
  const markers: THREE.Mesh[] = [];
  const stripes: THREE.Mesh[] = [];
  let conveyor: Polyline[] = [];
  const road: THREE.Mesh[] = [];
  if (b.motion) {
    if (b.boundary === "divergent") {
      for (let k = 0; k < 2 * (Math.ceil(HW / PERIOD) + 1); k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(PERIOD * 0.5, 0.05, 2 * HZ), stripeMats[0]!);
        m.userData.key = true;
        stripes.push(m);
        group.add(m);
      }
    }
    const line = (pts: [number, number][]) => new Polyline(pts.map(([x, y]) => v3(x, y, FRONT)));
    if (b.boundary === "subduction") {
      const pts: [number, number][] = [];
      for (let x = -HW; x <= HW; x += 0.1) {
        const y = x < TRENCH ? s(x) : slabTop(b, x);
        if (y < -DEP + 0.15) break;
        pts.push([x, y - 0.14]);
      }
      conveyor = [line(pts)];
    }
    if (b.boundary === "collision") {
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      for (let x = -HW; x <= -0.4; x += 0.1) left.push([x, -0.5]);
      for (let x = HW; x >= 0.4; x -= 0.1) right.push([x, -0.5]);
      conveyor = [line(left), line(right)];
    }
    for (const c of conveyor) {
      const n = Math.ceil(c.length / PERIOD) + 1;
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), markerMat);
        m.userData.key = true;
        m.userData.line = c;
        m.userData.k = k;
        markers.push(m);
        group.add(m);
      }
    }
    if (b.boundary === "transform") {
      const roadMat = std("#2e2e2e");
      for (const side of [-1, 1]) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(HW - 0.15, 0.06, 0.45), roadMat);
        seg.userData.side = side;
        seg.userData.key = true;
        road.push(seg);
        group.add(seg);
      }
      const fault = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 2 * HZ), basic("#141414", 1));
      fault.position.set(0, s(0) + 0.02, 0);
      group.add(fault);
    }
  }

  // ------------------------------------------------------------ volcano
  let volcano: { x: number; base: number; apex: number; chamber: THREE.Vector3; cone: THREE.MeshStandardMaterial[]; conduit: THREE.MeshStandardMaterial } | null = null;
  if (b.volcano) {
    const v = b.volcano;
    const x = v.u !== undefined ? v.u * HW : b.boundary === "subduction" ? ARC : b.boundary === "divergent" ? 0 : 0.3 * HW;
    const dims = { strato: [1.6, 1.6], shield: [2.6, 0.75], cinder: [0.8, 0.7] }[v.kind];
    const [rad, h] = dims as [number, number];
    const base = s(x) - 0.05;
    const apex = base + h;
    const crater = rad * 0.12;
    const coneMat = std(v.kind === "shield" ? "#5a4636" : "#6b5a4c", { emissive: new THREE.Color(0, 0, 0) });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(crater, rad, h, 40, 1, true, Math.PI / 2, Math.PI), coneMat);
    cone.position.set(x, base + h / 2, HZ);
    group.add(cone);
    const cut: THREE.MeshStandardMaterial[] = [coneMat];
    const layersN = v.kind === "strato" ? 4 : 1;
    for (let k = 0; k < layersN; k++) {
      const f = 1 - k / (layersN + 0.5);
      const shape = new THREE.Shape([new THREE.Vector2(-rad * f, 0), new THREE.Vector2(rad * f, 0), new THREE.Vector2(crater, h * f), new THREE.Vector2(-crater, h * f)]);
      const m = std(k % 2 ? "#8c7a68" : "#a08b75", { emissive: new THREE.Color(0, 0, 0) });
      const face = new THREE.Mesh(new THREE.ShapeGeometry(shape), m);
      face.position.set(x, base, HZ + 0.005 + 0.003 * k);
      group.add(face);
      cut.push(m);
    }
    const magma = std("#e2401c", { emissive: new THREE.Color("#c02000"), emissiveIntensity: 0.5 });
    const chamber = v3(x, Math.max(-DEP * 0.4, base - 1.6), FRONT);
    const ch = new THREE.Mesh(new THREE.CircleGeometry(1, 32).scale(0.85, 0.38, 1), magma);
    ch.position.copy(chamber);
    ch.userData.key = true;
    const conduitH = apex - chamber.y;
    const cd = new THREE.Mesh(new THREE.PlaneGeometry(0.16, conduitH).translate(0, conduitH / 2, 0), magma);
    cd.position.set(x, chamber.y, FRONT + 0.004);
    cd.userData.key = true;
    group.add(ch, cd);
    for (const m of cut) addGlow("volcano", m);
    addGlow("chamber", magma);
    addGlow("conduit", magma);
    volcano = { x, base, apex, chamber, cone: cut, conduit: magma };
    if (v.magma ?? true) {
      const srcY = b.boundary === "subduction" ? slabTop(b, x) + 0.05 : -DEP * 0.85;
      const pts = [v3(x + (b.boundary === "subduction" ? 0.3 : 0), srcY, FRONT + 0.01), v3(x + 0.15, lerp(srcY, chamber.y, 0.5), FRONT + 0.01), v3(x, chamber.y - 0.3, FRONT + 0.01)];
      streams.push({ s: new Stream(pts, 28, { ...FLOW_STYLES.magma!, speed: 0.5 }, 3) });
    }
    const eruptions = v.eruptions;
    if (eruptions?.length) {
      const up = [v3(x, chamber.y, FRONT + 0.02), v3(x, apex, FRONT + 0.02)];
      streams.push({ s: new Stream(up, 18, { ...FLOW_STYLES.magma!, speed: 2.2, spread: 0.03 }, 5), win: eruptions });
      if (v.style === "explosive") {
        const plume = [v3(x, apex + 0.1, HZ - 0.3), v3(x + 0.3, apex + 1.6, HZ - 0.3), v3(x + 1.2, apex + 3.2, HZ - 0.4)];
        streams.push({ s: new Stream(plume, 90, { ...FLOW_STYLES.ash!, speed: 0.9 }, 7), win: eruptions });
        streams.push({ s: new Stream([v3(x, apex, HZ - 0.3), v3(x - 0.6, apex + 1.4, HZ - 0.3), v3(x - 1.4, apex + 0.4, HZ - 0.2)], 10, { ...FLOW_STYLES.lava!, speed: 1.6, spread: 0.25 }, 9), win: eruptions });
      } else {
        for (const side of [-1, 1]) {
          const flank = [v3(x + side * crater, apex, FRONT + 0.02), v3(x + side * rad * 0.55, lerp(apex, base, 0.55), FRONT + 0.02), v3(x + side * rad * 0.98, base + 0.05, FRONT + 0.02)];
          streams.push({ s: new Stream(flank, 30, { ...FLOW_STYLES.lava!, speed: 0.5 }, 11 + side), win: eruptions });
        }
      }
    }
  }

  // ------------------------------------------------------------ fault and quake fronts
  let fault: {
    hypo: THREE.Vector3;
    epi: THREE.Vector3;
    mid: THREE.Vector3;
    fronts: { mesh: THREE.InstancedMesh; ground: THREE.InstancedMesh; ratio: number }[];
    houses: { g: THREE.Group; base: THREE.Vector3; dist: number }[];
    speed: number;
    mat: THREE.MeshStandardMaterial;
  } | null = null;
  if (b.fault) {
    const f = b.fault;
    const xf = (f.u ?? 0.15) * HW;
    const dip = (f.kind === "strike-slip" ? 90 : 60) * (Math.PI / 180);
    const top = v3(xf, s(xf), FRONT);
    const yh = -(f.depth ?? 0.35) * DEP;
    const hypo = v3(xf + (top.y - yh) / Math.tan(dip), yh, FRONT + 0.01);
    const bottom = v3(xf + (top.y + DEP * 0.85) / Math.tan(dip), -DEP * 0.85, FRONT);
    const mat = std("#141414", { emissive: new THREE.Color(0, 0, 0) });
    const lineMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 1), mat);
    lineMesh.position.copy(top).lerp(bottom, 0.5);
    lineMesh.scale.y = top.distanceTo(bottom);
    lineMesh.rotation.z = Math.PI / 2 - dip;
    const trace = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 2 * HZ), mat);
    trace.position.set(xf, s(xf) + 0.015, 0);
    group.add(lineMesh, trace);
    addGlow("fault", mat);
    const epi = v3(hypo.x, s(hypo.x) + 0.08, HZ - 0.05);
    const hyM = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), std("#ff3b1f", { emissive: new THREE.Color("#ff2000"), emissiveIntensity: 0.6 }));
    hyM.position.copy(hypo);
    const epM = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), std("#ff3b1f", { emissive: new THREE.Color("#ff2000"), emissiveIntensity: 0.6 }));
    epM.position.copy(epi);
    hyM.userData.key = epM.userData.key = true;
    group.add(hyM, epM);
    const fronts = (["P", "S"] as const).map((w) => {
      const dotGeo = new THREE.SphereGeometry(0.06, 6, 4);
      const m = new THREE.InstancedMesh(dotGeo, basic(w === "P" ? P_COLOR : S_COLOR, 1), 120);
      const gr = new THREE.InstancedMesh(dotGeo, basic(w === "P" ? P_COLOR : S_COLOR, 1), 64);
      m.frustumCulled = gr.frustumCulled = false;
      m.userData.key = gr.userData.key = true;
      group.add(m, gr);
      return { mesh: m, ground: gr, ratio: w === "P" ? 1 : 0.6 };
    });
    const houseMat = std("#f1e3c8");
    const roofMat = std("#b5462f");
    const houses = [-2.4, 1.3, 3.4].map((dx, i) => {
      const x = clamp(hypo.x + dx, -HW + 0.6, HW - 0.6);
      const z = [0.7, 0.1, -0.8][i]!;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.42).translate(0, 0.17, 0), houseMat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.28, 4).rotateY(Math.PI / 4).translate(0, 0.48, 0), roofMat);
      g.add(body, roof);
      const base = v3(x, s(x) - 0.02, z);
      g.position.copy(base);
      group.add(g);
      return { g, base, dist: Math.hypot(x - epi.x, z - epi.z) };
    });
    fault = { hypo, epi, mid: top.clone().lerp(bottom, 0.5), fronts, houses, speed: (2 * HW) / (f.travel ?? 4), mat };
  }

  // ------------------------------------------------------------ water cycle
  const clouds: THREE.Vector3[] = [];
  let riverPath: Polyline | null = null;
  if (b.water) {
    const w = b.water;
    let seaX: number | null = null;
    for (const x of XS) if (s(x) < -0.05) seaX = seaX === null ? x : seaX;
    const seaEnd = XS.filter((x) => s(x) < -0.05).pop();
    const seaMid = seaX !== null && seaEnd !== undefined ? (seaX + seaEnd) / 2 : null;
    const cloudMat = std("#ffffff", { roughness: 1 });
    const landXs = XS.filter((x) => s(x) >= 0);
    const highX = landXs.length ? landXs.reduce((a, x) => (s(x) > s(a) ? x : a), landXs[0]!) : 0;
    for (const cx of [highX - 1.2, highX + 1.6, seaMid ?? highX - 4]) clouds.push(v3(clamp(cx, -HW + 1, HW - 1), 3, -0.3));
    if (w.clouds ?? true) {
      clouds.forEach((c, i) => {
        const g = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const r = 0.45 + 0.15 * ((k * 7 + i) % 3);
          const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), cloudMat);
          m.position.set((k - 2) * 0.42, (k % 2) * 0.18, ((k * 5) % 3) * 0.2 - 0.2);
          g.add(m);
        }
        g.position.copy(c);
        group.add(g);
      });
    }
    if (w.evaporation && seaMid !== null) {
      const pts = [v3(seaMid, 0.05, 0), v3(seaMid + 0.4, 1.5, -0.2), v3(clouds[2]!.x, 2.7, -0.3)];
      streams.push({ s: new Stream(pts, 40, { ...FLOW_STYLES.vapour!, speed: 0.6 }, 13), win: w.evaporation });
    }
    if (w.rain) {
      for (const [k, c] of clouds.slice(0, 2).entries()) {
        const pts = [v3(c.x, c.y - 0.4, c.z), v3(c.x, s(c.x) + 0.05, c.z)];
        streams.push({ s: new Stream(pts, 50, { ...FLOW_STYLES.rain!, speed: 2.5 }, 17 + k), win: w.rain });
      }
    }
    if (landXs.length) {
      const pts: THREE.Vector3[] = [];
      const dir = seaX !== null && seaX < highX ? -1 : 1;
      for (let x = highX; dir < 0 ? x >= (seaEnd ?? -HW) : x <= HW; x += dir * 0.2) pts.push(v3(x, Math.max(0.03, s(x) + 0.06), 0.5));
      if (pts.length >= 2) {
        riverPath = new Polyline(pts);
        if (w.river) streams.push({ s: new Stream(pts, 50, { ...FLOW_STYLES.water!, speed: 0.9, spread: 0.08 }, 19), win: w.river });
      }
    }
    if (w.infiltration) {
      const x = clouds[0]!.x;
      const pts = [v3(x, s(x) - 0.05, FRONT + 0.01), v3(x + 0.2, s(x) - 0.7, FRONT + 0.01), v3(x - 0.1, -1.3, FRONT + 0.01)];
      streams.push({ s: new Stream(pts, 30, { ...FLOW_STYLES.water!, speed: 0.25 }, 23), win: w.infiltration });
    }
  }

  // ------------------------------------------------------------ free flows and arrows
  const flowPaths = new Map<string, Polyline>();
  for (const [i, f] of (b.flows ?? []).entries()) {
    const pts = f.path.map(([u, v]) => uvToXYZ(u, v, new THREE.Vector3(), FRONT + 0.012));
    const style = FLOW_STYLES[f.kind]!;
    const stream = new Stream(pts, f.count ?? 30, { ...style, speed: 0 }, 31 + i);
    stream.style.speed = (f.speed ?? 0.15) * stream.path.length;
    streams.push({ s: stream, at: f.at, until: f.until });
    flowPaths.set(f.id, stream.path);
  }
  for (const a of b.arrows ?? []) {
    const from = uvToXYZ(a.from[0], a.from[1], new THREE.Vector3(), FRONT + 0.05);
    const to = uvToXYZ(a.to[0], a.to[1], new THREE.Vector3(), FRONT + 0.05);
    const mat = std(a.color ?? ARROW, { emissive: new THREE.Color(a.color ?? ARROW), emissiveIntensity: 0.25 });
    const g = arrowMesh(mat, Math.max(0.3, from.distanceTo(to)), 0.07);
    pointArrow(g, from, to);
    group.add(g);
    shown.push({ object: g, at: a.at, until: a.until, mats: [mat] });
    flowPaths.set(a.id, new Polyline([from, to]));
    addGlow(a.id, mat);
  }
  for (const st of streams) group.add(st.s.mesh);

  // ------------------------------------------------------------ readout
  const readout = new Label(ctx, 0.6);
  labels.push(readout);
  readout.object.position.set(0, 4.9, 0);
  group.add(readout.object);

  const values = (t: number) => ({
    speed: b.motion?.speed,
    time: b.motion ? earthKeyValue(b.motion.time, t) : undefined,
    magnitude: b.fault?.magnitude,
  });

  const allMats = new Set<THREE.Material>();
  group.traverse((o) => {
    // Meshes only: sprite labels keep their own transparency.
    if (o instanceof THREE.Mesh) for (const x of Array.isArray(o.material) ? o.material : [o.material]) allMats.add(x);
  });
  for (const m of stripeMats) allMats.add(m);
  const mtx = new THREE.Matrix4();

  function updateFronts(t: number, magnitude: number) {
    if (!fault || !b.fault) return;
    const start = latest(b.fault.quakes, t);
    const tau = start === null ? -1 : t - start;
    const hd = fault.epi.y - fault.hypo.y;
    const maxR = 2.2 * HW;
    for (const fr of fault.fronts) {
      const r = tau * fault.speed * fr.ratio;
      const on = tau >= 0 && r < maxR;
      fr.mesh.visible = fr.ground.visible = on;
      if (!on) continue;
      const fade = 1 - r / maxR;
      (fr.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
      (fr.ground.material as THREE.MeshBasicMaterial).opacity = fade;
      const n = fr.mesh.count;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = fault.hypo.x + r * Math.cos(a);
        const y = fault.hypo.y + r * Math.sin(a);
        const inside = Math.abs(x) <= HW && y >= -DEP && y <= s(x);
        mtx.makeScale(inside ? 1 : 0, inside ? 1 : 0, inside ? 1 : 0).setPosition(x, y, FRONT + 0.02);
        fr.mesh.setMatrixAt(i, mtx);
      }
      fr.mesh.instanceMatrix.needsUpdate = true;
      const rg = r > hd ? Math.sqrt(r * r - hd * hd) : -1;
      const m = fr.ground.count;
      for (let i = 0; i < m; i++) {
        const a = Math.PI + (i / (m - 1)) * Math.PI; // half circle towards the back (z < front)
        const x = fault.epi.x + rg * Math.cos(a);
        const z = fault.epi.z + rg * Math.sin(a);
        const inside = rg > 0 && Math.abs(x) <= HW && z >= -HZ;
        mtx.makeScale(inside ? 1 : 0, inside ? 1 : 0, inside ? 1 : 0).setPosition(x, s(clamp(x, -HW, HW)) + 0.06, z);
        fr.ground.setMatrixAt(i, mtx);
      }
      fr.ground.instanceMatrix.needsUpdate = true;
    }
    // Houses shake when the S front reaches them; visual amplitude grows with the magnitude (compressed).
    const amp = clamp(0.012 * 1.8 ** (magnitude - 3), 0.004, 0.32);
    for (const h of fault.houses) {
      h.g.position.copy(h.base);
      h.g.rotation.z = 0;
      if (tau < 0) continue;
      const rS = tau * fault.speed * 0.6;
      const reach = Math.sqrt(h.dist * h.dist + hd * hd);
      if (rS < reach) continue;
      const since = (rS - reach) / (fault.speed * 0.6);
      const env = Math.exp(-since * 1.2);
      const wob = Math.sin(since * Math.PI * 2 * 3.2) * amp * env;
      h.g.position.x += wob;
      h.g.rotation.z = wob * 0.8;
    }
  }

  return {
    group,
    values,

    update(t, ov) {
      const pres = presence(t, b.at, b.until);
      group.visible = pres > 0.001;
      if (!group.visible) return;
      const val = values(t);
      const speed = ov.speed ?? val.speed ?? 0;
      const ma = ov.time ?? val.time ?? 0;
      const magnitude = ov.magnitude ?? val.magnitude ?? 0;
      const dKm = displacementKm(speed, ma);
      const dVis = (dKm / width) * 2 * HW;
      // Collision: the range grows with the convergence.
      if (b.boundary === "collision" && b.motion) {
        growth.value = clamp(dVis / 8);
        for (const { def, band } of bands) if (def.live) band.set(def.top, def.bottom);
      }
      for (const m of allMats) setOpacity(m, (m.userData.baseOpacity as number | undefined) ?? 1, pres);
      // Conveyor stripes (divergent): new crust born at the ridge, carried outwards.
      if (stripes.length) {
        const half = stripes.length / 2;
        const shift = ((dVis / 2) % PERIOD + PERIOD) % PERIOD;
        const born = Math.floor(dVis / 2 / PERIOD);
        stripes.forEach((m, i) => {
          const side = i < half ? -1 : 1;
          const k = i % half;
          const x = side * (k * PERIOD + shift + PERIOD * 0.25);
          m.visible = Math.abs(x) < HW - 0.3;
          m.position.set(x, s(x) + 0.01, 0);
          m.material = stripeMats[(k - born + 1000) % 2]!;
        });
      }
      for (const m of markers) {
        const line = m.userData.line as Polyline;
        const k = m.userData.k as number;
        const d = k * PERIOD + ((dVis % PERIOD) + PERIOD) % PERIOD;
        m.visible = d < line.length - 0.05;
        line.at(d, m.position);
      }
      for (const r of road) {
        const side = r.userData.side as number;
        const off = Math.min(HZ * 0.85, dVis / 2);
        r.position.set((side * (HW - 0.1)) / 2, s((side * HW) / 2) + 0.06, -side * off);
      }
      // Streams.
      for (const st of streams) {
        const p = st.win ? windows(t, st.win) : presence(t, st.at, st.until);
        const start = st.win ? (st.win.filter((w) => w[0] <= t).pop()?.[0] ?? null) : (st.at ?? -60);
        st.s.update(start === null ? -1 : t - start, p * pres);
      }
      updateFronts(t, magnitude);
      // Glow: scene windows; the conduit glows during eruptions.
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.6);
      const glowOf = new Map<string, number>();
      for (const g of b.glow ?? []) glowOf.set(g.part, Math.max(glowOf.get(g.part) ?? 0, windows(t, [g.window])));
      for (const [id, mats] of glowMats) {
        const w = glowOf.get(id) ?? 0;
        for (const m of mats) {
          if (m === volcano?.conduit) continue;
          m.emissive.copy(GLOW).multiplyScalar(w * (0.16 + 0.18 * pulse));
          m.userData.key = w > 0.05;
        }
      }
      if (volcano) {
        const e = windows(t, b.volcano?.eruptions);
        volcano.conduit.emissiveIntensity = 0.5 + 0.5 * e * pulse;
      }
      for (const a of plateArrows) a.g.visible = !!b.motion || (glowOf.get(a.side) ?? 0) > 0;
      for (const sh of shown) {
        const p = presence(t, sh.at, sh.until);
        sh.object.visible = p > 0.001;
        for (const m of sh.mats) setOpacity(m, 1, p * pres);
      }
      // Readout.
      const lines: string[] = [];
      if (b.motion)
        lines.push(engineText("earth.motion", { ma: fmt(ma, Math.abs(ma - Math.round(ma)) > 0.05 ? 1 : 0), speed: fmtDec(speed), km: fmt(Math.round(dKm)) }));
      if (b.fault) {
        const c = b.fault.compare;
        const amp = c !== undefined ? engineText("earth.amplitude", { x: fmt(nice(10 ** (magnitude - c)), magnitude - c < 0 ? 2 : 0), c: fmt(c, 1) }) : "";
        lines.push(engineText("earth.magnitude", { m: fmt(magnitude, 1) }) + amp);
      }
      readout.object.visible = lines.length > 0;
      readout.set(lines.join("\n"));
    },

    anchor(part, index, t, out) {
      const pct = index === undefined ? 0.5 : clamp(index / 100);
      const front = (x: number, y: number) => out.set(x, y, FRONT);
      const band = bands.find((x) => x.def.id === part);
      const sideX = b.boundary === "subduction" ? 5 : -5;
      if (band) {
        const x = part === "ocean" ? (b.boundary === "subduction" ? -5 : b.sea !== undefined ? (b.sea * HW - HW) / 2 : -3) : part === "slab" ? TRENCH + 3.2 : part === "asthenosphere" ? -2.5 : b.strata ? -4 : sideX;
        if (part === "slab") front(x, slabTop(b, x) - 0.5);
        else front(x, (band.def.top(x) + band.def.bottom(x)) / 2);
      } else if (flowPaths.has(part)) flowPaths.get(part)!.at(pct * flowPaths.get(part)!.length, out);
      else
        switch (part) {
          case "surface":
            out.set(0, s(0) + 0.3, 0);
            break;
          case "readout":
            out.copy(readout.object.position);
            break;
          case "plate-left":
            out.set(-5, s(-5) + 0.4, 0);
            break;
          case "plate-right":
            out.set(5, s(5) + 0.4, 0);
            break;
          case "ridge":
            out.set(0, s(0) + 0.15, 0);
            break;
          case "trench":
            front(TRENCH, s(TRENCH) + 0.05);
            break;
          case "mountains": {
            const x = b.boundary === "subduction" ? ARC : b.boundary === "none" ? 3.5 : 0;
            out.set(x, s(x) + 0.2, 0);
            break;
          }
          case "volcano":
            if (!volcano) return false;
            out.set(volcano.x, volcano.apex + 0.15, HZ - 0.2);
            break;
          case "chamber":
            if (!volcano) return false;
            out.copy(volcano.chamber);
            break;
          case "conduit":
            if (!volcano) return false;
            front(volcano.x, (volcano.chamber.y + volcano.apex) / 2);
            break;
          case "fault":
            if (!fault) return false;
            out.copy(fault.mid);
            break;
          case "hypocentre":
            if (!fault) return false;
            out.copy(fault.hypo);
            break;
          case "epicentre":
            if (!fault) return false;
            out.copy(fault.epi);
            break;
          case "cloud":
            if (!clouds.length) return false;
            out.copy(clouds[0]!).setY(clouds[0]!.y + 0.4);
            break;
          case "river":
            if (!riverPath) return false;
            riverPath.at(riverPath.length * 0.5, out);
            break;
          default:
            return false;
        }
      out.add(group.position);
      return true;
    },

    dispose() {
      const geos = new Set<THREE.BufferGeometry>();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) geos.add(o.geometry);
      });
      for (const g of geos) g.dispose();
      for (const m of allMats) m.dispose();
      for (const st of streams) st.s.dispose();
      for (const l of labels) l.dispose();
    },
  };
}
