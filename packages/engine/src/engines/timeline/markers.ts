// Keyword markers of the timeline (no three.js, unit-tested).
//
// Pins anchored with an `offset` (keywords around an event, a name above a period, a word over a year)
// used to put their label dot in empty air. Each such pin now gets a small marker: a bead exactly at the
// anchor point (where the label dot lands, so the label is unchanged) on a thin stem rising from the thing
// it belongs to: the event's symbol (straight above it), the plinth beside the event with a ground link
// to the event's disc (sideways offsets), the period band, or the axis at that year. Pins on an event
// without offset, on the axis without offset, or on the cursor already sit on an object: no marker.

export interface MarkerPin {
  anchor: unknown;
  marker?: string;
  visible?: readonly (readonly [number, number])[];
}

export interface MarkerWorld {
  /** Event position and full-size symbol top (plinth y = 0); null if unknown. */
  event(id: string): { x: number; z: number; top: number; color: string } | null;
  period(id: string): { mid: number; color: string } | null;
  /** x of a year on the axis. */
  yearX(year: number): number;
}

export interface MarkerSpec {
  /** Anchor point: the bead centre. */
  point: [number, number, number];
  /** Foot of the stem. */
  base: [number, number, number];
  /** Ground link from the owner to the foot (sideways offsets), or null. */
  link: { from: [number, number]; to: [number, number] } | null;
  color: string;
  /** What must be shown for the marker to show. */
  owner: { kind: "event" | "period"; id: string } | null;
  /** Chapter time the marker appears (start of the pin's first visible window). */
  from: number;
}

/** Event disc radius, period band half-depth, axis half-depth, band and axis top (match index.ts). */
export const MARKER_GEOMETRY = { disc: 0.8, bandHalf: 0.9, axisHalf: 0.07, bandTop: 0.065, axisTop: 0.13 } as const;
const SIDEWAYS = 0.45;
const INK = "#2a211b";

type Offset = [number, number, number];

function anchorParts(a: unknown): { entity: string; part?: string; offset?: Offset } | { pos: Offset } | null {
  if (!a || typeof a !== "object") return null;
  if ("pos" in a) return { pos: (a as { pos: Offset }).pos };
  if ("entity" in a) return a as { entity: string; part?: string; offset?: Offset };
  return null;
}

/** Marker for one pin, or null when the pin already sits on an object. Pure. */
export function keywordMarker(pin: MarkerPin, w: MarkerWorld): MarkerSpec | null {
  const a = anchorParts(pin.anchor);
  if (!a) return null;
  const from = pin.visible?.length ? Math.min(...pin.visible.map((v) => v[0])) : 0;
  const G = MARKER_GEOMETRY;
  if ("pos" in a) {
    const [x, y, z] = a.pos;
    return { point: [x, y, z], base: [x, 0, z], link: null, color: pin.marker ?? INK, owner: null, from };
  }
  const off = a.offset;
  if (!off || (Math.abs(off[0]) < 1e-6 && Math.abs(off[1]) < 1e-6 && Math.abs(off[2]) < 1e-6)) return null;
  const [dx, dy, dz] = off;
  const side = Math.hypot(dx, dz) >= SIDEWAYS;
  if (a.entity === "event") {
    const ev = a.part ? w.event(a.part) : null;
    if (!ev) return null;
    // Same point the engine resolves (symbol top + 0.2) with the offset.
    const point: [number, number, number] = [ev.x + dx, ev.top + 0.2 + dy, ev.z + dz];
    const color = pin.marker ?? ev.color;
    const owner = { kind: "event" as const, id: a.part! };
    if (!side) return { point, base: [point[0], ev.top, point[2]], link: null, color, owner, from };
    // Sideways: stem from the plinth, linked to the edge of the event's disc.
    const d = Math.hypot(dx, dz);
    const edge: [number, number] = [ev.x + (dx / d) * G.disc, ev.z + (dz / d) * G.disc];
    return { point, base: [point[0], 0, point[2]], link: d > G.disc + 0.05 ? { from: edge, to: [point[0], point[2]] } : null, color, owner, from };
  }
  if (a.entity === "period") {
    const pd = a.part ? w.period(a.part) : null;
    if (!pd) return null;
    const point: [number, number, number] = [pd.mid + dx, 0.1 + dy, dz];
    const onBand = Math.abs(dz) <= G.bandHalf;
    return {
      point,
      base: [point[0], onBand ? G.bandTop : 0, point[2]],
      link: onBand ? null : { from: [point[0], Math.sign(dz) * G.bandHalf], to: [point[0], point[2]] },
      color: pin.marker ?? pd.color,
      owner: { kind: "period", id: a.part! },
      from,
    };
  }
  if (a.entity === "year") {
    const year = Number(a.part);
    if (a.part === undefined || a.part.trim() === "" || !Number.isFinite(year)) return null;
    const x = w.yearX(year);
    const point: [number, number, number] = [x + dx, 0.1 + dy, dz];
    const onAxis = Math.abs(dz) <= 0.3 && Math.abs(dx) <= 0.3;
    return {
      point,
      base: [point[0], onAxis ? G.axisTop : 0, point[2]],
      link: onAxis ? null : { from: [x, 0], to: [point[0], point[2]] },
      color: pin.marker ?? INK,
      owner: null,
      from,
    };
  }
  return null;
}
