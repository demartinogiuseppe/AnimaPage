// Pure blocking evaluator of the `stage` engine: where every character and prop is at (chapter, t),
// which clip plays, who speaks, where the spotlight is. No three.js, no accumulated state.
import {
  clockAt,
  clockMinutes,
  clockSize,
  dioramaModel,
  PERSON_PARTS,
  STAGE_WALK_SPEED,
  stageCharacterOfVoice,
  stageSize,
  type Chapter,
  type StageAction,
  type StageCharacter,
  type StageData,
  type StageProp,
} from "@pv/scene-spec";
import { clamp, ease, hash, lerp, seg } from "../../util/math.ts";

/** Seconds to turn towards a new facing. */
export const TURN = 0.45;
/** Share of the turn towards the audience ("cheating out"). */
export const CHEAT = 0.3;
/** Spotlight fade and slide, seconds. */
export const SPOT_FADE = 0.3;
export const SPOT_SLIDE = 0.4;
/** House lights while someone speaks (1 = full). */
export const HOUSE_DIM = 0.7;
/** Curtains open in every chapter during this window (after the pop-up). */
export const CURTAIN_WINDOW: readonly [number, number] = [1.4, 3.0];
/** The Kenney "sit" clip lowers the body by this share of the height. */
export const SIT_DROP = 0.224;
/** Hip height while sitting, share of the height. */
const SIT_HIP = 0.045;
const SIT_MOVE = 0.5;
const GESTURE_DUR = 1.5;
/** Distance of the wings from the floor edge, metres. */
export const WING_OUT = 0.9;
const POP = 0.3;

export interface Cue {
  from: number;
  to: number;
  /** Character id. */
  who: string;
}

export interface Place {
  x: number;
  z: number;
  /** Base height (sitting on a seat). */
  y: number;
  visible: boolean;
  /** Walking right now: direction of travel in degrees. */
  walkYaw: number | null;
  walkStart: number;
  /** End time of the move (walk, enter, exit, sit, stand) in progress at t. */
  moveEnd: number | null;
  sitting: { on: string | null; yaw: number | null } | null;
}

export interface CharState extends Place {
  yaw: number;
  clip: string | null;
  clipTime: number;
  loop: boolean;
  speaking: boolean;
  /** Walking, gesturing or speaking: drawn in colour in the ink style. */
  acting: boolean;
  /** Height in metres (catalog size x scale). */
  height: number;
}

export interface PropState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 0..1 pop scale (show/hide). */
  pop: number;
  heldBy: string | null;
  /** An action on this prop is near t. */
  acting: boolean;
}

export interface SpotState {
  x: number;
  z: number;
  /** 0..1 */
  intensity: number;
  who: string | null;
}

interface ChapterData {
  acts: Map<string, StageAction[]>;
  propActs: Map<string, StageAction[]>;
  cues: Cue[];
  duration: number;
  /** Cache of facing-change times per character. */
  changes: Map<string, number[]>;
}

const deg = (r: number) => (r * 180) / Math.PI;
const yawTo = (dx: number, dz: number) => deg(Math.atan2(dx, dz));

/** Shortest-path angle interpolation, degrees. */
export function lerpAngle(a: number, b: number, p: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * p;
}

export class StageEvaluator {
  readonly chars = new Map<string, StageCharacter>();
  readonly props = new Map<string, StageProp>();
  readonly width: number;
  readonly depth: number;
  private chapters = new Map<string, ChapterData>();
  /** Param overrides (user sliders) and the scene's own values. */
  private overrides: Record<string, number> | null = null;
  private paramDefs = new Map<string, StageData["chapters"][number]["params"]>();
  private phase = new Map<string, number>();

