// What closes a façade at the top and what mediates between floors: pediments with raking cornices
// and a recessed tympanum, attics, balustrades with turned balusters and pedestals, volutes.
// Geometry in building-local metres; the wall face is z = 0.
import * as THREE from "three";
import { arcPoints, box, merge, profile, runAlongX, slab, sweep, turned } from "../profiles.ts";
import { corniceProfile } from "./bands.ts";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;

/**
 * Pediment over [x0, x1] standing on y0: the horizontal cornice, raking cornices up to the apex (or along
 * a circular arc) and the tympanum between them. `pitch` is the roof slope in degrees; a segmental
 * pediment rises 70% of that, as it should be flatter. `front` moves the cornices out in front of the wall
 * (over a colonnade); the tympanum then runs back to the wall.
 */
export function pediment(shape: "triangular" | "segmental", x0: number, x1: number, y0: number, pitch: number, front = 0): THREE.BufferGeometry {
  const w = x1 - x0;
  const half = w / 2;
  const cx = (x0 + x1) / 2;
  const cs = clamp(0.045 * w, 0.08, 0.4);
  const proj = 1.1 * cs;
  const yb = y0 + cs;
  const rise = half * Math.tan(pitch * RAD) * (shape === "segmental" ? 0.7 : 1);

  let path: THREE.Vector2[];
  if (shape === "triangular") path = [new THREE.Vector2(x0, yb), new THREE.Vector2(cx, yb + rise), new THREE.Vector2(x1, yb)];
  else {
    const R = (half * half + rise * rise) / (2 * rise);
    const theta = Math.asin(Math.min(1, half / R));
    path = arcPoints(cx, yb + rise - R, R, Math.PI / 2 + theta, Math.PI / 2 - theta, 20);
  }
  const tympanum = new THREE.Shape([...path, new THREE.Vector2(x1, yb), new THREE.Vector2(x0, yb)]);
  const cornices = [runAlongX(corniceProfile(cs, proj, y0).points, x0, x1), sweep(corniceProfile(cs, 0.9 * proj).points, path)];
  for (const g of cornices) g.translate(0, 0, front);
  return merge([...cornices, slab(tympanum, -0.1, front + 0.03)]);
}

/** Attic over [x0, x1] standing on y, `h` high: base moulding, panelled body and a crowning cornice. */
export function attic(x0: number, x1: number, y: number, h: number): THREE.BufferGeometry {
  const ch = clamp(0.22 * h, 0.12, 0.45);
  const base = 0.06;
  const parts = [
    runAlongX(profile(y, [["o", 0.07], ["v", base * 0.5], ["ovolo", base * 0.5, 0.1]]).points, x0 - 0.05, x1 + 0.05),
    box(x0, x1, y + base, y + h - ch, -0.4, 0),
    runAlongX(corniceProfile(ch, 1.2 * ch, y + h - ch).points, x0 - 0.1, x1 + 0.1),
  ];
  const n = Math.max(1, Math.round((x1 - x0) / 3.2));
  const bay = (x1 - x0) / n;
  const py0 = y + base + 0.18 * h;
  const py1 = y + h - ch - 0.18 * h;
  if (py1 - py0 > 0.1)
    for (let i = 0; i < n; i++) {
      const s = new THREE.Shape();
      const a = x0 + bay * i + 0.3 * Math.min(1, bay / 2);
      const b = x0 + bay * (i + 1) - 0.3 * Math.min(1, bay / 2);
      s.moveTo(a, py0).lineTo(b, py0).lineTo(b, py1).lineTo(a, py1).closePath();
      parts.push(slab(s, 0, 0.04, 0.01));
    }
  return merge(parts);
}

/** Baluster profile: radius over its widest point and height over its length, both 0..1. */
const BALUSTER: Array<[number, number]> = [
  [0, 0], [0.6, 0], [0.6, 0.05], [0.45, 0.09], [0.5, 0.14], [0.85, 0.26], [1, 0.38], [0.85, 0.52], [0.45, 0.66], [0.4, 0.74], [0.6, 0.8], [0.6, 0.86], [0.45, 0.9], [0.45, 0.97], [0.62, 0.97], [0.62, 1], [0, 1],
];
/** Spacing the balusters aim for between pedestals. */
const BALUSTER_PITCH = 0.3;

/**
 * Balustrade over [x0, x1] standing on y0, `height` high: pedestals at the x of every post, a plinth and
 * a handrail between them, and floor(span / 0.3) turned balusters in every span between two posts.
 * It stands centred on z = `zc` (default behind the wall plane, as on a roof) with the given depth.
 */
