// `pnpm export:e2e`: the offline end-to-end check of exported lessons. Exports every reference scene
// of fixtures/public/scenes to a single .html file (plus one OpenBoard .wgt and one lesson in a UI
// language without a built-in catalog), opens each in headless Chrome with every non-file: request
// blocked, and checks that the lesson really works. Needs Chrome (playwright-core, channel "chrome"),
// so it is not part of `pnpm test`. Exit code 0 when every file passes or is skipped, at least one
// file was checked, at most MAX_SKIPPED scenes were skipped, and the chapter chip, the quiz and the
// activity were each exercised by at least one file. Every file must also have the app's layout: the
// player fits the window and the page itself does not scroll. One formula lesson is also exported in
// the Accademico presentation (D24).
//
//   pnpm export:e2e            every scene
//   pnpm export:e2e troia      only the scenes whose name contains "troia"
//
// Assets come from fixtures/public; `/cache/<x>` (server-side art images) from server/.cache/<x> when
// it is on disk, else the scene is skipped ("no server cache"). Nothing else is read from server/.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decode } from "fast-png";
import { resolvePresentation, sceneKey, type Presentation } from "@pv/engine";
import { SceneSpec } from "@pv/scene-spec";
import { ENGLISH, type Catalog } from "@pv/scene-spec/i18n";
import { assembleHtml } from "../src/export/assemble.ts";
import { collectExport, ExportError, type Fetcher } from "../src/export/collect.ts";
import { buildWgt } from "../src/export/wgt.ts";
import { readStoredZip } from "../src/export/zip-read.ts";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const PUBLIC = join(ROOT, "fixtures/public");
const SERVER_CACHE = join(ROOT, "server/.cache");
const OUT = join(tmpdir(), "animapage-export-e2e");
// playwright-core is a dependency of the server package (server/src/check/render.ts); load it from there.
const { chromium } = createRequire(join(ROOT, "server/package.json"))("playwright-core") as typeof import("playwright-core");
type Page = import("playwright-core").Page;
type BrowserContext = import("playwright-core").BrowserContext;

const READY_MS = 20_000;
/** Luma variance (0..255 scale) a non-blank stage screenshot must exceed. */
const MIN_VARIANCE = 20;
const JA_RESTART = "最初から";
/** More skipped scenes than this (no server cache) fails the run: it would check too little. */
const MAX_SKIPPED = 2;
/** Formula lesson also exported in the Accademico presentation (D24). */
const ACADEMIC_SCENE = "matematica-parabola";

/** Thrown for a missing /cache file: collect turns a TypeError on /cache/ into ExportError "server". */
class NoServerCache extends TypeError {}

function inside(dir: string, file: string): string {
  const full = resolve(dir, file);
  if (!full.startsWith(dir + sep)) throw new Error(`path outside ${dir}: ${file}`);
  return full;
}

const diskFetcher: Fetcher = async (path) => {
  const rel = path.replace(/^\/+/, "");
  if (rel.startsWith("cache/")) {
    const file = inside(SERVER_CACHE, rel.slice("cache/".length));
    if (!existsSync(file)) throw new NoServerCache(`not in server/.cache`);
    return new Uint8Array(readFileSync(file));
  }
  return new Uint8Array(readFileSync(inside(PUBLIC, rel)));
};

interface Job {
  name: string;
  file: string;
  spec: SceneSpec;
  /** Extra check: this text must be shown (UI language without a built-in catalog). */
  expectText?: string;
  /** Extra check: an element matching this selector must exist (the Accademico presentation). */
  expectSelector?: string;
}

