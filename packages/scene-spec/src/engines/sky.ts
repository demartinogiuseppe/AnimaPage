// SkyData: owned by the `sky` engine (astronomy: solar system, day/night, seasons, Moon phases,
// eclipses, constellations).
//
// The engine computes where the Sun, the planets and the Moon really are at a date (JPL
// "Approximate Positions of the Planets", Table 1; truncated Meeus/ELP lunar series), so the
// scene only says WHICH view, WHICH dates and WHAT to highlight. Sizes and distances are always
// schematic: every sky scene needs a disclaimer containing "scala" ("dimensioni e distanze non in scala").
//
// Stage and units
// - All views share one stage: a dark round "space" plate (radius 10, top at y = 0.25) with a
//   curved star backdrop behind it (on the -z side, 9 units tall). Bodies move in the orbital
//   plane at y = 3.4. The reader looks from +z (camera azimuth 0).
// - Ecliptic J2000 axes map to the stage as: +x = vernal equinox direction, +y = ecliptic north,
//   -z = ecliptic longitude 90° (so planets go counter-clockwise seen from above).
// - Angles in degrees; dates are ISO UTC datetimes ("2026-06-21T12:00:00Z"), valid 1800-2050.
//
// Views (one per chapter)
// - "system":     heliocentric: Sun at the centre, the planets in `bodies` on their orbits.
//                 distances "linear" (true ratios, good up to Mars) or "compressed" (r^0.4, for outer planets).
// - "earth-sun":  Sun at the centre, a big Earth on its orbit (radius 7) with its axis fixed in space,
//                 night side, equator/tropics/polar circles, optional parallel sun rays: day/night, seasons.
// - "earth-moon": Sun-fixed frame: the Sun always on the left (x = -9), Earth at x = 2, the Moon on its
//                 orbit (radius ~5.5, inclination exaggerated by `moonTilt`), night sides, optional shadow
//                 cones (eclipses) and a "phase window" on the backdrop: the Moon as seen from Earth.
//
// Time: `time` keys map chapter seconds to dates, piecewise linear (two keys with the same date =
// a pause). The Earth's spin is real while it is slow enough to see; faster segments show a calm
// spin that still lands on the real angle at each key.
//
// Entity anchors (pins, camera targets), all accept `offset`:
// - { entity: "<body>" }                      centre of sun, mercury..neptune, earth, moon (in the chapter's view)
// - { entity: "earth", part: "north" | "south" }   tips of the Earth's axis
// - { entity: "earth", part: "equator" | "tropic-n" | "tropic-s" | "arctic" | "antarctic" | "subsolar" | "lat:<deg>" }
//                                             point at that latitude on the meridian facing the Sun (follows the tilt)
// - { entity: "place", part: "<placeId>" }    a place on the Earth (turns with it)
// - { entity: "orbit", part: "<body>", index: <deg> }  point of the body's orbit at that ecliptic longitude
//                                             (earth-moon view: angle from the Sun direction, 0 = new moon)
// - { entity: "ray", index?: 0..4 }           earth-sun view: where sun ray `index` (default 2, the middle one) hits the Earth
// - { entity: "shadow", part: "earth" | "moon" }  earth-moon view: the Earth's shadow at the Moon's distance / the Moon's shadow on the Earth
// - { entity: "phase" }                       earth-moon view: the phase window
// - { entity: "constellation", part: "<id>", index?: <star> }  centre of a constellation drawing, or one of its stars
import { z } from "zod";
import { Id, TimeRange, type SceneBase } from "../common.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const SKY_BODIES = ["sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "moon"] as const;
export const SkyBody = z.enum(SKY_BODIES);
export type SkyBody = z.infer<typeof SkyBody>;
/** Bodies the "system" view can show (the Sun is always there; the Moon only in earth-moon). */
export const SYSTEM_PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
const SystemPlanet = z.enum(SYSTEM_PLANETS);

export const SkyView = z.enum(["system", "earth-sun", "earth-moon"]);
export type SkyView = z.infer<typeof SkyView>;

/** Validity of the JPL Table 1 elements the engine uses. */
export const SKY_YEARS: readonly [number, number] = [1800, 2050];

const IsoDate = z.iso.datetime({ offset: true });

export const SkyTimeKey = z.object({ at: z.number().min(0), date: IsoDate }).strict();
export type SkyTimeKey = z.infer<typeof SkyTimeKey>;

/** What a highlight window can make glow. */
export const SKY_TARGETS = [...SKY_BODIES, "axis", "orbit", "rays", "shadow", "phase", "tropics", "equator"] as const;
export const SkyTarget = z.enum(SKY_TARGETS);

