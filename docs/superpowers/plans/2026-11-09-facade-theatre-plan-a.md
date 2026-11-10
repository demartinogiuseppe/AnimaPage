# Façade theatre — Plan A (engine, views, hand-written lessons) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `facade` theatre that draws building façades with lines only, from a compact grammar, in five views (prospetto, assonometria, prospettiva centrale, sezione, pianta) with animated camera moves, including a rotunda with its dome (the Pantheon), chapter actions and a "move the eye" activity, proven on two hand-written reference lessons.

**Architecture:** A zod grammar in `@pv/scene-spec` (buildings made of floors and bays, one building per chapter) is turned by the engine into building-local geometry (metres) from a catalogue of parametric elements, drawn by custom line materials (paper with grey poché, screen-space silhouette, crease lines) that the China styler leaves alone. The engine drives the camera through a new optional `Engine.view()` hook that the stage honours instead of the chapter camera keys. No AI integration in this plan (Plan B).

**Tech Stack:** TypeScript strict, zod 4, three.js 0.187, vitest + happy-dom, pnpm 9 monorepo (`@pv/*`), playwright-core with system Chrome for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-09-facade-theatre-design.md`. Visual and technique reference: `docs/superpowers/specs/assets/2026-11-09-facade-spike.html` (throwaway spike: paper/poché shader, inverted-hull silhouette, moulding profiles `prof()`, one-point perspective with lens shift). Read both before Task 1.

## Before you start

- Work in a separate git worktree (e.g. `wt-facade-theatre`, next to the main checkout) (branch `feature/facade-theatre`). Run `pnpm install` once there, then `pnpm test` to record the baseline (all green).
- Commands (from the worktree root): one test file `pnpm vitest run <path>`; type check `pnpm typecheck`; everything `pnpm test` (typecheck + vitest).
- **Before Task 5** (it edits `player/stage.ts`): if `feature/export-interactive` has been merged into `main`, merge `main` into this branch first (`git merge main`), run `pnpm test`, then start Task 5. If it has not been merged yet, go on; Task 9 step "export check" waits for it.
- Load the skill `andrej-karpathy-skills:karpathy-guidelines` before writing code (standing user rule).

## Global Constraints

- Lines only: paper-white surfaces, dark fine lines, muted red overlays; the same look in the Colori and China styles.
- Engine `update(chapterId, t)` must be a pure function of (chapterId, t) and the slider overrides: no accumulated state, no `Math.random`.
- No live LLM calls. Do not edit `ANALYSIS_ENGINES` (`packages/scene-spec/src/analysis.ts`), `server/src/analyze/prompt.ts`, `server/src/generate/guides/*`, `server/src/generate/example.ts` or any recorded fixture under `fixtures/llm` (Plan B, D16/D26).
- The façade engine data must fit the generation schema budget of 30,000 characters (`server/src/generate/schema.ts:26`); `server/test/generate.test.ts` "schema dedupe is lossless and fits" runs for every `EngineId` and must stay green.
- `art` and its architecture kit stay untouched (saved lessons depend on it).
- No new npm dependencies (three.js already provides `ExtrudeGeometry`, `LatheGeometry`, `EdgesGeometry`, and `mergeGeometries` in `three/examples/jsm/utils/BufferGeometryUtils.js`).
- Code, comments and technical docs in English; app text in Italian, through the i18n catalogues (`packages/scene-spec/src/i18n/messages/{it,en,de,es,fr,pt}.ts`, key parity test) except `EngineParam.label`, which is Italian by contract.
- Files LF (`git ls-files --eol`).
- Reference buildings are public domain (centuries old); narration is written in our own words, facts checked against the sources listed in the scene.
- Smooth on a school board PC and a mid-range phone: a 3-floor, 7-bay façade with balusters and dentils must not drop frames.
- One subagent at a time (standing user rule).

## Review Focus

1. Grammar at the edges (1 bay, 15 bays, a 6-floor building, a cell as wide as its bay): schema/check report issues instead of crashing; the engine builds whatever passes the checks. Tests in Task 1 and Task 3.
2. Upper floor wider than the floor below, a colonnade with pilasters instead of columns, a crown over bays that do not exist: a check issue with a readable message, never a throw. Tests in Task 1.
3. Scrubbing the timeline backwards across view changes, draw and cut acts: the scene at t must be identical whether reached from 0 or from a later t. Test in Task 6.
4. "Prova" sliders at their extremes (eye at 0.5 m or at the building top, eye at the façade edge): no NaN, horizon and vanishing-point marker stay on the building, depth lines stay inside the page. Tests in Task 5 and Task 6.
5. A narrow portrait stage (aspect 0.5) and docked cards: the prospetto still shows the whole façade; the perspective keeps the vanishing point on screen. Tests in Task 5.

---

### Task 1: Façade grammar, checks and registration

**Files:**
- Create: `packages/scene-spec/src/engines/facade.ts`
- Modify: `packages/scene-spec/src/index.ts` (export, `EngineId` at :54, `SceneSpec` union at :56-73, `checkScene` dispatch at :76-93)
- Modify: `packages/scene-spec/test/smoke.test.ts:34` (EngineId list gets `"facade"` at the end)
- Modify: `packages/scene-spec/src/i18n/messages/{it,en,de,es,fr,pt}.ts` (key `"theatre.facade"`, after `"theatre.solid"`): it "Facciata", en "Façade", de "Fassade", es "Fachada", fr "Façade", pt "Fachada"
- Modify: `apps/web/src/archive.ts:40` (`THEATRES` gets `"facade"`) and the icon map at :57 (add `facade:` a one-path glyph of a pedimented front, e.g. `"M3 20h18M5 20v-9h14v9M4 11l8-6 8 6M8 20v-6h3v6M13 14h3v3h-3z"`)
- Create: `packages/engine/src/engines/facade/index.ts` (skeleton: `createFacadeEngine()` whose `build` stores the spec and does nothing else, `bounds()` returns `{ center: (0,0,0), radius: 1 }`, `resolveAnchor` returns false)
- Modify: `packages/engine/src/index.ts` (`case "facade"` in `createEngine`)
- Test: `packages/scene-spec/test/facade.test.ts`

**Interfaces:**
- Produces (all exported from `packages/scene-spec/src/engines/facade.ts`, re-exported by the package):
  - `FACADE_STYLES = ["classical", "renaissance", "baroque", "temple", "romanesque"] as const`
  - `FACADE_ORDERS = ["tuscan", "doric", "ionic", "corinthian", "composite"] as const`
  - `FACADE_VIEWS = ["prospetto", "assonometria", "prospettiva", "sezione"] as const`, type `FacadeViewName`
  - `FACADE_PARAMS = ["eye-height", "eye-x"] as const`
  - `FACADE_ENTITIES = ["building", "floor", "bay", "member", "vanishing-point", "horizon"] as const`
  - zod schemas and types `FacadeCell`, `FacadeMember`, `FacadeBay`, `FacadeFloor`, `FacadeCrown`, `FacadeBuilding`, `FacadeViewKey`, `FacadeAct`, `FacadeChapter`, `FacadeData`
  - `floorLayout(floor: FacadeFloor): { width: number; bays: Array<{ id: string; x0: number; x1: number; cx: number; forward: number }> }` — bays left to right, centred on x = 0, `width` = sum of bay widths
  - `buildingSize(b: FacadeBuilding): { width: number; height: number }` — width of the widest floor; height = base + floors + crown (pediment/gable height = half crown width × tan(pitch); attic/balustrade = their `height`)
  - `checkFacadeData(data: FacadeData, scene: Pick<SceneBase, "chapters">): Issue[]` (same `Issue` shape as `checkSolidData`)

The grammar (field names are binding; units metres, times chapter seconds; every object `.strict()`; keep descriptions short — they go into the generation schema later):

```ts
Pediment = z.enum(["triangular", "segmental"])
FacadeCell = z.discriminatedUnion("el", [
  { el: "wall" },
  { el: "arch", open?: boolean /* default true = passage; false = blind arch */, archivolt?: "voussoirs" | "moulded" /* default "moulded" */, keystone?: boolean, spring?: number /* springing height above floor, default 0.55 × floor height */ },
  { el: "portal", w, h, top?: "flat" | "round", pediment?: Pediment, splay?: int 0..4 /* nested receding arches (Romanesque) */ },
  { el: "window", w, h, sill /* height above floor */, top?: "flat" | "round", mullion?: boolean /* bifora */, pediment?: Pediment, corbels?: boolean, balustrade?: boolean },
  { el: "niche", w, h, sill },
  { el: "oculus", r, y /* centre height above floor */ },
  { el: "panel", w, h, sill },
  { el: "gallery", columns: int 2..12, h, sill /* Romanesque loggetta: small arches on colonnettes */ },
])
FacadeMember = { type: "pilaster" | "half-column" | "column" | "pier", order?: FacadeOrder /* required unless pier */, width, paired?: boolean, rusticated?: boolean }
FacadeBay = { id, width /* axis-to-axis span */, cell: FacadeCell, forward?: number 0..3 /* avant-corps */ }
FacadeFloor = { id, height, bays: FacadeBay[1..15], members?: FacadeMember /* between bays and at both ends */, wall?: "smooth" | "rusticated", course?: number /* rustication course, default 0.5 */, top?: "string-course" | "entablature" | "none", cornice?: "plain" | "dentils" | "modillions", portico?: { depth, vault?: "barrel" | "segmental" }, colonnade?: { depth } /* free-standing members in front (temple front) */, shoulders?: "volutes" | "slopes" /* transition from the wider floor below */ }
FacadeCrown = { type: "pediment" | "attic" | "balustrade" | "gable", shape?: Pediment, bays?: [Id, Id] /* first and last bay of the top floor, default all */, height?: number, pitch?: number 10..40 /* degrees, default 22 */ }
FacadeBuilding = { id, name /* Italian */, style: FacadeStyle, base?: { height, steps?: int 0..8 }, floors: FacadeFloor[1..6] /* bottom to top */, crown?: FacadeCrown, depth?: number /* body behind, default min(0.8 × width, 20) */ }
FacadeViewKey = { at, view: FacadeViewName, dur?: number /* default 2 */ }
FacadeAct = z.discriminatedUnion("do", [
  { do: "draw", target: Id /* building, floor or bay id, "crown" or "base" */, at, dur?: number /* default 3 */ },
  { do: "highlight", target: Id /* floor or bay id, "<floorId>.members", "crown", "base" */, at, until?: number },
  { do: "cut", bay: Id, at, dur?: number /* default 2 */ },
  { do: "eye", at, dur?: number /* default 2 */, height?: number, x?: number },
])
FacadeChapter = { chapter: Id, building: Id, views?: FacadeViewKey[], acts?: FacadeAct[], eye?: { height?: number /* default 1.6 */, x?: number /* default 0 */, distance?: number /* default 1.2 × building width */ } }
FacadeData = { buildings: FacadeBuilding[1..4], chapters: FacadeChapter[] }
```

Lengths: positive; `w`, `h`, `width`, `height`, `depth` ≤ 120 m; `r` ≤ 10.

- [ ] **Step 1: Write the failing tests** in `packages/scene-spec/test/facade.test.ts`. Use a helper `palazzo()` returning a valid 2-floor, 3-bay building (ground: 3 open arches on rusticated piers, string course; first floor: 3 windows with triangular pediments, ionic pilasters, entablature with dentils; crown balustrade) and `scene(data)` wrapping it in a minimal one-chapter scene (copy the minimal scene shape used in `packages/scene-spec/test/smoke.test.ts`).
  - `"parses a valid palazzo and finds no issues"`: `FacadeData.parse(...)` succeeds; `checkFacadeData(...)` equals `[]`; `checkScene(SceneSpec.parse(scene(...)))` equals `[]`.
  - `"floorLayout centres the bays"`: bay widths `[4, 5, 4]` → `width` 13, first `x0` −6.5, last `x1` 6.5, middle `cx` 0.
  - `"buildingSize adds base, floors and a pediment"`: base 1 + floors 6 and 5, triangular pediment over width 13 at pitch 22 → height ≈ 12 + 6.5 × tan(22°) (`toBeCloseTo`, 3 digits).
  - `"reports a window taller than its floor"`: issue path ends with `cell` and message contains `"taller than the floor"`.
  - `"reports a cell wider than its bay minus the members"`: message contains `"wider than the bay"`.
  - `"reports an upper floor wider than the one below"`: message contains `"wider than the floor below"` (tolerance 1 %).
  - `"reports a colonnade without columns"`, `"reports an order missing on a pilaster"`, `"reports a crown over unknown bays"`, `"reports an unknown building in a chapter"`, `"reports an act after the chapter ends"`, `"reports an unknown act target"`, `"reports a test param that is not eye-height or eye-x"`, `"reports duplicate floor or bay ids inside a building"`, `"reports a pin on an unknown bay"`: each exactly one issue with a readable message.
  - Review Focus 1: `"accepts a 1-bay and a 15-bay floor"` and `"rejects 16 bays and 7 floors at parse time"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/scene-spec/test/facade.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `packages/scene-spec/src/engines/facade.ts` (schemas with `superRefine` for in-object rules such as unique ids, as in `engines/solid.ts`; cross-scene rules in `checkFacadeData`, as `checkSolidData` does), plus the registrations listed under Files. Header comment in the style of `engines/solid.ts`: purpose, units, layout convention (façade plane x–y facing +z, x = 0 on the axis, y = 0 at the ground, front face at z = 0, body towards −z), entity anchors.
