// Geometry builders for the chart engine: unit bars, pie/donut sectors, pictogram icons, flow arcs.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ChartIcon } from "@pv/scene-spec";

/** Unit box / cylinder standing on y = 0 (scale x, y, z to size it). */
export const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
export const unitCylinder = () => new THREE.CylinderGeometry(0.5, 0.5, 1, 28).translate(0, 0.5, 0);

/**
 * Flat sector lying on y = 0..thickness. Angles in radians from the back (-z), clockwise seen
 * from above; inner = 0 makes a pie slice.
 */
export function sectorGeometry(start: number, length: number, outer: number, inner: number, thickness: number): THREE.BufferGeometry {
  const len = Math.max(length, 1e-4);
  // Shape coordinates: angle phi from +x counter-clockwise; shape +y becomes -z after the rotation.
  const phi0 = Math.PI / 2 - start;
  const phi1 = Math.PI / 2 - start - len;
  const s = new THREE.Shape();
  if (inner > 0) {
    s.moveTo(inner * Math.cos(phi0), inner * Math.sin(phi0));
    s.absarc(0, 0, outer, phi0, phi1, true);
    s.absarc(0, 0, inner, phi1, phi0, false);
  } else {
    s.moveTo(0, 0);
    s.absarc(0, 0, outer, phi0, phi1, true);
    s.lineTo(0, 0);
  }
  const segs = Math.max(4, Math.ceil((len / (Math.PI * 2)) * 72));
  const geo = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: segs });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Icon about 1 unit tall standing on y = 0, centred on x/z. */
export function iconGeometry(icon: ChartIcon): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const at = (g: THREE.BufferGeometry, x: number, y: number, z = 0) => parts.push(g.translate(x, y, z));
  switch (icon) {
    case "person":
      at(new THREE.SphereGeometry(0.17, 14, 10), 0, 0.83);
      at(new THREE.CapsuleGeometry(0.2, 0.32, 4, 12), 0, 0.36);
      break;
    case "house":
      at(new THREE.BoxGeometry(0.7, 0.55, 0.6), 0, 0.275);
      at(new THREE.ConeGeometry(0.56, 0.42, 4).rotateY(Math.PI / 4), 0, 0.76);
      break;
    case "tree":
      at(new THREE.CylinderGeometry(0.07, 0.09, 0.35, 8), 0, 0.175);
      at(new THREE.ConeGeometry(0.34, 0.7, 12), 0, 0.65);
      break;
    case "factory":
      at(new THREE.BoxGeometry(0.8, 0.45, 0.5), 0, 0.225);
      at(new THREE.CylinderGeometry(0.08, 0.1, 0.55, 10), 0.25, 0.72);
      break;
    case "coin":
      at(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 24), 0, 0.07);
      break;
    case "drop":
      at(new THREE.SphereGeometry(0.3, 16, 12), 0, 0.3);
      at(new THREE.ConeGeometry(0.26, 0.45, 16), 0, 0.72);
      break;
    case "box":
      at(new THREE.BoxGeometry(0.7, 0.7, 0.7), 0, 0.35);
      break;
  }
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  return geo;
}

/** Height of an icon's stack row (icons are ~1 unit tall). */
export const ICON_ROW = { person: 1.05, house: 1.0, tree: 1.0, factory: 1.0, coin: 0.18, drop: 1.0, box: 0.75 } as const;

/** Arched curve from a to b on the ground, rising with the distance. */
export function flowCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += Math.max(0.8, a.distanceTo(b) * 0.35);
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
}
