// SolidData: owned by the `solid` engine (Geometria solida, decision D16/D18).
//
// Each chapter puts 1–4 solids side by side on a drawing mat. The engine builds them procedurally
// from their real dimensions and animates declarative "acts": nets that unfold and fold back,
// plane figures that revolve around an axis and sweep the solid, section planes, liquid poured
// from one solid into another (volume comparison), counting of faces/edges/vertices (Euler),
// scaling and turning. Overlays: dimension lines with labels, a formula board with live values,
// the F/V/S panel and a unit grid. An LLM fills shapes, dimensions, times and sliders only.
//
// Units: lengths in `unit` (default "cm"), angles in degrees, times in chapter seconds.
// The engine picks one drawing scale per chapter so every solid fits for every slider position
// (and every scale factor k): sizes stay comparable inside a chapter.
//
// Scene layout (scene units, y up, main view from +z): the mat top is y = 0, solids stand on it in
// a row along x centred on x = 0 (first solid on the left), the tallest about 4.2 units high and
// the row at most about 11 units wide; boards float behind the solids. Nets unfold flat on the mat
// around the solid's base face.
//
// Entity anchors (pins and camera targets); `part` is a solid id (omitted = the first solid of the
// chapter), all accept `offset`:
// - { entity: "solid", part }                top centre of the solid, wherever it is (pour, scale)
// - { entity: "face" | "edge" | "vertex", part, index }   an element; index range in SOLID_COUNTS.
//     Order: polyhedra list faces/edges/vertices from the bottom up, each level starting at the
//     front (+z) and going counter-clockwise seen from above; face 0 is the base on the mat and,
//     when the solid has a parallel top face, face 1 is that top. Curved solids: faces 0 = base,
//     1 = lateral surface (front point), 2 = top base; edges = rims (bottom first); cone vertex 0 = apex.
// - { entity: "dim", part: "<solidId>.<dim>" }   label of a dimension line (dims of SOLID_LABEL_DIMS)
// - { entity: "section" | "liquid" | "figure" | "net" | "board" | "elements", part }
//     section polygon centre, liquid surface, revolving plane figure, net centre, panels.
import { z } from "zod";
import { Id, type Anchor, type SceneBase } from "../common.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const SOLID_SHAPES = [
  "cube",
  "cuboid",
  "prism",
  "pyramid",
  "cylinder",
  "cone",
  "sphere",
  "frustum",
  "tetrahedron",
  "octahedron",
  "dodecahedron",
  "icosahedron",
] as const;
export type SolidShape = (typeof SOLID_SHAPES)[number];

/** Length dimensions a solid can have; "k" (scale factor) is also a slider target. */
export const SOLID_DIM_NAMES = ["a", "b", "c", "l", "h", "r", "r2"] as const;
export type SolidDim = (typeof SOLID_DIM_NAMES)[number];

/**
 * Dimensions each shape needs (all of them, no others):
 * cube a (edge); cuboid a (length, x), b (width, depth), c (height); prism/pyramid l (base side of a
 * regular polygon with `sides` sides), h (height); cylinder/cone r, h; sphere r; frustum (truncated
 * cone) r (bottom radius), r2 (top radius), h; Platonic solids a (edge).
 */
export const SOLID_DIMS: Record<SolidShape, readonly SolidDim[]> = {
  cube: ["a"],
  cuboid: ["a", "b", "c"],
  prism: ["l", "h"],
  pyramid: ["l", "h"],
  cylinder: ["r", "h"],
  cone: ["r", "h"],
  sphere: ["r"],
  frustum: ["r", "r2", "h"],
  tetrahedron: ["a"],
  octahedron: ["a"],
  dodecahedron: ["a"],
  icosahedron: ["a"],
};

/** Dimension lines drawn by the "dims" overlay ("ap" = apothem, computed). */
export const SOLID_LABEL_DIMS: Record<SolidShape, readonly string[]> = {
  cube: ["a"],
  cuboid: ["a", "b", "c"],
  prism: ["l", "h"],
  pyramid: ["l", "h", "ap"],
  cylinder: ["r", "h"],
  cone: ["r", "h", "ap"],
  sphere: ["r"],
  frustum: ["r", "r2", "h"],
  tetrahedron: ["a"],
  octahedron: ["a"],
  dodecahedron: ["a"],
  icosahedron: ["a"],
};

