// @vitest-environment happy-dom
// The "Esporta" menu: both formats, progress, size warning, server-down message, default fetcher mapping.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SceneSpec } from "@pv/scene-spec";
import { setUiLanguage, t } from "@pv/scene-spec/i18n";
import { SIZE_WARN_BYTES, type Fetcher } from "../src/export/collect.ts";
import { appFetcher, exportMenu, formatSize } from "../src/export/menu.ts";
import { RUNTIME_CSS, RUNTIME_JS, RUNTIME_MARKER } from "../src/export/payload.ts";

const enc = new TextEncoder();
const PUBLIC = `${import.meta.dirname}/../../../fixtures/public/`;
// "campania" is left out of the public copy (tools/publish/exclude.txt): fall back to another map scene with terrain.
// Sample map scene; both are left out of the public copy (tools/publish/exclude.txt), so the tests
// that need one skip when neither is present.
const SAMPLE = ["campania", "_dev-routes"].find((n) => existsSync(PUBLIC + `scenes/${n}.scene.json`));
const base = (SAMPLE ? JSON.parse(readFileSync(PUBLIC + `scenes/${SAMPLE}.scene.json`, "utf8")) : {}) as SceneSpec;
const spec = { ...base, title: "Battaglia di Canne" } as SceneSpec;
const okFetch: Fetcher = async (p) => (p === RUNTIME_JS ? enc.encode(`${RUNTIME_MARKER}/*js*/`) : p === RUNTIME_CSS ? enc.encode("/*css*/") : new Uint8Array(readFileSync(PUBLIC + p.replace(/^\//, ""))));
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const settle = () => new Promise((r) => setTimeout(r, 20));

describe.skipIf(!SAMPLE)("exportMenu", () => {
  it("offers both formats", () => {
    const m = exportMenu(spec, { fetch: okFetch, download: () => {} });
    expect(button(m, t("export.html"))).toBeTruthy();
    expect(button(m, t("export.wgt"))).toBeTruthy();
  });

  it("downloads a .html named from the title", async () => {
    const download = vi.fn();
    const m = exportMenu(spec, { fetch: okFetch, download });
    button(m, t("export.html")).click();
    await settle();
    expect(download).toHaveBeenCalledTimes(1);
    const [name, blob] = download.mock.calls[0] as [string, Blob];
    expect(name).toBe("battaglia-di-canne.html");
    expect(blob.type).toContain("text/html");
    expect(m.textContent).toContain("battaglia-di-canne.html");
  });

  it("downloads a .wgt", async () => {
    const download = vi.fn();
    const m = exportMenu(spec, { fetch: okFetch, download });
    button(m, t("export.wgt")).click();
    await settle();
    expect((download.mock.calls[0] as [string])[0]).toBe("battaglia-di-canne.wgt");
  });

  it("shows serverDown on ExportError server", async () => {
    const art = JSON.parse(readFileSync(PUBLIC + "scenes/gen-art_primavera-botticelli.scene.json", "utf8")) as SceneSpec;
    const fetch: Fetcher = async (p) => {
      if (p.startsWith("/cache/")) throw new TypeError("Failed to fetch");
      return okFetch(p);
    };
    const download = vi.fn();
    const m = exportMenu(art, { fetch, download });
    button(m, t("export.html")).click();
    await settle();
    expect(m.textContent).toContain(t("export.serverDown"));
    expect(download).not.toHaveBeenCalled();
  });

  it("warns above 30 MB", async () => {
    const fetch: Fetcher = async (p) => (p === RUNTIME_JS ? new Uint8Array([...enc.encode(RUNTIME_MARKER), ...new Uint8Array(SIZE_WARN_BYTES + 1024)]) : okFetch(p));
    const m = exportMenu(spec, { fetch, download: () => {} });
    button(m, t("export.html")).click();
    await settle();
    expect(m.textContent).toMatch(/Il file è grande \(\d+(,\d+)? MB\)/);
    expect(m.textContent).not.toContain("{size}");
  });
});

describe("formatSize", () => {
  it("shows kB below 1024 kB and MB from there, with the UI's decimal mark", () => {
    expect(formatSize(10)).toBe("1 kB");
    expect(formatSize(340 * 1024)).toBe("340 kB");
    expect(formatSize(1023 * 1024)).toBe("1023 kB");
    // Rounds to 1024 kB: never printed as "1024 kB".
    expect(formatSize(1024 * 1024 - 1)).toBe("1,0 MB");
    expect(formatSize(1.4 * 1024 * 1024)).toBe("1,4 MB");
    setUiLanguage("en");
    try {
      expect(formatSize(1.4 * 1024 * 1024)).toBe("1.4 MB");
    } finally {
      setUiLanguage("it");
    }
  });
});

describe("appFetcher", () => {
  const reply = (status: number) => vi.fn(async () => new Response(status === 200 ? "ab" : "no", { status }));
  it("maps an unreachable server on /cache/ to TypeError, other failures to Error", async () => {
    vi.stubGlobal("fetch", reply(502));
    await expect(appFetcher("/cache/a.glb")).rejects.toBeInstanceOf(TypeError);
    vi.stubGlobal("fetch", reply(504));
    await expect(appFetcher("/cache/a.glb")).rejects.toBeInstanceOf(TypeError);
    vi.stubGlobal("fetch", reply(502));
    const e = await appFetcher("/models/a.glb").catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(TypeError);
    expect((e as Error).message).toContain("502");
    vi.stubGlobal("fetch", reply(404));
    const e2 = await appFetcher("/cache/a.glb").catch((x: unknown) => x);
    expect(e2).not.toBeInstanceOf(TypeError);
    vi.stubGlobal("fetch", reply(200));
    expect([...(await appFetcher("/models/a.glb"))]).toEqual([97, 98]);
    vi.unstubAllGlobals();
  });

  it("rejects an HTML answer (SPA fallback) for a path that is not .html, naming the path", async () => {
    const html = vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", html);
    for (const path of ["export/runtime.js", "models/x.glb"]) {
      const e = await appFetcher(path).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(TypeError);
      expect((e as Error).message).toContain(path);
    }
    expect([...(await appFetcher("pages/a.html"))].length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});
