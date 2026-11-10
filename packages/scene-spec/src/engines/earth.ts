// EarthData: owned by the `earth` engine (Terra in sezione: the inside of the Earth, plate
// tectonics, volcanoes, earthquakes, rock/soil layers and the water cycle at landscape scale).
//
// Two drawings, both built procedurally from declarative data an LLM can fill:
// - the GLOBE cut like a fruit (a wedge removed facing the camera) with one coloured shell per
//   layer, a depth probe that reads layer / temperature / pressure, and earthquakes whose P and S
//   rays cross the globe (S rays stop at the liquid outer core; shadow zones on the far side);
// - the BLOCK: a landscape block-diagram (a slab of ground cut open on its front face) showing a
//   plate boundary (divergent ridge, subduction, collision, transform) or plain layers (soil
//   horizons, rock strata), with plates moving for "millions of years", a volcano with magma
//   chamber and eruptions, a fault with hypocentre/epicentre and expanding wave fronts, the water
//   cycle (clouds, evaporation, rain, river, infiltration) and free particle flows and arrows.
//
// Units and conventions
// - Globe: depths in km from the surface (0) to the centre (= globe.radius, km). Temperatures in
//   °C, pressures in GPa. Thin layers (the crust) are drawn thicker than to scale unless
//   `toScale` is true; the depth probe always reads the real depth.
// - Block: positions on the front face are [u, v]: u from -1 (left edge) to 1 (right edge);
//   v = 0 is sea level, v = -1 the bottom of the block, v up to 1 the sky above it. The drawing is
//   schematic (strong vertical exaggeration): only `width` (km represented by the block) is used,
//   to turn plate displacement into a distance on screen.
// - Plate motion: displacement (km) = speed (cm/yr) × time (millions of years) × 10.
// - Times are chapter seconds. Angles in degrees (shadow-zone angles are angular distances from
//   the epicentre, measured at the centre of the Earth).
//
// Time model: each chapter shows a globe and/or a block (`at`/`until` fade them in and out; when a
// scene uses both, the block stands on the left and the globe on the right, same place in every
// chapter). Keyed values ([{ at, value }]) are interpolated smoothly between keys and hold before
// the first / after the last key. Quakes and eruptions restart at each listed time.
// Sliders (activity.test.params -> chapter `params`) override a keyed value: depth (globe probe),
// speed and time (plate motion), magnitude (block fault); update stays pure.
//
// Entity anchors (pins and camera targets), all accept `offset`:
// - { entity: "globe", part }  part = a layer id (point in the middle of that shell on the cut
//   face), "centre", "surface" (top of the globe), "probe" (the probe tip, at the current depth),
//   "readout" (the probe's text panel), "focus" (the earthquake source, top of the disc),
//   "P" | "S" (the leading front of the wave; index = ray number), "shadow" (middle of the P
//   shadow zone on the surface, right side), "s-shadow" (middle of the S shadow zone, right side)
// - { entity: "block", part }  part = one of EARTH_BLOCK_PARTS, a stratum id, a flow id or an arrow id
//   (flows and arrows accept index = % along their path).
import { z } from "zod";
import { Id, TimeRange, type Anchor, type SceneBase } from "../common.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Point on the block's front face: [u, v], see the header. */
const UV = z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]);

/** A keyed value: [{ at, value }] in increasing `at`. */
const Keys = z.array(z.object({ at: z.number().min(0), value: z.number() }).strict()).min(1);
export type EarthKeys = z.infer<typeof Keys>;

const presenceFields = {
  /** Fade-in time; omitted = there from t = 0. */
  at: z.number().min(0).optional(),
  /** Gone by this time (fades out just before). */
  until: z.number().min(0).optional(),
};

export const EarthLayer = z
  .object({
    id: Id,
    /** Italian name shown by the probe readout, e.g. "Nucleo esterno". */
    name: z.string().min(1),
    /** Depth of the top and bottom of the layer, km. Layers are listed from the surface down. */
    top: z.number().min(0),
    bottom: z.number().positive(),
    color: Color,
    state: z.enum(["solid", "plastic", "liquid"]).optional(),
    /** Temperature at the top and bottom of the layer, °C (from a verified source): the probe interpolates. */
    temp: z.tuple([z.number(), z.number()]).optional(),
    /** Pressure at the top and bottom, GPa (from a verified source). */
    pressure: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  })
  .strict();
