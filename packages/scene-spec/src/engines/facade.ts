// FacadeData: owned by the `facade` engine (Facciate, drawn with lines only).
//
// Each building is a stack of floors, each floor a row of bays, each bay one cell (wall, arch,
// portal, window, niche, oculus, panel, gallery). Members (pilasters, columns, piers) stand between
// the bays, a crown (pediment, attic, balustrade, gable) closes the top. The engine draws the
// facade in five views: prospetto (front elevation), assonometria (axonometric), prospettiva
// (one-point perspective with the horizon and its single vanishing point), sezione (vertical section
// through a bay) and pianta (plan, a horizontal cut at the chapter's `plan` height). It animates
// declarative "acts": drawing, highlighting, a cut through a bay, the eye moving. An LLM fills the
// grammar below, never the geometry.
//
// Units: lengths in metres, angles in degrees, times in chapter seconds. One exception: `pos` anchors
// and the `distance` of camera keys are in the engine's root units, not metres: the engine fits the
// largest building to 6 units, so one unit is roughly 2 to 20 metres. Use entity anchors instead.
//
// Scene layout (y up): the facade plane is x–y facing +z; x = 0 on the building axis, y = 0 at the
// ground, the front face of the wall at z = 0 and the body of the building towards −z. Bays that
// project (`forward`, metres) come out towards +z.
//
// Entity anchors (pins and camera targets); `part` is a building id (omitted = the chapter's
// building), a floor id or a bay id, all accept `offset`:
// - { entity: "building" }                       centre of the facade
// - { entity: "floor" | "bay", part }            centre of the floor / of the bay's front
// - { entity: "member", part: "<floorId>" }      first member of that floor
// - { entity: "vanishing-point" | "horizon" }    perspective helpers (one-point perspective: a single vanishing point, so no index)
// - { entity: "rotunda" | "dome" | "oculus" }    the rotunda's axis at the top of its wall / at the crown of the dome / in the oculus
//
// A building may have a rotunda behind its body (the Pantheon): a cylinder with niches and a dome (smooth or
// coffered, with an oculus). The plan view "pianta" cuts the building horizontally at the chapter's `plan` height.
import { z } from "zod";
import { Id, type Anchor, type SceneBase } from "../common.ts";

export const FACADE_STYLES = ["classical", "renaissance", "baroque", "temple", "romanesque"] as const;
export const FACADE_ORDERS = ["tuscan", "doric", "ionic", "corinthian", "composite"] as const;
export const FACADE_VIEWS = ["prospetto", "assonometria", "prospettiva", "sezione", "pianta"] as const;
export type FacadeViewName = (typeof FACADE_VIEWS)[number];
/** "Prova tu" sliders of the engine: the eye of the perspective view. */
export const FACADE_PARAMS = ["eye-height", "eye-x"] as const;
export const FACADE_ENTITIES = ["building", "floor", "bay", "member", "vanishing-point", "horizon", "rotunda", "dome", "oculus"] as const;

const Len = z.number().positive().max(120);
const Sill = z.number().min(0).max(120);
const Time = z.number().min(0);
const Dur = z.number().positive().max(60).optional();
const Pediment = z.enum(["triangular", "segmental"]);
const Top = z.enum(["flat", "round"]);

const cell = <T extends string, S extends z.ZodRawShape>(el: T, shape: S) => z.object({ el: z.literal(el), ...shape }).strict();