- [ ] **Step 4: Run** `pnpm vitest run packages/scene-spec/test/facade.test.ts packages/scene-spec/test/smoke.test.ts`, then `pnpm test` — Expected: all PASS, including `server/test/generate.test.ts` "facade: schema dedupe is lossless and fits" and the i18n key parity test.
- [ ] **Step 5: Commit** `git commit -m "feat(facade): grammar, checks and registration of the façade theatre"`.

---

### Task 2: Line-drawing kit and styler opt-out

**Files:**
- Create: `packages/engine/src/engines/facade/ink.ts`
- Create: `packages/engine/src/engines/facade/profiles.ts`
- Modify: `packages/engine/src/book/ink.ts` (skip subtrees marked `userData.inkSelf === true`)
- Test: `packages/engine/test/facade-ink.test.ts`, `packages/engine/test/ink-styler.test.ts`

**Interfaces:**
- Produces in `facade/ink.ts`:
  - `FACADE_LINE = { ink: 0x3d3631, overlay: 0xb03a2e, paper: 0xfbfaf6, poche: 0x8f897d, silhouettePx: 1.2, creaseDeg: 20, fineAlpha: 0.45 } as const` — the one place for line weight and colours. These are variant B of the China-style comparison; they change here if the user picks another variant.
  - `class FacadeInk { paper: THREE.ShaderMaterial; hull: THREE.ShaderMaterial; lines: THREE.ShaderMaterial; fine: THREE.ShaderMaterial; overlay: THREE.ShaderMaterial; setSection(plane: THREE.Plane | null): void; setResolution(width: number, height: number, pixelRatio: number): void; dispose(): void }`
    - `paper`: front faces paper colour, back faces poché (spike shader), `polygonOffset` factor/units 1.
    - `hull`: inverted-hull silhouette (spike / `book/ink.ts` OUTLINE_VS), `side: BackSide`, `polygonOffset` factor/units 6 so it never covers the poché.
    - `lines` / `fine` / `overlay`: line shaders (`fine` at `fineAlpha`, `overlay` in the overlay colour).
    - Section: every material discards fragments with `dot(vec4(position, 1.0), uSection) > 0.0`, `position` being the building-local vertex position (geometry is baked in building space, Task 3); `setSection(null)` sets a plane that discards nothing. The section uses this uniform, not three.js `clippingPlanes`: the materials still set `clipping: true` and include the clipping chunks, so the stage's page-edge planes (`stage.ts clipToPage`) keep working on them.
  - `addInked(group: THREE.Group, geometry: THREE.BufferGeometry, ink: FacadeInk, opts?: { crease?: boolean }): void` — adds the paper mesh, the hull mesh and (unless `crease` is false) `EdgesGeometry(geometry, FACADE_LINE.creaseDeg)` line segments; all three named after `geometry.name`.
  - `addFineLines(group: THREE.Group, positions: Float32Array, ink: FacadeInk): void` for paving joints and similar.
