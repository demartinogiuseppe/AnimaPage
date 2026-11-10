// Pop-up book layout (decision D12): pure geometry, no rendering.
//
// The engine content is never scaled: the book is sized to the content, so camera keys, fog,
// light positions and engine units all stay valid. Book-local frame: spine along z at x = 0,
// flat part of the page surface at y = 0, the reader on the +z side; the right page holds the content.
import * as THREE from "three";
import { clamp } from "../util/math.ts";

/** Horizontal extent of the engine content, in root-local units. */
export interface Footprint {
  /** Centre of the footprint; `y` is the content's base (where it stands on the page). */
  center: THREE.Vector3;
  halfX: number;
  halfZ: number;
  height: number;
  /** Engine bounding radius (camera framing). */
  radius: number;
}

export interface BookLayout {
  /** One page: width along x, depth along z. */
  pageW: number;
  pageD: number;
  /** Height of the page block above the cover (paper thickness). */
  stackH: number;
  coverT: number;
  /** Cover overhang around the pages. */
  coverMargin: number;
  /** Width of the curved part of a page near the spine, as a fraction of pageW. */
  curl: number;
  /** Book-local x of the content centre on the right page. */
  contentX: number;
  /** Where the book origin goes in root-local coordinates (content stays where the engine put it). */
  origin: THREE.Vector3;
  /** Content stands up (dioramas, processes) or lies on the page like a relief model (maps). */
  upright: boolean;
  footprint: Footprint;
  /** Half extents of the whole book (covers included). */
  halfWidth: number;
  halfDepth: number;
}

/** Usable part of the right page across its width: from the end of the spine curl to the outer margin. */
export const USABLE_U: readonly [number, number] = [0.2, 0.94];
/** Usable part of a page along its depth. */
const USABLE_V = 0.88;
/** Page depth / width, kept between a square and a portrait page. */
const ASPECT: readonly [number, number] = [1.0, 1.4];
/** Breathing room around the footprint. */
const PAD = 1.1;
/** The content stands this share of a page width above the paper, so it never looks sunk into the page. */
export const CONTENT_LIFT = 0.035;

/**
 * Footprint of the content from its world box, clamped to the engine's bounding sphere (labels or
 * far-away helpers must not blow up the page) and to a minimum size (a single object still gets a page).
 */
export function footprintFrom(box: THREE.Box3 | null, bounds: { center: THREE.Vector3; radius: number }): Footprint {
  const R = Math.max(bounds.radius, 0.05);
  const c = bounds.center;
  if (!box || box.isEmpty()) {
    return { center: new THREE.Vector3(c.x, c.y - R * 0.5, c.z), halfX: R * 0.75, halfZ: R * 0.75, height: R, radius: R };
  }
  const lo = box.min.clone().max(new THREE.Vector3(c.x - R, c.y - R, c.z - R));
  const hi = box.max.clone().min(new THREE.Vector3(c.x + R, c.y + R, c.z + R));
  if (lo.x > hi.x || lo.y > hi.y || lo.z > hi.z) return footprintFrom(null, bounds);
  const halfX = clamp((hi.x - lo.x) / 2, R * 0.3, R);
  const halfZ = clamp((hi.z - lo.z) / 2, R * 0.3, R);
  return {
    center: new THREE.Vector3((lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2),
    halfX,
    halfZ,
    height: Math.max(hi.y - lo.y, 0),
    radius: R,
  };
}

/** Footprint of an engine root after build (uses three's Box3; works in Node too). */
export function contentFootprint(root: THREE.Object3D, bounds: { center: THREE.Vector3; radius: number }): Footprint {
  root.updateMatrixWorld(true);
  const skip = new Set(backdropsOf(root, bounds.radius));
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g || skip.has(o)) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) box.union(b.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return footprintFrom(box, bounds);
}

/** Objects far bigger than the content (sky domes, horizon aprons): hidden in book mode, ignored for the layout. */
export const BACKDROP_FACTOR = 2.5;

export function backdropsOf(root: THREE.Object3D, radius: number): THREE.Object3D[] {
  root.updateMatrixWorld(true);
  const out: THREE.Object3D[] = [];
  const s = new THREE.Sphere();
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g || !(o as THREE.Mesh).isMesh) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingSphere && s.copy(g.boundingSphere).applyMatrix4(o.matrixWorld).radius > Math.max(radius, 0.05) * BACKDROP_FACTOR) out.push(o);
  });
  return out;
}

/** `lift`: share of a page width the content stands above the paper; 0 for content that draws its own ground (userData.onPage). */
export function bookLayout(fp: Footprint, lift = CONTENT_LIFT): BookLayout {
  const fx = 2 * fp.halfX * PAD;
  const fz = 2 * fp.halfZ * PAD;
  let pageW = fx / (USABLE_U[1] - USABLE_U[0]);
  let pageD = fz / USABLE_V;
  if (pageD > pageW * ASPECT[1]) pageW = pageD / ASPECT[1];
  pageD = Math.max(pageD, pageW * ASPECT[0]);
  const stackH = pageW * 0.035;
  const coverT = pageW * 0.014;
  const coverMargin = pageW * 0.03;
  const contentX = pageW * ((USABLE_U[0] + USABLE_U[1]) / 2);
  return {
    pageW,
    pageD,
    stackH,
    coverT,
    coverMargin,
    curl: USABLE_U[0],
    contentX,
    origin: new THREE.Vector3(fp.center.x - contentX, fp.center.y - pageW * lift, fp.center.z),
    upright: fp.height > 0.3 * Math.max(fp.halfX, fp.halfZ) * 2,
    footprint: fp,
    halfWidth: pageW + coverMargin,
    halfDepth: pageD / 2 + coverMargin,
  };
}

