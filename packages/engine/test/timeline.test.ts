import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkSemantics, SceneSpec } from "@pv/scene-spec";
import { setDisplayLocale } from "@pv/scene-spec/i18n";
import { checkTimelineData, TimelineData } from "../../scene-spec/src/engines/timeline.ts";
import { createTimelineEngine } from "../src/engines/timeline/index.ts";
import { assignLanes, cursorYear, formatYear, MIN_GAP, ticks, yearToX } from "../src/engines/timeline/layout.ts";
import { buildSymbol, SYMBOLS } from "../src/engines/timeline/symbols.ts";
import { ease } from "../src/util/math.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/timeline-esempio.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function buildEngine() {
  const spec = SceneSpec.parse(raw());
  const engine = createTimelineEngine();
  const ctx = {
    root: new THREE.Group(),
    scene: new THREE.Scene(),
    loadAsset: () => Promise.reject(new Error("no assets")),
  };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Every transform, visibility and glow value under root. */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverse((o) => {
    const entry: unknown[] = [o.name, o.visible, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshLambertMaterial;
      entry.push(m.opacity, ...(m.emissive ? m.emissive.toArray() : []));
    }
    out.push(entry);
  });
  return out;
}

describe("timeline scene fixture", () => {
  it("passes SceneSpec, checkSemantics and the timeline cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("timeline");
    expect(checkSemantics(spec)).toEqual([]);
    if (spec.engine !== "timeline") throw new Error("unreachable");
    expect(checkTimelineData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters).toHaveLength(3);
    const quizTypes = new Set(spec.chapters.flatMap((c) => c.quiz.map((q) => q.type)));
    expect(quizTypes).toEqual(new Set(["choice", "pick"]));
  });
});

describe("TimelineData schema", () => {
  const base = () => raw().engineData;

  it("rejects ranges that end before they start, unknown symbols and unknown references", () => {
    const a = base();
    a.events[0].to = a.events[0].year - 10;
    expect(TimelineData.safeParse(a).success).toBe(false);
    const b = base();
    b.events[0].symbol = "spaceship";
    expect(TimelineData.safeParse(b).success).toBe(false);
    const c = base();
    c.chapters[0].events.push({ id: "nope", at: 1 });
    expect(TimelineData.safeParse(c).success).toBe(false);
    const d = base();
    d.events[0].year = -5000;
    expect(TimelineData.safeParse(d).success).toBe(false);
    const e = base();
    e.events[0].sourceIds = [];
    expect(TimelineData.safeParse(e).success).toBe(false);
  });

  it("cross-checks chapter and source ids against the scene", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "timeline") throw new Error("unreachable");
    const data = structuredClone(spec.engineData);
    data.chapters[0]!.chapter = "ghost";
    data.events[0]!.sourceIds = ["missing"];
    const messages = checkTimelineData(data, spec).map((i) => i.message);
    expect(messages).toContain('unknown chapter "ghost"');
    expect(messages).toContain('unknown source id "missing"');
  });
});

describe("timeline layout", () => {
  it("formats years and maps them linearly", () => {
    expect(formatYear(-753, "era")).toBe("753 a.C.");
    expect(formatYear(476, "era")).toBe("476 d.C.");
    expect(formatYear(0, "era")).toBe("");
    expect(formatYear(1848, "plain")).toBe("1848");
    expect(yearToX(-800, -800, 500)).toBeCloseTo(-20);
    expect(yearToX(500, -800, 500)).toBeCloseTo(20);
    expect(ticks(-800, 500, 100)).toHaveLength(14);
  });

  it("writes era years in the language of the lesson (English for languages without a table)", () => {
    try {
      setDisplayLocale("ja");
      expect(formatYear(250, "era")).toBe("AD 250");
      expect(formatYear(-753, "era")).toBe("753 BC");
      setDisplayLocale("en-GB");
      expect(formatYear(476, "era")).toBe("AD 476");
      expect(formatYear(1848, "plain")).toBe("1848");
      setDisplayLocale("it-IT");
      expect(formatYear(250, "era")).toBe("250 d.C.");
    } finally {
      setDisplayLocale(null);
    }
  });

  it("keeps symbols on the same lane at least MIN_GAP apart when lanes allow", () => {
    const xs = [0, 0.3, 0.6, 0.9, 5];
    const lanes = assignLanes(xs);
    expect(new Set(lanes.slice(0, 4)).size).toBe(4);
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++)
        if (lanes[i] === lanes[j]) expect(Math.abs(xs[i]! - xs[j]!)).toBeGreaterThanOrEqual(MIN_GAP);
  });

  it("eases the cursor between keys and clamps at the ends", () => {
    const keys = [
      { at: 2, year: -100 },
      { at: 4, year: 100 },
    ];
    expect(cursorYear([], 1, ease.inOutQuad)).toBeNull();
    expect(cursorYear(keys, 0, ease.inOutQuad)).toBe(-100);
    expect(cursorYear(keys, 3, ease.inOutQuad)).toBeCloseTo(0);
    expect(cursorYear(keys, 9, ease.inOutQuad)).toBe(100);
  });
});

