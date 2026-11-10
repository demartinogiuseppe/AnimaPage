// Procedural fallback sounds: plain sample math, no WebAudio, so it runs (and is tested) in node.
// Used when a catalog sound has no file, or its file fails to load or decode.

export type SynthKind =
  // loops
  | "wind"
  | "sea"
  | "rain"
  | "fire"
  | "rumble"
  | "hum"
  | "murmur"
  | "pulse"
  | "drone"
  | "bubbles"
  | "pad"
  | "space"
  | "room"
  // one-shots
  | "whoosh"
  | "pop"
  | "click"
  | "chime"
  | "sparkle"
  | "correct"
  | "wrong"
  | "thud"
  | "clang"
  | "crack"
  | "zap"
  | "boom"
  | "horn"
  | "beep"
  | "ring"
  | "whistle"
  // cartoon one-shots (storybook theatre)
  | "boing"
  | "slide"
  | "peep"
  | "meow"
  | "moo"
  | "whistle-train"
  | "chug";

export interface Synth {
  kind: SynthKind;
  /** Base frequency in Hz for tonal kinds, or beats per minute for "pulse". */
  f?: number;
}

/** Deterministic PRNG (mulberry32) so fallbacks sound the same every time. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

function onePole(fc: number, sr: number): (x: number) => number {
  const a = Math.exp((-TAU * fc) / sr);
  let y = 0;
  return (x) => (y = (1 - a) * x + a * y);
}

/** Crossfades the last `xf` samples into the first ones: the result loops without a click. */
export function loopify(x: Float32Array, xf: number): Float32Array {
  const n = x.length - xf;
  const out = x.slice(0, n);
  for (let i = 0; i < xf; i++) {
    const k = (i / xf) * (Math.PI / 2);
    out[i] = x[n + i]! * Math.cos(k) + x[i]! * Math.sin(k);
  }
  return out;
}

function normalize(x: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! / m) * peak;
  return x;
}

const LOOP_SECONDS: Partial<Record<SynthKind, number>> = { pulse: 0, pad: 16, space: 20 };
const SHOT_SECONDS: Partial<Record<SynthKind, number>> = {
  whoosh: 0.7,
  pop: 0.15,
  click: 0.04,
  chime: 1.2,
  sparkle: 1.2,
  correct: 0.5,
  wrong: 0.5,
  thud: 0.4,
  clang: 1.0,
  crack: 0.35,
  zap: 0.6,
  boom: 3.5,
  horn: 2.5,
  beep: 0.18,
  ring: 2.2,
  whistle: 1.3,
  boing: 0.6,
  slide: 0.8,
  peep: 0.3,
  meow: 0.7,
  moo: 1.4,
  "whistle-train": 1.4,
  chug: 1.2,
};

export function isLoopKind(kind: SynthKind): boolean {
  return !(kind in SHOT_SECONDS);
}

