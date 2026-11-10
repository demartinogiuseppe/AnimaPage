// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SceneSpec, type Chapter } from "@pv/scene-spec";
import { createStorybookEngine } from "../src/engines/storybook/index.ts";
import { AudioDirector, DUCK_LEVEL, FEEDBACK_VOLUME, IDLE_MUSIC, type AudioOut } from "../src/player/audio/director.ts";
import { Playback } from "../src/player/playback.ts";
import { FakeTts } from "../src/player/tts.ts";

class RecordingOut implements AudioOut {
  loops = new Map<string, number>();
  loopCalls = 0;
  music: { track: string | null; level: number } = { track: null, level: 0 };
  duck = 1;
  played: { sound: string; volume: number }[] = [];
  preloaded: string[] = [];
  setLoops(levels: ReadonlyMap<string, number>) {
    this.loops = new Map(levels);
    this.loopCalls++;
  }
  setMusic(track: string | null, level: number) {
    this.music = { track, level };
  }
  setDuck(level: number) {
    this.duck = level;
  }
  play(sound: string, volume: number) {
    this.played.push({ sound, volume });
  }
  notes: { sound: string; freq: number | null; duration: number | undefined; volume: number }[] = [];
  stops = 0;
  note(sound: string, freq: number | null, duration: number | undefined, volume: number) {
    this.notes.push({ sound, freq, duration, volume });
  }
  stopNotes() {
    this.stops++;
  }
  preload(sounds: readonly string[]) {
    this.preloaded.push(...sounds);
  }
}

const chapter = (id: string, sounds: Chapter["sounds"], duration = 10): Chapter => ({
  id,
  title: id,
  chip: id,
  kind: "history",
  duration,
  narration: [
    { at: 0, text: "Uno.", highlight: [], sourceIds: [] },
    { at: 4, text: "Due.", highlight: [], sourceIds: [] },
  ],
  camera: [],
  pins: [],
  deep: [],
  quiz: [],
  sounds,
});

const a = chapter("a", {
  ambience: [{ sound: "sea", volume: 0.5 }, { sound: "fire", window: [6, 10] }],
  cues: [
    { at: 1, sound: "whoosh" },
    { at: 4, sound: "thunder", volume: 0.7 },
  ],
});
const b = chapter("b", { ambience: [{ sound: "forest" }], cues: [{ at: 0, sound: "chime" }] });

function setup(music = true) {
  const out = new RecordingOut();
  const d = new AudioDirector(out, music ? { track: "music-calm", volume: 0.8 } : undefined);
  return { out, d };
}

