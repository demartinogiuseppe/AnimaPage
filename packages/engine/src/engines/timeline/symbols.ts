// Procedural low-poly symbols for timeline events. Each builder returns a group
// standing on y = 0, about 1.2 units wide and 1.2-1.8 tall, readable at small size.
// Materials are created per symbol so each event can glow on its own.
import * as THREE from "three";
import type { TimelineData } from "@pv/scene-spec";

// TimelineSymbol is not re-exported by the scene-spec package index, so derive it.
type TimelineSymbol = TimelineData["events"][number]["symbol"];

// Palette from the prototypes (analysis-troia.md, Appendix B.2).
export const PALETTE = {
  stone: "#d3c19a",
  stoneDark: "#c2ad83",
  bronze: "#b98a3e",
  gold: "#d1a640",
  ivory: "#efe6cf",
  leather: "#5a4430",
  clay: "#9b4a22",
  pitch: "#2b231e",
  blue: "#2c5fa6",
  red: "#b3342a",
  sand: "#e2d3a2",
  ink: "#2a211b",
} as const;

const DEFAULT_COLOR: Record<TimelineSymbol, string> = {
  column: PALETTE.stone,
  crown: PALETTE.gold,
  ship: PALETTE.pitch,
  book: PALETTE.clay,
  scroll: PALETTE.ivory,
  sword: PALETTE.bronze,
  pyramid: PALETTE.sand,
  temple: PALETTE.stone,
  shield: PALETTE.blue,
  wheel: PALETTE.leather,
  amphora: PALETTE.clay,
  tower: PALETTE.stoneDark,
};

const mat = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const out = new THREE.Mesh(geo, m);
  out.position.set(x, y, z);
  return out;
}

type Builder = (main: THREE.MeshLambertMaterial, g: THREE.Group) => void;

