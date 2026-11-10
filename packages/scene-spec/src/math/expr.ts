// Safe expression language for formulas written by an LLM (plots, surfaces, checks).
// A small recursive-descent parser builds an AST that is compiled into plain closures:
// NO eval / new Function, no property access, no strings. Anything that is not maths fails
// with an ExprError.
//
// Syntax (documented for prompts):
// - Variables: x (plots), x and y (surfaces), plus named parameters declared by the scene
//   (a, b, c...), which are just extra variables. Constants: pi (or π), e.
// - Numbers use "." as the decimal separator ("0.5"); "," and ";" separate function arguments
//   (max(1, x) or max(1; x)). "0,5x" is rejected, never misread.
// - Operators: + - * / ^ with the usual precedence; ^ is right-associative and binds tighter
//   than unary minus (-x^2 = -(x^2)); 2^-x is allowed.
// - Implicit multiplication, same precedence as *: "2x", "3(x+1)", "(x-1)(x-3)", "2sin(x)",
//   "x(x+1)", "2pi". So "1/2x" = (1/2)·x. Names are not split: "xy" is an error, write "x*y".
// - Functions (parentheses required): sin cos tan asin acos atan sinh cosh tanh exp
//   ln log (natural, same as ln) log10 sqrt cbrt abs sign floor ceil, min max (2+ arguments).
//   |expr| is abs(expr).
// - Unicode accepted: − (minus), · × (times), ÷, π, ² ³ (powers), √ (square root of what follows).
// - Limits: MAX_EXPR_LENGTH characters, MAX_EXPR_DEPTH nesting levels.
// Evaluation returns NaN outside the domain (sqrt of a negative, ln of a non-positive number,
// division by zero, any infinite intermediate result), so plotted curves break there.

export const MAX_EXPR_LENGTH = 200;
export const MAX_EXPR_DEPTH = 24;

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

const UNARY_FNS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
} as const;
const VARIADIC_FNS = { min: Math.min, max: Math.max } as const;
export type FnName = keyof typeof UNARY_FNS | keyof typeof VARIADIC_FNS;
const isFn = (s: string): s is FnName => Object.hasOwn(UNARY_FNS, s) || Object.hasOwn(VARIADIC_FNS, s);

/** Names that can never be variables or parameters. */
export function isReservedName(s: string): boolean {
  return isFn(s) || s === "pi" || s === "e";
}

export type ExprNode =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "const"; name: "pi" | "e" }
  | { k: "neg"; a: ExprNode }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: ExprNode; b: ExprNode; implicit?: boolean }
  | { k: "call"; fn: FnName; args: ExprNode[] };

// ---------- tokenizer ----------

type Tok = { t: "num"; v: number; at: number } | { t: "id"; s: string; at: number } | { t: "op"; s: string; at: number };

const UNICODE: Record<string, string> = { "−": "-", "–": "-", "·": "*", "×": "*", "⋅": "*", "÷": "/", ":": "/" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]), at: i });
      i += num[0].length;
      if (src[i] === "," && /\d/.test(src[i + 1] ?? "") && !out.some((t) => t.t === "op" && t.s === "("))
        throw new ExprError(`decimal comma at ${i}: write "${num[0]}.${src[i + 1]}" with a dot`);
      continue;
    }
    const id = /^[A-Za-z][A-Za-z0-9]*/.exec(src.slice(i));
    if (id) {
      out.push({ t: "id", s: id[0], at: i });
      i += id[0].length;
      continue;
    }
    if (c === "π") out.push({ t: "id", s: "pi", at: i });
    else if (c === "²" || c === "³") out.push({ t: "op", s: "^", at: i }, { t: "num", v: c === "²" ? 2 : 3, at: i });
    else if ("+-*/^(),;|√".includes(c)) out.push({ t: "op", s: c, at: i });
    else if (UNICODE[c]) out.push({ t: "op", s: UNICODE[c]!, at: i });
    else throw new ExprError(`unexpected character "${c}" at ${i}`);
    i++;
  }
  return out;
}

