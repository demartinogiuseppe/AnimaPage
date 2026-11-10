// ChartData: owned by the `chart` engine ("Dati": animated 3D infographics for tables and
// charts on geography, history, science, civics and economics pages).
//
// Data first: `datasets` hold the numbers (categories x series), each series with its sources;
// `charts` say how a dataset is drawn; `chapters` say which charts are on stage and what
// happens to them over time (grow-in, highlight, sort, switch series, compare, annotate,
// sweep through time). Everything is declarative so an LLM can fill it.
//
// Every number must be sourced: each series carries `sourceIds` (scene sources). When the book
// and a verified source disagree, put both in the dataset as two series ("Libro", "ISTAT 2026")
// and show the difference with `switch` or a grouped chart: never silently pick one.
//
// Units and conventions
// - Scene units; y up; the main view is from +z (camera azimuth 0). A chart stands on the
//   ground plane y = 0, centred on its `pos` (default the origin). `size` = [width, height,
//   depth] of its plot box, default [12, 6, 3]; keep charts inside a ~20-unit box. All
//   chapters share the origin: a chart is drawn only in chapters that list it.
// - Category axis along +x (left to right in dataset order); values grow along +y.
//   Categories with `x` (years) are placed proportionally to x: a time axis.
// - Pies and donuts lie flat on the ground (look at them from elevation 35-60); slices start
//   at the back (-z) and go clockwise seen from above.
// - Numbers are shown in Italian format (5.590.076; 13,5 %).
//
// Entity anchors resolved by the engine (pins and camera targets), all accept `offset`:
// - { entity: "chart",  part: "<chartId>" }               centre of the chart's plot box
// - { entity: "item",   part: "<chartId>", index: k }     just above category k's mark and its value
//                                                          label (bar top, line point, slice, icon stack,
//                                                          bubble), following sort/switch/growth; on a time
//                                                          axis unresolved until the point is reached
//   { entity: "item",   part: "<chartId>:<seriesId>", index: k }   same, for one series of a
//                                                          grouped/stacked/multi-line chart
// - { entity: "cursor", part: "<chartId>" }               current cursor point (head of the line
//                                                          being drawn, or the focused category)
//
// Cursor and "Prova tu" slider: a chart with `cursor` exposes a slider (list its id in
// chapter.activity.test.params). On a time axis (every category has `x`) the cursor is a year:
// later points are hidden and the last one reached is read out. Otherwise the cursor is a
// position 1..n in the current display order: that category is focused (glow; pies explode it).
// The `sweep` action moves the cursor over a time window (play through time).
import { z } from "zod";
import { Id, type SceneBase } from "../common.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Len = z.number().positive();
const Time = z.number().min(0);
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const ChartCategory = z
  .object({
    id: Id,
    /** Axis label (Italian), e.g. "Napoli", "1861", "gen". */
    label: z.string().min(1),
    /** Numeric position for time axes (the year). Give it on every category or on none. */
    x: z.number().optional(),
    /** Colour of this category's mark in single-series charts (pie slices, bars). */
    color: Color.optional(),
  })
  .strict();
export type ChartCategory = z.infer<typeof ChartCategory>;

export const ChartSeries = z
  .object({
    id: Id,
    /** Legend label (Italian), e.g. "Libro", "ISTAT 2026", "Temperatura". */
    label: z.string().min(1),
    color: Color.optional(),
    /** One value per category, in category order; null = no data (not drawn). */
    values: z.array(z.number().nullable()).min(1),
    /** Overrides the dataset unit (climographs: "°C" and "mm"). */
    unit: z.string().min(1).optional(),
    /** Overrides the dataset decimals (a book rounds to 51 %, the source says 50,8 %). */
    decimals: z.number().int().min(0).max(3).optional(),
    /** Where these numbers come from: scene source ids (the page, a dataset, a computed source). */
    sourceIds: z.array(Id).min(1),
  })
  .strict();
export type ChartSeries = z.infer<typeof ChartSeries>;

export const ChartDataset = z
  .object({
    id: Id,
    /** Chart title (Italian), e.g. "Abitanti per provincia". */
    title: z.string().min(1),
    /** Unit of the values (Italian): "abitanti", "%", "km²", "°C", "mm", "t". */
    unit: z.string().min(1),
    /** Decimals shown in labels (default 0). */
    decimals: z.number().int().min(0).max(3).optional(),
    categories: z.array(ChartCategory).min(1).max(40),
    series: z.array(ChartSeries).min(1).max(8),
  })
  .strict();
