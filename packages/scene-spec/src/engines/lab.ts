// LabData: owned by the `lab` engine (Laboratorio: physics experiments with sliders, decision D16).
//
// Each chapter puts ONE experiment on a lab bench: the engine builds the apparatus procedurally,
// runs the physics (closed form, or a fixed-step integration cached per parameter set) and draws
// measurement overlays (energy test tubes, live formula board, timer, ruler, arrows, stroboscope).
// Nothing is topic-specific beyond the experiment `kind`; an LLM fills physical values only.
//
// Units: SI everywhere (m, kg, s, N, J, W, V, Ω, kg/m³), except angles in degrees, volume in
// litres and temperature in °C. The engine chooses the drawing scale per chapter so the apparatus
// fits the bench for every slider position; rulers and the board always show real units.
//
// Time model: before the first run the apparatus waits in its start state. Each `runs` entry
// restarts the experiment at chapter time `at`; physical time = (t - at) * speed, so `speed` < 1
// is slow motion (falls last well under a second) and > 1 fast-forward (heating takes minutes).
// Sliders (activity.test.params -> `params`) change the variables live; update stays pure.
//
// Scene layout (scene units, y up, main view from +z): bench top at y = 0, x -8..8.4,
// apparatus in x -7..3, energy tubes at x 4..7.6, formula board above them (y 4.6..7.4).
//
// Entity anchors (pins and camera targets), all accept `offset`:
// - { entity: "body" }                 the moving object (ball, bob, cart, block, cube); index 1 =
//                                      the second ball of a "fall" with mass2; lever: 0 = left
//                                      weight, 1 = right weight
// - { entity: "part", part: "<name>" } a named apparatus point, see LAB_PARTS (index: bulb number)
// - { entity: "gauge", part: "energy" | "Ep" | "Ec" | "Q" | "board" | "timer" }
// Vessels: body = the water surface of the container poured into (lab), the tank surface (tower) or
// the boat (canal); parts per layout in LAB_VESSEL_PARTS.
import { z } from "zod";
import { Id, type Anchor, type SceneBase } from "../common.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LAB_KINDS = ["fall", "projectile", "pendulum", "spring", "ramp", "lever", "buoyancy", "circuit", "heat", "vessels"] as const;
export type LabKind = (typeof LAB_KINDS)[number];

export interface LabVarInfo {
  min: number;
  max: number;
  unit: string;
  /** Italian name, for slider labels and the guide. */
  it: string;
  optional?: true;
}

const v = (min: number, max: number, unit: string, it: string): LabVarInfo => ({ min, max, unit, it });
/** An optional variable (the setup may omit it; the engine has a default). */
const o = (min: number, max: number, unit: string, it: string): LabVarInfo & { optional: true } => ({ min, max, unit, it, optional: true });
const G = o(0.5, 30, "m/s²", "accelerazione di gravità (default 9,81)");
const MASS = v(0.01, 100, "kg", "massa");

