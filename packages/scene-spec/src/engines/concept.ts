// ConceptData: owned by the `concept` engine (decision D9).
//
// Abstract topics (grammar, maths, logic, metre...) as 3D "building blocks": word/number
// tiles coloured by role, rows (shelves), axes, arrows and flat maths shapes, animated by
// declarative per-chapter actions. Everything is generic and declarative so an LLM can fill it.
//
// Units and layout model
// - 1 unit = the height of a size "m" tile ("s" = 0.8, "l" = 1.3). Tiles are upright blocks
//   whose text faces +z (the default camera side); their width is computed from the text.
// - Board coordinates: x right, y up, z towards the camera; the board top is y = 0, centred
//   on the origin, `board.width` along x and `board.depth` along z.
// - A Place gives the BOTTOM-CENTRE of an entity:
//   { pos: [x, y, z] }                         fixed point (y > 0 = floating/stacked)
//   { row: "r1", index: 2 }                    slot in a row: present entities of a row are packed
//                                              left to right by index (ties: declaration order),
//                                              centred on the row origin, `gap` apart. When a
//                                              tile joins, leaves or changes width, the others
//                                              slide to their new slots automatically.
//   { axis: "t", value: 4, lane: -1, height: 0 } point of an axis at `value` (min..max mapped
//                                              onto its length), moved `lane` units sideways
//                                              (+z for x and y axes, +x for z axes) and `height` up.
// - Shapes lie flat on their place (local 2D x -> board x, local 2D y -> board -z) or, with
//   `upright`, stand facing +z (local y -> board y). Their local origin is the place point.
//
// Time model: chapter time t in seconds. Every entity starts hidden; a chapter starts from the
// end state of the previous chapter in scene order (carryOver, default true) or from scratch.
// Actions run at `at` for `dur` seconds (defaults per action, see ACTION_DEFAULT_DUR).
//
// Entity anchors resolved by the engine (for pins and camera targets), all accept `offset`:
// - { entity: "tile",  part: "<id>" }            top-centre of the tile, following its motion
// - { entity: "shape", part: "<id>" }            top-centre of the shape
// - { entity: "row",   part: "<id>" }            centre of the row's current extent, mid tile height
// - { entity: "axis",  part: "<id>", index: k }  the axis' k-th label; without index: axis middle
// - { entity: "link",  part: "<id>" }            middle of the arrow
// - { entity: "board" }                          board centre
// - { entity: "graph",   part: "<id>" }          centre of a graph frame
// - { entity: "plot",    part: "<id>", index: k } curve point at x = x.min + k·x.step (no index:
//                                              where the plot label sits)
// - { entity: "point",   part: "<id>" }          the bead of a notable point (live with params)
// - { entity: "tracer",  part: "<id>" }          the moving tracer bead
// - { entity: "surface", part: "<id>" }          top centre of a surface
//
// Graphs (function study): `graphs` holds Cartesian frames, each a whiteboard standing on the
// board (2D: maths x -> board x, maths y -> board up) or, with a `z` axis, a 3D box (maths x ->
// board x, maths z -> board up, maths y -> board depth, towards the back). `pos` is the
// bottom-centre of the frame; `scale` board units per maths unit (`yScale` for the vertical axis).
// Inside a graph: plots y = f(x) (smooth tubes; in 3D graphs they lie in the plane y = 0),
// notable points declared by kind + x (y is COMPUTED, the kind is checked numerically, labels
// like "V(2; −1)" are automatic), lines (asymptotes, symmetry axes, guides; dashed), regions
// (shading between a curve and the x axis or another curve, optionally split by sign),
// intervals (bands on the x axis: domain, f > 0, increasing...), tracers (a bead moving along
// a curve with its tangent and a live readout) and surfaces z = f(x, y) (3D graphs only).
// Formulas use the safe language of ../math/expr.ts ("x^2 - 4x + 3", "sqrt(x-1)", "ln(x)").
// Parameters (`params`, e.g. a, b, c) are extra variables of the graph's formulas: they are
// animated per chapter by "param" actions and handed to the student as sliders when a chapter's
// `activity.test.params` lists them (engine.params / engine.setParams); points, labels, regions
// and tracers follow them live.
import { z } from "zod";
import { Id, Vec3, type SceneBase } from "../common.ts";
import { ExprError, isReservedName, MAX_EXPR_LENGTH, parseExpr } from "../math/expr.ts";
import { checkConceptMath, paramNum } from "../math/graph.ts";

export * from "../math/index.ts";
export * from "../math/graph.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Seconds = z.number().min(0);

