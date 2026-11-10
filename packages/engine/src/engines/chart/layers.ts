// Mark layers of the chart engine, one per chart kind (bars, line, pie, pictogram, bubbles,
// flows; a climograph is a bars layer plus a line layer on two scales). Each layer builds its
// meshes once and poses them from a ChartState in update(): pure given (state, t).
import * as THREE from "three";
import { engineText } from "@pv/scene-spec/i18n";
import type { ChartIcon } from "@pv/scene-spec";
import type { EngineContext } from "../../types.ts";
import { clamp, ease } from "../../util/math.ts";
import { formatIt, formatValue, type Scale } from "./format.ts";
import { INK, showLabel, textSprite } from "./labels.ts";
import { flowCurve, ICON_ROW, iconGeometry, sectorGeometry, unitBox, unitCylinder } from "./marks.ts";
import { valuesOf, type ChartInfo, type ChartState } from "./plan.ts";

export const PALETTE = ["#3b6fb6", "#e07b39", "#4a9a5b", "#c94f6d", "#8a6bbf", "#d4a72c", "#2f9c9c", "#7d8a99"];
const GLOW = new THREE.Color("#fff3d6");
const VALUE_H = 0.56;
const CAT_H = 0.56;

/** What every layer gets from the engine. */
export interface Frame {
  ctx: EngineContext;
  info: ChartInfo;
  group: THREE.Group;
  W: number;
  H: number;
  D: number;
  /** x of category k's centre now (sort slots or time axis). */
  catX(st: ChartState, k: number): number;
  /** Width available per category. */
  gap: number;
  /** Materials of the layer register here (opacity follows presence). */
  track(m: THREE.Material, base?: number): void;
}

export interface Layer {
  update(st: ChartState, t: number): void;
  /** Top of category k's mark (series omitted = the whole category), chart-local. */
  top(st: ChartState, k: number, series: string | undefined, out: THREE.Vector3): boolean;
  /** Head of the drawing (line layers): cursor anchor. */
  head?(out: THREE.Vector3): boolean;
}

export const seriesColor = (info: ChartInfo, id: string) => {
  const i = info.dataset.series.findIndex((s) => s.id === id);
  return info.dataset.series[i]?.color ?? PALETTE[i % PALETTE.length]!;
};
const catColor = (info: ChartInfo, k: number) => info.dataset.categories[k]?.color ?? PALETTE[k % PALETTE.length]!;
const unitOf = (info: ChartInfo, id: string) => info.dataset.series.find((s) => s.id === id)?.unit ?? info.dataset.unit;
const decimals = (info: ChartInfo, s?: string) => info.dataset.series.find((x) => x.id === s)?.decimals ?? info.dataset.decimals ?? 0;

/** Standard material for a data mark. */
function markMat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, transparent: true });
}

/** Opacity/glow/ink-key of a data mark from highlight state. */
function styleMark(o: THREE.Object3D, m: THREE.MeshStandardMaterial, presence: number, hi: number, dim: number) {
  const fade = 1 - 0.68 * dim * (1 - hi);
  m.opacity = presence * fade;
  m.depthWrite = m.opacity > 0.98;
  m.emissive.copy(GLOW).multiplyScalar(0.22 * hi);
  o.userData.key = dim < 0.05 || hi > 0.5;
}

const markHi = (st: ChartState, k: number, s: string) => Math.max(st.hiCat[k] ?? 0, st.hiSeries.get(s) ?? 0);

/** Value labels per (series, category): `possible` series are the ones that can be shown. */
function valueLabels(f: Frame, possible: string[], text: (s: string, k: number, v: number) => string, center: [number, number] = [0.5, 0]) {
  const map = new Map<string, THREE.Sprite | null>();
  for (const s of possible) {
    const vals = f.info.dataset.series.find((x) => x.id === s)?.values ?? [];
    vals.forEach((v, k) => {
      if (v === null) return;
      const sp = textSprite(f.ctx, text(s, k, v), VALUE_H, { center, weight: 800 });
      if (sp) f.group.add(sp);
      map.set(`${s}|${k}`, sp);
    });
  }
  return map;
}

