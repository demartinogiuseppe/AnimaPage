// ArtData: owned by the `art` engine ("Opera": paintings, frescoes, sculpture, architecture; decision D14).
//
// The artwork stands on the pop-up page in its real proportions (in a frame, on an easel, on a
// wall or on a plinth). Everything that explains it is declarative so an LLM can fill it:
// - regions: details of the image (a figure, a symbol, the signature) for camera tours, pins, quizzes;
// - overlays: perspective lines growing towards the vanishing point, composition shapes, symmetry
//   axes, thirds / golden grids, light and gaze arrows, the colour palette;
// - layers: regions lifted off the canvas as paper cut-outs (2.5D pop-out with parallax);
// - architecture: a procedural kit of classical orders (columns, entablature, pediment, arch, dome).
//
// Copyright (D14): `artwork.image` is set ONLY for public-domain works, with a Source whose `license`
// says so; otherwise the engine shows a placeholder frame with title, author and `artwork.link`.
//
// Coordinates
// - Image coordinates are normalised: x from the left edge (0..1), y DOWN from the top edge (0..1),
//   like Wikidata's "relative position within image" (P2677, "pct:x,y,w,h" / 100). Regions are
//   [x, y, w, h]; points are [x, y].
// - Scene units: the canvas is `presentation.width` units wide (default 12), its height follows
//   the real proportions. It stands in the x-y plane, facing +z (camera azimuth 0 looks at it),
//   centred on x = 0, bottom edge on the mount. Architecture elements use [x, z] ground positions
//   and heights in the same units, on the ground y = 0.
//
// Time model: per chapter, `actions` switch things on inside windows [at, until) (at omitted = already
// there at t = 0; until omitted = to the chapter end, except show actions: they fade out 8 s after their
// lines are drawn, so overlays never cover the work for long). show: an overlay appears (its lines draw
// themselves in `draw` seconds) or an architecture element rises (elements with no show action in a
// chapter simply stand there); tour: spotlight on a region (the rest of the image is dimmed: pair it
// with a camera key on the region); highlight: outline glow on a region or element; lift: a layer
// rises off the canvas.
//
// Anchors (pins, camera targets), all accept `offset`:
// - { entity: "region", part: "<regionId>" }       centre of the region on the canvas surface
// - { entity: "vanishing-point", part?: "<id>" }   vanishing point of a perspective overlay
//                                                  (default: the first one); a guess overlay id
//                                                  gives the guessed point (follows the sliders)
// - { entity: "layer", part: "<layerId>" }         centre of the cut-out card (follows the lift)
// - { entity: "artwork" }                          centre of the canvas
// - { entity: "element", part: "<id>" }            top centre of an architecture element
//
// Params ("Prova tu" sliders, listed in activity.test.params): guess-x / guess-y move a guess
// overlay's point (0..1 image coordinates) so the user can compare a wrong guess with the real
// vanishing point; opacity changes an overlay's opacity; depth changes a layer's lift.
import { z } from "zod";
import type { Issue } from "../validate.ts";
import { Id, type SceneBase } from "../common.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Norm = z.number().min(0).max(1);
/** Normalised image point [x, y], y down. */
export const ArtPoint = z.tuple([Norm, Norm]);
export type ArtPoint = z.infer<typeof ArtPoint>;
const EPS = 1e-6;
/** Normalised image rectangle [x, y, w, h], y down. */
export const ArtRect = z
  .tuple([Norm, Norm, z.number().gt(0).max(1), z.number().gt(0).max(1)])
  .refine(([x, y, w, h]) => x + w <= 1 + EPS && y + h <= 1 + EPS, "rectangle goes outside the image");
export type ArtRect = z.infer<typeof ArtRect>;
/** A straight edge traced on the image: [x1, y1, x2, y2]. */
const Segment = z.tuple([Norm, Norm, Norm, Norm]);

export const ArtKind = z.enum(["painting", "fresco", "mosaic", "drawing", "sculpture", "architecture"]);
export type ArtKind = z.infer<typeof ArtKind>;
const FLAT_KINDS = new Set<ArtKind>(["painting", "fresco", "mosaic", "drawing"]);
export const isFlatArt = (k: ArtKind) => FLAT_KINDS.has(k);

