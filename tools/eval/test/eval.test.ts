import { describe, expect, it } from "vitest";
import { factCoverage } from "../src/facts.ts";
import { parseYamlLite } from "../src/yaml-lite.ts";

describe("yaml-lite", () => {
  it("reads the expected.yaml subset", () => {
    const y = parseYamlLite(`# comment
status: draft — to confirm
topic: L'elettricista pasticcione (racconto)   # trailing comment
acceptable_engines: [card]
pages: { visible: 2, numbers: [38, 39] }
literary: { isLiterary: true, author: Stefano Benni, work: Bar Sport }
key_facts:   # list
  - "Abitanti 5590076, superficie 13668 km²"
  - Il Vesuvio è un vulcano
`);
    expect(y).toEqual({
      status: "draft — to confirm",
      topic: "L'elettricista pasticcione (racconto)",
      acceptable_engines: ["card"],
      pages: { visible: 2, numbers: [38, 39] },
      literary: { isLiterary: true, author: "Stefano Benni", work: "Bar Sport" },
      key_facts: ["Abitanti 5590076, superficie 13668 km²", "Il Vesuvio è un vulcano"],
    });
  });
});

describe("factCoverage", () => {
  it("matches stems and normalised numbers", () => {
    const c = factCoverage("410 d.C.: i Visigoti di Alarico saccheggiano Roma", "Nel 410 d.C. i Visigoti, guidati da Alarico, saccheggiarono Roma.");
    expect(c.ratio).toBe(1);
    const m = factCoverage("Abitanti 5590076", "La Campania ha 5.561.912 abitanti.");
    expect(m.missingNumbers).toEqual(["5590076"]);
  });
});