export const SOLID_POLYHEDRA: readonly SolidShape[] = ["cube", "cuboid", "prism", "pyramid", "tetrahedron", "octahedron", "dodecahedron", "icosahedron"];
/** Solids of revolution: the "revolve" act shows their generating plane figure turning around the axis. */
export const SOLID_REVOLVABLE: readonly SolidShape[] = ["cylinder", "cone", "sphere", "frustum"];
/** Shapes with a net ("unfold" / "fold"): polyhedra, cylinder (rectangle + 2 circles), cone (sector + circle). */
export const SOLID_UNFOLDABLE: readonly SolidShape[] = [...SOLID_POLYHEDRA, "cylinder", "cone"];
/** Straight-walled shapes that can be filled with liquid (level proportional to volume). */
export const SOLID_CONTAINERS: readonly SolidShape[] = ["cube", "cuboid", "prism", "cylinder"];
/** Shapes that can pour their content into a container. */
export const SOLID_POURERS: readonly SolidShape[] = ["cube", "cuboid", "prism", "pyramid", "cylinder", "cone"];
/** Shapes that get the unit grid ("units" overlay): one square per unit of length. */
export const SOLID_GRIDDED: readonly SolidShape[] = ["cube", "cuboid"];

/** Italian names (default labels). */
export const SOLID_NAMES: Record<SolidShape, string> = {
  cube: "Cubo",
  cuboid: "Parallelepipedo",
  prism: "Prisma",
  pyramid: "Piramide",
  cylinder: "Cilindro",
  cone: "Cono",
  sphere: "Sfera",
  frustum: "Tronco di cono",
  tetrahedron: "Tetraedro",
  octahedron: "Ottaedro",
  dodecahedron: "Dodecaedro",
  icosahedron: "Icosaedro",
};

/** Number of faces, edges and vertices (anchor index ranges; polyhedra satisfy F + V − E = 2). */
export function solidCounts(shape: SolidShape, sides = 4): { faces: number; edges: number; vertices: number } {
  const n = sides;
  switch (shape) {
    case "cube":
    case "cuboid":
      return { faces: 6, edges: 12, vertices: 8 };
    case "prism":
      return { faces: n + 2, edges: 3 * n, vertices: 2 * n };
    case "pyramid":
      return { faces: n + 1, edges: 2 * n, vertices: n + 1 };
    case "tetrahedron":
      return { faces: 4, edges: 6, vertices: 4 };
    case "octahedron":
      return { faces: 8, edges: 12, vertices: 6 };
    case "dodecahedron":
      return { faces: 12, edges: 30, vertices: 20 };
    case "icosahedron":
      return { faces: 20, edges: 30, vertices: 12 };
    case "cylinder":
    case "frustum":
      return { faces: 3, edges: 2, vertices: 0 };
    case "cone":
      return { faces: 2, edges: 1, vertices: 1 };
    case "sphere":
      return { faces: 1, edges: 0, vertices: 0 };
  }
}

/** Hard limits. */
export const SOLID_LENGTH = { min: 0.1, max: 100 } as const;
export const SOLID_SCALE = { min: 0.1, max: 10 } as const;

const Len = z.number().min(SOLID_LENGTH.min).max(SOLID_LENGTH.max);
const Time = z.number().min(0);
/** Duration of an act in chapter seconds; omitted = the act's default (see SOLID_ACT_DEFAULTS). */
const Dur = z.number().min(0.1).max(60).optional();

export const SolidItem = z
  .object({
    /** Unique in the chapter; acts, overlays, sliders and anchors refer to it. */
    id: Id,
    shape: z.enum(SOLID_SHAPES),
    dims: z.object({ a: Len.optional(), b: Len.optional(), c: Len.optional(), l: Len.optional(), h: Len.optional(), r: Len.optional(), r2: Len.optional() }).strict(),
    /** Sides of the regular base polygon (prism, pyramid), 3–8; default 4. */
    sides: z.number().int().min(3).max(8).optional(),
    /** Italian name shown on the board (default from SOLID_NAMES). */
    name: z.string().min(1).optional(),
    color: Color.optional(),
    /** Scale factor k applied to every dimension (default 1); a "k" slider or a "scale" act changes it. */
    scale: z.number().min(SOLID_SCALE.min).max(SOLID_SCALE.max).optional(),
    /** Chapter time at which the solid pops up (default 0 = from the start). */
    appear: Time.optional(),
  })
  .strict();
export type SolidItem = z.infer<typeof SolidItem>;

const act = <T extends string, S extends z.ZodRawShape>(name: T, shape: S) =>
  z.object({ do: z.literal(name), solid: Id, at: Time, dur: Dur, ...shape }).strict();

