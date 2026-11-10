// Display of formulas written as plain text by the lessons ("V = π · r² · h", "sen Ĉ = AB/BC",
// "p = dF/dS   [Pa] = [N/m²]"), for the Accademico presentation (decision D24):
// - texFromPlain(): LaTeX for KaTeX (side panel, labels). Every character of the source is either mapped
//   to a known maths construct or escaped, so the result is always well-formed and never carries a
//   command the lesson wrote (KaTeX also runs with trust off).
// - drawFormula(): the same tokens drawn on a 2D canvas (formula boards, tiles) with maths typography:
//   italic variables, upright numbers and words, raised exponents, lowered indices, operator spacing.
//   Uses the KaTeX fonts when they are loaded, a serif otherwise.
// Display only: the safe-maths parser (scene-spec math/expr.ts) still evaluates formulas.

export type MathTok =
  | { k: "var"; s: string; accent?: string }
  | { k: "word"; s: string }
  | { k: "fn"; s: string }
  | { k: "num"; s: string }
  | { k: "op"; s: string; tex: string; rel?: boolean; bin?: boolean }
  | { k: "sup"; s: string }
  | { k: "sub"; s: string }
  | { k: "sqrt"; inner: MathTok[] }
  | { k: "frac"; num: MathTok[]; den: MathTok[] }
  | { k: "gap" }
  | { k: "sp" };

const FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "sen", "tg", "ctg", "log", "ln", "lg", "exp", "lim", "max", "min", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "det", "dim", "mod", "gcd", "mcd", "mcm"]);
const KATEX_FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lg", "exp", "lim", "max", "min", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "det", "dim", "gcd"]);

const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "varepsilon", ζ: "zeta", η: "eta", θ: "theta", ι: "iota", κ: "kappa", λ: "lambda", μ: "mu", ν: "nu",
  ξ: "xi", π: "pi", ρ: "rho", σ: "sigma", ς: "varsigma", τ: "tau", υ: "upsilon", φ: "varphi", χ: "chi", ψ: "psi", ω: "omega",
  Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Σ: "Sigma", Υ: "Upsilon", Φ: "Phi", Ψ: "Psi", Ω: "Omega",
};

/** Operators and symbols: [TeX, relation?, binary?]. */
const OPS: Record<string, [string, boolean?, boolean?]> = {
  "=": ["=", true], "<": ["<", true], ">": [">", true], "≈": ["\\approx ", true], "≠": ["\\neq ", true], "≤": ["\\le ", true], "≥": ["\\ge ", true],
  "~": ["\\sim ", true], "∼": ["\\sim ", true], "≡": ["\\equiv ", true], "∝": ["\\propto ", true], "∈": ["\\in ", true],
  "→": ["\\to ", true], "←": ["\\leftarrow ", true], "↔": ["\\leftrightarrow ", true], "⇒": ["\\Rightarrow ", true], "⇔": ["\\Leftrightarrow ", true],
  "+": ["+", false, true], "-": ["-", false, true], "−": ["-", false, true], "±": ["\\pm ", false, true], "·": ["\\cdot ", false, true], "⋅": ["\\cdot ", false, true],
  "*": ["\\cdot ", false, true], "×": ["\\times ", false, true], "÷": ["\\div ", false, true], ":": [":", true], "/": ["/"],
  "(": ["("], ")": [")"], "[": ["["], "]": ["]"], "|": ["|"], ",": [","], ";": [";"], "?": ["?"], "!": ["!"], ".": ["."], "'": ["'"], "′": ["'"], "″": ["''"],
  "°": ["^{\\circ}"], "%": ["\\%"], "#": ["\\#"], "&": ["\\&"], "$": ["\\$"], "{": ["\\{"], "}": ["\\}"], "\\": ["\\backslash "],
  "∞": ["\\infty "], "∂": ["\\partial "], "∑": ["\\sum "], "∫": ["\\int "], "∏": ["\\prod "], "∇": ["\\nabla "], "∅": ["\\emptyset "],
  "ℝ": ["\\mathbb{R}"], "ℕ": ["\\mathbb{N}"], "ℤ": ["\\mathbb{Z}"], "ℚ": ["\\mathbb{Q}"], "ℂ": ["\\mathbb{C}"],
  "½": ["\\tfrac{1}{2}"], "⅓": ["\\tfrac{1}{3}"], "⅔": ["\\tfrac{2}{3}"], "¼": ["\\tfrac{1}{4}"], "¾": ["\\tfrac{3}{4}"],
};

