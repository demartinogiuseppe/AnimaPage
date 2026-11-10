// ProcessData: owned by the `process` engine (science: how things work, decision D9).
//
// A "textbook illustration in 3D": schematic parts built procedurally (spheres with a
// cut-away, lenses, tubes, membranes, spirals, layered blocks...), plus things that move
// through them: flows (particles along a path), rays (light), waves (sound/water) and
// vibrations. Everything is declarative so an LLM can fill it; nothing is topic-specific.
//
// Units and conventions
// - Lengths are free "scene units"; keep each chapter's drawing inside a ~20-unit box
//   centred on the origin (all chapters share the origin: hide what a chapter doesn't use).
// - y is up. The main view is from +z (camera azimuth 0): lay diagrams out in the x-y plane,
//   like a page standing up; cut-aways face +z.
// - Angles in degrees. Times are chapter seconds. Speeds in units/second, frequencies in Hz.
// - Axial shapes (lens, disc, cylinder, funnel, spiral, torus) are built around local +y;
//   turn them with `rot` (Euler XYZ, degrees). E.g. rot [0,0,90] points +y towards -x;
//   rot [0,0,-90] points it towards +x; rot [90,0,0] points it towards +z (facing the camera).
// - Part coordinates (`pos`, tube `path`, bone/arrow `from`/`to`) are local to the parent part,
//   or to the scene when there is no parent. Flow/ray/wave paths are in scene coordinates.
//
// Time model: an element (part, flow, ray, wave) is on stage in a chapter only if the chapter
// lists it in `items` (children of a listed part come along with it). `at` omitted = already
// there at t=0; otherwise it is revealed at `at` (fade + small pop, or flying in from `from`).
// Flows run, rays draw themselves and waves travel while their element is on stage.
//
// Entity anchors resolved by the engine (pins and camera targets), all accept `offset`:
// - { entity: "part", part: "<partId>" }   the part's label point (`label`, default its origin),
//                                          following its current motion. Layer ids work too
//                                          (centre of the layer's front face).
// - { entity: "flow", part: "<flowId>" }   the first particle (follows the stream/signal);
//   { entity: "flow", part, index: 40 }    the point at 40% along the flow's path
// - { entity: "ray",  part: "<rayId>", index? }   end of the ray, or index% along it
// - { entity: "wave", part: "<waveId>", index? }  source point, or index% along a fronts path
import { z } from "zod";
import { Id, TimeRange, Vec3, type SceneBase } from "../common.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Len = z.number().positive();
const Path = z.array(Vec3).min(2);

/** Fields every part has. */
const partFields = {
  id: Id,
  /** Part this one is attached to (moves, fades and glows with it). Must be listed earlier. */
  parent: Id.optional(),
  pos: Vec3.optional(),
  /** Euler XYZ rotation in degrees. */
  rot: Vec3.optional(),
  /** Uniform or per-axis scale (per-axis turns a sphere into an ellipsoid). */
  scale: z.union([Len, Vec3]).optional(),
  /** Omitted = a soft neutral colour. */
  color: Color.optional(),
  /** Colour of the inside (back faces): e.g. the inside of a cut-away eyeball. */
  innerColor: Color.optional(),
  /** 0..1; < 1 makes the part see-through (a duct with a flow inside). */
  opacity: z.number().min(0.05).max(1).optional(),
  /** Point (part-local) where pins and camera anchors attach. Default: the part's origin. */
  label: Vec3.optional(),
  /**
   * Oscillation used inside a chapter item's `vibrate` windows. With `axis` (parent space):
   * back-and-forth movement of `amplitude` units. Without: the part pulses in size by ±amplitude (0..1).
   */
  vibrate: z.object({ axis: Vec3.optional(), amplitude: Len, freq: Len }).strict().optional(),
};

const part = <T extends z.ZodRawShape>(shape: T) => z.object({ ...partFields, ...shape }).strict();