interface Row {
  name: string;
  size: string;
  result: "pass" | "fail" | "skip";
  detail: string;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`);

async function exportHtml(spec: SceneSpec, uiLang = "it", catalog: Catalog | null = null, presentation?: Presentation): Promise<string> {
  const input = await collectExport(spec, {
    fetch: diskFetcher,
    uiLang,
    catalog,
    presentation: presentation ?? resolvePresentation("auto", spec),
    app: "AnimaPage e2e",
  });
  return assembleHtml(input);
}

/** Luma variance of a PNG screenshot. */
function variance(png: Buffer): number {
  const img = decode(png);
  const ch = img.channels;
  const d = img.data;
  let sum = 0;
  let sq = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const y = 0.299 * d[i * ch]! + 0.587 * d[i * ch + 1]! + 0.114 * d[i * ch + 2]!;
    sum += y;
    sq += y * y;
  }
  const mean = sum / n;
  return sq / n - mean * mean;
}

/** Clicks the chapter chip of `id` (if it is not the active one) and waits until it is active. */
async function goChapter(page: Page, spec: SceneSpec, id: string): Promise<void> {
  const i = spec.chapters.findIndex((c) => c.id === id);
  const chip = page.locator(".pv-chips > button").nth(i);
  if ((await chip.getAttribute("aria-current")) === "true") return;
  await chip.click({ timeout: 5000 });
  await page.waitForFunction((k) => document.querySelectorAll(".pv-chips > button")[k]?.getAttribute("aria-current") === "true", i, { timeout: 5000 });
}

interface Checked {
  problems: string[];
  /** What was checked, for the table. */
  done: string[];
}

/** In-memory URLs the page makes itself (blob: workers, data: images and fonts): allowed, never counted. */
const inMemory = (url: string) => url.startsWith("data:") || url.startsWith("blob:");

/** Pretends this device can start an immersive-ar session (what ar-mode.ts asks), so a lesson that
 * wrongly shows the AR button in an exported file is caught in headless Chrome too. A string, not a
 * function: tsx would add helper calls (__name) to a function body that do not exist in the page. */
const FAKE_WEBXR = `Object.defineProperty(navigator, "xr", {
  configurable: true,
  value: {
    isSessionSupported: async (mode) => mode === "immersive-ar",
    requestSession: async () => { throw new Error("fake WebXR: no session"); },
    addEventListener() {},
    removeEventListener() {},
  },
});`;

async function checkFile(context: BrowserContext, job: Job): Promise<Checked> {
  const problems: string[] = [];
  const done: string[] = [];
  const blocked = new Set<string>();
  const stray = new Set<string>();
  const errors: string[] = [];
  const self = pathToFileURL(job.file).href;
  // Routing, recording and console capture are per context, so popups, new pages and workers are covered.
  await context.addInitScript({ content: FAKE_WEBXR });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:")) {
      // The lesson must not need any file next to it either.
      if (url !== self) stray.add(url);
      return route.continue();
    }
    if (inMemory(url)) return route.continue();
    blocked.add(url);
    return route.abort();
  });
  await context.routeWebSocket(/.*/, (ws) => {
    blocked.add(ws.url());
    return ws.close();
  });
  // Cross-check of the route: every request the context sees, also one a route would have missed.
  context.on("request", (r) => {
    const url = r.url();
    if (inMemory(url)) return;
    if (!url.startsWith("file:")) blocked.add(url);
    else if (url !== self) stray.add(url);
  });
  context.on("requestfailed", (r) => {
    const url = r.url();
    if (url.startsWith("file:")) stray.add(`${url} (failed)`);
  });
  context.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    // A sound missing from the file only degrades to its procedural fallback, with a warning.
    else if (m.type() === "warning" && /not in file|file unavailable/.test(m.text())) errors.push(m.text());
  });
  context.on("weberror", (e) => errors.push(`pageerror: ${e.error().message}`));
  const page = await context.newPage();
  page.on("websocket", (ws) => blocked.add(ws.url()));

  await page.goto(self, { waitUntil: "load", timeout: READY_MS });
  const state = await page
    .waitForFunction(() => document.documentElement.dataset.pvExport, undefined, { timeout: READY_MS })
    .then((h) => h.jsonValue())
    .catch(() => "timeout");
  if (state !== "ready") {
    problems.push(`pvExport=${String(state)}`);
  } else {
    // Let the stage draw a few frames.
    await page.waitForTimeout(1500);
    if (await page.locator(".pv-fail").count()) problems.push(`.pv-fail: ${await page.locator(".pv-fail").first().textContent()}`);
    // The app's layout (apps/web/index.html): the player fits the window, the page itself never scrolls.
    const layout = await page.evaluate(() => ({
      app: document.querySelector(".pv-app")?.getBoundingClientRect().height ?? -1,
      scroll: document.scrollingElement?.scrollHeight ?? -1,
      viewport: window.innerHeight,
    }));
    if (layout.app < 0) problems.push("no .pv-app");
    else if (layout.app > layout.viewport || layout.scroll !== layout.viewport) {
      problems.push(`layout: .pv-app ${Math.round(layout.app)} px, page scrollHeight ${layout.scroll} px, viewport ${layout.viewport} px`);
    } else done.push("fits");
    const hasStage = (await page.locator(".pv-stage").count()) > 0;
    if (hasStage) {
      // Counted even when hidden; with the WebXR stub a wrongly created button is also visible.
      const ar = page.locator(".pv-ar-btn");
      if (await ar.count()) problems.push(`AR button present (${(await ar.first().isVisible()) ? "visible" : "hidden"})`);
      else done.push("no AR");
    }
    const target = hasStage ? page.locator(".pv-stage canvas").first() : page.locator(".pv-book2d").first();
    if (!(await target.count())) problems.push(hasStage ? "no stage canvas" : "no .pv-book2d");
    else {
      // Only the WebGL drawing counts: hide the HTML overlays (HUD, labels, activity card) and give the
      // stage a flat background, so a canvas that draws nothing screenshots as one flat colour.
      const flat = hasStage
        ? await page.addStyleTag({ content: ".pv-stage{background:#808080 !important}.pv-stage > :not(canvas){visibility:hidden !important}" })
        : null;
      const v = variance(await target.screenshot({ type: "png", timeout: 5000 }));
      await flat?.evaluate((el) => el.remove());
      if (v <= MIN_VARIANCE) problems.push(`blank stage (variance ${v.toFixed(1)})`);
      else done.push(`${hasStage ? "stage" : "book"} var ${v.toFixed(0)}`);
    }

    try {
      const spec = job.spec;
      if (spec.chapters.length > 1) {
        const before = await page.locator(".pv-panel h2").first().textContent();
        await goChapter(page, spec, spec.chapters[1]!.id);
        const after = await page.locator(".pv-panel h2").first().textContent();
        if (before === after) problems.push("next chip: chapter title unchanged");
        else done.push("chip");
      }
      const quizCh = spec.chapters.find((c) => c.quiz.length > 0);
      if (quizCh) {
        await goChapter(page, spec, quizCh.id);
        const q = quizCh.quiz[0]!;
        if (q.type === "choice") await page.locator(".pv-quiz .pv-opts button").first().click({ timeout: 5000 });
        else await page.locator(".pv-quiz .pv-qnav .pv-btn.soft").first().click({ timeout: 5000 });
        await page.locator(".pv-quiz .pv-fb").first().waitFor({ timeout: 5000 });
        done.push(`quiz ${q.type}`);
      }
      const actCh = spec.chapters.find((c) => c.activity);
      if (actCh) {
        await goChapter(page, spec, actCh.id);
        await page.locator('.pv-act[data-phase="predict"] .pv-act-opt').first().click({ timeout: 5000 });
        await page.waitForFunction(() => document.querySelector<HTMLElement>(".pv-act")?.dataset.phase !== "predict", undefined, { timeout: 5000 });
        done.push("activity");
      }
      if (job.expectSelector) {
        if (!(await page.locator(job.expectSelector).count())) problems.push(`${job.expectSelector} missing`);
        else done.push(job.expectSelector);
      }
      if (job.expectText) {
        const n = await page.getByText(job.expectText, { exact: true }).count();
        if (!n) problems.push(`text "${job.expectText}" not shown`);
        else done.push(`"${job.expectText}"`);
      }
    } catch (e) {
      problems.push(`interaction: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    }
  }
  if (blocked.size) problems.push(`${blocked.size} blocked request(s): ${[...blocked].slice(0, 3).join(", ")}`);
  if (stray.size) problems.push(`${stray.size} file request(s) outside the lesson: ${[...stray].slice(0, 3).join(", ")}`);
  if (errors.length) problems.push(`${errors.length} console error(s): ${errors.slice(0, 3).join(" | ")}`);
  return { problems, done };
}

