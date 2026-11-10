// Free movement in the 3D stage (keyboard, on-screen pad): pure math, no DOM, no three.js controls.
import * as THREE from "three";

export interface MoveInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export const NO_MOVE: Readonly<MoveInput> = { forward: false, back: false, left: false, right: false, up: false, down: false };

export const anyMove = (m: MoveInput) => m.forward || m.back || m.left || m.right || m.up || m.down;

/** Speed in world units per second, per unit of camera-target distance (closer = finer moves). */
export const MOVE_SPEED = 0.5;
/** Velocity smoothing rate, 1/s. */
const DAMPING = 9;

/**
 * Desired velocity for the pressed keys: forward/back and left/right on the horizontal plane, relative
 * to where the camera looks (camera -> target); up/down along world y. Speed grows with the distance.
 */
export function moveVelocity(input: MoveInput, camera: THREE.Vector3, target: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  out.set(0, 0, 0);
  const view = target.clone().sub(camera);
  const dist = view.length();
  if (dist < 1e-9) return out;
  const fwd = new THREE.Vector3(view.x, 0, view.z);
  // Looking straight down: "forward" is the screen's up, i.e. the camera's world up projected.
  if (fwd.lengthSq() < 1e-12) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // fwd × up
  if (input.forward) out.add(fwd);
  if (input.back) out.sub(fwd);
  if (input.right) out.add(right);
  if (input.left) out.sub(right);
  if (input.up) out.y += 1;
  if (input.down) out.y -= 1;
  if (out.lengthSq() > 0) out.normalize().multiplyScalar(MOVE_SPEED * dist);
  return out;
}

/** Exponential approach of the current velocity to the desired one (smooth start and stop). */
export function dampVelocity(current: THREE.Vector3, desired: THREE.Vector3, dt: number): THREE.Vector3 {
  return current.lerp(desired, 1 - Math.exp(-DAMPING * Math.max(0, dt)));
}

export interface BookBounds {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** World y of the page surface. */
  pageY: number;
  /** Page width (unit for margins and heights). */
  size: number;
}

/** Where the camera target may go: the book's box plus a soft margin, from just under the page to above the content. */
export function targetLimits(b: BookBounds, contentHeight: number): { min: THREE.Vector3; max: THREE.Vector3 } {
  const m = b.size * 0.15;
  return {
    min: new THREE.Vector3(b.min.x - m, b.pageY - b.size * 0.05, b.min.z - m),
    max: new THREE.Vector3(b.max.x + m, b.pageY + Math.max(contentHeight, b.size) * 1.2, b.max.z + m),
  };
}

/**
 * Correction that brings the target back inside the limits, softly (a fraction per frame), so a pan past
 * the edge springs back instead of stopping dead. Apply the same vector to the camera.
 */
export function softClamp(target: THREE.Vector3, lim: { min: THREE.Vector3; max: THREE.Vector3 }, dt: number, out = new THREE.Vector3()): THREE.Vector3 {
  const inside = target.clone().clamp(lim.min, lim.max);
  return out.copy(inside).sub(target).multiplyScalar(1 - Math.exp(-8 * Math.max(0, dt)));
}

/** Lowest camera height: a little above the page, never under the table. */
export function minCameraY(b: BookBounds): number {
  return b.pageY + b.size * 0.03;
}