export const ProcessPart = z.discriminatedUnion("shape", [
  /** Sphere/ellipsoid. `cap`: keep only the cap within this polar angle of +y (180 = whole).
   * `cut`: remove a wedge of this many degrees facing +z (180 = half, a section). `wall`: thickness
   * shown on the cut faces. */
  part({
    shape: z.literal("sphere"),
    radius: Len,
    cap: z.number().gt(0).max(180).optional(),
    cut: z.number().gt(0).lt(360).optional(),
    wall: Len.optional(),
  }),
  /** Biconvex lens around +y. */
  part({ shape: z.literal("lens"), radius: Len, thickness: Len }),
  /** Flat disc / membrane around +y; `inner` makes a ring with a hole (iris + pupil). */
  part({ shape: z.literal("disc"), radius: Len, inner: Len.optional(), thickness: Len.optional() }),
  /** Cylinder centred on the origin along +y; radiusTop 0 = cone; `open` = no caps (a pipe). */
  part({
    shape: z.literal("cylinder"),
    radius: Len,
    radiusTop: z.number().min(0).optional(),
    height: Len,
    open: z.boolean().optional(),
  }),
  /** Flared funnel/trumpet: wide mouth (radiusOut) at y=0, narrow end (radiusIn) at y=length. */
  part({ shape: z.literal("funnel"), radiusIn: Len, radiusOut: Len, length: Len }),
  part({ shape: z.literal("box"), size: Vec3 }),
  /** Tube along a smooth curve through `path` (vessel, nerve, duct, canal). */
  part({ shape: z.literal("tube"), path: Path, radius: Len, closed: z.boolean().optional() }),
  /** Conical spiral tube around +y (cochlea, shell): starts at `radius` at y=0 and winds inwards up to `height`. */
  part({ shape: z.literal("spiral"), radius: Len, turns: Len, tube: Len, height: z.number().min(0).optional() }),
  /** Ring lying in the x-z plane around +y; `arc` < 360 leaves it open (semicircular canal). */
  part({ shape: z.literal("torus"), radius: Len, tube: Len, arc: z.number().gt(0).max(360).optional() }),
  /** Small bone / rod from `from` to `to`, with rounded knobs. */
  part({ shape: z.literal("bone"), from: Vec3, to: Vec3, radius: Len }),
  /** 3D arrow from `from` to `to`. */
  part({ shape: z.literal("arrow"), from: Vec3, to: Vec3, radius: Len.optional() }),
  /** Organic lump (organ, brain, cell): sphere with seeded bumps (0..1); use `scale` to stretch it. */
  part({ shape: z.literal("blob"), radius: Len, bumps: z.number().min(0).max(1).optional(), seed: z.number().int().optional() }),
  /** Seeded scatter of `count` small balls inside a box of `size` (granules, cells, receptors). */
  part({
    shape: z.literal("dots"),
    size: Vec3,
    count: z.number().int().min(1).max(500),
    radius: Len,
    seed: z.number().int().optional(),
  }),
  /**
   * Block cut out of layered tissue/rock (skin, soil, atmosphere). Layers top to bottom; the block's
   * top face is at y = total height / 2. Layers with an `id` can be targeted like parts.
   */
  part({
    shape: z.literal("layers"),
    width: Len,
    depth: Len,
    layers: z.array(z.object({ id: Id.optional(), thickness: Len, color: Color }).strict()).min(1),
  }),
]);
export type ProcessPart = z.infer<typeof ProcessPart>;

/** Particles moving along a path (blood, water, food, nerve signal). Give `path` or `along` (a tube/spiral/torus part). */
export const ProcessFlow = z
  .object({
    id: Id,
    path: Path.optional(),
    along: Id.optional(),
    /** Run the `along` part's curve backwards. */
    reverse: z.boolean().optional(),
    color: Color,
    count: z.number().int().min(1).max(200),
    speed: Len,
    /** Particle radius (default 0.08). */
    size: Len.optional(),
    /** Random sideways offset of each particle (default 0). */
    spread: z.number().min(0).optional(),
    /** true = a one-off signal that travels the path once; false (default) = a continuous stream. */
    once: z.boolean().optional(),
    seed: z.number().int().optional(),
  })
  .strict();
export type ProcessFlow = z.infer<typeof ProcessFlow>;

/** Light ray drawn as straight segments through `path` (bend it where it crosses a lens). */
export const ProcessRay = z
  .object({
    id: Id,
    path: Path,
    color: Color,
    /** Line radius (default 0.035). */
    width: Len.optional(),
    /** Drawing speed (default 6). */
    speed: Len.optional(),
    /** Bright dots travelling along the ray once drawn (default 2). */
    photons: z.number().int().min(0).max(10).optional(),
  })
  .strict();
export type ProcessRay = z.infer<typeof ProcessRay>;

export const ProcessWave = z.discriminatedUnion("kind", [
  /** Curved wave fronts travelling along a path (sound in the ear canal). Give `path` or `along`. */
  z
    .object({
      kind: z.literal("fronts"),
      id: Id,
      path: Path.optional(),
      along: Id.optional(),
      reverse: z.boolean().optional(),
      color: Color,
      /** Half-width of a front at the start; `endSize` at the end of the path (default = size). */
      size: Len,
      endSize: Len.optional(),
      /** Distance between fronts (wavelength, as drawn). */
      spacing: Len,
      speed: Len,
    })
    .strict(),
  /** Rings expanding from `pos` in the plane with normal `normal` (default [0,0,1], facing the camera). */
  z
    .object({
      kind: z.literal("rings"),
      id: Id,
      pos: Vec3,
      normal: Vec3.optional(),
      color: Color,
      /** Radius at which rings fade out. */
      radius: Len,
      spacing: Len,
      speed: Len,
    })
    .strict(),
]);
export type ProcessWave = z.infer<typeof ProcessWave>;

