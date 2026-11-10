// Synthesized instruments: one note rendered to samples at any frequency and length.
// Plain sample math (no WebAudio), so tuning and envelopes are unit-tested in node.
// Tuning comes from the cue's pitch via pitchToFrequency (A4 = 440 Hz, equal temperament).
import { prng } from "./synth.ts";

export type InstrumentKind = "piano" | "flute" | "violin" | "clarinet" | "xylophone" | "guitar" | "drum" | "snare" | "hihat" | "bell";

/** Catalog id -> instrument. */
export const INSTRUMENTS: Readonly<Record<string, InstrumentKind>> = {
  "instr-piano": "piano",
  "instr-flute": "flute",
  "instr-violin": "violin",
  "instr-clarinet": "clarinet",
  "instr-xylophone": "xylophone",
  "instr-guitar": "guitar",
  "instr-drum": "drum",
  "instr-snare": "snare",
  "instr-hihat": "hihat",
  "instr-bell": "bell",
};

/** Used when a cue has no pitch: C4 for tuned instruments, a low A1 for the kick. */
export const DEFAULT_FREQUENCY = 261.6255653005986;
export const DEFAULT_DURATION = 0.5;

/** Percussion ignores the pitch (the kick uses it to tune its body when given). */
const UNPITCHED: ReadonlySet<InstrumentKind> = new Set(["snare", "hihat"]);

/** Seconds the note keeps sounding after its duration (release / natural decay). */
export function releaseTime(kind: InstrumentKind): number {
  switch (kind) {
    case "piano":
      return 0.35;
    case "flute":
    case "clarinet":
      return 0.12;
    case "violin":
      return 0.18;
    case "guitar":
      return 0.25;
    case "xylophone":
      return 0.6;
    case "bell":
      return 2.5;
    case "drum":
      return 0.45;
    case "snare":
      return 0.25;
    case "hihat":
      return 0.08;
  }
}

/** Percussive instruments decay on their own: the note length only cuts them shorter. */
const PERCUSSIVE: ReadonlySet<InstrumentKind> = new Set(["xylophone", "drum", "snare", "hihat", "bell"]);

const TAU = Math.PI * 2;

/**
 * Renders one note (mono, peak about 0.8). `duration` is how long the key is held, in seconds;
 * the buffer also holds the release. Deterministic for a given (kind, f, duration).
 */
