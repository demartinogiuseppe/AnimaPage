// Locale helpers shared by the server, the engines and the web app (decision D21). Italian stays the
// default everywhere: every helper returns today's Italian behaviour when no locale (or "it") is given.

/** Strict BCP-47 subset: language, optional script, optional region ("ja", "en-GB", "zh-Hant-TW", "es-419"). */
export const LOCALE_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-(?:[A-Z]{2}|\d{3}))?$/;
export const DEFAULT_LOCALE = "it-IT";

/** Canonical locale tag, or null when `raw` is not a short, plain BCP-47 tag (no extensions, no free text). */
export function normalizeLocale(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 20) return null;
  const s = raw.trim().replace(/_/g, "-");
  if (!/^[A-Za-z0-9-]+$/.test(s)) return null;
  let tag: string | undefined;
  try {
    tag = Intl.getCanonicalLocales(s)[0];
  } catch {
    return null;
  }
  return tag && LOCALE_RE.test(tag) ? tag : null;
}

/** "en-GB" -> "en". */
export const baseLang = (tag: string): string => tag.replace(/_/g, "-").split("-")[0]!.toLowerCase();
/** True for no locale (the default) and every Italian locale. */
export const isItalian = (tag?: string | null): boolean => !tag || baseLang(tag) === "it";
/** "en-GB" -> "GB"; undefined without a region. */
export const regionOf = (tag: string): string | undefined => /-([A-Z]{2})$/.exec(tag)?.[1];

const RTL = new Set(["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug"]);
export const isRtl = (tag: string): boolean => RTL.has(baseLang(tag));

/**
 * English name of a language for prompts ("Japanese", "British English"), from Intl.DisplayNames;
 * only letters, spaces and ()-,' survive, so nothing but a language name can reach a prompt.
 */
export function languageName(tag: string): string {
  let name = "";
  try {
    name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? "";
  } catch {
    /* unknown tag */
  }
  return /^[A-Za-z][A-Za-z ()',-]{0,60}$/.test(name) ? name : baseLang(tag).replace(/[^a-z]/g, "");
}

/** Name of a language in that language ("日本語", "English"), for the language picker. */
export function nativeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

// ---------------------------------------------------------------- numbers

export interface NumberMarks {
  group: string;
  decimal: string;
}
const IT_MARKS: NumberMarks = { group: ".", decimal: "," };
const marksCache = new Map<string, NumberMarks>();

/** Thousands separator and decimal mark of a locale (Latin digits); Italian: "." and ",". */
export function numberMarks(tag?: string | null): NumberMarks {
  if (isItalian(tag)) return IT_MARKS;
  let m = marksCache.get(tag!);
  if (!m) {
    m = { group: ",", decimal: "." };
    try {
      for (const p of new Intl.NumberFormat(tag!, { numberingSystem: "latn", useGrouping: true }).formatToParts(1234567.5)) {
        if (p.type === "group") m.group = p.value;
        if (p.type === "decimal") m.decimal = p.value;
      }
    } catch {
      /* unknown locale: English marks */
    }
    marksCache.set(tag!, m);
  }
  return m;
}

/**
 * Locale of the lesson on screen, for the numbers, dates and default labels the engines draw.
 * The player sets it from SceneSpec.lang when a lesson is mounted; Italian by default.
 */
let display = DEFAULT_LOCALE;
export function setDisplayLocale(tag?: string | null): void {
  display = normalizeLocale(tag) ?? DEFAULT_LOCALE;
}
export const displayLocale = (): string => display;
/** Decimal mark of the lesson on screen ("," in Italian). */
export const decimalMark = (): string => numberMarks(display).decimal;
/** Thousands separator of the lesson on screen ("." in Italian). */
export const groupMark = (): string => numberMarks(display).group;

// ---------------------------------------------------------------- reading time

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
/** Scripts written without spaces between words (Intl.Segmenter counts the words). */
const UNSPACED = new Set(["th", "lo", "km", "my"]);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Length of a text in "spoken words" for reading-time estimates. Spaced scripts: words split by
 * spaces (unchanged Italian behaviour). Chinese/Japanese: characters (a Japanese character is ~0.4 of
 * a word, a Chinese one ~0.6). Thai, Lao, Khmer, Burmese: Intl.Segmenter words.
 */
export function speechUnits(text: string, lang?: string | null): number {
  const base = lang ? baseLang(lang) : "it";
  if (base === "ja" || base === "zh" || base === "yue") {
    const n = text.match(CJK)?.length ?? 0;
    return n * (base === "ja" ? 0.4 : 0.6) + words(text.replace(CJK, " "));
  }
  if (UNSPACED.has(base) && typeof Intl.Segmenter === "function") {
    let n = 0;
    for (const s of new Intl.Segmenter(base, { granularity: "word" }).segment(text)) if (s.isWordLike) n++;
    return n;
  }
  return words(text);
}
