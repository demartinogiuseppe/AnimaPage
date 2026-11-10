// How each catalog sound (packages/scene-spec/src/sounds.ts) is produced in the player:
// a compressed file under fixtures/public/audio/<id>.ogg (licenses: docs/assets-audio.md)
// and a procedural fallback used when there is no file or it fails to load.
import { STORY_LIBRARY } from "../../engines/storybook/library.ts";
import type { Synth } from "./synth.ts";

export interface SoundSource {
  /** True when fixtures/public/audio/<id>.ogg exists. */
  file: boolean;
  synth: Synth;
}

const F = (kind: Synth["kind"], f?: number): SoundSource => ({ file: true, synth: f === undefined ? { kind } : { kind, f } });
const P = (kind: Synth["kind"], f?: number): SoundSource => ({ file: false, synth: f === undefined ? { kind } : { kind, f } });

export const SOUND_LIBRARY: Readonly<Record<string, SoundSource>> = {
  // ambience
  sea: F("sea"),
  wind: F("wind"),
  rain: F("rain"),
  storm: F("rain"),
  forest: F("wind"),
  river: F("rain"),
  fire: F("fire"),
  night: F("murmur"),
  crowd: F("murmur"),
  city: F("rumble"),
  battle: F("murmur"),
  marching: F("pulse", 110),
  horses: F("pulse", 160),
  rumble: F("rumble"),
  "electric-hum": F("hum"),
  machine: F("hum"),
  bubbling: F("bubbles"),
  heartbeat: F("pulse", 66),
  breathing: F("wind"),
  drone: F("drone", 55),
  space: P("space"),
  room: P("room"),
  // sfx
  whoosh: F("whoosh"),
  "whoosh-soft": F("whoosh"),
  pop: F("pop"),
  click: F("click"),
  chime: F("chime", 880),
  sparkle: P("sparkle", 660),
  bell: F("chime", 1320),
  gong: F("clang", 140),
  correct: F("correct"),
  wrong: F("wrong"),
  tick: F("click"),
  beep: P("beep", 1760),
  "phone-ring": P("ring", 1000),
  whistle: P("whistle", 900),
  "sword-clash": F("clang", 900),
  "shield-hit": F("thud"),
  arrows: F("whoosh"),
  "war-horn": F("horn", 220),
  "battle-clash": F("clang", 600),
  explosion: F("boom"),
  eruption: F("boom"),
  thunder: F("boom"),
  spark: F("crack"),
  "short-circuit": F("zap"),
  switch: F("click"),
  "glass-break": F("crack"),
  "metal-clank": F("clang", 400),
  "wood-hit": F("thud"),
  "door-creak": F("horn", 300),
  "dog-bark": F("thud"),
  sheep: F("horn", 400),
  seagull: F("chime", 1500),
  splash: F("crack"),
  "page-turn": F("whoosh"),
  coins: F("chime", 2400),
  applause: F("whoosh"),
  footsteps: F("thud"),
  // music
  "music-calm": F("pad", 220),
  "music-history": F("pad", 196),
  "music-epic": F("pad", 147),
  "music-playful": F("pad", 262),
  "music-mysterious": F("pad", 110),
  "music-curious": F("pad", 247),
};

const SB = "sb:";

/** Storybook variant ids on the audio path are `sb:<variant>` (engines/storybook/library.ts); every other id is a catalog id. */
export function soundSource(id: string): SoundSource | undefined {
  if (!id.startsWith(SB)) return SOUND_LIBRARY[id];
  const v = STORY_LIBRARY[id.slice(SB.length)];
  return v && { file: v.file, synth: v.synth };
}

/** Served path of a sound file, relative to the app base. */
export function soundFile(id: string): string {
  return id.startsWith(SB) ? `audio/storybook/${id.slice(SB.length)}.ogg` : `audio/${id}.ogg`;
}
