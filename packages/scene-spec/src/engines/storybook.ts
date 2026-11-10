// StorybookData: owned by the `storybook` engine (Storie). Children's stories: strong colours,
// procedural cartoon characters (or Kenney models), fun sounds that fire when the narrating voice
// reaches a word. The model writes characters and, per chapter, a place, a few acts and one play.
//
// Conventions
// - Positions are [x, z] on the ground, free units, y up; keep everything inside ~ -8..8.
// - Times are chapter seconds. A `sound` act is tied to a WORD of a narration sentence
//   (0-based word of narration[sentence].text split on spaces), not to a time: the player fires
//   it when the voice reaches that word. The word must belong to the sound group
//   (storybook-sounds.ts wordMatchesGroup), otherwise the checker reports it.
// - A character whose id equals a SceneBase.voices id talks (a bob) during that speaker's lines.
import { z } from "zod";
import type { SceneBase } from "../common.ts";
import { Id } from "../common.ts";
import { dioramaModel } from "./diorama.ts";
import { norm, splitWords, storyGroup, wordMatchesGroup } from "../storybook-sounds.ts";
import type { Issue } from "../validate.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Ground = z.tuple([z.number().min(-30).max(30), z.number().min(-30).max(30)]);
const Group = z.string().min(1).max(40);
const Time = z.number().min(0).max(600);

export const STORY_PLACES = ["sea", "meadow", "rails", "sky"] as const;
export const STORY_GAITS = ["glide", "hop", "swim", "roll", "rock"] as const;
export const STORY_REACTIONS = ["jump", "spin", "laugh", "wobble"] as const;
export type StoryProcId = "whale" | "sailboat" | "caterpillar" | "umbrella" | "ball" | "train" | "sun" | "cloud";

export interface StoryCharacterEntry {
  id: string;
  it: string;
  en: string;
  /** 1 (tiny) to 5 (huge). */
  size: 1 | 2 | 3 | 4 | 5;
  source: { model: string } | { proc: StoryProcId };
  /** Sound group (kind sfx) played on its entrance and when it is touched; none = boing when touched. */
  sound?: string;
  /** Colourable parts (procedural characters only). */
  parts?: string[];
}

const p = (id: StoryProcId, it: string, en: string, size: StoryCharacterEntry["size"], parts: string[], sound?: string): StoryCharacterEntry => ({
  id, it, en, size, source: { proc: id }, parts, ...(sound ? { sound } : {}),
});
const m = (id: string, it: string, en: string, size: StoryCharacterEntry["size"], sound?: string): StoryCharacterEntry => ({
  id, it, en, size, source: { model: id }, ...(sound ? { sound } : {}),
});

export const STORY_CHARACTERS: readonly StoryCharacterEntry[] = [
  p("whale", "balena", "whale", 5, ["body", "belly"], "whale-spout"),
  p("sailboat", "barca", "sailboat", 4, ["hull", "sail"], "boat-creak"),
  p("caterpillar", "bruco", "caterpillar", 2, ["body", "head"]),
  p("umbrella", "ombrello", "umbrella", 2, ["canopy"], "umbrella-open"),
  p("ball", "palla", "ball", 1, ["ball"], "ball-bounce"),
  p("train", "treno", "train", 4, ["engine", "wagon"], "train-whistle"),
  p("sun", "sole", "sun", 5, ["disc"], "sparkle"),
  p("cloud", "nuvola", "cloud", 4, ["cloud"]),
  m("cat", "gatto", "cat", 2, "cat-meow"),
  m("chick", "pulcino", "chick", 1, "chick-peep"),
  m("dog", "cane", "dog", 2, "dog-woof"),
  m("cow", "mucca", "cow", 4, "cow-moo"),
  m("pig", "maiale", "pig", 3),
  m("bunny", "coniglio", "bunny", 2),
  m("fish", "pesce", "fish", 1),
  m("bee", "ape", "bee", 1),
  m("crab", "granchio", "crab", 1),
  m("penguin", "pinguino", "penguin", 2),
  m("elephant", "elefante", "elephant", 5),
  m("giraffe", "giraffa", "giraffe", 5),
  m("lion", "leone", "lion", 4),
  m("monkey", "scimmia", "monkey", 2),
  m("parrot", "pappagallo", "parrot", 2),
  m("apple", "mela", "apple", 1, "apple-crunch"),
  m("mug", "tazza", "mug", 1, "cup-clink"),
  m("hammer", "martello", "hammer", 1, "hammer-tap"),
  m("tree", "albero", "tree", 4),
  m("tree-oak", "quercia", "oak", 5),
  m("tree-pine", "pino", "pine", 5),
  m("tree-palm", "palma", "palm", 5),
];
const CHARACTER_BY_ID = new Map(STORY_CHARACTERS.map((c) => [c.id, c]));
export const storyCharacter = (id: string): StoryCharacterEntry | undefined => CHARACTER_BY_ID.get(id);