/** A colour with a meaning ("soggetto", "ausiliare", "radice"...). Tiles, shapes and links refer to roles. */
export const ConceptRole = z.object({ id: Id, name: z.string().min(1), color: Color }).strict();
export type ConceptRole = z.infer<typeof ConceptRole>;

export const ConceptPlace = z.union([
  z.object({ pos: Vec3 }).strict(),
  z.object({ row: Id, index: z.number() }).strict(),
  z
    .object({ axis: Id, value: z.number(), lane: z.number().optional(), height: z.number().optional() })
    .strict(),
]);
export type ConceptPlace = z.infer<typeof ConceptPlace>;

/** A horizontal row of slots along +x; with `tray` it is drawn as a shelf under its tiles. */
export const ConceptRow = z
  .object({
    id: Id,
    /** Centre of the row, at the bottom of its tiles. */
    origin: Vec3,
    /** Space between neighbours (default 0.25). Small gaps (~0.05) read as "snapped together". */
    gap: z.number().min(0).optional(),
    tray: z.boolean().optional(),
    /** Small caption above the left end of the row (shown with the tray). */
    label: z.string().min(1).optional(),
    role: Id.optional(),
  })
  .strict();
export type ConceptRow = z.infer<typeof ConceptRow>;

/** Time arrow, number line, or one axis of a Cartesian plane (use two axes with the same origin). */
export const ConceptAxis = z
  .object({
    id: Id,
    origin: Vec3,
    direction: z.enum(["x", "y", "z"]),
    length: z.number().positive(),
    /** Values mapped onto [0, length]. */
    min: z.number(),
    max: z.number(),
    /** Tick + caption at a value; `role` colours the tick. */
    labels: z.array(z.object({ value: z.number(), text: z.string().min(1), role: Id.optional() }).strict()),
    /** Caption at the arrow end. */
    title: z.string().min(1).optional(),
    /** Arrow head at the end (default true). */
    arrow: z.boolean().optional(),
    role: Id.optional(),
  })
  .strict();
export type ConceptAxis = z.infer<typeof ConceptAxis>;

/** A block with text: word, morpheme, number, formula piece. */
export const ConceptTile = z
  .object({
    id: Id,
    text: z.string().min(1),
    /** Smaller second line ("ausiliare", "presente"). */
    sub: z.string().min(1).optional(),
    role: Id.optional(),
    size: z.enum(["s", "m", "l"]).optional(),
    /** Home place (where it appears unless moved). */
    place: ConceptPlace,
    /** Needed when the text contains a number (same rule as narration). */
    sourceIds: z.array(Id).optional(),
  })
  .strict();
export type ConceptTile = z.infer<typeof ConceptTile>;

const ShapeCommon = {
  id: Id,
  place: ConceptPlace,
  role: Id.optional(),
  /** Caption floating above the shape. */
  label: z.string().min(1).optional(),
  upright: z.boolean().optional(),
  sourceIds: z.array(Id).optional(),
};
const Point2 = z.tuple([z.number(), z.number()]);

/** Flat maths shapes (slabs). Angles in degrees, counter-clockwise from local +x. */
export const ConceptShape = z.discriminatedUnion("kind", [
  /** Triangle, square on a side, any polygon: points in local 2D units. */
  z.object({ ...ShapeCommon, kind: z.literal("polygon"), points: z.array(Point2).min(3) }).strict(),
  z.object({ ...ShapeCommon, kind: z.literal("circle"), radius: z.number().positive() }).strict(),
  /** Fraction as a pie: `filled` of `parts` slices in the role colour. */
  z
    .object({
      ...ShapeCommon,
      kind: z.literal("pie"),
      radius: z.number().positive(),
      parts: z.number().int().min(1).max(64),
      filled: z.number().int().min(0),
    })
    .strict(),
  /** Fraction as a bar of `parts` cells along local x, centred on the origin. */
  z
    .object({
      ...ShapeCommon,
      kind: z.literal("bar"),
      length: z.number().positive(),
      parts: z.number().int().min(1).max(64),
      filled: z.number().int().min(0),
    })
    .strict(),
  /** Angle: two arms of length `radius` and the filled sector between `from` and `to`. */
  z
    .object({ ...ShapeCommon, kind: z.literal("angle"), radius: z.number().positive(), from: z.number(), to: z.number() })
    .strict(),
]);
export type ConceptShape = z.infer<typeof ConceptShape>;

/** Arrow (or plain line) between two tiles/shapes; it follows them when they move. */
export const ConceptLink = z
  .object({
    id: Id,
    from: Id,
    to: Id,
    label: z.string().min(1).optional(),
    role: Id.optional(),
    /** Curvature: 0 straight, 1 default arc. */
    bend: z.number().min(0).max(3).optional(),
    arrow: z.boolean().optional(),
  })
  .strict();
