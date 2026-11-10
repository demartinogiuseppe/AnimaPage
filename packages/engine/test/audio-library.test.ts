import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkScene, checkSoundIds, pitchToFrequency, pitchToMidi, SceneSpec, SOUND_CATALOG, SOUND_IDS } from "@pv/scene-spec";
import { INSTRUMENTS, releaseTime, renderNote, type InstrumentKind } from "../src/player/audio/instruments.ts";
import { SOUND_LIBRARY, soundFile } from "../src/player/audio/library.ts";
import { isLoopKind, synthesize } from "../src/player/audio/synth.ts";

const PUBLIC = resolve(import.meta.dirname, "../../../fixtures/public");
const SCENES = ["campania", "troia", "timeline-esempio", "card-esempio", "racconto-elettricista", "scienze-sensi", "grammatica-indicativo", "cielo-stagioni", "musica-pentagramma", "geometria-solidi", "terra-sezione"];

describe("sound catalog and library", () => {
  it("has unique ids and covers ambience, effects and 3-6 music tracks", () => {
    expect(new Set(SOUND_IDS).size).toBe(SOUND_IDS.length);
    const n = (c: string) => SOUND_CATALOG.filter((s) => s.category === c).length;
    expect(n("ambience")).toBeGreaterThanOrEqual(15);
    expect(n("sfx")).toBeGreaterThanOrEqual(25);
    expect(n("music")).toBeGreaterThanOrEqual(3);
    expect(n("music")).toBeLessThanOrEqual(6);
    for (const s of SOUND_CATALOG) {
      expect(s.it.length, s.id).toBeGreaterThan(2);
      expect(s.en.length, s.id).toBeGreaterThan(2);
      expect(s.tags.length, s.id).toBeGreaterThan(0);
    }
  });

  it("every catalog id plays something: a file on disk or a procedural sound", () => {
    expect([...Object.keys(SOUND_LIBRARY), ...Object.keys(INSTRUMENTS)].sort()).toEqual([...SOUND_IDS].sort());
    for (const id of Object.keys(INSTRUMENTS)) expect(SOUND_CATALOG.find((s) => s.id === id)?.category, id).toBe("instrument");
    for (const id of Object.keys(SOUND_LIBRARY)) {
      const src = SOUND_LIBRARY[id]!;
      if (src.file) expect(existsSync(resolve(PUBLIC, soundFile(id))), `${id} file`).toBe(true);
      const data = synthesize(src.synth, 8000, 3);
      expect(data.length, id).toBeGreaterThan(100);
      expect(data.every(Number.isFinite), id).toBe(true);
      expect(data.reduce((m, v) => Math.max(m, Math.abs(v)), 0), id).toBeGreaterThan(0.05);
    }
  });

  it("procedural loops are used for loops and one-shots for effects", () => {
    for (const s of SOUND_CATALOG.filter((x) => x.category !== "instrument")) {
      expect(isLoopKind(SOUND_LIBRARY[s.id]!.synth.kind), s.id).toBe(s.category !== "sfx");
    }
  });

  it("no stray audio files and the folder stays within the 15 MB budget", () => {
    // Files only: audio/storybook/ is the storybook theatre's own library, with its own budget (storybook-library.test.ts).
    const files = readdirSync(resolve(PUBLIC, "audio"), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
    const ids = new Set(SOUND_IDS.filter((id) => SOUND_LIBRARY[id]?.file).map((id) => `${id}.ogg`));
    expect(files.filter((f) => !ids.has(f))).toEqual([]);
    const total = files.reduce((s, f) => s + statSync(resolve(PUBLIC, "audio", f)).size, 0);
    expect(total).toBeLessThan(15 * 1024 * 1024);
  });

  it("loops synthesized procedurally are seamless (no jump at the loop point)", () => {
    for (const kind of ["wind", "sea", "rain", "fire", "rumble", "hum", "space", "room"] as const) {
      const x = synthesize({ kind }, 8000, 1);
      const jump = Math.abs(x[0]! - x[x.length - 1]!);
      let typical = 0;
      for (let i = 1; i < x.length; i++) typical = Math.max(typical, Math.abs(x[i]! - x[i - 1]!));
      expect(jump, kind).toBeLessThanOrEqual(typical + 1e-6);
    }
  });
});

/** Dominant frequency of x near `around` (Hz): scans a windowed DFT over +-8% in 0.05% steps. */
function peakNear(x: Float32Array, sr: number, around: number, from: number, len: number): number {
  const seg = x.subarray(from, from + len);
  let best = 0;
  let bestF = 0;
  for (let f = around * 0.92; f <= around * 1.08; f *= 1.0005) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * f) / sr;
    for (let i = 0; i < seg.length; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / seg.length);
      re += seg[i]! * h * Math.cos(w * i);
      im += seg[i]! * h * Math.sin(w * i);
    }
    const m = re * re + im * im;
    if (m > best) [best, bestF] = [m, f];
  }
  return bestF;
}

