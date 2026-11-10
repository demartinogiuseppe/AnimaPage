// Pure astronomy for the `sky` engine: where the Sun, planets and Moon are at a date. No three.js.
//
// Sources (verified 2026-11-04):
// - Planets: E.M. Standish, "Keplerian Elements for Approximate Positions of the Major Planets",
//   JPL Solar System Dynamics, https://ssd.jpl.nasa.gov/planets/approx_pos.html - Table 1 (valid
//   1800-2050) and its algorithm (Kepler's equation, rotation to the J2000 ecliptic), obliquity 23.43928°.
// - Moon: mean arguments and the largest periodic terms of Meeus, "Astronomical Algorithms" ch. 47,
//   as implemented in PyMeeus (https://pymeeus.readthedocs.io/en/latest/_modules/pymeeus/Moon.html);
//   cross-checked with en.wikipedia "Lunar theory" (named inequalities) and "Lunar distance" (ELP2000 distance terms).
// - Earth rotation: Earth Rotation Angle, en.wikipedia "Sidereal time" (IERS linear relation to UT1).
// Simplifications: UTC is used for TT/UT1 (about a minute off), the Earth/Moon barycentre stands for
// the Earth, ERA stands for sidereal time (under half a degree off in 1800-2050). Good to a fraction
// of a degree for planets and about half a degree for the Moon: enough to draw, not to navigate.
import { displayLocale, engineText, isItalian } from "@pv/scene-spec/i18n";

export type Vec3 = [number, number, number];

export const DEG = Math.PI / 180;
export const J2000 = 2451545.0;
const DAY_MS = 86_400_000;
/** Obliquity of the ecliptic at J2000 (JPL page above). */
export const OBLIQUITY = 23.43928;
/** Mean inclination of the Moon's orbit to the ecliptic (en.wikipedia "Orbit of the Moon"). */
export const MOON_INCLINATION = 5.145;

export type Planet = "mercury" | "venus" | "earth" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune";

/** JPL Table 1: [a (au), e, I, L, long.peri, long.node] and their rates per Julian century. "earth" = EM barycentre. */
const TABLE1: Record<Planet, readonly [readonly number[], readonly number[]]> = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};
export const PLANETS = Object.keys(TABLE1) as Planet[];

/** Julian day from Unix milliseconds (UTC). */
export const julianDay = (ms: number) => ms / DAY_MS + 2440587.5;
/** Julian centuries since J2000. */
const centuries = (jd: number) => (jd - J2000) / 36525;
/** Angle in degrees reduced to [0, 360). */
export const norm360 = (a: number) => ((a % 360) + 360) % 360;
/** Angle in degrees reduced to [-180, 180). */
export const norm180 = (a: number) => norm360(a + 180) - 180;

interface Elements {
  a: number;
  e: number;
  /** Radians. */
  I: number;
  node: number;
  argPeri: number;
  /** Mean anomaly, radians in [-π, π). */
  M: number;
}

function elements(p: Planet, jd: number): Elements {
  const T = centuries(jd);
  const [el, rate] = TABLE1[p];
  const v = el.map((x, i) => x + rate[i]! * T);
  const [a, e, I, L, peri, node] = v as [number, number, number, number, number, number];
  return { a, e, I: I * DEG, node: node * DEG, argPeri: (peri - node) * DEG, M: norm180(L - peri) * DEG };
}

/** Eccentric anomaly from mean anomaly (radians), Newton iterations as in the JPL note. */
export function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

