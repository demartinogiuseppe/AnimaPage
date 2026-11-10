// StageData: the `stage` engine ("Palcoscenico"): characters in dialogue on a small theatre stage.
//
// Pages: literature excerpts with dialogue, theatre, foreign-language conversations, civic-education
// situations, "interviews" with historical figures, myths told by their characters.
//
// Units and axes: 1 unit = 1 metre, y up, the stage floor is y = 0, centred on the origin. The audience
// (default camera, azimuth 0) is on the +z side; the backdrop is at z = -depth/2. Positions on the floor
// are [x, z]; -x is the audience's left. Angles are degrees: facing 0 looks at the audience (+z),
// 90 looks towards +x.
//
// Characters are catalog people (DIORAMA_CATALOG, tag "person"). Who speaks comes from the narration:
// a Sentence with `speaker` = a SceneBase.voices id belongs to the character whose `voice` is that id
// (default: the character's own id). That character gets the spotlight and a speech bubble for the whole
// sentence (until the next sentence starts). Narrator sentences (no speaker) light the whole stage.
//
// Blocking: per-chapter declarative actions, evaluated as a pure function of (chapter, t). Each chapter
// starts from the base state (characters on their `pos`, props on theirs). If a character's first
// enter/exit action of a chapter is "enter", the character waits in the wings until then; otherwise it
// starts as `offstage` says. Characters face automatically (the speaker looks at whom they answer,
// listeners look at the speaker, everyone cheats a little towards the audience) unless a "face" action
// fixes their facing ("auto" gives it back).
//
// Anchors (pins, camera):
// - { entity: "character", part: "<id>" | "<id>.<part>" }: parts base, center, head, top (just above the
//   head: name pins go here), hand (right hand), bubble (the speech bubble beside the head).
// - { entity: "prop", part: "<id>" | "<id>.<part>" }: parts base, center, top, front. A held prop follows the hand.
// - { entity: "set", part: "center" | "front" | "backdrop" | "left" | "right" }: fixed points of the set.
// All parts follow the character (walking, sitting).
import { z } from "zod";
import type { Issue } from "../validate.ts";
import { Id, Vec3, type SceneBase } from "../common.ts";
import { dioramaModel, Shape } from "./diorama.ts";
import { CLOCK_TIME_RE } from "../clock.ts";

type Scene = z.infer<typeof SceneBase>;

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Character and prop ids share one namespace and may not contain dots ("<id>.<part>"). */
const EntityId = z.string().regex(/^[A-Za-z0-9_-]+$/);
/** A point on the stage floor [x, z]. */
const XZ = z.tuple([z.number(), z.number()]);
const Side = z.enum(["left", "right"]);
const Time = z.number().min(0);
const Dur = z.number().positive().max(30);

export const STAGE_BACKDROPS = ["piazza", "aula", "casa", "bosco", "palazzo", "porto", "vuoto"] as const;
export const StageBackdrop = z.enum(STAGE_BACKDROPS);
export type StageBackdrop = z.infer<typeof StageBackdrop>;

/** Default stage floor [width x, depth z], metres. */
export const STAGE_DEFAULT_SIZE: readonly [number, number] = [7, 4.5];
/** Walking speed when an action has no `dur`, m/s. */
export const STAGE_WALK_SPEED = 1.2;
/** Free strip in front of the backdrop flats, metres: characters stand at z >= -depth/2 + this. */
export const STAGE_BACK_MARGIN = 0.8;

const StageSet = z
  .object({
    /** Procedural painted backdrop: town square, classroom, home, wood, ancient palace, harbour, plain drape. */
    backdrop: StageBackdrop,
    /** Floor [width x, depth z] in metres (default 7 x 4.5). */
    size: z.tuple([z.number().min(4).max(14), z.number().min(3).max(8)]).optional(),
    curtain: Color.optional(),
    floor: Color.optional(),
    /** Main colour of the backdrop (sky, wall). */
    wall: Color.optional(),
  })
  .strict();

