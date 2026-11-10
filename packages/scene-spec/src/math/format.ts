// Display of numbers, points and formulas for labels and readouts, in the lesson's locale (Italian by
// default, D21): decimal comma, true minus sign "−", "V(2; −1)", "x² − 4x + 3", "√(x − 1)", "ln(x)".
import { decimalMark } from "../i18n/locale.ts";
import { parseExpr, type ExprNode, type ParseOptions } from "./expr.ts";

const MINUS = "−";

/** Rounds to `maxDecimals`, drops trailing zeros: 2 -> "2", -1.5 -> "−1,5", 1/3 -> "0,33". */
export function formatNum(v: number, maxDecimals = 2): string {
  if (!Number.isFinite(v)) return "?";
  const f = 10 ** maxDecimals;
  const r = Math.round(Math.abs(v) * f) / f;
  if (r === 0) return "0";
  const s = (maxDecimals > 0 ? r.toFixed(maxDecimals).replace(/\.?0+$/, "") : r.toFixed(0)).replace(".", decimalMark());
  return v < 0 ? MINUS + s : s;
}

/** Same as formatNum but always with `decimals` digits (stable width for live readouts). */
export function formatFixed(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return "?";
  const s = Math.abs(v).toFixed(decimals);
  const zero = Number(s) === 0;
  return (v < 0 && !zero ? MINUS : "") + s.replace(".", decimalMark());
}

/** "V(2; −1)"; without a name "(2; −1)". With a decimal point (English...) the separator is ", ". */
export function formatPoint(name: string | undefined, x: number, y: number, maxDecimals = 2): string {
  const sep = decimalMark() === "," ? "; " : ", ";
  return `${name ?? ""}(${formatNum(x, maxDecimals)}${sep}${formatNum(y, maxDecimals)})`;
}

// ---------- formulas ----------

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻", x: "ˣ", y: "ʸ",
};

// Precedence of the printed node: 1 sum, 2 product, 3 unary minus, 4 power, 5 atom.
const prec = (n: ExprNode): number => {
  switch (n.k) {
    case "num":
      return n.v < 0 ? 3 : 5;
    case "var":
    case "const":
    case "call":
      return 5;
    case "neg":
      return 3;
    case "bin":
      return n.op === "+" || n.op === "-" ? 1 : n.op === "^" ? 4 : 2;
  }
};

const isNumLike = (n: ExprNode): boolean => n.k === "num" || (n.k === "neg" && n.a.k === "num");

/** Exponent as superscript when simple (integers, x, y, −x), else null. */
function superscript(n: ExprNode): string | null {
  if (n.k === "num" && Number.isInteger(n.v) && n.v < 1000) return [...String(n.v)].map((c) => SUP[c]!).join("");
  if (n.k === "var") return SUP[n.name]!;
  if (n.k === "neg") {
    const s = superscript(n.a);
    return s && n.a.k !== "neg" ? SUP["-"] + s : null;
  }
  return null;
}

