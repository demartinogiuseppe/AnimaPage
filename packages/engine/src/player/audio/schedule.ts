// Pure timing rules for chapter sounds: which loops are audible at t, which cues fire between frames.
import type { ChapterSounds, SoundCue } from "@pv/scene-spec";

/** Fade at the edges of an ambience window, in seconds (shortened for short windows). */
export const WINDOW_FADE = 1.2;

/** Biggest time step still treated as continuous playback; anything larger (or backwards) is a seek. */
export const MAX_CONTINUOUS_STEP = 0.25;

/**
 * Loop levels at chapter time t (0..1, item volume included). A sound listed in several windows
 * plays once, at the loudest level. Windowless ambience covers the whole chapter.
 */
export function ambienceAt(sounds: ChapterSounds | undefined, t: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of sounds?.ambience ?? []) {
    let env = 1;
    if (a.window) {
      const [from, to] = a.window;
      if (t < from || t > to) continue;
      const fade = Math.min(WINDOW_FADE, (to - from) / 4);
      env = fade > 0 ? Math.min(1, (t - from) / fade, (to - t) / fade) : 1;
    }
    const level = env * (a.volume ?? 1);
    if (level <= 0) continue;
    out.set(a.sound, Math.max(out.get(a.sound) ?? 0, level));
  }
  return out;
}

/**
 * Fires each cue once when playback crosses its `at`. Crossing means continuous forward play:
 * a cue fires when `at` is in [previous t, t) — so a cue at 0 fires as the chapter starts, and a cue
 * at the moment the clock waits for the voice fires when the clock moves on. A cue at the very end
 * of the chapter fires when t reaches it. Seeks, jumps and paused frames never fire anything.
 */
export class CueTracker {
  private last: number | null = null;

  /** New chapter or explicit seek: the next frame starts counting from `t`. */
  reset(t: number | null = null): void {
    this.last = t;
  }

  advance(cues: readonly SoundCue[], t: number, playing: boolean, duration: number): SoundCue[] {
    const prev = this.last;
    this.last = t;
    if (!playing || prev === null) return [];
    if (t < prev || t - prev > MAX_CONTINUOUS_STEP) return [];
    const atEnd = t >= duration;
    return cues.filter((c) => c.at >= prev && (c.at < t || (atEnd && c.at <= t && c.at > prev)));
  }
}