const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "⁽": "(", "⁾": ")", ⁿ: "n", ⁱ: "i" };
const SUB: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-", ₐ: "a", ₑ: "e", ₒ: "o", ₓ: "x" };
/** Combining accents (after NFD) -> KaTeX accent command. */
const ACCENTS: Record<string, string> = { "̂": "hat", "̄": "bar", "̅": "bar", "̇": "dot", "̃": "tilde", "⃗": "vec", "́": "acute", "̀": "grave", "̈": "ddot" };

const isLetter = (c: string) => /\p{L}/u.test(c);
const isLatin = (c: string) => /\p{Script=Latin}/u.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";
const isMark = (c: string) => /\p{M}/u.test(c);

/** Splits a plain-text formula into tokens. Never throws. */
export function tokenize(src: string): MathTok[] {
  const s = [...src.normalize("NFD")];
  const out: MathTok[] = [];
  let i = 0;
  const peek = (k = 0) => s[i + k] ?? "";
  /** Balanced (...) group after `i` (i at "("), as a string without the outer parens; null if unbalanced. */
  const group = (): string | null => {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")" && --depth === 0) {
        const inner = s.slice(i + 1, j).join("");
        i = j + 1;
        return inner;
      }
    }
    return null;
  };
  const scriptArg = (): string => {
    if (peek() === "{" || peek() === "(") {
      const close = peek() === "{" ? "}" : ")";
      const j = s.indexOf(close, i + 1);
      if (j > i) {
        const inner = s.slice(i + 1, j).join("");
        i = j + 1;
        return inner;
      }
    }
    let arg = "";
    if (peek() === "-" || peek() === "−" || peek() === "+") arg += s[i++];
    while (i < s.length && (isDigit(peek()) || (isLetter(peek()) && isLatin(peek())))) arg += s[i++];
    if (!arg && i < s.length && peek() !== " ") arg = s[i++]!;
    return arg;
  };
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      let n = 0;
      while (i < s.length && /\s/.test(peek())) {
        n += peek() === "\t" ? 2 : 1;
        i++;
      }
      out.push(n >= 2 ? { k: "gap" } : { k: "sp" });
      continue;
    }
    if (isDigit(c)) {
      let num = "";
      while (i < s.length) {
        if (isDigit(peek())) num += s[i++];
        else if ((peek() === "," || peek() === ".") && isDigit(peek(1))) num += s[i++];
        // Thousands with a space: "10 020 528" (groups of exactly three digits).
        else if (peek() === " " && isDigit(peek(1)) && isDigit(peek(2)) && isDigit(peek(3)) && !isDigit(peek(4)) && /^\d{1,3}( \d{3})*$/.test(num)) num += s[i++];
        else break;
      }
      out.push({ k: "num", s: num });
      continue;
    }
    if (c in SUP || c in SUB) {
      const map = c in SUP ? SUP : SUB;
      let v = "";
      while (i < s.length && peek() in map) v += map[s[i++]!];
      out.push({ k: map === SUP ? "sup" : "sub", s: v });
      continue;
    }
    if (c === "^" || c === "_") {
      i++;
      const arg = scriptArg();
      if (arg) out.push({ k: c === "^" ? "sup" : "sub", s: arg });
      else out.push({ k: "op", s: c, tex: c === "^" ? "\\hat{}" : "\\_" });
      continue;
    }
    if (c === "√") {
      i++;
      while (peek() === " ") i++;
      let inner: string | null = null;
      if (peek() === "(") inner = group();
      if (inner === null) {
        inner = "";
        while (i < s.length && (isDigit(peek()) || isLetter(peek()) || isMark(peek()) || peek() in SUP)) inner += s[i++];
      }
      out.push({ k: "sqrt", inner: tokenize(inner) });
      continue;
    }
    if (c in GREEK) {
      i++;
      out.push({ k: "var", s: c });
      continue;
    }
    if (isLetter(c) && !(c in OPS)) {
      let run = "";
      let accent: string | undefined;
      while (i < s.length && (isLetter(peek()) || isMark(peek())) && !(peek() in GREEK)) {
        const ch = s[i++]!;
        if (isMark(ch) && ACCENTS[ch] && [...run].length === 1 && !accent) accent = ACCENTS[ch];
        run += ch;
      }
      const word = run.normalize("NFC");
      const letters = [...word];
      const latin = letters.every(isLatin);
      if (FUNCTIONS.has(word.toLowerCase()) && latin) out.push({ k: "fn", s: word });
      else if (letters.length === 1 && latin) out.push(accent ? { k: "var", s: [...run][0]!, accent } : { k: "var", s: word });
      else if (latin && letters.length <= 3 && (letters.length === 2 || word === word.toUpperCase())) out.push({ k: "var", s: word });
      else out.push({ k: "word", s: word });
      continue;
    }
    i++;
    const op = OPS[c];
    if (op) out.push({ k: "op", s: c, tex: op[0], ...(op[1] ? { rel: true } : {}), ...(op[2] ? { bin: true } : {}) });
    else if (isMark(c)) continue;
    else out.push({ k: "word", s: c });
  }
  return fracs(out);
}