- Produces in `facade/profiles.ts`:
  - `type ProfileStep = ["o", number] | ["v", number] | ["ovolo" | "cavetto" | "cyma" | "torus" | "scotia", number, number]`
  - `profile(y0: number, steps: ProfileStep[], back = 0.05): { points: Array<[out: number, y: number]>; top: number; projection: number }` (spike `prof()`, plus torus and scotia)
  - `runAlongX(points: Array<[number, number]>, x0: number, x1: number): THREE.BufferGeometry` — profile extruded along x, projecting towards +z (spike `along()`)
  - `frameAround(points: Array<[number, number]>, rect: { x0: number; y0: number; x1: number; y1: number }, sides: "all" | "no-bottom"): THREE.BufferGeometry` — a moulding run around an opening with mitred corners
  - `slab(shape: THREE.Shape, z0: number, z1: number, bevel = 0): THREE.BufferGeometry` (spike `slab()`)
- `book/ink.ts`: `export function isInkSelf(o: THREE.Object3D, stop: THREE.Object3D | null): boolean` (same walk as `isKeyObject`); in `InkStyler.begin`, a mesh for which it is true is neither swapped nor outlined.

- [ ] **Step 1: Write the failing tests.**
  - `ink-styler.test.ts` → `"leaves meshes under an inkSelf group alone"`: root with a normal mesh and a group `{ userData: { inkSelf: true } }` holding another mesh; `setEnabled(true)`, `begin(frame)`: the normal mesh's material is swapped, the inkSelf mesh keeps its material; `overlay` holds a hull only for the normal mesh; `end()` restores.
  - `facade-ink.test.ts`:
    - `"profile rises monotonically and ends back on the wall"`: `profile(0, [["o",0.05],["v",0.1],["ovolo",0.1,0.16],["cyma",0.08,0.27]])` → y never decreases, last point `out` = −0.05, `top` ≈ 0.28, `projection` 0.27.
    - `"runAlongX spans x0..x1 and projects forward"`: bounding box x = [x0, x1], max z ≈ projection, min z ≈ −back.
    - `"frameAround wraps an opening without covering it"`: a ray along −z through the opening centre hits nothing (`THREE.Raycaster` on a mesh with the geometry); a ray through the frame band hits.
    - `"setSection discards one side"`: `uSection` equals the plane as vec4 after `setSection(plane)` and the "off" value after `setSection(null)`.
    - `"addInked adds paper, hull and crease lines"`: a box gives 3 children; `crease: false` gives 2.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/facade-ink.test.ts packages/engine/test/ink-styler.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the two modules and the `isInkSelf` skip.
