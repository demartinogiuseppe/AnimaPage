# Manual theatre — Plan A (engine, warnings, check, hand-written lessons) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `manual` theatre ("Manuale") that turns a page of a technical manual into a sober line-drawn lesson — what the apparatus is, what it is for, how it works, where it can hurt you — with the manual's part numbers, enforced warnings, a fixed legal notice and the final check "Sai riconoscerla?", proven on four hand-written dev scenes.

**Architecture:** A zod grammar in `@pv/scene-spec` (parts from a kit, motions, flows, hazards, controls, per-chapter roles and acts) is staged by `packages/engine/src/engines/manual/`: parametric kit parts drawn with façade-style line materials (paper, inverted-hull silhouette, creases, hatched cut faces), each part in its own transform so it can move, explode and be cut. Everything the stage shows is a pure function of (chapter, t). Warnings, part numbers and the legal notice are drawn by the player through three new optional, engine-agnostic hooks (`tags`, `notices`, `mustRead`); the check reuses the storybook touch machinery (`Engine.tap`/`play`/`choose`/`animate`, `TouchPlayPanel`, `MarkLayer`, `TapDetector`). No AI integration (the generator comes later, in the shared recording batch).

**Tech Stack:** TypeScript strict, zod 4, three.js 0.187, vitest + happy-dom, pnpm 9 monorepo (`@pv/*`), playwright-core with system Chrome for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-10-manual-theatre-design.md` (approved; binding). Closest model: the façade theatre — `docs/superpowers/specs/2026-11-09-facade-theatre-design.md`, `docs/facade.md`, `packages/engine/src/engines/facade/`. Read the spec and `docs/facade.md` before Task 1.

## Before you start

- **This plan runs only after `feature/storybook-theatre` has been merged into `main`.** It builds on that branch's `Engine.tap/animate/wobble/play/choose`, `TouchPlayView`, `player/tap.ts`, `player/touch-play-ui.ts` and the play wiring in `player/player.ts`. Task 1 Step 1 verifies this and stops the plan if it is not so.
- Work in a new worktree `../wt-manual-theatre` (a sibling of the repository folder) on branch `feature/manual-theatre`, created from `main` after that merge (superpowers:using-git-worktrees). `pnpm install`, then `pnpm test` for the baseline (all green).
- `fix/player-act-card` (`restrictsLabels`, `--pv-hud-h`) may or may not be in `main`: do not depend on it. If it lands in `main` during this plan, merge `main` before Task 6 (both touch `player.ts`) and run `pnpm test`.
- Commands from the worktree root: one file `pnpm vitest run <path>`; types `pnpm typecheck`; everything `pnpm test`. Dev app: `pnpm dev:web`, lesson at `http://localhost:5173/?scene=<name>`.
- Visual sign-offs: the controller takes the screenshots (playwright script in the scratchpad, Chrome, 1280×800 and 390×844), sends them to the user and **stops until the user approves**; requested changes are folded into that task.
- Load the skill `andrej-karpathy-skills:karpathy-guidelines` before writing code (standing user rule).

## Global Constraints

