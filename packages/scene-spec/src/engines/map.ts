// MapData: owned by the `map` engine (packages/engine/src/engines/map).
//
// Declarative description of a geographic scene, meant to be filled by the generator/LLM:
// places are [lon, lat] WGS84 degrees, times are chapter-local seconds, chapters are
// referred to by id. Geodata files (elevation grid, boundaries, rivers) are produced by
// server/src/geo and referenced by path relative to the asset base (fixtures/public).
//
// Scene scale (the engine's projection):
// - Equirectangular around the bbox centre (lon0, lat0), longitude scaled by cos(lat0).
// - The bbox is `area.widthUnits` scene units wide (default 10); +x east, -z north, y up.
//   For Campania (2.25 deg of longitude at 40.75 N) 1 unit = about 19 km, so orbit
//   distances of 3..12 units frame a city area .. the whole region.
// - Heights: true scale times `terrain.verticalExaggeration`, so a geo anchor's `alt`
//   (metres) is exaggerated like the terrain. Sea level is y = 0.
//
// Engine anchors (common `Anchor` with `entity`):
// - { entity: "column", part: "<column pinId>" }: top of that data column at (chapter, t).
// - { entity: "route", part: "<route id>" }: the arrow head of that route at (chapter, t): the
//   start point before the route is drawn, the end point once it is complete. Resolves only in
//   chapters listed in the route's `show` windows (a pin there follows the arrow).
//   With `index: k` it is the fixed point path[k] instead (e.g. index 0 = where the route starts).
//
// Boundaries without `focus` (or focus ""): every land feature is drawn in relief colours and the
// file's `kind: "border"` lines (written by server/src/geo for country-level areas) are drawn
// faint. Use it for continents and historical maps where no single modern area is the subject.
import { z } from "zod";
import { Id, type SceneBase } from "../common.ts";

const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A time window inside one chapter; `from`/`to` omitted = chapter start/end. */
export const ChapterWindow = z
  .object({ chapter: Id, from: z.number().min(0).optional(), to: z.number().min(0).optional() })
  .strict();
export type ChapterWindow = z.infer<typeof ChapterWindow>;

const AltitudeMode = z
  .object({
    id: Id,
    type: z.literal("altitude"),
    label: z.string().min(1),
    /** Legend ticks in metres. */
    ticks: z.array(z.number()).min(2),
    /** Hypsometric ramp; omitted = engine default (green, sand, brown, snow). */
    stops: z.array(z.object({ elev: z.number(), color: Color }).strict()).min(2).optional(),
  })
  .strict();

const ClassesMode = z
  .object({
    id: Id,
    type: z.literal("classes"),
    label: z.string().min(1),
    /** Ordered from low to high; the last class has no `maxElev`. */
    classes: z
      .array(
        z
          .object({
            label: z.string().min(1),
            maxElev: z.number().optional(),
            color: Color,
            /** Share of the area shown in the legend, e.g. from the page. Not computed from the DEM. */
            pct: z.number().min(0).max(100).optional(),
            sourceIds: z.array(Id),
          })
          .strict(),
      )
      .min(2),
    /** Legend footnote, e.g. "Percentuali dal libro". */
    note: z.string().optional(),
  })
  .strict();

export const ColorMode = z.discriminatedUnion("type", [AltitudeMode, ClassesMode]);
export type ColorMode = z.infer<typeof ColorMode>;

