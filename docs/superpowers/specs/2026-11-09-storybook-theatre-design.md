# Storybook theatre (children's stories) — design

Date: 2026-11-09. Status: approved description, written up for planning; builder check done (answers below). Decision ID to assign: D29.

## Why

Young children's books (pre-school and the first years of primary school) tell short illustrated stories: a whale that meets a sailboat, a little train on its tracks. Today such a page goes to the `diorama` theatre, which was built for older readers' stories (the "racconto dell'elettricista") and for sober lessons: muted colours, a small sound library, sounds placed at chapter seconds. The user wants a theatre made for these stories, with **strong colours** and **fun sounds that follow the telling**: "when the narration reaches the little train, I want to hear the train whistle in the background; if the story looks at the sky, I want to hear the birds".

The user also requires a **very rich sound library**, "otherwise we end up with the same sounds even for different stories".

## Who it serves

Children of about 5–6 years old (Italian first grade, "Storie dell'alfabeto"), and by extension 3–8: children who are learning to read, listen more than they read, and learn by touching. The teacher uses it at the board; parents at home.

## The reference page (the user's example)

"Storie dell'alfabeto — GRANDE E PICCOLO — BALENA": a whale swims in the blue ocean and meets a sailboat rocking in the wind; a short dialogue between them about who is big and who is small; the boat lists small things on dry land (cups, cats, apples, hammers, balls, umbrellas, chicks), and finally finds something even smaller on its own deck: a caterpillar. The page teaches the letter **B** and the concept **big / small**, and carries a whale outline to colour plus a small coloured card. Its illustration style: bold black outlines, flat bright colours, round friendly shapes.

