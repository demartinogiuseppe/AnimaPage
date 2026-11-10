// Screen-space label decluttering: a pure function (label boxes in -> placements out), run every frame
// after projection. Greedy placement in priority order over candidate slots around each anchor, with
// hysteresis (a label keeps its slot while it is free). Labels avoid the 3D content itself (a coarse
// occupancy grid of the projected content), not only each other: when there is no free spot near the
// anchor they become callouts in the stage margins, like the labels of a textbook plate, stacked in
// anchor order so leader lines do not cross. What still does not fit joins a cluster ("Nome +N") or
// becomes a small numbered dot.
import type { PinKind } from "@pv/scene-spec";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelBox {
  id: string;
  /** Anchor in stage pixels. */
  ax: number;
  ay: number;
  /** Label size in pixels. */
  w: number;
  h: number;
  /** Higher first (see labelPriority). */
  priority: number;
  /** Distance or NDC depth: nearer labels win ties. */
  depth: number;
  /** Atlas text (seas, regions): centred on the anchor by default, no leader. */
  centered: boolean;
}

export interface PrevPlacement {
  slot?: number;
  demoted?: boolean;
}

export interface LayoutInput {
  labels: readonly LabelBox[];
  width: number;
  height: number;
  /** Areas labels must avoid (HUD, timeline, info card...). */
  blocked: readonly Rect[];
  prev?: ReadonlyMap<string, PrevPlacement>;
  /** Cap on pill labels shown in full (phones); FOCUS priority and above, and atlas text, are not capped. */
  maxExpanded?: number;
  /** Anchors closer than this (px) to a placed label's anchor join its cluster. */
  clusterRadius?: number;
  /** Distance kept from the stage edges. */
  margin?: number;
  /** Leader length unit (px). */
  stem?: number;
  /** Labels the user expanded (tapped dots): always placed in full. */
  forced?: ReadonlySet<string>;
  /** Screen footprint of the 3D content: label boxes avoid it (the anchor dot does not). */
  content?: OccupancyGrid;
  /** Footprint of the active/highlighted things: never covered, not even when `onContent`. */
  keys?: OccupancyGrid;
  /** Flat content filling the stage (a map): labels may sit on `content`, never on `keys`. */
  onContent?: boolean;
  /**
   * Progressive disclosure: only these labels may be shown in full; the others are dots (atlas text is
   * hidden instead). Undefined = every label may be full ("Tutte").
   */
  active?: ReadonlySet<string>;
}

/** Callout slots (labels moved to the stage margins). */
export const CALLOUT_LEFT = 100;
export const CALLOUT_RIGHT = 101;
export const CALLOUT_TOP = 102;
export const isCallout = (slot: number) => slot >= CALLOUT_LEFT;

/** Coarse screen occupancy (e.g. 32 x 24 cells) filled from projected boxes. Pure, no GPU readback. */
export class OccupancyGrid {
  readonly cells: Uint8Array;
  readonly cw: number;
  readonly ch: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cols = 32,
    readonly rows = 24,
  ) {
    this.cells = new Uint8Array(cols * rows);
    this.cw = width / cols;
    this.ch = height / rows;
  }

  private span(r: Rect, shrink: number): [number, number, number, number] {
    const sx = this.cw * shrink;
    const sy = this.ch * shrink;
    const c0 = Math.max(0, Math.floor((r.x + sx) / this.cw));
    const c1 = Math.min(this.cols - 1, Math.floor((r.x + r.w - sx) / this.cw));
    const r0 = Math.max(0, Math.floor((r.y + sy) / this.ch));
    const r1 = Math.min(this.rows - 1, Math.floor((r.y + r.h - sy) / this.ch));
    return [c0, c1, r0, r1];
  }

  /** Marks the cells mostly covered by `r` (a third of a cell of tolerance on each side). */
  fill(r: Rect): void {
    const [c0, c1, r0, r1] = this.span(r, 0.33);
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) this.cells[y * this.cols + x] = 1;
  }

  /** True when `r` touches an occupied cell. */
  blocks(r: Rect): boolean {
    const [c0, c1, r0, r1] = this.span(r, 0.05);
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (this.cells[y * this.cols + x]) return true;
    return false;
  }

  /** True when the point lies in an occupied cell. */
  hit(x: number, y: number): boolean {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.cells[r * this.cols + c] === 1;
  }

  /** Share of the stage that is occupied, 0..1. */
  fraction(): number {
    let n = 0;
    for (const v of this.cells) n += v;
    return n / this.cells.length;
  }
}

