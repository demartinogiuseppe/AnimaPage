// Web shell: home with "Scatta / Carica una foto" (photo flow, src/photo.ts), "Le mie lezioni" and
// the example scenes (src/archive.ts); ?scene=<name> loads /scenes/<name>.scene.json, ?lesson=<id>
// a saved lesson from /api/lessons/<id>; both are validated and mounted in the player.
// ?render=1 is the headless render mode of the server's visual check (src/render.ts).
// ?settings opens "Impostazioni" (language and AI model per phase, src/settings.ts).
// Every text comes from the UI catalog of the user's language (src/i18n.ts, decision D21).
import { checkScene, SceneSpec } from "@pv/scene-spec";
import { t, uiLanguage } from "@pv/scene-spec/i18n";
import { applyTheme, createEngine, mountPlayer, readTheme, themePicker, WebSpeechTts, type Engine, type PlayerHandle, type PlayerOptions } from "@pv/engine";
import { examplesSection, LESSON_ID_RE, lessonsApi, lessonsSection } from "./archive.ts";
import { debugEnabled, installDebugOverlay } from "./debug.ts";
import { exportMenu } from "./export/menu.ts";
import { initI18n } from "./i18n.ts";
import { confirmPhoto, formatMb, formatSeconds, loadRuns } from "./photo.ts";
import { renderSettings } from "./settings.ts";


const app = document.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Created at load so its unlock listener sees the first tap (iOS speaks only after a gesture). */
const voice = new WebSpeechTts();

function photoInput(label: string, cls: string, capture: boolean): HTMLLabelElement {
  const wrap = el("label", cls);
  const input = el("input", "sr-only");
  input.type = "file";
  input.accept = "image/*";
  if (capture) input.setAttribute("capture", "environment");
  input.onchange = () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) confirmPhoto(file, { app, tts: voice, el, photoButtons, exportMenu, showScene }, renderHome);
  };
  wrap.append(input, el("span", undefined, label));
  return wrap;
}

/** "Scatta" shows the photo tips first, until the user ticks "non mostrare più". */
const TIPS_KEY = "pv.tips.hidden";
const tipsHidden = () => {
  try {
    return localStorage.getItem(TIPS_KEY) === "1";
  } catch {
    return false;
  }
};

function startFromBlob(blob: Blob): void {
  const file = blob instanceof File ? blob : new File([blob], `incollata.${blob.type.split("/")[1] ?? "png"}`, { type: blob.type });
  confirmPhoto(file, { app, tts: voice, el, photoButtons, exportMenu, showScene }, renderHome);
}

/** First image in the clipboard (async Clipboard API; needs a secure context and the user's permission). */
async function clipboardImage(): Promise<Blob | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return item.getType(type);
  }
  return null;
}

function pasteButton(note: HTMLElement): HTMLButtonElement {
  const btn = el("button", "big-btn secondary", t("home.paste"));
  btn.type = "button";
  btn.onclick = async () => {
    note.textContent = "";
    try {
      const img = await clipboardImage();
      if (img) startFromBlob(img);
      else note.textContent = t("home.pasteEmpty");
    } catch {
      note.textContent = t("home.pasteDenied");
    }
  };
  return btn;
}

function photoButtons(): HTMLElement {
  const box = el("div", "photo-actions");
  let shoot: HTMLElement;
  if (tipsHidden()) shoot = photoInput(t("home.shoot"), "big-btn", true);
  else {
    shoot = el("button", "big-btn", t("home.shoot"));
    (shoot as HTMLButtonElement).type = "button";
    shoot.onclick = renderTips;
  }
  box.append(shoot, photoInput(t("home.upload"), "big-btn secondary", false));
  const note = el("p", "paste-note");
  if (typeof navigator.clipboard?.read === "function") box.append(pasteButton(note));
  box.append(note);
  // Privacy: the photo goes to the configured AI service and is not stored (README, "Legal and privacy").
  box.append(el("p", "note photo-privacy", t("photo.privacy")));
  return box;
}

// Ctrl+V / Cmd+V on the home (not while a lesson or the photo flow is on screen).
addEventListener("paste", (e) => {
  if (!app.querySelector("main.home:not(.flow)")) return;
  const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
  if (!file) return;
  e.preventDefault();
  startFromBlob(file);
});

