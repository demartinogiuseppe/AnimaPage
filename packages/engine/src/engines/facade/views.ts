// The five views of the façade theatre as pure camera functions of the building's bounds: prospetto,
// sezione and pianta (orthographic-like, a 6° lens from far away; the pianta looks straight down, the
// front of the building at the bottom of the frame), assonometria, and the one-point perspective with
// a lens shift (a low horizon without tilting the camera, so verticals stay vertical). All lengths are in
// root units.
import * as THREE from "three";
import type { FacadeViewKey, FacadeViewName } from "@pv/scene-spec";
import type { EngineView } from "../../types.ts";
import { ease, seg } from "../../util/math.ts";

/** Lens of the orthographic-like views: narrow enough to read as parallel projection. */
const FLAT_FOV = 6;
const DEG = Math.PI / 180;
/** The perspective lens never goes wider than this; the camera backs off instead. */
const MAX_FOV = 120;
/** The vanishing point must stay well inside the frame. */
const MAX_SHIFT = 0.35;
/** Duration of the blend between two view keys, seconds (same as the camera keys). */
export const VIEW_BLEND = 1.8;

/** Bounds of the building: `front` is the nearest z (avant-corps, free-standing columns), `depth` runs back from it. */
export interface FacadeFrame {
  center: THREE.Vector3;
  width: number;
  height: number;
  depth: number;
  front: number;
}

/** The eye of the perspective view. */
export interface Eye {
  height: number;
  x: number;
  /** Distance from the front plane. */
  distance: number;
}

const halfTan = (fov: number): number => Math.tan((fov * DEG) / 2);

/** Camera on the direction `dir` from `target`, `visibleH` tall at the target plane. */
function aimed(target: THREE.Vector3, dir: THREE.Vector3, visibleH: number, fov: number, shiftY = 0): EngineView {
  const d = visibleH / (2 * halfTan(fov));
  return { position: target.clone().addScaledVector(dir, d), target: target.clone(), fov, shiftY };
}

/** Half extents of the frame's box along the camera's right and up axes when looking along `-dir`. */
function halfExtents(f: FacadeFrame, dir: THREE.Vector3): { x: number; y: number } {
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  let x = 0;
  let y = 0;
  const c = new THREE.Vector3();
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        c.set((sx * f.width) / 2, (sy * f.height) / 2, (sz * f.depth) / 2);
        x = Math.max(x, Math.abs(c.dot(right)));
        y = Math.max(y, Math.abs(c.dot(up)));
      }
  return { x, y };
}

/** Visible height at the target plane that fits half extents `hx`, `hy` (already with margins) at `aspect`. */
const fit = (hx: number, hy: number, aspect: number): number => 2 * Math.max(hy, hx / aspect);

function perspective(f: FacadeFrame, eye: Eye, aspect: number): EngineView {
  // The part of the front plane that must be in frame: the façade with 15 % margin, and the eye axis.
  const lo = Math.min(-0.075 * f.height, eye.height);
  const hi = Math.max(1.075 * f.height, eye.height);
  const half = 0.575 * f.width;
  const halfW = Math.max(Math.abs(f.center.x - half - eye.x), Math.abs(f.center.x + half - eye.x));
  // The lens is centred on the eye horizontally; vertically the shift moves the horizon down the frame.
  const visH0 = Math.max(hi - lo, (2 * halfW) / aspect);
  const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, ((lo + hi) / 2 - eye.height) / visH0));
  const visH = Math.max(visH0, (eye.height - lo) / (0.5 - shift), (hi - eye.height) / (0.5 + shift));
  const distance = Math.max(eye.distance, visH / (2 * halfTan(MAX_FOV)));
  const fov = (2 * Math.atan(visH / (2 * distance))) / DEG;
  const target = new THREE.Vector3(eye.x, eye.height, f.front);
  return { position: new THREE.Vector3(eye.x, eye.height, f.front + distance), target, fov, shiftY: shift };
}

