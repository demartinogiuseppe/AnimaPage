// DioramaData: the generalist `diorama` engine (stories, everyday life, jobs, cooking, descriptive science).
//
// A diorama is a small stage with *items* (catalog models or procedural shapes) animated by
// declarative per-chapter *actions*. The state of every item is a pure function of (chapter, t).
//
// Units and axes: 1 unit = 1 metre, y up, the ground is y = 0. The stage is centred on the origin.
// Models face +z: the default camera (azimuth 0) looks at their front. Angles are degrees;
// yaw 0 faces +z, yaw 90 faces +x. Catalog models are scaled so their height is the catalog `size[1]`
// (times the item's `scale`), their base sits on `pos` and they are centred on it in x/z.
//
// Anchors (pins, camera): { entity: "item", part: "<itemId>" } is the item's base point;
// { entity: "item", part: "<itemId>.<part>" } a named part: every item has base, center, top, front;
// people also have head; text items have one part per character index ("sign.0", "sign.1", ...).
// A part follows the item (move, turn, scale, fall, attach).
//
// Time-ordered evaluation: for each item, the actions of the chapter that target it are applied in
// order of their start time on top of the item's base state. Actions of the same kind on the same item
// should not overlap in time. Visibility: if the first show/hide action of a chapter is "show", the
// item is hidden until then (it "appears"); otherwise it starts as `hidden` says. The same rule holds
// for "power" actions with `on: true` (the item starts switched off).
import { z } from "zod";
import type { Issue } from "../validate.ts";
import { Id, Vec3, type SceneBase } from "../common.ts";
import { CLOCK_TIME_RE, ClockShape } from "../clock.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Item ids may not contain dots: "<itemId>.<part>" addresses parts. */
const ItemId = z.string().regex(/^[A-Za-z0-9_-]+$/);
const Ease = z.enum(["linear", "inOutQuad", "inOutCubic", "inQuad", "outQuad", "outBack"]);
/** Degrees: a number is a yaw; [x, y, z] Euler angles (applied y, then x, then z). */
const Rotation = z.union([z.number(), Vec3]);
/** A point that may move: fixed coordinates, "<itemId>" (its base) or "<itemId>.<part>". */
const Point = z.union([Vec3, z.string().regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/)]);
const Keys = z.array(z.object({ at: z.number().min(0), value: z.number(), ease: Ease.optional() }).strict()).min(1);

// ---------------------------------------------------------------------------
// Stage

export const GroundType = z.enum(["grass", "asphalt", "pavement", "sand", "dirt", "snow", "water", "floor"]);

const Stage = z
  .object({
    /** Ground extent [width x, depth z] in metres: also the camera limits and AR scale. */
    size: z.tuple([z.number().positive(), z.number().positive()]),
    ground: z.object({ type: GroundType, color: Color.optional() }).strict(),
    /** Fixed sky gradient; omitted = derived from the hour of the day. */
    sky: z.object({ top: Color, bottom: Color }).strict().optional(),
    /** Fog towards the horizon (default true). */
    fog: z.boolean().optional(),
    /** Default hour of the day 0..24 (default 12) when a chapter has no `hour`. */
    hour: z.number().min(0).max(24).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Items

/** Procedural shapes, for everything the catalog lacks. Sizes in metres. */
export const Shape = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("box"), size: Vec3, color: Color }).strict(),
  z.object({ shape: z.literal("cylinder"), radius: z.number().positive(), height: z.number().positive(), color: Color, radiusTop: z.number().min(0).optional(), sides: z.number().int().min(3).max(48).optional() }).strict(),
  z.object({ shape: z.literal("sphere"), radius: z.number().positive(), color: Color }).strict(),
  z.object({ shape: z.literal("cone"), radius: z.number().positive(), height: z.number().positive(), color: Color }).strict(),
  /**
   * Dot-matrix 3D letters (A-Z, 0-9, accented vowels, . , ! ? ' - : / +), bottom-centred on `pos`, facing +z.
   * `height` = letter height. Neon letters glow in their colour while powered (see power/blink actions).
   * `plate` draws a backing board behind the text.
   */
  z
    .object({
      shape: z.literal("text"),
      text: z.string().min(1).max(40),
      color: Color,
      height: z.number().positive(),
      depth: z.number().positive().optional(),
      neon: z.boolean().optional(),
      plate: Color.optional(),
    })
    .strict(),
  /** Flat area on the ground (roads, pavements, fields, rugs). `pattern` adds markings in `patternColor`. */
  z
    .object({
      shape: z.literal("patch"),
      size: z.tuple([z.number().positive(), z.number().positive()]),
      color: Color,
      pattern: z.enum(["zebra", "dashes", "tiles"]).optional(),
      patternColor: Color.optional(),
    })
    .strict(),
  /** A cable between two points (they may move), sagging by `sag` metres in the middle. */
  z.object({ shape: z.literal("wire"), from: Point, to: Point, sag: z.number().min(0).optional(), color: Color.optional(), thickness: z.number().positive().optional() }).strict(),
  /** A glowing bulb; give the item a `light` to make it light up the scene. */
  z.object({ shape: z.literal("bulb"), radius: z.number().positive(), color: Color }).strict(),
  /** Analog/digital clock (clock.ts); its time changes with the "time" action. */
  ClockShape,
]);
export type Shape = z.infer<typeof Shape>;

export const DioramaItem = z
  .object({
    id: ItemId,
    /** A catalog id (DIORAMA_CATALOG) or a procedural shape. */
    model: z.union([Id, Shape]),
    pos: Vec3,
    rot: Rotation.optional(),
    /** Multiplier of the catalog size (default 1). */
    scale: z.number().positive().optional(),
    /** Multiplies the model colours (catalog models). */
    tint: Color.optional(),
    /** Hidden at the start of every chapter (see show). */
    hidden: z.boolean().optional(),
    /** Animation clip looping by default (catalog `anims`); default "idle" when the model has it. */
    anim: z.string().optional(),
    /** Emissive colour while powered (signs, screens, machines). */
    glow: Color.optional(),
    /** Point light while powered, at `offset` from the base. */
    light: z
      .object({ color: Color.optional(), intensity: z.number().min(0).optional(), distance: z.number().positive().optional(), offset: Vec3.optional() })
      .strict()
      .optional(),
    /** Initial power: true (default), false, or "night" = on when it is dark. */
    power: z.union([z.boolean(), z.literal("night")]).optional(),
  })
  .strict();
export type DioramaItem = z.infer<typeof DioramaItem>;