const ParamId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/);

/**
 * "Prova tu" sliders. kind:
 * - day:   day of the year (1..365) of the current date; the Earth moves along its orbit.
 * - hour:  UTC hour (0..24) of the current date; the Earth turns (day/night).
 * - tilt:  axial tilt shown (0..90°, default range 0..45): "what if the axis were straight?".
 * - moon:  the Moon's angle from the Sun as seen from Earth (0..360°, 0 = new moon, 180 = full moon), earth-moon view.
 */
export const SkyParam = z
  .object({
    id: ParamId,
    kind: z.enum(["day", "hour", "tilt", "moon"]),
    /** Slider caption (Italian). Default by kind. */
    label: z.string().min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
  })
  .strict();
export type SkyParam = z.infer<typeof SkyParam>;

export const PARAM_RANGES: Record<SkyParam["kind"], { min: number; max: number; step: number; label: string }> = {
  day: { min: 1, max: 365, step: 1, label: "Giorno dell'anno" },
  hour: { min: 0, max: 24, step: 0.25, label: "Ora (UTC)" },
  tilt: { min: 0, max: 45, step: 0.5, label: "Inclinazione dell'asse (°)" },
  moon: { min: 0, max: 360, step: 1, label: "Posizione della Luna (°)" },
};
const PARAM_LIMITS: Record<SkyParam["kind"], [number, number]> = { day: [1, 366], hour: [0, 24], tilt: [0, 90], moon: [0, 360] };

export const SkyChapter = z
  .object({
    chapter: Id,
    view: SkyView,
    /** Chapter seconds -> UTC dates, piecewise linear. One key = the date stands still. */
    time: z.array(SkyTimeKey).min(1),
    /** "system" view: planets shown (default mercury, venus, earth, mars). */
    bodies: z.array(SystemPlanet).min(1).optional(),
    /** "system" view: "linear" (default) keeps the true distance ratios; "compressed" fits the outer planets. */
    distances: z.enum(["linear", "compressed"]).optional(),
    /** Axial tilt drawn, degrees (default the real 23.44). The Sun's path stays real. */
    tilt: z.number().min(0).max(90).optional(),
    /** earth-moon view: exaggeration of the Moon's 5° orbital inclination (1 = true, default 6), so eclipses read. */
    moonTilt: z.number().min(1).max(10).optional(),
    /** Orbit lines (default true). */
    orbits: z.boolean().optional(),
    /** Earth: equator, tropics and polar circles (default true in earth-sun, false elsewhere). */
    latitudes: z.boolean().optional(),
    /** earth-sun view: parallel sun rays hitting the Earth (default false). */
    rays: z.boolean().optional(),
    /** earth-moon view: shadow cones of the Earth and the Moon (default false). */
    shadows: z.boolean().optional(),
    /** earth-moon view: window on the backdrop with the Moon as seen from Earth (default true). */
    phase: z.boolean().optional(),
    /** Date shown on the backdrop (default true). */
    dateLabel: z.boolean().optional(),
    /** Windows in which an element glows (and keeps its colours in ink style). */
    highlight: z.array(z.object({ target: SkyTarget, window: TimeRange }).strict()).optional(),
    /** Constellations drawn on the backdrop in this chapter. */
    constellations: z.array(Id).optional(),
    params: z.array(SkyParam).optional(),
  })
  .strict();
export type SkyChapter = z.infer<typeof SkyChapter>;

/** A place on the Earth (a dot that turns with it). Coordinates must come from a cited source. */
export const SkyPlace = z
  .object({
    id: Id,
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    color: Color.optional(),
    sourceIds: z.array(Id),
  })
  .strict();
export type SkyPlace = z.infer<typeof SkyPlace>;

/**
 * Constellation drawn as a small star map on the backdrop. Star coordinates (right ascension in
 * hours, declination in degrees) must come from a cited catalogue; `lines` join star indices.
 */
export const SkyConstellation = z
  .object({
    id: Id,
    stars: z
      .array(z.object({ ra: z.number().min(0).max(24), dec: z.number().min(-90).max(90), mag: z.number().min(-2).max(7).optional() }).strict())
      .min(2),
    lines: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])),
    /** Centre on the backdrop: u = -1 (left) .. 1 (right), v = 0 (bottom) .. 1 (top). Default [0, 0.7]. */
    at: z.tuple([z.number().min(-1).max(1), z.number().min(0).max(1)]).optional(),
    /** Width of the drawing in scene units (default 4). */
    size: z.number().positive().max(10).optional(),
    sourceIds: z.array(Id).min(1),
  })
  .strict();
