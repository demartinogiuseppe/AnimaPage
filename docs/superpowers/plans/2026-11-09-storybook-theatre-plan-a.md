# Storybook theatre — Plan A (theatre, sounds on the word, activities, seed library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `storybook` theatre for young children's story pages. It has:
- a cartoon look;
- characters that appear, move and speak with their own voices;
- sounds that start on the word the voice is saying, and a word-by-word highlight;
- touch activities: touch-to-hear, letter hunt, big to small, colouring.

It also builds the sound pipeline, a listening page for the user, and a seed library of about 40–60 CC0 sounds. Everything is proven on hand-written scenes.

**Architecture:**
- **The grammar.** A compact zod grammar in `@pv/scene-spec` (`engines/storybook.ts`): characters from a catalogue, acts in chapter time, word cues addressed as (sentence, word), one touch activity per chapter. It is staged by an engine in `packages/engine/src/engines/storybook/`.
- **Sounds.** Each sound is a *variant group* (`train-whistle`). The engine picks one concrete variant per lesson, deterministically, and plays it through the existing audio path under the id `sb:<variant>`. So the director, the cue tracker, ducking and export all keep working.
- **New optional `Engine` hooks:**
  - `sounds?` gives the engine's ambience and cues;
  - `words?` gives the word timeline;
  - `tap?` and `animate?` handle touch and transient reactions;
  - `play?` and `choose?` drive the activity panel.

  Every other engine is unaffected.

