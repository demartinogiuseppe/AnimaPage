// Which files a lesson needs at runtime. The lesson export embeds exactly these, because a page
// opened from file:// cannot fetch anything. Every path is returned character for character as the
// stage and the audio code request it (they are used as map keys by the player's loadAsset).
import { dioramaModel, MUSIC_INSTRUMENTS, MUSIC_PERCUSSION, storyCharacter, type SceneSpec } from "@pv/scene-spec";
import { storySoundsOf, tapSoundsOf } from "../engines/storybook/sounds.ts";
import { soundFile, soundSource } from "../player/audio/library.ts";

export interface AssetRefs {
  /** Every asset path requested while playing the lesson: sorted, unique, including audio/<id>.ogg. */
  files: string[];
  /** The subset of `files` that are map terrain headers (the grid file they name is resolved separately). */
  terrainHeaders: string[];
}

/**
 * URL of a scene asset, only on the app's own origin (docs/security.md, M2): asset paths are written by the
 * model, so a full URL could be a tracking beacon or a request to the LAN / loopback.
 */
export function localAssetUrl(path: string, base: string): URL {
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) throw new Error(`${path.slice(0, 80)}: not an asset of this app`);
  return url;
}

/** One-shots the player and quiz feedback fire regardless of the scene (player.ts, AudioDirector.feedback). */
const PLAYER_SOUNDS = ["page-turn", "wood-hit", "correct", "wrong"];

export function assetsOf(spec: SceneSpec): AssetRefs {
  const files = new Set<string>();
  const terrainHeaders = new Set<string>();

  /** Sounds without a file (procedural ones, instruments) are synthesized and never requested. */
  const sound = (id: string) => {
    if (soundSource(id)?.file) files.add(soundFile(id));
  };
  const model = (id: unknown) => {
    const file = typeof id === "string" ? dioramaModel(id)?.file : undefined;
    if (file) files.add(file);
  };

  PLAYER_SOUNDS.forEach(sound);
  if (spec.music) sound(spec.music.track);
  for (const c of spec.chapters) {
    for (const a of c.sounds?.ambience ?? []) sound(a.sound);
    for (const q of c.sounds?.cues ?? []) sound(q.sound);
  }

  switch (spec.engine) {
    case "map": {
      const d = spec.engineData;
      files.add(d.terrain.asset);
      terrainHeaders.add(d.terrain.asset);
      files.add(d.boundaries.asset);
      if (d.rivers) files.add(d.rivers.asset);
      break;
    }
    case "art": {
      const d = spec.engineData;
      if (d.artwork.image) files.add(d.artwork.image.asset);
      if (d.model) files.add(d.model.asset);
      break;
    }
    case "diorama":
      for (const it of spec.engineData.items) model(it.model);
      break;
    case "workshop":
      for (const p of spec.engineData.parts) model(p.model);
      break;
    case "stage":
      for (const c of spec.engineData.characters) model(c.model);
      for (const p of spec.engineData.props) model(p.model);
      break;
    case "music":
      // Instrument sounds are synthesized, but go through the same rule so a future sampled one is covered.
      for (const i of Object.values(MUSIC_INSTRUMENTS)) sound(i.sound);
      for (const s of Object.values(MUSIC_PERCUSSION)) sound(s);
      break;
    case "storybook": {
      for (const c of spec.engineData.characters) {
        const source = storyCharacter(c.model)?.source;
        if (source && "model" in source) model(source.model);
      }
      // The same pure function the engine hook plays from: the export embeds exactly these variants.
      for (const ch of storySoundsOf(spec).values()) {
        ch.ambience.forEach((a) => sound(a.sound));
        ch.cues.forEach((q) => sound(q.sound));
        ch.words.forEach((w) => sound(w.cue.sound));
      }
      // Touch: the sounds the tap code plays on the page (characters' own, boing, the finish, the plays' notes).
      tapSoundsOf(spec).forEach(sound);
      break;
    }
    default:
      break;
  }

  return { files: [...files].sort(), terrainHeaders: [...terrainHeaders].sort() };
}
