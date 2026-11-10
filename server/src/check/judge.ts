// Judge request for the visual check: page photo + scene screenshots + a compact summary of each
// chapter -> { problems: [{ chapter, severity, what, fix }] } under a strict JSON schema (Claude CLI,
// `--json-schema`, images as stream-json blocks like analyze does). Only "blocking" problems make the
// pipeline regenerate (D23); "minor" ones are logged, and passed along only when regenerating anyway.
import type { PageAnalysis, SceneSpec } from "@pv/scene-spec";
import type { ImageInput, StructuredRequest } from "../llm/types.ts";
import type { Shot } from "./render.ts";

/** Part of the page cache key (server/src/pipeline/run.ts): bump when the check changes the lessons it lets through. */
export const CHECK_VERSION = "check-1";

export type Severity = "blocking" | "minor";

export interface Problem {
  /** Chapter id. */
  chapter: string;
  /** blocking = the lesson is broken or teaches something wrong (worth a regeneration); minor = cosmetic. */
  severity: Severity;
  what: string;
  fix: string;
}

export interface Verdict {
  /** No blocking problem. */
  ok: boolean;
  /** Blocking problems first, then minor ones. */
  problems: Problem[];
}

export const VERDICT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["problems"],
  properties: {
    problems: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chapter", "severity", "what", "fix"],
        properties: {
          chapter: { type: "string" },
          severity: { type: "string", enum: ["blocking", "minor"] },
          what: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
};

export const JUDGE_SYSTEM =
  "You review 3D lesson scenes generated from a school book page, comparing screenshots of the scene with the page. You tell apart the problems that break the lesson from the cosmetic ones, and ignore style. Answer only through the JSON schema.";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface JudgeInput {
  scene: SceneSpec;
  shots: Shot[];
  /** The page photo (in memory only). Without it the page analysis is the reference. */
  photo?: ImageInput;
  analysis?: PageAnalysis;
}

function pageSection(scene: SceneSpec, a: PageAnalysis | undefined): string[] {
  const lines = [`Page: ${scene.page.subject} · ${scene.page.topic}. Lesson title: ${scene.title}.`];
  if (!a) return lines;
  lines.push(`Page summary: ${clip(a.summary, 600)}`);
  if (a.concepts.length) lines.push(`Concepts: ${a.concepts.slice(0, 10).join("; ")}`);
  for (const i of a.illustrations.slice(0, 6))
    lines.push(`Illustration on the page (${i.kind}): ${clip(i.description, 400)}${i.labels.length ? ` Labels: ${i.labels.join(", ")}` : ""}`);
  return lines;
}

function chapterSection(scene: SceneSpec): string[] {
  return scene.chapters.map((c) => {
    const narration = clip(c.narration.map((s) => s.text).join(" "), 700);
    const pins = c.pins.slice(0, 14).map((p) => (p.sub ? `${p.name} (${p.sub})` : p.name));
    return `- chapter "${c.id}" «${c.title}» (${c.duration} s). Narration: ${narration}${pins.length ? ` Labels: ${pins.join(" | ")}.` : " No labels."}`;
  });
}

export function judgePrompt(input: JudgeInput): string {
  const first = input.photo ? 2 : 1;
  return [
    `[${CHECK_VERSION}] Visual check of a generated lesson.`,
    input.photo
      ? "Image 1 is the photo of the book page. The other images are screenshots of the 3D pop-up-book scene generated from it."
      : "No photo of the page is available: the page description below is the reference. The images are screenshots of the 3D pop-up-book scene generated from it.",
    "In the screenshots the open book under the scene, its printed left page and the paper look are normal. Labels are the small tags with names; a numbered dot may stand for a label.",
    "",
    ...pageSection(input.scene, input.analysis),
    "",
    "Chapters (what each should show):",
    ...chapterSection(input.scene),
    "",
    "Screenshots:",
    ...input.shots.map((s, k) => `- Image ${k + first}: chapter "${s.chapterId}" at ${s.t} s (${s.moment === "middle" ? "middle of the narration" : "end of the chapter"})`),
    "",
    "For each chapter compare its screenshots with the page and with the chapter's narration and labels:",
    "1. Subject: does the 3D scene depict what the page and the narration describe (the right apparatus, object, place, process, in the configuration the page shows)? A generic or unrelated object, e.g. a lone floating cube on a page about communicating vessels, is a problem.",
    "2. Labels: is each label on the thing it names? Labels on empty space or on the wrong object, the same label twice, and labels the narration needs but that are missing are problems.",
    "3. Invented or stray content: objects that are neither on the page nor in the narration, leftover primitives (a lone cube, sphere or slab), anything that contradicts the page.",
    "4. Layout and physics: parts must be placed and connected as on the page and as the narration says: what hangs is below what holds it, ropes and rods reach the parts they connect, nothing floats, sinks into the floor, intersects another part or tilts without a reason.",
    "5. Readability: the key thing is visible, big enough, not hidden by other objects nor cut off by the frame; labels do not cover each other.",
    "Report only problems a student would notice or that would teach something wrong; ignore colours, style, lighting and small aesthetic details. No problem: problems is empty.",
    "",
    "Give each problem a severity. A blocking problem makes the scene be generated again (minutes of waiting, and the new scene is not always better), so it must really hurt the lesson:",
    '- blocking: the scene shows the wrong subject, apparatus or template, or a generic placeholder (a lone floating cube in a beaker on a page about communicating vessels).',
    '- blocking: a key object the narration talks about is missing or invisible, so the narration describes nothing on screen (a "right triangle ABC" with no vertex letters and no right angle while the narration reads AB/BC).',
    "- blocking: the scene contradicts the page or would teach something wrong (a clock showing 8:00 labelled \"seven o'clock\"; a movable pulley drawn above the load it lifts; systems arranged differently from the page when the arrangement is the point of the chapter).",
    "- blocking: the chapter cannot be followed: its key objects or labels are hidden, cut off, unreadable or cover each other so their text cannot be read; or the scene is empty, black or broken.",
    "- minor: a label a bit off its object or over empty space near it, or whose leader line ends on a neighbouring part while the screen still makes clear what is what (e.g. the part carries its own name or formula tile); a label repeating a text tile or formula card; slight overlaps or intersections where everything stays readable; leftover objects from an earlier chapter that do not mislead; framing, spacing, alignment, sizes; a page illustration not reproduced when the chapter still makes its point with other objects and labels (e.g. keyword labels above a timeline).",
    "When unsure, minor.",
    "",
    'Each problem: chapter = the chapter id (or "*" for the whole scene); severity = blocking or minor; what = what is wrong, concretely (which object or label, where); fix = a concrete instruction for the scene author: what to add, remove, move, reconnect or relabel. English, one or two sentences each. List blocking problems first.',
  ].join("\n");
}

export function judgeRequest(input: JudgeInput): StructuredRequest {
  return {
    system: JUDGE_SYSTEM,
    prompt: judgePrompt(input),
    images: [...(input.photo ? [input.photo] : []), ...input.shots.map((s) => ({ mediaType: "image/jpeg" as const, data: s.jpeg }))],
    jsonSchema: VERDICT_JSON_SCHEMA,
  };
}

const text = (v: unknown, n: number) => (typeof v === "string" ? clip(v.replace(/\s+/g, " ").trim(), n) : "");

/**
 * Checks the judge's answer: problems without text are dropped, a severity other than "blocking"
 * counts as minor (a malformed answer never forces a regeneration), and ok means "no blocking problem".
 * A non-object answer or no problems array throws (the check is then skipped).
 */
export function parseVerdict(data: unknown): Verdict {
  const d = (data ?? {}) as { problems?: unknown };
  if (!Array.isArray(d.problems)) throw new Error("judge answer does not match the verdict schema");
  const problems = d.problems
    .map((p) => (p ?? {}) as Record<string, unknown>)
    .map((p): Problem => ({
      chapter: text(p.chapter, 60) || "*",
      severity: p.severity === "blocking" ? "blocking" : "minor",
      what: text(p.what, 500),
      fix: text(p.fix, 500),
    }))
    .filter((p) => p.what && p.fix);
  const blocking = problems.filter((p) => p.severity === "blocking");
  return { ok: blocking.length === 0, problems: [...blocking, ...problems.filter((p) => p.severity === "minor")] };
}
