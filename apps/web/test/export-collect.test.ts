import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assetsOf, type Presentation } from "@pv/engine";
import type { SceneSpec } from "@pv/scene-spec";
import { collectExport, exportFileName, ExportError, type Fetcher } from "../src/export/collect.ts";
import { RUNTIME_CSS, RUNTIME_JS, RUNTIME_MARKER } from "../src/export/payload.ts";

const PUBLIC = fileURLToPath(new URL("../../../fixtures/public/", import.meta.url));
// "campania" is left out of the public copy (tools/publish/exclude.txt): fall back to another map scene with terrain.
// Sample map scene; both are left out of the public copy (tools/publish/exclude.txt), so the tests
// that need one skip when neither is present.
const SAMPLE = ["campania", "_dev-routes"].find((n) => existsSync(PUBLIC + `scenes/${n}.scene.json`));
const enc = new TextEncoder();

const diskFetch: Fetcher = async (path) => {
  if (path === RUNTIME_JS) return enc.encode(`${RUNTIME_MARKER}/*js*/`);
  if (path === RUNTIME_CSS) return enc.encode("/*css*/");
  return new Uint8Array(await readFile(PUBLIC + path.replace(/^\//, "")));
};
const deps = (fetch: Fetcher) => ({ fetch, uiLang: "it", catalog: null, presentation: { mode: "lesson" } as unknown as Presentation, app: "AnimaPage test" });

describe.skipIf(!SAMPLE)("collectExport", () => {
  it("collects runtime, scene assets and terrain grid", async () => {
    const spec = JSON.parse(await readFile(PUBLIC + `scenes/${SAMPLE}.scene.json`, "utf8")) as SceneSpec;
    const input = await collectExport(spec, deps(diskFetch));
    expect(input.runtimeJs).toBe(`${RUNTIME_MARKER}/*js*/`);
    expect(input.runtimeCss).toBe("/*css*/");
    expect(input.title).toBe(spec.title);
    const { files, terrainHeaders } = assetsOf(spec);
    expect(terrainHeaders.length).toBeGreaterThan(0);
    for (const f of files) expect(input.payload.assets).toHaveProperty([f]);
    const header = JSON.parse(Buffer.from(input.payload.assets[terrainHeaders[0]!]!, "base64").toString("utf8")) as { data: string };
    const dir = terrainHeaders[0]!.slice(0, terrainHeaders[0]!.lastIndexOf("/") + 1);
    expect(input.payload.assets).toHaveProperty([dir + header.data]);
    expect(Buffer.from(input.payload.assets[dir + header.data]!, "base64").equals(await readFile(PUBLIC + dir + header.data))).toBe(true);
    expect(input.payload.spec).toBe(spec);
  });

  it('collectExport rejects with kind "server" when an asset fetch fails with a network error', async () => {
    const spec = JSON.parse(await readFile(PUBLIC + `scenes/${SAMPLE}.scene.json`, "utf8")) as SceneSpec;
    const art = {
      ...spec,
      engine: "art",
      engineData: { artwork: { image: { asset: "/cache/art/Q1/x.jpg" } } },
    } as unknown as SceneSpec;
    const f: Fetcher = async (p) => {
      if (p.startsWith("/cache/")) throw new TypeError("Failed to fetch");
      return diskFetch(p);
    };
    await expect(collectExport(art, deps(f))).rejects.toMatchObject({ name: "ExportError", kind: "server" });
  });

  it("maps runtime failures to kind runtime and other failures to asset with the path", async () => {
    const spec = JSON.parse(await readFile(PUBLIC + `scenes/${SAMPLE}.scene.json`, "utf8")) as SceneSpec;
    const noRuntime: Fetcher = async (p) => (p === RUNTIME_JS ? Promise.reject(new Error("404")) : diskFetch(p));
    await expect(collectExport(spec, deps(noRuntime))).rejects.toMatchObject({ kind: "runtime" });
    const bad: Fetcher = async (p) => (p.endsWith(".ogg") ? Promise.reject(new Error("404")) : diskFetch(p));
    const err = await collectExport(spec, deps(bad)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect((err as ExportError).kind).toBe("asset");
    expect((err as ExportError).message).toContain(".ogg");
  });

  it('rejects with kind "runtime" when the runtime is not the built one (SPA fallback HTML)', async () => {
    const spec = JSON.parse(await readFile(PUBLIC + `scenes/${SAMPLE}.scene.json`, "utf8")) as SceneSpec;
    const spa: Fetcher = async (p) => (p === RUNTIME_JS ? enc.encode("<!doctype html><html><body><div id=app></div></body></html>") : diskFetch(p));
    const err = await collectExport(spec, deps(spa)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect((err as ExportError).kind).toBe("runtime");
    expect((err as ExportError).message).toContain(RUNTIME_JS);
  });
});

describe("exportFileName", () => {
  it("slugifies titles", () => {
    expect(exportFileName("Battaglia di Canne", "html")).toBe("battaglia-di-canne.html");
    expect(exportFileName("Perché è così?", "wgt")).toBe("perche-e-cosi.wgt");
    expect(exportFileName("a".repeat(100), "html")).toBe("a".repeat(60) + ".html");
    expect(exportFileName("  ?!  ", "html")).toBe("lezione.html");
    expect(exportFileName("", "wgt")).toBe("lezione.wgt");
    expect(exportFileName("ab ".repeat(30), "html")).not.toMatch(/-\.html$/);
  });
});
