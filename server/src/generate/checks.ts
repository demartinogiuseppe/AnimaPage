// After generation: deterministic fixes (things the server knows better than the model)
// and content checks on top of checkScene (brief §4.1, §4.6).
//
// Fixes never invent content: they copy data from the inputs (page info, sources, videos,
// geo assets), add the mandatory notices, attach "page"/fact source ids to numbers that
// really are on the page or in a fact, add spoken forms for abbreviations, and lengthen
// chapters that are too short for their narration.
import { audienceFromGrade, conceptMathNumbers, PAGE_SOURCE_ID, soundInfo, type Chapter, type SceneSpec, type Source } from "@pv/scene-spec";
import type { Discrepancy, GenerateInput, Issue } from "../pipeline/types.ts";
import { labMathNumbers } from "./labmath.ts";
import { pageFormulaNumbers, skyMathNumbers, solidMathNumbers, workshopMathNumbers } from "./enginemath.ts";
import { isItalian, textIn } from "@pv/scene-spec/i18n";
import { lessonCatalog } from "../i18n.ts";
import { autoSpeech, numbersIn, numbersIn as numbersInLang, readingTime, statedNumbers as statedIn } from "./text.ts";

/** A lesson text in the lesson's language (D21): built-in catalog, the server's translation, English. */
export const lessonText = (locale: string | undefined, key: Parameters<typeof textIn>[1], vars?: Record<string, string | number>) =>
  textIn(locale, key, vars, locale ? lessonCatalog(locale) : undefined);

export const AI_DISCLAIMER = "Lezione generata automaticamente con l'intelligenza artificiale a partire dalla pagina fotografata: può contenere errori, controlla sempre sul libro.";
export const RECONSTRUCTION_DISCLAIMER = "Ricostruzione animata e semplificata: luoghi, personaggi, proporzioni e movimenti servono a spiegare e non sono in scala.";
export const literaryDisclaimer = (author?: string, work?: string, locale?: string) =>
  lessonText(locale, "lesson.literary", {
    by: author ? lessonText(locale, "lesson.literaryBy", { author }) + (work ? lessonText(locale, "lesson.literaryWork", { work }) : "") : "",
  });
export const exaggerationDisclaimer = (n: number, locale?: string) => lessonText(locale, "lesson.exaggeration", { n });

/** A file under the app's asset folders: no scheme, no host, no "..", no query. */
const LOCAL_ASSET = /^\/?(?:models|art|cache\/art|geo|cache\/geo|audio)\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** Default background music by scene kind, used only when the model gave none. */
const DEFAULT_MUSIC: Record<SceneSpec["kind"], string> = {
  geography: "music-calm",
  history: "music-history",
  myth: "music-history",
  science: "music-curious",
  mixed: "music-calm",
  art: "music-calm",
};

export function pageSource(input: GenerateInput): Source {
  const fromEnrich = input.enrich.sources.find((s) => s.id === PAGE_SOURCE_ID);
  if (fromEnrich) return fromEnrich;
  const a = input.analysis;
  const pages = a.pages.numbers.length ? lessonText(input.locale, "lesson.pageSourcePages", { pages: a.pages.numbers.join("-") }) : "";
  return { id: PAGE_SOURCE_ID, kind: "page", title: lessonText(input.locale, "lesson.pageSource", { pages, topic: a.topic }) };
}

/** Maths pages (decision D13): subject, or formulas in the page's claims. */
export function isMathPage(a: GenerateInput["analysis"]): boolean {
  // Italian stems first; the others cover subjects written in the user's language (D21).
  if (/matemat|geometr|algebr|fisic|aritmet|math|physi|arithm|géom|rechnen|数学|算数|物理|математ|физик|رياضيات|فيزياء|गणित/i.test(a.subject)) return true;
  return a.claims.some((c) => /f\(x\)|[x-z]\s*[²³^]|√|\b[xy]\s*[=<>≤≥≠]/.test(c.text));
}

/** Source of the numbers computed in worked examples (zeros, excluded values, f(1)...). */
export const CALC_SOURCE: Source = { id: "calc", kind: "computed", title: "Calcoli svolti nella lezione a partire dalle formule dei grafici" };
const calcSource = (locale?: string): Source => (isItalian(locale) ? CALC_SOURCE : { ...CALC_SOURCE, title: lessonText(locale, "lesson.calcSource") });

