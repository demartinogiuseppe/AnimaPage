// Formula display for the Accademico presentation: plain text -> LaTeX, KaTeX rendering with fallback,
// canvas typesetting.
import katex from "katex";
import { describe, expect, it } from "vitest";
import { drawFormula, looksLikeFormula, texFromPlain, texText, tokenize } from "../src/util/math-text.ts";
import { renderFormula } from "../src/player/katex.ts";

describe("texFromPlain", () => {
  it("maps the lessons' plain maths to LaTeX", () => {
    expect(texFromPlain("V = π · r² · h")).toBe("V=\\pi \\cdot r^{2}\\cdot h");
    expect(texFromPlain("f(x) = ax² + bx + c")).toBe("f(x)=ax^{2}+bx+c");
    expect(texFromPlain("sen Ĉ = AB/BC")).toBe("\\operatorname{sen}\\hat{C}=\\frac{AB}{BC}");
    expect(texFromPlain("p = dF/dS   [Pa] = [N/m²]")).toBe("p=\\frac{dF}{dS}\\qquad [Pa]=[\\frac{N}{m^{2}}]");
    expect(texFromPlain("T = 2π · √(L / g)")).toBe("T=2\\pi \\cdot \\sqrt{L/g}");
    expect(texFromPlain("b_r = b cos α")).toBe("b_{r}=b\\ \\cos \\alpha");
    expect(texFromPlain("V cono = V cilindro : 3")).toBe("V\\ \\text{cono}=V\\ \\text{cilindro}:3");
    expect(texFromPlain("Lombardia: 10 020 528 abitanti")).toBe("\\text{Lombardia}:10\\,020\\,528\\ \\text{abitanti}");
    expect(texFromPlain("h = ½ · g · t²")).toBe("h=\\tfrac{1}{2}\\cdot g\\cdot t^{2}");
    expect(texFromPlain("V = (−b/2a; f(−b/2a))")).toBe("V=(-\\frac{b}{2a};f(-\\frac{b}{2a}))");
    expect(texFromPlain("x ≥ 0, D = ℝ")).toBe("x\\ge 0,D=\\mathbb{R}");
  });

  it("escapes every LaTeX special character the lesson writes", () => {
    const tex = texFromPlain("50 % & #1 {a} ~ $ \\ x^y_z");
    expect(tex).toContain("\\%");
    expect(tex).toContain("\\&");
    expect(tex).toContain("\\#");
    expect(tex).toContain("\\{");
    expect(tex).toContain("\\$");
    expect(tex).toContain("\\backslash");
    expect(tex).toContain("x^{y}_{z}");
    // A command smuggled in plain text stays text: the backslash is escaped.
    expect(texFromPlain("1 \\href{javascript:alert(1)}{x}")).not.toMatch(/\\href/);
    expect(texText("a_b{c}%\\")).toBe("a\\_b\\{c\\}\\%\\textbackslash{}");
  });

  it("passes LaTeX the lesson already wrote", () => {
    expect(texFromPlain("$\\frac{1}{2} mv^2$")).toBe("\\frac{1}{2} mv^2");
  });

  it("tells formulas from phrases", () => {
    expect(looksLikeFormula("V = π · r² · h")).toBe(true);
    expect(looksLikeFormula("sen 30° = 1/2")).toBe(true);
    expect(looksLikeFormula("Fondazione di Roma")).toBe(false);
    expect(looksLikeFormula("light → pupil → lens → retina → brain")).toBe(false);
    expect(looksLikeFormula("Il prezzo della farina è uguale = a quello di ieri mattina")).toBe(false);
  });
});

describe("renderFormula (KaTeX)", () => {
  it("typesets plain formulas", () => {
    const html = renderFormula(katex, "V = π · r² · h")!;
    expect(html).toContain('class="katex"');
    expect(html).toContain("π");
    expect(html).toContain("<math"); // MathML for screen readers
  });

  it("falls back (null) on LaTeX it cannot typeset, and never trusts commands", () => {
    expect(renderFormula(katex, "$\\frac{1}{$")).toBeNull();
    expect(renderFormula(katex, "")).toBeNull();
    // Links and HTML hooks in LaTeX input are refused, so the caller keeps the plain text.
    expect(renderFormula(katex, "$\\frac{1}{2} \\href{javascript:alert(1)}{x}$")).toBeNull();
    expect(renderFormula(katex, "$\\htmlClass{x}{y} + \\frac{1}{2}$")).toBeNull();
    // Markup in the text is escaped, never injected.
    const html = renderFormula(katex, "x = <img src=x onerror=alert(1)>")!;
    expect(html).not.toContain("<img");
  });

  it("survives any input without throwing", () => {
    for (const s of ["", "√", "^", "_", "x^", "((((", "]]]", "½/¾", "a//b", "日本語 = 3", "Ĉ̂̂", "1,,,2", "√(", "x_{", "%%%"]) {
      expect(() => renderFormula(katex, s)).not.toThrow();
      expect(() => tokenize(s)).not.toThrow();
    }
  });
});

describe("drawFormula (canvas)", () => {
  it("draws italic variables, upright numbers and raised exponents, shrunk to fit", () => {
    const calls: { text: string; font: string; y: number }[] = [];
    let font = "";
    const g = {
      set font(f: string) {
        font = f;
      },
      get font() {
        return font;
      },
      textAlign: "center",
      textBaseline: "middle",
      measureText: (t: string) => ({ width: t.length * (Number(/(\d+(\.\d+)?)px/.exec(font)?.[1]) || 10) * 0.5 }),
      fillText: (text: string, _x: number, y: number) => calls.push({ text, font, y }),
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D;
    const w = drawFormula(g, "V = π · r² · h", 100, 50, 40, { maxWidth: 120 });
    expect(w).toBeLessThanOrEqual(120.001);
    const r = calls.find((c) => c.text === "r")!;
    const two = calls.find((c) => c.text === "2")!;
    expect(r.font).toMatch(/^italic .*KaTeX_Math/);
    expect(two.font).not.toMatch(/italic/);
    expect(two.y).toBeLessThan(r.y); // raised
    expect(g.textAlign).toBe("center"); // restored
  });
});
