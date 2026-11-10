# Audio assets

All sounds in `fixtures/public/audio/` are **CC0 (public domain dedication)**: free to use, modify and
redistribute, attribution not required (we credit anyway). Licenses were checked on each source page
on 2026-11-03 (OpenGameArt "License(s)" field; Kenney asset page "CC0 licensed" plus the `License.txt`
inside the zip). Nothing is CC-BY/SA/GPL, so there are no attribution or share-alike obligations.

- Catalog (ids, Italian/English descriptions, tags): `packages/scene-spec/src/sounds.ts`.
- File / procedural fallback per id: `packages/engine/src/player/audio/library.ts`.
- Total size: about 5.5 MB (budget 15 MB, enforced by `packages/engine/test/audio-library.test.ts`).

## Processing

Sources were decoded with ffmpeg 9.0.2 and processed in numpy (cut, mix, equal-power loop crossfade,
loudness), then encoded as **Ogg Vorbis** (`ffmpeg -c:a libvorbis -q:a 2` mono 32 kHz for ambience and
effects, `-q:a 1` stereo 44.1 kHz for music). Loops: RMS -20 dBFS, the tail crossfaded into the head
(or built on a wrap-around timeline) so they repeat without clicks. Effects: peak -1 dBFS. Music:
RMS -18 dBFS. Ogg Vorbis decodes in Chrome/Android (decision D1); if a file fails to load or decode
(e.g. an older Safari), the player uses the procedural fallback of that id, so every id always plays.

Ids marked *(mix)* are our own mixes of the listed CC0 sources; *(procedural)* means there is no file:
the sound is synthesized at runtime (`player/audio/synth.ts`).

## Sources

| Short | Source page | Author | License |
|---|---|---|---|
| K-IF | https://kenney.nl/assets/interface-sounds (Interface Sounds 1.0) | Kenney | CC0 |
| K-IM | https://kenney.nl/assets/impact-sounds (Impact Sounds 1.0) | Kenney | CC0 |
| K-RPG | https://kenney.nl/assets/rpg-audio (RPG Audio) | Kenney | CC0 |
| K-SF | https://kenney.nl/assets/sci-fi-sounds (Sci-Fi Sounds 1.0) | Kenney | CC0 |
| RD100 | https://opengameart.org/content/100-cc0-sfx | rubberduck | CC0 |
| RD100b | https://opengameart.org/content/100-cc0-sfx-2 | rubberduck | CC0 |
| RDloop | https://opengameart.org/content/30-cc0-sfx-loops | rubberduck | CC0 |
| RDcrea | https://opengameart.org/content/80-cc0-creature-sfx | rubberduck | CC0 |

## Files

### Ambience (loops)

| id | File source | Author | License |
|---|---|---|---|
| sea *(mix)* | https://opengameart.org/content/beach-ocean-waves (`wave_01..04`, from Freesound #18363 by jasinski) over a generated low-noise bed | qubodup (jasinski) | CC0 |
| wind | https://opengameart.org/content/wind1 (`wind1.wav`, 2–26 s) | lukerustltd | CC0 |
| rain | https://opengameart.org/content/rain-loopable (`Rain OGG.zip` → `1.ogg`) | ylmir | CC0 |
| storm | https://opengameart.org/content/rain-long-thunder (`rain-thunder.ogg`, 0–32 s) | wuxiascrub | CC0 |
| forest | https://opengameart.org/content/ambient-bird-sounds (`birds-isaiah658_0.ogg`) | isaiah658 | CC0 |
| river | https://opengameart.org/content/park-ambiences (`park_ambience_river.wav`, 60–84 s) | thimras | CC0 |
| fire | https://opengameart.org/content/fireplace-sound-loop (`fire.wav`, 1–17 s) | pagdev | CC0 |
| night | https://opengameart.org/content/crickets-ambient-noise-loopable (`crickets_1.mp3`) | wolfgang | CC0 |
| crowd | https://opengameart.org/content/crowd-shoutingspeaking-ambience (`crowd_shouting_0.ogg`) | starninjas | CC0 |
| city | https://opengameart.org/content/high-traffic-road-sounds (`gatve Varniu_2.ogg`, 0–30 s) | ignasd | CC0 |
| battle *(mix)* | crowd (above, low-passed) + K-IM `impactMetal_*`, `impactPlate_heavy_*` + https://opengameart.org/content/3-melee-sounds (`sword sound.wav`, remaxim) | see sources | CC0 |
| marching *(mix)* | K-IM `footstep_grass_000..004` (14 soldiers) + K-RPG `beltHandle1/2`, `clothBelt` | Kenney | CC0 |
| horses | https://opengameart.org/content/horse-trotting (`Trot.ogg`) | ezduzziteh | CC0 |
| rumble | https://opengameart.org/content/rumble-fx (`rumble.wav`) | cinameng | CC0 |
| electric-hum | https://opengameart.org/content/electric-buzz (`buzz_0.ogg`, repeated) | themightyglider | CC0 |
| machine | RD100b `sfx100v2_loop_machine_02.ogg` | rubberduck | CC0 |
| bubbling | RDloop `water_boiling.ogg` | rubberduck | CC0 |
| heartbeat | https://opengameart.org/content/heartbeat-sounds (`heartbeat_slow_0.wav`) | bart | CC0 |
| breathing | https://opengameart.org/content/breathing-tired (`breathing tired.wav`) | mikeask | CC0 |
| drone | K-SF `spaceEngineLow_000.ogg` | Kenney | CC0 |
| room *(procedural)* | — (`synth.ts` "room": steady dark low-passed noise, room tone for quiet lessons) | — | — |
| space *(procedural)* | — (`synth.ts` "space": sub-bass noise + a slowly sweeping band of filtered noise, slow swells, no pitch; 20 s seamless loop) | — | — |

