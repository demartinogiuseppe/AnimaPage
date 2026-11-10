# Manual theatre — design

Date: 2026-11-10. Status: description agreed with the user in conversation, written up for planning; builder check done and its questions answered (combustion engines by the user, the rest as Claude's calls). Decision ID to assign.

## Why

AnimaPage turns a photographed book page into an animated 3D lesson. The user wants the same for **technical manuals**: a page of a user manual, an instruction sheet or a maintenance manual. Today such a page would land in `workshop` or `diorama`, which have no notion of numbered parts, cutaways, exploded views, flows through a machine or safety warnings.

The user's idea: a theatre for manuals, written in the plain style of ASD-STE100 (Simplified Technical English) and drawn as **technical cutaways and drawings in lines**, like the façade theatre.

What makes it special: the operator gets the picture a good colleague would give standing in front of the machine — **what it is, what it is for, how it works, where it can hurt you** — before touching it, with the same part numbers as the manual in their hands.

## Who it serves

**The operator who will then actually work on the apparatus** (user's words): someone about to use or maintain a real machine, not a student studying a subject. Typical readers: technicians, apprentices, new staff, students of vocational and technical schools. Adults: the lesson is sober (see "The look").

What the operator must get from the lesson (user): **an overall view of the apparatus and an understanding of its basic functions**, and, if the apparatus is dangerous, **its hazards**.

## Goals

1. A new theatre, **`manual`** ("Manuale"), for pages of instructions, user manuals and maintenance manuals.
2. **v1 families (user):** motors, household appliances, mechanical apparatus.
   - Motors: electric (stator, rotor, windings, fan, terminal box) and combustion (piston, connecting rod, crankshaft, valves, spark plug).
   - Household appliances: washing machine, dishwasher, coffee machine and the like (drum, heating element, pump, solenoid valves, hoses, filter, **control panel**).
   - Mechanical apparatus: gearboxes, pumps, compressors, transmissions (shafts, bearings, gears, belts and pulleys, springs, seals, casings).
3. **The lesson structure (user: "gli direi cos'è, a cosa serve e quali sono le funzioni base, se è un apparato pericoloso gli spiegherei anche quali sono i pericoli"):**
   1. **Cos'è** — the whole apparatus, orbitable, its main parts named and numbered.
   2. **A cosa serve** — the job it does, in one scene (e.g. water from a low tank to a high one).
   3. **Funzioni base** — how it works inside: cutaway and/or exploded view, the moving parts moving, the flow animated. For appliances, the controls: each knob, button and light can be touched and is explained.
   4. **Pericoli** — only if the page or the apparatus is dangerous: hazard zones highlighted on the drawing, each with its warning.

   More chapters are allowed (e.g. a second "Funzioni base" chapter for a second subsystem, or a short maintenance sequence when the page is about one), but orientation comes first; step-by-step procedures are the second level.
4. **Hazards placement (user chose option B on the mockup):** a short red line in chapter 1 ("Apparato pericoloso: vedi capitolo 4"), the full detail in the hazards chapter.
5. **Warnings** have three fixed levels with fixed colour and shape: **PERICOLO** (red), **ATTENZIONE** (amber), **NOTA** (blue). They cannot be hidden by the labels setting and are always read by the voice — **even when the "Voce" switch is off** (user, 2026-11-10: "Voce accesa anche per i manuali"); the other sentences follow the switch.
6. **A fixed legal notice**, always visible in this theatre (user: "adotteremo tutti gli avvisi del caso per rimanere in completo legal safe"), in substance: *this lesson is a teaching schematic based on a manual page; it does not replace the manufacturer's manual, nor the company's training and safety procedures; always follow the original manual before operating.* Exact wording through i18n; to be reviewed by the user.
7. **Numbering (Claude's call, played back):**
   - Page with a numbered drawing: the lesson follows it — same parts, same layout, same numbers.
   - Page with text only: the lesson builds a plausible schematic from the description and numbers it itself, saying so ("Numerazione della lezione, non del manuale").
8. **Writing style (user: style yes, dictionary no):** STE-like rules in every language — short sentences, imperative for instructions, one action per sentence, the warning before the step it concerns, the same word for the same thing throughout, no idioms. **No STE dictionary** is used or shipped.
9. **The final check "Sai riconoscerla?" (user: "va bene"):**
   - **Trova il pezzo:** the voice says "Tocca la girante"; the operator touches it on the 3D drawing (3–4 numbered parts).
   - **Segui il percorso:** touch, in order, the parts the water (or current, or motion) passes through, inlet to outlet. For an apparatus without a flow: put the steps of use in order.
   - **Trova il pericolo:** touch the hazard zones; each repeats its warning.
   - No marks or scores; a mistake shows the right answer with a short reason, and the operator can retry. Same mechanics as the storybook activities (touch, order) and the quiz; sober look.

## Non-goals (v1)

- Faithful CAD reconstruction of the real part. The 3D is a **schematic** built from a kit of typical parts; it says so.
- Copying the manual's drawing or text. The drawing is used only to understand the shape and layout of the parts; text is paraphrased (as everywhere in AnimaPage).
- Electronic boards and circuit diagrams, hydraulic/pneumatic P&ID schematics, whole vehicles, plants and production lines.
- Full repair procedures as the main content; torque tables, tolerances and specification sheets as content of their own.
- The STE dictionary and any claim of STE compliance.
- Real-time sensor data; AR overlay on the real machine (AR stays the generic AnimaPage AR).

## Anti-goals (would make it a failure even if it technically works)

- **Invented values or steps.** No torque, pressure, voltage, temperature, interval or procedure step that is not on the page. If a value is missing, the lesson says it is missing and points to the manual.
- **A schematic that looks like the real part**, so the operator trusts it as one.
- **Hazards that can be missed:** hidden by the labels setting, skipped by the tour, shown only in a card that starts folded, or not spoken.
- A beautiful animation that is not the apparatus on the page (the façade anti-goal: accuracy beats richness).
- A playful, childish look.

## Constraints

- The architecture stays: the AI writes a declarative scene (SceneSpec), the engine stages it; `update(chapterId, t)` stays pure.
- **Legal:** the fixed notice (Goal 6) is part of every `manual` lesson, also in exports (`.html`/`.wgt`).
- **Copyright:** manual texts and drawings are protected; paraphrase, never copy; no manufacturer logos or trademarks drawn.
- **Schema budget:** 30,000 characters for the generation schema (`server/src/generate/schema.ts`).
- **Frozen prompts (D26) and D16:** the generator and the prompt changes come later, in the shared recording batch with the façade, music and storybook theatres; until then the engine is built and tested on hand-written scenes and does not join `ANALYSIS_ENGINES`. Live LLM calls kept to a minimum (standing user rule).
- **Export (D27):** works offline in the exported `.html`/`.wgt`.
- **Performance:** smooth on a school board PC and a mid-range phone.
- **Languages:** the lesson is in the page's or the user's language like every lesson; app texts through the i18n catalogues (it, en, de, es, fr, pt); code and technical docs in English.
- Pop-up book (D12) and Accademico (D24) work as for every theatre.

## What was decided, and by whom

### Decided by the user

- A theatre for technical manuals; STE style, no dictionary.
- Audience: the operator who will work on the real apparatus.
- Goal: overall view and basic functions; hazards when dangerous.
- Lesson structure: Cos'è → A cosa serve → Funzioni base → Pericoli.
- Hazards placement: option B (short line in chapter 1, detail in the hazards chapter).
- The lesson does not replace the manual, with all the needed notices ("legal safe").
- Pages: both with a numbered drawing and with text only.
- v1 families: motors, household appliances, mechanical apparatus; motors include combustion engines with the four-stroke cycle.
- The final check "Sai riconoscerla?" as proposed.

### Claude's calls (played back to the user; they can still overturn them)

- A new engine `manual`, not an extension of `workshop` or `facade`: the data (numbered parts, flows, motions, hazards, controls) and the activity differ. It reuses the façade's line rendering where it fits.
- **The look:** dark lines on paper as in `facade` (silhouettes, creases, hatched section faces), plus **colour only for meaning**: flows (blue water/fluid, orange heat, yellow electric current, grey motion), hazard zones (red/amber tint) and the highlighted part. Same look in Colori and China. Sober type; no cartoon.
- The **three warning levels** and their colours.
- The numbering rule (Goal 7).
- In appliances, **the control panel is part of "Funzioni base"**: controls are touchable parts with their function.
- The final check reuses the storybook touch/order mechanics with a sober panel.

## The manual grammar (the data the AI writes)

Intent only; the exact zod schema is left to the builder, within the schema budget.

- **Parts:** `{ id, num?, name, kind, size, at, rot?, group?, explode? }`
  - `kind` from the kit (below); `size` and `at` in apparatus units; `group` for assemblies (motor, pump, panel).
  - `num`: the manual's number when the page has one; omitted otherwise (the engine numbers and the notice says so).
  - `explode`: the direction and distance a part slides in the exploded view.
- **Motions:** `{ part, kind: rotate | slide | reciprocate | swing, axis, speed? }`, pure in t.
- **Flows:** `{ medium: water | fluid | air | heat | current | motion, path: [part ids] }`, drawn as animated coloured lines through the parts.
- **Hazards:** `{ level: danger | warning | note, parts: [ids], text, sourceId? }`.
- **Controls** (appliances): `{ part, label, does }` — the touch shows and speaks what the control does.
- **Chapter actions:** show/hide parts, highlight, explode (0..1), section (plane, 0..1), run motions, run flows, focus camera.
- **Check:** `{ find: [ids], path?: [ids], order?: [step texts], hazards: true }`.
- **Missing data:** a field for "values the page does not give", so the narration can say so instead of inventing.

## The kit (what the engine draws)

Typical parts in lines, parametric: shaft, bearing, gear (spur, bevel), pulley and belt, spring, piston, connecting rod, crank, valve, cylinder/sleeve, casing (box, cylinder, volute), fan/impeller, coil/winding, stator/rotor, terminal box, pipe and elbow, hose, tank, drum, heating element, filter, seal, screw/bolt/nut, bracket/base, knob, button, switch, light/indicator, display, plug and cable. The builder may merge or extend within the v1 families.

## Views and camera

- **Overview:** the whole apparatus, orbitable (as every theatre).
- **Exploded:** parts slide apart along their `explode` vectors; numbers follow the parts.
- **Section:** a cut plane opens the casing; cut faces hatched (as the `facade` poché).
- **Flow overlay** and **motion** on top of any view.
- Animated camera moves between views, driven by chapter actions.

## Activity

The check in Goal 9 replaces Prevedi → Prova → Dimostra in this theatre for v1 (Claude's call; the builder may keep Prevedi available if a page suits it).

## Generator (later)

In the shared recording batch: the analysis step sends manual pages to `manual`; the page photo is attached to the generation request as for façades (a text-only generator would invent parts — the main anti-goal); the guide teaches the grammar, the STE-like style rules and the "no invented values" rule.

## Reference: the mockup

`.superpowers/brainstorm/245286-1794310940/content/manuali-struttura.html` (git-ignored): an invented electric centrifugal pump in four chapters, numbered parts 1–6, flow in blue, a hatched cutaway, hazard zones and the three warning levels, the fixed legal notice. The user picked option B for hazards there.

## Left to the builder

- The exact schema, units and kit parameters, within the budget.
- How much of the façade line renderer is shared vs copied.
- The legal notice's placement in the player and in exports (always visible, not covering the stage).
- Hand-written dev scenes: an electric pump, a washing machine, a gearbox and a single-cylinder four-stroke engine, with original texts and own numbering.
- Accessibility of the warnings (contrast, never colour alone: label text and shape).

## Settled after the builder check (Claude's calls)

1. **Legal notice:** a fixed i18n key rendered by the player (and the export shell) for every `manual` lesson. It is not part of SceneSpec, so a lesson cannot omit or change it. Claude drafts the wording in the six catalogues; the user reviews it before the merge (a text change only, no layout change).
2. **Hazards are enforced, not only suggested:**
   - "Dangerous" = the scene's `hazards` list is not empty.
   - `checkScene` reports an error (like the other semantic checks) when there are hazards but no hazards chapter, or no chapter-1 line, or a hazard part id that does not exist.
   - The player never folds or hides a warning: the labels setting does not apply to warnings, and the guided tour ("Visita guidata") and "Avanti da sola" (both exist) wait in the hazards chapter until its warnings have been read by the voice.
3. **The check reuses real code:** the storybook theatre's touch and order mechanics (`Engine.tap`, `play`/`choose`, the touch-play panel, `StampStore`; built on `feature/storybook-theatre`) — the manual theatre is built after that branch is merged. Picking by part id goes through `Engine.tap`; exploded and sectioned parts are picked where they are drawn. No stamp: a sober "Fatto" instead.
4. **Ids and numbers:** part ids are stable across views, flows, motions, hazards and the check. With a mixed page (some `num`, some not), the engine numbers the unnumbered parts after the highest manual number and marks those as lesson numbers. `order` steps must come from the page; the checker requires 2–6 steps.
5. **Purity:** camera, explode and section follow the façade's view-transition model (pure in chapter time); motions and flows are pure in t.
6. **Missing values:** data plus narration only ("Il manuale non indica la coppia di serraggio: consulta il manuale."); no new UI element.
7. **Kit v1:** a first cut of about 20 parts that covers the four dev scenes (electric pump with its motor, washing machine with its control panel, gearbox, single-cylinder four-stroke engine); the rest of the list later.
8. **Schema:** `manual` is an `EngineId` from the start, so the existing "schema dedupe is lossless and fits" test checks it against the 30,000-character budget; it does not join `ANALYSIS_ENGINES` until the recording batch.

## Combustion engines (user, 2026-11-10: "anche a scoppio")

Combustion engines are in v1. Their "Funzioni base" shows the **four-stroke cycle** (intake, compression, power, exhaust): piston, connecting rod and crankshaft moving, intake and exhaust valves opening in phase, the spark at the plug, the mixture and the exhaust gases as flows. This needs:

- a **phase** on motions, so several parts move in sync on one cycle (e.g. `{ part, kind, axis, cycle, phase }` with one cycle length per chapter), still pure in t;
- kit parts: piston, connecting rod, crankshaft, cylinder and head, intake/exhaust valve with cam, spark plug;
- a fourth hand-written dev scene: a single-cylinder four-stroke engine (e.g. a lawn mower's), with original texts;
- the stroke names shown as the cycle turns (i18n).

## Open questions for the user

None left from the design conversation. The legal notice wording will be shown to the user for review before the merge.