export const SolidAct = z.discriminatedUnion("do", [
  /** Opens the net flat on the mat (faces hinge around their shared edges). */
  act("unfold", {}),
  /** Folds the net back into the solid. */
  act("fold", {}),
  /** Before the first revolve only the plane figure and the axis are shown; the figure turns 360° and sweeps the solid. */
  act("revolve", {}),
  /**
   * A plane cuts the solid at height `to` (0 = base, 1 = top) and shows the section; the plane slides
   * from the previous section height (or `to`) during the act and stays until `until` (default: chapter end).
   * `tilt` 0 = horizontal, 90 = vertical through the axis facing the viewer.
   */
  act("section", { to: z.number().min(0).max(1), tilt: z.number().min(0).max(90).optional(), until: Time.optional() }),
  /**
   * Fills the (glass) solid with liquid. With `from`: the other solid, full of liquid, moves over it,
   * turns upside down and pours all its volume (the level rises by V_from / V_solid). Without `from`:
   * the level goes to `level` (volume fraction 0..1).
   */
  act("fill", { from: Id.optional(), level: z.number().min(0).max(1).optional() }),
  /** Lights the faces, edges or vertices one by one with a running counter. */
  act("count", { what: z.enum(["faces", "edges", "vertices"]) }),
  /** Changes the scale factor k to `k` during the act. */
  act("scale", { k: z.number().min(SOLID_SCALE.min).max(SOLID_SCALE.max) }),
  /** Turns the solid around its vertical axis by `turns` (default 1, negative = clockwise). */
  act("spin", { turns: z.number().min(-4).max(4).optional() }),
]);
export type SolidAct = z.infer<typeof SolidAct>;

/** Default act durations (seconds); "count" lasts 0.6 s per element by default. */
export const SOLID_ACT_DEFAULTS = { unfold: 3, fold: 3, revolve: 4, section: 2, fill: 3, pour: 6, count: 0.6, scale: 2, spin: 4 } as const;

export const SOLID_SHOWS = ["dims", "board", "elements", "units"] as const;
export type SolidShowItem = (typeof SOLID_SHOWS)[number];
export const SOLID_FORMULAS = ["V", "A", "Al", "Ab"] as const;
export type SolidFormula = (typeof SOLID_FORMULAS)[number];

export const SolidShow = z
  .object({
    /**
     * dims: dimension lines with labels ("r = 2 cm"); board: formulas with live values;
     * elements: faces/vertices/edges counts and Euler's formula (polyhedra); units: one-unit grid (cube, cuboid).
     */
    item: z.enum(SOLID_SHOWS),
    /** The solid it belongs to; omitted = every solid it applies to. */
    solid: Id.optional(),
    at: Time.optional(),
    until: Time.optional(),
    /** board: which measures (default ["V", "A"]); V volume, A total area, Al lateral area, Ab base area. */
    formulas: z.array(z.enum(SOLID_FORMULAS)).min(1).max(4).optional(),
    /** board: also show the ratios A : A₀ and V : V₀ against this other solid (scaling, comparisons). */
    compare: Id.optional(),
  })
  .strict();
export type SolidShow = z.infer<typeof SolidShow>;

/** A "Prova tu" slider bound to one dimension (or the scale factor "k") of one or more solids. */
export const SolidParam = z
  .object({
    /** Unique in the whole scene. */
    id: Id,
    dim: z.enum([...SOLID_DIM_NAMES, "k"]),
    /** Solids it drives together (e.g. a cylinder and a cone with the same r keep V_cone = V_cyl / 3). */
    solids: z.array(Id).min(1),
    /** Italian label with unit, e.g. "Raggio r (cm)". */
    label: z.string().min(1),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
  })
  .strict();
export type SolidParam = z.infer<typeof SolidParam>;

export const SolidChapter = z
  .object({
    chapter: Id,
    solids: z.array(SolidItem).min(1).max(4),
    acts: z.array(SolidAct).optional(),
    params: z.array(SolidParam).optional(),
    show: z.array(SolidShow).optional(),
  })
  .strict();
export type SolidChapter = z.infer<typeof SolidChapter>;

