// Storybook acts in chapter time: what each character is doing at (chapter, t). Everything here is a pure
// function of its arguments (no Math.random, no state kept between calls), so the timeline scrubs both ways.
//
// Rules
// - Who is on stage: a character is shown in a chapter only if the chapter names it (an act's `who`, a
//   row's `who`, or the play's targets / order / who). If it names nobody, every character is shown.
// - A character named by an `appear` act (or a row, whose item k appears at `at + k * every`) is absent
//   before that time and pops in; any other named character stands there from t = 0.
// - A `move` that starts at or before the character's first appearance (at 0 for the others) is a
//   placement: the character simply stands at `to` from the start. This is how a chapter puts each
//   character in its own spot, since a character's `at` is shared by all chapters.
import { storyCharacter, type Sentence, type StoryChapter, type StoryCharacter } from "@pv/scene-spec";
import { timedDurationMs } from "../../player/tts.ts";

/** Reading time of a sentence, remembered: update() runs every frame and the text never changes. */
const READ = new Map<string, number>();
function readSeconds(text: string, lang: string | undefined): number {
  const key = `${lang ?? ""}|${text}`;
  let v = READ.get(key);
  if (v === undefined) {
    if (READ.size >= 256) READ.delete(READ.keys().next().value!);
    READ.set(key, (v = timedDurationMs(text, lang) / 1000));
  }
  return v;
}

type Id = string;

export interface StoryState {
  /** 0 = absent, 0..1.15 while popping in (overshoot), 1 = present. Scale factor of the character. */
  shown: number;
  /** Ground position [x, z]. */
  pos: [number, number];
  /** Rotation about y in radians (0 = facing +x). */
  yaw: number;
  /** Height stretch around 0: the character is scaled (1 + squash) tall and (1 - squash / 2) wide. */
  squash: number;
  /** Lift above the ground in world units, never negative. */
  bob: number;
  /** Lean around the forward axis, radians (rocking, wobbling). */
  roll: number;
  /** Rolling angle, radians, for balls and wheels. */
  spin: number;
  /** Direction of the latest move, radians as `yaw` (the ball rolls across it). */
  heading: number;
}

/** A character counts as on stage once its pop is past this: one threshold for the scene and the anchors. */
export const SHOWN_MIN = 0.001;
export const isShown = (s: StoryState | undefined): s is StoryState => !!s && s.shown > SHOWN_MIN;

export const POP_DURATION = 0.45;
export const REACT_DURATION = 0.6;
/** How long a character takes to turn towards where it is going. */
const TURN = 0.4;
/** A gait fades in and out over this long, so it never starts or stops with a jolt. */
const GAIT_FADE = 0.5;
/** Backing-off constant of the pop: overshoot 1.15. */
const POP_S = 2.2;
const SPEAK_HZ = 3;
/** Characters that never turn: they are round, or their face looks at the camera. */
const NO_TURN = new Set(["ball", "sun", "cloud", "umbrella", "tree", "tree-oak", "tree-pine", "tree-palm"]);
/** Rolling angle per world unit of travel, over the character's scale. */
const ROLL_RADIUS = 0.35;

interface Move {
  at: number;
  dur: number;
  from: [number, number];
  to: [number, number];
  gait: string;
  dist: number;
  heading: number;
  /** Yaw of this move, and the yaw before it. */
  yaw: number;
  yawBefore: number;
  /** Rolling angle accumulated by earlier moves. */
  spinBefore: number;
}

interface CharPlan {
  id: Id;
  scale: number;
  /** World height unit of this character (about half its catalogue size times its scale). */
  unit: number;
  turns: boolean;
  phase: number;
  appearAt: number;
  start: [number, number];
  moves: Move[];
  reacts: { at: number; how: string }[];
  /** Times the whale spouts (appear and react). */
  spouts: number[];
}

interface Plan {
  chars: StoryCharacter[];
  list: CharPlan[];
  byId: Map<Id, CharPlan>;
}

const plans = new WeakMap<StoryChapter, Plan>();

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number): number => {
  const p = clamp01(x);
  return p * p * (3 - 2 * p);
};
/** Ease-out with overshoot: 0 at 0, 1 at 1, peaks at 1.15. */
const back = (p: number): number => {
  const u = p - 1;
  return 1 + (POP_S + 1) * u * u * u + POP_S * u * u;
};
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const shortest = (d: number): number => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));

