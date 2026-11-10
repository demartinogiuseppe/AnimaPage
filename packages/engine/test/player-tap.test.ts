import { describe, expect, it } from "vitest";
import { TapDetector, TapSoundLimiter } from "../src/player/tap.ts";

const ev = (id: number, x: number, y: number, extra: object = {}) => ({ pointerId: id, clientX: x, clientY: y, button: 0, isPrimary: true, pointerType: "mouse", ...extra });

describe("TapDetector", () => {
  it("a quick press that hardly moves is a tap", () => {
    const d = new TapDetector();
    d.down(ev(1, 100, 100), 0);
    expect(d.up(ev(1, 103, 104), 120)).toEqual({ x: 103, y: 104 });
  });

  it("a drag of 20 px is not a tap", () => {
    const d = new TapDetector();
    d.down(ev(1, 100, 100), 0);
    d.move(ev(1, 120, 100));
    expect(d.up(ev(1, 120, 100), 100)).toBeNull();
  });

  it("a long press, a second finger and a right button are not taps", () => {
    const d = new TapDetector();
    d.down(ev(1, 0, 0), 0);
    expect(d.up(ev(1, 0, 0), 351)).toBeNull();
    d.down(ev(1, 0, 0), 0);
    d.down(ev(2, 50, 0, { isPrimary: false }), 10);
    expect(d.up(ev(1, 0, 0), 50)).toBeNull();
    d.down(ev(3, 0, 0, { button: 2 }), 0);
    expect(d.up(ev(3, 0, 0, { button: 2 }), 50)).toBeNull();
  });

  it("a cancelled press is forgotten", () => {
    const d = new TapDetector();
    d.down(ev(1, 0, 0), 0);
    d.cancel();
    expect(d.up(ev(1, 0, 0), 50)).toBeNull();
  });
});

describe("TapDetector after a lost release", () => {
  it("a press whose release never came (left the canvas) does not swallow the next tap once reset", () => {
    const d = new TapDetector();
    d.down(ev(1, 10, 10), 0);
    // pointerleave / lostpointercapture: the player resets the detector.
    d.cancel();
    d.down(ev(1, 50, 50), 1000);
    expect(d.up(ev(1, 50, 50), 1100)).toEqual({ x: 50, y: 50 });
  });

  it("without the reset the stale press turns the next one into a gesture", () => {
    const d = new TapDetector();
    d.down(ev(1, 10, 10), 0);
    d.down(ev(1, 50, 50), 1000);
    expect(d.up(ev(1, 50, 50), 1100)).toBeNull();
  });
});

describe("TapSoundLimiter", () => {
  it("lets at most 3 tap sounds overlap", () => {
    const l = new TapSoundLimiter();
    expect([0, 10, 20, 30].map((t) => l.allow(t))).toEqual([true, true, true, false]);
    expect(l.allow(2000)).toBe(true);
  });
});

describe("TapDetector with a finger", () => {
  const finger = { pointerType: "touch" };
  it("is more tolerant than the mouse: 700 ms and 14 px", () => {
    const d = new TapDetector();
    d.down(ev(1, 100, 100, finger), 0);
    d.move(ev(1, 110, 108, finger));
    expect(d.up(ev(1, 110, 108, finger), 650)).toEqual({ x: 110, y: 108 });
    d.down(ev(1, 100, 100, finger), 0);
    expect(d.up(ev(1, 100, 100, finger), 701)).toBeNull();
    d.down(ev(1, 100, 100, finger), 0);
    d.move(ev(1, 100, 116, finger));
    expect(d.up(ev(1, 100, 116, finger), 100)).toBeNull();
  });

  it("the mouse rule is unchanged", () => {
    const d = new TapDetector();
    d.down(ev(1, 100, 100), 0);
    expect(d.up(ev(1, 100, 100), 400)).toBeNull();
    d.down(ev(1, 100, 100), 0);
    d.move(ev(1, 110, 100));
    expect(d.up(ev(1, 110, 100), 100)).toBeNull();
  });
});
