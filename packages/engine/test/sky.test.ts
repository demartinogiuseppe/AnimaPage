import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, SceneSpec } from "@pv/scene-spec";
import { checkSkyData, SkyData } from "../../scene-spec/src/engines/sky.ts";
import { createSkyEngine, skyState } from "../src/engines/sky/index.ts";
import { dayOfYear, italianDate, julianDay, moonState, planetPosition, solveKepler, sunDeclination, sunLongitude } from "../src/engines/sky/astro.ts";
import { dateAt, MAX_SPIN, spinAt, track } from "../src/engines/sky/time.ts";
import { eclipseAt, EM_EARTH, placeMoon } from "../src/engines/sky/views.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/cielo-stagioni.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));
const jd = (iso: string) => julianDay(Date.parse(iso));

async function buildEngine(json: unknown = raw()) {
  const spec = SceneSpec.parse(json);
  const engine = createSkyEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

/** Every transform, colour and opacity of what is rendered (visible subtrees). */
function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, ...o.matrixWorld.elements.map((x) => Math.round(x * 1e6) / 1e6)];
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      entry.push(m.opacity, ...m.color.toArray(), ...(m.emissive ? m.emissive.toArray() : []));
    }
    out.push(entry);
  });
  return out;
}

describe("cielo-stagioni scene fixture", () => {
  it("passes SceneSpec, checkScene and the sky cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("sky");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "sky") throw new Error("unreachable");
    expect(checkSkyData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["terra-sole", "stagioni", "luna"]);
    for (const ch of spec.chapters) {
      expect(ch.book, ch.id).toBeDefined();
      expect(ch.activity?.test.params?.length, ch.id).toBeGreaterThan(0);
      expect(new Set(ch.quiz.map((q) => q.type)), ch.id).toEqual(new Set(["choice", "pick"]));
      expect(ch.sounds?.cues.length, ch.id).toBeGreaterThan(0);
    }
  });
});

