// MusicData: owned by the `music` engine (Musica: staff, notes, rhythm, keyboard, timbre).
//
// Each chapter has ONE short score (a melody line in one clef) that the engine draws on a 3D staff
// standing on the book page, plays with a moving playhead, mirrors on a keyboard whose keys press
// down, splits into beat tiles (rhythm) and plays with procedural instrument models (timbre).
// An LLM fills the notes (scientific pitch "C4", values in quarter-note beats) and what to show.
//
// Time model: the score starts at chapter time `start`; one beat = one quarter note lasts
// 60 / tempo seconds. The score is played `repeat` times with `gap` beats of silence between
// repetitions; repetition k is played by instruments[k % instruments.length].
// The SOUND is ordinary chapter cues (Chapter.sounds.cues, instrument sounds "instr-*" with pitch and
// duration): musicCues() computes them from the score, applyMusicCues() writes them into a scene and
// checkMusicData() verifies that the cues of every chapter are exactly the ones of its score.
// Sliders (activity.test.params -> `params`: tempo, transpose, instrument, value) change the score
// live; the engine's soundCues(chapterId) gives the matching cues (the scene's cues follow the
// scene's own values).
//
// Scene layout (scene units, y up, main view from +z): staff board standing at z = -1, x -8..8,
// staff lines y 3.4..5.4 (0.5 apart, line 1 at the bottom); beat tiles under the staff (y 1.4..2.1);
// keyboard lying in front (z 0.6..3, y 0..0.35); instrument models in a row at z 4.6; tempo panel
// and metronome top left (y 7.3), harmonic-spectrum panel top right (y 6.95..9.05).
//
// Entity anchors (pins and camera targets), all accept `offset`:
// - { entity: "note", index }               the index-th entry of `notes` (rests included), on the staff
// - { entity: "staff", part? }              part: clef, time, playhead, line-1..line-5, space-1..space-4
//                                           (no part = staff centre)
// - { entity: "key", part: "C4" }           a keyboard key (show "keyboard")
// - { entity: "beat", index }               the index-th beat tile of the score (show "beats")
// - { entity: "instrument", part: <id> }    an instrument model of `instruments` (show "instruments")
// - { entity: "panel", part: "tempo" | "wave" }
import { z } from "zod";
import { Id, type Anchor, type SceneBase, type SoundCue } from "../common.ts";
import { pitchToMidi, soundInfo } from "../sounds.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Pitched instruments: catalog sound, Italian name and orchestra family (it.wikipedia "Orchestra"). */
export const MUSIC_INSTRUMENTS = {
  piano: { sound: "instr-piano", it: "pianoforte", family: "tastiere" },
  flute: { sound: "instr-flute", it: "flauto", family: "legni" },
  violin: { sound: "instr-violin", it: "violino", family: "archi" },
  clarinet: { sound: "instr-clarinet", it: "clarinetto", family: "legni" },
  xylophone: { sound: "instr-xylophone", it: "xilofono", family: "percussioni" },
  guitar: { sound: "instr-guitar", it: "chitarra", family: "corde pizzicate" },
  bell: { sound: "instr-bell", it: "campane", family: "percussioni" },
} as const;
export type MusicInstrument = keyof typeof MUSIC_INSTRUMENTS;
export const MUSIC_INSTRUMENT_IDS = Object.keys(MUSIC_INSTRUMENTS) as MusicInstrument[];

/** Unpitched metronome sounds. */
export const MUSIC_PERCUSSION = { drum: "instr-drum", snare: "instr-snare", hihat: "instr-hihat" } as const;

/** Note values in quarter-note beats, dotted ones included (a dot adds half the value). */
export const NOTE_VALUES = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25] as const;

/** The five figures, longest first (index + 1 = value of the "value" slider). Each lasts twice the next one. */
export const FIGURES = [
  { beats: 4, it: "semibreve" },
  { beats: 2, it: "minima" },
  { beats: 1, it: "semiminima" },
  { beats: 0.5, it: "croma" },
  { beats: 0.25, it: "semicroma" },
] as const;

/** Italian figure name of a value ("semiminima col punto"). */
export function figureName(beats: number): string {
  const plain = FIGURES.find((f) => f.beats === beats);
  if (plain) return plain.it;
  const dotted = FIGURES.find((f) => f.beats * 1.5 === beats);
  return dotted ? `${dotted.it} col punto` : `${beats} battiti`;
}