// ---------------------------------------------------------------------------
// Actions

const Target = z.union([ItemId, z.array(ItemId).min(1)]);
const Appear = z.enum(["pop", "fade", "grow", "instant"]);

export const DioramaAction = z.discriminatedUnion("do", [
  /** Appears at `at` (pop = bouncy scale, grow = scale from 0, fade = opacity). */
  z.object({ do: z.literal("show"), target: Target, at: z.number().min(0), dur: z.number().min(0).optional(), style: Appear.optional() }).strict(),
  z.object({ do: z.literal("hide"), target: Target, at: z.number().min(0), dur: z.number().min(0).optional(), style: Appear.optional() }).strict(),
  /** Instant teleport to `pos` and/or rotation `rot`. */
  z.object({ do: z.literal("place"), target: Target, at: z.number().min(0), pos: Vec3.optional(), rot: Rotation.optional() }).strict(),
  /**
   * Walks/flies through `path` (points after the current position) at constant speed, eased overall.
   * `arc` lifts the middle of the trip (jumps, throws). `face` turns towards the travel direction
   * (default: true when `anim` is set). `anim` plays a clip during the move (e.g. "walk").
   */
  z
    .object({
      do: z.literal("move"),
      target: Target,
      from: z.number().min(0),
      to: z.number().min(0),
      path: z.array(Vec3).min(1),
      ease: Ease.optional(),
      arc: z.number().optional(),
      face: z.boolean().optional(),
      anim: z.string().optional(),
    })
    .strict(),
  /** Adds `by` degrees (a yaw, or [x, y, z]). */
  z.object({ do: z.literal("turn"), target: Target, from: z.number().min(0), to: z.number().min(0), by: Rotation, ease: Ease.optional() }).strict(),
  /** Scales to `value` times the base size (number or per-axis). */
  z.object({ do: z.literal("scale"), target: Target, from: z.number().min(0), to: z.number().min(0), value: z.union([z.number().min(0), Vec3]), ease: Ease.optional() }).strict(),
  /** Plays a clip from `from` (to `to`, default the end of the chapter); `loop` default true. */
  z.object({ do: z.literal("anim"), target: Target, from: z.number().min(0), to: z.number().min(0).optional(), clip: z.string().min(1), speed: z.number().positive().optional(), loop: z.boolean().optional() }).strict(),
  /** Vibrates by `amount` metres (default 0.05). */
  z.object({ do: z.literal("shake"), target: Target, from: z.number().min(0), to: z.number().min(0), amount: z.number().positive().optional() }).strict(),
  /** Topples over towards yaw `dir` (default: where it faces) and drops to `floor` (default 0). */
  z.object({ do: z.literal("fall"), target: Target, at: z.number().min(0), dur: z.number().positive().optional(), dir: z.number().optional(), floor: z.number().optional() }).strict(),
  /** Flies into `pieces` fragments (default 14) with sparks; the item disappears. */
  z
    .object({
      do: z.literal("explode"),
      target: Target,
      at: z.number().min(0),
      pieces: z.number().int().min(3).max(60).optional(),
      colors: z.array(Color).min(1).optional(),
      force: z.number().positive().optional(),
      seed: z.number().int().optional(),
    })
    .strict(),
  /** Switches glow/light/neon on or off. */
  z.object({ do: z.literal("power"), target: Target, at: z.number().min(0), on: z.boolean(), dur: z.number().min(0).optional() }).strict(),
  /** Blinks (regular, `period` seconds) or flickers (irregular) between `from` and `to`. */
  z
    .object({ do: z.literal("blink"), target: Target, from: z.number().min(0), to: z.number().min(0), period: z.number().positive().optional(), mode: z.enum(["blink", "flicker"]).optional(), seed: z.number().int().optional() })
    .strict(),
  /** Follows `parent` (or one of its parts) at `offset` in the parent's frame, from `from` to `to` (then stays where it was). */
  z
    .object({ do: z.literal("attach"), target: Target, from: z.number().min(0), to: z.number().min(0).optional(), parent: ItemId, part: z.string().optional(), offset: Vec3.optional() })
    .strict(),
  /** Changes the text of a text item. */
  z.object({ do: z.literal("text"), target: Target, at: z.number().min(0), text: z.string().min(1).max(40) }).strict(),
  /** Sets a clock item to `time` ("HH:MM"); with `dur` the hands run forward to it over `dur` seconds. */
  z
    .object({
      do: z.literal("time"),
      target: z.string().regex(/^[A-Za-z0-9_-]+$/),
      at: z.number().min(0),
      time: z.string().regex(CLOCK_TIME_RE),
      dur: z.number().positive().max(60).optional(),
    })
    .strict(),
  // Effects: placed at a Point, not on an item.
  /** Electric sparks. */
  z.object({ do: z.literal("sparks"), at: Point, from: z.number().min(0), to: z.number().min(0), color: Color.optional(), count: z.number().int().min(1).max(200).optional(), seed: z.number().int().optional() }).strict(),
  /** Rising smoke puffs. */
  z.object({ do: z.literal("smoke"), at: Point, from: z.number().min(0), to: z.number().min(0), color: Color.optional(), size: z.number().positive().optional(), seed: z.number().int().optional() }).strict(),
  /** Flames with a flickering light. */
  z.object({ do: z.literal("fire"), at: Point, from: z.number().min(0), to: z.number().min(0), size: z.number().positive().optional(), seed: z.number().int().optional() }).strict(),
  /** Glowing trail behind a moving item, `length` seconds long (default 1.2). */
  z.object({ do: z.literal("trail"), target: ItemId, from: z.number().min(0), to: z.number().min(0), color: Color.optional(), length: z.number().positive().optional() }).strict(),
]);
export type DioramaAction = z.infer<typeof DioramaAction>;

const DioramaChapter = z
  .object({
    chapter: Id,
    /** Hour of the day 0..24: a fixed number or keys (sky, sun, stars, "night" power). */
    hour: z.union([z.number().min(0).max(24), Keys]).optional(),
    actions: z.array(DioramaAction),
  })
  .strict();

export const DioramaData = z
  .object({
    stage: Stage,
    items: z.array(DioramaItem).min(1),
    /** One entry per scene chapter that animates something; chapters without an entry show the base state. */
    chapters: z.array(DioramaChapter),
  })
  .strict();
export type DioramaData = z.infer<typeof DioramaData>;

// ---------------------------------------------------------------------------
// Model catalog

