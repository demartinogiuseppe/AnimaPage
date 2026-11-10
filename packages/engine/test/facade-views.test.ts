import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SceneSpec } from "@pv/scene-spec";
import { createFacadeEngine } from "../src/engines/facade/index.ts";
import { blendViews, viewOf, type Eye, type FacadeFrame } from "../src/engines/facade/views.ts";
import { viewOffsetY } from "../src/player/camera.ts";
import type { EngineView } from "../src/types.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/_dev-facciata.scene.json", import.meta.url));
type Raw = Record<string, any>;
const raw = (): Raw => JSON.parse(readFileSync(scenePath, "utf8"));

/** A 14 x 11 m front at z = 1, body 8 m deep behind it (root units). */
const frame: FacadeFrame = { center: new THREE.Vector3(0, 5.5, -3), width: 14, height: 11, depth: 8, front: 1 };
const eye: Eye = { height: 1.6, x: 0, distance: 17 };
const AX = 1.6;

/** The camera of a view: fov, aspect and the lens shift as the stage applies it. */
function cameraOf(v: EngineView, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(v.fov, aspect, 0.1, 2000);
  cam.position.copy(v.position);
  cam.lookAt(v.target);
  const h = 1000;
  const w = h * aspect;
  cam.setViewOffset(w, h, 0, viewOffsetY(0, h, v.shiftY), w, h);
  cam.updateMatrixWorld(true);
  return cam;
}
const ndc = (cam: THREE.Camera, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(cam);
const frontCorners = (f: FacadeFrame) =>
  [[-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, sy]) => [sx! * f.width / 2, sy! * f.height, f.front] as const);

