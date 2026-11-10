// SceneSpec: the central contract between server (producer) and engine (consumer).
// The renderer never calls an AI: it only receives this validated JSON.
//
// Difference from the brief's sketch: `engineData` lives on the scene, not on each
// chapter, because chapters share one world (one terrain, one battlefield).
// Engine data refers to chapters by id where it is chapter-specific.
import { z } from "zod";
import { SceneBase } from "./common.ts";
import { BattleData } from "./engines/battle.ts";
import { ArtData, checkArtData } from "./engines/art.ts";
import { CardData } from "./engines/card.ts";
import { ChartData, checkChartData } from "./engines/chart.ts";
import { checkConceptData, ConceptData } from "./engines/concept.ts";
import { checkDioramaData, DioramaData } from "./engines/diorama.ts";
import { checkFacadeData, FacadeData } from "./engines/facade.ts";
import { checkLabData, LabData } from "./engines/lab.ts";
import { checkMapData, MapData } from "./engines/map.ts";
import { checkProcessData, ProcessData } from "./engines/process.ts";
import { checkSkyData, SkyData } from "./engines/sky.ts";
import { checkEarthData, EarthData } from "./engines/earth.ts";
import { checkMusicData, MusicData } from "./engines/music.ts";
import { checkStorybookData, StorybookData } from "./engines/storybook.ts";
import { checkSolidData, SolidData } from "./engines/solid.ts";
import { checkStageData, StageData } from "./engines/stage.ts";
import { checkTimelineData, TimelineData } from "./engines/timeline.ts";
import { checkWorkshopData, WorkshopData } from "./engines/workshop.ts";
import { checkSoundIds } from "./sounds.ts";
import { checkSemantics, type Issue } from "./validate.ts";

export * from "./common.ts";
export * from "./validate.ts";
export * from "./sounds.ts";
export * from "./analysis.ts";
export * from "./clock.ts";
export * from "./audience.ts";
export * from "./unexposed.ts";
export * from "./engines/battle.ts";
export * from "./engines/card.ts";
export * from "./engines/concept.ts";
export * from "./engines/diorama.ts";
export * from "./engines/map.ts";
export * from "./engines/process.ts";
export * from "./engines/timeline.ts";
export * from "./engines/sky.ts";
export * from "./engines/lab.ts";
export * from "./engines/chart.ts";
export * from "./engines/stage.ts";
export * from "./engines/art.ts";
export * from "./engines/solid.ts";
export * from "./engines/facade.ts";
export * from "./engines/storybook.ts";
export * from "./storybook-sounds.ts";
export * from "./engines/earth.ts";
export * from "./engines/music.ts";
export * from "./engines/workshop.ts";

export const SCENE_SPEC_VERSION = "0.1";

export const EngineId = z.enum(["map", "battle", "timeline", "diorama", "process", "concept", "sky", "lab", "chart", "stage", "art", "solid", "earth", "music", "workshop", "card", "facade", "storybook"]);
export type EngineId = z.infer<typeof EngineId>;

export const SceneSpec = z.discriminatedUnion("engine", [
  SceneBase.extend({ engine: z.literal("map"), engineData: MapData }).strict(),
  SceneBase.extend({ engine: z.literal("battle"), engineData: BattleData }).strict(),
  SceneBase.extend({ engine: z.literal("timeline"), engineData: TimelineData }).strict(),
  SceneBase.extend({ engine: z.literal("diorama"), engineData: DioramaData }).strict(),
  SceneBase.extend({ engine: z.literal("process"), engineData: ProcessData }).strict(),
  SceneBase.extend({ engine: z.literal("concept"), engineData: ConceptData }).strict(),
  SceneBase.extend({ engine: z.literal("sky"), engineData: SkyData }).strict(),
  SceneBase.extend({ engine: z.literal("lab"), engineData: LabData }).strict(),
  SceneBase.extend({ engine: z.literal("chart"), engineData: ChartData }).strict(),
  SceneBase.extend({ engine: z.literal("stage"), engineData: StageData }).strict(),
  SceneBase.extend({ engine: z.literal("art"), engineData: ArtData }).strict(),
  SceneBase.extend({ engine: z.literal("solid"), engineData: SolidData }).strict(),
  SceneBase.extend({ engine: z.literal("earth"), engineData: EarthData }).strict(),
  SceneBase.extend({ engine: z.literal("music"), engineData: MusicData }).strict(),
  SceneBase.extend({ engine: z.literal("workshop"), engineData: WorkshopData }).strict(),
  SceneBase.extend({ engine: z.literal("card"), engineData: CardData }).strict(),
  SceneBase.extend({ engine: z.literal("facade"), engineData: FacadeData }).strict(),
  SceneBase.extend({ engine: z.literal("storybook"), engineData: StorybookData }).strict(),
]);
export type SceneSpec = z.infer<typeof SceneSpec>;

/** Common semantic checks plus the engine-specific and sound ones. */
export function checkScene(spec: SceneSpec): Issue[] {
  const issues = checkSemantics(spec);
  if (spec.engine === "map") issues.push(...checkMapData(spec.engineData, spec));
  if (spec.engine === "timeline") issues.push(...checkTimelineData(spec.engineData, spec));
  if (spec.engine === "process") issues.push(...checkProcessData(spec.engineData, spec));
  if (spec.engine === "diorama") issues.push(...checkDioramaData(spec.engineData, spec));
  if (spec.engine === "concept") issues.push(...checkConceptData(spec.engineData, spec));
  if (spec.engine === "stage") issues.push(...checkStageData(spec.engineData, spec));
  if (spec.engine === "chart") issues.push(...checkChartData(spec.engineData, spec));
  if (spec.engine === "lab") issues.push(...checkLabData(spec.engineData, spec));
  if (spec.engine === "art") issues.push(...checkArtData(spec.engineData, spec));
  if (spec.engine === "sky") issues.push(...checkSkyData(spec.engineData, spec));
  if (spec.engine === "music") issues.push(...checkMusicData(spec.engineData, spec));
  if (spec.engine === "solid") issues.push(...checkSolidData(spec.engineData, spec));
  if (spec.engine === "earth") issues.push(...checkEarthData(spec.engineData, spec));
  if (spec.engine === "facade") issues.push(...checkFacadeData(spec.engineData, spec));
  if (spec.engine === "storybook") issues.push(...checkStorybookData(spec.engineData, spec));
  if (spec.engine === "workshop") issues.push(...checkWorkshopData(spec.engineData, spec));
  issues.push(...checkSoundIds(spec));
  return issues;
}
