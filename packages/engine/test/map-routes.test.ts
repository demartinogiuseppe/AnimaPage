// Routes, areas and focus-less (country-level) boundaries of the map engine, on the hand-written
// smoke scene _dev-routes.scene.json (Europe, assets built by server/src/geo).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkMapData, checkScene, SceneSpec } from "@pv/scene-spec";
import { createMapEngine, Projection, type MapEngine } from "../src/engines/map/index.ts";
import { routeState } from "../src/engines/map/routes.ts";

const PUBLIC = resolve(import.meta.dirname, "../../../fixtures/public");
const load = (name: string) => JSON.parse(readFileSync(resolve(PUBLIC, `scenes/${name}.scene.json`), "utf8"));
// Left out of the public copy (tools/publish/exclude.txt): the tests on it skip when it is absent.
const HAS_DEV_ROUTES = existsSync(resolve(PUBLIC, "scenes/_dev-routes.scene.json"));

async function buildEngine(): Promise<{ engine: MapEngine; root: THREE.Group; spec: SceneSpec }> {
  const spec = SceneSpec.parse(load("_dev-routes"));
  const root = new THREE.Group();
  const engine = createMapEngine();
  await engine.build(
    {
      root,
      scene: new THREE.Scene(),
      // Scene paths are "/geo/..." (web root); in Node they are relative to fixtures/public.
      loadAsset: async (path) => {
        const b = readFileSync(resolve(PUBLIC, path.replace(/^\//, "")));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    },
    spec,
  );
  return { engine, root, spec };
}

function snapshot(root: THREE.Object3D): string {
  const out: unknown[] = [];
  root.traverse((o) => {
    const row: unknown[] = [o.name, o.visible, ...o.position.toArray(), ...o.scale.toArray(), ...o.quaternion.toArray()];
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mat && !Array.isArray(mat)) row.push(mat.opacity);
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geo) row.push(geo.drawRange.count);
    const c = geo?.getAttribute("color");
    if (c && o.name === "terrain") {
      let sum = 0;
      const arr = c.array as Float32Array;
      for (let i = 0; i < arr.length; i++) sum += arr[i]! * ((i % 97) + 1);
      row.push(sum);
    }
    out.push(row);
  });
  return JSON.stringify(out);
}

describe.skipIf(!HAS_DEV_ROUTES)("_dev-routes.scene.json", () => {
  it("passes SceneSpec.parse, checkScene and checkMapData with zero issues", () => {
    const spec = SceneSpec.parse(load("_dev-routes"));
    if (spec.engine !== "map") throw new Error("not a map scene");
    expect(checkScene(spec)).toEqual([]);
    expect(checkMapData(spec.engineData, spec)).toEqual([]);
    expect(spec.engineData.routes.map((r) => r.id)).toEqual(["visigoti", "unni-gallia", "unni-italia", "vandali"]);
    // Only facts from the page.
    expect(spec.sources.filter((s) => s.kind !== "dataset").map((s) => s.id)).toEqual(["page"]);
  });

// Scene left out of the public copy (tools/publish/exclude.txt): this test skips when it is absent.
  it.skipIf(!existsSync(resolve(PUBLIC, "scenes/campania.scene.json")))("campania.scene.json still passes checkMapData (backwards compatible)", () => {
    const spec = SceneSpec.parse(load("campania"));
    if (spec.engine !== "map") throw new Error("not a map scene");
    expect(checkMapData(spec.engineData, spec)).toEqual([]);
    expect(spec.engineData.routes).toEqual([]);
    expect(spec.engineData.areas).toEqual([]);
  });

  it("checkMapData reports bad routes", () => {
    const raw = load("_dev-routes");
    raw.engineData.routes[0].show.push({ chapter: "nope" });
    raw.engineData.routes[0].path.push([120, 10]);
    raw.engineData.routes[1].dates = "451 d.C.";
    raw.engineData.routes[1].sourceIds = [];
    raw.chapters[0].pins[0].anchor.part = "ghost";
    const spec = SceneSpec.parse(raw);
    if (spec.engine !== "map") throw new Error("not a map scene");
    const msgs = checkMapData(spec.engineData, spec).map((i) => i.message);
    expect(msgs).toContain('unknown chapter "nope"');
    expect(msgs).toContain("point outside the map area");
    expect(msgs).toContain("dated route without source");
    expect(msgs).toContain('anchor on unknown route "ghost"');
  });
});

describe("routeState", () => {
  const route = { show: [{ chapter: "a", from: 2, draw: 4 }, { chapter: "b", from: 1, to: 5, draw: 0 }] };
  it("draws from `from` over `draw` seconds, only in its chapters", () => {
    expect(routeState(route, "a", 1)).toEqual({ level: 0, progress: 0 });
    expect(routeState(route, "a", 4)).toEqual({ level: 1, progress: 0.5 });
    expect(routeState(route, "a", 99)).toEqual({ level: 1, progress: 1 });
    expect(routeState(route, "zzz", 3)).toBeNull();
  });
  it("draw 0 = complete at once, with fades in and out", () => {
    expect(routeState(route, "b", 1.3)!.progress).toBe(1);
    expect(routeState(route, "b", 1.3)!.level).toBeCloseTo(0.5, 5);
    expect(routeState(route, "b", 3)!.level).toBe(1);
    expect(routeState(route, "b", 5)!.level).toBe(0);
  });
});

describe.skipIf(!HAS_DEV_ROUTES)("map engine: routes, areas, country borders", () => {
  it("builds the Europe scene in Node: relief everywhere, faint borders, no focus outline", async () => {
    const { root } = await buildEngine();
    expect(root.getObjectByName("terrain")).toBeDefined();
    expect(root.getObjectByName("border")).toBeDefined();
    expect(root.getObjectByName("outline")).toBeUndefined();
    expect(root.getObjectByName("route:visigoti")).toBeDefined();
    expect(root.getObjectByName("route-head:vandali")).toBeDefined();
    expect(root.getObjectByName("river:danube")).toBeDefined();
    expect(root.getObjectByName("area:italia-sett")).toBeDefined();
  });

  it("update(chapter, t) is a pure function of its arguments", async () => {
    const { engine, root } = await buildEngine();
    const cases: [string, number, number][] = [
      ["visigoti", 6, 12],
      ["unni", 8, 15],
      ["unni", 13, 20.8],
      ["vandali", 3, 9],
      ["riepilogo", 0.2, 5],
    ];
    for (const [ch, t1, t2] of cases) {
      engine.update(ch, t1);
      const a = snapshot(root);
      engine.update(ch, t2);
      expect(snapshot(root)).not.toBe(a);
      engine.update("visigoti", 0);
      engine.update(ch, t1);
      expect(snapshot(root)).toBe(a);
    }
  });

  it("is deterministic across engine instances", async () => {
    const a = await buildEngine();
    const b = await buildEngine();
    a.engine.update("vandali", 6.3);
    b.engine.update("vandali", 6.3);
    expect(snapshot(a.root)).toBe(snapshot(b.root));
  });

  it("reveals the shaft progressively and grows the head", async () => {
    const { engine, root } = await buildEngine();
    const shaft = root.getObjectByName("route:vandali") as THREE.Mesh;
    const head = root.getObjectByName("route-head:vandali") as THREE.Mesh;
    const group = shaft.parent!;
    engine.update("vandali", 0.5);
    expect(group.visible).toBe(false);
    engine.update("vandali", 1.2);
    const early = shaft.geometry.drawRange.count;
    const headEarly = head.scale.x;
    engine.update("vandali", 5);
    const mid = shaft.geometry.drawRange.count;
    engine.update("vandali", 12);
    const full = shaft.geometry.drawRange.count;
    expect(group.visible).toBe(true);
    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThan(full);
    expect(headEarly).toBeLessThan(1);
    expect(head.scale.x).toBe(1);
    // Other chapters: hidden.
    engine.update("unni", 10);
    expect(group.visible).toBe(false);
  });

  it("resolves { entity: 'route' } anchors to the arrow head, or to a path point with index", async () => {
    const { engine, spec } = await buildEngine();
    if (spec.engine !== "map") throw new Error("not a map scene");
    const d = spec.engineData;
    const proj = new Projection(d.area.bbox, d.area.widthUnits, d.terrain.verticalExaggeration);
    const route = d.routes.find((r) => r.id === "visigoti")!;
    const [sx, sy] = route.path[0]!, [ex, ey] = route.path[route.path.length - 1]!;
    const v = new THREE.Vector3();
    const anchor = { entity: "route", part: "visigoti" };
    expect(engine.resolveAnchor(anchor, "visigoti", 0, v)).toBe(true);
    expect(v.x).toBeCloseTo(proj.x(sx), 3);
    expect(v.z).toBeCloseTo(proj.z(sy), 3);
    const start = v.clone();
    expect(engine.resolveAnchor(anchor, "visigoti", 7, v)).toBe(true);
    const mid = v.clone();
    expect(engine.resolveAnchor(anchor, "visigoti", 13, v)).toBe(true);
    expect(v.x).toBeCloseTo(proj.x(ex), 3);
    expect(v.z).toBeCloseTo(proj.z(ey), 3);
    expect(mid.distanceTo(start)).toBeGreaterThan(0.5);
    expect(mid.distanceTo(v)).toBeGreaterThan(0.5);
    // Above the ground and the sea.
    expect(v.y).toBeGreaterThan(0);
    // path[index] is fixed in time.
    const a0 = new THREE.Vector3(), a1 = new THREE.Vector3();
    engine.resolveAnchor({ ...anchor, index: 0 }, "riepilogo", 0, a0);
    engine.resolveAnchor({ ...anchor, index: 0 }, "riepilogo", 9, a1);
    expect(a0.distanceTo(start)).toBeLessThan(1e-6);
    expect(a1.equals(a0)).toBe(true);
    // Not in this chapter / unknown route / bad index.
    expect(engine.resolveAnchor(anchor, "unni", 5, v)).toBe(false);
    expect(engine.resolveAnchor({ entity: "route", part: "nope" }, "visigoti", 5, v)).toBe(false);
    expect(engine.resolveAnchor({ ...anchor, index: 99 }, "visigoti", 5, v)).toBe(false);
  });

  it("lists the visible routes for a legend", async () => {
    const { engine } = await buildEngine();
    expect(engine.routesAt("visigoti", 1)).toEqual([]);
    expect(engine.routesAt("unni", 13).map((r) => [r.id, r.dates])).toEqual([
      ["unni-gallia", undefined],
      ["unni-italia", "452 d.C."],
    ]);
    expect(engine.routesAt("riepilogo", 5).map((r) => r.progress)).toEqual([1, 1, 1, 1]);
  });

  it("tints an area only inside its window, and only on land", async () => {
    const { engine, root } = await buildEngine();
    const terrain = root.getObjectByName("terrain") as THREE.Mesh;
    const colors = () => Array.from((terrain.geometry.getAttribute("color") as THREE.BufferAttribute).array as Float32Array);
    engine.update("unni", 10);
    const before = colors();
    engine.update("unni", 16);
    const during = colors();
    const changed = during.filter((c, i) => Math.abs(c - before[i]!) > 1e-6).length;
    expect(changed).toBeGreaterThan(30);
    expect(changed).toBeLessThan(before.length / 20);
    engine.update("unni", 10);
    expect(colors()).toEqual(before);
  });
});