export type EarthLayer = z.infer<typeof EarthLayer>;

/** The globe shared by every chapter (one world). */
export const EarthGlobe = z
  .object({
    /** Radius of the planet, km (the depth of the centre). */
    radius: z.number().positive(),
    /** From the surface to the centre; contiguous (each top = previous bottom), the last ends at `radius`. */
    layers: z.array(EarthLayer).min(2),
    /** Draw every layer to scale (the crust becomes a hairline). Default false. */
    toScale: z.boolean().optional(),
    /** Colour of the outer surface (default ocean blue). */
    surface: Color.optional(),
    /**
     * Seismic shadow zones (angular distance from the epicentre, degrees, from a verified source):
     * no direct P waves between pFrom and pTo; no S waves beyond sFrom. Required by globe quakes.
     */
    shadow: z
      .object({ pFrom: z.number().gt(30).lt(180), pTo: z.number().gt(30).max(180), sFrom: z.number().gt(30).lt(180) })
      .strict()
      .optional(),
  })
  .strict();
export type EarthGlobe = z.infer<typeof EarthGlobe>;

export const EarthGlobeView = z
  .object({
    ...presenceFields,
    /** Wedge removed, degrees (default 90; quakes need 180 = a half globe whose flat face is the wave plane). */
    cut: z.number().min(20).max(180).optional(),
    /** Depth probe on the cut face: keyed depth in km (slider var "depth"). */
    probe: Keys.optional(),
    /** Windows in which a layer glows (emphasis). */
    glow: z.array(z.object({ layer: Id, window: TimeRange }).strict()).optional(),
    /** Earthquake at the top of the disc; P and S rays cross the globe. */
    quake: z
      .object({
        /** Start times; each one restarts the waves. */
        at: z.array(z.number().min(0)).min(1),
        /** Seconds the P wave takes to reach the opposite side (default 8). */
        travel: z.number().positive().optional(),
        /** Rays drawn on each side (default 9, 4..14). */
        rays: z.number().int().min(4).max(14).optional(),
        /** Which waves to draw (default both). */
        waves: z.array(z.enum(["P", "S"])).min(1).optional(),
        /** Seismic stations on the surface lighting up when the waves arrive, and the shadow-zone arcs (default true). */
        stations: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EarthGlobeView = z.infer<typeof EarthGlobeView>;

export const EARTH_BOUNDARIES = ["none", "divergent", "subduction", "collision", "transform"] as const;
export type EarthBoundary = (typeof EARTH_BOUNDARIES)[number];

export const EARTH_FLOW_KINDS = ["magma", "lava", "water", "vapour", "rain", "ash", "sediment"] as const;

/** Named anchor points of the block; earthBlockParts() says which ones a given block has. */
export const EARTH_BLOCK_PARTS = [
  "surface",
  "crust",
  "mantle",
  "asthenosphere",
  "plate-left",
  "plate-right",
  "ocean",
  "ridge",
  "trench",
  "slab",
  "mountains",
  "volcano",
  "chamber",
  "conduit",
  "fault",
  "hypocentre",
  "epicentre",
  "cloud",
  "river",
  "readout",
] as const;
export type EarthBlockPart = (typeof EARTH_BLOCK_PARTS)[number];

export const EarthBlockView = z
  .object({
    ...presenceFields,
    /**
     * "none": plain layers (soil, rock strata, landscape); "divergent": mid-ocean ridge, plates moving
     * apart and new crust; "subduction": oceanic plate (left) sinking under a continent (right), trench,
     * volcanic arc; "collision": two continents pushing up a mountain range; "transform": two plates
     * sliding past each other along a vertical fault (motion along the depth of the block).
     */
    boundary: z.enum(EARTH_BOUNDARIES),
    /** km represented by the block's width (default 1000); only used for plate displacement. */
    width: z.number().positive().optional(),
    /** "none" only: shape of the land (default "hills"). */
    relief: z.enum(["flat", "hills", "mountains"]).optional(),
    /** "none" only: sea on the left up to this u (coastline). */
    sea: z.number().min(-1).max(1).optional(),
    /**
     * "none" only: layers from the ground down (soil horizons, rock strata); thickness = share of the
     * block depth (normalised). Replaces the default crust / mantle / asthenosphere.
     */
    strata: z
      .array(z.object({ id: Id, name: z.string().min(1), thickness: z.number().positive(), color: Color }).strict())
      .min(1)
      .optional(),
    /** Plates moving (not "none"): speed in cm/yr (slider "speed") over keyed millions of years (slider "time"). */
    motion: z.object({ speed: z.number().min(0).max(30), time: Keys }).strict().optional(),
    volcano: z
      .object({
        /** Position (default: on the arc for "subduction", on the ridge for "divergent", else 0.3). */
        u: z.number().min(-0.9).max(0.9).optional(),
        /** "strato" (steep cone of layers), "shield" (wide, low), "cinder" (small steep cone). */
        kind: z.enum(["strato", "shield", "cinder"]),
        /** "explosive": ash column and bombs; "effusive": lava flowing down the flanks. */
        style: z.enum(["explosive", "effusive"]),
        /** Eruption windows. */
        eruptions: z.array(TimeRange).optional(),
        /** Magma rising to the chamber (from the slab, the ridge or the mantle). Default true. */
        magma: z.boolean().optional(),
      })
      .strict()
      .optional(),
    fault: z
      .object({
        u: z.number().min(-0.9).max(0.9).optional(),
        kind: z.enum(["normal", "reverse", "strike-slip"]),
        /** Hypocentre depth as a share of the block depth (default 0.35). */
        depth: z.number().min(0.05).max(0.9).optional(),
        /** Quake times; each one restarts the waves. */
        quakes: z.array(z.number().min(0)).min(1),
        /** Magnitude (slider "magnitude"): the ground shakes more, ×10 amplitude per unit. */
        magnitude: z.number().min(1).max(10),
        /** Reference magnitude for the readout ("ampiezza ×1000 rispetto a M 3"). */
        compare: z.number().min(0).max(10).optional(),
        /** Seconds the P front takes to cross the block (default 4). */
        travel: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    water: z
      .object({
        /** Clouds above the land (default true). */
        clouds: z.boolean().optional(),
        /** Windows of each process. */
        evaporation: z.array(TimeRange).optional(),
        rain: z.array(TimeRange).optional(),
        river: z.array(TimeRange).optional(),
        infiltration: z.array(TimeRange).optional(),
      })
      .strict()
      .optional(),
    /** Free particle flows along a path on the front face (rock cycle, groundwater...). */
    flows: z
      .array(
        z
          .object({
            id: Id,
            kind: z.enum(EARTH_FLOW_KINDS),
            path: z.array(UV).min(2),
            count: z.number().int().min(1).max(120).optional(),
            /** Path lengths per second (default 0.15). */
            speed: z.number().positive().max(2).optional(),
            ...presenceFields,
          })
          .strict(),
      )
      .optional(),
    /** Arrows on the front face (process directions). */
    arrows: z
      .array(z.object({ id: Id, from: UV, to: UV, color: Color.optional(), ...presenceFields }).strict())
      .optional(),
    /** Windows in which a part or stratum glows. */
    glow: z.array(z.object({ part: Id, window: TimeRange }).strict()).optional(),
  })
  .strict();
export type EarthBlockView = z.infer<typeof EarthBlockView>;

export const EARTH_VARS = {
  depth: { min: 0, unit: "km", it: "profondità della sonda nel globo (needs globe.probe)" },
  speed: { min: 0, max: 30, unit: "cm/anno", it: "velocità delle placche (needs block.motion)" },
  time: { min: 0, max: 500, unit: "milioni di anni", it: "tempo trascorso (needs block.motion)" },
  magnitude: { min: 1, max: 10, unit: "", it: "magnitudo del terremoto (needs block.fault)" },
} as const;
export type EarthVar = keyof typeof EARTH_VARS;

export const EarthParam = z
  .object({
    id: Id,
    var: z.enum(["depth", "speed", "time", "magnitude"]),
    /** Italian label with unit, e.g. "Profondità (km)". */
    label: z.string().min(1),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
  })
  .strict();
export type EarthParam = z.infer<typeof EarthParam>;

export const EarthChapter = z
  .object({
    chapter: Id,
    globe: EarthGlobeView.optional(),
    block: EarthBlockView.optional(),
    params: z.array(EarthParam).optional(),
  })
  .strict();
export type EarthChapter = z.infer<typeof EarthChapter>;

/** Value of a keyed track at t (smooth between keys, held outside). */
export function earthKeyValue(keys: EarthKeys, t: number): number {
  const first = keys[0]!;
  if (t <= first.at) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t < b.at) {
      const a = keys[i - 1]!;
      const p = (t - a.at) / (b.at - a.at);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      return a.value + (b.value - a.value) * e;
    }
  }
  return keys[keys.length - 1]!.value;
}

/** Which slider variables a chapter entry supports. */
function varSupported(c: EarthChapter, v: EarthVar): boolean {
  if (v === "depth") return c.globe?.probe !== undefined;
  if (v === "magnitude") return c.block?.fault !== undefined;
  return c.block?.motion !== undefined;
}

export const EarthData = z
  .object({
    /** Background colour (default: warm paper). */
    background: Color.optional(),
    globe: EarthGlobe.optional(),
    chapters: z.array(EarthChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const layerIds = new Set<string>();
    if (d.globe) {
      const g = d.globe;
      g.layers.forEach((l, i) => {
        const path = ["globe", "layers", i];
        if (layerIds.has(l.id)) add([...path, "id"], `duplicate layer id "${l.id}"`);
        layerIds.add(l.id);
        if (l.bottom <= l.top) add(path, "bottom must be deeper than top");
        const expectTop = i === 0 ? 0 : g.layers[i - 1]!.bottom;
        if (l.top !== expectTop) add([...path, "top"], `top must be ${expectTop} (layers are contiguous from the surface)`);
      });
      const last = g.layers[g.layers.length - 1]!;
      if (last.bottom !== g.radius) add(["globe", "layers"], `the last layer must end at the centre (${g.radius} km)`);
      if (g.shadow && !(g.shadow.pFrom < g.shadow.pTo)) add(["globe", "shadow"], "pFrom must be below pTo");
    }
    const seen = new Set<string>();
    d.chapters.forEach((c, i) => {
      const at = ["chapters", i];
      if (seen.has(c.chapter)) add([...at, "chapter"], `duplicate chapter "${c.chapter}"`);
      seen.add(c.chapter);
      if (!c.globe && !c.block) add(at, "give a globe or a block (or both)");
      for (const key of ["globe", "block"] as const) {
        const v = c[key];
        if (v?.until !== undefined && v.until <= (v.at ?? 0)) add([...at, key], "`until` must come after `at`");
      }
      const gv = c.globe;
      if (gv) {
        if (!d.globe) add([...at, "globe"], "the scene has no `globe` model (engineData.globe)");
        gv.glow?.forEach((w, k) => {
          if (!layerIds.has(w.layer)) add([...at, "globe", "glow", k], `unknown layer "${w.layer}"`);
          if (w.window[0] > w.window[1]) add([...at, "globe", "glow", k], "window ends before it starts");
        });
        if (gv.probe) {
          checkKeys(gv.probe, [...at, "globe", "probe"], add);
          if (d.globe && gv.probe.some((k) => k.value < 0 || k.value > d.globe!.radius))
            add([...at, "globe", "probe"], `probe depth must stay within 0..${d.globe.radius} km`);
        }
        if (gv.quake) {
          if (d.globe && !d.globe.shadow) add([...at, "globe", "quake"], "globe quakes need engineData.globe.shadow (sourced angles)");
          if (gv.cut !== undefined && gv.cut !== 180) add([...at, "globe", "cut"], "a globe with a quake must be cut 180 (half globe)");
          checkOrder(gv.quake.at, [...at, "globe", "quake", "at"], add);
        }
      }
      const b = c.block;
      if (b) {
        const bp = [...at, "block"];
        const plain = b.boundary === "none";
        if (!plain && (b.strata || b.relief || b.sea !== undefined)) add(bp, "`strata`, `relief` and `sea` are only for boundary \"none\"");
        if (plain && b.motion) add([...bp, "motion"], "boundary \"none\" has no plates to move");
        if (b.motion) checkKeys(b.motion.time, [...bp, "motion", "time"], add);
        if (b.motion?.time.some((k) => k.value < 0 || k.value > EARTH_VARS.time.max)) add([...bp, "motion", "time"], "time must be 0..500 million years");
        if (b.fault) checkOrder(b.fault.quakes, [...bp, "fault", "quakes"], add);
        b.volcano?.eruptions?.forEach((w, k) => w[0] > w[1] && add([...bp, "volcano", "eruptions", k], "window ends before it starts"));
        const ids = new Set<string>();
        const claim = (id: string, path: (string | number)[]) => {
          if (ids.has(id) || (EARTH_BLOCK_PARTS as readonly string[]).includes(id)) add(path, `id "${id}" is already used`);
          ids.add(id);
        };
        b.strata?.forEach((s, k) => claim(s.id, [...bp, "strata", k, "id"]));
        b.flows?.forEach((f, k) => {
          claim(f.id, [...bp, "flows", k, "id"]);
          if (f.until !== undefined && f.until <= (f.at ?? 0)) add([...bp, "flows", k], "`until` must come after `at`");
        });
        b.arrows?.forEach((a, k) => {
          claim(a.id, [...bp, "arrows", k, "id"]);
          if (a.until !== undefined && a.until <= (a.at ?? 0)) add([...bp, "arrows", k], "`until` must come after `at`");
        });
        b.glow?.forEach((g, k) => {
          if (!ids.has(g.part) && !(EARTH_BLOCK_PARTS as readonly string[]).includes(g.part)) add([...bp, "glow", k], `unknown part "${g.part}"`);
          if (g.window[0] > g.window[1]) add([...bp, "glow", k], "window ends before it starts");
        });
      }
      const pids = new Set<string>();
      c.params?.forEach((p, k) => {
        const path = [...at, "params", k];
        if (pids.has(p.id)) add(path, `duplicate param id "${p.id}"`);
        pids.add(p.id);
        if (p.min >= p.max) add(path, "min must be below max");
        if (!varSupported(c, p.var)) add(path, `"${p.var}" needs ${EARTH_VARS[p.var].it.replace(/.*\(needs (.*)\)/, "$1")}`);
        const info = EARTH_VARS[p.var];
        const hi = p.var === "depth" ? (d.globe?.radius ?? Infinity) : (info as { max: number }).max;
        if (p.min < info.min || p.max > hi) add(path, `"${p.var}" range must stay within ${info.min}..${hi}`);
      });
    });
  });
export type EarthData = z.infer<typeof EarthData>;

function checkKeys(keys: EarthKeys, path: (string | number)[], add: (p: (string | number)[], m: string) => void) {
  checkOrder(
    keys.map((k) => k.at),
    path,
    add,
  );
}
function checkOrder(times: number[], path: (string | number)[], add: (p: (string | number)[], m: string) => void) {
  for (let i = 1; i < times.length; i++) if (times[i]! <= times[i - 1]!) return add(path, "times must be in increasing order");
}

/** Parts a block anchor may name, given what the block contains. */
export function earthBlockParts(b: EarthBlockView): string[] {
  const out: string[] = ["surface", "readout"];
  if (b.boundary === "none" && b.strata) out.push(...b.strata.map((s) => s.id));
  else out.push("crust", "mantle", "asthenosphere");
  if (b.boundary !== "none") out.push("plate-left", "plate-right");
  if (b.boundary === "divergent" || b.boundary === "subduction" || (b.boundary === "none" && b.sea !== undefined)) out.push("ocean");
  if (b.boundary === "divergent") out.push("ridge");
  if (b.boundary === "subduction") out.push("trench", "slab");
  if (b.boundary === "collision" || b.boundary === "subduction" || b.relief === "mountains") out.push("mountains");
  if (b.volcano) out.push("volcano", "chamber", "conduit");
  if (b.fault) out.push("fault", "hypocentre", "epicentre");
  if (b.water) out.push("cloud", "river");
  for (const f of b.flows ?? []) out.push(f.id);
  for (const a of b.arrows ?? []) out.push(a.id);
  return out;
}

export const EARTH_GLOBE_PARTS = ["centre", "surface", "probe", "readout", "focus", "P", "S", "shadow", "s-shadow"] as const;

type Issue = { path: string; message: string };

function checkAnchor(a: Anchor, entry: EarthChapter | undefined, data: EarthData, path: string, issues: Issue[]): void {
  if (!("entity" in a)) return;
  const add = (message: string): void => void issues.push({ path, message });
  if (!entry) return add("earth anchor in a chapter without an earth entry");
  if (a.entity === "globe") {
    if (!entry.globe) return add("globe anchor in a chapter without a globe");
    const layers = data.globe?.layers.map((l) => l.id) ?? [];
    const part = a.part ?? "";
    if (!layers.includes(part) && !(EARTH_GLOBE_PARTS as readonly string[]).includes(part))
      return add(`unknown globe part "${part}" (use a layer id or ${EARTH_GLOBE_PARTS.join(", ")})`);
    if (part === "probe" || part === "readout") if (!entry.globe.probe) add(`"${part}" needs globe.probe`);
    if (["focus", "P", "S", "shadow", "s-shadow"].includes(part) && !entry.globe.quake) add(`"${part}" needs globe.quake`);
  } else if (a.entity === "block") {
    if (!entry.block) return add("block anchor in a chapter without a block");
    const parts = earthBlockParts(entry.block);
    if (!a.part || !parts.includes(a.part)) add(`unknown block part "${a.part}" here (use ${parts.join(", ")})`);
  } else add(`unknown earth entity "${a.entity}" (use globe, block)`);
}

/**
 * Cross-checks against the rest of the scene: chapter ids, times inside the chapter, slider ids
 * used by activities, and earth anchors in pins and camera keys. Same Issue shape as checkSemantics.
 */
export function checkEarthData(data: EarthData, scene: Pick<z.infer<typeof SceneBase>, "chapters">): Issue[] {
  const issues: Issue[] = [];
  const byChapter = new Map(data.chapters.map((c) => [c.chapter, c]));
  const durations = new Map(scene.chapters.map((c) => [c.id, c.duration]));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const duration = durations.get(c.chapter);
    if (duration === undefined) return void issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    const late = (what: string, times: number[]) => {
      if (times.some((x) => x >= duration)) issues.push({ path, message: `${what} starts after the chapter ends` });
    };
    late("globe", [c.globe?.at ?? 0]);
    late("block", [c.block?.at ?? 0]);
    late("a globe quake", c.globe?.quake?.at ?? []);
    late("a block quake", c.block?.fault?.quakes ?? []);
    late("an eruption", (c.block?.volcano?.eruptions ?? []).map((w) => w[0]));
    late("a probe key", (c.globe?.probe ?? []).map((k) => k.at));
    late("a motion key", (c.block?.motion?.time ?? []).map((k) => k.at));
  });
  scene.chapters.forEach((ch, c) => {
    const entry = byChapter.get(ch.id);
    const at = `chapters[${c}]`;
    if (!entry) issues.push({ path: at, message: `chapter "${ch.id}" has no earth entry (empty stage)` });
    for (const id of ch.activity?.test.params ?? [])
      if (!entry?.params?.some((p) => p.id === id)) issues.push({ path: `${at}.activity.test`, message: `unknown earth param "${id}"` });
    ch.pins.forEach((p, i) => checkAnchor(p.anchor, entry, data, `${at}.pins[${i}].anchor`, issues));
    ch.camera.forEach((k, i) => checkAnchor(k.target, entry, data, `${at}.camera[${i}].target`, issues));
  });
  return issues;
}