/** Category labels in front of the axis; on dense time axes only every few are kept. */
function categoryLabels(f: Frame): (THREE.Sprite | null)[] {
  const n = f.info.n;
  const every = f.info.time ? Math.max(1, Math.ceil(n / 8)) : 1;
  return f.info.dataset.categories.map((c, k) => {
    if (k % every !== 0 && k !== n - 1) return null;
    const sp = textSprite(f.ctx, c.label, CAT_H, { center: [0.5, 1], weight: 600 });
    if (sp) f.group.add(sp);
    return sp;
  });
}

/** Single-series charts may switch to any dataset series; multi-series ones draw a fixed set. */
const possibleSeries = (info: ChartInfo, series: string[]) => (info.single ? info.dataset.series.map((s) => s.id) : series);

// ---------------------------------------------------------------- bars

export function barsLayer(f: Frame, series: string[], scale: Scale, opts: { stacked: boolean; cylinder: boolean; values: boolean; labels: boolean }): Layer {
  const { info } = f;
  const m = opts.stacked ? 1 : series.length;
  const bw = (f.gap * (opts.stacked ? 0.6 : 0.74)) / m;
  const depth = Math.min(f.D * 0.7, Math.max(bw, f.gap * 0.5));
  const geo = opts.cylinder ? unitCylinder() : unitBox();
  const yOf = (v: number) => ((v - scale.lo) / (scale.hi - scale.lo)) * f.H;
  const bars = series.map((s) =>
    info.dataset.categories.map((_, k) => {
      const mat = markMat(series.length === 1 && info.dataset.categories[k]!.color ? catColor(info, k) : seriesColor(info, s));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `bar:${info.chart.id}:${s}:${k}`;
      f.group.add(mesh);
      return { mesh, mat };
    }),
  );
  const shownSeries = (st: ChartState, j: number) => (info.single ? st.active : series[j]!);
  const labels = opts.values
    ? valueLabels(f, possibleSeries(info, series), (s, _k, v) => formatValue(v, unitOf(info, s), decimals(info, s)))
    : new Map<string, THREE.Sprite | null>();
  const cats = opts.labels ? categoryLabels(f) : [];
  /** Per category: [base, top] of each series bar, recomputed in update. */
  const spans = info.dataset.categories.map(() => series.map(() => [0, 0] as [number, number]));
  const xs = new Array<number>(info.n).fill(0);

  return {
    update(st) {
      for (let k = 0; k < info.n; k++) {
        const x = f.catX(st, k);
        xs[k] = x;
        let base = 0;
        series.forEach((s, j) => {
          const v = (info.single ? st.values.get(series[0]!)! : st.values.get(s)!)[k] ?? 0;
          const h = Math.max(0, yOf(v) - yOf(0)) * st.grow[k]!;
          const { mesh, mat } = bars[j]![k]!;
          const y0 = opts.stacked ? base : yOf(0);
          mesh.visible = st.presence > 0.001 && h > 1e-4;
          mesh.position.set(opts.stacked ? x : x + (j - (m - 1) / 2) * bw, y0, 0);
          mesh.scale.set(bw * 0.92, Math.max(h, 1e-4), depth);
          styleMark(mesh, mat, st.presence, markHi(st, k, s), st.dim);
          spans[k]![j] = [y0, y0 + h];
          if (opts.stacked) base += h;
        });
        series.forEach((s0, j) => {
          const want = shownSeries(st, j);
          for (const s of possibleSeries(info, [s0])) {
            const sp = labels.get(`${s}|${k}`);
            if (!sp) continue;
            const on = s === want && st.grow[k]! > 0.97;
            const hi = markHi(st, k, s);
            showLabel(sp, on ? st.presence * (1 - 0.75 * st.dim * (1 - hi)) : 0);
            const top = spans[k]![j]!;
            sp.position.set(opts.stacked ? x : x + (j - (m - 1) / 2) * bw, opts.stacked ? (top[0] + top[1]) / 2 : top[1] + 0.12, opts.stacked ? depth / 2 + 0.05 : 0);
            sp.center.set(0.5, opts.stacked ? 0.5 : 0);
          }
        });
        const cl = cats[k];
        if (cl) {
          cl.position.set(x, -0.08, f.D / 2 + 0.25);
          showLabel(cl, st.presence * (info.time && st.grow[k]! <= 0 ? 0.25 : 1));
        }
      }
    },
    top(st, k, s, out) {
      if (k < 0 || k >= info.n) return false;
      const j = s === undefined ? -1 : series.indexOf(s);
      if (s !== undefined && j < 0) return false;
      const sp = spans[k]!;
      if (j >= 0) out.set(opts.stacked ? xs[k]! : xs[k]! + (j - (m - 1) / 2) * bw, sp[j]![1], 0);
      else out.set(xs[k]!, Math.max(...sp.map((x) => x[1])), 0);
      return true;
    },
  };
}