/** Numeric variables of each experiment kind (hard limits). Sliders bind to these by name. */
export const LAB_VARS = {
  fall: { height: v(0.1, 50, "m", "altezza di partenza"), mass: MASS, mass2: o(0.01, 100, "kg", "massa della seconda palla (due palle affiancate)"), g: G },
  projectile: {
    speed: v(0.5, 40, "m/s", "velocità di lancio"),
    angle: v(0, 90, "°", "angolo di lancio"),
    height: o(0, 20, "m", "altezza del lancio (default 0)"),
    mass: MASS,
    g: G,
  },
  pendulum: {
    length: v(0.1, 5, "m", "lunghezza del filo"),
    mass: MASS,
    angle: v(1, 80, "°", "ampiezza iniziale"),
    damping: o(0, 2, "1/s", "smorzamento (attrito dell'aria; default 0)"),
    g: G,
  },
  spring: {
    k: v(1, 2000, "N/m", "costante elastica"),
    mass: v(0.05, 20, "kg", "massa del carrello"),
    amplitude: v(0.02, 1, "m", "allungamento iniziale"),
    damping: o(0, 20, "kg/s", "smorzamento (attrito; default 0)"),
  },
  ramp: {
    angle: v(2, 70, "°", "inclinazione"),
    length: v(0.3, 10, "m", "lunghezza della rampa"),
    mass: MASS,
    friction: v(0, 1.5, "", "coefficiente d'attrito μ"),
    flat: o(0, 10, "m", "tratto piano dopo la rampa (default metà rampa)"),
    g: G,
  },
  lever: {
    massLeft: v(0, 50, "kg", "massa a sinistra"),
    armLeft: v(0.05, 3, "m", "braccio sinistro"),
    massRight: v(0, 50, "kg", "massa a destra"),
    armRight: v(0.05, 3, "m", "braccio destro"),
    g: G,
  },
  buoyancy: {
    density: v(10, 22000, "kg/m³", "densità dell'oggetto"),
    fluidDensity: v(500, 14000, "kg/m³", "densità del liquido (acqua 1000)"),
    volume: v(0.05, 10, "L", "volume dell'oggetto (cubo)"),
    g: G,
  },
  circuit: {
    voltage: v(0, 24, "V", "tensione della pila"),
    r1: v(0.5, 1000, "Ω", "resistenza della lampadina 1"),
    r2: o(0.5, 1000, "Ω", "resistenza della lampadina 2"),
    r3: o(0.5, 1000, "Ω", "resistenza della lampadina 3"),
  },
  heat: {
    power: v(50, 5000, "W", "potenza del fornello"),
    mass: v(0.05, 5, "kg", "massa d'acqua (o ghiaccio)"),
    startTemp: v(-30, 100, "°C", "temperatura iniziale (sotto 0 = ghiaccio)"),
  },
  vessels: {
    volume: o(0, 3, "L", "acqua versata in un recipiente (layout lab; default 0)"),
    count: o(2, 4, "", "numero di recipienti collegati (layout lab, intero; default tutte le forme)"),
    level: o(0.02, 0.2, "m", "livello iniziale comune (layout lab; default 0,08)"),
    tankHeight: o(3, 60, "m", "livello dell'acqua nel serbatoio sopraelevato (layout tower; default 20)"),
    buildingHeight: o(3, 80, "m", "altezza del rubinetto più alto del palazzo (layout tower; default 15)"),
    depth: o(1, 25, "m", "profondità del fondo del canale sotto il livello del mare (layout canal; default 10)"),
    draft: o(0.5, 20, "m", "pescaggio della nave (layout canal; default 6)"),
    fluidDensity: o(500, 14000, "kg/m³", "densità del liquido (acqua 1000, default)"),
    g: G,
  },
} as const satisfies Record<LabKind, Record<string, LabVarInfo>>;

/** Values the engine uses for vessels variables the setup leaves out (count: the number of shapes). */
export const VESSEL_DEFAULTS = { volume: 0, level: 0.08, tankHeight: 20, buildingHeight: 15, depth: 10, draft: 6, fluidDensity: 1000 } as const;

/** Overlays; LAB_SHOW_KINDS says which kinds support each one. */
export const LAB_SHOWS = ["energy", "board", "timer", "ruler", "velocity", "forces", "strobe", "graph", "level", "pressure"] as const;
export type LabShowItem = (typeof LAB_SHOWS)[number];
const MOTION: LabKind[] = ["fall", "projectile", "pendulum", "spring", "ramp"];
export const LAB_SHOW_KINDS: Record<LabShowItem, readonly LabKind[]> = {
  energy: MOTION,
  board: LAB_KINDS,
  timer: LAB_KINDS,
  ruler: ["fall", "projectile", "pendulum", "spring", "ramp", "vessels"],
  velocity: MOTION,
  forces: ["fall", "spring", "ramp", "lever", "buoyancy"],
  strobe: ["fall", "projectile", "ramp"],
  graph: ["heat"],
  level: ["vessels"],
  pressure: ["vessels"],
};