(The page is the user's private test photo; it is never stored or published, and the lesson retells the story in its own words — see Constraints.)

## Goals

1. A new theatre, **`storybook`** ("Storie"), for children's story pages.
2. **Cartoon look:** bold dark outlines, flat saturated colours, round toy-like shapes and lively, bouncy motion, in the spirit of the page's own illustrations. Colour is the point here: the China (ink) style does not apply to this theatre.
3. **Sounds that follow the story:**
   - **ambience** under the scene while the story is there (ocean waves; birds while the story looks at the sky);
   - **cues on the word**: when the voice says "trenino", the whistle starts on that word, not at the start of the sentence;
   - **a sound for each thing** that appears or that the child touches (the cat meows, the chick peeps, the ball goes boing).
4. **A very rich sound library** (user requirement): hundreds of CC0 sounds grouped by theme, with **several variants per sound**; each lesson picks its variant deterministically (same lesson, same sound; different lessons, different variants), so different stories do not all sound alike.
5. **Character voices:** each character speaks with its own voice (deep and slow for the whale, cheerful for the boat), as the `stage` theatre already does with `Sentence.speaker` and `SceneBase.voices`.
6. **Reading support:** while the voice reads, the narration text highlights word by word (helps a child learning to read; it uses the same word timing as the sound cues).
7. **Activities for small children** (no reading needed, big touch targets):
   - **touch-to-hear**: every character and object answers a touch with its sound and a small bounce;
   - **the letter hunt**: touch the things whose name starts with the page's letter (balena, barca, blu, bruco);
   - **big to small**: touch the characters in order from the biggest to the smallest;
   - **colouring**: pick a colour from a palette and touch a part of a character to paint it (the page's own "colour the whale" invitation).
   - The stamp (timbro) rewards the child as in the other theatres.

## Non-goals (v1)

- Long stories over many pages; v1 stages one page (a few chapters).
- Realistic rendering, lighting or textures.
- Reproducing copyrighted characters (cartoon and TV characters, brand mascots): characters are generic (a whale, a train), built from our catalogue.
- Free drawing; colouring is "touch a part to fill it".
- Music composition; background music stays the existing optional track.
- Changing the `diorama` theatre (older readers' stories keep going there).

## Anti-goals

- **The same five sounds in every story.** Variety is a requirement, not polish.
- Sounds that cover the voice: every cue ducks under the narration (as today, D10), and loud or long sounds are trimmed.
- A cluttered screen with text a five-year-old cannot read: short sentences, big type, few buttons.
- Scary or harsh content for small children (sudden loud noises, dark scenes).
- A sound that does not match its word ("trenino" with a car horn): wrong is worse than nothing.

## Constraints

- The architecture stays: the AI writes a declarative scene, the engine stages it; `update(chapterId, t)` pure.
- **Copyright:** the story text on the page is protected; the narration and dialogue retell it in our own words (standing rule: paraphrase literary text). Every sound and 3D model must be **CC0** (public domain) — the repository will be open source under MIT. Excluded sources for that reason: Sonniss GDC bundles (no standalone redistribution), Zapsplat, Pixabay, AI sound generators.
- **Pop-up book (D12):** the scene stands on the page like every scene; the Accademico presentation is not offered for this theatre (it is for adult pages).
- **Frozen prompts (D26):** the analysis and generation prompt changes go into **one recording batch together with the façade theatre (D28) and the music theatre** (user decision for façade + music; this theatre joins the same batch). Until then the theatre is built and tested on hand-written scenes and does not join `ANALYSIS_ENGINES` (D16).
- **Export (D27):** the export runtime bundles all engines; exported lessons carry their sounds; the library's size must not bloat a single exported lesson (only the sounds the lesson uses are inlined, as today with `assetsOf(spec)`).
- **Performance:** smooth on a board PC and a mid-range phone; audio files compressed (OGG, short).
- Code and technical docs in English; app text in Italian through i18n.

## What was decided, and by whom

### Decided by the user

- A theatre for children's stories, strong colours, fun sounds tied to the story (train whistle on the train, birds on the sky).
- A very rich sound library, so that different stories do not sound alike.
- **The user will listen to a selection per theme and discard bad sounds** (Claude cannot listen; it can only measure duration, loudness and silence).
- The reference page is the "Balena" page of "Storie dell'alfabeto".
- The played-back description (scene, voices, sounds, activities, cartoon look) was approved: "Va bene, procedi".

### Claude's calls (in the approved description; the user can still overturn them)

- **A new engine `storybook`, not an extension of `diorama`:** different audience, look, activities and audio behaviour; `diorama` stays as it is.
- **Cues on the word**, with word timing from the speech engine where available (Web Speech `boundary` events) and an estimate from the word's position in the sentence otherwise; the same timing drives the word-by-word highlight.
- **Deterministic variant choice per lesson** (from the lesson id), so replaying the same lesson sounds the same.
- **The four activities** listed in Goal 7.
- **Sources for the library:** Freesound (CC0 filter), BigSoundBank (CC0), Kenney and OpenGameArt CC0 packs (already used for today's 59 sounds), and sounds synthesised by the app (boings, slide whistles, pops, bells) in many variants.

## The sound library (a sub-project of its own)

- **Size:** a few hundred sounds in v1 (target 300–500 files), grouped by theme: transport (trains, boats, cars, planes, bikes), farm animals, forest and garden animals, sea, birds, weather (wind, rain, thunder — gentle), house and kitchen, toys, magic and sparkles, human sounds (laugh, clap, yawn, snore), cartoon effects (boing, pop, slide whistle, zip), musical toys (xylophone, bell, drum).
- **Variants:** 3–5 per common sound (several whistles, several meows).
- **Catalogue:** every sound has an id, theme, Italian and English description, tags, words that trigger it (Italian and English at least: "treno, trenino, locomotiva…"), duration, loudness, source URL, author, licence (CC0 checked on the source page) and its variant group. It extends the existing `SOUND_CATALOG` (`packages/scene-spec/src/sounds.ts`) and `docs/assets-audio.md`.
- **Pipeline:** a script searches the sources by theme and tags, keeps only CC0, downloads, trims silence, normalises loudness, encodes to OGG, rejects files that are too long, too quiet or clipped, prefers well-rated and often-downloaded sounds, and writes a listening sheet per theme.
- **Listening by the user:** a simple page lists each theme's candidates with play buttons and keep/discard; only kept sounds enter the catalogue. Sessions of about 5–10 minutes per theme.
- Freesound originals need an account (OAuth); previews do not. Which one the pipeline uses is left to the builder (previews are lower quality).

## The look

- Toon shading: flat colours with at most two tones, bold dark outlines (thicker than the façade's fine lines, about 2–3 px at board size), saturated palette, soft round shapes.
- Water, sky and ground are simple and bright (a blue ocean with moving waves, a sky with puffy clouds).
- Characters: the existing Kenney CC0 models already cover many (cube pets: cat, dog, chick, cow, fish; food: apple; furniture: cup; survival: hammer). Missing for the reference page: whale, sailboat, caterpillar, umbrella, ball. They come from CC0 packs (e.g. Kenney's watercraft and other packs) or are built procedurally as simple round shapes in the same style. A character catalogue (id, names in Italian and English, size class for "big/small", tags, parts that can be coloured) is part of the work.
- Motion: bounce on appearance, idle wobble, characters move along simple paths (the boat rocks, the whale swims and spouts, the train runs on its tracks), squash and stretch on touch.

## Chapter actions (what the narration can trigger)

- A character **appears** (pop with a bounce and its sound), **moves** along a path, **speaks** (its line in its own voice, with a small talking bob), **reacts** (jump, spin, laugh).
- A **row of things** pops up one by one, each with its sound (the boat's list of small things).
- The camera **zooms** to something small (the caterpillar) or pulls back to show something big.
- **Ambience** changes with the place (open sea, sky, land).
- Sound cues tied to a **word** in a sentence, or to an action.

## Generator (in the shared recording batch, later)

- The analysis recognises children's story pages (young audience, a short illustrated story) and sends them to `storybook`; older readers' stories stay with `diorama`.
- A guide tells the model to retell the story in its own words in very short sentences, give each character a voice, pick sounds from the catalogue by words and themes (never inventing ids), tie cues to words, choose the page's letter and concept for the activities, and use only characters from the catalogue.
- A hand-written reference scene based on an original story (not the book's text), used as the prompt example.

## Builder check: answers and Claude's calls

A builder read this document on 2026-11-09. Its questions, settled here (Claude's calls unless marked as the user's):

- **The library is built in two phases** (Claude's call). Phase 1: the theatre end to end, the pipeline, the listening page and a seed library of about 40–60 sounds across 3–4 themes (enough for the reference page and two or three other stories). Phase 2: the library grows to 300–500 files theme by theme, as the user's listening sessions keep sounds. The theatre never waits on listening; "very rich" is phase 2's acceptance bar.
- **A separate catalogue, `STORYBOOK_SOUNDS`** (Claude's call), not an in-place extension of `SOUND_CATALOG`: the shared catalogue feeds every engine's validation and the frozen prompts (D26), and other theatres must not change. A scene names a **variant group id** (e.g. `train-whistle`); the engine picks the variant from the lesson id. Cues are authored in the scene (tied to a word index of a sentence, or to an action); there is no automatic matching of words to sounds at run time. Trigger words in the catalogue help the generator choose, they do not fire sounds by themselves.
- **Word timing is precomputed** (Claude's call): each sentence gets a word timeline estimated from the text (word length and punctuation, scaled to the voice's measured rate), so `update(chapterId, t)` stays pure and seeking works. Live `boundary` events, when the voice gives them, only re-align the highlight and pending cues of the sentence being spoken; without them the estimate drives everything. The exported runtime uses the same path.
- **The letter hunt** (Claude's call): the scene names the page letter and lists the target things explicitly; the checker verifies that each target's Italian name starts with that letter. The letter shows large on the narration card during the activity; no overlay on the 3D scene in v1.
- **Branch** (Claude's call): from `main`; nothing is shared with the façade or music theatres except the single prompt-recording batch at the end.
- **Colouring is session-only** (user's decision, 2026-11-09): the child's colours last while the lesson is open; reopening shows the character uncoloured again. Nothing is saved with the lesson or the export in v1.
- **No Freesound account** (user's decision, 2026-11-09): the pipeline uses Freesound's keyless previews (CC0 filter) plus BigSoundBank, Kenney, OpenGameArt and sounds synthesised by the app. No API key is needed or stored.

## Left to the builder

- The zod schema of the theatre's data (characters, paths, rows, cues on words, activities), within the 30,000-character schema budget.
- The toon material and outline technique, motion curves, camera moves.
- The sound pipeline's tooling and the listening page.
- Which CC0 model packs to add, and which characters to build procedurally.
- Test strategy (engine tests like the other theatres, catalogue validation, e2e render of the reference scene, export check).
