import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, checkStageData, SceneSpec, SOUND_IDS, StageData } from "@pv/scene-spec";
import type { Engine, EngineContext } from "../src/index.ts";
import { createStageEngine } from "../src/engines/stage/index.ts";
import { CHEAT, lerpAngle, StageEvaluator } from "../src/engines/stage/blocking.ts";

const PUBLIC = new URL("../../../fixtures/public/", import.meta.url);
const raw = JSON.parse(readFileSync(new URL("scenes/palcoscenico-dialogo.scene.json", PUBLIC), "utf8"));

function parse(json: unknown = raw) {
  const spec = SceneSpec.parse(json);
  if (spec.engine !== "stage") throw new Error("not a stage scene");
  return spec;
}

async function build(json: unknown = raw): Promise<{ engine: Engine; ctx: EngineContext; spec: SceneSpec }> {
  const spec = parse(json);
  // No createCanvas: Node mode, GLB files are not loaded and catalog models are placeholders.
  const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
  const engine = createStageEngine();
  await engine.build(ctx, spec);
  return { engine, ctx, spec };
}

function snapshot(ctx: EngineContext): string {
  const out: string[] = [];
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  ctx.scene.add(ctx.root);
  ctx.scene.traverse((o) => {
    const e: unknown[] = [o.name, o.type, o.visible, o.userData.key ?? null, ...o.position.toArray().map(r), ...o.quaternion.toArray().map(r), ...o.scale.toArray().map(r)];
    if (o instanceof THREE.Light) e.push(r(o.intensity));
    const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (mat && !Array.isArray(mat)) e.push(r(mat.opacity), r(mat.emissiveIntensity ?? 0));
    out.push(JSON.stringify(e));
  });
  ctx.scene.remove(ctx.root);
  return out.join("\n");
}

const anchorAt = (engine: Engine, anchor: object, ch: string, t: number) => {
  const v = new THREE.Vector3();
  engine.update(ch, t);
  const ok = engine.resolveAnchor(anchor as never, ch, t, v);
  return ok ? v : null;
};

describe("palcoscenico-dialogo scene", () => {
  it("passes SceneSpec.parse, checkScene and checkStageData with zero issues", () => {
    const spec = parse();
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "stage") throw new Error();
    expect(checkStageData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters).toHaveLength(3);
    for (const ch of spec.chapters) {
      expect(ch.book && ch.activity, ch.id).toBeTruthy();
      expect(new Set(ch.quiz.map((q) => q.type))).toEqual(new Set(["choice", "pick"]));
      expect(ch.pins.length && ch.deep.length).toBeTruthy();
      for (const s of [...(ch.sounds?.ambience ?? []), ...(ch.sounds?.cues ?? [])]) expect(SOUND_IDS).toContain(s.sound);
      expect(ch.narration.some((s) => s.speaker)).toBe(true);
    }
    for (const s of spec.sources) if (s.kind !== "page") expect(s.url).toMatch(/^https:\/\/it\.wikipedia\.org\//);
  });

  it("checkStageData reports bad models, clips, speakers, props, anchors and missing name pins", () => {
    const bad = structuredClone(raw);
    bad.engineData.characters.push({ id: "gatto", model: "cat", pos: [0, 0] }, { id: "x", model: "no-such-model", pos: [0, 9] });
    const b0 = bad.engineData.chapters[0].blocking;
    b0.push({ do: "gesture", who: "anna", at: 30, clip: "moonwalk" });
    b0.push({ do: "give", who: "tom", at: 31, prop: "cup", to: "anna" });
    b0.push({ do: "walk", who: "anna", at: 0.5, to: [0, 0] });
    bad.chapters[0].narration.splice(1, 0, { at: 0.5, text: "Hi!", speaker: "anna", highlight: [], sourceIds: ["page"] });
    bad.chapters[1].pins = bad.chapters[1].pins.filter((p: { id: string }) => p.id !== "tom");
    bad.chapters[1].pins[0].anchor = { entity: "character", part: "anna.tail" };
    bad.chapters[1].camera[0].target = { entity: "item", part: "tavolo" };
    bad.chapters[0].activity.test.params = ["nope"];
    const spec = parse(bad);
    if (spec.engine !== "stage") throw new Error();
    const msgs = checkStageData(spec.engineData, spec).map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'model "cat" is not a person',
        'unknown catalog model "no-such-model"',
        '"anna" has no clip "moonwalk"',
        '"tom" does not hold "cup"',
        '"anna" is in the wings at 0.5s',
        '"anna" speaks from the wings',
        'character "tom" is on stage without a name pin',
        'character has no part "tail"',
        'stage anchors use entity "character", "prop" or "set", not "item"',
        'activity param "nope" is not defined in params',
      ]),
    );
    expect(msgs.some((m) => m.startsWith("point [0, 9] is off the stage floor"))).toBe(true);
  });

  it("StageData rejects unknown fields, dotted ids and unknown backdrops", () => {
    expect(StageData.safeParse(raw.engineData).success).toBe(true);
    expect(StageData.safeParse({ ...raw.engineData, extra: 1 }).success).toBe(false);
    const dotted = structuredClone(raw.engineData);
    dotted.characters[0].id = "a.b";
    expect(StageData.safeParse(dotted).success).toBe(false);
    const bd = structuredClone(raw.engineData);
    bd.set.backdrop = "luna";
    expect(StageData.safeParse(bd).success).toBe(false);
  });
});

