// Procedural music notation: staff positions, clefs, note heads with stems and flags, rests, accidentals.
// All glyphs are built in the staff plane (x right, y up) and face +z.
import * as THREE from "three";
import { box, mesh } from "./draw.ts";

/** Staff geometry (scene units). */
export const STAFF = {
  /** y of line 1 (bottom). */
  y0: 3.4,
  /** Distance between two lines; one diatonic step is half of it. */
  gap: 0.5,
  z: -0.95,
  /** Board and line extents. */
  x0: -8.0,
  x1: 8.0,
  /** Note area (after clef and time signature). */
  notesX0: -5.5,
  notesX1: 7.6,
} as const;

const LETTERS = "CDEFGAB";

/** Diatonic step number of a pitch, ignoring the accidental (C0 = 0, C4 = 28, E4 = 30). */
export function stepOf(pitch: string): number {
  return Number(pitch[pitch.length - 1]) * 7 + LETTERS.indexOf(pitch[0]!);
}

/** Step of line 1 for each clef: E4 (treble), G2 (bass). */
export const BOTTOM_STEP = { treble: 30, bass: 18 } as const;

export const stepY = (step: number, bottom: number) => STAFF.y0 + (step - bottom) * (STAFF.gap / 2);
export const lineY = (k: number) => STAFF.y0 + (k - 1) * STAFF.gap;

/** A smooth tube along 2D points (staff-space units, scaled by `s`), centred at (x, y). */
function stroke(points: [number, number][], s: number, r: number, m: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x * s, y * s, 0)));
  return mesh(new THREE.TubeGeometry(curve, points.length * 10, r, 6, false), m);
}

/** Treble (G) clef: the curl wraps line 2 (G4). Origin on line 2. */
export function trebleClef(m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = "clef:treble";
  const pts: [number, number][] = [
    [0.12, 0.3], [0.5, 0.15], [0.55, -0.35], [0.12, -0.7], [-0.45, -0.5], [-0.65, 0.1], [-0.35, 0.75],
    [0.25, 1.35], [0.6, 2.05], [0.52, 2.85], [0.22, 3.3], [-0.05, 3.05], [-0.18, 2.35], [-0.05, 1.2],
    [0.12, 0], [0.22, -1.2], [0.2, -1.75], [-0.08, -2.05], [-0.38, -1.85],
  ];
  g.add(stroke(pts, STAFF.gap, 0.055, m));
  g.add(mesh(new THREE.SphereGeometry(0.11, 12, 8).translate(-0.19, -0.9, 0), m));
  return g;
}

/** Bass (F) clef: the big dot sits on line 4 (F3), the two dots around it. Origin on line 4. */
export function bassClef(m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = "clef:bass";
  const pts: [number, number][] = [[-0.4, 0.05], [-0.15, 0.5], [0.35, 0.55], [0.7, 0.15], [0.65, -0.55], [0.2, -1.25], [-0.45, -1.8]];
  g.add(stroke(pts, STAFF.gap, 0.06, m));
  g.add(mesh(new THREE.SphereGeometry(0.12, 12, 8).translate(-0.4 * STAFF.gap, 0, 0), m));
  for (const y of [0.25, -0.25]) g.add(mesh(new THREE.SphereGeometry(0.055, 10, 6).translate(0.95 * STAFF.gap, y * STAFF.gap, 0), m));
  return g;
}

/** "#" from four thin boxes, centred at the origin. */
export function sharp(m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.06, 0.06]) g.add(box(0.025, 0.5, 0.03, x, 0, 0, m));
  for (const y of [-0.09, 0.09]) {
    const b = box(0.24, 0.05, 0.03, 0, y, 0, m);
    b.rotation.z = 0.3;
    g.add(b);
  }
  return g;
}

/** "♭": a stem and a small bowl, origin on the note's line. */
export function flat(m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.025, 0.55, 0.03, -0.07, 0.17, 0, m));
  const bowl = mesh(new THREE.TorusGeometry(0.08, 0.022, 6, 16, Math.PI * 1.6), m);
  bowl.rotation.z = -Math.PI * 0.55;
  bowl.position.set(0, -0.02, 0);
  bowl.scale.set(1, 1.2, 1);
  g.add(bowl);
  return g;
}