export type ChartDataset = z.infer<typeof ChartDataset>;

export const ChartCursor = z
  .object({
    /** Parameter id for activity.test.params, e.g. "anno". */
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,15}$/),
    /** Slider caption (Italian), e.g. "Anno", "Provincia". */
    label: z.string().min(1),
  })
  .strict();

const chartFields = {
  id: Id,
  dataset: Id,
  /** Default: the dataset title. */
  title: z.string().min(1).optional(),
  pos: Vec3.optional(),
  /** [width, height, depth] of the plot box; default [12, 6, 3]. */
  size: Vec3.optional(),
  /** Series drawn (default: all for bars and lines, the first one for the other kinds). */
  series: z.array(Id).min(1).optional(),
  cursor: ChartCursor.optional(),
  /** Value labels on the marks (default true; lines: false, the cursor reads them out). */
  values: z.boolean().optional(),
};
const chart = <T extends z.ZodRawShape>(shape: T) => z.object({ ...chartFields, ...shape }).strict();

export const ChartIcon = z.enum(["person", "house", "tree", "factory", "coin", "drop", "box"]);
export type ChartIcon = z.infer<typeof ChartIcon>;

export const Chart = z.discriminatedUnion("kind", [
  /** 3D bars (or columns): several series side by side (grouped) or on top of each other (stacked). */
  chart({
    kind: z.literal("bars"),
    layout: z.enum(["grouped", "stacked"]).optional(),
    shape: z.enum(["box", "cylinder"]).optional(),
  }),
  /** Line over the category/time axis; `area` fills below it. */
  chart({ kind: z.literal("line"), area: z.boolean().optional() }),
  /** Pie (donut 0) or donut (inner radius ratio, e.g. 0.5) lying on the ground; one series. */
  chart({
    kind: z.literal("pie"),
    donut: z.number().min(0).max(0.85).optional(),
    /** Default 4. */
    radius: Len.optional(),
    /** Slice height, default 0.6. */
    thickness: Len.optional(),
  }),
  /** Stacks of icons, one icon every `per` units ("1 omino = 100.000 abitanti"); one series. */
  chart({
    kind: z.literal("pictogram"),
    icon: ChartIcon,
    per: Len,
    /** Icons per row in a stack (default 3). */
    perRow: z.number().int().min(1).max(10).optional(),
  }),
  /** Proportional marks: spheres (volume ∝ value) or flat discs (area ∝ value); one series. */
  chart({
    kind: z.literal("bubbles"),
    shape: z.enum(["sphere", "disc"]).optional(),
    /** Radius of the largest value, default 2. */
    maxRadius: Len.optional(),
  }),
  /**
   * Arrows from node to node with width ∝ value (migrations, trade, water). Each link takes the
   * value of one category of the (single) series. Node positions are [x, z] on the ground, chart-local.
   */
  chart({
    kind: z.literal("flows"),
    nodes: z.array(z.object({ id: Id, label: z.string().min(1), pos: z.tuple([z.number(), z.number()]) }).strict()).min(2),
    links: z.array(z.object({ category: Id, from: Id, to: Id }).strict()).min(1),
    /** Width of the largest link, default 0.6. */
    maxWidth: Len.optional(),
  }),
  /** Climograph: rainfall bars (left axis) + temperature line (right axis) over the months. */
  chart({ kind: z.literal("climograph"), rain: Id, temp: Id }),
]);
export type Chart = z.infer<typeof Chart>;
export type ChartKind = Chart["kind"];

/** A chart on stage in a chapter. */
export const ChartItem = z
  .object({
    id: Id,
    /** Appears at this time (default 0). */
    at: Time.optional(),
    /** Gone by this time (fades out just before). */
    until: Time.optional(),
    /** Seconds the marks take to grow in, one category after the other (default 2). */
    grow: Len.optional(),
  })
  .strict();
export type ChartItem = z.infer<typeof ChartItem>;

