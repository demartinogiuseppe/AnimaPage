// WorkshopData: owned by the `workshop` engine (Officina, decision D19).
//
// The generic theatre: when a page's subject or experiment is not covered by a specialised engine,
// the model builds the scene from basic parts (box, cylinder, sphere, cone, torus, plane, tube,
// arrow, text tile, line) and a few recurring helpers (liquid with a fill level, particles flowing
// along a path, wheel/gear, spring, catalog model of a person/house/tree/boat), then animates them
// with keyframes or safe formulas. Nothing the model writes is executed: formulas go through the
// safe parser in ../math/expr.ts (no eval).
//
// Units and conventions
// - Free scene units, y up, standing on y = 0. Keep the whole build inside ~12 x 8 x 8 units
//   centred on x = z = 0 (all chapters share it: hide what a chapter does not use).
// - The main view is from +z (camera azimuth 0). Angles in degrees, times in chapter seconds.
// - Axial shapes (cylinder, cone, spring) stand along local +y; torus and wheel lie in the x-y
//   plane facing +z (a wheel turns around its local z axis); plane lies flat in x-z.
// - `pos`/`rot`/`scale` are relative to the parent part (or to the scene). `path` points
//   (tube, line, arrow, particles) are in the part's own frame.
//
// Time model (per chapter): only the parts listed in the chapter's `items` are on stage (children
// come with their parent). `at` omitted = there from t = 0; otherwise the part appears at `at`
// (fade + small pop, or flying in from the offset `from`: assembling a machine). `glow` windows
// highlight a part (colour kept in the ink style). `tracks` animate one property of a part with
// keyframes OR with a formula in `t` (chapter seconds) and the scene's `params` (sliders).
//
// Track properties: pos, rot, scale (Vec3 keys) or x, y, z, rx, ry, rz, sx, sy, sz, size (uniform
// scale factor), opacity (0..1), level (liquid fill 0..1), spin (turns per second around the part's
// spin axis: the angle is the integral over time), speed (particles: units per second, integrated
// too), visible (> 0.5 = shown), color (keys only, "#rrggbb").
//
// Entity anchors (pins, camera targets): { "entity": "<partId>", "offset"?: [x, y, z] } = the
// part's origin following its motion (liquid: the centre of its surface; particles: `index` =
// percent along the path, default the first particle).
import { z } from "zod";
import type { Anchor, SceneBase } from "../common.ts";
import { Id, TimeRange, Vec3 } from "../common.ts";
import { dioramaModel } from "./diorama.ts";
import { ExprError, isReservedName, parseExpr } from "../math/expr.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Len = z.number().positive().max(60);
const Path = z.array(Vec3).min(2).max(64);

export const WORKSHOP_SHAPES = [
  "box", "cylinder", "sphere", "cone", "torus", "plane", "tube", "arrow", "text", "line",
  "liquid", "particles", "wheel", "spring", "model",
] as const;
export const WorkshopShape = z.enum(WORKSHOP_SHAPES);
export type WorkshopShape = z.infer<typeof WorkshopShape>;

/**
 * One part. A flat object (not a union per shape) keeps the JSON schema small; which fields a
 * shape needs is checked in the refinement below:
 * box {size}; cylinder {radius, height, radiusTop?}; sphere {radius}; cone {radius, height};
 * torus {radius, tube}; plane {size [x, _, z]}; tube {path, radius}; arrow {path [from, to], radius?};
 * line {path, dashed?, follow?}; text {text, height} (color = the letters, on a paper plate); liquid {radius + height (round) or size (box), level};
 * particles {path, count, speed, radius?}; wheel {radius, height = thickness, teeth?, spokes?};
 * spring {radius, height, turns}; model {model (diorama catalog id), height}.
 */