export const StageCharacter = z
  .object({
    id: EntityId,
    /** A DIORAMA_CATALOG person: man-a..man-f, woman-a..woman-f, boy, girl. */
    model: Id,
    /** SceneBase.voices id of this character's lines (default: the character id). */
    voice: Id.optional(),
    tint: Color.optional(),
    /** Starting mark on the floor [x, z]. */
    pos: XZ,
    /** Fixed facing in degrees (0 = audience); omitted = automatic. */
    facing: z.number().optional(),
    /** Starts every chapter in the wings (see "enter"). */
    offstage: z.boolean().optional(),
    /** Multiplier of the catalog size (default 1). */
    scale: z.number().min(0.5).max(1.5).optional(),
  })
  .strict();
export type StageCharacter = z.infer<typeof StageCharacter>;

export const StageProp = z
  .object({
    id: EntityId,
    /** A DIORAMA_CATALOG id (not a person) or a procedural shape (box, cylinder, sphere, cone, text, patch). */
    model: z.union([Id, Shape]),
    /** Base point [x, y, z]; y > 0 puts it on something (a cup on a table: y = table height). */
    pos: Vec3,
    /** Yaw in degrees (0 = front to the audience). */
    rot: z.number().optional(),
    scale: z.number().positive().max(5).optional(),
    tint: Color.optional(),
    /** Hidden at the start of every chapter (see "show"). */
    hidden: z.boolean().optional(),
    /** Seat height in metres above `pos` for "sit" (default: half the prop height). */
    seat: z.number().min(0).max(2).optional(),
  })
  .strict();
export type StageProp = z.infer<typeof StageProp>;

/** Blocking actions. `who` is a character id, `prop` a prop id. Times in chapter seconds. */
export const StageAction = z.discriminatedUnion("do", [
  /** Walks in from the wings (side default: the nearest) to `to`. */
  z.object({ do: z.literal("enter"), who: EntityId, at: Time, to: XZ, side: Side.optional(), dur: Dur.optional() }).strict(),
  /** Walks out into the wings and disappears. */
  z.object({ do: z.literal("exit"), who: EntityId, at: Time, side: Side.optional(), dur: Dur.optional() }).strict(),
  z.object({ do: z.literal("walk"), who: EntityId, at: Time, to: XZ, dur: Dur.optional() }).strict(),
  /** Instant jump to a mark. */
  z.object({ do: z.literal("place"), who: EntityId, at: Time, to: XZ }).strict(),
  /** Turns towards a character or prop id, "audience", a floor point [x, z] or a fixed angle; "auto" = automatic again. */
  z.object({ do: z.literal("face"), who: EntityId, at: Time, toward: z.union([EntityId, XZ, z.number()]) }).strict(),
  /** Plays a clip of the model (emote-yes, emote-no, interact-right, pick-up, jump, ...) for `dur` seconds (default 1.5). */
  z.object({ do: z.literal("gesture"), who: EntityId, at: Time, clip: z.string().min(1), dur: Dur.optional() }).strict(),
  /** Sits on a prop (a chair, bench, sofa) or on the floor. */
  z.object({ do: z.literal("sit"), who: EntityId, at: Time, on: EntityId.optional() }).strict(),
  z.object({ do: z.literal("stand"), who: EntityId, at: Time }).strict(),
  /** The prop goes into the character's right hand. */
  z.object({ do: z.literal("take"), who: EntityId, at: Time, prop: EntityId }).strict(),
  /** The prop passes from `who` to character `to`. */
  z.object({ do: z.literal("give"), who: EntityId, at: Time, prop: EntityId, to: EntityId }).strict(),
  /** The prop is put down at [x, y, z] or on top of another prop. */
  z.object({ do: z.literal("put"), who: EntityId, at: Time, prop: EntityId, on: z.union([Vec3, EntityId]) }).strict(),
  z.object({ do: z.literal("show"), prop: EntityId, at: Time }).strict(),
  z.object({ do: z.literal("hide"), prop: EntityId, at: Time }).strict(),
  /** Sets a clock prop to `time` ("HH:MM"); with `dur` its hands run forward to it over `dur` seconds. */
  z
    .object({
      do: z.literal("time"),
      prop: z.string().regex(/^[A-Za-z0-9_-]+$/),
      at: z.number().min(0),
      time: z.string().regex(CLOCK_TIME_RE),
      dur: z.number().positive().max(60).optional(),
    })
    .strict(),
]);
export type StageAction = z.infer<typeof StageAction>;

