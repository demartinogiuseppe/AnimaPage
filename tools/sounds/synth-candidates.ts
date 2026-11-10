// Renders the storybook's synthesised sounds OFFLINE into extra listening candidates, through the same
// processing rules as real downloads (processFile: trim, -3 dBFS peak / RMS -22 loops, OGG mono 32 kHz).
// Files are candidates/<theme>/<group>-s<n>.ogg and rows are appended to <theme>.json; real files, real rows
// and *.decisions.json are never touched. Re-running replaces only the -s<n> files and the synth rows.
// Usage: pnpm sounds:synth
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORY_LIBRARY } from "../../packages/engine/src/engines/storybook/library.ts";
import { prng, synthesize, type Synth } from "../../packages/engine/src/player/audio/synth.ts";
import { STORY_SOUND_GROUPS } from "../../packages/scene-spec/src/storybook-sounds.ts";
import { CANDIDATES_DIR, isMain, type CandidateRow, type Decisions } from "./common.ts";
import { processFile } from "./process.ts";

const RATE = 32000;
const TAU = Math.PI * 2;
export const SYNTH_SOURCE = "synth (AnimaPage)";
const SYNTH_FILE = /-s\d+\.ogg$/;

/** Themes whose groups without a kept real sound get synth candidates. */
const THEMES = new Set(["sea", "transport", "animals", "cartoon", "magic", "music"]);
/** Groups that get synth variants even when a real sound exists (more choice for the listener). */
const EXTRA = new Set(["boing", "pop", "slide-whistle", "xylophone-up", "xylophone-down", "sparkle", "ta-da", "train-whistle", "whale-spout", "wind-soft"]);

type Render = () => Float32Array;
type Note = { hz: number; at: number };

/** The engine's own synth (packages/engine/src/player/audio/synth.ts), rendered at the candidate rate. */
const lib = (s: Synth, seed = 1): Render => () => synthesize(s, RATE, seed);

/** Pitch sweep with an exponential decay and optional vibrato: pops and springs. */
const sweep = (f0: number, f1: number, dur: number, decay: number, vib?: [rate: number, depth: number]): Render => () => {
  const out = new Float32Array(Math.round(dur * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const hz = (f0 + (f1 - f0) * (t / dur)) * (1 + (vib ? vib[1] * Math.sin(TAU * vib[0] * t) : 0));
    phase += (TAU * hz) / RATE;
    out[i] = Math.sin(phase) * Math.exp(-t * decay) * Math.min(1, t * 400);
  }
  return out;
};

/** Soft bars: a sine plus a quiet, quickly fading upper partial, each note starting at `at` seconds. */
const notes = (list: Note[], decay: number, tail: number): Render => () => {
  const last = Math.max(...list.map((n) => n.at));
  const out = new Float32Array(Math.round((last + tail) * RATE));
  for (const n of list)
    for (let i = Math.round(n.at * RATE); i < out.length; i++) {
      const t = i / RATE - n.at;
      out[i]! += (Math.sin(TAU * n.hz * t) + 0.25 * Math.sin(TAU * n.hz * 3 * t) * Math.exp(-t * 20)) * Math.exp(-t * decay) * Math.min(1, t * 300);
    }
  return out;
};

/** One-pole low-passed noise, deterministic. */
function lowNoise(n: number, fc: number, seed: number): Float32Array {
  const rnd = prng(seed);
  const a = Math.exp((-TAU * fc) / RATE);
  let y = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = y = (1 - a) * (rnd() * 2 - 1) + a * y;
  return out;
}

/** A breath of water: low-passed noise that swells for `attack` s, then fades. */
const puff = (dur: number, fc: number, attack: number, decay: number): Render => () => {
  const out = lowNoise(Math.round(dur * RATE), fc, 5);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i]! *= Math.min(1, t / attack) * Math.exp(-Math.max(0, t - attack) * decay);
  }
  return out;
};