/** Every source the scene may cite: the page, the enrichment sources, the geodata sources, "calc" on maths pages. */
export function allowedSources(input: GenerateInput): Source[] {
  const out = new Map<string, Source>([[PAGE_SOURCE_ID, pageSource(input)]]);
  if (isMathPage(input.analysis) || input.art || ["art", "lab", "workshop"].includes(input.analysis.suggestedEngine)) out.set(CALC_SOURCE.id, calcSource(input.locale));
  for (const s of input.art?.sources ?? []) if (!out.has(s.id)) out.set(s.id, s);
  for (const s of [...input.enrich.sources, ...(input.geo?.sources ?? [])]) if (!out.has(s.id)) out.set(s.id, s);
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Number provenance

export interface NumberIndex {
  page: Set<string>;
  /** number -> source ids of the facts / discrepancies that state it */
  bySource: Map<string, Set<string>>;
  /** Lesson locale (D21): how the scene's own texts write numbers; undefined = Italian. */
  lang?: string;
}

/** Ways a computed value may be written: 2 -> "2"; 1.4142 -> "1.4", "1.41", "1.414" (sign ignored, like numbersIn). */
export function numberSpellings(v: number): string[] {
  const a = Math.abs(v);
  if (Math.abs(a - Math.round(a)) < 1e-9) return [String(Math.round(a))];
  // Rounded and truncated: 4.0554 may be written 4,06 or 4,05.
  const trim = (t: string) => t.replace(/0+$/, "").replace(/\.$/, "");
  return [...new Set([1, 2, 3].flatMap((d) => [trim(a.toFixed(d)), trim((Math.trunc(a * 10 ** d) / 10 ** d).toFixed(d))]))];
}

/**
 * Numbers the scene may show, with the sources that state them: the page, the facts, the
 * discrepancies and, for concept scenes with graphs, every number the graphs imply (source "calc").
 */
export function numberIndex(input: GenerateInput, scene?: SceneSpec): NumberIndex {
  const { analysis, enrich } = input;
  const pageText = [
    analysis.topic,
    analysis.summary,
    ...analysis.concepts,
    ...analysis.entities.map((e) => `${e.name} ${e.value ?? ""}`),
    ...analysis.claims.map((c) => c.text),
    ...analysis.exercises,
    ...analysis.illustrations.flatMap((i) => [i.description, ...i.labels]),
    ...analysis.pages.numbers.map(String),
  ].join("\n");
  const bySource = new Map<string, Set<string>>();
  const add = (n: string, id: string) => bySource.set(n, (bySource.get(n) ?? new Set()).add(id));
  // Non-Italian lessons (D21): the inputs may write numbers the page's way, the lesson's way or the
  // Italian way (facts): every reading counts, so a reformatted number is never a false failure.
  const lang = isItalian(input.locale) ? undefined : input.locale;
  const readings = lang ? [lang, ...(isItalian(analysis.language) ? [] : [analysis.language]), undefined] : [undefined];
  const statedNumbers = (text: string) => [...new Set(readings.flatMap((l) => statedIn(text, l)))];
  const numbersIn = (text: string) => [...new Set(readings.flatMap((l) => numbersInLang(text, l)))];
  for (const f of enrich.facts) for (const n of statedNumbers(`${f.text} ${f.value ?? ""}`)) add(n, f.sourceId);
  for (const d of enrich.discrepancies) {
    for (const n of statedNumbers(d.bookValue)) add(n, PAGE_SOURCE_ID);
    for (const n of statedNumbers(d.sourceValue)) add(n, d.sourceId);
  }
  // Artwork data from the resolver (date, size in cm), cited with its Wikidata source.
  const art = input.art;
  const artSource = art?.sources[0]?.id;
  if (art && artSource) for (const n of [art.date ?? "", ...(art.sizeCm ?? []).map(String)].flatMap((t) => statedNumbers(t))) add(n, artSource);
  // Slider ranges and values of the newer engines ("Prova tu") are scaffolding the scene computes with.
  if (scene && ["sky", "lab", "chart", "stage", "art", "workshop"].includes(scene.engine)) {
    const params: unknown[] = [];
    const grab = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(grab);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) k === "params" && Array.isArray(x) ? params.push(...x) : grab(x);
    };
    grab(scene.engineData);
    for (const p of params as Record<string, unknown>[])
      for (const k of ["min", "max", "value", "step"]) if (typeof p[k] === "number") for (const n of numberSpellings(p[k] as number)) add(n, CALC_SOURCE.id);
  }
  // Formulas printed on the page applied to numbers printed on the page ("V = π · r² · h", r = 2, h = 5).
  for (const v of pageFormulaNumbers(analysis)) for (const n of numberSpellings(v)) add(n, CALC_SOURCE.id);
  if (scene?.engine === "solid") for (const v of solidMathNumbers(scene.engineData)) for (const n of numberSpellings(v)) add(n, CALC_SOURCE.id);
  if (scene?.engine === "sky") for (const v of skyMathNumbers(scene.engineData)) for (const n of numberSpellings(v)) add(n, CALC_SOURCE.id);
  if (scene?.engine === "workshop") for (const v of workshopMathNumbers(scene.engineData)) for (const n of numberSpellings(v)) add(n, CALC_SOURCE.id);
  if (scene?.engine === "lab") {
    // Values the lab engine computes from the scene's own experiments (forces, energies, periods...).
    const lab = labMathNumbers(scene.engineData);
    for (const v of lab.values) for (const n of numberSpellings(v)) add(n, CALC_SOURCE.id);
    for (const t of lab.texts) for (const n of numbersIn(t)) add(n, CALC_SOURCE.id);
  }
  if (scene?.engine === "concept" && scene.engineData.graphs?.length) {
    for (const m of conceptMathNumbers(scene.engineData, scene.chapters.map((c) => c.id)))
      for (const n of numberSpellings(m.value)) add(n, CALC_SOURCE.id);
  }
  return { page: new Set(statedNumbers(pageText)), bySource, ...(lang ? { lang } : {}) };
}

