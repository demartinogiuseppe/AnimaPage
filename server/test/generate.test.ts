import { ANALYSIS_ENGINES, checkScene, EngineId, SceneSpec, type PageAnalysis } from "@pv/scene-spec";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkLessonParts, lessonText, checkMathActivity, checkNumberProvenance, numberIndex, numberSpellings, postprocess } from "../src/generate/checks.ts";
import { pageFormulaNumbers, solidMathNumbers } from "../src/generate/enginemath.ts";
import { REFERENCE_SCENES_DIR, engineExample, exampleRef } from "../src/generate/example.ts";
import { cardFromAnalysis, chooseEngine, dropUnknownSliders, earlyChapter, GENERATE_FIXTURES_DIR, generateScene, generationRequest } from "../src/generate/index.ts";
import { ANALYSES_DIR, loadGeo, loadPageInputs, minimalEnrich, pagePhoto } from "../src/generate/inputs.ts";
import { COMMAND_LINE_BUDGET, dedupeSchema, escapedLength, rawSceneSchema, SCENE_FIELD_ORDER, sceneJsonSchema } from "../src/generate/schema.ts";
import { quickIntro } from "../src/generate/quick.ts";
import { autoSpeech, numbersIn, sentences, statedNumbers } from "../src/generate/text.ts";
import { MockProvider, readRecordings, requestKey } from "../src/llm/mock.ts";
import type { LlmProvider, StructuredRequest, StructuredResponse } from "../src/llm/types.ts";
import type { EnrichResult, GenerateInput } from "../src/pipeline/types.ts";

const analysis: PageAnalysis = {
  readable: true,
  confidence: 0.9,
  language: "it",
  pages: { visible: 1, numbers: [116] },
  orientation: "upright",
  subject: "storia",
  topic: "La fine dell'impero romano",
  gradeLevel: "scuola primaria, classe 5",
  contentType: "explanation",
  literary: { isLiterary: false },
  summary: "La pagina racconta la fine dell'impero romano d'Occidente. Nel 476 d.C. Odoacre depone Romolo Augustolo.",
  concepts: ["fine dell'impero"],
  entities: [
    { name: "Sacco di Roma", type: "event", value: "410 d.C.", onPage: true },
    { name: "Sacco dei Vandali", type: "event", value: "455 d.C.", onPage: true },
    { name: "Fine dell'impero", type: "event", value: "476 d.C.", onPage: true },
  ],
  claims: [
    { text: "Nel 410 d.C. i Visigoti saccheggiano Roma.", kind: "fact", onPage: true },
    { text: "Nel 476 d.C. finisce l'impero romano d'Occidente.", kind: "fact", onPage: true },
  ],
  exercises: [],
  illustrations: [],
  suggestedEngine: "card",
  engineReason: "Test.",
};

const enrich: EnrichResult = {
  ...minimalEnrich(analysis),
  sources: [
    { id: "page", kind: "page", title: "Libro di storia, p. 116" },
    { id: "wp-odoacre", kind: "wikipedia", title: "Wikipedia: Odoacre", url: "https://it.wikipedia.org/wiki/Odoacre" },
  ],
  facts: [{ id: "f1", text: "Odoacre morì nel 493.", entity: "Odoacre", sourceId: "wp-odoacre" }],
  discrepancies: [],
  videos: [{ id: "v1", provider: "commons", ref: "File:Roma.webm", title: "Roma antica" }],
};

const input: GenerateInput = { analysis, enrich };