export const WorkshopPart = z
  .object({
    id: Id,
    shape: WorkshopShape,
    /** Part this one is attached to (moves, turns, fades with it). Must be listed earlier. */
    parent: Id.optional(),
    pos: Vec3.optional(),
    /** Euler XYZ, degrees. */
    rot: Vec3.optional(),
    scale: z.number().positive().max(20).optional(),
    color: Color.optional(),
    /** 0.05..1; < 1 = see-through. */
    opacity: z.number().min(0.05).max(1).optional(),
    /** Clear glass material (containers, pipes, tanks). */
    glass: z.boolean().optional(),
    /** Always keep its colours in the ink style (the parts the lesson is about). */
    key: z.boolean().optional(),
    size: z.tuple([Len, z.number().min(0).max(60), Len]).optional(),
    radius: Len.optional(),
    radiusTop: z.number().min(0).max(60).optional(),
    height: Len.optional(),
    tube: Len.optional(),
    path: Path.optional(),
    dashed: z.boolean().optional(),
    /** line only: its last point follows this part's anchor (rope to a moving load, chain, belt). */
    follow: Id.optional(),
    text: z.string().min(1).max(40).optional(),
    /** Liquid fill level 0..1 of its height. */
    level: z.number().min(0).max(1).optional(),
    count: z.number().int().min(1).max(200).optional(),
    speed: z.number().min(-30).max(30).optional(),
    teeth: z.number().int().min(0).max(48).optional(),
    spokes: z.number().int().min(0).max(16).optional(),
    turns: z.number().positive().max(30).optional(),
    model: Id.optional(),
    /** Constant spin in turns per second (a `spin` track overrides it). */
    spin: z.number().min(-10).max(10).optional(),
    /** Spin axis in the part's frame; default z for wheel and torus, y otherwise. */
    axis: z.enum(["x", "y", "z"]).optional(),
  })
  .strict();
export type WorkshopPart = z.infer<typeof WorkshopPart>;

/** Slider variable used by formulas (activity.test.params lists its id). */
export const WorkshopParam = z
  .object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,11}$/),
    /** Italian, with the unit: "Portata (L/s)". */
    label: z.string().min(1),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    /** Value used when the user has not moved the slider. */
    value: z.number(),
  })
  .strict();
export type WorkshopParam = z.infer<typeof WorkshopParam>;

export const WORKSHOP_PROPS = [
  "pos", "rot", "scale", "x", "y", "z", "rx", "ry", "rz", "sx", "sy", "sz", "size",
  "opacity", "level", "spin", "speed", "visible", "color",
] as const;
export const WorkshopProp = z.enum(WORKSHOP_PROPS);
export type WorkshopProp = z.infer<typeof WorkshopProp>;
export const VEC_PROPS: ReadonlySet<WorkshopProp> = new Set(["pos", "rot", "scale"]);

export const WorkshopKey = z
  .object({
    at: z.number().min(0),
    /** Number, [x, y, z] (pos, rot, scale) or "#rrggbb" (color). */
    v: z.union([z.number(), Vec3, Color]),
    /** How the value gets here from the previous key (default inOut). */
    ease: z.enum(["linear", "inOut", "step"]).optional(),
  })
  .strict();
export type WorkshopKey = z.infer<typeof WorkshopKey>;

export const WorkshopTrack = z
  .object({
    part: Id,
    prop: WorkshopProp,
    keys: z.array(WorkshopKey).min(1).max(40).optional(),
    /** Formula in t and the params, e.g. "2 + 0.5*sin(t)", "k*t" (safe parser, no eval). */
    expr: z.string().min(1).max(200).optional(),
    /** Time window of the formula; outside it the part keeps its own value. */
    window: TimeRange.optional(),
  })
  .strict();
export type WorkshopTrack = z.infer<typeof WorkshopTrack>;

export const WorkshopItem = z
  .object({
    id: Id,
    at: z.number().min(0).optional(),
    /** Gone by this time (fades out just before). */
    until: z.number().min(0).optional(),
    /** Fly in from this offset (parent space) while appearing. */
    from: Vec3.optional(),
    glow: z.array(TimeRange).optional(),
  })
  .strict();
export type WorkshopItem = z.infer<typeof WorkshopItem>;

export const WorkshopChapter = z
  .object({ chapter: Id, items: z.array(WorkshopItem).max(60), tracks: z.array(WorkshopTrack).max(60) })
  .strict();
