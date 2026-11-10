import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bookLayout, footprintFrom } from "../src/book/layout.ts";
import { AR_BOOK_WIDTH_M, AR_WIDTH_RANGE, arScale, clampWidth, faceViewer, isHorizontal, worldPose, type ArTransform } from "../src/player/xr/placement.ts";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const pose = () => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() });
const matrixOf = (p: ReturnType<typeof pose>) => new THREE.Matrix4().compose(p.position, p.quaternion, p.scale);

describe("AR placement", () => {
  it("sizes the book to the requested real width", () => {
    expect(arScale(20, 0.4)).toBeCloseTo(0.02);
    // A real layout: an engine of radius 5 around (3, 1, -2), book width = 2 * halfWidth.
    const L = bookLayout(footprintFrom(null, { center: v(3, 1, -2), radius: 5 }));
    const t: ArTransform = { position: v(0.2, -0.8, -0.6), yaw: 0, width: AR_BOOK_WIDTH_M };
    const out = pose();
    worldPose(t, v(L.origin.x, L.origin.y - L.stackH - L.coverT, L.origin.z), 2 * L.halfWidth, out);
    const m = matrixOf(out);
    const left = v(L.origin.x - L.halfWidth, L.origin.y, L.origin.z).applyMatrix4(m);
    const right = v(L.origin.x + L.halfWidth, L.origin.y, L.origin.z).applyMatrix4(m);
    expect(left.distanceTo(right)).toBeCloseTo(AR_BOOK_WIDTH_M);
  });

  it("puts the bottom of the covers on the table point, whatever the yaw and size", () => {
    const base = v(4, -1.5, 2);
    for (const yaw of [0, 0.7, -2.4, Math.PI]) {
      for (const width of [0.2, 0.35, 0.9]) {
        const t: ArTransform = { position: v(-0.3, -0.75, -1.1), yaw, width };
        const out = pose();
        worldPose(t, base, 10, out);
        const p = base.clone().applyMatrix4(matrixOf(out));
        expect(p.distanceTo(t.position)).toBeLessThan(1e-9);
        expect(out.scale.x).toBeCloseTo(width / 10);
      }
    }
  });

  it("turns the reader's side of the book towards the viewer", () => {
    const table = v(0, -0.8, -1);
    for (const viewer of [v(0, 0, 0), v(2, 0.4, -1), v(-1, 0, -3)]) {
      const yaw = faceViewer(table, viewer);
      const readerSide = v(0, 0, 1).applyAxisAngle(v(0, 1, 0), yaw);
      const toViewer = viewer.clone().sub(table).setY(0).normalize();
      expect(readerSide.dot(toViewer)).toBeCloseTo(1);
    }
    expect(faceViewer(table, table.clone())).toBe(0);
  });

  it("clamps the width to the pinch limits", () => {
    expect(clampWidth(0.01)).toBe(AR_WIDTH_RANGE[0]);
    expect(clampWidth(5)).toBe(AR_WIDTH_RANGE[1]);
    expect(clampWidth(0.5)).toBe(0.5);
  });

  it("accepts only upward-facing horizontal surfaces", () => {
    const q = (axis: THREE.Vector3, deg: number) => new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);
    expect(isHorizontal(new THREE.Quaternion())).toBe(true);
    expect(isHorizontal(q(v(0, 1, 0), 130))).toBe(true); // any yaw on a table
    expect(isHorizontal(q(v(1, 0, 0), 15))).toBe(true); // slightly tilted plane estimate
    expect(isHorizontal(q(v(1, 0, 0), 90))).toBe(false); // wall
    expect(isHorizontal(q(v(0, 0, 1), 180))).toBe(false); // ceiling
  });
});