export type Placement =
  | { id: string; mode: "label"; slot: number; rect: Rect; members: string[] }
  | { id: string; mode: "member"; host: string }
  | { id: string; mode: "dot" }
  | { id: string; mode: "hidden" };

/** Priority bands. */
export const PRIORITY = { HIGHLIGHT: 1000, FOCUS: 500 } as const;

const KIND_RANK: Record<PinKind, number> = {
  person: 6,
  event: 6,
  city: 5,
  peak: 5,
  data: 5,
  object: 4,
  group: 4,
  note: 3,
  place: 3,
  island: 2,
  river: 2,
  area: 1,
  sea: 1,
  region: 1,
};

/** Highlighted by the current sentence > pick answers / open info card > kind importance. */
export function labelPriority(kind: PinKind, highlighted: boolean, focused: boolean): number {
  return (highlighted ? PRIORITY.HIGHLIGHT : 0) + (focused ? PRIORITY.FOCUS : 0) + KIND_RANK[kind] * 10;
}

/** Number of candidate slots. */
export const SLOT_COUNT = 16;

/**
 * Centre of the label rect relative to its anchor for slot k: above (default), below, right, left,
 * the four diagonals, then the same eight directions farther away. Centred labels use slot 0 = on the anchor.
 */
export function slotOffset(k: number, w: number, h: number, stem: number, centered: boolean): [number, number] {
  if (k === 0 && centered) return [0, 0];
  const far = k >= 8 ? 2.6 : 1;
  const s = stem * far;
  const d = s * 0.75;
  switch (k % 8) {
    case 0:
      return [0, -(h / 2 + s)];
    case 1:
      return [0, h / 2 + s];
    case 2:
      return [w / 2 + s, 0];
    case 3:
      return [-(w / 2 + s), 0];
    case 4:
      return [w / 2 + d, -(h / 2 + d)];
    case 5:
      return [-(w / 2 + d), -(h / 2 + d)];
    case 6:
      return [w / 2 + d, h / 2 + d];
    default:
      return [-(w / 2 + d), h / 2 + d];
  }
}

