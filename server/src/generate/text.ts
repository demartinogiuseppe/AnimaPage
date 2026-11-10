// Small text helpers shared by the checks, the post-processing and the card fallback. Italian by
// default; with a `lang` (lesson locale, decision D21) numbers follow that locale's marks, number words
// and spoken forms are skipped (Italian-only), and reading time works for scripts without spaces.
import { isItalian, numberMarks, speechUnits } from "@pv/scene-spec/i18n";

/** Reading time used for narration timing (brief: ~0.36 s per word) and the gap after a sentence. */
export const SECONDS_PER_WORD = 0.36;
export const SENTENCE_GAP = 0.8;

export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Seconds the voice needs for a sentence (without the gap); CJK/Thai lessons count characters/segments. */
export const readingTime = (s: string, lang?: string): number => (isItalian(lang) ? wordCount(s) : speechUnits(s, lang)) * SECONDS_PER_WORD;

/**
 * Numbers in a text, normalised so "5 590 076", "5.590.076" and "5590076" compare equal
 * (Italian: dot and space group thousands, comma is the decimal mark).
 */
export function numbersIn(text: string, lang?: string): string[] {
  if (!isItalian(lang)) return localeNumbersIn(text, lang!);
  const out: string[] = [];
  for (const m of text.matchAll(/\d{1,3}(?:[ .  ]\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g)) {
    out.push(m[0].replace(/[ .  ]/g, "").replace(",", "."));
  }
  return out;
}

/** Arabic-Indic, Persian, Devanagari and full-width digits -> 0-9. */
export const asciiDigits = (s: string): string =>
  s.replace(/[٠-٩۰-۹०-९０-９]/g, (c) => {
    const n = c.charCodeAt(0);
    return String(n - (n >= 0xff10 ? 0xff10 : n >= 0x0966 ? 0x0966 : n >= 0x06f0 ? 0x06f0 : 0x0660));
  });

/**
 * Numbers of a text in any locale, normalised like numbersIn ("5590076", "13.5"). Groups of exactly
 * three digits joined by one repeated separator are thousands; a single "," or "." before three digits is
 * read with the locale's own decimal mark ("1,234" is 1234 in English, 1.234 in German); any other
 * "," or "." is a decimal mark.
 */
export function localeNumbersIn(text: string, lang: string): string[] {
  const { decimal } = numberMarks(lang);
  const out: string[] = [];
  const re = /\d{1,3}([,.  '’ ])\d{3}(?:\1\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
  for (const m of asciiDigits(text).matchAll(re)) {
    const tok = m[0];
    const sep = m[1];
    if (!sep) {
      out.push(tok.replace(",", "."));
      continue;
    }
    const groups = tok.split(sep);
    const tail = /[.,]\d+$/.exec(groups[groups.length - 1]!.slice(3));
    if (groups.length === 2 && !tail && sep === decimal) out.push(tok.replace(sep, "."));
    else out.push(groups.join("").replace(/[.,](?=\d+$)/, "."));
  }
  return out;
}

const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17,
  diciotto: 18, diciannove: 19, venti: 20, trenta: 30, quaranta: 40, cinquanta: 50, cento: 100, mille: 1000,
  primo: 1, prima: 1, secondo: 2, seconda: 2, terzo: 3, terza: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5,
  meta: 50, "metà": 50,
};

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToInt(s: string): number | undefined {
  if (!/^[IVXLCDM]+$/.test(s)) return undefined;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!]!;
    const next = ROMAN[s[i + 1] ?? ""] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/** Numbers a text states in any form: digits, number words (Italian only), Roman numerals. */
export function statedNumbers(text: string, lang?: string): string[] {
  const out = numbersIn(text, lang);
  if (isItalian(lang))
    for (const w of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
      const n = NUMBER_WORDS[w];
      if (n !== undefined) out.push(String(n));
    }
  for (const r of text.match(/\b[IVXLCDM]{1,6}\b/g) ?? []) {
    const n = romanToInt(r);
    if (n !== undefined) out.push(String(n));
  }
  return out;
}

const ORDINALS = [
  "", "primo", "secondo", "terzo", "quarto", "quinto", "sesto", "settimo", "ottavo", "nono", "decimo",
  "undicesimo", "dodicesimo", "tredicesimo", "quattordicesimo", "quindicesimo", "sedicesimo",
  "diciassettesimo", "diciottesimo", "diciannovesimo", "ventesimo", "ventunesimo",
];

/**
 * Spoken form of a sentence when it contains abbreviations the voice would misread
 * (a.C., d.C., km², %, Roman numerals before "secolo"/"millennio"). Undefined when no change is needed.
 */
export function autoSpeech(text: string, lang?: string): string | undefined {
  // Italian abbreviations and ordinals only: other languages get no automatic spoken form.
  if (!isItalian(lang)) return undefined;
  let s = text
    .replace(/\ba\.\s?C\./g, "avanti Cristo")
    .replace(/\bd\.\s?C\./g, "dopo Cristo")
    .replace(/ab\.\s?\/\s?km²/g, "abitanti per chilometro quadrato")
    .replace(/km²/g, "chilometri quadrati")
    .replace(/m²/g, "metri quadrati")
    .replace(/(\d)\s?%/g, "$1 per cento")
    .replace(/\b([IVXLCDM]{1,5})\s+(secol[oi]|millenni[oi])\b/g, (m, r: string, w: string) => {
      const n = romanToInt(r);
      return n !== undefined && ORDINALS[n] ? `${ORDINALS[n]} ${w}` : m;
    });
  // Thousands written with spaces or dots are read digit group by digit group: join them.
  s = s.replace(/\b\d{1,3}(?:[ .  ]\d{3})+\b/g, (m) => m.replace(/[ .  ]/g, ""));
  return s === text ? undefined : s;
}

/** Splits a paragraph into sentences: after . ! ? when the next word starts with a capital or a quote, after 。！？. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý«"“])|(?<=[。！？])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}
