# Handoff: prompt and schema changes for D24 (clock, timeline keywords, Accademico)

> **Status: done (2026-11-06, decision D25).** Clock part and `time` actions exposed with guide rules
> (stage, diorama); timeline keyword anchoring rules; `PageAnalysis.audience` + prompt line (`an-6`),
> used by `postprocess()` ahead of the `gradeLevel` fallback, `SceneBase.audience` still unexposed;
> register by audience in `guides/common.ts` rule 8 (`gen-6`); timeline axis years localised. Not done:
> the optional spoken-time vs clock server check (4), the clock in the stage reference example (5) and
> LaTeX in `book.formula` (c.3, the pop-up book draws it as raw text). Kept for its history.

Written 2026-11-06 by the agent that built the rendering side (decision D24). Everything below changes the
LLM requests (analysis prompt, generation guides/prompt, generation JSON schema), so the request hashes
change: do **all** of it in one go and re-record the mock fixtures (`fixtures/llm/`) **once**.

## How the new SceneSpec parts are hidden today

New fields and union variants are wrapped in `unexposed(...)` (`packages/scene-spec/src/unexposed.ts`).
zod accepts them, but `rawSceneSchema()` in `server/src/generate/schema.ts` drops every marked node
(zod `override` → `x-pv-unexposed` key → removed by `strip()`), so the generation schema is byte-identical
to before (checked for all 16 engines + the analysis schema). To offer a part to the model, **remove its
`unexposed(...)` wrapper**; nothing else in schema.ts needs to change. Then update the test
`generation schema: parts not offered to the model yet` (`server/test/generate.test.ts`), which asserts
that `clock`, `audience` and the `time` actions are absent, and re-check
`%s: fits the command line` (same file): stage and diorama grow by ~0.5 kB each.

Currently unexposed:

| Part | Where |
|---|---|
| `ClockShape` (`{ shape: "clock", time, face?, hours?, radius?, color?, hands? }`), a member of the diorama `Shape` union (so also of stage props) | `packages/scene-spec/src/clock.ts` |
| stage blocking `{ do: "time", prop, at, time, dur? }` | `packages/scene-spec/src/engines/stage.ts` (`StageAction`) |
| diorama action `{ do: "time", target, at, time, dur? }` | `packages/scene-spec/src/engines/diorama.ts` (`DioramaAction`) |
| `SceneBase.audience: "child" \| "teen" \| "adult"` | `packages/scene-spec/src/common.ts` |

## (a) Clock part

Engine side is done: `packages/engine/src/engines/diorama/clock.ts` (dial, hour + minute hands, ticks,
numerals, optional digital window), wired into the stage props and the diorama items; times evaluated by
`clockAt()` (pure, runs forward across 12:00/midnight). Validation: a `time` action on a prop/item that is
not a clock is an issue; `time` must match `HH:MM` (24 h).

To do:
1. Remove `unexposed(...)` from `ClockShape` and from both `time` actions (keep them built from fresh zod
   instances or not: no longer matters once exposed).
