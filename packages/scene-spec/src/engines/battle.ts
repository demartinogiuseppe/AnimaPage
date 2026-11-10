// BattleData: declarative description of a battle, siege or landing for the `battle` engine.
//
// Coordinates: engine units, y up, positions on the ground are Vec2 = [x, z].
// Angles are degrees. Facing/yaw 0 looks towards +z, 90 towards +x (yaw = atan2(dx, dz)).
// Polar angles (arcs, orbits, city gates) are measured from +x towards +z:
// point = center + r * (cos a, sin a).
//
// Everything that moves is a *group* of `count` members (soldiers, ships, chariots,
// one hero, one prop). For each chapter a group has a *phase*: a start target and a
// list of eased moves to other targets. The engine evaluates the chain at time t,
// so the state is a pure function of (chapter, t). Randomness is a seeded hash.
import { z } from "zod";
import { Id, TimeRange, Vec3 } from "../common.ts";

const Vec2 = z.tuple([z.number(), z.number()]);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Ease = z.enum(["linear", "inOutQuad", "inOutCubic"]);

/** Keyframes: value of key k is reached at key k's `at`, blending from key k-1 with `ease` (default inOutQuad). Holds outside. */
const Keys = z.array(z.object({ at: z.number(), value: z.number(), ease: Ease.optional() }).strict()).min(1);

/** Per-chapter keyframe track. */
const ChapterKeys = z.object({ chapter: Id, keys: Keys }).strict();

// ---------------------------------------------------------------------------
// World

const Rect = z.object({ center: Vec2, size: Vec2 }).strict();

const World = z
  .object({
    /** Area of interest: camera limits and AR scale. */
    extent: z.object({ x: Vec2, z: Vec2 }).strict(),
    /** Flat coloured areas drawn from bottom to top. `water` areas shine and darken at night; ships bob on them. */
    areas: z.array(
      Rect.extend({ id: Id, water: z.boolean().optional(), color: Color, nightColor: Color.optional() }).strict(),
    ),
    /** Truncated-cone hills: they raise the terrain (soldiers walk up the slope). Cities sit on top. */
    hills: z
      .array(z.object({ id: Id, center: Vec2, topRadius: z.number().positive(), footRadius: z.number().positive(), height: z.number().positive(), color: Color }).strict())
      .optional(),
    /** Background cones (do not raise the walkable terrain). */
    mountains: z.array(z.object({ id: Id, center: Vec2, radius: z.number().positive(), height: z.number().positive(), color: Color }).strict()).optional(),
    /** Low domes in the water. */
    islands: z.array(z.object({ id: Id, center: Vec2, radius: z.number().positive(), height: z.number().positive(), color: Color }).strict()).optional(),
    /** Smooth ribbons through the points. */
    rivers: z.array(z.object({ id: Id, points: z.array(Vec2).min(2), halfWidth: z.number().positive(), color: Color }).strict()).optional(),
    sky: z.object({ day: Color, night: Color, fog: Vec2.optional() }).strict(),
  })
  .strict();

const Side = z
  .object({
    id: Id,
    name: z.string().min(1),
    /** Tunic / banner colour, also the pin marker colour. */
    color: Color,
    helmetColor: Color,
    shieldColor: Color,
  })
  .strict();

const City = z
  .object({
    id: Id,
    center: Vec2,
    wall: z.object({ radius: z.number().positive(), height: z.number().positive(), thickness: z.number().positive(), segments: z.number().int().min(6), color: Color }).strict(),
    /** A tower every `every` wall segments, and always on both sides of the gate. */
    towers: z.object({ every: z.number().int().min(1), size: Vec2, color: Color }).strict().optional(),
    gate: z
      .object({
        /** Polar angle of the gate on the wall ring. */
        angle: z.number(),
        color: Color,
        /** 0 closed .. 1 open, per chapter. Closed where omitted. */
        open: z.array(ChapterKeys).optional(),
      })
      .strict(),
    houses: z.object({ count: z.number().int().min(0), innerRadius: z.number().min(0), outerRadius: z.number().positive(), seed: z.number().int(), colors: z.array(Color).min(1) }).strict().optional(),
    palace: z.object({ offset: Vec2, size: Vec3, color: Color, roofColor: Color }).strict().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Formations and targets

/**
 * Slots for the members of a group, placed at a target's `at`.
 * grid: rows of `perRow` members, row 0 in front, columns centred on `at`, rows extending behind.
 *   `spacing` = [between columns, between rows]; odd rows shift by `rowShift`; `jitter` = seeded random offset [x, z].
 * arc:  members spread evenly on a circle from polar angle `from` to `to`, facing outwards.
 *   With `city`, the circle is the wall walk of that city (centre, radius and height), skipping the gate.
 */
const Formation = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("grid"),
      perRow: z.number().int().min(1),
      spacing: Vec2,
      facing: z.number(),
      rowShift: z.number().optional(),
      jitter: Vec2.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("arc"),
      city: Id.optional(),
      center: Vec2.optional(),
      radius: z.number().positive().optional(),
      from: z.number(),
      to: z.number(),
    })
    .strict(),
]);