export type SkyConstellation = z.infer<typeof SkyConstellation>;

export const SkyData = z
  .object({
    /** Colour of the space plate and backdrop (default deep night blue). */
    background: Color.optional(),
    /** Decorative starfield (not real stars): count 0..1500 (default 400), seed. */
    stars: z.object({ count: z.number().int().min(0).max(1500).optional(), seed: z.number().int().optional() }).strict().optional(),
    places: z.array(SkyPlace).optional(),
    constellations: z.array(SkyConstellation).optional(),
    chapters: z.array(SkyChapter).min(1),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const unique = (ids: string[], path: (string | number)[], what: string) => {
      const seen = new Set<string>();
      ids.forEach((id, i) => {
        if (seen.has(id)) add([...path, i, "id"], `duplicate ${what} id "${id}"`);
        seen.add(id);
      });
    };
    unique((d.places ?? []).map((p) => p.id), ["places"], "place");
    unique((d.constellations ?? []).map((c) => c.id), ["constellations"], "constellation");
    d.constellations?.forEach((c, i) =>
      c.lines.forEach(([a, b], k) => {
        if (a >= c.stars.length || b >= c.stars.length) add(["constellations", i, "lines", k], "line joins a star that does not exist");
      }),
    );
    const consts = new Set((d.constellations ?? []).map((c) => c.id));
    const chapters = new Set<string>();
    d.chapters.forEach((c, i) => {
      const at = ["chapters", i];
      if (chapters.has(c.chapter)) add([...at, "chapter"], `duplicate chapter "${c.chapter}"`);
      chapters.add(c.chapter);
      let prev = -1;
      let prevMs = -Infinity;
      c.time.forEach((k, j) => {
        if (k.at < prev) add([...at, "time", j], "time keys must be in order of `at`");
        prev = k.at;
        const ms = Date.parse(k.date);
        const y = new Date(ms).getUTCFullYear();
        if (y < SKY_YEARS[0] || y > SKY_YEARS[1]) add([...at, "time", j, "date"], `date outside ${SKY_YEARS[0]}-${SKY_YEARS[1]}`);
        if (ms < prevMs) add([...at, "time", j, "date"], "dates must not go backwards");
        prevMs = ms;
      });
      if (c.bodies && c.view !== "system") add([...at, "bodies"], "`bodies` only applies to the system view");
      if (c.distances && c.view !== "system") add([...at, "distances"], "`distances` only applies to the system view");
      if (c.rays && c.view !== "earth-sun") add([...at, "rays"], "`rays` only applies to the earth-sun view");
      if ((c.shadows || c.moonTilt !== undefined) && c.view !== "earth-moon") add([...at], "`shadows` and `moonTilt` only apply to the earth-moon view");
      c.highlight?.forEach((h, k) => {
        if (h.window[0] > h.window[1]) add([...at, "highlight", k], "window ends before it starts");
      });
      c.constellations?.forEach((id, k) => {
        if (!consts.has(id)) add([...at, "constellations", k], `unknown constellation "${id}"`);
      });
      unique((c.params ?? []).map((p) => p.id), [...at, "params"], "param");
      c.params?.forEach((p, k) => {
        const [lo, hi] = PARAM_LIMITS[p.kind];
        const min = p.min ?? PARAM_RANGES[p.kind].min;
        const max = p.max ?? PARAM_RANGES[p.kind].max;
        if (min >= max || min < lo || max > hi) add([...at, "params", k], `${p.kind} range must lie inside [${lo}, ${hi}] with min < max`);
        if (p.kind === "moon" && c.view !== "earth-moon") add([...at, "params", k], "a moon slider needs the earth-moon view");
        if ((p.kind === "tilt" || p.kind === "hour") && c.view === "system") add([...at, "params", k], `a ${p.kind} slider needs an Earth close-up view`);
      });
    });
  });
export type SkyData = z.infer<typeof SkyData>;

type SceneLike = Pick<z.infer<typeof SceneBase>, "chapters" | "disclaimers" | "sources">;

/** Bodies on stage in a chapter of this view. */
export function skyBodiesOf(c: Pick<SkyChapter, "view" | "bodies">): SkyBody[] {
  if (c.view === "system") return ["sun", ...(c.bodies ?? ["mercury", "venus", "earth", "mars"])];
  if (c.view === "earth-sun") return ["sun", "earth"];
  return ["sun", "earth", "moon"];
}

const EARTH_PARTS = new Set(["north", "south", "equator", "tropic-n", "tropic-s", "arctic", "antarctic", "subsolar"]);

