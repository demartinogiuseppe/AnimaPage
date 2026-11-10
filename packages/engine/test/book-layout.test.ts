// Pop-up book layout: every engine's content fits the right page; pop-up and page turn are deterministic.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec, type EngineId } from "@pv/scene-spec";
import { createEngine } from "../src/index.ts";
import {
  backdropsOf,
  bookLayout,
  CONTENT_LIFT,
  contentFootprint,
  fitsRightPage,
  footprintFrom,
  insideBook,
  keepBookInView,
  overviewPose,
  pageY,
  USABLE_U,
} from "../src/book/layout.ts";
import { cameraJoinAt, easeOutBack, entryJoinAt, popAt, POP_WINDOW, sheetProfile, turnAngleAt, TURN_SECONDS } from "../src/book/popup.ts";
import { leftPageText, rightPageText } from "../src/book/page.ts";

const PUBLIC = resolve(import.meta.dirname, "../../../fixtures/public");
// Some scenes are left out of the public copy (tools/publish/exclude.txt): their tests skip when the file is absent.
const has = (name: string) => existsSync(resolve(PUBLIC, `scenes/${name}.scene.json`));
const load = (name: string) => SceneSpec.parse(JSON.parse(readFileSync(resolve(PUBLIC, `scenes/${name}.scene.json`), "utf8")));

const SCENE_OF: Partial<Record<EngineId, string>> = {
  map: "campania",
  battle: "troia",
  timeline: "timeline-esempio",
  diorama: "racconto-elettricista",
  process: "scienze-sensi",
  concept: "grammatica-indicativo",
  card: "card-esempio",
};