describe("stage engine", () => {
  it("builds in Node without WebGL, canvas or GLB loading, and disposes cleanly", async () => {
    const { engine, ctx } = await build();
    expect(ctx.root.getObjectByName("anna")?.getObjectByName("placeholder")).toBeDefined();
    expect(ctx.root.getObjectByName("curtain-left")).toBeDefined();
    expect(ctx.root.getObjectByName("backdrop")).toBeDefined();
    expect(engine.bounds().radius).toBeGreaterThan(4);
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
    expect(ctx.scene.children).toHaveLength(0);
  });

  it("builds every backdrop", async () => {
    for (const backdrop of ["piazza", "aula", "casa", "bosco", "palazzo", "porto", "vuoto"]) {
      const j = structuredClone(raw);
      j.engineData.set.backdrop = backdrop;
      const { engine, ctx } = await build(j);
      expect(ctx.root.getObjectByName("backdrop")!.children.length, backdrop).toBeGreaterThan(0);
      engine.dispose();
    }
  });

  it("update is a pure function of (chapter, t): t1 -> t2 -> t1 gives identical state", async () => {
    const { engine, ctx, spec } = await build();
    const probes: [string, number][] = spec.chapters.flatMap((c) => [0, 0.37, 2.2, 3.1, 9.6, 12.7, 20.1, 26.3, 33.4, c.duration].map((t) => [c.id, t] as [string, number]));
    const first = probes.map(([c, t]) => (engine.update(c, t), snapshot(ctx)));
    // Reverse order, then shuffled jumps across chapters.
    [...probes].reverse().forEach(([c, t]) => engine.update(c, t));
    probes.forEach(([c, t], i) => {
      engine.update(spec.chapters[(i * 7) % 3]!.id, (i * 13.7) % 40);
      engine.update(c, t);
      expect(snapshot(ctx)).toBe(first[i]);
    });
  });

  it("characters enter from the wings, sit, and their anchors follow them", async () => {
    const { engine } = await build();
    const before = anchorAt(engine, { entity: "character", part: "anna" }, "ordinare", 0.5)!;
    expect(Math.abs(before.x)).toBeGreaterThan(3.5); // in the wings
    const mid = anchorAt(engine, { entity: "character", part: "anna" }, "ordinare", 3)!;
    expect(mid.x).toBeLessThan(before.x);
    expect(mid.x).toBeGreaterThan(0.15);
    const seated = anchorAt(engine, { entity: "character", part: "anna" }, "ordinare", 8)!;
    expect(seated.x).toBeCloseTo(0.15, 5);
    expect(seated.y).toBeGreaterThan(0.3);
    const head = anchorAt(engine, { entity: "character", part: "anna.head" }, "ordinare", 8)!;
    const top = anchorAt(engine, { entity: "character", part: "anna.top" }, "ordinare", 8)!;
    expect(top.y).toBeGreaterThan(head.y);
    expect(anchorAt(engine, { entity: "character", part: "anna.tail" }, "ordinare", 8)).toBeNull();
    expect(anchorAt(engine, { entity: "character", part: "nobody" }, "ordinare", 8)).toBeNull();
    expect(anchorAt(engine, { entity: "set", part: "front" }, "ordinare", 8)!.z).toBeGreaterThan(2);
    expect(anchorAt(engine, { pos: [1, 2, 3] }, "ordinare", 8)!.toArray()).toEqual([1, 2, 3]);
  });

  it("a held prop follows the hand, then stays where it was put", async () => {
    const { engine } = await build();
    const hand = anchorAt(engine, { entity: "character", part: "sam.hand" }, "parole", 6)!;
    const cup = anchorAt(engine, { entity: "prop", part: "cup" }, "parole", 6)!;
    expect(cup.distanceTo(hand)).toBeLessThan(0.2);
    const put = anchorAt(engine, { entity: "prop", part: "cup" }, "parole", 12)!;
    expect(put.toArray().map((v) => Math.round(v * 100) / 100)).toEqual([0.72, 0.64, 0.25]);
  });

  it("the spotlight and the bubble follow the speaker; listeners turn to the speaker", async () => {
    const spec = parse();
    if (spec.engine !== "stage") throw new Error();
    const ev = new StageEvaluator(spec.engineData, spec.chapters);
    expect(ev.cues("ordinare").map((c) => c.who)).toEqual(["sam", "anna", "tom", "sam", "tom"]);
    const s = ev.spot("ordinare", 14);
    expect(s.who).toBe("sam");
    expect(s.intensity).toBe(1);
    const sam = ev.character("sam", "ordinare", 14);
    expect(Math.hypot(s.x - sam.x, s.z - sam.z)).toBeLessThan(1e-6);
    expect(sam.speaking).toBe(true);
    expect(ev.spot("ordinare", 17).intensity).toBe(0); // narrator line
    expect(ev.house("ordinare", 14)).toBeLessThan(ev.house("ordinare", 17));
    // Without the chairs (sitting characters face the way their chair faces) a listener faces the speaker.
    const j = structuredClone(raw);
    j.engineData.chapters[0].blocking = j.engineData.chapters[0].blocking.filter((a: { do: string }) => a.do !== "sit");
    const spec2 = parse(j);
    if (spec2.engine !== "stage") throw new Error();
    const ev2 = new StageEvaluator(spec2.engineData, spec2.chapters);
    const anna = ev2.character("anna", "ordinare", 25.5); // Tom speaks
    const tom = ev2.character("tom", "ordinare", 25.5);
    const toward = (Math.atan2(tom.x - anna.x, tom.z - anna.z) * 180) / Math.PI;
    expect(Math.abs(lerpAngle(anna.yaw, lerpAngle(toward, 0, CHEAT), 1) - anna.yaw)).toBeLessThan(1e-6);
    expect(Math.abs(toward - 90)).toBeLessThan(1); // Tom is to her right
    const { engine, ctx } = await build();
    engine.update("ordinare", 14);
    expect(ctx.root.getObjectByName("sam-bubble")!.visible).toBe(true);
    expect(ctx.root.getObjectByName("anna-bubble")!.visible).toBe(false);
    expect(ctx.root.getObjectByName("sam")!.userData.key).toBe(true);
  });

  it("walking and sitting pick the model clips", () => {
    const spec = parse();
    if (spec.engine !== "stage") throw new Error();
    const ev = new StageEvaluator(spec.engineData, spec.chapters);
    expect(ev.character("anna", "ordinare", 3).clip).toBe("walk");
    expect(ev.character("anna", "ordinare", 10).clip).toBe("sit");
    expect(ev.character("sam", "ordinare", 13).clip).toBe("interact-right");
    expect(ev.character("sam", "parole", 6).clip).toBe("walk");
    expect(ev.character("sam", "parole", 3.8).clip).toBe("holding-right");
    expect(ev.character("anna", "conto", 40).visible).toBe(false);
  });

  it("exposes the chapter params and applies the slider overrides purely", async () => {
    const { engine, ctx } = await build();
    expect(engine.params!("ordinare")).toEqual([]);
    expect(engine.params!("conto").map((p) => [p.id, p.value])).toEqual([["luci", 1]]);
    const hemi = () => ctx.scene.children.find((o) => o instanceof THREE.HemisphereLight)!.intensity;
    engine.update("conto", 2);
    const full = hemi();
    engine.setParams!({ luci: 0.2 });
    engine.update("conto", 2);
    expect(hemi()).toBeCloseTo(full * 0.2, 6);
    engine.setParams!(null);
    engine.update("conto", 2);
    expect(hemi()).toBeCloseTo(full, 6);
  });

  it("the spacing param moves standing characters away from the centre line", async () => {
    const j = structuredClone(raw);
    j.engineData.chapters[2].params.push({ id: "distanza", kind: "spacing", label: "Distanza", min: 0.5, max: 1.5, step: 0.1, value: 1 });
    const { engine } = await build(j);
    const x0 = anchorAt(engine, { entity: "character", part: "sam" }, "conto", 20)!.x;
    engine.setParams!({ distanza: 1.5 });
    const x1 = anchorAt(engine, { entity: "character", part: "sam" }, "conto", 20)!.x;
    expect(x1).toBeCloseTo(x0 * 1.5, 6);
  });
});