export type ConceptLink = z.infer<typeof ConceptLink>;

// ---------- graphs ----------

const Range2 = z.tuple([z.number(), z.number()]);
const MathExpr = z.string().min(1).max(MAX_EXPR_LENGTH);
/**
 * A number, or a formula of the graph's parameters only (no x), evaluated live: "a", "-b/(2a)",
 * "q + 1". Lines, intervals, regions, point x and plot domains follow the sliders this way.
 */
export const ParamNum = z.union([z.number(), MathExpr]);
export type ParamNum = z.infer<typeof ParamNum>;
const ParamRange = z.tuple([ParamNum, ParamNum]);
/** false hides the automatic label; a string replaces it. */
const AutoLabel = z.union([z.string().min(1), z.literal(false)]).optional();
const Sources = z.array(Id).optional();

export const GraphAxis = z
  .object({
    min: z.number(),
    max: z.number(),
    /** Tick and grid spacing (default: a round step giving about 10 ticks). */
    step: z.number().positive().optional(),
    /** Axis name at the arrow (default "x", "y", "z"). */
    label: z.string().min(1).optional(),
  })
  .strict();
export type GraphAxis = z.infer<typeof GraphAxis>;

/** A named parameter of the graph's formulas ("a" in "a*x^2 + b*x + c"). */
export const GraphParam = z
  .object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,5}$/),
    /** Slider caption (default the id). */
    label: z.string().min(1).optional(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    /** Value at the start of the lesson. */
    value: z.number(),
  })
  .strict();
export type GraphParam = z.infer<typeof GraphParam>;

export const GraphPlot = z
  .object({
    id: Id,
    /** y = expr(x, params). */
    expr: MathExpr,
    /** Function name for labels and readouts (default "f"). */
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]?$/).optional(),
    /** Default "f(x) = <formula>" with the current parameter values. */
    label: AutoLabel,
    role: Id.optional(),
    /** Draw only for x inside [from, to]. */
    domain: ParamRange.optional(),
    /** Tube radius in board units (default 0.08). */
    width: z.number().min(0.02).max(0.4).optional(),
    dashed: z.boolean().optional(),
    /** Gives a 2D curve visual depth: a ribbon this deep (board units) along z. */
    extrude: z.number().positive().max(10).optional(),
    sourceIds: Sources,
  })
  .strict();
export type GraphPlot = z.infer<typeof GraphPlot>;

export const POINT_KINDS = ["zero", "vertex", "max", "min", "inflection", "y-intercept", "point"] as const;
export const GraphPoint = z
  .object({
    id: Id,
    plot: Id,
    /** zero: f(x) = 0; vertex: max or min; y-intercept: x = 0 (x may be omitted); point: any x. */
    kind: z.enum(POINT_KINDS),
    x: ParamNum.optional(),
    /** Letter before the coordinates: "V" -> "V(2; −1)". */
    name: z.string().min(1).max(6).optional(),
    label: AutoLabel,
    role: Id.optional(),
    sourceIds: Sources,
  })
  .strict();
export type GraphPoint = z.infer<typeof GraphPoint>;

/** Dashed line: { x } vertical, { y } horizontal, { m, q } y = mx + q. */
export const GraphLine = z
  .object({
    id: Id,
    x: ParamNum.optional(),
    y: ParamNum.optional(),
    m: ParamNum.optional(),
    q: ParamNum.optional(),
    /** "asymptote" (default) and "symmetry" (vertical axis) are checked against `plot`. */
    meaning: z.enum(["asymptote", "symmetry", "guide"]).optional(),
    plot: Id.optional(),
    /** Default "x = 2", "y = 2x + 1". */
    label: AutoLabel,
    role: Id.optional(),
    sourceIds: Sources,
  })
  .strict();
export type GraphLine = z.infer<typeof GraphLine>;

export const GraphRegion = z
  .object({
    id: Id,
    plot: Id,
    /** x interval (default: the whole drawn curve). */
    over: ParamRange.optional(),
    /** Second curve; default the x axis. */
    with: Id.optional(),
    /** Colour positive parts green with "+" and negative parts red with "−" (sign study). */
    sign: z.boolean().optional(),
    role: Id.optional(),
    label: z.string().min(1).optional(),
    sourceIds: Sources,
  })
  .strict();
export type GraphRegion = z.infer<typeof GraphRegion>;

