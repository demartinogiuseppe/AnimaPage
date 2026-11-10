// Fields shared by every engine. See docs/briefs/BRIEF_paginaviva.md §4.1.
//
// Conventions:
// - Time `t` is chapter-local, in seconds, 0..chapter.duration.
// - Scene coordinates are engine-local units, y up. For geographic engines
//   +x is east and -z is north.
// - Angles in the spec are degrees.
import { z } from "zod";
import { LOCALE_RE } from "./i18n/locale.ts";
import { unexposed } from "./unexposed.ts";

export const Id = z.string().min(1);
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;
/** Inclusive chapter-time window [from, to] in seconds. */
export const TimeRange = z.tuple([z.number(), z.number()]);
export type TimeRange = z.infer<typeof TimeRange>;

/** A point in the scene, resolved by the engine at (chapterId, t). */
export const Anchor = z.union([
  /** Fixed scene coordinates. */
  z.object({ pos: Vec3 }).strict(),
  /** Geographic point [lon, lat]; `alt` in metres above the terrain (map engine). */
  z.object({ geo: z.tuple([z.number(), z.number()]), alt: z.number().optional() }).strict(),
  /** A moving engine entity, e.g. { entity: "ships", index: 6, offset: [0, 1.9, 0] }. */
  z
    .object({
      entity: Id,
      index: z.number().int().min(0).optional(),
      part: z.string().optional(),
      offset: Vec3.optional(),
    })
    .strict(),
]);
export type Anchor = z.infer<typeof Anchor>;

export const SceneKind = z.enum(["history", "myth", "science", "geography", "art", "mixed"]);
export type SceneKind = z.infer<typeof SceneKind>;

export const Sentence = z
  .object({
    at: z.number().min(0),
    text: z.string().min(1),
    /** What the voice says when it differs from `text` ("a.C." -> "avanti Cristo"). */
    speech: z.string().min(1).optional(),
    /** Who says it: id of a SceneBase.voices entry (dialogues on the `stage` engine); omitted = the narrator. */
    speaker: Id.optional(),
    /** Language of this line (BCP-47, e.g. "en-GB"); omitted = the speaker's language, else Italian. */
    lang: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).optional(),
    /** Pins that pulse when this sentence starts. */
    highlight: z.array(Id),
    sourceIds: z.array(Id),
  })
  .strict();
export type Sentence = z.infer<typeof Sentence>;

/**
 * Orbit-style camera key: position = target + distance * (cos(el) sin(az), sin(el), cos(el) cos(az)).
 * azimuth 0 puts the camera on the +z side (south on maps) looking towards -z.
 * The player blends key k-1 -> k over a fixed transition starting at key k's `at`.
 */
export const CameraKey = z
  .object({
    at: z.number().min(0),
    target: Anchor,
    distance: z.number().positive(),
    azimuth: z.number(),
    elevation: z.number().min(-89).max(89),
  })
  .strict();
export type CameraKey = z.infer<typeof CameraKey>;

export const PinKind = z.enum([
  "city",
  "peak",
  "area",
  "sea",
  "region",
  "river",
  "island",
  "place",
  "person",
  "group",
  "object",
  "event",
  "data",
  "note",
]);
export type PinKind = z.infer<typeof PinKind>;

export const Pin = z
  .object({
    id: Id,
    name: z.string().min(1),
    sub: z.string().optional(),
    info: z.string().min(1),
    kind: PinKind,
    /** Small coloured dot next to the name (army side, data category): a CSS colour, e.g. "#2c5fa6". */
    marker: z.string().optional(),
    anchor: Anchor,
    /** Visible only inside these windows; omitted = whole chapter. During a "pick" quiz all pins are visible. */
    visible: z.array(TimeRange).optional(),
    sourceIds: z.array(Id),
  })
  .strict();
export type Pin = z.infer<typeof Pin>;

export const Deep = z.object({ text: z.string().min(1), sourceIds: z.array(Id) }).strict();
export type Deep = z.infer<typeof Deep>;

export const Quiz = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("choice"),
      q: z.string().min(1),
      options: z.array(z.string().min(1)).min(2),
      /** Index into `options`. */
      answer: z.number().int().min(0),
      explain: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("pick"),
      q: z.string().min(1),
      answerPins: z.array(Id).min(1),
      explain: z.string().min(1),
    })
    .strict(),
]);
export type Quiz = z.infer<typeof Quiz>;

/** Status pill text for a time window. `{n}` in `text` is replaced by a counter going from..to over the window. */
export const Status = z
  .object({
    from: z.number().min(0),
    to: z.number().min(0),
    text: z.string().min(1),
    counter: z.object({ from: z.number(), to: z.number() }).strict().optional(),
  })
  .strict();
export type Status = z.infer<typeof Status>;