/** A valid card scene as the model could write it. */
function cardAnswer(): SceneSpec {
  return {
    version: "0.1",
    engine: "card",
    title: "La fine dell'impero",
    page: { subject: "x", topic: "y", language: "it" },
    kind: "history",
    chapters: [
      {
        id: "fine",
        title: "La fine",
        chip: "Fine",
        kind: "history",
        duration: 12,
        narration: [
          { at: 0, text: "Nel 476 d.C. finisce l'impero romano d'Occidente.", highlight: [], sourceIds: [] },
          { at: 4, text: "Odoacre morì nel 493.", highlight: [], sourceIds: ["wp-odoacre"] },
        ],
        camera: [],
        pins: [],
        deep: [],
        quiz: [{ type: "choice", q: "Chi depone Romolo Augustolo?", options: ["Odoacre", "Alarico"], answer: 0, explain: "Fu Odoacre." }],
        sounds: { ambience: [{ sound: "wind", volume: 0.3 }], cues: [{ at: 0, sound: "page-turn" }] },
        book: { heading: "La fine", formula: "476 d.C.", lines: ["Odoacre depone l'ultimo imperatore."], sourceIds: [] },
        activity: {
          predict: { q: "Chi depone l'ultimo imperatore?", options: ["Alarico", "Odoacre"], answer: 1 },
          test: { prompt: "Guarda la linea del tempo." },
          prove: { text: "Nel 476 d.C. fu Odoacre.", sourceIds: [] },
          stamp: "Storico in erba",
        },
      },
    ],
    sources: [{ id: "invented", kind: "web", title: "Fonte inventata", url: "https://example.com" }],
    videos: [{ id: "fake", provider: "youtube", ref: "abc", title: "Video inventato" }],
    disclaimers: [],
    music: { track: "music-history", volume: 0.6 },
    engineData: {},
  };
}

/** Answers with the given payloads in order (the last one repeats) and records the requests. */
function scripted(...answers: unknown[]): LlmProvider & { calls: StructuredRequest[] } {
  const calls: StructuredRequest[] = [];
  return {
    name: "mock",
    calls,
    async generateStructured(req): Promise<StructuredResponse> {
      calls.push(req);
      const data = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (data instanceof Error) throw data;
      return { data: structuredClone(data), durationMs: 1000, model: "scripted", usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
}

// Some reference scenes (the compact prompt examples) are left out of the public copy
// (tools/publish/exclude.txt), which uses the original example lessons instead (EXAMPLE_FALLBACKS):
// the tests that build an example skip only when neither scene is there.
const hasExample = (engine: string) => {
  const src = exampleRef(engine as EngineId);
  return !!src && existsSync(join(REFERENCE_SCENES_DIR, `${src.scene}.scene.json`));
};
// Photos of study-book pages are never published; a recording replays only with a saved analysis or the photo.
const hasInputs = (label: string) => {
  if (existsSync(join(ANALYSES_DIR, `${label}.analysis.json`))) return true;
  try {
    pagePhoto(label);
    return true;
  } catch {
    return false;
  }
};

describe("generation schema", () => {
  it.each([...ANALYSIS_ENGINES])("%s: fits the command line, no draft-07-only tuples", (engine) => {
    const s = sceneJsonSchema(engine, 600);
    const text = JSON.stringify(s.schema);
    expect(s.relaxed).toBe(false);
    expect(s.length + 600).toBeLessThan(COMMAND_LINE_BUDGET);
    expect(escapedLength(text)).toBe(s.length);
    expect(text).not.toContain('"items":[');
    expect(text).not.toContain("prefixItems");
    expect(text).not.toContain('"description"');
  });

  it.each(EngineId.options)("%s: schema dedupe is lossless and fits", (engine) => {
    const raw = rawSceneSchema(engine);
    const deduped = dedupeSchema(rawSceneSchema(engine));
    const defs = deduped.definitions as Record<string, unknown>;
    const inline = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(inline);
      if (v && typeof v === "object") {
        const ref = (v as { $ref?: string }).$ref;
        if (ref?.startsWith("#/definitions/r")) return inline(defs[ref.slice(14)]);
        return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "definitions").map(([k, x]) => [k, inline(x)]));
      }
      return v;
    };
    expect(inline(deduped)).toEqual(inline(raw));
    expect(sceneJsonSchema(engine, 600).relaxed).toBe(false);
  });

  for (const engine of ANALYSIS_ENGINES) {
    it.skipIf(!hasExample(engine))(`${engine}: compact example from the reference scene`, () => {
      const ex = JSON.parse(engineExample(engine)) as SceneSpec;
      expect(ex.engine).toBe(engine);
      expect(ex.chapters).toHaveLength(1);
      expect(JSON.stringify(ex).length).toBeLessThan(10_000);
    });
  }
});

