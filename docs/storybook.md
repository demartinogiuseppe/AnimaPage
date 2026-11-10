# Storybook theatre (D29)

The `storybook` engine (Storie) tells short stories to children of about 5 to 6: a cartoon look, sounds that fire **on the word** the narrating voice is saying, and touch activities that end with a stamp. Nothing ever says "wrong": a mistaken touch only wobbles the character.

- Spec: [superpowers/specs/2026-11-09-storybook-theatre-design.md](superpowers/specs/2026-11-09-storybook-theatre-design.md)
- Plan: `docs/superpowers/plans/2026-11-09-storybook-theatre-plan-a.md`
- Decision: D29 in [decisions.md](decisions.md)
- Sound files and licences: [assets-audio-storybook.md](assets-audio-storybook.md)
- Reference lessons: `fixtures/public/scenes/storie-trenino.scene.json` (the worked example: the little train, letter T, big and small) and `_dev-storie.scene.json` (the same grammar in a dev scene, letter B)
- Code: `packages/engine/src/engines/storybook/`, grammar in `packages/scene-spec/src/engines/storybook.ts`, sound groups in `packages/scene-spec/src/storybook-sounds.ts`

## Grammar (StorybookData)

`engineData = { letter?, characters[1..12], chapters[1..12] }`.

- `letter`: one capital A-Z, the page's letter (needed by a `letter` play).
- Character: `id`, `model` (an id of `STORY_CHARACTERS`), `at` [x, z] on the ground (free units, keep inside about -8..8), optional `scale`, `colour`, `name` (Italian display name).
- Chapter entry: `chapter` (id of a scene chapter), `place` (`sea`, `meadow`, `rails`, `sky`), `ambience` (sound groups looping under the whole chapter), `acts`, `play`.
- Acts (times in chapter seconds): `appear` (the character pops in; its own sound, or `sound: "group"`, or `sound: false`), `move` (`to`, `dur`, optional `gait`: glide, hop, swim, roll, rock), `react` (jump, spin, laugh, wobble; optional sound), `row` (characters enter one after the other every `every` seconds), `sound` (see below), `ambience` (a group between `at` and `until`).
- Play (one per chapter at most): `touch` (touch the characters to hear them), `letter` (touch the `targets` that start with the letter), `order` (number the characters from the biggest to the smallest), `color` (paint the parts of a procedural character). Each has a `prompt` and a `stamp`.

Who is on stage: a character is shown in a chapter only if the chapter names it (an act's `who`, a row, or the play). If the chapter names nobody, all are shown. A `move` that starts at or before the character's first appearance is a **placement**: it stands there from the start. This is how each chapter puts the same character in a different spot. A character that is only a distractor (for example in a letter hunt) is named by a placement.

`checkStorybookData(data, scene)` cross-checks what the schema cannot: ids, catalogue models, sound groups, chapters, `sound` acts against the narration (sentence and word exist, the word matches the group), act times inside the chapter, `letter` targets that really start with the letter, `order` strictly decreasing (size times scale), `color` on a character with parts.

## Voices

Characters talk through the scene's `voices` list (`SceneBase.voices`, with `pitch` and `rate`). A narration sentence with `speaker: "<voice id>"` is read in that voice, and a character whose id equals the voice id bobs while it talks. In the reference lesson the train (`treno`) is higher and faster (pitch 1.3, rate 1.1) and the cow (`mucca`) lower and slower (pitch 0.7, rate 0.8). No storybook-only code is involved.

## Sounds on the word

A `sound` act is `{ do: "sound", group, sentence, word }`: `sentence` is an index into the chapter's `narration`, `word` is the 0-based word of that sentence **split on spaces**. The cue never has a time: the engine computes it.

- **Group, not file.** The generator and the checker see only groups (`STORY_SOUND_GROUPS`: id, theme, kind `sfx` or `ambience`, a description, the words that trigger it). `wordMatchesGroup(word, group, lang)` decides if a word belongs: it equals a listed form, or shares the first 4 letters with one ("trenino" ~ "treno"); accents and punctuation are ignored; an elided word also matches after the apostrophe.
- **Variants.** Each group has several variants in `STORY_LIBRARY` (`packages/engine/src/engines/storybook/library.ts`, generated). `storySoundsOf(spec)` numbers every use of a group in play order and picks `variants[(seed + n) % count]`, where `seed` is a hash of the title and chapter ids: the same lesson always sounds the same, different lessons differ. The export calls the same function, so it embeds exactly the variants played.
- **`sb:` ids.** On the audio path a storybook variant is `sb:<group>-<n>` (for example `sb:train-whistle-2`). Every other id is a `SOUND_CATALOG` id; the storybook catalogue is separate and `SOUND_CATALOG` is untouched. `player/audio/library.ts` loads `sb:` ids from `audio/storybook/<variant>.ogg` and renders the variant's synth when the file is missing or fails.
- **Where a sound can come from:** the chapter's `ambience` list (from t = 0), an `ambience` act (a window), an `appear` or `react` act (at the act's time; `appear` falls back to the character's own sound in `STORY_CHARACTERS`), a `row` (each item's entrance sound), a `sound` act (the word).
- **Kinds.** A group is `sfx` (a one-shot) or `ambience` (a loop of 8 to 20 s). The checker enforces it: `sound`, `appear` and `react` need an sfx group, a chapter's `ambience` list and the `ambience` act need an ambience group. A character's own sound (the entrance and the tap) is always an sfx group; a character with none plays `boing` when touched, and so does one whose group is an ambience.
- **Levels and ducking.** The sfx bus is not ducked under the voice (only music and ambience are), so the story's levels are set low instead: cues and tap sounds 0.4, ambience 0.2, the finish fanfare 0.6 (`STORY_CUE_VOLUME`, `STORY_AMBIENCE_VOLUME`, `TAP_VOLUME` in the player).
- **Stopping.** One-shots (cues, word cues, tap sounds) are cut on pause, on a seek and on a chapter change, like instrument notes.