2. `server/src/generate/guides/stage.ts`, add (adapt the wording to the guide's style):
   > Clocks: never build a clock from boxes, spheres or text. Use a clock prop:
   > `{ "id": "orologio", "model": { "shape": "clock", "time": "07:00", "face": "analog" | "digital" | "both", "hours": 12 | 24, "radius": 0.5 }, "pos": [0, 1.1, -1.6] }`
   > (bottom-centred, facing the audience; `pos[1]` = height of its lower edge, a wall clock ~1.0–1.3).
   > The hands are computed: the hour hand moves with the minutes. Set the time for each moment with
   > blocking `{ "do": "time", "prop": "orologio", "at": 3, "time": "08:15" }`; add `"dur": 2` to let the
   > hands run forward to it (they never run backwards). Every chapter starts from the prop's own `time`.
   > The clock must show exactly the time the narration says at that moment (24 h in the data: 21:30 for
   > "half past nine" in the evening; `hours: 12` only changes the digital display). Anchor the pin on
   > `{ "entity": "prop", "part": "orologio.top" }`.
3. `server/src/generate/guides/diorama.ts`: same part for items (`model: { shape: "clock", ... }`) with the
   action `{ "do": "time", "target": "<itemId>", "at", "time", "dur"? }`.
4. Optional server check (`server/src/generate/checks.ts`): a sentence that states a time ("7:15",
   "seven o'clock", "alle sette e un quarto") while a clock is on stage should match
   `formatClock(clockAt(...))` at that sentence's `at` (helpers exported by `@pv/scene-spec`).
   The visual-check judge already treats a wrong clock as blocking (`server/src/check/judge.ts`).
5. Optional: a reference example with a clock (editing `fixtures/public/scenes/palcoscenico-dialogo.scene.json`
   changes the stage example in the prompt: fine, you re-record anyway).

## (b) Timeline keyword labels

Engine side is done (`packages/engine/src/engines/timeline/markers.ts`): every pin anchored with an
`offset` (on an event, a period or a year) and every `{ pos }` pin gets a small bead exactly at the label
point on a thin stem rising from the event's symbol, the period band or the axis; sideways offsets
(≥ 0.45 in x/z) stand on the plinth with a ground link to the event's disc. Labels therefore never float,
whatever the model writes; the model can still be guided to better layouts.

To do in `server/src/generate/guides/timeline.ts`:
1. Keywords, peoples and names that belong to an event or period: anchor them **on that event/period**
   (`{ "entity": "event", "part": "<id>" }`); several words about the same event: offsets **sideways**
   (x ±1.2–1.8, y 0.3–2.0, z 0) so their posts stand beside the symbol, at most 3–4 per event, with
   different heights so the beads do not overlap.
2. Do not anchor a keyword to `{ "entity": "year" }` unless it names that year (a year anchor with an
   offset now shows as a flag on the axis at that year: "Germani" at year 280 reads as "Germani = 280").
   Prefer the event/period it belongs to.
3. Found, not fixed (engine, not prompt): the axis tick labels use the Italian era format ("250 d.C.") in
   a Japanese lesson (`formatYear` in `packages/engine/src/engines/timeline/layout.ts` is not localised).

## (c) Accademico: who the lesson is for

Rendering side is done: the player picks Accademico for `audience: "adult"` (and, without an audience,
for maths/physics pages on university topics: `packages/engine/src/player/presentation.ts`), with the
user's override in Impostazioni. Until a model writes `audience`, the server derives it in
`postprocess()` (`server/src/generate/checks.ts`) from the analysis' free-text `gradeLevel`
(`audienceFromGrade()` in `packages/scene-spec/src/audience.ts`: università/university/college/大学 →
adult, primaria/primary/小学 → child, secondaria/high school/liceo/lycée/中学 → teen).

Recommended (cheaper than asking the generation model):
1. Add `audience: z.enum(["child", "teen", "adult"]).optional()` to `PageAnalysis`
   (`packages/scene-spec/src/analysis.ts`) and one line to the analysis prompt
   (`server/src/analyze/prompt.ts`, bump `PROMPT_VERSION` "an-5" → "an-6"): "audience: who the page is
   written for: child (primary school), teen (secondary school, up to the last school year), adult
   (university textbooks, professional or adult non-fiction); omit if unclear."
2. In `postprocess()`: `scene.audience ?? analysis.audience ?? audienceFromGrade(analysis.gradeLevel)`.
   `SceneBase.audience` can then **stay unexposed** (the generation model never needs to write it).
   If you prefer the generation model to write it instead, remove the wrapper in `common.ts` and add the
   rule to `server/src/generate/guides/common.ts` (bump `GENERATE_PROMPT_VERSION` "gen-5" → "gen-6").
3. Formulas: `BookPage.formula` and the engines' formula boards are typeset in Accademico from plain text
   (`texFromPlain()` in `packages/engine/src/util/math-text.ts` understands `·`, `²`, `√(...)`, `a/b`,
   Greek, `_x`, `^x`). Optional guide line for adult pages: "`book.formula` may be LaTeX between `$...$`
   (e.g. `$\int_a^b f(x)\,dx$`) when plain text cannot write it; never in narration". LaTeX with `\href`,
   `\url`, `\html…` or `\includegraphics` is refused by the player (shown as plain text).
4. Optional register rule for adults in `guides/common.ts` rule 8 (today: by `gradeLevel`): university
   pages can use the technical vocabulary and notation of the page, no "tu" invitations.

## Checklist for the re-recording
- `pnpm typecheck` and `pnpm test` green before recording (the mock replay will fail on every changed
  request until the fixtures are re-recorded; record in one session).
- Bump `PROMPT_VERSION` / `GENERATE_PROMPT_VERSION` if the prompts change (page cache keys follow them).
- After recording: the `fits the command line` test for stage and diorama; the unexposed-parts test updated.
