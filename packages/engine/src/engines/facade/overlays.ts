// Drawing aids of the façade views, in the overlay red: the horizon, the vanishing point and the depth
// lines of the one-point perspective; the section line A–A of the prospetto; the level marks of the
// sezione; the scale bar of the pianta. They live in building-local metres (the group carries the engine scale), are drawn over the
// façade, and fade with the weight of the view they belong to.
import * as THREE from "three";
import { FACADE_LINE } from "./ink.ts";
import type { FacadeLayout } from "./model.ts";

/** How much of each overlay shows, 0..1. */
export interface OverlayWeights {
  perspective: number;
  sectionLine: number;
  levels: number;
  plan: number;
}

export interface Overlays {
  group: THREE.Group;
  /** `eye` and `cutX` (the x of the bay the section cuts) in building-local metres. */
  set(eye: { height: number; x: number }, w: OverlayWeights, cutX: number): void;
  dispose(): void;
}

type Seg = readonly [number, number, number, number, number, number];

/** A planar polygon as segments. */
function polygon(points: ReadonlyArray<readonly [number, number, number]>): Seg[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length]!;
    return [p[0], p[1], p[2], q[0], q[1], q[2]] as const;
  });
}

/**
 * A set of `count` segments in one fixed-size position attribute: `write` rewrites it in place, so a moving
 * eye never allocates (and never orphans) a GL buffer.
 */
function lines(name: string, count: number, color: number = FACADE_LINE.overlay): { object: THREE.LineSegments; write(segs: readonly Seg[]): void } {
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false });
  const position = new THREE.BufferAttribute(new Float32Array(count * 6), 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", position);
  const object = new THREE.LineSegments(geometry, material);
  object.name = name;
  object.renderOrder = 10;
  // The perspective lines move with the eye, and the bounding sphere is computed once.
  object.frustumCulled = false;
  const write = (segs: readonly Seg[]): void => {
    if (segs.length !== count) throw new Error(`${name}: ${segs.length} segments, expected ${count}`);
    position.array.set(segs.flat());
    position.needsUpdate = true;
  };
  return { object, write };
}

/** The letter A as three segments in the plane z, `h` tall, its foot centred on (x, y). */
function letterA(x: number, y: number, z: number, h: number): Seg[] {
  const w = h * 0.7;
  return [
    [x - w / 2, y, z, x, y + h, z],
    [x, y + h, z, x + w / 2, y, z],
    [x - w / 4, y + h * 0.35, z, x + w / 4, y + h * 0.35, z],
  ];
}

/** Seven-segment digits (a b c d e f g: top, upper right, lower right, bottom, lower left, upper left, middle). */
const DIGITS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
const SEGMENT: Record<string, readonly [number, number, number, number]> = {
  a: [0, 2, 1, 2],
  b: [1, 1, 1, 2],
  c: [1, 0, 1, 1],
  d: [0, 0, 1, 0],
  e: [0, 0, 0, 1],
  f: [0, 1, 0, 2],
  g: [0, 1, 1, 1],
};

/**
 * A label such as "5 m" as line segments in the plan view: x runs to the right, the glyphs stand `h` tall with their baseline
 * at z (the screen's up is -z in the pianta), the first glyph starting at x0. Digits are seven-segment, the m is three stems
 * and two arches.
 */
function label(text: string, x0: number, y: number, z: number, h: number): Seg[] {
  const segs: Seg[] = [];
  const w = 0.5 * h;
  let x = x0;
  for (const ch of text) {
    if (ch === " ") x += 0.6 * w;
    else if (ch === "m") {
      const mw = 1.5 * w;
      for (const k of [0, 1, 2]) segs.push([x + (k * mw) / 2, y, z, x + (k * mw) / 2, y, z - h / 2]);
      for (const k of [0, 1]) segs.push([x + (k * mw) / 2, y, z - h / 2, x + ((k + 1) * mw) / 2, y, z - h / 2]);
      x += mw + 0.4 * w;
    } else {
      for (const s of DIGITS[Number(ch)]!) {
        const [ax, ay, bx, by] = SEGMENT[s]!;
        segs.push([x + ax * w, y, z - (ay * h) / 2, x + bx * w, y, z - (by * h) / 2]);
      }
      x += w + 0.4 * w;
    }
  }
  return segs;
}

