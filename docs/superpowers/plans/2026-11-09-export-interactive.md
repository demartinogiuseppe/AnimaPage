# Interactive lesson export (HTML + OpenBoard widget) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add an "Esporta" menu to a complete lesson in the app with two exports:
- a self-contained `.html` file that runs the whole lesson offline from `file://`;
- the same file wrapped as an OpenBoard widget (`.wgt`).

**Architecture:**
- A separate Vite build turns `apps/web/src/export/runtime.ts` into one inlined script, `fixtures/public/export/runtime.js` (plus `runtime.css`).
- At export time the app collects that runtime, the SceneSpec, the referenced assets (from `assetsOf(spec)`) and the UI catalog.
- `assembleHtml` writes everything into one HTML string, which the browser downloads as a Blob.
- The player gains two options:
  - `loadAsset`, so the runtime reads assets from the embedded map instead of `fetch`;
  - `exported`, which hides AR, adds "Ricomincia" and marks the online-only parts.

**Tech Stack:** TypeScript strict, Vite 8 (build API), three.js, zod 4, vitest 5 (+ happy-dom), playwright-core (channel `chrome`), Node ≥ 24 (`zlib.crc32`).

**Spec:** `docs/superpowers/specs/2026-11-09-export-design.md`. Read it first. This plan argues from it.

## Global Constraints

- The exported file makes **no network request** unless the user clicks a video or a source link.
- The exported payload contains only:
  - the format version and app version;
  - the UI language and catalog;
  - the presentation;
  - the SceneSpec;
  - the assets referenced by it.

  It never contains page photos, archive data, ledger data, keys, settings beyond the UI language, or the user's email.
- Presentation is fixed at export time: the value the player resolved, `resolvePresentation(readPresentationPref(), spec)`, unless the caller passed one.
- **Stamps and progress:**
  - kept in local storage under the existing keys (`pv.stamps.<sceneKey>`);
  - "Ricomincia" clears only this lesson;
  - nothing is written into the OpenBoard document.
- AR is hidden in exported files.
- **Online-only parts:** videos and source links stay, and each is marked with the new string `player.needsInternet` (it: "Serve internet").
- **Archive lessons** (asset paths under `/cache/`): if the server is unreachable, the export fails with the message `export.serverDown`, never with a partial file.
- **Size:** show the file size after export, and warn when it is above **30 MB** (`30 * 1024 * 1024` bytes).
- **One runtime for all engines.** It is simpler and the size is acceptable. The spec phrase "engine code for this lesson" is satisfied in function, not by per-engine bundles. Record this in D27.
- **Text and language rules:**
  - every new UI string goes into all six catalogs in `packages/scene-spec/src/i18n/messages/` (it, en, es, fr, de, pt);
  - Italian is the reference wording;
  - code and docs are in English.
- **Dependencies:** none, apart from what is already installed. The zip writer is hand-written (stored entries, CRC32 via `node:zlib` in tests, a small table-based CRC32 in the browser).
- **Work rules:**
  - no live LLM calls;
  - `pnpm test` must stay green (baseline: 811 passed, 5 skipped);
  - one agent at a time;
  - never touch `server/.env` or `apps/web/.cert`.

## Review Focus

1. **A lesson text containing `</script>` or `<!--`** (titles, narration, quiz text) must not break the HTML. The test goes in Task 4: `assembleHtml escapes script terminators`.
2. **Two exported lessons opened from the same folder** share the `file://` storage origin. "Ricomincia" in one must not clear the other. The test goes in Task 1: `StampStore.clear removes only that scene`.
3. **A UI language without a built-in catalog** (e.g. `ja`) must open in that language offline. The test goes in Task 4: `payload carries a non-built-in catalog` (assemble round-trip) and in Task 7's e2e (one scene exported with a fake `ja` catalog shows its strings).
4. **An archive lesson with a `/cache/...` asset while the server is down** must fail clearly. The test goes in Task 5: `collectExport rejects with kind "server" when an asset fetch fails with a network error`.
5. **Lesson titles that are empty, very long or full of accents and symbols** must still give a usable filename. The test goes in Task 5: `exportFileName` gives `battaglia-di-canne.html` for "Battaglia di Canne", ASCII-folds "Perché è così?" to `perche-e-cosi.html`, caps the slug at 60 characters, and falls back to `lezione.html` when nothing is left.