- [ ] **Step 4: Run** the two files, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(facade): line-drawing kit, moulding profiles, styler opt-out"`.

---

### Task 3: Assembly — from grammar to building, and the engine

**Files:**
- Create: `packages/engine/src/engines/facade/model.ts` (grammar → building group in metres)
- Create: `packages/engine/src/engines/facade/catalogue/basic.ts` (core pieces: wall with openings, plain pier/pilaster, plain string course and entablature boxes, base with steps, body block, portico vault and paving)
- Modify: `packages/engine/src/engines/facade/index.ts` (real engine)
- Create: `fixtures/public/scenes/_dev-facciata.scene.json` (dev scene, not listed in the archive, like `_dev-routes.scene.json`: two chapters, the Task 1 palazzo and a 1-bay narrow front)
- Test: `packages/engine/test/facade.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas, `floorLayout`, `buildingSize`; Task 2 `FacadeInk`, `addInked`, `addFineLines`, `slab`, `runAlongX`.
- Produces in `model.ts`:
  - `interface FacadeModel { group: THREE.Group /* building-local metres */; parts: Map<string, THREE.Group> /* building id, floor ids, bay ids, "<floorId>.members", "crown", "base" */; size: { width: number; height: number; depth: number }; front: number /* max z of the front, incl. avant-corps */ }`
  - `buildModel(b: FacadeBuilding, ink: FacadeInk): FacadeModel`
  - The building group carries `userData.inkSelf = true`.
  - Geometry is baked in building-local coordinates (identity transforms under `group`) so the section uniform works; merge geometries per part with `mergeGeometries` (one paper mesh, one hull, one line set per part) to keep draw calls low.
- Produces in `index.ts`: `createFacadeEngine(): Engine` with
  - one scale for the lesson: `FACADE_FIT / max(width, height)` of the largest building, `FACADE_FIT = 6` scene units; every building is built at build time at the root origin and hidden unless it is the current chapter's (the book layout traverses all geometry, so the page fits the largest building);
  - `bounds()`: sphere around the largest building;
  - anchors (root-local): `building` top centre of the front; `floor` (part = floor id) centre of the floor's front; `bay` (part = bay id) centre of the cell's front; `member` (part = floor id, index i) top of member i from the left; `vanishing-point` and `horizon` come in Task 5 (return false until then).

- [ ] **Step 1: Write the failing tests** in `packages/engine/test/facade.test.ts` (build helper as in `solid.test.ts`: `SceneSpec.parse` the dev scene, `createFacadeEngine()`, ctx with `root`, `scene`, a rejecting `loadAsset`).
  - `"buildModel size matches buildingSize"`: width and height (±1 cm); depth = given or default.
  - `"an open arch is a passage, a wall is not"`: raycast along −z at the bay centre, 1 m above the floor: no hit on the façade wall for an open-arch bay (only the back of the portico or body beyond its depth), a hit at z ≈ 0 for a `wall` bay.
  - `"forward moves a bay's front"`: a bay with `forward: 0.6` has its cell front at z ≈ 0.6 and `model.front` ≥ 0.6.
  - `"parts exist for every id"`: building, floors, bays, `<floorId>.members`, `crown`, `base`.
  - `"draw calls stay low"`: a 3-floor, 7-bay building with every bay a window: `Mesh` + `LineSegments` count under `group` ≤ 3 × (7 + 4) + 12.
  - `"anchors resolve on the façade"`: `bay` anchor x equals the bay `cx` × scale, z ≥ 0; unknown part → false.
  - `"only the chapter's building is visible"` and `"bounds cover the largest building"`.
  - Review Focus 1: `"builds a 1-bay and a 15-bay floor without throwing"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/facade.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `model.ts`, `catalogue/basic.ts` and the engine. Openings are holes in the wall shape (spike façade wall); rusticated walls and piers use bevelled blocks (`slab(..., bevel)`); a portico floor gets the vault mass (spike) and paving lines (`addFineLines`); the body is a closed block behind the façade with a flat roof slab.
- [ ] **Step 4: Run** the test file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: See it.** With `pnpm dev:web` running, open `http://localhost:5173/?scene=_dev-facciata` in Chrome; check the façade stands on the page and looks identical in Colori and China. Save two screenshots (a playwright script in the scratchpad) for the reviewer.
- [ ] **Step 6: Commit** `git commit -m "feat(facade): assemble buildings from the grammar; engine with anchors and bounds"`.

---

### Task 4: Catalogue, part 1 — orders, mouldings, openings, crowns

**Files:**
- Create: `packages/engine/src/engines/facade/catalogue/orders.ts` (base, shaft with entasis and optional flutes, capitals tuscan / doric / ionic / corinthian simplified / composite simplified; pilaster, half-column, column; paired)
- Create: `packages/engine/src/engines/facade/catalogue/bands.ts` (string course; entablature: architrave with fasciae, frieze, cornice plain / dentils / modillions)
- Create: `packages/engine/src/engines/facade/catalogue/openings.ts` (arch with voussoirs + keystone or moulded archivolt, impost; portal with moulded frame and pediment on brackets; window with moulded frame, sill on corbels, pediment, mullion, balustrade apron; niche; oculus; panel)
- Create: `packages/engine/src/engines/facade/catalogue/crown.ts` (pediment triangular / segmental with raking cornices and tympanum; attic; balustrade with turned balusters, pedestals and handrail; volutes between floors)
- Modify: `packages/engine/src/engines/facade/model.ts` (use the catalogue where the grammar asks for it)
- Modify: `fixtures/public/scenes/_dev-facciata.scene.json` (add a chapter "catalogo": a 3-floor, 5-bay front using every Task 4 element at least once)
- Test: `packages/engine/test/facade-catalogue.test.ts`