**Tech Stack:**
- TypeScript strict, zod 4, three.js 0.187, vitest + happy-dom, pnpm 9 monorepo (`@pv/*`);
- Web Speech (`boundary` events);
- ffmpeg 9 (system install, already used for `docs/assets-audio.md`);
- playwright-core with system Chrome, for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-09-storybook-theatre-design.md` (D29). Read it first, especially "Builder check: answers and Claude's calls", which settles the library phases, the separate catalogue, the precomputed word timeline, the letter hunt, session-only colouring and no Freesound account.

## Before you start

- **Worktree:** `../wt-storybook-theatre` (a sibling of the repository folder), branch `feature/storybook-theatre`. `main` (export runtime, light China style) is already merged in (336dc4e).
- **Setup:** run `pnpm install` once, then `pnpm test` to record the baseline (all green).
- **Private photos:** link `fixtures/pages` (git-ignored) from the main checkout as a directory junction if the recorded-generation tests need it, as in the façade worktree. Never copy, open or commit the photos.
- **Commands** (from the worktree root):
  - one test file: `pnpm vitest run <path>`;
  - type check: `pnpm typecheck`;
  - everything: `pnpm test`.
- **Karpathy skill:** load `andrej-karpathy-skills:karpathy-guidelines` before writing code (standing user rule).
- **Styler opt-out, copied from the façade branch.** The façade branch (`feature/facade-theatre`) adds `isInkSelf` to `packages/engine/src/book/ink.ts`. Task 5 adds **the identical hunk** (same text, below), so the two branches merge cleanly:

  ```ts
  /** userData.inkSelf on the object or an ancestor, up to (excluding) `stop`: the content draws its own lines. */
  export function isInkSelf(o: THREE.Object3D, stop: THREE.Object3D | null): boolean {
    for (let x: THREE.Object3D | null = o; x && x !== stop; x = x.parent) if (x.userData?.inkSelf === true) return true;
    return false;
  }
  ```

  In `InkStyler`, the line is `if (!first || isInkSelf(mesh, this.root)) return;`.

## Global Constraints

- `update(chapterId, t)` must be a pure function of (chapterId, t) plus the user's overrides (activity progress, colours). No `Math.random`, no accumulated timeline state. Touch reactions (bounce, wobble) are transient effects driven by `animate(now)`; they decay to zero and never change the state at a given t.
- **No live LLM calls.** Do not edit:
  - `ANALYSIS_ENGINES` (`packages/scene-spec/src/analysis.ts`);
  - `server/src/analyze/prompt.ts`, `server/src/generate/guides/*`, `server/src/generate/example.ts`;
  - anything under `fixtures/llm`.

  The generator comes later, in the shared recording batch (D16/D26).
- **Do not change shared schemas.** `Sentence`, `SoundCue`, `Ambience`, `Chapter` and `SceneBase` in `packages/scene-spec/src/common.ts` stay as they are: they are in every engine's generation schema and in the frozen prompts. `SOUND_CATALOG` (`packages/scene-spec/src/sounds.ts`) is untouched too.
- **Schema budget.** The storybook engine data must fit the generation schema budget of 30,000 characters (`server/src/generate/schema.ts`). `server/test/generate.test.ts` "schema dedupe is lossless and fits" runs for every `EngineId`.
- **Licences.** Every sound and model is CC0, with the licence checked on the source page and recorded in `docs/assets-audio-storybook.md`. Excluded sources: Sonniss, Zapsplat, Pixabay, AI generators. **Freesound is not used in Plan A.** The user chose no account and "previews are enough", but the Freesound API needs a free key even to search and get the preview links. If the user later provides a key (in `server/.env`, set by the user), `sources.json` gains a Freesound entry; nothing else changes.
- **Downloads need permission.** Downloading sound packs is an action that needs the user's explicit permission. The implementer prepares the list (file, source URL, size) and stops; the controller asks the user.
- **Copyright of the reference page.** The page's story text is protected. Committed scenes tell **original** stories in our own words, and nothing is copied from the reference page.
- **Children first:**
  - no harsh or sudden loud sounds: effects peak at −3 dBFS max, ambience −24 LUFS-ish (RMS −22 dBFS);
  - no "wrong" buzzer: a mistaken touch gets a gentle wobble;
  - big touch targets;
  - few buttons.
- **Ducking.** Every cue ducks under the voice, as today (`DUCK_LEVEL`).
- **Language.** Code, comments and technical docs are in English. App text is in Italian through the i18n catalogues (`packages/scene-spec/src/i18n/messages/{it,en,de,es,fr,pt}.ts`, key parity test).
- **Line endings.** Files are LF (`git ls-files --eol`).
- **Performance.** The lesson must stay smooth on a school board PC and a mid-range phone. Audio is OGG Vorbis mono and short (effects ≤ 4 s, ambience loops ≤ 20 s). The storybook audio folder has its own budget: 12 MB for the seed library.
- **One subagent at a time** (standing user rule).

## Review Focus

1. **Voices without `boundary` events, and very slow or fast voices.** Word cues still fire in sentence order, never after the next sentence has started. The highlight never jumps backwards. Tests in Task 3 and Task 4.
2. **Seeking backwards, pausing mid-sentence, tapping a sentence to replay it.** A word cue never fires twice in one pass, and the highlight follows t. Test in Task 3.
3. **A child hammering the same character.** Sounds don't pile up: at most one sound per character every 300 ms, and at most 3 effects at once. Bounces don't grow: the scale returns to 1. Test in Task 7.
4. **A missing or undecodable variant file, or a group whose variants are all synthesised.** The sound still plays, through the synth fallback, and nothing throws. An unknown group id is a checker issue. Tests in Task 2.
5. **A drag that orbits the camera.** It is never a tap. A tap on empty space does nothing. Test in Task 7.

---

### Task 1: Grammar, catalogues, checks, registration

**Files:**
- Create: `packages/scene-spec/src/engines/storybook.ts`
- Create: `packages/scene-spec/src/storybook-sounds.ts` (the variant *groups* the generator sees; no files)
- Modify, for registration:
  - `packages/scene-spec/src/index.ts`: `EngineId`, the `SceneSpec` union, the `checkScene` dispatch;
  - the smoke test EngineId list;
  - i18n `theatre.storybook` ("Storie") in 6 catalogues;
  - `apps/web/src/archive.ts` `THEATRES` and icon;
  - the `createEngine` switch, with an engine skeleton.

  Follow how `solid` or `workshop` were registered: `grep -rn "\"workshop\"" packages apps server --include=*.ts`.
- Create: `fixtures/public/scenes/_dev-storie.scene.json`. It is a dev scene with an **original** whale-and-boat story, letter B, at least one of every act and one of every activity.
- Test: `packages/scene-spec/test/storybook.test.ts`

**Interfaces:**
- Produces in `storybook-sounds.ts`:
  ```ts
  export const STORY_THEMES = ["sea", "transport", "animals", "cartoon", "nature", "home", "music", "people", "magic", "weather"] as const;
  export interface StoryGroup { id: string; theme: StoryTheme; kind: "ambience" | "sfx"; it: string; en: string; words: { it: string[]; en: string[] } }
  export const STORY_SOUND_GROUPS: readonly StoryGroup[];
  export function storyGroup(id: string): StoryGroup | undefined;
  export function wordMatchesGroup(word: string, g: StoryGroup, lang: "it" | "en"): boolean;
  ```
  - `STORY_SOUND_GROUPS` holds the seed groups for the reference stories, at least: `waves`, `whale-spout`, `boat-creak`, `splash`, `seagull-call`, `train-whistle`, `train-chug`, `train-bell`, `cat-meow`, `chick-peep`, `dog-woof`, `cow-moo`, `birds`, `wind-soft`, `boing`, `pop`, `slide-whistle`, `sparkle`, `ball-bounce`, `hammer-tap`, `cup-clink`, `apple-crunch`, `umbrella-open`, `xylophone-up`, `xylophone-down`, `ta-da`.
  - `words` lists every form a story may use: Italian "treno, trenino, treni, locomotiva…".
  - `wordMatchesGroup`: normalise both sides (lower case, strip accents and punctuation). A word matches if it equals a listed form, or if it shares a common prefix of at least 4 letters with one ("trenino" ~ "treno").
- Produces in `engines/storybook.ts` (field names binding; limits are the implementer's choice within the schema budget):
  ```ts
  StorybookData = {
    letter?: string;                         // one capital letter A–Z: the page's letter
    characters: StoryCharacter[];            // 1..12
    chapters: StoryChapter[];
  }
  StoryCharacter = { id: Id; model: string /* STORY_CHARACTERS id */; at: [x, z]; scale?: number; colour?: "#rrggbb"; name?: string /* Italian display name; default the catalogue's */ }
  StoryChapter = {
    chapter: Id;
    place: "sea" | "meadow" | "rails" | "sky";
    ambience?: string[];                      // group ids, whole chapter
    acts?: StoryAct[];
    play?: StoryPlay;
  }
  StoryAct =
    | { do: "appear"; who: Id; at: number; sound?: string | false }   // pop with bounce; default sound = the character's group
    | { do: "move"; who: Id; at: number; dur: number; to: [x, z]; gait?: "glide" | "hop" | "swim" | "roll" | "rock" }
    | { do: "react"; who: Id; at: number; how: "jump" | "spin" | "laugh" | "wobble"; sound?: string }
    | { do: "row"; who: Id[]; at: number; every: number }             // pop one by one, each with its sound
    | { do: "sound"; group: string; sentence: number; word: number }  // cue ON the word (0-based word of narration[sentence].text)
    | { do: "ambience"; group: string; at: number; until?: number };
  StoryPlay =
    | { kind: "touch"; prompt: string; stamp: string }
    | { kind: "letter"; prompt: string; targets: Id[]; stamp: string }
    | { kind: "order"; prompt: string; order: Id[] /* biggest to smallest */; stamp: string }
    | { kind: "color"; prompt: string; who: Id; stamp: string };
  ```
- Produces `STORY_CHARACTERS` (in `engines/storybook.ts`):
  ```ts
  { id: string; it: string; en: string; size: 1 | 2 | 3 | 4 | 5; source: { model: string /* DIORAMA_CATALOG id */ } | { proc: ProcId }; sound?: string /* group */; parts?: string[] /* colourable */ }
  ```
  - `size` runs from 1 (tiny) to 5 (huge).
  - `ProcId` = `"whale" | "sailboat" | "caterpillar" | "umbrella" | "ball" | "train" | "sun" | "cloud"`. Only procedural characters have `parts`.
  - The Kenney models already in `fixtures/public/models` cover cat, chick, dog, cow, pig, bunny, fish, bee, crab, penguin, elephant, giraffe, lion, monkey, parrot, apple, mug ("tazza"), hammer, and trees.
- Produces `checkStorybookData(data, scene): Issue[]` (readable issues, never a throw):
  - duplicate or unknown ids;
  - unknown model or group;
  - word index out of range for that sentence;
  - **a word cue whose word does not match its group** (`wordMatchesGroup` false: "a sound that does not match its word is worse than nothing");
  - `letter` targets whose Italian name (character `name` or catalogue `it`) does not start with `letter`;
  - an `order` that is not strictly decreasing in `size × scale`;
  - `color` on a character without `parts`;
  - a voice-less speaker: a `Sentence.speaker` with no `SceneBase.voices` entry;
  - acts after the chapter's duration.

  A character whose id equals a `voices` id talks (a bob) during that speaker's sentences, so no extra act is needed.

- [ ] **Step 1: Write the failing tests:**
  - `"the dev scene parses and checks clean"`;
  - `"word cues must match their group"`: "fischio" on `train-whistle` passes, "macchina" on `train-whistle` gives an issue;
  - `"wordMatchesGroup handles forms and accents"`: trenino/treno, città/citta, uccellini/uccello;
  - `"letter targets must start with the letter"`: balena, barca, bruco pass for B, gatto gives an issue;
  - `"order must go from biggest to smallest"`;
  - `"color needs a character with parts"`;
  - `"word index out of range is reported"`;
  - `"unknown group and model ids are reported"`.

  The existing server test "schema dedupe is lossless and fits" must stay green with `storybook` in `EngineId`.
- [ ] **Step 2: Run** `pnpm vitest run packages/scene-spec/test/storybook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the grammar, the catalogues, the checks, the registration and the engine skeleton (builds an empty group; `update` is a no-op).
- [ ] **Step 4: Run** the file, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(storybook): grammar, character and sound-group catalogues, checks, registration"`.