// ---------------------------------------------------------------- line

export function lineLayer(f: Frame, series: string[], scale: Scale, opts: { area: boolean; values: boolean; labels: boolean; z?: number }): Layer {
  const { info } = f;
  const n = info.n;
  const z = opts.z ?? 0;
  const yOf = (v: number) => ((v - scale.lo) / (scale.hi - scale.lo)) * f.H;
  const xs = info.dataset.categories.map((c) => c.x ?? 0);
  const segGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 10).translate(0, 0.5, 0);
  const dotGeo = new THREE.SphereGeometry(0.16, 16, 12);
  const UP = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const lines = series.map((s) => {
    const color = seriesColor(info, s);
    const mat = markMat(color);
    const dotMat = markMat(color);
    const segs = Array.from({ length: Math.max(0, n - 1) }, (_, k) => {
      const mesh = new THREE.Mesh(segGeo, mat);
      mesh.name = `line:${info.chart.id}:${s}:${k}`;
      f.group.add(mesh);
      return mesh;
    });
    const dots = Array.from({ length: n }, (_, k) => {
      const mesh = new THREE.Mesh(dotGeo, dotMat);
      mesh.name = `point:${info.chart.id}:${s}:${k}`;
      f.group.add(mesh);
      return mesh;
    });
    let area: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
    if (opts.area) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      const idx: number[] = [];
      for (let k = 0; k < n - 1; k++) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
      g.setIndex(idx);
      area = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      area.name = `area:${info.chart.id}:${s}`;
      area.frustumCulled = false;
      f.group.add(area);
    }
    return { s, mat, dotMat, segs, dots, area, pts: Array.from({ length: n }, () => new THREE.Vector3()), head: new THREE.Vector3() };
  });
  // Cursor: vertical line + read-out pill per (series, category).
  const cursorMat = new THREE.MeshBasicMaterial({ color: "#5a5a5a", transparent: true, opacity: 0.5, depthWrite: false });
  const cursorBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04).translate(0, 0.5, 0), cursorMat);
  cursorBar.name = `cursor:${info.chart.id}`;
  f.group.add(cursorBar);
  const readouts = new Map<string, THREE.Sprite | null>();
  for (const s of possibleSeries(info, series).slice(0, info.single ? undefined : 1)) {
    info.dataset.series.find((x) => x.id === s)?.values.forEach((v, k) => {
      if (v === null) return;
      const text = `${info.dataset.categories[k]!.label}: ${formatValue(v, unitOf(info, s), decimals(info, s))}`;
      // Below the point: pins sit above it.
      const sp = textSprite(f.ctx, text, 0.6, { bg: "rgba(255,255,255,0.94)", ink: INK, center: [0.5, 1], weight: 800 });
      if (sp) f.group.add(sp);
      readouts.set(`${s}|${k}`, sp);
    });
  }
  const labels = opts.values
    ? valueLabels(f, possibleSeries(info, series), (s, _k, v) => formatValue(v, unitOf(info, s), decimals(info, s)))
    : new Map<string, THREE.Sprite | null>();
  const cats = opts.labels ? categoryLabels(f) : [];
  let headOk = false;

  return {
    update(st) {
      const p = st.presence;
      headOk = false;
      for (const L of lines) {
        const vals = info.single ? st.values.get(series[0]!)! : st.values.get(L.s)!;
        for (let k = 0; k < n; k++) L.pts[k]!.set(f.catX(st, k), yOf(vals[k] ?? 0), z);
        /** Fraction of segment k drawn. */
        const drawn = (k: number) =>
          info.time ? (st.reach === Infinity ? 1 : clamp((st.reach - xs[k]!) / (xs[k + 1]! - xs[k]!))) : st.grow[k + 1]!;
        const hiS = st.hiSeries.get(L.s) ?? 0;
        let head = -1;
        for (let k = 0; k < n; k++) {
          const dot = L.dots[k]!;
          const on = st.grow[k]! > 0 && info.dataset.series.find((x) => x.id === L.s)?.values[k] !== null;
          dot.visible = p > 0.001 && on;
          dot.position.copy(L.pts[k]!);
          const hi = Math.max(st.hiCat[k] ?? 0, hiS, k === st.focus ? 1 : 0);
          dot.scale.setScalar((on ? ease.inOutQuad(Math.min(1, st.grow[k]!)) : 0) * (1 + 0.5 * hi) + 1e-4);
          if (on) head = k;
        }
        // Lines dim only when another series is highlighted; category highlights enlarge the points.
        const sDim = Math.max(0, ...st.hiSeries.values());
        styleMark(L.dots[0]!, L.dotMat, p, hiS, sDim);
        for (const d of L.dots) d.userData.key = L.dots[0]!.userData.key;
        L.head.copy(L.pts[Math.max(0, head)]!);
        for (let k = 0; k < n - 1; k++) {
          const seg = L.segs[k]!;
          const fr = drawn(k);
          seg.visible = p > 0.001 && fr > 0;
          if (!seg.visible) continue;
          const a = L.pts[k]!;
          const b = tmp.lerpVectors(a, L.pts[k + 1]!, fr);
          seg.position.copy(a);
          const len = a.distanceTo(b);
          seg.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
          seg.scale.set(1, Math.max(len, 1e-4), 1);
          if (fr > 0) L.head.copy(b);
        }
        styleMark(L.dots[0]!, L.mat, p, hiS, sDim);
        for (const s of L.segs) s.userData.key = L.dots[0]!.userData.key;
        if (L.area) {
          const pos = L.area.geometry.getAttribute("position") as THREE.BufferAttribute;
          for (let k = 0; k < n; k++) {
            // Points beyond the drawn head collapse onto it.
            const reached = k === 0 || drawn(k - 1) >= 1;
            const q = reached ? L.pts[k]! : L.head;
            pos.setXYZ(2 * k, q.x, yOf(Math.max(scale.lo, 0)), z);
            pos.setXYZ(2 * k + 1, q.x, q.y, z);
          }
          pos.needsUpdate = true;
          L.area.geometry.computeBoundingSphere();
          L.area.visible = p > 0.001;
          L.area.material.opacity = 0.25 * p;
        }
        if (L === lines[0]) headOk = head >= 0;
      }
      // Cursor line and read-out on the first series.
      const L0 = lines[0]!;
      const showCursor = st.cursor !== null && st.focus >= 0;
      cursorBar.visible = p > 0.001 && showCursor && info.time;
      if (cursorBar.visible) {
        cursorBar.position.set(L0.head.x, 0, z - 0.02);
        cursorBar.scale.set(1, Math.max(L0.head.y, 1e-3), 1);
        cursorMat.opacity = 0.45 * p;
      }
      const rs = info.single ? st.active : series[0]!;
      for (const [key, sp] of readouts) {
        if (!sp) continue;
        const [s, ks] = key.split("|");
        const k = Number(ks);
        const on = showCursor && s === rs && k === st.focus;
        showLabel(sp, on ? p : 0);
        if (on) sp.position.copy(L0.pts[k]!).add(tmp.set(0, -0.35, 0.1));
      }
      for (const [key, sp] of labels) {
        if (!sp) continue;
        const [s, ks] = key.split("|");
        const k = Number(ks);
        const li = lines.find((l) => l.s === (info.single ? series[0] : s));
        const on = (info.single ? s === st.active : true) && st.grow[k]! > 0.97 && !(showCursor && k === st.focus);
        showLabel(sp, on ? p * (1 - 0.7 * st.dim * (1 - (st.hiCat[k] ?? 0))) : 0);
        if (li) sp.position.copy(li.pts[k]!).add(tmp.set(0, 0.25, 0));
      }
      cats.forEach((cl, k) => {
        if (!cl) return;
        cl.position.set(f.catX(st, k), -0.08, f.D / 2 + 0.25);
        showLabel(cl, p * (st.grow[k]! > 0 ? 1 : 0.3));
      });
    },
    top(_st, k, s, out) {
      const L = s === undefined ? lines[0] : lines.find((l) => l.s === s);
      if (!L || k < 0 || k >= n) return false;
      out.copy(L.pts[k]!);
      return true;
    },
    head(out) {
      out.copy(lines[0]!.head);
      return headOk;
    },
  };
}

