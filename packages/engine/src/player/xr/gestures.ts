// AR touch gestures (docs/m5/ar.md): pure maths, no DOM, no WebXR.
// One finger drags the book along the table plane; two fingers pinch (scale) and twist (rotate).
import * as THREE from "three";
import { clampWidth, type ArTransform } from "./placement.ts";

export interface Pt {
  x: number;
  y: number;
}

/** Movement under this many CSS pixels still counts as a tap. */
export const TAP_SLOP_PX = 10;
/** Longer touches are not taps. */
export const TAP_MAX_MS = 500;

/** Angle wrapped to (-π, π]. */
export function wrapAngle(a: number): number {
  const r = a % (2 * Math.PI);
  if (r > Math.PI) return r - 2 * Math.PI;
  if (r <= -Math.PI) return r + 2 * Math.PI;
  return r;
}

/**
 * Two-finger gesture from its start positions (a0, b0) to the current ones (a1, b1), screen pixels
 * (y down). `twist` is the clockwise on-screen rotation, radians.
 */
export function pinchTwist(a0: Pt, b0: Pt, a1: Pt, b1: Pt): { scale: number; twist: number } {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const scale = d0 < 1 ? 1 : d1 / d0;
  const twist = wrapAngle(Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x));
  return { scale, twist };
}

/**
 * Transform after a pinch/twist that started at `start`. Seen from above, a clockwise twist on
 * screen turns the book clockwise, i.e. a negative rotation about +y. The width is clamped.
 */
export function applyPinchTwist(start: ArTransform, g: { scale: number; twist: number }, out: ArTransform): ArTransform {
  out.position.copy(start.position);
  out.width = clampWidth(start.width * g.scale);
  out.yaw = wrapAngle(start.yaw - g.twist);
  return out;
}

/** Intersection of a ray with the horizontal plane y = planeY; null when parallel or behind. */
export function rayPlaneY(origin: THREE.Vector3, dir: THREE.Vector3, planeY: number, out: THREE.Vector3): THREE.Vector3 | null {
  if (Math.abs(dir.y) < 1e-6) return null;
  const k = (planeY - origin.y) / dir.y;
  if (k <= 0) return null;
  return out.copy(dir).multiplyScalar(k).add(origin);
}

/** Screen pixels -> normalised device coordinates. */
export function toNdc(p: Pt, width: number, height: number, out: THREE.Vector2): THREE.Vector2 {
  return out.set((p.x / Math.max(width, 1)) * 2 - 1, -(p.y / Math.max(height, 1)) * 2 + 1);
}

/** True while a single touch is still a tap. */
export function isTap(start: Pt, end: Pt, ms: number): boolean {
  return ms <= TAP_MAX_MS && Math.hypot(end.x - start.x, end.y - start.y) <= TAP_SLOP_PX;
}