export const MUSIC_SHOWS = ["names", "lyrics", "keyboard", "beats", "instruments", "wave", "tempo"] as const;
export type MusicShowItem = (typeof MUSIC_SHOWS)[number];
export const MUSIC_PARAM_KINDS = ["tempo", "transpose", "instrument", "value"] as const;
export const MUSIC_STAFF_PARTS = ["clef", "time", "playhead", "line-1", "line-2", "line-3", "line-4", "line-5", "space-1", "space-2", "space-3", "space-4"] as const;
export const MUSIC_PANELS = ["tempo", "wave"] as const;

const Pitch = z.string().regex(/^[A-G](#|b)?[0-8]$/);

export const MusicNote = z
  .object({
    /** Scientific pitch ("C4" = middle C, "F#4", "Bb3") or "rest". */
    pitch: z.union([Pitch, z.literal("rest")]),
    /** Value in quarter-note beats: 4 semibreve, 2 minima, 1 semiminima, 0.5 croma, 0.25 semicroma; 3, 1.5, 0.75 dotted. */
    beats: z.literal(NOTE_VALUES),
    /** Syllable sung on this note, shown under the staff (show "lyrics"). */
    lyric: z.string().min(1).max(12).optional(),
  })
  .strict();
export type MusicNote = z.infer<typeof MusicNote>;

export const MusicParam = z
  .object({
    id: Id,
    /**
     * tempo: bpm (default range 40..208); transpose: semitones (default -12..12); instrument: 1..n picks
     * instruments[n - 1] for every repetition; value: 1..5 replaces the score with notes of FIGURES[v - 1]
     * on the first pitch, filling the same number of beats (1 semibreve = 2 minime = 4 semiminime ...).
     */
    kind: z.enum(MUSIC_PARAM_KINDS),
    /** Italian label with unit, e.g. "Tempo (bpm)". */
    label: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
  })
  .strict();
export type MusicParam = z.infer<typeof MusicParam>;

export const MusicShow = z
  .object({
    item: z.enum(MUSIC_SHOWS),
    at: z.number().min(0).optional(),
    until: z.number().min(0).optional(),
  })
  .strict();
export type MusicShow = z.infer<typeof MusicShow>;

export const MusicChapter = z
  .object({
    chapter: Id,
    clef: z.enum(["treble", "bass"]).optional(),
    /** Time signature [beats per bar, beat unit]: [4, 4], [3, 4], [2, 4], [6, 8]. Default [4, 4]. */
    time: z.tuple([z.number().int().min(1).max(12), z.union([z.literal(2), z.literal(4), z.literal(8)])]).optional(),
    /** Quarter notes per minute. */
    tempo: z.number().min(30).max(240),
    /** Chapter time (s) of the first note. Default 0. */
    start: z.number().min(0).optional(),
    repeat: z.number().int().min(1).max(8).optional(),
    /** Silent beats between repetitions. Default 0. */
    gap: z.number().min(0).max(8).optional(),
    /** Who plays: repetition k uses instruments[k % n]. Default ["piano"]. */
    instruments: z.array(z.enum(MUSIC_INSTRUMENT_IDS as [MusicInstrument, ...MusicInstrument[]])).min(1).max(7).optional(),
    /** Note names: Italian (Do Re Mi), English letters (C D E) or both. Default "it". */
    names: z.enum(["it", "en", "both"]).optional(),
    /** Note volume 0..1. Default 0.7. */
    volume: z.number().min(0).max(1).optional(),
    /** A percussion tick on every beat of the time signature while the score plays. */
    metronome: z
      .object({
        sound: z.enum(["drum", "snare", "hihat"]).optional(),
        /** The first beat of each bar on the bass drum. Default true. */
        accent: z.boolean().optional(),
        volume: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    notes: z.array(MusicNote).min(1).max(64),
    params: z.array(MusicParam).optional(),
    show: z.array(MusicShow).optional(),
  })
  .strict();
export type MusicChapter = z.infer<typeof MusicChapter>;

const SLIDER_LIMITS = { tempo: [30, 240], transpose: [-24, 24] } as const;

export const MusicData = z
  .object({
    /** Background colour (default: warm paper). */
    background: Color.optional(),
    chapters: z.array(MusicChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const chapters = new Set<string>();
    const ids = new Set<string>();
    d.chapters.forEach((c, i) => {
      if (chapters.has(c.chapter)) add(["chapters", i, "chapter"], `duplicate chapter "${c.chapter}"`);
      chapters.add(c.chapter);
      if (c.notes.every((n) => n.pitch === "rest")) add(["chapters", i, "notes"], "the score has only rests");
      const kinds = new Set<string>();
      c.params?.forEach((p, k) => {
        const path = ["chapters", i, "params", k];
        if (ids.has(p.id)) add(path, `duplicate param id "${p.id}" (ids are unique in the scene)`);
        ids.add(p.id);
        if (kinds.has(p.kind)) add(path, `two "${p.kind}" sliders in one chapter`);
        kinds.add(p.kind);
        const r = paramRange(c, p);
        if (r.min >= r.max) add(path, "min must be below max");
        if (p.kind === "tempo" || p.kind === "transpose") {
          const [lo, hi] = SLIDER_LIMITS[p.kind];
          if (r.min < lo || r.max > hi) add(path, `${p.kind} range must stay within ${lo}..${hi}`);
          const own = p.kind === "tempo" ? c.tempo : 0;
          if (own < r.min || own > r.max) add(path, `the scene's ${p.kind} ${own} is outside the slider range`);
        }
        if (p.kind === "instrument" && (c.instruments?.length ?? 1) < 2) add(path, "an instrument slider needs at least 2 instruments");
        if ((p.kind === "instrument" || p.kind === "value") && (p.min !== undefined || p.max !== undefined))
          add(path, `${p.kind} sliders have a fixed range (leave min and max out)`);
      });
      c.show?.forEach((s, k) => {
        if (s.until !== undefined && s.until <= (s.at ?? 0)) add(["chapters", i, "show", k], "`until` must come after `at`");
      });
    });
  });
export type MusicData = z.infer<typeof MusicData>;

// ------------------------------------------------------------ score and timeline (pure)

/** Slider values (kind -> value); missing = the scene's own value. */
export interface MusicOverrides {
  tempo?: number;
  transpose?: number;
  /** 1-based index into `instruments`. */
  instrument?: number;
  /** 1-based index into FIGURES. */
  value?: number;
}

/** Effective range of a slider. */
export function paramRange(entry: MusicChapter, p: MusicParam): { min: number; max: number; step: number } {
  switch (p.kind) {
    case "tempo":
      return { min: p.min ?? 40, max: p.max ?? 208, step: p.step ?? 1 };
    case "transpose":
      return { min: p.min ?? -12, max: p.max ?? 12, step: p.step ?? 1 };
    case "instrument":
      return { min: 1, max: entry.instruments?.length ?? 1, step: 1 };
    case "value":
      return { min: 1, max: FIGURES.length, step: 1 };
  }
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Scientific pitch of a MIDI note, sharps for black keys (60 -> "C4", 61 -> "C#4"). */
export function midiToPitch(midi: number): string {
  const m = Math.round(midi);
  return `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

const IT_NAMES: Record<string, string> = { C: "Do", D: "Re", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };

/** Note name for labels: "Do", "C", "Do · C"; accidentals as ♯/♭ ("Fa♯"). */
export function noteName(pitch: string, names: "it" | "en" | "both" = "it"): string {
  const letter = pitch[0]!;
  const acc = pitch[1] === "#" ? "♯" : pitch[1] === "b" ? "♭" : "";
  const it = `${IT_NAMES[letter] ?? letter}${acc}`;
  const en = `${letter}${acc}`;
  return names === "it" ? it : names === "en" ? en : `${it} · ${en}`;
}

export interface ScoreNote {
  /** Index into the chapter's `notes` (value override: index of the generated note). */
  index: number;
  /** Pitch after transposition; null = rest. */
  pitch: string | null;
  beats: number;
  /** Start, in beats from the start of the score. */
  beat: number;
  lyric?: string;
}

export interface Score {
  notes: ScoreNote[];
  /** Length of the score in beats (without the gap). */
  beats: number;
  /** Bar length in quarter-note beats. */
  bar: number;
  /** Metronome tick spacing in quarter-note beats (the time signature's unit). */
  unit: number;
  tempo: number;
  /** Seconds per quarter-note beat. */
  spb: number;
  start: number;
  repeat: number;
  gap: number;
  /** Instrument of each repetition. */
  instruments: MusicInstrument[];
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** The score as played, with slider overrides applied. */
export function musicScore(entry: MusicChapter, ov: MusicOverrides = {}): Score {
  const [n, d] = entry.time ?? [4, 4];
  const tempo = ov.tempo !== undefined ? Math.min(240, Math.max(30, ov.tempo)) : entry.tempo;
  const shift = ov.transpose !== undefined ? clampInt(ov.transpose, -24, 24) : 0;
  const palette = entry.instruments ?? ["piano"];
  const repeat = entry.repeat ?? 1;
  const instruments =
    ov.instrument !== undefined
      ? Array.from({ length: repeat }, () => palette[clampInt(ov.instrument!, 1, palette.length) - 1]!)
      : Array.from({ length: repeat }, (_, k) => palette[k % palette.length]!);
  let source: { pitch: string; beats: number; lyric?: string }[] = entry.notes;
  if (ov.value !== undefined) {
    const fig = FIGURES[clampInt(ov.value, 1, FIGURES.length) - 1]!;
    const total = entry.notes.reduce((s, x) => s + x.beats, 0);
    const first = entry.notes.find((x) => x.pitch !== "rest")?.pitch ?? "C4";
    source = Array.from({ length: Math.max(1, Math.floor(total / fig.beats + 1e-9)) }, () => ({ pitch: first, beats: fig.beats }));
  }
  let beat = 0;
  const notes: ScoreNote[] = source.map((x, index) => {
    const midi = x.pitch === "rest" ? null : pitchToMidi(x.pitch);
    const pitch = midi === null ? null : shift === 0 ? x.pitch : midiToPitch(Math.min(119, Math.max(12, midi + shift)));
    const note: ScoreNote = { index, pitch, beats: x.beats, beat, ...(x.lyric && ov.value === undefined ? { lyric: x.lyric } : {}) };
    beat += x.beats;
    return note;
  });
  return { notes, beats: beat, bar: (n * 4) / d, unit: 4 / d, tempo, spb: 60 / tempo, start: entry.start ?? 0, repeat, gap: entry.gap ?? 0, instruments };
}

/** Chapter time at which repetition `rep` starts. */
export const repStart = (s: Score, rep: number) => s.start + rep * (s.beats + s.gap) * s.spb;

/** Chapter time at which the last repetition ends. */
export const scoreEnd = (s: Score) => repStart(s, s.repeat - 1) + s.beats * s.spb;

/** Where the playback is at chapter time t: repetition and beat inside the score (-1 before the start). */
export function scorePosition(s: Score, t: number): { rep: number; beat: number; playing: boolean } {
  if (t < s.start) return { rep: 0, beat: -1, playing: false };
  const span = (s.beats + s.gap) * s.spb;
  const rep = Math.min(s.repeat - 1, Math.floor((t - s.start) / span));
  const beat = (t - repStart(s, rep)) / s.spb;
  if (beat >= s.beats) return { rep, beat: s.beats, playing: false };
  return { rep, beat, playing: true };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The chapter cues of a score: one instrument cue per note (pitch, duration = the note's length) and,
 * with a metronome, one percussion cue per beat unit. Cues at or after `until` (the chapter end) are dropped.
 */
export function musicCues(entry: MusicChapter, ov: MusicOverrides = {}, until = Infinity): SoundCue[] {
  const s = musicScore(entry, ov);
  const out: SoundCue[] = [];
  const volume = entry.volume ?? 0.7;
  for (let rep = 0; rep < s.repeat; rep++) {
    const t0 = repStart(s, rep);
    const sound = MUSIC_INSTRUMENTS[s.instruments[rep]!].sound;
    for (const n of s.notes) {
      if (!n.pitch) continue;
      out.push({ at: r3(t0 + n.beat * s.spb), sound, volume, pitch: n.pitch, duration: r3(Math.min(8, n.beats * s.spb)) });
    }
    if (entry.metronome) {
      const m = entry.metronome;
      const tick = MUSIC_PERCUSSION[m.sound ?? "hihat"];
      for (let k = 0; k * s.unit < s.beats - 1e-9; k++) {
        const downbeat = Math.abs((k * s.unit) % s.bar) < 1e-9;
        out.push({ at: r3(t0 + k * s.unit * s.spb), sound: downbeat && m.accent !== false ? MUSIC_PERCUSSION.drum : tick, volume: m.volume ?? 0.35 });
      }
    }
  }
  return out.filter((c) => c.at < until).sort((a, b) => a.at - b.at || a.sound.localeCompare(b.sound));
}

const isInstrumentCue = (c: SoundCue) => soundInfo(c.sound)?.category === "instrument";

type MusicScene = Pick<z.infer<typeof SceneBase>, "chapters">;

/** Returns a copy of the scene whose chapters' instrument cues are exactly those of their scores (sfx cues kept). */
export function applyMusicCues<S extends MusicScene>(scene: S, data: MusicData): S {
  const byChapter = new Map(data.chapters.map((c) => [c.chapter, c]));
  return {
    ...scene,
    chapters: scene.chapters.map((ch) => {
      const entry = byChapter.get(ch.id);
      if (!entry) return ch;
      const other = (ch.sounds?.cues ?? []).filter((c) => !isInstrumentCue(c));
      const cues = [...other, ...musicCues(entry, {}, ch.duration)].sort((a, b) => a.at - b.at);
      return { ...ch, sounds: { ambience: ch.sounds?.ambience ?? [], cues } };
    }),
  };
}

/** Lowest and highest MIDI note the keyboard shows: whole octaves C..B covering the score and the transpose slider (max 4 octaves). */
export function keyboardRange(entry: MusicChapter): [number, number] {
  const midis = entry.notes.flatMap((n) => (n.pitch === "rest" ? [] : [pitchToMidi(n.pitch)!]));
  const tr = entry.params?.find((p) => p.kind === "transpose");
  const r = tr ? paramRange(entry, tr) : { min: 0, max: 0 };
  let lo = Math.min(...midis) + Math.min(0, r.min);
  let hi = Math.max(...midis) + Math.max(0, r.max);
  lo = Math.floor(lo / 12) * 12;
  hi = Math.floor(hi / 12) * 12 + 11;
  if (hi - lo + 1 > 48) {
    const mid = Math.floor((Math.min(...midis) + Math.max(...midis)) / 24) * 12;
    lo = mid - 24;
    hi = mid + 23;
  }
  return [Math.max(12, lo), Math.min(119, hi)];
}

// ------------------------------------------------------------ cross-checks

type Issue = { path: string; message: string };

function shownAt(entry: MusicChapter, item: MusicShowItem): boolean {
  return (entry.show ?? []).some((s) => s.item === item);
}

function checkAnchor(a: Anchor, entry: MusicChapter | undefined, path: string, issues: Issue[]): void {
  if (!("entity" in a)) return;
  const add = (message: string): void => void issues.push({ path, message });
  if (!entry) return add("music anchor in a chapter without a music entry");
  const score = musicScore(entry);
  switch (a.entity) {
    case "note":
      if ((a.index ?? 0) >= entry.notes.length) add(`note index ${a.index} does not exist (${entry.notes.length} notes)`);
      return;
    case "staff":
      if (a.part !== undefined && !(MUSIC_STAFF_PARTS as readonly string[]).includes(a.part)) add(`unknown staff part "${a.part}" (use ${MUSIC_STAFF_PARTS.join(", ")})`);
      return;
    case "key": {
      if (!shownAt(entry, "keyboard")) return add(`key anchor but the chapter does not show the keyboard`);
      const midi = a.part ? pitchToMidi(a.part) : null;
      const [lo, hi] = keyboardRange(entry);
      if (midi === null) add(`key needs a pitch part like "C4", got "${a.part}"`);
      else if (midi < lo || midi > hi) add(`key ${a.part} is not on the keyboard (${midiToPitch(lo)}..${midiToPitch(hi)})`);
      return;
    }
    case "beat":
      if (!shownAt(entry, "beats")) return add(`beat anchor but the chapter does not show "beats"`);
      if ((a.index ?? 0) >= Math.ceil(score.beats / score.unit - 1e-9)) add(`beat index ${a.index} is beyond the score`);
      return;
    case "instrument":
      if (!shownAt(entry, "instruments")) return add(`instrument anchor but the chapter does not show "instruments"`);
      if (!a.part || !(entry.instruments ?? ["piano"]).includes(a.part as MusicInstrument)) add(`instrument "${a.part}" is not in the chapter's instruments`);
      return;
    case "panel":
      if (!a.part || !(MUSIC_PANELS as readonly string[]).includes(a.part)) return add(`unknown panel "${a.part}" (use tempo, wave)`);
      if (!shownAt(entry, a.part as MusicShowItem)) add(`panel "${a.part}" is not shown in this chapter`);
      return;
    default:
      add(`unknown music entity "${a.entity}" (use note, staff, key, beat, instrument, panel)`);
  }
}

const cueKey = (c: SoundCue) => `${c.at.toFixed(3)}|${c.sound}|${c.pitch ?? ""}|${c.duration?.toFixed(3) ?? ""}`;

/**
 * Cross-checks against the rest of the scene: chapter ids, the score fits in the chapter, notes do not
 * cross bar lines, slider ids used by activities, music anchors in pins and camera keys, and the
 * chapter's instrument cues are exactly the ones computed from its score (musicCues).
 */
export function checkMusicData(data: MusicData, scene: MusicScene): Issue[] {
  const issues: Issue[] = [];
  const byChapter = new Map(data.chapters.map((c) => [c.chapter, c]));
  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (duration === undefined) return void issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    const s = musicScore(c);
    const end = scoreEnd(s);
    if (end > duration + 1e-6) issues.push({ path, message: `the score ends at ${end.toFixed(2)} s, after the chapter (${duration} s)` });
    for (const n of s.notes) {
      const barEnd = (Math.floor(n.beat / s.bar + 1e-9) + 1) * s.bar;
      if (n.beat + n.beats > barEnd + 1e-9) issues.push({ path: `${path}.notes[${n.index}]`, message: "note crosses the bar line (ties are not supported: split the bar differently)" });
    }
    c.show?.forEach((x, k) => {
      if ((x.at ?? 0) >= duration) issues.push({ path: `${path}.show[${k}]`, message: `"${x.item}" appears after the chapter ends` });
    });
  });
  scene.chapters.forEach((ch, c) => {
    const at = `chapters[${c}]`;
    const entry = byChapter.get(ch.id);
    if (!entry) issues.push({ path: at, message: `chapter "${ch.id}" has no music entry (empty staff)` });
    for (const id of ch.activity?.test.params ?? [])
      if (!entry?.params?.some((p) => p.id === id)) issues.push({ path: `${at}.activity.test`, message: `unknown music param "${id}"` });
    ch.pins.forEach((p, i) => checkAnchor(p.anchor, entry, `${at}.pins[${i}].anchor`, issues));
    ch.camera.forEach((k, i) => checkAnchor(k.target, entry, `${at}.camera[${i}].target`, issues));
    // Score and sound must agree: the notes shown are the notes heard.
    const have = new Map<string, number>();
    for (const q of (ch.sounds?.cues ?? []).filter(isInstrumentCue)) have.set(cueKey(q), (have.get(cueKey(q)) ?? 0) + 1);
    const want = entry ? musicCues(entry, {}, ch.duration) : [];
    const missing: string[] = [];
    for (const q of want) {
      const k = cueKey(q);
      const n = have.get(k) ?? 0;
      if (n > 0) have.set(k, n - 1);
      else missing.push(k);
    }
    const extra = [...have].flatMap(([k, n]) => Array.from({ length: n }, () => k));
    if (missing.length || extra.length) {
      const list = (xs: string[]) => xs.slice(0, 3).join(", ") + (xs.length > 3 ? ` (+${xs.length - 3})` : "");
      issues.push({
        path: `${at}.sounds.cues`,
        message: `instrument cues differ from the score (use applyMusicCues): ${missing.length ? `missing ${list(missing)}` : ""}${missing.length && extra.length ? "; " : ""}${extra.length ? `extra ${list(extra)}` : ""}`,
      });
    }
  });
  return issues;
}
