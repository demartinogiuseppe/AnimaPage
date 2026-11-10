// Prompt examples (server/src/generate/example.ts) when a reference scene is missing: the public copy
// leaves out the reference scenes reconstructed from book pages (tools/publish/exclude.txt) and uses
// the original example lessons (EXAMPLE_FALLBACKS) instead. With the originals present the prompt
// must not change by a byte, or the recorded generations in fixtures/llm/ would stop matching.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANALYSIS_ENGINES, SceneSpec } from "@pv/scene-spec";
import { EXAMPLE_FALLBACKS, EXAMPLE_SOURCES, MATH_EXAMPLE, REFERENCE_SCENES_DIR, engineExample } from "../src/generate/example.ts";
import { loadExcludes } from "../../tools/publish/make-clean-copy.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const present = (scene: string, dir = REFERENCE_SCENES_DIR) => existsSync(join(dir, `${scene}.scene.json`));

// engineExample() output before the fallback existed (2026-11-10), from the private reference scenes.
const BEFORE: Record<string, string> = {
  map: "c5ac667b152c9470",
  battle: "c32d2fe0125815c8",
  timeline: "66721d6f73946dd8",
  diorama: "a6b44137cdca6f0c",
  process: "e94c35826516068a",
  concept: "3bf2da240c9ac696",
  stage: "4eae44984f0f1c97",
  lab: "bc35c1394f38b3ca",
  sky: "ab9f6f23399465c7",
  chart: "78f2533ee2bf9e93",
  art: "620f83164f5f9fc0",
  solid: "025ec22284a5418d",
  earth: "fe276656f509da42",
  music: "729307d8b935f4b2",
  workshop: "42a61862f7c873de",
  card: "8fcb5476ae622189",
  "concept-math": "69f1376a1e1405b3",
};

describe("prompt examples with the reference scenes present", () => {
  for (const engine of ANALYSIS_ENGINES) {
    const src = EXAMPLE_SOURCES[engine];
    it.skipIf(!src || !present(src.scene))(`${engine}: byte-identical to the example before the fallback`, () => {
      expect(sha(engineExample(engine))).toBe(BEFORE[engine]);
    });
  }
  it.skipIf(!present(MATH_EXAMPLE.scene))("concept (maths): byte-identical", () => {
    expect(sha(engineExample("concept", undefined, true))).toBe(BEFORE["concept-math"]);
  });
});

describe("prompt examples without the reference scenes (public copy)", () => {
  // A scenes folder holding only the original example lessons.
  const dir = `${mkdtempSync(join(tmpdir(), "pv-examples-"))}/`;
  for (const f of Object.values(EXAMPLE_FALLBACKS)) copyFileSync(join(REFERENCE_SCENES_DIR, `${f!.scene}.scene.json`), join(dir, `${f!.scene}.scene.json`));

  it("has a fallback for exactly the engines whose reference scene is left out of the public copy", () => {
    const excludes = loadExcludes(fileURLToPath(new URL("../../tools/publish/exclude.txt", import.meta.url)));
    const excluded = (scene: string) => excludes.some((r) => r.test(`fixtures/public/scenes/${scene}.scene.json`));
    const left = ANALYSIS_ENGINES.filter((e) => EXAMPLE_SOURCES[e] && excluded(EXAMPLE_SOURCES[e]!.scene));
    expect(Object.keys(EXAMPLE_FALLBACKS).sort()).toEqual([...left].sort());
    for (const f of Object.values(EXAMPLE_FALLBACKS)) {
      expect(excluded(f!.scene), f!.scene).toBe(false);
      expect(present(f!.scene), f!.scene).toBe(true);
    }
  });

  for (const engine of Object.keys(EXAMPLE_FALLBACKS) as (keyof typeof EXAMPLE_FALLBACKS)[]) {
    it(`${engine}: uses the original example lesson`, () => {
      const fb = EXAMPLE_FALLBACKS[engine]!;
      const text = engineExample(engine, dir);
      expect(text.length).toBeGreaterThan(1000);
      const ex = JSON.parse(text) as SceneSpec;
      expect(ex.engine).toBe(engine);
      expect(ex.chapters).toHaveLength(1);
      expect(text.length).toBeLessThan(10_000);
      const own = SceneSpec.parse(JSON.parse(readFileSync(join(dir, `${fb.scene}.scene.json`), "utf8")));
      expect(ex.title).toBe(own.title);
      expect(ex.chapters[0]!.id).toBe(own.chapters[fb.chapter]!.id);
      // With the original present the original is used, not the fallback.
      if (present(EXAMPLE_SOURCES[engine]!.scene)) expect((JSON.parse(engineExample(engine)) as SceneSpec).title).not.toBe(own.title);
    });
  }
});