/** Band on the x axis; a missing end means −∞ / +∞. Labels may hold "{expr}" placeholders ("x < {a}"). */
export const GraphInterval = z
  .object({
    id: Id,
    from: ParamNum.optional(),
    to: ParamNum.optional(),
    /** Closed ends get a full dot, open ends a ring (default open). */
    fromClosed: z.boolean().optional(),
    toClosed: z.boolean().optional(),
    /** 0 = on the x axis, 1.. = stacked under it. */
    lane: z.number().int().min(0).max(4).optional(),
    role: Id.optional(),
    label: z.string().min(1).optional(),
    sourceIds: Sources,
  })
  .strict();
export type GraphInterval = z.infer<typeof GraphInterval>;

export const GraphTracer = z
  .object({
    id: Id,
    plot: Id,
    /** Start x; "trace" actions move it. */
    x: z.number(),
    tangent: z.boolean().optional(),
    /** Live text next to the bead (default "slope": x and f′(x)). */
    readout: z.enum(["slope", "value", "both", "none"]).optional(),
    role: Id.optional(),
    sourceIds: Sources,
  })
  .strict();
export type GraphTracer = z.infer<typeof GraphTracer>;

/** z = expr(x, y, params) over a rectangle, coloured by height (3D graphs only). */
export const GraphSurface = z
  .object({
    id: Id,
    expr: MathExpr,
    x: Range2,
    y: Range2,
    wireframe: z.boolean().optional(),
    /** Grid cells per side (default 48). */
    resolution: z.number().int().min(8).max(96).optional(),
    label: AutoLabel,
    sourceIds: Sources,
  })
  .strict();
export type GraphSurface = z.infer<typeof GraphSurface>;

export const ConceptGraph = z
  .object({
    id: Id,
    /** Bottom-centre of the frame on the board. */
    pos: Vec3,
    x: GraphAxis,
    y: GraphAxis,
    /** Present = 3D graph: z is the vertical axis, y goes into depth. */
    z: GraphAxis.optional(),
    scale: z.number().positive().optional(),
    yScale: z.number().positive().optional(),
    grid: z.boolean().optional(),
    params: z.array(GraphParam).optional(),
    plots: z.array(GraphPlot).optional(),
    points: z.array(GraphPoint).optional(),
    lines: z.array(GraphLine).optional(),
    regions: z.array(GraphRegion).optional(),
    intervals: z.array(GraphInterval).optional(),
    tracers: z.array(GraphTracer).optional(),
    surfaces: z.array(GraphSurface).optional(),
  })
  .strict();
export type ConceptGraph = z.infer<typeof ConceptGraph>;

export type GraphEntityKind = "graph" | "plot" | "point" | "line" | "region" | "interval" | "tracer" | "surface" | "param";

/** Every graph entity with its kind and graph, in declaration order. */
export function graphEntities(graphs: ConceptGraph[] | undefined): { id: string; kind: GraphEntityKind; graph: ConceptGraph }[] {
  const out: { id: string; kind: GraphEntityKind; graph: ConceptGraph }[] = [];
  for (const g of graphs ?? []) {
    out.push({ id: g.id, kind: "graph", graph: g });
    const lists: [GraphEntityKind, { id: string }[] | undefined][] = [
      ["param", g.params],
      ["plot", g.plots],
      ["point", g.points],
      ["line", g.lines],
      ["region", g.regions],
      ["interval", g.intervals],
      ["tracer", g.tracers],
      ["surface", g.surfaces],
    ];
    for (const [kind, list] of lists) for (const e of list ?? []) out.push({ id: e.id, kind, graph: g });
  }
  return out;
}

/**
 * Default `appear` duration for graph entities, seconds (curves draw themselves, surfaces grow).
 * Graph frames are the exception: the player pops the content up at chapter entry, so a frame
 * shown in a chapter stands from t = 0 (the engine hoists its "appear"; unless the chapter hides it).
 */
export const GRAPH_APPEAR_DUR: Partial<Record<GraphEntityKind, number>> = {
  graph: 1.2,
  plot: 2.5,
  surface: 2.5,
  region: 1.0,
  interval: 1.0,
  line: 1.0,
};

const ActionBase = { at: Seconds, dur: Seconds.optional() };
const Ids = z.array(Id).min(1);

