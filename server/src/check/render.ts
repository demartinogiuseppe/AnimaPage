// Headless render of a generated scene for the visual check (server/src/check/index.ts).
//
// Uses the Chrome installed on the PC through playwright-core (`channel: "chrome"`, no browser
// download) and the web player served by the Vite dev server (PAGINAVIVA_WEB_URL) in its render
// mode: apps/web/src/render.ts (`?render=1`). The scene is handed to the page script, never written
// to disk; screenshots stay in memory. On Windows WebGL runs on the GPU through ANGLE/D3D11 also
// headless (checked 2026-11: "ANGLE (NVIDIA ..., Direct3D11 ...)").
import type { SceneSpec } from "@pv/scene-spec";
import { chromium, type Browser } from "playwright-core";

export const DEFAULT_WEB_URL = "http://localhost:5173";
export const VIEWPORT = { width: 960, height: 600 } as const;
export const JPEG_QUALITY = 70;
/** Above this many chapters, one picture per chapter instead of two. */
const TWO_SHOTS_MAX_CHAPTERS = 5;

export interface ShotPlan {
  chapterId: string;
  /** Seconds into the chapter. */
  t: number;
  moment: "middle" | "end";
}

export interface Shot extends ShotPlan {
  jpeg: Buffer;
}

export interface RenderOptions {
  webUrl?: string;
  /** Aborting closes the browser (the check's time cap). */
  signal?: AbortSignal;
}

/** About two pictures per chapter: the middle of the narration and just before the end. */
export function shotPlan(scene: SceneSpec): ShotPlan[] {
  const two = scene.chapters.length <= TWO_SHOTS_MAX_CHAPTERS;
  return scene.chapters.flatMap((c): ShotPlan[] => {
    const end = { chapterId: c.id, t: Math.max(0, Math.round((c.duration - 0.4) * 10) / 10), moment: "end" as const };
    if (!two) return [end];
    return [{ chapterId: c.id, t: Math.round(c.duration * 5) / 10, moment: "middle" }, end];
  });
}

type RenderApi = {
  mount(spec: unknown): Promise<{ ok: boolean; error?: string }>;
  shot(chapterId: string, t: number): Promise<{ ok: boolean; error?: string }>;
};

/**
 * Requests the check's Chrome may make (docs/security.md, M2): the web app's own origin and inline data only,
 * so a scene cannot make it reach the internet, the LAN or other local ports.
 */
export function allowedRequest(url: string, base: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

export async function renderScene(scene: SceneSpec, opts: RenderOptions = {}): Promise<Shot[]> {
  const base = (opts.webUrl || DEFAULT_WEB_URL).replace(/\/+$/, "");
  let browser: Browser | undefined;
  const onAbort = () => void browser?.close().catch(() => {});
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      // Playwright adds --no-sandbox unless asked: the scene comes from a model that read an untrusted page.
      chromiumSandbox: true,
      args: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--ignore-gpu-blocklist", "--mute-audio"],
    });
    if (opts.signal?.aborted) throw new Error("aborted");
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "no-preference" });
    await page.route("**/*", (route) => (allowedRequest(route.request().url(), base) ? route.continue() : route.abort("blockedbyclient")));
    await page.goto(`${base}/?render=1`, { waitUntil: "load", timeout: 20_000 });
    await page.waitForFunction(() => document.documentElement.dataset.pvRender === "ready", undefined, { timeout: 20_000 });
    const mounted = await page.evaluate((s) => (window as unknown as { pvRender: RenderApi }).pvRender.mount(s), scene as unknown);
    if (!mounted.ok) throw new Error(`render mount failed: ${mounted.error ?? "?"}`);
    if (await page.locator(".pv-fail").count()) throw new Error(`3D stage unavailable: ${await page.locator(".pv-fail").first().textContent()}`);

    const shots: Shot[] = [];
    for (const p of shotPlan(scene)) {
      const r = await page.evaluate(([id, t]) => (window as unknown as { pvRender: RenderApi }).pvRender.shot(id, t), [p.chapterId, p.t] as const);
      if (!r.ok) throw new Error(`render shot failed: ${r.error ?? "?"}`);
      shots.push({ ...p, jpeg: await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY }) });
    }
    return shots;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await browser?.close().catch(() => {});
  }
}