// ---------------------------------------------------------------- pie / donut

export function pieLayer(f: Frame, opts: { radius: number; inner: number; thickness: number; values: boolean }): Layer {
  const { info } = f;
  const n = info.n;
  const R = opts.radius;
  const slices = info.dataset.categories.map((_, k) => {
    const mat = markMat(catColor(info, k));
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(new THREE.BufferGeometry(), mat);
    mesh.name = `slice:${info.chart.id}:${k}`;
    f.group.add(mesh);
    return { mesh, mat, key: "", mid: 0, lift: new THREE.Vector3() };
  });
  const unit = (s: string) => unitOf(info, s);
  const labels = opts.values
    ? valueLabels(f, possibleSeries(info, info.series), (s, k, v) => `${info.dataset.categories[k]!.label} ${formatValue(v, unit(s), decimals(info, s))}`, [0.5, 0.5])
    : new Map<string, THREE.Sprite | null>();
  const dir = (a: number, out: THREE.Vector3) => out.set(Math.sin(a), 0, -Math.cos(a));

  return {
    update(st) {
      const vals = st.values.get(info.series[0]!)!;
      const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      const order = vals.map((_, k) => k).sort((a, b) => st.slots[a]! - st.slots[b]! || a - b);
      let start = 0;
      for (const k of order) {
        const s = slices[k]!;
        const len = ((Math.max(0, vals[k]!) / total) * Math.PI * 2) * st.grow[k]!;
        const key = `${start.toFixed(4)}|${len.toFixed(4)}`;
        if (key !== s.key) {
          s.mesh.geometry.dispose();
          s.mesh.geometry = len > 1e-4 ? sectorGeometry(start, len, R, R * opts.inner, opts.thickness) : new THREE.BufferGeometry();
          s.key = key;
        }
        s.mid = start + len / 2;
        start += len;
        const hi = st.hiCat[k] ?? 0;
        dir(s.mid, s.lift).multiplyScalar(0.55 * hi * (R / 4));
        s.lift.y = 0.18 * hi;
        s.mesh.position.copy(s.lift);
        s.mesh.visible = st.presence > 0.001 && len > 1e-4;
        styleMark(s.mesh, s.mat, st.presence, hi, st.dim);
      }
      for (const [key, sp] of labels) {
        if (!sp) continue;
        const [sid, ks] = key.split("|");
        const k = Number(ks);
        const s = slices[k]!;
        const on = sid === st.active && st.grow[k]! > 0.97;
        showLabel(sp, on ? st.presence * (1 - 0.6 * st.dim * (1 - (st.hiCat[k] ?? 0))) : 0);
        dir(s.mid, sp.position).multiplyScalar(R + 0.75).add(s.lift);
        sp.position.y += opts.thickness + 0.35;
      }
    },
    top(_st, k, _s, out) {
      if (k < 0 || k >= n) return false;
      const s = slices[k]!;
      dir(s.mid, out).multiplyScalar(R * (opts.inner > 0 ? (1 + opts.inner) / 2 : 0.62)).add(s.lift);
      out.y += opts.thickness;
      return true;
    },
  };
}