/** Numbers that are harmless outside facts ("3D"). */
const IGNORED = /\b[23]D\b/g;

/** Source ids that state every number of `text`, or undefined if some number is in no source. */
function sourcesForNumbers(text: string, idx: NumberIndex): string[] | undefined {
  const ids = new Set<string>();
  for (const n of numbersIn(text.replace(IGNORED, ""), idx.lang)) {
    if (idx.page.has(n)) ids.add(PAGE_SOURCE_ID);
    else if (idx.bySource.has(n)) for (const id of idx.bySource.get(n)!) ids.add(id);
    else return undefined;
  }
  return [...ids];
}

export interface ShownText {
  path: string;
  text: string;
  sourceIds?: string[];
}

const ENGINE_TEXT_KEYS = new Set(["title", "name", "text", "sub", "label"]);

/** Every text the player shows (not the disclaimers, not the spoken forms). */
export function shownTexts(scene: SceneSpec): ShownText[] {
  const out: ShownText[] = [{ path: "title", text: scene.title }];
  scene.chapters.forEach((ch, c) => {
    const at = `chapters[${c}]`;
    out.push({ path: `${at}.title`, text: [ch.title, ch.chip, ch.dates ?? ""].join(" · ") });
    ch.narration.forEach((s, i) => out.push({ path: `${at}.narration[${i}]`, text: s.text, sourceIds: s.sourceIds }));
    ch.pins.forEach((p, i) => out.push({ path: `${at}.pins[${i}]`, text: `${p.name} ${p.sub ?? ""} ${p.info}`, sourceIds: p.sourceIds }));
    ch.deep.forEach((d, i) => out.push({ path: `${at}.deep[${i}]`, text: d.text, sourceIds: d.sourceIds }));
    // Wrong options of a choice quiz are not statements: their numbers are not checked.
    ch.quiz.forEach((q, i) =>
      out.push({ path: `${at}.quiz[${i}]`, text: [q.q, ...(q.type === "choice" ? [q.options[q.answer] ?? ""] : []), q.explain].join(" ") }),
    );
    ch.status?.forEach((s, i) => out.push({ path: `${at}.status[${i}]`, text: s.text }));
    if (ch.book) out.push({ path: `${at}.book`, text: [ch.book.heading, ch.book.formula ?? "", ...ch.book.lines].join(" "), sourceIds: ch.book.sourceIds });
    if (ch.activity) {
      const a = ch.activity;
      out.push({ path: `${at}.activity.predict`, text: [a.predict.q, a.predict.options[a.predict.answer] ?? "", a.test.prompt, a.stamp].join(" ") });
      out.push({ path: `${at}.activity.prove`, text: a.prove.text, sourceIds: a.prove.sourceIds });
    }
  });
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "string" && ENGINE_TEXT_KEYS.has(k) && !k.endsWith("asset")) out.push({ path: `${path}.${k}`, text: x });
        else walk(x, `${path}.${k}`);
      }
  };
  walk(scene.engineData, "engineData");
  return out;
}