/** Windows default to "until the end of the chapter". */
export const ChartAction = z.discriminatedUnion("do", [
  /** Glow these categories and/or series, dim the rest (pies: the slices pop out). */
  z
    .object({
      do: z.literal("highlight"),
      chart: Id,
      at: Time,
      until: Time.optional(),
      categories: z.array(Id).optional(),
      series: z.array(Id).optional(),
    })
    .strict(),
  /** Reorder the categories by the value shown at that moment (bars, pictograms, bubbles, pies). */
  z.object({ do: z.literal("sort"), chart: Id, at: Time, order: z.enum(["desc", "asc", "original"]) }).strict(),
  /** Morph the chart to another series of its dataset (book value -> source value, year -> year). */
  z.object({ do: z.literal("switch"), chart: Id, at: Time, series: Id }).strict(),
  /** Two categories side by side: both glow, the rest dims, a level line marks the smaller value. */
  z
    .object({
      do: z.literal("compare"),
      chart: Id,
      at: Time,
      until: Time.optional(),
      categories: z.tuple([Id, Id]),
    })
    .strict(),
  /** Callout with a leader line, above a category's mark (or above the chart without `category`). */
  z
    .object({
      do: z.literal("annotate"),
      chart: Id,
      at: Time,
      until: Time.optional(),
      category: Id.optional(),
      series: Id.optional(),
      /** Short Italian text; numbers in it need sourceIds. */
      text: z.string().min(1).max(80),
      sourceIds: z.array(Id),
    })
    .strict(),
  /** Moves the cursor from the first to the last category over [at, until] (needs `cursor`). */
  z.object({ do: z.literal("sweep"), chart: Id, at: Time, until: Time }).strict(),
]);
export type ChartAction = z.infer<typeof ChartAction>;

export const ChartChapter = z
  .object({ chapter: Id, charts: z.array(ChartItem), actions: z.array(ChartAction) })
  .strict();
export type ChartChapter = z.infer<typeof ChartChapter>;

const SINGLE_SERIES = new Set<ChartKind>(["pie", "pictogram", "bubbles", "flows"]);
/** Kinds whose marks can be reordered. */
export const SORTABLE_KINDS: ReadonlySet<ChartKind> = new Set(["bars", "pictogram", "bubbles", "pie"]);

/** Series a chart draws (resolved defaults). */
export function chartSeries(c: Chart, d: ChartDataset): string[] {
  if (c.kind === "climograph") return [c.rain, c.temp];
  if (c.series) return c.series;
  return SINGLE_SERIES.has(c.kind) ? [d.series[0]!.id] : d.series.map((s) => s.id);
}

/** True when every category has a numeric `x` (a time axis). */
export const isTimeAxis = (d: ChartDataset) => d.categories.every((c) => c.x !== undefined);