// ---------- parser ----------

export interface ParseOptions {
  /** Allowed variables and parameters (default ["x"]); compiled functions take them in this order. */
  vars?: readonly string[];
}

/** Parses a formula into an AST. Throws ExprError with a short English message. */
export function parseExpr(src: string, opts: ParseOptions = {}): ExprNode {
  const vars = opts.vars ?? ["x"];
  if (typeof src !== "string" || !src.trim()) throw new ExprError("empty expression");
  if (src.length > MAX_EXPR_LENGTH) throw new ExprError(`expression longer than ${MAX_EXPR_LENGTH} characters`);
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (s: string) => {
    const t = toks[p];
    return t?.t === "op" && t.s === s;
  };
  const where = () => (toks[p] ? `at ${toks[p]!.at}` : "at the end");
  const expectOp = (s: string) => {
    if (!isOp(s)) throw new ExprError(`expected "${s}" ${where()}`);
    p++;
  };
  const enter = () => {
    if (++depth > MAX_EXPR_DEPTH) throw new ExprError(`expression nested deeper than ${MAX_EXPR_DEPTH} levels`);
  };

  function sum(): ExprNode {
    enter();
    let node = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { s: "+" | "-" }).s;
      node = { k: "bin", op, a: node, b: term() };
    }
    depth--;
    return node;
  }
  /** Can the next token start an implicitly multiplied factor? */
  const implicitStart = () => {
    const t = peek();
    return !!t && (t.t === "id" || (t.t === "op" && (t.s === "(" || t.s === "√")));
  };
  function term(): ExprNode {
    let node = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (toks[p++] as { s: "*" | "/" }).s;
        node = { k: "bin", op, a: node, b: unary() };
      } else if (implicitStart()) node = { k: "bin", op: "*", a: node, b: power(), implicit: true };
      else return node;
    }
  }
  function unary(): ExprNode {
    if (isOp("-") || isOp("+")) {
      const neg = isOp("-");
      p++;
      enter();
      const a = unary();
      depth--;
      return neg ? { k: "neg", a } : a;
    }
    return power();
  }
  function power(): ExprNode {
    const base = primary();
    if (!isOp("^")) return base;
    p++;
    enter();
    const exp = unary();
    depth--;
    return { k: "bin", op: "^", a: base, b: exp };
  }
  function primary(): ExprNode {
    const t = peek();
    if (!t) throw new ExprError("unexpected end of expression");
    if (t.t === "num") {
      p++;
      return { k: "num", v: t.v };
    }
    if (t.t === "id") {
      p++;
      if (isFn(t.s)) {
        if (!isOp("(")) throw new ExprError(`function ${t.s} needs parentheses: ${t.s}(...)`);
        p++;
        const args = [sum()];
        while (isOp(",") || isOp(";")) {
          p++;
          args.push(sum());
        }
        expectOp(")");
        const variadic = Object.hasOwn(VARIADIC_FNS, t.s);
        if (variadic && args.length < 2) throw new ExprError(`${t.s} needs at least 2 arguments`);
        if (!variadic && args.length !== 1) throw new ExprError(`${t.s} takes 1 argument`);
        return { k: "call", fn: t.s, args };
      }
      if (t.s === "pi" || t.s === "e") return { k: "const", name: t.s };
      if (vars.includes(t.s)) return { k: "var", name: t.s };
      throw new ExprError(`unknown name "${t.s}" (variables: ${vars.join(", ")}; write products with *, e.g. x*y)`);
    }
    if (t.s === "(") {
      p++;
      const e = sum();
      expectOp(")");
      return e;
    }
    if (t.s === "|") {
      p++;
      const e = sum();
      expectOp("|");
      return { k: "call", fn: "abs", args: [e] };
    }
    if (t.s === "√") {
      p++;
      enter();
      const a = power();
      depth--;
      return { k: "call", fn: "sqrt", args: [a] };
    }
    throw new ExprError(`unexpected "${t.s}" ${where()}`);
  }

  const ast = sum();
  if (p < toks.length) throw new ExprError(`unexpected ${toks[p]!.t === "num" ? "number" : `"${(toks[p] as { s: string }).s}"`} ${where()}`);
  return ast;
}