export const ArtImage = z
  .object({
    /** Asset path served to the player ("/art/<file>.jpg" or "/cache/art/<qid>/<file>"), ≤ 2048 px. */
    asset: z.string().min(1),
    /** Pixel size of the asset. */
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** Source entry of the file: author, licence (must say public domain / CC0), Commons URL. */
    sourceId: Id,
  })
  .strict();

export const Artwork = z
  .object({
    title: z.string().min(1),
    author: z.string().min(1),
    /** As written in the sources, e.g. "1494-1498". */
    date: z.string().min(1),
    technique: z.string().min(1),
    location: z.string().min(1),
    kind: ArtKind,
    wikidataId: z.string().regex(/^Q\d+$/).optional(),
    /** Real size in centimetres [width, height]; drives the proportions when there is no image. */
    sizeCm: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    /** Public-domain image only (see the header). Omitted = placeholder frame with title, author and link. */
    image: ArtImage.optional(),
    /** Page where the work can be seen (museum, Commons, Wikipedia): shown on the placeholder. */
    link: z.url().optional(),
    /** Sources of title, author, date, technique, location, size. */
    sourceIds: z.array(Id).min(1),
  })
  .strict();
export type Artwork = z.infer<typeof Artwork>;

export const ArtPresentation = z
  .object({
    /** frame: gilded frame on a small stand; easel; wall: a piece of wall (frescoes); plinth (sculpture). */
    mount: z.enum(["frame", "easel", "wall", "plinth"]),
    /** Canvas width in scene units (default 12). */
    width: z.number().positive().optional(),
    /** A museum wall standing behind the work. */
    museumWall: z.boolean().optional(),
    frameColor: Color.optional(),
    /** Scene background (default warm paper). */
    background: Color.optional(),
  })
  .strict();

export const ArtRegion = z
  .object({
    id: Id,
    /** Italian name, e.g. "Giuda". */
    name: z.string().min(1),
    rect: ArtRect,
    /** Where the rectangle comes from (e.g. Wikidata P180 + P2677); omitted = drawn by the author. */
    sourceIds: z.array(Id).optional(),
  })
  .strict();
export type ArtRegion = z.infer<typeof ArtRegion>;

const overlay = <T extends z.ZodRawShape>(shape: T) => z.object({ id: Id, color: Color.optional(), ...shape }).strict();

export const ArtOverlay = z.discriminatedUnion("kind", [
  /**
   * Perspective: edges traced on the image (ceiling beams, floor tiles, wall tops). Each line is
   * drawn from its first point, growing towards the vanishing point. `vanishingPoint` omitted = the
   * least-squares intersection of the lines (computed, see vanishingPointOf).
   */
  overlay({ kind: z.literal("perspective"), lines: z.array(Segment).min(2), vanishingPoint: ArtPoint.optional() }),
  /** A movable guessed vanishing point with lines from the perspective's starts ("Prova tu"). */
  overlay({ kind: z.literal("guess"), perspective: Id, start: ArtPoint }),
  /** Composition polyline: triangle, pyramid, diagonals (closed = back to the first point). */
  overlay({ kind: z.literal("polygon"), points: z.array(ArtPoint).min(2), closed: z.boolean().optional() }),
  /** Composition circle; radius as a fraction of the image width. */
  overlay({ kind: z.literal("circle"), center: ArtPoint, radius: z.number().positive().max(1) }),
  /** Symmetry axis: vertical at x, or horizontal at y. */
  overlay({ kind: z.literal("axis"), x: Norm.optional(), y: Norm.optional() }),
  /** Rule of thirds or golden-ratio grid over the whole image. */
  overlay({ kind: z.literal("grid"), grid: z.enum(["thirds", "golden"]) }),
  /** Arrow on the image: light direction, gaze between figures, movement. */
  overlay({ kind: z.literal("arrow"), from: ArtPoint, to: ArtPoint, style: z.enum(["light", "gaze", "plain"]) }),
  /** Colour swatches under the work: declared `colors`, or `count` colours computed from the image in the browser. */
  overlay({
    kind: z.literal("palette"),
    colors: z.array(z.object({ color: Color, name: z.string().optional() }).strict()).min(1).max(8).optional(),
    count: z.number().int().min(3).max(8).optional(),
  }),
]);
export type ArtOverlay = z.infer<typeof ArtOverlay>;