- The architecture stays: the AI writes a declarative SceneSpec, the engine stages it; `Engine.update(chapterId, t)` is a pure function of (chapterId, t): no accumulated state, no `Math.random`. Session state (the check's progress, a flash after a tap) lives outside `update` and is applied in `animate(now)`, as in the storybook.
- No live LLM calls. Do not edit `ANALYSIS_ENGINES` (`packages/scene-spec/src/analysis.ts`), `server/src/analyze/prompt.ts`, `server/src/generate/guides/*`, `server/src/generate/example.ts`, or anything under `fixtures/llm` (the generator is the later recording batch, D16/D26).
- Do not change the shared schemas in `packages/scene-spec/src/common.ts`. New player behaviour comes through optional `Engine` hooks in `packages/engine/src/types.ts`; existing engines and saved lessons behave exactly as before.
- Generation schema budget: 30,000 characters (`server/src/generate/schema.ts`); `server/test/generate.test.ts` "schema dedupe is lossless and fits" runs for every `EngineId`, `manual` included from Task 1, and stays green. Keep schema descriptions short.
- App text only through the i18n catalogues `packages/scene-spec/src/i18n/messages/{it,en,de,es,fr,pt}.ts` (key parity test). Code, comments and technical docs in English. Files LF (`git ls-files --eol`).
- Lesson texts of the dev scenes are original (invented apparatus, own numbering); no copied manual text or drawing, no manufacturer names, logos or trademarks.
- Lines on paper as in `facade`; colour only for meaning: flows (water/fluid blue, heat orange, current yellow, motion grey, air light blue), hazard zones (level colour), the highlighted part (teal, never red). Same look in Colori and China (`userData.inkSelf`); sober type, nothing cartoonish.
- Warning levels fixed: `danger` PERICOLO red, `warning` ATTENZIONE amber, `note` NOTA blue; never colour alone (level word and shape always shown); text contrast ≥ 4.5:1. Warnings are never hidden by the labels setting, never in a folded card, always read by the voice.
- The legal notice is an i18n key rendered by the player for every `manual` lesson; it is not part of SceneSpec. It works in the exported `.html`/`.wgt` (D27), offline.
- No invented values: dev scenes state missing values in the narration ("La pagina non indica …: consulta il manuale.") and list them in `missing`.
- No new npm dependencies. Smooth on a school board PC and a mid-range phone (budget pinned in Task 9).
- Pop-up book (D12) and Accademico (D24) work as for every theatre.
- Never open `fixtures/pages`, `server/.env`, `server/data`, `apps/web/.cert`. One subagent at a time (standing user rule).

## Review Focus

1. **Picking what is drawn.** A tap through the cut-away half of a sectioned casing must reach the part behind it; a hidden part is never picked; an exploded part is picked where it is drawn, not at its rest position. Tests in Task 7.
2. **Warnings cannot be skipped.** During the guided tour or "Avanti da sola", seeking past a warning sentence, pausing in it or jumping to a later sentence must not let the player leave chapter 1 (alert) or the hazards chapter until every warning sentence has been spoken to its end; manual navigation by the chapter chips stays free. Tests in Task 6.
3. **Voice off or Web Speech unavailable.** User decision (2026-11-10, "Voce accesa anche per i manuali"): in a `manual` lesson the warning sentences (`mustRead`) are **spoken with the real voice even when the "Voce" switch is off**; the other sentences follow the switch. Only when no speech voice exists at all (Web Speech unavailable or failing) does the timer voice count as "spoken", so the tour does not hang. Warnings, tags and the legal notice always show. Test in Task 6.
4. **Linkage at its extremes.** The slider-crank at top and bottom dead centre and across many cycles yields finite, continuous poses (no NaN, no jump); a rod shorter than the crank throw is a check issue, never a crash. Tests in Task 1 and Task 4.
5. **Mixed and broken numbering.** Some parts with `num`, some without: lesson numbers start after the highest manual number and are marked as lesson numbers (with the "lesson numbering" notice); a duplicate `num` is reported by the checker. Tests in Task 1 and Task 3.

---

### Task 1: Preflight, manual grammar, checks and registration

**Files:**
- Create: `packages/scene-spec/src/engines/manual.ts`
- Modify: `packages/scene-spec/src/index.ts` (import/export, `EngineId` gets `"manual"` last, `SceneSpec` union, `checkScene` dispatch)
- Modify: `packages/scene-spec/test/smoke.test.ts` (EngineId list gets `"manual"` last)
- Modify: the six catalogues: `"theatre.manual"` after the last `theatre.*` key — it "Manuale", en "Manual", de "Handbuch", es "Manual", fr "Manuel", pt "Manual"
- Modify: `apps/web/src/archive.ts` (`THEATRES` gets `"manual"`; icon map entry, a one-path glyph of a gear with a page corner, e.g. `"M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"`)
- Create: `packages/engine/src/engines/manual/index.ts` (skeleton `createManualEngine()`: `build` stores the spec, `bounds()` = centre 0, radius 1, `resolveAnchor` false)
- Modify: `packages/engine/src/index.ts` (`case "manual"` in `createEngine`, lazy import as for `facade`)
- Test: `packages/scene-spec/test/manual.test.ts`

**Interfaces:**
- Produces (exported from `engines/manual.ts`, re-exported by the package): `MANUAL_KINDS`, `MANUAL_ROLES`, `MANUAL_MEDIA`, `MANUAL_LEVELS`, `MANUAL_MOTIONS`, `CONTROL_KINDS = ["knob", "button", "light", "display"]`; schemas and types `ManualPart`, `ManualMotion`, `ManualFlow`, `ManualHazard`, `ManualControl`, `ManualAct`, `ManualCheck`, `ManualChapter`, `ManualData`; `checkManualData(data: ManualData, scene: Pick<SceneBase, "chapters" | "sources">): Issue[]`; `lessonNumbers(parts: ManualPart[]): Map<string, { n: number; lesson: boolean }>` (every part gets a number: its `num`, else the next after the highest `num`, in array order, `lesson: true`).

The grammar (field names binding; every object `.strict()`; lengths in **millimetres**, angles in degrees, times in chapter seconds, fractions 0..1; `Id` as in `common.ts`):

```ts
MANUAL_KINDS = ["shaft","bearing","gear","pulley","belt","spring","seal","casing","impeller","stator","rotor","pipe","base",
  "cylinder","piston","rod","crank","valve","cam","spark-plug","drum","heater","filter","solenoid","knob","button","light","display"]
MANUAL_ROLES = ["what","purpose","how","hazards","steps","check"]
MANUAL_MEDIA = ["water","fluid","air","heat","current","motion"]
MANUAL_LEVELS = ["danger","warning","note"]
MANUAL_MOTIONS = ["rotate","slide","reciprocate","swing","flash","linkage"]
Vec3 = [number, number, number]
ManualPart = { id, num?: int 1..99 /* the manual's number; omit on text-only pages */, name, kind, size: Vec3 /* part-local box, each 0 < s <= 3000; main axis = local z */,
  at: Vec3 /* centre, apparatus space: y up, base on y = 0, front towards +z */, rot?: Vec3 /* Euler XYZ */, group?: Id /* assembly */,
  explode?: Vec3 /* offset at explode = 1 */, teeth?: int 6..120 /* gear */, blades?: int 2..16 /* impeller */,
  shape?: "box" | "cylinder" | "volute" /* casing, default box */, link?: [Id, Id] /* belt: its two pulleys */ }
ManualMotion = { id, part: Id /* part or group */, kind, axis: "x" | "y" | "z" /* part-local, default z */,
  amount?: number /* rotate and linkage: turns per cycle (default 1; linkage 2); slide/reciprocate: mm; swing: degrees */, phase?: 0..1, when?: [0..1, 0..1] /* active window in the cycle */,
  rod?: Id, piston?: Id, throw?: number /* linkage only: the crank is `part` */ }
ManualFlow = { id, medium, path: Id[2..12] /* parts, inlet to outlet */, when?: [0..1, 0..1] }
ManualHazard = { id, level, parts: Id[1..6], text /* what the card shows; the voice reads it, see warn */, sourceId?: Id }
ManualControl = { part: Id /* a knob, button, light or display */, label, does }
ManualAct = discriminatedUnion("do", [
  { do: "show" | "hide" /* two members */, ids: Id[] /* parts or groups */, at, dur?: number /* fade, default 1 */ },
  { do: "highlight", ids: Id[], at, until?: number },
  { do: "explode", to: 0..1, at, dur?: number /* default 2 */ },
  { do: "section", to: 0..1 /* 0 = closed, 1 = cut through the centre */, axis?: "x" | "y" | "z" /* default z: the front half goes */, parts?: Id[] /* default: every casing, cylinder, drum, pipe */, at, dur?: number /* default 2 */ },
  { do: "run", ids: Id[] /* motions and flows */, at, until?: number },
])
ManualCheck = { find: Id[3..4], path?: Id[2..8], order?: string[2..6] /* steps of use, from the page */ }
ManualChapter = { chapter: Id, role, show?: Id[] /* visible at t = 0, default all */, acts?: ManualAct[],
  cycle?: { period?: number 0.5..20 /* default 2 */, strokes?: Id /* part where the four stroke names show */ },
  alert?: int /* chapter 1 of a dangerous apparatus: index of the sentence "Apparato pericoloso: vedi capitolo N" */,
  warn?: Array<{ hazard: Id, sentence: int }> /* hazards chapter: who reads each warning */, check?: ManualCheck }
ManualData = { parts: ManualPart[1..40], motions?: [..16], flows?: [..8], hazards?: [..8], controls?: [..12], missing?: string[..8] /* values the page does not give */, chapters: ManualChapter[] }
```

`checkManualData` rules (readable issue, never a throw): one id space for parts, groups, motions, flows, hazards (duplicates; a group id equal to a part id); duplicate `num`; every reference exists (motion part/rod/piston, flow path, hazard parts and `sourceId` in `scene.sources`, control part, belt `link` to two pulleys, act ids of the right sort, `cycle.strokes`, check ids); `teeth`/`blades`/`shape`/`link` on another kind ("ignored"); a control on a kind outside `CONTROL_KINDS`; linkage without `rod`, `piston` or `throw`, or with rod length (distance between `piston.at` and `part.at`) ≤ `throw` (message contains `"shorter than the throw"`); a `when` window with from ≥ to; act times beyond the chapter's `duration`; every scene chapter has exactly one entry; the first entry has role `what`; at most one `check` chapter, it is the last, it has `check`, and `check` appears nowhere else; check needs exactly one of `path` / `order`; find/path ids distinct; a chapter with `activity` (message contains `"uses the check"`).
**Hazard rules** (spec "Settled" 2): hazards not empty ⇒ exactly one `hazards` chapter; the first chapter has `alert`; every hazard is in that chapter's `warn` exactly once; `warn`/`alert` sentence indices exist; the warn sentence's `text` contains the hazard `text` (case-insensitive, whitespace collapsed); a warn/alert sentence has no `speech`. Hazards empty ⇒ no `hazards` chapter, no `alert`, no `warn`.

- [ ] **Step 1: Preflight — the storybook merge is in.** In the worktree on `main`'s tip: `git log --oneline main | grep -i storybook` shows the merge; `grep -n "tap?(\|play?(\|choose?(\|animate?(\|interface TouchPlayView" packages/engine/src/types.ts` finds all five; `packages/engine/src/player/tap.ts` exports `TapDetector`, `TapSoundLimiter`; `packages/engine/src/player/touch-play-ui.ts` exports `TouchPlayPanel`, `MarkLayer`; `packages/engine/src/engines/storybook/play.ts` exports `PLAY_SLACK`; `"storybook"` is in `EngineId`. Expected: all present. **If any is missing, stop the plan and report to the user.** Record the next free decision id in `docs/decisions.md` (expected D30, D29 being the storybook).
- [ ] **Step 2: Write the failing tests** in `packages/scene-spec/test/manual.test.ts`, with a helper `pump()` returning a valid four-chapter pump (parts volute casing, impeller with 6 blades, shaft, motor casing, stator, rotor; one rotate motion; one water flow; one danger hazard on the shaft; chapters what (with `alert` 1), purpose, how, hazards (warn on sentence 0, whose text contains the hazard text)) and `scene(data, chapters)` wrapping it in a minimal scene (shape as in `smoke.test.ts`):
  - `"parses a valid pump and finds no issues"`: parse ok; `checkManualData` and `checkScene(SceneSpec.parse(...))` equal `[]`.
  - `"lessonNumbers keeps manual numbers and numbers the rest after the highest"`: nums `[2, undefined, 5, undefined]` → `2, 6 (lesson), 5, 7 (lesson)`.
  - One test per rule above, each asserting exactly one issue whose message is readable: e.g. `"reports a duplicate num"`, `"reports a rod shorter than the throw"` (Review Focus 4), `"reports hazards without a hazards chapter"`, `"reports a dangerous apparatus without the chapter-1 alert"`, `"reports a hazard nobody reads"`, `"reports a warn sentence that does not contain the hazard text"`, `"reports a warn sentence with speech"`, `"reports a hazards chapter without hazards"`, `"reports a check that is not the last chapter"`, `"reports a check with both path and order"`, `"reports an activity in a manual chapter"`, `"reports an act after the chapter ends"`, `"reports a control on a gear"`, `"reports teeth on a shaft"`.
  - `"rejects 41 parts, 7 order steps and 2 find targets at parse time"`.
- [ ] **Step 3: Run** `pnpm vitest run packages/scene-spec/test/manual.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `engines/manual.ts` (header comment in the style of `engines/facade.ts`: purpose, units, apparatus space, kit axis convention, entity anchors `{ entity: <part or group id> | "apparatus", part?: "top" | "tag" }`), the registrations listed under Files and the skeleton engine.
- [ ] **Step 5: Run** the test file and `packages/scene-spec/test/smoke.test.ts`, then `pnpm test` — Expected: all PASS, including `"manual: schema dedupe is lossless and fits"` and the i18n key parity test. If the budget fails, shorten descriptions before touching structure.
- [ ] **Step 6: Commit** `git commit -m "feat(manual): grammar, checks and registration of the manual theatre"`.

---

### Task 2: Line ink and kit, part 1 (rotating machinery)

**Files:**
- Create: `packages/engine/src/engines/manual/ink.ts`
- Create: `packages/engine/src/engines/manual/kit/machinery.ts` (shaft, bearing, gear, pulley, belt, spring, seal, casing, impeller, stator, rotor, pipe, base)
- Create: `packages/engine/src/engines/manual/kit/index.ts` (`kitGeometry` dispatch)
- Create: `packages/engine/src/player/notices.ts` (only `LEVEL_COLORS` in this task; Task 6 adds the card)
- Test: `packages/engine/test/manual-kit.test.ts`

**Interfaces:**
- Produces in `player/notices.ts`: `LEVEL_COLORS = { danger: { bg: "#b3261e", fg: "#ffffff" }, warning: { bg: "#f2a900", fg: "#1f1a14" }, note: { bg: "#1d4f91", fg: "#ffffff" } } as const` (starting values; the Task 6 sign-off may change them).
- Produces in `manual/ink.ts`:
  - `MANUAL_COLORS = { ink: FACADE_LINE.ink, paper: FACADE_LINE.paper, highlight: 0x0f766e, water: 0x2f6fb5, fluid: 0x2f6fb5, air: 0x8fb7d4, heat: 0xd9822b, current: 0xd8b400, motion: 0x8a8f96 }` (import `FACADE_LINE` read-only from `../facade/ink.ts`; level tints from `LEVEL_COLORS`). The one place for colours.
  - `class ManualInk { paper(cut: boolean): THREE.ShaderMaterial; hull: THREE.ShaderMaterial; lines: THREE.ShaderMaterial; tinted(base: THREE.ShaderMaterial, color: number | null, alpha: number): THREE.ShaderMaterial; setSection(worldPlane: THREE.Plane | null): void; setResolution(width: number, height: number, pixelRatio: number): void; dispose(): void }`
  - The shaders follow `facade/ink.ts` (paper front faces, inverted-hull silhouette with `polygonOffset`, crease lines, `clipping: true` with the clipping chunks so the page-edge planes still work). Two differences, both decisions: (1) the section test uses the **world** position (`modelMatrix * vec4(position, 1.0)`), because manual parts move; only `paper(true)` and the line/hull materials of cut parts test it. (2) Cut faces (back faces of cut parts) are **hatched**, not flat poché: 45° screen-space lines, `HATCH_PX = 7` spacing × pixel ratio, ink colour at `fineAlpha` on paper. `tinted` returns a copy sharing every uniform but `uTint`/`uAlpha` (as `FacadeInk.fadeOf`), cached per (base, colour).
- Produces in `kit/index.ts`: `kitGeometry(part: ManualPart): THREE.BufferGeometry` — part-local millimetres, centred on the origin, filling the `size` box, main axis local z, deterministic, non-indexed or indexed but always with normals. Every hollow kind (casing, pipe; later cylinder, drum) is **one closed solid with real wall thickness** (`WALL = 0.06 × min(size.x, size.y)`), no coplanar opposite-facing contacts (the façade rule in `docs/facade.md` "Section and plan").
- Shapes in a word each (the implementer chooses the profile within the box): shaft = cylinder with a keyway line; bearing = two rings with a ball line; gear = spur gear with `teeth` (default 24) trapezoid teeth; pulley = V-groove disc; belt = flat loop tangent to its `link` pulleys (built in Task 3 from their positions; here a loop for a given centre distance and two radii); spring = helix tube (6 turns); seal = thin ring with a lip; casing = box / cylinder / volute (spiral casing with outlet nozzle on +x); impeller = hub + `blades` (default 6) curved blades between two shrouds; stator = laminated ring with winding bumps; rotor = cylinder with skewed bar lines; pipe = straight tube; base = plinth with four bolt holes.

- [ ] **Step 1: Write the failing tests** in `manual-kit.test.ts`, looping over the 13 kinds with a typical size: `"<kind> fills its size box"` (bounding box within `size` ± 1 %, at least one axis touching ± 1 %), `"<kind> is deterministic"` (two builds have equal position arrays), `"<kind> has normals and no NaN"`. Plus `"a gear has as many teeth as asked"` (count local maxima of the radius along the rim: 24), `"an impeller has as many blades as asked"`, `"a casing is hollow and closed"` (a ray along x through the centre of a box and of a cylinder casing hits exactly 4 faces), `"a volute has its outlet on +x"`, `"the cut material hatches back faces"` (fragment source of `paper(true)` contains the hatch term and `gl_FrontFacing`; `paper(false)` has no section test), `"setSection(null) cuts nothing"` (uniform plane far away, as `FacadeInk`), `"tinted shares the section uniform"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/manual-kit.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `ink.ts`, `kit/machinery.ts`, `kit/index.ts`, `LEVEL_COLORS`.
- [ ] **Step 4: Run** the file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(manual): line ink with hatched cuts; kit part 1 (machinery)"`.

---

### Task 3: Assembly, numbering, chapter state and the kit table — **visual sign-off**

**Files:**
- Create: `packages/engine/src/engines/manual/model.ts` (parts to groups of inked meshes)
- Create: `packages/engine/src/engines/manual/state.ts` (pure state at (chapter, t))
- Modify: `packages/engine/src/engines/manual/index.ts` (the real engine)
- Create: `fixtures/public/scenes/_dev-manuale-kit.scene.json` (one chapter "kit": every kind of part 1 on a grid, lesson-numbered, named)
- Create: `fixtures/public/scenes/_dev-manuale-pompa.scene.json` (chapter "cos-e" only for now: an invented electric centrifugal pump in the spirit of the mockup — manual numbers 1–6 for the main parts, the rest lesson-numbered)
- Test: `packages/engine/test/manual-state.test.ts`, `packages/engine/test/manual.test.ts`

**Interfaces:**
- Consumes: Task 1 grammar and `lessonNumbers`; Task 2 `ManualInk`, `kitGeometry`.
- Produces in `state.ts`: `interface ManualState { visible: Map<string, number> /* part → alpha 0..1 */; highlight: Set<string>; explode: number; section: { axis: "x" | "y" | "z"; to: number; parts: Set<string> } | null; running: Map<string, number> /* motion or flow id → seconds since its run began, clamped at `until` */ }` and `manualStateAt(data: ManualData, chapterId: string, t: number): ManualState`. Group ids expand to their parts. Explode and section blend from the previous value with `ease` over `dur` (the façade view-transition model); a value before the first act is 0 / null.
- Produces in `model.ts`: `buildModel(data: ManualData, ink: ManualInk): ManualModel` with `ManualModel = { group: THREE.Group /* apparatus space, mm scaled to root units */; parts: Map<string, PartNode>; scale: number }`, `PartNode = { part: ManualPart; pivot: THREE.Group /* at + rot */; body: THREE.Group /* moved by motions */; meshes: THREE.Mesh[] }`. One scale for the whole lesson: the apparatus box's largest side fits `MANUAL_FIT = 6` root units. Groups marked `userData.inkSelf = true`. Belts are built here from their `link` pulleys.
- Engine (in `index.ts`): `build`, `update` (applies `manualStateAt`: visibility/fade, highlight tint, explode offsets `explode × part.explode`, `ink.setSection` from the apparatus-space plane — set in the paper meshes' `onBeforeRender` from the apparatus group's `matrixWorld`, so fit and AR moves never lag a frame), `resolveAnchor` (`{ entity: partOrGroupId | "apparatus", part?: "top" | "tag", offset? }` at the part's current, exploded position; `"tag"` = top of the part's box pushed outward from the apparatus centre by 0.15 root units), `anchorShown` (false while the part is hidden), `bounds`, `dispose`. Camera: the chapters' own camera keys with entity targets (no `Engine.view` in v1; `distance` in root units, as documented for `facade`).

- [ ] **Step 1: Write the failing tests.**
  - `manual-state.test.ts`: `"show and hide fade over dur"`; `"a group id shows all its parts"`; `"explode eases from the previous value"` (at the act's `at` = previous, at `at + dur` = `to`, monotonic between); `"section defaults to the hollow kinds"`; `"run clamps at until"`; `"state at t is the same reached from 0 or from later"` (call at 9, 2, 9 → deep-equal; Global Constraint purity).
  - `manual.test.ts` (engine, built in happy-dom without a renderer, as `facade.test.ts` does): `"one scale for the lesson: the largest side is MANUAL_FIT"`; `"an exploded part's anchor moves with it"`; `"a hidden part's anchor is not shown"`; `"tag anchors sit outside the part"`; `"_dev-manuale-kit parses, checks clean and builds"`; `"_dev-manuale-pompa parses, checks clean and builds"`; `"every chapter updates from 0 to its duration in 0.5 s steps without throwing"`.
  - Review Focus 5 in `manual.test.ts`: `"mixed numbering: lesson numbers follow the highest manual number"` on the pump scene (parts without `num` get 7, 8, … and are flagged `lesson`).
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement** `state.ts`, `model.ts`, the engine and the two dev scenes (texts original, Italian, STE-like: short sentences, one action per sentence, the same word for the same thing).
- [ ] **Step 4: Run** both files, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Visual sign-off — the line look and the kit.** Screenshots of `?scene=_dev-manuale-kit` (front and three-quarters) and `?scene=_dev-manuale-pompa` chapter 1, in Colori and China, pop-up and Accademico. Send to the user with a one-line note per kind. **Stop until the user approves the look**; fold changes (line weights, hatch spacing, colours in `MANUAL_COLORS`) into this task.
- [ ] **Step 6: Commit** `git commit -m "feat(manual): assembly, numbering, chapter state; kit and pump dev scenes"`.

---

### Task 4: Motions, cycles and flows

**Files:**
- Create: `packages/engine/src/engines/manual/motion.ts`
- Create: `packages/engine/src/engines/manual/flows.ts`
- Modify: `packages/engine/src/engines/manual/index.ts`, `state.ts`
- Modify: `fixtures/public/scenes/_dev-manuale-pompa.scene.json` (chapters "a-cosa-serve": water from a low tank to a high one; "come-funziona": section of the volute, impeller and rotor turning, water flow, explode of the motor)
- Test: `packages/engine/test/manual-motion.test.ts`

**Interfaces:**
- Produces in `motion.ts` (all pure):
  - `cyclePhase(seconds: number, period: number): number` in [0, 1).
  - `motionPose(m: ManualMotion, seconds: number, period: number): { angle: number /* rad about axis */; shift: number /* mm along axis */; glow: number /* 0..1 */ }` — rotate: `angle = 2π × amount × seconds / period` (phase-shifted); reciprocate: `shift = amount/2 × sin(2π(cycle + phase))`; swing: `angle = amount° × sin(...)`; slide: raised-cosine bump of height `amount` inside `when` (default the whole cycle), 0 outside; flash: `glow` 1 inside `when`, 0 outside, with a 0.05-cycle fade.
  - `linkagePose(throwMm: number, rodMm: number, crankAngle: number): { pistonShift: number; rodAngle: number }` — exact slider-crank: `pistonShift = throw·cos θ + √(rod² − throw²·sin² θ) − rod` (0 at top dead centre), `rodAngle = asin(throw·sin θ / rod)`.
  - `STROKES = ["intake", "compression", "power", "exhaust"] as const`; `strokeAt(cycle: number): (typeof STROKES)[number]` (quarters, intake from phase 0).
- Produces in `flows.ts`: `class FlowLine { constructor(medium: ManualFlow["medium"], ink: ManualInk); setPoints(points: THREE.Vector3[]): void; setTime(seconds: number, on: number /* 0..1 */): void; object: THREE.Object3D; dispose(): void }` — a polyline through the current centres of its path parts, drawn as moving chevron dashes (dash offset = `FLOW_SPEED` × seconds, `FLOW_SPEED = 1.2` root units/s), colour from `MANUAL_COLORS[medium]`, always on top of paper (depthTest off, drawn after the parts) but clipped by the page planes.
- Engine: a running motion poses its part's `body` (a group motion poses every part of the group about the first part's axis); `linkage` turns the crank (`amount` turns per cycle, default 2 for a four-stroke cycle), and poses `piston` along its local z and `rod` from its small end; a flow is drawn while running and inside its `when` window, with `on` fading over 0.1 cycle. The chapter's `cycle.period` (default 2 s) drives all of them. With `cycle.strokes`, the stroke name is exposed for Task 6's tags (`strokeAt`), nothing drawn yet.

- [ ] **Step 1: Write the failing tests** in `manual-motion.test.ts`: `"rotate turns amount times per cycle"`; `"phase shifts reciprocate by a fraction of the cycle"`; `"slide is zero outside its window and peaks in the middle"`; `"flash is on only inside its window"`; Review Focus 4: `"linkage at top and bottom dead centre"` (θ = 0 → shift 0, θ = π → shift −2·throw, rodAngle 0 both) and `"linkage stays finite and continuous over 50 cycles"` (sample every 1°, no NaN, consecutive shifts differ by < throw × 0.02); `"strokeAt returns the four strokes in order"`; `"a flow is drawn only while running and inside when"`; `"flow points follow exploded parts"`; `"poses at t are the same reached from 0 or from later"`.
- [ ] **Step 2: Run** the file — Expected: FAIL.
- [ ] **Step 3: Implement** `motion.ts`, `flows.ts`, the engine wiring and the two pump chapters.
- [ ] **Step 4: Run** the file and `packages/engine/test/manual.test.ts`, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: See it.** Play the pump chapters 2–3 in the app; three screenshots (tanks with the flow, the section with the turning impeller, the exploded motor) for the reviewer.
- [ ] **Step 6: Commit** `git commit -m "feat(manual): motions with cycle and phase, slider-crank, flows"`.

---

### Task 5: Kit, part 2 (combustion engine and household appliance)

**Files:**
- Create: `packages/engine/src/engines/manual/kit/engine.ts` (cylinder, piston, rod, crank, valve, cam, spark-plug)
- Create: `packages/engine/src/engines/manual/kit/appliance.ts` (drum, heater, filter, solenoid, knob, button, light, display)
- Modify: `packages/engine/src/engines/manual/kit/index.ts`, `fixtures/public/scenes/_dev-manuale-kit.scene.json` (a second row with the 15 new kinds)
- Test: `packages/engine/test/manual-kit.test.ts`

**Interfaces:**
- Consumes: Task 2 `kitGeometry` contract (box, axis z, deterministic, hollow kinds closed with wall thickness).
- Shapes: cylinder = finned barrel with head, bore along z, hollow (cut by default); piston = crown, skirt and ring lines, pin bore on x; rod = I-section bar between a small and a big eye along z (the eyes at z = ±size.z/2 − eye radius, so the linkage poses it from its small eye); crank = shaft with two webs and a crank pin offset by size.y/4 (the linkage `throw` is independent data; the check in Task 1 keeps rod > throw); valve = poppet with stem along z; cam = egg-shaped lobe on a shaft; spark-plug = hex, insulator, electrode; drum = perforated hollow cylinder (hole lines, not real holes) with lifters, cut by default; heater = U-tube element; filter = ribbed cylinder with a cap; solenoid = valve body with coil box; knob = disc with a pointer line; button = round cap in a bezel; light = small dome; display = flat rectangle with a bezel and three segment-digit lines (no text).

- [ ] **Step 1: Write the failing tests**: extend the per-kind loop of `manual-kit.test.ts` to all 28 kinds (fills box, deterministic, normals, no NaN); add `"cylinder and drum are hollow and closed"` (ray count 4), `"the rod's small eye is at +z"`, `"a knob's pointer marks its rotation"` (the pointer line lies on +y).
- [ ] **Step 2: Run** the file — Expected: FAIL for the new kinds.
- [ ] **Step 3: Implement** the two files and the kit table row.
- [ ] **Step 4: Run** the file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: See it.** Screenshot the kit table (both rows) and send it to the user as information (the stop is Task 9's).
- [ ] **Step 6: Commit** `git commit -m "feat(manual): kit part 2 — combustion engine and appliance parts"`.

---

### Task 6: Tags, warnings, legal notice and the read-before-leaving rule — **visual sign-off**

**Files:**
- Modify: `packages/engine/src/types.ts` (types and hooks below)
- Modify: `packages/engine/src/player/notices.ts` (`NoticeCard`)
- Modify: `packages/engine/src/player/touch-play-ui.ts` (`MarkLayer.set` accepts an optional `kind` per mark: class `pv-tag-<kind>`; storybook calls unchanged)
- Modify: `packages/engine/src/player/playback.ts` (`onSpoken`)
- Modify: `packages/engine/src/player/player.ts` (tag layer, notice card, legal notice, read rule)
- Modify: `packages/engine/src/player/styles.ts` (tags, notices, `.pv-legal`)
- Modify: `packages/engine/src/engines/manual/index.ts` (`tags`, `notices`, `mustRead`)
- Modify: the six catalogues (keys below)
- Modify: `fixtures/public/scenes/_dev-manuale-pompa.scene.json` (chapter 1 `alert`; chapter "pericoli": danger on the turning shaft and fan, warning on the hot motor casing, note on dry running; each warning read by its sentence)
- Test: `packages/engine/test/player-manual.test.ts`, `packages/engine/test/player-playback.test.ts`, `packages/engine/test/touch-play-ui.test.ts`, `packages/engine/test/manual.test.ts`

**Interfaces:**
- Produces in `types.ts`:

```ts
export interface EngineTag { id: string; anchor: Anchor; text: string; kind: "num" | "lesson-num" | "danger" | "warning" | "note" | "label" }
export interface EngineNotice { level: "danger" | "warning" | "note" | "info"; text: string; parts?: string; on?: boolean }
// on Engine, all optional and pure in (chapterId, t):
tags?(chapterId: string, t: number): readonly EngineTag[];   // drawn over the stage; the labels setting never applies
notices?(chapterId: string, t: number): readonly EngineNotice[]; // the warning card; never folded
mustRead?(chapterId: string): readonly number[];             // sentences the tour and "Avanti da sola" wait for
```

- `Playback` event `onSpoken?(i: number): void`: fired when the voice's end callback for sentence `i` arrives for the current speak (not after `silence()`/seek/pause). `TimerTts` counts.
- Player: a second `MarkLayer` (`pv-tags`, resolver = `stage.resolveWorld(tag.anchor, ...)`) fed by `engine.tags` every frame (gated like the pin labels until the content stands on the page); a `NoticeCard` (`<section class="pv-card pv-notices" aria-live="polite">`, each item: shape glyph + level word + parts + text; `on` item emphasised; never a `<details>`) placed first in the side panel's chapter content; for `spec.engine === "manual"` a `<p class="pv-legal" role="note">` with `t("manual.legal")`, first child of the panel, `position: sticky; top: 0`, outside the stage element. Read rule: a per-chapter-visit `spoken: Set<number>` (reset in `go`); in `onEnd`, before the activity and play checks, when `tour || autoNext` and some `mustRead` index is not spoken, `playback.jumpTo(first unspoken)` instead of advancing.
- Engine: `tags` = one per visible part, text = its number (+ `" " + name` except in the check chapter, where only numbers show), kind `num` / `lesson-num`, or the hazard level for parts of a hazard in the hazards chapter (the hazard zone is tinted with the level colour there); with `cycle.strokes`, a `label` tag at that part's side with `t("manual.stroke.<name>")`. `notices` = chapter 1 with `alert`: one `danger` item with the alert sentence's text, whole chapter; hazards chapter: every hazard from t = 0, ordered as `warn`, `parts` = their numbers ("2, 3"), `on` while its sentence is the current one; every chapter: one `info` item `t("manual.lessonNumbers")` when any part has a lesson number. `mustRead` = `[alert]` in chapter 1, the `warn` sentences in the hazards chapter, else `[]`.
- i18n keys (six languages, implementer drafts, the user reviews `manual.legal` in Task 10): `manual.legal` (substance from spec Goal 6: a teaching schematic based on a manual page; does not replace the manufacturer's manual, nor the company's training and safety procedures; always follow the original manual before operating), `manual.lessonNumbers` ("Numerazione della lezione, non del manuale"), `manual.level.danger` / `.warning` / `.note` (PERICOLO, ATTENZIONE, NOTA; en DANGER, WARNING, NOTE; de GEFAHR, WARNUNG, HINWEIS; es PELIGRO, ADVERTENCIA, NOTA; fr DANGER, AVERTISSEMENT, REMARQUE; pt PERIGO, ATENÇÃO, NOTA), `manual.stroke.intake` / `.compression` / `.power` / `.exhaust`, `manual.notices` (card title "Avvertenze").

- [ ] **Step 1: Write the failing tests.**
  - `player-playback.test.ts`: `"onSpoken fires when the voice ends a sentence"`, `"no onSpoken for a sentence cut by seek or pause"`.
  - `touch-play-ui.test.ts`: `"a mark with a kind gets its class"`; existing storybook mark tests unchanged.
  - `player-manual.test.ts` (happy-dom, a fake engine with `tags`/`notices`/`mustRead` in the style of `player-storybook-play.test.ts`): `"a manual lesson shows the legal notice outside the stage and not folded"`; `"other engines show no legal notice"`; `"the notice card is a section and lists level word and text"`; `"labels set to none keep tags and notices visible"`; Review Focus 2: `"the tour replays an unspoken warning instead of moving on"` (seek past sentence 1, let the chapter end → `jumpTo(1)`, no chapter change), `"a pause inside a warning leaves it unspoken"`, `"chapter chips still move freely"`; Review Focus 3: `"with TimerTts the tour moves on once the warnings have run"`; user decision: `"with Voce off, a manual lesson still speaks its mustRead sentences with the real voice and only those"`, `"with no speech voice at all, the timer counts and the tour moves on"`.
  - `manual.test.ts`: `"tags carry manual and lesson numbers; hazards chapter tags carry the level"`, `"check chapter tags show numbers only"`, `"notices: alert in chapter 1, every warning from the start of the hazards chapter, the current one on"`, `"mustRead lists alert and warn sentences"`, `"stroke label follows the cycle"`.
  - Contrast (in `player-manual.test.ts`): `"level colours have text contrast of at least 4.5"` (WCAG relative luminance on `LEVEL_COLORS`).
- [ ] **Step 2: Run** the four files — Expected: FAIL.
- [ ] **Step 3: Implement** in the order types → playback → MarkLayer kind → NoticeCard → player wiring → engine hooks → catalogues → pump hazards chapter.
- [ ] **Step 4: Run** the four files, then `pnpm test` — Expected: PASS (all storybook player tests unchanged).
- [ ] **Step 5: Visual sign-off — warnings and legal notice.** Screenshots of the pump's chapter 1 (alert line) and hazards chapter (tinted zones, level tags, card, a warning `on`), desktop and phone (390×844), pop-up and Accademico, Colori and China. **Stop until the user approves the placement of the legal notice and of the warnings**; fold changes in.
- [ ] **Step 6: Commit** `git commit -m "feat(manual): part tags, warning card, legal notice; tour waits for spoken warnings"`.

---

### Task 7: The check logic, picking and touchable controls

**Files:**
- Create: `packages/engine/src/engines/manual/check.ts` (pure run of "Sai riconoscerla?")
- Create: `packages/engine/src/engines/manual/pick.ts`
- Modify: `packages/engine/src/types.ts` (tap result gains `card?`; `TouchPlayView` additions below)
- Modify: `packages/engine/src/engines/manual/index.ts` (`tap`, `play`, `choose`, `animate`)
- Modify: the six catalogues (keys below)
- Test: `packages/engine/test/manual-check.test.ts`, `packages/engine/test/manual-pick.test.ts`

**Interfaces:**
- Produces in `types.ts` (optional additions; storybook unaffected): tap result `{ sound?: string; complete?: boolean; card?: { title: string; text: string } }`; `TouchPlayView.kind` gains `"check"`; `stamp` becomes optional (`stamp?: string`: absent = no stamp, the panel says `t("manual.check.done")`); new optional fields `title?: string`, `options?: readonly { text: string; done?: string /* its number once placed */ }[]`, `feedback?: { ok: boolean; text: string }`, `voice?: { id: number; text: string }` (the player speaks `text` once per new `id`). Update the storybook engine and any test that builds a `TouchPlayView` only if the type change requires it.
- Produces in `pick.ts`: `pickPart(model: ManualModel, state: ManualState, ray: THREE.Ray /* root-local */): string | null` — raycast against the visible parts' meshes at their current poses; skips hits on parts with alpha < 0.5; for a cut part, skips hit points on the removed side of the section plane and keeps looking along the ray; nearest remaining hit wins.
- Produces in `check.ts`: `class CheckRun { constructor(check: ManualCheck, data: ManualData, numbers: Map<string, { n: number; lesson: boolean }>); tap(partId: string | null): CheckStep; choose(k: number): CheckStep; view(): TouchPlayView; readonly complete: boolean }` with `CheckStep = { result: "good" | "wrong" | "ignore"; flash?: string /* part to flash: the right answer */; say: string }`.
  - Stages in order: **find** (one target at a time, prompt `t("manual.check.find", { name })` "Tocca: {name}"), then **path** (touch in order, numbered marks 1, 2, …; prompt "Tocca in ordine i pezzi da cui passa il flusso, dall'ingresso all'uscita") **or** **order** (the `order` steps as `options` in a fixed shuffled order — a deterministic permutation that is never the identity — touched in order), then **hazards** when the scene has hazards (touch each hazard zone; a found zone repeats its warning in `say`: level word + text). Progress counts every item of every stage.
  - A mistake never counts: `result: "wrong"`, `feedback` with the right answer and a short reason (`manual.check.wrongFind` "Questo è {got} ({gotNum}). {name} è il numero {num}: lampeggia."; `manual.check.wrongPath` "Non ancora: dopo {prev} viene {next}."; `manual.check.wrongStep` "Prima viene: «{step}»."; `manual.check.noHazard` "Qui non c'è un pericolo segnalato. Ne mancano {n}."), `flash` the right part (or the next unfound hazard's first part); the same item stays open, so the operator retries. A tap on nothing is `ignore`. No marks or scores; complete = `manual.check.done` "Fatto".
  - Also keys `manual.check.title` ("Sai riconoscerla?"), `manual.check.path`, `manual.check.steps`, `manual.check.hazards`.
- Engine: the check is live from `duration - PLAY_SLACK` (import from `../storybook/play.ts`) of the check chapter, like the storybook play. `tap(chapterId, t, ray, now)`: `pickPart` on the state at (chapterId, t); while the check is live → `CheckRun.tap`, start a 1.2 s flash of `flash` (applied in `animate(now)` as a highlight-colour pulse on top of `update`), return `{ complete }`; otherwise, a hit on a control part → `{ card: { title: label, text: does } }`; otherwise `null`. `play(chapterId)` returns the run's view (same object until something changes), `null` outside the check chapter; `choose` forwards to `CheckRun.choose`. One `CheckRun` per lesson session, never saved or exported.

- [ ] **Step 1: Write the failing tests.**
  - `manual-check.test.ts` on the pump data: `"find asks one part at a time and counts only the right one"`; `"a wrong find flashes the right part and explains"` (feedback contains the right number); `"path must be touched in order and gets numbered marks"`; `"order shows the steps shuffled, never in the right order, and accepts them in order"`; `"hazards stage only when the scene has hazards"`; `"a found hazard repeats its warning"`; `"complete says Fatto and has no stamp"`; `"voice id changes with every new prompt or feedback"`; `"ignore on a tap that hit nothing"`.
  - `manual-pick.test.ts` (engine built in happy-dom): Review Focus 1 — `"a tap through the cut-away half reaches the impeller behind"`, `"a hidden part is never picked"`, `"an exploded part is picked where it is drawn"` (ray at the exploded position hits, ray at the rest position does not).
  - In `manual.test.ts`: `"a control tap returns its card outside the check"`, `"the check takes the taps once live"`, `"play is null outside the check chapter"`.
- [ ] **Step 2: Run** the three files — Expected: FAIL.
- [ ] **Step 3: Implement** `pick.ts`, `check.ts`, the type additions, the engine hooks, the keys.
- [ ] **Step 4: Run** the files and the storybook tests (`pnpm vitest run packages/engine/test/storybook-play.test.ts packages/engine/test/player-storybook-play.test.ts`), then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(manual): the check Sai riconoscerla?, picking what is drawn, touchable controls"`.

---

### Task 8: The check in the player — **visual sign-off**

**Files:**
- Modify: `packages/engine/src/player/touch-play-ui.ts` (`TouchPlayPanel`: `title`, `feedback`, `options` as buttons calling `hooks.choose(k)`, complete without stamp shows `t("manual.check.done")`; `kind "check"` gets the sober `pv-play-check` class — no bounce, no confetti, the app's plain type)
- Modify: `packages/engine/src/player/player.ts` (speak `view.voice` once per id through `say`; a tap result with `card` opens the info card and speaks `title. text` as `onPin` does; no stamp awarded or listed when `view.stamp` is absent: `renderStamps` lists only chapters whose play has a stamp, `playWaits` = not complete and not (stamped and `stamps.has`), `playDone` adds a stamp only when there is one)
- Modify: `packages/engine/src/player/styles.ts`
- Modify: `fixtures/public/scenes/_dev-manuale-pompa.scene.json` (control-free pump; chapter "verifica" with `find` 3 parts, `path` inlet pipe → impeller → volute → outlet pipe)
- Test: `packages/engine/test/touch-play-ui.test.ts`, `packages/engine/test/player-manual.test.ts`

**Interfaces:**
- Consumes: Task 7 `TouchPlayView` additions and tap result `card`; Task 6 test helpers.

- [ ] **Step 1: Write the failing tests.**
  - `touch-play-ui.test.ts`: `"a check view shows title, prompt, feedback and progress"`; `"options are buttons that choose their index and show their number once done"`; `"a complete view without stamp says Fatto and draws no stamp"`; storybook panel tests unchanged.
  - `player-manual.test.ts` (fake engine): `"the player speaks a new voice id once"` (same id twice → one `speak`); `"a tap card opens the info card and speaks"`; `"no stamp is stored or listed for a stampless play"`; `"the tour waits for the check to complete, then ends"`.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement** the panel, the player wiring, the styles and the pump's check chapter.
- [ ] **Step 4: Run** both files and all `player-*.test.ts`, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Visual sign-off — the check panel.** Play the pump's "verifica" in the app (voice on): screenshots of a find prompt, a mistake (feedback + flashing part), the path with numbered marks, the hazard stage, "Fatto"; desktop and phone, pop-up and Accademico. **Stop until the user approves the panel**; fold changes in.
- [ ] **Step 6: Commit** `git commit -m "feat(manual): the check panel in the player, sober and stampless; control cards"`.

---

### Task 9: Washing machine, gearbox and four-stroke engine; performance budget — **visual sign-off**

**Files:**
- Create: `fixtures/public/scenes/_dev-manuale-lavatrice.scene.json` — washing machine with own numbering (some `num`): drum, tub, belt and pulleys, motor, heater (heat flow), solenoid valve and pump (water in and out), drain filter, springs; a "come-funziona" chapter for the drum and water, a second one for the **control panel** (knob, start button, door light, display as `controls`); hazards (electric: danger; hot water and door glass: warning; drain filter water: note); check with `path` (solenoid → drum → pump → drain).
- Create: `fixtures/public/scenes/_dev-manuale-riduttore.scene.json` — a two-stage spur gearbox, **text-only page** (no `num`: the lesson numbers and says so), no hazards (exercises the safe path: no alert, no hazards chapter, no hazard stage), motion flow from input to output shaft, one value missing in `missing` and said in the narration, a short "passi" (role `steps`) maintenance chapter, check with `order` (4 steps of use from the invented page).
- Create: `fixtures/public/scenes/_dev-manuale-motore4t.scene.json` — single-cylinder four-stroke engine of a lawn mower: cylinder with head, piston, rod, crank (`linkage`, 2 turns per cycle), intake and exhaust valves with cams (`slide` in `when` [0, 0.25] and [0.75, 1]), spark plug (`flash` at 0.5), flywheel, air filter, muffler (casing cylinder); the four-stroke chapter with `cycle { period: 4, strokes: cylinder }`, mixture (air) and exhaust gases (heat) flows in their windows; hazards (hot muffler: warning; turning flywheel: danger; fuel: note); check with `path` (air filter → intake valve → cylinder → exhaust valve → muffler).
- Test: `packages/engine/test/manual.test.ts`

**Interfaces:**
- Consumes: everything above. Scene shape (meta, sources with an invented manual page as the source, chapters with narration, camera keys on part entities) copied from the pump scene. Texts original, Italian, STE-like; the warning before the step it concerns; no invented values.

- [ ] **Step 1: Write the failing tests** (one `describe` per scene, pump included): parses; `checkScene` equals `[]`; the engine builds; every chapter updates 0 → duration in 0.5 s steps without throwing; every pin and camera anchor resolves at mid-chapter; `mustRead` and `notices` as the scene implies (gearbox: none but the `info` lesson-number notice). Performance budget: `"each dev scene stays within the draw budget"` — at most 160 meshes + line objects and 250,000 triangles in the built group (count by traversal).
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/manual.test.ts` — Expected: FAIL (scenes missing).
- [ ] **Step 3: Write the three scenes**; fix engine bugs they reveal in the owning file, with a test there.
- [ ] **Step 4: Run** the file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Frame-rate check.** In Chrome with 4× CPU throttling (DevTools protocol `Emulation.setCPUThrottlingRate`) at 390×844, play the four-stroke chapter and the washing machine's water chapter for 10 s each: median frame time ≤ 33 ms. Record the numbers for the reviewer.
- [ ] **Step 6: Visual sign-off — the four dev scenes.** Play each scene as an operator would (voice on, guided tour, check done) in pop-up and Accademico, Colori and China, desktop and phone; one screenshot per chapter, sent to the user with a line per scene on what is simplified. **Stop until the user approves**; fold changes in.
- [ ] **Step 7: Commit** `git commit -m "feat(manual): washing machine, gearbox and four-stroke engine dev scenes; draw budget"`.

---

### Task 10: Export check, docs, decision and the legal wording review

**Files:**
- Modify: `apps/web/scripts/export-e2e.ts` (for `engine === "manual"` scenes: `.pv-legal` visible and non-empty, and the notice card present in the hazards chapter of the pump)
- Create: `docs/manual.md` (developer notes in the shape of `docs/facade.md`: grammar summary, units and apparatus space, kit map by file, colours in `MANUAL_COLORS` / `LEVEL_COLORS`, the section and hatching rule, motions and the slider-crank, the hooks `tags`/`notices`/`mustRead`, the check, how to add a kit part, the dev scenes, not in v1)
- Modify: `docs/decisions.md` (row **D30 "Manual theatre"**, or the id found in Task 1: engine `manual` for user/maintenance manual pages, lines with colour for meaning, lesson structure, enforced warnings and the fixed legal notice, numbering rule, the check reusing the storybook touch machinery, generator in the shared recording batch)
- Modify: the six catalogues only if the user changes the legal wording

- [ ] **Step 1: Export check.** `pnpm export:e2e manuale` — Expected: every `_dev-manuale-*` export (and the `.wgt`) passes offline, legal notice found. Then `pnpm export:e2e` (all scenes) — Expected: pass.
- [ ] **Step 2: Write** `docs/manual.md` and the decision row.
- [ ] **Step 3: Legal wording review.** Send the user `manual.legal` in all six languages (and `manual.lessonNumbers`, the level words) as plain text. **Stop until the user approves the wording**; apply changes to the catalogues only (no layout change).
- [ ] **Step 4: Run** `pnpm test` and `git ls-files --eol | grep -v "i/lf"` on the new files — Expected: all PASS, all LF.
- [ ] **Step 5: Commit** `git commit -m "docs(manual): D30, developer notes; export check of the manual lessons"`.
