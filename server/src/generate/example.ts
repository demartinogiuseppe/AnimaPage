// One compact example per engine, derived from the hand-written reference scenes in
// fixtures/public/scenes/: one chapter, a few sentences/pins, and only the engine data that
// chapter uses. It shows the shape and the style; the model is told never to copy its content.
//
// The example is part of the prompt: editing a reference scene changes the request hash, so
// the recordings in fixtures/llm/ must be re-recorded.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Chapter, EngineId, SceneSpec } from "@pv/scene-spec";
import { inFieldOrder } from "./schema.ts";

export const REFERENCE_SCENES_DIR = fileURLToPath(new URL("../../../fixtures/public/scenes/", import.meta.url));

/** Reference scene and chapter used as the example of each engine. */
/** New engines join once they have a reference scene (they are not offered to the analysis before that). */
export const EXAMPLE_SOURCES: Partial<Record<EngineId, { scene: string; chapter: number }>> = {
  map: { scene: "campania", chapter: 0 },
  battle: { scene: "troia", chapter: 1 },
  timeline: { scene: "timeline-esempio", chapter: 0 },
  diorama: { scene: "racconto-elettricista", chapter: 0 },
  process: { scene: "scienze-sensi", chapter: 0 },
  concept: { scene: "grammatica-indicativo", chapter: 0 },
  card: { scene: "card-esempio", chapter: 0 },
  // Chapters chosen to differ from the synthetic test pages (fasi lunari, piano inclinato, popolazione).
  sky: { scene: "cielo-stagioni", chapter: 1 },
  lab: { scene: "laboratorio-energia", chapter: 0 },
  chart: { scene: "dati-campania", chapter: 1 },
  stage: { scene: "palcoscenico-dialogo", chapter: 0 },
  art: { scene: "arte-ultima-cena", chapter: 1 },
  solid: { scene: "geometria-solidi", chapter: 0 },
  earth: { scene: "terra-sezione", chapter: 0 },
  music: { scene: "musica-pentagramma", chapter: 1 },
  workshop: { scene: "officina-mulino", chapter: 1 },
};

/**
 * Original example lessons (written for AnimaPage, not from a book page) used when the reference scene
 * above is missing: the public copy leaves out the references reconstructed from book pages
 * (tools/publish/exclude.txt). With the reference present nothing changes.
 */
export const EXAMPLE_FALLBACKS: Partial<Record<EngineId, { scene: string; chapter: number }>> = {
  map: { scene: "esempio-mappa-fiumi-europa", chapter: 0 },
  diorama: { scene: "esempio-diorama-torta-volante", chapter: 0 },
  process: { scene: "esempio-processo-ciclo-acqua", chapter: 0 },
  concept: { scene: "esempio-concetto-nome", chapter: 0 },
};

/** Maths pages use the function-study reference instead (chapter "simmetria": graphs + mirror). */
export const MATH_EXAMPLE = { scene: "matematica-parabola", chapter: 2 };

const LIMITS = { narration: 5, pins: 5, deep: 1, quiz: 2, camera: 3, cues: 4, items: 14 };

type Json = Record<string, unknown>;
type AnyData = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function trimChapter(ch: Chapter): Chapter {
  const narration = ch.narration.slice(0, LIMITS.narration);
  const named = new Set(narration.flatMap((s) => s.highlight));
  const pins = [...ch.pins.filter((p) => named.has(p.id)), ...ch.pins.filter((p) => !named.has(p.id))].slice(0, LIMITS.pins);
  const pinIds = new Set(pins.map((p) => p.id));
  const quiz = ch.quiz.filter((q) => q.type === "choice" || q.answerPins.every((id) => pinIds.has(id))).slice(0, LIMITS.quiz);
  return {
    ...ch,
    narration: narration.map((s) => ({ ...s, highlight: s.highlight.filter((id) => pinIds.has(id)) })),
    camera: ch.camera.slice(0, LIMITS.camera),
    pins,
    deep: ch.deep.slice(0, LIMITS.deep),
    quiz,
    ...(ch.sounds ? { sounds: { ambience: ch.sounds.ambience, cues: ch.sounds.cues.slice(0, LIMITS.cues) } } : {}),
  };
}