describe("AudioDirector", () => {
  it("plays ambience and cues only while playing, music softly while paused", () => {
    const { out, d } = setup();
    d.load(a);
    expect(out.preloaded).toEqual(["sea", "fire", "whoosh", "thunder", "music-calm"]);
    d.update({ t: 0, playing: false, speaking: false });
    expect(out.loops.size).toBe(0);
    expect(out.music).toEqual({ track: "music-calm", level: 0.8 * IDLE_MUSIC });

    for (let t = 0; t <= 2; t += 0.05) d.update({ t, playing: true, speaking: false });
    expect(out.loops).toEqual(new Map([["sea", 0.5]]));
    expect(out.music).toEqual({ track: "music-calm", level: 0.8 });
    expect(out.played).toEqual([{ sound: "whoosh", volume: 1 }]);

    d.update({ t: 2, playing: false, speaking: false });
    expect(out.loops.size).toBe(0);
  });

  it("does not call the output every frame when nothing changes", () => {
    const { out, d } = setup();
    d.load(a);
    for (let i = 0; i < 100; i++) d.update({ t: 2, playing: true, speaking: false });
    expect(out.loopCalls).toBe(1);
  });

  it("ducks music and ambience while the voice speaks", () => {
    const { out, d } = setup();
    d.load(a);
    d.update({ t: 0, playing: true, speaking: true });
    expect(out.duck).toBe(DUCK_LEVEL);
    d.update({ t: 0.1, playing: true, speaking: false });
    expect(out.duck).toBe(1);
  });

  it("re-syncs ambience on a seek without firing the skipped cues", () => {
    const { out, d } = setup();
    d.load(a);
    d.update({ t: 0, playing: true, speaking: false });
    d.update({ t: 8, playing: true, speaking: false }); // jump
    expect(out.played).toEqual([]);
    expect(out.loops.get("fire")).toBe(1);
    expect(out.loops.get("sea")).toBe(0.5);
  });

  it("switches: Suoni silences loops and cues (and feedback), Musica only the music", () => {
    const { out, d } = setup();
    d.load(a);
    d.update({ t: 0.5, playing: true, speaking: false });
    d.setSounds(false);
    expect(out.loops.size).toBe(0);
    d.update({ t: 0.95, playing: true, speaking: false });
    d.update({ t: 1.05, playing: true, speaking: false }); // crosses the whoosh cue
    expect(out.played).toEqual([]);
    d.feedback(true);
    expect(out.played).toEqual([]);
    expect(out.music.track).toBe("music-calm");

    d.setSounds(true);
    expect(out.loops.get("sea")).toBe(0.5);
    d.setMusic(false);
    expect(out.music).toEqual({ track: null, level: 0 });
    d.feedback(false);
    expect(out.played).toEqual([{ sound: "wrong", volume: FEEDBACK_VOLUME }]);
  });

  it("chapter change swaps the ambience and restarts the cues from 0", () => {
    const { out, d } = setup(false);
    d.load(a);
    for (let t = 0; t <= 5; t += 0.05) d.update({ t, playing: true, speaking: false });
    expect(out.played.map((p) => p.sound)).toEqual(["whoosh", "thunder"]);
    d.load(b);
    d.update({ t: 0, playing: true, speaking: false });
    d.update({ t: 0.02, playing: true, speaking: false });
    expect(out.loops).toEqual(new Map([["forest", 1]]));
    expect(out.played.map((p) => p.sound)).toEqual(["whoosh", "thunder", "chime"]);
    expect(out.music.track).toBeNull();
  });

  it("follows a real Playback: cues sync with the narration even when the voice is slow", () => {
    const { out, d } = setup(false);
    // Sentence 1 lasts 6 s, so t freezes at 4 (the next sentence) until the voice finishes.
    const tts = new FakeTts((text) => (text === "Uno." ? 6 : 1));
    const pb = new Playback(tts);
    pb.load(a);
    d.load(a);
    pb.play();
    const firedAt: Record<string, number> = {};
    let wall = 0;
    for (let i = 0; i < 60 * 9; i++) {
      const dt = 1 / 60;
      wall += dt;
      tts.tick(dt);
      pb.tick(dt);
      const before = out.played.length;
      d.update({ t: pb.t, playing: pb.playing, speaking: tts.speaking !== null });
      for (const p of out.played.slice(before)) firedAt[p.sound] = wall;
    }
    expect(Object.keys(firedAt)).toEqual(["whoosh", "thunder"]);
    expect(firedAt.whoosh).toBeCloseTo(1, 1);
    // Thunder (at t = 4) waits for the first sentence to end at ~6 s of wall time.
    expect(firedAt.thunder).toBeGreaterThan(5.9);
    expect(firedAt.thunder).toBeLessThan(6.2);
  });

  describe("instrument cues", () => {
    const melody = chapter("m", {
      ambience: [{ sound: "space", volume: 0.5 }],
      cues: [
        { at: 1, sound: "instr-piano", pitch: "A4", duration: 0.5 },
        { at: 2, sound: "instr-flute", pitch: "C4", duration: 1, volume: 0.6 },
        { at: 3, sound: "instr-snare" },
        { at: 4, sound: "chime" },
      ],
    });

    it("plays notes at the equal-tempered frequency, effects as effects", () => {
      const { out, d } = setup(false);
      d.load(melody);
      for (let t = 0; t <= 5; t += 0.05) d.update({ t, playing: true, speaking: false });
      expect(out.notes.map((n) => n.sound)).toEqual(["instr-piano", "instr-flute", "instr-snare"]);
      expect(out.notes[0]!.freq).toBeCloseTo(440, 6);
      expect(out.notes[1]!.freq).toBeCloseTo(261.6256, 3);
      expect(out.notes[1]).toMatchObject({ duration: 1, volume: 0.6 });
      expect(out.notes[2]).toMatchObject({ freq: null, duration: undefined, volume: 1 });
      expect(out.played.map((p) => p.sound)).toEqual(["chime"]);
    });

    it("a note crossing a seek is not replayed, and notes in flight are cut on seek and pause", () => {
      const { out, d } = setup(false);
      d.load(melody);
      const stopsAfterLoad = out.stops;
      for (let t = 0; t <= 1.2; t += 0.05) d.update({ t, playing: true, speaking: false });
      expect(out.notes).toHaveLength(1);
      d.update({ t: 0.5, playing: true, speaking: false }); // seek back before the note
      expect(out.stops).toBe(stopsAfterLoad + 1);
      d.update({ t: 3.5, playing: true, speaking: false }); // seek forward over two notes
      expect(out.notes).toHaveLength(1);
      for (let t = 3.5; t <= 3.7; t += 0.05) d.update({ t, playing: true, speaking: false });
      d.update({ t: 3.7, playing: false, speaking: false }); // pause
      expect(out.stops).toBe(stopsAfterLoad + 2);
      for (let t = 0.5; t <= 1.2; t += 0.05) d.update({ t, playing: true, speaking: false });
      expect(out.notes).toHaveLength(2); // replayed only when crossed again by continuous play
    });

    it("notes are not ducked by the voice; Suoni off silences them; background music is muted in a notes chapter", () => {
      const out = new RecordingOut();
      const d = new AudioDirector(out, { track: "music-calm" });
      d.load(melody);
      d.update({ t: 0.95, playing: true, speaking: true });
      d.update({ t: 1.05, playing: true, speaking: true });
      expect(out.notes).toHaveLength(1);
      expect(out.music.track).toBeNull();
      d.setSounds(false);
      d.update({ t: 1.95, playing: true, speaking: false });
      d.update({ t: 2.05, playing: true, speaking: false });
      expect(out.notes).toHaveLength(1);
      d.load(a); // a chapter without notes brings the music back
      d.update({ t: 0, playing: true, speaking: false });
      expect(out.music.track).toBe("music-calm");
    });
  });

  describe("instrument cues supplied by the engine (music engine sliders)", () => {
    const song = chapter("song", {
      ambience: [{ sound: "space" }],
      cues: [
        { at: 1, sound: "instr-piano", pitch: "C4" },
        { at: 2, sound: "instr-piano", pitch: "D4" },
        { at: 2.5, sound: "chime" },
      ],
    });
    /** The engine's cues for a tempo: one note per beat starting at t = 1. */
    const beats = (bpm: number, pitch = "C4") => [0, 1, 2, 3].map((k) => ({ at: 1 + (k * 60) / bpm, sound: "instr-flute", pitch }));
    const play = (d: AudioDirector, from: number, to: number) => {
      for (let t = from; t <= to + 1e-9; t += 0.05) d.update({ t, playing: true, speaking: false });
    };

    it("replace the chapter's instrument cues; effects still come from the scene", () => {
      const { out, d } = setup(false);
      d.load(song);
      d.setInstrumentCues(beats(60));
      play(d, 0, 4.5);
      expect(out.notes.map((n) => n.sound)).toEqual(["instr-flute", "instr-flute", "instr-flute", "instr-flute"]);
      expect(out.played.map((p) => p.sound)).toEqual(["chime"]);
      d.setInstrumentCues(null); // back to the scene's notes
      d.load(song);
      play(d, 0, 2.2);
      expect(out.notes.slice(4).map((n) => n.sound)).toEqual(["instr-piano", "instr-piano"]);
    });

    it("moving the tempo slider changes when the notes fire", () => {
      const fireTimes = (bpm: number) => {
        const { out, d } = setup(false);
        d.load(song);
        d.setInstrumentCues(beats(bpm));
        const at: number[] = [];
        for (let t = 0; t <= 6; t += 0.05) {
          const n = out.notes.length;
          d.update({ t, playing: true, speaking: false });
          if (out.notes.length > n) at.push(Math.round(t * 20) / 20);
        }
        return at;
      };
      const near = (got: number[], want: number[]) => {
        expect(got).toHaveLength(want.length);
        got.forEach((g, i) => expect(Math.abs(g - want[i]!)).toBeLessThanOrEqual(0.051));
      };
      near(fireTimes(60), [1, 2, 3, 4]);
      near(fireTimes(120), [1, 1.5, 2, 2.5]);
    });

    it("a slider change mid-play neither replays passed notes nor bursts; a seek never replays", () => {
      const { out, d } = setup(false);
      d.load(song);
      d.setInstrumentCues(beats(60));
      play(d, 0, 2.2); // notes at 1 and 2
      expect(out.notes).toHaveLength(2);
      d.setInstrumentCues(beats(120, "G4")); // now at 1, 1.5, 2, 2.5: the first three are already behind
      play(d, 2.25, 2.7);
      expect(out.notes.map((n) => n.freq?.toFixed(1))).toEqual(["261.6", "261.6", "392.0"]);
      d.update({ t: 0.5, playing: true, speaking: false }); // seek back
      d.update({ t: 3, playing: true, speaking: false }); // seek forward over everything
      expect(out.notes).toHaveLength(3);
    });
  });
});

