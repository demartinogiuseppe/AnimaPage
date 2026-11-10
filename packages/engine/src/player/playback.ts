// Chapter clock + narration ("the scene waits for the voice", brief §1, §4.3).
// Pure logic: driven by tick(dt) and a TtsProvider, no DOM, no timers.
import type { Sentence } from "@pv/scene-spec";
import type { TtsProvider } from "./tts.ts";

export interface PlaybackChapter {
  duration: number;
  narration: readonly Sentence[];
}

export interface PlaybackEvents {
  /** Sentence i starts being spoken (highlight + pulse its pins). */
  onSentence?(i: number): void;
  /** The voice reached the word at `charIndex` of sentence i (only voices that report boundaries, never with a `speech` override). */
  onWord?(i: number, charIndex: number): void;
  /** The position was set by hand (seek, jump to a sentence): what was played "in this pass" is forgotten. */
  onSeek?(): void;
  /** Chapter finished: t reached the end and the last sentence was spoken. */
  onEnd?(): void;
}

/** Index of the last sentence with `at <= t`, or -1. */
export function sentenceAt(narration: readonly Sentence[], t: number): number {
  let idx = -1;
  narration.forEach((s, i) => {
    if (s.at <= t + 1e-9) idx = i;
  });
  return idx;
}

/**
 * Rules:
 * - t is chapter-local and advances by dt while playing;
 * - sentence i+1 starts at its `at` only once sentence i has finished speaking; while it waits, t freezes
 *   (a slow voice stretches the chapter, a fast one never speeds it up);
 * - after a seek or a pause, play() re-speaks the sentence covering t from its start (t itself does not jump).
 */
export class Playback {
  t = 0;
  playing = false;
  /** Sentence highlighted in the text, -1 for none. */
  highlighted = -1;
  /** Last word boundary reported by the voice for the sentence being spoken; null = none (estimate in charge). */
  boundary: { sentence: number; char: number } | null = null;
  /** Seconds the voice has been speaking since its last boundary (Infinity once it is known to have stopped reporting). */
  sinceBoundary = 0;

  private chapter: PlaybackChapter = { duration: 0, narration: [] };
  /** Last sentence started in the current run. */
  private si = -1;
  private speaking = false;
  private speakId = 0;

  constructor(
    private tts: TtsProvider,
    private events: PlaybackEvents = {},
  ) {}

  get duration(): number {
    return this.chapter.duration;
  }

  /** True while the clock is frozen waiting for the voice. */
  get holding(): boolean {
    const next = this.chapter.narration[this.si + 1];
    return this.playing && this.speaking && !!next && this.t >= next.at;
  }

  load(chapter: PlaybackChapter): void {
    this.silence();
    this.chapter = chapter;
    this.t = 0;
    this.si = -1;
    this.playing = false;
    this.highlighted = -1;
  }

  play(): void {
    if (this.t >= this.chapter.duration - 0.05) this.seek(0);
    this.playing = true;
  }

  pause(): void {
    if (this.speaking) this.si--; // interrupted: say it again on resume
    this.silence();
    this.playing = false;
  }

  /** The voice stopped reporting word boundaries (it failed over to a timer): the estimate takes over at once. */
  dropBoundary(): void {
    this.sinceBoundary = Infinity;
  }

  seek(t: number): void {
    this.events.onSeek?.();
    this.silence();
    this.t = Math.min(this.chapter.duration, Math.max(0, t));
    const covering = sentenceAt(this.chapter.narration, this.t);
    this.si = covering - 1;
    this.highlighted = covering;
  }

  /** Tap on a sentence: jump to its `at` and speak it. */
  jumpTo(i: number): void {
    const s = this.chapter.narration[i];
    if (!s) return;
    this.seek(s.at);
    this.si = i - 1;
    this.highlighted = i;
    this.play();
  }

  tick(dt: number): void {
    if (!this.playing) return;
    if (this.speaking) this.sinceBoundary += dt;
    const { narration, duration } = this.chapter;
    const next = narration[this.si + 1];
    if (next && this.t >= next.at && !this.speaking) this.start(this.si + 1);
    let t = Math.min(duration, this.t + dt);
    // While a sentence is still speaking, t may reach the next sentence's `at` but not pass it.
    const upcoming = narration[this.si + 1];
    if (this.speaking && upcoming) t = Math.min(t, Math.max(this.t, upcoming.at));
    this.t = t;
    if (this.t >= duration && !this.speaking && this.si >= narration.length - 1) {
      this.playing = false;
      this.highlighted = -1;
      this.events.onEnd?.();
    }
  }

  private start(i: number): void {
    const s = this.chapter.narration[i];
    if (!s) return;
    this.si = i;
    this.speaking = true;
    this.highlighted = i;
    const id = ++this.speakId;
    this.boundary = null;
    this.sinceBoundary = 0;
    this.events.onSentence?.(i);
    // With a `speech` override the char indices refer to other text than the one shown: no boundaries.
    const onWord =
      s.speech === undefined
        ? (char: number) => {
            if (id !== this.speakId) return;
            this.boundary = { sentence: i, char };
            this.sinceBoundary = 0;
            this.events.onWord?.(i, char);
          }
        : undefined;
    this.tts.speak(
      s.speech ?? s.text,
      () => {
        if (id === this.speakId) this.speaking = false;
      },
      s.speaker,
      s.lang,
      onWord,
    );
  }

  private silence(): void {
    this.speakId++;
    this.boundary = null;
    this.speaking = false;
    this.tts.stop();
  }
}
