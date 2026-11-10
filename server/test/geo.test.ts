// Geo context for map scenes: area choice from the recorded analyses, bbox/zoom/grid, asset paths.
// Offline: the gazetteer and the pre-built assets are committed. The live test skips itself
// unless PAGINAVIVA_MODE=live.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PageAnalysis } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { chooseGridWidth, chooseZoom, frame, PRESETS, selectArea, sizeKm, suggestedExaggeration } from "../src/geo/areas.ts";
import { FIXTURE_GEO_DIR, geoContextFor } from "../src/geo/context.ts";
import { norm, loadGazetteer } from "../src/geo/gazetteer.ts";
import { wikidataPoint } from "../src/geo/geocode.ts";
import { tileRange } from "../src/geo/terrarium.ts";
import { sharedBorders, touches, type Pt } from "../src/geo/vector.ts";

const LLM = resolve(import.meta.dirname, "../../fixtures/llm");
const PUBLIC = resolve(import.meta.dirname, "../../fixtures/public");
const page = (label: string): PageAnalysis => {
  const file = readdirSync(LLM).find((f) => f.startsWith(label + "."))!;
  return PageAnalysis.parse(JSON.parse(readFileSync(join(LLM, file), "utf8")).response.data);
};
const gaz = loadGazetteer();
// Recorded analyses of the protected book pages are left out of the public copy (tools/publish/exclude.txt):
// the tests that read them skip when they are absent.
const haveRecordings = ["geografia_campania_p84", "storia_germani-fine-impero_p116-117", "grammatica_modo-indicativo_p44", "racconto_elettricista-pasticcione", "scienze_sensi_p38-39"].every(
  (l) => readdirSync(LLM).some((f) => f.startsWith(l + ".")),
);

describe("gazetteer", () => {
  it("normalises names and resolves Italian, English and historical names", () => {
    expect(norm("L'Italia")).toBe("italia");
    expect(norm("Mare Adriatico")).toBe("mar adriatico");
    expect(gaz.lookup("Campania").places[0]).toMatchObject({ name: "Campania", kind: "it-region" });
    expect(gaz.lookup("Mar Tirreno").places[0]!.kind).toBe("sea");
    expect(gaz.lookup("SPAGNA").places[0]).toMatchObject({ name: "Spagna", kind: "country" });
    expect(gaz.lookup("Gallia").places.map((p) => p.name)).toEqual(["Francia"]);
    expect(gaz.lookup("Italia settentrionale").places).toHaveLength(8);
    expect(gaz.lookup("Africa")).toMatchObject({ soft: true });
    expect(gaz.lookup("tangenziale").places).toEqual([]);
  });
});

describe("area selection from the recorded analyses", () => {
  it.skipIf(!haveRecordings)("Campania -> the hand-made Campania preset", () => {
    const { plan } = selectArea(page("geografia_campania_p84"), gaz);
    expect(plan).toEqual(PRESETS.campania);
  });

  it.skipIf(!haveRecordings)("Germani -> Europe, Mediterranean and North Africa, country borders, no focus", () => {
    const { plan } = selectArea(page("storia_germani-fine-impero_p116-117"), gaz);
    expect(plan).toBeDefined();
    const b = plan!.bbox;
    expect(plan!.focus).toBeUndefined();
    expect(plan!.boundaries).toBe("ne-countries");
    // Spain and Britain to the Caspian, Egypt to the North Sea.
    expect(b.lonMin).toBeLessThan(-9.3);
    expect(b.lonMax).toBeGreaterThan(54);
    expect(b.latMin).toBeLessThan(22);
    expect(b.latMax).toBeGreaterThan(58);
    // ...but not the whole of Africa or Asia (soft names do not stretch the map).
    expect(b.latMin).toBeGreaterThan(10);
    expect(b.lonMax).toBeLessThan(70);
    expect(plan!.zoom).toBeGreaterThanOrEqual(4);
    expect(plan!.zoom).toBeLessThanOrEqual(5);
    expect(plan!.key).toBe("area_m14_19_58_64");
  });

  it.skipIf(!haveRecordings).each(["grammatica_modo-indicativo_p44", "racconto_elettricista-pasticcione", "scienze_sensi_p38-39"])("%s -> no map", (label) => {
    expect(selectArea(page(label), gaz).plan).toBeUndefined();
  });

  it.skipIf(!haveRecordings)("an unreadable page gets no map", () => {
    expect(selectArea({ ...page("geografia_campania_p84"), readable: false }, gaz).plan).toBeUndefined();
  });

  it.skipIf(!haveRecordings)("a country page focuses on the country, with its neighbours' boundaries", () => {
    const a = { ...page("geografia_campania_p84"), topic: "La Francia", entities: [{ name: "Francia", type: "place" as const, onPage: true as const }] };
    const { plan } = selectArea(a, gaz);
    expect(plan).toMatchObject({ key: "francia", focus: { name: "Francia", kind: "country" }, boundaries: "ne-countries", rivers: "ne10" });
  });
});

