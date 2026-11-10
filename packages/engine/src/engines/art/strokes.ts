// Overlay drawings as straight strokes on the canvas plane (pure, no three.js): each stroke is drawn
// between `from` and `to` of the overlay's draw progress (0..1), so lines grow over time.
import type { ArtOverlay } from "@pv/scene-spec";

export type XY = [number, number];

export interface Stroke {
  a: XY;
  b: XY;
  /** Draw-progress window of this stroke. */
  from: number;
  to: number;
  /** Line width multiplier. */
  width: number;
}

/** Maps a normalised image point (y down) to canvas-plane coordinates (x right, y up). */
export type ToPlane = (u: number, v: number) => XY;

const GOLDEN = 1 / ((1 + Math.sqrt(5)) / 2);

const lerpXY = (a: XY, b: XY, p: number): XY => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];

/** `n` dashes along a→b (60% dash, 40% gap), drawn one after the other within [from, to]. */
export function dashed(a: XY, b: XY, n: number, from: number, to: number, width: number): Stroke[] {
  const out: Stroke[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = i / n;
    const p1 = (i + 0.6) / n;
    out.push({ a: lerpXY(a, b, p0), b: lerpXY(a, b, p1), from: from + (to - from) * p0, to: from + (to - from) * p1, width });
  }
  return out;
}

/** Arrow head: two short strokes at the tip of a→b. */
function head(a: XY, b: XY, size: number, from: number, width: number): Stroke[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const wing = (s: number): XY => [b[0] - size * (ux * 0.9 - s * uy * 0.55), b[1] - size * (uy * 0.9 + s * ux * 0.55)];
  return [
    { a: b, b: wing(1), from, to: 1, width },
    { a: b, b: wing(-1), from, to: 1, width },
  ];
}

/**
 * Strokes of an overlay. `vp` is the perspective's vanishing point (image coordinates), `aspect` the
 * image height / width, `scale` the canvas width in scene units (sizes the arrow heads and dashes).
 * Guess and palette overlays have no static strokes (the engine draws them).
 */
export function overlayStrokes(o: ArtOverlay, vp: XY | null, toPlane: ToPlane, aspect: number, scale: number): Stroke[] {
  switch (o.kind) {
    case "perspective": {
      if (!vp) return [];
      const n = o.lines.length;
      const end = toPlane(vp[0], vp[1]);
      return o.lines.map((l, k) => {
        const from = n > 1 ? (0.25 * k) / (n - 1) : 0;
        return { a: toPlane(l[0], l[1]), b: end, from, to: from + 0.75, width: 1 };
      });
    }
    case "polygon": {
      const pts = o.points.map(([u, v]) => toPlane(u, v));
      if (o.closed) pts.push(pts[0]!);
      const n = pts.length - 1;
      return pts.slice(1).map((b, i) => ({ a: pts[i]!, b, from: i / n, to: (i + 1) / n, width: 1.2 }));
    }
    case "circle": {
      const n = 72;
      const pts: XY[] = [];
      for (let i = 0; i <= n; i++) {
        const th = -Math.PI / 2 + (i / n) * Math.PI * 2;
        pts.push(toPlane(o.center[0] + Math.cos(th) * o.radius, o.center[1] + (Math.sin(th) * o.radius) / aspect));
      }
      return pts.slice(1).map((b, i) => ({ a: pts[i]!, b, from: i / n, to: (i + 1) / n, width: 1.2 }));
    }
    case "axis": {
      const [a, b] = o.x !== undefined ? [toPlane(o.x, 0), toPlane(o.x, 1)] : [toPlane(0, o.y!), toPlane(1, o.y!)];
      return dashed(a, b, 24, 0, 1, 1);
    }
    case "grid": {
      const ks = o.grid === "thirds" ? [1 / 3, 2 / 3] : [1 - GOLDEN, GOLDEN];
      return ks.flatMap((k, i) => [
        ...dashed(toPlane(k, 0), toPlane(k, 1), 20, i * 0.2, 0.6 + i * 0.2, 0.8),
        ...dashed(toPlane(0, k), toPlane(1, k), 30, 0.1 + i * 0.2, 0.7 + i * 0.2, 0.8),
      ]);
    }
    case "arrow": {
      const a = toPlane(o.from[0], o.from[1]);
      const b = toPlane(o.to[0], o.to[1]);
      const width = o.style === "light" ? 3 : 1.4;
      const size = scale * (o.style === "light" ? 0.045 : 0.028);
      const shaft = o.style === "gaze" ? dashed(a, b, 10, 0, 0.8, width) : [{ a, b, from: 0, to: 0.8, width }];
      return [...shaft, ...head(a, b, size, 0.8, width)];
    }
    case "guess":
    case "palette":
      return [];
  }
}

/** Visible fraction (0..1) of a stroke at overlay draw progress p. */
export function strokeFraction(s: Pick<Stroke, "from" | "to">, p: number): number {
  if (p >= s.to) return 1;
  if (p <= s.from) return 0;
  return (p - s.from) / (s.to - s.from);
}
