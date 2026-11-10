// Sound catalog: the ids usable in Chapter.sounds (ambience, cues) and SceneSpec.music.
// Descriptions and tags are written for whoever picks sounds for a scene (a person or an LLM).
// Files, licenses and procedural fallbacks live in the engine (player/audio/library.ts) and
// docs/assets-audio.md; this file stays engine-agnostic.
import type { ChapterSounds, Music } from "./common.ts";
import type { Issue } from "./validate.ts";

export type SoundCategory = "ambience" | "sfx" | "music" | "instrument";

export interface SoundInfo {
  id: string;
  /**
   * ambience = loop that plays under a window; sfx = one-shot cue; music = background track;
   * instrument = synthesized note played by a cue, at the cue's `pitch` for `duration` seconds.
   */
  category: SoundCategory;
  /** Short Italian description. */
  it: string;
  /** Short English description. */
  en: string;
  tags: readonly string[];
}

const A = (id: string, it: string, en: string, tags: string[]): SoundInfo => ({ id, category: "ambience", it, en, tags });
const S = (id: string, it: string, en: string, tags: string[]): SoundInfo => ({ id, category: "sfx", it, en, tags });
const M = (id: string, it: string, en: string, tags: string[]): SoundInfo => ({ id, category: "music", it, en, tags });
const I = (id: string, it: string, en: string, tags: string[]): SoundInfo => ({ id, category: "instrument", it, en, tags });

