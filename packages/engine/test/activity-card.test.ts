// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ActivityView } from "../src/player/activity-ui.ts";
import { restrictsLabels } from "../src/player/pin-layer.ts";

const hooks = { choose() {}, prove() {}, params: () => [], setParams() {} };
const predict = {
  phase: "predict",
  choice: null,
  activity: { predict: { q: "Che cosa succede?", options: ["A", "B"], answer: 0 }, test: { prompt: "Prova", params: [] }, prove: {} },
};

const card = async (v: ActivityView): Promise<HTMLElement> => {
  await Promise.resolve();
  return v.el.querySelector<HTMLElement>(".pv-act-card")!;
};

describe("Prevedi card", () => {
  it("starts folded in every chapter", async () => {
    const v = new ActivityView(hooks as never);
    v.render({} as never, predict as never);
    expect((await card(v)).classList.contains("min")).toBe(true);
  });

  it("stays open once the reader opens it, and folds again in the next chapter", async () => {
    const v = new ActivityView(hooks as never);
    v.render({} as never, predict as never);
    (await card(v)).click();
    expect((await card(v)).classList.contains("min")).toBe(false);
    v.render({} as never, predict as never);
    expect((await card(v)).classList.contains("min")).toBe(false);
    v.resetValues();
    v.render({} as never, predict as never);
    expect((await card(v)).classList.contains("min")).toBe(true);
  });
});

describe("labels: Solo attive", () => {
  it("shows only the active labels, in the book overview too", () => {
    expect(restrictsLabels("active", false)).toBe(true);
    expect(restrictsLabels("none", false)).toBe(true);
    expect(restrictsLabels("all", false)).toBe(false);
    expect(restrictsLabels("active", true)).toBe(false); // picking a label in a quiz shows them all
  });
});