export function balustrade(x0: number, x1: number, y0: number, height: number, posts: number[], opts: { zc?: number; depth?: number } = {}): THREE.BufferGeometry {
  const depth = opts.depth ?? 0.4;
  const zc = opts.zc ?? -0.2;
  const z0 = zc - depth / 2;
  const ph = 0.14 * height;
  const rh = 0.13 * height;
  const parts: THREE.BufferGeometry[] = [];
  const plinth = runAlongX(profile(y0, [["o", depth], ["v", 0.6 * ph], ["cyma", 0.4 * ph, 0.9 * depth]]).points, x0, x1);
  plinth.translate(0, 0, z0 + 0.05);
  const rail = runAlongX(profile(y0 + height - rh, [["o", 0.7 * depth], ["v", 0.35 * rh], ["torus", 0.3 * rh, 0.78 * depth], ["v", 0.35 * rh]]).points, x0, x1);
  rail.translate(0, 0, z0 + 0.05 + 0.15 * depth);
  parts.push(plinth, rail);

  const pw = Math.min(0.36, 0.9 * depth);
  const sorted = [...posts].sort((a, b) => a - b);
  for (const px of sorted) {
    parts.push(box(px - pw / 2, px + pw / 2, y0, y0 + height - 0.08 * height, z0, z0 + depth));
    parts.push(box(px - pw / 2 - 0.03, px + pw / 2 + 0.03, y0 + height - 0.08 * height, y0 + height, z0 - 0.03, z0 + depth + 0.03));
  }
  const hb = height - ph - rh;
  const rb = clamp(0.13 * hb, 0.04, 0.1);
  const lathe = BALUSTER.map(([r, y]): [number, number] => [r * rb, y * hb]);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const span = sorted[i + 1]! - sorted[i]!;
    const n = Math.floor(span / BALUSTER_PITCH);
    const free = span - pw;
    if (free < 2 * rb * 1.1) continue;
    for (let k = 0; k < n; k++) parts.push(turned(lathe, 10).translate(sorted[i]! + pw / 2 + (free * (k + 0.5)) / n, y0 + ph, zc));
  }
  return merge(parts);
}

/**
 * The scroll at the foot of a volute, in the façade plane: the centre of its eye and the outline of a
 * flat spiral band that winds clockwise (for `side` = 1) from the top of the roll inwards for 1.75 turns,
 * narrowing as it goes. `radius` is the roll's outer radius.
 */
export function voluteSpiral(side: -1 | 1, x: number, y0: number, width: number, radius: number): { centre: THREE.Vector2; band: THREE.Vector2[] } {
  const centre = new THREE.Vector2(x + side * (width - radius), y0 + radius);
  const turns = 1.75;
  const eye = 0.13 * radius;
  const pitch = (radius - eye) / turns;
  const outer: THREE.Vector2[] = [];
  const inner: THREE.Vector2[] = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = radius + (eye - radius) * t;
    const a = Math.PI / 2 - t * turns * 2 * Math.PI;
    const w = Math.min(0.55 * pitch, 0.85 * r);
    const dir = new THREE.Vector2(side * Math.cos(a), Math.sin(a));
    outer.push(centre.clone().addScaledVector(dir, r));
    inner.push(centre.clone().addScaledVector(dir, r - w));
  }
  return { centre, band: [...outer, ...inner.reverse()] };
}

/**
 * Volute (a scrolled buttress) between a wide floor below and a narrower one above: it stands on y0 with
 * its flat side at x against the upper wall, sweeps `width` outwards (`side` is -1 left, 1 right) and
 * rises `height` along a concave curve that runs into a spiral scroll at its foot (the spiral band
 * stands a little proud of the body, so its edges draw the spiral), with a small disc as the eye.
 */
export function volute(side: -1 | 1, x: number, y0: number, width: number, height: number): THREE.BufferGeometry {
  const radius = Math.min(0.2 * width, 0.3 * height);
  const { centre, band } = voluteSpiral(side, x, y0, width, radius);
  const top = new THREE.Vector2(x + side * 0.02 * width, y0 + height);
  const foot = new THREE.Vector2(centre.x, centre.y + radius);
  const body = new THREE.Shape();
  // the curve comes down to the top of the roll and meets it tangent, heading outwards
  body.moveTo(x, y0).lineTo(centre.x, y0).lineTo(foot.x, foot.y).quadraticCurveTo(top.x + side * 0.3 * width, foot.y, top.x, top.y).lineTo(x, y0 + height).closePath();
  const eye = new THREE.CylinderGeometry(0.1 * radius, 0.1 * radius, 0.48, 12);
  eye.rotateX(Math.PI / 2);
  eye.translate(centre.x, centre.y, 0.095);
  return merge([slab(body, -0.05, 0.3, 0.015), slab(new THREE.Shape(band), -0.05, 0.34, 0.01), eye]);
}

/**
 * Gable end `width` wide centred on x = 0, standing on y0, `pitch` degrees: a plain coping that follows
 * both slopes up to the apex (no horizontal cornice, no tympanum: the wall behind is the gable). The
 * roof prism behind it is a solid of the model (basic.ts).
 */
export function gable(width: number, y0: number, pitch: number): THREE.BufferGeometry {
  const half = width / 2;
  const cs = clamp(0.012 * width, 0.05, 0.12);
  const path = [new THREE.Vector2(-half, y0), new THREE.Vector2(0, y0 + half * Math.tan(pitch * RAD)), new THREE.Vector2(half, y0)];
  return sweep(profile(0, [["o", 0.5 * cs], ["v", 0.5 * cs], ["ovolo", 0.5 * cs, 1.4 * cs], ["v", 0.5 * cs]]).points, path);
}