export const ConceptAction = z.discriminatedUnion("do", [
  /** Show entities ("pop": scale up with overshoot; "drop": fall from above and bounce). Axes and arrows draw themselves. */
  z
    .object({ ...ActionBase, do: z.literal("appear"), ids: Ids, style: z.enum(["pop", "drop"]).optional(), stagger: Seconds.optional() })
    .strict(),
  z.object({ ...ActionBase, do: z.literal("hide"), ids: Ids }).strict(),
  /** Tile or shape to a new place; ends with a snap/squash. "hop" arcs over the others. */
  z.object({ ...ActionBase, do: z.literal("move"), id: Id, to: ConceptPlace, style: z.enum(["hop", "slide"]).optional() }).strict(),
  /** Two tiles/shapes exchange places. */
  z.object({ ...ActionBase, do: z.literal("swap"), a: Id, b: Id }).strict(),
  /** A tile breaks into pieces: `id` vanishes, `into` tiles fly from it to their own places. */
  z.object({ ...ActionBase, do: z.literal("split"), id: Id, into: Ids }).strict(),
  /** Tiles fly together and snap into one: `ids` vanish into `into`, which pops at its place. */
  z.object({ ...ActionBase, do: z.literal("merge"), ids: Ids, into: Id }).strict(),
  /** The tile flips and shows a new text ("provare" -> "avrete provato"); optional new sub/role. */
  z
    .object({ ...ActionBase, do: z.literal("morph"), id: Id, text: z.string().min(1), sub: z.string().optional(), role: Id.optional() })
    .strict(),
  z.object({ ...ActionBase, do: z.literal("color"), ids: Ids, role: Id }).strict(),
  /** Pulsing glow and outline for `dur` seconds (default 2.5). */
  z.object({ ...ActionBase, do: z.literal("highlight"), ids: Ids }).strict(),
  z.object({ ...ActionBase, do: z.literal("bounce"), ids: Ids }).strict(),
  /** Draws (part of) a plot with a pen tip, from x = `from` to x = `to` (default: whole curve). */
  z.object({ ...ActionBase, do: z.literal("draw"), id: Id, from: z.number().optional(), to: z.number().optional() }).strict(),
  /** Moves a tracer along its curve to x = `to`. */
  z.object({ ...ActionBase, do: z.literal("trace"), id: Id, to: z.number() }).strict(),
  /**
   * Parity tests with a ghost copy of the plot: "y-axis" reflects it in the y axis (f(−x), even
   * test: it swings round in 3D), "origin" turns it 180° about the origin (−f(−x), odd test).
   * Each ghost stays for the rest of the chapter and both can be shown together, each with its
   * live verdict ("f(−x) ≠ f(x)", "−f(−x) = f(x): dispari"): trying both shows "neither".
   */
  z.object({ ...ActionBase, do: z.literal("mirror"), id: Id, about: z.enum(["y-axis", "origin"]) }).strict(),
  /** Animates a graph parameter to a new value. */
  z.object({ ...ActionBase, do: z.literal("param"), id: Id, to: z.number() }).strict(),
]);
export type ConceptAction = z.infer<typeof ConceptAction>;

/** Default `dur` per action, seconds. */
export const ACTION_DEFAULT_DUR: Record<ConceptAction["do"], number> = {
  appear: 0.6,
  hide: 0.45,
  move: 0.9,
  swap: 1.0,
  split: 0.9,
  merge: 1.0,
  morph: 0.7,
  color: 0.5,
  highlight: 2.5,
  bounce: 0.8,
  draw: 2.5,
  trace: 3,
  mirror: 2.5,
  param: 2,
};

export const ConceptChapter = z
  .object({
    chapter: Id,
    /** Start from the end state of the previous chapter (default true); false = empty board. */
    carryOver: z.boolean().optional(),
    actions: z.array(ConceptAction),
  })
  .strict();
export type ConceptChapter = z.infer<typeof ConceptChapter>;

type AddIssue = (path: (string | number)[], message: string) => void;

