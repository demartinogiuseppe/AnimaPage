import { describe, expect, it } from "vitest";
import type { ChapterSounds, SoundCue } from "@pv/scene-spec";
import { ambienceAt, CueTracker, WINDOW_FADE } from "../src/player/audio/schedule.ts";

const cues: SoundCue[] = [
  { at: 0, sound: "pop" },
  { at: 2, sound: "chime" },
  { at: 5, sound: "thunder", volume: 0.5 },
  { at: 10, sound: "applause" },
];

/** Simulates continuous play from `from` to `to` with frame step dt; returns fired ids in order. */
function run(tr: CueTracker, from: number, to: number, dt = 1 / 60, duration = 10): string[] {
  const fired: string[] = [];
  for (let t = from; t <= to + 1e-9; t = Math.min(duration, t + dt)) {
    fired.push(...tr.advance(cues, t, true, duration).map((c) => c.sound));
    if (t >= duration) break;
  }
  return fired;
}

describe("CueTracker", () => {
  it("fires every cue exactly once when playback crosses it, including t = 0 and the chapter end", () => {
    const tr = new CueTracker();
    tr.reset(0);
    expect(run(tr, 0, 10)).toEqual(["pop", "chime", "thunder", "applause"]);
  });

  it("does not fire while paused, and fires on resume only for what is crossed afterwards", () => {
    const tr = new CueTracker();
    tr.reset(0);
    expect(run(tr, 0, 1)).toEqual(["pop"]);
    for (let i = 0; i < 30; i++) expect(tr.advance(cues, 1, false, 10)).toEqual([]);
    expect(run(tr, 1, 3)).toEqual(["chime"]);
  });

  it("never bursts cues on a forward seek, and replays nothing on a backward seek", () => {
    const tr = new CueTracker();
    tr.reset(0);
    run(tr, 0, 1);
    // Jump from 1 s to 6 s while playing (tap on a later sentence): chime and thunder are skipped.
    expect(tr.advance(cues, 6, true, 10)).toEqual([]);
    expect(run(tr, 6, 9)).toEqual([]);
    // Back to 1.5 s: nothing fires on the jump, chime fires again when crossed.
    expect(tr.advance(cues, 1.5, true, 10)).toEqual([]);
    expect(run(tr, 1.5, 2.5)).toEqual(["chime"]);
  });

  it("a cue at a moment where the clock waits for the voice fires once, when the clock moves on", () => {
    const tr = new CueTracker();
    tr.reset(1.9);
    const fired: string[] = [];
    for (const t of [1.95, 2, 2, 2, 2, 2.02, 2.04]) fired.push(...tr.advance(cues, t, true, 10).map((c) => c.sound));
    expect(fired).toEqual(["chime"]);
  });

  it("chapter change (reset) starts counting from 0 again", () => {
    const tr = new CueTracker();
    tr.reset(0);
    run(tr, 0, 3);
    tr.reset(0);
    expect(run(tr, 0, 0.5)).toEqual(["pop"]);
  });

  it("after reset(null) the first frame only sets the reference time", () => {
    const tr = new CueTracker();
    expect(tr.advance(cues, 2.01, true, 10)).toEqual([]);
    expect(run(tr, 2.01, 4)).toEqual([]);
  });
});

describe("ambienceAt", () => {
  const sounds: ChapterSounds = {
    ambience: [
      { sound: "sea", volume: 0.6 },
      { sound: "fire", window: [10, 20] },
      { sound: "night", window: [0, 4], volume: 0.5 },
      { sound: "night", window: [3, 8], volume: 0.8 },
    ],
    cues: [],
  };

  it("windowless ambience covers the whole chapter at its volume", () => {
    expect(ambienceAt(sounds, 0).get("sea")).toBe(0.6);
    expect(ambienceAt(sounds, 99).get("sea")).toBe(0.6);
  });

  it("windows fade in and out at their edges and are silent outside", () => {
    expect(ambienceAt(sounds, 9.9).has("fire")).toBe(false);
    expect(ambienceAt(sounds, 10).has("fire")).toBe(false); // level 0 at the very edge
    expect(ambienceAt(sounds, 10 + WINDOW_FADE / 2).get("fire")).toBeCloseTo(0.5);
    expect(ambienceAt(sounds, 15).get("fire")).toBe(1);
    expect(ambienceAt(sounds, 20 - WINDOW_FADE / 4).get("fire")).toBeCloseTo(0.25);
    expect(ambienceAt(sounds, 20.1).has("fire")).toBe(false);
  });

  it("the same sound in overlapping windows plays once, at the loudest level", () => {
    const m = ambienceAt(sounds, 3.5);
    expect([...m.keys()].filter((k) => k === "night")).toHaveLength(1);
    expect(m.get("night")).toBeGreaterThan(0.25);
    expect(m.get("night")).toBeLessThanOrEqual(0.8);
  });

  it("no sounds, no loops", () => {
    expect(ambienceAt(undefined, 3).size).toBe(0);
  });
});