export function intersects(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function layoutLabels(input: LayoutInput): Map<string, Placement> {
  const { width, height, blocked } = input;
  const margin = input.margin ?? 6;
  const stem = input.stem ?? 12;
  const clusterR = input.clusterRadius ?? 40;
  const maxExpanded = input.maxExpanded ?? Infinity;
  const prev = input.prev ?? new Map<string, PrevPlacement>();
  const forced = input.forced ?? new Set<string>();
  const order = [...input.labels].sort(
    (a, b) =>
      Number(forced.has(b.id)) - Number(forced.has(a.id)) || b.priority - a.priority || a.depth - b.depth || (a.id < b.id ? -1 : 1),
  );

  const out = new Map<string, Placement>();
  const placedRects: Rect[] = [];
  const hosts: Array<{ box: LabelBox; p: Extract<Placement, { mode: "label" }> }> = [];
  let expanded = 0;

  const rectAt = (b: LabelBox, k: number): Rect => {
    const [dx, dy] = slotOffset(k, b.w, b.h, stem, b.centered);
    return { x: b.ax + dx - b.w / 2, y: b.ay + dy - b.h / 2, w: b.w, h: b.h };
  };
  const inside = (r: Rect) => r.x >= margin && r.y >= margin && r.x + r.w <= width - margin && r.y + r.h <= height - margin;
  const onContent = !!input.onContent;
  const clearOfContent = (r: Rect, soft: boolean) => !input.keys?.blocks(r) && (soft || !input.content?.blocks(r));
  const free = (r: Rect, pad: number, soft = onContent) =>
    inside(r) && clearOfContent(r, soft) && !blocked.some((q) => intersects(r, q, pad)) && !placedRects.some((q) => intersects(r, q, pad));
  const callouts: LabelBox[] = [];
  // Labels should not cover other anchors either (soft rule: tried first, dropped if nothing fits).
  const anchorRects = input.labels.map((l) => ({ id: l.id, r: { x: l.ax - 4, y: l.ay - 4, w: 8, h: 8 } }));
  const clearOfAnchors = (r: Rect, self: string) => anchorRects.every((a) => a.id === self || !intersects(r, a.r));

  for (const b of order) {
    const must = forced.has(b.id) || b.priority >= PRIORITY.FOCUS;
    const was = prev.get(b.id);
    let slot = -1;
    // Progressive disclosure: a label that is not active right now is a dot (atlas text disappears).
    if (!must && input.active && !input.active.has(b.id)) {
      out.set(b.id, { id: b.id, mode: b.centered ? "hidden" : "dot" });
      continue;
    }
    // Atlas text (seas, regions) is light: it does not count towards the cap.
    if (must || b.centered || expanded < maxExpanded) {
      // Hysteresis: keep the previous slot while it is free; a demoted label needs some room to come back.
      const pad = was?.demoted ? 6 : 0;
      if (was?.slot !== undefined && !isCallout(was.slot) && !was.demoted && free(rectAt(b, was.slot), 0)) slot = was.slot;
      for (let k = 0; slot < 0 && k < SLOT_COUNT; k++) {
        const r = rectAt(b, k);
        if (free(r, pad) && clearOfAnchors(r, b.id)) slot = k;
      }
      for (let k = 0; slot < 0 && k < SLOT_COUNT; k++) if (free(rectAt(b, k), pad)) slot = k;
      // Nothing near the anchor outside the content: a callout in the margins (placed after this loop).
      if (slot < 0 && !b.centered) {
        callouts.push(b);
        continue;
      }
      if (slot < 0 && must) {
        // Must be shown: the slot with the least overlap, pushed inside the stage.
        let best = Infinity;
        for (let k = 0; k < SLOT_COUNT; k++) {
          const r = rectAt(b, k);
          const cost = [...placedRects, ...blocked].reduce((s, q) => s + overlapArea(r, q), 0) + (inside(r) ? 0 : 1e6);
          if (cost < best) {
            best = cost;
            slot = k;
          }
        }
      }
    }
    if (slot >= 0) {
      const rect = rectAt(b, slot);
      if (!inside(rect)) {
        rect.x = Math.min(Math.max(rect.x, margin), width - margin - rect.w);
        rect.y = Math.min(Math.max(rect.y, margin), height - margin - rect.h);
      }
      const p = { id: b.id, mode: "label" as const, slot, rect, members: [] as string[] };
      out.set(b.id, p);
      placedRects.push(rect);
      hosts.push({ box: b, p });
      if (!b.centered) expanded++;
      continue;
    }
    demote(b);
  }

  // Callouts: margins on the anchor's side first, stacked top to bottom in anchor order so that the
  // leader lines of one side never cross; then a row along the top; then clusters and dots.
  const lastY = { [CALLOUT_LEFT]: -Infinity, [CALLOUT_RIGHT]: -Infinity } as Record<number, number>;
  const gap = 4;
  for (const b of callouts.sort((a, c) => a.ay - c.ay || (a.id < c.id ? -1 : 1))) {
    const must = forced.has(b.id) || b.priority >= PRIORITY.FOCUS;
    const sides = b.ax < width / 2 ? [CALLOUT_LEFT, CALLOUT_RIGHT] : [CALLOUT_RIGHT, CALLOUT_LEFT];
    let placed: Rect | null = null;
    let slot = -1;
    for (const side of sides) {
      const x = side === CALLOUT_LEFT ? margin : width - margin - b.w;
      const y0 = Math.max(margin, lastY[side]! + gap, Math.min(b.ay - b.h / 2, height - margin - b.h));
      for (let y = y0; y + b.h <= height - margin && !placed; y += 4) {
        const r = { x, y, w: b.w, h: b.h };
        if (free(r, 2, false) || (onContent && free(r, 2, true))) placed = r;
      }
      if (placed) {
        slot = side;
        lastY[side] = placed.y + placed.h;
        break;
      }
    }
    if (!placed) {
      for (let x = Math.max(margin, Math.min(b.ax - b.w / 2, width - margin - b.w)), k = 0; k < 2 * width && !placed; k += 6) {
        // Search sideways from above the anchor, alternating right and left.
        const dx = (k % 12 === 0 ? 1 : -1) * Math.floor(k / 12) * 6;
        const r = { x: x + dx, y: margin, w: b.w, h: b.h };
        if (free(r, 2, false)) placed = r;
      }
      if (placed) slot = CALLOUT_TOP;
    }
    if (!placed && must) {
      // Must be shown (focus, tapped): over the content, but still away from the active things if possible.
      for (let k = 0; k < SLOT_COUNT && !placed; k++) if (free(rectAt(b, k), 0, true)) placed = rectAt(b, k), (slot = k);
      if (!placed) placed = rectAt(b, 0), (slot = 0);
      placed.x = Math.min(Math.max(placed.x, margin), width - margin - placed.w);
      placed.y = Math.min(Math.max(placed.y, margin), height - margin - placed.h);
    }
    if (placed) {
      const p = { id: b.id, mode: "label" as const, slot, rect: placed, members: [] as string[] };
      out.set(b.id, p);
      placedRects.push(placed);
      hosts.push({ box: b, p });
      if (!b.centered) expanded++;
    } else demote(b);
  }
  return out;

  /** Not placed: join the nearest placed label within the cluster radius, or become a dot. */
  function demote(b: LabelBox): void {
    let host: (typeof hosts)[number] | null = null;
    let bestD = clusterR;
    for (const hst of hosts) {
      const d = Math.hypot(hst.box.ax - b.ax, hst.box.ay - b.ay);
      if (d <= bestD) {
        bestD = d;
        host = hst;
      }
    }
    if (host) {
      host.p.members.push(b.id);
      out.set(b.id, { id: b.id, mode: "member", host: host.p.id });
    } else out.set(b.id, { id: b.id, mode: b.centered && input.active ? "hidden" : "dot" });
  }
}

/** True when two segments cross (leader lines). */
export function segmentsCross(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const [x1, y1, x2, y2] = a;
  const [x3, y3, x4, y4] = b;
  return o(x1, y1, x2, y2, x3, y3) * o(x1, y1, x2, y2, x4, y4) < 0 && o(x3, y3, x4, y4, x1, y1) * o(x3, y3, x4, y4, x2, y2) < 0;
}

/**
 * Fan-out of a tapped cluster: label centres spread on an arc above the cluster's anchor centroid
 * (falls back to a full circle for many labels). Pure.
 */
export function fanOut(cx: number, cy: number, sizes: ReadonlyArray<{ w: number; h: number }>, stem = 12): Array<[number, number]> {
  const n = sizes.length;
  if (n === 0) return [];
  const maxH = Math.max(...sizes.map((s) => s.h));
  const full = n > 5;
  const span = full ? Math.PI * 2 : Math.PI * 0.9;
  const start = full ? -Math.PI / 2 : -Math.PI / 2 - span / 2;
  const step = full ? span / n : n > 1 ? span / (n - 1) : 0;
  const at = (r: number): Array<[number, number]> =>
    sizes.map((_, i) => {
      const a = n === 1 ? -Math.PI / 2 : start + step * i;
      // Wider than tall: labels are wide, so the ellipse is too.
      return [cx + Math.cos(a) * r * 1.8, cy + Math.sin(a) * r];
    });
  // Grow the ellipse until no two labels overlap.
  let r = stem * 2 + maxH;
  for (let k = 0; k < 60; k++, r += 6) {
    const pos = at(r);
    const rs = pos.map(([x, y], i) => ({ x: x - sizes[i]!.w / 2, y: y - sizes[i]!.h / 2, w: sizes[i]!.w, h: sizes[i]!.h }));
    let ok = true;
    for (let i = 0; i < n && ok; i++) for (let j = i + 1; j < n && ok; j++) if (intersects(rs[i]!, rs[j]!, 2)) ok = false;
    if (ok) return pos;
  }
  return at(r);
}

/** Point of the rect border closest to the anchor, where the leader line ends. */
export function leaderEnd(ax: number, ay: number, r: Rect): [number, number] {
  return [Math.min(Math.max(ax, r.x), r.x + r.w), Math.min(Math.max(ay, r.y), r.y + r.h)];
}