/** Structural checks of one graph: ranges, formulas, references inside the same graph. */
function refineGraph(
  g: ConceptGraph,
  at: (string | number)[],
  add: AddIssue,
  checkRole: (path: (string | number)[], role: string | undefined) => void,
  inGraph: (id: string, kind: GraphEntityKind) => boolean,
): void {
  const init = Object.fromEntries((g.params ?? []).map((p) => [p.id, p.value]));
  const range = (path: (string | number)[], r: readonly [ParamNum, ParamNum] | { min: number; max: number }) => {
    const [a, b] = "min" in r ? [r.min, r.max] : r.map((v) => paramNum(v, init) ?? NaN);
    if (!(a! < b!)) add(path, `range must go from a smaller to a larger number, got [${a}, ${b}]`);
  };
  range([...at, "x"], g.x);
  range([...at, "y"], g.y);
  if (g.z) range([...at, "z"], g.z);
  const params = (g.params ?? []).map((p) => p.id);
  g.params?.forEach((p, i) => {
    const path = [...at, "params", i];
    if (isReservedName(p.id) || ["x", "y", "z"].includes(p.id)) add(path, `"${p.id}" cannot be a parameter name`);
    range(path, p);
    if (p.value < p.min || p.value > p.max) add(path, `value ${p.value} is outside [${p.min}, ${p.max}]`);
  });
  const formula = (path: (string | number)[], src: string, vars: string[]) => {
    try {
      parseExpr(src, { vars });
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      add(path, `formula "${src}": ${e.message}`);
    }
  };
  /** Parameter formulas in numeric fields: parameters only, no x. */
  const pnum = (path: (string | number)[], v: ParamNum | undefined) => {
    if (typeof v === "string") formula(path, v, params);
  };
  const pnums = (path: (string | number)[], v: readonly ParamNum[] | undefined) => v?.forEach((q, i) => pnum([...path, i], q));
  const placeholders = (path: (string | number)[], label: string | false | undefined) => {
    if (typeof label === "string") for (const m of label.matchAll(/\{([^}]*)\}/g)) formula(path, m[1]!, params);
  };
  const ref = (path: (string | number)[], id: string | undefined, kind: GraphEntityKind) => {
    if (id !== undefined && !inGraph(id, kind)) add(path, `"${id}" is not a ${kind} of graph "${g.id}"`);
  };
  g.plots?.forEach((p, i) => {
    formula([...at, "plots", i, "expr"], p.expr, ["x", ...params]);
    checkRole([...at, "plots", i, "role"], p.role);
    pnums([...at, "plots", i, "domain"], p.domain);
    if (p.domain) range([...at, "plots", i, "domain"], p.domain);
  });
  g.points?.forEach((p, i) => {
    ref([...at, "points", i, "plot"], p.plot, "plot");
    checkRole([...at, "points", i, "role"], p.role);
    if (p.kind !== "y-intercept" && p.x === undefined) add([...at, "points", i, "x"], `a "${p.kind}" point needs x`);
    pnum([...at, "points", i, "x"], p.x);
    placeholders([...at, "points", i, "label"], p.label);
  });
  g.lines?.forEach((l, i) => {
    const path = [...at, "lines", i];
    const forms = [l.x !== undefined, l.y !== undefined, l.m !== undefined || l.q !== undefined].filter(Boolean).length;
    if (forms !== 1 || (l.m === undefined) !== (l.q === undefined)) add(path, "a line is { x }, { y } or { m, q }");
    const meaning = l.meaning ?? "asymptote";
    if (meaning !== "guide" && !l.plot) add(path, `a ${meaning} line needs its plot`);
    if (meaning === "symmetry" && l.x === undefined) add(path, "a symmetry axis is a vertical line { x }");
    ref([...path, "plot"], l.plot, "plot");
    checkRole([...path, "role"], l.role);
    for (const k of ["x", "y", "m", "q"] as const) pnum([...path, k], l[k]);
    placeholders([...path, "label"], l.label);
  });
  g.regions?.forEach((r, i) => {
    ref([...at, "regions", i, "plot"], r.plot, "plot");
    ref([...at, "regions", i, "with"], r.with, "plot");
    pnums([...at, "regions", i, "over"], r.over);
    placeholders([...at, "regions", i, "label"], r.label);
    if (r.over) range([...at, "regions", i, "over"], r.over);
    checkRole([...at, "regions", i, "role"], r.role);
  });
  g.intervals?.forEach((v, i) => {
    pnum([...at, "intervals", i, "from"], v.from);
    pnum([...at, "intervals", i, "to"], v.to);
    placeholders([...at, "intervals", i, "label"], v.label);
    if (v.from !== undefined && v.to !== undefined) range([...at, "intervals", i], [v.from, v.to]);
    checkRole([...at, "intervals", i, "role"], v.role);
  });
  g.tracers?.forEach((t, i) => {
    ref([...at, "tracers", i, "plot"], t.plot, "plot");
    checkRole([...at, "tracers", i, "role"], t.role);
  });
  g.surfaces?.forEach((s, i) => {
    const path = [...at, "surfaces", i];
    if (!g.z) add(path, "surfaces need a 3D graph (with a z axis)");
    formula([...path, "expr"], s.expr, ["x", "y", ...params]);
    range([...path, "x"], s.x);
    range([...path, "y"], s.y);
  });
}