describe("engine sounds and word cues (storybook)", () => {
  const play = (d: AudioDirector, from: number, to: number) => {
    for (let t = from; t <= to + 1e-9; t += 0.05) d.update({ t, playing: true, speaking: false });
  };
  const dev = () =>
    SceneSpec.parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/public/scenes/_dev-storie.scene.json"), "utf8")));

  async function story() {
    const spec = dev();
    const engine = createStorybookEngine();
    await engine.build({ root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("none")) }, spec);
    const ch = spec.chapters[0]!;
    const words = engine.sounds!(ch.id)!.words;
    const out = new RecordingOut();
    const d = new AudioDirector(out, undefined);
    d.load(ch, engine.sounds!(ch.id));
    const tts = new FakeTts(() => 1);
    const pb = new Playback(tts, {});
    pb.load(ch);
    return { spec, ch, words, out, d, tts, pb };
  }

  /** Runs the playback in 50 ms frames, returning [t, spoken sentences] at each play() call. */
  function drive(s: Awaited<ReturnType<typeof story>>, seconds: number, hits: { t: number; spoken: number; sound: string }[], fromPlaying = true) {
    if (fromPlaying) s.pb.play();
    for (let i = 0; i < seconds * 20; i++) {
      s.pb.tick(0.05);
      s.tts.tick(0.05);
      const n = s.out.played.length;
      s.d.update({ t: s.pb.t, playing: s.pb.playing, speaking: s.tts.speaking !== null });
      for (let k = n; k < s.out.played.length; k++) hits.push({ t: s.pb.t, spoken: s.tts.spoken.length, sound: s.out.played[k]!.sound });
    }
  }

  it("a word cue fires on its word, before the next sentence", async () => {
    const s = await story();
    const cue = s.words.find((w) => w.sentence === 0 && w.word === 2)!;
    const next = s.ch.narration[1]!.at;
    expect(cue.cue.at).toBeGreaterThan(0);
    const hits: { t: number; spoken: number; sound: string }[] = [];
    drive(s, 8, hits);
    const hit = hits.find((h) => h.sound === cue.cue.sound)!;
    expect(hit).toBeDefined();
    expect(hit.t).toBeGreaterThanOrEqual(cue.cue.at - 1e-9);
    expect(hit.t).toBeLessThan(next);
    expect(hit.spoken).toBe(1);
  });

  it("a slow voice: the cue never fires after the next sentence starts", async () => {
    const s = await story();
    const tts = new FakeTts(() => 9); // each sentence outlasts its slot: the clock freezes at the next `at`
    const pb = new Playback(tts, {});
    pb.load(s.ch);
    const slow = { ...s, tts, pb };
    const cue = s.words.find((w) => w.sentence === 0 && w.word === 2)!;
    const hits: { t: number; spoken: number; sound: string }[] = [];
    drive(slow, 12, hits);
    const hit = hits.find((h) => h.sound === cue.cue.sound)!;
    expect(hit).toBeDefined();
    expect(hit.spoken).toBe(1);
    expect(hit.t).toBeLessThanOrEqual(s.ch.narration[1]!.at);
  });

  it("seek back and replay: a word cue fires once per pass", async () => {
    const s = await story();
    const cue = s.words.find((w) => w.sentence === 0 && w.word === 2)!;
    const hits: { t: number; spoken: number; sound: string }[] = [];
    const count = () => hits.filter((h) => h.sound === cue.cue.sound && Math.abs(h.t - cue.cue.at) < 0.3).length;
    drive(s, 4.5, hits);
    expect(count()).toBe(1);
    s.pb.pause();
    s.pb.seek(0);
    s.d.update({ t: 0, playing: false, speaking: false });
    drive(s, 4.5, hits);
    expect(count()).toBe(2);
  });

  it("engines without the hooks behave as before", () => {
    const run = (extra?: null) => {
      const out = new RecordingOut();
      const d = new AudioDirector(out, { track: "music-calm" });
      d.load(a, extra);
      play(d, 0, 6);
      return { played: out.played, loops: [...out.loops], preloaded: out.preloaded };
    };
    expect(run(null)).toEqual(run(undefined));
  });

  it("engine ambience and cues are added to the chapter's own", () => {
    const out = new RecordingOut();
    const d = new AudioDirector(out, undefined);
    d.load(a, { ambience: [{ sound: "birds" }], cues: [{ at: 2, sound: "pop" }], words: [{ sentence: 0, word: 1, cue: { at: 3, sound: "boing" } }] });
    play(d, 0, 4.5);
    expect(out.played.map((p) => p.sound)).toEqual(["whoosh", "pop", "boing", "thunder"]);
    expect([...out.loops.keys()].sort()).toEqual(["birds", "sea"]);
    expect(out.preloaded).toEqual(expect.arrayContaining(["birds", "pop", "boing"]));
  });
});
