import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bodyDepth, buildingSize, FacadeBuilding, rotundaDims, SceneSpec } from "@pv/scene-spec";
import { GROUND_SLAB } from "../src/engines/facade/catalogue/basic.ts";
import { cofferDepths, DOME_SEAT, nicheLayout, rotundaFrame } from "../src/engines/facade/catalogue/rotunda.ts";
import { createFacadeEngine, PLAN_LIFT } from "../src/engines/facade/index.ts";
import { FACADE_LINE, FacadeInk } from "../src/engines/facade/ink.ts";
import { buildModel, SINK } from "../src/engines/facade/model.ts";
import { viewOf, type Eye, type FacadeFrame } from "../src/engines/facade/views.ts";
import { viewOffsetY } from "../src/player/camera.ts";
import type { EngineView } from "../src/types.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/_dev-facciata-2.scene.json", import.meta.url));
type Raw = Record<string, any>;
const raw = (): Raw => JSON.parse(readFileSync(scenePath, "utf8"));
const buildingRaw = (): Raw => structuredClone(raw().engineData.buildings.find((b: Raw) => b.id === "pantheon"));
const chapterRaw = (): Raw => raw().engineData.chapters.find((c: Raw) => c.chapter === "rotonda");
const model = (b: Raw = buildingRaw()) => buildModel(FacadeBuilding.parse(b), new FacadeInk());

/** The paper meshes under a part (the ones with a poché colour). */
const papers = (g: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && "uPoche" in ((o.material as THREE.ShaderMaterial).uniforms ?? {})) out.push(o);
  });
  return out;
};
const cast = (g: THREE.Object3D, from: THREE.Vector3, dir: THREE.Vector3) => {
  g.updateMatrixWorld(true);
  return new THREE.Raycaster(from, dir)
    .intersectObjects(papers(g), false)
    .map((h) => ({ back: h.face!.normal.dot(dir) > 0, point: h.point.clone(), distance: h.distance }));
};
/** Poché and nothing else: the first hit is a back face and no front face lies at the same distance. */
const pocheOnly = (what: string, h: Array<{ back: boolean; distance: number }>) => {
  expect(h.length, what).toBeGreaterThan(0);
  expect(h[0]!.back, what).toBe(true);
  expect(h.filter((x) => !x.back && Math.abs(x.distance - h[0]!.distance) < 1e-4), `${what}: coplanar front face`).toHaveLength(0);
};

const DOWN = new THREE.Vector3(0, -1, 0);

