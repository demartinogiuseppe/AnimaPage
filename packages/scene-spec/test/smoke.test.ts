import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { checkSemantics, EngineId, SCENE_SPEC_VERSION, SceneSpec } from "../src/index.ts";

const minimal = (): z.input<typeof SceneSpec> => ({
  version: "0.1",
  engine: "card",
  title: "Il complemento oggetto",
  page: { subject: "Grammatica", topic: "Complemento oggetto", language: "it" },
  kind: "mixed",
  chapters: [
    {
      id: "intro",
      title: "Che cos'è",
      chip: "Intro",
      kind: "mixed",
      duration: 10,
      narration: [{ at: 0, text: "Il complemento oggetto risponde a: chi? che cosa?", highlight: [], sourceIds: ["page"] }],
      camera: [],
      pins: [],
      deep: [],
      quiz: [{ type: "choice", q: "Che cosa indica?", options: ["L'oggetto", "Il luogo"], answer: 0, explain: "Indica l'oggetto." }],
    },
  ],
  sources: [{ id: "page", kind: "page", title: "Pagina del libro" }],
  videos: [],
  disclaimers: [],
  engineData: {},
});

describe("SceneSpec", () => {
  it("exposes the v0.1 engines", () => {
    expect(SCENE_SPEC_VERSION).toBe("0.1");
    expect(EngineId.options).toEqual(["map", "battle", "timeline", "diorama", "process", "concept", "sky", "lab", "chart", "stage", "art", "solid", "earth", "music", "workshop", "card", "facade", "storybook"]);
  });

  it("accepts a minimal card scene with no semantic issues", () => {
    const spec = SceneSpec.parse(minimal());
    expect(checkSemantics(spec)).toEqual([]);
  });

  it("rejects unknown engines and unknown fields", () => {
    expect(SceneSpec.safeParse({ ...minimal(), engine: "cartoon" }).success).toBe(false);
    expect(SceneSpec.safeParse({ ...minimal(), extra: 1 }).success).toBe(false);
  });
});

describe("checkSemantics", () => {
  it("flags numbers without sources, unknown pins and bad answers", () => {
    const raw = minimal();
    const ch = raw.chapters[0]!;
    ch.narration.push({ at: 5, text: "Nel 79 d.C. il Vesuvio eruttò.", highlight: ["vesuvio"], sourceIds: [] });
    ch.quiz.push({ type: "choice", q: "?", options: ["a", "b"], answer: 2, explain: "x" });
    const messages = checkSemantics(SceneSpec.parse(raw)).map((i) => i.message);
    expect(messages).toContain('number or date without source: "Nel 79 d.C. il Vesuvio eruttò."');
    expect(messages).toContain('highlight of unknown pin "vesuvio"');
    expect(messages).toContain("answer index out of range");
  });

  it("flags sentences out of order", () => {
    const raw = minimal();
    raw.chapters[0]!.narration.push({ at: 0, text: "Prima.", highlight: [], sourceIds: [] });
    raw.chapters[0]!.narration[0]!.at = 3;
    const messages = checkSemantics(SceneSpec.parse(raw)).map((i) => i.message);
    expect(messages).toContain("sentence times must be in order");
  });
});