export const ArtLayer = z
  .object({
    id: Id,
    /** Region cut out and lifted. */
    region: Id,
    /** Lift in scene units (default 0.35). */
    depth: z.number().positive().max(3).optional(),
  })
  .strict();
export type ArtLayer = z.infer<typeof ArtLayer>;

const Ground = z.tuple([z.number(), z.number()]);
const Len = z.number().positive();
/**
 * Procedural classical architecture. Column height / lower diameter: doric 7, ionic 9,
 * corinthian 10 (the engine derives the diameter from `height`).
 */
export const ArtElement = z.discriminatedUnion("type", [
  z.object({ id: Id, type: z.literal("column"), order: z.enum(["doric", "ionic", "corinthian"]), pos: Ground, height: Len, color: Color.optional() }).strict(),
  /** Architrave + frieze + cornice from `from` to `to` (ground positions), lying on top of y. */
  z.object({ id: Id, type: z.literal("entablature"), from: Ground, to: Ground, y: z.number().min(0), depth: Len, height: Len.optional(), color: Color.optional() }).strict(),
  /** Triangular pediment over from..to at height y; pitch in degrees (default 13). */
  z.object({ id: Id, type: z.literal("pediment"), from: Ground, to: Ground, y: z.number().min(0), depth: Len, pitch: z.number().min(5).max(45).optional(), color: Color.optional() }).strict(),
  /** Round arch on two piers: `span` between the piers, piers `height` tall, facing +z unless `rot` (degrees about y). */
  z.object({ id: Id, type: z.literal("arch"), pos: Ground, span: Len, height: Len, depth: Len, rot: z.number().optional(), color: Color.optional() }).strict(),
  /** Hemispherical dome of `radius` on an optional cylindrical drum, base at height y. */
  z.object({ id: Id, type: z.literal("dome"), pos: Ground, radius: Len, y: z.number().min(0), drum: z.number().min(0).optional(), color: Color.optional() }).strict(),
]);
export type ArtElement = z.infer<typeof ArtElement>;

export const ArtModel = z
  .object({
    /** GLB asset from a verified CC0 / public-domain collection. */
    asset: z.string().min(1),
    sourceId: Id,
    /** Height in scene units (the model is scaled to it, base on the plinth). */
    height: Len,
  })
  .strict();

export const ArtParam = z
  .object({
    id: Id,
    /** Italian slider label. */
    label: z.string().min(1),
    kind: z.enum(["guess-x", "guess-y", "opacity", "depth"]),
    /** guess-x/-y: a guess overlay; opacity: any overlay; depth: a layer. */
    target: Id,
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    /** Default: the guess start, opacity 1, the layer depth. */
    value: z.number().optional(),
  })
  .strict()
  .refine((p) => p.max > p.min, "max must be greater than min");
export type ArtParam = z.infer<typeof ArtParam>;

export const ArtAction = z
  .object({
    do: z.enum(["show", "tour", "highlight", "lift"]),
    /** show: overlay or architecture element id; tour: region id; highlight: region or element id; lift: layer id. */
    target: Id,
    at: z.number().min(0).optional(),
    until: z.number().min(0).optional(),
    /** show: seconds the lines take to draw themselves (default 2). Without `until`, a show ends 8 s after. */
    draw: z.number().positive().optional(),
  })
  .strict();
export type ArtAction = z.infer<typeof ArtAction>;

export const ArtChapter = z.object({ chapter: Id, actions: z.array(ArtAction) }).strict();
export type ArtChapter = z.infer<typeof ArtChapter>;

