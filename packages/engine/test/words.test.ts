import { describe, expect, it } from "vitest";
import { splitWords, wordTimes } from "../src/util/words.ts";

describe("words", () => {
  it("splitWords keeps elisions and drops punctuation", () => {
    const text = "Plof! L'acqua, che bello: 3 pesci.";
    const w = splitWords(text);
    expect(w.map((x) => x.word)).toEqual(["Plof", "L'acqua", "che", "bello", "3", "pesci"]);
    for (const x of w) expect(text.slice(x.start, x.end)).toBe(x.word);
  });

  it("wordTimes grows monotonically and scales with the rate", () => {
    const text = "Una grande balena nuota nel mare blu con la sua mamma";
    const a = wordTimes(text, "it-IT", 0.98);
    expect(a).toHaveLength(splitWords(text).length);
    expect(a[0]).toBe(0);
    for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThan(a[i - 1]!);
    const slow = wordTimes(text, "it-IT", 0.49);
    for (let i = 1; i < a.length; i++) expect(slow[i]!).toBeCloseTo(a[i]! * 2, 6);
    expect(a.at(-1)!).toBeLessThan(11 * 0.34 + 1e-9);
  });

  it("a short sentence is spread over the 1.5 s minimum", () => {
    const t = wordTimes("Ciao mondo", undefined, 0.98);
    expect(t[1]).toBeCloseTo(0.75, 6);
  });
});