async function built(id: EngineId) {
  const spec = load(SCENE_OF[id]!);
  const engine = await createEngine(spec.engine);
  const root = new THREE.Group();
  await engine.build(
    {
      root,
      scene: new THREE.Scene(),
      loadAsset: async (path) => {
        const b = readFileSync(resolve(PUBLIC, path));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    },
    spec,
  );
  engine.update(spec.chapters[0]!.id, 0);
  return { spec, engine, root };
}

describe("book layout", () => {
  for (const id of Object.keys(SCENE_OF) as EngineId[]) {
    it.skipIf(!has(SCENE_OF[id]!))(`fits the ${id} engine's content on the right page`, async () => {
      const { engine, root } = await built(id);
      const fp = contentFootprint(root, engine.bounds());
      const L = bookLayout(fp);
      expect(fitsRightPage(L)).toBe(true);
      // Portrait-ish page, sized to the content (not absurdly larger).
      expect(L.pageD / L.pageW).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(L.pageD / L.pageW).toBeLessThanOrEqual(1.4 + 1e-9);
      expect(L.pageW).toBeLessThan(fp.radius * 12);
      // The right-page centre lands on the content centre (content is never moved or scaled).
      expect(L.origin.x + L.contentX).toBeCloseTo(fp.center.x);
      expect(L.origin.z).toBeCloseTo(fp.center.z);
      expect(L.origin.y).toBeCloseTo(fp.center.y - L.pageW * CONTENT_LIFT); // content stands above the paper
      engine.dispose();
    });
  }

  it.skipIf(!has("racconto-elettricista"))("ignores sky domes and horizon aprons: the diorama stands on the page, not 26 units above it", async () => {
    const { engine, root } = await built("diorama");
    const fp = contentFootprint(root, engine.bounds());
    expect(fp.center.y).toBeGreaterThan(-3);
    expect(backdropsOf(root, engine.bounds().radius).length).toBeGreaterThan(0);
    engine.dispose();
  });

  it("clamps the footprint to the engine's bounding sphere and keeps a minimum size", () => {
    const bounds = { center: new THREE.Vector3(1, 0, 2), radius: 2 };
    const huge = new THREE.Box3(new THREE.Vector3(-100, -1, -100), new THREE.Vector3(100, 3, 100));
    const fp = footprintFrom(huge, bounds);
    expect(fp.halfX).toBeLessThanOrEqual(2);
    expect(fp.halfZ).toBeLessThanOrEqual(2);
    const dot = new THREE.Box3(new THREE.Vector3(1, 0, 2), new THREE.Vector3(1.01, 0.01, 2.01));
    expect(footprintFrom(dot, bounds).halfX).toBeCloseTo(0.6);
    expect(footprintFrom(null, bounds).halfZ).toBeCloseTo(1.5);
  });

  it("wide, deep and tall footprints all fit; tall content stands up, reliefs lie down", () => {
    const mk = (hx: number, hz: number, h: number) =>
      bookLayout({ center: new THREE.Vector3(), halfX: hx, halfZ: hz, height: h, radius: Math.hypot(hx, hz, h) });
    for (const L of [mk(10, 1, 0.5), mk(1, 10, 0.5), mk(2, 2, 6)]) expect(fitsRightPage(L)).toBe(true);
    expect(mk(5, 4, 0.6).upright).toBe(false);
    expect(mk(1, 1, 2).upright).toBe(true);
  });

  it("curves the page into the gutter and keeps the usable part flat", () => {
    const L = bookLayout({ center: new THREE.Vector3(), halfX: 1, halfZ: 1, height: 1, radius: 1.5 });
    expect(pageY(0, L)).toBeLessThan(-L.stackH * 0.5);
    for (let u = USABLE_U[0]; u <= 0.9; u += 0.05) expect(Math.abs(pageY(u, L))).toBeLessThan(1e-9);
  });

  it("frames the whole book in the overview, wider stages get closer", () => {
    const L = bookLayout({ center: new THREE.Vector3(), halfX: 1, halfZ: 1, height: 1, radius: 1.5 });
    const wide = overviewPose(L, 16 / 9, 40);
    const phone = overviewPose(L, 0.8, 40);
    expect(phone.position.length()).toBeGreaterThan(wide.position.length());
    // Book corners project inside the frame.
    for (const aspect of [16 / 9, 0.8]) {
      const pose = overviewPose(L, aspect, 40);
      const cam = new THREE.PerspectiveCamera(40, aspect, 0.01, 1000);
      cam.position.copy(pose.position);
      cam.lookAt(pose.target);
      cam.updateMatrixWorld();
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const p = new THREE.Vector3(x * L.halfWidth, 0, z * L.halfDepth).project(cam);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("book stays in view", () => {
  const L = bookLayout({ center: new THREE.Vector3(), halfX: 1, halfZ: 1, height: 1, radius: 1.5 });
  it("pulls extreme close-ups back to a tenth of a page in frame, keeping target and direction", () => {
    const target = new THREE.Vector3(0.5, 0.2, 0);
    const close = { position: target.clone().add(new THREE.Vector3(0, 0.05, 0.1)), target };
    const kept = keepBookInView(close, L.pageW, 40, 16 / 9);
    expect(kept.target.toArray()).toEqual(target.toArray());
    const d = kept.position.distanceTo(target);
    expect(2 * d * Math.tan((20 * Math.PI) / 180)).toBeCloseTo(0.1 * L.pageW);
    const a = close.position.clone().sub(target).normalize();
    const b = kept.position.clone().sub(target).normalize();
    expect(Math.atan2(a.x, a.z)).toBeCloseTo(Math.atan2(b.x, b.z));
    // Far enough already: unchanged.
    const far = { position: target.clone().add(new THREE.Vector3(0, 5, 5)), target };
    expect(keepBookInView(far, L.pageW, 40, 1.5).position.distanceTo(far.position)).toBeLessThan(1e-9);
  });

  it("never goes below the minimum elevation", () => {
    const target = new THREE.Vector3();
    const low = { position: new THREE.Vector3(0, -1, 10), target };
    const kept = keepBookInView(low, L.pageW, 40, 1.5);
    const dir = kept.position.clone().sub(target);
    expect(Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * (180 / Math.PI)).toBeCloseTo(14);
  });

  it("reports how far inside the book the camera is", () => {
    expect(insideBook(100, L.pageW, 40, 1.5)).toBe(0);
    expect(insideBook(0.01, L.pageW, 40, 1.5)).toBe(1);
  });
});

describe("pop-up animation", () => {
  it("is a pure function of chapter time: flat at 0, standing after the window, same t -> same state", () => {
    expect(popAt(0, true).p).toBe(0);
    expect(popAt(0, true).rise).toBeLessThan(0.1);
    expect(popAt(POP_WINDOW[1] + 0.01, true)).toEqual({ p: 1, rise: 1, lean: 0, shadow: 1 });
    const ts = [0.1, 0.7, 1.1, 1.5, 3, 0.7, 0.1];
    const a = ts.map((t) => popAt(t, true));
    const b = [...ts].reverse().map((t) => popAt(t, true)).reverse();
    expect(a).toEqual(b);
    expect(a[1]).toEqual(a[5]);
  });

  it("springs like paper (small overshoot) and only upright content leans", () => {
    let max = 0;
    for (let t = 0; t <= 2; t += 0.01) max = Math.max(max, popAt(t, false).rise);
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(1.15);
    expect(popAt(0.6, false).lean).toBe(0);
    expect(popAt(0.6, true).lean).toBeLessThan(0);
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
  });

  it("reduced motion: everything already in place", () => {
    expect(popAt(0, true, true).p).toBe(1);
    expect(turnAngleAt(0, true)).toBe(Math.PI);
  });

  it("turns the page from the right to the left page, and keeps the sheet's length", () => {
    expect(turnAngleAt(0)).toBe(0);
    expect(turnAngleAt(TURN_SECONDS)).toBeCloseTo(Math.PI);
    for (const th of [0, 0.5, Math.PI / 2, 2.5, Math.PI]) {
      const pts = sheetProfile(th, 2, 20);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      expect(len).toBeCloseTo(2, 6);
    }
    expect(sheetProfile(0, 2, 10).at(-1)![0]).toBeCloseTo(2);
    expect(sheetProfile(Math.PI, 2, 10).at(-1)![0]).toBeCloseTo(-2);
    expect(sheetProfile(Math.PI / 2, 2, 10).every(([, y]) => y >= 0)).toBe(true);
  });

  it("turns back from the left to the right page for an earlier chapter", () => {
    expect(turnAngleAt(0, false, -1)).toBeCloseTo(Math.PI);
    expect(turnAngleAt(TURN_SECONDS, false, -1)).toBeCloseTo(0);
    const mid = sheetProfile(Math.PI / 2, 2, 20, 0.9, -1);
    expect(mid.every(([, y]) => y >= 0)).toBe(true);
    expect(mid.at(-1)![0]).toBeGreaterThan(0); // the outer edge leads towards the right page
    expect(sheetProfile(Math.PI / 2, 2, 20).at(-1)![0]).toBeLessThan(0);
  });

  it("starts on the book overview and joins the scene's camera keys", () => {
    expect(cameraJoinAt(0)).toBe(0);
    expect(cameraJoinAt(10)).toBe(1);
    expect(cameraJoinAt(2.9)).toBeGreaterThan(0);
  });

  it("joins the camera keys on the entry clock too, so a lesson paused at t = 0 does not hold the overview", () => {
    expect(entryJoinAt(0, 0)).toBe(0); // chapter entry: book overview
    expect(entryJoinAt(0, 1.5)).toBe(0); // page turn and pop-up still on the overview
    expect(entryJoinAt(0, 10)).toBe(1); // waiting on a Prevedi question: the chapter's own view
    expect(entryJoinAt(10, 0)).toBe(1); // a seek far into the chapter, as before
    expect(entryJoinAt(2.9, 0)).toBe(cameraJoinAt(2.9));
  });
});

describe("printed pages", () => {
  it.skipIf(!has("campania"))("uses chapter.book when present, with source numbers and the Prevedi question", () => {
    const spec = load("campania");
    const ch = spec.chapters.find((c) => c.id === "vesuvio")!;
    const p = leftPageText(spec, ch);
    expect(p.heading).toBe(ch.book!.heading);
    expect(p.formula).toBe("1281 m");
    expect(p.marks).toEqual([1]);
    expect(p.question).toBe(ch.activity!.predict.q);
  });

  it("falls back to title and first sentences without a book", () => {
    const spec = load("card-esempio");
    const ch = spec.chapters[0]!;
    const p = leftPageText(spec, ch);
    expect(p.heading).toBe(ch.title);
    expect(p.lines).toHaveLength(Math.min(3, ch.narration.length));
    expect(p.lines.every((l) => l.length <= 151)).toBe(true);
    expect(rightPageText(spec, ch).lines.length).toBeGreaterThan(0);
  });

  it("the six book scenes have a book and an activity in every chapter and stay valid", () => {
    for (const name of ["campania", "troia", "scienze-sensi", "racconto-elettricista", "grammatica-indicativo", "timeline-esempio"].filter(has)) {
      const spec = load(name);
      expect(checkScene(spec)).toEqual([]);
      for (const c of spec.chapters) {
        expect(c.book, `${name}/${c.id}`).toBeDefined();
        expect(c.activity, `${name}/${c.id}`).toBeDefined();
        expect(c.book!.lines.length).toBeGreaterThan(0);
      }
    }
  });
});