describe("bbox, zoom and grid", () => {
  it("chooses zoom ~10 for a region and 4-5 for Europe, never more than 64 tiles", () => {
    const campania = PRESETS.campania!.bbox;
    expect(chooseZoom(campania, 256)).toBe(10);
    const europe = { lonMin: -14, lonMax: 58, latMin: 19, latMax: 64 };
    expect(chooseZoom(europe, 384)).toBe(5);
    const world = { lonMin: -180, lonMax: 180, latMin: -60, latMax: 80 };
    expect(tileRange(world, chooseZoom(world, 384)).count).toBeLessThanOrEqual(64);
  });

  it("caps the grid: 256 nodes for regions, 384 for large areas, fewer across tall areas", () => {
    expect(chooseGridWidth(PRESETS.campania!.bbox)).toBe(256);
    expect(chooseGridWidth({ lonMin: -14, lonMax: 58, latMin: 19, latMax: 64 })).toBe(384);
    expect(chooseGridWidth({ lonMin: 6, lonMax: 19, latMin: 36, latMax: 47.5 })).toBeLessThan(384);
  });

  it("frames with a margin, a sane aspect ratio and rounded edges", () => {
    const b = frame([10, 40, 11, 41]);
    expect(b.lonMin).toBeLessThan(10);
    expect(b.latMax).toBeGreaterThan(41);
    for (const v of Object.values(b)) expect(Math.abs(v * 20 - Math.round(v * 20))).toBeLessThan(1e-9);
    const thin = frame([0, 40, 30, 41]);
    const { w, h } = sizeKm(thin);
    expect(w / h).toBeLessThanOrEqual(2.05);
  });

  it("suggests the exaggeration: 10 for Campania, the maximum for a continent", () => {
    expect(suggestedExaggeration(PRESETS.campania!.bbox)).toBe(10);
    expect(suggestedExaggeration({ lonMin: -14, lonMax: 58, latMin: 19, latMax: 64 })).toBe(50);
  });
});

describe("vector helpers", () => {
  const sq = (x: number): Pt[] => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]];
  it("finds the shared border of two touching polygons", () => {
    const lines = sharedBorders([[sq(0)], [sq(1)], [sq(5)]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.map((p) => p[0])).toEqual([1, 1]);
    expect(touches([sq(0)], [sq(1)], 0.01, 1, 2)).toBe(true);
    expect(touches([sq(0)], [sq(5)], 0.01, 1)).toBe(false);
  });
});

describe("geoContextFor", () => {
  it.skipIf(!haveRecordings)("mock: Campania reproduces the hand-made context", async () => {
    const ctx = await geoContextFor(page("geografia_campania_p84"), { mode: "mock" });
    expect(ctx).toMatchObject({
      bbox: { lonMin: 13.65, lonMax: 15.9, latMin: 39.9, latMax: 41.6 },
      terrainAsset: "/geo/campania/terrain.json",
      boundariesAsset: "/geo/campania/regions.geojson",
      riversAsset: "/geo/campania/rivers.geojson",
      focus: "Campania",
      neighbors: ["Lazio", "Molise", "Puglia", "Basilicata"],
    });
    expect(ctx!.sources.map((s) => s.id)).toEqual(["data-terrain", "data-istat", "data-osm"]);
    // Same assets as the existing scene.
    const scene = JSON.parse(readFileSync(join(PUBLIC, "scenes/campania.scene.json"), "utf8"));
    expect("/" + scene.engineData.terrain.asset).toBe(ctx!.terrainAsset);
    expect(scene.engineData.boundaries.neighbors).toEqual(ctx!.neighbors);
  });

  it.skipIf(!haveRecordings)("mock: Germani -> pre-built Europe assets, country borders, Natural Earth cited", async () => {
    const ctx = await geoContextFor(page("storia_germani-fine-impero_p116-117"), { mode: "mock" });
    expect(ctx).toBeDefined();
    expect(ctx!.focus).toBe("");
    expect(ctx!.neighbors).toEqual([]);
    expect(ctx!.terrainAsset).toBe("/geo/area_m14_19_58_64/terrain.json");
    expect(ctx!.sources.map((s) => s.id)).toEqual(["data-terrain", "data-naturalearth"]);
    for (const p of [ctx!.terrainAsset, ctx!.boundariesAsset, ctx!.riversAsset!]) expect(existsSync(join(PUBLIC, p))).toBe(true);
    const header = JSON.parse(readFileSync(join(PUBLIC, ctx!.terrainAsset), "utf8"));
    expect(header.bbox).toEqual(ctx!.bbox);
    expect(header.width).toBeLessThanOrEqual(384);
    const fc = JSON.parse(readFileSync(join(PUBLIC, ctx!.boundariesAsset), "utf8"));
    const names = fc.features.map((f: { properties: { name?: string } }) => f.properties.name);
    for (const n of ["Italia", "Spagna", "Francia", "Egitto", "Turchia", "Regno Unito"]) expect(names).toContain(n);
    expect(fc.features.some((f: { properties: { kind?: string } }) => f.properties.kind === "border")).toBe(true);
  });

  it.skipIf(!haveRecordings).each(["grammatica_modo-indicativo_p44", "racconto_elettricista-pasticcione", "scienze_sensi_p38-39"])("mock: %s -> undefined", async (label) => {
    expect(await geoContextFor(page(label), { mode: "mock" })).toBeUndefined();
  });

  it.skipIf(!haveRecordings)("live: reuses assets already built in the output dir (no network), paths under /cache/geo", async () => {
    const out = mkdtempSync(join(tmpdir(), "pv-geo-"));
    cpSync(join(FIXTURE_GEO_DIR, "campania"), join(out, "campania"), { recursive: true });
    const ctx = await geoContextFor(page("geografia_campania_p84"), { mode: "live", outDir: out });
    expect(ctx!.terrainAsset).toBe("/cache/geo/campania/terrain.json");
    expect(ctx!.riversAsset).toBe("/cache/geo/campania/rivers.geojson");
  });

  it.skipIf(process.env.PAGINAVIVA_MODE !== "live")("live: geocodes a place with Wikidata P625", async () => {
    const p = await wikidataPoint("Roma");
    expect(p!.lon).toBeGreaterThan(12.3);
    expect(p!.lon).toBeLessThan(12.7);
    expect(p!.lat).toBeGreaterThan(41.7);
    expect(p!.lat).toBeLessThan(42.1);
  });
});