export const ChartData = z
  .object({
    /** Background colour (default: warm paper). */
    background: Color.optional(),
    datasets: z.array(ChartDataset).min(1),
    charts: z.array(Chart).min(1),
    chapters: z.array(ChartChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const datasets = new Map<string, ChartDataset>();
    d.datasets.forEach((ds, i) => {
      if (datasets.has(ds.id)) add(["datasets", i, "id"], `duplicate dataset id "${ds.id}"`);
      datasets.set(ds.id, ds);
      const cats = new Set<string>();
      ds.categories.forEach((c, k) => {
        if (cats.has(c.id)) add(["datasets", i, "categories", k, "id"], `duplicate category id "${c.id}"`);
        cats.add(c.id);
      });
      const withX = ds.categories.filter((c) => c.x !== undefined).length;
      if (withX !== 0 && withX !== ds.categories.length) add(["datasets", i, "categories"], "give `x` on every category or on none");
      if (withX && ds.categories.some((c, k) => k > 0 && c.x! <= ds.categories[k - 1]!.x!))
        add(["datasets", i, "categories"], "`x` must increase along the categories");
      const ser = new Set<string>();
      ds.series.forEach((s, k) => {
        if (ser.has(s.id)) add(["datasets", i, "series", k, "id"], `duplicate series id "${s.id}"`);
        ser.add(s.id);
        if (s.values.length !== ds.categories.length)
          add(["datasets", i, "series", k, "values"], `${s.values.length} values for ${ds.categories.length} categories`);
      });
    });

    const charts = new Map<string, Chart>();
    d.charts.forEach((c, i) => {
      const at = ["charts", i];
      if (charts.has(c.id)) add([...at, "id"], `duplicate chart id "${c.id}"`);
      charts.set(c.id, c);
      if (c.id.includes(":")) add([...at, "id"], "chart ids cannot contain ':'");
      const ds = datasets.get(c.dataset);
      if (!ds) return add([...at, "dataset"], `unknown dataset "${c.dataset}"`);
      const ids = new Set(ds.series.map((s) => s.id));
      const shown = chartSeries(c, ds);
      for (const s of shown) if (!ids.has(s)) add(at, `unknown series "${s}" in dataset "${ds.id}"`);
      if (SINGLE_SERIES.has(c.kind) && shown.length !== 1) add([...at, "series"], `a ${c.kind} chart draws exactly one series`);
      if (c.size && c.size.some((v) => v <= 0)) add([...at, "size"], "size values must be positive");
      if (c.kind !== "line" && c.kind !== "climograph") {
        for (const s of ds.series.filter((x) => shown.includes(x.id)))
          if (s.values.some((v) => v !== null && v < 0)) add(at, `${c.kind} charts need values >= 0 (series "${s.id}")`);
      }
      if (c.kind === "flows") {
        const nodes = new Set<string>();
        c.nodes.forEach((n, k) => {
          if (nodes.has(n.id)) add([...at, "nodes", k, "id"], `duplicate node id "${n.id}"`);
          nodes.add(n.id);
        });
        const cats = new Set(ds.categories.map((x) => x.id));
        c.links.forEach((l, k) => {
          if (!cats.has(l.category)) add([...at, "links", k, "category"], `unknown category "${l.category}"`);
          if (!nodes.has(l.from)) add([...at, "links", k, "from"], `unknown node "${l.from}"`);
          if (!nodes.has(l.to)) add([...at, "links", k, "to"], `unknown node "${l.to}"`);
          if (l.from === l.to) add([...at, "links", k], "a link needs two different nodes");
        });
      }
    });

    const chapters = new Set<string>();
    d.chapters.forEach((ch, i) => {
      const at = ["chapters", i];
      if (chapters.has(ch.chapter)) add([...at, "chapter"], `duplicate chapter "${ch.chapter}"`);
      chapters.add(ch.chapter);
      const onStage = new Set<string>();
      ch.charts.forEach((it, k) => {
        if (!charts.has(it.id)) add([...at, "charts", k], `unknown chart "${it.id}"`);
        if (onStage.has(it.id)) add([...at, "charts", k], `chart "${it.id}" listed twice`);
        onStage.add(it.id);
        if (it.until !== undefined && it.until <= (it.at ?? 0)) add([...at, "charts", k], "`until` must come after `at`");
      });
      ch.actions.forEach((a, k) => {
        const path = [...at, "actions", k];
        const c = charts.get(a.chart);
        if (!c) return add(path, `unknown chart "${a.chart}"`);
        if (!onStage.has(a.chart)) add(path, `chart "${a.chart}" is not on stage in this chapter`);
        const ds = datasets.get(c.dataset);
        if (!ds) return;
        const cats = new Set(ds.categories.map((x) => x.id));
        const sers = new Set(ds.series.map((x) => x.id));
        const until = "until" in a ? a.until : undefined;
        if (until !== undefined && until <= a.at) add(path, "`until` must come after `at`");
        const needCat = (id: string | undefined) => id !== undefined && !cats.has(id) && add(path, `unknown category "${id}"`);
        const needSer = (id: string | undefined) => id !== undefined && !sers.has(id) && add(path, `unknown series "${id}"`);
        switch (a.do) {
          case "highlight":
            a.categories?.forEach(needCat);
            a.series?.forEach(needSer);
            if (!a.categories?.length && !a.series?.length) add(path, "highlight needs categories or series");
            break;
          case "sort":
            if (!SORTABLE_KINDS.has(c.kind)) add(path, `${c.kind} charts cannot be sorted`);
            if (c.kind === "bars" && isTimeAxis(ds)) add(path, "a time axis cannot be sorted");
            break;
          case "switch":
            needSer(a.series);
            if (c.kind === "climograph" || chartSeries(c, ds).length !== 1) add(path, "switch needs a chart that draws one series");
            break;
          case "compare":
            a.categories.forEach(needCat);
            if (a.categories[0] === a.categories[1]) add(path, "compare needs two different categories");
            break;
          case "annotate":
            needCat(a.category);
            needSer(a.series);
            break;
          case "sweep":
            if (!c.cursor) add(path, `chart "${c.id}" has no cursor`);
            break;
        }
      });
    });
  });
export type ChartData = z.infer<typeof ChartData>;

type Issue = { path: string; message: string };
type SceneLike = Pick<z.infer<typeof SceneBase>, "chapters" | "sources">;

const HAS_DIGIT = /\d/;
const ENTITIES = new Set(["chart", "item", "cursor"]);

/**
 * Cross-checks against the rest of the scene (chapter ids and durations, source ids, slider
 * params, entity anchors of pins and camera keys). Same Issue shape as checkSemantics.
 */
export function checkChartData(data: ChartData, scene: SceneLike): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const sources = new Set(scene.sources.map((s) => s.id));
  const datasets = new Map(data.datasets.map((d) => [d.id, d]));
  const charts = new Map(data.charts.map((c) => [c.id, c]));
  const plan = new Map(data.chapters.map((c) => [c.chapter, c]));

  data.datasets.forEach((d, i) =>
    d.series.forEach((s, k) => {
      for (const id of s.sourceIds) if (!sources.has(id)) add(`engineData.datasets[${i}].series[${k}]`, `unknown source id "${id}"`);
    }),
  );

  const chapterIds = new Set(scene.chapters.map((c) => c.id));
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    const ch = scene.chapters.find((x) => x.id === c.chapter);
    if (!ch) return add(path, `unknown chapter "${c.chapter}"`);
    c.charts.forEach((it, k) => {
      if ((it.at ?? 0) > ch.duration) add(`${path}.charts[${k}]`, `"${it.id}" appears after the chapter ends`);
    });
    c.actions.forEach((a, k) => {
      const ap = `${path}.actions[${k}]`;
      if (a.at > ch.duration || ("until" in a && a.until !== undefined && a.until > ch.duration + 1e-9))
        add(ap, `${a.do} on "${a.chart}" has a time after the chapter ends`);
      if (a.do === "annotate") {
        for (const id of a.sourceIds) if (!sources.has(id)) add(ap, `unknown source id "${id}"`);
        if (HAS_DIGIT.test(a.text) && a.sourceIds.length === 0) add(ap, `number or date without source: "${a.text}"`);
      }
    });
  });

  scene.chapters.forEach((ch, c) => {
    const at = `chapters[${c}]`;
    const onStage = new Set(plan.get(ch.id)?.charts.map((x) => x.id) ?? []);
    ch.activity?.test.params?.forEach((id, k) => {
      const owner = [...onStage].map((x) => charts.get(x)).find((x) => x?.cursor?.id === id);
      if (!owner) add(`${at}.activity.test.params[${k}]`, `"${id}" is not the cursor of a chart on stage in this chapter`);
    });
    const checkAnchor = (path: string, anchor: unknown) => {
      if (!anchor || typeof anchor !== "object" || !("entity" in anchor)) return;
      const a = anchor as { entity: string; part?: string; index?: number };
      if (!ENTITIES.has(a.entity)) return add(path, `unknown entity "${a.entity}" (chart, item, cursor)`);
      const [chartId, seriesId] = (a.part ?? "").split(":");
      const chart = charts.get(chartId ?? "");
      if (!chart) return add(path, `unknown chart "${a.part ?? ""}"`);
      if (!onStage.has(chart.id)) add(path, `chart "${chart.id}" is not on stage in this chapter`);
      const ds = datasets.get(chart.dataset);
      if (!ds) return;
      if (seriesId !== undefined && !chartSeries(chart, ds).includes(seriesId)) add(path, `chart "${chart.id}" does not draw series "${seriesId}"`);
      if (a.entity === "item") {
        if (a.index === undefined) add(path, "item anchors need an index (category position in the dataset)");
        else if (a.index >= ds.categories.length) add(path, `index ${a.index} out of range (${ds.categories.length} categories)`);
      }
      if (a.entity === "cursor" && !chart.cursor) add(path, `chart "${chart.id}" has no cursor`);
    };
    ch.pins.forEach((p, i) => checkAnchor(`${at}.pins[${i}].anchor`, p.anchor));
    ch.camera.forEach((k, i) => checkAnchor(`${at}.camera[${i}].target`, k.target));
    if (!plan.has(ch.id) && chapterIds.has(ch.id)) add(at, `chapter "${ch.id}" has no chart entry in engineData.chapters`);
  });
  return issues;
}