  constructor(
    readonly data: StageData,
    chapters: readonly Pick<Chapter, "id" | "duration" | "narration">[],
  ) {
    [this.width, this.depth] = stageSize(data);
    data.characters.forEach((c, i) => {
      this.chars.set(c.id, c);
      this.phase.set(c.id, hash(i, 7) * 3);
    });
    for (const p of data.props) this.props.set(p.id, p);
    for (const ch of chapters) {
      const entry = data.chapters.find((c) => c.chapter === ch.id);
      const sorted = [...(entry?.blocking ?? [])].sort((a, b) => a.at - b.at);
      const acts = new Map<string, StageAction[]>();
      const propActs = new Map<string, StageAction[]>();
      for (const a of sorted) {
        if ("who" in a) acts.set(a.who, [...(acts.get(a.who) ?? []), a]);
        if ("prop" in a) propActs.set(a.prop, [...(propActs.get(a.prop) ?? []), a]);
      }
      const cues: Cue[] = [];
      ch.narration.forEach((s, i) => {
        const who = s.speaker ? stageCharacterOfVoice(data, s.speaker)?.id : undefined;
        if (who) cues.push({ from: s.at, to: ch.narration[i + 1]?.at ?? ch.duration, who });
      });
      this.chapters.set(ch.id, { acts, propActs, cues, duration: ch.duration, changes: new Map() });
      this.paramDefs.set(ch.id, entry?.params);
    }
  }

  setOverrides(v: Record<string, number> | null): void {
    this.overrides = v;
  }

  params(chapter: string): NonNullable<StageData["chapters"][number]["params"]> {
    return this.paramDefs.get(chapter) ?? [];
  }

  private param(chapter: string, kind: "spacing" | "lights"): number {
    const def = this.params(chapter).find((p) => p.kind === kind);
    if (!def) return 1;
    const v = this.overrides?.[def.id];
    return clamp(v ?? def.value, def.min, def.max);
  }

  height(id: string): number {
    const c = this.chars.get(id);
    return (dioramaModel(c?.model ?? "")?.size[1] ?? 1.7) * (c?.scale ?? 1);
  }

  cues(chapter: string): readonly Cue[] {
    return this.chapters.get(chapter)?.cues ?? [];
  }

  /** The cue covering t, if any. */
  cueAt(chapter: string, t: number): Cue | null {
    return this.cues(chapter).find((c) => t >= c.from && t < c.to) ?? null;
  }

  private wingX(side: "left" | "right" | undefined, x: number): number {
    const s = side ? (side === "left" ? -1 : 1) : x < 0 ? -1 : 1;
    return s * (this.width / 2 + WING_OUT);
  }

  propSize(p: StageProp): [number, number, number] {
    const s = p.scale ?? 1;
    const m = p.model;
    let v: [number, number, number] = [0.5, 0.5, 0.5];
    if (typeof m === "string") v = dioramaModel(m)?.size ?? v;
    else if (m.shape === "box") v = m.size;
    else if (m.shape === "cylinder" || m.shape === "cone") v = [2 * m.radius, m.height, 2 * m.radius];
    else if (m.shape === "sphere") v = [2 * m.radius, 2 * m.radius, 2 * m.radius];
    else if (m.shape === "patch") v = [m.size[0], 0.02, m.size[1]];
    else if (m.shape === "text") v = [m.text.length * m.height * 0.85, m.height, m.depth ?? m.height * 0.12];
    else if (m.shape === "clock") v = clockSize(m);
    return [v[0] * s, v[1] * s, v[2] * s];
  }

  /** Time a clock prop shows at (chapter, t), minutes after midnight (not wrapped); null for other props. */
  clockMinutes(id: string, chapter: string, t: number): number | null {
    const m = this.props.get(id)?.model;
    if (!m || typeof m === "string" || m.shape !== "clock") return null;
    const keys = (this.chapters.get(chapter)?.propActs.get(id) ?? []).flatMap((a) => (a.do === "time" ? [{ at: a.at, minutes: clockMinutes(a.time), dur: a.dur }] : []));
    return clockAt(clockMinutes(m.time), keys, t);
  }

  seatHeight(p: StageProp): number {
    if (p.seat !== undefined) return p.seat;
    return 0.5 * this.propSize(p)[1];
  }

