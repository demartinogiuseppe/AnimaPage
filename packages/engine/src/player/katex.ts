// KaTeX for formulas in the Accademico presentation (decision D24): loaded on first use (its own chunk,
// ~270 kB JS + 25 kB CSS; the fonts are bundled with the app and precached for offline use), never in
// the pop-up book. The lesson's plain-text formulas go through texFromPlain() (util/math-text.ts):
// every character is mapped or escaped, KaTeX runs with trust off and throwOnError, and any failure
// leaves the plain text where it was.
import type katexType from "katex";
import { texFromPlain } from "../util/math-text.ts";

export type Katex = typeof katexType;

/** A backslash command among href, url, html*, includegraphics (\x5c = backslash). */
const UNSAFE = /\x5c(href|url|html[A-Za-z]*|includegraphics)\b/;

let loading: Promise<Katex | null> | null = null;

/** Loads KaTeX, its stylesheet and the fonts the canvas boards use. Null if it cannot load (offline first visit). */
export function loadKatex(): Promise<Katex | null> {
  loading ??= (async () => {
    try {
      const [mod] = await Promise.all([import("katex"), import("katex/dist/katex.min.css")]);
      if (typeof document !== "undefined" && document.fonts?.load) {
        const faces = ["20px KaTeX_Main", "bold 20px KaTeX_Main", "italic 20px KaTeX_Math", "italic bold 20px KaTeX_Math", "20px KaTeX_AMS", "20px KaTeX_Size1"];
        // "∑ π x": a sample with a variable, a digit-free symbol and a big operator.
        await Promise.all(faces.map((f) => document.fonts.load(f, "x∑π1").catch(() => [])));
      }
      return mod.default;
    } catch (e) {
      console.warn("[player] KaTeX unavailable, formulas stay as plain text:", e);
      return null;
    }
  })();
  return loading;
}

/** KaTeX HTML for a lesson formula, or null when it cannot be typeset (the caller keeps the plain text). */
export function renderFormula(katex: Katex, text: string): string | null {
  if (!text.trim()) return null;
  const tex = texFromPlain(text);
  // LaTeX written by the lesson: links, HTML hooks and images are refused outright (KaTeX would only
  // show them as inert red text with trust off, but a plain-text formula is the better fallback).
  if (UNSAFE.test(tex)) return null;
  try {
    return katex.renderToString(tex, {
      throwOnError: true,
      trust: false,
      strict: "ignore",
      displayMode: false,
      maxSize: 10,
      maxExpand: 100,
      output: "htmlAndMathml",
    });
  } catch {
    return null;
  }
}

/** Shows `text` in `el` at once, then typesets it when KaTeX is ready (unless the element changed meanwhile). */
export function typesetInto(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.dataset.tex = text;
  void loadKatex().then((k) => {
    if (!k || el.dataset.tex !== text) return;
    const html = renderFormula(k, text);
    if (html === null) return;
    el.innerHTML = html;
    el.classList.add("pv-tex");
  });
}