describe("timeline symbols", () => {
  it("builds every symbol as a small, non-empty, grounded object", () => {
    for (const s of SYMBOLS) {
      const box = new THREE.Box3().setFromObject(buildSymbol(s));
      const size = box.getSize(new THREE.Vector3());
      expect(box.min.y, s).toBeGreaterThanOrEqual(-0.01);
      expect(size.y, s).toBeGreaterThan(0.8);
      expect(size.y, s).toBeLessThan(2);
      expect(Math.max(size.x, size.z), s).toBeLessThan(1.6);
    }
  });
});

describe("timeline engine", () => {
  it("is a pure function of (chapterId, t)", async () => {
    const { engine, ctx } = await buildEngine();
    for (const [ch, t1, t2] of [
      ["re", 5, 33],
      ["repubblica", 14.2, 2],
      ["impero", 40, 0],
      ["repubblica", 0, 49],
    ] as const) {
      engine.update(ch, t1);
      const a = snapshot(ctx.root);
      engine.update(ch, t2);
      const between = snapshot(ctx.root);
      engine.update("impero", 20);
      engine.update(ch, t1);
      expect(snapshot(ctx.root)).toEqual(a);
      expect(between).not.toEqual(a);
    }
  });

  it("reveals events per chapter and carries earlier ones over", async () => {
    const { engine, ctx } = await buildEngine();
    const visible = (id: string) => ctx.root.getObjectByName(`event:${id}`)!.visible;
    engine.update("re", 0);
    expect(visible("fondazione")).toBe(false);
    engine.update("re", 10);
    expect(visible("fondazione")).toBe(true);
    expect(visible("repubblica")).toBe(false);
    engine.update("repubblica", 0);
    expect(visible("fondazione")).toBe(true);
    expect(visible("tarquinio")).toBe(true);
    expect(visible("cesaricidio")).toBe(false);
  });

  it("resolves every entity anchor used by pins and camera keys", async () => {
    const { spec, engine } = await buildEngine();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters) {
      const t = ch.duration - 0.5;
      engine.update(ch.id, t);
      for (const anchor of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
        expect(engine.resolveAnchor(anchor, ch.id, t, out), JSON.stringify(anchor)).toBe(true);
        expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
      }
    }
  });

  it("puts event anchors on the symbol top, following the grow animation", async () => {
    const { engine } = await buildEngine();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    engine.update("re", 4.6);
    engine.resolveAnchor({ entity: "event", part: "fondazione" }, "re", 4.6, a);
    engine.update("re", 20);
    engine.resolveAnchor({ entity: "event", part: "fondazione" }, "re", 20, b);
    expect(a.x).toBeCloseTo(yearToX(-753, -800, 500));
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    expect(b.y).toBeGreaterThan(1.5);
    engine.resolveAnchor({ entity: "event", part: "caduta", offset: [0, 1, 0] }, "impero", 40, b);
    expect(b.x).toBeGreaterThan(a.x);
    expect(engine.resolveAnchor({ entity: "event", part: "nope" }, "re", 1, a)).toBe(false);
    expect(engine.resolveAnchor({ entity: "cursor" }, "re", 0, a)).toBe(true);
    expect(engine.resolveAnchor({ entity: "year", part: "abc" }, "re", 0, a)).toBe(false);
    expect(engine.resolveAnchor({ geo: [12, 41] }, "re", 0, a)).toBe(false);
  });

  it("reports bounds that contain the content and cleans up on dispose", async () => {
    const { engine, ctx } = await buildEngine();
    engine.update("impero", 45);
    const { center, radius } = engine.bounds();
    const box = new THREE.Box3().setFromObject(ctx.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    expect(center.distanceTo(sphere.center) + sphere.radius).toBeLessThanOrEqual(radius * 1.05);
    expect(ctx.scene.children.length).toBeGreaterThan(0);
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
    expect(ctx.scene.children).toHaveLength(0);
  });
});