function show(n: ExprNode, digits: number): string {
  const wrap = (c: ExprNode, min: number) => (prec(c) < min ? `(${show(c, digits)})` : show(c, digits));
  switch (n.k) {
    case "num":
      return formatNum(n.v, digits);
    case "var":
      return n.name;
    case "const":
      return n.name === "pi" ? "π" : "e";
    case "neg":
      return MINUS + wrap(n.a, 3);
    case "bin": {
      const { a, b } = n;
      switch (n.op) {
        case "+":
          if (b.k === "neg") return `${show(a, digits)} ${MINUS} ${wrap(b.a, 2)}`;
          if (b.k === "num" && b.v < 0) return `${show(a, digits)} ${MINUS} ${formatNum(-b.v, digits)}`;
          return `${show(a, digits)} + ${wrap(b, 2)}`;
        case "-":
          return `${show(a, digits)} ${MINUS} ${wrap(b, 2)}`;
        case "*": {
          const left = wrap(a, 2);
          const right = wrap(b, 3);
          const juxt =
            (isNumLike(a) && /^[A-Za-zπ√∛(|]/.test(right)) ||
            (left.endsWith(")") && right.startsWith("(")) ||
            ((a.k === "var" || a.k === "const") && /^[A-Za-zπ√∛(|]/.test(right));
          return juxt ? left + right : `${left}·${right}`;
        }
        case "/":
          return `${wrap(a, 2)}/${wrap(b, 3)}`;
        case "^": {
          const base = wrap(a, 5);
          const sup = superscript(b);
          if (sup) return base + sup;
          return `${base}^${prec(b) >= 5 ? show(b, digits) : `(${show(b, digits)})`}`;
        }
      }
    }
    // falls through: unreachable
    case "call": {
      const [x] = n.args;
      const arg = () => `(${n.args.map((c) => show(c, digits)).join("; ")})`;
      switch (n.fn) {
        case "sqrt":
          return prec(x!) >= 5 && x!.k !== "call" ? `√${show(x!, digits)}` : `√${arg()}`;
        case "cbrt":
          return prec(x!) >= 5 && x!.k !== "call" ? `∛${show(x!, digits)}` : `∛${arg()}`;
        case "abs":
          return `|${show(x!, digits)}|`;
        case "exp": {
          const sup = superscript(x!);
          return sup ? `e${sup}` : `e^${arg()}`;
        }
        case "log":
        case "ln":
          return `ln${arg()}`;
        case "log10":
          return `log₁₀${arg()}`;
        default:
          return n.fn + arg();
      }
    }
  }
}

/** Replaces parameters by their values and tidies the result for display (1·x -> x, + 0 dropped...). */
export function substitute(n: ExprNode, values: Readonly<Record<string, number>>): ExprNode {
  switch (n.k) {
    case "var":
      return Object.hasOwn(values, n.name) ? num(values[n.name]!) : n;
    case "neg": {
      const a = substitute(n.a, values);
      return a.k === "num" ? num(-a.v) : a.k === "neg" ? a.a : { k: "neg", a };
    }
    case "call":
      return { ...n, args: n.args.map((c) => substitute(c, values)) };
    case "bin": {
      const a = substitute(n.a, values);
      const b = substitute(n.b, values);
      const isNum = (c: ExprNode, v: number) => c.k === "num" && c.v === v;
      if (a.k === "num" && b.k === "num" && n.op !== "^") {
        const v = n.op === "+" ? a.v + b.v : n.op === "-" ? a.v - b.v : n.op === "*" ? a.v * b.v : a.v / b.v;
        if (Number.isFinite(v)) return num(v);
      }
      switch (n.op) {
        case "+":
          if (isNum(a, 0)) return b;
          if (isNum(b, 0)) return a;
          break;
        case "-":
          if (isNum(b, 0)) return a;
          if (isNum(a, 0)) return substitute({ k: "neg", a: b }, {});
          break;
        case "*":
          if (isNum(a, 0) || isNum(b, 0)) return num(0);
          if (isNum(a, 1)) return b;
          if (isNum(b, 1)) return a;
          if (isNum(a, -1)) return { k: "neg", a: b };
          if (a.k === "num" && a.v < 0) return { k: "neg", a: { ...n, a: num(-a.v), b } };
          break;
        case "/":
          if (isNum(b, 1)) return a;
          break;
        case "^":
          if (isNum(b, 1)) return a;
          if (isNum(b, 0)) return num(1);
          break;
      }
      return { ...n, a, b };
    }
    default:
      return n;
  }
}
const num = (v: number): ExprNode => ({ k: "num", v: Object.is(v, -0) ? 0 : v });

export interface PrettyOptions extends ParseOptions {
  /** Max decimals of numbers (default 6: coefficients as written). */
  digits?: number;
  /** Parameter values to substitute (live labels: "a·x²" with a = −1 -> "−x²"). */
  values?: Readonly<Record<string, number>>;
}

/** Display form of a formula: "x^2 - 4x + 3" -> "x² − 4x + 3". Throws ExprError on invalid input. */
export function prettyExpr(src: string | ExprNode, opts: PrettyOptions = {}): string {
  let ast = typeof src === "string" ? parseExpr(src, { vars: opts.vars ?? ["x", "y"] }) : src;
  if (opts.values) ast = substitute(ast, opts.values);
  return show(ast, opts.digits ?? 6);
}
