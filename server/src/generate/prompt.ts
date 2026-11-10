// Generation request: engine choice, prompt (rules + guide + catalogs + example + inputs) and repair.
//
// Everything large goes into the user prompt (stdin of the CLI); the system prompt stays short
// because it travels on the command line together with the JSON schema (see schema.ts).
// Changing any text changes the request hash: re-record fixtures/llm/ and bump the version.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { audienceFromGrade, dioramaCatalogPrompt, SOUND_CATALOG, type EngineId, type PageAnalysis } from "@pv/scene-spec";
import { isItalian, languageName, normalizeLocale } from "@pv/scene-spec/i18n";
import type { StructuredRequest } from "../llm/types.ts";
import type { GenerateInput, GeoContext } from "../pipeline/types.ts";
import { allowedSources, isMathPage } from "./checks.ts";
import { artSection } from "./art.ts";
import { engineExample } from "./example.ts";
import { SLIDER_RULES } from "./guides/sliders.ts";
import { CONTENT_RULES, ENGINE_GUIDES, MATH_GUIDE, SCENE_RULES, SYSTEM_PROMPT } from "./guides/index.ts";
import { sceneJsonSchema } from "./schema.ts";

export const GENERATE_PROMPT_VERSION = "gen-6";

/** Voices for dialogues (decision D16): one voice per character with its language; the narrator speaks Italian. */
const STAGE_VOICES = `VOICES (stage): scene "voices" has one entry per character { id (= the character's voice id), name, lang, prefer: "female" | "male", pitch?, rate? }. lang is the BCP-47 language the character SPEAKS in its lines: "en-GB" for English lines (a foreign-language lesson), "fr-FR", "de-DE", "es-ES"..., "it-IT" for Italian characters. Learners hear foreign lines slower: rate 0.85-0.95. The narrator (sentences without speaker) always speaks Italian and translates or explains the foreign lines; a character's single line in another language gets its own "lang".`;

/**
 * Lesson language for non-Italian locales (decision D21). Italian lessons get no section at all, so their
 * prompt stays byte-identical to the recorded one. Built only from the validated tag and its English name.
 */
export function languageSection(locale: string): string {
  const name = languageName(locale);
  let sample = "1,234,567.5";
  try {
    sample = new Intl.NumberFormat(locale, { numberingSystem: "latn" }).format(1234567.5);
  } catch {
    /* English sample */
  }
  return [
    `LESSON LANGUAGE: ${name} (${locale}). This overrides every rule, guide and example above that says "Italian": write ALL user-facing text in ${name}: title, chips, dates, narration, pins, deep, quiz, book, activity (questions, options, prompt, proof, stamp), disclaimers, status texts and every text of engineData (labels, captions, names, titles, units written as words). The page analysis and the facts may be in another language: translate them faithfully. The examples above are in Italian only to show the format.`,
    `Numbers: digits 0-9 in the ${name} format (e.g. ${sample}), with exactly the values of the page and the facts. "speech" only when the ${name} voice would misread an abbreviation or symbol.`,
    `The narrator (sentences without speaker) speaks ${name}. Dialogue lines in another language keep their own "lang" as described.`,
  ].join("\n");
}

/** Generation recordings live apart from the analysis ones (fixtures/llm/), which tests read as PageAnalysis. */
export const GENERATE_FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/llm/generate/", import.meta.url));

/** Web asset base: GeoContext asset paths are relative to it. */
export const ASSET_BASE_DIR = fileURLToPath(new URL("../../../fixtures/public/", import.meta.url));

export interface EngineChoice {
  engine: EngineId;
  /** Why the generator did not use analysis.suggestedEngine (absent when it did). */
  override?: string;
}

const DATED = /\b\d{3,4}\b|\b[IVX]+ secolo\b/;

export function chooseEngine(a: PageAnalysis, geo?: GeoContext): EngineChoice {
  if (!a.readable) return { engine: "card", override: "page not readable" };
  if (isMathPage(a) && a.suggestedEngine === "card") return { engine: "concept", override: "maths page: worked examples with graphs" };
  if (a.suggestedEngine === "map" && !geo) {
    const dated = a.entities.filter((e) => (e.type === "date" || e.type === "event") && DATED.test(`${e.name} ${e.value ?? ""}`));
    return dated.length >= 3
      ? { engine: "timeline", override: "map page without geo context; dated events -> timeline" }
      : { engine: "card", override: "map page without geo context" };
  }
  return { engine: a.suggestedEngine };
}

function soundCatalog(): string {
  return SOUND_CATALOG.map((s) => `${s.id} | ${s.category} | ${s.en} | ${s.tags.join(",")}`).join("\n");
}

function riverIds(geo: GeoContext, assetDir: string): string {
  const file = geo.riversAsset ? join(assetDir, geo.riversAsset) : "";
  if (!file || !existsSync(file)) return "none";
  const fc = JSON.parse(readFileSync(file, "utf8")) as { features?: { properties?: { id?: string; name?: string } }[] };
  return (fc.features ?? []).map((f) => `${f.properties?.id} (${f.properties?.name ?? ""})`).join(", ");
}

