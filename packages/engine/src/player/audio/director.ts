// AudioDirector: decides what should sound, frame by frame, from the player's state.
// Pure logic driven by update(); the sound itself goes through an AudioOut (WebAudio in the
// browser, a recorder in tests).
import { pitchToFrequency, type Ambience, type Chapter, type ChapterSounds, type Music, type SoundCue } from "@pv/scene-spec";
import { INSTRUMENTS } from "./instruments.ts";
import { ambienceAt, CueTracker, MAX_CONTINUOUS_STEP } from "./schedule.ts";

/** Music and ambience level while the voice speaks. */
export const DUCK_LEVEL = 0.3;
/** Music level while the lesson is paused (it keeps playing softly; the "Musica" switch turns it off). */
export const IDLE_MUSIC = 0.5;
/** Quiz feedback sounds are kept low. */
export const FEEDBACK_VOLUME = 0.35;

export interface AudioOut {
  /** Loop levels to reach (fading); loops not listed fade out. */
  setLoops(levels: ReadonlyMap<string, number>): void;
  /** Background track and its level; null fades the music out. */
  setMusic(track: string | null, level: number): void;
  /** Multiplier for the music and ambience buses (ducking under the voice). */
  setDuck(level: number): void;
  /** One-shot sound effect. */
  play(sound: string, volume: number): void;
  /** Instrument note: frequency in Hz (null = the instrument's default), held for `duration` s (undefined = default). */
  note(sound: string, freq: number | null, duration: number | undefined, volume: number): void;
  /** Cuts the notes and one-shot effects still sounding (seek, pause, chapter change): a sound is never left ringing out of place. */
  stopNotes(): void;
  /** Hint: these sounds will be needed soon. */
  preload(sounds: readonly string[]): void;
}

/** What an engine adds to a chapter's own sounds (Engine.sounds): ambience, cues, and cues with their time set. */
export interface EngineSounds {
  ambience: readonly Ambience[];
  cues: readonly SoundCue[];
  words: readonly { sentence: number; word: number; cue: SoundCue }[];
}

export interface FrameState {
  t: number;
  playing: boolean;
  /** The voice is audibly speaking (narration, deep dive, feedback). */
  speaking: boolean;
}

export class AudioDirector {
  soundsOn = true;
  musicOn = true;

  private chapter: Chapter | null = null;
  /** The chapter's sounds merged with the engine's. */
  private sounds: ChapterSounds | undefined;
  private cues = new CueTracker();
  private lastLoops = new Map<string, number>();
  private lastMusic: { track: string | null; level: number } = { track: null, level: 0 };
  private lastDuck = 1;
  private frame: FrameState = { t: 0, playing: false, speaking: false };
  /** Chapter has instrument cues: the notes are the content, so the background music is muted. */
  private notesChapter = false;
  /** Cues of the current chapter: the scene's, with the instrument ones possibly supplied by the engine. */
  private cueList: readonly SoundCue[] = [];
  private prevT: number | null = null;
  private wasContinuous = false;
  /** The engine's word cues, and those already played in this pass (by boundary or by the clock). */
  private wordCues: EngineSounds["words"] = [];
  private firedWords = new Set<SoundCue>();

  constructor(
    private out: AudioOut,
    private music: Music | undefined,
  ) {}

  /**
   * Chapter change: cues restart from t = 0, ambience follows the new chapter at the next update.
   * `extra`: the engine's own sounds, added to the chapter's.
   */
  load(chapter: Chapter, extra?: EngineSounds | null): void {
    this.chapter = chapter;
    this.sounds = extra
      ? {
          ambience: [...(chapter.sounds?.ambience ?? []), ...extra.ambience],
          cues: [...(chapter.sounds?.cues ?? []), ...extra.cues, ...extra.words.map((w) => w.cue)],
        }
      : chapter.sounds;
    this.cues.reset(0);
    this.wordCues = extra?.words ?? [];
    this.firedWords.clear();
    this.out.stopNotes();
    this.setCues(this.sounds?.cues ?? []);
    this.prevT = 0;
    this.wasContinuous = false;
    const ids = [...(this.sounds?.ambience.map((a) => a.sound) ?? []), ...(this.sounds?.cues.map((c) => c.sound) ?? [])];
    if (this.music) ids.push(this.music.track);
    this.out.preload([...new Set(ids)]);
  }

