import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { addFineLines, addInked, FACADE_LINE, FacadeInk } from "../src/engines/facade/ink.ts";
import { frameAround, profile, runAlongX } from "../src/engines/facade/profiles.ts";

describe("facade profiles", () => {
  it("profile rises monotonically and ends back on the wall", () => {
    const p = profile(0, [["o", 0.05], ["v", 0.1], ["ovolo", 0.1, 0.16], ["cyma", 0.08, 0.27]]);
    for (let i = 1; i < p.points.length; i++) expect(p.points[i]![1]).toBeGreaterThanOrEqual(p.points[i - 1]![1] - 1e-9);
    expect(p.points[p.points.length - 1]![0]).toBeCloseTo(-0.05, 9);
    expect(p.top).toBeCloseTo(0.28, 9);
    expect(p.projection).toBeCloseTo(0.27, 9);
  });

  it("profile supports torus and scotia", () => {
    const p = profile(0, [["torus", 0.06, 0.1], ["scotia", 0.05, 0.05]]);
    expect(p.top).toBeCloseTo(0.11, 9);
    expect(p.projection).toBeCloseTo(0.1, 9);
  });

  it("runAlongX spans x0..x1 and projects forward", () => {
    const p = profile(0, [["o", 0.05], ["v", 0.1], ["ovolo", 0.1, 0.16], ["cyma", 0.08, 0.27]]);
    const g = runAlongX(p.points, 1, 4);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.x).toBeCloseTo(1, 6);
    expect(b.max.x).toBeCloseTo(4, 6);
    expect(b.max.z).toBeCloseTo(p.projection, 6);
    expect(b.min.z).toBeCloseTo(-0.05, 6);
  });

  it("frameAround wraps an opening without covering it", () => {
    const p = profile(0, [["o", 0.05], ["v", 0.05], ["ovolo", 0.05, 0.1]]);
    const rect = { x0: 0, y0: 0, x1: 2, y1: 3 };
    const mesh = new THREE.Mesh(frameAround(p.points, rect, "all"), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const ray = (x: number, y: number) => {
      const r = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
      return r.intersectObject(mesh).length;
    };
    expect(ray(1, 1.5)).toBe(0);
    // frame band: outside the rect, within the projection of the profile (mid-height of left side)
    expect(ray(-0.05, 1.5)).toBeGreaterThan(0);
    expect(ray(1, -0.05)).toBeGreaterThan(0);
    expect(ray(1, 3.05)).toBeGreaterThan(0);
  });

  it("frameAround no-bottom leaves the sill side open", () => {
    const p = profile(0, [["o", 0.05], ["v", 0.05], ["ovolo", 0.05, 0.1]]);
    const rect = { x0: 0, y0: 0, x1: 2, y1: 3 };
    const mesh = new THREE.Mesh(frameAround(p.points, rect, "no-bottom"), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const r = new THREE.Raycaster(new THREE.Vector3(1, -0.05, 5), new THREE.Vector3(0, 0, -1));
    expect(r.intersectObject(mesh).length).toBe(0);
  });
});

describe("FacadeInk", () => {
  it("setSection discards one side", () => {
    const ink = new FacadeInk();
    const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 5);
    ink.setSection(plane);
    for (const m of [ink.paper, ink.hull, ink.lines, ink.fine, ink.overlay]) {
      const v = m.uniforms.uSection!.value as THREE.Vector4;
      expect(v.toArray()).toEqual([-1, 0, 0, 5]);
      expect(m.clipping).toBe(true);
    }
    ink.setSection(null);
    const off = ink.paper.uniforms.uSection!.value as THREE.Vector4;
    // dot(position, n) + w must never be > 0 for any building position
    expect(off.x).toBe(0);
    expect(off.y).toBe(0);
    expect(off.z).toBe(0);
    expect(off.w).toBeLessThanOrEqual(0);
    ink.dispose();
  });

  it("uses the shared line constants and render settings", () => {
    const ink = new FacadeInk();
    expect(ink.paper.polygonOffsetFactor).toBe(1);
    expect(ink.hull.polygonOffsetFactor).toBe(6);
    expect(ink.hull.side).toBe(THREE.BackSide);
    expect(ink.fine.uniforms.uAlpha!.value).toBe(FACADE_LINE.fineAlpha);
    // width/height are the drawing-buffer size, like InkFrame
    ink.setResolution(1600, 1200, 2);
    expect((ink.hull.uniforms.uRes!.value as THREE.Vector2).toArray()).toEqual([1600, 1200]);
    expect(ink.hull.uniforms.uWidth!.value).toBeCloseTo(FACADE_LINE.silhouettePx * 2, 9);
    ink.dispose();
  });

  it("addInked adds paper, hull and crease lines", () => {
    const ink = new FacadeInk();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.name = "box";
    const g = new THREE.Group();
    addInked(g, geo, ink);
    expect(g.children.length).toBe(3);
    expect(g.children.every((c) => c.name === "box")).toBe(true);
    const g2 = new THREE.Group();
    addInked(g2, geo, ink, { crease: false });
    expect(g2.children.length).toBe(2);
    ink.dispose();
  });

  it("addFineLines adds one line-segments object", () => {
    const ink = new FacadeInk();
    const g = new THREE.Group();
    addFineLines(g, new Float32Array([0, 0, 0, 1, 0, 0]), ink);
    expect(g.children.length).toBe(1);
    expect((g.children[0] as THREE.LineSegments).isLineSegments).toBe(true);
    ink.dispose();
  });
});
