// Computed numbers the newer engines (and the page's own formulas) imply, so the number-provenance
// check accepts worked answers with source "calc" instead of asking for a repair:
// - solidMathNumbers: volumes, areas, apothems, heights, F/V/S counts, scale factors of the scene's
//   own solids, at their dimensions and at every slider's min / middle / max (pure closed forms and
//   mesh measures from packages/engine/src/engines/solid/geometry.ts, read-only), also with π ≈ 3,14;
// - skyMathNumbers: the angles a sky scene's sliders and views imply (Moon phase angles, axial tilt);
// - workshopMathNumbers: teeth of the workshop's gears and their ratios, numbers written in its formulas;
// - pageFormulaNumbers: formulas printed on the page ("V = π · r² · h", "F : P = h : l") evaluated
//   with the numbers printed on the page, with the safe parser of @pv/scene-spec (no eval).
import { compileExpr, exprLiterals, isReservedName, parseExpr, solidCounts, workshopVars, type ExprNode, type PageAnalysis, type SkyData, type SolidData, type WorkshopData } from "@pv/scene-spec";
import { dimsOf, measures, type Dims } from "../../../packages/engine/src/engines/solid/geometry.ts";
import { numbersIn } from "./text.ts";

const PI_APPROX = 3.14 / Math.PI;

export function solidMathNumbers(data: SolidData): number[] {
  const out: number[] = [];
  for (const ch of data.chapters) {
    for (const item of ch.solids) {
      const k = item.scale ?? 1;
      const variants: Partial<Dims>[] = [{}];
      for (const p of ch.params ?? []) {
        if (!p.solids.includes(item.id) || p.dim === "k") continue;
        for (const x of [p.min, (p.min + p.max) / 2, p.max]) variants.push({ [p.dim]: x });
      }
      const ks = [k, ...(ch.params ?? []).filter((p) => p.dim === "k" && p.solids.includes(item.id)).flatMap((p) => [p.min, (p.min + p.max) / 2, p.max])];
      for (const over of variants)
        for (const kk of ks) {
          const base = dimsOf(item, over);
          const d = Object.fromEntries(Object.entries(base).map(([n, v]) => [n, v * kk])) as Dims;
          out.push(kk, kk * kk, kk * kk * kk, ...Object.values(d).filter((v) => v > 0));
          try {
            const m = measures(item.shape, d, item.sides ?? 4);
            const curved = ["cylinder", "cone", "sphere", "frustum"].includes(item.shape);
            for (const v of [m.V, m.A, m.Al, m.Ab, m.ap, m.height]) {
              out.push(v);
              if (curved) out.push(v * PI_APPROX, v / Math.PI);
            }
            // r² and similar squares appear in worked steps ("3,14 · 4 · 5").
            for (const v of Object.values(d)) if (v > 0) out.push(v * v, v * v * v);
          } catch {
            // a shape the geometry cannot build with these dims: skip
          }
        }
      const c = solidCounts(item.shape, item.sides ?? 4);
      out.push(c.faces, c.edges, c.vertices);
    }
  }
  return out;
}

/** Standard angles of the sky views: Moon phases, axial tilt, solstice/equinox declinations. */
export function skyMathNumbers(data: SkyData): number[] {
  const out = [0, 90, 180, 270, 360, 23.44, 23.5, 66.5];
  const grab = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(grab);
    else if (v && typeof v === "object") Object.values(v).forEach(grab);
  };
  // Slider ranges live in the chapters.
  grab(data.chapters.map((c) => (c as { params?: unknown }).params));
  return out;
}

/** Gear teeth and their ratios (24 driving 10 -> 2.4), and the literals of the scene's formulas. */
export function workshopMathNumbers(data: WorkshopData): number[] {
  const teeth = data.parts.flatMap((p) => (p.shape === "wheel" && p.teeth ? [p.teeth] : []));
  const out = [...teeth];
  for (const a of teeth) for (const b of teeth) if (a !== b) out.push(a / b);
  const vars = workshopVars(data.params);
  for (const ch of data.chapters)
    for (const tr of ch.tracks) {
      if (!tr.expr) continue;
      try {
        out.push(...exprLiterals(parseExpr(tr.expr, { vars })));
      } catch {
        // invalid formulas are reported by the schema
      }
    }
  return out;
}

// ---------------------------------------------------------------- formulas printed on the page

/** Unicode and Italian notation -> the parser's syntax: "π · r² · h" -> "pi * r^2 * h", "3,14" -> "3.14". */
function toExpr(s: string): string {
  return s
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[·×]/g, "*")
    .replace(/:/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function varsOf(n: ExprNode, out = new Set<string>()): Set<string> {
  if (n.k === "var") out.add(n.name);
  else if (n.k === "neg") varsOf(n.a, out);
  else if (n.k === "bin") (varsOf(n.a, out), varsOf(n.b, out));
  else if (n.k === "call") n.args.forEach((a) => varsOf(a, out));
  return out;
}

/** "lhs = rhs" formulas found in a text; proportions "a : b = c : d" give each term. */
export function pageFormulas(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(/[≈]/g, "=");
  for (const m of t.matchAll(/([A-Za-z]\w*)\s*:\s*([A-Za-z]\w*)\s*=\s*([A-Za-z]\w*)\s*:\s*([A-Za-z]\w*)/g)) {
    const [, a, b, c, d] = m as unknown as [string, string, string, string, string];
    out.push(`${b}*${c}/${d}`, `${a}*${d}/${c}`, `${a}*${d}/${b}`, `${b}*${c}/${a}`);
  }
  for (const m of t.matchAll(/\b[A-Za-z]\w?\s*=\s*([^=;.\n]*[A-Za-zπ][^=;\n]*?)(?=[;\n]|\.\s|$|\s[a-z]{3,}\s)/g)) {
    const rhs = toExpr(m[1]!);
    if (/[A-Za-zπ]/.test(rhs)) out.push(rhs);
  }
  return [...new Set(out)];
}

/** Results of the page's formulas applied to the page's numbers (every assignment, ≤ 3 variables). */
export function pageFormulaNumbers(a: PageAnalysis): number[] {
  const texts = [...a.claims.map((c) => c.text), ...a.exercises, ...a.entities.map((e) => `${e.name} = ${e.value ?? ""}`), ...a.illustrations.flatMap((i) => i.labels)];
  const formulas = pageFormulas(texts.join("\n"));
  if (formulas.length === 0) return [];
  const nums = [...new Set(numbersIn(texts.join(" ")).map(Number).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 12);
  const out: number[] = [];
  for (const f of formulas.slice(0, 12)) {
    let ast: ExprNode;
    let vars: string[];
    try {
      const probe = parseExpr(f, { vars: [...new Set(f.match(/[A-Za-z]\w*/g) ?? [])].filter((v) => !isReservedName(v)) });
      vars = [...varsOf(probe)];
      if (vars.length === 0 || vars.length > 3) continue;
      ast = parseExpr(f, { vars });
    } catch {
      continue;
    }
    const fn = compileExpr(ast, { vars });
    const assign = (i: number, vals: number[]) => {
      if (i === vars.length) {
        const v = fn(...vals);
        if (Number.isFinite(v)) out.push(v, v * PI_APPROX);
        return;
      }
      for (const n of nums) assign(i + 1, [...vals, n]);
    };
    assign(0, []);
  }
  // Squares of page numbers appear as intermediate steps (r² = 4).
  for (const n of nums) out.push(n * n);
  return out;
}