---

### Task 1: Player hooks for exported lessons

**Files:**
- Modify: `packages/engine/src/book/activity.ts` (class `StampStore`, around lines 89–124)
- Modify: `packages/engine/src/player/audio/webaudio.ts` (constructor at line 62; sound fetch at line 300)
- Modify: `packages/engine/src/player/player.ts`:
  - `PlayerOptions` (lines 28–47);
  - `WebAudioOut` creation (line 246);
  - stage `loadAsset` (lines 534–538);
  - `buildVideos` (line 1311) and `buildSources`;
  - AR block (line 1156).
- Modify: `packages/scene-spec/src/i18n/messages/{it,en,es,fr,de,pt}.ts`, adding `player.restart`, `player.restartConfirm` and `player.needsInternet`.
- Test: `packages/engine/test/book-activity.test.ts`, `packages/engine/test/player-dom.test.ts`

**Interfaces:**
- Produces:
  - `type AssetLoader = (path: string) => Promise<ArrayBuffer>`, exported from `packages/engine/src/player/index.ts`;
  - `PlayerOptions.loadAsset?: AssetLoader`, which, when present, replaces `fetch(new URL(path, assetBase))` for stage assets **and** sounds;
  - `PlayerOptions.exported?: boolean`;
  - `StampStore.clear(scene: string): void`;
  - `new WebAudioOut(base: string, load?: AssetLoader)`.

- [ ] **Step 1: Write failing tests.**
  - In `book-activity.test.ts`, add `StampStore.clear removes only that scene`. Add stamps to scenes `a` and `b` in a fake `StorageLike`, call `clear("a")`, then expect `has("a", ch)` to be false, `has("b", ch)` to be true, and storage key `pv.stamps.a` to be removed.
  - In `player-dom.test.ts`, add `exported lesson shows Ricomincia and no AR button`. Mount `card-esempio` with `{ tts, exported: true }`, then expect `button("Ricomincia")` to exist and the AR button (its selector in `xr/ar-mode.ts`) to be absent.
  - Also in `player-dom.test.ts`, add `Ricomincia clears this lesson's stamps`. Pass a `StampStore` over a fake storage holding a stamp for `sceneKey(card)`, stub `confirm` to return true, click, and expect the store to be empty for that key.
  - Add `WebAudioOut uses the loader instead of fetch` (unit test). Spy `globalThis.fetch`, construct with a loader resolving an empty `ArrayBuffer`, trigger a sound load, then expect the loader to have been called with `audio/<id>.ogg` and `fetch` not to have been called.
