import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SceneSpec } from "@pv/scene-spec";
import { assetsOf } from "../src/export/assets.ts";

const PUBLIC = resolve(import.meta.dirname, "../../../fixtures/public");
const SCENES_DIR = resolve(PUBLIC, "scenes");
const load = (name: string) => SceneSpec.parse(JSON.parse(readFileSync(resolve(SCENES_DIR, `${name}.scene.json`), "utf8")));
const names = readdirSync(SCENES_DIR)
  .filter((f) => f.endsWith(".scene.json"))
  .map((f) => f.replace(/\.scene\.json$/, ""));

describe("assetsOf", () => {
  it("every referenced file exists", () => {
    for (const name of names) {
      for (const f of assetsOf(load(name)).files) {
        // /cache/art/... holds artwork downloaded on demand: it is not shipped with the fixtures.
        if (f.startsWith("/cache/")) continue;
        expect(existsSync(resolve(PUBLIC, f.replace(/^\//, ""))), `${name}: ${f}`).toBe(true);
      }
    }
  });

// Scene left out of the public copy (tools/publish/exclude.txt): the test below skips when it is absent.
  it.skipIf(!existsSync(resolve(SCENES_DIR, "campania.scene.json")))("campania includes its terrain header", () => {
    const a = assetsOf(load("campania"));
    expect(a.terrainHeaders.length).toBeGreaterThan(0);
    for (const h of a.terrainHeaders) expect(a.files).toContain(h);
    expect(a.files.some((f) => f.endsWith("regions.geojson"))).toBe(true);
  });

  it("arte-ultima-cena includes art/ultima-cena-leonardo.jpg", () => {
    expect(assetsOf(load("arte-ultima-cena")).files).toContain("art/ultima-cena-leonardo.jpg");
  });

  it("diorama, stage and workshop scenes include their GLB files", () => {
    // "racconto-elettricista" is left out of the public copy (tools/publish/exclude.txt): only the scenes present are checked.
    for (const name of ["racconto-elettricista", "palcoscenico-dialogo", "officina-mulino"].filter((n) => names.includes(n))) {
      const files = assetsOf(load(name)).files.filter((f) => f.startsWith("models/") && f.endsWith(".glb"));
      expect(files.length, name).toBeGreaterThan(0);
    }
  });

  it("sounds always include page-turn and wood-hit", () => {
    // Any scene will do ("campania" is left out of the public copy).
    const files = assetsOf(load(names.includes("campania") ? "campania" : "troia")).files;
    expect(files).toContain("audio/page-turn.ogg");
    expect(files).toContain("audio/wood-hit.ogg");
    expect(files).toContain("audio/correct.ogg");
    expect(files).toContain("audio/wrong.ogg");
  });

  it("music scene lists only sounds that have a file (instruments are synthesized)", () => {
    const a = assetsOf(load("musica-pentagramma"));
    expect(a.files.some((f) => f.includes("instr-"))).toBe(false);
    expect(a.terrainHeaders).toEqual([]);
  });

  it("includes chapter and background music sounds", () => {
    const spec = load("troia");
    const ids = new Set<string>();
    if (spec.music) ids.add(spec.music.track);
    for (const c of spec.chapters) for (const s of [...(c.sounds?.ambience ?? []), ...(c.sounds?.cues ?? [])]) ids.add(s.sound);
    const files = assetsOf(spec).files;
    for (const id of ids) if (existsSync(resolve(PUBLIC, `audio/${id}.ogg`))) expect(files).toContain(`audio/${id}.ogg`);
  });

  it("result is sorted and unique", () => {
    for (const name of names) {
      const a = assetsOf(load(name));
      expect(a.files).toEqual([...new Set(a.files)].sort());
      expect(a.terrainHeaders).toEqual([...new Set(a.terrainHeaders)].sort());
    }
  });

  it("a storybook lesson also embeds the tap and activity sounds, not only the cues", async () => {
    const { STORY_LIBRARY } = await import("../src/engines/storybook/library.ts");
    const files = assetsOf(load("storie-trenino")).files;
    const has = (group: string) => {
      const ids = Object.keys(STORY_LIBRARY).filter((v) => STORY_LIBRARY[v]!.group === group && STORY_LIBRARY[v]!.file);
      expect(ids.length, group).toBeGreaterThan(0);
      for (const v of ids) expect(files, v).toContain(`audio/storybook/${v}.ogg`);
    };
    // The train and the cow (a tap; the cup has no recorded file), boing (the cloud has no sound of its own), the finish, the notes of the plays.
    for (const g of ["train-whistle", "cow-moo", "boing", "ta-da", "sparkle", "xylophone-up"]) has(g);
  });
});