export function renderNote(kind: InstrumentKind, f: number, duration: number, sr: number): Float32Array {
  const held = Math.max(0.02, duration);
  const total = PERCUSSIVE.has(kind) ? Math.min(held, 0.05) + releaseTime(kind) + (kind === "bell" ? held * 0.5 : 0) : held + releaseTime(kind);
  const n = Math.max(1, Math.round(total * sr));
  const out = kind === "guitar" ? pluck(f, held, n, sr) : new Float32Array(n);
  const rnd = prng(Math.round(f * 100) + n);
  const nyq = sr / 2;
  /** Sustain envelope: attack, hold until `held`, then exponential release. */
  const env = (t: number, attack: number) => {
    const a = Math.min(1, t / attack);
    return t <= held ? a : a * Math.exp(-(t - held) / (releaseTime(kind) / 4));
  };
  if (kind === "guitar") return finish(out, sr);

  let noiseLp = 0;
  /** Phase of the fundamental, integrated sample by sample so vibrato bends the pitch around f. */
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    switch (kind) {
      case "piano": {
        // Slightly inharmonic partials (stiff string), higher partials decay faster; hammer thump at onset.
        const B = 0.0004;
        const decay = 1.6 * Math.pow(261.6 / f, 0.35);
        for (let k = 1; k <= 10; k++) {
          const fk = k * f * Math.sqrt(1 + B * k * k);
          if (fk >= nyq) break;
          v += (Math.sin(TAU * fk * t) / Math.pow(k, 1.3)) * Math.exp((-t * (1 + 0.5 * k)) / decay);
        }
        v *= env(t, 0.004);
        if (t < 0.01) v += (rnd() * 2 - 1) * 0.15 * (1 - t / 0.01);
        break;
      }
      case "flute": {
        const vib = t > 0.2 ? 1 + 0.004 * Math.sin(TAU * 5 * t) : 1;
        ph += (TAU * f * vib) / sr;
        noiseLp += 0.1 * (rnd() * 2 - 1 - noiseLp);
        v = (Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph) + 0.4 * noiseLp) * env(t, 0.06);
        break;
      }
      case "violin": {
        // Band-limited sawtooth shaped by two body resonances, delayed vibrato, slow bow attack.
        const vib = t > 0.25 ? 1 + 0.006 * Math.sin(TAU * 5.5 * t) : 1;
        ph += (TAU * f * vib) / sr;
        for (let k = 1; k <= 30; k++) {
          const fk = k * f;
          if (fk >= nyq) break;
          const body = 0.35 + Math.exp(-(((fk - 450) / 250) ** 2)) + 0.7 * Math.exp(-(((fk - 2800) / 900) ** 2));
          v += (Math.sin(k * ph) / k) * body;
        }
        v *= env(t, 0.12) * 0.6;
        break;
      }
      case "clarinet": {
        // Mostly odd harmonics (closed cylindrical bore).
        for (let k = 1; k <= 15; k++) {
          const fk = k * f;
          if (fk >= nyq) break;
          v += Math.sin(TAU * fk * t) * (k % 2 ? 1 / k : 0.04);
        }
        v *= env(t, 0.04);
        break;
      }
      case "xylophone": {
        // Tuned bar: fundamental plus a 4th-harmonic overtone, fast decay; mallet click.
        v = Math.sin(TAU * f * t) * Math.exp(-t / 0.35) + 0.4 * Math.sin(TAU * 4 * f * t) * Math.exp(-t / 0.08);
        if (t < 0.004) v += (rnd() * 2 - 1) * 0.3;
        v *= cut(t, held, 0.05);
        break;
      }
      case "bell": {
        // Risset's inharmonic bell partials, relative to the nominal pitch.
        const P = [0.56, 0.92, 1.19, 1.71, 2, 2.74, 3, 3.76, 4.07];
        const A = [1, 0.67, 1, 1.8, 2.67, 1.67, 1.46, 1.33, 1.33];
        const D = [1, 0.9, 0.65, 0.55, 0.325, 0.35, 0.25, 0.2, 0.15];
        const len = held * 0.5 + releaseTime(kind);
        for (let k = 0; k < P.length; k++) {
          if (P[k]! * f >= nyq) continue;
          v += A[k]! * Math.sin(TAU * P[k]! * f * t) * Math.exp(-t / (D[k]! * len * 0.5));
        }
        v *= Math.min(1, t / 0.002) * 0.25;
        break;
      }
      case "drum": {
        // Kick: sine with a fast downward pitch sweep and a click.
        const body = f === DEFAULT_FREQUENCY ? 55 : f;
        const ph = TAU * (body * t + ((body * 2) / 30) * (1 - Math.exp(-30 * t)));
        v = Math.sin(ph) * Math.exp(-t / 0.15) + (t < 0.003 ? (rnd() * 2 - 1) * 0.4 : 0);
        v *= cut(t, held, 0.05);
        break;
      }
      case "snare": {
        const w = rnd() * 2 - 1;
        noiseLp += 0.5 * (w - noiseLp);
        v = (w - noiseLp) * 1.2 * Math.exp(-t / 0.07) + Math.sin(TAU * 185 * t) * 0.5 * Math.exp(-t / 0.04);
        v *= cut(t, held, 0.05);
        break;
      }
      case "hihat": {
        // Highpassed noise; held longer than 0.3 s it rings like an open hi-hat.
        const w = rnd() * 2 - 1;
        noiseLp += 0.3 * (w - noiseLp);
        const tau = held > 0.3 ? 0.25 : 0.03;
        v = (w - noiseLp) * Math.exp(-t / tau);
        break;
      }
    }
    out[i] = v;
  }
  return finish(out, sr);
}

/** Percussion cut short by a short note: fade after `held` (never before the natural attack). */
function cut(t: number, held: number, fade: number): number {
  const end = Math.max(held, 0.05);
  return t <= end ? 1 : Math.max(0, 1 - (t - end) / fade) * Math.exp(-(t - end) / fade);
}

/**
 * Karplus-Strong plucked string. The loop delay is the fractional read delay (period - 0.5, linear
 * interpolation) plus the half sample of the two-point averaging filter, so it stays in tune.
 * Damped hard once the note is released.
 */
function pluck(f: number, held: number, n: number, sr: number): Float32Array {
  const out = new Float32Array(n);
  const period = sr / f;
  const size = Math.ceil(period) + 4;
  const line = new Float32Array(size);
  const rnd = prng(Math.round(f * 1000));
  let soft = 0;
  for (let i = 0; i < size; i++) line[i] = soft = 0.5 * (soft + (rnd() * 2 - 1)); // softened pick burst
  const D = period - 0.5;
  const heldN = Math.round(held * sr);
  let w = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let rp = w - D;
    while (rp < 0) rp += size;
    const i0 = Math.floor(rp);
    const fr = rp - i0;
    const y = line[i0 % size]! * (1 - fr) + line[(i0 + 1) % size]! * fr;
    out[i] = y;
    const damp = i < heldN ? 0.996 : 0.9;
    line[w] = damp * 0.5 * (y + prev);
    prev = y;
    w = (w + 1) % size;
  }
  return out;
}

/** Normalizes to peak 0.8 and fades the last 5 ms so the buffer never ends in a click. */
function finish(x: Float32Array, sr: number): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! / m) * 0.8;
  const k = Math.min(x.length, Math.round(0.005 * sr));
  for (let i = 0; i < k; i++) x[x.length - 1 - i]! *= i / k;
  return x;
}

/** Resolves frequency and duration of a cue for an instrument (defaults when the cue omits them). */
export function noteParams(kind: InstrumentKind, freq: number | null, duration: number | undefined): { f: number; duration: number } {
  return { f: UNPITCHED.has(kind) ? DEFAULT_FREQUENCY : (freq ?? DEFAULT_FREQUENCY), duration: duration ?? DEFAULT_DURATION };
}