describe("rotunda of the dev scene", () => {
  const b = FacadeBuilding.parse(buildingRaw());
  const r = b.rotunda!;
  const m = model();
  const d = rotundaDims(r);
  const frame = rotundaFrame(r, bodyDepth(b));
  const wall = m.parts.get("rotunda")!;
  const dome = m.parts.get("dome")!;
  const planY = (chapterRaw().plan as number | undefined) ?? (b.base?.height ?? 0) + 1;

  it("the rotunda is hollow: a horizontal cut at plan height crosses the wall twice on each side", () => {
    // a chord at v = 8 m from the centre misses every niche (the nearest are at 45 and 90 degrees)
    const v = 8;
    const hits = cast(wall, new THREE.Vector3(100, planY, frame.zc + v), new THREE.Vector3(-1, 0, 0));
    const xs = hits.map((h) => h.point.x);
    expect(xs).toHaveLength(4);
    const inner = Math.sqrt(d.radius ** 2 - v ** 2);
    const outer = Math.sqrt(d.outer ** 2 - v ** 2);
    [outer, inner, -inner, -outer].forEach((x, i) => expect(xs[i]!, `hit ${i}`).toBeCloseTo(x, 1));
    // seen from the cut the wall is poché: a ray down from plan height inside it meets a back face first
    for (const rad of [d.radius + 0.5, (d.radius + d.outer) / 2, d.outer - 0.5]) {
      for (const a of [0.4, 1.2, 2.0, 3.6, 5.1]) {
        const p = new THREE.Vector3(rad * Math.sin(a), planY - 1e-3, frame.zc + rad * Math.cos(a));
        const fromWall = cast(wall, p, DOWN);
        pocheOnly(`wall at r ${rad.toFixed(1)}, a ${a}`, fromWall);
      }
    }
  });

  it("niches alternate and stay symmetric", () => {
    const list = nicheLayout(r);
    expect(list.filter((n) => n.kind !== "door")).toHaveLength(r.niches!);
    expect(list.filter((n) => n.kind === "door")).toHaveLength(1);
    expect(list.find((n) => n.kind === "door")!.angle).toBe(0);
    // alternate along the circle from the door: rectangular, semicircular, ... and the apse (opposite the door) is semicircular
    const ring = list.filter((n) => n.kind !== "door").sort((a, c) => a.angle - c.angle);
    ring.forEach((n, i) => expect(n.kind, `slot ${i + 1}`).toBe(Math.min(i + 1, ring.length - i) % 2 === 1 ? "rect" : "semi"));
    for (const n of ring) {
      const twin = ring.find((o) => Math.abs(o.angle + n.angle - 2 * Math.PI) < 1e-9 || Math.abs(o.angle + n.angle) < 1e-9);
      expect(twin, `mirror of ${n.angle}`).toBeDefined();
      expect(twin!.kind).toBe(n.kind);
    }
    // the same in the mesh: look down from plan height on a grid over the wall; the void cells (a front face first) form
    // one pocket per niche plus the door, and the picture is mirrored about x = 0
    const step = 0.5;
    const voids = new Set<string>();
    const inWall = (x: number, z: number) => {
      const rad = Math.hypot(x, z - frame.zc);
      return rad > d.radius + 0.4 && rad < d.outer - 0.4;
    };
    const key = (i: number, j: number) => `${i},${j}`;
    const n = Math.ceil(d.outer / step);
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const x = i * step;
        const z = frame.zc + j * step;
        if (!inWall(x, z)) continue;
        const h = cast(wall, new THREE.Vector3(x, planY - 1e-3, z), DOWN);
        if (h[0] && !h[0].back) voids.add(key(i, j));
      }
    for (const k of voids) {
      const [i, j] = k.split(",").map(Number) as [number, number];
      expect(voids.has(key(-i, j)), `mirror of ${k}`).toBe(true);
    }
    const seen = new Set<string>();
    let pockets = 0;
    for (const k of voids) {
      if (seen.has(k)) continue;
      pockets++;
      const todo = [k];
      seen.add(k);
      while (todo.length) {
        const [i, j] = todo.pop()!.split(",").map(Number) as [number, number];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const q = key(i + di!, j + dj!);
          if (voids.has(q) && !seen.has(q)) {
            seen.add(q);
            todo.push(q);
          }
        }
      }
    }
    expect(pockets).toBe(r.niches! + 1);
  });

  it("a [5, 28] coffered dome has 140 coffers", () => {
    // Rule: every coffer has exactly one floor patch (a quad, two triangles) at the deepest step, whose corners all lie on the
    // sphere of radius radius + cofferDepths()[1] about the springing centre; no other face has its three corners there.
    const g = dome.children.find((o) => o instanceof THREE.Mesh)!.parent!;
    const mesh = g.children.find((o) => o instanceof THREE.Mesh) as THREE.Mesh;
    const count = (radius: number, centre: THREE.Vector3): number => {
      const p = mesh.geometry.getAttribute("position");
      let tris = 0;
      for (let i = 0; i < p.count; i += 3) {
        const on = [0, 1, 2].every((k) => Math.abs(new THREE.Vector3().fromBufferAttribute(p, i + k).distanceTo(centre) - radius) < 1e-4);
        if (on) tris++;
      }
      return tris;
    };
    expect(r.dome.coffers).toEqual([5, 28]);
    expect(count(d.radius + cofferDepths(r)[1], frame.centre) / 2).toBe(140);
    const small = { ...buildingRaw(), rotunda: { ...buildingRaw().rotunda, dome: { type: "coffered", coffers: [3, 12], oculus: 4 } } };
    const sm = model(small);
    const sg = sm.parts.get("dome")!.children.find((o) => o instanceof THREE.Mesh) as THREE.Mesh;
    const sp = sg.geometry.getAttribute("position");
    const sf = rotundaFrame(FacadeBuilding.parse(small).rotunda!, bodyDepth(FacadeBuilding.parse(small)));
    let tris = 0;
    for (let i = 0; i < sp.count; i += 3) if ([0, 1, 2].every((k) => Math.abs(new THREE.Vector3().fromBufferAttribute(sp, i + k).distanceTo(sf.centre) - (d.radius + cofferDepths(FacadeBuilding.parse(small).rotunda!)[1])) < 1e-4)) tris++;
    expect(tris / 2).toBe(36);
  });

  it("the dome fits the budget: at most 40k triangles, three objects per part", () => {
    const tris = (g: THREE.Object3D) => papers(g).reduce((n, o) => n + o.geometry.getAttribute("position").count / 3, 0);
    expect(tris(dome)).toBeLessThanOrEqual(40000);
    expect(tris(wall)).toBeLessThanOrEqual(10000);
    for (const g of [wall, dome]) {
      let n = 0;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) n++;
      });
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it("wall and dome are closed solids: every edge is shared by two faces and the volume is positive", () => {
    for (const [name, g] of [["wall", wall], ["dome", dome]] as const) {
      const mesh = papers(g)[0]!;
      const p = mesh.geometry.getAttribute("position");
      const q = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e4));
      const edges = new Map<string, number>();
      let volume = 0;
      const [a, b2, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      let open = 0;
      for (let i = 0; i < p.count; i += 3) {
        volume += a.fromBufferAttribute(p, i).dot(b2.fromBufferAttribute(p, i + 1).cross(c.fromBufferAttribute(p, i + 2))) / 6;
        for (const [s, e] of [[0, 1], [1, 2], [2, 0]] as const) {
          const u = q(i + s!).join();
          const v = q(i + e!).join();
          if (u === v) continue;
          const k = u < v ? `${u}|${v}` : `${v}|${u}`;
          edges.set(k, (edges.get(k) ?? 0) + 1);
        }
      }
      for (const n of edges.values()) if (n !== 2) open++;
      expect(open, `${name}: edges not shared by exactly two faces`).toBe(0);
      expect(volume, `${name} volume`).toBeGreaterThan(0);
    }
  });

  it("the oculus is open: a vertical ray on the axis passes through the dome", () => {
    const from = new THREE.Vector3(0, 500, frame.zc);
    expect(cast(dome, from, DOWN)).toHaveLength(0);
    // a ray through the shell beside the oculus does hit it, and a closed dome blocks the axis
    expect(cast(dome, new THREE.Vector3(d.radius * 0.8, 500, frame.zc), DOWN).length).toBeGreaterThan(0);
    const closed = model({ ...buildingRaw(), rotunda: { ...buildingRaw().rotunda, dome: { type: "smooth" } } });
    expect(cast(closed.parts.get("dome")!, from, DOWN).length).toBeGreaterThan(0);
  });

  it("buildingSize includes the rotunda and the model agrees", () => {
    const size = buildingSize(b);
    expect(size.depth).toBeCloseTo(bodyDepth(b) + (r.gap ?? 0) + 2 * d.outer, 6);
    expect(m.size.depth).toBeCloseTo(size.depth, 6);
    expect(m.size.height).toBeCloseTo(size.height, 6);
    const box = new THREE.Box3().setFromObject(wall);
    // the front plane of the rotunda (the door chord; the cornice stands 2 cm in front of it) touches the back of the body plus gap
    expect(box.max.z).toBeCloseTo(-(bodyDepth(b) + (r.gap ?? 0)), 1);
    // buildingSize counts the outer diameter of the wall; only the cornice (2 % of the diameter) stands out of it
    expect(box.min.z).toBeGreaterThanOrEqual(-size.depth - 0.02 * r.diameter - 1e-6);
    expect(box.getSize(new THREE.Vector3()).x).toBeGreaterThan(2 * d.outer - 0.05);
  });
});

