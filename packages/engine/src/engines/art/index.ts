// `art` engine ("Opera", decision D14): an artwork on the pop-up page with guided tours of its
// details, perspective and composition overlays, palette, lifted paper layers and a classical-orders
// kit. Schema, coordinates and anchors: packages/scene-spec/src/engines/art.ts.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { engineText } from "@pv/scene-spec/i18n";
import {
  isFlatArt,
  perspectivePoint,
  type Anchor,
  type ArtAction,
  type ArtData,
  type ArtOverlay,
  type ArtParam,
  type ArtRect,
  type SceneSpec,
} from "@pv/scene-spec";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp, ease, lerp, seg } from "../../util/math.ts";
import { canDecode, computePalette, loadArtImage, type ArtImageData } from "./image.ts";
import { buildElement, stoneMaterial, type BuiltElement } from "./orders.ts";
import { overlayStrokes, strokeFraction, type Stroke, type XY } from "./strokes.ts";

const PAPER = "#f4efe6";
const DEFAULT_WIDTH = 12;
const DEFAULT_DEPTH = 0.35;
const DEFAULT_DRAW = 2;
/** A show action without `until` stays this long after its lines are drawn, then fades out. */
export const SHOW_HOLD = 8;
/** Overlay line width: base and hard cap, as a share of the canvas width. */
const LINE_W = 0.002;
const LINE_MAX = 0.004;
/** Overlays are semi-transparent so the painting stays readable underneath. */
const OVERLAY_OPACITY = 0.78;
const FADE = 0.5;
const PLINTH_H = 1.1;
const COLORS: Record<string, string> = {
  perspective: "#e3402b",
  guess: "#2b6fe3",
  polygon: "#f2c14e",
  circle: "#f2c14e",
  axis: "#ffffff",
  grid: "#ffffff",
  light: "#ffe27a",
  gaze: "#7fd3ff",
  plain: "#ffffff",
  highlight: "#ffcf4a",
};
/** z offsets above the canvas surface (dim < outlines < overlays < markers). */
const Z = { dim: 0.01, outline: 0.02, overlay: 0.03, marker: 0.04 };

/** Unit strip from (0, -0.5) to (1, 0.5): scaled to (length, width) and rotated about z. */
const STRIP = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);

const SPOT_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/** Dark veil outside (or, with uInvert, inside) a soft-edged rectangle given in image coordinates (y down). */
const SPOT_FS = /* glsl */ `
uniform vec4 uRect;
uniform float uDim;
uniform float uSoft;
uniform float uAspect;
uniform float uInvert;
varying vec2 vUv;
void main() {
  vec2 q = vec2(vUv.x, 1.0 - vUv.y);
  vec2 d = max(uRect.xy - q, q - (uRect.xy + uRect.zw));
  d.y *= uAspect;
  float outside = smoothstep(0.0, uSoft, length(max(d, 0.0)));
  float a = mix(outside, 1.0 - outside, uInvert);
  gl_FragColor = vec4(0.05, 0.04, 0.03, uDim * a);
}`;

function spotMaterial(aspect: number, invert: boolean, soft: number) {
  return new THREE.ShaderMaterial({
    vertexShader: SPOT_VS,
    fragmentShader: SPOT_FS,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uDim: { value: 0 },
      uSoft: { value: soft },
      uAspect: { value: aspect },
      uInvert: { value: invert ? 1 : 0 },
    },
  });
}

const basic = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

interface Lay {
  /** Canvas width / height in scene units, bottom edge height, surface z. */
  W: number;
  H: number;
  y0: number;
  zc: number;
  hasCanvas: boolean;
}

interface StrokeMesh {
  stroke: Stroke;
  mesh: THREE.Mesh;
}
interface OverlayObj {
  def: ArtOverlay;
  group: THREE.Group;
  strokes: StrokeMesh[];
  mats: THREE.MeshBasicMaterial[];
  /** Vanishing point (perspective) or guess marker. */
  marker?: THREE.Group;
  /** Palette swatches. */
  swatches?: THREE.Mesh[];
}
interface RegionObj {
  rect: ArtRect;
  outline: THREE.Group;
  mat: THREE.MeshBasicMaterial;
}
interface LayerObj {
  id: string;
  rect: ArtRect;
  depth: number;
  card: THREE.Mesh;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
}
interface ElementObj extends BuiltElement {
  id: string;
}

