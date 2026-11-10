// DOM labels over the stage, projected every frame (prototype technique: buttons + CSS transform,
// pulse via the individual `scale` property so it does not fight the positioning transform).
// Decluttering (declutter.ts) decides where each label goes; this layer smooths the moves, draws the
// leader lines, the cluster bubbles ("Nome +N", fanned out on tap) and the dots for demoted labels.
import * as THREE from "three";
import type { Pin } from "@pv/scene-spec";
import { isTextPin, ndcVisible, pinVisibleAt } from "./timing.ts";
import { h } from "./dom.ts";
import {
  fanOut,
  isCallout,
  labelPriority,
  layoutLabels,
  leaderEnd,
  type LabelBox,
  type OccupancyGrid,
  type Placement,
  type PrevPlacement,
  type Rect,
} from "./declutter.ts";

/** "Etichette": every label, only the active ones (default), none. */
export type LabelMode = "all" | "active" | "none";

/**
 * Whether only the active labels (highlighted, focused, forced) may be full labels: "Solo attive" and
 * "Nascoste", also in the book overview; never while picking a label in a quiz.
 */
export function restrictsLabels(mode: LabelMode, picking: boolean): boolean {
  return !picking && mode !== "all";
}

const FALLBACK_MARKERS = ["#2c5fa6", "#b3342a", "#2e7d46", "#b07a1e", "#7a3fa0", "#1f6d86"];
/** Label offset smoothing rate (1/s): slot changes glide instead of jumping. */
const SMOOTH = 14;
/** Occlusion tests per frame (raycasts are throttled round-robin). */
const OCCLUSION_PER_FRAME = 1;

/** `marker` is a CSS colour; anything else gets a stable colour from a small palette. */
function markerColor(marker: string): string {
  if (typeof CSS !== "undefined" && CSS.supports?.("color", marker)) return marker;
  let hsh = 0;
  for (const ch of marker) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_MARKERS[hsh % FALLBACK_MARKERS.length]!;
}

interface Item {
  pin: Pin;
  el: HTMLButtonElement;
  more: HTMLElement;
  leader: HTMLElement;
  dot: HTMLButtonElement;
  size: { w: number; h: number } | null;
  /** Smoothed label centre offset from the anchor. */
  off: { x: number; y: number } | null;
  occluded: boolean;
  /** Anchor world position this frame (occlusion test). */
  world: THREE.Vector3;
}

export interface PinFrame {
  /** Pins highlighted by the current sentence. */
  highlighted: readonly string[];
  /** Answer pins of the active pick question, the pin with the open info card. */
  focused: readonly string[];
  /** Areas the labels must avoid, in stage pixels. */
  blocked: readonly Rect[];
  narrow: boolean;
  dt: number;
  /** Optional occlusion test of a pin anchor (world position). */
  occluded?: (world: THREE.Vector3) => boolean;
  /** Screen footprint of the 3D content and of its active things (labels avoid them). */
  content?: OccupancyGrid;
  keys?: OccupancyGrid;
  /** Flat content filling the stage (maps): labels may sit on it, small and translucent. */
  onContent?: boolean;
  mode?: LabelMode;
}

export class PinLayer {
  private items = new Map<string, Item>();
  private pins: readonly Pin[] = [];
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private prev = new Map<string, PrevPlacement>();
  /** Dots the user tapped open, and the cluster currently fanned out. */
  private forced = new Set<string>();
  /** Labels of the cluster currently fanned out (host first). */
  private fan: string[] = [];
  private lastPlacement = new Map<string, Placement>();
  private occlusionCursor = 0;
  private sizeKey = "";

  constructor(
    private container: HTMLElement,
    private onTap: (pin: Pin, el: HTMLButtonElement) => void,
    /** Accademico (D24): writes a label name that reads as a formula with KaTeX; false = plain text. */
    private formula?: (el: HTMLElement, text: string) => boolean,
  ) {}

