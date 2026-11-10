import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { anyMove, dampVelocity, minCameraY, MOVE_SPEED, moveVelocity, NO_MOVE, softClamp, targetLimits } from "../src/player/move.ts";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("free movement", () => {
  it("moves forward/back and left/right on the ground, relative to the view direction", () => {
    // Camera south of the target, looking north (-z).
    const cam = v(0, 5, 10);
    const tgt = v(0, 0, 0);
    const fwd = moveVelocity({ ...NO_MOVE, forward: true }, cam, tgt);
    expect(fwd.y).toBe(0);
    expect(fwd.z).toBeLessThan(0);
    expect(fwd.x).toBeCloseTo(0);
    const right = moveVelocity({ ...NO_MOVE, right: true }, cam, tgt);
    expect(right.x).toBeGreaterThan(0);
    expect(right.z).toBeCloseTo(0);
    // Camera east looking west: "right" is now north.
    const r2 = moveVelocity({ ...NO_MOVE, right: true }, v(10, 3, 0), tgt);
    expect(r2.z).toBeLessThan(0);
    expect(moveVelocity({ ...NO_MOVE, up: true }, cam, tgt).y).toBeGreaterThan(0);
    expect(moveVelocity({ ...NO_MOVE, down: true }, cam, tgt).y).toBeLessThan(0);
  });

  it("scales speed with the camera distance and cancels opposite keys", () => {
    const near = moveVelocity({ ...NO_MOVE, forward: true }, v(0, 0, 2), v(0, 0, 0)).length();
    const far = moveVelocity({ ...NO_MOVE, forward: true }, v(0, 0, 20), v(0, 0, 0)).length();
    expect(near).toBeCloseTo(MOVE_SPEED * 2);
    expect(far).toBeCloseTo(MOVE_SPEED * 20);
    expect(moveVelocity({ ...NO_MOVE, forward: true, back: true }, v(0, 0, 2), v(0, 0, 0)).length()).toBe(0);
    // Diagonals are not faster.
    expect(moveVelocity({ ...NO_MOVE, forward: true, right: true }, v(0, 0, 2), v(0, 0, 0)).length()).toBeCloseTo(MOVE_SPEED * 2);
    // Looking straight down still has a forward.
    expect(moveVelocity({ ...NO_MOVE, forward: true }, v(0, 5, 0), v(0, 0, 0)).length()).toBeGreaterThan(0);
    expect(anyMove(NO_MOVE)).toBe(false);
  });

  it("starts and stops smoothly", () => {
    const cur = v(0, 0, 0);
    dampVelocity(cur, v(10, 0, 0), 1 / 60);
    expect(cur.x).toBeGreaterThan(0);
    expect(cur.x).toBeLessThan(10);
    for (let i = 0; i < 120; i++) dampVelocity(cur, v(10, 0, 0), 1 / 60);
    expect(cur.x).toBeCloseTo(10, 3);
  });

  it("keeps the target inside the book (soft margin) and the camera above the page", () => {
    const b = { min: v(-4, 0, -3), max: v(4, 0, 3), pageY: 0, size: 4 };
    const lim = targetLimits(b, 2);
    expect(lim.min.x).toBeCloseTo(-4.6);
    expect(lim.max.y).toBeGreaterThan(2);
    expect(softClamp(v(0, 1, 0), lim, 1 / 60).length()).toBe(0);
    const out = v(10, 1, 0);
    const c1 = softClamp(out, lim, 1 / 60);
    expect(c1.x).toBeLessThan(0);
    expect(Math.abs(c1.x)).toBeLessThan(10 - 4.6); // soft: a part per frame
    // Converges back inside.
    for (let i = 0; i < 300; i++) out.add(softClamp(out, lim, 1 / 60));
    expect(out.x).toBeCloseTo(4.6, 3);
    expect(minCameraY(b)).toBeGreaterThan(b.pageY);
  });
});
