# Lesson export: design

Date: 2026-11-09. Status: reviewed by a builder check; user questions answered; awaiting approval. Decision record: will become D27 in `docs/decisions.md` once approved.

## Intent

A teacher wants an AnimaPage lesson to become **their own teaching material**:
- put it among the pages of the classroom interactive whiteboard (LIM);
- save it;
- reopen it with another class;
- share it with colleagues.

The teacher may prepare the lesson at home, or create it in class by photographing the page. The app already covers the in-class case: chapter 1 appears after about 1.5 min while the teacher introduces the topic. Export covers the "keep, reuse and share" part.

Italian schools run several whiteboard programs:
- SMART Notebook and Promethean ActivInspire, each locked to its own brand;
- OpenBoard: free, open source, works on any board, increasingly used;
- vendor apps on the new Android interactive monitors bought with PNRR Scuola 4.0 money, for example BenQ EZWrite and ViewSonic myViewBoard. They import PDF, Office files and `.iwb`.

No single format carries a full interactive 3D lesson into all of them. The user therefore decided on **two families of output, side by side**:
- an **interactive** one that keeps everything;
- a **portable** one that works on every board.

## The whole feature (three parts, built in this order)

All formats end up side by side in one "Esporta" menu in the lesson. Each part gets its own design and plan. This document details **Part 1** only; Parts 2 and 3 are summarised so the builder knows what Part 1 must not block.

1. **Interactive lesson**: one self-contained `.html` file, plus the same lesson packaged as an **OpenBoard widget** (`.wgt`). Detailed below.
2. **Video** (later design):
   - one MP4 per chapter, plus one MP4 of the whole lesson;
   - the video shows the animations, the narration and the labels at their cue times;
   - quizzes appear as the question, then a pause of a few seconds, then the answer.

   The browser voice (Web Speech) cannot be recorded, so the video needs a local offline TTS. This is our call: probably Piper, which is open source and has Italian voices. The same recording mode serves a possible YouTube channel.
3. **Whiteboard pages** (later design):
   - files in `.iwb` (IWB Common File Format) and PDF, maybe PPTX;
   - one page per chapter, with that chapter's video clip, the labels and the narration text;
   - quiz pages where the answer is hidden under a shape the teacher drags away (the classic LIM "tendina");
   - a QR code or link to the interactive version.

## Part 1: the interactive export

### Goals

- In any lesson open in the app, an "Esporta" menu offers **"Lezione interattiva (.html)"** and **"Widget per OpenBoard (.wgt)"**. This covers:
  - an archive lesson;
  - an example scene;
  - a complete lesson just generated (not the chapter-1 preview while the rest is still being generated).
- The `.html` file is **self-contained**:
  - it opens with a double-click from a USB stick or a folder (`file://`) in Chrome or Edge on the Windows PC of a LIM;
  - it needs no network, no AnimaPage server and no installation.
- **The lesson works as it does in the app:**
  - all chapters and the 3D stage;
  - narration with the browser voice, sound effects, labels and pins;
  - quizzes and Predict → Try → Prove with sliders, stamps and the guided tour;
  - formulas (KaTeX), in whichever presentation was exported (see below);
  - themes, and the sources and credits as shown in the app.
- **The file contains only what this lesson needs:**
  - the player and the engine code: one prebuilt runtime with all engines, which is simpler and about 3 MB (plan call);
  - the SceneSpec;
  - the assets this lesson references (models, geo grids, art images, sounds, KaTeX fonts if used);
  - the UI strings in the language the user had when exporting.
- **The `.wgt`** wraps the same HTML as a W3C widget (`config.xml`, `index.html`, icon, zipped) following the OpenBoard documentation, so that:
  - a teacher can drag it into OpenBoard;
  - it is saved inside their OpenBoard document;
  - it keeps working offline.
- The file name is taken from the lesson title, for example `battaglia-di-canne.html`.
- **Stamps and progress (user decision, 2026-11-09):**
  - they stay saved between openings, so a teacher can pick the lesson up again;
  - the exported file has a clearly labelled **"Ricomincia"** button that clears the stamps and progress of this lesson, for the next class;
  - storage is that browser's local storage, keyed by lesson, in both `.html` and `.wgt`. No account is involved, and nothing is written into the OpenBoard document;
  - a file copied to a colleague starts with no stamps on their PC.
- **Presentation (user decision, 2026-11-09):** the file is locked to the presentation (pop-up book or Accademico) that the exporting user saw at export time. The file has no switch for it, and it needs only that presentation's code and fonts. The existing in-player switches (labels, sounds, theme) stay.

### Non-goals

- Editing a lesson before or after export.
- Hosting or publishing lessons online, share links, accounts, a shared library among teachers. Sharing means passing the file.
- Native SMART (`.notebook`) or ActivInspire (`.flipchart`) files. For those programs, the interactive route is their built-in browser object pointing at the `.html` file. Whether their embedded browsers load a local file and run WebGL is unknown; Part 1 only documents what was tested and does not promise it.
- AR (WebXR needs HTTPS; a local file cannot provide it): hide the AR button in exported files.
- LMS packages (SCORM, LTI): maybe later, separate.
- Anything from Parts 2 and 3.

### Anti-goals (failures even if it "works")