---

### Task 2: Variant library and deterministic choice

**Files:**
- Create: `packages/engine/src/engines/storybook/library.ts`. It is generated by the pipeline (Task 9) from Task 10 on; in this task it is written by hand, synth-only.
- Create: `packages/engine/src/engines/storybook/sounds.ts`
- Modify:
  - `packages/engine/src/player/audio/library.ts`: add `soundSource(id)`; `soundFile(id)` learns `sb:` ids;
  - `packages/engine/src/player/audio/webaudio.ts` (~:290): use `soundSource`;
  - `packages/engine/src/player/audio/synth.ts`: new synth kinds for cartoon effects if needed: `boing`, `slide`, `peep`, `meow`, `moo`, `whistle-train`, `chug`;
  - `packages/engine/src/export/assets.ts`: `soundSource` for every sound, plus `case "storybook"` for character models and resolved variant files.
- Test: `packages/engine/test/storybook-sounds.test.ts`

**Interfaces:**
- `STORY_LIBRARY: Readonly<Record<string /* variant id */, { group: string; file: boolean; synth: Synth; dur: number }>>`. Every group in `STORY_SOUND_GROUPS` has at least one variant: synthesised now, files from Task 10.
- Sound ids on the audio path are `sb:<variant>`:
  - file `audio/storybook/<variant>.ogg`;
  - `soundSource("sb:x")` returns `{ file, synth }` from `STORY_LIBRARY`;
  - every other id behaves exactly as today.