**Interfaces:**
- Consumes: Task 2 `profile`, `runAlongX`, `frameAround`, `slab`; Task 3 `buildModel`.
- Produces (building-local metres; names binding, extra parameters the implementer's choice): `orderMember(m: FacadeMember, height: number, x: number, z: number): THREE.BufferGeometry`, `entablature(width: number, height: number, cornice: "plain" | "dentils" | "modillions", y0: number): THREE.BufferGeometry`, `archOpening(cell, bay, floorHeight): { cut: THREE.Path; trim: THREE.BufferGeometry }`, `windowTrim(cell, cx: number): THREE.BufferGeometry`, `portalTrim(cell, cx: number): THREE.BufferGeometry`, `pediment(shape: "triangular" | "segmental", x0: number, x1: number, y0: number, pitch: number): THREE.BufferGeometry`, `balustrade(x0: number, x1: number, y0: number, height: number, posts: number[]): THREE.BufferGeometry`, `volute(side: -1 | 1, x: number, y0: number, width: number, height: number): THREE.BufferGeometry`.
- Order proportions (Vignola): column height / lower diameter tuscan 7, doric 8, ionic 9, corinthian 10, composite 10; entablature ≈ 1/4 of the column height. `art/orders.ts` `ORDER_RATIO` (Opera) stays as it is; the façade table lives in `catalogue/orders.ts`.

- [ ] **Step 1: Write the failing tests** (`facade-catalogue.test.ts`):
  - `"order members keep Vignola proportions"`: for each order, a 7 m column has a lower diameter of 7 / ratio (±2 %), measured on the shaft's base.
  - `"a pilaster projects less than a half-column, which projects less than a column"`.
  - `"dentils repeat along the cornice"`: an entablature with `dentils` over width W has at least floor(W / 0.4) dentil blocks (count separate box components, or vertical crease-edge pairs on the dentil band).
  - `"voussoirs: odd count with a keystone that stands out"`: the keystone's max z exceeds every other voussoir's.
  - `"a window with pediment is taller than its opening by the frame and the pediment"`.
  - `"balusters fill the span between pedestals"`: lathe count per span = floor(span / 0.3).
  - `"window, portal, pediment and arch are symmetric about their axis"` (bounding box mirrored).
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/facade-catalogue.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the four catalogue files and wire them in `model.ts`.
- [ ] **Step 4: Run** the file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Visual sign-off ("tavola del catalogo").** Screenshot `?scene=_dev-facciata`, chapter "catalogo", from the front and at three-quarters (Chrome, 1280×800), and send them to the user with SendUserFile. **Stop here until the user approves the look**; fold requested changes into this task.
- [ ] **Step 6: Commit** `git commit -m "feat(facade): catalogue part 1 — orders, mouldings, openings, crowns"`.

---

### Task 5: The four views, the engine view hook, the overlays

**Files:**
- Modify: `packages/engine/src/types.ts` (add `EngineView` and optional `Engine.view`)
- Modify: `packages/engine/src/player/camera.ts` (pure helpers below)
- Modify: `packages/engine/src/player/stage.ts` (`autoPose` around :550-566, `apply` around :630-636, projection update around :525-540)
- Create: `packages/engine/src/engines/facade/views.ts`
- Create: `packages/engine/src/engines/facade/overlays.ts` (horizon, vanishing-point marker, depth lines, section line A–A, level marks in the section)
- Modify: `packages/engine/src/engines/facade/index.ts` (`view`, anchors `vanishing-point` and `horizon`)
- Test: `packages/engine/test/facade-views.test.ts`, `packages/engine/test/player-camera.test.ts` (new cases)

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  export interface EngineView {
    /** Root-local camera position and target. */
    position: THREE.Vector3;
    target: THREE.Vector3;
    /** Vertical field of view, degrees. */
    fov: number;
    /** Vertical lens shift as a fraction of the frame height (one-point perspective with a low horizon); 0 = none. */
    shiftY: number;
  }
  // in Engine:
  /** Optional: the engine drives the camera at (chapterId, t) (façade views). Pure. null = the chapter's camera keys. */
  view?(chapterId: string, t: number, aspect: number): EngineView | null;
  ```
- Produces in `camera.ts`:
  - `engineViewPose(v: EngineView, world: THREE.Matrix4): CameraPose & { fov: number; shiftY: number }` — position and target into world space.
  - `viewOffsetY(frameY: number, frameH: number, shiftY: number): number` — the `y` argument for `camera.setViewOffset`, combining the free-rect offset and the lens shift (the spike's `setViewOffset(W, H, 0, -H * 0.24, W, H)` is shiftY 0.24: a point on the view axis then sits 0.24 of the frame height below the centre).
- Stage behaviour: in `autoPose`, when `engine.view` returns a view and no XR session is presenting, use `engineViewPose`; skip `keepBookInView`, the narrow/side pull-back and the Accademico distance multiplier; set `camera.fov` to `v.fov` and apply `shiftY` through `viewOffsetY` in the projection update. Otherwise behave exactly as today (base fov `FOV` or `ACADEMIC_FOV`). Raise `camera.far` to at least 2 × the view distance when needed. While the user orbits (`mode === "user"`) the last fov stays.
- Produces in `views.ts`:
  - `interface FacadeFrame { center: THREE.Vector3; width: number; height: number; depth: number; front: number }` (root units)
  - `interface Eye { height: number; x: number; distance: number }` (root units)
  - `viewOf(name: FacadeViewName, f: FacadeFrame, eye: Eye, aspect: number, sectionX: number): EngineView`:
    - prospetto: fov 6°, frontal (elevation 0), fit width × 1.15 and height × 1.15 for `aspect`, shiftY 0;
    - assonometria: fov 6°, azimuth −35°, elevation 30°, same margins;
    - prospettiva: camera at (eye.x, eye.height, front + eye.distance) looking along −z horizontally; fov and shiftY (≤ 0.35) chosen so the whole front is in frame;
    - sezione: fov 6°, from +x, looking at the plane x = sectionX; fit depth × 1.2 and height × 1.15.
  - `blendViews(a: EngineView, b: EngineView, p: number): EngineView` — dolly zoom: the visible height at the target plane is interpolated linearly and the distance follows from the interpolated fov (`d = h / (2 tan(fov / 2))`); targets and directions slerped; shiftY linear; same easing as camera keys.
- Overlays (perspective view only, faded with the view blend; colour `FACADE_LINE.overlay`):
  - horizon line across the front plane at eye height (every point at eye height projects onto the horizon in a one-point view);
  - vanishing-point marker on the view axis at eye height, on the front plane;
  - depth lines from front corner points (base, string course and cornice ends, portico floor corners) to the point of the view axis at eye height at the back of the building — they project exactly onto lines through the vanishing point and stay inside the page;
  - section line A–A in prospetto when a cut bay is set; in sezione, level marks (short ticks with a triangle) at each floor line.
- Section: in sezione (and during a `cut` act, Task 6) `ink.setSection(plane x = cut bay cx)`, keeping x ≤ cut; otherwise `setSection(null)`. Default cut bay: the middle bay of the ground floor.

- [ ] **Step 1: Write the failing tests.**
  - `player-camera.test.ts`: `"engineViewPose moves the view into world space"` (translated and scaled world matrix); `"viewOffsetY combines the free rect and the lens shift"` (frameY 0, frameH 800, shiftY 0.24 → −192; frameY 40 → 40 − 192 with the sign `setViewOffset` expects; shiftY 0 → frameY unchanged).
  - `facade-views.test.ts` (build a `PerspectiveCamera` from each view: fov, aspect 1.6, `setViewOffset` with shiftY):
    - `"prospetto shows the whole front"`: the 4 front corners project within NDC [−1, 1]; the front's left and right edges are vertical (top and bottom NDC x equal ±1e-3).
    - `"prospettiva is one-point: depth lines meet at the vanishing point"`: two receding edges of the portico floor intersect in the image at the projection of the eye-axis point (±0.01 NDC), whose NDC y is −2 × shiftY.
    - `"the horizon sits at eye height"`: points at y = eye.height and different x, z project to the same NDC y.
    - `"the vanishing point stays on screen at slider extremes"` (Review Focus 4): eye height 0.5 m and building top, eye x ±width/2 → VP NDC within [−1, 1], no NaN.
    - `"portrait aspect still fits the façade"` (Review Focus 5): aspect 0.5 for prospetto and prospettiva.
    - `"blendViews keeps the target plane height (dolly zoom)"`: halfway between prospetto and prospettiva, the visible height at the target is the mean of the two (±1 %).
    - `"sezione clips the building at the cut"`: at a sezione key, `ink.paper.uniforms.uSection` equals the plane x = cx of the chosen bay.
    - `"vanishing-point and horizon anchors resolve"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/facade-views.test.ts packages/engine/test/player-camera.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the hook, the camera helpers, the stage wiring, `views.ts`, `overlays.ts` and the engine's `view()` (current view from the chapter's `views` keys at t, default `assonometria` at t = 0; between keys `blendViews` over `dur`).