// ---------------------------------------------------------------- pictogram


export function pictogramLayer(f: Frame, opts: { icon: ChartIcon; per: number; perRow: number; values: boolean }): Layer {
  const { info } = f;
  const geo = iconGeometry(opts.icon);
  const size = Math.min(1.1, (f.gap * 0.86) / opts.perRow);
  const row = ICON_ROW[opts.icon] * size;
  const maxCount = Math.max(1, ...info.dataset.series.flatMap((s) => s.values.map((v) => Math.round((v ?? 0) / opts.per))));
  const mtx = new THREE.Matrix4();
  const stacks = info.dataset.categories.map((_, k) => {
    const mat = markMat(catColor(info, k));
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.name = `icons:${info.chart.id}:${k}`;
    mesh.frustumCulled = false;
    f.group.add(mesh);
    return { mesh, mat, height: 0 };
  });
  const labels = opts.values
    ? valueLabels(f, possibleSeries(info, info.series), (s, _k, v) => formatValue(v, unitOf(info, s), decimals(info, s)))
    : new Map<string, THREE.Sprite | null>();
  const cats = categoryLabels(f);
  const legend = textSprite(f.ctx, `1 ${engineText(`chart.icon.${opts.icon}`)} = ${formatIt(opts.per)} ${info.dataset.unit}`, 0.5, { center: [1, 0.5], bg: "rgba(255,255,255,0.85)" });
  if (legend) {
    legend.position.set(f.W / 2, f.H + 0.7, -f.D / 2);
    f.group.add(legend);
  }
  const xs = new Array<number>(info.n).fill(0);

  return {
    update(st) {
      const vals = st.values.get(info.series[0]!)!;
      stacks.forEach((s, k) => {
        const x = f.catX(st, k);
        xs[k] = x;
        const count = Math.round((vals[k] ?? 0) / opts.per);
        const shown = count * st.grow[k]!;
        for (let i = 0; i < maxCount; i++) {
          const pop = clamp(shown - i);
          if (i >= count || pop <= 0) mtx.makeScale(0, 0, 0);
          else {
            const col = i % opts.perRow;
            const r = Math.floor(i / opts.perRow);
            const sc = size * ease.inOutQuad(pop);
            mtx.makeScale(sc, sc, sc).setPosition(x + (col - (opts.perRow - 1) / 2) * size, r * row + (1 - pop) * 0.6, 0);
          }
          s.mesh.setMatrixAt(i, mtx);
        }
        s.mesh.instanceMatrix.needsUpdate = true;
        s.mesh.visible = st.presence > 0.001;
        s.height = Math.ceil(Math.min(shown, count) / opts.perRow) * row;
        styleMark(s.mesh, s.mat, st.presence, st.hiCat[k] ?? 0, st.dim);
        const cl = cats[k];
        if (cl) {
          cl.position.set(x, -0.08, f.D / 2 + 0.25);
          showLabel(cl, st.presence);
        }
        for (const sid of possibleSeries(info, info.series)) {
          const sp = labels.get(`${sid}|${k}`);
          if (!sp) continue;
          showLabel(sp, sid === st.active && st.grow[k]! > 0.97 ? st.presence * (1 - 0.7 * st.dim * (1 - (st.hiCat[k] ?? 0))) : 0);
          sp.position.set(x, s.height + 0.15, 0);
        }
      });
      showLabel(legend, st.presence);
    },
    top(_st, k, _s, out) {
      if (k < 0 || k >= info.n) return false;
      out.set(xs[k]!, stacks[k]!.height, 0);
      return true;
    },
  };
}