/**
 * "Prova tu" slider (Activity.test.params lists its id):
 * - spacing: multiplies the characters' distance from the stage centre line (personal space, proxemics);
 * - lights: house lights level (low = only the speaker's spotlight).
 */
export const StageParam = z
  .object({
    id: Id,
    kind: z.enum(["spacing", "lights"]),
    /** Italian slider label. */
    label: z.string().min(1),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    value: z.number(),
  })
  .strict();
export type StageParam = z.infer<typeof StageParam>;

const StageChapter = z
  .object({
    chapter: Id,
    blocking: z.array(StageAction),
    params: z.array(StageParam).optional(),
  })
  .strict();

export const StageData = z
  .object({
    set: StageSet,
    characters: z.array(StageCharacter).min(1).max(6),
    props: z.array(StageProp).max(30),
    chapters: z.array(StageChapter),
  })
  .strict();
export type StageData = z.infer<typeof StageData>;

/** Named anchor parts of a character, as fractions of its height (top and bubble are computed by the engine). */
export const STAGE_CHARACTER_PARTS = ["base", "center", "head", "top", "hand", "bubble"] as const;
export const STAGE_PROP_PARTS = ["base", "center", "top", "front"] as const;
export const STAGE_SET_PARTS = ["center", "front", "backdrop", "left", "right"] as const;

export const stageSize = (data: Pick<StageData, "set">): [number, number] => [...(data.set.size ?? STAGE_DEFAULT_SIZE)] as [number, number];

/** Character id that says a line with `speaker` (a voice id). */
export function stageCharacterOfVoice(data: Pick<StageData, "characters">, speaker: string): StageCharacter | undefined {
  return data.characters.find((c) => (c.voice ?? c.id) === speaker);
}

const startOf = (a: StageAction) => a.at;

/**
 * True if the character is on stage at chapter time t (between an enter and an exit), from the blocking only.
 * Shared by the checks; the engine adds the walking in between.
 */
export function stageOnStageAt(data: StageData, chapterId: string, who: string, t: number): boolean {
  const ch = data.chapters.find((c) => c.chapter === chapterId);
  const acts = (ch?.blocking ?? []).filter((a) => "who" in a && a.who === who && (a.do === "enter" || a.do === "exit")).sort((a, b) => startOf(a) - startOf(b));
  const char = data.characters.find((c) => c.id === who);
  let on = acts[0]?.do === "enter" ? false : !char?.offstage;
  for (const a of acts) if (a.at <= t) on = a.do === "enter";
  return on;
}

// ---------------------------------------------------------------------------
// Semantic checks