async function main(): Promise<number> {
  const filter = process.argv.slice(2).find((a) => a !== "--");
  execSync("pnpm --filter @pv/web export-runtime", { cwd: ROOT, stdio: "inherit" });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const sceneDir = join(PUBLIC, "scenes");
  const names = readdirSync(sceneDir)
    .filter((f) => f.endsWith(".scene.json") && !f.startsWith("_dev-routes"))
    .map((f) => f.slice(0, -".scene.json".length))
    .filter((n) => !filter || n.includes(filter))
    .sort();

  const rows: Row[] = [];
  const jobs: Job[] = [];
  const sizes = new Map<string, number>();
  for (const name of names) {
    let spec: SceneSpec;
    try {
      spec = SceneSpec.parse(JSON.parse(readFileSync(join(sceneDir, `${name}.scene.json`), "utf8")));
      const html = await exportHtml(spec);
      const file = join(OUT, `${name}.html`);
      writeFileSync(file, html);
      sizes.set(name, statSync(file).size);
      jobs.push({ name, file, spec });
    } catch (e) {
      if (e instanceof ExportError && e.kind === "server") rows.push({ name, size: "-", result: "skip", detail: `skipped (no server cache): ${e.message}` });
      else rows.push({ name, size: "-", result: "fail", detail: `export: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // One OpenBoard widget: the index.html read back out of the .wgt must be the same lesson.
  const wgtSource = jobs.find((j) => j.spec.engine !== "card") ?? jobs[0];
  if (wgtSource) {
    const html = readFileSync(wgtSource.file, "utf8");
    const wgt = buildWgt(html, { id: sceneKey(wgtSource.spec), title: wgtSource.spec.title, version: "e2e" });
    writeFileSync(join(OUT, `${wgtSource.name}.wgt`), wgt);
    const entries = readStoredZip(wgt);
    const index = entries.get("index.html");
    const name = `${wgtSource.name}.wgt`;
    if (!index || !entries.has("config.xml")) rows.push({ name, size: kb(wgt.length), result: "fail", detail: "index.html or config.xml missing" });
    else if (new TextDecoder().decode(index) !== html) rows.push({ name, size: kb(wgt.length), result: "fail", detail: "index.html differs from the .html" });
    else {
      const file = join(OUT, `${wgtSource.name}.wgt-index.html`);
      writeFileSync(file, index);
      sizes.set(name, wgt.length);
      jobs.push({ name, file, spec: wgtSource.spec });
    }
  }

  // UI language without a built-in catalog: the lesson must show the catalog carried in the file.
  const jaSource = jobs.find((j) => j.name === "card-esempio") ?? jobs[0];
  if (jaSource) {
    const catalog: Catalog = { ...ENGLISH, "player.restart": JA_RESTART };
    const file = join(OUT, `${jaSource.name}.ja.html`);
    writeFileSync(file, await exportHtml(jaSource.spec, "ja", catalog));
    const name = `${jaSource.name} (ja)`;
    sizes.set(name, statSync(file).size);
    jobs.push({ name, file, spec: jaSource.spec, expectText: JA_RESTART });
  }

  // A formula lesson in the Accademico presentation (typeset formulas, no paper book).
  const academicSource = jobs.find((j) => j.name === ACADEMIC_SCENE);
  if (academicSource) {
    const file = join(OUT, `${academicSource.name}.academic.html`);
    writeFileSync(file, await exportHtml(academicSource.spec, "it", null, "academic"));
    const name = `${academicSource.name} (academic)`;
    sizes.set(name, statSync(file).size);
    jobs.push({ name, file, spec: academicSource.spec, expectSelector: ".pv-academic" });
  } else if (!filter) rows.push({ name: `${ACADEMIC_SCENE} (academic)`, size: "-", result: "fail", detail: "scene not exported" });

  /** How many files exercised each interaction (guards against selector or fixture drift). */
  const exercised: Record<string, number> = { chip: 0, quiz: 0, activity: 0 };
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--ignore-gpu-blocklist", "--mute-audio"],
  });
  try {
    for (const job of jobs) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      let problems: string[];
      let done: string[] = [];
      try {
        ({ problems, done } = await checkFile(context, job));
      } catch (e) {
        problems = [`check: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`];
      } finally {
        await context.close();
      }
      const detail = problems.length ? problems.join("; ") : done.join(", ");
      rows.push({ name: job.name, size: kb(sizes.get(job.name) ?? 0), result: problems.length ? "fail" : "pass", detail });
      console.log(`${problems.length ? "FAIL" : "pass"}  ${job.name}: ${detail}`);
      for (const d of done) for (const k of Object.keys(exercised)) if (d.startsWith(k)) exercised[k]!++;
    }
  } finally {
    await browser.close();
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  const w = Math.max(...rows.map((r) => r.name.length), 5);
  console.log(`\n${"scene".padEnd(w)}  ${"size".padStart(8)}  result  detail`);
  for (const r of rows) console.log(`${r.name.padEnd(w)}  ${r.size.padStart(8)}  ${r.result.padEnd(6)}  ${r.detail}`);
  const count = (k: Row["result"]) => rows.filter((r) => r.result === k).length;
  console.log(`\n${count("pass")} passed, ${count("skip")} skipped, ${count("fail")} failed. Files in ${OUT}`);
  console.log(`Exercised by: ${Object.entries(exercised).map(([k, n]) => `${k} ${n}`).join(", ")} file(s); ${jobs.length} file(s) checked.`);
  const guards: string[] = [];
  if (jobs.length === 0) guards.push("no file was checked");
  if (count("skip") > MAX_SKIPPED) guards.push(`${count("skip")} scenes skipped (max ${MAX_SKIPPED})`);
  for (const [k, n] of Object.entries(exercised)) if (n === 0) guards.push(`no file exercised the ${k}`);
  for (const g of guards) console.log(`GUARD FAILED: ${g}`);
  return count("fail") || guards.length ? 1 : 0;
}

process.exitCode = await main();