// ---------- evaluation ----------

type Closure = (env: ArrayLike<number>) => number;
const fin = (v: number) => (Number.isFinite(v) ? v : NaN);

function compileNode(n: ExprNode, slot: Map<string, number>): Closure {
  const sub = (c: ExprNode) => compileNode(c, slot);
  switch (n.k) {
    case "num": {
      const v = n.v;
      return () => v;
    }
    case "const": {
      const v = n.name === "pi" ? Math.PI : Math.E;
      return () => v;
    }
    case "var": {
      const i = slot.get(n.name);
      if (i === undefined) throw new ExprError(`unknown name "${n.name}"`);
      return (env) => env[i] ?? NaN;
    }
    case "neg": {
      const a = sub(n.a);
      return (env) => -a(env);
    }
    case "bin": {
      const a = sub(n.a);
      const b = sub(n.b);
      switch (n.op) {
        case "+":
          return (env) => fin(a(env) + b(env));
        case "-":
          return (env) => fin(a(env) - b(env));
        case "*":
          return (env) => fin(a(env) * b(env));
        case "/":
          return (env) => {
            const d = b(env);
            return d === 0 ? NaN : fin(a(env) / d);
          };
        case "^":
          return (env) => fin(a(env) ** b(env));
      }
    }
    // falls through: unreachable, every op returns
    case "call": {
      const args = n.args.map(sub);
      if (n.fn === "min" || n.fn === "max") {
        const f = VARIADIC_FNS[n.fn];
        return (env) => fin(f(...args.map((g) => g(env))));
      }
      const f = UNARY_FNS[n.fn];
      const a = args[0]!;
      return (env) => fin(f(a(env)));
    }
  }
}

/** Compiled formula: takes its variables positionally, in ParseOptions.vars order. NaN outside the domain. */
export type CompiledExpr = (...args: number[]) => number;

/** Compiles a formula (or AST) into a function. Throws ExprError. */
export function compileExpr(src: string | ExprNode, opts: ParseOptions = {}): CompiledExpr {
  const vars = opts.vars ?? ["x"];
  const c = compileNode(typeof src === "string" ? parseExpr(src, { vars }) : src, new Map(vars.map((v, i) => [v, i])));
  return (...args) => {
    const v = c(args);
    return Number.isFinite(v) ? v : NaN;
  };
}

/** One-shot evaluation with x and y (parses every call: compile once for loops). */
export function evaluate(src: string, x: number, y = 0): number {
  return compileExpr(src, { vars: ["x", "y"] })(x, y);
}

/** Error message, or null when the formula is valid. */
export function exprError(src: string, opts: ParseOptions = {}): string | null {
  try {
    parseExpr(src, opts);
    return null;
  } catch (e) {
    if (e instanceof ExprError) return e.message;
    throw e;
  }
}

/** Does the formula use variable `v`? */
export function usesVar(n: ExprNode, v: string): boolean {
  switch (n.k) {
    case "var":
      return n.name === v;
    case "neg":
      return usesVar(n.a, v);
    case "bin":
      return usesVar(n.a, v) || usesVar(n.b, v);
    case "call":
      return n.args.some((a) => usesVar(a, v));
    default:
      return false;
  }
}

/** Numeric literals as written (coefficients, exponents), in reading order. */
export function exprLiterals(n: ExprNode): number[] {
  switch (n.k) {
    case "num":
      return [n.v];
    case "neg":
      return exprLiterals(n.a);
    case "bin":
      return [...exprLiterals(n.a), ...exprLiterals(n.b)];
    case "call":
      return n.args.flatMap(exprLiterals);
    default:
      return [];
  }
}
