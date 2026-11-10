// Which ids activity.test.params may list, per engine (read from the scene-spec schemas). Appended
// after the engine guide: models used to invent ids ("regione-omini", "luna2") and paid a repair.
import type { EngineId } from "@pv/scene-spec";

const RULE = (where: string) =>
  `SLIDERS ("Prova tu"): activity.test.params may list ONLY ids you declare in ${where}. Never invent an id; if a chapter has no slider, omit params.`;

export const SLIDER_RULES: Partial<Record<EngineId, string>> = {
  concept: RULE('engineData.graphs[].params[].id of a graph that is on the board in that chapter (e.g. "a" for 1/(x − a))'),
  sky: RULE('that chapter\'s engineData entry params[].id (kinds day | hour | tilt | moon), e.g. { id: "luna", kind: "moon" } -> params ["luna"]'),
  chart: RULE('engineData.charts[].cursor.id of a chart shown in that chapter (the cursor IS the slider), e.g. cursor { id: "regione", label: "Regione" } -> params ["regione"]'),
  lab: RULE('that chapter\'s engineData entry params[].id (each bound with var to a variable of THAT chapter\'s setup kind and layout), e.g. { id: "angolo", var: "angle" } -> params ["angolo"]; vessels tower: { id: "serbatoio", var: "tankHeight" } -> params ["serbatoio"]'),
  stage: RULE('that chapter\'s engineData entry params[].id (kinds lights | spacing)'),
  solid: RULE('that chapter\'s engineData entry params[].id (dim a | b | c | l | h | r | r2 | k, with the solids it drives)'),
  earth: RULE('that chapter\'s engineData entry params[].id (var depth | speed | time | magnitude)'),
  music: RULE('that chapter\'s engineData entry params[].id (kinds tempo | transpose | instrument | value)'),
  art: RULE('engineData.params[].id (kinds guess-x | guess-y | opacity | depth)'),
  workshop: RULE('engineData.params[].id (variables used by the track formulas), e.g. { id: "k", label: "Velocità", ... } -> params ["k"]'),
};