/** Soft wind loop: 12 s of low-passed noise, every gust a whole number of cycles so it loops. */
const gust = (fc: number, k1: number, k2: number): Render => () => {
  const dur = 12;
  const out = lowNoise(dur * RATE, fc, 100 + k1 * 7 + k2);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i]! *= 0.55 + 0.45 * Math.sin((TAU * k1 * t) / dur) * Math.sin((TAU * k2 * t) / dur + 1);
  }
  return out;
};

const scale = (root: number, semis: number[], step: number): Note[] => semis.map((s, i) => ({ hz: root * 2 ** (s / 12), at: i * step }));
const chord = (root: number, at: number): Note[] => [0, 4, 7].map((s) => ({ hz: root * 2 ** (s / 12), at }));
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const PENTA = [0, 2, 4, 7, 9, 12];
const rev = (a: number[]): number[] => [...a].reverse();

/** Explicit, gentle variants (nothing piercing, no buzzers) for the groups the brief names. */
const VARIANTS: Record<string, Render[]> = {
  boing: [lib({ kind: "boing", f: 440 }), lib({ kind: "boing", f: 800 }), sweep(330, 130, 0.7, 4, [12, 0.12])],
  pop: [sweep(700, 250, 0.16, 38), sweep(480, 190, 0.28, 18), sweep(1000, 420, 0.1, 60)],
  "slide-whistle": [lib({ kind: "slide", f: 300 }), lib({ kind: "slide", f: 420 }), lib({ kind: "slide", f: 560 })],
  "xylophone-up": [notes(scale(523.25, MAJOR.slice(0, 5), 0.11), 6, 0.9), notes(scale(392, PENTA, 0.14), 5, 1.1), notes(scale(261.63, MAJOR, 0.08), 7, 0.8)],
  "xylophone-down": [
    notes(scale(523.25, rev(MAJOR.slice(0, 5)), 0.11), 6, 0.9),
    notes(scale(392, rev(PENTA), 0.14), 5, 1.1),
    notes(scale(261.63, rev(MAJOR), 0.08), 7, 0.8),
  ],
  sparkle: [lib({ kind: "sparkle", f: 262 }), lib({ kind: "sparkle", f: 330 }), lib({ kind: "sparkle", f: 392 })],
  "ta-da": [
    notes([{ hz: 392, at: 0 }, ...chord(523.25, 0.2)], 3, 1.2),
    notes([...scale(523.25, [0, 4, 7], 0.1), ...chord(523.25, 0.35)], 3.5, 1.4),
    notes([...chord(261.63, 0), ...chord(392, 0.18), ...chord(523.25, 0.4)], 2.5, 1.5),
  ],
  "train-whistle": [lib({ kind: "whistle-train", f: 392 }), lib({ kind: "whistle-train", f: 466 }), lib({ kind: "whistle-train", f: 330 })],
  "whale-spout": [lib({ kind: "whoosh" }), puff(1.0, 600, 0.15, 3), puff(0.5, 1200, 0.05, 6)],
  "wind-soft": [gust(350, 1, 2), gust(700, 2, 3), gust(1100, 1, 3)],
};

/** Peak 0.8, like the engine's own synth: overlapping notes must not hit the clipping rejection. */
function headroom(x: Float32Array): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i]! *= 0.8 / m;
  return x;
}

/** Library loops are one seamless loop; tile them to reach the 8-20 s a story loop needs. */
function tile(x: Float32Array, minSec: number): Float32Array {
  const n = Math.ceil((minSec * RATE) / x.length);
  const out = new Float32Array(x.length * n);
  for (let k = 0; k < n; k++) out.set(x, k * x.length);
  return out;
}

