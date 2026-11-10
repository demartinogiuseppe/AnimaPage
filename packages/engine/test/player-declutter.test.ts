import { describe, expect, it } from "vitest";
import {
  CALLOUT_LEFT,
  CALLOUT_RIGHT,
  isCallout,
  OccupancyGrid,
  segmentsCross,
  fanOut,
  intersects,
  labelPriority,
  layoutLabels,
  leaderEnd,
  PRIORITY,
  type LabelBox,
  type Placement,
  type PrevPlacement,
  type Rect,
} from "../src/player/declutter.ts";

const box = (id: string, ax: number, ay: number, priority = 50, w = 80, h = 22, centered = false): LabelBox => ({
  id,
  ax,
  ay,
  w,
  h,
  priority,
  depth: 0.5,
  centered,
});

const W = 400;
const H = 300;
const placed = (m: Map<string, Placement>) =>
  [...m.values()].filter((p): p is Extract<Placement, { mode: "label" }> => p.mode === "label");

function noOverlaps(m: Map<string, Placement>, blocked: Rect[] = []): void {
  const rs = placed(m).map((p) => p.rect);
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(W);
    expect(r.y + r.h).toBeLessThanOrEqual(H);
    for (const b of blocked) expect(intersects(r, b)).toBe(false);
    for (let j = i + 1; j < rs.length; j++) expect(intersects(r, rs[j]!)).toBe(false);
  }
}