- [ ] **Step 4: Run** the two files, then `pnpm test` (every other engine's camera tests stay green: the hook is optional) — Expected: PASS.
- [ ] **Step 5: See it.** Add to `_dev-facciata` a chapter "viste" with view keys prospetto → assonometria → prospettiva → sezione; screenshot each view in the app, in the pop-up book and in Accademico, and compare with the spike page. Send the four screenshots to the user.
- [ ] **Step 6: Commit** `git commit -m "feat(facade): four views driven by the engine; one-point perspective overlays; section"`.

---

### Task 6: Chapter actions and the "move the eye" activity

**Files:**
- Create: `packages/engine/src/engines/facade/acts.ts` (pure state at (chapter, t))
- Modify: `packages/engine/src/engines/facade/index.ts` (`update`, `params`, `setParams`, `anchorShown`)
- Modify: `fixtures/public/scenes/_dev-facciata.scene.json` (a chapter "occhio" with draw, highlight and eye acts and an activity using both params)
- Test: `packages/engine/test/facade-acts.test.ts`

**Interfaces:**
- Consumes: Task 1 `FacadeAct`, `FacadeChapter`; Task 3 `FacadeModel.parts`; Task 5 `viewOf`, overlays.
- Produces in `acts.ts`: `facadeStateAt(ch: FacadeChapter, b: FacadeBuilding, t: number, overrides: Record<string, number> | null): { drawn: Map<string, number> /* 0..1; absent = 1 */; highlighted: Set<string>; cut: { bay: string; p: number } | null; eye: { height: number; x: number } }` (metres).
- Drawing: a part targeted by a `draw` act is absent before `at` and traced during `dur`: its line sets grow with `geometry.setDrawRange` in proportion to p; its paper and hull fade in over the last 30 % of the act. Parts not targeted are drawn from t = 0.
- Highlight: the part's line sets use the overlay line material from `at` to `until` (default: chapter end).
- `params(chapterId)`: `[{ id: "eye-height", label: "Altezza degli occhi (m)", min: 0.5, max: building height, step: 0.1, value }, { id: "eye-x", label: "Posizione dell'occhio (m)", min: −width / 2, max: width / 2, step: 0.1, value }]` in metres (the engine converts to root units). `setParams` stores overrides; `update` stays pure given them. While an override is set, the view is prospettiva.
- `anchorShown`: false for anchors on parts not yet drawn.

- [ ] **Step 1: Write the failing tests** (`facade-acts.test.ts`):
  - `"a drawn part is absent before its act and complete after"`: `drawn.get(id)` 0 before `at`, strictly between 0 and 1 mid-act, 1 after.
  - `"scrubbing backwards gives the same scene"` (Review Focus 3): a snapshot (helper like `solid.test.ts` `snapshot`) at t = 4 taken after updating at t = 9 equals the snapshot at t = 4 on a fresh engine.
  - `"highlight lasts until until"`, `"cut moves the section plane to the bay"`.
  - `"eye act moves the eye over its duration; sliders override it"`; `"params report metres and the chapter's current values"`; `"setParams(null) restores the scene's own eye"`.
  - `"slider extremes keep overlays finite"` (Review Focus 4): eye-height 0.5 and max, eye-x ±width/2 → no NaN in overlay positions, all within the page footprint.
  - `"anchorShown waits for the draw act"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/facade-acts.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `acts.ts` and the engine wiring.
- [ ] **Step 4: Run** the file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: See it.** Play chapter "occhio" in the app: the façade is traced floor by floor, the highlighted capitals turn red, the Prova sliders move the horizon and the vanishing point live. Three screenshots (start, mid-draw, slider at an extreme) for the reviewer.
- [ ] **Step 6: Commit** `git commit -m "feat(facade): draw, highlight, cut and eye acts; Prova sliders for the eye"`.

---

### Task 7: Catalogue, part 2 — temple fronts and Romanesque

**Files:**
- Create: `packages/engine/src/engines/facade/catalogue/temple.ts` (stylobate with steps, free-standing colonnade of an order at `colonnade.depth` in front of the cella wall, trabeated entablature with triglyphs for doric, pediment over the whole front)
- Create: `packages/engine/src/engines/facade/catalogue/romanesque.ts` (`shoulders: "slopes"` aisle roofs meeting the nave gable; blind arcades = `arch` cells with `open: false` on half-columns; `gallery` loggette of small arches on colonnettes, stackable; splayed portal with `splay` nested round arches; simple round window)
- Modify: `packages/engine/src/engines/facade/model.ts`, `catalogue/crown.ts` (crown `gable`)
- Modify: `fixtures/public/scenes/_dev-facciata.scene.json` (chapters "tempio" — a doric hexastyle front — and "romanico" — a two-register church front with blind arcades, a gallery and a gable)
- Test: `packages/engine/test/facade-catalogue.test.ts` (new cases)

**Interfaces:**
- Consumes: Task 4 `orderMember`, `entablature`, `pediment`; Task 2 profiles.
- Produces: `colonnade(floor: FacadeFloor, layout: ReturnType<typeof floorLayout>, y0: number): THREE.BufferGeometry`, `triglyphFrieze(width: number, height: number, y0: number, axes: number[]): THREE.BufferGeometry`, `gable(width: number, y0: number, pitch: number): THREE.BufferGeometry`, `aisleSlopes(lower: number, upper: number, y0: number, pitch: number): THREE.BufferGeometry`, `gallery(cell, bay, floorHeight: number): THREE.BufferGeometry`, `splayedPortal(cell, cx: number): { cut: THREE.Path; trim: THREE.BufferGeometry }`.

- [ ] **Step 1: Write the failing tests:** `"a doric hexastyle front has six free-standing columns in front of the wall"` (six column groups reaching z ≈ colonnade depth, wall front at z = 0); `"triglyphs sit over every column axis and every intercolumniation"`; `"a gallery has one small arch per intercolumniation"` (columns c → c − 1 arches between colonnettes plus the two end half-arches as implemented; state the rule in a comment and test it); `"a splayed portal steps back once per splay ring"`; `"aisle slopes meet the upper floor's sides"` (no gap between the slope lines and the upper floor).
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/facade-catalogue.test.ts` — Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the two catalogue files and wire them.
- [ ] **Step 4: Run** the file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Visual sign-off.** Screenshots of chapters "tempio" and "romanico" (front and three-quarters) to the user with SendUserFile. **Stop until the user approves.**
- [ ] **Step 6: Commit** `git commit -m "feat(facade): catalogue part 2 — temple fronts and Romanesque"`.

---

### Task 8: Rotunda, dome and plan view

Added 2026-11-09 by the user's decision "Aggiungi cupola etc." (acceptance image: an engraving of the Pantheon's plan and section). Runs after Tasks 5–7: it extends the grammar (Task 1), the model and catalogue (Tasks 3, 4, 7), the views (Task 5) and the acts (Task 6).

