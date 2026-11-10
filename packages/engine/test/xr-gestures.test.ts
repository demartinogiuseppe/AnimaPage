import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyPinchTwist, isTap, pinchTwist, rayPlaneY, TAP_MAX_MS, TAP_SLOP_PX, toNdc, wrapAngle } from "../src/player/xr/gestures.ts";
import { AR_WIDTH_RANGE, type ArTransform } from "../src/player/xr/placement.ts";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tr = (width: number, yaw = 0): ArTransform => ({ position: v(0.1, -0.7, -0.9), yaw, width });

describe("AR gestures", () => {
  it("measures pinch scale and clockwise twist (screen y down)", () => {
    const g = pinchTwist({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 });
    expect(g.scale).toBeCloseTo(2);
    expect(g.twist).toBeCloseTo(Math.PI / 2);
    const same = pinchTwist({ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 10, y: 10 }, { x: 60, y: 60 });
    expect(same.scale).toBeCloseTo(1);
    expect(same.twist).toBeCloseTo(0);
    // Fingers on top of each other: no scale jump.
    expect(pinchTwist({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 90, y: 0 }).scale).toBe(1);
  });

  it("wraps the twist across ±π", () => {
    const g = pinchTwist({ x: 0, y: 0 }, { x: -100, y: 1 }, { x: 0, y: 0 }, { x: -100, y: -1 });
    expect(Math.abs(g.twist)).toBeLessThan(0.05);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it("applies pinch/twist to the transform from its start, clamped", () => {
    const start = tr(0.35, 0.2);
    const out = tr(0);
    applyPinchTwist(start, { scale: 1.5, twist: 0.3 }, out);
    expect(out.width).toBeCloseTo(0.525);
    expect(out.yaw).toBeCloseTo(-0.1); // clockwise on screen = clockwise seen from above
    expect(out.position.equals(start.position)).toBe(true);
    expect(applyPinchTwist(start, { scale: 100, twist: 0 }, out).width).toBe(AR_WIDTH_RANGE[1]);
    expect(applyPinchTwist(start, { scale: 0.01, twist: 0 }, out).width).toBe(AR_WIDTH_RANGE[0]);
    // The start is not modified (gestures are relative to the touch start, no drift).
    expect(start.width).toBe(0.35);
  });

  it("drags along the table plane", () => {
    const out = v(0, 0, 0);
    const hit = rayPlaneY(v(0, 0, 0), v(0, -1, -1).normalize(), -0.8, out);
    expect(hit).not.toBeNull();
    expect(out.y).toBeCloseTo(-0.8);
    expect(out.z).toBeCloseTo(-0.8);
    expect(rayPlaneY(v(0, 0, 0), v(0, 1, -1).normalize(), -0.8, out)).toBeNull(); // looking up
    expect(rayPlaneY(v(0, 0, 0), v(1, 0, 0), -0.8, out)).toBeNull(); // parallel
    // Moving the finger moves the hit point by the plane delta.
    const a = rayPlaneY(v(0, 0, 0), v(0, -1, -1).normalize(), -0.8, v(0, 0, 0))!;
    const b = rayPlaneY(v(0, 0, 0), v(0.2, -1, -1).normalize(), -0.8, v(0, 0, 0))!;
    const d = b.clone().sub(a);
    expect(d.y).toBeCloseTo(0);
    expect(d.x).toBeGreaterThan(0);
  });

  it("converts screen pixels to NDC and recognises taps", () => {
    const n = toNdc({ x: 0, y: 0 }, 400, 800, new THREE.Vector2());
    expect([n.x, n.y]).toEqual([-1, 1]);
    const c = toNdc({ x: 200, y: 400 }, 400, 800, new THREE.Vector2());
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(isTap({ x: 10, y: 10 }, { x: 10 + TAP_SLOP_PX / 2, y: 10 }, 120)).toBe(true);
    expect(isTap({ x: 10, y: 10 }, { x: 10 + TAP_SLOP_PX * 2, y: 10 }, 120)).toBe(false);
    expect(isTap({ x: 10, y: 10 }, { x: 10, y: 10 }, TAP_MAX_MS + 1)).toBe(false);
  });
});
