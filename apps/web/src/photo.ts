// Photo flow (M4, phone details M5): optional downscale -> upload with progress -> progress over SSE
// (summary read aloud) -> generated scene, or a "rifai la foto" screen, or an error, in the UI language.
// Timings of each run are shown and kept on the device. The server runs behind the Vite proxy (/api).
import { SceneSpec } from "@pv/scene-spec";
import { t, uiLanguage } from "@pv/scene-spec/i18n";
import { WebSpeechTts, type PlayerHandle, type PlayerOptions, type TtsProvider } from "@pv/engine";
import { readyChime } from "./chime.ts";
import { appLocale, serverText, uiDecimal } from "./i18n.ts";
import { storedLlmChoice } from "./settings.ts";

type Phase = "analyze" | "enrich" | "generate" | "check" | "done" | "error";
interface ProgressEvent {
  phase: Phase;
  message: string;
  summary?: string;
  /** Language of the summary when not Italian (D21). */
  summaryLang?: string;
}
type Result =
  | { status: "scene"; summary: string; fallback: boolean; cached: boolean; lessonId?: string }
  | { status: "retake"; hint: string; summary?: string; cached: boolean }
  | { status: "error"; message: string };

export interface PhotoFlowUi {
  app: HTMLElement;
  tts: TtsProvider;
  el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K];
  /** Big "Scatta" / "Carica" buttons that restart the flow. */
  photoButtons(): HTMLElement;
  /** The "Esporta" menu of a complete lesson. */
  exportMenu(spec: SceneSpec): HTMLElement;
  /** `replace` (D22): the player on screen, kept visible until the new one is built. */
  showScene(spec: SceneSpec, topbar: HTMLElement, opts?: PlayerOptions, replace?: PlayerHandle): Promise<PlayerHandle>;
}

const STEPS = ["analyze", "enrich", "generate", "check"] as const;

const api = (path: string) => new URL(`api/${path}`, document.baseURI).href;

/** Same longest side as the server (server/src/image.ts DEFAULT_MAX_SIDE): it then only re-encodes. */
const MAX_SIDE = 2000;
/** Smaller photos are sent as they are. */
const DOWNSCALE_FROM_BYTES = 1.5 * 1024 * 1024;

/** "1,4 s", "35 s", "2:47" (decimal mark of the UI language). */
export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${uiDecimal(s.toFixed(1))} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}
export const formatMb = (bytes: number) => `${uiDecimal((bytes / 1024 / 1024).toFixed(1))} MB`;

async function serverMode(): Promise<string | null> {
  try {
    const res = await fetch(api("health"));
    return ((await res.json()) as { mode?: string }).mode ?? null;
  } catch {
    return null;
  }
}

/**
 * Live mode: a big phone photo is scaled to MAX_SIDE before upload (smaller upload, never over the
 * server's 20 MB limit; EXIF orientation applied, metadata dropped). Mock mode must send the original
 * bytes: its recordings are keyed by them.
 */
async function shrinkPhoto(file: File): Promise<Blob> {
  if (file.size < DOWNSCALE_FROM_BYTES || (await serverMode()) !== "live") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = MAX_SIDE / Math.max(bmp.width, bmp.height);
    if (k >= 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.92));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // e.g. a format the browser cannot decode: the server decides
  }
}

/** POST with upload progress (fetch has no upload progress events). */
function uploadPhoto(photo: Blob, name: string, onProgress: (sent: number, total: number) => void): Promise<{ ok: boolean; json: { id?: string; error?: string } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", api("pages"));
    xhr.setRequestHeader("X-AnimaPage", "1"); // required by the server's request guard (docs/security.md)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let json = {};
      try {
        json = JSON.parse(xhr.responseText) as object;
      } catch {
        /* not JSON (e.g. proxy error page) */
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, json });
    };
    xhr.onerror = () => reject(new Error("network"));
    const body = new FormData();
    // The AI model per phase chosen in Impostazioni (D20); absent = the server's default.
    const llm = storedLlmChoice();
    if (llm) body.append("llm", llm);
    // The user's language (D21): the lesson is written and read in it.
    body.append("locale", appLocale());
    body.append("photo", photo, name);
    xhr.send(body);
  });
}

/** Timings of the last photo runs, kept on this device for the M5 phone test (home page list). */
export interface RunTiming {
  at: string;
  outcome: string;
  total: number;
  parts: string;
  bytes: number;
}
const RUNS_KEY = "pv.runs";
export function loadRuns(): RunTiming[] {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? "[]") as RunTiming[];
  } catch {
    return [];
  }
}
function saveRun(run: RunTiming): void {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify([run, ...loadRuns()].slice(0, 12)));
  } catch {
    /* storage full or disabled */
  }
}

