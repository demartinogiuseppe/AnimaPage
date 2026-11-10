# Façade theatre — design

Date: 2026-11-09. Status: approved description, written up for planning; builder check done and its questions answered. Decision ID to assign: D28.

## Why

Art-history pages often show the façade of a building: a church, a palazzo, a portico. The user tried AnimaPage on such pages (saved lesson "Rilievo del portico di Piazza Statuto") and found the result "poor and poorly defined, I don't see details". The cause is structural: today architecture lives in the `art` engine (Opera, D14) as a kit of five smooth solids (column, entablature, pediment, arch, dome). There is no wall, window, pilaster, bay or floor, and no mouldings, so every façade comes out as a cardboard model built from generic parts, with invented pieces (half domes over the arches, coloured rods) that are not on the page.

The user's idea: for this kind of page, rebuild the façade in 3D **with lines only, no colour**, and offer, besides the 3D, **a one-point perspective view with its vanishing point**. A throwaway spike (one portico, three bays, four views) confirmed the level of detail the user wants (user: "Sì" to "is this the level of detail you had in mind?").

What makes it special: the drawing on the page is made of lines, so the 3D speaks the same language — it reads as the page's drawing rising up, not as a different model. Lines are also forgiving: a simplified volume drawn in lines looks like a drawing; coloured, it looks like a toy. And the perspective view becomes a lesson in itself.

## Who it serves

Students (and teachers at the board) studying architecture in art-history books: Italian middle and high school, and university pages through the Accademico presentation. The student should understand how the façade is made (orders, bays, floors, openings, mouldings) and how it is represented (elevation, axonometry, perspective, section).

## Goals

