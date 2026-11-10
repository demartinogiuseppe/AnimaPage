// Quick first pass (brief §4.6: first content in < 10 s): one tiny call straight from the photo,
// to run IN PARALLEL with the full analysis. It returns the topic and 2-3 introductory sentences
// the app can show and read aloud while analysis + generation (~1.5-2 min) run.
//
// Measured 2026-11-03 on the Germani spread (photo ~3 MB, `--effort low`): sonnet 4.5 s,
// haiku 6.0 s, opus 12.4 s. The full haiku analysis is not faster (31.6 s), so the speed-up
// comes from the tiny output, not from a smaller model.
//
// Safety: the sentences come from an unverified reading of the photo, so they must not contain
// numbers or dates (a misread number would be shown as sourced); sentences with digits are dropped.
import type { Chapter } from "@pv/scene-spec";
import { PAGE_SOURCE_ID } from "@pv/scene-spec";
import type { ImageInput, LlmProvider } from "../llm/types.ts";
import { autoSpeech, readingTime, SENTENCE_GAP } from "./text.ts";

export const QUICK_MODEL = "sonnet";

export const QUICK_SYSTEM = "You read photos of book pages for a children's learning app. Answer in the language of the page through the StructuredOutput tool.";
export const QUICK_PROMPT =
  "Give the topic of this book page and 2-3 short sentences (max 18 words each) that introduce it to a student, as a narrator would read them aloud. Use only what is printed on the page. Do not mention any number, date or quantity. If the page is a story, do not quote it: say in your own words what it is about.";

export const QUICK_SCHEMA = {
  type: "object",
  properties: {
    topic: { type: "string", minLength: 1 },
    narration: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 3 },
  },
  required: ["topic", "narration"],
  additionalProperties: false,
};

export interface QuickIntro {
  topic: string;
  chapter: Chapter;
  durationMs: number;
}

export async function quickIntro(image: ImageInput, provider: LlmProvider): Promise<QuickIntro> {
  const t0 = performance.now();
  const res = await provider.generateStructured({ system: QUICK_SYSTEM, prompt: QUICK_PROMPT, images: [image], jsonSchema: QUICK_SCHEMA });
  const data = res.data as { topic?: unknown; narration?: unknown };
  const topic = typeof data.topic === "string" && data.topic.trim() ? data.topic.trim() : "La pagina";
  const texts = (Array.isArray(data.narration) ? data.narration : []).filter((s): s is string => typeof s === "string" && !!s.trim() && !/\d/.test(s));
  let t = 0;
  const narration = texts.map((text) => {
    const speech = autoSpeech(text);
    const s = { at: Math.round(t * 10) / 10, text, ...(speech ? { speech } : {}), highlight: [], sourceIds: [PAGE_SOURCE_ID] };
    t += readingTime(speech ?? text) + SENTENCE_GAP;
    return s;
  });
  if (narration.length === 0) narration.push({ at: 0, text: `Questa pagina parla di: ${topic}.`, highlight: [], sourceIds: [PAGE_SOURCE_ID] });
  return {
    topic,
    durationMs: Math.round(performance.now() - t0),
    chapter: {
      id: "intro-rapida",
      title: topic,
      chip: "Introduzione",
      kind: "mixed",
      duration: Math.round((t + 1.5) * 10) / 10,
      narration,
      camera: [],
      pins: [],
      deep: [],
      quiz: [],
      sounds: { ambience: [], cues: [{ at: 0, sound: "page-turn", volume: 0.5 }] },
    },
  };
}