describe("SkyData schema", () => {
  const base = () => raw().engineData;

  it("rejects inconsistent chapters, params and constellations", () => {
    const cases: ((d: any) => void)[] = [
      (d) => d.chapters.push({ ...d.chapters[0] }), // duplicate chapter
      (d) => (d.chapters[0].view = "galaxy"),
      (d) => d.chapters[0].time.push({ at: 1, date: "2026-01-01T00:00:00Z" }), // `at` out of order
      (d) => (d.chapters[0].time[1].date = "2026-01-01T00:00:00Z"), // date going backwards
      (d) => (d.chapters[0].time[0].date = "1700-01-01T00:00:00Z"), // outside JPL table validity
      (d) => (d.chapters[0].time[0].date = "21 giugno"),
      (d) => (d.chapters[0].bodies = ["mars"]), // bodies only in the system view
      (d) => (d.chapters[0].shadows = true), // shadows only in earth-moon
      (d) => d.chapters[0].params.push({ id: "luna", kind: "moon" }), // moon slider outside earth-moon
      (d) => d.chapters[0].params.push({ id: "ora", kind: "day" }), // duplicate param id
      (d) => d.chapters[0].params.push({ id: "x", kind: "tilt", min: 10, max: 5 }),
      (d) => (d.chapters[0].constellations = ["orsa"]), // unknown constellation
      (d) => (d.constellations = [{ id: "c", stars: [{ ra: 1, dec: 2 }, { ra: 2, dec: 3 }], lines: [[0, 5]], sourceIds: ["page"] }]),
      (d) => d.places.push({ ...d.places[0] }),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(SkyData.safeParse(d).success, mutate.toString()).toBe(false);
    }
    expect(SkyData.safeParse(base()).success).toBe(true);
  });

  it("cross-checks chapters, sliders, anchors, sources and the disclaimer against the scene", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "sky") throw new Error("unreachable");
    const scene = structuredClone(spec);
    scene.chapters[0]!.activity!.test.params = ["giorno"]; // a slider of another chapter
    scene.chapters[0]!.pins[0]!.anchor = { entity: "moon" }; // no Moon in the earth-sun view
    scene.chapters[1]!.camera[0]!.target = { entity: "earth", part: "elbow" };
    scene.chapters[2]!.pins[0]!.anchor = { entity: "ray" }; // rays only in earth-sun
    scene.disclaimers = ["Disegno schematico."];
    const data = structuredClone(spec.engineData);
    data.chapters[2]!.time[1]!.at = 999;
    data.places![0]!.sourceIds = ["ghost"];
    const msgs = checkSkyData(data, scene).map((i) => `${i.path}: ${i.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("time key after the chapter ends"),
        expect.stringContaining('"giorno" is not a sky parameter'),
        expect.stringContaining('"moon" is not on stage'),
        expect.stringContaining('unknown Earth part "elbow"'),
        expect.stringContaining("ray anchors need"),
        expect.stringContaining('unknown source id "ghost"'),
        expect.stringContaining("disclaimers"),
      ]),
    );
    data.chapters.pop();
    expect(checkSkyData(data, spec).some((i) => i.message.includes("no engineData.chapters entry"))).toBe(true);
  });
});

describe("sky astronomy model", () => {
  it("solves Kepler's equation", () => {
    for (const [M, e] of [[0.3, 0.2], [2.5, 0.05], [-1, 0.0934]] as const) {
      const E = solveKepler(M, e);
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
    }
  });

  it("puts the Sun on the solstices and equinoxes of 2026 (within a day)", () => {
    // Longitudes are J2000 (equinox of 2000): about 0.36° behind the equinox of date in 2026.
    const near = (iso: string, lon: number) => {
      const d = (((sunLongitude(jd(iso)) - lon) % 360) + 540) % 360 - 180;
      expect(Math.abs(d), iso).toBeLessThan(1.1); // the Sun moves ~1°/day
    };
    near("2026-03-20T12:00:00Z", 0);
    near("2026-06-21T12:00:00Z", 90);
    near("2026-09-23T12:00:00Z", 180);
    near("2026-12-21T12:00:00Z", 270);
    expect(sunDeclination(jd("2026-06-21T12:00:00Z"))).toBeCloseTo(23.44, 1);
    expect(sunDeclination(jd("2026-12-21T12:00:00Z"))).toBeCloseTo(-23.44, 1);
    expect(Math.abs(sunDeclination(jd("2026-03-20T12:00:00Z"), 0))).toBeLessThan(1e-9); // no tilt, no seasons
  });

  it("keeps the planets at their distances from the Sun", () => {
    const r = (p: Parameters<typeof planetPosition>[0]) => Math.hypot(...planetPosition(p, jd("2026-11-04T00:00:00Z")));
    expect(r("earth")).toBeGreaterThan(0.983);
    expect(r("earth")).toBeLessThan(1.017);
    expect(r("mercury")).toBeGreaterThan(0.307);
    expect(r("mercury")).toBeLessThan(0.467);
    expect(r("neptune")).toBeGreaterThan(29.7);
  });

  it("finds the Moon new and close to the ecliptic at the solar eclipse of 12 August 2026", () => {
    const m = moonState(jd("2026-08-12T17:47:00Z"));
    expect(Math.min(m.elongation, 360 - m.elongation)).toBeLessThan(2);
    expect(Math.abs(m.lat)).toBeLessThan(1.5);
    // Total lunar eclipse of 7 September 2025: full moon in the Earth's shadow.
    const f = moonState(jd("2025-09-07T18:00:00Z"));
    expect(Math.abs(f.elongation - 180)).toBeLessThan(2);
    expect(Math.abs(f.lat)).toBeLessThan(0.6);
    expect(m.distance).toBeGreaterThan(356000);
    expect(m.distance).toBeLessThan(407000);
  });

  it("formats Italian dates and days of the year", () => {
    expect(italianDate(Date.parse("2026-06-21T08:05:00Z"))).toBe("21 giugno 2026");
    expect(italianDate(Date.parse("2026-08-01T08:05:00Z"), true)).toBe("1º agosto 2026 · ore 08:05 UTC");
    expect(dayOfYear(Date.parse("2026-02-01T23:00:00Z"))).toBe(32);
  });
});

describe("sky time track", () => {
  const tr = track([
    { at: 0, date: "2026-03-20T00:00:00Z" },
    { at: 10, date: "2026-03-21T00:00:00Z" },
    { at: 12, date: "2026-03-21T00:00:00Z" },
    { at: 20, date: "2027-03-21T00:00:00Z" },
  ]);

  it("maps chapter time onto dates piecewise, with pauses and clamping", () => {
    expect(dateAt(tr, -5)).toBe(Date.parse("2026-03-20T00:00:00Z"));
    expect(dateAt(tr, 5)).toBe(Date.parse("2026-03-20T12:00:00Z"));
    expect(dateAt(tr, 11)).toBe(Date.parse("2026-03-21T00:00:00Z"));
    expect(dateAt(tr, 99)).toBe(Date.parse("2027-03-21T00:00:00Z"));
  });

  it("spins the Earth for real when slow, calmly when fast, exact at keys and continuous", () => {
    const real = (iso: string) => spinAt(track([{ at: 0, date: iso }]), 0);
    const mod = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(spinAt(tr, 5)).toBeCloseTo(real("2026-03-20T12:00:00Z"), 9);
    expect(mod(spinAt(tr, 20))).toBeCloseTo(mod(real("2027-03-21T00:00:00Z")), 6);
    let prev = spinAt(tr, 12);
    for (let t = 12.05; t <= 20; t += 0.05) {
      const s = spinAt(tr, t);
      expect(Math.abs(s - prev) / 0.05 / (2 * Math.PI)).toBeLessThan(MAX_SPIN * 1.3);
      prev = s;
    }
  });
});

describe("sky engine", () => {
  it("builds in Node without WebGL or canvas", async () => {
    const { engine, ctx } = await buildEngine();
    expect(ctx.root.children.length).toBe(1);
    engine.update("terra-sole", 0);
    expect(ctx.root.getObjectByName("view:earth-sun:terra-sole")!.visible).toBe(true);
    expect(ctx.root.getObjectByName("view:earth-moon:luna")!.visible).toBe(false);
  });

  it("is a pure function of (chapterId, t)", async () => {
    const { spec, engine, ctx } = await buildEngine();
    for (const ch of spec.chapters) {
      const [t1, t2] = [ch.duration * 0.31, ch.duration * 0.83];
      engine.update(ch.id, t1);
      const a = snapshot(ctx.root);
      engine.update(ch.id, t2);
      expect(snapshot(ctx.root)).not.toEqual(a);
      engine.update(spec.chapters[0]!.id === ch.id ? spec.chapters[1]!.id : spec.chapters[0]!.id, 3);
      engine.update(ch.id, t1);
      expect(snapshot(ctx.root), ch.id).toEqual(a);
    }
  });

  it("turns the night side away from the Sun and tilts the axis towards it in June", async () => {
    const { engine, ctx } = await buildEngine();
    const p = new THREE.Vector3();
    engine.update("stagioni", 18); // pause on the June solstice
    const view = ctx.root.getObjectByName("view:earth-sun:stagioni")!;
    const earth = view.getObjectByName("body:earth")!;
    const night = view.getObjectByName("night:earth")!;
    const sun = new THREE.Vector3(0, 3.4, 0);
    const away = earth.position.clone().sub(sun).normalize();
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(night.quaternion).dot(away)).toBeCloseTo(1, 6);
    // In June the Earth is on the reader's side (+z) and the north pole leans towards the Sun.
    expect(earth.position.z).toBeGreaterThan(6.5);
    engine.resolveAnchor({ entity: "earth", part: "north" }, "stagioni", 18, p);
    expect(p.clone().sub(earth.position).dot(away)).toBeLessThan(0);
    // The ray hitting the Earth head-on lands on the tropic of Cancer.
    const ray = new THREE.Vector3();
    const cancer = new THREE.Vector3();
    engine.resolveAnchor({ entity: "ray", index: 2 }, "stagioni", 18, ray);
    engine.resolveAnchor({ entity: "earth", part: "tropic-n" }, "stagioni", 18, cancer);
    expect(ray.distanceTo(cancer)).toBeLessThan(0.05);
  });

  it("follows the sliders: day of the year, tilt, hour and Moon position", async () => {
    const { engine } = await buildEngine();
    const earth = new THREE.Vector3();
    engine.update("stagioni", 3);
    const [day, tilt] = engine.params!("stagioni");
    expect(day).toMatchObject({ id: "giorno", min: 1, max: 365 });
    expect(day!.value).toBe(79); // 20 March
    expect(tilt!.value).toBeCloseTo(23.44, 2);
    engine.setParams!({ giorno: 172, asse: 0 });
    engine.update("stagioni", 3);
    engine.resolveAnchor({ entity: "earth" }, "stagioni", 3, earth);
    expect(earth.z).toBeGreaterThan(6.5); // moved to June
    const north = new THREE.Vector3();
    engine.resolveAnchor({ entity: "earth", part: "north" }, "stagioni", 3, north);
    expect(north.x - earth.x).toBeCloseTo(0, 6); // straight axis
    expect(north.z - earth.z).toBeCloseTo(0, 6);
    expect(engine.params!("stagioni").map((p) => p.value)).toEqual([172, 0]);
    engine.setParams!({ giorno: 9999 });
    expect(engine.params!("stagioni")[0]!.value).toBe(365); // clamped
    engine.setParams!(null);

    // Hour: Rome on the day side at noon UTC, on the night side at midnight.
    const rome = new THREE.Vector3();
    const side = (h: number) => {
      engine.setParams!({ ora: h });
      engine.update("terra-sole", 2);
      engine.resolveAnchor({ entity: "place", part: "roma" }, "terra-sole", 2, rome);
      engine.resolveAnchor({ entity: "earth" }, "terra-sole", 2, earth);
      return rome.clone().sub(earth).dot(new THREE.Vector3(0, 3.4, 0).sub(earth).normalize());
    };
    expect(side(11)).toBeGreaterThan(0.3);
    expect(side(23)).toBeLessThan(-0.3);

    // Moon: 180° = full moon, on the far side of the Earth from the Sun.
    engine.setParams!({ luna: 180 });
    engine.update("luna", 20);
    const moon = new THREE.Vector3();
    engine.resolveAnchor({ entity: "moon" }, "luna", 20, moon);
    expect(moon.x).toBeGreaterThan(EM_EARTH.x + 4.5);
    expect(engine.params!("luna")[0]!.value).toBe(180);
    engine.setParams!(null);
  });

  it("shows the solar eclipse of 12 August 2026 and no eclipse at an ordinary full moon", () => {
    const solar = eclipseAt(placeMoon(Date.parse("2026-08-12T17:47:00Z"), 6, null).pos);
    expect(solar.spot).not.toBeNull();
    expect(solar.solarOffset).toBeLessThan(1);
    const lunar = eclipseAt(placeMoon(Date.parse("2025-09-07T18:00:00Z"), 6, null).pos);
    expect(lunar.lunar).toBeGreaterThan(0.9);
    // Full moon of 30 June 2026, 4° below the ecliptic: it passes under the Earth's shadow.
    const missed = eclipseAt(placeMoon(Date.parse("2026-06-30T00:00:00Z"), 6, null).pos);
    expect(missed.lunar).toBe(0);
    // Same sides as the phase names: elongation 90° puts the Moon on the reader's side.
    const fq = placeMoon(Date.parse("2026-07-21T11:00:00Z"), 6, null);
    expect(Math.abs(fq.elongation - 90)).toBeLessThan(12);
    expect(fq.pos.z - EM_EARTH.z).toBeGreaterThan(4);
  });

  it("lights the phase window like the view from Earth (first quarter: right half lit)", async () => {
    const { engine, ctx } = await buildEngine();
    engine.setParams!({ luna: 90 });
    engine.update("luna", 30);
    const cap = ctx.root.getObjectByName("night:phase-moon")!;
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cap.quaternion);
    expect(dir.x).toBeLessThan(-0.85); // dark on the left
    engine.setParams!(null);
  });

  it("resolves every entity anchor used by pins and camera keys", async () => {
    const { spec, engine, ctx } = await buildEngine();
    const b = engine.bounds();
    for (const ch of spec.chapters) {
      for (const t of [0, ch.duration / 2, ch.duration]) {
        engine.update(ch.id, t);
        for (const a of [...ch.pins.map((p) => p.anchor), ...ch.camera.map((k) => k.target)]) {
          const out = new THREE.Vector3(NaN, NaN, NaN);
          expect(engine.resolveAnchor(a, ch.id, t, out), `${ch.id} ${JSON.stringify(a)}`).toBe(true);
          expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
          expect(out.distanceTo(b.center)).toBeLessThan(b.radius * 1.1);
        }
      }
    }
    expect(engine.resolveAnchor({ entity: "jupiter" }, "luna", 0, new THREE.Vector3())).toBe(false);
    // Highlighted elements keep their colours in ink style.
    engine.update("stagioni", 18);
    expect(ctx.root.getObjectByName("rays")!.userData.key).toBe(true);
    expect(ctx.root.getObjectByName("view:earth-sun:stagioni")!.getObjectByName("latitudes")!.userData.key).toBe(true);
    engine.update("stagioni", 40);
    expect(ctx.root.getObjectByName("view:earth-sun:stagioni")!.getObjectByName("latitudes")!.userData.key).toBe(false);
  });

  it("draws a heliocentric system and constellations from data", async () => {
    const json = raw();
    json.engineData.constellations = [
      { id: "test", stars: [{ ra: 1, dec: 10 }, { ra: 2, dec: 20, mag: 1 }, { ra: 3, dec: 15 }], lines: [[0, 1], [1, 2]], sourceIds: ["page"] },
    ];
    Object.assign(json.engineData.chapters[0], { view: "system", bodies: ["mercury", "venus", "earth", "mars", "jupiter"], distances: "compressed", constellations: ["test"], latitudes: undefined, params: [{ id: "giorno1", kind: "day" }] });
    json.chapters[0].activity.test.params = ["giorno1"];
    json.chapters[0].pins = [{ id: "giove", name: "Giove", info: "Il pianeta più grande.", kind: "object", anchor: { entity: "jupiter" }, sourceIds: ["page"] }];
    json.chapters[0].camera = [{ at: 0, target: { entity: "constellation", part: "test", index: 1 }, distance: 20, azimuth: 0, elevation: 30 }];
    json.chapters[0].quiz = [];
    const { spec, engine, ctx } = await buildEngine(json);
    if (spec.engine !== "sky") throw new Error("unreachable");
    expect(checkSkyData(spec.engineData, spec)).toEqual([]);
    engine.update("terra-sole", 0);
    const view = ctx.root.getObjectByName("view:system:terra-sole")!;
    expect(view.visible).toBe(true);
    expect(ctx.root.getObjectByName("constellation:test")!.visible).toBe(true);
    const sun = new THREE.Vector3(0, 3.4, 0);
    const dist = (n: string) => view.getObjectByName(`body:${n}`)!.position.distanceTo(sun);
    expect(dist("mercury")).toBeLessThan(dist("venus"));
    expect(dist("mars")).toBeLessThan(dist("jupiter"));
    expect(dist("jupiter")).toBeLessThanOrEqual(9.01);
    expect(dist("mercury")).toBeGreaterThan(1.2); // outside the Sun even when compressed
    const star = new THREE.Vector3();
    expect(engine.resolveAnchor({ entity: "constellation", part: "test", index: 1 }, "terra-sole", 0, star)).toBe(true);
    expect(Math.hypot(star.x, star.z)).toBeGreaterThan(9.5); // on the backdrop
    engine.update("stagioni", 0);
    expect(ctx.root.getObjectByName("constellation:test")!.visible).toBe(false);
  });

  it("reports stable bounds that contain the stage and cleans up on dispose", async () => {
    const { engine, ctx } = await buildEngine();
    const b = engine.bounds();
    engine.update("luna", 44);
    // Plate rim and backdrop top corners lie inside the bounding sphere.
    for (const a of [0, 1.4, Math.PI / 2, Math.PI, 4.2]) expect(new THREE.Vector3(10 * Math.sin(a), 0, 10 * Math.cos(a)).distanceTo(b.center)).toBeLessThanOrEqual(b.radius);
    for (const a of [Math.PI - 1.4, Math.PI + 1.4]) expect(new THREE.Vector3(10 * Math.sin(a), 9, 10 * Math.cos(a)).distanceTo(b.center)).toBeLessThanOrEqual(b.radius);
    expect(engine.bounds()).toEqual(b);
    const s = skyState(SkyData.parse(raw().engineData).chapters[0]!, track([{ at: 0, date: "2026-01-01T00:00:00Z" }]), 0, {});
    expect(s.tilt).toBeCloseTo(23.44, 2);
    engine.dispose();
    expect(ctx.root.children.length).toBe(0);
    expect(ctx.scene.children.length).toBe(0);
  });
});