**Files:**
- Modify: `packages/scene-spec/src/engines/facade.ts` (grammar, checks, `FACADE_VIEWS`, `FACADE_ENTITIES`, act targets)
- Create: `packages/engine/src/engines/facade/catalogue/rotunda.ts`
- Modify: `packages/engine/src/engines/facade/model.ts` (parts `rotunda`, `dome`), `views.ts` (`pianta`), `overlays.ts` (level marks or a north/scale tick in pianta are the implementer's choice), `index.ts` (anchors, section plane per view)
- Modify: `fixtures/public/scenes/_dev-facciata.scene.json` (chapter "rotonda": an octastyle Corinthian pronaos, an intermediate block, a rotunda with niches and a coffered dome with oculus; views assonometria → sezione → pianta)
- Test: `packages/scene-spec/test/facade.test.ts` (new cases), `packages/engine/test/facade-rotunda.test.ts`

**Interfaces:**
- Grammar, in `FacadeBuilding`, optional and compact (the schema budget test must stay green):
  ```ts
  rotunda?: {
    diameter: Len;            // inner diameter, metres
    wall?: Len;               // wall thickness (default 0.14 × diameter)
    height: Len;              // cylinder wall height, from `level`
    level?: Len;              // where the cylinder starts (default 0 = ground; a drum on the body sits higher)
    gap?: Len;                // distance between the body's back and the rotunda's outer face (default 0: they touch)
    niches?: number;          // int 0..16, alternating rectangular / semicircular, symmetric about the axis; the entrance takes the slot on the axis
    dome: {
      type: "smooth" | "coffered";
      coffers?: [rings: number, perRing: number]; // ints 1..8 and 8..40 (Pantheon: [5, 28])
      oculus?: Len;           // diameter; 0 or absent = closed
      drum?: Len;             // drum height between the wall top and the dome springing (default 0)
      lantern?: boolean;      // only without oculus
      steps?: number;         // int 0..8, stepped rings on the outside of the dome's base (Pantheon: 7)
    };
  }
  ```
  The rotunda stands on the façade axis (x = 0), behind the body: its outer face touches the body's back plus `gap`.
- `FACADE_VIEWS` gains `"pianta"`; `FacadeChapter` gains `plan?: Len` (cut height in metres above the ground, default base height + 1 m); `FACADE_ENTITIES` gains `"rotunda"`, `"dome"`, `"oculus"`; `draw` and `highlight` accept the targets `"rotunda"` and `"dome"` when the building has one.
- Checks (`checkFacadeData`, readable issues, never a throw): `wall` < diameter / 4; oculus < 0.4 × diameter; `lantern` with an oculus; `coffers` with `type: "smooth"`; targets/entities `rotunda`, `dome`, `oculus` on a building without a rotunda; a chapter `plan` above the building's height.
- `buildingSize(b)` includes the rotunda: depth = body depth + gap + outer diameter; height = max(front height, level + height + drum + outer radius + lantern).
- Produces in `catalogue/rotunda.ts` (building-local metres): `rotundaWall(r: FacadeRotunda, zCentre: number): THREE.BufferGeometry` (hollow cylinder with niches cut into the inner face, entrance on the axis towards the front, cornice at the top), `domeShell(r: FacadeRotunda, zCentre: number): THREE.BufferGeometry` (hemispherical shell with real thickness; coffers as stepped recesses on the inner face; oculus ring; outer base steps; drum and lantern when asked). Both closed and double-sided for the section shader, deterministic, about ≤ 40k triangles for a [5, 28] coffered dome.
- `viewOf("pianta", f, eye, aspect, sectionX, planY)`: camera straight above, fov 6°, front of the building at the bottom of the frame, fit width × 1.15 and depth × 1.15 for `aspect`, shiftY 0. In pianta the engine calls `ink.setSection(plane y = planY)` keeping y ≤ planY; in sezione it keeps Task 5's vertical plane.

- [ ] **Step 1: Write the failing tests.**
  - scene-spec: `"a rotunda with a coffered dome parses and checks clean"`; `"rotunda checks report readable issues"` (thick wall, big oculus, lantern with oculus, coffers on a smooth dome, `dome` target without rotunda, plan above the top) — no throw; `"schema still fits the budget"` (existing server test stays green).
  - engine (`facade-rotunda.test.ts`): `"the rotunda is hollow: a horizontal cut at plan height crosses the wall twice on the axis"` (raycast along x at plan height through the centre hits inner and outer faces on each side); `"niches alternate and stay symmetric"` (bounding box of the niche cuts mirrored about x = 0; count as asked); `"a [5, 28] coffered dome has 140 coffers"` (count recessed panels, e.g. by grouping crease loops, or by the implementer's stated rule in a comment); `"the oculus is open"` (a vertical ray on the axis from above passes through the dome); `"pianta looks straight down and fits the plan"` (camera direction (0, −1, 0) ± 1e-6; the building's footprint corners project within NDC [−1, 1] at aspect 1.6 and 0.5); `"pianta cuts at the chapter's plan height"` (`ink.paper.uniforms.uSection` = (0, −1, 0, planY) in root units, or the sign convention `setSection` uses, stated in the test); `"buildingSize includes the rotunda"`; `"dome and oculus anchors resolve"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/scene-spec/test/facade.test.ts packages/engine/test/facade-rotunda.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the grammar, checks, `rotunda.ts`, the model parts, the pianta view and section, anchors, the dev chapter "rotonda".
- [ ] **Step 4: Run** the files, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Visual sign-off.** Screenshots of chapter "rotonda" in assonometria, sezione (through the axis: coffers and oculus visible) and pianta, plus the same in Accademico, sent to the user next to a description of how they compare with the Pantheon plate. **Stop until the user approves.**
- [ ] **Step 6: Commit** `git commit -m "feat(facade): rotunda and dome; plan view"`.

---

### Task 9: Reference lessons, docs, export check

**Files:**
- Create: `fixtures/public/scenes/facciata-palazzo-rucellai.scene.json` — Palazzo Rucellai, Florence (design by Leon Battista Alberti, c. 1446–1451; execution attributed to Bernardo Rossellino): superimposed pilaster orders on three floors, flat rusticated ashlar, mullioned arched windows (bifore) on the upper floors, portals, crowning cornice. Chapters (Italian): the façade as a drawing (prospetto, drawn floor by floor); the three orders (highlight); seeing it from the street (prospettiva, with the Prova "sposta l'occhio" activity: predict / test / prove / stamp); the section through a bay (sezione).
- Create: `fixtures/public/scenes/facciata-tempio-chiesa.scene.json` — three buildings, one per chapter: the so-called Temple of Neptune (Hera II) at Paestum (doric, hexastyle front), San Miniato al Monte, Florence (Romanesque: five blind arches on half-columns in the lower register, pedimented upper register; marble inlay not drawn), and the Pantheon, Rome (octastyle Corinthian pronaos, intermediate block, rotunda with niches, coffered dome [5, 28] with oculus; chapters in sezione through the axis and in pianta, matching the user's acceptance plate). At least one chapter in prospettiva and one in assonometria.
- Modify: wherever reference scenes are listed for the home archive (find with `grep -rn "geometria-solidi" apps/web/src fixtures/public`; add both façade lessons the same way).
- Modify: `docs/decisions.md` (row **D28 "Façade theatre"** after the last row: lines-only façades from a grammar, four views through `Engine.view`, v1 families, one building per chapter, generator in Plan B with the music theatre's recording batch).
- Create: `docs/facade.md` (developer notes: grammar summary, coordinates and scale, catalogue map, line weights in `FACADE_LINE`, the view hook, how to add an element, the dev scene).
- Test: `packages/engine/test/facade.test.ts` (fixture tests)

**Interfaces:**
- Consumes: everything above. Copy the overall scene shape (meta, sources, chapters with `book`, narration sentences, pins, activity, sounds) from `fixtures/public/scenes/geometria-solidi.scene.json`.
- Narration in our own words; every fact sentence cites a source in the scene's sources (Italian Wikipedia pages of the buildings and of Alberti), as other reference scenes do.

- [ ] **Step 1: Write the failing tests** (one `describe` per scene, like `solid.test.ts` "geometria-solidi scene fixture"): parses; `checkScene` and `checkFacadeData` equal `[]`; chapter ids as written; the engine builds; every chapter updates from 0 to its duration in 0.5 s steps without throwing; every pin anchor resolves at its chapter's mid-time.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/facade.test.ts` — Expected: FAIL (scenes missing).
- [ ] **Step 3: Write the two scenes**, the archive listing, D28 and `docs/facade.md`.
- [ ] **Step 4: Run** the file, then `pnpm test` — Expected: PASS.
- [ ] **Step 5: Lesson review.** Play both lessons in the app as a student would (voice on, Prova done, stamp obtained), in pop-up and Accademico, Colori and China; screenshot every chapter and send them to the user. **Stop until the user approves.**
- [ ] **Step 6: Export check** (only once `feature/export-interactive` is in this branch): add `facciata-palazzo-rucellai` to the scenes exported by `pnpm export:e2e` (find its scene list with `grep -rn "matematica-parabola" packages apps scripts`), run `pnpm export:e2e` — Expected: every export passes offline, the façade lesson included. If the export branch is not merged yet, record that in the ledger and leave this step open.
- [ ] **Step 7: Commit** `git commit -m "feat(facade): reference lessons Palazzo Rucellai and temple/church/Pantheon; D28; docs"`.