export type WorkshopChapter = z.infer<typeof WorkshopChapter>;

/** Fields each shape needs. */
const NEEDS: Record<WorkshopShape, (keyof WorkshopPart)[]> = {
  box: ["size"],
  cylinder: ["radius", "height"],
  sphere: ["radius"],
  cone: ["radius", "height"],
  torus: ["radius", "tube"],
  plane: ["size"],
  tube: ["path", "radius"],
  arrow: ["path"],
  text: ["text", "height"],
  line: ["path"],
  liquid: ["height"],
  particles: ["path", "count", "speed"],
  wheel: ["radius", "height"],
  spring: ["radius", "height", "turns"],
  model: ["model", "height"],
};

/** Which shapes a property applies to (others: every shape). */
const PROP_SHAPES: Partial<Record<WorkshopProp, readonly WorkshopShape[]>> = {
  level: ["liquid"],
  speed: ["particles"],
};

export const MAX_WORKSHOP_PARTS = 60;
export const MAX_WORKSHOP_PARAMS = 6;

/** Variables a formula may use: t plus the declared params, in this order. */
export const workshopVars = (params: readonly { id: string }[] | undefined) => ["t", ...(params ?? []).map((p) => p.id)];

export const WorkshopData = z
  .object({
    /** Background colour (default: warm paper). */
    background: Color.optional(),
    params: z.array(WorkshopParam).max(MAX_WORKSHOP_PARAMS).optional(),
    parts: z.array(WorkshopPart).min(1).max(MAX_WORKSHOP_PARTS),
    chapters: z.array(WorkshopChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const parts = new Map<string, WorkshopPart>();
    d.parts.forEach((p, i) => {
      if (parts.has(p.id)) add(["parts", i, "id"], `duplicate part id "${p.id}"`);
      if (p.parent !== undefined && !parts.has(p.parent)) add(["parts", i, "parent"], `parent "${p.parent}" must be a part listed earlier`);
      parts.set(p.id, p);
      const missing = NEEDS[p.shape].filter((k) => p[k] === undefined);
      if (missing.length) add(["parts", i], `${p.shape} "${p.id}" needs ${missing.join(", ")}`);
      if (p.shape === "liquid" && p.radius === undefined && p.size === undefined) add(["parts", i], `liquid "${p.id}" needs radius (round) or size (box)`);
      if (p.shape === "arrow" && p.path && p.path.length !== 2) add(["parts", i, "path"], "an arrow path is [from, to]");
      if (p.shape === "model" && p.model !== undefined && !dioramaModel(p.model)) add(["parts", i, "model"], `unknown catalog model "${p.model}"`);
    });
    d.parts.forEach((p, i) => {
      if (p.follow === undefined) return;
      if (p.shape !== "line") add(["parts", i, "follow"], "only lines can follow a part");
      else if (!parts.has(p.follow) || p.follow === p.id) add(["parts", i, "follow"], `unknown part "${p.follow}"`);
    });
    const vars = workshopVars(d.params);
    const seen = new Set<string>();
    d.params?.forEach((p, i) => {
      if (seen.has(p.id) || p.id === "t" || isReservedName(p.id)) add(["params", i, "id"], `param id "${p.id}" is duplicate or reserved`);
      seen.add(p.id);
      if (p.min >= p.max) add(["params", i], "min must be below max");
      else if (p.value < p.min || p.value > p.max) add(["params", i, "value"], "value outside [min, max]");
    });
    const chapters = new Set<string>();
    d.chapters.forEach((c, i) => {
      if (chapters.has(c.chapter)) add(["chapters", i, "chapter"], `duplicate chapter "${c.chapter}"`);
      chapters.add(c.chapter);
      const listed = new Set<string>();
      c.items.forEach((it, k) => {
        const path = ["chapters", i, "items", k];
        if (!parts.has(it.id)) add(path, `unknown part "${it.id}"`);
        if (listed.has(it.id)) add(path, `part "${it.id}" listed twice`);
        listed.add(it.id);
        if (it.until !== undefined && it.until <= (it.at ?? 0)) add(path, "`until` must come after `at`");
        it.glow?.forEach(([a, b], w) => a > b && add([...path, "glow", w], "window ends before it starts"));
      });
      c.tracks.forEach((tr, k) => {
        const path = ["chapters", i, "tracks", k];
        const part = parts.get(tr.part);
        if (!part) return add(path, `unknown part "${tr.part}"`);
        const only = PROP_SHAPES[tr.prop];
        if (only && !only.includes(part.shape)) add(path, `"${tr.prop}" applies only to ${only.join(", ")} parts`);
        if ((tr.keys === undefined) === (tr.expr === undefined)) add(path, "give exactly one of `keys` or `expr`");
        if (tr.window && tr.window[0] > tr.window[1]) add([...path, "window"], "window ends before it starts");
        const vec = VEC_PROPS.has(tr.prop);
        if (tr.expr !== undefined) {
          if (vec || tr.prop === "color") add(path, `"${tr.prop}" needs keys; formulas drive one number (x, rx, sx, size, level, spin...)`);
          try {
            parseExpr(tr.expr, { vars });
          } catch (e) {
            if (!(e instanceof ExprError)) throw e;
            add([...path, "expr"], `${e.message} (variables: ${vars.join(", ")})`);
          }
        }
        let prev = -1;
        tr.keys?.forEach((key, n) => {
          const kind = typeof key.v === "string" ? "color" : Array.isArray(key.v) ? "vec" : "num";
          const want = tr.prop === "color" ? "color" : vec ? "vec" : "num";
          if (kind !== want && !(tr.prop === "scale" && kind === "num"))
            add([...path, "keys", n, "v"], `"${tr.prop}" keys take ${want === "vec" ? "[x, y, z]" : want === "color" ? '"#rrggbb"' : "a number"}`);
          if (key.at < prev) add([...path, "keys", n], "keys must be in time order");
          prev = key.at;
        });
      });
    });
  });
export type WorkshopData = z.infer<typeof WorkshopData>;

/**
 * Cross-checks against the rest of the scene: chapter ids, times inside the chapter, slider ids,
 * part anchors in pins and camera keys. Same Issue shape as checkSemantics.
 */
export function checkWorkshopData(
  data: WorkshopData,
  scene: Pick<z.infer<typeof SceneBase>, "chapters">,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  const parts = new Set(data.parts.map((p) => p.id));
  const params = new Set((data.params ?? []).map((p) => p.id));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (duration === undefined) return void issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    c.items.forEach((it, k) => {
      const times = [it.at ?? 0, ...(it.glow ?? []).flat()];
      if (times.some((x) => x > duration)) issues.push({ path: `${path}.items[${k}]`, message: `"${it.id}" has a time after the chapter ends` });
    });
    c.tracks.forEach((tr, k) => {
      const times = [...(tr.keys ?? []).map((x) => x.at), ...(tr.window ?? [])];
      if (times.some((x) => x > duration)) issues.push({ path: `${path}.tracks[${k}]`, message: `track of "${tr.part}" has a time after the chapter ends` });
    });
  });
  const covered = new Set(data.chapters.map((c) => c.chapter));
  const checkAnchor = (a: Anchor, at: string) => {
    if ("entity" in a && !parts.has(a.entity)) issues.push({ path: at, message: `anchor entity "${a.entity}" is not a part id` });
  };
  scene.chapters.forEach((ch, c) => {
    const at = `chapters[${c}]`;
    if (!covered.has(ch.id)) issues.push({ path: at, message: `chapter "${ch.id}" has no workshop entry (empty stage)` });
    ch.activity?.test.params?.forEach((id, k) => {
      if (!params.has(id)) issues.push({ path: `${at}.activity.test.params[${k}]`, message: `"${id}" is not a workshop param` });
    });
    ch.pins.forEach((p, i) => checkAnchor(p.anchor, `${at}.pins[${i}].anchor`));
    ch.camera.forEach((k, i) => checkAnchor(k.target, `${at}.camera[${i}].target`));
  });
  return issues;
}
