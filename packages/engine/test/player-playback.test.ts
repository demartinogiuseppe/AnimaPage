import { describe, expect, it } from "vitest";
import type { Sentence } from "@pv/scene-spec";
import { Playback, sentenceAt } from "../src/player/playback.ts";
import { FakeTts, type TtsProvider } from "../src/player/tts.ts";

const S = (at: number, text: string, speech?: string): Sentence => ({ at, text, speech, highlight: [], sourceIds: [] });
const chapter = { duration: 10, narration: [S(0, "uno"), S(3, "due", "DUE parlato"), S(6, "tre")] };

/** Simulates wall-clock frames: the voice advances, then the player ticks. Returns wall seconds elapsed. */
function run(pb: Playback, tts: FakeTts, seconds: number, dt = 0.05): void {
  for (let w = 0; w < seconds - 1e-9; w += dt) {
    tts.tick(dt);
    pb.tick(dt);
  }
}

function runUntilEnd(pb: Playback, tts: FakeTts, dt = 0.05, max = 120): number {
  let wall = 0;
  while (pb.playing && wall < max) {
    tts.tick(dt);
    pb.tick(dt);
    wall += dt;
  }
  return wall;
}

function setup(voiceSeconds: number) {
  const tts = new FakeTts(() => voiceSeconds);
  const events: number[] = [];
  let ended = 0;
  const pb = new Playback(tts, { onSentence: (i) => events.push(i), onEnd: () => ended++ });
  pb.load(chapter);
  return { tts, pb, events, ended: () => ended };
}

describe("sentenceAt", () => {
  it("returns the last sentence started at t", () => {
    expect(sentenceAt(chapter.narration, -1)).toBe(-1);
    expect(sentenceAt(chapter.narration, 0)).toBe(0);
    expect(sentenceAt(chapter.narration, 2.99)).toBe(0);
    expect(sentenceAt(chapter.narration, 3)).toBe(1);
    expect(sentenceAt(chapter.narration, 9)).toBe(2);
  });
});

