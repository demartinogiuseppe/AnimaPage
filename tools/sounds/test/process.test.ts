import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StoryVariant } from "../../../packages/engine/src/engines/storybook/library.ts";
import { acceptCandidates } from "../accept.ts";
import { decode, processFile } from "../process.ts";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sounds-test-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}
/** 0.5 s silence + `sec` s of a 440 Hz sine (`vol` times the default amplitude) + 0.5 s silence, 16-bit WAV. */
function sineWav(name: string, sec: number, vol = 1, rate = 44100): string {
  const out = join(dir, name);
  ffmpeg([
    "-filter_complex",
    `anullsrc=r=${rate}:cl=mono:d=0.5[a];sine=f=440:r=${rate}:d=${sec},volume=${vol}[b];anullsrc=r=${rate}:cl=mono:d=0.5[c];[a][b][c]concat=n=3:v=0:a=1`,
    "-c:a", "pcm_s16le", out,
  ]);
  return out;
}
const db = (x: number) => 20 * Math.log10(x);
const peakOf = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rmsOf = (s: Float32Array) => Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length);

describe("sound processing", () => {
  it("silence is trimmed and effects peak at -3 dBFS", () => {
    const out = join(dir, "trim.ogg");
    const r = processFile(sineWav("trim.wav", 1), "sfx", out);
    expect(r.reason).toBeUndefined();
    expect(r.dur).toBeGreaterThan(0.95);
    expect(r.dur).toBeLessThan(1.06);
    expect(r.peakDb).toBeCloseTo(-3, 1);
    const decoded = decode(out, 32000);
    expect(decoded.length / 32000).toBeLessThan(1.1);
    expect(db(peakOf(decoded))).toBeGreaterThan(-4);
    expect(db(peakOf(decoded))).toBeLessThan(-2);
  });

  it("a clipped file is rejected with a reason", () => {
    const out = join(dir, "clip.ogg");
    const r = processFile(sineWav("clip.wav", 1, 12), "sfx", out);
    expect(r.reason).toMatch(/clipped/);
    expect(existsSync(out)).toBe(false);
  });

  it("a too-long effect is cut with a fade", () => {
    const out = join(dir, "long.ogg");
    const r = processFile(sineWav("long.wav", 6), "sfx", out);
    expect(r.reason).toBeUndefined();
    expect(r.dur).toBeGreaterThan(3.9);
    expect(r.dur).toBeLessThanOrEqual(4.05);
    const d = decode(out, 32000);
    const mid = rmsOf(d.subarray(32000, 64000));
    const tail = rmsOf(d.subarray(d.length - 800)); // last 25 ms, inside the 0.3 s fade
    expect(tail).toBeLessThan(mid * 0.3);
  });

  it("a recording far too long for an effect is rejected", () => {
    const r = processFile(sineWav("huge.wav", 150, 1, 4000), "sfx", join(dir, "huge.ogg"));
    expect(r.reason).toMatch(/too long/);
  });

  it("ambience becomes a 8-20 s loop at -22 dBFS RMS", () => {
    const out = join(dir, "amb.ogg");
    const r = processFile(sineWav("amb.wav", 30, 0.5), "ambience", out);
    expect(r.reason).toBeUndefined();
    expect(r.dur).toBeGreaterThanOrEqual(8);
    expect(r.dur).toBeLessThanOrEqual(20);
    expect(r.rmsDb).toBeCloseTo(-22, 0);
  });

  it("a stereo input is processed to mono", () => {
    const wav = join(dir, "stereo.wav");
    ffmpeg(["-f", "lavfi", "-i", "sine=f=440:d=1", "-ac", "2", "-c:a", "pcm_s16le", wav]);
    const r = processFile(wav, "sfx", join(dir, "stereo.ogg"));
    expect(r.reason).toBeUndefined();
    expect(r.peakDb).toBeCloseTo(-3, 1);
  });

  const hasMp3 = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout.includes("libmp3lame");
  it.skipIf(!hasMp3)("an mp3 input is processed", () => {
    const mp3 = join(dir, "in.mp3");
    ffmpeg(["-f", "lavfi", "-i", "sine=f=440:d=1", "-c:a", "libmp3lame", mp3]);
    const r = processFile(mp3, "sfx", join(dir, "mp3.ogg"));
    expect(r.reason).toBeUndefined();
    expect(r.dur).toBeGreaterThan(0.9);
  });

  it("a file that is silent is rejected", () => {
    const out = join(dir, "silent.wav");
    ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", "-c:a", "pcm_s16le", out]);
    expect(processFile(out, "sfx", join(dir, "silent.ogg")).reason).toMatch(/silent/);
  });
});