describe("text helpers", () => {
  it("normalises numbers written with thousand separators", () => {
    expect(numbersIn("5 590 076 abitanti, 13.668 km², 409 ab./km², 13.670,95")).toEqual(["5590076", "13668", "409", "13670.95"]);
    expect(statedNumbers("Ha otto tempi, nel IV secolo")).toEqual(expect.arrayContaining(["8", "4"]));
  });

  it("writes spoken forms for abbreviations and Roman numerals", () => {
    expect(autoSpeech("Nel 476 d.C. e nel IV secolo, il 51%")).toBe("Nel 476 dopo Cristo e nel quarto secolo, il 51 per cento");
    expect(autoSpeech("Una frase semplice.")).toBeUndefined();
    expect(sentences("Nel 476 d.C. Odoacre vince. Poi arriva il Medioevo.")).toHaveLength(3);
  });
});

describe("engine choice", () => {
  it("keeps the suggested engine, avoids map without geodata", () => {
    expect(chooseEngine({ ...analysis, suggestedEngine: "timeline" }).engine).toBe("timeline");
    expect(chooseEngine({ ...analysis, suggestedEngine: "map" })).toMatchObject({ engine: "timeline" });
    expect(chooseEngine({ ...analysis, suggestedEngine: "map", entities: [] })).toMatchObject({ engine: "card" });
    expect(chooseEngine({ ...analysis, readable: false }).engine).toBe("card");
  });

  it("puts the large parts in the prompt and the engine schema in the request", () => {
    const req = generationRequest(input, "card");
    expect(req.system.length).toBeLessThan(1000);
    expect(req.prompt).toContain("VERIFIED FACTS");
    expect(req.prompt).toContain("f1 | source wp-odoacre");
    expect(req.prompt).toContain("music-history | music");
    expect((req.jsonSchema.properties as Record<string, unknown>).engine).toEqual({ type: "string", const: "card" });
  });
});