export const ArtData = z
  .object({
    artwork: Artwork,
    presentation: ArtPresentation,
    regions: z.array(ArtRegion),
    overlays: z.array(ArtOverlay),
    layers: z.array(ArtLayer),
    architecture: z.array(ArtElement).optional(),
    model: ArtModel.optional(),
    params: z.array(ArtParam).optional(),
    chapters: z.array(ArtChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const kinds = new Map<string, string>();
    const claim = (id: string, kind: string, path: (string | number)[]) => {
      if (kinds.has(id)) add(path, `duplicate id "${id}"`);
      else kinds.set(id, kind);
    };
    d.regions.forEach((r, i) => claim(r.id, "region", ["regions", i, "id"]));
    d.overlays.forEach((o, i) => claim(o.id, o.kind, ["overlays", i, "id"]));
    d.layers.forEach((l, i) => claim(l.id, "layer", ["layers", i, "id"]));
    d.architecture?.forEach((e, i) => claim(e.id, "element", ["architecture", i, "id"]));
    d.layers.forEach((l, i) => kinds.get(l.region) !== "region" && add(["layers", i, "region"], `"${l.region}" is not a region`));
    d.overlays.forEach((o, i) => {
      if (o.kind === "guess" && kinds.get(o.perspective) !== "perspective") add(["overlays", i, "perspective"], `"${o.perspective}" is not a perspective overlay`);
      if (o.kind === "axis" && (o.x === undefined) === (o.y === undefined)) add(["overlays", i], "give exactly one of x or y");
      if (o.kind === "palette" && !o.colors && o.count === undefined) add(["overlays", i], "give `colors` or `count`");
    });
    d.params?.forEach((p, i) => {
      const k = kinds.get(p.target);
      const ok = p.kind === "depth" ? k === "layer" : p.kind === "opacity" ? k !== undefined && d.overlays.some((o) => o.id === p.target) : k === "guess";
      if (!ok) add(["params", i, "target"], `"${p.target}" is not a valid target for a ${p.kind} param`);
    });
    const chapters = new Set<string>();
    d.chapters.forEach((c, i) => {
      if (chapters.has(c.chapter)) add(["chapters", i, "chapter"], `duplicate chapter "${c.chapter}"`);
      chapters.add(c.chapter);
      c.actions.forEach((a, k) => {
        const path = ["chapters", i, "actions", k];
        const kind = kinds.get(a.target);
        const overlayOrElement = kind === "element" || d.overlays.some((o) => o.id === a.target);
        const want = a.do === "lift" ? kind === "layer" : a.do === "show" ? overlayOrElement : a.do === "tour" ? kind === "region" : kind === "region" || kind === "element";
        if (!want) add(path, `"${a.target}" is not a valid target for "${a.do}"`);
        if (a.until !== undefined && a.until <= (a.at ?? 0)) add(path, "`until` must come after `at`");
      });
    });
  });
export type ArtData = z.infer<typeof ArtData>;

/**
 * Least-squares intersection of image lines (each [x1, y1, x2, y2], normalised): the point that
 * minimises the sum of squared distances to the infinite lines. Null when they are (nearly) parallel.
 * Pure and deterministic; shared by the engine ("computed" vanishing point) and the checks.
 */
export function vanishingPointOf(lines: readonly (readonly [number, number, number, number])[]): ArtPoint | null {
  let a = 0, b = 0, c = 0, d = 0, e = 0;
  for (const [x1, y1, x2, y2] of lines) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-9) continue;
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const k = nx * x1 + ny * y1;
    a += nx * nx;
    b += nx * ny;
    c += ny * ny;
    d += nx * k;
    e += ny * k;
  }
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-9) return null;
  return [(d * c - b * e) / det, (a * e - b * d) / det];
}

/** Distance (normalised units) from a point to the infinite line through a segment. */
export function lineDistance(p: readonly [number, number], [x1, y1, x2, y2]: readonly [number, number, number, number]): number {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1e-9) return Math.hypot(p[0] - x1, p[1] - y1);
  return Math.abs((x2 - x1) * (y1 - p[1]) - (x1 - p[0]) * (y2 - y1)) / len;
}

/** Vanishing point of a perspective overlay: declared, or computed from its lines. */
export function perspectivePoint(o: { lines: readonly (readonly [number, number, number, number])[]; vanishingPoint?: readonly [number, number] }): ArtPoint | null {
  return o.vanishingPoint ? [o.vanishingPoint[0], o.vanishingPoint[1]] : vanishingPointOf(o.lines);
}

/** Lines whose distance from the vanishing point is above this (normalised) do not converge. */
export const CONVERGE_TOLERANCE = 0.03;