  /** Position, visibility and motion of a character (no facing). */
  place(id: string, chapter: string, t: number): Place {
    const c = this.chars.get(id)!;
    const acts = this.chapters.get(chapter)?.acts.get(id) ?? [];
    const firstMove = acts.find((a) => a.do === "enter" || a.do === "exit");
    let visible = firstMove?.do === "enter" ? false : !c.offstage;
    let x = c.pos[0];
    let z = c.pos[1];
    if (!visible) x = this.wingX(firstMove?.do === "enter" ? firstMove.side : undefined, firstMove?.do === "enter" ? firstMove.to[0] : x);
    let y = 0;
    let sitting: Place["sitting"] = null;
    let motion: { x0: number; z0: number; x1: number; z1: number; from: number; to: number; y0: number; y1: number; hideAtEnd: boolean } | null = null;
    const settle = (at: number) => {
      if (!motion) return;
      const p = seg(at, motion.from, motion.to);
      x = lerp(motion.x0, motion.x1, p);
      z = lerp(motion.z0, motion.z1, p);
      y = lerp(motion.y0, motion.y1, p);
      if (p >= 1) {
        if (motion.hideAtEnd) visible = false;
        motion = null;
      }
    };
    const go = (x1: number, z1: number, at: number, dur: number | undefined, y1 = 0, hideAtEnd = false) => {
      const d = Math.hypot(x1 - x, z1 - z);
      motion = { x0: x, z0: z, x1, z1, from: at, to: at + (dur ?? Math.max(0.3, d / STAGE_WALK_SPEED)), y0: y, y1, hideAtEnd };
    };
    for (const a of acts) {
      if (a.at > t) break;
      settle(a.at);
      switch (a.do) {
        case "enter":
          visible = true;
          sitting = null;
          x = this.wingX(a.side, a.to[0]);
          z = a.to[1];
          y = 0;
          go(a.to[0], a.to[1], a.at, a.dur);
          break;
        case "exit":
          sitting = null;
          go(this.wingX(a.side, x), z, a.at, a.dur, 0, true);
          break;
        case "walk":
          sitting = null;
          go(a.to[0], a.to[1], a.at, a.dur);
          break;
        case "place":
          motion = null;
          sitting = null;
          x = a.to[0];
          z = a.to[1];
          y = 0;
          break;
        case "sit": {
          const seat = a.on ? this.props.get(a.on) : undefined;
          const h = this.height(id);
          if (seat) {
            go(seat.pos[0], seat.pos[2], a.at, SIT_MOVE, seat.pos[1] + this.seatHeight(seat) - SIT_HIP * h);
            sitting = { on: seat.id, yaw: seat.rot ?? 0 };
          } else {
            motion = null;
            sitting = { on: null, yaw: null };
          }
          break;
        }
        case "stand": {
          const seat = sitting?.on ? this.props.get(sitting.on) : undefined;
          sitting = null;
          if (seat) {
            const r = ((seat.rot ?? 0) * Math.PI) / 180;
            go(seat.pos[0] + Math.sin(r) * 0.55, seat.pos[2] + Math.cos(r) * 0.55, a.at, SIT_MOVE, 0);
          }
          break;
        }
        default:
          break;
      }
    }
    let walkYaw: number | null = null;
    let walkStart = 0;
    let moveEnd: number | null = null;
    if (motion) {
      const m = motion as NonNullable<typeof motion>;
      moveEnd = m.to;
      settle(t);
      if (t < m.to && !sitting) {
        walkYaw = yawTo(m.x1 - m.x0, m.z1 - m.z0);
        walkStart = m.from;
      }
      if (t < m.to && Math.hypot(m.x1 - m.x0, m.z1 - m.z0) < 1e-6) walkYaw = null;
    }
    const k = this.param(chapter, "spacing");
    if (k !== 1 && !sitting && visible) x *= k;
    return { x, z, y, visible, walkYaw, walkStart, moveEnd, sitting };
  }

