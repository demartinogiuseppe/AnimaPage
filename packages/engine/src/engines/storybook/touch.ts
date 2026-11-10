// Touch in a storybook: the curves of the transient reactions (a squash-and-stretch bounce when a
// character is tapped, a gentle wobble for "not this one") and the generous hit test. All of it is
// applied on top of the base state that update() writes every frame, never stored in it.
import * as THREE from "three";

export const BOUNCE_SECONDS = 0.35;
export const WOBBLE_SECONDS = 0.5;
/** The largest scale factor a bounce ever reaches (stretch on y, bulge on x/z). */
export const BOUNCE_PEAK = 1.25;
/** The same character sounds at most once in this many milliseconds (a bounce without sound in between). */
export const SOUND_GAP_MS = 300;
/** A small finger: the hit sphere is the character's bounding sphere grown by this, and never smaller than the minimum. */
const HIT_GROW = 1.2;
const HIT_MIN_RADIUS = 0.8;
/** Peak roll of the wobble, radians (about 10 degrees). */
const WOBBLE_ANGLE = 0.18;

export interface Squash {
  sx: number;
  sy: number;
}

/** Writes the bounce factors `age` seconds after the tap into `out`: 1 before and after, a damped wave in between. */
export function bounceAt(age: number, out: Squash): Squash {
  if (!(age > 0) || age >= BOUNCE_SECONDS) {
    out.sx = 1;
    out.sy = 1;
    return out;
  }
  const u = age / BOUNCE_SECONDS;
  const sy = 1 + (BOUNCE_PEAK - 1) * (1 - u) * Math.sin(u * Math.PI * 2.5);
  out.sy = sy;
  out.sx = 1 / Math.sqrt(sy);
  return out;
}

/** Roll angle of the wobble `age` seconds after it began: 0 before and after. */
export function wobbleAt(age: number): number {
  if (!(age > 0) || age >= WOBBLE_SECONDS) return 0;
  const u = age / WOBBLE_SECONDS;
  return WOBBLE_ANGLE * (1 - u) * Math.sin(u * Math.PI * 4);
}

/** Radius of the sphere a tap may hit, for a character whose unscaled bounding box has the given diagonal. */
export function hitRadius(diagonal: number, scale: number): number {
  return Math.max(HIT_MIN_RADIUS, 0.5 * diagonal * scale * HIT_GROW);
}

const tmp = new THREE.Vector3();
const sphere = new THREE.Sphere();

/** Distance along the ray to the sphere, or null when the ray misses it. */
export function hitDistance(ray: THREE.Ray, centre: THREE.Vector3, radius: number): number | null {
  sphere.center.copy(centre);
  sphere.radius = radius;
  const p = ray.intersectSphere(sphere, tmp);
  return p ? p.distanceTo(ray.origin) : null;
}