export const StoryCharacter = z
  .object({
    id: Id,
    /** A STORY_CHARACTERS id. */
    model: z.string().min(1).max(40),
    at: Ground,
    scale: z.number().min(0.2).max(4).optional(),
    colour: Color.optional(),
    /** Italian display name; default the catalogue's. */
    name: z.string().min(1).max(40).optional(),
  })
  .strict();
export type StoryCharacter = z.infer<typeof StoryCharacter>;

export const StoryAct = z.discriminatedUnion("do", [
  z.object({ do: z.literal("appear"), who: Id, at: Time, sound: z.union([Group, z.literal(false)]).optional() }).strict(),
  z.object({ do: z.literal("move"), who: Id, at: Time, dur: z.number().positive().max(60), to: Ground, gait: z.enum(STORY_GAITS).optional() }).strict(),
  z.object({ do: z.literal("react"), who: Id, at: Time, how: z.enum(STORY_REACTIONS), sound: Group.optional() }).strict(),
  z.object({ do: z.literal("row"), who: z.array(Id).min(2).max(8), at: Time, every: z.number().positive().max(10) }).strict(),
  z.object({ do: z.literal("sound"), group: Group, sentence: z.number().int().min(0).max(60), word: z.number().int().min(0).max(80) }).strict(),
  z.object({ do: z.literal("ambience"), group: Group, at: Time, until: Time.optional() }).strict(),
]);
export type StoryAct = z.infer<typeof StoryAct>;

const Prompt = z.string().min(1).max(160);
const Stamp = z.string().min(1).max(60);
export const StoryPlay = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("touch"), prompt: Prompt, stamp: Stamp }).strict(),
  z.object({ kind: z.literal("letter"), prompt: Prompt, targets: z.array(Id).min(1).max(8), stamp: Stamp }).strict(),
  z.object({ kind: z.literal("order"), prompt: Prompt, order: z.array(Id).min(2).max(6), stamp: Stamp }).strict(),
  z.object({ kind: z.literal("color"), prompt: Prompt, who: Id, stamp: Stamp }).strict(),
]);
export type StoryPlay = z.infer<typeof StoryPlay>;

export const StoryChapter = z
  .object({
    chapter: Id,
    place: z.enum(STORY_PLACES),
    ambience: z.array(Group).max(4).optional(),
    acts: z.array(StoryAct).max(60).optional(),
    play: StoryPlay.optional(),
  })
  .strict();
export type StoryChapter = z.infer<typeof StoryChapter>;

export const StorybookData = z
  .object({
    /** The page's letter, one capital A-Z. */
    letter: z.string().regex(/^[A-Z]$/).optional(),
    characters: z.array(StoryCharacter).min(1).max(12),
    chapters: z.array(StoryChapter).min(1).max(12),
  })
  .strict();
export type StorybookData = z.infer<typeof StorybookData>;

const words = (text: string): string[] => splitWords(text).map((w) => w.word);
const letterOf = (s: string): string => norm(s).charAt(0);