describe("post-processing and content checks", () => {
  it("copies page info, verified sources and videos; adds notices and source ids", () => {
    const scene = cardAnswer();
    const { applied } = postprocess(scene, input);
    expect(scene.page).toEqual({ subject: "storia", topic: "La fine dell'impero romano", bookPage: "116", language: "it" });
    expect(scene.videos).toEqual(enrich.videos);
    expect(scene.sources.map((s) => s.id)).toEqual(["page", "wp-odoacre"]);
    expect(scene.disclaimers).toContain(lessonText("it", "lesson.aiDisclaimer"));
    const first = scene.chapters[0]!.narration[0]!;
    expect(first.sourceIds).toEqual(["page"]);
    expect(first.speech).toContain("dopo Cristo");
    expect(applied.length).toBeGreaterThan(3);
    expect(checkScene(scene)).toEqual([]);
  });

  it("moves correct answers away from always-first, keeping them right", () => {
    const scene = cardAnswer();
    const q = { type: "choice" as const, options: ["A", "B", "C"], answer: 0, explain: "x" };
    scene.chapters[0]!.quiz = ["uno?", "due?", "tre?", "quattro?"].map((t) => ({ ...q, q: t, options: [`${t} giusta`, "B", "C"] }));
    postprocess(scene, input);
    const qs = scene.chapters[0]!.quiz.filter((x) => x.type === "choice");
    expect(new Set(qs.map((x) => x.answer)).size).toBeGreaterThan(1);
    for (const x of qs) expect(x.options[x.answer]).toBe(`${x.q} giusta`);
  });

  it("sets the audience from the analysis, ahead of the gradeLevel fallback (D25)", () => {
    const fromGrade = cardAnswer();
    postprocess(fromGrade, input);
    expect(fromGrade.audience).toBe("child");
    const fromAnalysis = cardAnswer();
    postprocess(fromAnalysis, { ...input, analysis: { ...analysis, audience: "adult" } });
    expect(fromAnalysis.audience).toBe("adult");
    const unclear = cardAnswer();
    postprocess(unclear, { ...input, analysis: { ...analysis, gradeLevel: undefined } });
    expect(unclear.audience).toBeUndefined();
  });

  it("tells the generator the audience (analysis value, else derived from gradeLevel)", () => {
    const page = (a: PageAnalysis) => {
      const lines = generationRequest({ ...input, analysis: a }, "card").prompt.split("\n");
      return JSON.parse(lines[lines.indexOf("PAGE ANALYSIS (what is printed on the page)") + 1]!) as { audience?: string };
    };
    expect(page(analysis).audience).toBe("child");
    expect(page({ ...analysis, audience: "adult" }).audience).toBe("adult");
    expect(page({ ...analysis, gradeLevel: undefined }).audience).toBeUndefined();
  });

  it("turns loops used as cues into ambience windows and vice versa", () => {
    const scene = cardAnswer();
    scene.chapters[0]!.sounds = { ambience: [{ sound: "chime", window: [2, 4] }], cues: [{ at: 1, sound: "fire" }] };
    postprocess(scene, input);
    expect(scene.chapters[0]!.sounds).toEqual({ ambience: [{ sound: "fire", window: [1, 6] }], cues: [{ at: 2, sound: "chime" }] });
    expect(checkScene(scene)).toEqual([]);
  });

  it("requires book and activity in every chapter", () => {
    const scene = cardAnswer();
    delete scene.chapters[0]!.book;
    expect(checkLessonParts(scene).map((i) => i.path)).toEqual(["chapters[0].book"]);
  });

  it("accepts numbers implied by the graphs of a maths scene (source calc)", () => {
    const math: GenerateInput = { analysis: { ...analysis, subject: "matematica", claims: [{ text: "Il dominio di una fratta esclude gli zeri del denominatore.", kind: "rule", onPage: true }] }, enrich };
    const scene = JSON.parse(JSON.stringify(cardAnswer())) as SceneSpec & { engine: string; engineData: unknown };
    const concept = { ...scene, engine: "concept", engineData: { board: { width: 20, depth: 10 }, roles: [], rows: [], axes: [], tiles: [], shapes: [], links: [],
      graphs: [{ id: "g", pos: [0, 0, 0], x: { min: -4, max: 6 }, y: { min: -5, max: 5 }, plots: [{ id: "f", expr: "1/(x-2)" }], lines: [{ id: "as", x: 2, meaning: "asymptote", plot: "f" }] }],
      chapters: [{ chapter: "fine", actions: [{ at: 0, do: "appear", ids: ["g", "f"] }] }] } } as unknown as SceneSpec;
    concept.chapters[0]!.narration = [{ at: 0, text: "Il denominatore si annulla per x = 2.", highlight: [], sourceIds: [] }];
    postprocess(concept, math);
    expect(concept.chapters[0]!.narration[0]!.sourceIds).toEqual(["calc"]);
    expect(concept.sources.map((s) => s.id)).toContain("calc");
    expect(checkNumberProvenance(concept, numberIndex(math, concept)).filter((i) => i.path.includes("narration"))).toEqual([]);
  });

  it("maths pages need a real Prova tu and both parity tests", () => {
    const math: GenerateInput = { analysis: { ...analysis, subject: "matematica" }, enrich };
    const make = (lineX: number | string, about: ("y-axis" | "origin")[], params?: string[]) => {
      const scene = cardAnswer() as unknown as Record<string, unknown> & SceneSpec;
      const s = { ...scene, engine: "concept", engineData: { board: { width: 20, depth: 10 }, roles: [], rows: [], axes: [], tiles: [], shapes: [], links: [],
        graphs: [{ id: "g", pos: [0, 0, 0], x: { min: -4, max: 6 }, y: { min: -5, max: 5 }, params: [{ id: "a", min: -2, max: 4, value: 2 }],
          plots: [{ id: "f", expr: "1/(x-a)" }], lines: [{ id: "as", x: lineX, meaning: "asymptote", plot: "f" }] }],
        chapters: [{ chapter: "fine", actions: about.map((ab, k) => ({ at: k, do: "mirror", id: "f", about: ab })) }] } } as unknown as SceneSpec;
      s.chapters[0]!.activity!.test = { prompt: "Muovi a", ...(params ? { params } : {}) };
      return s;
    };
    expect(checkMathActivity(make("a", ["y-axis", "origin"], ["a"]), math)).toEqual([]);
    expect(checkMathActivity(make("a", ["y-axis", "origin"]), math).map((i) => i.message).join()).toContain("Prova tu");
    expect(checkMathActivity(make(2, ["y-axis", "origin"], ["a"]), math).map((i) => i.message).join()).toContain("fixed at a number");
    expect(checkMathActivity(make("a", ["y-axis"], ["a"]), math).map((i) => i.message).join()).toContain("both mirror tests");
  });

  it("lab: accepts numbers the experiments compute (fall time, period, acceleration)", () => {
    const ref = JSON.parse(readFileSync(new URL("../../fixtures/public/scenes/laboratorio-energia.scene.json", import.meta.url), "utf8")) as SceneSpec;
    const lab: GenerateInput = { analysis: { ...analysis, subject: "fisica", suggestedEngine: "lab" }, enrich };
    const idx = numberIndex(lab, ref);
    const known = (t: string) => numbersIn(t).every((n) => idx.page.has(n) || idx.bySource.has(n));
    expect(known("cade in 0,64 s e arriva a 6,3 m/s")).toBe(true);
    expect(known("periodo 2,01 s")).toBe(true);
    expect(known("a = 4,05 m/s²")).toBe(true);
    expect(known("7,77 m/s")).toBe(false);
  });

  it("page formulas applied to page numbers count as computed (calc)", () => {
    const a = JSON.parse(readFileSync(new URL("../../fixtures/analyses/solid_volume-cilindro-cono.analysis.json", import.meta.url), "utf8")).analysis as PageAnalysis;
    const spell = new Set(pageFormulaNumbers(a).flatMap(numberSpellings));
    for (const x of ["62.8", "20.93", "282.6", "94.2"]) expect(spell.has(x)).toBe(true);
    expect(spell.has("77.7")).toBe(false);
    const solid = JSON.parse(readFileSync(new URL("../../fixtures/public/scenes/geometria-solidi.scene.json", import.meta.url), "utf8")) as SceneSpec;
    if (solid.engine === "solid") expect(solidMathNumbers(solid.engineData).length).toBeGreaterThan(10);
  });

  it("drops slider ids the engine does not know instead of repairing", () => {
    const ref = JSON.parse(readFileSync(new URL("../../fixtures/public/scenes/matematica-parabola.scene.json", import.meta.url), "utf8")) as SceneSpec;
    const ch = ref.chapters.find((c) => c.activity?.test.params?.length)!;
    ch.activity!.test.params = [...ch.activity!.test.params!, "inventato"];
    const dropped = dropUnknownSliders(ref);
    expect(dropped.map((d) => d.message).join()).toContain("inventato");
    expect(ch.activity!.test.params).not.toContain("inventato");
    expect(checkScene(ref).filter((i) => i.path.includes("test.params"))).toEqual([]);
  });

  it("flags numbers that are neither on the page nor in the facts", () => {
    const scene = cardAnswer();
    scene.chapters[0]!.narration.push({ at: 8, text: "Durò 1229 anni.", highlight: [], sourceIds: ["page"] });
    postprocess(scene, input);
    const issues = checkNumberProvenance(scene, numberIndex(input));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("1229");
  });

  it("shows discrepancies with both values", () => {
    const scene = cardAnswer();
    const withD = { ...input, enrich: { ...enrich, discrepancies: [{ claim: "Abitanti", bookValue: "5 590 076", sourceValue: "5 561 912", sourceId: "wp-odoacre" }] } };
    postprocess(scene, withD);
    const deep = scene.chapters[0]!.deep.map((d) => d.text).join(" ");
    expect(deep).toContain("5 590 076");
    expect(deep).toContain("5 561 912");
  });
});