export interface DioramaModel {
  id: string;
  /** GLB path relative to the asset base (fixtures/public); absent for procedural models. */
  file?: string;
  /** License pack, see docs/assets-3d.md. */
  pack: string;
  it: string;
  en: string;
  tags: string[];
  /** Default size [width x, height y, depth z] in metres. */
  size: [number, number, number];
  /** Animation clips. */
  anims?: string[];
}

/** Named anchor parts as fractions of the item size, in the item frame. */
export const COMMON_PARTS: Record<string, [number, number, number]> = {
  base: [0, 0, 0],
  center: [0, 0.5, 0],
  top: [0, 1, 0],
  front: [0, 0.5, 0.5],
};
export const PERSON_PARTS: Record<string, [number, number, number]> = { head: [0, 0.82, 0], hand: [0.3, 0.45, 0.25] };

// Generated by packages/engine/src/engines/diorama/tools/build-models.mjs: do not edit by hand.
export const DIORAMA_CATALOG: readonly DioramaModel[] = [
  // <catalog:generated>
  {"id":"man-a","file":"models/man-a.glb","pack":"kenney-mini-characters","it":"uomo con maglia verde","en":"man in a green shirt","tags":["person","adult","man"],"size":[0.63,1.75,0.42],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"man-b","file":"models/man-b.glb","pack":"kenney-mini-characters","it":"uomo calvo e robusto","en":"stocky bald man","tags":["person","adult","man"],"size":[0.63,1.75,0.42],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"man-c","file":"models/man-c.glb","pack":"kenney-mini-characters","it":"uomo con berretto e divisa blu (vigile, operaio, elettricista)","en":"man with a blue cap and uniform (officer, worker, electrician)","tags":["person","adult","man","worker"],"size":[0.63,1.75,0.42],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"man-d","file":"models/man-d.glb","pack":"kenney-mini-characters","it":"uomo con camicia e cravatta (impiegato, padrone del negozio)","en":"man in shirt and tie (clerk, shop owner)","tags":["person","adult","man"],"size":[0.63,1.75,0.42],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"man-e","file":"models/man-e.glb","pack":"kenney-mini-characters","it":"uomo con occhiali e maglia gialla","en":"man with glasses and a yellow top","tags":["person","adult","man"],"size":[0.63,1.75,0.42],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"man-f","file":"models/man-f.glb","pack":"kenney-mini-characters","it":"uomo con capelli scuri e maglia verde","en":"dark-haired man in a green top","tags":["person","adult","man"],"size":[0.63,1.75,0.42],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"woman-a","file":"models/woman-a.glb","pack":"kenney-mini-characters","it":"donna con capelli scuri e vestito viola","en":"dark-haired woman in purple","tags":["person","adult","woman"],"size":[0.59,1.65,0.4],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"woman-b","file":"models/woman-b.glb","pack":"kenney-mini-characters","it":"donna con capelli rossi raccolti","en":"woman with red hair buns","tags":["person","adult","woman"],"size":[0.59,1.65,0.4],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"woman-c","file":"models/woman-c.glb","pack":"kenney-mini-characters","it":"donna con berretto","en":"woman with a beanie","tags":["person","adult","woman"],"size":[0.59,1.65,0.4],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"woman-d","file":"models/woman-d.glb","pack":"kenney-mini-characters","it":"donna con capelli ramati e giacca scura","en":"auburn-haired woman in a dark jacket","tags":["person","adult","woman"],"size":[0.59,1.65,0.4],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"woman-e","file":"models/woman-e.glb","pack":"kenney-mini-characters","it":"donna con capelli neri e maglia bianca (cuoca, dottoressa)","en":"black-haired woman in white (cook, doctor)","tags":["person","adult","woman","worker"],"size":[0.59,1.65,0.4],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"woman-f","file":"models/woman-f.glb","pack":"kenney-mini-characters","it":"donna con capelli lunghi castani","en":"woman with long brown hair","tags":["person","adult","woman"],"size":[0.59,1.65,0.4],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"boy","file":"models/man-e.glb","pack":"kenney-mini-characters","it":"bambino","en":"boy (child)","tags":["person","child","boy"],"size":[0.45,1.25,0.3],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"girl","file":"models/woman-b.glb","pack":"kenney-mini-characters","it":"bambina","en":"girl (child)","tags":["person","child","girl"],"size":[0.43,1.2,0.29],"anims":["idle","walk","sprint","jump","fall","crouch","sit","drive","die","pick-up","emote-yes","emote-no","holding-right","holding-left","holding-both","attack-melee-right","attack-melee-left","attack-kick-right","attack-kick-left","interact-right","interact-left"]},
  {"id":"wheelchair","file":"models/wheelchair.glb","pack":"kenney-mini-characters","it":"sedia a rotelle","en":"wheelchair","tags":["object","health"],"size":[1.01,1,1.18]},
  {"id":"cat","file":"models/cat.glb","pack":"kenney-cube-pets","it":"gatto","en":"cat","tags":["animal","pet"],"size":[0.29,0.4,0.42],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"dog","file":"models/dog.glb","pack":"kenney-cube-pets","it":"cane","en":"dog","tags":["animal","pet"],"size":[0.48,0.6,0.57],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"bunny","file":"models/bunny.glb","pack":"kenney-cube-pets","it":"coniglio","en":"rabbit","tags":["animal","pet","farm"],"size":[0.25,0.4,0.26],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"chick","file":"models/chick.glb","pack":"kenney-cube-pets","it":"pulcino","en":"chick","tags":["animal","farm","bird"],"size":[0.41,0.3,0.25],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"cow","file":"models/cow.glb","pack":"kenney-cube-pets","it":"mucca","en":"cow","tags":["animal","farm"],"size":[1.43,1.5,1.36],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"pig","file":"models/pig.glb","pack":"kenney-cube-pets","it":"maiale","en":"pig","tags":["animal","farm"],"size":[0.71,0.9,0.83],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"hog","file":"models/hog.glb","pack":"kenney-cube-pets","it":"cinghiale","en":"wild boar","tags":["animal","wild"],"size":[0.8,0.9,0.89],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"deer","file":"models/deer.glb","pack":"kenney-cube-pets","it":"cervo","en":"deer","tags":["animal","wild","forest"],"size":[1.08,1.4,1.1],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"fox","file":"models/fox.glb","pack":"kenney-cube-pets","it":"volpe","en":"fox","tags":["animal","wild","forest"],"size":[0.44,0.6,0.82],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"beaver","file":"models/beaver.glb","pack":"kenney-cube-pets","it":"castoro","en":"beaver","tags":["animal","wild","river"],"size":[0.42,0.5,0.61],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"bee","file":"models/bee.glb","pack":"kenney-cube-pets","it":"ape (grande per essere vista)","en":"bee (oversized to be visible)","tags":["animal","insect"],"size":[0.16,0.25,0.16],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"crab","file":"models/crab.glb","pack":"kenney-cube-pets","it":"granchio","en":"crab","tags":["animal","sea"],"size":[0.49,0.3,0.28],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"fish","file":"models/fish.glb","pack":"kenney-cube-pets","it":"pesce","en":"fish","tags":["animal","sea"],"size":[0.46,0.4,0.31],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"penguin","file":"models/penguin.glb","pack":"kenney-cube-pets","it":"pinguino","en":"penguin","tags":["animal","cold","bird"],"size":[1.24,0.9,0.76],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"polar-bear","file":"models/polar-bear.glb","pack":"kenney-cube-pets","it":"orso polare","en":"polar bear","tags":["animal","cold","wild"],"size":[1.33,1.6,1.59],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"parrot","file":"models/parrot.glb","pack":"kenney-cube-pets","it":"pappagallo","en":"parrot","tags":["animal","bird","jungle"],"size":[0.52,0.4,0.45],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"monkey","file":"models/monkey.glb","pack":"kenney-cube-pets","it":"scimmia","en":"monkey","tags":["animal","jungle"],"size":[0.98,0.8,0.89],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"lion","file":"models/lion.glb","pack":"kenney-cube-pets","it":"leone","en":"lion","tags":["animal","savanna","wild"],"size":[1.13,1.2,1.31],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"tiger","file":"models/tiger.glb","pack":"kenney-cube-pets","it":"tigre","en":"tiger","tags":["animal","jungle","wild"],"size":[0.87,1.1,1.22],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"elephant","file":"models/elephant.glb","pack":"kenney-cube-pets","it":"elefante","en":"elephant","tags":["animal","savanna","wild"],"size":[3.94,3,3.51],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"giraffe","file":"models/giraffe.glb","pack":"kenney-cube-pets","it":"giraffa","en":"giraffe","tags":["animal","savanna","wild"],"size":[3.63,4,3.31],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"panda","file":"models/panda.glb","pack":"kenney-cube-pets","it":"panda","en":"panda","tags":["animal","wild"],"size":[1.07,1.2,1.15],"anims":["idle","walk","run","eat","dance","gesture-positive","gesture-negative"]},
  {"id":"shop-building-a","file":"models/shop-building-a.glb","pack":"kenney-city-kit-commercial","it":"palazzo con negozi al piano terra","en":"apartment block with shops on the ground floor","tags":["building","city","shop"],"size":[8.2,12,8.72]},
  {"id":"shop-building-b","file":"models/shop-building-b.glb","pack":"kenney-city-kit-commercial","it":"palazzina bassa con negozio","en":"low building with a shop","tags":["building","city","shop"],"size":[7.92,8,9.76]},
  {"id":"apartment-a","file":"models/apartment-a.glb","pack":"kenney-city-kit-commercial","it":"condominio alto e stretto","en":"tall narrow apartment block","tags":["building","city","home"],"size":[8.59,15,8.17]},
  {"id":"skyscraper-a","file":"models/skyscraper-a.glb","pack":"kenney-city-kit-commercial","it":"grattacielo a vetri","en":"glass skyscraper","tags":["building","city","work"],"size":[18.89,40,18.89]},
  {"id":"awning","file":"models/awning.glb","pack":"kenney-city-kit-commercial","it":"tenda da negozio (sopra una porta)","en":"shop awning (over a door)","tags":["street","shop","detail"],"size":[2.6,2.6,0.96]},
  {"id":"awning-wide","file":"models/awning-wide.glb","pack":"kenney-city-kit-commercial","it":"tenda da negozio larga","en":"wide shop awning","tags":["street","shop","detail"],"size":[5.2,2.6,0.96]},
  {"id":"parasol","file":"models/parasol.glb","pack":"kenney-city-kit-commercial","it":"ombrellone da bar","en":"café parasol","tags":["street","shop","café"],"size":[1.85,2.4,2.13]},
  {"id":"house-a","file":"models/house-a.glb","pack":"kenney-city-kit-suburban","it":"villetta con tetto verde","en":"small house with a green roof","tags":["building","home","suburb"],"size":[10.92,7,8.63]},
  {"id":"house-b","file":"models/house-b.glb","pack":"kenney-city-kit-suburban","it":"casa a due piani","en":"two-storey house","tags":["building","home","suburb"],"size":[8.71,7,6.96]},
  {"id":"house-c","file":"models/house-c.glb","pack":"kenney-city-kit-suburban","it":"casa con garage","en":"house with a garage","tags":["building","home","suburb"],"size":[8.79,7,8.65]},
  {"id":"fence-garden","file":"models/fence-garden.glb","pack":"kenney-city-kit-suburban","it":"recinto del giardino","en":"garden fence","tags":["street","garden"],"size":[4.72,1,1.62]},
  {"id":"planter","file":"models/planter.glb","pack":"kenney-city-kit-suburban","it":"fioriera con cespugli","en":"planter with bushes","tags":["street","garden","plant"],"size":[1.81,0.8,1.36]},
  {"id":"tree-city","file":"models/tree-city.glb","pack":"kenney-city-kit-suburban","it":"albero da viale","en":"street tree","tags":["nature","tree","city"],"size":[1.37,5,1.58]},
  {"id":"traffic-light","file":"models/traffic-light.glb","pack":"kenney-city-kit-roads","it":"semaforo","en":"traffic light","tags":["street","traffic","light"],"size":[0.73,3.2,0.56]},
  {"id":"traffic-light-hanging","file":"models/traffic-light-hanging.glb","pack":"kenney-city-kit-roads","it":"semaforo sospeso sopra la strada","en":"hanging traffic light over the road","tags":["street","traffic","light"],"size":[1.15,5,2.9]},
  {"id":"street-lamp","file":"models/street-lamp.glb","pack":"kenney-city-kit-roads","it":"lampione","en":"street lamp","tags":["street","light"],"size":[0.42,5,1.98]},
  {"id":"street-lamp-curved","file":"models/street-lamp-curved.glb","pack":"kenney-city-kit-roads","it":"lampione curvo","en":"curved street lamp","tags":["street","light"],"size":[0.41,5.5,1.83]},
  {"id":"sign-stop","file":"models/sign-stop.glb","pack":"kenney-city-kit-roads","it":"cartello di stop","en":"stop sign","tags":["street","traffic","sign"],"size":[0.39,2.5,0.7]},
  {"id":"sign-warning","file":"models/sign-warning.glb","pack":"kenney-city-kit-roads","it":"cartello di pericolo","en":"warning sign","tags":["street","traffic","sign"],"size":[0.39,2.5,0.74]},
  {"id":"highway-sign","file":"models/highway-sign.glb","pack":"kenney-city-kit-roads","it":"cartello stradale grande da autostrada","en":"big highway sign gantry","tags":["street","traffic","sign","road"],"size":[1.12,6,8.48]},
  {"id":"electricity-pole","file":"models/electricity-pole.glb","pack":"kenney-city-kit-roads","it":"palo della luce con fili","en":"electricity pole","tags":["street","electricity"],"size":[7.72,7,2.86]},
  {"id":"traffic-cone","file":"models/traffic-cone.glb","pack":"kenney-city-kit-roads","it":"cono stradale","en":"traffic cone","tags":["street","work"],"size":[0.48,0.6,0.48]},
  {"id":"dumpster","file":"models/dumpster.glb","pack":"kenney-city-kit-roads","it":"cassonetto dei rifiuti","en":"dumpster","tags":["street","city"],"size":[1.84,1.4,2.47]},
  {"id":"table","file":"models/table.glb","pack":"kenney-furniture-kit","it":"tavolo","en":"table","tags":["furniture","home"],"size":[1.93,0.75,1.03]},
  {"id":"table-round","file":"models/table-round.glb","pack":"kenney-furniture-kit","it":"tavolino rotondo (bar, cucina)","en":"round table (café, kitchen)","tags":["furniture","home","café"],"size":[1.42,0.75,1.64]},
  {"id":"chair","file":"models/chair.glb","pack":"kenney-furniture-kit","it":"sedia","en":"chair","tags":["furniture","home"],"size":[0.38,0.9,0.38]},
  {"id":"chair-cushion","file":"models/chair-cushion.glb","pack":"kenney-furniture-kit","it":"sedia con cuscino","en":"cushioned chair","tags":["furniture","home"],"size":[0.39,0.9,0.39]},
  {"id":"bench","file":"models/bench.glb","pack":"kenney-furniture-kit","it":"panca","en":"bench","tags":["furniture","home","street"],"size":[0.43,0.5,0.21]},
  {"id":"sofa","file":"models/sofa.glb","pack":"kenney-furniture-kit","it":"divano","en":"sofa","tags":["furniture","home"],"size":[1.81,0.85,0.76]},
  {"id":"armchair","file":"models/armchair.glb","pack":"kenney-furniture-kit","it":"poltrona","en":"armchair","tags":["furniture","home"],"size":[0.91,0.85,0.76]},
  {"id":"bed","file":"models/bed.glb","pack":"kenney-furniture-kit","it":"letto singolo","en":"single bed","tags":["furniture","home","bedroom"],"size":[0.91,0.6,1.8]},
  {"id":"desk","file":"models/desk.glb","pack":"kenney-furniture-kit","it":"scrivania","en":"desk","tags":["furniture","school","work"],"size":[1.43,0.75,0.77]},
  {"id":"bookcase","file":"models/bookcase.glb","pack":"kenney-furniture-kit","it":"libreria","en":"bookcase","tags":["furniture","home","school"],"size":[0.86,1.9,0.54]},
  {"id":"books","file":"models/books.glb","pack":"kenney-furniture-kit","it":"pila di libri","en":"stack of books","tags":["object","school"],"size":[0.36,0.25,0.23]},
  {"id":"fridge","file":"models/fridge.glb","pack":"kenney-furniture-kit","it":"frigorifero","en":"fridge","tags":["kitchen","home","appliance"],"size":[0.84,1.8,0.57]},
  {"id":"stove","file":"models/stove.glb","pack":"kenney-furniture-kit","it":"cucina a gas con forno","en":"stove with oven","tags":["kitchen","home","appliance"],"size":[0.86,0.9,0.9]},
  {"id":"bar-counter","file":"models/bar-counter.glb","pack":"kenney-furniture-kit","it":"bancone (bar, cucina)","en":"counter (bar, kitchen)","tags":["kitchen","café","shop"],"size":[1.13,1.1,0.55]},
  {"id":"coffee-machine","file":"models/coffee-machine.glb","pack":"kenney-furniture-kit","it":"macchina del caffè","en":"coffee machine","tags":["kitchen","café","appliance"],"size":[0.59,0.55,0.74]},
  {"id":"tv","file":"models/tv.glb","pack":"kenney-furniture-kit","it":"televisore moderno","en":"modern TV","tags":["home","appliance"],"size":[1.05,0.7,0.2]},
  {"id":"radio","file":"models/radio.glb","pack":"kenney-furniture-kit","it":"radio","en":"radio","tags":["home","appliance"],"size":[0.41,0.3,0.13]},
  {"id":"computer","file":"models/computer.glb","pack":"kenney-furniture-kit","it":"schermo del computer","en":"computer screen","tags":["work","school","appliance"],"size":[0.6,0.45,0.16]},
  {"id":"laptop","file":"models/laptop.glb","pack":"kenney-furniture-kit","it":"computer portatile","en":"laptop","tags":["work","school"],"size":[0.41,0.25,0.37]},
  {"id":"lamp-floor","file":"models/lamp-floor.glb","pack":"kenney-furniture-kit","it":"lampada da terra","en":"floor lamp","tags":["home","light"],"size":[0.28,1.6,0.33]},
  {"id":"lamp-table","file":"models/lamp-table.glb","pack":"kenney-furniture-kit","it":"lampada da tavolo","en":"table lamp","tags":["home","light"],"size":[0.22,0.45,0.25]},
  {"id":"plant-pot","file":"models/plant-pot.glb","pack":"kenney-furniture-kit","it":"pianta in vaso","en":"potted plant","tags":["home","plant"],"size":[0.32,1,0.37]},
  {"id":"trash-can","file":"models/trash-can.glb","pack":"kenney-furniture-kit","it":"cestino","en":"trash can","tags":["home","street"],"size":[0.24,0.5,0.27]},
  {"id":"box-cardboard","file":"models/box-cardboard.glb","pack":"kenney-furniture-kit","it":"scatola di cartone","en":"cardboard box","tags":["object","home"],"size":[0.34,0.45,0.34]},
  {"id":"toilet","file":"models/toilet.glb","pack":"kenney-furniture-kit","it":"water","en":"toilet","tags":["home","bathroom"],"size":[0.55,0.8,0.85]},
  {"id":"bathtub","file":"models/bathtub.glb","pack":"kenney-furniture-kit","it":"vasca da bagno","en":"bathtub","tags":["home","bathroom"],"size":[1.7,0.6,0.8]},
  {"id":"door","file":"models/door.glb","pack":"kenney-furniture-kit","it":"porta (con cornice)","en":"door with frame","tags":["home","building"],"size":[1.06,2.2,0.25]},
  {"id":"wall","file":"models/wall.glb","pack":"kenney-furniture-kit","it":"pezzo di parete (1 modulo)","en":"wall piece (one module)","tags":["home","building"],"size":[2.17,2.8,0.11]},
  {"id":"wall-window","file":"models/wall-window.glb","pack":"kenney-furniture-kit","it":"parete con finestra","en":"wall with a window","tags":["home","building"],"size":[2.17,2.8,0.19]},
  {"id":"stairs","file":"models/stairs.glb","pack":"kenney-furniture-kit","it":"scala interna","en":"indoor stairs","tags":["home","building"],"size":[3.81,2.8,1.65]},
  {"id":"coffee-cup","file":"models/coffee-cup.glb","pack":"kenney-food-kit","it":"tazzina di caffè","en":"coffee cup","tags":["food","café"],"size":[0.15,0.1,0.2]},
  {"id":"mug","file":"models/mug.glb","pack":"kenney-food-kit","it":"tazza","en":"mug","tags":["food","kitchen"],"size":[0.15,0.12,0.13]},
  {"id":"croissant","file":"models/croissant.glb","pack":"kenney-food-kit","it":"cornetto","en":"croissant","tags":["food","café","bakery"],"size":[0.11,0.06,0.15]},
  {"id":"bread","file":"models/bread.glb","pack":"kenney-food-kit","it":"pagnotta","en":"loaf of bread","tags":["food","bakery"],"size":[0.16,0.12,0.1]},
  {"id":"pizza","file":"models/pizza.glb","pack":"kenney-food-kit","it":"pizza","en":"pizza","tags":["food"],"size":[0.58,0.03,0.58]},
  {"id":"cake","file":"models/cake.glb","pack":"kenney-food-kit","it":"torta di compleanno","en":"birthday cake","tags":["food","party"],"size":[0.35,0.2,0.35]},
  {"id":"apple","file":"models/apple.glb","pack":"kenney-food-kit","it":"mela","en":"apple","tags":["food","fruit"],"size":[0.09,0.09,0.09]},
  {"id":"banana","file":"models/banana.glb","pack":"kenney-food-kit","it":"banana","en":"banana","tags":["food","fruit"],"size":[0.04,0.05,0.16]},
  {"id":"orange","file":"models/orange.glb","pack":"kenney-food-kit","it":"arancia","en":"orange","tags":["food","fruit"],"size":[0.09,0.09,0.09]},
  {"id":"carrot","file":"models/carrot.glb","pack":"kenney-food-kit","it":"carota","en":"carrot","tags":["food","vegetable"],"size":[0.02,0.05,0.02]},
  {"id":"tomato","file":"models/tomato.glb","pack":"kenney-food-kit","it":"pomodoro","en":"tomato","tags":["food","vegetable"],"size":[0.1,0.08,0.1]},
  {"id":"cheese","file":"models/cheese.glb","pack":"kenney-food-kit","it":"forma di formaggio","en":"cheese","tags":["food"],"size":[0.31,0.1,0.31]},
  {"id":"watermelon","file":"models/watermelon.glb","pack":"kenney-food-kit","it":"anguria","en":"watermelon","tags":["food","fruit"],"size":[0.24,0.25,0.24]},
  {"id":"sandwich","file":"models/sandwich.glb","pack":"kenney-food-kit","it":"panino","en":"sandwich","tags":["food"],"size":[0.18,0.07,0.18]},
  {"id":"ice-cream","file":"models/ice-cream.glb","pack":"kenney-food-kit","it":"cono gelato","en":"ice-cream cone","tags":["food","café"],"size":[0.09,0.18,0.11]},
  {"id":"pot","file":"models/pot.glb","pack":"kenney-food-kit","it":"pentola","en":"cooking pot","tags":["kitchen","cooking"],"size":[0.36,0.2,0.46]},
  {"id":"plate","file":"models/plate.glb","pack":"kenney-food-kit","it":"piatto","en":"plate","tags":["kitchen","food"],"size":[0.3,0.03,0.3]},
  {"id":"rolling-pin","file":"models/rolling-pin.glb","pack":"kenney-food-kit","it":"mattarello","en":"rolling pin","tags":["kitchen","cooking","tool"],"size":[0.35,0.06,0.07]},
  {"id":"kitchen-knife","file":"models/kitchen-knife.glb","pack":"kenney-food-kit","it":"coltello da cucina","en":"kitchen knife","tags":["kitchen","cooking","tool"],"size":[0.54,0.03,0.1]},
  {"id":"tree","file":"models/tree.glb","pack":"kenney-nature-kit","it":"albero","en":"tree","tags":["nature","tree"],"size":[2.21,5,1.91]},
  {"id":"tree-oak","file":"models/tree-oak.glb","pack":"kenney-nature-kit","it":"quercia","en":"oak tree","tags":["nature","tree","forest"],"size":[3.13,6,3.62]},
  {"id":"tree-pine","file":"models/tree-pine.glb","pack":"kenney-nature-kit","it":"pino / abete","en":"pine tree","tags":["nature","tree","forest","mountain"],"size":[2.41,7,2.41]},
  {"id":"tree-palm","file":"models/tree-palm.glb","pack":"kenney-nature-kit","it":"palma","en":"palm tree","tags":["nature","tree","beach"],"size":[5.34,7,5.34]},
  {"id":"bush","file":"models/bush.glb","pack":"kenney-nature-kit","it":"cespuglio","en":"bush","tags":["nature","plant"],"size":[1.3,0.8,1.3]},
  {"id":"flower-red","file":"models/flower-red.glb","pack":"kenney-nature-kit","it":"fiori rossi","en":"red flowers","tags":["nature","plant","garden"],"size":[0.22,0.4,0.25]},
  {"id":"flower-yellow","file":"models/flower-yellow.glb","pack":"kenney-nature-kit","it":"fiori gialli","en":"yellow flowers","tags":["nature","plant","garden"],"size":[0.33,0.4,0.38]},
  {"id":"rock-large","file":"models/rock-large.glb","pack":"kenney-nature-kit","it":"roccia grande","en":"large rock","tags":["nature","rock"],"size":[3.63,1.2,4.69]},
  {"id":"rock-small","file":"models/rock-small.glb","pack":"kenney-nature-kit","it":"sasso","en":"small rock","tags":["nature","rock"],"size":[0.75,0.4,0.75]},
  {"id":"stump","file":"models/stump.glb","pack":"kenney-nature-kit","it":"ceppo","en":"tree stump","tags":["nature","forest"],"size":[0.78,0.5,0.9]},
  {"id":"log","file":"models/log.glb","pack":"kenney-nature-kit","it":"tronco a terra","en":"log","tags":["nature","forest"],"size":[0.54,0.4,1.64]},
  {"id":"log-stack","file":"models/log-stack.glb","pack":"kenney-nature-kit","it":"catasta di legna","en":"stack of logs","tags":["nature","forest","farm"],"size":[1.23,1,2.05]},
  {"id":"mushroom","file":"models/mushroom.glb","pack":"kenney-nature-kit","it":"fungo rosso","en":"red mushroom","tags":["nature","forest"],"size":[0.26,0.3,0.3]},
  {"id":"cactus","file":"models/cactus.glb","pack":"kenney-nature-kit","it":"cactus","en":"cactus","tags":["nature","desert"],"size":[1.32,2.5,1.13]},
  {"id":"tent","file":"models/tent.glb","pack":"kenney-nature-kit","it":"tenda da campeggio","en":"camping tent","tags":["nature","camping"],"size":[2.81,1.8,2.04]},
  {"id":"campfire","file":"models/campfire.glb","pack":"kenney-nature-kit","it":"falò (spento: aggiungi l'effetto fuoco)","en":"campfire (unlit: add a fire effect)","tags":["nature","camping"],"size":[1.86,0.4,1.86]},
  {"id":"fence-wood","file":"models/fence-wood.glb","pack":"kenney-nature-kit","it":"staccionata di legno","en":"wooden fence","tags":["nature","farm"],"size":[2.9,1,0.2]},
  {"id":"fence-gate","file":"models/fence-gate.glb","pack":"kenney-nature-kit","it":"cancello di legno","en":"wooden gate","tags":["nature","farm"],"size":[3.19,1.1,0.22]},
  {"id":"pumpkin","file":"models/pumpkin.glb","pack":"kenney-nature-kit","it":"zucca","en":"pumpkin","tags":["nature","farm","food"],"size":[0.53,0.4,0.54]},
  {"id":"canoe","file":"models/canoe.glb","pack":"kenney-nature-kit","it":"canoa","en":"canoe","tags":["vehicle","water"],"size":[0.82,0.5,3.15]},
  {"id":"column","file":"models/column.glb","pack":"kenney-nature-kit","it":"colonna antica","en":"ancient column","tags":["history","monument"],"size":[0.9,3,0.9]},
  {"id":"car","file":"models/car.glb","pack":"kenney-car-kit","it":"automobile","en":"car","tags":["vehicle","street"],"size":[1.73,1.5,2.94]},
  {"id":"car-suv","file":"models/car-suv.glb","pack":"kenney-car-kit","it":"fuoristrada","en":"SUV","tags":["vehicle","street"],"size":[1.96,1.7,3.53]},
  {"id":"taxi","file":"models/taxi.glb","pack":"kenney-car-kit","it":"taxi","en":"taxi","tags":["vehicle","street","work"],"size":[1.6,1.6,2.93]},
  {"id":"police-car","file":"models/police-car.glb","pack":"kenney-car-kit","it":"auto della polizia","en":"police car","tags":["vehicle","street","work"],"size":[1.73,1.5,3.58]},
  {"id":"ambulance","file":"models/ambulance.glb","pack":"kenney-car-kit","it":"ambulanza","en":"ambulance","tags":["vehicle","street","health"],"size":[2.17,2.6,4.69]},
  {"id":"fire-truck","file":"models/fire-truck.glb","pack":"kenney-car-kit","it":"camion dei pompieri","en":"fire truck","tags":["vehicle","street","work"],"size":[2.47,2.8,5.6]},
  {"id":"garbage-truck","file":"models/garbage-truck.glb","pack":"kenney-car-kit","it":"camion della spazzatura","en":"garbage truck","tags":["vehicle","street","work"],"size":[2.9,2.9,6.25]},
  {"id":"delivery-van","file":"models/delivery-van.glb","pack":"kenney-car-kit","it":"furgone delle consegne","en":"delivery van","tags":["vehicle","street","work"],"size":[2.36,2.6,5.12]},
  {"id":"tractor","file":"models/tractor.glb","pack":"kenney-car-kit","it":"trattore","en":"tractor","tags":["vehicle","farm"],"size":[2.01,2.4,3.3]},
  {"id":"hammer","file":"models/hammer.glb","pack":"kenney-survival-kit","it":"martello","en":"hammer","tags":["tool","work"],"size":[0.19,0.32,0.08]},
  {"id":"axe","file":"models/axe.glb","pack":"kenney-survival-kit","it":"ascia","en":"axe","tags":["tool","work","forest"],"size":[0.27,0.6,0.07]},
  {"id":"shovel","file":"models/shovel.glb","pack":"kenney-survival-kit","it":"pala","en":"shovel","tags":["tool","work","farm"],"size":[0.27,1.1,0.12]},
  {"id":"pickaxe","file":"models/pickaxe.glb","pack":"kenney-survival-kit","it":"piccone","en":"pickaxe","tags":["tool","work"],"size":[0.52,0.7,0.11]},
  {"id":"workbench","file":"models/workbench.glb","pack":"kenney-survival-kit","it":"banco da lavoro","en":"workbench","tags":["tool","work","furniture"],"size":[1.02,0.9,0.93]},
  {"id":"barrel","file":"models/barrel.glb","pack":"kenney-survival-kit","it":"botte","en":"barrel","tags":["object","farm"],"size":[0.69,1,0.69]},
  {"id":"crate","file":"models/crate.glb","pack":"kenney-survival-kit","it":"cassa di legno","en":"wooden crate","tags":["object","work"],"size":[0.6,0.6,0.6]},
  {"id":"bucket","file":"models/bucket.glb","pack":"kenney-survival-kit","it":"secchio","en":"bucket","tags":["object","farm"],"size":[0.26,0.35,0.26]},
  {"id":"chest","file":"models/chest.glb","pack":"kenney-survival-kit","it":"baule","en":"chest","tags":["object","treasure"],"size":[0.61,0.6,0.63],"anims":["open","close","open-close"]},
  {"id":"signpost","file":"models/signpost.glb","pack":"kenney-survival-kit","it":"cartello indicatore di legno","en":"wooden signpost","tags":["sign","street","nature"],"size":[0.93,2,0.19]},
  {"id":"ladder","pack":"procedural","it":"scala a pioli rossa (in alto: part top)","en":"red step ladder (part: top)","tags":["tool","work"],"size":[0.6,3,1]},
  // </catalog:generated>
];