  /** Times where the facing rule of `id` changes (motion start/end, face, sit, cue boundaries). */
  private changes(id: string, chapter: string): number[] {
    const cd = this.chapters.get(chapter);
    if (!cd) return [];
    let out = cd.changes.get(id);
    if (out) return out;
    const set = new Set<number>();
    for (const a of cd.acts.get(id) ?? []) {
      set.add(a.at);
      if (a.do === "enter" || a.do === "walk" || a.do === "exit" || a.do === "sit" || a.do === "stand") {
        const end = this.place(id, chapter, a.at).moveEnd;
        if (end !== null) set.add(end);
      }
    }
    for (const c of cd.cues) set.add(c.from);
    out = [...set].sort((a, b) => a - b);
    cd.changes.set(id, out);
    return out;
  }

  /** Facing the rule wants at t (no smoothing). */
  private targetYaw(id: string, chapter: string, t: number, p: Place): number {
    if (p.walkYaw !== null) return p.walkYaw;
    if (p.sitting?.yaw !== null && p.sitting?.yaw !== undefined) return p.sitting.yaw;
    const acts = this.chapters.get(chapter)?.acts.get(id) ?? [];
    let rule: StageAction & { do: "face" } | null = null;
    for (const a of acts) {
      if (a.at > t) break;
      if (a.do === "face") rule = a.toward === "auto" ? null : a;
    }
    const c = this.chars.get(id)!;
    if (rule) {
      const tw = rule.toward;
      if (typeof tw === "number") return tw;
      if (tw === "audience") return 0;
      let tx: number;
      let tz: number;
      if (Array.isArray(tw)) [tx, tz] = tw;
      else if (this.chars.has(tw)) ({ x: tx, z: tz } = this.place(tw, chapter, t));
      else {
        const pr = this.props.get(tw);
        if (!pr) return 0;
        [tx, , tz] = pr.pos;
      }
      return yawTo(tx - p.x, tz - p.z);
    }
    if (c.facing !== undefined) return c.facing;
    return this.autoYaw(id, chapter, t, p);
  }

  /** Speaker looks at whom they answer, listeners at the speaker, everyone cheats out. */
  private autoYaw(id: string, chapter: string, t: number, p: Place): number {
    const cues = this.cues(chapter);
    let cur: Cue | null = null;
    let prev: Cue | null = null;
    for (const c of cues) {
      if (c.from > t) break;
      if (cur && c.who !== cur.who) prev = cur;
      cur = c;
    }
    const others = [...this.chars.keys()].filter((o) => o !== id).map((o) => ({ o, p: this.place(o, chapter, t) })).filter((e) => e.p.visible);
    let target = null as { x: number; z: number } | null;
    const pick = (who: string | undefined) => others.find((e) => e.o === who)?.p ?? null;
    if (cur && cur.who === id) target = pick(prev?.who);
    else if (cur) target = pick(cur.who);
    if (!target && others.length) target = others.reduce((a, b) => (Math.hypot(a.p.x - p.x, a.p.z - p.z) <= Math.hypot(b.p.x - p.x, b.p.z - p.z) ? a : b)).p;
    if (!target) return 0;
    return lerpAngle(yawTo(target.x - p.x, target.z - p.z), 0, CHEAT);
  }

  /** Facing with smooth turns: blends from the facing just before the last change. */
  yaw(id: string, chapter: string, t: number, p = this.place(id, chapter, t), depth = 0): number {
    const target = this.targetYaw(id, chapter, t, p);
    if (depth > 12) return target;
    const ch = this.changes(id, chapter);
    let k: number | null = null;
    for (const c of ch) if (c <= t + 1e-9) k = c;
    if (k === null || k <= 0 || t - k >= TURN) return target;
    const before = this.yaw(id, chapter, k - 1e-3, undefined, depth + 1);
    return lerpAngle(before, target, ease.inOutQuad(seg(t, k, k + TURN)));
  }