1. A new theatre, **`facade`** ("Facciata"), for building façades from art-history pages. **v1 scope (user decision):** classical, Renaissance, Mannerist and Baroque façades, **temple fronts** (Greek and Roman temples, porticoes with free-standing columns under a beam such as the Pantheon pronaos or Palladio's villas) and **Romanesque** façades (e.g. San Miniato al Monte, Duomo di Pisa). **One building per chapter** (user decision): a lesson can compare buildings (e.g. Alberti's façades), each chapter showing one. **Rotunda and dome** (user decision, 2026-11-09, "Aggiungi cupola etc."): a building may have a cylindrical rotunda behind its front (with niches in the wall) carrying a dome (smooth or coffered, with oculus, optional drum and lantern), as in the Pantheon.
2. **Lines only.** Fine dark lines on paper: silhouettes, creases and mouldings, as in an ink survey drawing. The same look in the Colori and China styles.
3. **Rich, precise detail that comes from the engine, not from the model's imagination.** The AI describes the façade as a grammar; the engine draws every element with its full mouldings from a catalogue.
4. **Five views of one model, with animated camera moves between them** (the fifth, *pianta*, added by the user's 2026-11-09 decision):
   - **Prospetto** (elevation): frontal and practically orthographic, as on the plate.
   - **Assonometria** (axonometry): 3D from above-front at an angle, parallel lines stay parallel.
   - **Prospettiva centrale** (one-point perspective): the eye at a stated height in front of the façade, with the horizon line and the vanishing point drawn, and depth lines running to it.
   - **Sezione** (section): a plane cuts through a chosen bay; cut parts are filled (poché).
   - **Pianta** (plan): a horizontal plane cuts the building at a stated height (default 1 m above the base) and the camera looks straight down; cut walls and columns are filled (poché), as on an engraved plan (the user's acceptance plate: the Pantheon's plan and section).
   - The user can still orbit freely, as in every theatre.
5. **Prevedi → Prova → Dimostra** works here: the "Prova" moves the eye (height, and left–right position), and the student sees the horizon and the vanishing point move with it.
6. The detail level of the spike is the floor, not the ceiling (see "Reference: the spike").

## Non-goals (v1)

- **Gothic** (rose windows with tracery, pointed arches, pinnacles, flying buttresses) and **curved fronts** (Borromini-style concave/convex plans). They need their own catalogue and data; they come later. Until then these pages keep going to `art` exactly as today (see "Generator").
- A survey-accurate reconstruction "to the centimetre". Proportions are read from the photo and are approximate.
- Complete interiors (beyond the rotunda's niches and the dome's coffers), plans of whole complexes, roofs seen in detail, towers, domes on pendentives over a crossing, ribbed or Gothic domes. A rotunda with its dome is in v1 (see Goals); the plan view shows the modelled building only.
- Colour, textures, materials, the original photo or a Commons image shown next to the model.
- Statues, reliefs, frescoes and other figurative decoration on the façade (at most a plain niche or panel where they are).
- Ready-made 3D models from the internet.
- Changing how paintings work in Opera.

## Anti-goals (would make it a failure even if it technically works)

- **A rich façade that is not the building on the page.** Accuracy beats richness: the AI must not add elements that are not visible on the page. A plain wall is better than an invented window.
- The current look: smooth generic solids, invented parts, colour blocks.
- Lines so dense that the façade turns into grey mush at board distance (see the pending China-style line weight work: same concern).
- A perspective view where the vanishing point and horizon are decoration and do not match the 3D (they must be geometrically true).

## Constraints

- **The architecture of the app stays:** the AI writes a declarative scene (SceneSpec) and the engine stages it. Engine `update(chapterId, t)` must stay pure.
- **Pop-up book (D12):** the façade stands on the page like every scene. Accademico (D24) hides the book and works as usual.
- **Copyright:** only public-domain imagery; this theatre draws everything itself, so no image is needed. Façade texts are paraphrased as everywhere else.
- **Schema budget:** the JSON schema sent to the model has a 30,000-character budget (`server/src/generate/schema.ts:26`); the façade schema must be compact.
- **Frozen prompts (D26):** any guide or prompt text change alters request hashes and requires re-recording the mock fixtures. Live LLM calls are kept to a minimum (standing user rule).
- **New engines join `ANALYSIS_ENGINES` only once the generator supports them (D16).**
- **Export (D27):** the export runtime bundles all engines; the new engine must work offline in the exported `.html`/`.wgt`.
- **Performance:** must stay smooth on a school board PC and a mid-range phone. A three-bay, three-floor façade with balusters and dentils must not drop frames.
- Code and technical docs in English; app texts in Italian and through the i18n catalogues.

## What was decided, and by whom

### Decided by the user

- Lines only, no colour, for façades.
- A one-point perspective view with vanishing point, besides the 3D.
- The spike's level of detail.
- Scope: "facciate artistiche" (artistic façades from art-history pages), not technical-drawing exercises.
- v1 families: classical to Baroque, temple fronts, Romanesque; Gothic and curved fronts later (accepted Claude's proposal).
- One building per chapter, so a lesson can compare buildings (accepted Claude's proposal).
- Rotunda, dome (smooth or coffered, oculus, drum, lantern) and the plan view *pianta* in v1 ("Aggiungi cupola etc.", 2026-11-09, after sending the Pantheon plan-and-section engraving as the acceptance image).
- Line weight: China variant C (light lines), chosen 2026-11-09; the façade follows it.
- The prompt change and the re-recording of mock fixtures are done **once, together with the music theatre's prompt changes**, when that theatre is designed too (accepted Claude's proposal). Until then the façade engine can be built and tested on hand-written scenes, but it does not join `ANALYSIS_ENGINES` (D16).

### Claude's calls (accepted in the played-back description; the user can still overturn them)

- **A new engine `facade`, not an extension of `art`.** The data model (a grid grammar), the rendering (lines only) and the camera needs (frontal, near-orthographic views) all differ from paintings. `art` keeps its architecture kit untouched so saved lessons keep working; the analysis step sends façades in the v1 families to `facade` and leaves other buildings to `art`.
- **The façade grammar** (below) as the way the AI describes a façade.
- **The four views** listed in the goals, with animated transitions, on one model.
- **The activity is "move the eye"** (height, left–right), with the horizon and vanishing point following.
- **Lines stay lines in every style** (Colori and China look the same, apart from the paper tint of the theme).
- **The page photo is attached to the generation request for façade lessons.** Today only the analysis call sees the image; generation gets one sentence per illustration (`server/src/generate/prompt.ts`, `analysisForPrompt`). A text-only generator would have to invent bays and openings, which is the main anti-goal. Attaching the photo costs a little more per façade lesson only; the mock fingerprint already hashes images. (Alternatives rejected: a structured façade reading inside `PageAnalysis`, which changes the analysis of every page; a separate "read the façade" call, which adds a pipeline step and delay.)
- **Projecting bays** (avant-corps) are in v1: a depth offset per bay.
- **What `facade` does not cover stays in `art` as today** (Gothic, curved fronts, crossing domes, interiors, plans of complexes), so no lesson gets worse.

## The façade grammar (the data the AI writes)

The shape below is the intent; the exact zod schema is left to the builder (see "Left to the builder"), within the schema budget.

- **Buildings per chapter:** the data holds a list of buildings (usually one); each chapter names the building it shows. Ids are scoped per building. The book layout must fit the largest building, not only chapter 1's (today the stage sizes the book once from chapter 1 at t = 0, `player/stage.ts` around line 192).
- **Units:** metres, real proportions as read from the photo. The engine fits the model to the page.
- **Projecting bays:** each bay may carry a depth offset (a central avant-corps stepping forward).
- **Temple front / pronaos:** a free-standing colonnade in front of the wall (or the whole front), carrying a trabeated entablature and a pediment, with a depth; the columns are drawn as members of an order.
- **Floors** (`floors`), bottom to top. Each floor has a height and its own **bays** (`bays`): an ordered list of widths, left to right, centred on the façade axis. Floors may have different total widths (a church whose upper order is narrower than the lower one). A floor may be marked as a **portico** with a depth (an open arcade with a vault behind).
- **Cells:** each bay of each floor gets one **opening or filler** from the catalogue (arch, portal, window, niche, oculus, blind panel, plain wall), with its own few parameters (e.g. window with triangular or segmental pediment, with or without sill on corbels; arch with voussoirs and keystone or with a moulded archivolt).
- **Vertical members** between bays: pilaster, half-column or column of an order (Tuscan, Doric, Ionic, Corinthian, Composite), or plain pier, or rusticated pier; optionally paired.
- **Wall treatment** per floor: smooth or rusticated (bugnato), with a course height.
- **Horizontal members:** a base or plinth with steps; a string course between floors; a full entablature where an order carries one (architrave, frieze, cornice; cornice with dentils or modillions).
- **Crown:** a pediment over the whole façade or over a central group of bays (triangular or segmental), an attic, a balustrade (with pedestals over the members below), or nothing.
- **Transitions between floors of different width:** scrolls (volutes) on the sides, as on Renaissance and Baroque church fronts.
- **Body behind the façade:** a depth for a plain block behind it (so axonometry and section read), or the portico depth with its vault.
- **Rotunda (optional):** a hollow cylinder on the façade axis behind the body: inner diameter, wall thickness, wall height, the level it starts from (0 on the ground; higher for a drum standing on the body), niches in the inner face (count; alternating rectangular and semicircular, as in the Pantheon), and its **dome**: hemispherical shell, smooth or coffered (rings × coffers per ring), oculus diameter, optional drum height and lantern. The plan view needs the rotunda hollow, so walls, niches and the dome shell have real thickness.
- **Ids** on floors, bays and cells, for anchors, pins and actions.

Validation (scene-spec `check` function, same pattern as other engines): ids unique and referenced correctly; bay widths positive and floors stacked; cell elements fit their cell (an opening narrower and lower than the bay and floor); members of an order roughly respect the order's proportions (warn, do not reject).

## The catalogue (what the engine draws)

Every element is parametric and drawn with its mouldings, in the spirit of the treatises (Vignola for the orders). Mouldings are profiles (fillet, ovolo, cavetto, cyma, torus, scotia) run along straight lines or around openings. Lists below are the v1 minimum:

- Orders: base, shaft (optionally fluted, with entasis), capital (Tuscan, Doric, Ionic, Corinthian simplified, Composite simplified), for columns, half-columns and pilasters. `art/orders.ts` already has proportions and some capitals; reuse what fits.
- Entablature: architrave with fasciae, frieze (plain; triglyphs for Doric), cornice with dentils or modillions.
- Arch: round arch with voussoirs and keystone, or with a moulded archivolt; impost mouldings.
- Portal: door opening with moulded frame, with or without pediment (triangular or segmental) on brackets.
- Window: moulded frame, sill (on corbels or plain), with or without pediment (triangular or segmental), with or without an apron or balustrade below.
- Niche (round-headed), oculus (round window with moulded frame), blind panel.
- Rustication (bevelled blocks), string course, base with steps.
- Pediment (triangular, segmental) with raking cornices and tympanum; attic; balustrade with turned balusters, pedestals and handrail; scroll (volute) between floors.
- Portico: arcade on piers or columns, vault behind (barrel or segmental; cross vaults are a builder's choice), floor paving lines.
- Temple front: stylobate with steps, free-standing colonnade, trabeated entablature, pediment; cella wall behind.
- Rotunda and dome: cylindrical wall with niches and a cornice at the springing, stepped rings on the outside of the dome's base (as in the Pantheon), hemispherical shell with coffers on the inside (each coffer a stepped recess), oculus with a moulded ring, optional drum and lantern.
- Romanesque: gabled front following the roof slopes (central nave higher than the aisles), blind arcades (round arches on pilasters or half-columns against the wall), galleries of small columns (loggette, possibly stacked), splayed portals with nested round arches, simple round windows; geometric marble inlay is out of scope (lines only).

## The look

- Paper-white surfaces, no shading or almost none, **dark fine lines**: silhouettes (screen-space outline, as in `book/ink.ts`), creases (edges above a threshold angle), and moulding lines.
- **Line hierarchy:** the silhouette and main edges slightly stronger, secondary lines (paving joints, fine moulding lines) lighter. The China-style line-weight change under way (variants A/B/C sent to the user, choice pending) is the same concern; the façade theatre should follow whatever weight the user picks.
- **Overlays in a muted red:** horizon line, vanishing point, depth lines to the vanishing point, section line A–A, highlights.
- **Section:** cut faces filled with a flat grey-brown poché; what is beyond the cut is drawn in elevation.
- The look must not depend on the user's Colori/China choice: the engine draws its own lines and tags its content so `InkStyler` leaves it alone (today there is no engine hook to opt out of the styler; one is needed — see "Left to the builder").
- Labels and pins work as in other theatres.

## Views and camera

The views are part of the lesson: a chapter can say "show the elevation", then "move to perspective", etc. Required behaviour:

- **Prospetto:** frontal (elevation 0°), practically orthographic. A true orthographic camera or a long-lens perspective (very narrow field of view from far away) are both acceptable if the result reads as an elevation.
- **Prospettiva centrale:** a perspective camera at a stated eye height (default 1.60 m in the model's real units) and distance, looking straight at the façade (one-point perspective: the view axis perpendicular to the façade). The **horizon line** is at eye height; the **vanishing point** is where the view axis meets it; depth lines (portico floor, vault, string course and cornice returns, plinth) visibly run to it. These overlays are 3D geometry or computed from the camera, so they are always true.
- **Assonometria:** a parallel (or near-parallel) view from front-above at an angle; the same depth lines stay parallel here, which is itself a teaching point.
- **Sezione:** a cutting plane through a chosen bay, perpendicular to the façade, viewed from the side; it may slide in as an animation. Through the middle bay of a building with a rotunda it shows the dome's shell, its coffers and the oculus, as on the plate.
- **Pianta:** a horizontal cutting plane at the chapter's plan height, viewed from straight above, near-orthographic, front of the building at the bottom of the frame; the same section mechanism as *sezione* with a horizontal plane.
- **Transitions** between views are animated camera moves. A dolly zoom (narrowing the field of view while moving back) between perspective and elevation is a good way to show perspective becoming parallel projection; the builder decides the technique.
- **Today's limits that must be lifted for this theatre** (found in recon):
  - the camera is always `PerspectiveCamera(40)` and `CameraKey` has no field of view or projection (`packages/scene-spec/src/common.ts:62-70`, strict);
  - in the pop-up book the elevation is clamped to at least 14° (`packages/engine/src/book/layout.ts:188-202`), which forbids a true frontal elevation or one-point perspective;
  - content is clipped at the page edges, and far/maxDistance limits (`player/stage.ts:209-215`) may block a long-lens elevation.
- **Claude's call on how the views are driven:** the façade engine drives the views itself from its own data (a view per chapter and timed view changes, pure in `t`), through a new optional engine hook that the stage honours over the chapter camera keys. This keeps `CameraKey` and the LLM schema unchanged for every other theatre. The exact hook is left to the builder.
- In AR the engine-driven views are off (the user's real viewpoint wins).

## Chapter actions (what the narration can trigger)

Same timing model as other theatres (actions at `t`):

- `view`: change view (prospetto, assonometria, prospettiva, sezione, pianta), with a duration.
- `draw`: a group of elements (a floor, the order, the crown) is drawn line by line, like a hand drawing being traced; elements not yet drawn are absent or faint.
- `highlight`: outline an element or group in red (e.g. "the keystone", "the Ionic capitals of the upper order").
- `cut`: move the section plane to a bay.
- `eye`: set eye height / position for the perspective (also the activity's parameters).

## Activity (Prevedi → Prova → Dimostra)

- **Prevedi:** a question, e.g. "If you look from higher up, where does the vanishing point go?".
- **Prova:** sliders `eye-height` and `eye-x` (left–right) through the existing `params`/`setParams` mechanism (`packages/engine/src/player/activity-ui.ts`); the horizon, the vanishing point and the depth lines update live; the camera stays in perspective.
- **Dimostra:** the narration shows the answer (the vanishing point is always at eye height, on the view axis).

## Generator

- The analysis prompt (`server/src/analyze/prompt.ts`) gains a `facade` entry for façades in the v1 families (classical to Baroque, temple fronts, Romanesque: church, palazzo, portico, temple), including round temples with a pronaos and a domed rotunda (the Pantheon), while `art` keeps buildings outside that scope (Gothic, curved fronts, crossing domes, interiors, plans of complexes). This line is frozen text: it changes only in the combined recording batch with the music theatre.
- The generation request for a façade lesson carries the page photo (Claude's call above).
- A new guide `server/src/generate/guides/facade.ts`: how to read floors, bays and members from the photo; to use only elements visible on the page (anti-goal above); to estimate proportions in metres from a known element when possible (a door about 2.2–3 m, a storey 4–6 m); how to plan chapters (elevation first, then the order and the openings, then perspective, then section); the activity.
- A hand-written reference scene in `fixtures/public/scenes/` for a real, public-domain building, used as the prompt example (`server/src/generate/example.ts`), as all engines need. Choice of building left to the builder; a Renaissance palazzo or church front that exercises most of the catalogue (orders on two floors, pediments, rustication, a portal) is ideal.
- The visual check (D23) runs on façade scenes as on others.
- Re-recording the mock fixtures after the prompt changes, with the fewest live calls possible. Editing the shared analysis prompt invalidates the analysis recordings and, through them, the generation recordings that replay them: about 15–20 live calls, as in the D25 batch. Done once, together with the music theatre (user decision).
- **Acceptance photo:** the user's engraving of the Pantheon's plan and section, kept privately as `fixtures/pages/arte_pantheon_pianta-sezione.jpg` (never published).
- The files a new engine touches are listed by the recon pattern of `solid`/`music` (scene-spec engine file + index + analysis list, engine factory, guide + guides index + sliders, example, analysis prompt, web archive theatre list and icon, i18n `theatre.facade`, smoke test EngineId list, engine test).

## Reference: the spike

A throwaway prototype (not kept in the repo) drew a three-bay portico in four views with: rusticated piers of bevelled blocks, impost mouldings, arches with eleven voussoirs and a projecting keystone, a moulded string course, lesene, windows with moulded frames, sills on corbels and triangular pediments, a main cornice with dentils, an attic balustrade with turned balusters and pedestals, a segmental vault and paving lines under the portico. Techniques that worked:

- surfaces as one paper-white shader that paints back faces grey, so a clipping plane gives the section poché for free;
- silhouettes as the screen-space inverted hull already used in `book/ink.ts` (pushed slightly back in depth so it does not cover the poché);
- crease lines from `EdgesGeometry` at about 20°;
- mouldings as 2D profiles extruded along straight runs;
- one-point perspective from a camera looking straight at the façade with a vertical lens shift, so the horizon sits low in the frame and the whole front is visible;
- the vanishing point is just the projection of a point far along the view axis at eye height.

The section view was the weakest of the four and should be richer in the real theatre (for example level marks or dimensions).

## Left to the builder

- The exact zod schema of the grammar, its field names and limits, within the schema budget.
- The geometry of each catalogue element and the moulding profile library; reuse of `art/orders.ts`.
- How lines are drawn (edges + hull as in the spike, or `Line2`/fat lines, or a mix) and the line weights, following the China-style choice.
- How the engine opts out of `InkStyler` (e.g. an ancestor flag the styler skips).
- The engine-to-stage view hook (signature, how it overrides camera keys and the 14° clamp, how near/far and distance limits adapt, how pins and labels project in an orthographic or long-lens view).
- Whether the elevation uses a true orthographic camera or a long lens.
- Instancing for repeated elements (balusters, dentils, blocks) if needed for performance.
- Cross vaults vs barrel vaults under porticoes.
- The reference building and its scene.
- Test strategy beyond the usual (unit tests per catalogue element and grammar check, engine test like `solid.test.ts`, smoke tests, e2e render of the reference scene, export e2e).

## Open questions for the user

None left (acceptance image and line weight settled on 2026-11-09).