export const ConceptData = z
  .object({
    board: z.object({ width: z.number().positive(), depth: z.number().positive() }).strict(),
    roles: z.array(ConceptRole),
    rows: z.array(ConceptRow),
    axes: z.array(ConceptAxis),
    tiles: z.array(ConceptTile),
    shapes: z.array(ConceptShape),
    links: z.array(ConceptLink),
    graphs: z.array(ConceptGraph).optional(),
    chapters: z.array(ConceptChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const roleIds = new Set<string>();
    d.roles.forEach((r, i) => {
      if (roleIds.has(r.id)) add(["roles", i, "id"], `duplicate role id "${r.id}"`);
      roleIds.add(r.id);
    });
    const checkRole = (path: (string | number)[], role: string | undefined) => {
      if (role !== undefined && !roleIds.has(role)) add(path, `unknown role "${role}"`);
    };

    // One id namespace for everything actions and anchors can point at.
    const kinds = new Map<string, string>();
    const declare = (list: { id: string }[], kind: string, key: string) =>
      list.forEach((e, i) => {
        if (kinds.has(e.id)) add([key, i, "id"], `duplicate id "${e.id}"`);
        else kinds.set(e.id, kind);
      });
    declare(d.rows, "row", "rows");
    declare(d.axes, "axis", "axes");
    declare(d.tiles, "tile", "tiles");
    declare(d.shapes, "shape", "shapes");
    declare(d.links, "link", "links");
    const is = (id: string, ...k: string[]) => k.includes(kinds.get(id) ?? "");
    const graphOf = new Map<string, string>();
    for (const e of graphEntities(d.graphs)) {
      if (kinds.has(e.id)) add(["graphs"], `duplicate id "${e.id}"`);
      else kinds.set(e.id, e.kind);
      graphOf.set(e.id, e.graph.id);
    }
    const GRAPH_KINDS = ["graph", "plot", "point", "line", "region", "interval", "tracer", "surface"];

    const checkPlace = (path: (string | number)[], p: ConceptPlace) => {
      if ("row" in p && !is(p.row, "row")) add(path, `unknown row "${p.row}"`);
      if ("axis" in p && !is(p.axis, "axis")) add(path, `unknown axis "${p.axis}"`);
    };
    d.rows.forEach((r, i) => checkRole(["rows", i, "role"], r.role));
    d.axes.forEach((a, i) => {
      if (a.max === a.min) add(["axes", i, "max"], "axis max must differ from min");
      checkRole(["axes", i, "role"], a.role);
      a.labels.forEach((l, k) => checkRole(["axes", i, "labels", k, "role"], l.role));
    });
    d.tiles.forEach((t, i) => {
      checkRole(["tiles", i, "role"], t.role);
      checkPlace(["tiles", i, "place"], t.place);
    });
    d.shapes.forEach((s, i) => {
      checkRole(["shapes", i, "role"], s.role);
      checkPlace(["shapes", i, "place"], s.place);
      if ((s.kind === "pie" || s.kind === "bar") && s.filled > s.parts) add(["shapes", i, "filled"], "more filled parts than parts");
    });
    d.graphs?.forEach((g, gi) =>
      refineGraph(g, ["graphs", gi], add, checkRole, (id, kind) => is(id, kind) && graphOf.get(id) === g.id),
    );
    d.links.forEach((l, i) => {
      checkRole(["links", i, "role"], l.role);
      if (!is(l.from, "tile", "shape")) add(["links", i, "from"], `link end "${l.from}" is not a tile or shape`);
      if (!is(l.to, "tile", "shape")) add(["links", i, "to"], `link end "${l.to}" is not a tile or shape`);
    });

    d.chapters.forEach((c, i) => {
      c.actions.forEach((a, k) => {
        const path = ["chapters", i, "actions", k];
        const need = (id: string, what: string, ...allowed: string[]) => {
          if (!is(id, ...allowed)) add(path, `${a.do}: "${id}" is not a known ${what}`);
        };
        switch (a.do) {
          case "appear":
          case "hide":
          case "highlight":
            for (const id of a.ids) need(id, "tile, shape, axis, link or graph entity", "tile", "shape", "axis", "link", ...GRAPH_KINDS);
            break;
          case "bounce":
            for (const id of a.ids) need(id, "tile, shape, axis or link", "tile", "shape", "axis", "link");
            break;
          case "draw":
          case "mirror":
            need(a.id, "plot", "plot");
            break;
          case "trace":
            need(a.id, "tracer", "tracer");
            break;
          case "param": {
            need(a.id, "parameter", "param");
            const p = d.graphs?.flatMap((g) => g.params ?? []).find((q) => q.id === a.id);
            if (p && (a.to < p.min || a.to > p.max)) add(path, `param: ${a.id} = ${a.to} is outside [${p.min}, ${p.max}]`);
            break;
          }
          case "color":
            checkRole(path, a.role);
            for (const id of a.ids) need(id, "tile, shape, axis or link", "tile", "shape", "axis", "link");
            break;
          case "move":
            need(a.id, "tile or shape", "tile", "shape");
            checkPlace(path, a.to);
            break;
          case "swap":
            need(a.a, "tile or shape", "tile", "shape");
            need(a.b, "tile or shape", "tile", "shape");
            break;
          case "split":
            need(a.id, "tile", "tile");
            for (const id of a.into) need(id, "tile", "tile");
            break;
          case "merge":
            need(a.into, "tile", "tile");
            for (const id of a.ids) need(id, "tile", "tile");
            break;
          case "morph":
            need(a.id, "tile", "tile");
            checkRole(path, a.role);
            break;
        }
      });
    });
  });
export type ConceptData = z.infer<typeof ConceptData>;

const HAS_DIGIT = /\d/;

/**
 * Cross-checks against the rest of the scene (chapter and source ids; numbers shown on tiles,
 * shapes, labels need a source, as in checkSemantics). Same Issue shape as checkSemantics.
 */
export function checkConceptData(
  data: ConceptData,
  scene: Pick<z.infer<typeof SceneBase>, "chapters" | "sources">,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const chapterIds = new Set(scene.chapters.map((c) => c.id));
  const sourceIds = new Set(scene.sources.map((s) => s.id));
  const checkSources = (path: string, ids: string[] | undefined, text: string) => {
    for (const id of ids ?? []) if (!sourceIds.has(id)) issues.push({ path, message: `unknown source id "${id}"` });
    if (HAS_DIGIT.test(text) && !ids?.length) issues.push({ path, message: `number without source: "${text}"` });
  };
  const morphs = new Map<string, string[]>();
  for (const c of data.chapters)
    for (const a of c.actions) if (a.do === "morph") morphs.set(a.id, [...(morphs.get(a.id) ?? []), a.text, a.sub ?? ""]);
  data.tiles.forEach((t, i) =>
    checkSources(`engineData.tiles[${i}]`, t.sourceIds, [t.text, t.sub ?? "", ...(morphs.get(t.id) ?? [])].join(" ")),
  );
  data.shapes.forEach((s, i) => checkSources(`engineData.shapes[${i}]`, s.sourceIds, s.label ?? ""));
  // Graph labels show computed numbers (formulas, coordinates, readouts): they need a source too,
  // usually the "computed" one. Tick numbers of the grid are scaffolding and need none.
  data.graphs?.forEach((g, gi) => {
    const at = `engineData.graphs[${gi}]`;
    // "{expr}" placeholders show live numbers: they count as digits.
    const lbl = (l: string | false | undefined, auto: string) => (l === false ? "" : (l ?? auto).replace(/\{[^}]*\}/g, "0"));
    g.plots?.forEach((p, i) => checkSources(`${at}.plots[${i}]`, p.sourceIds, lbl(p.label, p.expr)));
    g.points?.forEach((p, i) => checkSources(`${at}.points[${i}]`, p.sourceIds, lbl(p.label, "(0; 0)")));
    g.lines?.forEach((l, i) => checkSources(`${at}.lines[${i}]`, l.sourceIds, lbl(l.label, "x = 0")));
    g.regions?.forEach((r, i) => checkSources(`${at}.regions[${i}]`, r.sourceIds, lbl(r.label, "")));
    g.intervals?.forEach((v, i) => checkSources(`${at}.intervals[${i}]`, v.sourceIds, lbl(v.label, "")));
    g.tracers?.forEach((t, i) => checkSources(`${at}.tracers[${i}]`, t.sourceIds, t.readout === "none" ? "" : "x = 0"));
    g.surfaces?.forEach((s, i) => checkSources(`${at}.surfaces[${i}]`, s.sourceIds, lbl(s.label, s.expr)));
  });
  const seen = new Set<string>();
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    if (!chapterIds.has(c.chapter)) issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    if (seen.has(c.chapter)) issues.push({ path, message: `duplicate chapter "${c.chapter}"` });
    seen.add(c.chapter);
  });
  const paramIds = new Set((data.graphs ?? []).flatMap((g) => (g.params ?? []).map((q) => q.id)));
  scene.chapters.forEach((ch, i) =>
    ch.activity?.test.params?.forEach((id, k) => {
      if (!paramIds.has(id)) issues.push({ path: `chapters[${i}].activity.test.params[${k}]`, message: `"${id}" is not a graph parameter` });
    }),
  );
  issues.push(...checkConceptMath(data));
  return issues;
}
