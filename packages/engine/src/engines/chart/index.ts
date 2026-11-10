// `chart` engine ("Dati"): animated 3D infographics (bars, lines, pies/donuts, pictograms,
// proportional bubbles, flows, climographs) from sourced datasets. Schema, units and anchors:
// packages/scene-spec/src/engines/chart.ts. Time model: ./plan.ts (pure in chapter, t).
import * as THREE from "three";
import type { Anchor, ChartAction, SceneSpec } from "@pv/scene-spec";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp } from "../../util/math.ts";
import { formatIt, niceScale, tickDecimals, type Scale } from "./format.ts";
import { showLabel, textSprite } from "./labels.ts";
import {
  allValues,
  barsLayer,
  bubblesLayer,
  flowsLayer,
  lineLayer,
  pictogramLayer,
  pieLayer,
  seriesColor,
  timeGap,
  type Frame,
  type Layer,
} from "./layers.ts";
import { compilePlan, evalChart, type ChartInfo, type ChartState, type Plan } from "./plan.ts";

const PAPER = "#f4efe6";
const PLATE = "#e8e0d0";
const GRID = "#cbbfac";
const DEFAULT_SIZE: [number, number, number] = [12, 6, 3];

type Annotate = Extract<ChartAction, { do: "annotate" }>;

interface ChartObj {
  info: ChartInfo;
  group: THREE.Group;
  W: number;
  H: number;
  D: number;
  layers: { layer: Layer; series: string[] }[];
  /** Static frame materials (plate, grid, axes, labels): opacity follows presence. */
  tracked: { m: THREE.Material; base: number }[];
  legends: Map<string, THREE.Sprite | null>;
  notes: Map<Annotate, { label: THREE.Sprite | null; leader: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> }>;
  level: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Extent for bounds(), chart-local. */
  box: THREE.Box3;
  /** Pie: centre height for the chart anchor. */
  centerY: number;
  state: ChartState | null;
}