  setPins(pins: readonly Pin[]): void {
    this.container.replaceChildren();
    this.items.clear();
    this.prev.clear();
    this.forced.clear();
    this.fan = [];
    this.pins = pins;
    pins.forEach((p, n) => {
      const text = isTextPin(p.kind);
      const el = h("button", { type: "button", class: `pv-pin k-${p.kind}${text ? " text" : ""}`, "aria-label": p.name });
      const more = h("span", { class: "more" });
      more.hidden = true;
      if (text) el.append(p.name, more);
      else {
        const tag = h("span", { class: "tag" });
        if (p.marker) {
          const mk = h("i", { class: "mk" });
          mk.style.background = markerColor(p.marker);
          tag.append(mk);
        }
        const name = h("span", {}, p.name);
        this.formula?.(name, p.name);
        tag.append(name);
        if (p.sub) tag.append(" ", h("small", {}, p.sub));
        el.append(tag, more);
      }
      const leader = h("div", { class: "pv-leader", "aria-hidden": "true" });
      // Numbered dot: the same numbers as the "Etichette" list in the panel.
      const dot = h("button", { type: "button", class: "pv-pin-dot", "aria-label": `${n + 1}. ${p.name}: mostra l'etichetta` }, String(n + 1));
      el.hidden = leader.hidden = dot.hidden = true;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const pl = this.lastPlacement.get(p.id);
        // A cluster bubble fans out first; its labels then work as usual.
        if (pl?.mode === "label" && pl.members.length && !this.fan.includes(p.id)) {
          this.fan = [p.id, ...pl.members];
          return;
        }
        this.onTap(p, el);
      });
      dot.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const pl = this.lastPlacement.get(p.id);
        const host = pl?.mode === "member" ? this.lastPlacement.get(pl.host) : undefined;
        if (host?.mode === "label") this.fan = [host.id, ...host.members];
        else this.forced.add(p.id);
      });
      this.container.append(leader, dot, el);
      this.items.set(p.id, { pin: p, el, more, leader, dot, size: null, off: null, occluded: false, world: new THREE.Vector3() });
    });
  }

  /** Tap on the empty stage: close the fanned cluster and the dots opened by hand. */
  collapse(): void {
    this.fan = [];
    this.forced.clear();
  }

  /** `resolve` writes the pin's world position; returns false if unresolvable. */
  update(
    t: number,
    picking: boolean,
    resolve: (pin: Pin, out: THREE.Vector3) => boolean,
    project: (v: THREE.Vector3) => THREE.Vector3,
    width: number,
    height: number,
    f: PinFrame = { highlighted: [], focused: [], blocked: [], narrow: false, dt: 0 },
  ): void {
    // Sizes depend on the stage width (phone CSS): measure again after a breakpoint change.
    const key = f.narrow ? "n" : "w";
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      for (const it of this.items.values()) it.size = null;
    }
    const anchors = new Map<string, { x: number; y: number; z: number }>();
    const toMeasure: Item[] = [];
    const occlusionIds: string[] = [];
    for (const p of this.pins) {
      const it = this.items.get(p.id)!;
      if (!pinVisibleAt(p, t, picking) || !resolve(p, this.v)) continue;
      const world = this.w.copy(this.v);
      const n = project(this.v);
      if (!ndcVisible(n.x, n.y, n.z)) continue;
      anchors.set(p.id, { x: ((n.x + 1) / 2) * width, y: ((1 - n.y) / 2) * height, z: n.z });
      if (!it.size) toMeasure.push(it);
      occlusionIds.push(p.id);
      it.world.copy(world);
    }
    if (toMeasure.length) {
      for (const it of toMeasure) {
        it.el.hidden = false;
        it.el.style.transform = "translate(-9999px,-9999px)";
      }
      for (const it of toMeasure) it.size = { w: Math.max(8, it.el.offsetWidth), h: Math.max(8, it.el.offsetHeight) };
    }

    // Throttled occlusion: a couple of raycasts per frame, round-robin.
    if (f.occluded && occlusionIds.length) {
      for (let k = 0; k < Math.min(OCCLUSION_PER_FRAME, occlusionIds.length); k++) {
        const id = occlusionIds[this.occlusionCursor++ % occlusionIds.length]!;
        const it = this.items.get(id)!;
        it.occluded = f.occluded(it.world);
      }
    }

    const hi = new Set(f.highlighted);
    const fo = new Set(f.focused);
    const boxes: LabelBox[] = [];
    for (const [id, a] of anchors) {
      const it = this.items.get(id)!;
      boxes.push({
        id,
        ax: a.x,
        ay: a.y,
        w: it.size!.w,
        h: it.size!.h,
        priority: labelPriority(it.pin.kind, hi.has(id), fo.has(id)),
        depth: a.z,
        centered: isTextPin(it.pin.kind),
      });
    }
    // A fanned cluster's labels are placed by fanOut, the rest of the layout works around them.
    const fanSet = new Set(this.fan.filter((id) => anchors.has(id)));
    if (fanSet.size < 2) fanSet.clear();
    const fanRects: Rect[] = [];
    const fanPos = new Map<string, [number, number]>();
    if (fanSet.size) {
      const ids = [...fanSet];
      const cx = ids.reduce((s, id) => s + anchors.get(id)!.x, 0) / ids.length;
      const cy = ids.reduce((s, id) => s + anchors.get(id)!.y, 0) / ids.length;
      const pos = fanOut(cx, cy, ids.map((id) => this.items.get(id)!.size!));
      ids.forEach((id, i) => {
        const s = this.items.get(id)!.size!;
        const [x, y] = pos[i]!;
        const r = { x: Math.min(Math.max(x - s.w / 2, 4), width - 4 - s.w), y: Math.min(Math.max(y - s.h / 2, 4), height - 4 - s.h), w: s.w, h: s.h };
        fanRects.push(r);
        fanPos.set(id, [r.x + s.w / 2, r.y + s.h / 2]);
      });
    } else this.fan = [];

    // Progressive disclosure: who may be a full label right now.
    const mode = f.mode ?? "all";
    let active: Set<string> | undefined;
    if (restrictsLabels(mode, picking)) active = new Set([...hi, ...fo, ...this.forced]);
    const layout = layoutLabels({
      labels: boxes.filter((b) => !fanSet.has(b.id)),
      width,
      height,
      blocked: [...f.blocked, ...fanRects],
      prev: this.prev,
      maxExpanded: f.narrow ? 6 : 14,
      clusterRadius: f.narrow ? 34 : 42,
      stem: f.narrow ? 10 : 12,
      margin: 16, // clear of the paper frame drawn around close-ups
      forced: this.forced,
      content: f.content,
      keys: f.keys,
      onContent: f.onContent,
      active,
    });
    if (!picking) {
      for (const [id, pl] of layout) {
        if (active?.has(id) || fo.has(id) || this.forced.has(id)) continue;
        const a = anchors.get(id);
        // "Nascoste": nothing but the focus. Spotlight / active experiment: no dots inside the active area.
        if (mode === "none" || (mode === "active" && a && f.keys?.hit(a.x, a.y) && pl.mode !== "label")) layout.set(id, { id, mode: "hidden" });
      }
    }
    for (const id of fanSet) layout.set(id, { id, mode: "label", slot: 0, rect: fanRects[[...fanSet].indexOf(id)]!, members: [] });
    this.lastPlacement = layout;

    const k = 1 - Math.exp(-SMOOTH * Math.max(0, f.dt));
    for (const it of this.items.values()) {
      const id = it.pin.id;
      const a = anchors.get(id);
      const pl = a ? layout.get(id) : undefined;
      if (!a || !pl || pl.mode === "member" || pl.mode === "hidden") {
        if (!a) it.off = null;
        this.show(it, false, false, false);
        if (a && pl && pl.mode !== "hidden") this.prev.set(id, { demoted: true });
        continue;
      }
      if (pl.mode === "dot") {
        this.prev.set(id, { demoted: true });
        this.show(it, false, false, true);
        it.dot.style.transform = `translate(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px)`;
        it.off = null;
        continue;
      }
      if (!fanSet.has(id)) this.prev.set(id, { slot: pl.slot });
      const target = { x: pl.rect.x + pl.rect.w / 2 - a.x, y: pl.rect.y + pl.rect.h / 2 - a.y };
      if (!it.off || f.dt <= 0) it.off = { ...target };
      else {
        it.off.x += (target.x - it.off.x) * k;
        it.off.y += (target.y - it.off.y) * k;
      }
      const s = it.size!;
      const r = { x: a.x + it.off.x - s.w / 2, y: a.y + it.off.y - s.h / 2, w: s.w, h: s.h };
      it.el.style.transform = `translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px)`;
      const n = pl.members.length;
      it.more.hidden = n === 0 || fanSet.has(id);
      if (n) it.more.textContent = `+${n}`;
      // Leader line from the anchor to the nearest point of the label.
      const [ex, ey] = leaderEnd(a.x, a.y, r);
      const len = Math.hypot(ex - a.x, ey - a.y);
      const lead = len > 2;
      if (lead) {
        it.leader.style.width = `${len.toFixed(1)}px`;
        it.leader.style.transform = `translate(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px) rotate(${Math.atan2(ey - a.y, ex - a.x).toFixed(4)}rad)`;
        it.dot.style.transform = `translate(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px)`;
      }
      this.show(it, true, lead, lead);
      it.dot.classList.toggle("anchor", true);
    }
    for (const it of this.items.values()) {
      const pl = layout.get(it.pin.id);
      if (pl?.mode === "dot") it.dot.classList.remove("anchor");
      const lab = pl?.mode === "label" ? pl : null;
      it.el.classList.toggle("callout", !!lab && isCallout(lab.slot));
      it.el.classList.toggle("on-content", !!lab && !!f.onContent && !!f.content?.blocks(lab.rect));
      it.el.classList.toggle("occluded", it.occluded);
      it.el.classList.toggle("cluster", pl?.mode === "label" && pl.members.length > 0 && !fanSet.has(it.pin.id));
      it.el.classList.toggle("fanned", fanSet.has(it.pin.id));
    }
  }

  pulse(ids: readonly string[]): void {
    for (const id of ids) restartClass(this.items.get(id)?.el, "pulse");
  }

  shake(id: string): void {
    restartClass(this.items.get(id)?.el, "wrong");
  }

  markRight(ids: readonly string[]): void {
    for (const [id, it] of this.items) it.el.classList.toggle("right", ids.includes(id));
  }

  private show(it: Item, label: boolean, leader: boolean, dot: boolean): void {
    if (it.el.hidden === label) it.el.hidden = !label;
    if (it.leader.hidden === leader) it.leader.hidden = !leader;
    if (it.dot.hidden === dot) it.dot.hidden = !dot;
  }
}

function restartClass(el: HTMLElement | undefined, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow restarts the CSS animation
  el.classList.add(cls);
}