/** An element on stage in a chapter. */
export const ProcessItem = z
  .object({
    id: Id,
    /** Reveal time; omitted = already there at t=0. */
    at: z.number().min(0).optional(),
    /** Gone by this time (fades out just before). */
    until: z.number().min(0).optional(),
    /** Seconds the reveal takes (default 0.8). */
    reveal: Len.optional(),
    /** Parts only: fly in from this offset (parent space) during the reveal. */
    from: Vec3.optional(),
    /** Windows of emphasis: the element glows and pulses. */
    glow: z.array(TimeRange).optional(),
    /** Parts with `vibrate` only: windows in which the part vibrates. */
    vibrate: z.array(TimeRange).optional(),
  })
  .strict();
export type ProcessItem = z.infer<typeof ProcessItem>;

export const ProcessChapter = z.object({ chapter: Id, items: z.array(ProcessItem) }).strict();
export type ProcessChapter = z.infer<typeof ProcessChapter>;

const CURVE_SHAPES = new Set(["tube", "spiral", "torus"]);

export const ProcessData = z
  .object({
    /** Background colour (default: warm paper). */
    background: Color.optional(),
    parts: z.array(ProcessPart),
    flows: z.array(ProcessFlow),
    rays: z.array(ProcessRay),
    waves: z.array(ProcessWave),
    chapters: z.array(ProcessChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const ids = new Map<string, string>(); // id -> kind
    const claim = (id: string, kind: string, path: (string | number)[]) => {
      if (ids.has(id)) add(path, `duplicate element id "${id}"`);
      else ids.set(id, kind);
    };
    const partById = new Map<string, ProcessPart>();
    d.parts.forEach((p, i) => {
      if (p.parent !== undefined && !partById.has(p.parent)) add(["parts", i, "parent"], `parent "${p.parent}" must be a part listed earlier`);
      claim(p.id, "part", ["parts", i, "id"]);
      partById.set(p.id, p);
      if (p.shape === "layers") p.layers.forEach((l, k) => l.id !== undefined && claim(l.id, "layer", ["parts", i, "layers", k, "id"]));
      if (p.shape === "disc" && p.inner !== undefined && p.inner >= p.radius) add(["parts", i, "inner"], "inner radius must be smaller than radius");
    });
    const checkCurve = (e: { path?: unknown; along?: string }, path: (string | number)[]) => {
      if ((e.path === undefined) === (e.along === undefined)) add(path, "give exactly one of `path` or `along`");
      if (e.along !== undefined) {
        const p = partById.get(e.along);
        if (!p || !CURVE_SHAPES.has(p.shape)) add([...path, "along"], `"${e.along}" is not a tube, spiral or torus part`);
      }
    };
    d.flows.forEach((f, i) => {
      claim(f.id, "flow", ["flows", i, "id"]);
      checkCurve(f, ["flows", i]);
    });
    d.rays.forEach((r, i) => claim(r.id, "ray", ["rays", i, "id"]));
    d.waves.forEach((w, i) => {
      claim(w.id, "wave", ["waves", i, "id"]);
      if (w.kind === "fronts") checkCurve(w, ["waves", i]);
    });
    const chapters = new Set<string>();
    d.chapters.forEach((c, i) => {
      if (chapters.has(c.chapter)) add(["chapters", i, "chapter"], `duplicate chapter "${c.chapter}"`);
      chapters.add(c.chapter);
      const seen = new Set<string>();
      c.items.forEach((it, k) => {
        const path = ["chapters", i, "items", k];
        const kind = ids.get(it.id);
        if (!kind) add(path, `unknown element "${it.id}"`);
        if (seen.has(it.id)) add(path, `element "${it.id}" listed twice`);
        seen.add(it.id);
        if (it.until !== undefined && it.until <= (it.at ?? 0)) add(path, "`until` must come after `at`");
        for (const key of ["glow", "vibrate"] as const)
          it[key]?.forEach(([a, b], w) => a > b && add([...path, key, w], "window ends before it starts"));
        if (it.from && kind !== "part") add(path, "`from` only applies to parts");
        if (it.vibrate && !(kind === "part" && partById.get(it.id)?.vibrate))
          add(path, `"${it.id}" has no \`vibrate\` settings`);
      });
    });
  });
export type ProcessData = z.infer<typeof ProcessData>;

/**
 * Cross-checks against the rest of the scene that the schema alone cannot do (chapter ids,
 * times inside the chapter). Same Issue shape as checkSemantics.
 */
export function checkProcessData(
  data: ProcessData,
  scene: Pick<z.infer<typeof SceneBase>, "chapters">,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (duration === undefined) return void issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    c.items.forEach((it, k) => {
      const times = [it.at ?? 0, ...(it.glow ?? []).flat(), ...(it.vibrate ?? []).flat()];
      if (times.some((x) => x > duration)) issues.push({ path: `${path}.items[${k}]`, message: `"${it.id}" has a time after the chapter ends` });
    });
  });
  return issues;
}
