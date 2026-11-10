// Builds the runtime of the exported lesson (src/export/runtime.ts): the player and all engines in ONE
// script (IIFE, no dynamic import) and one stylesheet with the KaTeX fonts as data URIs, so the .html
// runs from file://. Usage: tsx scripts/build-export-runtime.ts [--out <dir>] (default fixtures/public/export).
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { RUNTIME_MARKER } from "../src/export/payload.ts";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flag = process.argv.indexOf("--out");
const outDir = resolve(flag >= 0 && process.argv[flag + 1] ? process.argv[flag + 1]! : join(WEB, "../../fixtures/public/export"));

await build({
  root: WEB,
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: true,
    minify: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 100_000,
    lib: { entry: join(WEB, "src/export/runtime.ts"), name: "AnimaPageExport", formats: ["iife"], fileName: () => "runtime.js", cssFileName: "runtime" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

// The marker collectExport checks, so a wrong file (e.g. the dev server's index.html) is never inlined.
const jsFile = join(outDir, "runtime.js");
writeFileSync(jsFile, `${RUNTIME_MARKER}\n${readFileSync(jsFile, "utf8")}`);

// KaTeX ships each font as woff2, woff and ttf; browsers only ever use the first, so drop the others
// (about 1.1 MB of data URIs) from the @font-face sources.
const cssFile = join(outDir, "runtime.css");
writeFileSync(cssFile, readFileSync(cssFile, "utf8").replace(/,url\(data:font\/(?:woff|ttf);base64,[A-Za-z0-9+/=]*\)format\("[a-z]+"\)/g, ""));

for (const f of ["runtime.js", "runtime.css"]) console.log(`${f}: ${(statSync(join(outDir, f)).size / 1024).toFixed(0)} kB`);