/** Named apparatus points per kind ({ entity: "part", part }). */
export const LAB_PARTS: Record<LabKind, readonly string[]> = {
  fall: ["stand", "release", "floor", "ruler"],
  projectile: ["launcher", "apex", "landing", "ground"],
  pendulum: ["pivot", "string", "rest", "stand"],
  spring: ["wall", "spring", "equilibrium", "track"],
  ramp: ["top", "slope", "bottom", "flat", "end"],
  lever: ["fulcrum", "beam", "left", "right"],
  buoyancy: ["beaker", "water", "surface", "bottom"],
  circuit: ["battery", "switch", "bulb", "ammeter", "wire"],
  heat: ["beaker", "heater", "thermometer", "molecules", "graph"],
  vessels: ["container", "pipe", "pour", "level", "tank", "tower", "house", "building", "tap", "sea", "channel", "gate", "boat"],
};
/** Vessels parts that exist in each layout (container/tap/sea/gate take an index). */
export const LAB_VESSEL_PARTS = {
  lab: ["container", "pipe", "pour", "level"],
  tower: ["tank", "tower", "house", "building", "tap", "pipe", "level"],
  canal: ["sea", "channel", "gate", "boat", "level"],
} as const;
export const LAB_GAUGES = ["energy", "Ep", "Ec", "Q", "board", "timer"] as const;

/** Numeric zod fields from LAB_VARS. */
function numbers<K extends LabKind>(kind: K) {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, info] of Object.entries(LAB_VARS[kind]) as [string, LabVarInfo][]) {
    const n = z.number().min(info.min).max(info.max);
    shape[name] = info.optional ? n.optional() : n;
  }
  return shape as { [P in keyof (typeof LAB_VARS)[K]]: (typeof LAB_VARS)[K][P] extends { optional: true } ? z.ZodOptional<z.ZodNumber> : z.ZodNumber };
}

export const LabSetup = z.discriminatedUnion("kind", [
  /** Free fall from rest (no air). With mass2: two balls dropped side by side. */
  z.object({ kind: z.literal("fall"), ...numbers("fall") }).strict(),
  /** Oblique launch from a launcher of `height` (no air). */
  z.object({ kind: z.literal("projectile"), ...numbers("projectile") }).strict(),
  /** Simple pendulum released from `angle` (exact, not small-angle, motion). */
  z.object({ kind: z.literal("pendulum"), ...numbers("pendulum") }).strict(),
  /** Cart on a horizontal track tied to a spring, released stretched by `amplitude`. */
  z.object({ kind: z.literal("spring"), ...numbers("spring") }).strict(),
  /**
   * Block released at the top of an inclined plane, sliding with kinetic friction μ.
   * track "ramp" (default): ramp + flat with an end stop; "valley": ramp + flat + a second
   * ramp going up again (Galileo's double ramp: without friction it climbs back to the same height).
   */
  z.object({ kind: z.literal("ramp"), ...numbers("ramp"), track: z.enum(["ramp", "valley"]).optional() }).strict(),
  /** Beam on a central fulcrum with a hanging mass on each side. */
  z.object({ kind: z.literal("lever"), ...numbers("lever") }).strict(),
  /** Cube of given density released at the surface of a liquid in a beaker (Archimedes). */
  z.object({ kind: z.literal("buoyancy"), ...numbers("buoyancy") }).strict(),
  /** Battery, switch, ammeter and 1–3 bulbs (r1..r3) in series or in parallel. The switch closes at each run. */
  z.object({ kind: z.literal("circuit"), ...numbers("circuit"), layout: z.enum(["series", "parallel"]) }).strict(),
  /** Water (ice below 0 °C) heated at constant power until it has all boiled away. */
  z.object({ kind: z.literal("heat"), ...numbers("heat") }).strict(),
  /**
   * Communicating vessels joined at the bottom: the levels settle at one common height and p = ρ·g·h.
   * layout "lab": containers of different shapes on a bench (`shapes`, first `count` used), `volume` litres
   * poured into container `into` (default the last) at each run; "tower": an elevated tank piped to a house
   * and a building, the risers fill up to the tank level and taps above it stay dry; "canal": two seas and a
   * dry channel, the gates open at each run, the channel fills to sea level and a boat sails in if deep enough.
   */
  z
    .object({
      kind: z.literal("vessels"),
      layout: z.enum(["lab", "tower", "canal"]),
      shapes: z.array(z.enum(["beaker", "cylinder", "tube", "flask"])).min(2).max(4).optional(),
      into: z.number().int().min(0).max(3).optional(),
      ...numbers("vessels"),
    })
    .strict(),
]);
export type LabSetup = z.infer<typeof LabSetup>;