export const Eruption = z
  .object({
    type: z.literal("eruption"),
    id: Id,
    /** Crater position. */
    geo: LonLat,
    chapter: Id,
    /** Start, chapter-local seconds. */
    at: z.number().min(0),
    /** Seconds until the ash has faded. */
    duration: z.number().positive().default(7.6),
    /** PRNG seed: same seed, same eruption. */
    seed: z.number().int().default(1),
    lava: z.number().int().min(0).max(2000).default(160),
    ash: z.number().int().min(0).max(5000).default(840),
    /** Compass bearing the ash mostly drifts towards (degrees, 0 = north, 90 = east). */
    windDeg: z.number().default(250),
    /** Ash landing radius in km. */
    ashRadiusKm: z.number().positive().default(30),
    /** Green tint on the low land around the volcano, ramping in after the eruption; lasts until the chapter ends. */
    fertility: z
      .object({
        radiusKm: z.number().positive(),
        /** Only land below this elevation turns green. */
        maxElev: z.number().default(250),
        color: Color.default("#2f7d2a"),
        /** Ramp window in seconds after `at`. */
        from: z.number().min(0),
        to: z.number().min(0),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Eruption = z.infer<typeof Eruption>;

/** Route window: the arrow is drawn from `from` over `draw` seconds, then stays until `to` / chapter end (0.6 s fade). */
export const RouteWindow = ChapterWindow.extend({
  /** Seconds to grow from start to end; 0 = shown complete at once (e.g. a recap chapter). */
  draw: z.number().min(0).default(4),
}).strict();
export type RouteWindow = z.infer<typeof RouteWindow>;

/** Animated arrow along a polyline: migrations, invasions, explorations, trade routes, journeys. */
export const Route = z
  .object({
    id: Id,
    /** Who/what moves, e.g. "Visigoti". Shown in the route legend; label the head with a pin anchored to { entity: "route", part: id }. */
    label: z.string().min(1),
    /** Optional dates text, e.g. "410 d.C." (then sourceIds must not be empty). */
    dates: z.string().min(1).optional(),
    color: Color.default("#c0392b"),
    /** [lon, lat] from start to end; the drawn line is smoothed through these points. */
    path: z.array(LonLat).min(2),
    /** Relative thickness, 1 = default. */
    width: z.number().positive().default(1),
    show: z.array(RouteWindow).min(1),
    sourceIds: z.array(Id),
  })
  .strict();
export type Route = z.infer<typeof Route>;

/** Tinted polygon over the terrain, e.g. the extent of an empire. */
export const MapArea = z
  .object({
    id: Id,
    label: z.string().min(1),
    /** Outer ring of [lon, lat] (not closed: the last point joins the first). */
    polygon: z.array(LonLat).min(3),
    fill: Color,
    /** Tint strength at full visibility, 0..1. */
    fillOpacity: z.number().min(0).max(1).default(0.45),
    /** Outline colour; omitted = no outline. */
    outline: Color.optional(),
    /** Visible inside these windows (0.6 s fade in/out). */
    show: z.array(ChapterWindow).min(1),
    sourceIds: z.array(Id),
  })
  .strict();
export type MapArea = z.infer<typeof MapArea>;

export const MapData = z
  .object({
    area: z
      .object({
        bbox: z
          .object({ lonMin: z.number(), lonMax: z.number(), latMin: z.number(), latMax: z.number() })
          .strict()
          .refine((b) => b.lonMin < b.lonMax && b.latMin < b.latMax, "empty bbox"),
        widthUnits: z.number().positive().default(10),
      })
      .strict(),
    terrain: z
      .object({
        /** Header JSON written by server/src/geo/build.ts (points to the Int16 grid). */
        asset: z.string().min(1),
        /** Shown in the disclaimers; the scene must say it. */
        verticalExaggeration: z.number().min(1).max(50),
      })
      .strict(),
    boundaries: z
      .object({
        /** GeoJSON FeatureCollection of (Multi)Polygons with a `name` property. */
        asset: z.string().min(1),
        /** Feature name of the subject area, drawn in colour with a dashed land border. Omitted or "" = no focus (see above). */
        focus: z.string().optional(),
        /** Features drawn pale (all other land is drawn pale too, slightly lighter). Ignored without focus. */
        neighbors: z.array(z.string().min(1)).default([]),
        outlineColor: Color.default("#d23b2a"),
      })
      .strict(),
    rivers: z
      .object({
        /** GeoJSON FeatureCollection of (Multi)LineStrings with an `id` property. */
        asset: z.string().min(1),
        items: z.array(
          z
            .object({
              id: Id,
              /** Relative tube width, 1 = main river. */
              width: z.number().positive().default(1),
              /** Glow windows (fade in/out 0.6 s). */
              highlight: z.array(ChapterWindow).default([]),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    colorModes: z.array(ColorMode).min(1),
    /** Per chapter, colour mode by time (step function). Chapters not listed use colorModes[0]. */
    colorModeTrack: z.record(Id, z.array(z.object({ at: z.number().min(0), mode: Id }).strict()).min(1)).default({}),
    /** Small 3D dots under the chapter's visible `city` pins. */
    cityMarkers: z.boolean().default(true),
    columns: z
      .object({
        color: Color.default("#d9502b"),
        /** Scene units of the tallest column. */
        maxHeight: z.number().positive().default(2.4),
        items: z
          .array(z.object({ pinId: Id, geo: LonLat, value: z.number().min(0), sourceIds: z.array(Id).min(1) }).strict())
          .min(1),
        /** Columns grow (ease-out, `grow` seconds) from `from` and stay until `to` / chapter end. */
        show: z.array(ChapterWindow.extend({ grow: z.number().positive().default(1.2) }).strict()).min(1),
      })
      .strict()
      .optional(),
    effects: z.array(Eruption).default([]),
    routes: z.array(Route).default([]),
    areas: z.array(MapArea).default([]),
  })
  .strict();
export type MapData = z.infer<typeof MapData>;
export type MapDataInput = z.input<typeof MapData>;

/**
 * Cross-checks the schema cannot do: chapter/source/route ids, windows in order, routes and areas
 * inside the map, dated routes with sources. Same Issue shape as checkSemantics.
 */
export function checkMapData(
  data: MapData,
  scene: Pick<z.infer<typeof SceneBase>, "chapters" | "sources">,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const chapterIds = new Set(scene.chapters.map((c) => c.id));
  const sourceIds = new Set(scene.sources.map((s) => s.id));
  const b = data.area.bbox;
  const inside = ([lon, lat]: [number, number]) => lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;
  const windows = (path: string, ws: ChapterWindow[]) =>
    ws.forEach((w, k) => {
      if (!chapterIds.has(w.chapter)) add(`${path}.show[${k}]`, `unknown chapter "${w.chapter}"`);
      if (w.from !== undefined && w.to !== undefined && w.from > w.to) add(`${path}.show[${k}]`, "window ends before it starts");
    });
  const sources = (path: string, ids: string[]) => {
    for (const id of ids) if (!sourceIds.has(id)) add(path, `unknown source id "${id}"`);
  };
  const routeIds = new Set<string>();
  data.routes.forEach((r, i) => {
    const path = `engineData.routes[${i}]`;
    if (routeIds.has(r.id)) add(path, `duplicate route id "${r.id}"`);
    routeIds.add(r.id);
    windows(path, r.show);
    sources(path, r.sourceIds);
    if ((r.dates || /\d/.test(r.label)) && r.sourceIds.length === 0) add(path, "dated route without source");
    r.path.forEach((p, k) => {
      if (!inside(p)) add(`${path}.path[${k}]`, "point outside the map area");
    });
  });
  const areaIds = new Set<string>();
  data.areas.forEach((a, i) => {
    const path = `engineData.areas[${i}]`;
    if (areaIds.has(a.id)) add(path, `duplicate area id "${a.id}"`);
    areaIds.add(a.id);
    windows(path, a.show);
    sources(path, a.sourceIds);
  });
  scene.chapters.forEach((ch, c) =>
    ch.pins.forEach((p, i) => {
      const an = p.anchor;
      if ("entity" in an && an.entity === "route" && !routeIds.has(an.part ?? "")) add(`chapters[${c}].pins[${i}]`, `anchor on unknown route "${an.part}"`);
      if ("geo" in an && !inside(an.geo)) add(`chapters[${c}].pins[${i}]`, "pin outside the map area");
    }),
  );
  return issues;
}
