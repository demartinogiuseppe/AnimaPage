// Example-scene index (apps/web/scripts/scene-index.ts), written by the web app's Vite plugin.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSceneIndex, DEFAULT_EXAMPLES, writeSceneIndex, type SceneIndexEntry } from "../../apps/web/scripts/scene-index.ts";

const scene = (title: string, subject: string, engine = "card") => JSON.stringify({ title, engine, page: { subject } });

describe("scene index", () => {
  const fill = (dir: string) => {
    writeFileSync(join(dir, "gen-b.scene.json"), scene("Bravo", "storia", "timeline"));
    writeFileSync(join(dir, "gen-a.scene.json"), scene("Alfa", "geografia", "map"));
    writeFileSync(join(dir, "zeta.scene.json"), scene("Zeta", "Scienze"));
    writeFileSync(join(dir, "troia.scene.json"), scene("I Micenei", "Storia", "battle"));
    writeFileSync(join(dir, "campania.scene.json"), scene("Campania", "Geografia", "map"));
    writeFileSync(join(dir, "matematica-parabola.scene.json"), scene("Studio di funzione: un esempio svolto", "matematica", "graph"));
    writeFileSync(join(dir, "_dev.scene.json"), scene("Dev", "Storia"));
    writeFileSync(join(dir, "rotta.scene.json"), "{ nope");
    writeFileSync(join(dir, "index.json"), "[]");
  };

  it("by default lists only the default examples that exist, in default order", () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-scenes-"));
    fill(dir);
    expect(DEFAULT_EXAMPLES).toHaveLength(10);
    expect(buildSceneIndex(dir)).toEqual<SceneIndexEntry[]>([
      { file: "troia", title: "I Micenei", subject: "Storia", engine: "battle", generated: false },
      { file: "matematica-parabola", title: "Studio di funzione: un esempio svolto", subject: "Matematica", engine: "graph", generated: false },
    ]);
  });

  it("with all: true lists defaults first, then other hand-written scenes by title, then generated; skips _dev and broken files", () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-scenes-"));
    fill(dir);
    expect(buildSceneIndex(dir, { all: true }).map((e) => e.file)).toEqual(["troia", "matematica-parabola", "campania", "zeta", "gen-a", "gen-b"]);
  });

  it("writes index.json only when it changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-scenes-"));
    writeFileSync(join(dir, "troia.scene.json"), scene("I Micenei", "Storia", "battle"));
    expect(writeSceneIndex(dir)).toBe(true);
    expect(writeSceneIndex(dir)).toBe(false);
    writeFileSync(join(dir, "gen-x.scene.json"), scene("X", "storia"));
    expect(writeSceneIndex(dir)).toBe(false);
    expect(writeSceneIndex(dir, { all: true })).toBe(true);
    expect((JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as SceneIndexEntry[]).map((e) => e.file)).toEqual(["troia", "gen-x"]);
  });

  it("real example scenes: the default list is the ten defaults (those present), all: true adds the rest without _dev", () => {
    const dir = fileURLToPath(new URL("../../fixtures/public/scenes/", import.meta.url));
    const def = buildSceneIndex(dir).map((e) => e.file);
    expect(def).toEqual(DEFAULT_EXAMPLES.filter((f) => def.includes(f)));
    expect(def.length).toBeGreaterThan(0);
    const entries = buildSceneIndex(dir, { all: true });
    expect(entries.length).toBeGreaterThanOrEqual(20);
    expect(entries.some((e) => e.file.startsWith("_"))).toBe(false);
    expect(entries.slice(0, def.length).map((e) => e.file)).toEqual(def);
    const firstGen = entries.findIndex((e) => e.generated);
    if (firstGen >= 0) expect(entries.slice(firstGen).every((e) => e.generated)).toBe(true);
  });
});