export const SolidData = z
  .object({
    unit: z.enum(["mm", "cm", "dm", "m"]).optional(),
    /** Background colour (default: light paper). */
    background: Color.optional(),
    chapters: z.array(SolidChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const seenChapters = new Set<string>();
    const paramIds = new Set<string>();
    d.chapters.forEach((c, i) => {
      const at = ["chapters", i];
      if (seenChapters.has(c.chapter)) add([...at, "chapter"], `duplicate chapter "${c.chapter}"`);
      seenChapters.add(c.chapter);
      const solids = new Map<string, SolidItem>();
      c.solids.forEach((s, k) => {
        const p = [...at, "solids", k];
        if (solids.has(s.id)) add(p, `duplicate solid id "${s.id}"`);
        solids.set(s.id, s);
        const need = SOLID_DIMS[s.shape];
        for (const dim of need) if (s.dims[dim] === undefined) add([...p, "dims"], `${s.shape} needs "${dim}" (${need.join(", ")})`);
        for (const dim of Object.keys(s.dims)) if (!need.includes(dim as SolidDim)) add([...p, "dims"], `${s.shape} has no "${dim}" (use ${need.join(", ")})`);
        if (s.sides !== undefined && s.shape !== "prism" && s.shape !== "pyramid") add([...p, "sides"], "`sides` is only for prism and pyramid");
        if (s.shape === "frustum" && s.dims.r !== undefined && s.dims.r2 !== undefined && s.dims.r2 >= s.dims.r) add([...p, "dims"], "frustum: r2 (top) must be smaller than r (bottom)");
      });
      const shapeOf = (id: string) => solids.get(id)?.shape;
      c.acts?.forEach((a, k) => {
        const p = [...at, "acts", k];
        const shape = shapeOf(a.solid);
        if (!shape) return add(p, `unknown solid "${a.solid}"`);
        const allowed = (list: readonly SolidShape[], what: string) => list.includes(shape) || add(p, `"${a.do}" needs ${what}, not ${shape} (${list.join(", ")})`);
        if (a.do === "unfold" || a.do === "fold") allowed(SOLID_UNFOLDABLE, "a solid with a net");
        if (a.do === "revolve") allowed(SOLID_REVOLVABLE, "a solid of revolution");
        if (a.do === "count") allowed(SOLID_POLYHEDRA, "a polyhedron");
        if (a.do === "section" && a.until !== undefined && a.until <= a.at) add(p, "`until` must come after `at`");
        if (a.do === "fill") {
          allowed(SOLID_CONTAINERS, "a straight-walled container");
          if ((a.from === undefined) === (a.level === undefined)) add(p, "fill needs either `from` (pour) or `level`");
          if (a.from !== undefined) {
            const from = shapeOf(a.from);
            if (!from) add(p, `unknown solid "${a.from}"`);
            else if (a.from === a.solid) add(p, "a solid cannot pour into itself");
            else if (!SOLID_POURERS.includes(from)) add(p, `${from} cannot pour (use ${SOLID_POURERS.join(", ")})`);
          }
        }
      });
      c.show?.forEach((s, k) => {
        const p = [...at, "show", k];
        if (s.until !== undefined && s.until <= (s.at ?? 0)) add(p, "`until` must come after `at`");
        if ((s.formulas || s.compare) && s.item !== "board") add(p, "`formulas` and `compare` are only for the board");
        if (s.compare !== undefined && !solids.has(s.compare)) add(p, `unknown solid "${s.compare}"`);
        if (s.solid === undefined) return;
        const shape = shapeOf(s.solid);
        if (!shape) return add(p, `unknown solid "${s.solid}"`);
        if (s.item === "elements" && !SOLID_POLYHEDRA.includes(shape)) add(p, `"elements" is only for polyhedra, not ${shape}`);
        if (s.item === "units" && !SOLID_GRIDDED.includes(shape)) add(p, `"units" is only for ${SOLID_GRIDDED.join(", ")}`);
        if (s.compare === s.solid) add(p, "a solid cannot be compared with itself");
      });
      c.params?.forEach((q, k) => {
        const p = [...at, "params", k];
        if (paramIds.has(q.id)) add(p, `duplicate param id "${q.id}"`);
        paramIds.add(q.id);
        if (q.min >= q.max) add(p, "min must be below max");
        const lim = q.dim === "k" ? SOLID_SCALE : SOLID_LENGTH;
        if (q.min < lim.min || q.max > lim.max) add(p, `"${q.dim}" range must stay within ${lim.min}..${lim.max}`);
        for (const id of q.solids) {
          const s = solids.get(id);
          if (!s) {
            add(p, `unknown solid "${id}"`);
            continue;
          }
          const value = q.dim === "k" ? (s.scale ?? 1) : s.dims[q.dim];
          if (value === undefined) add(p, `${s.shape} "${id}" has no "${q.dim}" (use ${SOLID_DIMS[s.shape].join(", ")} or k)`);
          else if (value < q.min || value > q.max) add(p, `"${id}" ${q.dim} = ${value} is outside the slider range`);
        }
      });
    });
  });
export type SolidData = z.infer<typeof SolidData>;

type Issue = { path: string; message: string };

export const SOLID_ENTITIES = ["solid", "face", "edge", "vertex", "dim", "section", "liquid", "figure", "net", "board", "elements"] as const;

/** Splits a "dim" anchor part "<solidId>.<dim>" (the dim after the last dot). */
export function splitDimPart(part: string | undefined): { solid: string; dim: string } | null {
  const i = part?.lastIndexOf(".") ?? -1;
  if (!part || i <= 0 || i === part.length - 1) return null;
  return { solid: part.slice(0, i), dim: part.slice(i + 1) };
}

/** Checks a solid entity anchor against the solids of its chapter. */
function checkAnchor(a: Anchor, entry: SolidChapter | undefined, path: string, issues: Issue[]): void {
  if (!("entity" in a)) return;
  const add = (message: string): void => void issues.push({ path, message });
  if (!entry) return add("solid anchor in a chapter without a solid entry");
  if (!(SOLID_ENTITIES as readonly string[]).includes(a.entity)) return add(`unknown solid entity "${a.entity}" (use ${SOLID_ENTITIES.join(", ")})`);
  const byId = new Map(entry.solids.map((s) => [s.id, s]));
  if (a.entity === "dim") {
    const sp = splitDimPart(a.part);
    const s = sp && byId.get(sp.solid);
    if (!sp || !s) return add(`dim anchor needs part "<solidId>.<dim>", got "${a.part}"`);
    if (!SOLID_LABEL_DIMS[s.shape].includes(sp.dim)) add(`${s.shape} has no dimension line "${sp.dim}" (use ${SOLID_LABEL_DIMS[s.shape].join(", ")})`);
    return;
  }
  const s = a.part === undefined ? entry.solids[0] : byId.get(a.part);
  if (!s) return add(`unknown solid "${a.part}"`);
  const counts = solidCounts(s.shape, s.sides);
  const range = a.entity === "face" ? counts.faces : a.entity === "edge" ? counts.edges : a.entity === "vertex" ? counts.vertices : -1;
  if (range >= 0 && (a.index ?? 0) >= range) add(`${a.entity} index ${a.index ?? 0} does not exist (${s.shape} has ${range})`);
  if (a.entity === "elements" && !SOLID_POLYHEDRA.includes(s.shape)) add(`"elements" is only for polyhedra`);
  if (a.entity === "figure" && !SOLID_REVOLVABLE.includes(s.shape)) add(`"figure" is only for solids of revolution`);
  if (a.entity === "net" && !SOLID_UNFOLDABLE.includes(s.shape)) add(`${s.shape} has no net`);
}

/**
 * Cross-checks against the rest of the scene: chapter ids, times inside the chapter, slider ids used
 * by activities, and solid anchors in pins and camera keys. Same Issue shape as checkSemantics.
 */
export function checkSolidData(data: SolidData, scene: Pick<z.infer<typeof SceneBase>, "chapters">): Issue[] {
  const issues: Issue[] = [];
  const byChapter = new Map(data.chapters.map((c) => [c.chapter, c]));
  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (duration === undefined) return void issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    c.acts?.forEach((a, k) => a.at >= duration && issues.push({ path: `${path}.acts[${k}]`, message: `"${a.do}" starts after the chapter ends` }));
    c.show?.forEach((s, k) => (s.at ?? 0) >= duration && issues.push({ path: `${path}.show[${k}]`, message: `"${s.item}" appears after the chapter ends` }));
    c.solids.forEach((s, k) => (s.appear ?? 0) >= duration && issues.push({ path: `${path}.solids[${k}]`, message: `"${s.id}" appears after the chapter ends` }));
  });
  scene.chapters.forEach((ch, c) => {
    const entry = byChapter.get(ch.id);
    const at = `chapters[${c}]`;
    if (!entry) issues.push({ path: at, message: `chapter "${ch.id}" has no solid entry (empty mat)` });
    for (const id of ch.activity?.test.params ?? [])
      if (!entry?.params?.some((p) => p.id === id)) issues.push({ path: `${at}.activity.test`, message: `unknown solid param "${id}"` });
    ch.pins.forEach((p, i) => checkAnchor(p.anchor, entry, `${at}.pins[${i}].anchor`, issues));
    ch.camera.forEach((k, i) => checkAnchor(k.target, entry, `${at}.camera[${i}].target`, issues));
  });
  return issues;
}