export const SOUND_CATALOG: readonly SoundInfo[] = [
  // ---------- Ambience (loops) ----------
  A("sea", "Mare: onde che si frangono sulla riva", "Sea: waves breaking on the shore", ["nature", "sea", "beach", "coast", "water", "ships", "island"]),
  A("wind", "Vento costante", "Steady wind", ["nature", "weather", "mountain", "desert", "open land", "cold"]),
  A("rain", "Pioggia", "Rain", ["nature", "weather", "water", "storm"]),
  A("storm", "Temporale: pioggia e tuoni", "Thunderstorm: rain and thunder", ["nature", "weather", "storm", "thunder", "danger"]),
  A("forest", "Bosco con canto di uccelli", "Forest with birdsong", ["nature", "forest", "birds", "countryside", "spring", "morning"]),
  A("river", "Fiume o ruscello che scorre", "Flowing river or stream", ["nature", "river", "water", "valley", "plain"]),
  A("fire", "Fuoco che crepita", "Crackling fire", ["fire", "camp", "hearth", "burning city", "warmth", "prehistory"]),
  A("night", "Notte con i grilli", "Night with crickets", ["nature", "night", "summer", "countryside", "calm"]),
  A("crowd", "Folla che parla e grida (piazza, mercato)", "Crowd talking and shouting (square, market)", ["people", "city", "market", "square", "stadium", "assembly"]),
  A("city", "Strada con traffico", "Street with traffic", ["city", "traffic", "cars", "modern", "urban"]),
  A("battle", "Battaglia: grida e colpi di spade e scudi", "Battle: shouts, swords and shields", ["war", "battle", "army", "ancient", "medieval"]),
  A("marching", "Soldati in marcia", "Soldiers marching", ["war", "army", "soldiers", "march", "footsteps"]),
  A("horses", "Cavalli al trotto", "Horses trotting", ["animals", "horses", "cavalry", "chariot", "travel"]),
  A("rumble", "Brontolio profondo della terra", "Deep earth rumble", ["volcano", "earthquake", "underground", "danger", "geology"]),
  A("electric-hum", "Ronzio elettrico", "Electric hum", ["electricity", "science", "circuit", "lamp", "power"]),
  A("machine", "Macchinari in funzione", "Machinery running", ["machine", "factory", "industry", "mechanics", "engine"]),
  A("bubbling", "Acqua che bolle", "Boiling water", ["water", "science", "laboratory", "chemistry", "kitchen", "heat"]),
  A("heartbeat", "Battito del cuore", "Heartbeat", ["body", "science", "heart", "blood", "health", "tension"]),
  A("breathing", "Respiro affannato", "Heavy breathing", ["body", "science", "lungs", "breath", "sport", "fatigue"]),
  A("room", "Stanza silenziosa: leggerissimo fruscio d'ambiente", "Quiet room tone: very faint background hiss", ["room", "classroom", "study", "maths", "geometry", "calm", "neutral"]),
  A("space", "Spazio profondo: fruscio cupo e arioso, senza note", "Deep space: dark, airy hiss, no notes", ["space", "sky", "stars", "planets", "astronomy", "night", "calm"]),
  A("drone", "Suono cupo e misterioso", "Dark mysterious drone", ["mystery", "cave", "deep sea", "science fiction", "tension"]),
  // ---------- Sound effects (one-shots) ----------
  S("whoosh", "Sibilo rapido", "Quick swish", ["ui", "movement", "transition", "fast"]),
  S("whoosh-soft", "Soffio morbido di passaggio", "Soft passing whoosh", ["ui", "transition", "appear", "timeline", "gentle"]),
  S("pop", "Pop leggero", "Light pop", ["ui", "appear", "bubble", "playful"]),
  S("click", "Clic", "Click", ["ui", "button", "select"]),
  S("chime", "Ding cristallino", "Crystal ding", ["ui", "appear", "highlight", "notification", "gentle"]),
  S("sparkle", "Scintillio magico di comparsa", "Magic sparkle reveal", ["ui", "reveal", "discovery", "myth", "magic"]),
  S("bell", "Campanella", "Small bell", ["bell", "school", "church", "signal"]),
  S("gong", "Gong", "Gong", ["signal", "asia", "start", "ceremony"]),
  S("correct", "Risposta giusta", "Correct answer", ["ui", "quiz", "success"]),
  S("wrong", "Risposta sbagliata", "Wrong answer", ["ui", "quiz", "error"]),
  S("tick", "Tic di orologio", "Clock tick", ["ui", "time", "clock"]),
  S("beep", "Bip elettronico", "Electronic beep", ["machine", "appliance", "electronics", "signal", "coffee machine"]),
  S("phone-ring", "Squillo di telefono", "Phone ringing", ["phone", "call", "home", "office"]),
  S("whistle", "Fischio acuto che sale", "Rising whistle", ["cartoon", "funny", "warning", "pressure", "steam"]),
  S("sword-clash", "Spade che si scontrano", "Swords clashing", ["war", "battle", "sword", "duel", "metal"]),
  S("shield-hit", "Colpo su uno scudo", "Hit on a shield", ["war", "battle", "shield", "defence"]),
  S("arrows", "Raffica di frecce", "Volley of arrows", ["war", "battle", "arrows", "siege", "archers"]),
  S("war-horn", "Corno di guerra", "War horn", ["war", "battle", "army", "signal", "attack"]),
  S("battle-clash", "Scontro tra eserciti", "Armies clashing", ["war", "battle", "army", "charge", "melee"]),
  S("explosion", "Esplosione", "Explosion", ["explosion", "danger", "war", "chemistry"]),
  S("eruption", "Eruzione: boato e brontolio", "Eruption: blast and rumble", ["volcano", "eruption", "geology", "danger", "lava"]),
  S("thunder", "Tuono", "Thunder clap", ["weather", "storm", "lightning", "nature"]),
  S("spark", "Scintilla elettrica", "Electric spark", ["electricity", "science", "spark", "circuit"]),
  S("short-circuit", "Cortocircuito", "Short circuit", ["electricity", "danger", "circuit", "fault"]),
  S("switch", "Interruttore", "Switch flipped", ["electricity", "light", "home", "circuit"]),
  S("glass-break", "Vetro che si rompe", "Glass breaking", ["accident", "glass", "home", "danger"]),
  S("metal-clank", "Colpo metallico", "Metal clank", ["metal", "machine", "tools", "forge", "mechanics"]),
  S("wood-hit", "Colpo sul legno", "Knock on wood", ["wood", "door", "building", "carpentry"]),
  S("door-creak", "Porta che cigola", "Creaking door", ["door", "house", "mystery", "old"]),
  S("dog-bark", "Cane che abbaia", "Dog barking", ["animals", "dog", "home", "farm"]),
  S("sheep", "Belato di pecora", "Sheep bleating", ["animals", "farm", "countryside", "shepherd"]),
  S("seagull", "Gabbiano", "Seagull", ["animals", "birds", "sea", "harbour", "coast"]),
  S("splash", "Tuffo in acqua", "Water splash", ["water", "sea", "river", "fall"]),
  S("page-turn", "Pagina che si gira", "Page turn", ["book", "school", "story", "reading"]),
  S("coins", "Monete", "Coins", ["money", "trade", "market", "economy"]),
  S("applause", "Applauso", "Applause", ["people", "celebration", "success", "theatre"]),
  S("footsteps", "Passi", "Footsteps", ["people", "walking", "arrival"]),
  // ---------- Instruments (cues with pitch and duration) ----------
  I("instr-piano", "Pianoforte", "Piano", ["music", "melody", "chords", "keyboard"]),
  I("instr-flute", "Flauto", "Flute", ["music", "melody", "wind instrument", "recorder"]),
  I("instr-violin", "Violino (arco)", "Violin (bowed)", ["music", "melody", "strings", "orchestra"]),
  I("instr-clarinet", "Clarinetto", "Clarinet", ["music", "melody", "wind instrument", "reed"]),
  I("instr-xylophone", "Xilofono", "Xylophone", ["music", "melody", "percussion", "children"]),
  I("instr-guitar", "Chitarra (pizzicata)", "Guitar (plucked)", ["music", "melody", "chords", "strings"]),
  I("instr-drum", "Grancassa", "Kick drum", ["music", "rhythm", "percussion", "beat"]),
  I("instr-snare", "Rullante", "Snare drum", ["music", "rhythm", "percussion"]),
  I("instr-hihat", "Charleston (piatto)", "Hi-hat", ["music", "rhythm", "percussion", "cymbal"]),
  I("instr-bell", "Campana intonata", "Tuned bell", ["music", "melody", "bells", "chimes"]),
  // ---------- Music ----------
  M("music-calm", "Musica calma e dolce", "Calm, gentle music", ["calm", "geography", "nature", "reading", "default"]),
  M("music-history", "Musica antica, da racconto (arpe e flauti)", "Old-time storytelling music (harp, flutes)", ["history", "myth", "medieval", "ancient", "story"]),
  M("music-epic", "Musica epica (archi e corni)", "Epic music (strings and horns)", ["war", "battle", "heroes", "adventure"]),
  M("music-playful", "Marcetta allegra", "Cheerful little march", ["playful", "children", "grammar", "games", "fun"]),
  M("music-mysterious", "Musica misteriosa (campane e bassi)", "Mysterious music (bells and bass)", ["mystery", "caves", "space", "unknown", "archaeology"]),
  M("music-curious", "Musica curiosa e leggera", "Light, curious music", ["science", "discovery", "experiments", "technology"]),
];