/**
 * Where a member is. Names of places: the `places` map plus "<cityId>.gate" (the gate opening on the wall ring)
 * and "<cityId>.center" for every city.
 * - formation: slot of the member in `formation`, placed at `at` (place name or Vec2; arcs ignore `at`).
 * - point / place: every member on the same spot.
 * - vehicle: riding a member of a vehicle group (member i on vehicle i % count).
 * - follow: next to a moving prop/figure/vehicle member, at `formation` slots relative to it (`at` = offset).
 * - orbit: around `center`, from polar angle `startAngle` (+`lead`), `turns` full turns between `from` and `to`.
 * - path: constant-speed polyline between `from` and `to`, eased overall.
 */
const Target = z.union([
  z.object({ formation: Id, at: z.union([Vec2, Id]).optional() }).strict(),
  z.object({ point: z.union([Vec2, Vec3]) }).strict(),
  z.object({ place: Id }).strict(),
  z.object({ vehicle: Id }).strict(),
  z.object({ follow: Id, index: z.number().int().min(0).optional(), formation: Id.optional(), at: Vec2.optional() }).strict(),
  z
    .object({
      orbit: z.object({ center: z.union([Vec2, Id]), radius: z.number().positive(), startAngle: z.number(), lead: z.number().optional(), turns: z.number(), from: z.number(), to: z.number() }).strict(),
    })
    .strict(),
  z.object({ path: z.object({ points: z.array(Vec2).min(2), from: z.number(), to: z.number(), ease: Ease.optional() }).strict() }).strict(),
]);

/** Per-member delay of a move or event: k / n * spread, with k = member % mod (n = mod) or k = member (n = count), or a seeded random fraction. */
const Stagger = z.object({ spread: z.number().min(0), mod: z.number().int().min(1).optional(), random: z.boolean().optional() }).strict();

const Move = z
  .object({
    from: z.number(),
    to: z.number(),
    target: Target,
    stagger: Stagger.optional(),
    ease: Ease.optional(),
    /** Yaw to keep after arriving (default: the target's facing, or the travel direction). */
    face: z.number().optional(),
    /** Members are hidden until this move starts. */
    appear: z.boolean().optional(),
    /** Members are hidden once this move ends. */
    vanish: z.boolean().optional(),
  })
  .strict();

/** Member index range [from, to) inside the group. */
const Members = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

const Phase = z
  .object({
    /** Chapters this phase applies to. Omitted = every chapter without its own phase. A group with no phase for a chapter is hidden. */
    chapters: z.array(Id).optional(),
    /** Restrict the phase to some members (the others follow the other phases of the same chapter, or are hidden). */
    members: Members.optional(),
    start: Target,
    /** Yaw at the start when the start target has no facing of its own (points, places). */
    face: z.number().optional(),
    moves: z.array(Move).optional(),
    /** Visible only in these windows (default: whole chapter). */
    visible: z.array(TimeRange).optional(),
    /** Members inside this city's walls are hidden (e.g. troops entering the gate). */
    hideInside: Id.optional(),
    /** Front-line skirmish: members sway along their facing. */
    melee: z.object({ from: z.number(), to: z.number(), members: Members.optional(), amplitude: z.number().positive() }).strict().optional(),
    /** A seeded fraction of `members` fall between `from` and `to` and lie where they fell. */
    casualties: z
      .object({ from: z.number(), to: z.number(), members: Members.optional(), fraction: z.number().min(0).max(1), seed: z.number().int() })
      .strict()
      .optional(),
    /** Props: grows from the ground between from and to (e.g. the horse being built). */
    grow: TimeRange.optional(),
    /** Slow turn on the spot: yaw += amplitude * sin(t * speed). */
    spin: z.object({ amplitude: z.number(), speed: z.number() }).strict().optional(),
  })
  .strict();