export const FacadeCell = z.discriminatedUnion("el", [
  cell("wall", {}),
  /** open = passage (default true), false = blind arch; spring = springing height (default 0.55 x floor height). */
  cell("arch", { open: z.boolean().optional(), archivolt: z.enum(["voussoirs", "moulded"]).optional(), keystone: z.boolean().optional(), spring: Sill.optional() }),
  /** splay = nested receding arches (Romanesque). */
  cell("portal", { w: Len, h: Len, top: Top.optional(), pediment: Pediment.optional(), splay: z.number().int().min(0).max(4).optional() }),
  /** sill = height above the floor; mullion = two lights (bifora). */
  cell("window", { w: Len, h: Len, sill: Sill, top: Top.optional(), mullion: z.boolean().optional(), pediment: Pediment.optional(), corbels: z.boolean().optional(), balustrade: z.boolean().optional() }),
  cell("niche", { w: Len, h: Len, sill: Sill }),
  /** y = height of the centre above the floor. */
  cell("oculus", { r: z.number().positive().max(10), y: Sill }),
  cell("panel", { w: Len, h: Len, sill: Sill }),
  /** Romanesque loggetta: small arches on colonnettes. */
  cell("gallery", { columns: z.number().int().min(2).max(12), h: Len, sill: Sill }),
]);
export type FacadeCell = z.infer<typeof FacadeCell>;

export const FacadeMember = z
  .object({
    type: z.enum(["pilaster", "half-column", "column", "pier"]),
    /** Required unless pier. */
    order: z.enum(FACADE_ORDERS).optional(),
    width: Len,
    paired: z.boolean().optional(),
    rusticated: z.boolean().optional(),
  })
  .strict();
export type FacadeMember = z.infer<typeof FacadeMember>;

export const FacadeBay = z
  .object({
    id: Id,
    /** Axis-to-axis span. */
    width: Len,
    cell: FacadeCell,
    /** Avant-corps: how far the bay projects towards +z, in metres, 0..3. */
    forward: z.number().min(0).max(3).optional(),
  })
  .strict();
export type FacadeBay = z.infer<typeof FacadeBay>;

export const FacadeFloor = z
  .object({
    id: Id,
    height: Len,
    bays: z.array(FacadeBay).min(1).max(15),
    /** Between the bays and at both ends. */
    members: FacadeMember.optional(),
    wall: z.enum(["smooth", "rusticated"]).optional(),
    /** Rustication course height (default 0.5). */
    course: Len.optional(),
    top: z.enum(["string-course", "entablature", "none"]).optional(),
    cornice: z.enum(["plain", "dentils", "modillions"]).optional(),
    portico: z.object({ depth: Len, vault: z.enum(["barrel", "segmental"]).optional() }).strict().optional(),
    /** Free-standing members in front (temple front). */
    colonnade: z.object({ depth: Len }).strict().optional(),
    /** Transition from the wider floor below. */
    shoulders: z.enum(["volutes", "slopes"]).optional(),
  })
  .strict();
export type FacadeFloor = z.infer<typeof FacadeFloor>;

export const FacadeCrown = z
  .object({
    type: z.enum(["pediment", "attic", "balustrade", "gable"]),
    shape: Pediment.optional(),
    /** First and last bay of the top floor it covers (default all). */
    bays: z.tuple([Id, Id]).optional(),
    height: Len.optional(),
    /** Roof pitch in degrees (default 22). */
    pitch: z.number().min(10).max(40).optional(),
  })
  .strict();
export type FacadeCrown = z.infer<typeof FacadeCrown>;

export const FacadeRotunda = z
  .object({
    /** Inner diameter. */
    diameter: Len,
    /** Wall thickness (default 0.14 x diameter). */
    wall: Len.optional(),
    /** Height of the cylinder wall from `level`. */
    height: Len,
    /** Where the cylinder starts (default 0 = the ground). */
    level: Sill.optional(),
    /** Distance between the back of the body and the rotunda's outer face (default 0). */
    gap: Sill.optional(),
    /** Recesses besides the entrance, alternating rectangular and semicircular, evenly spread and symmetric about the axis. */
    niches: z.number().int().min(0).max(16).optional(),
    dome: z
      .object({
        type: z.enum(["smooth", "coffered"]),
        /** [rings, coffers per ring] (Pantheon: [5, 28]). */
        coffers: z.tuple([z.number().int().min(1).max(8), z.number().int().min(8).max(40)]).optional(),
        /** Diameter of the opening at the crown; 0 or absent = closed. */
        oculus: Sill.optional(),
        /** Drum between the wall top and the springing of the dome. */
        drum: Sill.optional(),
        /** Only without an oculus. */
        lantern: z.boolean().optional(),
        /** Stepped rings on the outside of the dome's base (Pantheon: 7). */
        steps: z.number().int().min(0).max(8).optional(),
      })
      .strict(),
  })
  .strict();