/** The ids of the characters a chapter names (acts and play). Empty when it names nobody. */
function named(ch: StoryChapter): Set<Id> {
  const ids = new Set<Id>();
  for (const a of ch.acts ?? []) {
    if (a.do === "row") a.who.forEach((w) => ids.add(w));
    else if (a.do === "appear" || a.do === "move" || a.do === "react") ids.add(a.who);
  }
  const p = ch.play;
  if (p?.kind === "letter") p.targets.forEach((w) => ids.add(w));
  else if (p?.kind === "order") p.order.forEach((w) => ids.add(w));
  else if (p?.kind === "color") ids.add(p.who);
  return ids;
}

/** The ids on stage in a chapter, in the order of `chars`. */
export function castOf(ch: StoryChapter, chars: StoryCharacter[]): Id[] {
  const ids = named(ch);
  return chars.filter((c) => ids.size === 0 || ids.has(c.id)).map((c) => c.id);
}

function planOf(ch: StoryChapter, chars: StoryCharacter[]): Plan {
  const hit = plans.get(ch);
  if (hit && hit.chars === chars) return hit;
  const acts = ch.acts ?? [];
  const list: CharPlan[] = castOf(ch, chars).map((id) => {
    const c = chars.find((x) => x.id === id)!;
    const entry = storyCharacter(c.model);
    const scale = c.scale ?? 1;
    // Appearance: the earliest appear act or row item; -Infinity = on stage from the start.
    let first = Infinity;
    for (const a of acts) {
      if (a.do === "appear" && a.who === id) first = Math.min(first, a.at);
      else if (a.do === "row") {
        const k = a.who.indexOf(id);
        if (k >= 0) first = Math.min(first, a.at + k * a.every);
      }
    }
    const appearAt = Number.isFinite(first) ? first : -Infinity;
    const placeLimit = Number.isFinite(appearAt) ? appearAt : 0;
    const start: [number, number] = [c.at[0], c.at[1]];
    const turns = !NO_TURN.has(c.model);
    const moves: Move[] = [];
    let at: [number, number] = [start[0], start[1]];
    let yaw = 0;
    let heading = 0;
    let spin = 0;
    const own = acts.flatMap((a) => (a.do === "move" && a.who === id ? [a] : [])).sort((p, q) => p.at - q.at);
    for (const m of own) {
      if (m.at <= placeLimit) {
        at = [m.to[0], m.to[1]];
        start[0] = at[0];
        start[1] = at[1];
        continue;
      }
      const dx = m.to[0] - at[0];
      const dz = m.to[1] - at[1];
      const dist = Math.hypot(dx, dz);
      const target = turns && dist > 1e-6 ? Math.atan2(-dz, dx) : yaw;
      // Turn the short way round from where it faced.
      const yawTo = yaw + shortest(target - yaw);
      const gait = m.gait ?? "glide";
      if (dist > 1e-6) heading = Math.atan2(-dz, dx);
      moves.push({ at: m.at, dur: m.dur, from: at, to: [m.to[0], m.to[1]], gait, dist, heading, yaw: yawTo, yawBefore: yaw, spinBefore: spin });
      if (gait === "roll") spin += dist / (ROLL_RADIUS * scale);
      at = [m.to[0], m.to[1]];
      yaw = yawTo;
    }
    const reacts = acts.flatMap((a) => (a.do === "react" && a.who === id ? [{ at: a.at, how: a.how }] : []));
    const spouts = c.model === "whale" ? [...(Number.isFinite(appearAt) ? [appearAt] : []), ...reacts.map((r) => r.at)].sort((p, q) => p - q) : [];
    return { id, scale, unit: (entry?.size ?? 2) * 0.5 * scale, turns, phase: hash(id) * Math.PI * 2, appearAt, start, moves, reacts, spouts };
  });
  const plan = { chars, list, byId: new Map(list.map((p) => [p.id, p])) };
  plans.set(ch, plan);
  return plan;
}

/** The times (chapter seconds) a character spouts: its appearance and its reactions. Only whales spout. */
export function spoutTimes(ch: StoryChapter, chars: StoryCharacter[], id: Id): number[] {
  return planOf(ch, chars).list.find((p) => p.id === id)?.spouts ?? [];
}

