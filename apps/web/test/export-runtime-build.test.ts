// The exported lesson runs from file://, so the runtime must be one script with no dynamic chunk
// and one stylesheet with no external URL (fonts inlined as data URIs).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RUNTIME_MARKER } from "../src/export/payload.ts";

const WEB = fileURLToPath(new URL("..", import.meta.url));

describe("export runtime build", () => {
  it("runtime build has no dynamic chunk and no external URL", { timeout: 120_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), "pv-export-"));
    try {
      execFileSync(process.execPath, ["--import", "tsx", "scripts/build-export-runtime.ts", "--out", out], { cwd: WEB, stdio: "pipe" });
      expect(readdirSync(out).sort()).toEqual(["runtime.css", "runtime.js"]);
      const js = readFileSync(join(out, "runtime.js"), "utf8");
      // collectExport refuses a runtime.js without the marker (e.g. the dev server's index.html fallback).
      expect(js.startsWith(RUNTIME_MARKER)).toBe(true);
      expect(js).not.toMatch(/\bimport\(/);
      const css = readFileSync(join(out, "runtime.css"), "utf8");
      expect(css).not.toMatch(/url\((?!["']?data:)/);
      // Only woff2 is kept for KaTeX: the woff and ttf alternatives are dead weight.
      expect(css).toContain("data:font/woff2;");
      expect(css).not.toContain("data:font/ttf");
      expect(css).not.toContain("data:font/woff;");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