export type FacadeRotunda = z.infer<typeof FacadeRotunda>;

export const FacadeBuilding = z
  .object({
    id: Id,
    /** Italian name. */
    name: z.string().min(1),
    style: z.enum(FACADE_STYLES),
    base: z.object({ height: Len, steps: z.number().int().min(0).max(8).optional() }).strict().optional(),
    /** Bottom to top. */
    floors: z.array(FacadeFloor).min(1).max(6),
    crown: FacadeCrown.optional(),
    /** Depth of the body behind (default min(0.8 x width, 20)). */
    depth: Len.optional(),
    rotunda: FacadeRotunda.optional(),
  })
  .strict();
export type FacadeBuilding = z.infer<typeof FacadeBuilding>;

export const FacadeViewKey = z.object({ at: Time, view: z.enum(FACADE_VIEWS), dur: Dur }).strict();
export type FacadeViewKey = z.infer<typeof FacadeViewKey>;

export const FacadeAct = z.discriminatedUnion("do", [
  /** target: building, floor or bay id, "crown", "base", or "rotunda" / "dome" when the building has a rotunda (default 3 s). */
  z.object({ do: z.literal("draw"), target: Id, at: Time, dur: Dur }).strict(),
  /** target: floor or bay id, "<floorId>.members", "crown", "base", or "rotunda" / "dome" when the building has a rotunda. */
  z.object({ do: z.literal("highlight"), target: Id, at: Time, until: Time.optional() }).strict(),
  /** Section through a bay (default 2 s); the sezione view and the A–A line of the prospetto follow it. */
  z.object({ do: z.literal("cut"), bay: Id, at: Time, dur: Dur }).strict(),
  /** Moves the eye of the perspective view (default 2 s). */
  z.object({ do: z.literal("eye"), at: Time, dur: Dur, height: Len.optional(), x: z.number().min(-120).max(120).optional() }).strict(),
]);
export type FacadeAct = z.infer<typeof FacadeAct>;

export const FacadeChapter = z
  .object({
    chapter: Id,
    building: Id,
    /** View keys. When set, the chapter's `camera` keys are ignored. */
    views: z.array(FacadeViewKey).optional(),
    acts: z.array(FacadeAct).optional(),
    /** Cut height of the plan view, metres above the ground (default: base height + 1). */
    plan: Len.optional(),
    /** Eye of the perspective: height 1.6, x 0, distance 1.2 x building width by default. */
    eye: z.object({ height: Len.optional(), x: z.number().min(-120).max(120).optional(), distance: Len.optional() }).strict().optional(),
  })
  .strict();
export type FacadeChapter = z.infer<typeof FacadeChapter>;

export const FacadeData = z.object({ buildings: z.array(FacadeBuilding).min(1).max(4), chapters: z.array(FacadeChapter) }).strict();
export type FacadeData = z.infer<typeof FacadeData>;

type Issue = { path: string; message: string };

const num = (n: number): string => String(Math.round(n * 100) / 100);

/** Bays of a floor left to right, centred on x = 0; `width` is the sum of the bay widths. */
export function floorLayout(floor: FacadeFloor): { width: number; bays: Array<{ id: string; x0: number; x1: number; cx: number; forward: number }> } {
  const width = floor.bays.reduce((sum, b) => sum + b.width, 0);
  let x = -width / 2;
  const bays = floor.bays.map((b) => {
    const x0 = x;
    x += b.width;
    return { id: b.id, x0, x1: x, cx: (x0 + x) / 2, forward: b.forward ?? 0 };
  });
  return { width, bays };
}

/** Lantern of a closed dome, as a share of the diameter. */
const LANTERN = 0.15;