export function createOverlays(layout: FacadeLayout, cutX: number): Overlays {
  const { width: W, height: H, depth: D } = layout.size;
  const front = layout.front;
  const group = new THREE.Group();
  group.name = "overlays";
  group.userData.inkSelf = true;

  // Front points the depth lines start from: base corners, floor lines, cornice ends, portico floor corners.
  const starts: Array<[number, number, number]> = [];
  const corners = (y: number, z: number): void => {
    starts.push([-W / 2, y, z], [W / 2, y, z]);
  };
  corners(0, front);
  for (const f of layout.floors) {
    corners(f.y1, 0);
    if (f.floor.portico) corners(f.y0, 0);
  }
  // horizon + vanishing-point cross (2) and ring (16) + one depth line per start
  const RING = 16;
  const perspective = lines("overlay-perspective", 1 + 2 + RING + starts.length);

  // A–A in the prospetto: a vertical line through the cut bay, its legs pointing the way we look (+x),
  // and the letter A beside both ends.
  const leg = 0.06 * W;
  const barb = 0.015 * W;
  const letter = 0.05 * W;
  const y0 = -0.06 * H;
  const y1 = 1.06 * H;
  const sectionAt = (x: number): Seg[] => {
    const segs: Seg[] = [[x, y0, front, x, y1, front]];
    for (const y of [y0, y1]) {
      segs.push([x, y, front, x + leg, y, front], [x + leg, y, front, x + leg - barb, y + barb, front], [x + leg, y, front, x + leg - barb, y - barb, front]);
      segs.push(...letterA(x + leg + 0.04 * W, y - letter / 2, front, letter));
    }
    return segs;
  };
  const section = lines("overlay-section", sectionAt(cutX).length);
  section.write(sectionAt(cutX));

  // Level marks in the sezione: a tick in front of the building at every floor line, with a triangle.
  const s = 0.02 * W;
  const marks = [layout.baseHeight, ...layout.floors.map((f) => f.y1)];
  const levelsAt = (x: number): Seg[] => {
    const segs: Seg[] = [];
    for (const y of marks) {
      const a = front + 0.03 * W;
      segs.push([x, y, a, x, y, front + 0.12 * W]);
      segs.push(...polygon([[x, y, a + s], [x, y + s, a + s * 1.6], [x, y + s, a + s * 0.4]]));
    }
    return segs;
  };
  const levels = lines("overlay-levels", levelsAt(cutX).length);
  levels.write(levelsAt(cutX));

  // Scale bar of the pianta: below the front, at the left, with a tick at both ends and in the middle.
  const bar = [1, 2, 5, 10, 20, 50].filter((n) => n <= W / 4).pop() ?? 1;
  const zb = front + 0.05 * layout.size.depth;
  const tick = 0.012 * layout.size.depth;
  const x0 = -W / 2;
  const planSegs: Seg[] = [[x0, 0, zb, x0 + bar, 0, zb]];
  for (const x of [x0, x0 + bar / 2, x0 + bar]) planSegs.push([x, 0, zb - tick, x, 0, zb + tick]);
  const plan = lines("overlay-plan", planSegs.length);
  plan.write(planSegs);
  // its label, in the ink of the drawing: the length to the right of the bar, standing on the bar's line
  const labelSegs = label(`${bar} m`, x0 + bar + 2 * tick, 0, zb + tick, 2.4 * tick);
  const planLabel = lines("overlay-plan-label", labelSegs.length, FACADE_LINE.ink);
  planLabel.write(labelSegs);
  group.add(perspective.object, section.object, levels.object, plan.object, planLabel.object);

  // The section line and the level marks stand at the cut bay: rewritten in place when it changes.
  let cutDrawn = cutX;
  const fillCut = (x: number): void => {
    if (x === cutDrawn) return;
    cutDrawn = x;
    section.write(sectionAt(x));
    levels.write(levelsAt(x));
  };

  let drawn: { height: number; x: number } | null = null;
  const fillPerspective = (eye: { height: number; x: number }): void => {
    if (drawn && drawn.height === eye.height && drawn.x === eye.x) return;
    drawn = { height: eye.height, x: eye.x };
    const segs: Seg[] = [];
    // Horizon across the front plane at eye height.
    segs.push([-0.65 * W, eye.height, front, 0.65 * W, eye.height, front]);
    // Vanishing point: a cross in a small circle on the view axis, on the front plane.
    const r = 0.02 * W;
    segs.push([eye.x - 1.6 * r, eye.height, front, eye.x + 1.6 * r, eye.height, front], [eye.x, eye.height - 1.6 * r, front, eye.x, eye.height + 1.6 * r, front]);
    const ring: Array<[number, number, number]> = Array.from({ length: RING }, (_, i) => [eye.x + r * Math.cos((i * 2 * Math.PI) / RING), eye.height + r * Math.sin((i * 2 * Math.PI) / RING), front]);
    segs.push(...polygon(ring));
    // Depth lines: from the front points to the eye axis at the back of the building; every one
    // projects on a line through the vanishing point.
    for (const p of starts) segs.push([p[0], p[1], p[2], eye.x, eye.height, -D]);
    perspective.write(segs);
  };

  const weights: Array<[THREE.LineSegments, keyof OverlayWeights]> = [
    [perspective.object, "perspective"],
    [section.object, "sectionLine"],
    [levels.object, "levels"],
    [plan.object, "plan"],
    [planLabel.object, "plan"],
  ];
  return {
    group,
    set(eye, w, x) {
      fillPerspective(eye);
      fillCut(x);
      for (const [o, key] of weights) {
        (o.material as THREE.LineBasicMaterial).opacity = w[key];
        o.visible = w[key] > 0.002;
      }
    },
    dispose() {
      for (const [o] of weights) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
      group.removeFromParent();
    },
  };
}