function fresh(): StoryState {
  return { shown: 0, pos: [0, 0], yaw: 0, squash: 0, bob: 0, roll: 0, spin: 0, heading: 0 };
}

/**
 * The state of every character on stage at chapter time `t`. Pure. Pass `out` to reuse the previous map
 * and its objects between frames (no allocation in the hot path); its contents are then overwritten.
 */
export function storyStateAt(ch: StoryChapter, chars: StoryCharacter[], narration: Sentence[], t: number, out: Map<Id, StoryState> = new Map(), lang?: string): Map<Id, StoryState> {
  const plan = planOf(ch, chars);
  // Whoever is not in this chapter's cast goes (a map reused from another chapter must not keep them).
  for (const id of out.keys()) if (!plan.byId.has(id)) out.delete(id);
  // The speaking character: the speaker of the current sentence, until that sentence ends (its own words
  // by the reading-speed estimate, or the next sentence if that starts first).
  let speaker: string | undefined;
  for (let i = narration.length - 1; i >= 0; i--) {
    const n = narration[i]!;
    if (n.at > t) continue;
    if (n.speaker) {
      const end = Math.min(narration[i + 1]?.at ?? Infinity, n.at + readSeconds(n.text, n.lang ?? lang));
      if (t < end) speaker = n.speaker;
    }
    break;
  }
  for (const p of plan.list) {
    let s = out.get(p.id);
    if (!s) out.set(p.id, (s = fresh()));
    const age = t - p.appearAt;
    s.shown = age < 0 ? 0 : age >= POP_DURATION ? 1 : back(age / POP_DURATION);
    let x = p.start[0];
    let z = p.start[1];
    let yaw = 0;
    let bob = 0;
    let roll = 0;
    let spin = 0;
    let heading = 0;
    // Idle: the character breathes.
    let squash = 0.025 * Math.sin(t * Math.PI + p.phase);
    for (const m of p.moves) {
      if (t < m.at) break;
      const el = t - m.at;
      const lin = clamp01(el / m.dur);
      const e = smooth(lin);
      x = m.from[0] + (m.to[0] - m.from[0]) * e;
      z = m.from[1] + (m.to[1] - m.from[1]) * e;
      yaw = m.yawBefore + (m.yaw - m.yawBefore) * smooth(el / Math.min(TURN, m.dur));
      heading = m.heading;
      spin = m.spinBefore + (m.gait === "roll" ? (m.dist / (ROLL_RADIUS * p.scale)) * e : 0);
      if (el < m.dur) {
        const env = Math.min(smooth(el / GAIT_FADE), smooth((m.dur - el) / GAIT_FADE));
        if (m.gait === "hop") {
          const arcs = Math.max(1, Math.round(m.dur * 1.8));
          bob += env * 0.35 * p.unit * Math.abs(Math.sin(Math.PI * arcs * lin));
        } else if (m.gait === "swim") bob += env * 0.12 * p.unit * (1 + Math.sin(el * 2.6));
        else if (m.gait === "rock") roll += env * ((8 * Math.PI) / 180) * Math.sin(el * 3.2);
      }
    }
    for (const r of p.reacts) {
      const q = (t - r.at) / REACT_DURATION;
      if (q < 0 || q > 1) continue;
      const env = Math.sin(Math.PI * q);
      if (r.how === "jump") {
        bob += 0.7 * p.unit * env;
        squash += 0.06 * Math.sin(2 * Math.PI * q);
      } else if (r.how === "spin") yaw += 2 * Math.PI * smooth(q);
      else if (r.how === "laugh") {
        bob += 0.12 * p.unit * env * Math.abs(Math.sin(3 * Math.PI * q));
        squash += 0.05 * env * Math.sin(6 * Math.PI * q);
      } else if (r.how === "wobble") roll += 0.3 * (1 - q) * Math.sin(4 * Math.PI * q);
    }
    // Speaking: a small bounce at 3 Hz while its own sentence is the current one.
    if (speaker === p.id) bob += 0.05 * p.unit * (1 + Math.sin(2 * Math.PI * SPEAK_HZ * t));
    s.pos[0] = x;
    s.pos[1] = z;
    s.yaw = yaw;
    s.squash = squash;
    s.bob = bob;
    s.roll = roll;
    s.spin = spin;
    s.heading = heading;
  }
  return out;
}
