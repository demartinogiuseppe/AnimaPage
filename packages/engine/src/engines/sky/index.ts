// `sky` engine: astronomy on a pop-up "space" stage. Real positions of the Sun, planets and Moon at
// the chapter's dates (astro.ts), three views (views.ts). Schema, units and anchors:
// packages/scene-spec/src/engines/sky.ts.
import * as THREE from "three";
import { PARAM_RANGES, type Anchor, type SceneSpec, type SkyChapter, type SkyData, type SkyParam } from "@pv/scene-spec";
import { engineText } from "@pv/scene-spec/i18n";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp, seg } from "../../util/math.ts";
import { DAY_MS, dayOfYear, earthRotation, hourOfDay, italianDate, julianDay, moonState, OBLIQUITY, startOfDay, startOfYear } from "./astro.ts";
import { glowTexture, makeConstellation, makeStage, PLATE_R, type ConstellationObj } from "./meshes.ts";
import { dateAt, rateAt, spinAt, track, type Track } from "./time.ts";
import { createEarthMoonView, createEarthSunView, createSystemView, type SkyState, type View } from "./views.ts";

const SPACE = "#161d3d";
const GLOW_FADE = 0.4;
/** Below this many days per chapter second the date label also shows the hour. */
const HOURS_BELOW = 2;

export type Overrides = Partial<Record<SkyParam["kind"], number>>;

/** Envelope 0..1 of highlight windows at t (soft edges). Pure. */
export function glowAt(c: SkyChapter, target: string, t: number): number {
  let env = 0;
  for (const h of c.highlight ?? []) {
    if (h.target !== target) continue;
    const [a, b] = h.window;
    const f = Math.min(GLOW_FADE, (b - a) / 2);
    env = Math.max(env, f <= 0 ? (t >= a && t <= b ? 1 : 0) : seg(t, a, a + f) * (1 - seg(t, b - f, b)));
  }
  return env;
}

/** The sky state of a chapter at time t, with slider overrides (by kind). Pure. */
export function skyState(c: SkyChapter, tr: Track, t: number, ov: Overrides): SkyState {
  let ms = dateAt(tr, t);
  let spin = spinAt(tr, t);
  const shift = (to: number) => {
    spin += earthRotation(julianDay(to)) - earthRotation(julianDay(ms));
    ms = to;
  };
  if (ov.day !== undefined) shift(startOfYear(ms) + (Math.round(ov.day) - 1) * DAY_MS + (ms - startOfDay(ms)));
  if (ov.hour !== undefined) shift(startOfDay(ms) + ov.hour * 3_600_000);
  return {
    ms,
    spin,
    tilt: ov.tilt ?? c.tilt ?? OBLIQUITY,
    moon: ov.moon ?? null,
    glow: (target) => glowAt(c, target, t),
  };
}

interface ChapterObj {
  data: SkyChapter;
  track: Track;
  view: View;
  constellations: ConstellationObj[];
}

