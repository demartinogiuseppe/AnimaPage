import { describe, expect, it } from "vitest";
import { ReticleState } from "../src/player/xr/reticle.ts";

describe("AR reticle state machine", () => {
  it("seeks, finds a surface, places on tap", () => {
    const r = new ReticleState(3);
    expect(r.phase).toBe("seeking");
    expect(r.place()).toBe(false); // tap without a surface does nothing
    expect(r.frame(false)).toBe("seeking");
    expect(r.frame(true)).toBe("found");
    expect(r.reticleVisible).toBe(true);
    expect(r.place()).toBe(true);
    expect(r.phase).toBe("placed");
    expect(r.reticleVisible).toBe(false);
    expect(r.place()).toBe(false); // second tap: already placed
  });

  it("keeps the reticle through short hit-test gaps, loses it after the grace frames", () => {
    const r = new ReticleState(3);
    r.frame(true);
    for (let i = 0; i < 3; i++) expect(r.frame(false)).toBe("found");
    expect(r.frame(false)).toBe("seeking");
    expect(r.frame(true)).toBe("found");
    r.frame(false);
    r.frame(true); // a hit resets the gap counter
    for (let i = 0; i < 3; i++) expect(r.frame(false)).toBe("found");
  });

  it("ignores hit-test frames once placed and starts over on Riposiziona", () => {
    const r = new ReticleState(2);
    r.frame(true);
    r.place();
    expect(r.frame(false)).toBe("placed");
    expect(r.frame(true)).toBe("placed");
    r.reset();
    expect(r.phase).toBe("seeking");
    expect(r.place()).toBe(false);
    r.frame(true);
    expect(r.place()).toBe(true);
  });
});
