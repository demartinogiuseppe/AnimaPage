import { describe, expect, it } from "vitest";
import type { Anchor, CameraKey } from "@pv/scene-spec";
import * as THREE from "three";
import {
  CAMERA_BLEND,
  cameraAt,
  engineViewFor,
  engineViewPose,
  lensAt,
  poseZoom,
  targetLens,
  viewOffsetY,
  type AnchorResolver,
} from "../src/player/camera.ts";
import type { EngineView } from "../src/types.ts";

const resolve: AnchorResolver = (a: Anchor, out) => {
  if ("pos" in a) {
    out.set(...a.pos);
    return true;
  }
  return false;
};
const key = (at: number, pos: [number, number, number], distance: number, azimuth: number, elevation: number): CameraKey => ({
  at,
  target: { pos },
  distance,
  azimuth,
  elevation,
});

const keys = [key(0, [0, 0, 0], 10, 0, 30), key(5, [4, 0, -2], 6, 90, 50), key(6, [-3, 1, 0], 14, -170, 20)];

describe("cameraAt", () => {
  it("returns null without keys", () => {
    expect(cameraAt([], 1, resolve)).toBeNull();
  });

  it("uses the orbit convention of CameraKey", () => {
    const south = cameraAt([key(0, [1, 0, 2], 10, 0, 0)], 0, resolve)!;
    expect(south.position.x).toBeCloseTo(1);
    expect(south.position.y).toBeCloseTo(0);
    expect(south.position.z).toBeCloseTo(12); // azimuth 0 = +z side
    expect(south.target.toArray()).toEqual([1, 0, 2]);
    const east = cameraAt([key(0, [0, 0, 0], 10, 90, 0)], 0, resolve)!;
    expect(east.position.x).toBeCloseTo(10);
    const up = cameraAt([key(0, [0, 0, 0], 10, 0, 89)], 0, resolve)!;
    expect(up.position.y).toBeCloseTo(10 * Math.sin((89 * Math.PI) / 180));
  });

  it("holds the first key before its time and each key after its blend", () => {
    const before = cameraAt([key(2, [0, 0, 0], 10, 0, 0)], 0, resolve)!;
    expect(before.position.z).toBeCloseTo(10);
    const settled = cameraAt(keys.slice(0, 2), 5 + CAMERA_BLEND, resolve)!;
    const k1 = cameraAt([keys[1]!], 0, resolve)!;
    expect(settled.position.distanceTo(k1.position)).toBeLessThan(1e-9);
  });

  it("starts each blend from the previous pose (no jump at a key)", () => {
    const a = cameraAt(keys.slice(0, 2), 4.999, resolve)!;
    const b = cameraAt(keys.slice(0, 2), 5, resolve)!;
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-6);
  });

  it("is continuous over the whole chapter, even with overlapping blends", () => {
    const maxStep = (dt: number) => {
      let prev = cameraAt(keys, 0, resolve)!;
      let max = 0;
      for (let t = dt; t <= 10; t += dt) {
        const p = cameraAt(keys, t, resolve)!;
        max = Math.max(max, p.position.distanceTo(prev.position), p.target.distanceTo(prev.target));
        prev = p;
      }
      return max;
    };
    // A jump would not shrink with the sampling step; a continuous path shrinks ~linearly.
    const coarse = maxStep(0.001);
    const fine = maxStep(0.0001);
    expect(coarse).toBeLessThan(0.05);
    expect(fine).toBeLessThan(coarse / 5);
  });

  it("is pure: same t, same pose, whatever was evaluated before", () => {
    const fresh = cameraAt(keys, 5.7, resolve)!;
    for (const t of [9, 0, 6.2, 5.1, 3]) cameraAt(keys, t, resolve);
    const again = cameraAt(keys, 5.7, resolve)!;
    expect(again.position.toArray()).toEqual(fresh.position.toArray());
    expect(again.target.toArray()).toEqual(fresh.target.toArray());
  });

  it("pulls the camera back by distanceScale (narrow stage)", () => {
    const k = [key(0, [0, 0, 0], 10, 0, 0)];
    expect(cameraAt(k, 0, resolve, 1.3)!.position.z).toBeCloseTo(13);
  });

  it("falls back to the origin for unresolvable anchors and follows moving ones", () => {
    const entity: CameraKey = { at: 0, target: { entity: "ships", index: 2 }, distance: 5, azimuth: 0, elevation: 0 };
    expect(cameraAt([entity], 0, resolve)!.target.toArray()).toEqual([0, 0, 0]);
    const moving = (t: number): AnchorResolver => (_a, out) => (out.set(t, 0, 0), true);
    expect(cameraAt([entity], 3, moving(3))!.position.x).toBeCloseTo(3);
  });

  it("turns the short way round when blending azimuths", () => {
    const k = [key(0, [0, 0, 0], 10, 170, 0), key(1, [0, 0, 0], 10, -170, 0)];
    const mid = cameraAt(k, 1 + CAMERA_BLEND / 2, resolve)!;
    expect(mid.position.z).toBeCloseTo(-10); // passes through 180°, not through 0°
  });
});