  character(id: string, chapter: string, t: number): CharState {
    const p = this.place(id, chapter, t);
    const yaw = this.yaw(id, chapter, t, p);
    const c = this.chars.get(id)!;
    const anims = dioramaModel(c.model)?.anims ?? [];
    const has = (n: string) => anims.includes(n);
    const acts = this.chapters.get(chapter)?.acts.get(id) ?? [];
    const cue = this.cueAt(chapter, t);
    const speaking = !!cue && cue.who === id && p.visible;
    let clip: string | null = has("idle") ? "idle" : null;
    let clipTime = t + (this.phase.get(id) ?? 0);
    let loop = true;
    let gesturing = false;
    for (const a of acts) {
      if (a.at > t) break;
      if (a.do === "gesture" && t < a.at + (a.dur ?? GESTURE_DUR) && has(a.clip)) {
        clip = a.clip;
        clipTime = t - a.at;
        gesturing = true;
      }
    }
    if (p.walkYaw !== null && has("walk")) {
      clip = "walk";
      clipTime = t - p.walkStart;
      gesturing = false;
    } else if (p.sitting && has("sit") && !gesturing) {
      clip = "sit";
      clipTime = 0;
      loop = false;
    } else if (!gesturing && this.heldProps(id, chapter, t).length && has("holding-right")) {
      clip = "holding-right";
      clipTime = 0;
      loop = false;
    }
    const acting = speaking || p.walkYaw !== null || gesturing;
    return { ...p, yaw, clip, clipTime, loop, speaking, acting, height: this.height(id) };
  }

  /** Named part of a character in stage coordinates. */
  characterPart(id: string, part: string | undefined, chapter: string, t: number, out: { x: number; y: number; z: number }): boolean {
    if (!this.chars.has(id)) return false;
    const s = this.character(id, chapter, t);
    const h = s.height;
    const drop = s.sitting ? SIT_DROP * h : 0;
    const r = (s.yaw * Math.PI) / 180;
    const local = (lx: number, ly: number, lz: number) => {
      out.x = s.x + lx * Math.cos(r) + lz * Math.sin(r);
      out.z = s.z - lx * Math.sin(r) + lz * Math.cos(r);
      out.y = s.y + ly;
    };
    const w = (dioramaModel(this.chars.get(id)!.model)?.size[0] ?? 0.6) * (this.chars.get(id)!.scale ?? 1);
    switch (part ?? "base") {
      case "base":
        local(0, 0, 0);
        return true;
      case "center":
        local(0, 0.5 * h - drop, 0);
        return true;
      case "head":
        local(0, PERSON_PARTS.head![1] * h - drop, 0);
        return true;
      case "top":
        local(0, h + 0.28 - drop, 0);
        return true;
      case "hand": {
        const [hx, hy, hz] = PERSON_PARTS.hand!;
        // Model faces +z: its right hand is on -x.
        local(-hx * w * 1.3, hy * h - drop, hz * w * 1.2);
        return true;
      }
      case "bubble": {
        // Outwards, unless the character is near a wing (then towards the centre).
        const outward = s.x <= 0 ? -1 : 1;
        const side = Math.abs(s.x) > this.width / 2 - 1.4 ? -outward : outward;
        out.x = s.x + side * (0.55 + w * 0.3);
        out.y = s.y + h * 0.95 - drop;
        out.z = s.z + 0.1;
        return true;
      }
      default:
        return false;
    }
  }

  /** Props held by `id` at t. */
  heldProps(id: string, chapter: string, t: number): string[] {
    const out: string[] = [];
    for (const p of this.props.keys()) if (this.holder(p, chapter, t) === id) out.push(p);
    return out;
  }

  private holder(prop: string, chapter: string, t: number): string | null {
    let h: string | null = null;
    for (const a of this.chapters.get(chapter)?.propActs.get(prop) ?? []) {
      if (a.at > t) break;
      if (a.do === "take") h = a.who;
      else if (a.do === "give") h = a.to;
      else if (a.do === "put") h = null;
    }
    return h;
  }