### Effects (one-shots)

| id | File source | Author | License |
|---|---|---|---|
| whoosh | https://opengameart.org/content/swishes-sound-pack (`swish-8.wav`) | artisticdude | CC0 |
| whoosh-soft | https://opengameart.org/content/wind-whoosh-loop (`wind woosh loop.ogg`, 1.0–2.4 s, faded) | sketchman3 | CC0 |
| pop | RD100 `plop_01.ogg` | rubberduck | CC0 |
| click | K-IF `click_002.ogg` | Kenney | CC0 |
| chime | K-IF `glass_001.ogg` | Kenney | CC0 |
| sparkle *(procedural)* | — | — | — |
| bell | RD100 `bell_01.ogg` | rubberduck | CC0 |
| gong | RD100 `gong_01.ogg` | rubberduck | CC0 |
| correct | K-IF `confirmation_001.ogg` | Kenney | CC0 |
| wrong | K-IF `error_006.ogg` | Kenney | CC0 |
| tick | K-IF `tick_002.ogg` | Kenney | CC0 |
| beep *(procedural)* | — | — | — |
| phone-ring *(procedural)* | — | — | — |
| whistle *(procedural)* | — | — | — |
| sword-clash *(mix)* | melee `sword sound.wav` (remaxim) + K-IM `impactMetal_heavy_001` | remaxim, Kenney | CC0 |
| shield-hit *(mix)* | K-IM `impactPlate_heavy_000` + `impactWood_heavy_000` | Kenney | CC0 |
| arrows *(mix)* | swishes `swish-1..13` (artisticdude) + K-IM `impactWood_light_*` | artisticdude, Kenney | CC0 |
| war-horn | https://opengameart.org/content/their-coming-generic-horn-sound (`theircoming_0.ogg`, 0–6 s) | stumpystrust | CC0 |
| battle-clash *(mix)* | crowd (starninjas) + K-IM metal/plate hits + melee sword (remaxim) | see sources | CC0 |
| explosion | K-SF `lowFrequency_explosion_000.ogg` | Kenney | CC0 |
| eruption *(mix)* | K-SF `lowFrequency_explosion_000/001`, `explosionCrunch_000` + rumble (cinameng) | Kenney, cinameng | CC0 |
| thunder | RD100b `sfx100v2_thunder_01.ogg` | rubberduck | CC0 |
| spark | https://opengameart.org/content/electricity-sound-effects-0 (`spark.wav`) | bmaczero | CC0 |
| short-circuit *(mix)* | `continuousspark.wav`, `spark.wav` (bmaczero) + K-IF `glitch_002` + RD100 `switch_01` | see sources | CC0 |
| switch | https://opengameart.org/content/sfx-circuit-breaker (`switch on.wav`) | cleytonkauffman | CC0 |
| glass-break *(mix)* | K-IM `impactGlass_heavy_000` + RD100 `glass_04` | Kenney, rubberduck | CC0 |
| metal-clank | RD100 `metal_04.ogg` | rubberduck | CC0 |
| wood-hit | K-IM `impactWood_medium_000.ogg` | Kenney | CC0 |
| door-creak | K-RPG `creak1.ogg` | Kenney | CC0 |
| dog-bark | RDcrea `barking_01.ogg` | rubberduck | CC0 |
| sheep | https://opengameart.org/content/sheep-baa (`sheep_baa_0.ogg`) | antumdeluge | CC0 |
| seagull | https://opengameart.org/content/solo-seagull-sound-effects (`Seagull Ambient 1.wav`) | rango-mango | CC0 |
| splash | RD100 `splash_01.ogg` | rubberduck | CC0 |
| page-turn | K-RPG `bookFlip1.ogg` | Kenney | CC0 |
| coins | K-RPG `handleCoins.ogg` | Kenney | CC0 |
| applause | https://opengameart.org/content/applause-in-a-large-hall-or-church (3–9 s, faded) | expl0it3r | CC0 |
| footsteps *(mix)* | K-IM `footstep_concrete_000..004` | Kenney | CC0 |

