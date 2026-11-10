// AR placement (docs/m5/ar.md): pure maths that puts the pop-up book on a real table.
//
// The whole `Stage.world` group (book + engine content) is placed: engine content is never
// rescaled on its own, so camera keys, labels and engine units stay valid inside the group.
import * as THREE from "three";
import { clamp } from "../../util/math.ts";

/** Book width (covers included) right after the first tap, in metres. */
export const AR_BOOK_WIDTH_M = 0.35;
/** Pinch limits for the book width, in metres. */
export const AR_WIDTH_RANGE: readonly [number, number] = [0.12, 1.2];

/** Where the book stands on the table and how big it is. */
export interface ArTransform {
  /** Table point under the book centre (spine), XR reference space, metres. */
  position: THREE.Vector3;
  /** Rotation about the table's up axis (+y), radians. 0 = reader side (+z) towards +z. */
  yaw: number;
  /** Book width (covers included), metres. */
  width: number;
}

/** World-group units per metre for a book of `bookWidthUnits` shown `widthM` wide. */
export function arScale(bookWidthUnits: number, widthM: number): number {
  return widthM / Math.max(bookWidthUnits, 1e-6);
}

/** Yaw that turns the reader's side of the book (+z) towards the viewer, on the table plane. */
export function faceViewer(table: THREE.Vector3, viewer: THREE.Vector3): number {
  const dx = viewer.x - table.x;
  const dz = viewer.z - table.z;
  if (dx * dx + dz * dz < 1e-10) return 0;
  return Math.atan2(dx, dz);
}

/** Width clamped to the pinch limits. */
export function clampWidth(w: number, range: readonly [number, number] = AR_WIDTH_RANGE): number {
  return clamp(w, range[0], range[1]);
}

/**
 * World-group pose for an AR transform. `base` is the point of the world group (its local units)
 * that must touch the table: the bottom of the covers under the spine.
 */
export function worldPose(
  t: ArTransform,
  base: THREE.Vector3,
  bookWidthUnits: number,
  out: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 },
): void {
  const s = arScale(bookWidthUnits, t.width);
  out.scale.setScalar(s);
  out.quaternion.setFromAxisAngle(UP, t.yaw);
  out.position.copy(base).multiplyScalar(s).applyQuaternion(out.quaternion).negate().add(t.position);
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpUp = new THREE.Vector3();

/** True when a hit-test pose lies on a horizontal, upward-facing surface (a table, the floor). */
export function isHorizontal(q: { x: number; y: number; z: number; w: number }, minCos = Math.cos((25 * Math.PI) / 180)): boolean {
  tmpUp.set(0, 1, 0).applyQuaternion(q as THREE.Quaternion);
  return tmpUp.y >= minCos;
}