/** Renders a mono buffer. Loops come out seamless; one-shots end in silence. */
export function synthesize(s: Synth, sr: number, seed = 1): Float32Array {
  const rnd = prng(seed);
  const noise = () => rnd() * 2 - 1;
  const shot = SHOT_SECONDS[s.kind];
  if (shot !== undefined) return normalize(oneShot(s, sr, shot, rnd, noise), 0.8);

  if (s.kind === "pulse") {
    // A thump pattern ("lub-dub") at f beats per minute: one period, loops by construction.
    const bpm = s.f ?? 70;
    const n = Math.round((60 / bpm) * sr);
    const out = new Float32Array(n);
    for (const [at, g] of [
      [0, 1],
      [0.28, 0.7],
    ] as const) {
      const start = Math.round(at * (60 / bpm) * sr);
      for (let i = 0; i < 0.12 * sr && start + i < n; i++) {
        const t = i / sr;
        out[start + i]! += g * Math.sin(TAU * 55 * t) * Math.exp(-t * 30);
      }
    }
    return normalize(out, 0.7);
  }

  const seconds = LOOP_SECONDS[s.kind] ?? 6;
  const xf = Math.round(0.5 * sr);
  const n = Math.round(seconds * sr) + xf;
  const out = new Float32Array(n);
  const lp = onePole(400, sr);
  const lp2 = onePole(1200, sr);
  const hp = onePole(2500, sr);
  const f = s.f ?? 110;
  const lpDeep = onePole(70, sr);
  const lpDeep2 = onePole(70, sr);
  let grain = 0;
  let svLow = 0;
  let svBand = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = noise();
    let v = 0;
    switch (s.kind) {
      case "wind": {
        // Low-passed noise with a slow gust envelope.
        const gust = 0.55 + 0.45 * Math.sin(TAU * 0.13 * t) * Math.sin(TAU * 0.07 * t + 1);
        v = lp2(w) * gust;
        break;
      }
      case "sea": {
        // Swells every ~4.5 s.
        const ph = (t % 4.5) / 4.5;
        const swell = Math.pow(Math.sin(Math.PI * ph), 3) * 0.9 + 0.1;
        v = lp2(w) * swell + lp(w) * 0.3;
        break;
      }
      case "rain": {
        v = (w - hp(w)) * 0.25 + (w - lp2(w)) * 0.4;
        if (rnd() < 0.0015) grain = 1;
        v += grain * noise() * 0.6;
        grain *= 0.98;
        break;
      }
      case "fire": {
        v = lp(w) * 0.6;
        if (rnd() < 0.0008) grain = 1;
        v += grain * (w - hp(w)) * 1.5;
        grain *= 0.93;
        break;
      }
      case "rumble":
        v = lp(lp(w)) * 3 + Math.sin(TAU * 38 * t) * 0.15 * (0.6 + 0.4 * Math.sin(TAU * 0.2 * t));
        break;
      case "hum":
        v = Math.sin(TAU * 50 * t) * 0.5 + Math.sin(TAU * 100 * t) * 0.3 + Math.sin(TAU * 150 * t) * 0.15 + w * 0.02;
        break;
      case "murmur": {
        // Crowd-like: band-limited noise with a fast irregular "syllable" envelope.
        const syl = 0.5 + 0.5 * Math.sin(TAU * 3.1 * t) * Math.sin(TAU * 4.7 * t + 2) * Math.sin(TAU * 0.3 * t);
        v = (lp2(w) - lp(w)) * (0.6 + 0.4 * syl);
        break;
      }
      case "drone":
        v = Math.sin(TAU * f * t) * 0.4 + Math.sin(TAU * f * 1.006 * t) * 0.4 + Math.sin(TAU * f * 1.5 * t) * 0.15 + lp(w) * 0.2;
        break;
      case "bubbles": {
        if (rnd() < 0.0006) grain = 1;
        v = grain * Math.sin(TAU * (300 + 900 * (1 - grain)) * t) * 0.6 + lp(w) * 0.2;
        grain *= 0.9992;
        break;
      }
      case "pad": {
        // Slow two-chord pad (I - vi) on f, with a gentle tremolo.
        const chord = t % 8 < 4 ? [1, 1.25, 1.5] : [0.84, 1.0, 1.26];
        for (const r of chord) v += Math.sin(TAU * f * 2 * r * t) * 0.2;
        v *= 0.8 + 0.2 * Math.sin(TAU * 0.25 * t);
        break;
      }
      case "room":
        // Room tone: steady, dark, very even noise (no gusts, no pitch), like a quiet classroom.
        v = lp(w) * 0.8 + lpDeep2(lpDeep(w)) * 3 + (lp2(w) - lp(w)) * 0.15;
        break;
      case "space": {
        // Deep and airy, no pitch: sub-bass noise plus a slowly sweeping band of "air", slow swells.
        // Every modulation completes whole cycles over the 20 s loop.
        const swell = 0.7 + 0.2 * Math.sin((TAU * t) / 10) + 0.1 * Math.sin((TAU * t) / 4 + 1);
        const fc = 650 + 450 * Math.sin((TAU * t) / 20);
        const g = 2 * Math.sin((Math.PI * fc) / sr);
        svLow += g * svBand;
        svBand += g * (w - svLow - 1.6 * svBand); // state-variable filter, low Q
        v = (lpDeep2(lpDeep(w)) * 9 + svBand * 0.12) * swell;
        break;
      }
      default:
        v = lp(w);
    }
    out[i] = v;
  }
  return normalize(loopify(out, xf), 0.6);
}