- `lessonSeed(spec: SceneSpec): number`: FNV-1a 32-bit of `spec.title + "|" + chapter ids joined by ","`.
- `pickVariant(group: string, seed: number, occurrence: number): string`: the `sb:` id. It is deterministic; the occurrence-th use of a group in a lesson rotates through the variants starting at `seed % n`, so the same sound twice in a row sounds different.
- `storySoundsOf(spec): Map<chapterId, { ambience: Ambience[]; cues: SoundCue[]; words: WordCue[] }>`, where `WordCue = { sentence: number; word: number; cue: SoundCue }` and `cue.at` is filled in by Task 3. This one pure function is shared by the engine hook and by `assetsOf`, so the export embeds exactly the variants the lesson plays.

- [ ] **Step 1: Write the failing tests:**
  - `"same lesson, same variants; different lessons, different variants"`: two specs differing only in title pick a different variant for at least one group of a 3-variant group set;
  - `"a group used twice in a row gets two different variants"` (n ≥ 2);
  - `"every group has a variant and every variant a synth fallback"`;
  - `"sb: ids resolve to audio/storybook/<variant>.ogg; other ids unchanged"`;
  - `"assetsOf a storybook scene lists its models and exactly its file variants"`;
  - `"an undecodable sb: file falls back to its synth"` (webaudio loader test pattern in `packages/engine/test/webaudio-loader.test.ts`). This is Review Focus 4.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/storybook-sounds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `pnpm test` (the existing audio-library budget test still covers only `fixtures/public/audio/*.ogg` at the top level). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(storybook): variant library, deterministic choice per lesson, sb: ids on the audio path"`.

---

### Task 3: Word timeline, engine sounds, word-by-word highlight

**Files:**
- Create: `packages/engine/src/util/words.ts`
- Modify: `packages/engine/src/types.ts`: optional hooks `sounds?` and `words?`.
- Modify: `packages/engine/src/player/audio/director.ts`, which merges engine sounds with the chapter's own.
- Modify: `packages/engine/src/player/player.ts`:
  - word spans and highlight in the narration text when `engine.words` is present;
  - a `pv-story` class on the player root for `spec.engine === "storybook"`, giving big type and few buttons;
  - storybook lessons always use the pop-up book: the Accademico presentation is not offered (spec, D12/D24), even with `audience: "adult"`.
- Modify: `packages/engine/src/player/styles.ts` (word highlight and `pv-story` styles).
- Modify: `packages/engine/src/engines/storybook/index.ts`, implementing `sounds` and `words`.
- Test: `packages/engine/test/words.test.ts`, `packages/engine/test/audio-director.test.ts` (new cases), `packages/engine/test/player-words.test.ts`

**Interfaces:**
- `splitWords(text: string): { word: string; start: number; end: number }[]`: character ranges in `text`. Words are runs of letters, digits and apostrophes (Italian elisions such as "l'acqua" count as one word).
- `wordTimes(text: string, lang: string | undefined, rate: number): number[]`: seconds from the sentence start to each word's start. It uses the same reading-speed model as `timedDurationMs` in `player/tts.ts`, which is 340 ms per speech unit (1500 ms minimum per sentence), divided by `rate / NARRATOR_RATE`, and spread over the words by their speech units. Where a speech-unit helper is needed, reuse the one in `tts.ts`; do not copy it.
- **Cue times.** A word cue's `at` = `s.at + wordTimes(...)[word]`, clamped to `nextSentence.at − 0.05` (or the chapter duration). The clock freezes at the next sentence's `at` while the voice is still speaking (`playback.ts`), so an unclamped cue would fire late.
- **Engine hooks:**
  - `sounds?(chapterId): { ambience: Ambience[]; cues: SoundCue[]; words: WordCue[] } | null`. The director adds them to the chapter's own; ambience follows `ambienceAt`; cues go through the same `CueTracker` (seeks never fire).
  - `words?(chapterId): number[][] | null`: per sentence, the word start offsets used for the highlight.
- **Highlight.** The player wraps each word of the current sentence in a span. The active word is the last one with `s.at + offset ≤ t`, and it gets `pv-word-on`. Sentences without word timings render as today.

