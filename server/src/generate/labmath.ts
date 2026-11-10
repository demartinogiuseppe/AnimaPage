// Numbers the `lab` engine computes from a scene's own experiments (forces, energies, speeds,
// periods, currents, water levels and pressures...), so the number-provenance check accepts worked answers such as "40 N"
// when the scene's experiment really produces them. Analogous to conceptMathNumbers.
//
// Uses the engine's pure physics (packages/engine/src/engines/lab/physics.ts: no three.js, Node-safe),
// read-only. Variants: the setup's default values and, for every slider, its min / middle / max
// (the same set the engine lays out with); states sampled over the first seconds of each run.
import type { LabData } from "@pv/scene-spec";
import { boardLines, Experiment, frameOf, varsOf, type Vars } from "../../../packages/engine/src/engines/lab/physics.ts";

const TAUS = [0, 0.25, 0.5, 1, 1.5, 2, 3, 5, 8];

function numbersOf(v: unknown, out: number[], depth = 0): void {
  if (depth > 4) return;
  if (typeof v === "number") {
    if (Number.isFinite(v)) out.push(v);
  } else if (Array.isArray(v)) v.forEach((x) => numbersOf(x, out, depth + 1));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbersOf(x, out, depth + 1));
}

/** Every number the lab experiments of the scene can show (setup values, state values, board text). */
export function labMathNumbers(data: LabData): { values: number[]; texts: string[] } {
  const values: number[] = [];
  const texts: string[] = [];
  for (const entry of data.chapters) {
    const base = varsOf(entry.setup);
    let variants: Vars[] = [base];
    for (const p of entry.params ?? []) {
      const next: Vars[] = [];
      for (const v of variants) for (const x of [p.min, (p.min + p.max) / 2, p.max]) next.push({ ...v, [p.var]: x });
      variants = next.slice(0, 27);
    }
    // The setup values (what plays before the student moves a slider) come first.
    variants = [base, ...variants.filter((v) => JSON.stringify(v) !== JSON.stringify(base))];
    const frame = frameOf(entry.setup.kind, variants);
    for (const v of variants) {
      numbersOf(v, values);
      let ex: Experiment;
      try {
        ex = new Experiment(entry.setup, v, frame);
      } catch {
        continue;
      }
      for (const tau of TAUS) {
        try {
          const st = ex.state(tau);
          numbersOf(st, values);
          texts.push(...boardLines(ex, st, true));
        } catch {
          // a variant the engine cannot simulate: skip it
        }
      }
    }
  }
  return { values, texts };
}