  /**
   * Instrument cues computed by the engine for its current parameters (music engine: tempo, transpose,
   * instrument). They replace the chapter's own instrument cues; effects and ambience still come from
   * the scene. null = back to the chapter's cues. Call after load() and after every parameter change.
   */
  setInstrumentCues(cues: readonly SoundCue[] | null): void {
    const own = this.sounds?.cues ?? [];
    this.setCues(cues === null ? own : [...own.filter((c) => !(c.sound in INSTRUMENTS)), ...cues.filter((c) => c.sound in INSTRUMENTS)]);
    this.apply();
  }

  private setCues(cues: readonly SoundCue[]): void {
    this.cueList = [...cues].sort((x, y) => x.at - y.at);
    this.notesChapter = this.cueList.some((c) => c.sound in INSTRUMENTS);
  }

  setSounds(on: boolean): void {
    this.soundsOn = on;
    if (!on) this.out.stopNotes();
    this.apply();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    this.apply();
  }

  /** Called every frame with the playback state. */
  update(state: FrameState): void {
    this.frame = state;
    const ch = this.chapter;
    if (ch) {
      const fired = this.cues.advance(this.cueList, state.t, state.playing, ch.duration);
      // A seek or a pause-jump replays the words from the new position.
      const was = this.prevT;
      if (was !== null && (state.t < was || state.t - was > MAX_CONTINUOUS_STEP || (!state.playing && state.t !== was))) this.firedWords.clear();
      if (this.soundsOn) {
        for (const c of fired) {
          if (this.wordCues.some((w) => w.cue === c)) {
            if (this.firedWords.has(c)) continue;
            this.firedWords.add(c);
          }
          if (c.sound in INSTRUMENTS) this.out.note(c.sound, c.pitch ? pitchToFrequency(c.pitch) : null, c.duration, c.volume ?? 1);
          else this.out.play(c.sound, c.volume ?? 1);
        }
      }
    }
    // Pause or seek: notes in flight belong to the old position.
    const prev = this.prevT;
    const continuous = state.playing && prev !== null && state.t >= prev && state.t - prev <= MAX_CONTINUOUS_STEP;
    if (this.wasContinuous && !continuous) this.out.stopNotes();
    this.wasContinuous = continuous;
    this.prevT = state.t;
    this.apply();
  }

  /**
   * The voice reached word `word` of `sentence`: its cues sound now if they have not yet in this pass
   * (a cue sounds at the earlier of its boundary and its estimated time, never twice).
   */
  wordReached(sentence: number, word: number): void {
    for (const w of this.wordCues) {
      if (w.sentence !== sentence || w.word !== word || this.firedWords.has(w.cue)) continue;
      this.firedWords.add(w.cue);
      if (this.soundsOn) this.out.play(w.cue.sound, w.cue.volume ?? 1);
    }
  }

  /** Position set by hand (seek, jump): the words of the new pass can sound again. */
  resetWords(): void {
    this.firedWords.clear();
  }

  /** Quiz feedback (right / wrong answer). */
  feedback(ok: boolean): void {
    if (this.soundsOn) this.out.play(ok ? "correct" : "wrong", FEEDBACK_VOLUME);
  }

  private apply(): void {
    const { t, playing, speaking } = this.frame;
    const loops = this.soundsOn && playing && this.chapter ? ambienceAt(this.sounds, t) : new Map<string, number>();
    if (!sameLevels(loops, this.lastLoops)) {
      this.lastLoops = loops;
      this.out.setLoops(loops);
    }

    const track = this.musicOn && this.music && !this.notesChapter ? this.music.track : null;
    const level = track ? (this.music!.volume ?? 1) * (playing ? 1 : IDLE_MUSIC) : 0;
    if (track !== this.lastMusic.track || Math.abs(level - this.lastMusic.level) > 1e-6) {
      this.lastMusic = { track, level };
      this.out.setMusic(track, level);
    }

    const duck = speaking ? DUCK_LEVEL : 1;
    if (duck !== this.lastDuck) {
      this.lastDuck = duck;
      this.out.setDuck(duck);
    }
  }
}

/** Levels equal within 0.01 (avoids touching WebAudio params every frame for inaudible changes). */
function sameLevels(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined || Math.abs(v - w) > 0.01) return false;
  }
  return true;
}
