// Pure evaluator of DioramaData: the state of every item at (chapter, t).
// No three.js objects are touched here, only math classes, so it runs (and is tested) in Node.
import * as THREE from "three";
import { COMMON_PARTS, PERSON_PARTS, clockAt, clockMinutes, clockSize, dioramaModel, type DioramaAction, type DioramaData, type DioramaItem } from "@pv/scene-spec";
import { clamp, ease as baseEase, hash, lerp, seg } from "../../util/math.ts";
import { letterCenter, textSize } from "./font.ts";

export const EASE = {
  ...baseEase,
  inQuad: (p: number) => p * p,
  outQuad: (p: number) => 1 - (1 - p) * (1 - p),
  outBack: (p: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
  },
} as const;
export type Ease = keyof typeof EASE;

type Keys = { at: number; value: number; ease?: Ease }[];
type Point = [number, number, number] | string;
export type ItemAction = Extract<DioramaAction, { target: unknown }>;

export interface ItemState {
  pos: THREE.Vector3;
  /** Degrees. */
  yaw: number;
  rx: number;
  rz: number;
  /** Fall: tilt angle (degrees) towards yaw `tiltDir`. */
  tilt: number;
  tiltDir: number;
  /** Multipliers of the base size. */
  scale: THREE.Vector3;
  /** Appear/disappear scale factor. */
  pop: number;
  opacity: number;
  visible: boolean;
  /** 0 off .. 1 on. */
  power: number;
  clip: string | null;
  clipTime: number;
  loop: boolean;
  text: string | null;
  shake: THREE.Vector3;
}

const DEG = Math.PI / 180;
const D2 = new THREE.Vector3();

export function evalKeys(keys: Keys, t: number): number {
  if (t <= keys[0]!.at) return keys[0]!.value;
  for (let k = 1; k < keys.length; k++) {
    const b = keys[k]!;
    if (t < b.at) {
      const a = keys[k - 1]!;
      return lerp(a.value, b.value, EASE[b.ease ?? "inOutQuad"](seg(t, a.at, b.at)));
    }
  }
  return keys[keys.length - 1]!.value;
}

/** 0 = full day .. 1 = full night. */
export function darkness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h > 20) return 1;
  if (h < 7.5) return 1 - (h - 5) / 2.5;
  if (h > 17.5) return (h - 17.5) / 2.5;
  return 0;
}

const startOf = (a: ItemAction): number => ("at" in a ? a.at : a.from);

export function baseSize(item: DioramaItem, text: string | null): [number, number, number] {
  const s = item.scale ?? 1;
  const m = item.model;
  let v: [number, number, number];
  if (typeof m === "string") v = dioramaModel(m)?.size ?? [1, 1, 1];
  else if (m.shape === "box") v = m.size;
  else if (m.shape === "cylinder") v = [2 * m.radius, m.height, 2 * m.radius];
  else if (m.shape === "cone") v = [2 * m.radius, m.height, 2 * m.radius];
  else if (m.shape === "sphere" || m.shape === "bulb") v = [2 * m.radius, 2 * m.radius, 2 * m.radius];
  else if (m.shape === "text") v = textSize(text ?? m.text, m.height, m.depth);
  else if (m.shape === "patch") v = [m.size[0], 0.02, m.size[1]];
  else if (m.shape === "clock") v = clockSize(m);
  else v = [0, 0, 0];
  return [v[0] * s, v[1] * s, v[2] * s];
}

export class Evaluator {
  readonly items = new Map<string, DioramaItem>();
  private acts = new Map<string, Map<string, ItemAction[]>>();
  private hours = new Map<string, number | Keys>();
  private cache = new Map<string, ItemState>();

  constructor(readonly data: DioramaData) {
    for (const it of data.items) this.items.set(it.id, it);
    for (const c of data.chapters) {
      if (c.hour !== undefined) this.hours.set(c.chapter, c.hour);
      const per = new Map<string, ItemAction[]>();
      for (const a of c.actions) {
        if (!("target" in a) || a.do === "trail") continue;
        for (const id of typeof a.target === "string" ? [a.target] : a.target) {
          const list = per.get(id) ?? [];
          list.push(a as ItemAction);
          per.set(id, list);
        }
      }
      for (const list of per.values()) list.sort((x, y) => startOf(x) - startOf(y)); // stable
      this.acts.set(c.chapter, per);
    }
  }

  /** Call once per frame: states are memoised per (item, chapter, t). */
  beginFrame(): void {
    this.cache.clear();
  }

  actionsOf(chapter: string, id: string): readonly ItemAction[] {
    return this.acts.get(chapter)?.get(id) ?? [];
  }

  /** Time a clock item shows at (chapter, t), minutes after midnight (not wrapped); null for other items. */
  clockMinutes(id: string, chapter: string, t: number): number | null {
    const m = this.items.get(id)?.model;
    if (!m || typeof m === "string" || m.shape !== "clock") return null;
    const keys = this.actionsOf(chapter, id).flatMap((a) => (a.do === "time" ? [{ at: a.at, minutes: clockMinutes(a.time), dur: a.dur }] : []));
    return clockAt(clockMinutes(m.time), keys, t);
  }

