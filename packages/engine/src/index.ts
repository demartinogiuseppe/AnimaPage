// three.js renderer: common player + one module per engine.
import type { EngineId } from "@pv/scene-spec";
import type { Engine } from "./types.ts";

export type { Engine, EngineContext, EngineParam } from "./types.ts";
export * from "./util/math.ts";
export * from "./player/index.ts";
export * from "./export/assets.ts";

/** Engines are loaded lazily so a scene only downloads the code it needs. */
export async function createEngine(id: EngineId): Promise<Engine> {
  switch (id) {
    case "map":
      return (await import("./engines/map/index.ts")).createMapEngine();
    case "battle":
      return (await import("./engines/battle/index.ts")).createBattleEngine();
    case "timeline":
      return (await import("./engines/timeline/index.ts")).createTimelineEngine();
    case "diorama":
      return (await import("./engines/diorama/index.ts")).createDioramaEngine();
    case "process":
      return (await import("./engines/process/index.ts")).createProcessEngine();
    case "concept":
      return (await import("./engines/concept/index.ts")).createConceptEngine();
    case "sky":
      return (await import("./engines/sky/index.ts")).createSkyEngine();
    case "lab":
      return (await import("./engines/lab/index.ts")).createLabEngine();
    case "chart":
      return (await import("./engines/chart/index.ts")).createChartEngine();
    case "stage":
      return (await import("./engines/stage/index.ts")).createStageEngine();
    case "art":
      return (await import("./engines/art/index.ts")).createArtEngine();
    case "solid":
      return (await import("./engines/solid/index.ts")).createSolidEngine();
    case "earth":
      return (await import("./engines/earth/index.ts")).createEarthEngine();
    case "music":
      return (await import("./engines/music/index.ts")).createMusicEngine();
    case "workshop":
      return (await import("./engines/workshop/index.ts")).createWorkshopEngine();
    case "card":
      return (await import("./engines/card/index.ts")).createCardEngine();
    case "storybook":
      return (await import("./engines/storybook/index.ts")).createStorybookEngine();
    case "facade":
      return (await import("./engines/facade/index.ts")).createFacadeEngine();
  }
}