describe("layoutLabels", () => {
  it("puts a lone label above its anchor (default slot)", () => {
    const m = layoutLabels({ labels: [box("a", 200, 150)], width: W, height: H, blocked: [] });
    const p = m.get("a") as Extract<Placement, { mode: "label" }>;
    expect(p.mode).toBe("label");
    expect(p.slot).toBe(0);
    expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(150);
    expect(p.rect.x + p.rect.w / 2).toBeCloseTo(200);
  });

  it("never overlaps labels, stage edges or blocked areas", () => {
    const labels: LabelBox[] = [];
    for (let i = 0; i < 30; i++) labels.push(box(`p${i}`, 60 + ((i * 53) % 280), 40 + ((i * 37) % 220)));
    const blocked = [{ x: 0, y: 260, w: 400, h: 40 }];
    const m = layoutLabels({ labels, width: W, height: H, blocked });
    noOverlaps(m, blocked);
    expect(m.size).toBe(30);
  });

  it("moves a label to another slot when the default is taken", () => {
    const m = layoutLabels({ labels: [box("a", 200, 150, 60), box("b", 205, 152, 50)], width: W, height: H, blocked: [] });
    const b = m.get("b") as Extract<Placement, { mode: "label" }>;
    expect(b.mode).toBe("label");
    expect(b.slot).not.toBe(0);
    noOverlaps(m);
  });

  it("respects priority: the highlighted label gets the default slot", () => {
    const hi = box("hi", 200, 150, labelPriority("place", true, false));
    const lo = box("lo", 200, 150, labelPriority("city", false, false));
    const m = layoutLabels({ labels: [lo, hi], width: W, height: H, blocked: [] });
    expect((m.get("hi") as Extract<Placement, { mode: "label" }>).slot).toBe(0);
    expect(labelPriority("place", true, false)).toBeGreaterThan(labelPriority("person", false, true));
    expect(labelPriority("sea", false, true)).toBeGreaterThan(labelPriority("person", false, false));
  });

  it("clusters labels that cannot be placed next to a placed one", () => {
    // Only one free spot (above the anchors); margins and top row are blocked, so no callouts either.
    const labels = [box("a", 100, 72, 90), box("b", 104, 74, 50), box("c", 98, 76, 40)];
    const blocked = [
      { x: 0, y: 0, w: 200, h: 30 },
      { x: 0, y: 64, w: 200, h: 36 },
      { x: 0, y: 30, w: 55, h: 34 },
      { x: 145, y: 30, w: 55, h: 34 },
    ];
    const m = layoutLabels({ labels, width: 200, height: 100, blocked, margin: 2 });
    const a = m.get("a") as Extract<Placement, { mode: "label" }>;
    expect(a.mode).toBe("label");
    expect(a.members.sort()).toEqual(["b", "c"]);
    expect(m.get("b")).toEqual({ id: "b", mode: "member", host: "a" });
  });

  it("demotes far-away unplaceable labels to dots and caps expanded labels", () => {
    const labels = [box("a", 200, 150, 90), box("b", 30, 150, 50), box("c", 370, 150, 40)];
    const m = layoutLabels({ labels, width: W, height: H, blocked: [], maxExpanded: 1 });
    expect(m.get("a")!.mode).toBe("label");
    expect(m.get("b")!.mode).toBe("dot");
    expect(m.get("c")!.mode).toBe("dot");
    // Focused labels ignore the cap.
    const f = layoutLabels({ labels: [...labels, box("f", 100, 60, PRIORITY.FOCUS + 10)], width: W, height: H, blocked: [], maxExpanded: 1 });
    expect(f.get("f")!.mode).toBe("label");
    // Dots tapped open are placed.
    const g = layoutLabels({ labels, width: W, height: H, blocked: [], maxExpanded: 1, forced: new Set(["c"]) });
    expect(g.get("c")!.mode).toBe("label");
  });

  it("is stable under small moves (hysteresis keeps the previous slot)", () => {
    const labels = [box("a", 200, 150, 60), box("b", 205, 152, 50)];
    let m = layoutLabels({ labels, width: W, height: H, blocked: [] });
    const prev = new Map<string, PrevPlacement>();
    for (const p of placed(m)) prev.set(p.id, { slot: p.slot });
    const slotB = (m.get("b") as Extract<Placement, { mode: "label" }>).slot;
    for (let k = 1; k <= 20; k++) {
      const moved = labels.map((l, i) => ({ ...l, ax: l.ax + Math.sin(k + i) * 2, ay: l.ay + Math.cos(k) * 2 }));
      m = layoutLabels({ labels: moved, width: W, height: H, blocked: [], prev });
      expect((m.get("b") as Extract<Placement, { mode: "label" }>).slot).toBe(slotB);
      noOverlaps(m);
    }
    // Once "a" goes away, "b" keeps its slot while it is free (no jump back to the default).
    m = layoutLabels({ labels: [labels[1]!], width: W, height: H, blocked: [], prev });
    expect((m.get("b") as Extract<Placement, { mode: "label" }>).slot).toBe(slotB);
  });

  it("centres atlas text on its anchor", () => {
    const m = layoutLabels({ labels: [box("sea", 200, 150, 10, 90, 18, true)], width: W, height: H, blocked: [] });
    const r = (m.get("sea") as Extract<Placement, { mode: "label" }>).rect;
    expect(r.x + r.w / 2).toBeCloseTo(200);
    expect(r.y + r.h / 2).toBeCloseTo(150);
  });
});

describe("fanOut and leaders", () => {
  it("spreads cluster labels without overlaps", () => {
    for (const n of [2, 4, 7]) {
      const sizes = Array.from({ length: n }, () => ({ w: 90, h: 22 }));
      const pos = fanOut(200, 150, sizes);
      const rs = pos.map(([x, y]) => ({ x: x - 45, y: y - 11, w: 90, h: 22 }));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(intersects(rs[i]!, rs[j]!)).toBe(false);
    }
  });

  it("ends the leader on the label border nearest to the anchor", () => {
    expect(leaderEnd(0, 0, { x: 10, y: -5, w: 20, h: 10 })).toEqual([10, 0]);
    expect(leaderEnd(15, 20, { x: 10, y: -5, w: 20, h: 10 })).toEqual([15, 5]);
  });
});