/**
 * The chosen photo (camera, gallery or paste) on screen before anything is sent: "Crea la lezione"
 * (Enter) starts the flow, "Cambia foto" (Esc) goes back to choosing (`back`). Nothing is uploaded,
 * and the model choice and language are read, only on confirm (uploadPhoto).
 */
export function confirmPhoto(file: File, ui: PhotoFlowUi, back: () => void): void {
  const { el, app } = ui;
  const url = URL.createObjectURL(file);
  const main = el("main", "home flow photo-confirm");
  const img = el("img", "photo-preview");
  img.src = url;
  img.alt = t("photo.previewAlt");
  const actions = el("div", "photo-actions");
  const ok = el("button", "big-btn", t("photo.confirm"));
  ok.type = "button";
  const change = el("button", "big-btn secondary", t("photo.change"));
  change.type = "button";
  actions.append(ok, change);
  main.append(el("h1", "flow-title", t("photo.previewTitle")), img, actions, el("p", "note photo-privacy", t("photo.privacy")));
  let left = false;
  const leave = (start: boolean) => {
    if (left) return;
    left = true;
    window.removeEventListener("keydown", onKey);
    URL.revokeObjectURL(url);
    if (start) startPhotoFlow(file, ui);
    else back();
  };
  // Buttons keep their own Enter/Space; Enter elsewhere confirms, Esc always goes back.
  const onKey = (e: KeyboardEvent) => {
    // Screen replaced some other way: just let go.
    if (!main.isConnected) {
      left = true;
      window.removeEventListener("keydown", onKey);
      URL.revokeObjectURL(url);
    } else if (e.key === "Escape") {
      e.preventDefault();
      leave(false);
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      leave(true);
    }
  };
  ok.onclick = () => leave(true);
  change.onclick = () => leave(false);
  window.addEventListener("keydown", onKey);
  app.replaceChildren(main);
  document.title = `${t("photo.previewTitle")} · AnimaPage`;
  ok.focus();
}