describe("generateScene", () => {
  it("accepts a valid answer with one call", async () => {
    const p = scripted(cardAnswer());
    let early = "";
    const r = await generateScene(input, { provider: p, ledgerPath: null, onEarly: (c) => (early = c.narration[0]!.text) });
    expect(early).toContain("fine dell'impero");
    expect(p.calls).toHaveLength(1);
    expect(r).toMatchObject({ validation: "ok", fallback: false, repaired: false, engine: "card", llmCalls: 1, llmReportedMs: 1000 });
    expect(r.issues).toEqual([]);
    expect(r.ledger).toMatchObject({ engine: "card", validation: "ok", llmCalls: 1, tokensOut: 20 });
  });

  it("repairs once with the issue list", async () => {
    const bad = cardAnswer();
    bad.chapters[0]!.narration[1]!.highlight = ["nowhere"];
    const p = scripted(bad, cardAnswer());
    const r = await generateScene(input, { provider: p, ledgerPath: null });
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1]!.prompt).toContain('highlight of unknown pin "nowhere"');
    expect(r).toMatchObject({ validation: "repaired", repaired: true, fallback: false });
    expect(r.ledger.validation).toBe("repaired");
  });

  it("falls back to a valid card built from the analysis", async () => {
    const p = scripted({ engine: "card", nonsense: true });
    const r = await generateScene(input, { provider: p, ledgerPath: null });
    expect(p.calls).toHaveLength(2);
    expect(r).toMatchObject({ validation: "fallback", fallback: true });
    expect(r.scene.engine).toBe("card");
    expect(checkScene(r.scene)).toEqual([]);
    expect(r.ledger).toMatchObject({ validation: "failed", engine: "card" });
    expect(r.ledger.error).toContain("fallback card");
  });

  it("falls back when the provider fails", async () => {
    const r = await generateScene(input, { provider: scripted(new Error("boom")), ledgerPath: null });
    expect(r.fallback).toBe(true);
    expect(r.ledger.validation).toBe("error");
  });

  it("keeps the first answer when the repair is structurally worse", async () => {
    const withNumber = cardAnswer();
    withNumber.chapters[0]!.narration.push({ at: 8, text: "Durò 1229 anni.", highlight: [], sourceIds: ["page"] });
    const r = await generateScene(input, { provider: scripted(withNumber, { broken: true }), ledgerPath: null });
    expect(r.validation).toBe("ok");
    expect(r.issues.map((i) => i.message).join()).toContain("1229");
  });
});

