// Contract between the common player and the per-engine modules.
import type * as THREE from "three";
import type { Anchor, SceneSpec, SoundCue } from "@pv/scene-spec";
import type { EngineSounds } from "./player/audio/director.ts";

export interface EngineContext {
  /** Engine content goes here. The player moves/scales this group (fit to view, AR placement). */
  root: THREE.Group;
  /** For background, fog and lights, which the engine owns (e.g. day/night). */
  scene: THREE.Scene;
  /** Loads a data asset (terrain, borders) by path relative to the asset base: fetch in the browser, fs in tests. */
  loadAsset(path: string): Promise<ArrayBuffer>;
  /** Canvas factory for procedural textures. Undefined in Node tests: engines must then skip textures. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  /**
   * Accademico presentation (decision D24): draw formulas on boards and tiles with maths typography
   * (util/math-text.ts maybeFormula; the player has loaded the KaTeX fonts). Absent = as before.
   */
  typesetFormulas?: boolean;
  /** The user asked for less motion: the engine keeps its small reactions (bounce, wobble) gentler. */
  reducedMotion?: boolean;
}

/** What the activity panel of a touch play shows (storybook): see Engine.play. */
export interface TouchPlayView {
  kind: "touch" | "letter" | "order" | "color";
  prompt: string;
  /** The page's letter (letter hunt). */
  letter?: string;
  /** The colours to choose from (colouring), as CSS colours. */
  palette?: readonly string[];
  /** The chosen palette index, if any. */
  picked?: number;
  progress: { done: number; total: number };
  /** Name of the stamp earned by finishing. */
  stamp: string;
  complete: boolean;
  /** Badges over the characters (a star for each one found, numbers for the order). */
  marks?: { id: string; text: string }[];
}

/** A user-controllable engine parameter (slider). */
export interface EngineParam {
  id: string;
  /** Italian label, e.g. "a". */
  label: string;
  min: number;
  max: number;
  step: number;
  /** Value the scene would use now. */
  value: number;
}

/** A camera the engine asks for (see Engine.view). Positions are in `root` local coordinates. */
export interface EngineView {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Vertical lens shift as a fraction of the frame height (one-point perspective with a low horizon); 0 = none. */
  shiftY: number;
}

export interface Engine {
  build(ctx: EngineContext, spec: SceneSpec): Promise<void>;
  /**
   * Puts the scene in its state for chapter `chapterId` at chapter time `t`.
   * MUST be a pure function of (chapterId, t): no accumulated state, no Math.random,
   * so the timeline can be scrubbed in both directions.
   */
  update(chapterId: string, t: number): void;
  /**
   * Writes the anchor position, in `root` local coordinates, into `out`.
   * Called after update(chapterId, t) with the same arguments. Returns false if unresolvable.
   */
  resolveAnchor(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3): boolean;
  /**
   * Optional: false while the thing the anchor belongs to has not appeared yet at (chapterId, t), so its
   * label waits for it (timeline keywords on an event that grows in later). Camera keys ignore it. Pure.
   */
  anchorShown?(anchor: Anchor, chapterId: string, t: number): boolean;
  /**
   * Optional: the engine drives the camera at (chapterId, t) (façade views). Pure. `aspect` is the aspect
   * of the area the camera frames. null = the chapter's camera keys.
   */
  view?(chapterId: string, t: number, aspect: number): EngineView | null;
  /** Bounding sphere of the content in `root` local coordinates (camera limits, AR scale). */
  bounds(): { center: THREE.Vector3; radius: number };
  /** Optional "Prova tu" controls (decision D13): parameters the user can move in this chapter. */
  params?(chapterId: string): EngineParam[];
  /** Overrides parameter values (user sliders); null = back to the scene's own keyframes. update() stays pure given the overrides. */
  setParams?(values: Record<string, number> | null): void;
  /** Optional: the chapter's instrument cues for the current parameters (music engine); the player plays these instead of the chapter's own instrument cues. */
  soundCues?(chapterId: string): SoundCue[];
  /**
   * Optional: sounds the engine adds to the chapter's own (storybook: ambience, cues on acts, cues on words
   * with their time in chapter time). The director plays them like the chapter's. null = none.
   */
  sounds?(chapterId: string): EngineSounds | null;
  /** Optional: per sentence, the start offset in seconds of each word (storybook highlight). null = no word timing. */
  words?(chapterId: string): number[][] | null;
  /**
   * Optional: a tap on the canvas, as a ray in `root` local coordinates, at (chapterId, t). Returns null when it
   * hit nothing the engine reacts to, else the `sb:` id of the sound to play (none when rate limited). Never
   * changes timeline state; `now` is a performance.now() time in ms. `canSound` is the player's global limit
   * on tap sounds: the engine asks it only when its own per-character limit lets a sound through, and spends
   * its slot only when the answer is yes. `complete` = this touch finished the chapter's activity.
   */
  tap?(chapterId: string, t: number, ray: THREE.Ray, now: number, canSound?: (now: number) => boolean): { sound?: string; complete?: boolean } | null;
  /**
   * Optional: the touch activity of a chapter (storybook), null when it has none. Its progress lives in the
   * engine for the whole lesson session and is never part of update's pure state.
   */
  play?(chapterId: string): TouchPlayView | null;
  /** Optional: the colour the child picked for the colouring (an index of the palette). */
  choose?(chapterId: string, value: number): void;
  /** Optional: a gentle "not this one" wobble of entity `id` (the activity uses it); applied by animate(). */
  wobble?(id: string, now: number): void;
  /**
   * Optional: transient reactions (bounce, wobble) applied on top of what update() just wrote. Called every
   * frame right after update(); they decay to nothing and are never part of update's pure state.
   */
  animate?(now: number): void;
  dispose(): void;
}