describe("Playback: the scene waits for the voice", () => {
  it("plays every sentence in order, speaking `speech ?? text`, and ends at the duration", () => {
    const { tts, pb, events, ended } = setup(1);
    pb.play();
    const wall = runUntilEnd(pb, tts);
    expect(tts.spoken).toEqual(["uno", "DUE parlato", "tre"]);
    expect(events).toEqual([0, 1, 2]);
    expect(pb.t).toBe(10);
    expect(wall).toBeCloseTo(10, 1);
    expect(ended()).toBe(1);
    expect(pb.highlighted).toBe(-1);
  });

  it("a slow voice freezes t at the next sentence and stretches the chapter", () => {
    const { tts, pb } = setup(5);
    pb.play();
    run(pb, tts, 4); // sentence 0 still speaking, t reached 3 and waits
    expect(pb.t).toBeCloseTo(3, 5);
    expect(pb.holding).toBe(true);
    expect(tts.spoken).toEqual(["uno"]);
    run(pb, tts, 1.1); // sentence 0 ended at wall 5 -> sentence 1 starts
    expect(tts.spoken).toEqual(["uno", "DUE parlato"]);
    const total = 5.1 + runUntilEnd(pb, tts);
    // s0 0-5, s1 5-10 (t holds at 6 from wall 8), s2 10-15 (t reaches 10 at wall 14, ends when voice ends)
    expect(total).toBeCloseTo(15, 0);
    expect(pb.t).toBe(10);
  });

  it("a fast voice never speeds the timeline up", () => {
    const { tts, pb } = setup(0.2);
    pb.play();
    run(pb, tts, 2.9);
    expect(pb.t).toBeCloseTo(2.9, 5);
    expect(tts.spoken).toEqual(["uno"]); // sentence 1 waits for its `at`
    run(pb, tts, 0.2);
    expect(tts.spoken).toEqual(["uno", "DUE parlato"]);
    expect(runUntilEnd(pb, tts) + 3.1).toBeCloseTo(10, 1);
  });

  it("pause mid-sentence keeps t; play re-speaks that sentence from its start", () => {
    const { tts, pb } = setup(2);
    pb.play();
    run(pb, tts, 4); // sentence 1 started at t=3, speaking
    expect(tts.speaking).toBe("DUE parlato");
    pb.pause();
    const t = pb.t;
    expect(tts.speaking).toBeNull();
    run(pb, tts, 3);
    expect(pb.t).toBe(t);
    pb.play();
    run(pb, tts, 0.05);
    expect(tts.spoken).toEqual(["uno", "DUE parlato", "DUE parlato"]);
    expect(pb.t).toBeGreaterThan(t); // t continues from where it was
  });

  it("pause after a sentence finished does not repeat it", () => {
    const { tts, pb } = setup(1);
    pb.play();
    run(pb, tts, 2); // sentence 0 done at wall 1
    pb.pause();
    pb.play();
    run(pb, tts, 0.5);
    expect(tts.spoken).toEqual(["uno"]);
  });

  it("after a scrub, play speaks the sentence covering t from its start", () => {
    const { tts, pb } = setup(1);
    pb.seek(4.5);
    expect(pb.highlighted).toBe(1);
    expect(pb.playing).toBe(false);
    pb.play();
    run(pb, tts, 0.05);
    expect(tts.spoken).toEqual(["DUE parlato"]);
    expect(pb.t).toBeCloseTo(4.55, 5);
    pb.seek(1); // scrub backwards: sentence 0 again
    pb.play();
    run(pb, tts, 0.05);
    expect(tts.spoken.at(-1)).toBe("uno");
  });

  it("seek clamps and stops the voice", () => {
    const { tts, pb } = setup(1);
    pb.play();
    run(pb, tts, 0.1);
    pb.seek(99);
    expect(pb.t).toBe(10);
    expect(tts.speaking).toBeNull();
    pb.seek(-3);
    expect(pb.t).toBe(0);
    expect(pb.highlighted).toBe(0);
  });

  it("tap on a sentence jumps to its `at` and speaks it", () => {
    const { tts, pb } = setup(1);
    pb.jumpTo(2);
    expect(pb.t).toBe(6);
    expect(pb.playing).toBe(true);
    run(pb, tts, 0.05);
    expect(tts.spoken).toEqual(["tre"]);
  });

  it("play at the end restarts from 0", () => {
    const { tts, pb } = setup(0.5);
    pb.play();
    runUntilEnd(pb, tts);
    pb.play();
    expect(pb.t).toBe(0);
    run(pb, tts, 0.05);
    expect(tts.spoken.at(-1)).toBe("uno");
  });

  it("ignores stale voice callbacks after stop", () => {
    const callbacks: (() => void)[] = [];
    const leaky: TtsProvider = { speak: (_t, onEnd) => callbacks.push(onEnd), stop: () => {} };
    const pb = new Playback(leaky);
    pb.load(chapter);
    pb.play();
    pb.tick(0.05); // speaks sentence 0
    pb.pause(); // stale from now on
    pb.play();
    pb.tick(0.05); // speaks sentence 0 again
    callbacks[0]!(); // late end of the first utterance must not unfreeze the second
    for (let i = 0; i < 80; i++) pb.tick(0.05);
    expect(pb.t).toBeCloseTo(3, 5);
    expect(pb.holding).toBe(true);
    callbacks[1]!();
    pb.tick(0.05);
    expect(callbacks).toHaveLength(3);
  });

  it("load resets the chapter state", () => {
    const { tts, pb } = setup(1);
    pb.play();
    run(pb, tts, 4);
    pb.load({ duration: 5, narration: [S(0, "nuovo")] });
    expect(pb.t).toBe(0);
    expect(pb.playing).toBe(false);
    expect(pb.highlighted).toBe(-1);
    expect(pb.duration).toBe(5);
    expect(tts.speaking).toBeNull();
  });
});
