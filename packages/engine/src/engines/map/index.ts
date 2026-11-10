// `map` engine: real relief (Terrarium DEM), ISTAT / Natural Earth boundaries, rivers, data
// columns, effects, route arrows and tinted areas, all driven by the declarative MapData
// (packages/scene-spec/src/engines/map.ts).
// Look and choreography follow docs/reference/prototypes/campania-ar.html (analysis §4, App. B).
//
// update(chapterId, t) is a pure function of its arguments: every animated value is computed
// from (chapterId, t) only, so the player can scrub in both directions.
import * as THREE from "three";
import type { Anchor, MapData, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../../types.ts";
import { seg } from "../../util/math.ts";
import { EruptionFx, type Ground } from "./eruption.ts";
import { RouteFx, routeState } from "./routes.ts";
import {
  densify,
  Grid,
  landBorder,
  lines,
  parseTerrain,
  Projection,
  rasterize,
  rings,
  type GeoCollection,
  type LonLat,
  type TerrainHeader,
} from "./geo.ts";

export { Projection } from "./geo.ts";

// The scene-spec package index exports only MapData, so the parts are derived from it.
type ColorMode = MapData["colorModes"][number];
type ChapterWindow = NonNullable<MapData["rivers"]>["items"][number]["highlight"][number];
type MapArea = MapData["areas"][number];

/** Land classes per grid node. */
const SEA = 0, FOCUS = 1, NEIGHBOR = 2, OTHER = 3;

/** Scene-unit offsets (from the prototype). */
const LAND_BASE = 0.015;
const SEABED_TOP = -0.03;
const SEABED_DEPTH = 0.12;
const DRAPE = 0.012;

const DEFAULT_STOPS = [
  { elev: 0, color: "#6fae4b" },
  { elev: 150, color: "#a9c95a" },
  { elev: 400, color: "#e0d78a" },
  { elev: 700, color: "#d6b06a" },
  { elev: 1100, color: "#b9844c" },
  { elev: 1600, color: "#8f5f3c" },
  { elev: 2100, color: "#efe9df" },
];
const NEIGHBOR_COLOR = "#d8d5ca";
const OTHER_COLOR = "#e4e2da";
const SEABED_COLOR = "#9cc3d8";
const SEABED_DEEP = "#6e9fbd";

export interface MapEngine extends Engine {
  /** Colour mode chosen by the user; null = follow the scene's colorModeTrack. */
  setColorMode(id: string | null): void;
  /** Colour mode in effect at (chapterId, t), override included (for the legend). */
  colorModeAt(chapterId: string, t: number): string;
  /** Routes visible at (chapterId, t), in scene order (for a legend). */
  routesAt(chapterId: string, t: number): { id: string; label: string; dates?: string; color: string; progress: number }[];
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/** 0..1 inside a chapter window with `fade` seconds in and out; 0 in other chapters. */
function windowLevel(ws: ChapterWindow[], chapterId: string, t: number, fade: number): number {
  let v = 0;
  for (const w of ws) {
    if (w.chapter !== chapterId) continue;
    const from = w.from ?? 0, to = w.to ?? Infinity;
    v = Math.max(v, seg(t, from, from + fade) * (1 - seg(t, to - fade, to)));
  }
  return v;
}

function decodeJson<T>(buf: ArrayBuffer): T {
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

function rampColor(stops: { elev: number; color: string }[], e: number, out: THREE.Color): THREE.Color {
  if (e <= stops[0]!.elev) return out.set(stops[0]!.color);
  for (let k = 1; k < stops.length; k++) {
    const b = stops[k]!;
    if (e <= b.elev) {
      const a = stops[k - 1]!;
      return out.set(a.color).lerp(new THREE.Color(b.color), (e - a.elev) / (b.elev - a.elev));
    }
  }
  return out.set(stops[stops.length - 1]!.color);
}

interface Column {
  pinId: string;
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  fullHeight: number;
}

export function createMapEngine(): MapEngine {
  let data: MapData;
  let ctx: EngineContext;
  let proj: Projection;
  let grid: Grid;
  let world: THREE.Group;
  /** Mesh y of every grid node (scene units). */
  let nodeY: Float32Array;
  let cls: Uint8Array;
  let terrain: THREE.Mesh;
  const modeColors = new Map<string, Float32Array>();
  let fertWeight: Float32Array | null = null;
  const fertColor = new THREE.Color();
  let colorKey = "";
  let override: string | null = null;
  const sceneLights: THREE.Light[] = [];
  const glows: { mat: THREE.MeshBasicMaterial; windows: ChapterWindow[]; tubes: THREE.Mesh[] }[] = [];
  const columns: Column[] = [];
  let effects: EruptionFx[] = [];
  /** Per chapter: city markers and their visibility windows (undefined = whole chapter). */
  const markers = new Map<string, { mesh: THREE.Mesh; visible?: [number, number][] }[]>();
  const allMarkers: THREE.Mesh[] = [];
  let routes: RouteFx[] = [];
  /** Tinted areas: grid-node mask (land only) and outline materials. */
  const areaFx: { spec: MapArea; mask: Uint8Array; color: THREE.Color; outline: THREE.LineBasicMaterial | null }[] = [];
  /** Densify step and border tolerance in degrees, scaled with the area (Campania: 0.004 / 0.01). */
  let step = 0.004;
  let borderTol = 0.01;
  let maxY = 0;

  const surfaceY = (lon: number, lat: number) => grid.sample(lon, lat, nodeY);

  function modeAt(chapterId: string, t: number): ColorMode {
    const id = override ?? [...(data.colorModeTrack[chapterId] ?? [])].reverse().find((k) => t >= k.at)?.mode;
    return data.colorModes.find((m) => m.id === id) ?? data.colorModes[0]!;
  }

  function fertilityAt(chapterId: string, t: number): number {
    return effects.reduce((v, fx) => Math.max(v, fx.fertility(chapterId, t)), 0);
  }

  function buildModeColors(mode: ColorMode, elev: Float32Array): Float32Array {
    const out = new Float32Array(elev.length * 3);
    const c = new THREE.Color();
    const neighbor = new THREE.Color(NEIGHBOR_COLOR), other = new THREE.Color(OTHER_COLOR);
    const sea = new THREE.Color(SEABED_COLOR), deep = new THREE.Color(SEABED_DEEP);
    const stops = mode.type === "altitude" ? (mode.stops ?? DEFAULT_STOPS) : null;
    const classes = mode.type === "classes" ? mode.classes.map((k) => ({ max: k.maxElev ?? Infinity, color: new THREE.Color(k.color) })) : [];
    for (let i = 0; i < elev.length; i++) {
      const e = elev[i]!;
      switch (cls[i]) {
        case SEA:
          c.copy(sea).lerp(deep, Math.min(1, Math.max(0, -e) / 1500));
          break;
        case FOCUS:
          if (stops) rampColor(stops, Math.max(0, e), c);
          else c.copy((classes.find((k) => e < k.max) ?? classes[classes.length - 1]!).color);
          break;
        case NEIGHBOR:
          c.copy(neighbor);
          break;
        default:
          c.copy(other);
      }
      out.set([c.r, c.g, c.b], i * 3);
    }
    return out;
  }

  function applyColors(chapterId: string, t: number): void {
    const mode = modeAt(chapterId, t);
    // Quantised so a ramp recolours ~50 times, not every frame; still a pure function of t.
    const fert = mode.type === "altitude" && fertWeight ? Math.round(fertilityAt(chapterId, t) * 50) / 50 : 0;
    const areaLevels = areaFx.map((a) => Math.round(windowLevel(a.spec.show, chapterId, t, 0.6) * 50) / 50);
    const key = `${mode.id}|${fert}|${areaLevels.join(",")}`;
    if (key === colorKey) return;
    colorKey = key;
    const base = modeColors.get(mode.id)!;
    const attr = terrain.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    arr.set(base);
    if (fert > 0 && fertWeight) {
      for (let i = 0; i < fertWeight.length; i++) {
        const w = fertWeight[i]! * fert;
        if (w <= 0) continue;
        const o = i * 3;
        arr[o] = arr[o]! + (fertColor.r - arr[o]!) * w;
        arr[o + 1] = arr[o + 1]! + (fertColor.g - arr[o + 1]!) * w;
        arr[o + 2] = arr[o + 2]! + (fertColor.b - arr[o + 2]!) * w;
      }
    }
    areaFx.forEach((a, k) => {
      const w = areaLevels[k]! * a.spec.fillOpacity;
      if (w <= 0) return;
      for (let i = 0; i < a.mask.length; i++) {
        if (!a.mask[i]) continue;
        const o = i * 3;
        arr[o] = arr[o]! + (a.color.r - arr[o]!) * w;
        arr[o + 1] = arr[o + 1]! + (a.color.g - arr[o + 1]!) * w;
        arr[o + 2] = arr[o + 2]! + (a.color.b - arr[o + 2]!) * w;
      }
    });
    attr.needsUpdate = true;
  }

  function buildTerrain(elev: Float32Array): void {
    const W = grid.width, H = grid.height;
    const pos = new Float32Array(W * H * 3);
    nodeY = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const n = j * W + i;
        const e = elev[n]!;
        const y = cls[n] === SEA ? SEABED_TOP - (Math.min(2000, Math.max(0, -e)) / 2000) * SEABED_DEPTH : LAND_BASE + Math.max(0, e) * proj.vs;
        nodeY[n] = y;
        maxY = Math.max(maxY, y);
        pos.set([proj.x(grid.lon(i)), y, proj.z(grid.lat(j))], n * 3);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(W * H * 3), 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    terrain.name = "terrain";
    world.add(terrain);

    // Water: a translucent plane at sea level over the whole area.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(proj.width, proj.depth),
      new THREE.MeshPhongMaterial({ color: 0x3d8fc6, transparent: true, opacity: 0.8, shininess: 60, specular: 0x446677, depthWrite: false }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(proj.x((proj.bbox.lonMin + proj.bbox.lonMax) / 2), 0, proj.z((proj.bbox.latMin + proj.bbox.latMax) / 2));
    water.renderOrder = 1;
    water.name = "water";
    world.add(water);
  }

  function drape(line: LonLat[], lift: number): THREE.Vector3[] {
    return line.map(([lon, lat]) => new THREE.Vector3(proj.x(lon), Math.max(0, surfaceY(lon, lat)) + lift, proj.z(lat)));
  }

  function buildOutline(regions: GeoCollection): void {
    const b = data.boundaries;
    const focus = regions.features.filter((f) => f.properties.name === b.focus);
    if (!focus.length) throw new Error(`map: boundary "${b.focus}" not found`);
    const others = regions.features.filter((f) => f.properties.name !== b.focus).flatMap(rings);
    const parts = landBorder(focus.flatMap(rings), others, borderTol, proj.cos0, step);
    const mat = new THREE.LineDashedMaterial({ color: b.outlineColor, dashSize: 0.09, gapSize: 0.06 });
    for (const part of parts) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(drape(part, 0.02)), mat);
      line.computeLineDistances();
      line.name = "outline";
      world.add(line);
    }
  }

  /** Faint land borders written by server/src/geo as `kind: "border"` line features (country-level maps). */
  function buildBorders(regions: GeoCollection): void {
    const mat = new THREE.LineBasicMaterial({ color: 0x4a4a4a, transparent: true, opacity: 0.4, depthWrite: false });
    for (const f of regions.features) {
      if (f.properties.kind !== "border") continue;
      for (const l of lines(f)) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(drape(densify(l, step), 0.015)), mat);
        line.name = "border";
        world.add(line);
      }
    }
  }

  function buildAreas(): void {
    for (const spec of data.areas) {
      const mask = new Uint8Array(cls.length);
      rasterize(grid, [spec.polygon as LonLat[]], 1, mask);
      for (let i = 0; i < mask.length; i++) if (cls[i] === SEA) mask[i] = 0;
      let outline: THREE.LineBasicMaterial | null = null;
      if (spec.outline) {
        outline = new THREE.LineBasicMaterial({ color: spec.outline, transparent: true, opacity: 0, depthWrite: false });
        const ring = [...spec.polygon, spec.polygon[0]!] as LonLat[];
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(drape(densify(ring, step), 0.025)), outline);
        line.name = `area:${spec.id}`;
        world.add(line);
      }
      areaFx.push({ spec, mask, color: new THREE.Color(spec.fill), outline });
    }
  }

  function buildRivers(fc: GeoCollection): void {
    const r = data.rivers!;
    const core = new THREE.MeshBasicMaterial({ color: 0x2a73c4 });
    for (const item of r.items) {
      const f = fc.features.find((x) => x.properties.id === item.id);
      if (!f) throw new Error(`map: river "${item.id}" not in ${r.asset}`);
      const glow = new THREE.MeshBasicMaterial({ color: 0x6fc3ff, transparent: true, opacity: 0, depthWrite: false });
      const tubes: THREE.Mesh[] = [];
      glows.push({ mat: glow, windows: item.highlight, tubes });
      for (const l of lines(f)) {
        const pts = drape(densify(l, step), DRAPE);
        if (pts.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(pts);
        const segs = Math.min(600, pts.length * 2);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, 0.018 * item.width, 6), core);
        tube.name = `river:${item.id}`;
        const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, 0.055 * item.width, 8), glow);
        halo.name = `river-glow:${item.id}`;
        // China style (player): the glow is a key element whenever it shows.
        halo.userData.key = true;
        tubes.push(tube);
        world.add(tube, halo);
      }
    }
  }

  function buildColumns(): void {
    const c = data.columns!;
    const max = Math.max(...c.items.map((i) => i.value)) || 1;
    const geo = new THREE.CylinderGeometry(0.11, 0.11, 1, 24).translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: c.color, transparent: true, opacity: 0.92 });
    for (const item of c.items) {
      const [lon, lat] = item.geo;
      const base = new THREE.Vector3(proj.x(lon), Math.max(0, surfaceY(lon, lat)), proj.z(lat));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(base);
      mesh.visible = false;
      mesh.name = `column:${item.pinId}`;
      mesh.userData.key = true; // shown only while the columns are being told

      world.add(mesh);
      columns.push({ pinId: item.pinId, mesh, base, fullHeight: (item.value / max) * c.maxHeight });
    }
  }

  function columnHeight(col: Column, chapterId: string, t: number): number {
    let p = 0;
    for (const w of data.columns!.show) {
      if (w.chapter !== chapterId) continue;
      const from = w.from ?? 0, to = w.to ?? Infinity;
      p = Math.max(p, easeOut(seg(t, from, from + w.grow)) * (1 - easeOut(seg(t, to, to + w.grow))));
    }
    return p * col.fullHeight;
  }

  function buildMarkers(spec: SceneSpec): void {
    const geo = new THREE.SphereGeometry(0.035, 12, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
    const byPlace = new Map<string, THREE.Mesh>();
    for (const ch of spec.chapters) {
      const list: { mesh: THREE.Mesh; visible?: [number, number][] }[] = [];
      for (const pin of ch.pins) {
        if (pin.kind !== "city" || !("geo" in pin.anchor)) continue;
        const [lon, lat] = pin.anchor.geo;
        const key = `${lon},${lat}`;
        let mesh = byPlace.get(key);
        if (!mesh) {
          mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(proj.x(lon), Math.max(0, surfaceY(lon, lat)) + 0.02, proj.z(lat));
          mesh.visible = false;
          mesh.name = `city:${pin.id}`;
          byPlace.set(key, mesh);
          allMarkers.push(mesh);
          world.add(mesh);
        }
        list.push({ mesh, visible: pin.visible });
      }
      markers.set(ch.id, list);
    }
  }

  function buildFertility(elev: Float32Array): void {
    const withFert = effects.filter((fx) => fx.spec.fertility);
    if (!withFert.length) return;
    fertWeight = new Float32Array(elev.length);
    fertColor.set(withFert[0]!.spec.fertility!.color);
    const smooth = (a: number, b: number, x: number) => {
      const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return u * u * (3 - 2 * u);
    };
    for (let j = 0; j < grid.height; j++) {
      for (let i = 0; i < grid.width; i++) {
        const n = j * grid.width + i;
        if (cls[n] !== FOCUS) continue;
        let w = 0;
        for (const fx of withFert) {
          const f = fx.spec.fertility!;
          const d = proj.km([grid.lon(i), grid.lat(j)], fx.spec.geo);
          w = Math.max(w, (1 - smooth(0.6 * f.radiusKm, f.radiusKm, d)) * (1 - smooth(0.6 * f.maxElev, f.maxElev, elev[n]!)));
        }
        fertWeight[n] = w;
      }
    }
  }

  function makeSprite(): THREE.Texture | null {
    const canvas = ctx.createCanvas?.(64, 64);
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return null;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  return {
    async build(context, spec) {
      if (spec.engine !== "map") throw new Error(`map engine got a "${spec.engine}" scene`);
      ctx = context;
      data = spec.engineData;
      world = new THREE.Group();
      world.name = "map";
      ctx.root.add(world);

      const header = decodeJson<TerrainHeader>(await ctx.loadAsset(data.terrain.asset));
      // The grid's own bbox places the mesh; area.bbox defines the projection (normally the same box).
      grid = parseTerrain(header, await ctx.loadAsset(dirOf(data.terrain.asset) + header.data));
      proj = new Projection(data.area.bbox, data.area.widthUnits, data.terrain.verticalExaggeration);
      const elev = grid.values;
      const span = data.area.bbox.lonMax - data.area.bbox.lonMin;
      step = Math.max(0.004, span / 600);
      borderTol = Math.max(0.01, span / 250);

      const regions = decodeJson<GeoCollection>(await ctx.loadAsset(data.boundaries.asset));
      const focus = data.boundaries.focus || null;
      cls = new Uint8Array(elev.length); // SEA
      for (const f of regions.features) {
        const name = String(f.properties.name);
        if (name === focus) continue;
        // Without a focus every land feature is the subject: relief colours everywhere.
        rasterize(grid, rings(f), !focus ? FOCUS : data.boundaries.neighbors.includes(name) ? NEIGHBOR : OTHER, cls);
      }
      for (const f of regions.features) if (focus && f.properties.name === focus) rasterize(grid, rings(f), FOCUS, cls);

      buildTerrain(elev);
      for (const mode of data.colorModes) modeColors.set(mode.id, buildModeColors(mode, elev));
      if (focus) buildOutline(regions);
      buildBorders(regions);
      buildAreas();
      if (data.rivers) buildRivers(decodeJson<GeoCollection>(await ctx.loadAsset(data.rivers.asset)));
      if (data.columns) buildColumns();
      if (data.cityMarkers) buildMarkers(spec);

      const ground: Ground = {
        xz: (lon, lat) => [proj.x(lon), proj.z(lat)],
        y: surfaceY,
        isLand: (lon, lat) => {
          if (!proj.inside(lon, lat)) return false;
          const [fi, fj] = grid.fij(lon, lat);
          return cls[Math.round(fj) * grid.width + Math.round(fi)] !== SEA;
        },
        degPerKm: [1 / (111.32 * proj.cos0), 1 / 111.32],
      };
      const sprite = data.effects.length ? makeSprite() : null;
      effects = data.effects.map((e) => new EruptionFx(e, ground, sprite));
      for (const fx of effects) world.add(fx.points, fx.light);
      buildFertility(elev);
      routes = data.routes.map((r) => new RouteFx(r, { xz: (lon, lat) => [proj.x(lon), proj.z(lat)], y: surfaceY, step: Math.max(0.004, span / 300) }));
      for (const r of routes) world.add(r.group);

      // Lights: r128 values from the prototype (hemi 0.62, dir 0.78) scaled by π for physical lights.
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.62 * Math.PI);
      const sun = new THREE.DirectionalLight(0xffffff, 0.78 * Math.PI);
      sun.position.set(-6, 8, -4);
      sceneLights.push(hemi, sun);
      ctx.scene.add(hemi, sun);

      const first = spec.chapters[0]!;
      this.update(first.id, 0);
    },

    update(chapterId, t) {
      applyColors(chapterId, t);
      for (const g of glows) {
        const level = windowLevel(g.windows, chapterId, t, 0.6);
        g.mat.opacity = 0.45 * level;
        // China style: a river keeps its colour while it is highlighted.
        for (const tube of g.tubes) tube.userData.key = level > 0.05;
      }
      for (const col of columns) {
        const h = columnHeight(col, chapterId, t);
        col.mesh.visible = h > 0.002;
        col.mesh.scale.set(1, Math.max(h, 1e-4), 1);
      }
      for (const fx of effects) fx.update(chapterId, t);
      for (const r of routes) r.update(chapterId, t);
      for (const a of areaFx) if (a.outline) a.outline.opacity = 0.9 * windowLevel(a.spec.show, chapterId, t, 0.6);
      for (const m of allMarkers) m.visible = false;
      for (const m of markers.get(chapterId) ?? []) {
        if (!m.visible || m.visible.some(([a, b]) => t >= a && t <= b)) m.mesh.visible = true;
      }
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if ("geo" in anchor) {
        const [lon, lat] = anchor.geo;
        if (!proj.inside(lon, lat)) return false;
        out.set(proj.x(lon), Math.max(0, surfaceY(lon, lat)) + (anchor.alt ?? 0) * proj.vs, proj.z(lat));
        return true;
      }
      if (anchor.entity === "column") {
        const col = columns.find((c) => c.pinId === anchor.part);
        if (!col) return false;
        out.copy(col.base).add(new THREE.Vector3(0, columnHeight(col, chapterId, t) + 0.06, 0));
        if (anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
        return true;
      }
      if (anchor.entity === "route") {
        const r = routes.find((x) => x.spec.id === anchor.part);
        if (!r || !r.tip(chapterId, t, out, anchor.index)) return false;
        if (anchor.offset) out.add(new THREE.Vector3(...anchor.offset));
        return true;
      }
      return false;
    },

    bounds() {
      const top = Math.max(maxY, data.columns ? data.columns.maxHeight : 0);
      const center = new THREE.Vector3(0, top / 2, 0);
      return { center, radius: Math.hypot(proj.width / 2, proj.depth / 2, top / 2) };
    },

    dispose() {
      for (const l of sceneLights) ctx.scene.remove(l);
      sceneLights.length = 0;
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          (mat as THREE.PointsMaterial).map?.dispose();
          mat.dispose();
        }
      });
      ctx.root.remove(world);
    },

    setColorMode(id) {
      override = id;
      colorKey = "";
    },

    colorModeAt(chapterId, t) {
      return modeAt(chapterId, t).id;
    },

    routesAt(chapterId, t) {
      return data.routes.flatMap((r) => {
        const s = routeState(r, chapterId, t);
        if (!s || s.level <= 0) return [];
        return [{ id: r.id, label: r.label, ...(r.dates ? { dates: r.dates } : {}), color: r.color, progress: s.progress }];
      });
    },
  };
}