describe("facade views", () => {
  it("prospetto shows the whole front", () => {
    const cam = cameraOf(viewOf("prospetto", frame, eye, AX, 0), AX);
    for (const [x, y, z] of frontCorners(frame)) {
      const p = ndc(cam, x, y, z);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
    const bottom = ndc(cam, -7, 0, 1);
    const top = ndc(cam, -7, 11, 1);
    expect(Math.abs(bottom.x - top.x)).toBeLessThan(1e-3);
  });

  it("prospettiva is one-point: depth lines meet at the vanishing point", () => {
    const v = viewOf("prospettiva", frame, eye, AX, 0);
    expect(v.shiftY).toBeGreaterThan(0);
    expect(v.shiftY).toBeLessThanOrEqual(0.35);
    const cam = cameraOf(v, AX);
    const vp = ndc(cam, eye.x, eye.height, -100);
    expect(vp.y).toBeCloseTo(-2 * v.shiftY, 3);
    // Two receding edges of the portico floor: (-7, 0, 1 -> -7) and (7, 0, 1 -> -7).
    const line = (x: number) => [ndc(cam, x, 0, 1), ndc(cam, x, 0, -7)] as const;
    const [a0, a1] = line(-7);
    const [b0, b1] = line(7);
    const d1 = a1.clone().sub(a0);
    const d2 = b1.clone().sub(b0);
    const k = ((b0.x - a0.x) * d2.y - (b0.y - a0.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
    const hit = { x: a0.x + k * d1.x, y: a0.y + k * d1.y };
    expect(hit.x).toBeCloseTo(vp.x, 2);
    expect(hit.y).toBeCloseTo(vp.y, 2);
  });

  it("the horizon sits at eye height", () => {
    const cam = cameraOf(viewOf("prospettiva", frame, eye, AX, 0), AX);
    const ys = [ndc(cam, 3, eye.height, 0).y, ndc(cam, -8, eye.height, -5).y, ndc(cam, 12, eye.height, 4).y];
    expect(ys[1]).toBeCloseTo(ys[0]!, 6);
    expect(ys[2]).toBeCloseTo(ys[0]!, 6);
  });

  it("the vanishing point stays on screen at slider extremes", () => {
    for (const height of [0.5, frame.height])
      for (const x of [-frame.width / 2, frame.width / 2]) {
        const e: Eye = { height, x, distance: 17 };
        const cam = cameraOf(viewOf("prospettiva", frame, e, AX, 0), AX);
        const p = ndc(cam, e.x, e.height, frame.front);
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        for (const [cx, cy, cz] of frontCorners(frame)) {
          const c = ndc(cam, cx, cy, cz);
          expect(Math.abs(c.x)).toBeLessThanOrEqual(1 + 1e-6);
          expect(Math.abs(c.y)).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
  });

  it("portrait aspect still fits the façade", () => {
    for (const name of ["prospetto", "prospettiva"] as const) {
      const cam = cameraOf(viewOf(name, frame, eye, 0.5, 0), 0.5);
      for (const [x, y, z] of frontCorners(frame)) {
        const p = ndc(cam, x, y, z);
        expect(Math.abs(p.x), name).toBeLessThanOrEqual(1 + 1e-6);
        expect(Math.abs(p.y), name).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it("assonometria and sezione fit the whole building", () => {
    const corners = [-1, 1].flatMap((sx) => [0, 1].flatMap((sy) => [0, 1].map((sz) => [sx * 7, sy * 11, 1 - sz * 8] as const)));
    for (const name of ["assonometria", "sezione"] as const)
      for (const aspect of [1.6, 0.6]) {
        const cam = cameraOf(viewOf(name, frame, eye, aspect, 0), aspect);
        for (const [x, y, z] of corners) {
          const p = ndc(cam, x, y, z);
          expect(Math.abs(p.x), `${name} ${aspect}`).toBeLessThanOrEqual(1);
          expect(Math.abs(p.y), `${name} ${aspect}`).toBeLessThanOrEqual(1);
        }
      }
  });

  it("blendViews keeps the target plane height (dolly zoom)", () => {
    const a = viewOf("prospetto", frame, eye, AX, 0);
    const b = viewOf("prospettiva", frame, eye, AX, 0);
    const visible = (v: EngineView) => 2 * v.position.distanceTo(v.target) * Math.tan((v.fov * Math.PI) / 360);
    const mid = blendViews(a, b, 0.5);
    expect(visible(mid) / ((visible(a) + visible(b)) / 2)).toBeCloseTo(1, 2);
    expect(mid.shiftY).toBeCloseTo(b.shiftY / 2, 6);
    expect(visible(blendViews(a, b, 0))).toBeCloseTo(visible(a), 6);
    expect(visible(blendViews(a, b, 1))).toBeCloseTo(visible(b), 6);
  });
});

/** The dev scene with a palazzo whose middle bay is off the axis, and chapters with view keys. */
function scene(): Raw {
  const j = raw();
  const palazzo = j.engineData.buildings[0];
  for (const f of palazzo.floors) f.bays[2].width = 6;
  j.engineData.chapters = [
    { chapter: "palazzo", building: "palazzo", views: [{ at: 0, view: "sezione" }] },
    { chapter: "casa", building: "casa" },
    { chapter: "catalogo", building: "catalogo", views: [{ at: 1, view: "prospettiva", dur: 2 }], eye: { height: 2, x: 1 } },
    {
      chapter: "ordini",
      building: "ordini",
      views: [
        { at: 0, view: "prospetto" },
        { at: 4, view: "sezione" },
      ],
    },
    // same building as "palazzo" with another eye: the overlays move, their buffers do not
    { chapter: "viste", building: "palazzo", views: [{ at: 0, view: "prospettiva" }], eye: { height: 3, x: 2 } },
  ];
  return j;
}

async function build() {
  const spec = SceneSpec.parse(scene());
  const engine = createFacadeEngine();
  const root = new THREE.Group();
  await engine.build({ root, scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("none")) }, spec);
  return { engine, root };
}

function sectionOf(root: THREE.Object3D): THREE.Vector4 {
  let found: THREE.Vector4 | undefined;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    if (!found && m?.uniforms?.uSection) found = m.uniforms.uSection.value as THREE.Vector4;
  });
  if (!found) throw new Error("no ink material");
  return found;
}

describe("facade engine views", () => {
  it("sezione clips the building at the cut", async () => {
    const { engine, root } = await build();
    engine.update("palazzo", 1);
    const cut = sectionOf(root);
    // Middle bay of the ground floor: widths 4, 5, 6 from x = -7.5, so it spans -3.5..1.5 and its centre is -1.
    expect([cut.x, cut.y, cut.z, cut.w]).toEqual([1, 0, 0, 1]);
    engine.update("casa", 1);
    expect(sectionOf(root).x).toBe(0);
    expect(sectionOf(root).w).toBeLessThan(0);
  });

  it("view() follows the chapter's view keys, null without them", async () => {
    const { engine } = await build();
    expect(engine.view!("casa", 1, 1.6)).toBeNull();
    const before = engine.view!("catalogo", 0, 1.6)!;
    const after = engine.view!("catalogo", 10, 1.6)!;
    expect(before.fov).toBe(6); // assonometria until the first key
    expect(after.fov).toBeGreaterThan(20); // prospettiva
    expect(after.shiftY).toBeGreaterThan(0);
    const mid = engine.view!("catalogo", 2, 1.6)!;
    expect(mid.fov).toBeGreaterThan(before.fov);
    expect(mid.fov).toBeLessThan(after.fov);
  });

  it("vanishing-point and horizon anchors resolve", async () => {
    const { engine } = await build();
    const vp = new THREE.Vector3();
    const hz = new THREE.Vector3();
    engine.update("catalogo", 10);
    expect(engine.resolveAnchor({ entity: "vanishing-point" }, "catalogo", 10, vp)).toBe(true);
    expect(engine.resolveAnchor({ entity: "horizon" }, "catalogo", 10, hz)).toBe(true);
    expect(vp.y).toBeCloseTo(hz.y, 6);
    expect(vp.x).toBeGreaterThan(0); // eye x = 1 m
    expect(vp.y).toBeGreaterThan(0);
    expect(engine.resolveAnchor({ entity: "vanishing-point", index: 1 }, "catalogo", 10, vp)).toBe(false);
  });

  it("overlays fade with the view weights", async () => {
    const { engine, root } = await build();
    const opacity = (name: string): number => {
      let best = 0;
      root.traverse((o) => {
        if (o.name !== name) return;
        let shown = o.visible;
        for (let p = o.parent; p; p = p.parent) shown = shown && p.visible;
        if (shown) best = Math.max(best, ((o as THREE.LineSegments).material as THREE.Material).opacity);
      });
      return best;
    };
    engine.update("catalogo", 0);
    expect(opacity("overlay-perspective")).toBe(0);
    engine.update("catalogo", 10);
    expect(opacity("overlay-perspective")).toBe(1);
    engine.update("catalogo", 2);
    expect(opacity("overlay-perspective")).toBeGreaterThan(0);
    expect(opacity("overlay-perspective")).toBeLessThan(1);
    engine.update("ordini", 10);
    expect(opacity("overlay-levels")).toBe(1);
    expect(opacity("overlay-perspective")).toBe(0);
  });

  it("the section slides in with the blend instead of snapping", async () => {
    const { engine, root } = await build();
    const planeX = (t: number): number | null => {
      engine.update("ordini", t);
      const c = sectionOf(root);
      return c.x === 0 ? null : -c.w;
    };
    expect(planeX(3)).toBeNull();
    const mid = planeX(4.9)!;
    const done = planeX(10)!;
    expect(mid).toBeGreaterThan(done);
    expect(planeX(4.3)!).toBeGreaterThan(mid);
  });

  it("overlays write their buffers in place: no new attributes, refilled only when the eye moves", async () => {
    const { engine, root } = await build();
    const attrs = () => {
      const out = new Map<string, THREE.BufferAttribute>();
      root.traverse((o) => {
        // only the chapter's building has its overlays shown
        if (o.name.startsWith("overlay-") && o.parent?.visible) out.set(o.name, (o as THREE.LineSegments).geometry.attributes.position as THREE.BufferAttribute);
      });
      return out;
    };
    engine.update("palazzo", 0);
    const first = attrs();
    expect(first.size).toBeGreaterThan(0);
    const versions = new Map([...first].map(([k, a]) => [k, a.version]));
    for (const t of [0.5, 1, 7]) engine.update("palazzo", t);
    for (const [k, a] of attrs()) {
      expect(a, k).toBe(first.get(k));
      expect(a.version, k).toBe(versions.get(k));
    }
    // another chapter of the same building with another eye: same objects, perspective buffer rewritten
    engine.update("viste", 1);
    const after = attrs();
    for (const [k, a] of after) expect(a, k).toBe(first.get(k));
    const bumped = [...after].filter(([k, a]) => a.version !== versions.get(k)).map(([k]) => k);
    expect(bumped).toEqual(["overlay-perspective"]);
    const v = after.get("overlay-perspective")!.version;
    engine.update("viste", 2);
    engine.update("viste", 3);
    expect(attrs().get("overlay-perspective")!.version).toBe(v);
  });

  it("the A-A line follows the bay the cut act names, in the same buffer", async () => {
    const j = scene();
    const viste = j.engineData.chapters.find((c: Raw) => c.chapter === "viste");
    viste.views = [{ at: 0, view: "prospetto" }];
    viste.acts = [{ do: "cut", bay: "b2", at: 1 }];
    const engine = createFacadeEngine();
    const root = new THREE.Group();
    await engine.build({ root, scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("none")) }, SceneSpec.parse(j));
    const buffer = (): THREE.BufferAttribute => {
      let pos!: THREE.BufferAttribute;
      root.traverse((o) => {
        if (o.name === "overlay-section" && o.parent?.visible) pos = (o as THREE.LineSegments).geometry.attributes.position as THREE.BufferAttribute;
      });
      return pos;
    };
    engine.update("palazzo", 0);
    const before = buffer();
    expect(before.getX(0)).toBeCloseTo(-1, 6); // default: middle bay b1
    engine.update("viste", 5);
    const after = buffer();
    // palazzo bays are 4, 5, 6 wide from x = -7.5: b2 spans 1.5..7.5, centre 4.5
    expect(after.getX(0)).toBeCloseTo(4.5, 6);
    expect(after.getX(1)).toBeCloseTo(4.5, 6);
    expect(after.count).toBe(before.count);
  });

  it("the section line carries an A at both ends", async () => {
    const { engine, root } = await build();
    engine.update("palazzo", 0);
    let pos!: THREE.BufferAttribute;
    root.traverse((o) => {
      if (o.name === "overlay-section" && o.parent?.visible) pos = (o as THREE.LineSegments).geometry.attributes.position as THREE.BufferAttribute;
    });
    // palazzo: 15 m wide, cut at x = -1, legs 0.06 W = 0.9 m long: letters stand beyond the leg tips
    const beyond: number[] = [];
    for (let i = 0; i < pos.count; i += 2) if (Math.min(pos.getX(i), pos.getX(i + 1)) > -1 + 0.9 + 1e-3) beyond.push(i);
    expect(beyond.length).toBe(6);
  });
});