  hour(chapter: string, t: number): number {
    const h = this.hours.get(chapter) ?? this.data.stage.hour ?? 12;
    return typeof h === "number" ? h : evalKeys(h, t);
  }

  state(id: string, chapter: string, t: number, depth = 0): ItemState {
    const key = `${id}|${chapter}|${t}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const item = this.items.get(id);
    if (!item) throw new Error(`diorama: unknown item "${id}"`);
    const s = this.base(item, chapter, t);
    for (const a of this.actionsOf(chapter, id)) {
      if (startOf(a) > t) break;
      this.apply(a, item, s, chapter, t, depth);
    }
    this.cache.set(key, s);
    return s;
  }

  private base(item: DioramaItem, chapter: string, t: number): ItemState {
    const r = item.rot;
    const [rx, yaw, rz] = r === undefined ? [0, 0, 0] : typeof r === "number" ? [0, r, 0] : r;
    const acts = this.actionsOf(chapter, item.id);
    const firstVis = acts.find((a) => a.do === "show" || a.do === "hide");
    const firstPow = acts.find((a) => a.do === "power");
    let power = item.power === "night" ? (darkness(this.hour(chapter, t)) > 0.5 ? 1 : 0) : item.power === false ? 0 : 1;
    if (firstPow?.do === "power" && firstPow.on) power = 0;
    const m = typeof item.model === "string" ? dioramaModel(item.model) : undefined;
    const clip = item.anim ?? (m?.anims?.includes("idle") ? "idle" : null);
    return {
      pos: new THREE.Vector3(...item.pos),
      yaw,
      rx,
      rz,
      tilt: 0,
      tiltDir: 0,
      scale: new THREE.Vector3(1, 1, 1),
      pop: 1,
      opacity: 1,
      visible: firstVis ? firstVis.do === "hide" && !item.hidden : !item.hidden,
      power,
      clip,
      clipTime: t,
      loop: true,
      text: typeof item.model !== "string" && item.model.shape === "text" ? item.model.text : null,
      shake: new THREE.Vector3(),
    };
  }

  private apply(a: ItemAction, item: DioramaItem, s: ItemState, chapter: string, t: number, depth: number): void {
    switch (a.do) {
      case "show":
      case "hide": {
        const dur = a.dur ?? 0.4;
        const style = a.style ?? "pop";
        const p = dur > 0 ? seg(t, a.at, a.at + dur) : 1;
        s.visible = true;
        s.pop = 1;
        s.opacity = 1;
        if (a.do === "show") {
          if (style === "pop") s.pop = EASE.outBack(p);
          else if (style === "grow") s.pop = EASE.outQuad(p);
          else if (style === "fade") s.opacity = p;
        } else {
          if (style === "pop" || style === "grow") s.pop = 1 - EASE.inQuad(p);
          else if (style === "fade") s.opacity = 1 - p;
          if (p >= 1) s.visible = false;
        }
        return;
      }
      case "place":
        if (a.pos) s.pos.set(...a.pos);
        if (a.rot !== undefined) [s.rx, s.yaw, s.rz] = typeof a.rot === "number" ? [0, a.rot, 0] : a.rot;
        return;
      case "move": {
        const pts = [s.pos.clone(), ...a.path.map((p) => new THREE.Vector3(...p))];
        const lens = pts.slice(1).map((p, i) => p.distanceTo(pts[i]!));
        const total = lens.reduce((x, y) => x + y, 0);
        const p = EASE[a.ease ?? "inOutQuad"](seg(t, a.from, a.to));
        let d = p * total;
        let k = 0;
        while (k < lens.length - 1 && d > lens[k]!) d -= lens[k++]!;
        const f = lens[k]! > 0 ? clamp(d / lens[k]!) : 1;
        s.pos.lerpVectors(pts[k]!, pts[k + 1]!, f);
        if (a.arc) s.pos.y += Math.sin(Math.PI * p) * a.arc;
        if (a.face ?? a.anim !== undefined) {
          for (let j = k; j >= 0; j--) {
            D2.subVectors(pts[j + 1]!, pts[j]!);
            if (D2.x * D2.x + D2.z * D2.z > 1e-8) {
              s.yaw = Math.atan2(D2.x, D2.z) / DEG;
              break;
            }
          }
        }
        if (a.anim && t < a.to) {
          s.clip = a.anim;
          s.clipTime = t - a.from;
          s.loop = true;
        }
        return;
      }
      case "turn": {
        const p = EASE[a.ease ?? "inOutQuad"](seg(t, a.from, a.to));
        if (typeof a.by === "number") s.yaw += a.by * p;
        else {
          s.rx += a.by[0] * p;
          s.yaw += a.by[1] * p;
          s.rz += a.by[2] * p;
        }
        return;
      }
      case "scale": {
        const p = EASE[a.ease ?? "inOutQuad"](seg(t, a.from, a.to));
        const v = typeof a.value === "number" ? [a.value, a.value, a.value] : a.value;
        s.scale.set(lerp(s.scale.x, v[0]!, p), lerp(s.scale.y, v[1]!, p), lerp(s.scale.z, v[2]!, p));
        return;
      }
      case "anim":
        if (t < (a.to ?? Infinity)) {
          s.clip = a.clip;
          s.clipTime = (t - a.from) * (a.speed ?? 1);
          s.loop = a.loop ?? true;
        }
        return;
      case "shake": {
        if (t > a.to) return;
        const amt = a.amount ?? 0.05;
        s.shake.set(amt * Math.sin(t * 53 + 1.3), amt * 0.5 * Math.sin(t * 71), amt * Math.sin(t * 61 + 0.7));
        s.rz += Math.sin(t * 47) * amt * 60;
        return;
      }
      case "fall": {
        const q = EASE.inQuad(seg(t, a.at, a.at + (a.dur ?? 0.9)));
        s.tiltDir = a.dir ?? s.yaw;
        s.tilt = 90 * q;
        s.pos.y = lerp(s.pos.y, a.floor ?? 0, q);
        return;
      }
      case "explode":
        s.visible = false;
        return;
      case "power": {
        const dur = a.dur ?? 0.15;
        s.power = lerp(s.power, a.on ? 1 : 0, dur > 0 ? seg(t, a.at, a.at + dur) : 1);
        return;
      }
      case "blink": {
        if (t > a.to) return;
        let on: boolean;
        if ((a.mode ?? "blink") === "blink") {
          const period = a.period ?? 0.5;
          on = (t - a.from) % period < period / 2;
        } else {
          on = hash(Math.floor(t / 0.09), a.seed ?? 7) > 0.4;
        }
        s.power = on ? 1 : 0;
        return;
      }
      case "attach": {
        if (depth > 8) return; // attachment cycle: ignore (checkDioramaData reports it)
        const tt = Math.min(t, a.to ?? Infinity);
        const parent = this.state(a.parent, chapter, tt, depth + 1);
        this.point(a.parent, a.part, chapter, tt, s.pos, depth + 1);
        if (a.offset) s.pos.add(D2.set(...a.offset).applyQuaternion(this.quat(parent, new THREE.Quaternion())));
        const r = item.rot;
        s.yaw = parent.yaw + (r === undefined ? 0 : typeof r === "number" ? r : r[1]);
        s.tilt = parent.tilt;
        s.tiltDir = parent.tiltDir;
        return;
      }
      case "text":
        s.text = a.text;
        return;
      case "time": // clocks: see clockMinutes()
        return;
    }
  }

  /** Orientation: Euler(rx, yaw, rz) in YXZ order, then the fall tilt about a horizontal axis. */
  quat(s: ItemState, out: THREE.Quaternion): THREE.Quaternion {
    out.setFromEuler(new THREE.Euler(s.rx * DEG, s.yaw * DEG, s.rz * DEG, "YXZ"));
    if (s.tilt) {
      const d = s.tiltDir * DEG;
      const tq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(d), 0, -Math.sin(d)), s.tilt * DEG);
      out.premultiply(tq);
    }
    return out;
  }

  /** Part position in the item frame (metres, before the scale multipliers). */
  partLocal(item: DioramaItem, part: string | undefined, text: string | null, out: THREE.Vector3): boolean {
    const size = baseSize(item, text);
    if (!part) return !!out.set(0, 0, 0);
    const m = item.model;
    if (typeof m !== "string" && m.shape === "text" && /^\d+$/.test(part)) {
      const str = text ?? m.text;
      const i = Number(part);
      if (i >= [...str].length) return false;
      out.set(letterCenter(str, i, m.height * (item.scale ?? 1)), size[1] / 2, 0);
      return true;
    }
    const isPerson = typeof m === "string" && !!dioramaModel(m)?.tags.includes("person");
    const f = COMMON_PARTS[part] ?? (isPerson ? PERSON_PARTS[part] : undefined);
    if (!f) return false;
    out.set(f[0] * size[0], f[1] * size[1], f[2] * size[2]);
    if (typeof m !== "string" && m.shape === "bulb") out.y -= size[1] / 2; // bulbs are centred on pos
    return true;
  }

  /** World (root-local) position of an item part at (chapter, t). */
  point(id: string, part: string | undefined, chapter: string, t: number, out: THREE.Vector3, depth = 0): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    const s = this.state(id, chapter, t, depth);
    if (!this.partLocal(item, part, s.text, out)) return false;
    out.multiply(s.scale).multiplyScalar(s.pop).applyQuaternion(this.quat(s, new THREE.Quaternion()));
    out.add(s.pos).add(s.shake);
    return true;
  }

  resolvePoint(p: Point, chapter: string, t: number, out: THREE.Vector3): boolean {
    if (typeof p !== "string") return !!out.set(p[0], p[1], p[2]);
    const [id, part] = p.split(".") as [string, string | undefined];
    return this.point(id, part, chapter, t, out);
  }
}