export function createSkyEngine(): Engine {
  let ctx: EngineContext | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let chapters = new Map<string, ChapterObj>();
  let allConst: ConstellationObj[] = [];
  let overrides: Record<string, number> | null = null;
  let last = { chapter: "", t: 0 };
  let glow: THREE.Texture | null = null;
  let label: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; text: string } | null = null;

  /** Overrides by kind for a chapter (slider ids -> their kinds). */
  const kindOverrides = (c: SkyChapter): Overrides => {
    const ov: Overrides = {};
    if (!overrides) return ov;
    for (const p of c.params ?? []) {
      const v = overrides[p.id];
      if (v !== undefined) ov[p.kind] = v;
    }
    return ov;
  };

  function drawLabel(text: string) {
    if (!label || label.text === text) return;
    label.text = text;
    const g = label.canvas.getContext("2d");
    if (!g) return;
    const { width: w, height: h } = label.canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(10,16,40,0.72)";
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, h / 2 - 4);
    g.fill();
    g.fillStyle = "#f6f0dc";
    g.font = `600 ${Math.round(h * 0.46)}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 2);
    label.tex.needsUpdate = true;
  }

  return {
    async build(c, spec: SceneSpec) {
      if (spec.engine !== "sky") throw new Error(`sky engine got a "${spec.engine}" scene`);
      ctx = c;
      const data: SkyData = spec.engineData;
      world = new THREE.Group();
      world.name = "sky";
      c.root.add(world);
      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color("#0b1026");
      const key = new THREE.DirectionalLight(0xffffff, 0.8 * Math.PI);
      key.position.set(4, 12, 14);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.7 * Math.PI), key];
      for (const l of lights) c.scene.add(l);

      world.add(makeStage(data.background ?? SPACE, data.stars?.count ?? 400, data.stars?.seed ?? 7));
      const constById = new Map((data.constellations ?? []).map((k) => [k.id, makeConstellation(k)] as const));
      allConst = [...constById.values()];
      for (const k of allConst) world.add(k.group);

      const places = data.places ?? [];
      glow = glowTexture(c.createCanvas);
      chapters = new Map();
      for (const ch of data.chapters) {
        const tr = track(ch.time);
        const start = tr.ms[0]!;
        const view =
                    ch.view === "system"
            ? createSystemView(ch, start, glow)
            : ch.view === "earth-sun"
              ? createEarthSunView(ch, start, places, glow)
              : createEarthMoonView(ch, places, glow);
        view.group.visible = false;
        world.add(view.group);
        chapters.set(ch.chapter, { data: ch, track: tr, view, constellations: (ch.constellations ?? []).map((id) => constById.get(id)!) });
      }

      if (c.createCanvas) {
        const canvas = c.createCanvas(768, 96);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        sprite.name = "date-label";
        sprite.userData.key = true;
        sprite.scale.set(5, 0.625, 1);
        // On the backdrop, upper left (the phase window of the earth-moon view is on the right).
        sprite.position.set(Math.sin(Math.PI + 0.72) * (PLATE_R - 0.8), 7.3, Math.cos(Math.PI + 0.72) * (PLATE_R - 0.8));
        world.add(sprite);
        label = { sprite, canvas, tex, text: "" };
      }
    },

    update(chapterId, t) {
      last = { chapter: chapterId, t };
      const ch = chapters.get(chapterId);
      for (const o of chapters.values()) o.view.group.visible = o === ch;
      for (const k of allConst) k.group.visible = !!ch?.constellations.includes(k);
      if (!ch) {
        if (label) label.sprite.visible = false;
        return;
      }
      const s = skyState(ch.data, ch.track, t, kindOverrides(ch.data));
      ch.view.update(s);
      if (label) {
        label.sprite.visible = ch.data.dateLabel !== false;
        drawLabel(italianDate(s.ms, rateAt(ch.track, t) < HOURS_BELOW || overrides !== null));
      }
    },

    resolveAnchor(anchor: Anchor, chapterId, _t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || !world) return false;
      const ch = chapters.get(chapterId);
      if (!ch) return false;
      let ok: boolean;
      if (anchor.entity === "constellation") {
        const k = ch.constellations.find((x) => x.id === anchor.part);
        ok = !!k && (anchor.index === undefined ? (out.copy(k.center), true) : !!k.stars[anchor.index] && (out.copy(k.stars[anchor.index]!), true));
      } else ok = ch.view.resolve(anchor, out);
      if (ok && anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
      return ok;
    },

    bounds() {
      return { center: new THREE.Vector3(0, 4, 0), radius: PLATE_R + 1.3 };
    },

    params(chapterId): EngineParam[] {
      const ch = chapters.get(chapterId);
      if (!ch) return [];
      const t = last.chapter === chapterId ? last.t : 0;
      const s = skyState(ch.data, ch.track, t, kindOverrides(ch.data));
      return (ch.data.params ?? []).map((p) => {
        const r = PARAM_RANGES[p.kind];
        const min = p.min ?? r.min;
        const max = p.max ?? r.max;
        let now: number;
        if (p.kind === "day") now = dayOfYear(s.ms);
        else if (p.kind === "hour") now = hourOfDay(s.ms);
        else if (p.kind === "tilt") now = s.tilt;
        else now = s.moon ?? ch.view.moonElongation?.() ?? moonState(julianDay(s.ms)).elongation;
        const value = overrides?.[p.id] ?? now;
        // Default caption in the lesson's language (the Italian table repeats PARAM_RANGES' labels).
        return { id: p.id, label: p.label ?? engineText(`sky.${p.kind}`), min, max, step: p.step ?? r.step, value: clamp(value, min, max) };
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      const defs = new Map([...chapters.values()].flatMap((c) => c.data.params ?? []).map((p) => [p.id, p] as const));
      overrides = {};
      for (const [id, v] of Object.entries(values)) {
        const p = defs.get(id);
        if (!p || !Number.isFinite(v)) continue;
        const r = PARAM_RANGES[p.kind];
        overrides[id] = clamp(v, p.min ?? r.min, p.max ?? r.max);
      }
    },

    dispose() {
      if (!ctx || !world) return;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) {
          if (!(o instanceof THREE.Sprite)) geos.add(o.geometry); // sprites share three's quad
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
      });
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      label?.tex.dispose();
      glow?.dispose();
      glow = null;
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      world = null;
      lights = [];
      chapters = new Map();
      allConst = [];
      overrides = null;
      label = null;
    },
  };
}
