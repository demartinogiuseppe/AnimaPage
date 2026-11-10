# Lesson export (D27)

Export, part 1: a lesson becomes one offline `.html` file or an OpenBoard widget (`.wgt`). A teacher can keep it, reuse it with another class and pass it to colleagues.

- Design: [superpowers/specs/2026-11-09-export-design.md](superpowers/specs/2026-11-09-export-design.md)
- Plan: [superpowers/plans/2026-11-09-export-interactive.md](superpowers/plans/2026-11-09-export-interactive.md)
- Decision: D27 in [decisions.md](decisions.md)

Parts 2 (MP4 video) and 3 (whiteboard pages: `.iwb`/PDF) are not built yet. Each needs its own design.

## How to export

1. Open a lesson in the app: an example scene, an archive lesson, or a complete lesson just generated. The menu is not offered on the chapter-1 preview until the rest of the lesson has arrived.
2. In the top bar, choose **Export** → **Interactive lesson (.html)** or **Widget for OpenBoard (.wgt)**. The UI shows these labels in the user's language; the Italian ones are "Esporta", "Lezione interattiva (.html)" and "Widget per OpenBoard (.wgt)".
3. The status line shows the file name and size. Above 30 MB it adds a warning (`SIZE_WARN_BYTES`).

Archive lessons need the AnimaPage server, because their art images and geodata come from `/cache/`. With the server down the menu says so instead of producing a broken file. Example scenes export without the server.

## What the file contains

- **The prebuilt export runtime.** This is the player and all 17 engines in one IIFE bundle with no code splitting (`export/runtime.js`, about 1.9 MB). Its CSS (`export/runtime.css`, about 370 kB) carries the KaTeX fonts as woff2 only.
- **The lesson itself:** the SceneSpec, the UI catalog in the language used at export, the presentation seen at export (pop-up book or Academic), and the app version. All of this goes in a `<script type="application/json" id="pv-export">` payload.
- **Every asset the lesson references**, base64-encoded: models, geo grids, art images and the sounds it uses. Discovery is `assetsOf(spec)` in `packages/engine/src/export/assets.ts`.
- **Never included:** the page photo, other lessons, keys, server config, the user's settings beyond the UI language.

The `.wgt` is a stored (uncompressed) zip with `config.xml` and the same `index.html` (`apps/web/src/export/wgt.ts`).

Typical size: 3–3.6 MB. The largest reference scene is about 7 MB.

## Behaviour of an exported lesson

- It works with no network: the 3D stage, narration with the browser voice, sounds, labels, quizzes, Predict → Try → Prove, stamps, guided tour, KaTeX, and ⏮/⏭ to change chapter.
- Videos and source links stay, marked as needing the internet. Nothing is fetched until the user clicks one.
- **Stamps and progress persist** in that browser's local storage, keyed by lesson. The **Start over** button asks for confirmation, then clears this lesson's stamps and answers for the next class. A file copied to another PC starts with no stamps.
- **The presentation is locked** to the one seen at export. There is no switch in the file.
- **AR is hidden,** because WebXR needs HTTPS and a local file cannot provide it.
- **The file is frozen.** It carries its own player, so later app updates do not change or break it.

## Developer notes

- **The runtime build.**
  - The `pv-export-runtime` Vite plugin (`apps/web/vite.config.ts`) builds the runtime into `fixtures/public/export/` (git-ignored). It runs once at the start of each `vite` / `vite build` process.
  - It is built only at start, so after changing player or engine code, restart `pnpm dev:web`. Otherwise new exports carry the old runtime.
  - To build it by hand: `pnpm --filter @pv/web export-runtime`.
- **`pnpm export:e2e`** (`apps/web/scripts/export-e2e.ts`) exports every reference scene and opens each file from `file://` in headless Chrome with the network blocked.
  - It checks for no requests, a non-blank stage, chapter switching, a quiz answer and a Predict → Try → Prove step, no console errors, and that the page fits the window.
  - It also covers one `.wgt`, a `ja` catalog and one Academic lesson.
  - It takes an optional name filter as its argument.
- **The runtime marker.** `collectExport` checks that the fetched runtime starts with the marker `/*! AnimaPage export runtime */`. This prevents the Vite SPA fallback (`index.html`) from being packed as if it were the runtime.

## What was tested, and where

| Check | Where | Result |
|---|---|---|
| `pnpm test` | this PC | 853 passed, 5 skipped |
| `pnpm export:e2e`, all reference scenes | headless Chrome, network blocked | 36 passed |
| Export through the real menu: `scienze-sensi` (pop-up book, with an activity) and `matematica-parabola` (maths with formulas) as `.html` + `.wgt` | running app, 2026-11-09 | 3.0–3.1 MB each |
| Offline layout at 1280×800 and 1024×720 | Chrome, `file://` | ready, no scrollbars, 0 network requests, 0 page errors |
| Driven like a teacher, offline: Predict → Try → Prove and stamp, voice starts (Web Speech, "Microsoft Cosimo", it-IT), quiz feedback, ⏮/⏭, stamps survive a reload, Start over shows its confirmation, clears the stamps and stays cleared after a reload | Chrome and Edge (Windows 10), `file://`, 2026-11-09, scripted with playwright-core | all pass, both lessons, both browsers |

**Still to check by hand:**

- **OpenBoard 1.7.7** (installed on the dev PC; it uses Qt WebEngine 6.9.1, Chromium-based). Drag the `.wgt` onto a page, then check:
  - the stage, the voice, a quiz, the stamp and Start over;
  - after saving, closing and reopening, whether the widget is still there and keeps its stamps.

  The main risk is that Qt WebEngine offers no speech-synthesis voices. In that case the lesson shows subtitles only, with the "voice unavailable" note.
- In Chrome and Edge, the **audible voice and the smoothness of the 3D animation**. Also the browser warnings shown when downloading or opening the file.
- **Optional:** the built-in browser object of SMART Notebook or ActivInspire pointing at the `.html`. This only gets recorded; no support is promised.

## Known limits

- The runtime is rebuilt only at dev-server start (see above).
- The layout was checked at 1280×800 and 1024×720. At 1024 px the stage toolbar wraps over the Predict card header. This is the same in the app, not specific to export.
- The widget has no icon.
- The version stamp is the web package version (`0.1.0`) for now.
- Asset fetches during export are sequential, which is slow for lessons with many `/cache` assets.
- One-chapter lessons still reserve the two arrow slots in the timeline.
- The AR arrows keep their own logic.
- There are no PageUp/PageDown shortcuts for presenter remotes.
