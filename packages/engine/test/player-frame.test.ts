import { describe, expect, it } from "vitest";
import { freeRect } from "../src/player/stage.ts";

describe("free area under the overlays", () => {
  it("removes the HUD and the bottom bars from the framed area", () => {
    expect(freeRect(900, 800, { left: 0, right: 0, top: 60, bottom: 120 })).toEqual({ x: 0, y: 60, w: 900, h: 620 });
    expect(freeRect(900, 800, { left: 0, right: 0, top: 0, bottom: 0 })).toEqual({ x: 0, y: 0, w: 900, h: 800 });
  });

  it("never shrinks the picture below 55% of the stage", () => {
    const r = freeRect(400, 400, { left: 0, right: 0, top: 150, bottom: 250 });
    expect(r.h).toBe(220);
    expect(r.y / (400 - r.h - r.y)).toBeCloseTo(150 / 250, 1);
    expect(freeRect(400, 400, { left: -5, right: 0, top: 0, bottom: 0 }).x).toBe(0);
  });
});
