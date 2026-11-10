// Deterministic content built from the analysis, without any LLM call:
// - earlyChapter(): the first content the app can show and read aloud right after the
//   analysis, while the full scene is being generated (brief §4.6: first content fast);
// - cardFromAnalysis(): the `card` fallback when generation fails validation twice.
import { PAGE_SOURCE_ID, type Chapter, type Deep, type SceneSpec, type Sentence } from "@pv/scene-spec";
import type { GenerateInput } from "../pipeline/types.ts";
import { isItalian } from "@pv/scene-spec/i18n";
import { allowedSources, lessonText, literaryDisclaimer } from "./checks.ts";
import { autoSpeech, readingTime, SENTENCE_GAP, sentences } from "./text.ts";

export const FALLBACK_DISCLAIMER = "Scheda semplice preparata dall'analisi della pagina: la scena animata non è stata generata.";

function timed(texts: string[], sourceIds: string[], lang?: string): { narration: Sentence[]; duration: number } {
  let t = 0;
  const narration = texts.map((text) => {
    const speech = autoSpeech(text, lang);
    const s: Sentence = { at: Math.round(t * 10) / 10, text, ...(speech ? { speech } : {}), highlight: [], sourceIds };
    t += readingTime(speech ?? text, lang) + SENTENCE_GAP;
    return s;
  });
  return { narration, duration: Math.round((t + 1) * 10) / 10 };
}

function chapter(id: string, title: string, chip: string, kind: Chapter["kind"], texts: string[], deep: Deep[], lang?: string): Chapter {
  const { narration, duration } = timed(texts, [PAGE_SOURCE_ID], lang);
  return {
    id,
    title,
    chip,
    kind,
    duration,
    narration,
    camera: [],
    pins: [],
    deep,
    quiz: [],
    sounds: { ambience: [], cues: [{ at: 0, sound: "page-turn", volume: 0.5 }] },
  };
}

function sceneKind(input: GenerateInput): SceneSpec["kind"] {
  const s = input.analysis.subject.toLowerCase();
  if (input.analysis.literary.isLiterary) return "mixed";
  if (s.includes("storia") || /histor|geschicht/.test(s)) return "history";
  if (s.includes("geografia") || /geogra/.test(s)) return "geography";
  if (s.includes("scienz") || /scien|ciênc|ciencia|naturwiss/.test(s)) return "science";
  return "mixed";
}

/** Chapter 1 from the analysis summary: available as soon as the analysis is done (0 ms). */
export function earlyChapter(input: GenerateInput): Chapter {
  return chapter("introduzione", input.analysis.topic, lessonText(input.locale, "lesson.cardIntroChip"), sceneKind(input), sentences(input.analysis.summary), [], input.locale);
}

/** The `card` fallback: summary, the page's claims, verified facts as deep items. No LLM. */
export function cardFromAnalysis(input: GenerateInput): SceneSpec {
  const { analysis, enrich } = input;
  const kind = sceneKind(input);
  const facts: Deep[] = enrich.facts.slice(0, 6).map((f) => ({ text: f.text, sourceIds: [f.sourceId] }));
  const discrepancies: Deep[] = enrich.discrepancies.map((d) => ({
    text: lessonText(input.locale, "lesson.cardDiscrepancy", { claim: d.claim, book: d.bookValue, value: d.sourceValue, note: d.note ? ` (${d.note})` : "" }),
    sourceIds: [PAGE_SOURCE_ID, d.sourceId],
  }));
  const first = earlyChapter(input);
  first.deep = [...discrepancies, ...facts.slice(0, 3)];
  const chapters: Chapter[] = [first];
  const claims = analysis.claims.map((c) => c.text);
  for (let i = 0, n = 1; i < claims.length && n <= 3; i += 6, n++) {
    const L = (key: Parameters<typeof lessonText>[1]) => lessonText(input.locale, key, { n });
    const ch = chapter(`punti-${n}`, L(n === 1 ? "lesson.cardPointsTitle" : "lesson.cardMoreTitle"), n === 1 ? L("lesson.cardPointsChip") : L("lesson.cardPartChip"), kind, claims.slice(i, i + 6), n === 1 ? facts.slice(3) : [], input.locale);
    chapters.push(ch);
  }
  const disclaimers = [lessonText(input.locale, "lesson.fallbackDisclaimer"), lessonText(input.locale, "lesson.aiDisclaimer")];
  if (analysis.literary.isLiterary) disclaimers.push(literaryDisclaimer(analysis.literary.author, analysis.literary.work, input.locale));
  const cited = new Set(chapters.flatMap((c) => [...c.narration, ...c.deep].flatMap((x) => x.sourceIds)));
  for (const v of enrich.videos) if (v.sourceId) cited.add(v.sourceId);
  const bookPage = analysis.pages.numbers.length ? analysis.pages.numbers.join("-") : undefined;
  return {
    version: "0.1",
    engine: "card",
    title: analysis.topic,
    page: { subject: analysis.subject, topic: analysis.topic, ...(bookPage ? { bookPage } : {}), language: "it" },
    kind,
    chapters,
    sources: allowedSources(input).filter((s) => cited.has(s.id)),
    videos: enrich.videos.map((v) => ({ ...v })),
    disclaimers,
    music: { track: "music-calm", volume: 0.5 },
    ...(isItalian(input.locale) ? {} : { lang: input.locale }),
    engineData: {},
  };
}
