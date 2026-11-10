// The seed sound library of the storybook theatre: files on disk, groups covered, licences recorded.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STORY_SOUND_GROUPS } from "@pv/scene-spec";
import { STORY_LIBRARY } from "../src/engines/storybook/library.ts";

const ROOT = join(__dirname, "..", "..", "..");
const AUDIO = join(ROOT, "fixtures", "public", "audio", "storybook");
const DOC = join(ROOT, "docs", "assets-audio-storybook.md");
const BUDGET = 12_000_000;

const entries = Object.entries(STORY_LIBRARY);
const withFile = entries.filter(([, v]) => v.file).map(([name]) => name);

describe("storybook seed library", () => {
  it("every library file exists, is listed, and the folder stays under 12 MB", () => {
    for (const name of withFile) expect(existsSync(join(AUDIO, `${name}.ogg`)), name).toBe(true);
    const onDisk = readdirSync(AUDIO).filter((f) => f.endsWith(".ogg"));
    expect(onDisk.map((f) => f.slice(0, -4)).sort()).toEqual([...withFile].sort());
    const total = onDisk.reduce((sum, f) => sum + statSync(join(AUDIO, f)).size, 0);
    expect(total).toBeLessThan(BUDGET);
  });

  it("every group has at least one variant; common groups have three", () => {
    const count = (group: string) => entries.filter(([, v]) => v.group === group).length;
    const files = (group: string) => entries.filter(([, v]) => v.group === group && v.file).length;
    for (const g of STORY_SOUND_GROUPS) expect(count(g.id), g.id).toBeGreaterThanOrEqual(1);
    for (const g of ["train-whistle", "cat-meow", "boing", "pop"]) expect(files(g), g).toBeGreaterThanOrEqual(3);
    // Only two CC0 recordings were found for these; the user kept both (ledger ruling, Task 10).
    for (const g of ["chick-peep", "waves"]) expect(files(g), g).toBeGreaterThanOrEqual(2);
    for (const name of withFile) expect(STORY_SOUND_GROUPS.some((g) => g.id === STORY_LIBRARY[name]!.group), name).toBe(true);
  });

  it("every file row in docs/assets-audio-storybook.md has a CC0 source", () => {
    const rows = readFileSync(DOC, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("| "))
      .map((l) => l.split("|").map((c) => c.trim()));
    for (const name of withFile) {
      const row = rows.find((r) => r[1] === name);
      expect(row, name).toBeDefined();
      expect(row![4], name).toMatch(/CC0/);
      expect(row![5]?.length ?? 0, name).toBeGreaterThan(0);
    }
  });
});