describe("pitch and instruments", () => {
  it("parses scientific pitch to MIDI and equal-tempered frequency (A4 = 440 Hz)", () => {
    expect(pitchToMidi("A4")).toBe(69);
    expect(pitchToMidi("C4")).toBe(60);
    expect(pitchToMidi("F#3")).toBe(54);
    expect(pitchToMidi("Bb2")).toBe(46);
    expect(pitchToMidi("H4")).toBeNull();
    expect(pitchToMidi("C9")).toBeNull();
    expect(pitchToFrequency("A4")).toBe(440);
    expect(pitchToFrequency("A5")).toBeCloseTo(880, 9);
    expect(pitchToFrequency("C4")).toBeCloseTo(261.6256, 3);
    expect(pitchToFrequency("Bb2")).toBeCloseTo(116.5409, 3);
  });

  it.each(["piano", "flute", "violin", "clarinet", "xylophone", "guitar"] as const)("%s is in tune (E2, A4, C6 within 0.3 percent)", (kind) => {
    const sr = 32000;
    for (const p of ["A4", "E2", "C6"]) {
      const f = pitchToFrequency(p)!;
      const x = renderNote(kind, f, 0.6, sr);
      const from = kind === "violin" || kind === "flute" ? 4000 : 400;
      const len = f < 100 ? 12000 : 6000;
      expect(Math.abs(peakNear(x, sr, f, from, len) / f - 1), `${kind} ${p}`).toBeLessThan(0.003);
    }
  });

  it.each(Object.values(INSTRUMENTS))("%s: finite, audible, length = held time + release, silent at the end", (kind: InstrumentKind) => {
    const sr = 16000;
    const x = renderNote(kind, 440, 0.4, sr);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeGreaterThan(0.5);
    expect(x.length / sr).toBeLessThanOrEqual(0.4 + releaseTime(kind) + 0.21);
    expect(Math.abs(x[x.length - 1]!)).toBeLessThan(1e-3);
  });

  it("sustained instruments last as long as the note is held, then release", () => {
    const sr = 16000;
    for (const kind of ["flute", "violin", "clarinet"] as const) {
      const x = renderNote(kind, 440, 1.5, sr);
      const rms = (a: number, b: number) => {
        const s = x.subarray(Math.round(a * sr), Math.round(b * sr));
        return Math.sqrt(s.reduce((acc, v) => acc + v * v, 0) / s.length);
      };
      expect(rms(1.3, 1.45), kind).toBeGreaterThan(rms(0.3, 0.45) * 0.7);
      expect(rms(1.5 + releaseTime(kind) * 0.7, 1.5 + releaseTime(kind)), kind).toBeLessThan(rms(1.3, 1.45) * 0.2);
    }
  });
});

describe("checkSoundIds", () => {
  it("reports unknown ids, wrong categories and reversed windows", () => {
    const issues = checkSoundIds({
      chapters: [
        {
          sounds: {
            ambience: [{ sound: "sea" }, { sound: "nope" }, { sound: "chime" }, { sound: "fire", window: [5, 2] }],
            cues: [
              { at: 1, sound: "whoosh" },
              { at: 2, sound: "rain" },
              { at: 3, sound: "instr-piano", pitch: "F#3", duration: 0.5 },
              { at: 4, sound: "chime", pitch: "C4" },
              { at: 5, sound: "instr-flute", pitch: "H2" },
            ],
          },
        },
        {},
      ],
      music: { track: "sea" },
    });
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'chapters[0].sounds.ambience[1]: unknown sound id "nope"',
      'chapters[0].sounds.ambience[2]: sound "chime" is sfx, expected ambience',
      "chapters[0].sounds.ambience[3]: window ends before it starts",
      'chapters[0].sounds.cues[1]: sound "rain" is ambience, expected sfx or instrument',
      'chapters[0].sounds.cues[3]: pitch and duration are only for instrument sounds, not "chime"',
      'chapters[0].sounds.cues[4]: bad pitch "H2" (use e.g. C4, F#3, Bb2)',
      'music: sound "sea" is ambience, expected music',
    ]);
  });

  // Some scenes are left out of the public copy (tools/publish/exclude.txt): skipped when the file is absent.
  for (const name of SCENES) {
    it.skipIf(!existsSync(resolve(PUBLIC, `scenes/${name}.scene.json`)))(`${name}: has sounds, and still passes parse + checkScene with zero issues`, () => {
      const spec = SceneSpec.parse(JSON.parse(readFileSync(resolve(PUBLIC, `scenes/${name}.scene.json`), "utf8")));
      expect(checkScene(spec)).toEqual([]);
      expect(spec.music).toBeDefined();
      for (const ch of spec.chapters) {
        for (const c of ch.sounds?.cues ?? []) expect(c.at).toBeLessThanOrEqual(ch.duration);
        for (const a of ch.sounds?.ambience ?? []) if (a.window) expect(a.window[1]).toBeLessThanOrEqual(ch.duration);
      }
    });
  }
});
