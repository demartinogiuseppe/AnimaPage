// Which sound variant plays where, in a storybook lesson. Pure and deterministic: the engine hook and
// the export (assetsOf) call the same storySoundsOf, so the export embeds exactly the variants played.
import { storyCharacter, storyGroup, type Ambience, type SceneSpec, type SoundCue, type StoryCharacterEntry } from "@pv/scene-spec";
import { wordTimes } from "../../util/words.ts";
import { NARRATOR_RATE } from "../../player/tts.ts";
import { STORY_LIBRARY } from "./library.ts";

/** An ambience act with no `until` plays to this chapter time (seconds): past any chapter's end. */
export const OPEN_AMBIENCE_END = 600;
/** A word cue is kept this far (seconds) before the next sentence, where the clock freezes for the voice. */
const BEFORE_NEXT = 0.05;
/** Story ambience sits low under the voice and the word sounds. */
export const STORY_AMBIENCE_VOLUME = 0.2;
/** Word and entrance sounds play under the narrating voice, never over it (user, 2026-11-10: they covered it). */
export const STORY_CUE_VOLUME = 0.4;

export interface WordCue {
  sentence: number;
  word: number;
  /** `cue.at`: the word's start in chapter time, clamped to just before the next sentence. */
  cue: SoundCue;
}

export interface ChapterStorySounds {
  ambience: Ambience[];
  cues: SoundCue[];
  words: WordCue[];
}

/**
 * Start of each word of a sentence, in seconds from the sentence start, kept before the next sentence
 * (or the chapter end) like the word cues: an overlong sentence does not push words past its slot, so the
 * lit word and the sound agree. Shared by the highlight and the cues.
 */
export function sentenceWordTimes(spec: SceneSpec, chapter: SceneSpec["chapters"][number], sentence: number): number[] {
  const s = chapter.narration[sentence];
  if (!s) return [];
  const limit = (chapter.narration[sentence + 1]?.at ?? chapter.duration) - BEFORE_NEXT;
  const room = Math.max(0, limit - s.at);
  const voice = s.speaker ? spec.voices?.find((v) => v.id === s.speaker) : undefined;
  return wordTimes(s.text, s.lang ?? voice?.lang ?? spec.lang, voice?.rate ?? NARRATOR_RATE).map((o) => Math.min(o, room));
}

/** FNV-1a 32-bit of the title and the chapter ids. */
export function lessonSeed(spec: SceneSpec): number {
  const s = `${spec.title}|${spec.chapters.map((c) => c.id).join(",")}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The `sb:` id of the occurrence-th use of a group: it rotates through the group's variants from seed % n. */
export function pickVariant(group: string, seed: number, occurrence: number): string {
  const variants = Object.keys(STORY_LIBRARY).filter((v) => STORY_LIBRARY[v]!.group === group);
  if (variants.length === 0) throw new Error(`storybook sound group "${group}" has no variant`);
  return `sb:${variants[(seed + occurrence) % variants.length]}`;
}

export function storySoundsOf(spec: SceneSpec): Map<string, ChapterStorySounds> {
  const out = new Map<string, ChapterStorySounds>();
  if (spec.engine !== "storybook") return out;
  const seed = lessonSeed(spec);
  const used = new Map<string, number>();
  const entryOf = (who: string) => storyCharacter(spec.engineData.characters.find((c) => c.id === who)?.model ?? "");

  for (const c of spec.engineData.chapters) {
    const chapter = spec.chapters.find((x) => x.id === c.chapter);
    // Start of a word in chapter time, clamped to just before the next sentence (or the chapter end).
    const wordAt = (sentence: number, word: number): number | null => {
      const s = chapter?.narration[sentence];
      if (!chapter || !s) return null;
      const times = sentenceWordTimes(spec, chapter, sentence);
      return s.at + (times[Math.min(word, times.length - 1)] ?? 0);
    };
    // Variants rotate in play order, so collect the uses first and number them by time.
    type Use = { at: number; group: string; put: (sound: string) => void };
    const r: ChapterStorySounds = { ambience: [], cues: [], words: [] };
    const uses: Use[] = [];
    for (const g of c.ambience ?? []) uses.push({ at: 0, group: g, put: (sound) => r.ambience.push({ sound, volume: STORY_AMBIENCE_VOLUME }) });
    for (const a of c.acts ?? []) {
      if (a.do === "appear") {
        const group = a.sound === undefined ? entryOf(a.who)?.sound : a.sound || undefined;
        if (group) uses.push({ at: a.at, group, put: (sound) => r.cues.push({ at: a.at, sound, volume: STORY_CUE_VOLUME }) });
      } else if (a.do === "react" && a.sound) {
        const group = a.sound;
        uses.push({ at: a.at, group, put: (sound) => r.cues.push({ at: a.at, sound, volume: STORY_CUE_VOLUME }) });
      } else if (a.do === "row") {
        // Item k enters at `at + k * every`, with its own entrance sound.
        a.who.forEach((who, k) => {
          const group = entryOf(who)?.sound;
          const at = a.at + k * a.every;
          if (group) uses.push({ at, group, put: (sound) => r.cues.push({ at, sound, volume: STORY_CUE_VOLUME }) });
        });
      } else if (a.do === "sound") {
        const at = wordAt(a.sentence, a.word);
        if (at !== null) uses.push({ at, group: a.group, put: (sound) => r.words.push({ sentence: a.sentence, word: a.word, cue: { at, sound, volume: STORY_CUE_VOLUME } }) });
      } else if (a.do === "ambience") {
        uses.push({ at: a.at, group: a.group, put: (sound) => r.ambience.push({ sound, volume: STORY_AMBIENCE_VOLUME, window: [a.at, a.until ?? OPEN_AMBIENCE_END] }) });
      }
    }
    for (const u of uses.sort((x, y) => x.at - y.at)) {
      const n = used.get(u.group) ?? 0;
      used.set(u.group, n + 1);
      u.put(pickVariant(u.group, seed, n));
    }
    out.set(c.chapter, r);
  }
  return out;
}

/** What a tap on a character plays: its own one-shot group, else boing (never an ambience loop). */
export function tapGroupOf(entry: StoryCharacterEntry | undefined): string {
  const g = entry?.sound;
  return g && storyGroup(g)?.kind === "sfx" ? g : "boing";
}

/**
 * Every variant a touch can play in a storybook lesson (the tap code in index.ts picks among them at play
 * time): each character's tap group, boing ("not this one"), the finish (ta-da) and, for the plays that exist, the
 * sparkle of the colouring and the climbing notes of the letter hunt and the order. The export embeds them.
 */
export function tapSoundsOf(spec: SceneSpec): string[] {
  if (spec.engine !== "storybook") return [];
  const groups = new Set<string>(["boing", "ta-da"]);
  for (const c of spec.engineData.characters) groups.add(tapGroupOf(storyCharacter(c.model)));
  const kinds = new Set(spec.engineData.chapters.map((c) => c.play?.kind));
  if (kinds.has("color")) groups.add("sparkle");
  if (kinds.has("letter") || kinds.has("order")) groups.add("xylophone-up");
  return Object.keys(STORY_LIBRARY).filter((v) => groups.has(STORY_LIBRARY[v]!.group)).map((v) => `sb:${v}`);
}
