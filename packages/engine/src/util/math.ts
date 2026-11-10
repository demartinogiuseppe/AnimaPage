// Small deterministic helpers shared by the engines (from the prototypes).

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Progress of t inside [a, b], clamped to 0..1. */
export const seg = (t: number, a: number, b: number) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export const ease = {
  linear: (p: number) => p,
  inOutQuad: (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
  inOutCubic: (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
} as const;
export type EaseName = keyof typeof ease;

/** Deterministic pseudo-random in [0, 1) from two integers (sin-hash used by micenei-troia.html). */
export function hash(i: number, k = 0): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Seeded PRNG (mulberry32) for building geometry once, deterministically. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