/** What follows from a rotunda's numbers: radii, wall, drum, lantern height. */
export function rotundaDims(r: FacadeRotunda): { radius: number; wall: number; outer: number; drum: number; lantern: number } {
  const wall = r.wall ?? 0.14 * r.diameter;
  const radius = r.diameter / 2;
  return { radius, wall, outer: radius + wall, drum: r.dome.drum ?? 0, lantern: r.dome.lantern && !r.dome.oculus ? LANTERN * r.diameter : 0 };
}

/** Depth of the body behind the façade (the rotunda not included). */
export function bodyDepth(b: FacadeBuilding): number {
  return b.depth ?? Math.min(0.8 * Math.max(...b.floors.map((f) => floorLayout(f).width)), 20);
}

/** Width of the widest floor, total height (base + floors + crown, or the rotunda if higher) and depth (body + rotunda). */
export function buildingSize(b: FacadeBuilding): { width: number; height: number; depth: number } {
  const width = Math.max(...b.floors.map((f) => floorLayout(f).width));
  let height = (b.base?.height ?? 0) + b.floors.reduce((sum, f) => sum + f.height, 0);
  const crown = b.crown;
  if (crown) {
    if (crown.type === "pediment" || crown.type === "gable") height += (crownWidth(b) / 2) * Math.tan(((crown.pitch ?? 22) * Math.PI) / 180);
    else height += crown.height ?? 0;
  }
  let depth = bodyDepth(b);
  const r = b.rotunda;
  if (r) {
    const d = rotundaDims(r);
    depth += (r.gap ?? 0) + 2 * d.outer;
    height = Math.max(height, (r.level ?? 0) + r.height + d.drum + d.outer + d.lantern);
  }
  return { width, height, depth };
}

/** Width covered by the crown: the bays it names on the top floor, or the whole top floor. */
function crownWidth(b: FacadeBuilding): number {
  const top = floorLayout(b.floors[b.floors.length - 1]!);
  const range = b.crown?.bays;
  if (!range) return top.width;
  const first = top.bays.find((x) => x.id === range[0]);
  const last = top.bays.find((x) => x.id === range[1]);
  return first && last ? Math.abs(last.x1 - first.x0) : top.width;
}

/** Width of the cell inside its bay, if it has one. */
function cellWidth(c: FacadeCell): number | undefined {
  if (c.el === "portal" || c.el === "window" || c.el === "niche" || c.el === "panel") return c.w;
  if (c.el === "oculus") return 2 * c.r;
  return undefined;
}

/** Top edge of the cell above the floor, if it has one. */
function cellTop(c: FacadeCell): number | undefined {
  if (c.el === "portal") return c.h;
  if (c.el === "window" || c.el === "niche" || c.el === "panel" || c.el === "gallery") return c.sill + c.h;
  if (c.el === "oculus") return c.y + c.r;
  return undefined;
}