describe("engine views", () => {
  it("engineViewPose moves the view into world space", () => {
    const world = new THREE.Matrix4().compose(new THREE.Vector3(10, 0, -5), new THREE.Quaternion(), new THREE.Vector3(2, 2, 2));
    const pose = engineViewPose({ position: new THREE.Vector3(1, 2, 3), target: new THREE.Vector3(0, 1, 0), fov: 6, shiftY: 0.2 }, world);
    expect(pose.position.toArray()).toEqual([12, 4, 1]);
    expect(pose.target.toArray()).toEqual([10, 2, -5]);
    expect(pose.fov).toBe(6);
    expect(pose.shiftY).toBe(0.2);
  });

  it("viewOffsetY combines the free rect and the lens shift", () => {
    expect(viewOffsetY(0, 800, 0.24)).toBeCloseTo(-192);
    expect(viewOffsetY(40, 800, 0.24)).toBeCloseTo(-232);
    expect(viewOffsetY(40, 800, 0)).toBeCloseTo(-40);
  });

  it("viewOffsetY puts the view axis where the lens shift says, with an offset free rect", () => {
    const W = 1280;
    const H = 800;
    const fr = { x: 100, y: 40, w: 800, h: 600 };
    for (const shiftY of [0, 0.24]) {
      const cam = new THREE.PerspectiveCamera(30, fr.w / fr.h, 0.1, 100);
      cam.position.set(0, 0, 10);
      cam.lookAt(0, 0, 0);
      cam.setViewOffset(fr.w, fr.h, -fr.x, viewOffsetY(fr.y, fr.h, shiftY), W, H);
      cam.updateMatrixWorld(true);
      const p = new THREE.Vector3(0, 0, 0).project(cam);
      // Canvas pixels: the axis sits at the centre of the free rect, shiftY x its height lower.
      expect(((p.x + 1) / 2) * W).toBeCloseTo(fr.x + fr.w / 2, 3);
      expect(((1 - p.y) / 2) * H).toBeCloseTo(fr.y + fr.h * (0.5 + shiftY), 3);
    }
  });

  it("engineViewFor: null without the hook, when it declines, and in an XR session", () => {
    const view: EngineView = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 6, shiftY: 0.2 };
    expect(engineViewFor({}, false, "c", 0, 1)).toBeNull();
    expect(engineViewFor({ view: () => null }, false, "c", 0, 1)).toBeNull();
    expect(engineViewFor({ view: () => view }, false, "c", 0, 1)).toBe(view);
    expect(engineViewFor({ view: () => view }, true, "c", 0, 1)).toBeNull();
  });

  it("targetLens: the presentation's own lens unless the engine drives it, eased in by join", () => {
    expect(targetLens(40, null, 1)).toEqual({ fov: 40, shiftY: 0 });
    expect(targetLens(22, { fov: 6, shiftY: 0.2 }, 1)).toEqual({ fov: 6, shiftY: 0.2 });
    const half = targetLens(40, { fov: 10, shiftY: 0.2 }, 0.5);
    expect(half.fov).toBeCloseTo(25);
    expect(half.shiftY).toBeCloseTo(0.1);
    expect(targetLens(40, { fov: 10, shiftY: 0.2 }, 0)).toEqual({ fov: 40, shiftY: 0 });
  });

  it("lensAt tweens, and holds the current lens while the user orbits or XR presents", () => {
    const from = { fov: 40, shiftY: 0 };
    const to = { fov: 6, shiftY: 0.2 };
    const current = { fov: 12, shiftY: 0.1 };
    expect(lensAt(from, to, 0.5, false, current)).toEqual({ fov: 23, shiftY: 0.1 });
    expect(lensAt(from, to, 1, false, current)).toEqual(to);
    expect(lensAt(from, to, 1, true, current)).toBe(current);
  });

  it("poseZoom: engine views skip the Accademico distance multiplier", () => {
    expect(poseZoom(true, 1.9)).toBe(1);
    expect(poseZoom(false, 1.9)).toBe(1.9);
  });
});