/** Presence of windows [at, until) with fades; `at` omitted = already there at t = 0. Max over actions. */
function envelope(acts: readonly ArtAction[], t: number, fadeIn = FADE, fadeOut = FADE): { env: number; act: ArtAction | null } {
  let best = 0;
  let act: ArtAction | null = null;
  for (const a of acts) {
    const on = a.at === undefined ? (t >= 0 ? 1 : 0) : seg(t, a.at, a.at + fadeIn);
    const off = a.until === undefined ? 1 : 1 - seg(t, a.until - fadeOut, a.until);
    const e = Math.min(on, off);
    if (e > best || (e === best && e > 0 && act && (a.at ?? 0) > (act.at ?? 0))) {
      best = e;
      act = a;
    }
  }
  return { env: best, act };
}

function setStrip(m: THREE.Object3D, a: XY, b: XY, frac: number, width: number, z: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  m.visible = frac > 0.001 && len > 1e-6;
  m.position.set(a[0], a[1], z);
  m.rotation.set(0, 0, Math.atan2(dy, dx));
  m.scale.set(Math.max(1e-4, len * frac), width, 1);
}

export function createArtEngine(): Engine {
  let ctx: EngineContext | null = null;
  let spec: SceneSpec | null = null;
  let data: ArtData | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let lay: Lay = { W: DEFAULT_WIDTH, H: 9, y0: 0, zc: 0, hasCanvas: false };
  let image: ArtImageData | null = null;
  let spot: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  let overlays = new Map<string, OverlayObj>();
  let regions = new Map<string, RegionObj>();
  let layers = new Map<string, LayerObj>();
  let elements = new Map<string, ElementObj>();
  let vps = new Map<string, XY>();
  let acts = new Map<string, ArtAction[]>();
  let overrides: Record<string, number> | null = null;
  let bound = { center: new THREE.Vector3(), radius: 1 };
  const owned: { dispose(): void }[] = [];

  const toPlane = (u: number, v: number): XY => [(u - 0.5) * lay.W, lay.y0 + (1 - v) * lay.H];
  /** Stroke width for a multiplier, never above LINE_MAX of the canvas width. */
  const strokeW = (k: number) => Math.min(lay.W * LINE_W * k, lay.W * LINE_MAX);
  const actsFor = (chapterId: string, target: string, kind?: ArtAction["do"]) =>
    (acts.get(chapterId) ?? []).filter((a) => a.target === target && (!kind || a.do === kind));
  const paramDef = (id: string) => data?.params?.find((p) => p.id === id);
  const override = (kind: ArtParam["kind"], target: string): number | undefined => {
    if (!overrides) return undefined;
    const p = data?.params?.find((q) => q.kind === kind && q.target === target && overrides![q.id] !== undefined);
    return p ? overrides[p.id] : undefined;
  };
  const guessPoint = (id: string): XY | null => {
    const o = overlays.get(id)?.def;
    if (!o || o.kind !== "guess") return null;
    return [override("guess-x", id) ?? o.start[0], override("guess-y", id) ?? o.start[1]];
  };
  const liftOf = (chapterId: string, l: LayerObj, t: number) => {
    const d = override("depth", l.id);
    if (d !== undefined) return { lift: 1, depth: d };
    const { env } = envelope(actsFor(chapterId, l.id, "lift"), t, 1.0, 0.6);
    return { lift: env, depth: l.depth };
  };

  function layoutOf(d: ArtData): Lay {
    const a = d.artwork;
    const hasCanvas = isFlatArt(a.kind) || a.image !== undefined;
    const aspect = a.image ? a.image.height / a.image.width : a.sizeCm ? a.sizeCm[1] / a.sizeCm[0] : 0.75;
    const W = d.presentation.width ?? (aspect > 1 ? DEFAULT_WIDTH / aspect : DEFAULT_WIDTH);
    const H = W * aspect;
    const m = d.presentation.mount;
    const base = m === "plinth" ? PLINTH_H : 0;
    const y0 = base + (m === "frame" || m === "plinth" ? W * 0.055 : m === "easel" ? H * 0.22 + W * 0.04 : H * 0.12);
    return { W, H, y0, zc: m === "frame" || m === "plinth" ? 0.05 : 0.005, hasCanvas };
  }

  function stdMat(color: THREE.ColorRepresentation, roughness = 0.8, metalness = 0) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    owned.push(m);
    return m;
  }

  function box(w: number, h: number, dd: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
    const g = new THREE.BoxGeometry(w, h, dd);
    owned.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  function buildMount(d: ArtData) {
    const g = new THREE.Group();
    g.name = "mount";
    world!.add(g);
    const { W, H, y0 } = lay;
    const p = d.presentation;
    if (p.mount === "plinth") box(Math.max(W * 0.5, 2.4), PLINTH_H, Math.max(W * 0.25, 2), stdMat("#d8d2c6"), 0, PLINTH_H / 2, -0.2, g);
    if (!lay.hasCanvas) return;
    if (p.mount === "frame" || p.mount === "plinth") {
      const b = W * 0.055;
      const fm = stdMat(p.frameColor ?? "#b8893a", 0.45, 0.35);
      box(W + 2 * b, b, 0.3, fm, 0, y0 - b / 2, 0, g);
      box(W + 2 * b, b, 0.3, fm, 0, y0 + H + b / 2, 0, g);
      box(b, H, 0.3, fm, -(W + b) / 2, y0 + H / 2, 0, g);
      box(b, H, 0.3, fm, (W + b) / 2, y0 + H / 2, 0, g);
      box(W, H, 0.06, stdMat("#6b5a44"), 0, y0 + H / 2, -0.06, g);
      // back strut leaning from the middle of the frame to the page
      const len = (H / 2 + b) / Math.cos(0.35);
      const strut = box(W * 0.08, len, 0.08, stdMat("#6b5a44"), 0, y0 - b + (H / 2 + b) / 2, -0.12 - (len / 2) * Math.sin(0.35), g);
      strut.rotation.x = 0.35;
    } else if (p.mount === "easel") {
      const wood = stdMat("#8a6038", 0.7);
      const top = y0 + H * 1.08;
      const legGeo = new THREE.CylinderGeometry(W * 0.012, W * 0.016, top, 10).translate(0, top / 2, 0);
      owned.push(legGeo);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, wood);
        leg.position.set(s * W * 0.36, 0, 0.35);
        leg.rotation.z = -s * 0.12;
        leg.rotation.x = -0.06;
        g.add(leg);
      }
      const back = new THREE.Mesh(legGeo, wood);
      back.position.set(0, 0, -0.2);
      back.rotation.x = -0.32;
      g.add(back);
      box(W * 1.04, W * 0.03, 0.5, wood, 0, y0 - W * 0.015, 0.15, g);
      box(W, H, 0.12, stdMat("#efe6d4"), 0, y0 + H / 2, -0.065, g);
    } else {
      // wall: a piece of wall with the painting on its face (frescoes, murals)
      const top = y0 + H + H * 0.16;
      box(W * 1.14, top, 0.6, stdMat("#d9cfbf", 0.95), 0, top / 2, -0.3, g);
      box(W * 1.14 + 0.1, H * 0.04, 0.7, stdMat("#cfc3b0", 0.9), 0, top - H * 0.02, -0.3, g);
    }
    if (p.museumWall) {
      const top = (y0 + H) * 1.3;
      box(W * 1.7, top, 0.3, stdMat("#b9b0a2", 0.95), 0, top / 2, -1.1, g);
      box(W * 1.7, 0.25, 0.4, stdMat("#8d8274", 0.8), 0, 0.125, -0.95, g);
    }
  }

  /** Placeholder face for works that cannot be shown (not public domain), or when the image failed. */
  function placeholderTexture(d: ArtData): THREE.Texture | null {
    if (!ctx?.createCanvas) return null;
    const w = 1024;
    const h = Math.max(256, Math.round((w * lay.H) / lay.W));
    const cv = ctx.createCanvas(w, h);
    const g = cv.getContext("2d");
    if (!g) return null;
    const a = d.artwork;
    g.fillStyle = "#e9e2d3";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#9c8f78";
    g.lineWidth = 6;
    g.strokeRect(24, 24, w - 48, h - 48);
    g.fillStyle = "#3b3226";
    g.textAlign = "center";
    const lines: [string, number, string][] = [
      [a.title, 0.3, "bold 64px Georgia, serif"],
      [a.author, 0.42, "44px Georgia, serif"],
      [a.date, 0.5, "36px Georgia, serif"],
      [engineText(a.image ? "art.noImage" : "art.protected"), 0.66, "italic 30px Georgia, serif"],
      [a.link ? engineText("art.link", { link: a.link.replace(/^https?:\/\//, "").slice(0, 60) }) : "", 0.76, "26px Georgia, serif"],
    ];
    for (const [text, y, font] of lines) {
      g.font = font;
      g.fillText(text, w / 2, h * y, w - 100);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    owned.push(tex);
    return tex;
  }

  /** Plane with the image's top row at v = 0 (texture flipY = false). */
  function flippedPlane(w: number, h: number, rect: ArtRect = [0, 0, 1, 1]) {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * rect[2], rect[1] + (1 - uv.getY(i)) * rect[3]);
    owned.push(geo);
    return geo;
  }

  function buildCanvas(d: ArtData) {
    if (!lay.hasCanvas) return;
    const map = image?.texture ?? placeholderTexture(d);
    const mat = new THREE.MeshBasicMaterial({ color: map ? 0xffffff : 0xd8d0c0, map });
    owned.push(mat);
    const canvasMesh = new THREE.Mesh(flippedPlane(lay.W, lay.H), mat);
    canvasMesh.name = "canvas";
    canvasMesh.position.set(0, lay.y0 + lay.H / 2, lay.zc);
    // The artwork is the subject: it keeps its colours in china style.
    canvasMesh.userData.key = true;
    world!.add(canvasMesh);

    const sm = spotMaterial(lay.H / lay.W, false, 0.035);
    owned.push(sm);
    spot = new THREE.Mesh(new THREE.PlaneGeometry(lay.W, lay.H), sm);
    owned.push(spot.geometry);
    spot.name = "spotlight";
    spot.position.set(0, lay.y0 + lay.H / 2, lay.zc + Z.dim);
    spot.renderOrder = 1;
    spot.userData.key = true;
    world!.add(spot);
  }

  function rectOutline(rect: ArtRect, color: string, name: string) {
    const g = new THREE.Group();
    g.name = name;
    const mat = basic(color, 0.9);
    owned.push(mat);
    const [x, y, w, h] = rect;
    const c: XY[] = [toPlane(x, y), toPlane(x + w, y), toPlane(x + w, y + h), toPlane(x, y + h)];
    const width = strokeW(1.8);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(STRIP, mat);
      const a = c[i]!;
      const b = c[(i + 1) % 4]!;
      // extend by half a width so the corners close
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const e = width / 2 / len;
      setStrip(m, [a[0] - dx * e, a[1] - dy * e], [b[0] + dx * e, b[1] + dy * e], 1, width, lay.zc + Z.outline);
      m.renderOrder = 2;
      g.add(m);
    }
    g.userData.key = true;
    world!.add(g);
    return { outline: g, mat };
  }

  function buildRegions(d: ArtData) {
    if (!lay.hasCanvas) return;
    for (const r of d.regions) {
      const { outline, mat } = rectOutline(r.rect, COLORS.highlight!, `region:${r.id}`);
      regions.set(r.id, { rect: r.rect, outline, mat });
    }
  }

  function markerGroup(color: string, size: number, name: string) {
    const g = new THREE.Group();
    g.name = name;
    const mat = basic(color, 1);
    const ring = new THREE.RingGeometry(size * 0.75, size, 40);
    const dot = new THREE.CircleGeometry(size * 0.28, 24);
    owned.push(mat, ring, dot);
    g.add(new THREE.Mesh(ring, mat), new THREE.Mesh(dot, mat));
    g.renderOrder = 4;
    g.userData.key = true;
    return { group: g, mat };
  }

  function buildOverlays(d: ArtData) {
    const aspect = lay.H / lay.W;
    for (const o of d.overlays) {
      const group = new THREE.Group();
      group.name = `overlay:${o.id}`;
      group.userData.key = true;
      world!.add(group);
      const color = o.color ?? (o.kind === "arrow" ? COLORS[o.style]! : COLORS[o.kind] ?? "#ffffff");
      const mat = basic(color, 0.95);
      owned.push(mat);
      const obj: OverlayObj = { def: o, group, strokes: [], mats: [mat] };
      if (o.kind === "perspective") {
        const vp = perspectivePoint(o);
        if (vp) vps.set(o.id, vp);
      }
      if (lay.hasCanvas && o.kind !== "palette") {
        const strokes = overlayStrokes(o, vps.get(o.id) ?? null, toPlane, aspect, lay.W);
        for (const s of strokes) {
          const m = new THREE.Mesh(STRIP, mat);
          m.renderOrder = 3;
          group.add(m);
          obj.strokes.push({ stroke: s, mesh: m });
        }
        if (o.kind === "guess") {
          const persp = d.overlays.find((p) => p.id === o.perspective);
          const n = persp?.kind === "perspective" ? persp.lines.length : 0;
          for (let i = 0; i < n; i++) {
            const m = new THREE.Mesh(STRIP, mat);
            m.renderOrder = 3;
            group.add(m);
          }
        }
        if (o.kind === "perspective" || o.kind === "guess") {
          const mk = markerGroup(color, lay.W * 0.018, `${o.kind === "guess" ? "guess" : "vanishing-point"}:${o.id}`);
          obj.mats.push(mk.mat);
          group.add(mk.group);
          obj.marker = mk.group;
        }
      }
      if (o.kind === "palette") {
        const colours = o.colors?.map((c) => c.color) ?? computePalette(ctx!, d.artwork.image?.asset ?? "", image, o.count ?? 5);
        const n = colours.length;
        const size = Math.min(1.0, (lay.W * 0.8) / n);
        const geo = new THREE.BoxGeometry(size * 0.9, size * 0.9, size * 0.12).translate(0, size * 0.45, 0);
        owned.push(geo);
        obj.swatches = colours.map((c, i) => {
          const sm = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, transparent: true });
          owned.push(sm);
          const m = new THREE.Mesh(geo, sm);
          m.name = `swatch:${i}`;
          m.position.set((i - (n - 1) / 2) * size, 0, Math.max(1.2, lay.y0 * 0.4 + 0.9));
          m.rotation.x = -0.15;
          group.add(m);
          return m;
        });
      }
      overlays.set(o.id, obj);
    }
  }

  function buildLayers(d: ArtData) {
    if (!lay.hasCanvas) return;
    const thick = Math.max(0.03, lay.W * 0.003);
    for (const l of d.layers) {
      const r = d.regions.find((x) => x.id === l.region)!;
      const [x, y, w, h] = r.rect;
      const geo = new THREE.BoxGeometry(w * lay.W, h * lay.H, thick);
      owned.push(geo);
      // Front face (+z, group 4): the cropped image; the edges and the back are white paper.
      const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
      const front = geo.groups[4]!;
      const idx = geo.getIndex()!;
      const done = new Set<number>();
      for (let k = front.start; k < front.start + front.count; k++) {
        const v = idx.getX(k);
        if (done.has(v)) continue;
        done.add(v);
        uv.setXY(v, x + uv.getX(v) * w, y + (1 - uv.getY(v)) * h);
      }
      const face = new THREE.MeshBasicMaterial({ color: image ? 0xffffff : 0xd8d0c0, map: image?.texture ?? null });
      const paper = stdMat("#f7f3ea", 0.95);
      owned.push(face);
      const card = new THREE.Mesh(geo, [paper, paper, paper, paper, face, paper]);
      card.name = `layer:${l.id}`;
      const [cx, cy] = toPlane(x + w / 2, y + h / 2);
      card.position.set(cx, cy, lay.zc + thick / 2);
      world!.add(card);
      const sm = spotMaterial((h * lay.H * 1.2) / (w * lay.W * 1.2), true, 0.08);
      owned.push(sm);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * lay.W * 1.2, h * lay.H * 1.2), sm);
      owned.push(shadow.geometry);
      sm.uniforms.uRect!.value.set(0.08, 0.08, 0.84, 0.84);
      shadow.position.set(cx, cy, lay.zc + Z.outline);
      shadow.renderOrder = 2;
      shadow.userData.key = true;
      world!.add(shadow);
      layers.set(l.id, { id: l.id, rect: r.rect, depth: l.depth ?? DEFAULT_DEPTH, card, shadow });
    }
  }

  function buildArchitecture(d: ArtData) {
    for (const e of d.architecture ?? []) {
      const b = buildElement(e);
      for (const m of b.materials) owned.push(m);
      b.object.traverse((o) => o instanceof THREE.Mesh && owned.push(o.geometry));
      world!.add(b.object);
      elements.set(e.id, { ...b, id: e.id });
    }
  }

  async function buildModel(d: ArtData) {
    const m = d.model;
    if (!m) return;
    const baseY = d.presentation.mount === "plinth" ? PLINTH_H : 0;
    // Invisible proxy: the same bounds in Node (no model decoding) and in the browser.
    const proxyGeo = new THREE.BoxGeometry(m.height * 0.6, m.height, m.height * 0.6).translate(0, m.height / 2, 0);
    const proxyMat = stoneMaterial();
    owned.push(proxyGeo, proxyMat);
    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.name = "model-proxy";
    proxy.visible = false;
    proxy.position.y = baseY;
    world!.add(proxy);
    if (!canDecode(ctx!)) return;
    try {
      const buf = await ctx!.loadAsset(m.asset);
      const gltf = await new GLTFLoader().parseAsync(buf, "");
      const obj = gltf.scene;
      const bb = new THREE.Box3().setFromObject(obj);
      const size = bb.getSize(new THREE.Vector3());
      const k = size.y > 0 ? m.height / size.y : 1;
      obj.scale.setScalar(k);
      obj.position.set(-((bb.min.x + bb.max.x) / 2) * k, baseY - bb.min.y * k, -((bb.min.z + bb.max.z) / 2) * k);
      obj.name = "model";
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          owned.push(o.geometry);
          for (const mm of Array.isArray(o.material) ? o.material : [o.material]) owned.push(mm);
        }
      });
      world!.add(obj);
    } catch (e) {
      console.warn(`[art] model ${m.asset} unavailable:`, e);
    }
  }

  function computeBounds() {
    world!.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(world!);
    if (bb.isEmpty()) bb.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    let maxDepth = 0;
    for (const l of layers.values()) maxDepth = Math.max(maxDepth, l.depth);
    if (maxDepth > 0) bb.expandByPoint(new THREE.Vector3(0, lay.y0, lay.zc + maxDepth));
    const s = bb.getBoundingSphere(new THREE.Sphere());
    bound = { center: s.center, radius: Math.max(s.radius, 0.5) };
  }

  // ---------------------------------------------------------------------------------- update

  function updateTour(chapterId: string, t: number) {
    if (!spot) return;
    const tours = (acts.get(chapterId) ?? []).filter((a) => a.do === "tour").sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    let cur = -1;
    for (let i = 0; i < tours.length; i++) if ((tours[i]!.at ?? 0) <= t) cur = i;
    let dim = 0;
    let rect: ArtRect = [0, 0, 1, 1];
    if (cur >= 0) {
      const a = tours[cur]!;
      const r = regions.get(a.target)?.rect;
      const prev = cur > 0 ? tours[cur - 1]! : null;
      const prevRect = prev ? regions.get(prev.target)?.rect : undefined;
      const chained = prev && prevRect && (prev.until === undefined || prev.until >= (a.at ?? 0) - 0.05);
      if (r) {
        const p = ease.inOutCubic(seg(t, a.at ?? 0, (a.at ?? 0) + 0.9));
        rect = chained ? (r.map((v, k) => lerp(prevRect![k]!, v, p)) as unknown as ArtRect) : r;
        const fadeIn = chained || a.at === undefined ? 1 : seg(t, a.at, a.at + 0.7);
        const fadeOut = a.until === undefined ? 1 : 1 - seg(t, a.until - 0.6, a.until);
        dim = 0.62 * Math.min(fadeIn, fadeOut);
      }
    }
    spot.visible = dim > 0.002;
    spot.material.uniforms.uDim!.value = dim;
    (spot.material.uniforms.uRect!.value as THREE.Vector4).set(...rect);
  }

  function updateRegions(chapterId: string, t: number) {
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.7);
    for (const [id, r] of regions) {
      const hi = envelope(actsFor(chapterId, id, "highlight"), t).env;
      const tour = envelope(actsFor(chapterId, id, "tour"), t, 0.7, 0.6).env;
      const op = Math.max(hi * (0.65 + 0.35 * pulse), tour * 0.55);
      r.outline.visible = op > 0.01;
      r.mat.opacity = op;
    }
  }

  function updateOverlays(chapterId: string, t: number) {
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.8);
    for (const [id, o] of overlays) {
      // A show window ends at `until`, or SHOW_HOLD seconds after the drawing is complete.
      const shows = actsFor(chapterId, id, "show").map((a) => ({ ...a, until: a.until ?? (a.at ?? 0) + (a.draw ?? DEFAULT_DRAW) + SHOW_HOLD }));
      const { env, act } = envelope(shows, t);
      let shown = env;
      let draw = act ? (act.at === undefined ? 1 : seg(t, act.at, act.at + (act.draw ?? DEFAULT_DRAW))) : 0;
      const opacity = override("opacity", id);
      const guess = o.def.kind === "guess" ? guessPoint(id) : null;
      const guessMoved = o.def.kind === "guess" && (override("guess-x", id) !== undefined || override("guess-y", id) !== undefined);
      if (opacity !== undefined || guessMoved) {
        shown = 1;
        draw = 1;
      }
      const alpha = shown * (opacity ?? 1);
      o.group.visible = alpha > 0.002;
      if (!o.group.visible) continue;
      for (const m of o.mats) m.opacity = OVERLAY_OPACITY * alpha;
      for (const s of o.strokes) setStrip(s.mesh, s.stroke.a, s.stroke.b, strokeFraction(s.stroke, draw), strokeW(s.stroke.width), lay.zc + Z.overlay);
      if (o.def.kind === "guess" && guess) {
        const persp = data!.overlays.find((p) => p.id === (o.def as { perspective: string }).perspective);
        const lines = persp?.kind === "perspective" ? persp.lines : [];
        const end = toPlane(guess[0], guess[1]);
        const meshes = o.group.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
        lines.forEach((l, k) => {
          const m = meshes[k];
          if (m) setStrip(m, toPlane(l[0], l[1]), end, draw, strokeW(0.9), lay.zc + Z.overlay);
        });
        if (o.marker) {
          o.marker.visible = draw > 0.9;
          o.marker.position.set(end[0], end[1], lay.zc + Z.marker);
          o.marker.scale.setScalar(ease.inOutQuad(seg(draw, 0.9, 1)));
        }
      }
      if (o.def.kind === "perspective" && o.marker) {
        const vp = vps.get(id);
        const k = seg(draw, 0.92, 1);
        o.marker.visible = !!vp && k > 0;
        if (vp) {
          const p = toPlane(vp[0], vp[1]);
          o.marker.position.set(p[0], p[1], lay.zc + Z.marker);
          o.marker.scale.setScalar(k * (1 + 0.25 * pulse));
        }
      }
      if (o.swatches) {
        const n = o.swatches.length;
        o.swatches.forEach((m, i) => {
          const p = act?.at === undefined && opacity === undefined ? 1 : ease.inOutCubic(seg(draw, (0.5 * i) / n, (0.5 * i) / n + 0.5));
          m.visible = p > 0.001;
          m.scale.set(1, Math.max(1e-3, p), 1);
          (m.material as THREE.MeshStandardMaterial).opacity = alpha;
        });
      }
    }
  }

  function updateLayers(chapterId: string, t: number) {
    for (const l of layers.values()) {
      const { lift, depth } = liftOf(chapterId, l, t);
      const k = lift < 1 ? ease.inOutCubic(lift) : 1;
      const thick = (l.card.geometry as THREE.BoxGeometry).parameters.depth;
      l.card.visible = k > 0.01;
      l.card.position.z = lay.zc + thick / 2 + depth * k;
      l.card.scale.setScalar(1 + 0.03 * k);
      l.card.userData.key = k > 0.01;
      l.shadow.visible = k > 0.01;
      l.shadow.material.uniforms.uDim!.value = 0.5 * k;
      const [cx, cy] = toPlane(l.rect[0] + l.rect[2] / 2, l.rect[1] + l.rect[3] / 2);
      l.shadow.position.set(cx + depth * k * 0.25, cy - depth * k * 0.35, lay.zc + Z.outline);
    }
  }

  function updateElements(chapterId: string, t: number) {
    for (const e of elements.values()) {
      const shows = actsFor(chapterId, e.id, "show");
      const env = shows.length ? envelope(shows, t, 1.0, 0.6).env : 1;
      const glow = envelope(actsFor(chapterId, e.id, "highlight"), t).env;
      e.object.visible = env > 0.01;
      e.object.scale.set(1, Math.max(1e-3, ease.inOutCubic(env)), 1);
      e.object.userData.key = glow > 0.05;
      for (const m of e.materials) m.emissive.setRGB(0.35 * glow, 0.25 * glow, 0.05 * glow);
    }
  }

  return {
    async build(c, s: SceneSpec) {
      if (s.engine !== "art") throw new Error(`art engine got a "${s.engine}" scene`);
      ctx = c;
      spec = s;
      data = s.engineData;
      acts = new Map(data.chapters.map((ch) => [ch.chapter, ch.actions]));
      lay = layoutOf(data);
      world = new THREE.Group();
      world.name = "art";
      c.root.add(world);

      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(data.presentation.background ?? PAPER);
      const key = new THREE.DirectionalLight(0xfff4e0, 0.9 * Math.PI);
      key.position.set(-10, 14, 12);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.8 * Math.PI), key];
      for (const l of lights) c.scene.add(l);

      if (data.artwork.image) image = await loadArtImage(c, data.artwork.image.asset);
      buildMount(data);
      buildCanvas(data);
      buildRegions(data);
      buildLayers(data);
      buildOverlays(data);
      buildArchitecture(data);
      await buildModel(data);
      computeBounds();
    },

    update(chapterId, t) {
      if (!world) return;
      updateTour(chapterId, t);
      updateRegions(chapterId, t);
      updateOverlays(chapterId, t);
      updateLayers(chapterId, t);
      updateElements(chapterId, t);
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || !world) return false;
      const surface = lay.zc + Z.marker;
      switch (anchor.entity) {
        case "region": {
          const r = anchor.part !== undefined ? regions.get(anchor.part) : undefined;
          if (!r) return false;
          const [x, y] = toPlane(r.rect[0] + r.rect[2] / 2, r.rect[1] + r.rect[3] / 2);
          out.set(x, y, surface);
          break;
        }
        case "vanishing-point": {
          if (!lay.hasCanvas) return false;
          const id = anchor.part ?? [...vps.keys()][0];
          const p = id === undefined ? null : (vps.get(id) ?? guessPoint(id));
          if (!p) return false;
          const [x, y] = toPlane(p[0], p[1]);
          out.set(x, y, surface);
          break;
        }
        case "layer": {
          const l = anchor.part !== undefined ? layers.get(anchor.part) : undefined;
          if (!l) return false;
          const { lift, depth } = liftOf(chapterId, l, t);
          const [x, y] = toPlane(l.rect[0] + l.rect[2] / 2, l.rect[1] + l.rect[3] / 2);
          out.set(x, y, surface + depth * (lift < 1 ? ease.inOutCubic(lift) : 1));
          break;
        }
        case "artwork":
          if (lay.hasCanvas) out.set(0, lay.y0 + lay.H / 2, surface);
          else out.copy(bound.center);
          break;
        case "element": {
          const e = anchor.part !== undefined ? elements.get(anchor.part) : undefined;
          if (!e) return false;
          out.copy(e.top);
          break;
        }
        default:
          return false;
      }
      if (anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
      return true;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    params(chapterId): EngineParam[] {
      const ids = spec?.chapters.find((ch) => ch.id === chapterId)?.activity?.test.params ?? [];
      return ids.flatMap((id) => {
        const p = paramDef(id);
        if (!p) return [];
        let def = p.value;
        if (def === undefined) {
          const o = overlays.get(p.target)?.def;
          if (p.kind === "guess-x" && o?.kind === "guess") def = o.start[0];
          else if (p.kind === "guess-y" && o?.kind === "guess") def = o.start[1];
          else if (p.kind === "depth") def = layers.get(p.target)?.depth ?? DEFAULT_DEPTH;
          else def = 1;
        }
        const value = overrides?.[id] ?? clamp(def, p.min, p.max);
        return [{ id, label: p.label, min: p.min, max: p.max, step: p.step ?? (p.max - p.min) / 100, value }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      overrides = {};
      for (const [id, v] of Object.entries(values)) {
        const p = paramDef(id);
        if (p && Number.isFinite(v)) overrides[id] = clamp(v, p.min, p.max);
      }
    },

    dispose() {
      if (!ctx || !world) return;
      for (const o of owned) o.dispose();
      image?.texture.dispose();
      image?.bitmap.close();
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      spec = null;
      data = null;
      world = null;
      lights = [];
      image = null;
      spot = null;
      overlays = new Map();
      regions = new Map();
      layers = new Map();
      elements = new Map();
      vps = new Map();
      acts = new Map();
      overrides = null;
      owned.length = 0;
    },
  };
}