export const SOUND_IDS: readonly string[] = SOUND_CATALOG.map((s) => s.id);

const BY_ID = new Map(SOUND_CATALOG.map((s) => [s.id, s] as const));

export function soundInfo(id: string): SoundInfo | undefined {
  return BY_ID.get(id);
}

const PITCH = /^([A-G])(#|b)?([0-8])$/;
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI note number of a scientific pitch ("C4" = 60, "A4" = 69, "F#3", "Bb2"), or null if malformed. */
export function pitchToMidi(pitch: string): number | null {
  const m = PITCH.exec(pitch);
  if (!m) return null;
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + SEMITONE[m[1]!]! + acc;
}

/** Frequency in Hz, twelve-tone equal temperament with A4 = 440 Hz: f = 440 * 2^((midi - 69) / 12). */
export function pitchToFrequency(pitch: string): number | null {
  const midi = pitchToMidi(pitch);
  return midi === null ? null : 440 * Math.pow(2, (midi - 69) / 12);
}

/** The parts of a scene this check reads (structural, so it also accepts partial objects in tests). */
export interface SoundedScene {
  chapters: readonly { sounds?: ChapterSounds }[];
  music?: Music;
}

/** Checks that every sound id used by the scene exists in the catalog and has the right category. */
export function checkSoundIds(scene: SoundedScene): Issue[] {
  const issues: Issue[] = [];
  const check = (path: string, id: string, want: SoundCategory) => {
    const s = BY_ID.get(id);
    if (!s) issues.push({ path, message: `unknown sound id "${id}"` });
    else if (s.category !== want) issues.push({ path, message: `sound "${id}" is ${s.category}, expected ${want}` });
  };
  scene.chapters.forEach((ch, c) => {
    ch.sounds?.ambience.forEach((a, i) => {
      const p = `chapters[${c}].sounds.ambience[${i}]`;
      check(p, a.sound, "ambience");
      if (a.window && a.window[0] > a.window[1]) issues.push({ path: p, message: "window ends before it starts" });
    });
    ch.sounds?.cues.forEach((q, i) => {
      const p = `chapters[${c}].sounds.cues[${i}]`;
      const s = BY_ID.get(q.sound);
      if (!s) return void issues.push({ path: p, message: `unknown sound id "${q.sound}"` });
      if (s.category !== "sfx" && s.category !== "instrument") {
        return void issues.push({ path: p, message: `sound "${q.sound}" is ${s.category}, expected sfx or instrument` });
      }
      if (s.category === "sfx" && (q.pitch !== undefined || q.duration !== undefined)) {
        issues.push({ path: p, message: `pitch and duration are only for instrument sounds, not "${q.sound}"` });
      }
      if (q.pitch !== undefined && pitchToMidi(q.pitch) === null) issues.push({ path: p, message: `bad pitch "${q.pitch}" (use e.g. C4, F#3, Bb2)` });
    });
  });
  if (scene.music) check("music", scene.music.track, "music");
  return issues;
}