export function checkStorybookData(data: StorybookData, scene: Pick<z.infer<typeof SceneBase>, "chapters" | "voices" | "lang">): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => void issues.push({ path, message });

  const chars = new Map<string, StoryCharacter>();
  data.characters.forEach((c, i) => {
    const path = `engineData.characters[${i}]`;
    if (chars.has(c.id)) add(path, `duplicate character id "${c.id}"`);
    chars.set(c.id, c);
    const entry = storyCharacter(c.model);
    if (!entry) add(path, `unknown character model "${c.model}"`);
    else if ("model" in entry.source && !dioramaModel(entry.source.model)) add(path, `catalogue model "${entry.source.model}" is missing from the diorama catalogue`);
  });
  const entryOf = (id: string): StoryCharacterEntry | undefined => storyCharacter(chars.get(id)?.model ?? "");
  const sizeOf = (id: string): number => (entryOf(id)?.size ?? 0) * (chars.get(id)?.scale ?? 1);
  const nameOf = (id: string): string => chars.get(id)?.name ?? entryOf(id)?.it ?? "";
  const known = (path: string, id: string) => {
    if (!chars.has(id)) add(path, `unknown character "${id}"`);
  };
  // An ambience loop played as a one-shot is never stopped and piles up; a one-shot in an ambience slot is a click.
  const group = (path: string, id: string, kind: "sfx" | "ambience" = "sfx") => {
    const g = storyGroup(id);
    if (!g) add(path, `unknown sound group "${id}"`);
    else if (g.kind !== kind) add(path, kind === "sfx" ? `"${id}" is an ambience loop: a one-shot (sound, appear, react) needs a sound effect group` : `"${id}" is a one-shot: ambience needs an ambience group`);
  };

  const byChapter = new Map(scene.chapters.map((c) => [c.id, c]));
  const voiceLang = new Map((scene.voices ?? []).map((v) => [v.id, v.lang]));

  const seen = new Set<string>();
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    if (seen.has(c.chapter)) add(path, `duplicate storybook entry for chapter "${c.chapter}"`);
    seen.add(c.chapter);
    const ch = byChapter.get(c.chapter);
    if (!ch) add(path, `unknown chapter "${c.chapter}"`);
    c.ambience?.forEach((a, k) => group(`${path}.ambience[${k}]`, a, "ambience"));
    c.acts?.forEach((a, k) => {
      const ap = `${path}.acts[${k}]`;
      if (a.do === "row") a.who.forEach((w) => known(ap, w));
      else if ("who" in a) known(ap, a.who);
      if (a.do === "appear" && typeof a.sound === "string") group(ap, a.sound);
      if (a.do === "react" && a.sound) group(ap, a.sound);
      if (a.do === "ambience") group(ap, a.group, "ambience");
      if (a.do === "sound") {
        group(ap, a.group);
        if (!ch) return;
        const s = ch.narration[a.sentence];
        if (!s) return add(ap, `sentence ${a.sentence} does not exist (the chapter has ${ch.narration.length})`);
        const ws = words(s.text);
        const w = ws[a.word];
        const g = storyGroup(a.group);
        if (w === undefined) add(ap, `word ${a.word} is out of range: sentence ${a.sentence} has ${ws.length} words`);
        else if (g && !wordMatchesGroup(w, g, (s.lang ?? (s.speaker ? voiceLang.get(s.speaker) : undefined) ?? scene.lang)?.startsWith("en") ? "en" : "it")) add(ap, `the word "${w}" does not match sound group "${a.group}": move the cue to a word of the group or drop it`);
      } else if (ch && a.at >= ch.duration) add(ap, `"${a.do}" starts after the chapter ends`);
    });
    const play = c.play;
    if (!play) return;
    const pp = `${path}.play`;
    if (play.kind === "letter") {
      if (!data.letter) add(pp, `a "letter" play needs engineData.letter`);
      play.targets.forEach((t) => {
        known(pp, t);
        if (data.letter && chars.has(t) && letterOf(nameOf(t)) !== data.letter.toLowerCase()) add(pp, `"${nameOf(t)}" does not start with ${data.letter}`);
      });
    }
    if (play.kind === "order") {
      play.order.forEach((t) => known(pp, t));
      if (play.order.every((t) => chars.has(t)) && play.order.some((t, k) => k > 0 && sizeOf(t) >= sizeOf(play.order[k - 1]!))) {
        add(pp, `"order" must go from the biggest to the smallest (size x scale, strictly decreasing)`);
      }
    }
    if (play.kind === "color") {
      known(pp, play.who);
      const entry = entryOf(play.who);
      if (entry && !entry.parts) add(pp, `"${play.who}" has no colourable parts: "color" needs a procedural character`);
    }
  });
  return issues;
}
