import { describe, expect, it } from "vitest";
import {
  compileExpr,
  derivative,
  evaluate,
  exprError,
  exprLiterals,
  findExtrema,
  findInflections,
  findZeros,
  formatFixed,
  formatNum,
  formatPoint,
  isAsymptote,
  isSymmetryAxis,
  MAX_EXPR_LENGTH,
  parity,
  parseExpr,
  prettyExpr,
  resolvePoint,
  sampleCurve,
} from "../src/math/index.ts";

const f = (src: string) => compileExpr(src);

describe("expression parser", () => {
  it("follows the usual precedence and associativity", () => {
    expect(evaluate("2 + 3 * 4", 0)).toBe(14);
    expect(evaluate("(2 + 3) * 4", 0)).toBe(20);
    expect(evaluate("2^3^2", 0)).toBe(512);
    expect(evaluate("-x^2", 3)).toBe(-9);
    expect(evaluate("2^-1", 0)).toBe(0.5);
    expect(evaluate("10 - 4 - 3", 0)).toBe(3);
    expect(evaluate("12 / 3 / 2", 0)).toBe(2);
    expect(evaluate("12 : 4", 0)).toBe(3);
    expect(evaluate("--x", 2)).toBe(2);
  });

  it("supports implicit multiplication with the same precedence as *", () => {
    expect(evaluate("2x", 3)).toBe(6);
    expect(evaluate("3(x+1)", 1)).toBe(6);
    expect(evaluate("(x-1)(x-3)", 2)).toBe(-1);
    expect(evaluate("2sin(x)", Math.PI / 2)).toBeCloseTo(2);
    expect(evaluate("x(x+1)", 2)).toBe(6);
    expect(evaluate("2pi", 0)).toBeCloseTo(2 * Math.PI);
    expect(evaluate("1/2x", 4)).toBe(2);
    expect(evaluate("2x^2", 3)).toBe(18);
  });

  it("knows the functions, constants and unicode forms", () => {
    const cases: [string, number, number][] = [
      ["sqrt(x)", 9, 3],
      ["cbrt(x)", -8, -2],
      ["abs(x)", -2, 2],
      ["|x - 5|", 1, 4],
      ["ln(e)", 0, 1],
      ["log(e^2)", 0, 2],
      ["log10(1000)", 0, 3],
      ["exp(0)", 0, 1],
      ["sign(x)", -3, -1],
      ["floor(x)", 2.7, 2],
      ["ceil(x)", 2.1, 3],
      ["min(3, x, 5)", 1, 1],
      ["max(1; x)", 4, 4],
      ["atan(1)*4", 0, Math.PI],
      ["cosh(0) + sinh(0) + tanh(0)", 0, 1],
      ["asin(1) + acos(1)", 0, Math.PI / 2],
      ["x² − 4x + 3", 2, -1],
      ["√x + 1", 4, 3],
      ["2·x × 3 ÷ 6", 5, 5],
      ["π", 0, Math.PI],
      ["x³", 2, 8],
    ];
    for (const [src, x, want] of cases) expect(evaluate(src, x), src).toBeCloseTo(want, 10);
    expect(compileExpr("x*y + a", { vars: ["x", "y", "a"] })(2, 3, 4)).toBe(10);
  });

  it("returns NaN outside the domain", () => {
    for (const [src, x] of [
      ["sqrt(x)", -1],
      ["ln(x)", 0],
      ["ln(x)", -2],
      ["1/x", 0],
      ["1/(1/x)", 0],
      ["x^0.5", -4],
      ["asin(x)", 2],
      ["0^-1", 0],
    ] as const)
      expect(evaluate(src, x), `${src} at ${x}`).toBeNaN();
  });

  it("rejects anything that is not maths", () => {
    for (const bad of [
      "alert(1)",
      "constructor",
      "__proto__",
      "x.constructor",
      "this",
      "x = 1",
      "x; y",
      '"x"',
      "`x`",
      "x => x",
      "[x]",
      "{}",
      "x,5",
      "0,5x",
      "2 3",
      "xy",
      "sin x",
      "sin()",
      "max(1)",
      "sqrt(1, 2)",
      "(x",
      "x)",
      "",
      "   ",
      "y",
      "a*x",
    ])
      expect(exprError(bad), bad).not.toBeNull();
    expect(exprError("0,5x")).toMatch(/dot/);
    expect(exprError("a*x", { vars: ["x", "a"] })).toBeNull();
  });

  it("limits length and nesting depth", () => {
    expect(exprError("x+".repeat(100) + "x")).toMatch(/longer than/);
    expect(exprError("1+x".padEnd(MAX_EXPR_LENGTH, " "))).toBeNull();
    expect(exprError("(".repeat(30) + "x" + ")".repeat(30))).toMatch(/deeper/);
    expect(exprError("-".repeat(40) + "x")).toMatch(/deeper/);
  });

  it("lists literals and pretty-prints in Italian style", () => {
    expect(exprLiterals(parseExpr("x^2 - 4x + 3"))).toEqual([2, 4, 3]);
    const cases: [string, string][] = [
      ["x^2 - 4x + 3", "x² − 4x + 3"],
      ["sqrt(x - 1)", "√(x − 1)"],
      ["sqrt(x)", "√x"],
      ["ln(x)", "ln(x)"],
      ["log(x)", "ln(x)"],
      ["log10(x)", "log₁₀(x)"],
      ["e^x", "eˣ"],
      ["exp(-x)", "e⁻ˣ"],
      ["2^(x+1)", "2^(x + 1)"],
      ["(x - 1)(x - 3)", "(x − 1)(x − 3)"],
      ["1/x", "1/x"],
      ["(x+1)/(x-1)", "(x + 1)/(x − 1)"],
      ["-x^2", "−x²"],
      ["0.5x", "0,5x"],
      ["abs(x)", "|x|"],
      ["x^2 + y^2", "x² + y²"],
      ["x - (x - 1)", "x − (x − 1)"],
    ];
    for (const [src, want] of cases) expect(prettyExpr(src), src).toBe(want);
    const vars = ["x", "a", "b", "c"];
    expect(prettyExpr("a*x^2 + b*x + c", { vars, values: { a: 1, b: -4, c: 3 } })).toBe("x² − 4x + 3");
    expect(prettyExpr("a*x^2 + b*x + c", { vars, values: { a: -1, b: 0, c: 0 } })).toBe("−x²");
    expect(prettyExpr("a*x^2 + b*x + c", { vars, values: { a: 0.5, b: -1, c: -2 } })).toBe("0,5x² − x − 2");
    expect(prettyExpr("a*x^2 + b*x + c", { vars })).toBe("ax² + bx + c");
  });

  it("formats numbers and points the Italian way", () => {
    expect(formatNum(-1)).toBe("−1");
    expect(formatNum(1.5)).toBe("1,5");
    expect(formatNum(1 / 3)).toBe("0,33");
    expect(formatNum(-0.0001)).toBe("0");
    expect(formatNum(2.0000001)).toBe("2");
    expect(formatPoint("V", 2, -1)).toBe("V(2; −1)");
    expect(formatPoint(undefined, 0.5, 0)).toBe("(0,5; 0)");
    expect(formatFixed(-0.001)).toBe("0,00");
    expect(formatFixed(-2.5)).toBe("−2,50");
  });
});