- [ ] **Step 2: Run them and see them fail.** Run `pnpm vitest run packages/engine/test/book-activity.test.ts packages/engine/test/player-dom.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
  - **`StampStore.clear`** removes the entry from `mem` and storage.
  - **`WebAudioOut`** uses `load ?? (p => fetch(new URL(p, base)).then(...))`.
  - **In `player.ts`, assets:** pass `opts.loadAsset` to the stage and to `WebAudioOut`.
  - **In `player.ts`, exported mode:**
    - skip `new ArMode` entirely;
    - add a "Ricomincia" button next to the existing top actions. After `confirm(t("player.restartConfirm"))`, it calls `stamps.clear(lessonKey)` and resets quizzes, activities and the current chapter by re-running `go(chapters[0].id, false)` after clearing the `quizzes` and `activities` maps;
    - append `t("player.needsInternet")` as a `.pv-note` in the videos card and in the sources card.
  - **Strings:** it "Ricomincia" / "Ricominciare da capo? Timbri e risposte di questa lezione verranno cancellati." / "Serve internet"; en "Start over" / "Start over? This lesson's stamps and answers will be cleared." / "Needs internet". Translate es/fr/de/pt in the same register.
- [ ] **Step 4: Run them and see them pass.** Run the same command, then `pnpm test`. Expected: all green.
- [ ] **Step 5: Commit.** `git commit -m "feat(player): loadAsset and exported options, StampStore.clear"`

### Task 2: `assetsOf(spec)`, the assets a lesson needs

**Files:**
- Create: `packages/engine/src/export/assets.ts`
- Modify: `packages/engine/src/index.ts` (re-export)
- Test: `packages/engine/test/export-assets.test.ts`

**Interfaces:**
- Consumes:
  - `dioramaModel(id)` from `@pv/scene-spec` (`engines/diorama.ts:416`);
  - `soundFile(id)` from `player/audio/library.ts`;
  - the instrument-cue logic of the music engine (`engine.soundCues`).
- Produces:
  - `interface AssetRefs { files: string[]; terrainHeaders: string[] }`, where `files` holds every asset path the stage and the sounds will request (sorted, unique, including `audio/<id>.ogg`), and `terrainHeaders` is the subset of `files` that are map terrain headers (their grid file is resolved in Task 5);
  - `assetsOf(spec: SceneSpec): AssetRefs`.

**Rules `assetsOf` must cover:**
- **map:** `terrain.asset`, `boundaries.asset`, `rivers.asset` (see `engines/map/index.ts:428-453`).
- **art:** the image `asset` and any 3D `asset` (`scene-spec/engines/art.ts:69,189`).
- **diorama and workshop:** `dioramaModel(model)?.file`.
- **stage:** `characters[].model` and `props[].model` strings, as in `engines/stage/index.ts:178`.
- **sounds:**
  - `chapter.sounds` ids;
  - `spec.music` ids;
  - always `page-turn` and `wood-hit` (player one-shots, `player.ts:466,767`);
  - for the music engine, every instrument sound its cues can use.

- [ ] **Step 1: Write failing tests.**
  - `every referenced file exists`: for each `fixtures/public/scenes/*.scene.json` except `index.json`, parse the scene and expect every `assetsOf(spec).files` entry to exist under `fixtures/public/`.
  - `campania includes its terrain header`: `terrainHeaders` is non-empty and is a subset of `files`.
  - `arte-ultima-cena includes art/ultima-cena-leonardo.jpg`.
  - `diorama scenes include their GLB files`: pick a reference scene that uses catalog models with files.
  - `sounds always include page-turn and wood-hit`.
  - `music scene includes instrument sounds`: pick `musica-pentagramma`.
  - `result is sorted and unique`.
- [ ] **Step 2: Run and see it fail.** Run `pnpm vitest run packages/engine/test/export-assets.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `assetsOf`** as a pure function that switches on `spec.engine` and walks the chapters.
- [ ] **Step 4: Run and see it pass.** Expected: PASS, then `pnpm test` green.
- [ ] **Step 5: Commit.** `git commit -m "feat(engine): assetsOf lists the assets a lesson needs"`

### Task 3: Export runtime and its build

**Files:**
- Create: `apps/web/src/export/payload.ts`, which holds the shared types and constants.
- Create: `apps/web/src/export/runtime.ts`, the entry of the exported file.
- Create: `apps/web/scripts/build-export-runtime.ts`
- Modify: `apps/web/package.json`: script `"export-runtime": "tsx scripts/build-export-runtime.ts"`. The runtime is built whenever the app is served or built by a `pv-export-runtime` plugin in `apps/web/vite.config.ts` (`buildStart`: dev-server start and `vite build`, which also covers `pnpm dev:phone`), not by `predev`/`prebuild`: pnpm pre-scripts are disabled in this repo (`enable-pre-post-scripts` is unset), so they would never run.
- Modify: `.gitignore`: add `fixtures/public/export/`.
- Modify: `apps/web/vite.config.ts`: add `"export/**"` to `workbox.globIgnores`.
- Test: `apps/web/test/export-runtime-build.test.ts`

**Interfaces:**
- Produces, in `payload.ts`:
  - `EXPORT_FORMAT = 1`;
  - `PAYLOAD_ID = "pv-export"`;
  - `interface ExportPayload { format: 1; app: string; uiLang: string; catalog: Catalog | null; presentation: Presentation; spec: unknown; assets: Record<string, string> }`, where `assets` maps each path to base64;
  - `RUNTIME_JS = "export/runtime.js"`, `RUNTIME_CSS = "export/runtime.css"`.
- Produces the runtime behaviour:
  - on load it reads `document.getElementById(PAYLOAD_ID)`;
  - it applies the language with `setUiLanguage(uiLang, catalog ?? undefined)`, setting `<html lang/dir>`;
  - it validates `SceneSpec.parse(spec)`;
  - it calls `mountPlayer(host, spec, await createEngine(spec.engine), { exported: true, presentation, loadAsset })`, where `loadAsset` decodes base64 from `assets` and rejects with `asset <path>: not in file` when the path is missing;
  - it sets `document.documentElement.dataset.pvExport = "ready"` once mounted, which the e2e check waits for.
- Produces the build:
  - `build-export-runtime.ts` calls Vite's `build()` with library mode (`formats: ["iife"]`, name `AnimaPageExport`), `inlineDynamicImports: true`, `assetsInlineLimit: Number.MAX_SAFE_INTEGER` so that KaTeX fonts become data URIs inside `runtime.css`, and `minify: true`;
  - it accepts `--out <dir>` (default `fixtures/public/export`), writes `runtime.js` and `runtime.css` there, and prints both sizes.

- [ ] **Step 1: Write a failing test.** In `apps/web/test/export-runtime-build.test.ts`, add `runtime build has no dynamic chunk and no external URL`. It runs the build script into a temp `--out` and expects:
  - exactly the files `runtime.js` and `runtime.css`;
  - `runtime.js` not to match `/\bimport\(/`;
  - `runtime.css` not to match `/url\((?!["']?data:)/`.
- [ ] **Step 2: Run and see it fail.** Run `pnpm vitest run apps/web/test/export-runtime-build.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `payload.ts`, `runtime.ts` and the build script.
- [ ] **Step 4: Run and see it pass,** then `pnpm test`.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): inlined export runtime and its build"`

### Task 4: `assembleHtml`, one HTML file

**Files:**
- Create: `apps/web/src/export/assemble.ts`
- Test: `apps/web/test/export-assemble.test.ts`

**Interfaces:**
- Consumes `ExportPayload` and `PAYLOAD_ID` (Task 3).
- Produces:
  - `interface ExportInput { payload: ExportPayload; runtimeJs: string; runtimeCss: string; title: string }`;
  - `assembleHtml(input: ExportInput): string`. It returns an `<!doctype html>` document with charset and viewport metas, `<meta name="generator" content="AnimaPage <app>">`, an escaped `<title>`, inline `<style>` and `<script>` for the runtime, and `<script type="application/json" id="pv-export">`;
  - `payloadOf(html: string): ExportPayload`, the inverse, used by tests and by the e2e check.

- [ ] **Step 1: Write failing tests.**
  - `round-trips the payload`: `payloadOf(assembleHtml(x))` deep-equals `x.payload`.
  - `assembleHtml escapes script terminators`: a spec whose title and narration contain `</script><!--` still round-trips, and the HTML contains exactly 2 `</script>` closing tags.
  - `payload carries a non-built-in catalog`: `uiLang: "ja"` with a catalog round-trips unchanged.
  - `payload has only the allowed keys`: `Object.keys(payload)` equals `["app","assets","catalog","format","presentation","spec","uiLang"]` when sorted.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.** In JSON and inline script text, replace `<` with `<` so that `</script` and `<!--` can never appear. Escape the title as HTML text.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(web): assembleHtml for single-file lessons"`

### Task 5: `collectExport`, `.wgt` packaging and file names

**Files:**
- Create: `apps/web/src/export/collect.ts`
- Create: `apps/web/src/export/wgt.ts` (writer)
- Create: `apps/web/src/export/zip-read.ts` (minimal stored-zip reader, used by tests and the e2e check)
- Test: `apps/web/test/export-collect.test.ts`, `apps/web/test/export-wgt.test.ts`

**Interfaces:**
- Consumes `assetsOf` (Task 2), `ExportPayload` and the `RUNTIME_*` constants (Task 3), and `ExportInput` (Task 4).
- Produces, in `collect.ts`:
  - `type Fetcher = (path: string) => Promise<Uint8Array>`. In the app it does `fetch(new URL(path, document.baseURI))`; the e2e check reads from disk;
  - `class ExportError extends Error { kind: "server" | "runtime" | "asset" }`;
  - `collectExport(spec: SceneSpec, deps: { fetch: Fetcher; uiLang: string; catalog: Catalog | null; presentation: Presentation; app: string }): Promise<ExportInput>`. It loads `RUNTIME_JS` and `RUNTIME_CSS`, every `assetsOf(spec).files` entry, and for each terrain header the grid file it names (`dirOf(path) + header.data`);
  - error mapping: a network error (TypeError) on a `/cache/` path gives `kind "server"`; any failure on a runtime file gives `"runtime"`; anything else gives `"asset"` with the path in the message;
  - `exportFileName(title: string, ext: "html" | "wgt"): string`, as in Review Focus 5;
  - `SIZE_WARN_BYTES = 30 * 1024 * 1024`.
- Produces, in `wgt.ts`:
  - `buildWgt(html: string, meta: { id: string; title: string; version: string }): Uint8Array`. It builds a stored (uncompressed) zip with `config.xml` and `index.html`;
  - the `config.xml` content is `<widget xmlns="http://www.w3.org/ns/widgets" id="https://animapage.local/lesson/<id>" version="<version>" width="1024" height="720"><name>{escaped title}</name><content src="index.html"/></widget>`, with `<id>` = `sceneKey(spec)`.
- Produces, in `zip-read.ts`: `readStoredZip(data: Uint8Array): Map<string, Uint8Array>`.

- [ ] **Step 1: Write failing tests.**
  - `collects runtime, scene assets and terrain grid` uses a fake `Fetcher` reading `fixtures/public` from disk for `campania`. It expects `assets` to have every `assetsOf` file plus the grid file named by the header.
  - `collectExport rejects with kind "server" when an asset fetch fails with a network error` uses a spec with an art asset `/cache/art/Q1/x.jpg` and a fetcher that throws `TypeError` for it.
  - `exportFileName` covers the cases in Review Focus 5.
  - `wgt contains config.xml and index.html with valid CRCs` reads the zip with `readStoredZip`, compares CRCs with `zlib.crc32`, checks that `index.html` equals the input, and checks that `config.xml` has `<content src="index.html"/>`.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.** Base64 the bytes in chunks so a large file does not exceed the argument limit of `String.fromCharCode.apply`.
- [ ] **Step 4: Run and see it pass,** then `pnpm test`.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): collectExport, .wgt packaging, export file names"`

### Task 6: The "Esporta" menu in the app

**Files:**
- Create: `apps/web/src/export/menu.ts`
- Modify: `apps/web/src/main.ts`. In `showScene` (around line 254), add the menu to the top bar only for complete lessons: when `opts.following` is undefined, for archive lessons and example scenes.
- Modify: `apps/web/src/i18n.ts`. Add `currentCatalog(): Catalog | null`, which returns `null` for built-in languages and the cached translated catalog otherwise.
- Modify: `apps/web/vite.config.ts`. Add `define: { __APP_VERSION__: JSON.stringify(<apps/web/package.json version>) }`, with a matching `declare const __APP_VERSION__: string`.
- Modify: `packages/scene-spec/src/i18n/messages/{it,en,es,fr,de,pt}.ts`. Add these keys, with the Italian reference wording:
  - `export.menu` "Esporta";
  - `export.html` "Lezione interattiva (.html)";
  - `export.wgt` "Widget per OpenBoard (.wgt)";
  - `export.working` "Preparo il file…";
  - `export.done` "Pronto: {name} ({size})";
  - `export.tooBig` "Il file è grande ({size}): passarlo potrebbe essere scomodo.";
  - `export.serverDown` "Per esportare questa lezione serve il server di AnimaPage acceso.";
  - `export.failed` "Esportazione non riuscita: {reason}".
- Test: `apps/web/test/export-menu.test.ts` (happy-dom)

**Interfaces:**
- Consumes `collectExport`, `exportFileName`, `SIZE_WARN_BYTES`, `ExportError` and `buildWgt` (Task 5), `assembleHtml` (Task 4), and `uiLanguage()` and `currentCatalog()`.
- Produces `exportMenu(spec: SceneSpec, deps?: { fetch?: Fetcher; download?: (name: string, data: Blob) => void }): HTMLElement`.

- [ ] **Step 1: Write failing tests.**
  - `offers both formats`: the element has buttons with `t("export.html")` and `t("export.wgt")`.
  - `downloads a .html named from the title`: a fake fetch and a fake download; click the html option and expect the download to receive `battaglia-di-canne.html` and a `text/html` Blob for a spec titled "Battaglia di Canne".
  - `shows serverDown on ExportError server`.
  - `warns above 30 MB`: a fake fetch returns a 31 MB asset, and the `export.tooBig` text appears.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.**
  - The presentation is `resolvePresentation(readPresentationPref(), spec)`.
  - The app version is `__APP_VERSION__`.
  - Show `export.working` while working, then `export.done`.
  - Download with `URL.createObjectURL` and `<a download>`.
- [ ] **Step 4: Run and see it pass,** then `pnpm test`.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): Esporta menu with HTML and OpenBoard widget"`

### Task 7: Offline end-to-end check

**Files:**
- Create: `apps/web/scripts/export-e2e.ts`
- Modify: root `package.json` with script `"export:e2e": "tsx apps/web/scripts/export-e2e.ts"`

**Interfaces:**
- Consumes `collectExport`, with a disk `Fetcher` rooted at `fixtures/public`, plus `assembleHtml`, `buildWgt` and `readStoredZip`.
- Produces a CLI that exits with code 0 when every scene passes.

**Behaviour**
- Run `pnpm --filter @pv/web export-runtime`.
- For every `fixtures/public/scenes/*.scene.json`, except `index.json` and `_dev-routes`:
  - write `<os tmpdir>/animapage-export-e2e/<name>.html`;
  - also build one `.wgt`, extract its `index.html` with `readStoredZip`, and check it the same way;
  - export one extra scene with `uiLang "ja"` and a fake catalog whose `player.restart` is "最初から".
- Launch `chromium.launch({ channel: "chrome", headless: true, args: [...(win32 ? ["--use-angle=d3d11"] : []), "--ignore-gpu-blocklist", "--mute-audio"] })`, as in `server/src/check/render.ts:55`.
- For each file, block and record every request whose URL does not start with `file:`.

**Pass conditions for every file**
- Zero blocked requests.
- `dataset.pvExport === "ready"` within 20 s.
- No `.pv-fail` element.
- A screenshot of the stage canvas has pixel variance above a threshold, so the stage is not blank.
- Clicking the next chapter chip changes the active chapter.
- If the chapter has a quiz, clicking the first option shows feedback.
- If any chapter has an activity, its first control responds.
- No `console.error` messages.
- The `ja` file shows "最初から".

The script prints a table of name, size and pass/fail.

- [ ] **Step 1: Write the script** and run `pnpm export:e2e`. Expected: on the first run, failures that show missing assets or player issues.
- [ ] **Step 2: Fix the causes.** Each fix belongs to the task that owns the code; add a unit test there for any asset rule that was missing.
- [ ] **Step 3: Run `pnpm export:e2e` again.** Expected: every row passes. Then run `pnpm test`; it must be green.
- [ ] **Step 4: Commit.** `git commit -m "test(web): offline end-to-end check of exported lessons"`

### Task 8: Real OpenBoard check, docs and decision D27

Do this with the user at the PC. OpenBoard 1.7.7 was installed on 2026-11-09 with winget, package `OpenEducationFoundation.OpenBoard`. Check that it is installed with `winget list --id OpenEducationFoundation.OpenBoard`.

**Files:**
- Create: `docs/export.md`, which records:
  - how to export;
  - what was tested and where;
  - known limits.
- Modify: `docs/decisions.md`. Add row D27 after D26, summarising the spec and this plan's calls (single runtime for all engines, browser assembly, `/cache` needs the server, stamps with "Ricomincia", presentation locked).
- Modify: `docs/dev-setup.md`. Add `pnpm export:e2e` and the `export-runtime` build.

- [ ] **Step 1: Export two lessons from the running app, as `.html` and `.wgt`.** Use one pop-up book lesson with an activity (`scienze-sensi`) and one Accademico lesson with formulas (`matematica-parabola`).
- [ ] **Step 2: Open the `.html` files from a folder with Wi-Fi off,** in Chrome and in Edge.
- [ ] **Step 3: In OpenBoard, check the `.wgt`.**
  - Drag the `.wgt` onto a page and check the stage, narration, quiz and "Ricomincia".
  - Save the OpenBoard document, close it, reopen it, and check that the widget is still there and works.
- [ ] **Step 4: Optional, if the user has access to them.** Try SMART Notebook's Internet browser object and ActivInspire's embedded browser pointing at the `.html`. Only record the results; do not promise support.
- [ ] **Step 5: Write `docs/export.md`, D27 and the dev-setup lines,** then commit: `git commit -m "docs: lesson export (D27), test results"`