  prop(id: string, chapter: string, t: number, depth = 0): PropState | null {
    const p = this.props.get(id);
    if (!p) return null;
    const acts = this.chapters.get(chapter)?.propActs.get(id) ?? [];
    const firstVis = acts.find((a) => a.do === "show" || a.do === "hide");
    let shown = firstVis?.do === "show" ? false : !p.hidden;
    let pop = shown ? 1 : 0;
    let x = p.pos[0];
    let y = p.pos[1];
    let z = p.pos[2];
    let yaw = p.rot ?? 0;
    let heldBy: string | null = null;
    let acting = false;
    for (const a of acts) {
      if (a.at > t) break;
      if (t - a.at < 2.5) acting = true;
      if (a.do === "show" || a.do === "hide") {
        shown = a.do === "show";
        const q = ease.inOutQuad(seg(t, a.at, a.at + POP));
        pop = shown ? q : 1 - q;
      } else if (a.do === "take") heldBy = a.who;
      else if (a.do === "give") heldBy = a.to;
      else if (a.do === "put") {
        heldBy = null;
        if (Array.isArray(a.on)) [x, y, z] = a.on;
        else {
          const base = depth < 4 ? this.prop(a.on, chapter, a.at, depth + 1) : null;
          const under = this.props.get(a.on);
          if (base && under) {
            x = base.x;
            z = base.z;
            y = base.y + this.propSize(under)[1];
          }
        }
      }
    }
    if (heldBy) {
      const out = { x: 0, y: 0, z: 0 };
      if (this.characterPart(heldBy, "hand", chapter, t, out)) {
        x = out.x;
        y = out.y - this.propSize(p)[1] * 0.3;
        z = out.z;
        yaw = this.character(heldBy, chapter, t).yaw;
      }
      if (!this.place(heldBy, chapter, t).visible) pop = 0;
    }
    return { x, y, z, yaw, pop, heldBy, acting: acting || heldBy !== null };
  }

  propPart(id: string, part: string | undefined, chapter: string, t: number, out: { x: number; y: number; z: number }): boolean {
    const s = this.prop(id, chapter, t);
    const p = this.props.get(id);
    if (!s || !p) return false;
    const [, h, d] = this.propSize(p);
    const r = (s.yaw * Math.PI) / 180;
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    switch (part ?? "base") {
      case "base":
        return true;
      case "center":
        out.y += h / 2;
        return true;
      case "top":
        out.y += h;
        return true;
      case "front":
        out.y += h / 2;
        out.x += Math.sin(r) * d * 0.5;
        out.z += Math.cos(r) * d * 0.5;
        return true;
      default:
        return false;
    }
  }

  spot(chapter: string, t: number): SpotState {
    const cues = this.cues(chapter);
    const posOf = (who: string) => {
      const p = this.place(who, chapter, t);
      return { x: p.x, z: p.z, vis: p.visible };
    };
    const cur = this.cueAt(chapter, t);
    if (cur) {
      const i = cues.indexOf(cur);
      const prev = cues[i - 1];
      const a = posOf(cur.who);
      const chained = prev && Math.abs(prev.to - cur.from) < 1e-6 && prev.who !== cur.who;
      if (chained) {
        const b = posOf(prev.who);
        const q = ease.inOutCubic(seg(t, cur.from, cur.from + SPOT_SLIDE));
        return { x: lerp(b.x, a.x, q), z: lerp(b.z, a.z, q), intensity: a.vis ? 1 : 0, who: cur.who };
      }
      const fadeIn = prev && Math.abs(prev.to - cur.from) < 1e-6 ? 1 : seg(t, cur.from, cur.from + SPOT_FADE);
      return { x: a.x, z: a.z, intensity: a.vis ? fadeIn : 0, who: cur.who };
    }
    let last: Cue | null = null;
    for (const c of cues) if (c.to <= t) last = c;
    if (!last) return { x: 0, z: 0, intensity: 0, who: null };
    const a = posOf(last.who);
    return { x: a.x, z: a.z, intensity: a.vis ? 1 - seg(t, last.to, last.to + SPOT_FADE) : 0, who: null };
  }

  /** House lights 0..1 (dimmed under the spotlight, times the "lights" slider). */
  house(chapter: string, t: number): number {
    return lerp(1, HOUSE_DIM, this.spot(chapter, t).intensity) * this.param(chapter, "lights");
  }

  /** Curtains: 0 = closed, 1 = open. */
  curtain(t: number): number {
    return ease.inOutCubic(seg(t, CURTAIN_WINDOW[0], CURTAIN_WINDOW[1]));
  }
}