// ---------------------------------------------------------------- bubbles

export function bubblesLayer(f: Frame, opts: { disc: boolean; maxRadius: number; values: boolean }): Layer {
  const { info } = f;
  const vmax = Math.max(1e-9, ...info.dataset.series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const geo = opts.disc ? new THREE.CylinderGeometry(1, 1, 0.25, 40).translate(0, 0.125, 0) : new THREE.SphereGeometry(1, 32, 20);
  const balls = info.dataset.categories.map((_, k) => {
    const mat = markMat(catColor(info, k));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `bubble:${info.chart.id}:${k}`;
    f.group.add(mesh);
    return { mesh, mat, r: 0 };
  });
  const labels = opts.values
    ? valueLabels(f, possibleSeries(info, info.series), (s, _k, v) => formatValue(v, unitOf(info, s), decimals(info, s)))
    : new Map<string, THREE.Sprite | null>();
  const cats = categoryLabels(f);
  const xs = new Array<number>(info.n).fill(0);
  const tops = new Array<number>(info.n).fill(0);

  return {
    update(st) {
      const vals = st.values.get(info.series[0]!)!;
      balls.forEach((b, k) => {
        const x = f.catX(st, k);
        xs[k] = x;
        const v = Math.max(0, vals[k] ?? 0) / vmax;
        b.r = opts.maxRadius * (opts.disc ? Math.sqrt(v) : Math.cbrt(v)) * st.grow[k]!;
        b.mesh.visible = st.presence > 0.001 && b.r > 1e-4;
        b.mesh.position.set(x, opts.disc ? 0 : b.r, 0);
        b.mesh.scale.set(Math.max(b.r, 1e-4), opts.disc ? 1 : Math.max(b.r, 1e-4), Math.max(b.r, 1e-4));
        tops[k] = opts.disc ? 0.25 : 2 * b.r;
        styleMark(b.mesh, b.mat, st.presence, st.hiCat[k] ?? 0, st.dim);
        const cl = cats[k];
        if (cl) {
          cl.position.set(x, -0.08, Math.max(f.D / 2, opts.maxRadius) + 0.25);
          showLabel(cl, st.presence);
        }
        for (const sid of possibleSeries(info, info.series)) {
          const sp = labels.get(`${sid}|${k}`);
          if (!sp) continue;
          showLabel(sp, sid === st.active && st.grow[k]! > 0.97 ? st.presence * (1 - 0.7 * st.dim * (1 - (st.hiCat[k] ?? 0))) : 0);
          sp.position.set(x, tops[k]! + 0.15, 0);
        }
      });
    },
    top(_st, k, _s, out) {
      if (k < 0 || k >= info.n) return false;
      out.set(xs[k]!, tops[k]!, 0);
      return true;
    },
  };
}

// ---------------------------------------------------------------- flows

export function flowsLayer(
  f: Frame,
  opts: { nodes: { id: string; label: string; pos: [number, number] }[]; links: { category: string; from: string; to: string }[]; maxWidth: number; values: boolean },
): Layer {
  const { info } = f;
  const node = new Map(opts.nodes.map((n) => [n.id, new THREE.Vector3(n.pos[0], 0, n.pos[1])]));
  const padGeo = new THREE.CylinderGeometry(0.45, 0.5, 0.25, 28).translate(0, 0.125, 0);
  const padMat = new THREE.MeshStandardMaterial({ color: "#d9d1c3", roughness: 0.7, transparent: true });
  f.track(padMat);
  for (const n of opts.nodes) {
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.name = `node:${info.chart.id}:${n.id}`;
    pad.position.copy(node.get(n.id)!);
    f.group.add(pad);
    const sp = textSprite(f.ctx, n.label, 0.55, { center: [0.5, 0], bg: "rgba(255,255,255,0.88)" });
    if (sp) {
      sp.position.copy(node.get(n.id)!).setY(0.45);
      f.group.add(sp);
      f.track(sp.material);
    }
  }
  const vmax = Math.max(1e-9, ...info.dataset.series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const dotGeo = new THREE.SphereGeometry(1, 10, 8);
  const coneGeo = new THREE.ConeGeometry(1, 2, 16).translate(0, 1, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const catIndex = new Map(info.dataset.categories.map((c, i) => [c.id, i]));
  const TUBULAR = 48;
  const links = opts.links.map((l) => {
    const k = catIndex.get(l.category)!;
    const curve = flowCurve(node.get(l.from)!, node.get(l.to)!);
    const mat = markMat(catColor(info, k));
    const tube = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(new THREE.BufferGeometry(), mat);
    tube.name = `flow:${info.chart.id}:${l.category}`;
    const arrow = new THREE.Mesh(coneGeo, mat);
    const dots = Array.from({ length: 5 }, () => new THREE.Mesh(dotGeo, mat));
    f.group.add(tube, arrow, ...dots);
    return { k, curve, mat, tube, arrow, dots, key: "", mid: curve.getPoint(0.5) };
  });
  const labels = opts.values
    ? valueLabels(f, possibleSeries(info, info.series), (s, _k, v) => formatValue(v, unitOf(info, s), decimals(info, s)))
    : new Map<string, THREE.Sprite | null>();
  const tmp = new THREE.Vector3();

  return {
    update(st, t) {
      const vals = st.values.get(info.series[0]!)!;
      for (const L of links) {
        const r = Math.max(0.04, (opts.maxWidth / 2) * (Math.max(0, vals[L.k] ?? 0) / vmax));
        const key = r.toFixed(3);
        if (key !== L.key) {
          L.tube.geometry.dispose();
          L.tube.geometry = new THREE.TubeGeometry(L.curve, TUBULAR, r, 12, false);
          L.key = key;
        }
        const g = st.grow[L.k]!;
        const on = st.presence > 0.001 && g > 0;
        L.tube.visible = on;
        L.tube.geometry.setDrawRange(0, Math.floor(g * TUBULAR) * 12 * 6);
        const end = L.curve.getPoint(Math.min(1, g * 0.97), tmp);
        L.arrow.visible = on && g > 0.05;
        L.arrow.position.copy(end);
        L.arrow.quaternion.setFromUnitVectors(UP, L.curve.getTangent(Math.min(1, g * 0.97)).normalize());
        L.arrow.scale.setScalar(r * 2.2);
        L.dots.forEach((d, i) => {
          const u = (t * 0.22 + i / L.dots.length) % 1;
          d.visible = on && g >= 1;
          L.curve.getPoint(u, d.position);
          d.scale.setScalar(Math.max(0.06, r * 0.7));
        });
        styleMark(L.tube, L.mat, st.presence, st.hiCat[L.k] ?? 0, st.dim);
        for (const o of [L.arrow, ...L.dots]) o.userData.key = L.tube.userData.key;
        for (const sid of possibleSeries(info, info.series)) {
          const sp = labels.get(`${sid}|${L.k}`);
          if (!sp) continue;
          showLabel(sp, sid === st.active && g > 0.97 ? st.presence : 0);
          sp.position.copy(L.mid).add(tmp.set(0, r + 0.2, 0));
        }
      }
    },
    top(_st, k, _s, out) {
      const L = links.find((l) => l.k === k);
      if (!L) return false;
      out.copy(L.mid);
      return true;
    },
  };
}

/** Values of every series a chart may draw (scales cover switches too). */
export function allValues(info: ChartInfo, ids: string[]): number[] {
  return ids.flatMap((s) => valuesOf(info, s));
}

/** Smallest gap between consecutive x on a time axis, in scene units. */
export function timeGap(xs: number[], toScene: (x: number) => number): number {
  let g = Infinity;
  for (let i = 1; i < xs.length; i++) g = Math.min(g, toScene(xs[i]!) - toScene(xs[i - 1]!));
  return g === Infinity ? 1 : g;
}