function toEcliptic(el: Elements, E: number): Vec3 {
  const xp = el.a * (Math.cos(E) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const cw = Math.cos(el.argPeri), sw = Math.sin(el.argPeri);
  const cO = Math.cos(el.node), sO = Math.sin(el.node);
  const cI = Math.cos(el.I), sI = Math.sin(el.I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Heliocentric ecliptic J2000 position in au. */
export function planetPosition(p: Planet, jd: number): Vec3 {
  const el = elements(p, jd);
  return toEcliptic(el, solveKepler(el.M, el.e));
}

/** `n` points around the orbit (ecliptic, au), from the elements at `jd`. */
export function orbitPath(p: Planet, jd: number, n = 180): Vec3[] {
  const el = elements(p, jd);
  return Array.from({ length: n }, (_, i) => toEcliptic(el, (i / n) * 2 * Math.PI));
}

/** Farthest distance from the Sun (aphelion), au. */
export function aphelion(p: Planet): number {
  const [el] = TABLE1[p];
  return el[0]! * (1 + el[1]!);
}

/** Geocentric ecliptic longitude of the Sun, degrees. */
export function sunLongitude(jd: number): number {
  const [x, y] = planetPosition("earth", jd);
  return norm360(Math.atan2(-y, -x) / DEG);
}

/** Declination of the Sun (latitude where it is overhead at noon) for an axial tilt, degrees. */
export function sunDeclination(jd: number, tilt = OBLIQUITY): number {
  return Math.asin(Math.sin(tilt * DEG) * Math.sin(sunLongitude(jd) * DEG)) / DEG;
}

export interface MoonState {
  /** Geocentric ecliptic longitude and latitude, degrees. */
  lon: number;
  lat: number;
  /** Earth-Moon distance, km. */
  distance: number;
  /** Longitude of the mean ascending node, degrees. */
  node: number;
  /** Elongation from the Sun, degrees in [0, 360): 0 new moon, 90 first quarter, 180 full moon. */
  elongation: number;
}

export function moonState(jd: number): MoonState {
  const T = centuries(jd);
  const poly = (c: number[]) => c.reduceRight((acc, k) => acc * T + k, 0);
  // Mean arguments, degrees (Meeus 47.1-47.5 and the node, via PyMeeus).
  const Lp = poly([218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000]);
  const D = poly([297.8501921, 445267.1114034, -0.0018819, 1 / 545868, -1 / 113065000]) * DEG;
  const M = poly([357.5291092, 35999.0502909, -0.0001536, 1 / 24490000]) * DEG;
  const Mp = poly([134.9633964, 477198.8675055, 0.0087414, 1 / 69699.9, 1 / 14712000]) * DEG;
  const F = poly([93.272095, 483202.0175233, -0.0036539, -1 / 3526000, 1 / 863310000]) * DEG;
  const node = poly([125.0445479, -1934.1362891, 0.0020754, 1 / 476441, -1 / 60616000]);
  const s = Math.sin;
  const c = Math.cos;
  // Largest longitude terms: equation of the centre, evection, variation, annual equation,
  // parallactic inequality, reduction to the ecliptic (degrees).
  const dLon =
    6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) - 0.185116 * s(M) -
    (125 / 3600) * s(D) - (412 / 3600) * s(2 * F);
  const lat = 5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F) + 0.055413 * s(2 * D - Mp + F);
  const distance = 385000.5584 - 20905.355 * c(Mp) - 3699.1109 * c(2 * D - Mp) - 2955.9676 * c(2 * D) - 569.9251 * c(2 * Mp);
  const lon = norm360(Lp + dLon);
  return { lon, lat, distance, node: norm360(node), elongation: norm360(lon - sunLongitude(jd)) };
}

/** Earth Rotation Angle, radians (unwrapped: grows by 2π per sidereal day). */
export function earthRotation(jd: number): number {
  return 2 * Math.PI * (0.779057273264 + 1.00273781191135448 * (jd - J2000));
}

/** Ecliptic (x to the equinox, z north) -> stage axes (x, y up, z towards the reader): (x, z, -y). */
export const eclToStage = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

/** Direction of the Earth's north pole in stage axes for an axial tilt (degrees): ecliptic (0, sin ε, cos ε). */
export function poleDirection(tilt: number): Vec3 {
  return eclToStage([0, Math.sin(tilt * DEG), Math.cos(tilt * DEG)]);
}

// ---------------------------------------------------------------- calendar helpers (UTC)

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export function startOfYear(ms: number): number {
  return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
}
export function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}
/** 1 = 1 January. */
export function dayOfYear(ms: number): number {
  return Math.floor((startOfDay(ms) - startOfYear(ms)) / DAY_MS) + 1;
}
export function hourOfDay(ms: number): number {
  return (ms - startOfDay(ms)) / 3_600_000;
}
/**
 * "21 giugno 2026", optionally with "· ore 14:30 UTC". Other lesson languages (D21): the locale's own
 * long date (Intl, UTC) and "14:30 UTC".
 */
export function italianDate(ms: number, withHour = false): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (!isItalian(displayLocale())) {
    const base = new Intl.DateTimeFormat(displayLocale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC", numberingSystem: "latn" }).format(d);
    return withHour ? `${base} · ${engineText("sky.hourOf", { time: `${hh}:${mm}` })}` : base;
  }
  const day = d.getUTCDate() === 1 ? "1º" : String(d.getUTCDate());
  const base = `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!withHour) return base;
  return `${base} · ore ${hh}:${mm} UTC`;
}
export { DAY_MS };
