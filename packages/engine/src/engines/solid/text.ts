// Text for the solid engine in the lesson's language (Italian by default, D21): number format,
// dimension labels, formula board, F/V/S panel.
import type { SolidFormula, SolidShape } from "@pv/scene-spec";
import { decimalMark, engineText } from "@pv/scene-spec/i18n";
import type { Dims, Measures } from "./geometry.ts";

/** Number with up to `dec` decimals, trailing zeros dropped, the lesson's decimal mark ("62,83", "8"). */
export function num(x: number, dec = 2): string {
  const r = Number(x.toFixed(dec));
  const s = Math.abs(r) < 1e-12 ? "0" : String(r);
  return s.replace(".", decimalMark());
}

/** "=" when the rounded value is exact, otherwise "≈". */
const eq = (x: number, dec = 2) => (Math.abs(x - Number(x.toFixed(dec))) < 1e-9 ? "=" : "≈");
const val = (x: number, unit: string, dec = 2) => `${eq(x, dec)} ${num(x, dec)} ${unit}`;

/** Symbol shown for a dimension (frustum: R bottom, r top). */
export function dimSymbol(shape: SolidShape, dim: string): string {
  if (shape === "frustum") return dim === "r" ? "R" : dim === "r2" ? "r" : dim;
  if (dim === "ap") return "a";
  return dim;
}

/** Real value of a dimension line (k already applied to `d`). */
export function dimValue(dim: string, d: Dims, m: Measures): number {
  if (dim === "ap") return m.ap;
  return d[dim as keyof Dims] ?? 0;
}

export const dimLabel = (shape: SolidShape, dim: string, d: Dims, m: Measures, unit: string) =>
  `${dimSymbol(shape, dim)} = ${num(dimValue(dim, d, m))} ${unit}`;

/** One board line per formula: symbolic form, substituted values, result. `d` and `m` are real (k applied). */
export function formulaLine(shape: SolidShape, f: SolidFormula, d: Dims, m: Measures, unit: string, sides: number): string | null {
  const u2 = `${unit}²`;
  const u3 = `${unit}³`;
  const n = num;
  switch (shape) {
    case "cube":
      if (f === "V") return `V = a³ = ${n(d.a)}³ ${val(m.V, u3)}`;
      if (f === "A") return `A = 6 · a² = 6 · ${n(d.a)}² ${val(m.A, u2)}`;
      if (f === "Al") return `Al = 4 · a² ${val(m.Al, u2)}`;
      return `Ab = a² ${val(m.Ab, u2)}`;
    case "cuboid":
      if (f === "V") return `V = a · b · c = ${n(d.a)} · ${n(d.b)} · ${n(d.c)} ${val(m.V, u3)}`;
      if (f === "A") return `A = 2 · (a·b + b·c + a·c) ${val(m.A, u2)}`;
      if (f === "Al") return `Al = 2 · (a + b) · c ${val(m.Al, u2)}`;
      return `Ab = a · b ${val(m.Ab, u2)}`;
    case "prism":
      if (f === "V") return `V = Ab · h = ${n(m.Ab)} · ${n(d.h)} ${val(m.V, u3)}`;
      if (f === "A") return `A = 2 · Ab + Al ${val(m.A, u2)}`;
      if (f === "Al") return `Al = ${sides} · l · h ${val(m.Al, u2)}`;
      return `Ab ${val(m.Ab, u2)}`;
    case "pyramid":
      if (f === "V") return `V = Ab · h : 3 = ${n(m.Ab)} · ${n(d.h)} : 3 ${val(m.V, u3)}`;
      if (f === "A") return `A = Ab + Al ${val(m.A, u2)}`;
      if (f === "Al") return `Al = p · a : 2 ${val(m.Al, u2)}`;
      return `Ab ${val(m.Ab, u2)}`;
    case "cylinder":
      if (f === "V") return `V = π · r² · h = π · ${n(d.r)}² · ${n(d.h)} ${val(m.V, u3)}`;
      if (f === "A") return `A = 2·π·r² + 2·π·r·h ${val(m.A, u2)}`;
      if (f === "Al") return `Al = 2 · π · r · h ${val(m.Al, u2)}`;
      return `Ab = π · r² ${val(m.Ab, u2)}`;
    case "cone":
      if (f === "V") return `V = π · r² · h : 3 = π · ${n(d.r)}² · ${n(d.h)} : 3 ${val(m.V, u3)}`;
      if (f === "A") return `A = π · r · (r + a) ${val(m.A, u2)}`;
      if (f === "Al") return `Al = π · r · a ${val(m.Al, u2)}`;
      return `Ab = π · r² ${val(m.Ab, u2)}`;
    case "frustum":
      if (f === "V") return `V = π · h · (R² + R·r + r²) : 3 ${val(m.V, u3)}`;
      if (f === "A") return `A = Al + π · (R² + r²) ${val(m.A, u2)}`;
      if (f === "Al") return `Al = π · (R + r) · a ${val(m.Al, u2)}`;
      return `Ab = π · R² ${val(m.Ab, u2)}`;
    case "sphere":
      if (f === "V") return `V = 4 : 3 · π · r³ ${val(m.V, u3)}`;
      if (f === "A") return `A = 4 · π · r² ${val(m.A, u2)}`;
      return null;
    default:
      // Platonic solids: values computed from the model, no formula shown.
      if (f === "V") return `V ${val(m.V, u3)}`;
      if (f === "A") return `A ${val(m.A, u2)}`;
      return null;
  }
}

export interface BoardInput {
  title: string;
  shape: SolidShape;
  sides: number;
  formulas: readonly SolidFormula[];
  d: Dims;
  m: Measures;
  k: number;
  unit: string;
  /** Measures of the solid compared with ("compare"), real. */
  ref?: { name: string; m: Measures; k: number };
}

export function boardLines(b: BoardInput): string[] {
  const lines = [b.k !== 1 || (b.ref && b.ref.k !== b.k) ? `${b.title} · k = ${num(b.k)}` : b.title];
  for (const f of b.formulas) {
    const l = formulaLine(b.shape, f, b.d, b.m, b.unit, b.sides);
    if (l) lines.push(l);
  }
  if (b.ref) {
    // Ratios only for the measures on the board.
    const parts: string[] = [];
    if (b.formulas.includes("A")) parts.push(`area × ${num(b.m.A / b.ref.m.A)}`);
    if (b.formulas.includes("V")) parts.push(`volume × ${num(b.m.V / b.ref.m.V)}`);
    if (parts.length) lines.push(engineText("solid.compare", { name: b.ref.name, parts: parts.join(", ") }));
  }
  return lines;
}

/** F/V/S panel; `known` are counts revealed so far (null = not counted yet). */
export function elementLines(known: { faces: number | null; vertices: number | null; edges: number | null }): string[] {
  const q = (x: number | null) => (x === null ? "?" : String(x));
  const lines = [`Facce F = ${q(known.faces)}`, `Vertici V = ${q(known.vertices)}`, `Spigoli S = ${q(known.edges)}`];
  if (known.faces !== null && known.vertices !== null && known.edges !== null)
    lines.push(`F + V − S = ${known.faces} + ${known.vertices} − ${known.edges} = ${known.faces + known.vertices - known.edges}`);
  else lines.push("F + V − S = ?");
  return lines;
}

export const COUNT_WORD = { faces: "Facce", edges: "Spigoli", vertices: "Vertici" } as const;