export function createChartEngine(): Engine {
  let ctx: EngineContext | null = null;
  let spec: (SceneSpec & { engine: "chart" }) | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let plan: Plan | null = null;
  let charts = new Map<string, ChartObj>();
  let bound = { center: new THREE.Vector3(), radius: 1 };
  /** User slider values by cursor id (setParams); null = the scene's own sweeps. */
  let overrides: Record<string, number> | null = null;
  let last = { chapter: "", t: NaN };
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function buildChart(c: EngineContext, info: ChartInfo): ChartObj {
    const chart = info.chart;
    const [W, H, D] = chart.size ?? DEFAULT_SIZE;
    const group = new THREE.Group();
    group.name = `chart:${chart.id}`;
    group.position.set(...(chart.pos ?? [0, 0, 0]));
    world!.add(group);
    const tracked: ChartObj["tracked"] = [];
    const track = (m: THREE.Material, base = m.opacity) => {
      m.transparent = true;
      tracked.push({ m, base });
    };
    const addLabel = (text: string, h: number, pos: [number, number, number], center: [number, number], opts: Parameters<typeof textSprite>[3] = {}) => {
      const sp = textSprite(c, text, h, { center, ...opts });
      if (!sp) return null;
      sp.position.set(...pos);
      group.add(sp);
      track(sp.material, 1);
      return sp;
    };
    const flat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
    const plateMat = flat(PLATE);
    const gridMat = new THREE.MeshBasicMaterial({ color: GRID });
    track(plateMat, 1);
    track(gridMat, 1);
    const box = new THREE.Box3();
    const xs = info.dataset.categories.map((k) => k.x ?? 0);
    const x0 = xs[0]!;
    const xN = xs[info.n - 1]!;
    const toScene = (x: number) => (xN === x0 ? 0 : -W / 2 + W * 0.05 + ((x - x0) / (xN - x0)) * W * 0.9);
    const gap = info.time ? Math.min(W / info.n, timeGap(xs, toScene)) : W / info.n;
    const frame: Frame = {
      ctx: c,
      info,
      group,
      W,
      H,
      D,
      gap,
      catX: (st, k) => (info.time ? toScene(xs[k]!) : -W / 2 + (st.slots[k]! + 0.5) * (W / info.n)),
      track,
    };
    const title = chart.title ?? info.dataset.title;
    const values = chart.values;
    const layers: ChartObj["layers"] = [];
    let centerY = H / 2;

    /** Plate, grid lines and y axis with tick labels on one side. */
    const axisFrame = (scale: Scale, side: -1 | 1, unit: string, grid: boolean) => {
      const x = side * (W / 2 + 0.45);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, 0.06).translate(0, H / 2, 0), gridMat);
      post.position.set(x, 0, -D / 2);
      group.add(post);
      const dec = tickDecimals(scale);
      for (const v of scale.ticks) {
        const y = ((v - scale.lo) / (scale.hi - scale.lo)) * H;
        if (grid) {
          const line = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.025, 0.025), gridMat);
          line.position.set(0, y, -D / 2);
          group.add(line);
        }
        addLabel(formatIt(v, dec), 0.5, [x + side * 0.15, y, -D / 2], [side < 0 ? 1 : 0, 0.5], { weight: 600 });
      }
      addLabel(unit, 0.48, [x, H + 0.95, -D / 2], [side < 0 ? 1 : 0, 0.5], { weight: 700, ink: "#5a6170" });
    };
    const plate = (w: number, d: number, round = false) => {
      const geo = round ? new THREE.CylinderGeometry(w / 2, w / 2, 0.12, 64) : new THREE.BoxGeometry(w, 0.12, d);
      const mesh = new THREE.Mesh(geo.translate(0, -0.06, 0), plateMat);
      mesh.name = `plate:${chart.id}`;
      group.add(mesh);
    };

    switch (chart.kind) {
      case "bars":
      case "line": {
        const stacked = chart.kind === "bars" && chart.layout === "stacked";
        const vals = stacked
          ? info.dataset.categories.map((_, k) => info.series.reduce((a, s) => a + (info.dataset.series.find((x) => x.id === s)!.values[k] ?? 0), 0))
          : allValues(info, info.single ? info.dataset.series.map((s) => s.id) : info.series);
        const scale = niceScale(Math.min(...vals), Math.max(...vals));
        plate(W + 1.6, D + 1);
        axisFrame(scale, -1, info.dataset.unit, true);
        const layer =
          chart.kind === "bars"
            ? barsLayer(frame, info.series, scale, { stacked, cylinder: chart.shape === "cylinder", values: values ?? true, labels: true })
            : lineLayer(frame, info.series, scale, { area: chart.area ?? false, values: values ?? false, labels: true });
        layers.push({ layer, series: info.series });
        box.set(new THREE.Vector3(-W / 2 - 2.2, -0.2, -D / 2 - 0.6), new THREE.Vector3(W / 2 + 0.9, H + 1.9, D / 2 + 1.2));
        break;
      }
      case "climograph": {
        const rainScale = niceScale(0, Math.max(...allValues(info, [chart.rain])));
        const tv = allValues(info, [chart.temp]);
        const tempScale = niceScale(Math.min(...tv), Math.max(...tv));
        const unit = (id: string) => info.dataset.series.find((s) => s.id === id)?.unit ?? info.dataset.unit;
        plate(W + 1.6, D + 1);
        axisFrame(rainScale, -1, unit(chart.rain), true);
        axisFrame(tempScale, 1, unit(chart.temp), false);
        layers.push({ layer: barsLayer(frame, [chart.rain], rainScale, { stacked: false, cylinder: false, values: values ?? false, labels: true }), series: [chart.rain] });
        layers.push({ layer: lineLayer(frame, [chart.temp], tempScale, { area: false, values: values ?? false, labels: false, z: D / 2 * 0.6 }), series: [chart.temp] });
        box.set(new THREE.Vector3(-W / 2 - 2.2, -0.2, -D / 2 - 0.6), new THREE.Vector3(W / 2 + 2.2, H + 1.9, D / 2 + 1.2));
        break;
      }
      case "pie": {
        const R = chart.radius ?? 4;
        const th = chart.thickness ?? 0.6;
        plate(2 * R + 1.8, 0, true);
        layers.push({ layer: pieLayer(frame, { radius: R, inner: chart.donut ?? 0, thickness: th, values: values ?? true }), series: info.series });
        centerY = th;
        box.set(new THREE.Vector3(-R - 2.4, -0.2, -R - 1.8), new THREE.Vector3(R + 2.4, th + 1.6, R + 2));
        break;
      }
      case "pictogram":
        plate(W + 1, D + 1);
        layers.push({
          layer: pictogramLayer(frame, { icon: chart.icon, per: chart.per, perRow: chart.perRow ?? 3, values: values ?? true }),
          series: info.series,
        });
        box.set(new THREE.Vector3(-W / 2 - 0.6, -0.2, -D / 2 - 0.6), new THREE.Vector3(W / 2 + 0.6, H + 1.9, D / 2 + 1.2));
        break;
      case "bubbles": {
        const maxR = chart.maxRadius ?? Math.min(2, (W / info.n) * 0.45);
        plate(W + 1, Math.max(D, 2 * maxR) + 1);
        layers.push({ layer: bubblesLayer(frame, { disc: chart.shape === "disc", maxRadius: maxR, values: values ?? true }), series: info.series });
        centerY = maxR;
        box.set(new THREE.Vector3(-W / 2 - 0.6, -0.2, -maxR - 0.6), new THREE.Vector3(W / 2 + 0.6, 2 * maxR + 1.6, maxR + 1.2));
        break;
      }
      case "flows": {
        const pts = chart.nodes.map((n) => n.pos);
        const lo = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))] as const;
        const hi = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] as const;
        const span = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
        layers.push({ layer: flowsLayer(frame, { nodes: chart.nodes, links: chart.links, maxWidth: chart.maxWidth ?? 0.6, values: values ?? true }), series: info.series });
        centerY = 0.5;
        box.set(new THREE.Vector3(lo[0] - 1.5, -0.2, lo[1] - 1.5), new THREE.Vector3(hi[0] + 1.5, Math.max(2, span * 0.4 + 1), hi[1] + 1.5));
        break;
      }
    }

    // Title and legend.
    const isPie = chart.kind === "pie";
    const R = isPie ? chart.radius ?? 4 : 0;
    const titleY = isPie || chart.kind === "flows" ? box.max.y + 0.4 : H + 1.45;
    addLabel(title, 0.7, [0, titleY, isPie ? -R - 1 : box.min.z + 0.6], [0.5, 0.5], { weight: 800 });
    const legends = new Map<string, THREE.Sprite | null>();
    if (info.single && info.dataset.series.length > 1) {
      for (const s of info.dataset.series) {
        const pos: [number, number, number] = isPie ? [0, titleY - 0.75, -R - 1] : [0, titleY - 0.65, box.min.z + 0.6];
        legends.set(s.id, addLabel(`Dati: ${s.label}`, 0.46, pos, [0.5, 0.5], { bg: "rgba(255,255,255,0.88)", weight: 700 }));
      }
    } else if (!info.single && info.series.length > 1) {
      info.series.forEach((s, i) => {
        const label = info.dataset.series.find((x) => x.id === s)!.label;
        const side = chart.kind === "climograph" ? W / 2 + 2.3 : W / 2 + 0.55;
        legends.set(s, addLabel(label, 0.46, [side, H - 0.3 - i * 0.62, -D / 2], [0, 0.5], { swatch: seriesColor(info, s), bg: "rgba(255,255,255,0.85)" }));
      });
      if (chart.kind !== "climograph") box.max.x += 3;
    }

    // Callouts (every annotate action on this chart, in any chapter) and the compare level line.
    const notes: ChartObj["notes"] = new Map();
    const leaderGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6).translate(0, 0.5, 0);
    for (const cc of spec!.engineData.chapters)
      for (const a of cc.actions)
        if (a.do === "annotate" && a.chart === chart.id) {
          const label = textSprite(c, a.text, 0.5, { bg: "rgba(255,248,225,0.96)", ink: "#4d3a00", center: [0.5, 0], weight: 700 });
          if (label) group.add(label);
          const leader = new THREE.Mesh(leaderGeo, new THREE.MeshBasicMaterial({ color: "#7a6a3a", transparent: true, depthWrite: false }));
          leader.name = `note:${chart.id}`;
          group.add(leader);
          notes.set(a, { label, leader });
        }
    const level = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: "#3a3a3a", transparent: true, depthWrite: false }));
    level.name = `level:${chart.id}`;
    group.add(level);

    return { info, group, W, H, D, layers, tracked, legends, notes, level, box, centerY, state: null };
  }

  /**
   * Height kept free above a mark for its value label: item anchors (pins) and callouts start
   * there, so they never cover the number.
   */
  const clearance = (o: ChartObj) => {
    const c = o.info.chart;
    if (c.kind === "line" || c.kind === "climograph") return 0.3;
    if (c.kind === "pie" || c.values === false) return 0.1;
    return 0.8;
  };

  /** Top of category k (optionally of one series) in chart-local coordinates. */
  function topOf(o: ChartObj, k: number, series: string | undefined, out: THREE.Vector3): boolean {
    if (!o.state) return false;
    const owner = series === undefined ? o.layers[0] : o.layers.find((l) => l.series.includes(series));
    if (!owner) return false;
    return owner.layer.top(o.state, k, series, out);
  }

  function cursorPoint(o: ChartObj, out: THREE.Vector3): boolean {
    const st = o.state;
    if (!st) return false;
    const head = o.layers.find((l) => l.layer.head);
    if (o.info.time && head?.layer.head!(out)) return true;
    if (st.focus >= 0 && topOf(o, st.focus, undefined, out)) return true;
    out.set(0, o.centerY, 0);
    return true;
  }

  function updateChart(o: ChartObj, chapterId: string, t: number) {
    const cc = plan!.chapters.get(chapterId)?.get(o.info.chart.id);
    if (!cc) {
      o.group.visible = false;
      o.state = null;
      return;
    }
    const cur = o.info.chart.cursor;
    const override = cur && overrides && cur.id in overrides ? overrides[cur.id] : undefined;
    const st = evalChart(o.info, cc, t, override);
    o.state = st;
    o.group.visible = st.presence > 0.001;
    for (const { m, base } of o.tracked) m.opacity = base * st.presence;
    for (const { layer } of o.layers) layer.update(st, t);
    for (const [id, sp] of o.legends) showLabel(sp, (o.info.single ? id === st.active : true) ? st.presence : 0);

    // Callouts.
    for (const [a, n] of o.notes) {
      const on = st.annotations.find((x) => x.action === a);
      const reached = !on || on.index < 0 || (st.grow[on.index] ?? 0) > 0;
      const k = on && reached ? on.k * st.presence : 0;
      n.leader.visible = k > 0.01;
      showLabel(n.label, k);
      if (k <= 0.01) continue;
      n.leader.material.opacity = 0.8 * k;
      const idx = on!.index;
      if (idx >= 0 && topOf(o, idx, a.series, tmp)) {
        tmp.y += clearance(o);
        const rise = 1.25;
        n.leader.position.copy(tmp);
        n.leader.scale.set(1, rise, 1);
        n.leader.quaternion.identity();
        n.label?.position.copy(tmp).add(tmp2.set(0, rise + 0.05, 0));
      } else {
        n.leader.visible = false;
        n.label?.position.set(0, o.H + 2.35, o.box.min.z + 0.6);
      }
    }

    // Compare: level line at the smaller of the two tops, from one to the other.
    const cmp = st.compare;
    o.level.visible = false;
    if (cmp && topOf(o, cmp.a, undefined, tmp) && topOf(o, cmp.b, undefined, tmp2) && o.info.chart.kind !== "pie") {
      const y = Math.min(tmp.y, tmp2.y);
      const xa = Math.min(tmp.x, tmp2.x) - 0.5;
      const xb = Math.max(tmp.x, tmp2.x) + 0.5;
      o.level.visible = cmp.k * st.presence > 0.01;
      o.level.position.set((xa + xb) / 2, y, 0.05 + Math.max(tmp.z, tmp2.z));
      o.level.scale.set(Math.max(xb - xa, 0.01), 1, 1);
      o.level.material.opacity = 0.85 * cmp.k * st.presence;
    }
  }

  function ensure(chapterId: string, t: number) {
    if (last.chapter !== chapterId || last.t !== t) {
      for (const o of charts.values()) updateChart(o, chapterId, t);
      last = { chapter: chapterId, t };
    }
  }

  const cursorCharts = (chapterId: string) =>
    [...(plan?.chapters.get(chapterId)?.keys() ?? [])].map((id) => charts.get(id)!).filter((o) => o?.info.chart.cursor);

  return {
    async build(c, sceneSpec) {
      if (sceneSpec.engine !== "chart") throw new Error(`chart engine got a "${sceneSpec.engine}" scene`);
      ctx = c;
      spec = sceneSpec;
      plan = compilePlan(sceneSpec);
      world = new THREE.Group();
      world.name = "chart";
      c.root.add(world);
      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(sceneSpec.engineData.background ?? PAPER);
      const key = new THREE.DirectionalLight(0xffffff, 0.95 * Math.PI);
      key.position.set(6, 14, 10);
      const rim = new THREE.DirectionalLight(0xffe8d0, 0.3 * Math.PI);
      rim.position.set(-10, 5, -8);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.8 * Math.PI), key, rim];
      for (const l of lights) c.scene.add(l);

      const all = new THREE.Box3();
      for (const info of plan.charts.values()) {
        const o = buildChart(c, info);
        charts.set(info.chart.id, o);
        all.union(o.box.clone().translate(o.group.position));
      }
      const sphere = all.getBoundingSphere(new THREE.Sphere());
      bound = { center: sphere.center, radius: Math.max(sphere.radius, 1) };
      last = { chapter: "", t: NaN };
    },

    update(chapterId, t) {
      last = { chapter: "", t: NaN };
      ensure(chapterId, t);
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor) || anchor.part === undefined) return false;
      const [chartId, series] = anchor.part.split(":");
      const o = charts.get(chartId ?? "");
      if (!o) return false;
      ensure(chapterId, t);
      let ok = false;
      switch (anchor.entity) {
        case "chart":
          out.set(0, o.centerY, 0);
          ok = true;
          break;
        case "item":
          // On a time axis, points not reached yet have no anchor (their pins hide).
          ok = anchor.index !== undefined && !(o.info.time && (o.state?.grow[anchor.index] ?? 0) <= 0) && topOf(o, anchor.index, series, out);
          if (ok) out.y += clearance(o);
          break;
        case "cursor":
          ok = cursorPoint(o, out);
          break;
      }
      if (!ok) return false;
      out.add(o.group.position);
      if (anchor.offset) out.add(tmp.set(...anchor.offset));
      return true;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    params(chapterId): EngineParam[] {
      const ids = spec?.chapters.find((c) => c.id === chapterId)?.activity?.test.params ?? [];
      const owners = cursorCharts(chapterId);
      return ids.flatMap((id) => {
        const o = owners.find((x) => x.info.chart.cursor!.id === id);
        if (!o) return [];
        const { cursorMin: min, cursorMax: max, time } = o.info;
        const cc = plan!.chapters.get(chapterId)!.get(o.info.chart.id)!;
        const t = last.chapter === chapterId ? last.t : 0;
        const live = overrides?.[id] ?? evalChart(o.info, cc, t).cursor ?? max;
        const step = time && max - min < 20 ? (max - min) / 100 : 1;
        return [{ id, label: o.info.chart.cursor!.label, min, max, step, value: clamp(live, min, max) }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
      } else {
        overrides = {};
        const all = [...charts.values()].filter((o) => o.info.chart.cursor);
        for (const [id, v] of Object.entries(values)) {
          const o = all.find((x) => x.info.chart.cursor!.id === id);
          if (o && Number.isFinite(v)) overrides[id] = clamp(v, o.info.cursorMin, o.info.cursorMax);
        }
      }
      last = { chapter: "", t: NaN };
    },

    dispose() {
      if (!ctx || !world) return;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      world.traverse((o) => {
        if (o instanceof THREE.Mesh) geos.add(o.geometry);
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite)
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
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
      spec = null;
      world = null;
      lights = [];
      plan = null;
      charts = new Map();
      overrides = null;
    },
  };
}