### Music (loops)

| id | File source | Author | License |
|---|---|---|---|
| music-calm | https://opengameart.org/content/snowfall (`Snowfall (Looped ver.)`) | kistol | CC0 |
| music-history | https://opengameart.org/content/medieval-the-bards-tale (`Loop_The_Bards_Tale.wav`) | randommind | CC0 |
| music-epic | https://opengameart.org/content/battle-theme-a (`battleThemeA.mp3`, 0–64 s, loop crossfade) | cynicmusic | CC0 |
| music-playful | https://opengameart.org/content/childrens-march-theme (`Children's March Theme.wav`) | cleytonkauffman | CC0 |
| music-mysterious | https://opengameart.org/content/crystal-cave-song18 (`song18_0.mp3`) | cynicmusic | CC0 |
| music-curious | https://opengameart.org/content/where-was-i (`WereWasI_0.ogg`) | yd | CC0 |

## Instruments (category "instrument")

`instr-piano`, `instr-flute`, `instr-violin`, `instr-clarinet`, `instr-xylophone`, `instr-guitar`,
`instr-drum` (kick), `instr-snare`, `instr-hihat`, `instr-bell`: no files, every note is synthesized
(`player/audio/instruments.ts`, rendered once per pitch/length and cached) and played on the effects bus.

- **Cue fields**: `pitch` in scientific pitch notation (`C4`, `F#3`, `Bb2`; octave 0-8) and `duration`
  (seconds the note is held). `checkSoundIds` rejects `pitch`/`duration` on non-instrument sounds and
  malformed pitches. Defaults: C4, 0.5 s. Snare and hi-hat ignore the pitch; the kick uses it to tune its
  body (default A1 = 55 Hz); a hi-hat held longer than 0.3 s rings open.
- **Tuning**: twelve-tone equal temperament with A4 = 440 Hz (ISO 16, see
  https://en.wikipedia.org/wiki/A440_(pitch_standard)): `f = 440 * 2^((m - 69) / 12)` with MIDI number
  `m` (C4 = 60, A4 = 69). This is the formula of https://en.wikipedia.org/wiki/Piano_key_frequencies,
  `f(n) = 2^((n - 49) / 12) * 440 Hz` for piano key n, with m = n + 20 (that page lists C4 = 261.6256 Hz,
  key 40, MIDI 60). Tests check the rendered pitch of each tuned instrument within 0.3 %.
- **Recipes**: piano = slightly inharmonic additive partials, faster decay for higher partials, hammer
  noise; flute = sine + weak harmonics + breath noise, delayed vibrato; violin = band-limited sawtooth
  through two body resonances, slow bow attack, vibrato; clarinet = odd harmonics; xylophone = bar
  fundamental + 4th harmonic, fast decay, mallet click; guitar = Karplus-Strong with fractional delay;
  drum = sine with downward pitch sweep; snare = noise + 185 Hz tone; hi-hat = high-passed noise;
  bell = Risset's inharmonic bell partials.
- **Mixing decision**: in a music lesson the notes are the content, so (1) notes go on the effects bus,
  which is never ducked under the voice (only music and ambience are); (2) in a chapter that contains
  instrument cues the background music is muted; (3) notes follow the "Suoni" switch like every effect;
  (4) a seek, a pause or a chapter change cuts the notes still sounding, and a note is played again only
  when continuous playback crosses its `at` (never on a seek).
- **Engine-computed notes**: an engine may implement `soundCues(chapterId)` (music engine: tempo,
  transpose, instrument sliders). The player then calls `AudioDirector.setInstrumentCues()` on chapter
  change and after every slider change: those cues replace the chapter's instrument cues, while effects
  and ambience still come from the scene. Notes already behind the playhead are not replayed.

## Procedural fallbacks

Every id has a recipe in `library.ts` (`synth.ts`: wind, sea, rain, fire, rumble, hum, murmur, pulse,
drone, bubbles, pad, space, room; whoosh, pop, click, chime, sparkle, correct, wrong, thud, clang, crack, zap, boom,
horn, beep, ring, whistle). They are rough approximations, meant only to keep the lesson from going silent.

## Not verified by ear

The files were picked from their descriptions and checked numerically (length, loudness, loop seam,
pitch direction of `correct`/`wrong`), not by listening. A listening pass on the phone is still needed.