function geoSection(geo: GeoContext, assetDir: string): string {
  return [
    "GEO CONTEXT (copy exactly)",
    `bbox: ${JSON.stringify(geo.bbox)}`,
    `terrain.asset: ${geo.terrainAsset}`,
    `boundaries.asset: ${geo.boundariesAsset}`,
    `boundaries.focus: ${geo.focus}`,
    `boundaries.neighbors: ${JSON.stringify(geo.neighbors)}`,
    `rivers.asset: ${geo.riversAsset ?? "none (omit engineData.rivers)"}`,
    `river ids: ${riverIds(geo, assetDir)}`,
  ].join("\n");
}

/** The parts of the analysis the generator needs (no photo metadata). */
function analysisForPrompt(a: PageAnalysis): unknown {
  return {
    subject: a.subject,
    topic: a.topic,
    gradeLevel: a.gradeLevel,
    audience: a.audience ?? audienceFromGrade(a.gradeLevel),
    pageNumbers: a.pages.numbers,
    contentType: a.contentType,
    literary: a.literary,
    summary: a.summary,
    concepts: a.concepts,
    entities: a.entities.map((e) => (e.value ? `${e.name} [${e.type}] = ${e.value}` : `${e.name} [${e.type}]`)),
    claims: a.claims.map((c) => `(${c.kind}) ${c.text}`),
    exercises: a.exercises,
    illustrations: a.illustrations.map((i) => `${i.kind}: ${i.description}${i.labels.length ? ` Labels: ${i.labels.join(", ")}` : ""}`),
    engineReason: a.engineReason,
  };
}

export function buildPrompt(input: GenerateInput, engine: EngineId, assetDir = ASSET_BASE_DIR): string {
  const { analysis, enrich, geo } = input;
  const math = engine === "concept" && isMathPage(analysis);
  const locale = isItalian(input.locale) ? undefined : (normalizeLocale(input.locale) ?? undefined);
  const sources = allowedSources(input)
    .map((s) => `${s.id} | ${s.kind} | ${s.title}`)
    .join("\n");
  const facts = enrich.facts.length
    ? enrich.facts.map((f) => `${f.id} | source ${f.sourceId} | ${f.entity ? `[${f.entity}] ` : ""}${f.text}`).join("\n")
    : "none";
  const discrepancies = enrich.discrepancies.length
    ? enrich.discrepancies.map((d) => `${d.claim}: book ${d.bookValue} vs source ${d.sourceValue} (${d.sourceId})${d.note ? ` — ${d.note}` : ""}`).join("\n")
    : "none";
  return [
    `[${GENERATE_PROMPT_VERSION}] Write the SceneSpec for the "${engine}" engine (engine: "${engine}") for the book page described below.`,
    "",
    CONTENT_RULES,
    "",
    SCENE_RULES,
    "",
    ENGINE_GUIDES[engine] ?? "",
    ...(SLIDER_RULES[engine] ? [SLIDER_RULES[engine]!] : []),
    ...(math ? ["", MATH_GUIDE] : []),
    "",
    "SOUND CATALOG (id | category | description | tags)",
    soundCatalog(),
    ...(engine === "diorama" || engine === "stage" ? ["", "DIORAMA MODEL CATALOG (id | description | size x*y*z m | tags | anims)", dioramaCatalogPrompt("en")] : []),
    "",
    "FORMAT EXAMPLE: one trimmed chapter of a hand-written scene for the same engine. It shows the shape and the style only. Its topic may differ from this page: never copy its content, sources or numbers.",
    engineExample(engine, undefined, math),
    "",
    "=== INPUT ===",
    "PAGE ANALYSIS (what is printed on the page)",
    JSON.stringify(analysisForPrompt(analysis)),
    "",
    "SOURCES (the only ids you may cite)",
    sources,
    "",
    "VERIFIED FACTS (id | source | text)",
    facts,
    "",
    "DISCREPANCIES (show both values)",
    discrepancies,
    ...(engine === "map" && geo ? ["", geoSection(geo, assetDir)] : []),
    ...(engine === "art" ? ["", artSection(input.art)] : []),
    ...(engine === "stage" ? ["", locale ? STAGE_VOICES.replace("always speaks Italian", `always speaks ${languageName(locale)}`) : STAGE_VOICES] : []),
    ...(locale ? ["", languageSection(locale)] : []),
  ].join("\n");
}

export function generationRequest(input: GenerateInput, engine: EngineId, assetDir = ASSET_BASE_DIR): StructuredRequest {
  return {
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input, engine, assetDir),
    jsonSchema: sceneJsonSchema(engine, SYSTEM_PROMPT.length).schema,
  };
}

export function repairRequest(first: StructuredRequest, previous: unknown, issues: string[]): StructuredRequest {
  return {
    ...first,
    prompt: [
      first.prompt,
      "",
      "=== REPAIR ===",
      "Your previous answer (below) did not pass validation. Fix every problem listed, keep everything else as it was, and return the full corrected SceneSpec.",
      "Problems:",
      ...issues.map((i) => `- ${i}`),
      "",
      "Previous answer:",
      JSON.stringify(previous),
    ].join("\n"),
  };
}