const PD_LICENSE = /public domain|pubblico dominio|^pd\b|cc0/i;
const ENTITIES = new Set(["region", "vanishing-point", "layer", "artwork", "element"]);

type SceneLike = Pick<z.infer<typeof SceneBase>, "chapters" | "sources">;

/**
 * Cross-checks against the rest of the scene that the schema alone cannot do: chapter ids and times,
 * source ids, the public-domain gate on the image, anchors of pins and camera keys, slider params.
 */
export function checkArtData(data: ArtData, scene: SceneLike): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const sources = new Map(scene.sources.map((s) => [s.id, s]));
  const checkIds = (path: string, ids: readonly string[] | undefined) => ids?.forEach((id) => !sources.has(id) && add(path, `unknown source id "${id}"`));

  const a = data.artwork;
  checkIds("engineData.artwork.sourceIds", a.sourceIds);
  if (a.image) {
    const src = sources.get(a.image.sourceId);
    if (!src) add("engineData.artwork.image.sourceId", `unknown source id "${a.image.sourceId}"`);
    else if (!src.license || !PD_LICENSE.test(src.license)) add("engineData.artwork.image", `image source "${src.id}" must declare a public-domain licence (got "${src.license ?? "none"}")`);
    else if (!src.url) add("engineData.artwork.image", `image source "${src.id}" needs the file page url`);
  } else if (!a.link) add("engineData.artwork", "without a public-domain image, give `link` for the placeholder");
  if (!isFlatArt(a.kind) && !a.image && !data.architecture?.length && !data.model) add("engineData.artwork", `a ${a.kind} needs an image, architecture elements or a model`);
  if (data.model) checkIds("engineData.model.sourceId", [data.model.sourceId]);
  data.regions.forEach((r, i) => checkIds(`engineData.regions[${i}].sourceIds`, r.sourceIds));

  data.overlays.forEach((o, i) => {
    if (o.kind !== "perspective") return;
    const vp = perspectivePoint(o);
    if (!vp) return void add(`engineData.overlays[${i}]`, "perspective lines are parallel: no vanishing point");
    o.lines.forEach((l, k) => {
      if (lineDistance(vp, l) > CONVERGE_TOLERANCE) add(`engineData.overlays[${i}].lines[${k}]`, "line does not pass near the vanishing point");
    });
  });

  const regionIds = new Set(data.regions.map((r) => r.id));
  const layerIds = new Set(data.layers.map((l) => l.id));
  const elementIds = new Set((data.architecture ?? []).map((e) => e.id));
  const vpIds = new Set(data.overlays.filter((o) => o.kind === "perspective" || o.kind === "guess").map((o) => o.id));
  const checkAnchor = (path: string, an: unknown) => {
    if (!an || typeof an !== "object" || !("entity" in an)) return;
    const { entity, part } = an as { entity: string; part?: string };
    if (!ENTITIES.has(entity)) return void add(path, `unknown art entity "${entity}"`);
    const ok =
      entity === "artwork" ||
      (entity === "vanishing-point" ? (part === undefined ? vpIds.size > 0 : vpIds.has(part)) : part !== undefined && (entity === "region" ? regionIds : entity === "layer" ? layerIds : elementIds).has(part));
    if (!ok) add(path, `unresolvable anchor ${entity}${part ? `:${part}` : ""}`);
  };

  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  const paramIds = new Set((data.params ?? []).map((p) => p.id));
  scene.chapters.forEach((ch, c) => {
    ch.pins.forEach((p, i) => checkAnchor(`chapters[${c}].pins[${i}].anchor`, p.anchor));
    ch.camera.forEach((k, i) => checkAnchor(`chapters[${c}].camera[${i}].target`, k.target));
    ch.activity?.test.params?.forEach((id, k) => !paramIds.has(id) && add(`chapters[${c}].activity.test.params[${k}]`, `"${id}" is not an art param`));
  });
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (duration === undefined) return void add(path, `unknown chapter "${c.chapter}"`);
    c.actions.forEach((act, k) => {
      if ((act.at ?? 0) > duration || (act.until ?? 0) > duration + EPS) add(`${path}.actions[${k}]`, `"${act.target}" has a time after the chapter ends`);
    });
  });
  return issues;
}