const BUILDERS: Record<TimelineSymbol, Builder> = {
  column(main, g) {
    g.add(mesh(new THREE.BoxGeometry(0.75, 0.16, 0.75), main, 0, 0.08));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.3, 10), main, 0, 0.81));
    g.add(mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.12, 10), main, 0, 1.52));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.14, 0.7), main, 0, 1.65));
  },
  temple(main, g) {
    g.add(mesh(new THREE.BoxGeometry(1.35, 0.16, 0.95), main, 0, 0.08));
    const colGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.75, 6);
    for (const x of [-0.52, -0.17, 0.17, 0.52]) for (const z of [-0.32, 0.32]) g.add(mesh(colGeo, main, x, 0.535, z));
    g.add(mesh(new THREE.BoxGeometry(1.35, 0.12, 0.95), main, 0, 0.97));
    const tri = new THREE.Shape([new THREE.Vector2(-0.7, 0), new THREE.Vector2(0.7, 0), new THREE.Vector2(0, 0.32)]);
    const ped = new THREE.ExtrudeGeometry(tri, { depth: 0.95, bevelEnabled: false });
    ped.translate(0, 0, -0.475);
    g.add(mesh(ped, mat(PALETTE.clay), 0, 1.03));
  },
  crown(main, g) {
    g.add(mesh(new THREE.BoxGeometry(0.95, 0.22, 0.95), mat(PALETTE.red), 0, 0.11));
    const band = new THREE.CylinderGeometry(0.42, 0.38, 0.34, 10, 1, true);
    main.side = THREE.DoubleSide;
    g.add(mesh(band, main, 0, 0.39));
    const spike = new THREE.ConeGeometry(0.09, 0.32, 4);
    const gem = new THREE.OctahedronGeometry(0.06);
    const gemMat = mat(PALETTE.red);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = Math.sin(a) * 0.41;
      const z = Math.cos(a) * 0.41;
      g.add(mesh(spike, main, x, 0.72, z));
      g.add(mesh(gem, gemMat, Math.sin(a) * 0.43, 0.4, Math.cos(a) * 0.43));
    }
  },
  ship(main, g) {
    const hull = new THREE.BoxGeometry(1.4, 0.32, 0.48, 4, 1, 1);
    const pos = hull.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Pointed bow/stern, narrower keel, raised ends.
      pos.setZ(i, pos.getZ(i) * (Math.abs(x) > 0.6 ? 0.12 : 1) * (y < 0 ? 0.55 : 1));
      if (Math.abs(x) > 0.6 && y > 0) pos.setY(i, y + 0.14);
    }
    hull.computeVertexNormals();
    g.add(mesh(hull, main, 0, 0.3));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.15, 5), mat(PALETTE.leather), 0, 1.0));
    // Sail drawn face-on (not across the beam) so it reads from the default side view.
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.6, 0.04), mat(PALETTE.ivory), 0, 1.08, 0.05));
    g.add(mesh(new THREE.BoxGeometry(0.73, 0.1, 0.05), mat(PALETTE.red), 0, 1.08, 0.05));
    g.add(mesh(new THREE.BoxGeometry(0.85, 0.04, 0.06), mat(PALETTE.leather), 0, 1.4, 0.05));
  },
  book(main, g) {
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), mat(PALETTE.leather), 0, 0.3));
    const stand = new THREE.Group();
    stand.position.set(0, 0.65, 0);
    stand.rotation.x = 0.5;
    stand.add(mesh(new THREE.BoxGeometry(1.15, 0.05, 0.8), main));
    const page = new THREE.BoxGeometry(0.52, 0.07, 0.74);
    const pageMat = mat(PALETTE.ivory);
    const left = mesh(page, pageMat, -0.27, 0.07, 0);
    left.rotation.z = 0.14;
    const right = mesh(page, pageMat, 0.27, 0.07, 0);
    right.rotation.z = -0.14;
    stand.add(left, right);
    g.add(stand);
  },
  scroll(main, g) {
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.12, 0.4), mat(PALETTE.leather), 0, 0.06));
    const rod = new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8);
    const knob = new THREE.SphereGeometry(0.07, 6, 4);
    const knobMat = mat(PALETTE.bronze);
    for (const x of [-0.36, 0.36]) {
      g.add(mesh(rod, main, x, 0.72, 0));
      g.add(mesh(knob, knobMat, x, 1.32, 0));
    }
    g.add(mesh(new THREE.BoxGeometry(0.72, 0.95, 0.02), main, 0, 0.72, 0.05));
    const lineMat = mat(PALETTE.ink);
    for (let k = 0; k < 5; k++) g.add(mesh(new THREE.BoxGeometry(0.46, 0.03, 0.01), lineMat, 0, 0.45 + k * 0.14, 0.065));
  },
  sword(main, g) {
    g.add(mesh(new THREE.DodecahedronGeometry(0.42, 0), mat(PALETTE.stoneDark), 0, 0.4));
    g.add(mesh(new THREE.BoxGeometry(0.13, 0.95, 0.04), main, 0, 0.85));
    g.add(mesh(new THREE.BoxGeometry(0.55, 0.08, 0.12), mat(PALETTE.bronze), 0, 1.36));
    g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 6), mat(PALETTE.leather), 0, 1.55));
    g.add(mesh(new THREE.SphereGeometry(0.08, 6, 4), mat(PALETTE.bronze), 0, 1.74));
  },
  pyramid(main, g) {
    const geo = new THREE.ConeGeometry(0.8, 1.15, 4);
    geo.rotateY(Math.PI / 4);
    g.add(mesh(geo, main, 0, 0.575));
    g.add(mesh(new THREE.ConeGeometry(0.16, 0.23, 4).rotateY(Math.PI / 4), mat(PALETTE.gold), 0, 1.04));
  },
  shield(main, g) {
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), mat(PALETTE.leather), 0, 0.25, -0.12));
    const face = new THREE.Group();
    face.position.set(0, 0.75, 0);
    face.rotation.x = -0.15;
    face.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 14).rotateX(Math.PI / 2), main));
    face.add(mesh(new THREE.TorusGeometry(0.6, 0.05, 4, 14), mat(PALETTE.bronze)));
    face.add(mesh(new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), mat(PALETTE.bronze), 0, 0, 0.05));
    g.add(face);
  },
  wheel(main, g) {
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), main, 0, 0.06));
    const w = new THREE.Group();
    w.position.set(0, 0.68, 0);
    w.add(mesh(new THREE.TorusGeometry(0.52, 0.07, 5, 16), main));
    w.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.18, 8).rotateX(Math.PI / 2), mat(PALETTE.bronze)));
    const spoke = new THREE.BoxGeometry(0.05, 0.98, 0.05);
    for (let k = 0; k < 4; k++) {
      const s = mesh(spoke, main);
      s.rotation.z = (k / 4) * Math.PI;
      w.add(s);
    }
    g.add(w);
  },
  amphora(main, g) {
    const profile = [
      [0.0, 0.0],
      [0.12, 0.0],
      [0.05, 0.12],
      [0.3, 0.45],
      [0.36, 0.7],
      [0.28, 1.0],
      [0.12, 1.15],
      [0.1, 1.42],
      [0.14, 1.48],
      [0.0, 1.48],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    g.add(mesh(new THREE.LatheGeometry(profile, 10), main));
    const handle = new THREE.TorusGeometry(0.16, 0.035, 4, 8, Math.PI);
    for (const side of [-1, 1]) {
      const h = mesh(handle, main, side * 0.16, 1.18, 0);
      h.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(h);
    }
  },
  tower(main, g) {
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.2, 10), main, 0, 0.6));
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 10), main, 0, 1.26));
    const merlon = new THREE.BoxGeometry(0.16, 0.2, 0.16);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.add(mesh(merlon, main, Math.sin(a) * 0.42, 1.42, Math.cos(a) * 0.42));
    }
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.42, 0.06), mat(PALETTE.pitch), 0, 0.21, 0.45));
  },
};

export function buildSymbol(symbol: TimelineSymbol, color?: string): THREE.Group {
  const g = new THREE.Group();
  g.name = `symbol:${symbol}`;
  BUILDERS[symbol](mat(color ?? DEFAULT_COLOR[symbol]), g);
  return g;
}

export const SYMBOLS = Object.keys(BUILDERS) as TimelineSymbol[];
