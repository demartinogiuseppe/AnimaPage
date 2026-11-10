import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { InkStyler } from "../src/book/ink.ts";

describe("InkStyler", () => {
  it("leaves meshes under an inkSelf group alone", () => {
    const root = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const matA = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const matB = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    const normal = new THREE.Mesh(geo, matA);
    const self = new THREE.Group();
    self.userData = { inkSelf: true };
    const own = new THREE.Mesh(geo, matB);
    self.add(own);
    root.add(normal, self);
    root.updateMatrixWorld(true);

    const styler = new InkStyler(root);
    styler.setEnabled(true);
    styler.begin({ keyPoints: [], radius: 1, width: 800, height: 600, pixelRatio: 1 });
    expect(normal.material).not.toBe(matA);
    expect(own.material).toBe(matB);
    expect(styler.overlay.children.length).toBeGreaterThan(0);
    const hulls = styler.overlay.children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(hulls.length).toBe(1);
    styler.end();
    expect(normal.material).toBe(matA);
    expect(own.material).toBe(matB);
  });
});