- [ ] **Step 1: Write the failing tests:**
  - `"splitWords keeps elisions and drops punctuation"`;
  - `"wordTimes grows monotonically and scales with the rate"`;
  - `"a word cue fires on its word, before the next sentence"`: drive `Playback` with `FakeTts` plus an `AudioDirector` with a recorder; the cue fires within [s.at + offset, next.at);
  - `"a slow voice: the cue never fires after the next sentence starts"` (Review Focus 1);
  - `"seek back and replay: a word cue fires once per pass"` (Review Focus 2);
  - `"the highlighted word follows t and never moves backwards while playing"` (Review Focus 1);
  - `"engines without the hooks behave as before"`: a director snapshot with a `diorama` scene is unchanged.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/words.test.ts packages/engine/test/audio-director.test.ts packages/engine/test/player-words.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(storybook): word timeline, engine sounds and word cues, word-by-word highlight"`.

---

### Task 4: Live word boundaries

**Files:**
- Modify: `packages/engine/src/player/tts.ts`:
  - `TtsProvider.speak` gains an optional last parameter `onWord?: (charIndex: number) => void`;
  - `WebSpeechTts` forwards `boundary` events with `name === "word"`;
  - `FakeTts` can emit boundaries in tests.
- Modify: `packages/engine/src/player/playback.ts`, which passes `onWord` through for the current sentence.
- Modify: `packages/engine/src/player/audio/director.ts`, adding `wordReached(sentence, word)`.
- Modify: `packages/engine/src/player/player.ts`, where the highlight prefers live boundaries.
- Test: `packages/engine/test/word-boundary.test.ts`

**Interfaces:**
- `onWord` gives a char index in the spoken text. It is mapped to a word index with `splitWords`, **only when the sentence has no `speech` override**: with an override the char indices refer to other text, so the estimate stays in charge.
- `AudioDirector.wordReached(sentence, word)` fires the word cues of that (sentence, word) that have not fired yet in this pass. A cue then fires at the earlier of its boundary and its estimated time, and never twice in one pass. Fired keys are cleared on `load`, on a seek and on a jump to a sentence.
- The highlight takes the boundary's word while the sentence is speaking, but never earlier than the word already shown. Without boundaries, Task 3's estimate drives it.

- [ ] **Step 1: Write the failing tests:**
  - `"a boundary before the estimate fires the cue early, and the estimate does not fire it again"`;
  - `"no boundaries: the estimate fires it"`;
  - `"a sentence with a speech override ignores boundaries"`;
  - `"boundaries after a seek count only for the sentence being spoken"`;
  - `"the highlight follows boundaries and never goes back"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/word-boundary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(player): live word boundaries re-align word cues and the highlight"`.

---

### Task 5: The look: toon characters, outlines, places

**Files:**
- Create in `packages/engine/src/engines/storybook/`:
  - `toon.ts`: toon material and outline;
  - `characters.ts`: Kenney models converted, plus the procedural characters;
  - `places.ts`: sea, meadow, rails, sky.
- Modify: `packages/engine/src/book/ink.ts` (the `isInkSelf` hunk from "Before you start"), `packages/engine/src/engines/storybook/index.ts` (build).
- Modify: `fixtures/public/scenes/_dev-storie.scene.json` if needed.
- Test: `packages/engine/test/storybook-look.test.ts`

**Interfaces:**
- **Toon materials:**
  - `toonMaterial(colour: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshToonMaterial`, with a 2-step gradient map (at most two tones) built once and shared;
  - `addOutline(mesh: THREE.Mesh, px: number): void`, an inverted-hull outline in screen pixels, dark (`#1f1a17`), 2.5 px at a 1280×800 drawing buffer, scaled with the pixel ratio.
- **Characters.** `buildCharacter(def: StoryCharacterDef, models: Map<string, LoadedModel | null>): { obj: THREE.Group; parts: Map<string, THREE.Mesh[]> }`.
  - Kenney GLBs are loaded with `diorama/models.ts` (`loadModels`, `instantiate`); their materials are swapped for `toonMaterial(colour, map)`.
  - Procedural characters are built from round primitives in bright flat colours:
    - whale: body with a lighter belly, tail, fins and eye;
    - sailboat: hull, mast, sail and a little flag;
    - caterpillar: 5–7 spheres in a row with antennae;
    - umbrella: canopy in 8 coloured panels and a hooked stick;
    - ball: two-colour stripes;
    - train: locomotive with chimney, cab and wheels, plus 2 wagons;
    - sun with rays;
    - puffy cloud.

    Their `parts` are named meshes (for colouring).
- **Places.** `buildPlace(place, size): THREE.Group`, bright and simple:
  - sea: a blue water plane whose waves move with the chapter t (pure), plus a sky;
  - meadow: green ground with a few flowers;
  - rails: meadow plus a rail track along x;
  - sky: clouds and the sun.
- **Styler opt-out.** The whole engine content carries `userData.inkSelf = true`: the China style never restyles it (spec: colour is the point here).

- [ ] **Step 1: Write the failing tests:**
  - `"every procedural character builds, has its named parts, and is centred on its base"`;
  - `"toon materials have at most two tones"` (gradient map size);
  - `"every character mesh has an outline"`;
  - `"China style leaves storybook content alone"`: an `InkStyler` pass keeps the toon materials;
  - `"places build, and sea waves are a pure function of t"`;
  - `"the dev scene builds with placeholders in Node"` (models disabled in Node, as in diorama tests).
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/storybook-look.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Visual sign-off.**
  - Take screenshots of `?scene=_dev-storie`: every place, the catalogue of characters in a row, and a close-up of the whale, the boat and the caterpillar. Use Chrome at 1280×800 and the pop-up book.
  - The controller sends them to the user. **Stop until the user approves the look**, and fold the requested changes into this task.