/** The camera of one view. `sectionX` is the x of the cut plane (sezione looks at it), `planY` the height of the plan cut (pianta looks at it). */
export function viewOf(name: FacadeViewName, f: FacadeFrame, eye: Eye, aspect: number, sectionX: number, planY = 0): EngineView {
  switch (name) {
    case "prospetto":
      // Frontal, fitted on the front plane (the nearest, so the largest).
      return aimed(new THREE.Vector3(f.center.x, f.center.y, f.front), new THREE.Vector3(0, 0, 1), fit(0.575 * f.width, 0.575 * f.height, aspect), FLAT_FOV);
    case "assonometria": {
      const az = -35 * DEG;
      const el = 30 * DEG;
      const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      const h = halfExtents(f, dir);
      return aimed(f.center, dir, fit(1.15 * h.x, 1.15 * h.y, aspect), FLAT_FOV);
    }
    case "prospettiva":
      return perspective(f, eye, aspect);
    case "sezione": {
      // From +x: the screen shows depth (horizontal) and height (vertical).
      const target = new THREE.Vector3(sectionX, f.center.y, f.center.z);
      return aimed(target, new THREE.Vector3(1, 0, 0), fit(0.6 * f.depth, 0.575 * f.height, aspect), FLAT_FOV);
    }
    case "pianta":
      // From straight above: the screen shows width (horizontal) and depth (vertical, the front at the bottom).
      return aimed(new THREE.Vector3(f.center.x, planY, f.center.z), new THREE.Vector3(0, 1, 0), fit(0.575 * f.width, 0.575 * f.depth, aspect), FLAT_FOV);
  }
}

/**
 * Dolly zoom between two views: the visible height at the target plane goes linearly from one to the
 * other, the lens too, and the distance follows (so the target plane keeps its size while the
 * perspective grows). Targets lerp, directions slerp, the lens shift is linear.
 */
export function blendViews(a: EngineView, b: EngineView, p: number): EngineView {
  const visible = (v: EngineView): number => 2 * v.position.distanceTo(v.target) * halfTan(v.fov);
  const h = visible(a) + (visible(b) - visible(a)) * p;
  const fov = a.fov + (b.fov - a.fov) * p;
  const da = a.position.clone().sub(a.target).normalize();
  const db = b.position.clone().sub(b.target).normalize();
  const target = a.target.clone().lerp(b.target, p);
  const shiftY = a.shiftY + (b.shiftY - a.shiftY) * p;
  // Straight down has no azimuth, and a camera looking along the vertical turns its screen about it: towards or
  // away from the plan the direction moves by azimuth and elevation, so the screen turns smoothly and ends with the front at the bottom.
  const vertical = (v: THREE.Vector3): boolean => Math.abs(v.y) > 1 - 1e-9;
  if (vertical(da) || vertical(db)) {
    const azimuth = (v: THREE.Vector3): number => (vertical(v) ? 0 : Math.atan2(v.x, v.z));
    const elevation = (v: THREE.Vector3): number => Math.asin(Math.max(-1, Math.min(1, v.y)));
    const a0 = azimuth(da);
    const az = a0 + (((azimuth(db) - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * p;
    const el = elevation(da) + (elevation(db) - elevation(da)) * p;
    const dir = p >= 1 ? db : new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    return aimed(target, dir, h, fov, shiftY);
  }
  const q = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(da, db), p);
  return aimed(target, da.applyQuaternion(q), h, fov, shiftY);
}

/**
 * Resolves view keys at time t. A virtual assonometria key at 0 holds before the first key. Recursive
 * like the camera keys, so overlapping blends stay continuous. `mix` blends two states by p in 0..1.
 */
export function resolveKeys<T>(keys: readonly FacadeViewKey[], t: number, state: (view: FacadeViewName) => T, mix: (a: T, b: T, p: number) => T): T {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  const list: FacadeViewKey[] = sorted[0]!.at <= 0 ? sorted : [{ at: 0, view: "assonometria" }, ...sorted];
  let k = 0;
  list.forEach((key, i) => {
    if (key.at <= t) k = i;
  });
  const at = (i: number, time: number): T => {
    const key = list[i]!;
    const to = state(key.view);
    if (i === 0) return to;
    const p = ease.inOutCubic(seg(time, key.at, key.at + (key.dur ?? VIEW_BLEND)));
    return p >= 1 ? to : mix(at(i - 1, key.at), to, p);
  };
  return at(k, t);
}