describe("domain edges and holes", () => {
  it("accepts zeros and one-sided extrema at a closed end of the domain", () => {
    const r: [number, number] = [-4, 6];
    const s = f("sqrt(x + 2)");
    expect(findZeros(s, r)[0]).toBeCloseTo(-2, 9);
    expect(findExtrema(s, r).map((e) => [+e.x.toFixed(6), e.kind])).toEqual([[-2, "min"]]);
    expect(resolvePoint(s, "zero", -2, r)).toMatchObject({ ok: true, y: 0 });
    expect(resolvePoint(s, "min", -2, r).ok).toBe(true);
    const half = f("sqrt(4 - x^2)");
    expect(findZeros(half, r).map((x) => +x.toFixed(6))).toEqual([-2, 2]);
    expect(findExtrema(half, r).map((e) => [+e.x.toFixed(6), e.kind])).toEqual([
      [-2, "min"],
      [0, "max"],
      [2, "min"],
    ]);
    // Domain edge exactly on the range end, or the edge of a declared domain.
    expect(resolvePoint(f("sqrt(x)"), "zero", 0, [0, 4]).ok).toBe(true);
    expect(resolvePoint(f("sqrt(x + 2) - 1"), "zero", -2, r).ok).toBe(false);
  });

  it("does not take open edges or holes for points", () => {
    const r: [number, number] = [-4, 6];
    // ln x runs off to −∞ at 0: no zero and no minimum there.
    expect(findZeros(f("ln(x)"), r).map((x) => +x.toFixed(9))).toEqual([1]);
    expect(findExtrema(f("ln(x)"), r)).toEqual([]);
    expect(resolvePoint(f("ln(x)"), "zero", 0, r).ok).toBe(false);
    expect(resolvePoint(f("ln(x)"), "zero", 1, r).ok).toBe(true);
    // (x² − 1)/(x − 1) has a hole at 1, not a point; x²/x has a hole at 0 (limit 0), not a zero.
    expect(resolvePoint(f("(x^2 - 1)/(x - 1)"), "point", 1, r).ok).toBe(false);
    expect(resolvePoint(f("x^2/x"), "zero", 0, r).problem).toMatch(/hole/);
    expect(findZeros(f("1/x"), r)).toEqual([]);
  });
});