- **The exported file silently needs the internet.** This includes fetching a CDN, Wikipedia, Wikimedia images or the AnimaPage server at runtime. With the network off, everything must still work.
- **The file leaks anything beyond this lesson:**
  - the page photo;
  - other lessons or the archive;
  - the ledger, keys or server config;
  - the user's email or settings beyond the UI language.
- **The file breaks when the app is updated later.** The file must be frozen and independent: it carries its own player code, not a reference to the installed app.
- **Files too big to pass around.** Report the size in the UI. Aim for a typical lesson in the low megabytes, and warn above ~30 MB.
- **Copyright problems:**
  - only content the lesson already shows goes in (paraphrased text, public-domain art, attributed CC sources);
  - the page photo never goes in.

### Constraints

- Existing stack: pnpm monorepo, TypeScript strict, Vite, three.js, vitest, playwright-core. Build on the current player (`packages/engine/src/player/player.ts`), not a second implementation.
- **Player hooks the builder can use:**
  - `PlayerOptions.assetBase`, `audio` and `stamps` exist today;
  - stage assets are loaded through one `loadAsset(path)` function inside `player.ts` (around line 534);
  - sounds load through `WebAudioOut` (`player/audio/webaudio.ts`).
- **Engines are loaded with dynamic `import()`** (`packages/engine/src/index.ts`). A single file opened from `file://` cannot load further chunks, so the export bundle must be inlined.
- **No live LLM calls** are needed or allowed for this feature. Mock mode remains the default.
- **Work rules (repository `CLAUDE.md`):**
  - code and technical docs in English, app texts in Italian, through the i18n catalog;
  - one agent at a time;
  - keys never leave `server/.env`.
- No new dependencies unless they are small and clearly needed, for example a tiny zip writer. Name any you add in the plan.

### What the user decided

- Keep **both** an interactive export and a portable export, side by side.
- The full list of formats is: interactive HTML, OpenBoard widget, MP4 video (whole lesson and per chapter), and whiteboard pages (`.iwb`, PDF, maybe PPTX) with video per chapter, quizzes with hidden answers and a QR code to the interactive version.
- Build order: interactive, then video, then whiteboard pages.
- The goal is reuse in other classes and sharing with colleagues.

### Our calls (open to correction)

- **Assembly in the browser, not on the server.** The app ships a prebuilt "export player": one JS bundle with no code splitting, built by a separate Vite build entry. To export, the app fetches that template and the scene's assets, inlines them, and offers the result as a download (Blob). This works for example scenes and archive lessons alike, and in the installed PWA. If the builder finds a server endpoint clearly simpler, they may switch, giving the reason in the plan.
- **Assets are inlined into the HTML.** Binary assets go in as base64 or similar, and the player's `loadAsset` and sound loading read from that embedded map instead of `fetch`. Add the smallest hook to `PlayerOptions` that allows this.
- **Asset discovery is a pure function**, `assetsOf(spec)`, that lists every asset path and sound id a SceneSpec references, with unit tests per engine.
- **Two languages in the file:**
  - the exported file carries the UI catalog the user had at export time;
  - the lesson content keeps its own language (`SceneSpec.lang`).
- **Videos and source links stay, as online-only extras.**
  - The lesson's video section (YouTube or Wikimedia Commons players, loaded on click) and the links to sources stay in the file, marked in the UI as needing the internet, for example "serve internet".
  - Nothing is fetched until the user clicks one, and with the network off the click fails gracefully.
  - The videos themselves are not embedded, because they are not ours to redistribute.
  - The offline check therefore means: no network request unless the user clicks a video or a source link.
- **Exporting needs the AnimaPage server for archive lessons.** Their art images and geodata are served from `/cache/art/` and `/cache/geo/`, which the service worker does not cache. Exporting an archive lesson while the server is unreachable shows a clear message instead of producing a broken file. Example scenes (static assets) export without the server.
- **The voice in the exported file** is the browser voice, as in the app. If the LIM PC has no voice for the lesson language, the existing "voice unavailable" behaviour applies.

### Verification (definition of done)

1. Unit tests for `assetsOf` covering every engine type in `fixtures/public/scenes/`.
2. **An automated end-to-end check with playwright-core.** Export every reference scene, open each file from `file://` with the network blocked, and assert:
   - no network requests;
   - the stage renders (non-blank screenshot);
   - chapters switch;
   - a quiz answer and a Predict → Try → Prove step work;
   - no console errors.
3. The `.wgt` is a valid zip with `config.xml` and `index.html`, and its `index.html` passes the same checks.
4. **A manual check in a real OpenBoard install on this PC, done with the user.** Installing OpenBoard needs the user's OK first. Record the results, and any SMART or ActivInspire findings, in `docs/dev-setup.md` or a new `docs/export.md`.
5. `pnpm test` stays green (today: 811 passed, 5 skipped).

### Left to the builder

- **Build tooling:**
  - how to build the inlined export bundle;
  - a Vite library or single-file build;
  - how CSS and fonts are inlined.
- Zip writing for `.wgt`.
- Where exactly the "Esporta" entry sits in the player UI, its wording and its progress and size feedback, within the app's existing style and i18n.
- Asset encoding details and size optimisations.
- How the export player is versioned (e.g. the app version stamped in the file).