/** Sound ids refer to the catalog in sounds.ts. Volumes are 0..1 relative to their bus. */
export const SoundCue = z
  .object({
    at: z.number().min(0),
    sound: Id,
    volume: z.number().min(0).max(1).optional(),
    /** Musical note for instrument sounds (sounds.ts category "instrument"), scientific pitch e.g. "C4", "F#3". */
    pitch: z.string().regex(/^[A-G](#|b)?[0-8]$/).optional(),
    /** Note length in seconds (instrument sounds). */
    duration: z.number().positive().max(8).optional(),
  })
  .strict();
export type SoundCue = z.infer<typeof SoundCue>;

/** Looping background sound; `window` omitted = whole chapter. */
export const Ambience = z
  .object({ sound: Id, volume: z.number().min(0).max(1).optional(), window: TimeRange.optional() })
  .strict();
export type Ambience = z.infer<typeof Ambience>;

export const ChapterSounds = z.object({ ambience: z.array(Ambience), cues: z.array(SoundCue) }).strict();
export type ChapterSounds = z.infer<typeof ChapterSounds>;

export const Music = z.object({ track: Id, volume: z.number().min(0).max(1).optional() }).strict();
export type Music = z.infer<typeof Music>;

/** Left page of the pop-up book (decision D12): the chapter's key text, short. */
export const BookPage = z
  .object({
    heading: z.string().min(1),
    /** Key formula or rule, displayed large (plain text, e.g. "E = m · g · h"). */
    formula: z.string().optional(),
    /** 1–5 short lines. */
    lines: z.array(z.string().min(1)).max(5),
    sourceIds: z.array(Id),
  })
  .strict();
export type BookPage = z.infer<typeof BookPage>;

/** Prevedi → Prova → Dimostra (decision D13). */
export const Activity = z
  .object({
    /** Asked before the scene plays; the answer is revealed with the proof. */
    predict: z
      .object({
        q: z.string().min(1),
        options: z.array(z.string().min(1)).min(2),
        answer: z.number().int().min(0),
      })
      .strict(),
    /** What to watch or do in the scene; `params` are engine parameters the user can move (sliders). */
    test: z.object({ prompt: z.string().min(1), params: z.array(Id).optional() }).strict(),
    /** Shown under the flap ("alza la linguetta"). */
    prove: z.object({ text: z.string().min(1), sourceIds: z.array(Id) }).strict(),
    /** Stamp earned at the end of the chapter, e.g. "Esploratore dei vulcani". */
    stamp: z.string().min(1),
  })
  .strict();
export type Activity = z.infer<typeof Activity>;

export const Chapter = z
  .object({
    id: Id,
    title: z.string().min(1),
    /** Short name for the chapter chips. */
    chip: z.string().min(1),
    kind: SceneKind,
    dates: z.string().optional(),
    duration: z.number().positive(),
    narration: z.array(Sentence).min(1),
    camera: z.array(CameraKey),
    pins: z.array(Pin),
    deep: z.array(Deep),
    quiz: z.array(Quiz),
    status: z.array(Status).optional(),
    sounds: ChapterSounds.optional(),
    book: BookPage.optional(),
    activity: Activity.optional(),
  })
  .strict();
export type Chapter = z.infer<typeof Chapter>;

/** The photographed page itself is always the source with id "page". */
export const PAGE_SOURCE_ID = "page";

export const Source = z
  .object({
    id: Id,
    kind: z.enum(["page", "wikipedia", "wikidata", "web", "dataset", "computed"]),
    title: z.string().min(1),
    url: z.url().optional(),
    publisher: z.string().optional(),
    /** Access date, YYYY-MM-DD. */
    accessed: z.iso.date().optional(),
    wikidataId: z.string().regex(/^Q\d+$/).optional(),
    license: z.string().optional(),
  })
  .strict();
export type Source = z.infer<typeof Source>;

/** Embedded only through the official players (youtube-nocookie.com, Commons). Never downloaded. */
export const Video = z
  .object({
    id: Id,
    provider: z.enum(["youtube", "commons"]),
    /** YouTube video id, or Commons file name ("File:....webm"). */
    ref: z.string().min(1),
    title: z.string().min(1),
    channel: z.string().optional(),
    durationSec: z.number().positive().optional(),
    /** Source entry with licence and author of the video (e.g. "commons-<id>"). */
    sourceId: Id.optional(),
  })
  .strict();
export type Video = z.infer<typeof Video>;

export const PageInfo = z
  .object({
    subject: z.string().min(1),
    topic: z.string().min(1),
    bookPage: z.string().optional(),
    language: z.literal("it"),
  })
  .strict();

/** Fields every SceneSpec has; the engine-specific part is added in index.ts. */
export const SceneBase = z.object({
  version: z.literal("0.1"),
  /** Big title of the lesson ("I Micenei"). */
  title: z.string().min(1),
  page: PageInfo,
  kind: SceneKind,
  chapters: z.array(Chapter).min(1),
  sources: z.array(Source),
  videos: z.array(Video),
  disclaimers: z.array(z.string().min(1)),
  /** Background music for the whole lesson; the user can switch it off. */
  music: Music.optional(),
  /** Characters' voices for dialogues (Sentence.speaker). The narrator is the default voice. */
  voices: z
    .array(
      z
        .object({
          id: Id,
          /** Character name shown next to the line. */
          name: z.string().min(1),
          prefer: z.enum(["female", "male", "any"]).optional(),
          /** Language the character speaks (BCP-47, e.g. "en-GB"); omitted = Italian. */
          lang: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).optional(),
          /** 0.5..2, 1 = normal. */
          pitch: z.number().min(0.5).max(2).optional(),
          rate: z.number().min(0.5).max(2).optional(),
        })
        .strict(),
    )
    .optional(),
  /** Default visual style (decision D12); the user can switch in the player. */
  style: z.enum(["color", "ink"]).optional(),
  /**
   * Who the lesson is for (decision D24): "child" (primary school), "teen" (secondary school), "adult"
   * (university, adult readers). The player shows "adult" lessons in the sober "Accademico" presentation
   * instead of the pop-up book (the user can override it). Omitted = unknown (pop-up book, or the
   * maths/physics university heuristic). Set by the server from the analysis (D25), not by the generation
   * model: unexposed.ts keeps it out of the generation schema.
   */
  audience: unexposed(z.enum(["child", "teen", "adult"]).optional()),
  /**
   * Language of the lesson (BCP-47, decision D21): narration voice, number format and engine labels.
   * Omitted = Italian. Set by the server, not by the model (it is not in the generation schema).
   */
  lang: z.string().regex(LOCALE_RE).optional(),
});