- [ ] **Step 6: Commit** `git commit -m "feat(storybook): cartoon look — toon characters with outlines, places"`.

---

### Task 6: Acts in chapter time

**Files:**
- Create: `packages/engine/src/engines/storybook/acts.ts`, holding the pure state at (chapter, t).
- Modify: `packages/engine/src/engines/storybook/index.ts`: `update`, `resolveAnchor` (entity = character id; parts `head`, `top`, `center`), `anchorShown`, `bounds`, `sounds` (appear, react and row sounds become cues).
- Test: `packages/engine/test/storybook-acts.test.ts`

**Interfaces:**
- `storyStateAt(ch: StoryChapter, chars: StoryCharacter[], narration: Sentence[], t: number): Map<Id, { shown: number /* 0..1 pop */; pos: [x, z]; yaw: number; squash: number; bob: number }>`. The rules:
  - **Appear:** absent before `at`, then a 0.45 s bouncy pop (overshoot ≈ 1.15).
  - **Move:** eased over `dur`. Each gait adds its own motion, all pure in t:
    - `hop`: little arcs;
    - `swim`: a gentle sine in y;
    - `rock`: roll ± 8°;
    - `roll`: wheels or ball spin.
  - **React:** 0.6 s.
  - **Row:** item k appears at `at + k × every`.
  - **Speaking bob:** while a sentence whose `speaker` equals the character's id is current, the bob is a small up-and-down at 3 Hz.
  - **Idle wobble:** every character gently breathes.
  - **Spout:** the whale spouts on its `appear` and `react`; a small particle fountain driven by t.
- Characters not named by any `appear` act are present from t = 0.

- [ ] **Step 1: Write the failing tests:**
  - `"appear: absent before, popping during, present after"`;
  - `"scrubbing backwards gives the same scene"`: snapshot at t = 4 after visiting t = 9 equals the fresh snapshot at t = 4;
  - `"row items appear one by one, each with its cue"`;
  - `"the speaker bobs only during its own sentences"`;
  - `"anchors on characters resolve and wait for their appear act"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/storybook-acts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: See it.** Take three screenshots of the dev scene mid-story (an appear pop, a row half done, the whale spouting) for the reviewer.
- [ ] **Step 6: Commit** `git commit -m "feat(storybook): appear, move, react, row and speaking acts; ambience and act sounds"`.

---

### Task 7: Touch

**Files:**
- Modify: `packages/engine/src/types.ts`, adding the optional hooks `tap?` and `animate?`.
- Modify: `packages/engine/src/player/stage.ts`, adding `pickRay(clientX, clientY): THREE.Ray | null` in root-local coordinates.
- Modify: `packages/engine/src/player/player.ts`:
  - tap detection on the canvas;
  - calls to `engine.tap` and plays the returned sound through the effects bus;
  - calls to `engine.animate(now)` every frame after `update`.
- Create: `packages/engine/src/engines/storybook/touch.ts`
- Test: `packages/engine/test/storybook-touch.test.ts`, `packages/engine/test/player-tap.test.ts`

**Interfaces:**
- `tap?(chapterId: string, t: number, ray: THREE.Ray, now: number): { sound?: string } | null`. It returns the `sb:` id to play: a character's own group, varied per tap by an occurrence counter.
- `animate?(now: number): void`. It applies transient reactions (squash-and-stretch bounce 0.35 s, wobble 0.5 s) on top of `update`'s state. They decay to zero and never touch timeline state.
- **Tap rule:** pointerdown → pointerup within 350 ms and within 8 px of movement, primary button or touch. Anything else is a drag (orbit) and is never a tap.
- **Limits:**
  - the same character makes at most one sound every 300 ms (a bounce without sound in between);
  - at most 3 tap effects sound at once (drop the oldest request);
  - the bounce scale is reset from its start each time, never multiplied.

  This is Review Focus 3.
- Taps work while playing and while paused.

- [ ] **Step 1: Write the failing tests:**
  - `"a tap on a character returns its sound and starts a bounce that ends at scale 1"`;
  - `"hammering one character: one sound per 300 ms, scale never exceeds the bounce peak"` (Review Focus 3);
  - `"a tap on empty space returns null"` (Review Focus 5);
  - `"a drag of 20 px is not a tap"` (Review Focus 5, the player-tap test);
  - `"update(chapterId, t) gives the same state with or without taps"` (purity).
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/storybook-touch.test.ts packages/engine/test/player-tap.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(storybook): touch to hear — tap hook, bounce and wobble, sound limits"`.

---

### Task 8: Activities: letter hunt, big to small, colouring, stamp

