// PageAnalysis: photo -> structured understanding of the page (brief §4.4, M2).
//
// Produced by the server (server/src/analyze) from one photo of a book page, any book
// (decision D9). It is the input of enrichment (M3) and scene generation (M4).
//
// Differences from the brief's sketch, driven by real photos:
// - `pages` (one page or a two-page spread, printed page numbers) and `orientation`
//   (phone photos are often rotated 90°);
// - `contentType`, `literary` (copyrighted creative prose: the generator must
//   paraphrase, never copy) and `illustrations` (they help build scenes);
// - `readable` + `retake`: the app asks for a new photo instead of guessing;
// - entity types `group` and `term` (peoples, technical words), claim `kind`
//   (fact / definition / rule / story event) so fiction is never narrated as history.
//
// The engine list is repeated here instead of importing `EngineId` from index.ts,
// because index.ts re-exports this module (a circular import would be undefined at
// load time). A test keeps the two lists equal.
import { z } from "zod";

export const ANALYSIS_ENGINES = ["map", "battle", "timeline", "diorama", "process", "concept", "stage", "lab", "sky", "chart", "art", "solid", "earth", "music", "workshop", "card"] as const;
export const AnalysisEngine = z.enum(ANALYSIS_ENGINES);
export type AnalysisEngine = z.infer<typeof AnalysisEngine>;

export const EntityType = z.enum(["place", "person", "group", "event", "date", "object", "quantity", "term"]);
export type EntityType = z.infer<typeof EntityType>;

export const PageEntity = z
  .object({
    name: z.string().min(1).describe("As written on the page."),
    type: EntityType,
    value: z.string().optional().describe("Exact value from the page, e.g. '1281 m', '476 d.C.', '5 590 076'."),
    onPage: z.literal(true),
  })
  .strict();
export type PageEntity = z.infer<typeof PageEntity>;

export const ClaimKind = z.enum(["fact", "definition", "rule", "story_event"]);
export type ClaimKind = z.infer<typeof ClaimKind>;

export const PageClaim = z
  .object({
    text: z.string().min(1).describe("One statement made by the page, restated briefly in the page's language."),
    kind: ClaimKind,
    onPage: z.literal(true),
  })
  .strict();
export type PageClaim = z.infer<typeof PageClaim>;

export const ContentType = z.enum([
  "explanation", // expository textbook text
  "exercises", // mostly questions / activities
  "narrative", // story, novel excerpt, tale, myth
  "poem",
  "map_or_diagram", // the page is mostly a map, chart or labelled diagram
  "mixed",
  "other",
]);
export type ContentType = z.infer<typeof ContentType>;

export const Illustration = z
  .object({
    kind: z.enum(["photo", "drawing", "map", "diagram", "chart", "table", "other"]),
    description: z.string().min(1),
    /** Text labels printed on the illustration (e.g. "retina", "Vesuvio 1281"). */
    labels: z.array(z.string()),
  })
  .strict();
export type Illustration = z.infer<typeof Illustration>;

export const RetakeReason = z.enum(["blurry", "too_dark", "glare", "cropped", "too_far", "not_a_book_page", "other"]);
export type RetakeReason = z.infer<typeof RetakeReason>;

export const PageAnalysis = z
  .object({
    readable: z.boolean().describe("False when the text cannot be read reliably."),
    retake: z
      .object({ reason: RetakeReason, hint: z.string().min(1).describe("Short Italian hint for the user.") })
      .strict()
      .optional()
      .describe("Present only when the user should take a new photo."),
    confidence: z.number().min(0).max(1),
    language: z.string().min(2).describe("ISO 639-1 code of the page text, e.g. 'it'."),
    pages: z
      .object({
        visible: z.number().int().min(1).max(2).describe("Book pages in the photo: 1, or 2 for a spread."),
        numbers: z.array(z.number().int().min(0)).describe("Printed page numbers that can be read."),
      })
      .strict(),
    orientation: z.enum(["upright", "rotated_90_cw", "rotated_90_ccw", "upside_down"]),
    subject: z.string().min(1),
    topic: z.string().min(1),
    gradeLevel: z.string().optional(),
    /** Who the page is written for (decision D25); the server copies it to SceneSpec.audience. */
    audience: z.enum(["child", "teen", "adult"]).optional(),
    contentType: ContentType,
    literary: z
      .object({
        isLiterary: z.boolean().describe("Creative prose or poetry by an author: must be paraphrased, never copied."),
        author: z.string().optional(),
        work: z.string().optional(),
      })
      .strict(),
    summary: z.string().min(1),
    concepts: z.array(z.string().min(1)),
    entities: z.array(PageEntity),
    claims: z.array(PageClaim),
    exercises: z.array(z.string().min(1)),
    illustrations: z.array(Illustration),
    suggestedEngine: AnalysisEngine,
    engineReason: z.string().min(1),
  })
  .strict();
export type PageAnalysis = z.infer<typeof PageAnalysis>;

/** JSON Schema (draft-07, the dialect the Claude Code CLI validates `--json-schema` with). */
export function pageAnalysisJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PageAnalysis, { target: "draft-07" }) as Record<string, unknown>;
}
