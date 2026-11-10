// Horizontal bands: the string course and the entablature (architrave with fasciae, frieze, cornice
// plain / dentils / modillions). Every function returns one geometry in building-local metres,
// centred on x = 0 (floors are), the moulding's back on the wall face z = 0.
import * as THREE from "three";
import { box, merge, profile, runAlongX, type ProfileStep } from "../profiles.ts";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The steps of a cornice `ch` high projecting `proj`: fascia, cove, corona with its soffit, cyma and
 * fillet. `fromCorona` leaves out fascia and cove (the modillions carry the corona instead).
 */
export function corniceSteps(ch: number, proj: number, fromCorona = false): ProfileStep[] {
  const crown: ProfileStep[] = [
    ["o", 0.82 * proj],
    ["v", 0.34 * ch],
    ["cyma", 0.2 * ch, proj],
    ["v", 0.16 * ch],
  ];
  return fromCorona ? crown : [["o", 0.2 * proj], ["v", 0.15 * ch], ["cavetto", 0.15 * ch, 0.42 * proj], ...crown];
}

/** A whole cornice as a closed profile starting at y0. */
export function corniceProfile(ch: number, proj: number, y0 = 0) {
  return profile(y0, corniceSteps(ch, proj));
}

/** String course: a plain band with a rounded, projecting top, `height` high from `y0`. */
export function stringCourse(width: number, height: number, y0: number): THREE.BufferGeometry {
  const h = height;
  const p = profile(y0, [["o", 0.3 * h], ["v", 0.28 * h], ["ovolo", 0.32 * h, 0.55 * h], ["v", 0.4 * h]]);
  return runAlongX(p.points, -width / 2 - 0.1, width / 2 + 0.1);
}

/** Share of an entablature the architrave takes, and the frieze of a plain one (the cornice has the rest). */
const ARCHITRAVE = 0.27;
const FRIEZE_PLAIN = 0.31;

/** Where the frieze of a plain entablature lies: its bottom and top y and the projection of its face. */
export function friezeBand(height: number, y0: number, frieze = FRIEZE_PLAIN): { y0: number; y1: number; out: number } {
  return { y0: y0 + ARCHITRAVE * height, y1: y0 + (ARCHITRAVE + frieze) * height, out: 0.025 * height };
}

/** Dentil pitch for an entablature `h` high: coarse enough to read, never wider than 0.4 m. */
export const dentilPitch = (h: number): number => clamp(0.2 * h, 0.12, 0.38);
/**
 * How many blocks of about `pitch` fit between the 0.1 m margins of a band `width` wide, and their exact
 * pitch. A band 0.5 m wide or more gets at least max(1, floor(width / 0.4)) blocks (so dentils stay at
 * least that dense); a narrower one gets none (under 0.3 m of free length after the margins).
 */
function repeats(width: number, pitch: number): [number, number] {
  const usable = width - 0.2;
  if (usable < 0.3) return [0, pitch];
  const n = Math.max(1, Math.floor(width / 0.4), Math.floor(usable / pitch));
  return [n, usable / n];
}
const modillionPitch = (h: number): number => clamp(0.3 * h, 0.2, 0.5);

/**
 * Entablature `height` high from `y0` over `width`: architrave (three fasciae and a crown moulding),
 * frieze and cornice. `front` pushes the moulding out in front of the wall (a colonnade carries it),
 * with its back reaching `opts.into` metres behind the wall face (default 0, the wall face): the
 * moulding and what fills the space to the wall are ONE closed solid. `opts.frieze` is the share of the
 * height the frieze takes in a plain entablature (default 0.31; the cornice gives way): a taller frieze for triglyphs.
 */
export function entablature(width: number, height: number, cornice: "plain" | "dentils" | "modillions", y0: number, front = 0, opts: { frieze?: number; into?: number } = {}): THREE.BufferGeometry {
  const h = height;
  const back = front > 0 ? front + (opts.into ?? 0) : 0.05;
  const P = 0.85 * h;
  const run = [-width / 2 - 0.05 * h, width / 2 + 0.05 * h] as const;
  const architrave: ProfileStep[] = [["o", 0.03 * h], ["v", 0.07 * h], ["o", 0.055 * h], ["v", 0.08 * h], ["o", 0.075 * h], ["v", 0.07 * h], ["cyma", 0.05 * h, 0.095 * h]];
  const frieze = (fh: number): ProfileStep[] => [["o", 0.025 * h], ["v", fh * h]];
  const parts: THREE.BufferGeometry[] = [];

  if (cornice === "plain") {
    const fr = opts.frieze ?? FRIEZE_PLAIN;
    parts.push(runAlongX(profile(y0, [...architrave, ...frieze(fr), ...corniceSteps((FRIEZE_PLAIN + 0.42 - fr) * h, P)], back).points, ...run));
  } else if (cornice === "dentils") {
    const bandY = y0 + (0.27 + 0.28 + 0.04) * h;
    const steps: ProfileStep[] = [...architrave, ...frieze(0.28), ["ovolo", 0.04 * h, 0.07 * h], ["o", 0.065 * h], ["v", 0.08 * h], ...corniceSteps(0.33 * h, P)];
    parts.push(runAlongX(profile(y0, steps, back).points, ...run));
    const [n, pitch] = repeats(width, dentilPitch(h));
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + 0.1 + pitch * (i + 0.5);
      parts.push(box(x - 0.25 * pitch, x + 0.25 * pitch, bandY, bandY + 0.08 * h, 0.065 * h - 0.005, 0.14 * h));
    }
  } else {
    const zoneY = y0 + (0.27 + 0.28) * h;
    const steps: ProfileStep[] = [...architrave, ...frieze(0.28), ["o", 0.04 * h], ["v", 0.11 * h], ...corniceSteps(0.486 * h, P, true)];
    parts.push(runAlongX(profile(y0, steps, back).points, ...run));
    // brackets under the corona: a block with a curved underside
    const a = 0.03 * h;
    const b = 0.82 * P;
    const z = 0.11 * h;
    const bracket: Array<[number, number]> = [[a, zoneY + z], [b, zoneY + z], [b, zoneY + 0.75 * z], [a + 0.7 * (b - a), zoneY + 0.2 * z], [a + 0.35 * (b - a), zoneY], [a, zoneY]];
    const [n, pitch] = repeats(width, modillionPitch(h));
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + 0.1 + pitch * (i + 0.5);
      parts.push(runAlongX(bracket, x - 0.2 * pitch, x + 0.2 * pitch));
    }
  }
  if (front > 0) for (const g of parts) g.translate(0, 0, front);
  return merge(parts);
}