describe("fallback and early content", () => {
  it("builds a card and a first chapter from the analysis only", () => {
    const card = cardFromAnalysis(input);
    expect(SceneSpec.safeParse(card).success).toBe(true);
    expect(checkScene(card)).toEqual([]);
    expect(card.videos).toEqual(enrich.videos);
    const ch = earlyChapter(input);
    expect(ch.narration.length).toBeGreaterThanOrEqual(2);
    expect(ch.narration.every((s) => s.sourceIds.includes("page"))).toBe(true);
  });
});

describe("quick first pass", () => {
  it("keeps only sentences without numbers and times them", async () => {
    const p = scripted({ topic: "I Germani", narration: ["I Germani vivevano nel Nord Europa.", "Nel 476 d.C. finisce l'impero.", "I Romani li chiamavano barbari."] });
    const r = await quickIntro({ mediaType: "image/jpeg", data: Buffer.from("x") }, p);
    expect(p.calls[0]!.images).toHaveLength(1);
    expect(r.chapter.narration.map((s) => s.text)).toEqual(["I Germani vivevano nel Nord Europa.", "I Romani li chiamavano barbari."]);
    expect(r.chapter.narration[1]!.at).toBeGreaterThan(2);
  });
});

describe("recorded generations (mock replay)", async () => {
  const keys = new Set(readRecordings(GENERATE_FIXTURES_DIR).filter((r) => r.label.startsWith("gen_")).map((r) => r.key));
  const labels = [...new Set(readRecordings(GENERATE_FIXTURES_DIR).filter((r) => r.label.startsWith("gen_")).map((r) => r.label.slice(4)))];

  it.skipIf(!hasInputs("geografia_campania_p84"))("there is a geo context for the Campania page", async () => {
    const p = await loadPageInputs("geografia_campania_p84");
    expect(loadGeo(p.input.analysis)?.focus).toBe("Campania");
  });

  for (const label of labels) {
    it.skipIf(!hasInputs(label))(`${label}: replays and validates offline`, async () => {
      const { input: inp } = await loadPageInputs(label);
      const { engine } = chooseEngine(inp.analysis, inp.geo);
      const key = requestKey(generationRequest(inp, engine));
      if (!keys.has(key)) {
        console.warn(`${label}: inputs changed since the recording; re-record with --live`);
        return;
      }
      const r = await generateScene(inp, { provider: new MockProvider(GENERATE_FIXTURES_DIR), ledgerPath: null });
      expect(r.fallback).toBe(false);
      expect(checkScene(r.scene)).toEqual([]);
      expect(r.scene.videos).toEqual(inp.enrich.videos);
    });
  }
});

