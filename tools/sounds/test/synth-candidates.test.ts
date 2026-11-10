import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CandidateRow } from "../common.ts";
import { startServer } from "../listen.ts";
import { runSynth } from "../synth-candidates.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "synth-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (name: string): CandidateRow[] => JSON.parse(readFileSync(join(dir, name), "utf8")) as CandidateRow[];
const realRow = (group: string, file: string): CandidateRow => ({ group, file, source: "https://x", author: "A", licence: "CC0 1.0", dur: 1, peakDb: -3, rmsDb: -20 });

function seedReal(): { sheet: string; decisions: string } {
  mkdirSync(join(dir, "sea"), { recursive: true });
  writeFileSync(join(dir, "sea", "waves-1.ogg"), "real");
  const sheet = JSON.stringify([realRow("waves", "sea/waves-1.ogg")], null, 2) + "\n";
  const decisions = JSON.stringify({ "sea/waves-1.ogg": "keep" }, null, 2) + "\n";
  writeFileSync(join(dir, "sea.json"), sheet);
  writeFileSync(join(dir, "sea.decisions.json"), decisions);
  return { sheet, decisions };
}

describe("synth candidates", () => {
  it("writes -s<n> files and rows, and leaves real rows, files and decisions untouched", () => {
    const { decisions } = seedReal();
    const res = runSynth(dir, ["whale-spout", "waves"]);
    const rows = read("sea.json");
    expect(rows[0]).toEqual(realRow("waves", "sea/waves-1.ogg")); // real row first and unchanged
    const synth = rows.filter((r) => r.file.includes("-s"));
    expect(synth.length).toBeGreaterThanOrEqual(2);
    for (const [i, r] of synth.entries()) {
      expect(r.group).toBe("whale-spout");
      expect(r.file).toBe(`sea/whale-spout-s${i + 1}.ogg`);
      expect(existsSync(join(dir, r.file))).toBe(true);
      expect([r.source, r.author, r.licence]).toEqual(["synth (AnimaPage)", "AnimaPage", "CC0 (own work)"]);
      expect(r.peakDb).toBeCloseTo(-3, 1);
    }
    expect(readFileSync(join(dir, "sea", "waves-1.ogg"), "utf8")).toBe("real");
    expect(readFileSync(join(dir, "sea.decisions.json"), "utf8")).toBe(decisions);
    expect(res.rows.length).toBe(synth.length); // waves has a kept real sound: no synth for it
  });

  it("a group whose real candidates were all discarded gets synth variants", () => {
    seedReal();
    writeFileSync(join(dir, "sea.decisions.json"), JSON.stringify({ "sea/waves-1.ogg": "discard" }));
    runSynth(dir, ["waves"]);
    expect(read("sea.json").some((r) => r.file === "sea/waves-s1.ogg")).toBe(true);
    // an ambience loop is 8-20 s
    const amb = read("sea.json").find((r) => r.file === "sea/waves-s1.ogg")!;
    expect(amb.dur).toBeGreaterThanOrEqual(8);
    expect(amb.dur).toBeLessThanOrEqual(20);
  });

  it("re-running replaces only the synth files and rows", () => {
    const { decisions } = seedReal();
    runSynth(dir, ["whale-spout"]);
    writeFileSync(join(dir, "sea", "whale-spout-s9.ogg"), "stale");
    const first = read("sea.json");
    runSynth(dir, ["whale-spout"]);
    expect(read("sea.json")).toEqual(first);
    expect(readdirSync(join(dir, "sea")).sort()).toEqual(["waves-1.ogg", ...first.filter((r) => r.file.includes("-s")).map((r) => r.file.slice(4))].sort());
    expect(readFileSync(join(dir, "sea.decisions.json"), "utf8")).toBe(decisions);
  });

  it("creates the sheet of a theme that has only synth rows, and the listening page shows it", async () => {
    runSynth(dir, ["xylophone-up"]);
    const rows = read("music.json");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.group === "xylophone-up" && !r.reason)).toBe(true);
    const server = await startServer(dir, 0);
    try {
      const port = (server.address() as { port: number }).port;
      const state = (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()) as { theme: string; rows: CandidateRow[] }[];
      expect(state.find((t) => t.theme === "music")?.rows.length).toBe(rows.length);
    } finally {
      server.close();
    }
  });
});