const BASE: Record<string, StoryVariant> = {
  "cat-meow-1": { group: "cat-meow", file: false, synth: { kind: "meow" }, dur: 0.7 },
  "cat-meow-2": { group: "cat-meow", file: false, synth: { kind: "meow", f: 520 }, dur: 0.7 },
  "dog-woof-1": { group: "dog-woof", file: false, synth: { kind: "thud" }, dur: 0.4 },
};

describe("accept", () => {
  it("accept checks the budget before touching anything and removes stale files after copying", () => {
    const root = mkdtempSync(join(tmpdir(), "sounds-accept2-"));
    try {
      const cand = join(root, "candidates");
      mkdirSync(join(cand, "animals"), { recursive: true });
      writeFileSync(join(cand, "animals", "cat-meow-1.ogg"), "x".repeat(100));
      const row = { group: "cat-meow", file: "animals/cat-meow-1.ogg", source: "s", author: "a", licence: "CC0", dur: 1, peakDb: -3, rmsDb: -20 };
      writeFileSync(join(cand, "animals.json"), JSON.stringify([row]));
      writeFileSync(join(cand, "animals.decisions.json"), JSON.stringify({ "animals/cat-meow-1.ogg": "keep" }));
      const audioDir = join(root, "audio");
      mkdirSync(audioDir);
      writeFileSync(join(audioDir, "cat-meow-3.ogg"), "stale");
      writeFileSync(join(audioDir, "dog-woof-1.ogg"), "d".repeat(50));
      const o = { candidatesDir: cand, audioDir, libraryPath: join(root, "lib.ts"), docPath: join(root, "d.md"), baseLibrary: BASE };
      expect(() => acceptCandidates({ ...o, budgetBytes: 120 })).toThrow(/150 bytes.*budget/);
      expect(existsSync(join(audioDir, "cat-meow-1.ogg"))).toBe(false);
      expect(existsSync(join(audioDir, "cat-meow-3.ogg"))).toBe(true);
      expect(existsSync(o.libraryPath)).toBe(false);
      acceptCandidates({ ...o, budgetBytes: 1000 });
      expect(existsSync(join(audioDir, "cat-meow-1.ogg"))).toBe(true);
      expect(existsSync(join(audioDir, "cat-meow-3.ogg"))).toBe(false);
      expect(existsSync(join(audioDir, "dog-woof-1.ogg"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accept writes the library entry and the licence row", () => {
    const root = mkdtempSync(join(tmpdir(), "sounds-accept-"));
    try {
      const cand = join(root, "candidates");
      mkdirSync(join(cand, "animals"), { recursive: true });
      for (const n of [1, 2]) writeFileSync(join(cand, "animals", `cat-meow-${n}.ogg`), `fake-ogg-${n}`);
      const row = (n: number) => ({
        group: "cat-meow", file: `animals/cat-meow-${n}.ogg`, source: `https://example.test/cat${n}`,
        author: "Jane Doe", licence: "CC0", dur: 0.8, peakDb: -3, rmsDb: -20,
      });
      writeFileSync(join(cand, "animals.json"), JSON.stringify([row(1), row(2)]));
      writeFileSync(join(cand, "animals.decisions.json"), JSON.stringify({ "animals/cat-meow-1.ogg": "discard", "animals/cat-meow-2.ogg": "keep" }));
      const audioDir = join(root, "audio");
      const libraryPath = join(root, "library.ts");
      const docPath = join(root, "assets.md");
      writeFileSync(docPath, "# Storybook audio\n");
      const res = acceptCandidates({ candidatesDir: cand, audioDir, libraryPath, docPath, baseLibrary: BASE });
      expect(res.accepted).toEqual(["cat-meow-1"]);
      expect(readFileSync(join(audioDir, "cat-meow-1.ogg"), "utf8")).toBe("fake-ogg-2");
      const lib = readFileSync(libraryPath, "utf8");
      expect(lib).toContain(`"cat-meow-1": { group: "cat-meow", file: true, synth: { kind: "meow" }, dur: 0.7 },`);
      expect(lib).not.toContain("cat-meow-2");
      expect(lib).toContain(`"dog-woof-1": { group: "dog-woof", file: false,`);
      const doc = readFileSync(docPath, "utf8");
      expect(doc).toMatch(/\| cat-meow-1 \| cat-meow \|.*Jane Doe.*CC0.*https:\/\/example\.test\/cat2/);
      // the dropped candidate never reached the fixtures dir
      expect(existsSync(join(root, "audio", "cat-meow-2.ogg"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
