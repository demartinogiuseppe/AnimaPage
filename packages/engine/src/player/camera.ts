// Automatic camera as a pure function of chapter time (fixes the prototypes' history-dependent flyTo).
import * as THREE from "three";
import type { Anchor, CameraKey } from "@pv/scene-spec";
import type { Engine, EngineView } from "../types.ts";
import { ease, lerp, seg } from "../util/math.ts";

/** Duration of the blend from key k-1 to key k, starting at key k's `at`. */
export const CAMERA_BLEND = 1.8;
/** Stages narrower than this get the camera pulled back. */
export const NARROW_STAGE_PX = 520;
export const NARROW_DISTANCE_SCALE = 1.3;

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Resolves an anchor to world coordinates at the current (chapter, t). */
export type AnchorResolver = (anchor: Anchor, out: THREE.Vector3) => boolean;

interface Orbit {
  target: THREE.Vector3;
  distance: number;
  azimuth: number; // radians
  elevation: number; // radians
}

const DEG = Math.PI / 180;

function keyOrbit(k: CameraKey, resolve: AnchorResolver): Orbit {
  const target = new THREE.Vector3();
  if (!resolve(k.target, target)) target.set(0, 0, 0);
  return { target, distance: k.distance, azimuth: k.azimuth * DEG, elevation: k.elevation * DEG };
}

/** Shortest-way angle interpolation. */
function lerpAngle(a: number, b: number, p: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * p;
}

function blend(a: Orbit, b: Orbit, p: number): Orbit {
  return {
    target: a.target.clone().lerp(b.target, p),
    distance: lerp(a.distance, b.distance, p),
    azimuth: lerpAngle(a.azimuth, b.azimuth, p),
    elevation: lerp(a.elevation, b.elevation, p),
  };
}

/** Orbit of segment k (active from keys[k].at) evaluated at time t. Recursive so overlapping blends stay continuous. */
function segmentOrbit(keys: readonly CameraKey[], k: number, t: number, resolve: AnchorResolver): Orbit {
  const key = keys[k]!;
  const to = keyOrbit(key, resolve);
  if (k === 0) return to;
  const p = ease.inOutCubic(seg(t, key.at, key.at + CAMERA_BLEND));
  if (p >= 1) return to;
  return blend(segmentOrbit(keys, k - 1, key.at, resolve), to, p);
}

export function orbitToPose(o: Orbit, distanceScale = 1): CameraPose {
  const d = o.distance * distanceScale;
  const ce = Math.cos(o.elevation);
  const position = new THREE.Vector3(
    o.target.x + d * ce * Math.sin(o.azimuth),
    o.target.y + d * Math.sin(o.elevation),
    o.target.z + d * ce * Math.cos(o.azimuth),
  );
  return { position, target: o.target.clone() };
}

/**
 * Camera pose at chapter time t. Pure: same (keys, t, anchor positions) -> same pose.
 * Anchors are resolved at the current t through `resolve`. Returns null when there are no keys.
 */
export function cameraAt(
  keys: readonly CameraKey[],
  t: number,
  resolve: AnchorResolver,
  distanceScale = 1,
): CameraPose | null {
  if (keys.length === 0) return null;
  let k = 0;
  keys.forEach((key, i) => {
    if (key.at <= t) k = i;
  });
  return orbitToPose(segmentOrbit(keys, k, t, resolve), distanceScale);
}

/** Default framing when a chapter has no camera keys: look at the content's bounding sphere from the south, 35° up. */
export function defaultPose(center: THREE.Vector3, radius: number, distanceScale = 1): CameraPose {
  return orbitToPose(
    { target: center.clone(), distance: Math.max(radius, 0.5) * 2.4, azimuth: 0, elevation: 35 * DEG },
    distanceScale,
  );
}

/** Interpolates two poses (used for the short player-level tweens: chapter entry, "Centra"). */
export function mixPose(a: CameraPose, b: CameraPose, p: number): CameraPose {
  return { position: a.position.clone().lerp(b.position, p), target: a.target.clone().lerp(b.target, p) };
}

/** An engine view in world space: the pose plus the lens (see Engine.view). */
export type EngineViewPose = CameraPose & { fov: number; shiftY: number };

/** Moves a root-local engine view into world space with the root's world matrix. */
export function engineViewPose(v: EngineView, world: THREE.Matrix4): EngineViewPose {
  return { position: v.position.clone().applyMatrix4(world), target: v.target.clone().applyMatrix4(world), fov: v.fov, shiftY: v.shiftY };
}

/**
 * The `y` argument of `camera.setViewOffset(fullW, fullH, x, y, w, h)` for a camera framed on the free
 * rectangle (top edge `frameY`, height `frameH`, in px) with a vertical lens shift: the point on the view
 * axis then sits `shiftY` x `frameH` below the centre of the frame. shiftY 0 gives `-frameY`.
 */
export function viewOffsetY(frameY: number, frameH: number, shiftY: number): number {
  return -frameY - shiftY * frameH;
}

/** Field of view and vertical lens shift of the camera. */
export interface Lens {
  fov: number;
  shiftY: number;
}

/** The engine's own view for the camera, or null: no hook, the hook declines, or an XR session owns the camera. */
export function engineViewFor(engine: Pick<Engine, "view">, presenting: boolean, chapterId: string, t: number, aspect: number): EngineView | null {
  if (presenting) return null;
  return engine.view?.(chapterId, t, aspect) ?? null;
}

/** The lens to aim for: the presentation's own (`baseFov`, no shift) or the engine view's, eased in by `join` (book overview 0..1). */
export function targetLens(baseFov: number, view: Lens | null, join: number): Lens {
  if (!view) return { fov: baseFov, shiftY: 0 };
  return { fov: baseFov + (view.fov - baseFov) * join, shiftY: view.shiftY * join };
}

/** The lens now: `from` -> `to` by p; while the user orbits or an XR session presents, `current` stays. */
export function lensAt(from: Lens, to: Lens, p: number, hold: boolean, current: Lens): Lens {
  if (hold) return current;
  return { fov: from.fov + (to.fov - from.fov) * p, shiftY: from.shiftY + (to.shiftY - from.shiftY) * p };
}

/** Distance multiplier of a pose: engine views are final, the others get the Accademico multiplier. */
export function poseZoom(fromEngineView: boolean, zoom: number): number {
  return fromEngineView ? 1 : zoom;
}
