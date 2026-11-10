import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { checkSemantics, SceneSpec } from "@pv/scene-spec";
import { createCardEngine } from "../src/engines/card/index.ts";

const fixture = new URL("../../../fixtures/public/scenes/card-esempio.scene.json", import.meta.url);

describe("card engine", () => {
  it("is a trivial engine without geometry", async () => {
    const e = createCardEngine();
    const root = new THREE.Group();
    await e.build({ root, scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) }, SceneSpec.parse(JSON.parse(readFileSync(fixture, "utf8"))));
    e.update("definizione", 3);
    expect(root.children).toHaveLength(0);
    expect(e.resolveAnchor({ pos: [0, 0, 0] }, "definizione", 0, new THREE.Vector3())).toBe(false);
    expect(e.bounds().radius).toBeGreaterThan(0);
    e.dispose();
  });

  it("card-esempio fixture is valid with zero semantic issues", () => {
    const spec = SceneSpec.parse(JSON.parse(readFileSync(fixture, "utf8")));
    expect(spec.engine).toBe("card");
    expect(checkSemantics(spec)).toEqual([]);
    expect(spec.chapters).toHaveLength(2);
    for (const ch of spec.chapters) {
      expect(ch.pins).toEqual([]);
      expect(ch.quiz.length).toBeGreaterThan(0);
      expect(ch.quiz.every((q) => q.type === "choice")).toBe(true);
      expect(ch.deep.length).toBeGreaterThan(0);
    }
  });
});