describe("labels and the 3D content", () => {
  const grid = (rects: Rect[], w = W, h = H) => {
    const g = new OccupancyGrid(w, h, 32, 24);
    for (const r of rects) g.fill(r);
    return g;
  };

  it("fills a coarse occupancy grid from boxes", () => {
    const g = grid([{ x: 100, y: 100, w: 100, h: 50 }]);
    expect(g.blocks({ x: 120, y: 110, w: 20, h: 10 })).toBe(true);
    expect(g.blocks({ x: 300, y: 10, w: 40, h: 20 })).toBe(false);
    expect(g.hit(150, 120)).toBe(true);
    expect(g.hit(10, 10)).toBe(false);
    expect(g.fraction()).toBeGreaterThan(0);
    expect(g.fraction()).toBeLessThan(0.1);
  });

  it("never puts a label box on the content when a free spot exists near the anchor", () => {
    // Content in the middle; the anchor is on its right edge: the label goes to the right, off the content.
    const content = grid([{ x: 100, y: 80, w: 160, h: 140 }]);
    const m = layoutLabels({ labels: [box("a", 258, 150)], width: W, height: H, blocked: [], content });
    const p = m.get("a") as Extract<Placement, { mode: "label" }>;
    expect(p.mode).toBe("label");
    expect(content.blocks(p.rect)).toBe(false);
  });

  it("moves labels of covered anchors to callouts in the margins, without crossing leader lines", () => {
    // Content covers the centre; anchors inside it.
    const content = grid([{ x: 90, y: 20, w: 220, h: 260 }]);
    const labels = [box("a", 150, 60, 50, 70), box("b", 140, 120, 50, 70), box("c", 160, 200, 50, 70), box("d", 260, 90, 50, 70), box("e", 250, 220, 50, 70)];
    const m = layoutLabels({ labels, width: W, height: H, blocked: [], content });
    const pls = placed(m);
    expect(pls.length).toBe(5);
    for (const p of pls) {
      expect(isCallout(p.slot)).toBe(true);
      expect(content.blocks(p.rect)).toBe(false);
    }
    noOverlaps(m);
    expect((m.get("a") as Extract<Placement, { mode: "label" }>).slot).toBe(CALLOUT_LEFT);
    expect((m.get("d") as Extract<Placement, { mode: "label" }>).slot).toBe(CALLOUT_RIGHT);
    // Leaders (anchor -> nearest point of its box) do not cross.
    const seg = (id: string) => {
      const l = labels.find((x) => x.id === id)!;
      const r = (m.get(id) as Extract<Placement, { mode: "label" }>).rect;
      const [ex, ey] = leaderEnd(l.ax, l.ay, r);
      return [l.ax, l.ay, ex, ey] as [number, number, number, number];
    };
    const ids = labels.map((l) => l.id);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(segmentsCross(seg(ids[i]!), seg(ids[j]!))).toBe(false);
  });

  it("flat content (a map) may carry labels, never over the active highlight", () => {
    const content = grid([{ x: 0, y: 0, w: W, h: H }]);
    const keys = grid([{ x: 150, y: 100, w: 100, h: 60 }]);
    const m = layoutLabels({ labels: [box("city", 200, 170)], width: W, height: H, blocked: [], content, keys, onContent: true });
    const p = m.get("city") as Extract<Placement, { mode: "label" }>;
    expect(p.mode).toBe("label");
    expect(keys.blocks(p.rect)).toBe(false);
  });

  it("progressive disclosure: only active labels in full, the others dots, atlas text hidden; focus always shown", () => {
    const labels = [box("hi", 100, 100, 1050), box("other", 300, 100, 50), box("sea", 200, 250, 10, 60, 16, true), box("pick", 300, 200, PRIORITY.FOCUS + 10)];
    const m = layoutLabels({ labels, width: W, height: H, blocked: [], active: new Set(["hi"]) });
    expect(m.get("hi")!.mode).toBe("label");
    expect(m.get("other")!.mode).toBe("dot");
    expect(m.get("sea")!.mode).toBe("hidden");
    expect(m.get("pick")!.mode).toBe("label");
  });

  it("detects crossing segments", () => {
    expect(segmentsCross([0, 0, 10, 10], [0, 10, 10, 0])).toBe(true);
    expect(segmentsCross([0, 0, 10, 0], [0, 5, 10, 5])).toBe(false);
  });
});