const TIPS = [1, 2, 3, 4] as const;

function renderTips(): void {
  document.title = `${t("tips.docTitle")} · AnimaPage`;
  const main = el("main", "home flow");
  main.append(el("h1", "flow-title", t("tips.title")));
  const list = el("ol", "tips");
  for (const n of TIPS) {
    const li = el("li");
    li.append(el("b", undefined, t(`tips.${n}.head`)), el("span", undefined, t(`tips.${n}.text`)));
    list.append(li);
  }
  const check = el("label", "check");
  const box = el("input");
  box.type = "checkbox";
  box.checked = tipsHidden();
  box.onchange = () => {
    try {
      if (box.checked) localStorage.setItem(TIPS_KEY, "1");
      else localStorage.removeItem(TIPS_KEY);
    } catch {
      /* storage disabled: tips keep showing */
    }
  };
  check.append(box, el("span", undefined, t("tips.hide")));
  const actions = el("div", "photo-actions");
  actions.append(photoInput(t("tips.openCamera"), "big-btn", true));
  const back = el("a", "back", t("common.backHome"));
  back.href = "./";
  main.append(list, actions, check, back);
  app.replaceChildren(main);
}

/** Timings of the last photo runs on this device (M5 phone test). */
function runsList(): HTMLElement | null {
  const runs = loadRuns();
  if (!runs.length) return null;
  const box = el("details", "runs");
  box.append(el("summary", undefined, t("home.runs", { n: runs.length })));
  const ol = el("ol");
  for (const r of runs) {
    const when = new Date(r.at).toLocaleString(uiLanguage(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const kb = r.bytes ? ` · ${t("home.runPhoto", { mb: formatMb(r.bytes) })}` : "";
    ol.append(el("li", undefined, `${when} — ${r.outcome} in ${formatSeconds(r.total)}${r.parts ? ` · ${r.parts}` : ""}${kb}`));
  }
  box.append(ol);
  return box;
}

function renderHome(): void {
  document.title = "AnimaPage";
  const main = el("main", "home");
  main.append(el("h1", undefined, "AnimaPage"));
  main.append(el("p", "lead", t("home.lead")));
  main.append(photoButtons());
  const themes = el("section", "theme-row");
  themes.append(themePicker(readTheme()));
  const settings = el("a", "link-btn settings-link", t("home.settings"));
  settings.href = "?settings";
  themes.append(settings);
  main.append(themes);
  const offline = el("p", "offline-note", t("home.offline"));
  const syncOnline = () => (offline.hidden = navigator.onLine);
  syncOnline();
  addEventListener("online", syncOnline);
  addEventListener("offline", syncOnline);
  main.append(offline);
  if (tipsHidden()) {
    const tips = el("button", "link-btn", t("home.tipsLink"));
    tips.type = "button";
    tips.onclick = renderTips;
    main.append(tips);
  }
  main.append(lessonsSection(el), examplesSection(el));
  const runs = runsList();
  if (runs) main.append(runs);
  app.replaceChildren(main);
}

function renderError(title: string, detail: string): void {
  const main = el("main", "home");
  const back = el("a", "back", t("common.backList"));
  back.href = "./";
  main.append(el("h1", undefined, title), el("p", "lead", detail), back);
  app.replaceChildren(main);
}

/** Dev box with validation issues, shown above the player. */
function issuesBox(title: string, lines: string[]): HTMLElement {
  const box = el("details", "dev-issues");
  box.open = true;
  box.append(el("summary", undefined, title));
  const ul = el("ul");
  for (const l of lines) ul.append(el("li", undefined, l));
  box.append(ul);
  return box;
}

async function loadScene(name: string): Promise<void> {
  if (!/^[a-z0-9_-]+$/i.test(name)) return renderError(t("scene.badNameTitle"), t("scene.badName", { name }));
  app.replaceChildren(el("p", "loading", t("common.loadingLesson")));

  let json: unknown;
  try {
    const res = await fetch(new URL(`scenes/${name}.scene.json`, document.baseURI));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json(); // the dev server answers missing files with index.html: that fails here too
  } catch {
    return renderError(t("scene.notFoundTitle"), t("scene.notFound", { name }));
  }

  const parsed = SceneSpec.safeParse(json);
  if (!parsed.success) {
    app.replaceChildren(
      issuesBox(
        t("scene.invalid", { name, n: parsed.error.issues.length }),
        parsed.error.issues.map((i) => `${i.path.join(".") || t("scene.root")}: ${i.message}`),
      ),
    );
    return;
  }
  // Examples and dev scenes: a way back to the home page, like "Le mie lezioni" on saved lessons.
  const bar = el("div", "topbar");
  const back = el("a", "back", t("common.backHome"));
  back.href = "./";
  bar.append(back);
  await showScene(parsed.data, bar);
}

async function loadLesson(id: string): Promise<void> {
  if (!LESSON_ID_RE.test(id)) return renderError(t("lesson.badLinkTitle"), t("lesson.badLink"));
  app.replaceChildren(el("p", "loading", t("common.loadingLesson")));
  let lesson: { scene?: unknown; fallback?: boolean };
  try {
    const res = await fetch(lessonsApi(id));
    if (res.status === 404) return renderError(t("scene.notFoundTitle"), t("lesson.gone"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lesson = (await res.json()) as typeof lesson;
  } catch {
    return renderError(t("lesson.unavailableTitle"), t(navigator.onLine ? "lesson.serverDown" : "lesson.offline"));
  }
  const parsed = SceneSpec.safeParse(lesson.scene);
  if (!parsed.success) return renderError(t("lesson.badLinkTitle"), t("lesson.cantOpen"));
  const bar = el("div", "topbar");
  const back = el("a", "back", t("lesson.back"));
  back.href = "./";
  bar.append(back);
  if (lesson.fallback) bar.append(el("span", "note", t("lesson.cardOnly")));
  await showScene(parsed.data, bar);
}

/**
 * Mounts the player on a validated scene, with the semantic-check box and an optional top bar.
 * `replace` (D22): the player on screen now; it stays visible until the new one is built, then goes.
 */
async function showScene(spec: SceneSpec, topbar?: HTMLElement, opts: PlayerOptions = {}, replace?: PlayerHandle): Promise<PlayerHandle> {
  document.title = `${spec.title} · AnimaPage`;

  const issues = checkScene(spec);
  const shell = el("div", "shell");
  const host = el("div", "player-host");
  if (topbar) shell.append(topbar);
  // Only complete lessons export (not the D22 chapter-1 preview, which has more chapters coming).
  if (!opts.following) (topbar ?? shell.appendChild(el("div", "topbar"))).append(exportMenu(spec));
  if (issues.length) shell.append(issuesBox(t("scene.issues", { n: issues.length }), issues.map((i) => `${i.path}: ${i.message}`)));
  shell.append(host);
  if (replace) {
    shell.classList.add("shell-next");
    app.append(shell);
  } else app.replaceChildren(shell);

  let engine: Engine | null = null;
  try {
    engine = await createEngine(spec.engine);
  } catch (e) {
    console.error(`[web] engine "${spec.engine}" unavailable:`, e);
  }
  const handle = await mountPlayer(host, spec, engine, { tts: voice, ...opts });
  if (replace) {
    replace.dispose();
    for (const old of [...app.children]) if (old !== shell) old.remove();
    shell.classList.remove("shell-next");
  }
  return handle;
}

// Theme ("Tema") before the first paint of any screen.
applyTheme(readTheme());

const params = new URLSearchParams(location.search);
// Language before the first screen; a translated catalog arriving later redraws the home or the settings.
initI18n(() => {
  if (app.querySelector("main.home:not(.flow)")) renderHome();
  else if (app.querySelector("main.settings")) void renderSettings(app, el);
});
if (debugEnabled(params)) installDebugOverlay();
const scene = params.get("scene");
const lesson = params.get("lesson");
if (params.get("render") === "1") void import("./render.ts").then((m) => m.installRenderMode(app));
else if (scene) void loadScene(scene);
else if (lesson) void loadLesson(lesson);
else if (params.has("settings")) void renderSettings(app, el);
else renderHome();