## The word timeline and boundaries

`wordTimes(text, lang, rate)` (`util/words.ts`) spreads the sentence's reading time over its words by speech units, the same model the timed fallback voice uses. `sentenceWordTimes` clamps the times to just before the next sentence (0.05 s), so an overlong sentence does not push a cue past its slot. A word cue's time is `sentence.at + time of the word`. Two things follow:

- One splitter for both sides: `splitWords` (in `scene-spec`, `storybook-sounds.ts`) cuts a sentence into runs of letters, digits and apostrophes. The checker, the voice timeline, the highlight and the cue times all use it, so a dash (" — "), "..." or a hyphen never shifts an index: "Ta-da" is two words ("Ta", "da"), "l'acqua" is one. Index a cue by counting words that way (a standalone dash is not a word). Writing "Tadà" is still the simplest for a word that should be one, but it is no longer required.
- A speaker line is timed with the speaker voice's `rate` (from the scene's `voices`), the narrator's lines with the narrator rate; the checker matches words in the language of the line, else of its speaker, else of the scene (`lang`).
- With a real voice the browser reports **boundaries** (`onboundary`, a character index). The player keeps the last one (`Playback.boundary`), maps it to a word with `wordAtChar`, and follows the voice instead of the estimate. With no boundaries (some voices never report) the estimate is in charge.

## Hooks (Engine interface, `packages/engine/src/types.ts`)

- `sounds(chapterId)`: ambience, act cues, word cues, handed to the director like the chapter's own sounds.
- `words(chapterId)`: per sentence, the offset of each word, for the highlight.
- `tap(chapterId, t, ray, now, canSound)`: a touch on the canvas as a ray. Returns null when nothing was hit, else the `sb:` sound to play (rate limited per character and globally) and `complete` when the touch finished the chapter's activity. It never changes `update` state.
- `play(chapterId)`: the chapter's activity as a `TouchPlayView` (prompt, progress, marks, palette, stamp, complete). Progress lives in the engine for the whole lesson session and is not saved or exported.
- `choose(chapterId, i)`: the colour picked for the colouring (palette of six). `wobble(id, now)` and `animate(now)`: transient reactions (bounce, wobble) applied on top of what `update` wrote, never part of its state.

`update(chapterId, t)` stays pure: the same chapter and time always give the same picture, in either direction.

**The play is live at the chapter end** (`PLAY_SLACK` before it): invite the touch in the last sentence of the chapter, close to the end ("Tocca il trenino e la mucca!"), with no long silent wait after it, and keep praise out of the narration (the panel says "Bravo!"). The panel lies over the stage (semi-transparent): the camera does not make room for it. A touch from a finger may last up to 700 ms and move 14 px (a mouse: 350 ms, 8 px) and still count as a tap.  the touch UI is `player/touch-play-ui.ts`, the tap handling `player/tap.ts`.

## How to add a character

1. Add a line to `STORY_CHARACTERS` (`packages/scene-spec/src/engines/storybook.ts`): `id`, Italian and English name, `size` 1 to 5 (used by the `order` play), the source and optionally an entrance `sound` group.
2. A Kenney model: the id must exist in the diorama catalogue (the checker reports a missing one) and its file in the model assets. A procedural one: add the id to `StoryProcId`, write its builder in `characters.ts` (`PROC`) with named `parts` for the colouring.
3. Run `pnpm vitest run packages/engine/test/storybook-look.test.ts`.

## How to add a sound group

1. Add the group to `STORY_SOUND_GROUPS` in `storybook-sounds.ts`: id, theme, kind, descriptions, and **every word form** a story may use (Italian and English).
2. Add its candidates to `tools/sounds/sources.json` (CC0 only, with the licence text read on the source page), then run the pipeline below.
3. Until a real file exists the library carries a synth variant, so a lesson never plays silence.

## The sound pipeline

`pnpm sounds:fetch --dry` (lists, downloads nothing), `pnpm sounds:fetch --approved`, `pnpm sounds:process` (trim, normalise, loop, OGG mono), `pnpm sounds:listen` (a local page where a person keeps or discards each candidate), `pnpm sounds:accept` (copies the kept files, regenerates `library.ts` and the table in [assets-audio-storybook.md](assets-audio-storybook.md)). `pnpm sounds:synth` renders offline synth candidates for groups without real sounds. Budget for the folder: 12 MB.

## Export

The exported lesson embeds the `sb:` variants it plays: the cues of the story (`storySoundsOf`) and the touch sounds (`tapSoundsOf`: every variant of each character's tap group, boing, the ta-da finish, and the sparkle or climbing notes when a colouring, letter hunt or order exists), so it plays offline with its sounds. `pnpm export:e2e storie` exports and plays the storybook lessons in a browser.

## Generator

The analysis and generation prompts for storybook lessons are **Plan B**, run with the shared recording batch of the new theatres. Until then storybook lessons are written by hand, from the reference lesson.