describe("numeric calculus", () => {
  it("finds zeros, extrema and inflections", () => {
    const p = f("x^2 - 4x + 3");
    expect(findZeros(p, [-4, 6]).map((x) => +x.toFixed(9))).toEqual([1, 3]);
    const ex = findExtrema(p, [-4, 6]);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.kind).toBe("min");
    expect(ex[0]!.x).toBeCloseTo(2, 6);
    expect(ex[0]!.y).toBeCloseTo(-1, 9);
    expect(findZeros(f("(x - 2)^2"), [-4, 6])[0]).toBeCloseTo(2, 5);
    expect(findZeros(f("1/x"), [-3, 3])).toEqual([]);
    expect(findZeros(f("tan(x)"), [-2, 2]).map((x) => +x.toFixed(9))).toEqual([0]);
    const cubic = f("x^3 - 3x");
    expect(findExtrema(cubic, [-3, 3]).map((e) => [+e.x.toFixed(5), e.kind])).toEqual([
      [-1, "max"],
      [1, "min"],
    ]);
    expect(findInflections(cubic, [-3, 3]).map((x) => +x.toFixed(4))).toEqual([0]);
    expect(findInflections(f("2x + 1"), [-3, 3])).toEqual([]);
    expect(findInflections(f("x^2"), [-3, 3])).toEqual([]);
    expect(findExtrema(f("abs(x)"), [-3, 4])[0]!.x).toBeCloseTo(0, 6);
    expect(derivative(p, 0)).toBeCloseTo(-4, 6);
  });

  it("breaks curves at poles, holes and domain edges", () => {
    const ends = (pieces: [number, number][][]) => pieces.map((pc) => [pc[0]![0], pc[pc.length - 1]![0]]);
    const inv = sampleCurve(f("1/x"), [-5, 5], 200, { yClip: [-4, 4] });
    expect(inv).toHaveLength(2);
    expect(ends(inv)[0]![1]).toBeCloseTo(-0.25, 6);
    expect(ends(inv)[1]![0]).toBeCloseTo(0.25, 6);
    const ln = sampleCurve(f("ln(x)"), [-5, 5], 200, { yClip: [-4, 4] });
    expect(ln).toHaveLength(1);
    expect(ln[0]![0]![0]).toBeCloseTo(Math.exp(-4), 6);
    expect(ln[0]![0]![1]).toBeCloseTo(-4, 6);
    const tan = sampleCurve(f("tan(x)"), [-5, 5], 200, { yClip: [-4, 4] });
    expect(tan).toHaveLength(5);
    for (const pc of tan) for (const [, y] of pc) expect(Math.abs(y)).toBeLessThanOrEqual(4 + 1e-9);
    const sq = sampleCurve(f("sqrt(x)"), [-5, 5], 200);
    expect(sq).toHaveLength(1);
    expect(sq[0]![0]![0]).toBeCloseTo(0, 9);
    expect(sampleCurve(f("floor(x)"), [-2, 2], 200)).toHaveLength(4);
    // Steep but continuous: one piece.
    expect(sampleCurve(f("x^9"), [-2, 2], 100)).toHaveLength(1);
    expect(sampleCurve(f("sqrt(-1 - x^2)"), [-2, 2], 100)).toEqual([]);
  });

  it("checks declared points, asymptotes, symmetry axes and parity", () => {
    const p = f("x^2 - 4x + 3");
    const r: [number, number] = [-4, 6];
    expect(resolvePoint(p, "vertex", 2, r)).toMatchObject({ ok: true, y: -1 });
    expect(resolvePoint(p, "min", 2.004, r).ok).toBe(true);
    expect(resolvePoint(p, "max", 2, r).ok).toBe(false);
    expect(resolvePoint(p, "zero", 2, r).problem).toMatch(/not a zero/);
    expect(resolvePoint(p, "zero", 1.002, r)).toMatchObject({ ok: true, x: 1 });
    expect(resolvePoint(p, "y-intercept", undefined, r)).toMatchObject({ ok: true, x: 0, y: 3 });
    expect(resolvePoint(p, "point", 9, r).ok).toBe(false);
    expect(resolvePoint(f("ln(x)"), "point", -1, r).ok).toBe(false);
    expect(resolvePoint(f("x^3"), "inflection", 0, [-2, 2]).ok).toBe(true);

    expect(isAsymptote(f("1/x"), { x: 0 }, r)).toBe(true);
    expect(isAsymptote(f("ln(x)"), { x: 0 }, r)).toBe(true);
    expect(isAsymptote(f("tan(x)"), { x: 1.5708 }, r)).toBe(true);
    expect(isAsymptote(p, { x: 2 }, r)).toBe(false);
    expect(isAsymptote(f("x^2"), { x: 100 }, [90, 110])).toBe(false);
    expect(isAsymptote(f("1/x"), { y: 0 }, r)).toBe(true);
    expect(isAsymptote(f("exp(-x)"), { y: 0 }, r)).toBe(true);
    expect(isAsymptote(p, { y: 0 }, r)).toBe(false);
    expect(isAsymptote(f("(x^2 + 1)/x"), { m: 1, q: 0 }, r)).toBe(true);
    expect(isAsymptote(f("(x^2 + 1)/x"), { m: 2, q: 0 }, r)).toBe(false);

    expect(isSymmetryAxis(p, 2, r)).toBe(true);
    expect(isSymmetryAxis(p, 1, r)).toBe(false);
    expect(parity(p, r)).toBe("neither");
    expect(parity(f("x^3 - x"), r)).toBe("odd");
    expect(parity(f("cos(x) + x^2"), r)).toBe("even");
  });
});