/** Checks one building on its own: ids, cells inside their bay and floor, floors, members, crown. */
function checkBuilding(b: FacadeBuilding, path: string, issues: Issue[]): void {
  const add = (p: string, message: string): void => void issues.push({ path: p, message });
  const ids = new Set<string>();
  const claim = (id: string, p: string): void => {
    if (ids.has(id)) add(p, `duplicate floor or bay id "${id}" in "${b.id}"`);
    ids.add(id);
  };
  b.floors.forEach((f, i) => {
    const fp = `${path}.floors[${i}]`;
    claim(f.id, fp);
    const width = floorLayout(f).width;
    const below = b.floors[i - 1];
    if (below && width > floorLayout(below).width * 1.01) add(fp, `floor "${f.id}" is wider than the floor below (${num(width)} m against ${num(floorLayout(below).width)} m)`);
    const m = f.members;
    if (m && m.type !== "pier" && m.order === undefined) add(`${fp}.members`, `${m.type} needs an order (${FACADE_ORDERS.join(", ")})`);
    if (f.colonnade && m?.type !== "column") add(fp, `colonnade "${f.id}" needs members of type column`);
    if (f.colonnade && m?.paired) add(`${fp}.members`, `colonnade "${f.id}" cannot have paired members (a colonnade has one column on each axis)`);
    f.bays.forEach((bay, k) => {
      const bp = `${fp}.bays[${k}]`;
      claim(bay.id, bp);
      const w = cellWidth(bay.cell);
      const clear = bay.width - (m ? m.width * (m.paired ? 2 : 1) : 0);
      if (w !== undefined && w > clear + 1e-9) add(`${bp}.cell`, `${bay.cell.el} in bay "${bay.id}" is wider than the bay (${num(w)} m against ${num(clear)} m clear)`);
      const top = cellTop(bay.cell);
      if (top !== undefined && top > f.height + 1e-9) add(`${bp}.cell`, `${bay.cell.el} in bay "${bay.id}" is taller than the floor (${num(top)} m against ${num(f.height)} m)`);
    });
  });
  const r = b.rotunda;
  if (r) {
    const d = rotundaDims(r);
    if (d.wall >= r.diameter / 4) add(`${path}.rotunda.wall`, `rotunda wall of ${num(d.wall)} m is too thick for a diameter of ${num(r.diameter)} m (under ${num(r.diameter / 4)} m)`);
    const oculus = r.dome.oculus ?? 0;
    if (oculus >= 0.4 * r.diameter) add(`${path}.rotunda.dome`, `oculus of ${num(oculus)} m is too big for a diameter of ${num(r.diameter)} m (under ${num(0.4 * r.diameter)} m)`);
    if (r.dome.lantern && oculus > 0) add(`${path}.rotunda.dome`, "a lantern needs a closed dome: drop the oculus or the lantern");
    if (r.dome.coffers && r.dome.type === "smooth") add(`${path}.rotunda.dome`, "coffers need a dome of type coffered");
  }
  const crown = b.crown;
  if (crown?.bays) {
    const topIds = new Set(b.floors[b.floors.length - 1]!.bays.map((x) => x.id));
    const missing = crown.bays.filter((id) => !topIds.has(id));
    if (missing.length) add(`${path}.crown`, `crown over unknown bays ${missing.map((m) => `"${m}"`).join(", ")} (top floor has ${[...topIds].join(", ")})`);
  }
}

/** Checks a facade entity anchor against the building of its chapter. */
function checkAnchor(a: Anchor, building: FacadeBuilding | undefined, path: string, issues: Issue[]): void {
  if (!("entity" in a)) return;
  const add = (message: string): void => void issues.push({ path, message });
  if (!(FACADE_ENTITIES as readonly string[]).includes(a.entity)) return add(`unknown facade entity "${a.entity}" (use ${FACADE_ENTITIES.join(", ")})`);
  if (!building) return add("facade anchor in a chapter without a building");
  const floors = new Set(building.floors.map((f) => f.id));
  const bays = new Set(building.floors.flatMap((f) => f.bays.map((x) => x.id)));
  if (a.entity === "bay" && (a.part === undefined || !bays.has(a.part))) add(`unknown bay "${a.part}"`);
  if ((a.entity === "floor" || a.entity === "member") && (a.part === undefined || !floors.has(a.part))) add(`unknown floor "${a.part}"`);
  else if (a.entity === "member" && !building.floors.find((f) => f.id === a.part)?.members) add(`member anchor: floor "${a.part}" has no members`);
  if (a.entity === "vanishing-point" && a.index !== undefined) add("vanishing-point anchor with an index: the perspective has a single vanishing point (drop the index)");
  if (a.entity === "building" && a.part !== undefined && a.part !== building.id) add(`unknown building "${a.part}"`);
  if ((a.entity === "rotunda" || a.entity === "dome" || a.entity === "oculus") && !building.rotunda) add(`${a.entity} anchor: building "${building.id}" has no rotunda`);
  else if (a.entity === "oculus" && !building.rotunda?.dome.oculus) add(`oculus anchor: the dome of "${building.id}" has no oculus`);
}

/**
 * Cross-checks against the rest of the scene: chapter ids, buildings, times inside the chapter, act
 * targets, slider ids and facade anchors in pins and camera keys. Same Issue shape as checkSolidData.
 */
