// `timeline` engine: events along a time axis on a low diorama plinth.
// Axis runs along x (past at -x), events alternate in lanes in front of (+z) and
// behind (-z) the axis. Anchors: see packages/scene-spec/src/engines/timeline.ts.
import * as THREE from "three";
import type { Anchor, SceneSpec, TimelineData } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../../types.ts";
import { ease, seg } from "../../util/math.ts";
import { AXIS_LENGTH, LANE_STEP, assignLanes, cursorYear, formatYear, ticks, yearToX } from "./layout.ts";
import { PALETTE, buildSymbol } from "./symbols.ts";
import { keywordMarker, type MarkerSpec } from "./markers.ts";

const SKY = "#cfdde6";
const PLINTH_W = AXIS_LENGTH + 4;
const PLINTH_D = 13;
const DISC_H = 0.14;
const BAND_HALF = 0.9;
/** Seconds for an event to grow / a period band to extend. */
const GROW = 0.9;
const BAND_GROW = 1.4;
const MAJOR_SCALE = 1.3;
const TINY = 1e-4;

interface EventState {
  at: number;
  glow: [number, number][];
}
interface ChapterState {
  events: Map<string, EventState>;
  periods: Map<string, number>;
  cursor: { at: number; year: number }[];
}
interface EventObj {
  id: string;
  x: number;
  z: number;
  group: THREE.Group;
  /** Symbol top above the plinth, at full scale. */
  top: number;
  mats: THREE.MeshLambertMaterial[];
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  connector: THREE.Mesh;
  bar?: { mesh: THREE.Mesh; width: number };
}
interface MarkerObj {
  chapter: string;
  spec: MarkerSpec;
  /** At the stem's foot; scaled 0..1 as it grows. */
  group: THREE.Group;
}
/** Seconds for a keyword marker to grow from its foot. */
const MARKER_GROW = 0.5;
interface PeriodObj {
  id: string;
  mesh: THREE.Mesh;
  width: number;
  mid: number;
}

const EMPTY: ChapterState = { events: new Map(), periods: new Map(), cursor: [] };

const grow = (t: number, at: number, d: number) => ease.inOutQuad(seg(t, at, at + d));

/** 0..1 envelope inside [a, b] with short fades at the edges. */
const windowEnv = (t: number, a: number, b: number) => {
  const f = Math.min(0.3, (b - a) / 2);
  return f <= 0 ? (t === a ? 1 : 0) : seg(t, a, a + f) * (1 - seg(t, b - f, b));
};

const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color, flatShading: true });

/** Precomputes the per-chapter reveal state, applying carryOver in scene chapter order. */
function chapterStates(spec: SceneSpec, data: TimelineData): Map<string, ChapterState> {
  const out = new Map<string, ChapterState>();
  const shownEvents = new Set<string>();
  const shownPeriods = new Set<string>();
  for (const ch of spec.chapters) {
    const def = data.chapters.find((c) => c.chapter === ch.id);
    const st: ChapterState = { events: new Map(), periods: new Map(), cursor: def?.cursor ?? [] };
    if (def?.carryOver ?? true) {
      for (const id of shownEvents) st.events.set(id, { at: -Infinity, glow: [] });
      for (const id of shownPeriods) st.periods.set(id, -Infinity);
    }
    for (const e of def?.events ?? []) st.events.set(e.id, { at: e.at, glow: e.glow ?? [] });
    for (const p of def?.periods ?? []) st.periods.set(p.id, p.at);
    for (const id of st.events.keys()) shownEvents.add(id);
    for (const id of st.periods.keys()) shownPeriods.add(id);
    out.set(ch.id, st);
  }
  return out;
}

function tickLabel(ctx: EngineContext, text: string): THREE.Sprite | null {
  if (!ctx.createCanvas || !text) return null;
  const canvas = ctx.createCanvas(256, 64);
  const g = canvas.getContext("2d");
  if (!g) return null;
  // Cinzel only for Latin text; other scripts get the system serif that has their glyphs (D21).
  g.font = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u.test(text) ? "600 34px Cinzel, Georgia, serif" : "600 34px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = PALETTE.ink;
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}

