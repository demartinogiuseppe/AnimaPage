import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Manifest } from "../common.ts";
import { dryReport, downloadOne, planDownloads, run as fetchRun } from "../fetch.ts";
import { runFfmpeg, runProcess, validateTheme } from "../process.ts";

const root = mkdtempSync(join(tmpdir(), "sounds-hard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const file = (id: string, group: string, bytes = 10) => ({ id, group, title: id, page: `https://example.test/${id}`, url: `https://example.test/${id}.wav`, bytes });
const manifest = (files: ReturnType<typeof file>[]): Manifest => ({
  checked: "2026-11-10",
  sources: [{ id: "s", name: "S", author: "Au", licence: "CC0", licenceUrl: "u", licenceText: "t", files }],
});

describe("safe re-processing", () => {
  it("a corrupt file is a rejected row, the good one is processed and decisions survive", () => {
    const cache = join(root, "c1", "cache");
    const cand = join(root, "c1", "cand");
    mkdirSync(join(cache, "animals"), { recursive: true });
    mkdirSync(join(cand, "sea"), { recursive: true });
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=1", "-c:a", "pcm_s16le", join(cache, "animals", "good.wav")]);
    expect(r.status).toBe(0);
    writeFileSync(join(cache, "animals", "bad.wav"), "this is not audio");
    writeFileSync(join(cand, "animals.decisions.json"), JSON.stringify({ "animals/cat-meow-1.ogg": "keep", "animals/cat-meow-9.ogg": "keep" }));
    writeFileSync(join(cand, "sea.json"), "[]");
    writeFileSync(join(cand, "sea.decisions.json"), JSON.stringify({ "sea/waves-1.ogg": "keep" }));
    const m = manifest([file("good", "cat-meow"), file("bad", "cat-meow"), file("absent", "waves")]);
    runProcess(m, { cacheDir: cache, candidatesDir: cand });
    const sheet = JSON.parse(readFileSync(join(cand, "animals.json"), "utf8")) as { file: string; reason?: string }[];
    expect(sheet).toHaveLength(2);
    expect(sheet[0]?.file).toBe("animals/cat-meow-1.ogg");
    expect(existsSync(join(cand, "animals", "cat-meow-1.ogg"))).toBe(true);
    expect(sheet[1]?.reason).toMatch(/^decode failed/);
    expect(sheet[1]?.file).toBe("");
    expect(JSON.parse(readFileSync(join(cand, "animals.decisions.json"), "utf8"))).toEqual({ "animals/cat-meow-1.ogg": "keep" });
    // a theme with nothing in the cache is left alone
    expect(readFileSync(join(cand, "sea.json"), "utf8")).toBe("[]");
    expect(existsSync(join(cand, "sea.decisions.json"))).toBe(true);
    expect(readdirSync(cand).some((n) => n.startsWith(".tmp"))).toBe(false);
  });

  it("only known themes are accepted for --theme", () => {
    expect(validateTheme("sea")).toBe("sea");
    expect(() => validateTheme("../..")).toThrow(/unknown theme/);
    expect(() => validateTheme("")).toThrow(/unknown theme/);
  });

  it("a missing ffmpeg gives a clear message", () => {
    expect(() => runFfmpeg(["-version"], undefined, "definitely-not-ffmpeg-xyz")).toThrow(/ffmpeg not found/);
  });
});

describe("fetch", () => {
  const m = manifest([file("a", "cat-meow", 5)]);
  it("refuses without --approved and does not call the network", async () => {
    let called = 0;
    const f = (async () => {
      called++;
      return new Response("x");
    }) as typeof fetch;
    expect(await fetchRun([], m, f, join(root, "f0"))).toBe(1);
    expect(called).toBe(0);
  });
  it("refuses ids that are not plain names and URLs that are not https (docs/security.md, L8)", () => {
    for (const id of ["../../evil", "a/b", "A", "x.wav"]) expect(() => planDownloads(manifest([file(id, "cat-meow")])), id).toThrow(/id/);
    const insecure = manifest([{ ...file("a", "cat-meow"), url: "http://example.test/a.wav" }]);
    expect(() => planDownloads(insecure)).toThrow(/https/);
    expect(() => planDownloads(manifest([{ ...file("a", "cat-meow"), url: "file:///C:/x.wav" }]))).toThrow(/https/);
  });
  it("dryReport lists files and the total", () => {
    const out = dryReport(m);
    expect(out).toContain("animals/cat-meow");
    expect(out).toContain("1 files, 0.00 MB total");
  });
  it("rejects html and wrong sizes, caches good files atomically", async () => {
    const dest = join(root, "f1", "a.wav");
    const plan = { source: "S", id: "a", theme: "animals", group: "cat-meow", url: "https://example.test/a.wav", bytes: 5, dest };
    const resp = (body: string, type: string) => (async () => new Response(body, { headers: { "content-type": type } })) as typeof fetch;
    await expect(downloadOne(plan, resp("<html>", "text/html"))).rejects.toThrow(/html/);
    await expect(downloadOne(plan, resp("123456", "audio/wav"))).rejects.toThrow(/size/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(dest + ".part")).toBe(false);
    await downloadOne(plan, resp("12345", "audio/wav"));
    expect(readFileSync(dest, "utf8")).toBe("12345");
    expect(existsSync(dest + ".part")).toBe(false);
  });
});