**Files:**
- Create: `packages/engine/src/engines/storybook/play.ts` (activity state, pure given its inputs)
- Create: `packages/engine/src/player/touch-play-ui.ts` (the activity panel: prompt, big letter, palette, progress dots)
- Modify:
  - `packages/engine/src/types.ts`: hooks `play?` and `choose?`;
  - `packages/engine/src/player/player.ts`: show the panel at the chapter's end and award the stamp through the existing `StampStore` and stamp UI (see `book/activity.ts` and `player.ts` ~301–320);
  - `packages/engine/src/player/styles.ts`;
  - i18n catalogues for the panel's fixed texts.
- Test: `packages/engine/test/storybook-play.test.ts`, `packages/engine/test/touch-play-ui.test.ts`

**Interfaces:**
- `play?(chapterId: string): TouchPlayView | null`, where `TouchPlayView = { kind: "touch" | "letter" | "order" | "color"; prompt: string; letter?: string; palette?: string[]; picked?: number; progress: { done: number; total: number }; stamp: string; complete: boolean }`.
- `choose?(chapterId: string, value: number): void`: the palette swatch the child picked.
- **Behaviour.** A tap during an active play goes to the activity:
  - **letter:** a target bounces with a `xylophone-up` note and is marked; a non-target wobbles with a soft `boing`. There is no buzzer.
  - **order:** the right next character gets a number badge (1, 2, 3…) and a rising note; a wrong one wobbles.
  - **color:** a tapped part of `who` fills with the picked colour, chosen from 6 bright colours (red, orange, yellow, green, blue, purple).
  - **touch:** every character touched once.
- **When it's complete:** `ta-da` plays, the stamp is awarded, and the panel shows the stamp.
- **Colours are session-only (user decision).** They are kept in the engine instance while the lesson is open, across chapter changes, and never saved or exported.
- Touch-to-hear (Task 7) works outside the activity, always.

- [ ] **Step 1: Write the failing tests:**
  - `"letter hunt completes when every target is found; non-targets never count"`;
  - `"big to small accepts only the next in order and completes at the end"`;
  - `"colouring fills the tapped part with the picked colour and completes when every part is coloured"`;
  - `"colours survive a chapter change and are not in any saved state"`;
  - `"the panel renders prompt, big letter, palette and progress, and the stamp on completion"` (happy-dom);
  - `"a mistaken touch never plays the quiz 'wrong' sound"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/storybook-play.test.ts packages/engine/test/touch-play-ui.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Visual sign-off.**
  - Take screenshots of each activity in the dev scene: the letter hunt half done with the big B, the order with badges, colouring with the palette and a half-coloured whale, and the stamp.
  - The controller sends them to the user. **Stop until the user approves.**
- [ ] **Step 6: Commit** `git commit -m "feat(storybook): letter hunt, big to small, colouring; touch activity panel and stamp"`.

---

### Task 9: Sound pipeline and listening page

**Files:**
- Create in `tools/sounds/`:
  - `sources.json`: a hand-curated manifest of CC0 packs and pages per theme: Kenney packs, OpenGameArt CC0 packs, BigSoundBank pages. Each entry has its URL, author and the licence as read on the page, plus the date checked.
  - `fetch.ts`: downloads into the git-ignored `tools/sounds/cache/`. It refuses to run without `--approved`, and `--dry` prints the file list with sizes.
  - `process.ts`: ffmpeg trim, normalise and encode, then the rejection rules.
  - `listen.ts`: a local listening server.
  - `accept.ts`: writes the kept candidates into the library.
- Modify: `package.json` scripts: `sounds:fetch`, `sounds:process`, `sounds:listen`, `sounds:accept`.
- Modify: `.gitignore`: `tools/sounds/cache/`, `tools/sounds/candidates/`.
- Create: `docs/assets-audio-storybook.md` (licences, processing, the listening workflow).
- Test: `tools/sounds/test/process.test.ts` (on short synthetic WAVs made in the test with ffmpeg's `sine` and `anullsrc` sources)

**Interfaces:**
- `process.ts` writes candidates to `tools/sounds/candidates/<theme>/<group>-<n>.ogg` and a sheet `candidates/<theme>.json`: `{ group, file, source, author, licence, dur, peakDb, rmsDb, reason? }`. The rules:
  - **Trim:** leading and trailing silence below −50 dBFS.
  - **Effects:** peak normalised to −3 dBFS; ≤ 4 s, longer files get a 0.3 s fade-out.
  - **Ambience:** RMS normalised to −22 dBFS; loops of 8–20 s with an equal-power crossfade.
  - **Encoding:** OGG Vorbis mono 32 kHz `-q:a 2`.
  - **Rejected and listed with a reason:** clipped (more than 0.1 % of samples at full scale), too quiet after normalisation (RMS below −40 dBFS), too long, or mono-silent.
- `listen.ts` serves on `127.0.0.1:5175` only. For each theme it shows one big play button per candidate, Keep and Discard buttons, a "Next theme" button and a counter. Decisions are POSTed to the server and written to `candidates/<theme>.decisions.json`. It is text in Italian; no external network.
- `accept.ts`:
  - copies the kept files to `fixtures/public/audio/storybook/<group>-<n>.ogg`;
  - regenerates `packages/engine/src/engines/storybook/library.ts`: variants with `file: true` and their synth fallback kept, as in `audio/library.ts`;
  - appends rows to `docs/assets-audio-storybook.md`.

- [ ] **Step 1: Write the failing tests:**
  - `"silence is trimmed and effects peak at −3 dBFS"`;
  - `"a clipped file is rejected with a reason"`;
  - `"a too-long effect is cut with a fade"`;
  - `"accept writes the library entry and the licence row"` (with a temp fixtures dir).
- [ ] **Step 2: Run** `pnpm vitest run tools/sounds/test/process.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write `sources.json` for the four seed themes: sea, transport, animals, cartoon.
- [ ] **Step 4: Run** the tests, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Download list.** Run `pnpm sounds:fetch --dry` and save its output (files, sources, sizes) to the task report. **Stop: the controller asks the user for permission to download.**
- [ ] **Step 6: Commit** `git commit -m "feat(sounds): CC0 sound pipeline, listening page, accept step"`.