describe.skipIf(process.env.PAGINAVIVA_MODE !== "live")("live generation", () => {
  it("generates a valid scene through the Claude Code CLI", { timeout: 600_000 }, async () => {
    const { ClaudeCliProvider } = await import("../src/llm/claude-cli.ts");
    const r = await generateScene(input, { provider: new ClaudeCliProvider(), ledgerPath: null });
    expect(checkScene(r.scene)).toEqual([]);
  });
});

describe("generation schema: exposed and unexposed parts (scene-spec unexposed.ts)", () => {
  it("offers the clock part and the time actions to stage and diorama only (D25)", () => {
    for (const engine of ["stage", "diorama"] as const) {
      const json = JSON.stringify(rawSceneSchema(engine));
      expect(json, engine).toContain('"const":"clock"');
      expect(json, engine).toMatch(/"const":"time"/);
    }
    for (const engine of ["timeline", "concept"] as const) {
      const json = JSON.stringify(rawSceneSchema(engine));
      expect(json, engine).not.toContain('"clock"');
      expect(json, engine).not.toMatch(/"const":"time"/);
    }
  });

  it("leaves out SceneSpec.audience (set by the server from the analysis)", () => {
    for (const engine of EngineId.options) {
      const json = JSON.stringify(rawSceneSchema(engine));
      expect(json, engine).not.toContain('"audience"');
      expect(json, engine).not.toContain("x-pv-unexposed");
    }
  });
});

describe("generation field order (D25: engineData before chapters)", () => {
  for (const engine of ANALYSIS_ENGINES) {
    it.skipIf(!hasExample(engine))(`${engine}: schema and example list engineData before chapters`, () => {
      const schema = sceneJsonSchema(engine, 600).schema;
      const keys = Object.keys(schema.properties as object);
      expect(keys).toEqual(SCENE_FIELD_ORDER.filter((k) => keys.includes(k)));
      expect(keys.indexOf("engineData")).toBeLessThan(keys.indexOf("chapters"));
      expect(schema.required as string[]).toEqual(keys.filter((k) => (schema.required as string[]).includes(k)));
      const example = Object.keys(JSON.parse(engineExample(engine)) as object);
      expect(example.indexOf("engineData")).toBeLessThan(example.indexOf("chapters"));
      expect(example.indexOf("chapters")).toBeLessThan(example.indexOf("sources"));
    });
  }
});