/** 32-bit float mono WAV, so processFile (which reads files with ffmpeg) can take the samples. */
function wav(samples: Float32Array): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(32, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Groups of this theme that have at least one kept real (non-synth) candidate. */
function keptReal(dir: string, theme: string): Set<string> {
  const sheet = join(dir, `${theme}.json`);
  const decPath = join(dir, `${theme}.decisions.json`);
  if (!existsSync(sheet) || !existsSync(decPath)) return new Set();
  const dec = JSON.parse(readFileSync(decPath, "utf8")) as Decisions;
  const rows = JSON.parse(readFileSync(sheet, "utf8")) as CandidateRow[];
  return new Set(rows.filter((r) => r.file && r.source !== SYNTH_SOURCE && dec[r.file] === "keep").map((r) => r.group));
}

/**
 * Renders the synth candidates into `dir`. `only` limits the groups (tests). Returns the new rows.
 * Existing real rows and files and the decisions are left as they are.
 */
export function runSynth(dir: string, only?: string[]): { rows: CandidateRow[] } {
  const tmp = mkdtempSync(join(tmpdir(), "synth-cand-"));
  const added: CandidateRow[] = [];
  try {
    const byTheme = new Map<string, CandidateRow[]>();
    for (const g of STORY_SOUND_GROUPS) {
      if (only && !only.includes(g.id)) continue;
      if (!THEMES.has(g.theme) && !EXTRA.has(g.id)) continue;
      if (!EXTRA.has(g.id) && keptReal(dir, g.theme).has(g.id)) continue;
      const renders = VARIANTS[g.id] ?? Object.values(STORY_LIBRARY).filter((v) => v.group === g.id).map((v) => lib(v.synth));
      renders.forEach((render, i) => {
        const rel = `${g.theme}/${g.id}-s${i + 1}.ogg`;
        const x = headroom(g.kind === "ambience" ? tile(render(), 10) : render());
        const raw = join(tmp, `${g.id}-${i + 1}.wav`);
        writeFileSync(raw, wav(x));
        mkdirSync(join(tmp, g.theme), { recursive: true });
        const res = processFile(raw, g.kind, join(tmp, rel));
        const row: CandidateRow = { group: g.id, file: res.reason ? "" : rel, source: SYNTH_SOURCE, author: "AnimaPage", licence: "CC0 (own work)", dur: res.dur, peakDb: res.peakDb, rmsDb: res.rmsDb };
        if (res.reason) row.reason = res.reason;
        (byTheme.get(g.theme) ?? byTheme.set(g.theme, []).get(g.theme)!).push(row);
        added.push(row);
      });
    }
    for (const [theme, rows] of byTheme) {
      const sheet = join(dir, `${theme}.json`);
      const old = existsSync(sheet) ? (JSON.parse(readFileSync(sheet, "utf8")) as CandidateRow[]) : [];
      // Only this tool's rows and files of the groups rendered now are replaced.
      const regen = new Set(rows.map((r) => r.group));
      const keepRows = old.filter((r) => !(r.source === SYNTH_SOURCE && regen.has(r.group)));
      mkdirSync(join(dir, theme), { recursive: true });
      for (const f of readdirSync(join(dir, theme))) if (SYNTH_FILE.test(f) && regen.has(f.replace(SYNTH_FILE, ""))) rmSync(join(dir, theme, f));
      for (const r of rows) if (r.file) writeFileSync(join(dir, r.file), readFileSync(join(tmp, r.file)));
      writeFileSync(sheet, JSON.stringify([...keepRows, ...rows], null, 2) + "\n");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { rows: added };
}

if (isMain(import.meta.url)) {
  try {
    const { rows } = runSynth(CANDIDATES_DIR);
    for (const r of rows) console.log(`${r.reason ? "reject" : "ok    "} ${r.group}  ${r.file || "-"}  ${r.dur}s  peak ${r.peakDb}  rms ${r.rmsDb}${r.reason ? `  ${r.reason}` : ""}`);
    console.log(`\n${rows.filter((r) => !r.reason).length} synth candidates ok, ${rows.filter((r) => r.reason).length} rejected`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
