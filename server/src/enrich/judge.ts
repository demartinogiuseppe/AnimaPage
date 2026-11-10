// One structured LLM call per page: pick the right Wikipedia article for each looked-up
// entity and rate the video candidates for relevance and child safety. Text only (titles,
// short extracts, descriptions), through the LlmProvider (decision D3).
import type { PageAnalysis } from "@pv/scene-spec";
import { isItalian, languageName } from "@pv/scene-spec/i18n";
import type { LlmProvider, LlmUsage, StructuredRequest } from "../llm/types.ts";
import type { VideoCandidate } from "./videos/types.ts";

export interface ArticleChoice {
  entity: string;
  candidates: { title: string; extract: string }[];
}

export interface VideoVerdict {
  ref: string;
  relevance: number;
  childSafe: boolean;
  /** Short Italian title shown in the app. */
  titleIt: string;
  reason: string;
}

export interface Judgement {
  /** entity -> chosen title, or "" for none. */
  articles: Map<string, string>;
  videos: VideoVerdict[];
  usage?: LlmUsage;
  model: string;
  durationMs: number;
}

export const JUDGE_SYSTEM = [
  "You check sources for an Italian educational app that turns a photographed book page into a lesson, also for children.",
  "1. Articles: for each entity of the page you get candidate it.wikipedia articles (title + first sentence).",
  "Choose the article that is about the same thing the page means, in the page's context; answer an empty title when none fits.",
  "Never choose an article about a homonym (a film, a person, a place with the same name) that the page does not mean.",
  "2. Videos: for each Wikimedia Commons video candidate (title, description, categories, duration) give",
  "relevance from 0 to 1 (1 = it clearly shows the page's topic and helps a student understand it; 0 = unrelated),",
  "childSafe = false if it may contain violence, injuries, blood, death, weapons in use, nudity, sexual content, frightening or",
  "disturbing scenes, medical procedures, or anything unsuitable for a 9-year-old; when unsure, false.",
  "titleIt: a short neutral Italian title for the video (max 60 characters). reason: one short sentence in Italian;",
  "if the title or description show that the narration or on-screen text is not in Italian, say which language.",
  "Use only the information given; answer every entity and every video ref exactly as given.",
].join(" ");

const YOUTUBE_NOTE =
  "Videos with provider \"youtube\" also give the channel, whether it is on the app's list of educational channels " +
  "(preferredChannel), and the declared language. Judge YouTube videos with the same rules; a channel on the list is not a reason to skip the safety check.";

/**
 * Judge prompts for a non-Italian user (decision D21): same rules, the user's language instead of
 * Italian, and no approved-channel list (it exists only for Italian): YouTube channels are judged on
 * their own. Italian keeps JUDGE_SYSTEM / YOUTUBE_NOTE byte for byte.
 */
export function judgeTexts(locale?: string): { system: string; youtubeNote: string } {
  if (isItalian(locale)) return { system: JUDGE_SYSTEM, youtubeNote: YOUTUBE_NOTE };
  const name = languageName(locale!);
  return {
    system: JUDGE_SYSTEM.replace("an Italian educational app", `an educational app used in ${name}`)
      .replace("candidate it.wikipedia articles", "candidate Wikipedia articles")
      .replace("a short neutral Italian title", `a short neutral ${name} title`)
      .replace("one short sentence in Italian", "one short sentence in English")
      .replace("is not in Italian", `is not in ${name}`),
    youtubeNote:
      'Videos with provider "youtube" also give the channel and the declared language. There is no list of approved channels for this language: ' +
      "judge each channel yourself with the same rules (an educational, reliable source that suits children; when unsure, low relevance), and always apply the safety check.",
  };
}

export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["articles", "videos"],
  properties: {
    articles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "title"],
        properties: { entity: { type: "string" }, title: { type: "string" } },
      },
    },
    videos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "relevance", "childSafe", "titleIt", "reason"],
        properties: {
          ref: { type: "string" },
          relevance: { type: "number", minimum: 0, maximum: 1 },
          childSafe: { type: "boolean" },
          titleIt: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export function judgeRequest(a: PageAnalysis, articles: ArticleChoice[], videos: VideoCandidate[], locale?: string): StructuredRequest {
  const texts = judgeTexts(locale);
  const payload = {
    page: {
      subject: a.subject,
      topic: a.topic,
      gradeLevel: a.gradeLevel ?? null,
      summary: a.summary.slice(0, 600),
      concepts: a.concepts.slice(0, 12),
    },
    articles: articles.map((x) => ({ entity: x.entity, candidates: x.candidates.map((c) => ({ title: c.title, extract: c.extract.slice(0, 220) })) })),
    videos: videos.map((v) => ({
      ref: v.ref,
      title: v.title.slice(0, 160),
      description: v.description.slice(0, 300),
      categories: v.categories.slice(0, 10),
      durationSec: v.durationSec === undefined ? null : Math.round(v.durationSec),
      // Only YouTube items carry these keys, so Commons-only requests (and their recordings) are unchanged.
      ...(v.youtube
        ? { provider: "youtube", channel: v.author ?? "", preferredChannel: v.youtube.preferredChannel, language: v.youtube.language ?? null }
        : {}),
    })),
  };
  return {
    system: texts.system,
    // The YouTube note is added only when there are YouTube items (keeps Commons-only requests unchanged).
    prompt:
      (videos.some((v) => v.youtube) ? `${texts.youtubeNote}\n` : "") + `Page, article candidates and video candidates (JSON):\n${JSON.stringify(payload)}`,
    jsonSchema: JUDGE_SCHEMA,
  };
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** Keeps only answers that refer to what was asked (titles among the candidates, known refs). */
export function parseJudgement(data: unknown, articles: ArticleChoice[], videos: VideoCandidate[]): Pick<Judgement, "articles" | "videos"> {
  const d = o(data);
  const chosen = new Map<string, string>();
  const allowed = new Map(articles.map((x) => [x.entity, new Set(x.candidates.map((c) => c.title))]));
  for (const raw of Array.isArray(d.articles) ? d.articles : []) {
    const r = o(raw);
    if (typeof r.entity !== "string" || typeof r.title !== "string") continue;
    const set = allowed.get(r.entity);
    if (set && (r.title === "" || set.has(r.title))) chosen.set(r.entity, r.title);
  }
  const refs = new Set(videos.map((v) => v.ref));
  const verdicts: VideoVerdict[] = [];
  for (const raw of Array.isArray(d.videos) ? d.videos : []) {
    const r = o(raw);
    if (typeof r.ref !== "string" || !refs.has(r.ref)) continue;
    if (typeof r.relevance !== "number" || typeof r.childSafe !== "boolean") continue;
    verdicts.push({
      ref: r.ref,
      relevance: Math.max(0, Math.min(1, r.relevance)),
      childSafe: r.childSafe,
      titleIt: typeof r.titleIt === "string" ? r.titleIt.slice(0, 80) : "",
      reason: typeof r.reason === "string" ? r.reason.slice(0, 200) : "",
    });
  }
  return { articles: chosen, videos: verdicts };
}

export async function judge(
  provider: LlmProvider,
  a: PageAnalysis,
  articles: ArticleChoice[],
  videos: VideoCandidate[],
  locale?: string,
): Promise<Judgement> {
  const res = await provider.generateStructured(judgeRequest(a, articles, videos, locale));
  return { ...parseJudgement(res.data, articles, videos), usage: res.usage, model: res.model, durationMs: res.durationMs };
}