/** Collects every string value in a JSON tree (ids referenced anywhere). */
function strings(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** Keeps only the engine data the chosen chapter uses. */
function trimEngineData(engine: EngineId, data: AnyData, chapter: Chapter): AnyData {
  const id = chapter.id;
  const ofChapter = (list: AnyData[] | undefined) => (list ?? []).filter((c) => c.chapter === id);
  switch (engine) {
    case "map":
      return {
        ...data,
        rivers: data.rivers && { ...data.rivers, items: data.rivers.items.slice(0, 2) },
        colorModeTrack: id in (data.colorModeTrack ?? {}) ? { [id]: data.colorModeTrack[id] } : {},
        columns: data.columns?.show.some((s: AnyData) => s.chapter === id) ? data.columns : undefined,
        effects: ofChapter(data.effects),
        ...(data.routes ? { routes: data.routes.filter((r: AnyData) => r.show.some((w: AnyData) => w.chapter === id)) } : {}),
        ...(data.areas ? { areas: data.areas.filter((a: AnyData) => a.show.some((w: AnyData) => w.chapter === id)) } : {}),
      };
    case "timeline": {
      const chapters = ofChapter(data.chapters);
      const used = strings(chapters);
      return {
        ...data,
        periods: data.periods.filter((p: AnyData) => used.has(p.id)),
        events: data.events.filter((e: AnyData) => used.has(e.id)),
        chapters,
      };
    }
    case "diorama": {
      const chapters = ofChapter(data.chapters);
      const used = strings([chapters, chapter.pins, chapter.camera]);
      const refd = (it: AnyData) => [...used].some((s) => s === it.id || s.startsWith(`${it.id}.`));
      const items = [...data.items.filter(refd), ...data.items.filter((it: AnyData) => !refd(it))].slice(0, LIMITS.items);
      return { ...data, items, chapters };
    }
    case "process": {
      const chapters = ofChapter(data.chapters);
      const used = strings(chapters);
      const parts: AnyData[] = data.parts;
      const keep = new Set(parts.filter((p) => used.has(p.id)).map((p) => p.id as string));
      // Children of a listed part come with it; parents must be kept too.
      for (const p of parts) if (p.parent && keep.has(p.parent)) keep.add(p.id);
      for (const p of [...parts].reverse()) if (keep.has(p.id) && p.parent) keep.add(p.parent);
      return {
        ...data,
        parts: parts.filter((p) => keep.has(p.id)),
        flows: data.flows.filter((f: AnyData) => used.has(f.id)),
        rays: data.rays.filter((r: AnyData) => used.has(r.id)),
        waves: data.waves.filter((w: AnyData) => used.has(w.id)),
        chapters,
      };
    }
    case "concept": {
      const chapters = ofChapter(data.chapters).map((c) => ({ ...c, carryOver: false }));
      const used = strings(chapters);
      const tiles = data.tiles.filter((t: AnyData) => used.has(t.id));
      // A graph is kept whole when the chapter uses it or any of its entities.
      const graphs = (data.graphs ?? []).filter((g: AnyData) => [...strings(g)].some((x) => used.has(x)) || used.has(g.id));
      const placed = strings(tiles.map((t: AnyData) => t.place));
      const roles = strings([tiles, chapters]);
      return {
        ...data,
        roles: data.roles.filter((r: AnyData) => roles.has(r.id)),
        rows: data.rows.filter((r: AnyData) => placed.has(r.id) || used.has(r.id)),
        axes: data.axes.filter((a: AnyData) => used.has(a.id) || placed.has(a.id)),
        tiles,
        shapes: data.shapes.filter((s: AnyData) => used.has(s.id)),
        links: data.links.filter((l: AnyData) => used.has(l.id)),
        ...(data.graphs ? { graphs } : {}),
        chapters,
      };
    }
    case "battle": {
      const inChapter = (ph: AnyData) => !ph.chapters || ph.chapters.includes(id);
      const withPhases = (list: AnyData[] | undefined) =>
        (list ?? []).map((g) => ({ ...g, phases: g.phases.filter(inChapter) })).filter((g) => g.phases.length > 0);
      return {
        ...data,
        armies: withPhases(data.armies),
        vehicles: withPhases(data.vehicles),
        figures: withPhases(data.figures),
        props: withPhases(data.props),
        effects: ofChapter(data.effects),
        night: ofChapter(data.night),
      };
    }
    case "art": {
      const chapters = ofChapter(data.chapters);
      const used = strings([chapters, chapter.pins, chapter.camera, chapter.activity]);
      const keep = (list: AnyData[] | undefined) => (list ?? []).filter((x) => used.has(x.id) || [...strings(x)].some((v) => used.has(v)));
      return { ...data, regions: keep(data.regions), overlays: keep(data.overlays), layers: keep(data.layers), params: keep(data.params), chapters };
    }
    default:
      // Newer engines keep their world and only the chosen chapter's entry.
      return Array.isArray(data.chapters) ? { ...data, chapters: ofChapter(data.chapters) } : data;
  }
}

const cache = new Map<string, string>();

/** The scene and chapter engineExample() reads in `dir`: the reference, or its fallback when the reference file is missing. */
export function exampleRef(engine: EngineId, dir = REFERENCE_SCENES_DIR, math = false): { scene: string; chapter: number } | undefined {
  if (math && engine === "concept") return MATH_EXAMPLE;
  const ref = EXAMPLE_SOURCES[engine];
  const fallback = EXAMPLE_FALLBACKS[engine];
  return ref && fallback && !existsSync(`${dir}${ref.scene}.scene.json`) ? fallback : ref;
}

/** The compact example of an engine as minified JSON (`math`: the maths reference, concept engine). */
export function engineExample(engine: EngineId, dir = REFERENCE_SCENES_DIR, math = false): string {
  const key = `${engine}${math ? "-math" : ""}`;
  const hit = cache.get(key);
  if (hit && dir === REFERENCE_SCENES_DIR) return hit;
  const ref = exampleRef(engine, dir, math);
  if (!ref) throw new Error(`no reference scene for engine "${engine}" yet`);
  const scene = JSON.parse(readFileSync(`${dir}${ref.scene}.scene.json`, "utf8")) as SceneSpec;
  const src = scene.chapters[ref.chapter] ?? scene.chapters[0]!;
  const chapter = trimChapter(src);
  const engineData = trimEngineData(engine, scene.engineData as AnyData, chapter);
  const used = strings([chapter, engineData]);
  // Keys in the order the model should write them (engineData before chapters, D25).
  const example: Json = inFieldOrder({
    ...scene,
    chapters: [chapter],
    sources: scene.sources.filter((s) => used.has(s.id)),
    videos: [],
    engineData,
  });
  const text = JSON.stringify(example);
  if (dir === REFERENCE_SCENES_DIR) cache.set(key, text);
  return text;
}