describe("pianta", () => {
  const f: FacadeFrame = { center: new THREE.Vector3(0, 5.5, -14), width: 14, height: 11, depth: 30, front: 1 };
  const eye: Eye = { height: 1.6, x: 0, distance: 17 };
  const cameraOf = (v: EngineView, aspect: number): THREE.PerspectiveCamera => {
    const cam = new THREE.PerspectiveCamera(v.fov, aspect, 0.1, 2000);
    cam.position.copy(v.position);
    cam.lookAt(v.target);
    const h = 1000;
    cam.setViewOffset(h * aspect, h, 0, viewOffsetY(0, h, v.shiftY), h * aspect, h);
    cam.updateMatrixWorld(true);
    return cam;
  };

  it("pianta looks straight down and fits the plan", () => {
    for (const aspect of [1.6, 0.5]) {
      const v = viewOf("pianta", f, eye, aspect, 0, 2);
      const dir = v.position.clone().sub(v.target).normalize();
      expect(dir.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);
      expect(v.fov).toBe(6);
      expect(v.shiftY).toBe(0);
      const cam = cameraOf(v, aspect);
      const corner = (sx: number, sz: number) => new THREE.Vector3((sx * f.width) / 2, 2, sz < 0 ? f.front - f.depth : f.front).project(cam);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const p = corner(sx, sz);
          expect(Math.abs(p.x), `x ${aspect}`).toBeLessThanOrEqual(1);
          expect(Math.abs(p.y), `y ${aspect}`).toBeLessThanOrEqual(1);
        }
      // the front of the building is at the bottom of the frame
      expect(corner(1, 1).y).toBeLessThan(corner(1, -1).y);
      // and it is the plan that fills the frame: the bound is 1.15 times the footprint, whichever side limits
      const wide = Math.abs(corner(1, 1).x - corner(-1, 1).x) / 2;
      const deep = Math.abs(corner(1, 1).y - corner(1, -1).y) / 2;
      expect(Math.max(wide, deep)).toBeGreaterThan(0.8);
    }
  });
});