export function createTimelineEngine(): Engine {
  let ctx: EngineContext | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let data: TimelineData | null = null;
  let states = new Map<string, ChapterState>();
  let events: EventObj[] = [];
  let periods: PeriodObj[] = [];
  let cursor: THREE.Group | null = null;
  let markers: MarkerObj[] = [];

  const x = (year: number) => yearToX(year, data!.axis.from, data!.axis.to);
  const eventGrow = (st: ChapterState, id: string, t: number) => {
    const s = st.events.get(id);
    return s ? grow(t, s.at, GROW) : 0;
  };

  return {
    async build(c, spec) {
      if (spec.engine !== "timeline") throw new Error(`timeline engine got a "${spec.engine}" scene`);
      ctx = c;
      data = spec.engineData;
      states = chapterStates(spec, data);
      world = new THREE.Group();
      world.name = "timeline";
      c.root.add(world);

      // Lights: warm hemisphere + sun from the upper left (Appendix B.2). Intensities are the
      // prototype's r128 values times PI, since three >= r155 uses physical light units.
      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(SKY);
      const sun = new THREE.DirectionalLight(0xfff0d8, 0.8 * Math.PI);
      sun.position.set(-12, 20, 14);
      lights = [new THREE.HemisphereLight(0xfff4e0, 0x6b5a45, 0.65 * Math.PI), sun];
      for (const l of lights) c.scene.add(l);

      // Plinth and axis.
      world.add(new THREE.Mesh(new THREE.BoxGeometry(PLINTH_W, 0.6, PLINTH_D), lambert(PALETTE.sand)).translateY(-0.3));
      world.add(new THREE.Mesh(new THREE.BoxGeometry(PLINTH_W + 0.3, 0.12, PLINTH_D + 0.3), lambert(PALETTE.clay)).translateY(-0.62));
      const inkMat = lambert(PALETTE.ink);
      world.add(new THREE.Mesh(new THREE.BoxGeometry(AXIS_LENGTH, 0.06, 0.14), inkMat).translateY(0.1));
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6).rotateZ(-Math.PI / 2), inkMat);
      arrow.position.set(AXIS_LENGTH / 2 + 0.25, 0.1, 0);
      world.add(arrow);
      const tickGeo = new THREE.BoxGeometry(0.05, 0.08, 0.5);
      const edgeGeo = new THREE.BoxGeometry(0.04, 0.02, 0.35);
      for (const year of ticks(data.axis.from, data.axis.to, data.axis.tick)) {
        const tx = x(year);
        world.add(new THREE.Mesh(tickGeo, inkMat).translateX(tx).translateY(0.1));
        world.add(new THREE.Mesh(edgeGeo, inkMat).translateX(tx).translateY(0.01).translateZ(PLINTH_D / 2 - 0.3));
        const label = tickLabel(c, formatYear(year, data.axis.labels));
        if (label) {
          label.position.set(tx, 0.4, PLINTH_D / 2 - 0.75);
          world.add(label);
        }
      }

      // Period bands: unit box starting at x=0, scaled along x as it grows.
      const bandGeo = new THREE.BoxGeometry(1, 0.05, BAND_HALF * 2).translate(0.5, 0, 0);
      periods = data.periods.map((p) => {
        const x0 = x(p.from);
        const x1 = x(p.to);
        const m = new THREE.Mesh(bandGeo, lambert(p.color));
        m.position.set(x0, 0.04, 0);
        world!.add(m);
        return { id: p.id, mesh: m, width: Math.max(x1 - x0, 0.05), mid: (x0 + x1) / 2 };
      });

      // Events.
      const xs = data.events.map((e) => x(e.to === undefined ? e.year : (e.year + e.to) / 2));
      const lanes = assignLanes(xs);
      const discGeo = new THREE.CylinderGeometry(0.72, 0.8, DISC_H, 12);
      const ringGeo = new THREE.RingGeometry(0.85, 1.02, 24).rotateX(-Math.PI / 2);
      const barGeo = new THREE.BoxGeometry(1, 0.07, 0.22).translate(0.5, 0, 0);
      events = data.events.map((e, i) => {
        const ex = xs[i]!;
        const lane = lanes[i]!;
        const ez = lane * LANE_STEP;
        const side = Math.sign(lane);
        const group = new THREE.Group();
        group.name = `event:${e.id}`;
        group.position.set(ex, 0, ez);
        group.add(new THREE.Mesh(discGeo, lambert(PALETTE.stone)).translateY(DISC_H / 2));
        const symbol = buildSymbol(e.symbol, e.color);
        const s = e.emphasis === "major" ? MAJOR_SCALE : 1;
        symbol.scale.setScalar(s);
        symbol.position.y = DISC_H;
        group.add(symbol);
        const top = DISC_H + new THREE.Box3().setFromObject(symbol).max.y;
        const mats = new Set<THREE.MeshLambertMaterial>();
        group.traverse((o) => {
          if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) mats.add(o.material);
        });
        const ring = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({ color: "#ffcc66", transparent: true, opacity: 0, depthWrite: false }),
        );
        ring.position.y = 0.015;
        group.add(ring);
        world!.add(group);

        const z0 = BAND_HALF + 0.05;
        const z1 = Math.abs(ez) - 0.78;
        const connector = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, Math.max(z1 - z0, 0.05)), lambert(PALETTE.stoneDark));
        connector.position.set(ex, 0.015, side * (z0 + z1) / 2);
        world!.add(connector);

        let bar: EventObj["bar"];
        if (e.to !== undefined) {
          const bx0 = x(e.year);
          const m = new THREE.Mesh(barGeo, lambert(e.color ?? PALETTE.clay));
          m.position.set(bx0, 0.12, side * (BAND_HALF + 0.12));
          world!.add(m);
          bar = { mesh: m, width: Math.max(x(e.to) - bx0, 0.12) };
        }
        return { id: e.id, x: ex, z: ez, group, top, mats: [...mats], ring, connector, bar };
      });

      // Keyword markers: pins anchored with an offset get a bead on a stem (markers.ts), so their labels
      // stand on something that belongs to the event, period or year instead of floating.
      const evById = new Map(data.events.map((e, i) => [e.id, { e, o: events[i]! }] as const));
      const pdById = new Map(data.periods.map((p, i) => [p.id, { p, o: periods[i]! }] as const));
      const markerWorld = {
        event: (id: string) => {
          const v = evById.get(id);
          return v ? { x: v.o.x, z: v.o.z, top: v.o.top, color: v.e.color ?? PALETTE.clay } : null;
        },
        period: (id: string) => {
          const v = pdById.get(id);
          return v ? { mid: v.o.mid, color: v.p.color } : null;
        },
        yearX: x,
      };
      const stemGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, 0.5, 0);
      const beadGeo = new THREE.SphereGeometry(0.12, 14, 10);
      const linkGeo = new THREE.BoxGeometry(1, 0.025, 0.05).translate(0.5, 0, 0);
      const stemMat = lambert(PALETTE.stoneDark);
      markers = spec.chapters.flatMap((ch) =>
        ch.pins.flatMap((pin) => {
          const m = keywordMarker(pin, markerWorld);
          if (!m) return [];
          const group = new THREE.Group();
          group.name = `keyword:${ch.id}:${pin.id}`;
          group.position.set(...m.base);
          const h = m.point[1] - m.base[1];
          if (h > 0.2) {
            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.scale.y = h - 0.1;
            group.add(stem);
          }
          const bead = new THREE.Mesh(beadGeo, lambert(m.color));
          bead.name = "bead";
          bead.position.set(m.point[0] - m.base[0], h, m.point[2] - m.base[2]);
          group.add(bead);
          if (m.link) {
            const [fx, fz] = m.link.from;
            const [tx, tz] = m.link.to;
            const link = new THREE.Mesh(linkGeo, stemMat);
            link.position.set(fx - m.base[0], 0.013 - m.base[1], fz - m.base[2]);
            link.scale.x = Math.hypot(tx - fx, tz - fz);
            link.rotation.y = -Math.atan2(tz - fz, tx - fx);
            group.add(link);
          }
          world!.add(group);
          return [{ chapter: ch.id, spec: m, group }];
        }),
      );

      // "Now" cursor.
      cursor = new THREE.Group();
      const clayMat = lambert(PALETTE.clay);
      cursor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), clayMat).translateY(0.65));
      cursor.add(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 8).rotateX(Math.PI), clayMat).translateY(1.35));
      world.add(cursor);
    },

    update(chapterId, t) {
      const st = states.get(chapterId) ?? EMPTY;
      const pulse = Math.sin(4 * t);
      for (const ev of events) {
        const p = eventGrow(st, ev.id, t);
        const visible = p > 0;
        ev.group.visible = visible;
        ev.group.scale.setScalar(Math.max(p, TINY));
        ev.connector.visible = visible;
        ev.connector.scale.set(1, 1, Math.max(p, TINY));
        if (ev.bar) {
          ev.bar.mesh.visible = visible;
          ev.bar.mesh.scale.set(ev.bar.width * Math.max(p, TINY), 1, 1);
        }
        let env = 0;
        for (const [a, b] of st.events.get(ev.id)?.glow ?? []) env = Math.max(env, windowEnv(t, a, b));
        const k = env * (0.1 + 0.08 * (1 + pulse));
        for (const m of ev.mats) m.emissive.setRGB(k, 0.62 * k, 0.18 * k);
        ev.ring.visible = env > 0;
        // China style (player): the glowing event keeps its colours.
        ev.group.userData.key = env > 0.05;
        ev.ring.userData.key = true;
        ev.ring.material.opacity = env * (0.55 + 0.35 * pulse);
      }
      for (const pd of periods) {
        const at = st.periods.get(pd.id);
        const p = at === undefined ? 0 : grow(t, at, BAND_GROW);
        pd.mesh.visible = p > 0;
        pd.mesh.scale.set(pd.width * Math.max(p, TINY), 1, 1);
      }
      for (const mk of markers) {
        let p = 0;
        if (mk.chapter === chapterId) {
          const own = mk.spec.owner;
          // The owner must be on show (it grows in at its own time): the marker follows it.
          const ownerAt = !own ? 0 : own.kind === "event" ? st.events.get(own.id)?.at : st.periods.get(own.id);
          if (ownerAt !== undefined) p = grow(t, Math.max(mk.spec.from, ownerAt), MARKER_GROW);
        }
        mk.group.visible = p > 0;
        mk.group.scale.setScalar(Math.max(p, TINY));
      }
      if (cursor) {
        const y = cursorYear(st.cursor, t, ease.inOutQuad);
        cursor.visible = y !== null;
        cursor.position.set(y === null ? 0 : x(y), 0, 0);
      }
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || !data) return false;
      const st = states.get(chapterId) ?? EMPTY;
      switch (anchor.entity) {
        case "event": {
          const ev = events.find((e) => e.id === anchor.part);
          if (!ev) return false;
          out.set(ev.x, ev.top * eventGrow(st, ev.id, t) + 0.2, ev.z);
          break;
        }
        case "period": {
          const pd = periods.find((p) => p.id === anchor.part);
          if (!pd) return false;
          out.set(pd.mid, 0.1, 0);
          break;
        }
        case "year": {
          const year = Number(anchor.part);
          if (anchor.part === undefined || anchor.part.trim() === "" || !Number.isFinite(year)) return false;
          out.set(x(year), 0.1, 0);
          break;
        }
        case "cursor": {
          const year = cursorYear(st.cursor, t, ease.inOutQuad);
          if (year === null) return false;
          out.set(x(year), 1.6, 0);
          break;
        }
        default:
          return false;
      }
      if (anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
      return true;
    },

    anchorShown(anchor: Anchor, chapterId, t) {
      // A label on an event or period waits until it starts growing in (same moment as its keyword marker).
      if (!("entity" in anchor) || anchor.part === undefined) return true;
      const st = states.get(chapterId) ?? EMPTY;
      const at = anchor.entity === "event" ? st.events.get(anchor.part)?.at : anchor.entity === "period" ? st.periods.get(anchor.part) : undefined;
      return at === undefined || t > at;
    },

    bounds() {
      return { center: new THREE.Vector3(0, 0.8, 0), radius: Math.hypot(PLINTH_W / 2, PLINTH_D / 2, 1.2) };
    },

    dispose() {
      if (!ctx || !world) return;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        // Sprites share one module-level geometry in three: dispose only their materials.
        if (o instanceof THREE.Mesh) geos.add(o.geometry);
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
      });
      for (const g of geos) g.dispose();
      for (const m of mats) {
        if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
        m.dispose();
      }
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      world = null;
      cursor = null;
      lights = [];
      events = [];
      periods = [];
      markers = [];
      data = null;
    },
  };
}