export function startPhotoFlow(file: File, ui: PhotoFlowUi): void {
  const { el, app, tts } = ui;
  let closed = false;
  let es: EventSource | null = null;
  const t0 = performance.now();
  /** Time (ms from t0) the upload ended, each phase was first seen and the first chapter opened (D22). */
  const marks: Partial<Record<"sent" | "first" | Phase, number>> = {};
  let sentBytes = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    closed = true;
    es?.close();
    clearInterval(ticker);
  };

  /** "Pronta in 2:47 · invio 1,4 s · lettura 35 s · fonti 20 s · scena 1:50 · controllo 50 s", also saved for the home list. */
  const timings = (outcome: string, cached = false): string => {
    const end = performance.now() - t0;
    const span = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && b >= a ? formatSeconds(b - a) : null);
    const enrich = marks.enrich;
    const gen = marks.generate;
    const check = marks.check;
    const part = (key: "photo.t.read" | "photo.t.sources" | "photo.t.scene" | "photo.t.check", s: string | null) => s && t(key, { t: s });
    const parts = [
      marks.sent !== undefined ? t("photo.t.sent", { t: formatSeconds(marks.sent) }) : null,
      part("photo.t.read", span(marks.sent, enrich ?? gen)),
      part("photo.t.sources", span(enrich, gen)),
      part("photo.t.scene", span(gen, check ?? end)),
      part("photo.t.check", span(check, end)),
      marks.first !== undefined ? t("photo.t.first", { t: formatSeconds(marks.first) }) : null,
      cached ? t("photo.cachedNote") : null,
    ].filter(Boolean);
    const text = `${t("photo.t.total", { outcome, t: formatSeconds(end) })}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
    console.info(`[web] ${text}`);
    saveRun({ at: new Date().toISOString(), outcome, total: Math.round(end), parts: parts.join(" · "), bytes: sentBytes });
    return text;
  };

  // ---------- Progress screen ----------
  const main = el("main", "home flow");
  const steps = el("ol", "steps");
  const items = STEPS.map((s) => {
    const li = el("li", "step", t(`photo.step.${s}`));
    steps.append(li);
    return li;
  });
  const status = el("p", "status", t("photo.preparing"));
  status.setAttribute("aria-live", "polite");
  const bar = el("div", "bar");
  const barFill = el("i");
  bar.append(barFill);
  const timer = el("p", "timer", t("photo.elapsed", { t: formatSeconds(0) }));
  ticker = setInterval(() => (timer.textContent = t("photo.elapsed", { t: formatSeconds(performance.now() - t0) })), 1000);
  const summaryBox = el("section", "summary");
  summaryBox.hidden = true;
  const summaryText = el("p");
  const noVoice = el("p", "note");
  noVoice.hidden = true;
  const stopVoice = el("button", "link-btn", t("photo.stopVoice"));
  stopVoice.type = "button";
  stopVoice.onclick = () => tts.stop();
  summaryBox.append(el("h2", undefined, t("photo.summary")), summaryText, noVoice, stopVoice);
  // No voice for the summary's language on this device: the summary stays on screen, with a notice (D21).
  if (tts instanceof WebSpeechTts)
    tts.onNoVoice = (lang) => {
      let name = lang;
      try {
        name = new Intl.DisplayNames([uiLanguage()], { type: "language" }).of(lang) ?? lang;
      } catch {
        /* tag as it is */
      }
      noVoice.textContent = t("photo.noVoice", { lang: name });
      noVoice.hidden = false;
    };
  const cancel = el("button", "link-btn", t("common.cancel"));
  cancel.type = "button";
  cancel.onclick = () => {
    stop();
    tts.stop();
    location.assign("./");
  };
  main.append(el("h1", "flow-title", t("photo.title")), steps, status, bar, timer, summaryBox, cancel);
  app.replaceChildren(main);
  document.title = `${t("photo.docTitle")} · AnimaPage`;

  let spoken = false;
  const onProgress = (e: ProgressEvent) => {
    marks[e.phase] ??= performance.now() - t0;
    const idx = e.phase === "done" ? STEPS.length : (STEPS as readonly Phase[]).indexOf(e.phase);
    if (idx >= 0) items.forEach((li, i) => (li.className = `step ${i < idx ? "done" : i === idx ? "active" : ""}`));
    status.textContent = serverText(e.message);
    if (e.summary && !spoken) {
      spoken = true;
      summaryText.textContent = e.summary;
      summaryText.lang = e.summaryLang ?? "it";
      summaryBox.hidden = false;
      // Read in its own language (the Italian prompt writes it in the page's language).
      tts.speak(e.summary, () => {}, undefined, e.summaryLang ?? "it-IT");
    }
  };

  // ---------- Outcome screens ----------
  const outcome = (title: string, text: string, time?: string) => {
    stop();
    const m = el("main", "home flow");
    m.append(el("h1", "flow-title", title), el("p", "lead", text));
    if (time) m.append(el("p", "note timings", time));
    const home = el("a", "back", t("common.backHome").replace(/^←\s*/, ""));
    home.href = "./";
    m.append(ui.photoButtons(), home);
    app.replaceChildren(m);
  };
  const fail = (message: string) => {
    tts.stop();
    document.title = "AnimaPage";
    outcome(t("photo.errorTitle"), serverText(message), marks.sent !== undefined ? timings(t("photo.outcome.error")) : undefined);
  };

  // ---------- First chapter ahead of the lesson (D22) ----------
  // The player opens on chapter 1 with an "in preparazione" chip; the complete lesson arrives with the
  // result and is swapped in at the next chapter boundary (the user's chapter and time are never touched).
  let previewing: Promise<void> | null = null;
  let preview: { handle: PlayerHandle; bar: HTMLElement; note: HTMLElement } | null = null;
  let full: SceneSpec | null = null;

  const openFirstChapter = (data: unknown) => {
    if (previewing || closed) return;
    const parsed = SceneSpec.safeParse(data);
    if (!parsed.success) return; // the complete lesson still comes
    marks.first = performance.now() - t0;
    clearInterval(ticker);
    readyChime();
    const bar = el("div", "topbar");
    const back = el("a", "back", t("photo.newPhoto"));
    back.href = "./";
    const note = el("span", "note", t("photo.firstReady"));
    bar.append(back, note);
    previewing = ui
      .showScene(parsed.data, bar, { following: { onContinue: (cid, tour) => void continueTo(cid, tour) } })
      .then((handle) => void (preview = { handle, bar, note }));
  };

  /** Swap to the complete lesson, opening the chapter the user (or the tour) moved to. */
  const continueTo = async (chapter: string, tour: boolean) => {
    const p = preview;
    if (!p || !full) return;
    preview = null;
    const bar = p.bar.cloneNode(true) as HTMLElement;
    bar.querySelector(".export-menu")?.remove(); // showScene adds the menu to the complete lesson
    const handle = await ui.showScene(full, bar, { start: { chapter, tour } }, p.handle);
    handle.go(chapter, true);
  };

  /** The rest of the lesson could not be made: the first chapter stays, with a quiet note. */
  const restFailed = async () => {
    await previewing;
    if (!preview) return;
    preview.note.textContent = t("photo.restFailed");
    preview.handle.setFollowing([]);
  };

  const finishLesson = async (r: Extract<Result, { status: "scene" }>, id: string) => {
    await previewing;
    if (!preview) return openScene(r, id);
    try {
      const res = await fetch(api(`pages/${id}/scene`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = SceneSpec.safeParse(await res.json());
      if (!parsed.success) return restFailed();
      full = parsed.data;
    } catch {
      return restFailed();
    }
    if (r.lessonId) history.replaceState(null, "", `?lesson=${encodeURIComponent(r.lessonId)}`);
    // A fallback card replaces the 3D lesson: all its chapters follow, with a note.
    const next = r.fallback ? full.chapters : full.chapters.slice(1);
    preview.note.textContent = r.fallback ? t("photo.restFallback") : timings(t("photo.outcome.ready"), r.cached);
    preview.bar.append(ui.exportMenu(full)); // the lesson is complete now
    preview.handle.setFollowing(next.map((c) => ({ id: c.id, chip: c.chip, kind: c.kind })));
  };

  const openScene = async (r: Extract<Result, { status: "scene" }>, id: string) => {
    try {
      const res = await fetch(api(`pages/${id}/scene`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = SceneSpec.safeParse(await res.json());
      if (!parsed.success) return fail(t("photo.badScene"));
      readyChime();
      // Saved in "Le mie lezioni": a reload (or the link) reopens it from the archive.
      if (r.lessonId) history.replaceState(null, "", `?lesson=${encodeURIComponent(r.lessonId)}`);
      const bar = el("div", "topbar");
      const back = el("a", "back", t("photo.newPhoto"));
      back.href = "./";
      bar.append(back);
      if (r.fallback) bar.append(el("span", "note", t("photo.fallbackNote")));
      bar.append(el("span", "note timings", timings(t("photo.outcome.ready"), r.cached)));
      // The summary keeps speaking until the player starts its own narration (same voice).
      await ui.showScene(parsed.data, bar);
    } catch {
      fail(t("photo.lost"));
    }
  };

  void (async () => {
    if (!navigator.onLine) return fail(t("photo.offline"));
    let id: string;
    try {
      const photo = await shrinkPhoto(file);
      if (closed) return;
      sentBytes = photo.size;
      status.textContent = t("photo.sending");
      const res = await uploadPhoto(photo, file.name || "pagina.jpg", (sent, total) => {
        barFill.style.width = `${Math.round((sent / total) * 100)}%`;
        status.textContent = t("photo.uploading", { pct: Math.round((sent / total) * 100), sent: formatMb(sent), total: formatMb(total) });
      });
      marks.sent = performance.now() - t0;
      bar.hidden = true;
      if (!res.ok || !res.json.id) return fail(res.json.error ?? t("photo.serverDown"));
      id = res.json.id;
    } catch {
      return fail(t(navigator.onLine ? "photo.serverDown" : "photo.offline"));
    }
    if (closed) return;

    es = new EventSource(api(`pages/${id}/events`));
    es.addEventListener("progress", (m) => onProgress(JSON.parse((m as MessageEvent<string>).data) as ProgressEvent));
    es.addEventListener("chapter", (m) => openFirstChapter((JSON.parse((m as MessageEvent<string>).data) as { scene?: unknown }).scene));
    es.addEventListener("result", (m) => {
      stop();
      const r = JSON.parse((m as MessageEvent<string>).data) as Result;
      if (r.status === "scene") void finishLesson(r, id);
      else if (previewing) void restFailed();
      else if (r.status === "retake") {
        tts.stop();
        outcome(t("photo.retakeTitle"), serverText(r.hint), timings(t("photo.outcome.retake"), r.cached));
      } else fail(r.message);
    });
    // EventSource reconnects by itself (the server replays the job); CLOSED means it gave up.
    es.onerror = () => {
      if (closed || es?.readyState !== EventSource.CLOSED) return;
      if (previewing) {
        stop();
        void restFailed();
      } else fail(t("photo.lost"));
    };
  })();
}