describe("rotunda in the engine", () => {
  async function build() {
    const spec = SceneSpec.parse(raw());
    const engine = createFacadeEngine();
    const root = new THREE.Group();
    await engine.build({ root, scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("none")) }, spec);
    return { engine, root, spec };
  }
  const sectionOf = (root: THREE.Object3D): THREE.Vector4 => {
    let found: THREE.Vector4 | undefined;
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (!found && mat?.uniforms?.uSection) found = mat.uniforms.uSection.value as THREE.Vector4;
    });
    return found!;
  };

  it("pianta cuts at the chapter's plan height", async () => {
    const ch = chapterRaw();
    const planAt = (ch.views as Array<{ at: number; view: string }>).find((v) => v.view === "pianta")!.at;
    const b = FacadeBuilding.parse(buildingRaw());
    const planY = (ch.plan as number | undefined) ?? (b.base?.height ?? 0) + 1;
    const { engine, root } = await build();
    // Convention of FacadeInk.setSection: the plane's normal and constant in building-local metres (the shader works on the
    // baked position, so the engine scale does not enter); what is on its positive side is discarded, so y > planY goes.
    engine.update("rotonda", planAt + 4);
    const cut = sectionOf(root);
    expect([cut.x, cut.y, cut.z]).toEqual([0, 1, 0]);
    expect(cut.w).toBeCloseTo(-planY, 6);
    // before the plan view starts the section is off or vertical, never the plan plane; scrubbing back gives the same cut
    engine.update("rotonda", 0);
    expect(sectionOf(root).y).toBe(0);
    engine.update("rotonda", planAt + 4);
    expect(sectionOf(root).w).toBeCloseTo(-planY, 6);
  });

  it("the plan view of the engine looks straight down", async () => {
    const ch = chapterRaw();
    const planAt = (ch.views as Array<{ at: number; view: string }>).find((v) => v.view === "pianta")!.at;
    const { engine } = await build();
    const v = engine.view!("rotonda", planAt + 5, 1.6)!;
    const dir = v.position.clone().sub(v.target).normalize();
    expect(dir.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });

  it("dome and oculus anchors resolve", async () => {
    const { engine, spec } = await build();
    if (spec.engine !== "facade") throw new Error("unreachable");
    const out = new THREE.Vector3();
    const b = FacadeBuilding.parse(buildingRaw());
    const frame = rotundaFrame(b.rotunda!, bodyDepth(b));
    const at: Record<string, number> = {};
    for (const entity of ["rotunda", "dome", "oculus"] as const) {
      expect(engine.resolveAnchor({ entity } as never, "rotonda", 0, out), entity).toBe(true);
      expect(out.x).toBeCloseTo(0, 6);
      at[entity] = out.y;
      expect(Number.isFinite(out.z)).toBe(true);
    }
    expect(at.dome!).toBeGreaterThan(at.rotunda!);
    expect(at.oculus!).toBeCloseTo(at.dome!, 6);
    expect(frame.crown).toBeGreaterThan(frame.wallTop);
  });

  it("draw and highlight act on the rotunda and the dome parts", async () => {
    const { engine, root } = await build();
    const part = (name: string): THREE.Group => {
      let found: THREE.Group | undefined;
      root.traverse((o) => {
        if (!found && o instanceof THREE.Group && o.name === name) found = o;
      });
      return found!;
    };
    const meshes = (g: THREE.Group) => g.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    const lines = (g: THREE.Group) => g.children.filter((o): o is THREE.LineSegments => o instanceof THREE.LineSegments);
    const colour = (l: THREE.LineSegments): number => (l.material as THREE.ShaderMaterial).uniforms.uColor!.value.getHex();
    const red = (g: THREE.Group): boolean => lines(g).every((l) => colour(l) === FACADE_LINE.overlay);
    const plain = (g: THREE.Group): boolean => lines(g).every((l) => colour(l) === FACADE_LINE.ink);
    // draw "pantheon" 0..4 s: half way the lines are half traced and the paper is not there yet
    engine.update("rotonda", 2);
    for (const name of ["rotunda", "dome"]) {
      const g = part(name);
      expect(meshes(g).length, name).toBeGreaterThan(0);
      for (const m of meshes(g)) expect(m.visible, `${name} paper hidden`).toBe(false);
      for (const l of lines(g)) {
        const total = l.geometry.getAttribute("position").count;
        expect(l.geometry.drawRange.count, `${name} traced`).toBeLessThan(total);
        expect(l.geometry.drawRange.count).toBeGreaterThan(0);
      }
    }
    // at 3.5 s the paper fades in (last 30 % of the act): alpha (0.875 - 0.7) / 0.3
    engine.update("rotonda", 3.5);
    for (const m of meshes(part("dome"))) {
      expect(m.visible).toBe(true);
      expect((m.material as THREE.ShaderMaterial).uniforms.uAlpha!.value).toBeCloseTo(0.5833, 3);
    }
    // done at 4.5 s: full alpha, whole line set, ink colour
    engine.update("rotonda", 4.5);
    for (const name of ["rotunda", "dome"]) {
      for (const m of meshes(part(name))) expect((m.material as THREE.ShaderMaterial).uniforms.uAlpha!.value).toBe(1);
      for (const l of lines(part(name))) expect(l.geometry.drawRange.count).toBe(Infinity);
      expect(plain(part(name)), name).toBe(true);
    }
    // highlight dome 5..7 s, rotunda 14..16 s: only the named part turns red
    engine.update("rotonda", 6);
    expect(red(part("dome"))).toBe(true);
    expect(plain(part("rotunda"))).toBe(true);
    engine.update("rotonda", 8);
    expect(plain(part("dome"))).toBe(true);
    engine.update("rotonda", 15);
    expect(red(part("rotunda"))).toBe(true);
    expect(plain(part("dome"))).toBe(true);
    engine.update("rotonda", 17);
    expect(plain(part("rotunda"))).toBe(true);
  });

  it("the cut does not jump between the sezione and the pianta, and the lift fades in with the plan", async () => {
    const { engine, root } = await build();
    const box = new THREE.Box3().setFromObject(model().group);
    const pts: THREE.Vector3[] = [];
    const n = 24;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++)
        for (let k = 0; k <= n; k++) pts.push(new THREE.Vector3(box.min.x + ((box.max.x - box.min.x) * i) / n, box.min.y + ((box.max.y - box.min.y) * j) / n, box.min.z + ((box.max.z - box.min.z) * k) / n));
    const lift = (): number => {
      let found: number | undefined;
      root.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (found === undefined && mat?.uniforms?.uLift) found = mat.uniforms.uLift.value as number;
      });
      return found!;
    };
    // share of the building (in building-local metres) the cutting plane takes away at time t
    const taken = (t: number): number => {
      engine.update("rotonda", t);
      const c = sectionOf(root);
      return pts.filter((p) => c.x * p.x + c.y * p.y + c.z * p.z + c.w > 0).length / pts.length;
    };
    const views = chapterRaw().views as Array<{ at: number; view: string }>;
    const start = views.find((v) => v.view === "pianta")!.at;
    let before = taken(start - 0.5);
    let lastLift = lift();
    let biggest = 0;
    for (let t = start - 0.5; t <= start + 2.5; t += 0.02) {
      const now = taken(t);
      biggest = Math.max(biggest, Math.abs(now - before));
      before = now;
      expect(lift()).toBeGreaterThanOrEqual(lastLift - 1e-12);
      expect(lift()).toBeLessThanOrEqual(PLAN_LIFT + 1e-12);
      lastLift = lift();
    }
    // the plane glides: the eased blend moves it at most about 8 % of the building per 20 ms; the old switch of planes at the middle of the blend took about a quarter at once
    expect(biggest).toBeLessThan(0.12);
    expect(lift()).toBeCloseTo(PLAN_LIFT, 9);
    // and going back to the sezione the lift is off again
    expect(taken(start - 0.5)).toBeGreaterThan(0);
    expect(lift()).toBe(0);
  });

  it("the scale bar of the pianta has a label in the ink of the drawing", async () => {
    const { engine, root } = await build();
    const label = (): THREE.LineSegments => {
      let found: THREE.LineSegments | undefined;
      root.traverse((o) => {
        if (o.name === "overlay-plan-label") found = o as THREE.LineSegments;
      });
      return found!;
    };
    const start = (chapterRaw().views as Array<{ at: number; view: string }>).find((v) => v.view === "pianta")!.at;
    engine.update("rotonda", start + 4);
    const l = label();
    const pos = l.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.count).toBeGreaterThanOrEqual(8);
    expect(pos.count % 2).toBe(0);
    const material = l.material as THREE.LineBasicMaterial;
    expect(material.color.getHex()).toBe(FACADE_LINE.ink);
    expect(material.opacity).toBe(1);
    expect(l.visible).toBe(true);
    // the buffer is written once and kept: same attribute, same version
    const version = pos.version;
    engine.update("rotonda", start + 5);
    expect(label().geometry.getAttribute("position")).toBe(pos);
    expect(pos.version).toBe(version);
    engine.update("rotonda", 1);
    expect(label().visible).toBe(false);
  });
});