/** Numbers shown to the user that appear neither on the page nor in a verified fact. */
export function checkNumberProvenance(scene: SceneSpec, idx: NumberIndex): Issue[] {
  const issues: Issue[] = [];
  for (const t of shownTexts(scene)) {
    const missing = numbersIn(t.text.replace(IGNORED, ""), idx.lang).filter((n) => !idx.page.has(n) && !idx.bySource.has(n));
    if (missing.length) issues.push({ path: t.path, message: `number not on the page nor in the facts (${[...new Set(missing)].join(", ")}): "${t.text.slice(0, 120)}"` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Other content checks (warnings)

export function checkGeoBounds(scene: SceneSpec, input: GenerateInput): Issue[] {
  if (scene.engine !== "map") return [];
  const b = input.geo?.bbox ?? scene.engineData.area.bbox;
  const inside = ([lon, lat]: [number, number]) => lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;
  const issues: Issue[] = [];
  const anchor = (path: string, a: unknown) => {
    if (a && typeof a === "object" && "geo" in a && !inside((a as { geo: [number, number] }).geo))
      issues.push({ path, message: `geo point ${JSON.stringify((a as { geo: unknown }).geo)} outside the map area` });
  };
  scene.chapters.forEach((ch, c) => {
    ch.pins.forEach((p, i) => anchor(`chapters[${c}].pins[${i}].anchor`, p.anchor));
    ch.camera.forEach((k, i) => anchor(`chapters[${c}].camera[${i}].target`, k.target));
  });
  scene.engineData.columns?.items.forEach((it, i) => anchor(`engineData.columns.items[${i}]`, { geo: it.geo }));
  scene.engineData.effects.forEach((e, i) => anchor(`engineData.effects[${i}]`, { geo: e.geo }));
  return issues;
}

/** Pop-up book page and Prevedi -> Prova -> Dimostra in every chapter (decisions D12, D13). */
export function checkLessonParts(scene: SceneSpec): Issue[] {
  const issues: Issue[] = [];
  // Slider ids (activity.test.params) are checked by each engine inside checkScene.
  scene.chapters.forEach((ch, c) => {
    if (!ch.book) issues.push({ path: `chapters[${c}].book`, message: "missing book (left page of the pop-up book)" });
    if (!ch.activity) issues.push({ path: `chapters[${c}].activity`, message: "missing activity (predict, test, prove, stamp)" });
  });
  return issues;
}

const usesParam = (v: unknown, id: string): boolean => typeof v === "string" && new RegExp(`(^|[^A-Za-z0-9])${id}([^A-Za-z0-9]|$)`).test(v);

/**
 * Maths pages (decision D13): at least one real "Prova tu" (sliders on graph params that drive a plot,
 * with the dependent lines and bands following them), and parity chapters run BOTH mirror tests.
 */
export function checkMathActivity(scene: SceneSpec, input: GenerateInput): Issue[] {
  if (scene.engine !== "concept" || !isMathPage(input.analysis)) return [];
  const issues: Issue[] = [];
  const graphs = scene.engineData.graphs ?? [];
  let usable = 0;
  scene.chapters.forEach((ch, c) => {
    for (const id of ch.activity?.test.params ?? []) {
      const g = graphs.find((q) => q.params?.some((p) => p.id === id));
      if (!g) continue;
      const plots = (g.plots ?? []).filter((p) => usesParam(p.expr, id));
      if (plots.length === 0) {
        issues.push({ path: `chapters[${c}].activity.test.params`, message: `slider "${id}" does not change any plot of graph "${g.id}"` });
        continue;
      }
      usable++;
      const plotIds = new Set(plots.map((p) => p.id));
      g.lines?.forEach((l, i) => {
        if (l.plot && plotIds.has(l.plot) && l.meaning !== "guide" && [l.x, l.y, l.m, l.q].every((v) => v === undefined || typeof v === "number"))
          issues.push({ path: `engineData.graphs[${graphs.indexOf(g)}].lines[${i}]`, message: `${l.meaning ?? "asymptote"} of a curve moved by "${id}" is fixed at a number: write it as a formula of the parameters` });
      });
      g.intervals?.forEach((v, i) => {
        if ([v.from, v.to].some((x) => typeof x === "number"))
          issues.push({ path: `engineData.graphs[${graphs.indexOf(g)}].intervals[${i}]`, message: `band fixed at a number while "${id}" moves the curve: use a parameter formula and a "{...}" label` });
      });
    }
  });
  if (usable === 0) issues.push({ path: "chapters", message: 'maths page without a "Prova tu": no chapter has activity.test.params that move a plot' });
  scene.engineData.chapters.forEach((c, i) => {
    const mirrors = new Map<string, Set<string>>();
    for (const a of c.actions) if (a.do === "mirror") mirrors.set(a.id, (mirrors.get(a.id) ?? new Set()).add(a.about));
    for (const [id, abouts] of mirrors)
      if (abouts.size < 2) issues.push({ path: `engineData.chapters[${i}]`, message: `parity of "${id}": show both mirror tests (y-axis and origin), only ${[...abouts].join()} is shown` });
  });
  return issues;
}

export function checkAudio(scene: SceneSpec): Issue[] {
  const issues: Issue[] = [];
  if (!scene.music) issues.push({ path: "music", message: "no background music" });
  scene.chapters.forEach((ch, c) => {
    if (!ch.sounds || ch.sounds.ambience.length + ch.sounds.cues.length === 0)
      issues.push({ path: `chapters[${c}].sounds`, message: "chapter without sounds" });
  });
  return issues;
}

export function checkStyle(scene: SceneSpec, input: GenerateInput): Issue[] {
  const issues: Issue[] = [];
  const a = input.analysis;
  const fiction = a.literary.isLiterary || (a.claims.length > 0 && a.claims.every((c) => c.kind === "story_event"));
  scene.chapters.forEach((ch, c) => {
    if (fiction && ch.kind === "history") issues.push({ path: `chapters[${c}].kind`, message: "fiction presented as history" });
    let prevEnd = 0;
    ch.narration.forEach((s, i) => {
      if (i > 0 && s.at + 0.2 < prevEnd) issues.push({ path: `chapters[${c}].narration[${i}]`, message: `starts at ${s.at} s, before the previous sentence ends (~${prevEnd.toFixed(1)} s)` });
      prevEnd = s.at + readingTime(s.speech ?? s.text, input.locale);
    });
  });
  if (a.literary.isLiterary) {
    for (const t of shownTexts(scene)) {
      for (const q of t.text.match(/[«"“][^»"”]{60,}[»"”]/g) ?? [])
        issues.push({ path: t.path, message: `long quotation on a literary page (paraphrase instead): ${q.slice(0, 80)}` });
    }
  }
  return issues;
}

const discrepancyShown = (scene: SceneSpec, d: Discrepancy, lang?: string): boolean => {
  const all = new Set(shownTexts(scene).flatMap((t) => numbersIn(t.text, lang)));
  return [...numbersIn(d.bookValue, lang), ...numbersIn(d.sourceValue, lang)].every((n) => all.has(n));
};

// ---------------------------------------------------------------------------
// Deterministic fixes

export interface FixReport {
  /** Human-readable list of what was changed. */
  applied: string[];
}

function fixChapterTiming(ch: Chapter, lang?: string): boolean {
  const last = ch.narration[ch.narration.length - 1];
  if (!last) return false;
  const need = Math.max(
    last.at + readingTime(last.speech ?? last.text, lang) + 1.5,
    ...ch.camera.map((k) => k.at + 1),
    ...(ch.sounds?.cues ?? []).map((q) => q.at + 0.5),
  );
  if (ch.duration >= need) return false;
  ch.duration = Math.round(need * 10) / 10;
  return true;
}

/**
 * Models tend to put the right answer first. Rotates the options of every "choice" quiz so the
 * answer lands at a position derived from the question text (deterministic, same scene = same order).
 * Skipped when the answers are already spread out.
 */
function shuffleAnswers(scene: SceneSpec): boolean {
  const quizzes = scene.chapters.flatMap((ch) => ch.quiz).filter((q) => q.type === "choice");
  const predicts = scene.chapters.flatMap((ch) => (ch.activity ? [ch.activity.predict] : []));
  const a = rotate(quizzes);
  const b = rotate(predicts);
  return a || b;
}

function rotate(quizzes: { q: string; options: string[]; answer: number }[]): boolean {
  if (quizzes.length < 2 || new Set(quizzes.map((q) => q.answer)).size > 1) return false;
  for (const q of quizzes) {
    let h = 0;
    for (const ch of q.q) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const n = q.options.length;
    const target = h % n;
    const shift = (target - q.answer + n) % n;
    q.options = q.options.map((_, i) => q.options[(i - shift + n) % n]!);
    q.answer = target;
  }
  return true;
}

/**
 * A loop used as a one-shot cue becomes a short ambience window (5 s) at the cue time; a one-shot
 * used as ambience becomes a cue at the window start. Unknown ids are left for checkScene.
 */
function fixSoundCategories(ch: Chapter): string[] {
  const s = ch.sounds;
  if (!s) return [];
  const out: string[] = [];
  const cues = s.cues.filter((q) => {
    if (soundInfo(q.sound)?.category !== "ambience") return true;
    s.ambience.push({ sound: q.sound, ...(q.volume !== undefined ? { volume: q.volume } : {}), window: [q.at, Math.min(q.at + 5, ch.duration)] });
    out.push(`cue "${q.sound}" is a loop -> ambience window`);
    return false;
  });
  s.ambience = s.ambience.filter((a) => {
    if (soundInfo(a.sound)?.category !== "sfx") return true;
    cues.push({ at: a.window?.[0] ?? 0, sound: a.sound, ...(a.volume !== undefined ? { volume: a.volume } : {}) });
    out.push(`ambience "${a.sound}" is a one-shot -> cue`);
    return false;
  });
  s.cues = cues.sort((a, b) => a.at - b.at);
  return out;
}

const LANG_WORDS: [string, RegExp][] = [
  ["en-GB", /\b(the|you|what|is|are|please|thank|hello|would|like|can|my|your|have|do|it's|i'm)\b/gi],
  ["fr-FR", /\b(le|la|les|vous|est|je|tu|bonjour|merci|oui|avec|pour|c'est|nous)\b/gi],
  ["de-DE", /\b(der|die|das|ist|ich|du|und|nicht|danke|bitte|guten|ja|wie)\b/gi],
  ["es-ES", /\b(el|los|las|usted|es|yo|hola|gracias|por|favor|qué|cómo|sí)\b/gi],
];
const IT_WORDS = /\b(il|lo|gli|che|non|sono|è|della|questo|perché|anche|come|grazie|ciao)\b/gi;

/** Language of short dialogue lines from function words (undefined = Italian or unclear). */
export function guessLang(text: string): string | undefined {
  const it = text.match(IT_WORDS)?.length ?? 0;
  let best: [string, number] = ["", 0];
  for (const [lang, re] of LANG_WORDS) {
    const n = text.match(re)?.length ?? 0;
    if (n > best[1]) best = [lang, n];
  }
  return best[1] >= 2 && best[1] > it ? best[0] : undefined;
}

/** Applies the server-side fixes in place and returns what was changed. */
export function postprocess(scene: SceneSpec, input: GenerateInput): FixReport {
  const applied: string[] = [];
  const { analysis, enrich, geo } = input;

  scene.version = "0.1";
  const bookPage = analysis.pages.numbers.length ? analysis.pages.numbers.join("-") : undefined;
  scene.page = { subject: analysis.subject, topic: analysis.topic, ...(bookPage ? { bookPage } : {}), language: "it" };
  // Lesson language (D21): set for non-Italian lessons only (absent = Italian).
  if (isItalian(input.locale)) delete scene.lang;
  else scene.lang = input.locale;
  // Reader (D24, D25): the model's own value if it wrote one, else the analysis' audience, else derived
  // from its free-text gradeLevel.
  const audience = scene.audience ?? analysis.audience ?? audienceFromGrade(analysis.gradeLevel);
  if (audience) scene.audience = audience;
  scene.videos = enrich.videos.map((v) => ({ ...v }));

  if (scene.engine === "art") {
    // Copyright gate (D14): only the resolver's public-domain image, never a path the model wrote.
    const aw = scene.engineData.artwork;
    const art = input.art;
    if (art?.publicDomain && art.image) {
      if (JSON.stringify(aw.image) !== JSON.stringify(art.image)) applied.push("artwork.image from the resolver");
      aw.image = { ...art.image };
    } else if (aw.image) {
      delete aw.image;
      applied.push("artwork.image removed: not a public-domain image from the resolver");
    }
    if (art) {
      aw.wikidataId = art.wikidataId;
      if (!aw.image) aw.link = art.link;
    }
    // The model's GLB path is free text written by the model: only a local asset path (docs/security.md, M2).
    const model = scene.engineData.model;
    if (model && !LOCAL_ASSET.test(model.asset)) {
      delete scene.engineData.model;
      applied.push("model removed: its asset is not a local asset path");
    }
  }

  if (scene.engine === "stage") {
    // Foreign-language lines need their voice's language; Italian is the narrator's default.
    const voices = scene.voices ?? [];
    for (const v of voices)
      if (!v.lang) {
        const lines = scene.chapters.flatMap((c) => c.narration.filter((n) => n.speaker === v.id).map((n) => n.text));
        const lang = guessLang(lines.join(" "));
        if (lang) {
          v.lang = lang;
          applied.push(`voices.${v.id}.lang = ${lang}`);
        }
      }
  }

  if (scene.engine === "map" && geo) {
    const d = scene.engineData;
    d.area.bbox = { ...geo.bbox };
    d.terrain.asset = geo.terrainAsset;
    d.boundaries.asset = geo.boundariesAsset;
    d.boundaries.focus = geo.focus;
    d.boundaries.neighbors = [...geo.neighbors];
    if (geo.riversAsset && d.rivers) d.rivers.asset = geo.riversAsset;
    if (!geo.riversAsset && d.rivers) {
      delete d.rivers;
      applied.push("removed rivers: no rivers asset");
    }
  }

  // Numbers without source ids: attach the page / fact sources that really state them.
  const idx = numberIndex(input, scene);
  const attach = (item: { sourceIds: string[] }, text: string, path: string) => {
    if (item.sourceIds.length || !/\d/.test(text)) return;
    const ids = sourcesForNumbers(text, idx);
    if (ids?.length) {
      item.sourceIds = ids;
      applied.push(`${path}: sourceIds ${ids.join(",")}`);
    }
  };
  scene.chapters.forEach((ch, c) => {
    ch.narration.forEach((s, i) => {
      attach(s, s.text, `chapters[${c}].narration[${i}]`);
      if (!s.speech) {
        const sp = autoSpeech(s.text, input.locale);
        if (sp) {
          s.speech = sp;
          applied.push(`chapters[${c}].narration[${i}]: speech`);
        }
      }
    });
    ch.pins.forEach((p, i) => attach(p, `${p.name} ${p.sub ?? ""} ${p.info}`, `chapters[${c}].pins[${i}]`));
    ch.deep.forEach((d, i) => attach(d, d.text, `chapters[${c}].deep[${i}]`));
    if (ch.book) attach(ch.book, [ch.book.heading, ch.book.formula ?? "", ...ch.book.lines].join(" "), `chapters[${c}].book`);
    if (ch.activity) attach(ch.activity.prove, ch.activity.prove.text, `chapters[${c}].activity.prove`);
  });
  if (scene.engine === "concept")
    for (const [i, t] of scene.engineData.tiles.entries()) {
      const item = { sourceIds: t.sourceIds ?? [] };
      attach(item, [t.text, t.sub ?? ""].join(" "), `engineData.tiles[${i}]`);
      if (item.sourceIds.length) t.sourceIds = item.sourceIds;
    }

  // Graph entities draw computed values: on maths pages they cite "calc" when they cite nothing.
  if (scene.engine === "concept" && isMathPage(analysis)) {
    let n = 0;
    for (const g of scene.engineData.graphs ?? [])
      for (const list of [g.plots, g.points, g.lines, g.regions, g.intervals, g.tracers, g.surfaces])
        for (const e of (list ?? []) as { sourceIds?: string[] }[])
          if (!e.sourceIds?.length) {
            e.sourceIds = [CALC_SOURCE.id];
            n++;
          }
    if (n) applied.push(`graphs: ${n} entities cite "calc"`);
  }

  // Discrepancies: both values must be visible.
  for (const d of enrich.discrepancies) {
    if (discrepancyShown(scene, d, input.locale)) continue;
    const src = enrich.sources.find((s) => s.id === d.sourceId);
    scene.chapters[0]!.deep.push({
      text: lessonText(input.locale, "lesson.discrepancy", {
        claim: d.claim,
        book: d.bookValue,
        according: src ? lessonText(input.locale, "lesson.according", { source: src.title }) : lessonText(input.locale, "lesson.accordingSources"),
        value: d.sourceValue,
        note: d.note ? ` (${d.note})` : "",
      }),
      sourceIds: [PAGE_SOURCE_ID, d.sourceId],
    });
    applied.push(`deep: discrepancy "${d.claim}"`);
  }

  // Sources: exactly the allowed ones the scene cites (plus the page). Unknown ids stay
  // referenced and are reported by checkScene.
  const cited = new Set<string>([PAGE_SOURCE_ID]);
  const collect = (v: unknown, key?: string) => {
    if (Array.isArray(v)) v.forEach((x) => (key === "sourceIds" && typeof x === "string" ? cited.add(x) : collect(x)));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (k === "sourceId" && typeof x === "string") cited.add(x);
        else collect(x, k);
      }
  };
  collect(scene.chapters);
  collect(scene.engineData);
  for (const v of scene.videos) if (v.sourceId) cited.add(v.sourceId);
  const before = scene.sources.map((s) => s.id).join(",");
  scene.sources = allowedSources(input).filter((s) => cited.has(s.id));
  if (before !== scene.sources.map((s) => s.id).join(",")) applied.push("sources replaced by the verified list");

  // Mandatory notices.
  const loc = input.locale;
  const need = [lessonText(loc, "lesson.aiDisclaimer")];
  if (scene.engine === "map") need.push(exaggerationDisclaimer(scene.engineData.terrain.verticalExaggeration, loc));
  if (scene.engine === "diorama" || scene.engine === "battle") need.push(lessonText(loc, "lesson.reconstruction"));
  if (analysis.literary.isLiterary) need.push(literaryDisclaimer(analysis.literary.author, analysis.literary.work, loc));
  const has = (d: string) => scene.disclaimers.some((x) => x === d || (d.startsWith("Altezze") && /esagerat/i.test(x)) || (d.startsWith("Il testo è raccontato") && /parole nostre/i.test(x)) || (d.startsWith("Ricostruzione") && /ricostruzion/i.test(x)));
  for (const d of need)
    if (!has(d)) {
      scene.disclaimers.push(d);
      applied.push(`disclaimer: ${d.slice(0, 40)}`);
    }

  if (!scene.music) {
    scene.music = { track: DEFAULT_MUSIC[scene.kind], volume: 0.6 };
    applied.push(`music: ${scene.music.track}`);
  }

  scene.chapters.forEach((ch, c) => {
    if (fixChapterTiming(ch, input.locale)) applied.push(`chapters[${c}].duration -> ${ch.duration}`);
  });
  if (shuffleAnswers(scene)) applied.push("quiz: correct answers moved to varied positions");
  scene.chapters.forEach((ch, c) => {
    for (const m of fixSoundCategories(ch)) applied.push(`chapters[${c}].sounds: ${m}`);
  });
  return { applied };
}