---

### Task 10: Seed library, with the user's listening

**Files:**
- Generated by the tools:
  - `fixtures/public/audio/storybook/*.ogg`;
  - `packages/engine/src/engines/storybook/library.ts`;
  - rows in `docs/assets-audio-storybook.md`.
- Test: `packages/engine/test/storybook-library.test.ts`

**Steps:**
- [ ] **Step 1: Fetch and process.** Once the user has approved the downloads, run `pnpm sounds:fetch --approved` and `pnpm sounds:process`. Synthesised variants (boings, slide whistles, pops, xylophone, sparkles) count as candidates too: render them through `synth.ts` offline into the same folder.
- [ ] **Step 2: Listening session (user).** The controller starts `pnpm sounds:listen` and tells the user the address, one theme at a time, about 5–10 minutes each. **Stop until the user has finished the four themes.**
- [ ] **Step 3: Accept.** Run `pnpm sounds:accept`. Target: 40–60 kept files, every seed group with at least one variant and the common ones (whistle, meow, peep, boing, pop, waves) with 3–5.
- [ ] **Step 4: Write the failing test, then make it pass:**
  - `"every library file exists, is listed, and the folder stays under 12 MB"`;
  - `"every group has at least one variant; common groups have three"`;
  - `"every file row in docs/assets-audio-storybook.md has a CC0 source"`.
- [ ] **Step 5: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(storybook): seed sound library (user-curated, CC0)"`.

---

### Task 11: Reference lesson, docs, export check

**Files:**
- Create: `fixtures/public/scenes/storie-trenino.scene.json`. It is an **original** story: a little train on its tracks, letter T, big and small.
  - The whistle starts on "trenino". Birds come in when the story looks at the sky.
  - Characters have their own voices: a cheerful train and a slow cow.
  - Chapters (Italian): "Il trenino parte", "Guarda il cielo!", "Chi è più grande?" (big to small), "La caccia alla T" (letter hunt), and a colouring chapter.
  - Sources: the page itself (`page`) and nothing invented.
- Modify: wherever reference scenes are listed for the home archive (`grep -rn "geometria-solidi" apps/web/src fixtures/public`).
- Modify: the export e2e scene list (`grep -rn "matematica-parabola" apps/web/scripts`), to add `storie-trenino`.
- Modify: `docs/decisions.md`, adding row **D29 "Storybook theatre"**: cartoon look, sounds on the word with variant groups chosen per lesson, touch activities, separate sound catalogue, seed library curated by the user, generator in the shared recording batch.
- Create: `docs/storybook.md`, the developer notes: grammar, catalogues, the `sb:` ids, the word timeline and boundaries, the hooks, how to add a character or a sound group, the pipeline.
- Test: `packages/engine/test/storybook.test.ts` (fixture tests)

- [ ] **Step 1: Write the failing tests**, in the pattern of `solid.test.ts` "geometria-solidi scene fixture":
  - the scene parses, and `checkScene` and `checkStorybookData` give `[]`;
  - the engine builds;
  - every chapter updates from 0 to its duration in 0.5 s steps;
  - every pin anchor resolves at mid-chapter;
  - every word cue matches its word.
- [ ] **Step 2: Run** `pnpm vitest run packages/engine/test/storybook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** the scene, the archive listing, D29 and `docs/storybook.md`.
- [ ] **Step 4: Run** the file, then `pnpm test` and `pnpm export:e2e`. Expected: PASS; the storybook lesson exports and plays offline with its sounds.
- [ ] **Step 5: Lesson review.**
  - Play the lesson as a child would, with the voice on: listen for the cues on their words (the reviewer can check the cue log), touch everything, do every activity and get the stamps.
  - Run it in the pop-up book, on a phone-sized viewport (390×844) and at board size.
  - Take screenshots of every chapter. The controller sends them to the user. **Stop until the user approves.**
- [ ] **Step 6: Commit** `git commit -m "feat(storybook): reference lesson 'Il trenino', D29, docs, export check"`.