const Army = z.object({ id: Id, side: Id, count: z.number().int().min(1).max(2000), phases: z.array(Phase) }).strict();

const Vehicle = z
  .object({
    id: Id,
    type: z.enum(["ship", "chariot"]),
    side: Id.optional(),
    count: z.number().int().min(1).max(200),
    scale: z.number().positive().optional(),
    /** Chariot panel colour (default: side colour) and horse colour. */
    color: Color.optional(),
    horseColor: Color.optional(),
    phases: z.array(Phase),
  })
  .strict();

const Figure = z
  .object({
    id: Id,
    name: z.string().min(1),
    side: Id.optional(),
    /** Detailed low-poly warrior. Local anchor parts: head, helmet, cuirass, shield, spear. */
    model: z.literal("warrior"),
    tunic: Color,
    crest: Color,
    scale: z.number().positive().optional(),
    phases: z.array(Phase),
  })
  .strict();

const Prop = z
  .object({
    id: Id,
    model: z.enum(["woodenHorse", "podium", "hut"]),
    count: z.number().int().min(1).max(200).optional(),
    scale: z.number().positive().optional(),
    color: Color.optional(),
    phases: z.array(Phase),
  })
  .strict();

const Effect = z.discriminatedUnion("type", [
  /** Arcing arrows shot from the visible members of `army` to a target area. */
  z
    .object({
      type: z.literal("arrows"),
      chapter: Id,
      visible: z.array(TimeRange),
      army: Id,
      count: z.number().int().min(1).max(500),
      target: Rect,
      period: Vec2,
      arc: z.number().positive(),
      seed: z.number().int(),
    })
    .strict(),
  /** Rising flames over a disc, with a flickering light. `intensity` 0..1 keys. */
  z
    .object({
      type: z.literal("fire"),
      chapter: Id,
      center: z.union([Vec2, Id]),
      radius: z.number().positive(),
      height: z.number().positive(),
      particles: z.number().int().min(1).max(3000),
      intensity: Keys,
      seed: z.number().int(),
    })
    .strict(),
  /** Fades a city (walls, towers, gate, houses; not the hill) out over `ramp`. */
  z.object({ type: z.literal("cityFade"), chapter: Id, city: Id, ramp: TimeRange }).strict(),
  /** Archaeological layers stacked on the hill top, growing one by one from the bottom. */
  z
    .object({
      type: z.literal("strata"),
      id: Id,
      chapter: Id,
      center: z.union([Vec2, Id]),
      radius: z.number().positive(),
      layerHeight: z.number().positive(),
      /** Bottom (oldest) first. */
      layers: z.array(z.object({ id: Id, label: z.string().min(1), color: Color }).strict()).min(1),
      grow: z.object({ from: z.number(), step: z.number().min(0), duration: z.number().positive() }).strict(),
      glow: z.object({ layer: Id, from: z.number() }).strict().optional(),
      /** Polar angle of the edge point used by anchors (default 180 = towards -x). */
      edgeAngle: z.number().optional(),
    })
    .strict(),
]);

export const BattleData = z
  .object({
    world: World,
    sides: z.array(Side).min(1),
    cities: z.array(City).optional(),
    places: z.record(z.string(), Vec2).optional(),
    formations: z.record(z.string(), Formation),
    armies: z.array(Army),
    vehicles: z.array(Vehicle).optional(),
    figures: z.array(Figure).optional(),
    props: z.array(Prop).optional(),
    effects: z.array(Effect).optional(),
    /** 0 day .. 1 night, per chapter. Day where omitted. */
    night: z.array(ChapterKeys).optional(),
  })
  .strict();
export type BattleData = z.infer<typeof BattleData>;