/**
 * Cross-checks against the rest of the scene (chapter ids, times inside the chapter, slider ids,
 * anchors valid for the chapter's view, sources of places, the "not to scale" disclaimer).
 * Same Issue shape as checkSemantics.
 */
export function checkSkyData(data: SkyData, scene: SceneLike): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });
  const byId = new Map(data.chapters.map((c) => [c.chapter, c] as const));
  const sourceIds = new Set(scene.sources.map((s) => s.id));
  const places = new Set((data.places ?? []).map((p) => p.id));
  const consts = new Map((data.constellations ?? []).map((c) => [c.id, c] as const));

  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const ch = scene.chapters.find((x) => x.id === c.chapter);
    if (!ch) return void push(path, `unknown chapter "${c.chapter}"`);
    c.time.forEach((k, j) => k.at > ch.duration && push(`${path}.time[${j}]`, "time key after the chapter ends"));
    c.highlight?.forEach((h, k) => h.window[0] > ch.duration && push(`${path}.highlight[${k}]`, "highlight starts after the chapter ends"));
  });
  data.places?.forEach((p, i) => {
    if (p.sourceIds.length === 0) push(`engineData.places[${i}]`, `place "${p.id}" needs a source for its coordinates`);
    for (const id of p.sourceIds) if (!sourceIds.has(id)) push(`engineData.places[${i}]`, `unknown source id "${id}"`);
  });
  data.constellations?.forEach((c, i) => {
    for (const id of c.sourceIds) if (!sourceIds.has(id)) push(`engineData.constellations[${i}]`, `unknown source id "${id}"`);
  });

  scene.chapters.forEach((ch, i) => {
    const at = `chapters[${i}]`;
    const sc = byId.get(ch.id);
    if (!sc) return void push(at, `chapter "${ch.id}" has no engineData.chapters entry (nothing would be on stage)`);
    const bodies = new Set<string>(skyBodiesOf(sc));
    const params = new Set((sc.params ?? []).map((p) => p.id));
    ch.activity?.test.params?.forEach((id, k) => {
      if (!params.has(id)) push(`${at}.activity.test.params[${k}]`, `"${id}" is not a sky parameter of this chapter`);
    });
    const anchorIssue = (a: unknown): string | null => {
      if (!a || typeof a !== "object" || !("entity" in a)) return null;
      const { entity, part, index } = a as { entity: string; part?: string; index?: number };
      if ((SKY_BODIES as readonly string[]).includes(entity)) {
        if (!bodies.has(entity)) return `"${entity}" is not on stage in the ${sc.view} view`;
        if (part === undefined) return null;
        if (entity !== "earth") return `"${entity}" has no parts`;
        if (sc.view === "system") return "Earth parts need an Earth close-up view";
        if (EARTH_PARTS.has(part) || /^lat:-?\d+(\.\d+)?$/.test(part)) return null;
        return `unknown Earth part "${part}"`;
      }
      switch (entity) {
        case "place":
          if (sc.view === "system") return "places need an Earth close-up view";
          return part && places.has(part) ? null : `unknown place "${part}"`;
        case "orbit":
          return part && bodies.has(part) && part !== "sun" ? null : `no orbit "${part}" in the ${sc.view} view`;
        case "ray":
          if (sc.view !== "earth-sun" || !sc.rays) return "ray anchors need the earth-sun view with rays";
          return index === undefined || index <= 4 ? null : "ray index is 0..4";
        case "shadow":
          if (sc.view !== "earth-moon") return "shadow anchors need the earth-moon view";
          return part === "earth" || part === "moon" ? null : `shadow part must be "earth" or "moon"`;
        case "phase":
          return sc.view === "earth-moon" && sc.phase !== false ? null : "the phase window is only in the earth-moon view";
        case "constellation": {
          const c = part ? consts.get(part) : undefined;
          if (!c || !sc.constellations?.includes(c.id)) return `constellation "${part}" is not drawn in this chapter`;
          return index === undefined || index < c.stars.length ? null : "constellation star index out of range";
        }
        default:
          return `unknown sky entity "${entity}"`;
      }
    };
    ch.pins.forEach((p, k) => {
      const m = anchorIssue(p.anchor);
      if (m) push(`${at}.pins[${k}].anchor`, m);
    });
    ch.camera.forEach((key, k) => {
      const m = anchorIssue(key.target);
      if (m) push(`${at}.camera[${k}].target`, m);
    });
  });

  if (!scene.disclaimers.some((d) => /scala/i.test(d))) {
    push("disclaimers", 'sky scenes are never to scale: add a disclaimer such as "Dimensioni e distanze non sono in scala."');
  }
  return issues;
}