/**
 * Height of the page surface at u = distance from the spine / pageW (0..1): the paper dips into the
 * gutter near the spine, is flat in the middle and droops a little at the outer edge.
 */
export function pageY(u: number, L: Pick<BookLayout, "stackH" | "curl" | "pageW">): number {
  const k = 1 - clamp(u / L.curl);
  const dip = -L.stackH * 0.85 * k * k;
  const droop = -L.pageW * 0.006 * clamp((u - 0.9) / 0.1) ** 2;
  return dip + droop;
}

/** True when the footprint lies inside the usable part of the right page (used by the tests and the dev overlay). */
export function fitsRightPage(L: BookLayout): boolean {
  const fp = L.footprint;
  const x0 = L.contentX - fp.halfX;
  const x1 = L.contentX + fp.halfX;
  const eps = 1e-9;
  return (
    x0 >= L.pageW * USABLE_U[0] - eps &&
    x1 <= L.pageW * USABLE_U[1] + eps &&
    fp.halfZ <= (L.pageD * USABLE_V) / 2 + eps
  );
}

export interface OverviewPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Elevation of the book overview shot at chapter entry. */
export const OVERVIEW_ELEVATION = 58;

/**
 * Camera that shows the whole open book from the reader's side, in book-local coordinates
 * (add `origin` and apply the world matrix to place it). `aspect` = stage width / height.
 */
export function overviewPose(L: BookLayout, aspect: number, fovDeg: number): OverviewPose {
  const el = (OVERVIEW_ELEVATION * Math.PI) / 180;
  const vHalf = Math.tan((fovDeg * Math.PI) / 360);
  const hHalf = vHalf * Math.max(aspect, 0.1);
  const rise = Math.min(L.footprint.height, L.pageD) * 0.5;
  const target = new THREE.Vector3(0, rise * 0.35, 0);
  // Visible half extents of the book seen from elevation `el`: width as is, depth foreshortened.
  const needW = L.halfWidth * 1.06;
  const needH = L.halfDepth * Math.sin(el) + rise * Math.cos(el) * 0.6 + L.halfDepth * 0.08;
  const d = Math.max(needW / hHalf, needH / vHalf) + L.halfDepth * Math.cos(el) * 0.5;
  const position = new THREE.Vector3(0, target.y + d * Math.sin(el), d * Math.cos(el));
  return { position, target };
}

/** Close-ups never get closer than this share of a page width across the smaller frame side (they stay close-ups;
 * the player frames them with a paper margin, see insideBook). */
export const BOOK_MIN_VIEW = 0.1;
/** Lowest camera elevation over the page, degrees (lower and the page turns into a thin line). */
export const BOOK_MIN_ELEVATION = 14;

/**
 * Keeps the book recognisable in close-ups: same target and direction as the scene's camera key, but
 * no closer than BOOK_MIN_VIEW of a page width in frame and no lower than BOOK_MIN_ELEVATION. Pure.
 */
export function keepBookInView(
  pose: OverviewPose,
  pageW: number,
  fovDeg: number,
  aspect: number,
  minView = BOOK_MIN_VIEW,
  minElevationDeg = BOOK_MIN_ELEVATION,
): OverviewPose {
  const dir = pose.position.clone().sub(pose.target);
  let d = dir.length();
  if (d < 1e-9) return { position: pose.position.clone(), target: pose.target.clone() };
  const vHalf = Math.tan((fovDeg * Math.PI) / 360);
  const half = Math.min(vHalf, vHalf * Math.max(aspect, 0.05));
  d = Math.max(d, (minView * pageW) / (2 * half));
  const flat = Math.hypot(dir.x, dir.z);
  let el = Math.atan2(dir.y, flat);
  el = Math.max(el, (minElevationDeg * Math.PI) / 180);
  const az = flat > 1e-9 ? Math.atan2(dir.x, dir.z) : 0;
  const position = new THREE.Vector3(
    pose.target.x + d * Math.cos(el) * Math.sin(az),
    pose.target.y + d * Math.sin(el),
    pose.target.z + d * Math.cos(el) * Math.cos(az),
  );
  return { position, target: pose.target.clone() };
}

/**
 * How far "inside" the book the camera is: 0 while about a page and a half is in frame, 1 when less
 * than ~0.9 of a page is visible (the player then draws a subtle page frame around the stage).
 */
export function insideBook(distance: number, pageW: number, fovDeg: number, aspect: number): number {
  const vHalf = Math.tan((fovDeg * Math.PI) / 360);
  const visible = 2 * distance * Math.min(vHalf, vHalf * Math.max(aspect, 0.05));
  return clamp((1.5 * pageW - visible) / (0.6 * pageW));
}
