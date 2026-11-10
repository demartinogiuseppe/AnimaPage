// Per-engine authoring guides for the generation prompt (units, anchors, camera, what makes a good scene).
// Changing any text changes the request hash: re-record fixtures/llm/ and bump GENERATE_PROMPT_VERSION.
import type { EngineId } from "@pv/scene-spec";
import { ART_GUIDE } from "./art.ts";
import { BATTLE_GUIDE } from "./battle.ts";
import { CARD_GUIDE } from "./card.ts";
import { CHART_GUIDE } from "./chart.ts";
import { CONCEPT_GUIDE } from "./concept.ts";
import { DIORAMA_GUIDE } from "./diorama.ts";
import { EARTH_GUIDE } from "./earth.ts";
import { LAB_GUIDE } from "./lab.ts";
import { MAP_GUIDE } from "./map.ts";
import { MUSIC_GUIDE } from "./music.ts";
import { PROCESS_GUIDE } from "./process.ts";
import { SKY_GUIDE } from "./sky.ts";
import { SOLID_GUIDE } from "./solid.ts";
import { STAGE_GUIDE } from "./stage.ts";
import { TIMELINE_GUIDE } from "./timeline.ts";
import { WORKSHOP_GUIDE } from "./workshop.ts";

export { CONTENT_RULES, SCENE_RULES, SYSTEM_PROMPT } from "./common.ts";
export { MATH_GUIDE } from "./math.ts";

export const ENGINE_GUIDES: Partial<Record<EngineId, string>> = {
  map: MAP_GUIDE,
  battle: BATTLE_GUIDE,
  timeline: TIMELINE_GUIDE,
  diorama: DIORAMA_GUIDE,
  process: PROCESS_GUIDE,
  concept: CONCEPT_GUIDE,
  stage: STAGE_GUIDE,
  chart: CHART_GUIDE,
  lab: LAB_GUIDE,
  art: ART_GUIDE,
  sky: SKY_GUIDE,
  music: MUSIC_GUIDE,
  solid: SOLID_GUIDE,
  earth: EARTH_GUIDE,
  workshop: WORKSHOP_GUIDE,
  card: CARD_GUIDE,
};
