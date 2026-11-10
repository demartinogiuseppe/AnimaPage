// Clock part (scene-spec clock.ts, engine diorama/clock.ts): hand angles, running keys, stage + diorama wiring.
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, clockAt, clockHands, clockMinutes, formatClock, SceneSpec } from "@pv/scene-spec";
import type { EngineContext } from "../src/index.ts";
import { createStageEngine } from "../src/engines/stage/index.ts";
import { createDioramaEngine } from "../src/engines/diorama/index.ts";

const PUBLIC = new URL("../../../fixtures/public/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(`scenes/${name}.scene.json`, PUBLIC), "utf8"));
const ctx = (): EngineContext => ({ root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) });
/** Clockwise angle (degrees, 0 = 12) of a hand group from its z rotation. */
const angleOf = (o: THREE.Object3D) => ((((-o.rotation.z * 180) / Math.PI) % 360) + 360) % 360;
const find = (root: THREE.Object3D, name: string) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => o.name === name && out.push(o));
  return out;
};

describe("clock math", () => {
  it("parses and formats times", () => {
    expect(clockMinutes("07:15")).toBe(435);
    expect(clockMinutes("7:05")).toBe(425);
    expect(clockMinutes("23:59")).toBe(1439);
    expect(() => clockMinutes("24:00")).toThrow();
    expect(() => clockMinutes("7.30")).toThrow();
    expect(formatClock(19 * 60 + 30)).toBe("19:30");
    expect(formatClock(19 * 60 + 30, 12)).toBe("7:30");
    expect(formatClock(0, 12)).toBe("12:00");
    expect(formatClock(1440 + 65)).toBe("01:05");
  });

  it("puts the hour hand between the hours as the minutes pass", () => {
    expect(clockHands(clockMinutes("07:00"))).toEqual({ hour: 210, minute: 0 });
    expect(clockHands(clockMinutes("07:15"))).toEqual({ hour: 217.5, minute: 90 });
    expect(clockHands(clockMinutes("09:30"))).toEqual({ hour: 285, minute: 180 });
    expect(clockHands(clockMinutes("08:45"))).toEqual({ hour: 262.5, minute: 270 });
    expect(clockHands(clockMinutes("12:00"))).toEqual({ hour: 0, minute: 0 });
    // 15:20 and 3:20 look the same on a dial.
    expect(clockHands(clockMinutes("15:20"))).toEqual(clockHands(clockMinutes("03:20")));
  });

  it("runs forward across 12:00 and midnight, jumps without dur", () => {
    const base = clockMinutes("11:45");
    const run = [{ at: 2, minutes: clockMinutes("12:15"), dur: 4 }];
    expect(clockAt(base, run, 0)).toBe(base);
    expect(clockAt(base, run, 4)).toBeCloseTo(clockMinutes("12:00"), 6); // halfway (smooth ease is symmetric)
    expect(clockAt(base, run, 6)).toBe(clockMinutes("12:15"));
    expect(clockAt(base, run, 99)).toBe(clockMinutes("12:15"));
    // Never backwards: 23:50 -> 00:10 is 20 minutes later.
    const night = clockAt(clockMinutes("23:50"), [{ at: 0, minutes: clockMinutes("00:10"), dur: 2 }], 2);
    expect(night - clockMinutes("23:50")).toBe(20);
    expect(formatClock(night)).toBe("00:10");
    // Monotonic while running.
    let prev = -Infinity;
    for (let t = 0; t <= 6; t += 0.25) {
      const v = clockAt(base, run, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // A jump, then a run interrupted by the next key, which continues from where the hands were.
    const keys = [
      { at: 1, minutes: clockMinutes("08:00") },
      { at: 2, minutes: clockMinutes("09:00"), dur: 2 },
      { at: 3, minutes: clockMinutes("09:30") },
    ];
    expect(formatClock(clockAt(base, keys, 1.5))).toBe("08:00");
    // Values are not wrapped (the hands went forward through the night): 08:00 and 09:30 of the next day.
    expect(clockAt(base, keys, 2)).toBe(1440 + clockMinutes("08:00"));
    expect(formatClock(clockAt(base, keys, 2.5))).toBe("08:07"); // a quarter of the time: 1/8 of the way (smooth ease)
    expect(formatClock(clockAt(base, keys, 3))).toBe("09:30");
    expect(clockAt(base, [...keys].reverse(), 3)).toBe(clockAt(base, keys, 3));
  });
});

/** The daily-routine stage lesson (f7ffc6eb) rebuilt with one real clock. */
function routineScene(): unknown {
  const raw = read("palcoscenico-dialogo");
  const ch = raw.chapters[0].id;
  raw.engineData.props.push({ id: "orologio", model: { shape: "clock", time: "07:00", face: "both", hours: 12 }, pos: [0, 1.2, -1.4] });
  const entry = raw.engineData.chapters.find((c: { chapter: string }) => c.chapter === ch);
  entry.blocking.push({ do: "time", prop: "orologio", at: 4, time: "07:15" }, { do: "time", prop: "orologio", at: 8, time: "09:30", dur: 4 });
  return raw;
}

describe("stage clock prop", () => {
  it("validates, and flags a time action on a prop that is not a clock", () => {
    const spec = SceneSpec.parse(routineScene());
    expect(checkScene(spec)).toEqual([]);
    const bad = routineScene() as { engineData: { props: { id: string }[]; chapters: { blocking: unknown[] }[] } };
    bad.engineData.chapters[0]!.blocking.push({ do: "time", prop: bad.engineData.props[0]!.id, at: 1, time: "10:00" });
    expect(checkScene(SceneSpec.parse(bad)).map((i) => i.message)).toContainEqual(expect.stringContaining("is not a clock"));
    const wrong = routineScene() as { engineData: { chapters: { blocking: { time?: string }[] }[] } };
    wrong.engineData.chapters[0]!.blocking.at(-1)!.time = "25:00";
    expect(SceneSpec.safeParse(wrong).success).toBe(false);
  });

  it("shows the time of each moment with both hands, purely from (chapter, t)", async () => {
    const spec = SceneSpec.parse(routineScene());
    const c = ctx();
    const engine = createStageEngine();
    await engine.build(c, spec);
    const ch = spec.chapters[0]!.id;
    const [hour] = find(c.root, "hour-hand");
    const [minute] = find(c.root, "minute-hand");
    expect(hour && minute).toBeTruthy();
    const at = (t: number) => {
      engine.update(ch, t);
      return [Math.round(angleOf(hour!) * 100) / 100, Math.round(angleOf(minute!) * 100) / 100];
    };
    expect(at(0)).toEqual([210, 0]); // 7:00
    expect(at(5)).toEqual([217.5, 90]); // 7:15
    expect(at(20)).toEqual([285, 180]); // 9:30
    expect(at(5)).toEqual([217.5, 90]); // scrubbing back
    // The other chapters start again from the prop's own time.
    engine.update(spec.chapters[1]!.id, 3);
    expect(Math.round(angleOf(hour!))).toBe(210);
    // Anchors on the clock work like any prop's.
    const v = new THREE.Vector3();
    expect(engine.resolveAnchor({ entity: "prop", part: "orologio.top" }, ch, 5, v)).toBe(true);
    expect(v.y).toBeCloseTo(1.2 + 0.7, 5);
    engine.dispose();
  });
});

describe("diorama clock item", () => {
// Scene left out of the public copy (tools/publish/exclude.txt): this test skips when it is absent.
  it.skipIf(!existsSync(new URL("scenes/racconto-elettricista.scene.json", PUBLIC)))("runs the hands with a time action", async () => {
    const raw = read("racconto-elettricista");
    const ch = raw.chapters[0].id;
    raw.engineData.items.push({ id: "sveglia", model: { shape: "clock", time: "06:50", radius: 0.2 }, pos: [0, 1, 0] });
    raw.engineData.chapters.find((c: { chapter: string }) => c.chapter === ch).actions.push({ do: "time", target: "sveglia", at: 1, time: "07:10", dur: 2 });
    const spec = SceneSpec.parse(raw);
    expect(checkScene(spec)).toEqual([]);
    const c = ctx();
    const engine = createDioramaEngine();
    await engine.build(c, spec);
    const [minute] = find(c.root, "minute-hand");
    engine.update(ch, 0);
    expect(Math.round(angleOf(minute!))).toBe(300); // :50
    engine.update(ch, 2);
    expect(Math.round(angleOf(minute!))).toBe(0); // 7:00, halfway
    engine.update(ch, 3);
    expect(Math.round(angleOf(minute!))).toBe(60); // :10
    engine.dispose();
  });
});