export function checkStageData(data: StageData, scene: Pick<Scene, "chapters" | "voices">): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const [W, D] = stageSize(data);
  const chars = new Map(data.characters.map((c) => [c.id, c]));
  const props = new Map(data.props.map((p) => [p.id, p]));
  const onFloor = (path: string, [x, z]: readonly [number, number]) => {
    if (Math.abs(x) > W / 2 - 0.25 || z > D / 2 - 0.25 || z < -D / 2 + STAGE_BACK_MARGIN) add(path, `point [${x}, ${z}] is off the stage floor (|x| <= ${W / 2 - 0.25}, ${-D / 2 + STAGE_BACK_MARGIN} <= z <= ${D / 2 - 0.25})`);
  };

  const ids = new Set<string>();
  const voices = new Set((scene.voices ?? []).map((v) => v.id));
  data.characters.forEach((c, i) => {
    const p = `engineData.characters[${i}]`;
    if (ids.has(c.id)) add(p, `duplicate id "${c.id}"`);
    ids.add(c.id);
    const m = dioramaModel(c.model);
    if (!m) add(p, `unknown catalog model "${c.model}"`);
    else if (!m.tags.includes("person")) add(p, `model "${c.model}" is not a person`);
    if (!voices.has(c.voice ?? c.id)) add(p, `character "${c.id}" has no voice "${c.voice ?? c.id}" in voices`);
    onFloor(`${p}.pos`, c.pos);
  });
  data.props.forEach((pr, i) => {
    const p = `engineData.props[${i}]`;
    if (ids.has(pr.id)) add(p, `duplicate id "${pr.id}"`);
    ids.add(pr.id);
    if (typeof pr.model === "string") {
      const m = dioramaModel(pr.model);
      if (!m) add(p, `unknown catalog model "${pr.model}"`);
      else if (m.tags.includes("person")) add(p, `people are characters, not props ("${pr.model}")`);
    } else if (pr.model.shape === "wire" || pr.model.shape === "bulb") add(p, `shape "${pr.model.shape}" is not available on the stage`);
    if (Math.abs(pr.pos[0]) > W / 2 + 0.6 || Math.abs(pr.pos[2]) > D / 2) add(`${p}.pos`, "prop is off the stage");
  });

  const chapters = new Map(scene.chapters.map((c) => [c.id, c]));
  const seen = new Set<string>();
  data.chapters.forEach((c, ci) => {
    const cp = `engineData.chapters[${ci}]`;
    const ch = chapters.get(c.chapter);
    if (!ch) add(cp, `unknown chapter "${c.chapter}"`);
    if (seen.has(c.chapter)) add(cp, `duplicate chapter "${c.chapter}"`);
    seen.add(c.chapter);
    const holder = new Map<string, string>();
    [...c.blocking]
      .map((a, ai) => ({ a, ai }))
      .sort((x, y) => x.a.at - y.a.at)
      .forEach(({ a, ai }) => {
        const ap = `${cp}.blocking[${ai}]`;
        if (ch && a.at > ch.duration) add(ap, "action after the chapter ends");
        if ("who" in a) {
          const who = chars.get(a.who);
          if (!who) return add(ap, `unknown character "${a.who}"`);
          const on = stageOnStageAt(data, c.chapter, a.who, a.at - 1e-6);
          if (a.do === "enter" && on) add(ap, `"${a.who}" is already on stage`);
          if (a.do !== "enter" && !on) add(ap, `"${a.who}" is in the wings at ${a.at}s`);
          if ((a.do === "enter" || a.do === "walk" || a.do === "place") && a.to) onFloor(`${ap}.to`, a.to);
          if (a.do === "gesture" && !dioramaModel(who.model)?.anims?.includes(a.clip)) add(ap, `"${a.who}" has no clip "${a.clip}"`);
          if (a.do === "face" && typeof a.toward === "string" && a.toward !== "audience" && a.toward !== "auto" && !chars.has(a.toward) && !props.has(a.toward))
            add(ap, `unknown face target "${a.toward}"`);
          if (a.do === "sit" && a.on && !props.has(a.on)) add(ap, `unknown seat "${a.on}"`);
          if (a.do === "give" && !chars.has(a.to)) add(ap, `unknown character "${a.to}"`);
          if (a.do === "put" && typeof a.on === "string" && !props.has(a.on)) add(ap, `unknown prop "${a.on}"`);
          if (a.do === "take" || a.do === "give" || a.do === "put") {
            if (!props.has(a.prop)) return add(ap, `unknown prop "${a.prop}"`);
            if ((a.do === "give" || a.do === "put") && holder.get(a.prop) !== a.who) add(ap, `"${a.who}" does not hold "${a.prop}"`);
            if (a.do === "take") holder.set(a.prop, a.who);
            else if (a.do === "give") holder.set(a.prop, a.to);
            else holder.delete(a.prop);
          }
        } else if (!props.has(a.prop)) add(ap, `unknown prop "${a.prop}"`);
        else if (a.do === "time") {
          const m = props.get(a.prop)!.model;
          if (typeof m === "string" || m.shape !== "clock") add(ap, `prop "${a.prop}" is not a clock`);
        }
      });
    const pids = new Set<string>();
    c.params?.forEach((p, pi) => {
      const pp = `${cp}.params[${pi}]`;
      if (pids.has(p.id)) add(pp, `duplicate param "${p.id}"`);
      pids.add(p.id);
      if (!(p.min < p.max) || p.value < p.min || p.value > p.max) add(pp, "needs min < max and min <= value <= max");
    });
    for (const id of ch?.activity?.test.params ?? []) if (!pids.has(id)) add(`${cp}`, `activity param "${id}" is not defined in params`);
  });

  scene.chapters.forEach((ch, c) => {
    if (!seen.has(ch.id)) add(`chapters[${c}]`, `chapter "${ch.id}" has no stage blocking entry`);
    // Lines: the speaker must be a character on stage.
    ch.narration.forEach((s, i) => {
      if (!s.speaker) return;
      const who = stageCharacterOfVoice(data, s.speaker);
      if (!who) add(`chapters[${c}].narration[${i}]`, `speaker "${s.speaker}" is not a character on the stage`);
      else if (!stageOnStageAt(data, ch.id, who.id, s.at + 0.5)) add(`chapters[${c}].narration[${i}]`, `"${who.id}" speaks from the wings`);
    });
    // Anchors.
    const anchored = new Set<string>();
    const anchors: [string, unknown, boolean][] = [
      ...ch.pins.map((p, i): [string, unknown, boolean] => [`chapters[${c}].pins[${i}].anchor`, p.anchor, true]),
      ...ch.camera.map((k, i): [string, unknown, boolean] => [`chapters[${c}].camera[${i}].target`, k.target, false]),
    ];
    for (const [path, anchor, pin] of anchors) {
      if (!anchor || typeof anchor !== "object" || !("entity" in anchor)) continue;
      const a = anchor as { entity: string; part?: string };
      if (a.entity === "set") {
        if (!(STAGE_SET_PARTS as readonly string[]).includes(a.part ?? "")) add(path, `set anchor part must be one of ${STAGE_SET_PARTS.join(", ")}`);
        continue;
      }
      if (a.entity !== "character" && a.entity !== "prop") {
        add(path, `stage anchors use entity "character", "prop" or "set", not "${a.entity}"`);
        continue;
      }
      if (!a.part) {
        add(path, `${a.entity} anchor needs part "<id>" or "<id>.<part>"`);
        continue;
      }
      const [id, part] = a.part.split(".") as [string, string | undefined];
      const known = a.entity === "character" ? chars.has(id) : props.has(id);
      if (!known) add(path, `unknown ${a.entity} "${id}"`);
      const parts: readonly string[] = a.entity === "character" ? STAGE_CHARACTER_PARTS : STAGE_PROP_PARTS;
      if (part !== undefined && !parts.includes(part)) add(path, `${a.entity} has no part "${part}"`);
      if (pin && a.entity === "character") anchored.add(id);
    }
    // Names over the heads: every character on stage in this chapter carries a pin.
    const blocking = data.chapters.find((e) => e.chapter === ch.id)?.blocking ?? [];
    for (const who of data.characters) {
      const appears = stageOnStageAt(data, ch.id, who.id, 0) || blocking.some((a) => a.do === "enter" && a.who === who.id);
      if (appears && !anchored.has(who.id)) add(`chapters[${c}].pins`, `character "${who.id}" is on stage without a name pin`);
    }
  });
  return issues;
}