const CATALOG_BY_ID = new Map(DIORAMA_CATALOG.map((m) => [m.id, m]));
export const dioramaModel = (id: string): DioramaModel | undefined => CATALOG_BY_ID.get(id);

/** Compact catalog listing for an LLM prompt: one line per model. */
export function dioramaCatalogPrompt(lang: "it" | "en" = "it"): string {
  return DIORAMA_CATALOG.map((m) => {
    const anims = m.anims?.length ? ` | anims: ${m.anims.join(",")}` : "";
    return `${m.id} | ${m[lang]} | ${m.size.join("x")} m | ${m.tags.join(",")}${anims}`;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// Semantic checks

const ITEM_ACTIONS = new Set(["show", "hide", "place", "move", "turn", "scale", "anim", "shake", "fall", "explode", "power", "blink", "attach", "text", "time"]);

/** Parts an item has (without the per-letter parts of text items). */
export function dioramaPartNames(item: DioramaItem): string[] {
  const m = typeof item.model === "string" ? dioramaModel(item.model) : undefined;
  return [...Object.keys(COMMON_PARTS), ...(m?.tags.includes("person") ? Object.keys(PERSON_PARTS) : [])];
}

export function checkDioramaData(data: DioramaData, scene: Pick<z.infer<typeof SceneBase>, "chapters">): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const items = new Map<string, DioramaItem>();
  data.items.forEach((it, i) => {
    if (items.has(it.id)) add(`engineData.items[${i}]`, `duplicate item id "${it.id}"`);
    items.set(it.id, it);
    if (typeof it.model === "string") {
      const m = dioramaModel(it.model);
      if (!m) add(`engineData.items[${i}]`, `unknown catalog model "${it.model}"`);
      else if (it.anim && !m.anims?.includes(it.anim)) add(`engineData.items[${i}]`, `model "${it.model}" has no clip "${it.anim}"`);
    }
  });
  const checkPoint = (path: string, p: string | number[]) => {
    if (typeof p !== "string") return;
    const [id, part] = p.split(".") as [string, string | undefined];
    const it = items.get(id);
    if (!it) return add(path, `unknown item "${id}"`);
    if (part !== undefined && !partOk(it, part)) add(path, `item "${id}" has no part "${part}"`);
  };
  data.items.forEach((it, i) => {
    if (typeof it.model !== "string" && it.model.shape === "wire") {
      checkPoint(`engineData.items[${i}].model.from`, it.model.from);
      checkPoint(`engineData.items[${i}].model.to`, it.model.to);
    }
  });

  const chapterIds = new Set(scene.chapters.map((c) => c.id));
  const seen = new Set<string>();
  data.chapters.forEach((c, ci) => {
    const cp = `engineData.chapters[${ci}]`;
    if (!chapterIds.has(c.chapter)) add(cp, `unknown chapter "${c.chapter}"`);
    if (seen.has(c.chapter)) add(cp, `duplicate chapter "${c.chapter}"`);
    seen.add(c.chapter);
    c.actions.forEach((a, ai) => {
      const ap = `${cp}.actions[${ai}]`;
      if ("from" in a && "to" in a && a.to !== undefined && a.to < a.from) add(ap, "ends before it starts");
      if ("at" in a && typeof a.at !== "number") checkPoint(`${ap}.at`, a.at);
      if (a.do === "trail" && !items.has(a.target)) add(ap, `unknown item "${a.target}"`);
      if (!ITEM_ACTIONS.has(a.do) || !("target" in a)) return;
      const targets = typeof a.target === "string" ? [a.target] : a.target;
      for (const id of targets) {
        const it = items.get(id);
        if (!it) {
          add(ap, `unknown item "${id}"`);
          continue;
        }
        const clip = a.do === "anim" ? a.clip : a.do === "move" ? a.anim : undefined;
        if (clip) {
          const m = typeof it.model === "string" ? dioramaModel(it.model) : undefined;
          if (!m?.anims?.includes(clip)) add(ap, `item "${id}" has no clip "${clip}"`);
        }
        if (a.do === "text" && (typeof it.model === "string" || it.model.shape !== "text")) add(ap, `item "${id}" is not a text item`);
        if (a.do === "time" && (typeof it.model === "string" || it.model.shape !== "clock")) add(ap, `item "${id}" is not a clock`);
        if (a.do === "attach") {
          if (a.parent === id) add(ap, "an item cannot be attached to itself");
          const parent = items.get(a.parent);
          if (!parent) add(ap, `unknown parent "${a.parent}"`);
          else if (a.part && !partOk(parent, a.part)) add(ap, `item "${a.parent}" has no part "${a.part}"`);
        }
      }
    });
  });

  scene.chapters.forEach((ch, c) => {
    const anchors: [string, unknown][] = [
      ...ch.pins.map((p, i): [string, unknown] => [`chapters[${c}].pins[${i}].anchor`, p.anchor]),
      ...ch.camera.map((k, i): [string, unknown] => [`chapters[${c}].camera[${i}].target`, k.target]),
    ];
    for (const [path, anchor] of anchors) {
      if (!anchor || typeof anchor !== "object" || !("entity" in anchor)) continue;
      const a = anchor as { entity: string; part?: string };
      if (a.entity !== "item") add(path, `diorama anchors use entity "item", not "${a.entity}"`);
      else if (!a.part) add(path, 'item anchor needs part "<itemId>" or "<itemId>.<part>"');
      else checkPoint(path, a.part);
    }
  });
  return issues;
}

function partOk(item: DioramaItem, part: string): boolean {
  if (dioramaPartNames(item).includes(part)) return true;
  if (typeof item.model !== "string" && item.model.shape === "text") {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n < 40;
  }
  return false;
}