const HEAD_FILLED = new THREE.SphereGeometry(0.2, 18, 12);
const HEAD_OPEN = new THREE.TorusGeometry(0.16, 0.055, 8, 22);
/** Module-level geometries shared by every engine instance: never disposed. */
export const SHARED_GEOMETRIES: ReadonlySet<THREE.BufferGeometry> = new Set([HEAD_FILLED, HEAD_OPEN]);

export interface NoteGlyph {
  group: THREE.Group;
  /** The head, which lights up and bounces. */
  head: THREE.Mesh;
}

/**
 * A note (or rest) of `beats` quarter beats. `y` is the head centre; `up` the stem direction; `middle`
 * the y of line 3 (rests sit around it). The head uses `headMat`, the rest of the glyph `ink`.
 */
export function noteGlyph(beats: number, rest: boolean, up: boolean, headMat: THREE.Material, ink: THREE.Material, middle: number, y: number): NoteGlyph {
  const group = new THREE.Group();
  const dotted = beats === 3 || beats === 1.5 || beats === 0.75;
  const base = dotted ? beats / 1.5 : beats;
  const flags = base === 0.5 ? 1 : base === 0.25 ? 2 : 0;
  let head: THREE.Mesh;
  if (rest) {
    const gy = middle - y;
    if (base >= 4) head = box(0.5, 0.22, 0.06, 0, gy + STAFF.gap - 0.11, 0, headMat);
    else if (base >= 2) head = box(0.5, 0.22, 0.06, 0, gy + 0.11, 0, headMat);
    else if (base >= 1) {
      head = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), headMat);
      const zig: [number, number, number][] = [[0.04, gy + 0.42, -0.9], [-0.02, gy + 0.12, 0.9], [0.04, gy - 0.18, -0.9], [-0.04, gy - 0.4, 0.5]];
      for (const [x, yy, rot] of zig) {
        const b = box(0.07, 0.3, 0.06, 0, 0, 0, headMat);
        b.position.set(x, yy, 0);
        b.rotation.z = rot;
        head.add(b);
      }
    } else {
      head = box(0.06, 0.75, 0.05, 0.05, gy - 0.05, 0, headMat);
      head.rotation.z = -0.25;
      for (let k = 0; k < flags; k++) {
        const dot = mesh(new THREE.SphereGeometry(0.085, 10, 8), headMat);
        dot.position.set(-0.12 - k * 0.06, gy + 0.22 - k * STAFF.gap, 0);
        group.add(dot);
      }
    }
    group.add(head);
    if (dotted) group.add(mesh(new THREE.SphereGeometry(0.06, 10, 6).translate(0.38, gy + STAFF.gap / 2, 0), ink));
    return { group, head };
  }
  const open = base >= 2;
  head = mesh(open ? HEAD_OPEN : HEAD_FILLED, headMat, "head");
  head.scale.set(open ? 1.25 : 1.3, open ? 0.95 : 0.95, open ? 1 : 0.55);
  head.rotation.z = 0.35;
  if (base >= 4) {
    head.scale.set(1.45, 1.05, 1);
    head.rotation.z = 0;
  }
  group.add(head);
  if (base < 4) {
    const sx = up ? 0.24 : -0.24;
    const len = 1.75;
    group.add(box(0.045, len, 0.04, sx, up ? len / 2 : -len / 2, 0, ink));
    for (let k = 0; k < flags; k++) {
      const f = box(0.06, 0.55, 0.04, 0, 0, 0, ink);
      const tip = up ? len - k * 0.28 : -len + k * 0.28;
      f.position.set(sx + 0.16, tip + (up ? -0.22 : 0.22), 0);
      f.rotation.z = up ? 0.8 : -0.8;
      group.add(f);
    }
  }
  if (dotted) group.add(mesh(new THREE.SphereGeometry(0.06, 10, 6).translate(0.42, 0.08, 0), ink));
  return { group, head };
}