/** A "Prova tu" slider bound to a setup variable. */
export const LabParam = z
  .object({
    id: Id,
    /** Name of the setup variable (see LAB_VARS for the kind). */
    var: z.string().min(1),
    /** Italian label with unit, e.g. "Altezza (m)". */
    label: z.string().min(1),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
  })
  .strict();
export type LabParam = z.infer<typeof LabParam>;

export const LabRun = z
  .object({
    at: z.number().min(0),
    /** Physical seconds per chapter second (default 1). */
    speed: z.number().min(0.02).max(500).optional(),
  })
  .strict();
export type LabRun = z.infer<typeof LabRun>;

export const LabShow = z
  .object({
    item: z.enum(LAB_SHOWS),
    /** Appears at; omitted = from t = 0. */
    at: z.number().min(0).optional(),
    /** Gone at; omitted = until the chapter ends. */
    until: z.number().min(0).optional(),
  })
  .strict();
export type LabShow = z.infer<typeof LabShow>;

export const LabChapter = z
  .object({
    chapter: Id,
    setup: LabSetup,
    params: z.array(LabParam).optional(),
    runs: z.array(LabRun),
    show: z.array(LabShow).optional(),
    /** Colour of the moving body (default per kind). */
    color: Color.optional(),
  })
  .strict();
export type LabChapter = z.infer<typeof LabChapter>;

/** Variable names of a kind, and whether the setup gives a value for it. */
export function labVars(kind: LabKind): Record<string, LabVarInfo> {
  return LAB_VARS[kind];
}