function oneShot(s: Synth, sr: number, seconds: number, rnd: () => number, noise: () => number): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const lp = onePole(800, sr);
  const lpLow = onePole(150, sr);
  const hp = onePole(3000, sr);
  const f = s.f ?? 660;
  const tone = (t: number, hz: number) => Math.sin(TAU * hz * t);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const p = t / seconds;
    const w = noise();
    let v = 0;
    switch (s.kind) {
      case "whoosh": {
        const env = Math.sin(Math.PI * p) ** 2;
        v = (lp(w) * (1 - p) + (w - hp(w)) * p * 0.3) * env;
        break;
      }
      case "pop":
        v = tone(t, 900 - 600 * p) * Math.exp(-t * 40);
        break;
      case "click":
        v = w * Math.exp(-t * 400);
        break;
      case "chime":
        v = (tone(t, f * 2) + 0.5 * tone(t, f * 5.04) + 0.25 * tone(t, f * 8.1)) * Math.exp(-t * 4);
        break;
      case "sparkle": {
        // Rising arpeggio of short bell notes.
        const step = Math.floor(t / 0.09);
        const tn = t - step * 0.09;
        const hz = f * 2 * Math.pow(2, [0, 4, 7, 12, 16, 19, 24][step % 7]! / 12);
        v = step < 7 ? tone(tn, hz) * Math.exp(-tn * 9) : 0;
        v += step >= 1 && step < 8 ? tone(t, hz * 2) * 0.1 * Math.exp(-tn * 20) : 0;
        break;
      }
      case "correct": {
        const hz = t < 0.12 ? 660 : 990;
        v = tone(t, hz) * Math.exp(-((t < 0.12 ? t : t - 0.12) * 8));
        break;
      }
      case "wrong": {
        const hz = t < 0.18 ? 220 : 165;
        v = (tone(t, hz) * 0.7 + tone(t, hz * 2.01) * 0.2) * Math.exp(-((t < 0.18 ? t : t - 0.18) * 6));
        break;
      }
      case "thud":
        v = (tone(t, 80 - 40 * p) + lp(w) * 0.5) * Math.exp(-t * 18);
        break;
      case "clang":
        v = (tone(t, f) + 0.6 * tone(t, f * 2.76) + 0.4 * tone(t, f * 5.4) + 0.2 * tone(t, f * 8.93)) * Math.exp(-t * 6) + w * Math.exp(-t * 80) * 0.5;
        break;
      case "crack":
        v = (w - hp(w) * 0.2) * Math.exp(-t * 25) * (rnd() < 0.3 ? 1 : 0.4);
        break;
      case "zap":
        v = (w - lp(w)) * (rnd() < 0.08 ? 1 : 0.1) * (1 - p) + tone(t, 120) * 0.2 * (1 - p);
        break;
      case "boom":
        v = (lpLow(w) * 4 + tone(t, 45 - 15 * p) * 0.6) * Math.exp(-t * 1.6) * Math.min(1, t * 200);
        break;
      case "horn": {
        const env = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 1.5);
        let saw = 0;
        for (let k = 1; k <= 8; k++) saw += Math.sin(TAU * f * 0.33 * k * t) / k;
        v = lp(saw) * env * 2;
        break;
      }
      case "beep":
        v = Math.sin(TAU * f * t) * Math.min(1, t * 400, (seconds - t) * 200);
        break;
      case "ring": {
        // Two bursts of a fast-alternating two-tone bell, like an old telephone.
        const on = t < 0.9 || (t > 1.2 && t < 2.1);
        const hz = Math.floor(t * 40) % 2 ? f : f * 1.25;
        v = on ? tone(t, hz) * 0.6 + tone(t, hz * 2.5) * 0.2 : 0;
        break;
      }
      case "whistle": {
        // Glide up an octave and a half, with vibrato.
        const hz = f * Math.pow(2, 1.5 * p) * (1 + 0.01 * Math.sin(TAU * 7 * t));
        v = (tone(t, hz) * 0.8 + w * 0.05) * Math.min(1, t * 20, (seconds - t) * 6);
        break;
      }
      case "boing": {
        // Springy: a pitch that wobbles down while the decay rings.
        const hz = f * 0.5 * (1 + 0.5 * Math.exp(-t * 6) * Math.sin(TAU * 14 * t)) * (1 - 0.3 * p);
        v = tone(t, hz) * Math.exp(-t * 5) * Math.min(1, t * 200);
        break;
      }
      case "slide": {
        // Slide whistle: up then down.
        const hz = (s.f ?? 500) * Math.pow(2, 2 * Math.sin(Math.PI * p));
        v = tone(t, hz) * 0.8 * Math.min(1, t * 30, (seconds - t) * 10);
        break;
      }
      case "peep": {
        // Two quick chirps.
        const tn = t % 0.15;
        const hz = (s.f ?? 2400) * (1 + 0.2 * (tn / 0.15));
        v = t < 0.3 ? tone(t, hz) * Math.sin((Math.PI * tn) / 0.15) : 0;
        break;
      }
      case "meow": {
        // A vowel-ish glide up and down with formant-like harmonics.
        const hz = (s.f ?? 420) * (1 + 0.5 * Math.sin(Math.PI * Math.min(1, p * 1.2)));
        v = (tone(t, hz) + 0.5 * tone(t, hz * 2) + 0.35 * tone(t, hz * 3)) * Math.sin(Math.PI * p) ** 0.6;
        break;
      }
      case "moo": {
        // Low, long, wavering sawtooth.
        const hz = (s.f ?? 130) * (1 - 0.15 * p) * (1 + 0.02 * Math.sin(TAU * 5 * t));
        let saw = 0;
        for (let k = 1; k <= 6; k++) saw += Math.sin(TAU * hz * k * t) / k;
        v = lp(saw) * 2 * Math.min(1, t * 8, (seconds - t) * 3);
        break;
      }
      case "whistle-train": {
        // Two steam-whistle notes, a fifth apart.
        const hz = (s.f ?? 440) * (p < 0.5 ? 1 : 1.5);
        v = (tone(t, hz) + 0.5 * tone(t, hz * 2) + w * 0.06) * Math.min(1, t * 15, (seconds - t) * 5);
        break;
      }
      case "chug": {
        // Four steam puffs.
        const tn = t % 0.3;
        v = lp(w) * Math.exp(-tn * 14) * 2 * (t < 1.2 ? 1 : 0);
        break;
      }
      default:
        v = 0;
    }
    out[i] = v;
  }
  // Short fade-out so nothing clicks at the end.
  const k = Math.min(n, Math.round(0.01 * sr));
  for (let i = 0; i < k; i++) out[n - 1 - i]! *= i / k;
  return out;
}
