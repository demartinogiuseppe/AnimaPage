// TimelineData: owned by the `timeline` engine (brief §4.2).
//
// Events laid out along a horizontal time axis, each shown by a procedural
// symbol (column, crown, ship...). Everything is declarative so an LLM can fill it.
//
// Years: integers, BCE negative (-753 = 753 a.C.), CE positive. There is no
// year 0; the axis maps years linearly, so the one-year gap across 1 a.C./1 d.C.
// is ignored.
//
// Entity anchors resolved by the engine (for pins and camera targets):
// - { entity: "event", part: "<eventId>" }   top of the event's symbol (follows its grow animation)
// - { entity: "period", part: "<periodId>" } centre of the period band, on the axis
// - { entity: "year", part: "-753" }         point on the axis at that year
// - { entity: "cursor" }                     the chapter's moving "now" marker (if the chapter has one)
// All accept the usual `offset`.
import { z } from "zod";
import { Id, TimeRange, type SceneBase } from "../common.ts";

/** Procedural symbols the engine knows how to build. */
export const TimelineSymbol = z.enum([
  "column",
  "crown",
  "ship",
  "book",
  "scroll",
  "sword",
  "pyramid",
  "temple",
  "shield",
  "wheel",
  "amphora",
  "tower",
]);
export type TimelineSymbol = z.infer<typeof TimelineSymbol>;

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Year = z.number().int();

export const TimelineAxis = z
  .object({
    from: Year,
    to: Year,
    /** Years between ticks (100 = one tick per century). */
    tick: z.number().int().positive(),
    /** Tick label style: "era" -> "753 a.C." / "476 d.C."; "plain" -> "1848". */
    labels: z.enum(["era", "plain"]),
  })
  .strict();

export const TimelinePeriod = z
  .object({
    id: Id,
    name: z.string().min(1),
    from: Year,
    to: Year,
    color: Color,
    sourceIds: z.array(Id).min(1),
  })
  .strict();

export const TimelineEvent = z
  .object({
    id: Id,
    /** Single year, or start of a range. */
    year: Year,
    /** End of a range (inclusive); omitted = single year. */
    to: Year.optional(),
    title: z.string().min(1),
    symbol: TimelineSymbol,
    /** Main colour of the symbol; omitted = the symbol's default material. */
    color: Color.optional(),
    /** "major" events get a bigger symbol. */
    emphasis: z.enum(["normal", "major"]).optional(),
    sourceIds: z.array(Id).min(1),
  })
  .strict();

export const TimelineChapter = z
  .object({
    chapter: Id,
    /**
     * Events/periods revealed in earlier chapters (in scene order) stay visible from t=0.
     * Default true.
     */
    carryOver: z.boolean().optional(),
    /** Events that appear (grow) at chapter time `at`; `glow` = windows of emphasis (pulsing glow). */
    events: z.array(z.object({ id: Id, at: z.number().min(0), glow: z.array(TimeRange).optional() }).strict()),
    /** Period bands that grow along the axis from chapter time `at`. */
    periods: z.array(z.object({ id: Id, at: z.number().min(0) }).strict()).optional(),
    /** "Now" marker sliding along the axis: keyframes, eased between consecutive keys. */
    cursor: z.array(z.object({ at: z.number().min(0), year: z.number() }).strict()).optional(),
  })
  .strict();

export const TimelineData = z
  .object({
    axis: TimelineAxis,
    periods: z.array(TimelinePeriod),
    events: z.array(TimelineEvent).min(1),
    chapters: z.array(TimelineChapter),
  })
  .strict()
  .superRefine((d, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (d.axis.to <= d.axis.from) add(["axis", "to"], "axis must end after it starts");
    const inAxis = (y: number) => y >= d.axis.from && y <= d.axis.to;
    const periodIds = new Set<string>();
    d.periods.forEach((p, i) => {
      if (periodIds.has(p.id)) add(["periods", i, "id"], `duplicate period id "${p.id}"`);
      periodIds.add(p.id);
      if (p.to < p.from) add(["periods", i], "period ends before it starts");
      if (!inAxis(p.from) || !inAxis(p.to)) add(["periods", i], "period outside the axis");
    });
    const eventIds = new Set<string>();
    d.events.forEach((e, i) => {
      if (eventIds.has(e.id)) add(["events", i, "id"], `duplicate event id "${e.id}"`);
      eventIds.add(e.id);
      if (e.to !== undefined && e.to < e.year) add(["events", i, "to"], "event ends before it starts");
      if (!inAxis(e.year) || !inAxis(e.to ?? e.year)) add(["events", i], "event outside the axis");
    });
    d.chapters.forEach((c, i) => {
      c.events.forEach((e, k) => {
        if (!eventIds.has(e.id)) add(["chapters", i, "events", k], `unknown event "${e.id}"`);
        e.glow?.forEach(([a, b], w) => {
          if (a > b) add(["chapters", i, "events", k, "glow", w], "window ends before it starts");
        });
      });
      c.periods?.forEach((p, k) => {
        if (!periodIds.has(p.id)) add(["chapters", i, "periods", k], `unknown period "${p.id}"`);
      });
      let prev = -1;
      c.cursor?.forEach((k, j) => {
        if (k.at < prev) add(["chapters", i, "cursor", j], "cursor keys must be in order");
        prev = k.at;
      });
    });
  });
export type TimelineData = z.infer<typeof TimelineData>;

/**
 * Cross-checks against the rest of the scene that the schema alone cannot do
 * (chapter ids, source ids). Same Issue shape as checkSemantics.
 */
export function checkTimelineData(
  data: TimelineData,
  scene: Pick<z.infer<typeof SceneBase>, "chapters" | "sources">,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const chapterIds = new Set(scene.chapters.map((c) => c.id));
  const sourceIds = new Set(scene.sources.map((s) => s.id));
  const checkSources = (path: string, ids: string[]) => {
    for (const id of ids) if (!sourceIds.has(id)) issues.push({ path, message: `unknown source id "${id}"` });
  };
  data.periods.forEach((p, i) => checkSources(`engineData.periods[${i}]`, p.sourceIds));
  data.events.forEach((e, i) => checkSources(`engineData.events[${i}]`, e.sourceIds));
  const seen = new Set<string>();
  data.chapters.forEach((c, i) => {
    const path = `engineData.chapters[${i}]`;
    if (!chapterIds.has(c.chapter)) issues.push({ path, message: `unknown chapter "${c.chapter}"` });
    if (seen.has(c.chapter)) issues.push({ path, message: `duplicate chapter "${c.chapter}"` });
    seen.add(c.chapter);
  });
  return issues;
}