export const LabData = z
  .object({
    /** Background colour (default: warm paper). */
    background: Color.optional(),
    chapters: z.array(LabChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const seen = new Set<string>();
    d.chapters.forEach((c, i) => {
      if (seen.has(c.chapter)) add(["chapters", i, "chapter"], `duplicate chapter "${c.chapter}"`);
      seen.add(c.chapter);
      const vars = labVars(c.setup.kind);
      const setup = c.setup as Record<string, unknown>;
      const ids = new Set<string>();
      c.params?.forEach((p, k) => {
        const path = ["chapters", i, "params", k];
        if (ids.has(p.id)) add(path, `duplicate param id "${p.id}"`);
        ids.add(p.id);
        const info = vars[p.var];
        if (!info) return add(path, `"${p.var}" is not a variable of "${c.setup.kind}" (use ${Object.keys(vars).join(", ")})`);
        if (p.min >= p.max) add(path, "min must be below max");
        if (p.min < info.min || p.max > info.max) add(path, `"${p.var}" range must stay within ${info.min}..${info.max} ${info.unit}`);
        let value = setup[p.var];
        // Vessels variables have documented defaults: a slider may start from them.
        if (value === undefined && c.setup.kind === "vessels")
          value = p.var === "count" ? (c.setup.shapes?.length ?? 4) : (VESSEL_DEFAULTS as Record<string, number>)[p.var];
        if (typeof value !== "number") add(path, `the setup must give a value for "${p.var}"`);
        else if (value < p.min || value > p.max) add(path, `setup ${p.var} = ${value} is outside the slider range`);
      });
      if (c.setup.kind === "circuit" && c.setup.r3 !== undefined && c.setup.r2 === undefined) add(["chapters", i, "setup"], "give r2 before r3");
      if (c.setup.kind === "vessels") {
        const s = c.setup;
        const n = s.shapes?.length ?? 4;
        const counts = [s.count, ...(c.params ?? []).filter((p) => p.var === "count").flatMap((p) => [p.min, p.max])].filter((x): x is number => x !== undefined);
        for (const k of counts) {
          if (!Number.isInteger(k)) add(["chapters", i, "setup", "count"], "count must be a whole number");
          if (k > n) add(["chapters", i, "setup", "count"], `count ${k} is more than the ${n} shapes`);
        }
        // With fewer containers (count slider) the water goes into the last one.
        if (s.into !== undefined && s.into >= n) add(["chapters", i, "setup", "into"], "into must be one of the shapes");
        const layoutVars: Record<string, readonly string[]> = { lab: ["volume", "count", "level"], tower: ["tankHeight", "buildingHeight"], canal: ["depth", "draft"] };
        for (const p of c.params ?? []) {
          const other = Object.entries(layoutVars).find(([l, vs]) => l !== s.layout && vs.includes(p.var));
          if (other) add(["chapters", i, "params"], `"${p.var}" has no effect in layout "${s.layout}" (it is for "${other[0]}")`);
        }
      }
      let prev = -1;
      c.runs.forEach((r, k) => {
        if (r.at <= prev) add(["chapters", i, "runs", k], "runs must be in increasing order of `at`");
        prev = r.at;
      });
      c.show?.forEach((s, k) => {
        const path = ["chapters", i, "show", k];
        if (!LAB_SHOW_KINDS[s.item].includes(c.setup.kind)) add(path, `"${s.item}" is not available for "${c.setup.kind}"`);
        if (s.until !== undefined && s.until <= (s.at ?? 0)) add(path, "`until` must come after `at`");
      });
    });
  });
export type LabData = z.infer<typeof LabData>;

type Issue = { path: string; message: string };

/** Checks a lab entity anchor against the experiment of its chapter. */
function checkAnchor(a: Anchor, entry: LabChapter | undefined, path: string, issues: Issue[]): void {
  if (!("entity" in a)) return;
  const add = (message: string): void => void issues.push({ path, message });
  if (!entry) return add(`lab anchor in a chapter without a lab entry`);
  const kind = entry.setup.kind;
  if (a.entity === "body") {
    const max = (kind === "fall" && entry.setup.mass2 !== undefined) || kind === "lever" ? 1 : 0;
    if ((a.index ?? 0) > max) add(`body index ${a.index} does not exist`);
  } else if (a.entity === "part" && entry.setup.kind === "vessels") {
    const parts: readonly string[] = LAB_VESSEL_PARTS[entry.setup.layout];
    if (!a.part || !parts.includes(a.part)) add(`unknown part "${a.part}" for vessels layout "${entry.setup.layout}" (use ${parts.join(", ")})`);
  } else if (a.entity === "part") {
    if (!a.part || !LAB_PARTS[kind].includes(a.part)) add(`unknown part "${a.part}" for "${kind}" (use ${LAB_PARTS[kind].join(", ")})`);
    if (kind === "circuit" && a.part === "bulb" && entry.setup.kind === "circuit") {
      const bulbs = entry.setup.r3 !== undefined ? 3 : entry.setup.r2 !== undefined ? 2 : 1;
      if ((a.index ?? 0) >= bulbs) add(`bulb index ${a.index} does not exist (${bulbs} bulbs)`);
    }
  } else if (a.entity === "gauge") {
    if (!a.part || !(LAB_GAUGES as readonly string[]).includes(a.part)) add(`unknown gauge "${a.part}" (use ${LAB_GAUGES.join(", ")})`);
  } else add(`unknown lab entity "${a.entity}" (use body, part, gauge)`);
}

/**
 * Cross-checks against the rest of the scene: chapter ids, times inside the chapter, slider ids
 * used by activities, and lab anchors in pins and camera keys. Same Issue shape as checkSemantics.
 */
export function checkLabData(data: LabData, scene: Pick<z.infer<typeof SceneBase>, "chapters">): Issue[] {
  const issues: Issue[] = [];
  const byChapter = new Map(data.chapters.map((c) => [c.chapter, c]));
  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (duration === undefined) return void issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    c.runs.forEach((r, k) => r.at >= duration && issues.push({ path: `${path}.runs[${k}]`, message: "run starts after the chapter ends" }));
    c.show?.forEach((s, k) => {
      if ((s.at ?? 0) >= duration) issues.push({ path: `${path}.show[${k}]`, message: `"${s.item}" appears after the chapter ends` });
    });
  });
  scene.chapters.forEach((ch, c) => {
    const entry = byChapter.get(ch.id);
    const at = `chapters[${c}]`;
    if (!entry) issues.push({ path: at, message: `chapter "${ch.id}" has no lab entry (empty bench)` });
    for (const id of ch.activity?.test.params ?? [])
      if (!entry?.params?.some((p) => p.id === id)) issues.push({ path: `${at}.activity.test`, message: `unknown lab param "${id}"` });
    ch.pins.forEach((p, i) => checkAnchor(p.anchor, entry, `${at}.pins[${i}].anchor`, issues));
    ch.camera.forEach((k, i) => checkAnchor(k.target, entry, `${at}.camera[${i}].target`, issues));
  });
  return issues;
}