/** a/b with no spaces around the slash, where a and b are runs of variables/numbers (with scripts): a fraction. */
function fracs(toks: MathTok[]): MathTok[] {
  const atom = (t: MathTok | undefined) => !!t && (t.k === "var" || t.k === "num" || t.k === "sup" || t.k === "sub");
  const out: MathTok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k === "op" && t.s === "/" && atom(out.at(-1)) && atom(toks[i + 1]) && toks[i + 1]!.k !== "sup" && toks[i + 1]!.k !== "sub") {
      let a = out.length;
      while (a > 0 && atom(out[a - 1])) a--;
      if (out[a]?.k === "sup" || out[a]?.k === "sub") {
        out.push(t);
        continue;
      }
      let b = i + 1;
      while (b < toks.length && atom(toks[b])) b++;
      const num = out.splice(a);
      out.push({ k: "frac", num, den: toks.slice(i + 1, b) });
      i = b - 1;
    } else out.push(t);
  }
  return out;
}

/** Escapes text for \text{...}. */
export function texText(s: string): string {
  return s.replace(/[\\{}$&#^_%~]/g, (c) =>
    c === "\\" ? "\\textbackslash{}" : c === "^" ? "\\textasciicircum{}" : c === "~" ? "\\textasciitilde{}" : `\\${c}`,
  );
}

const wordish = (t: MathTok | undefined) => !!t && (t.k === "var" || t.k === "word" || t.k === "fn" || t.k === "num" || t.k === "sqrt" || t.k === "frac");

function texScript(s: string): string {
  return tokensToTex(tokenize(s));
}

export function tokensToTex(toks: readonly MathTok[]): string {
  let out = "";
  toks.forEach((t, i) => {
    switch (t.k) {
      case "var":
        if (t.s in GREEK) out += `\\${GREEK[t.s]} `;
        else if (t.accent) out += `\\${t.accent}{${/^[A-Za-z]$/.test(t.s) ? t.s : `\\text{${texText(t.s)}}`}}`;
        else out += /^[A-Za-z]+$/.test(t.s) ? t.s : `\\text{${texText(t.s)}}`;
        break;
      case "word":
        out += `\\text{${texText(t.s)}}`;
        break;
      case "fn":
        out += KATEX_FUNCTIONS.has(t.s) ? `\\${t.s} ` : `\\operatorname{${texText(t.s)}}`;
        break;
      case "num":
        out += t.s.replace(/,/g, "{,}").replace(/ /g, "\\,");
        break;
      case "op":
        out += t.tex;
        break;
      case "sup":
        out += `^{${texScript(t.s)}}`;
        break;
      case "sub":
        out += `_{${texScript(t.s)}}`;
        break;
      case "sqrt":
        out += `\\sqrt{${tokensToTex(t.inner)}}`;
        break;
      case "frac":
        out += `\\frac{${tokensToTex(t.num)}}{${tokensToTex(t.den)}}`;
        break;
      case "gap":
        out += "\\qquad ";
        break;
      case "sp":
        // A visible space only between two words/symbols; around operators the maths spacing applies.
        if (wordish(toks[i - 1]) && wordish(toks[i + 1]) && toks[i - 1]!.k !== "fn") out += "\\ ";
        break;
    }
  });
  return out.trim();
}

/** Text the lesson already wrote as LaTeX: "$...$" or a backslash command. */
export function looksLikeTex(s: string): boolean {
  return /^\s*\$[^$]+\$\s*$/.test(s) || /\\(frac|sqrt|cdot|times|alpha|beta|pi|sum|int|left|right|mathrm|text)\b/.test(s);
}

/** LaTeX for a formula written by a lesson (plain text, or LaTeX already). */
export function texFromPlain(s: string): string {
  if (looksLikeTex(s)) return s.trim().replace(/^\$|\$$/g, "");
  return tokensToTex(tokenize(s));
}

/** Heuristic: short text that reads as a formula (a relation, exponents, roots, Greek), not a phrase. */
export function looksLikeFormula(s: string): boolean {
  if (!s || s.length > 80) return false;
  if (looksLikeTex(s)) return true;
  if (!/[=≈≠≤≥<>²³√π∑∫∂ΔλθαβωρσμΩ^]/.test(s)) return false;
  const words = s.match(/\p{L}{4,}/gu) ?? [];
  return words.length <= 3;
}

// ---------- Canvas ----------

export interface FormulaFonts {
  /** Italic variables. */
  math: string;
  /** Upright numbers, operators, words. */
  main: string;
}
export const KATEX_FONTS: FormulaFonts = { math: '"KaTeX_Math","Times New Roman",serif', main: '"KaTeX_Main","Times New Roman",serif' };

interface Run {
  text: string;
  italic: boolean;
  scale: number;
  /** Baseline shift in em (positive = up). */
  rise: number;
  /** Extra space before/after in em. */
  before: number;
  after: number;
  over?: { from: number };
  width?: number;
}

function runsOf(toks: readonly MathTok[], scale = 1, rise = 0): Run[] {
  const runs: Run[] = [];
  const add = (text: string, italic: boolean, before = 0, after = 0, sc = scale, r = rise) => runs.push({ text, italic, scale: sc, rise: r, before, after });
  toks.forEach((t, i) => {
    switch (t.k) {
      case "var":
        add(t.accent === "hat" ? `${t.s}̂`.normalize("NFC") : t.accent === "bar" ? `${t.s}̄`.normalize("NFC") : t.s, !(t.s in GREEK) || t.s === t.s.toLowerCase());
        break;
      case "word":
      case "num":
        add(t.s, false);
        break;
      case "fn":
        add(t.s, false, 0, 0.12);
        break;
      case "op": {
        const shown = t.s === "-" || t.s === "*" ? (t.s === "-" ? "−" : "·") : t.s;
        // Unary at the start or after another operator ("= −17"): no binary spacing.
        let j = i - 1;
        while (j >= 0 && toks[j]!.k === "sp") j--;
        const bin = t.bin && j >= 0 && toks[j]!.k !== "op" && toks[j]!.k !== "gap";
        add(shown, false, t.rel ? 0.24 : bin ? 0.18 : 0, t.rel ? 0.24 : bin ? 0.18 : t.s === "," || t.s === ";" ? 0.15 : 0);
        break;
      }
      case "sup":
        runs.push(...runsOf(tokenize(t.s), scale * 0.7, rise + 0.42 * scale));
        break;
      case "sub":
        runs.push(...runsOf(tokenize(t.s), scale * 0.7, rise - 0.2 * scale));
        break;
      case "sqrt": {
        add("√", false);
        const inner = runsOf(t.inner, scale, rise);
        if (inner[0]) inner[0].over = { from: runs.length };
        runs.push(...inner);
        break;
      }
      case "frac":
        // Inline on boards: a/b.
        runs.push(...runsOf(t.num, scale, rise));
        add("/", false);
        runs.push(...runsOf(t.den, scale, rise));
        break;
      case "gap":
        add("", false, 1.2, 0);
        break;
      case "sp":
        if (wordish(toks[i - 1]) && wordish(toks[i + 1])) add("", false, 0.28, 0);
        break;
    }
  });
  return runs;
}

/**
 * Draws a plain-text formula centred on (x, y) (textBaseline middle) with maths typography, `size` px,
 * shrunk to `maxWidth`. Uses g.fillStyle. Returns the drawn width.
 */
export function drawFormula(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { maxWidth?: number; bold?: boolean; fonts?: FormulaFonts; stroke?: { width: number; style: string } } = {},
): number {
  const fonts = opts.fonts ?? KATEX_FONTS;
  const runs = runsOf(tokenize(text));
  const fontOf = (r: Run, px: number) => `${r.italic ? "italic " : ""}${opts.bold ? "bold " : ""}${px * r.scale}px ${r.italic ? fonts.math : fonts.main}`;
  const measure = (px: number) => {
    let w = 0;
    for (const r of runs) {
      g.font = fontOf(r, px);
      r.width = g.measureText(r.text).width;
      w += r.width + (r.before + r.after) * px * r.scale;
    }
    return w;
  };
  let px = size;
  let total = measure(px);
  if (opts.maxWidth && total > opts.maxWidth) {
    px = size * (opts.maxWidth / total);
    total = measure(px);
  }
  const align = g.textAlign;
  const base = g.textBaseline;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  let cx = x - total / 2;
  const baseline = y + px * 0.34;
  const starts: number[] = [];
  runs.forEach((r, k) => {
    cx += r.before * px * r.scale;
    starts[k] = cx;
    g.font = fontOf(r, px);
    if (r.text && opts.stroke) {
      g.lineJoin = "round";
      g.lineWidth = opts.stroke.width * r.scale;
      g.strokeStyle = opts.stroke.style;
      g.strokeText(r.text, cx, baseline - r.rise * px);
    }
    if (r.text) g.fillText(r.text, cx, baseline - r.rise * px);
    if (r.over) {
      // Root bar from just after the radical to the end of this run's group (the next runs at the same level).
      let end = cx + (r.width ?? 0);
      for (let j = k + 1; j < runs.length && runs[j]!.rise === r.rise && !runs[j]!.over && runs[j]!.before === 0; j++) end += runs[j]!.width ?? 0;
      g.fillRect(starts[r.over.from] ?? cx, baseline - r.rise * px - px * 0.78, end - (starts[r.over.from] ?? cx), Math.max(1, px * 0.05));
    }
    cx += (r.width ?? 0) + r.after * px * r.scale;
  });
  g.textAlign = align;
  g.textBaseline = base;
  return total;
}

/**
 * For engines: draws `text` as a typeset formula when the context asks for it (Accademico, D24) and the
 * text reads as a formula. False = not drawn, the engine draws it as before.
 */
export function maybeFormula(
  ctx: { typesetFormulas?: boolean },
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: Parameters<typeof drawFormula>[5] = {},
): boolean {
  if (!ctx.typesetFormulas || !looksLikeFormula(text)) return false;
  drawFormula(g, text, x, y, size, opts);
  return true;
}