// Scene left out of the public copy (tools/publish/exclude.txt): these tests skips when it is absent.
const germani = fileURLToPath(new URL("../../../fixtures/public/scenes/gen-storia_germani-fine-impero_p116-117.scene.json", import.meta.url));
describe.skipIf(!existsSync(germani))("keyword markers (labels anchored with an offset)", () => {

  async function build(json: unknown) {
    const spec = SceneSpec.parse(json);
    const engine = createTimelineEngine();
    const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
    await engine.build(ctx, spec);
    return { spec, engine, ctx };
  }
  const named = (root: THREE.Object3D, name: string) => root.getObjectByName(name);

  it("puts a bead exactly under every offset label, on a stem from its event, period or year", async () => {
    const { spec, engine, ctx } = await build(JSON.parse(readFileSync(germani, "utf8")));
    let checked = 0;
    for (const ch of spec.chapters) {
      for (const pin of ch.pins) {
        const a = pin.anchor as { entity?: string; offset?: number[] };
        const marker = named(ctx.root, `keyword:${ch.id}:${pin.id}`);
        if (!a.offset) {
          expect(marker, `${pin.id} needs no marker`).toBeUndefined();
          continue;
        }
        expect(marker, pin.id).toBeDefined();
        const from = pin.visible?.[0]?.[0] ?? 0;
        // The marker also waits for the event/period it stands on (it grows in with its owner).
        const entry = spec.engine === "timeline" ? spec.engineData.chapters.find((c) => c.chapter === ch.id) : undefined;
        const ownerAt = a.entity === "event" ? entry?.events.find((e) => e.id === (a as { part?: string }).part)?.at : a.entity === "period" ? entry?.periods?.find((p) => p.id === (a as { part?: string }).part)?.at : undefined;
        const t = Math.min(ch.duration, Math.max(from, ownerAt ?? 0) + 3);
        engine.update(ch.id, t);
        ctx.root.updateMatrixWorld(true);
        expect(marker!.visible, pin.id).toBe(true);
        const bead = new THREE.Vector3();
        marker!.getObjectByName("bead")!.getWorldPosition(bead);
        const anchor = new THREE.Vector3();
        expect(engine.resolveAnchor(pin.anchor, ch.id, t, anchor)).toBe(true);
        expect(bead.distanceTo(anchor), pin.id).toBeLessThan(1e-6);
        // The stem's foot is on the thing the label belongs to, below the bead.
        expect(marker!.position.y).toBeLessThan(anchor.y);
        // Hidden in other chapters and before the label appears.
        const other = spec.chapters.find((c) => c.id !== ch.id)!;
        engine.update(other.id, 1);
        expect(marker!.visible).toBe(false);
        if (from > 0.5) {
          engine.update(ch.id, from - 0.5);
          expect(marker!.visible).toBe(false);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(7);
  });

  it("keeps a keyword label hidden until its event or period appears, together with its marker", async () => {
    const { spec, engine, ctx } = await build(JSON.parse(readFileSync(germani, "utf8")));
    // "attila" is visible from 19 s, its event "attila-452" grows in at 26 s.
    const ch = spec.chapters.find((c) => c.id === "invasioni")!;
    const pin = ch.pins.find((p) => p.id === "attila")!;
    expect(pin.visible?.[0]?.[0]).toBe(19);
    const marker = named(ctx.root, "keyword:invasioni:attila")!;
    for (const [t, shown] of [[19.5, false], [25.9, false], [26.2, true], [37, true]] as const) {
      engine.update(ch.id, t);
      expect(engine.anchorShown!(pin.anchor, ch.id, t), `t=${t}`).toBe(shown);
      expect(marker.visible, `marker t=${t}`).toBe(shown);
    }
    // Periods wait too; events carried over from an earlier chapter, years and fixed points do not.
    const medioevo = spec.chapters.find((c) => c.id === "fine")!.pins.find((p) => p.id === "medioevo")!;
    expect(engine.anchorShown!(medioevo.anchor, "fine", 28)).toBe(false);
    expect(engine.anchorShown!(medioevo.anchor, "fine", 29.5)).toBe(true);
    expect(engine.anchorShown!({ entity: "event", part: "sacco-410" }, "fine", 0)).toBe(true);
    expect(engine.anchorShown!({ entity: "year", part: "400", offset: [0, 1, 0] }, "invasioni", 0)).toBe(true);
    expect(engine.anchorShown!({ pos: [0, 1, 0] }, "invasioni", 0)).toBe(true);
  });

  it("links a sideways keyword to its event's disc along the plinth", async () => {
    const json = raw();
    const ch = json.chapters[0];
    const ev = json.engineData.chapters.find((c: { chapter: string }) => c.chapter === ch.id).events[0].id;
    ch.pins.push({ id: "kw", name: "parola", info: "x", kind: "note", anchor: { entity: "event", part: ev, offset: [1.5, 1.2, 0] }, sourceIds: [] });
    const { engine, ctx } = await build(json);
    engine.update(ch.id, ch.duration);
    const marker = named(ctx.root, `keyword:${ch.id}:kw`)!;
    expect(marker.visible).toBe(true);
    expect(marker.position.y).toBe(0); // on the plinth
    expect(marker.children.length).toBe(3); // stem, bead, link to the event
    const before = snapshot(ctx.root);
    engine.update(ch.id, 0);
    engine.update(ch.id, ch.duration);
    expect(snapshot(ctx.root)).toEqual(before); // pure in (chapter, t)
  });
});