describe("plan view lifts the back faces", () => {
  it("the paper's lift is on in the pianta and off in the other views", async () => {
    const spec = SceneSpec.parse(raw());
    const engine = createFacadeEngine();
    const root = new THREE.Group();
    await engine.build({ root, scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("none")) }, spec);
    const lift = (): number => {
      let found: number | undefined;
      root.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (found === undefined && mat?.uniforms?.uLift) found = mat.uniforms.uLift.value as number;
      });
      return found!;
    };
    const ch = chapterRaw();
    const at = (view: string) => (ch.views as Array<{ at: number; view: string }>).find((v) => v.view === view)!.at + 4;
    engine.update("rotonda", at("pianta"));
    expect(lift()).toBeGreaterThan(0.05);
    engine.update("rotonda", at("sezione"));
    expect(lift()).toBe(0);
    engine.update("rotonda", 1);
    expect(lift()).toBe(0);
  });
});

describe("plan lift guard", () => {
  it("PLAN_LIFT stays above how far a wall sinks into its plinth and below the thinnest slab, with margin", () => {
    expect(PLAN_LIFT).toBeGreaterThan(SINK + 0.05);
    expect(PLAN_LIFT).toBeLessThan(GROUND_SLAB - 0.1);
  });
});

describe("rotunda variants are closed solids", () => {
  const mk = (rotunda: Raw) => model({ ...buildingRaw(), rotunda: { ...buildingRaw().rotunda, ...rotunda } });
  const edgesClosed = (g: THREE.Object3D): { open: number; volume: number } => {
    const p = papers(g)[0]!.geometry.getAttribute("position");
    const q = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e4)).join();
    const edges = new Map<string, number>();
    let volume = 0;
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < p.count; i += 3) {
      volume += a.fromBufferAttribute(p, i).dot(b.fromBufferAttribute(p, i + 1).cross(c.fromBufferAttribute(p, i + 2))) / 6;
      for (const [s, e] of [[0, 1], [1, 2], [2, 0]] as const) {
        const u = q(i + s!);
        const v = q(i + e!);
        if (u === v) continue;
        const k = u < v ? `${u}|${v}` : `${v}|${u}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
    return { open: [...edges.values()].filter((n) => n !== 2).length, volume };
  };
  const variants: Array<[string, Raw]> = [
    ["smooth, oculus", { dome: { type: "smooth", oculus: 8.2, steps: 3 } }],
    ["smooth, closed", { dome: { type: "smooth" } }],
    ["lantern", { dome: { type: "smooth", lantern: true, steps: 2 } }],
    ["steps 0, no drum", { dome: { type: "coffered", coffers: [5, 28], oculus: 8.2, steps: 0 } }],
    ["steps 0, no drum, smooth closed", { dome: { type: "smooth", steps: 0 } }],
    ["steps 0, drum", { dome: { type: "coffered", coffers: [5, 28], oculus: 8.2, steps: 0, drum: 3 } }],
    ["steps 7, drum", { dome: { type: "coffered", coffers: [5, 28], oculus: 8.2, steps: 7, drum: 3 } }],
    ["steps 7, no drum", { dome: { type: "coffered", coffers: [5, 28], oculus: 8.2, steps: 7 } }],
  ];

  it.each(variants)("dome: %s", (_name, rotunda) => {
    const m = mk(rotunda);
    const r = FacadeBuilding.parse({ ...buildingRaw(), rotunda: { ...buildingRaw().rotunda, ...rotunda } }).rotunda!;
    const d = rotundaDims(r);
    const f = rotundaFrame(r, bodyDepth(FacadeBuilding.parse(buildingRaw())));
    const dome = m.parts.get("dome")!;
    const { open, volume } = edgesClosed(dome);
    expect(open, "edges not shared by exactly two faces").toBe(0);
    expect(volume).toBeGreaterThan(0);
    const sphere = d.radius + Math.min(0.06 * r.diameter, 0.7 * d.wall);
    const rho = d.radius + 1.5;
    const base0 = f.wallTop + DOME_SEAT;
    // looking down through the base of the shell: the underside is the first thing met, and the top of the wall, a seat below it, is not coplanar with it
    for (const a of [0.3, 1.9, 4.4]) {
      const from = new THREE.Vector3(rho * Math.sin(a), base0 + 0.5, f.zc + rho * Math.cos(a));
      pocheOnly(`down through the base at ${a}`, cast(m.group, from, DOWN));
    }
    // along the section: from inside the shell the first thing met is a back face (the inner surface or a recess wall)
    for (const h of [1, 0.5 * d.radius]) {
      const mid = (Math.sqrt(d.radius ** 2 - h ** 2) + Math.sqrt(sphere ** 2 - h ** 2)) / 2;
      pocheOnly(`along x at ${h}`, cast(m.group, new THREE.Vector3(mid, f.spring + h, f.zc), new THREE.Vector3(-1, 0, 0)));
    }
    // the dome rests a seat above the wall: no face of one lies in the plane of a face of the other
    const wallBox = new THREE.Box3().setFromObject(m.parts.get("rotunda")!);
    const domeBox = new THREE.Box3().setFromObject(dome);
    expect(domeBox.min.y - wallBox.max.y).toBeCloseTo(DOME_SEAT, 6);
  });

  it.each([
    ["no niches", { niches: 0 }],
    ["16 niches", { niches: 16 }],
    ["raised on the level of the body", { level: 1.2 }],
  ] as Array<[string, Raw]>)("wall: %s", (_name, rotunda) => {
    const { open, volume } = edgesClosed(mk(rotunda).parts.get("rotunda")!);
    expect(open).toBe(0);
    expect(volume).toBeGreaterThan(0);
  });
});