export function checkFacadeData(data: FacadeData, scene: Pick<z.infer<typeof SceneBase>, "chapters">): Issue[] {
  const issues: Issue[] = [];
  const buildings = new Map(data.buildings.map((b) => [b.id, b]));
  const seenBuildings = new Set<string>();
  data.buildings.forEach((b, i) => {
    if (seenBuildings.has(b.id)) issues.push({ path: `engineData.buildings[${i}]`, message: `duplicate building id "${b.id}"` });
    seenBuildings.add(b.id);
    checkBuilding(b, `engineData.buildings[${i}]`, issues);
  });
  const byChapter = new Map(data.chapters.map((c) => [c.chapter, c]));
  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (data.chapters.findIndex((x) => x.chapter === c.chapter) !== i) issues.push({ path, message: `duplicate facade entry for chapter "${c.chapter}"` });
    if (duration === undefined) issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    const b = buildings.get(c.building);
    if (!b) issues.push({ path, message: `unknown building "${c.building}"` });
    if (duration !== undefined) {
      c.views?.forEach((v, k) => v.at >= duration && issues.push({ path: `${path}.views[${k}]`, message: `view "${v.view}" starts after the chapter ends` }));
      c.acts?.forEach((a, k) => a.at >= duration && issues.push({ path: `${path}.acts[${k}]`, message: `"${a.do}" starts after the chapter ends` }));
    }
    if (!b) return;
    const floors = new Set(b.floors.map((f) => f.id));
    const bays = new Set(b.floors.flatMap((f) => f.bays.map((x) => x.id)));
    const members = new Set(b.floors.map((f) => `${f.id}.members`));
    const round = b.rotunda ? ["rotunda", "dome"] : [];
    const top = buildingSize(b).height;
    if (c.plan !== undefined && c.plan > top) issues.push({ path: `${path}.plan`, message: `plan cut at ${num(c.plan)} m is above the top of "${b.id}" (${num(top)} m)` });
    const ok = (a: FacadeAct): boolean => {
      if (a.do === "draw") return a.target === b.id || floors.has(a.target) || bays.has(a.target) || a.target === "crown" || a.target === "base" || round.includes(a.target);
      if (a.do === "highlight") return floors.has(a.target) || bays.has(a.target) || members.has(a.target) || a.target === "crown" || a.target === "base" || round.includes(a.target);
      if (a.do === "cut") return bays.has(a.bay);
      return true;
    };
    c.acts?.forEach((a, k) => {
      if (!ok(a) && (a.do === "draw" || a.do === "highlight") && (a.target === "rotunda" || a.target === "dome")) issues.push({ path: `${path}.acts[${k}]`, message: `"${a.target}" in "${a.do}" needs a rotunda: "${b.id}" has none` });
      else if (!ok(a)) issues.push({ path: `${path}.acts[${k}]`, message: `unknown ${a.do === "cut" ? "bay" : "target"} "${a.do === "cut" ? a.bay : (a as { target: string }).target}" in "${a.do}"` });
      if (a.do === "highlight" && a.until !== undefined && a.until <= a.at) issues.push({ path: `${path}.acts[${k}]`, message: "`until` must come after `at`" });
    });
  });
  scene.chapters.forEach((ch, c) => {
    const entry = byChapter.get(ch.id);
    const at = `chapters[${c}]`;
    const b = entry && buildings.get(entry.building);
    if (!entry) issues.push({ path: at, message: `chapter "${ch.id}" has no facade entry (engineData.chapters)` });
    else if (entry.views?.length && ch.camera.length) issues.push({ path: `${at}.camera`, message: `chapter "${ch.id}" sets both facade views and camera keys: the camera keys are ignored` });
    for (const id of ch.activity?.test.params ?? [])
      if (!(FACADE_PARAMS as readonly string[]).includes(id)) issues.push({ path: `${at}.activity.test`, message: `unknown facade param "${id}" (use ${FACADE_PARAMS.join(", ")})` });
    ch.pins.forEach((p, i) => checkAnchor(p.anchor, b, `${at}.pins[${i}].anchor`, issues));
    ch.camera.forEach((k, i) => checkAnchor(k.target, b, `${at}.camera[${i}].target`, issues));
  });
  return issues;
}
