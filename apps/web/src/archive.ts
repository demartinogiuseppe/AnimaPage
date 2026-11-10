// Home archive (D18): "Le mie lezioni" (lessons saved by the server from the user's photos:
// open, rename, delete) and "Esempi" (the ten default example scenes of fixtures/public/scenes, from scenes/index.json
// written by the Vite plugin). The service worker keeps the list and the lessons already opened
// for offline use (vite.config.ts, cache "pv-lessons"). Texts from the UI catalog (D21).
import { t, uiLanguage, type MessageKey } from "@pv/scene-spec/i18n";

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K];

/** Mirror of server/src/lessons/store.ts LessonMeta. */
export interface LessonMeta {
  id: string;
  createdAt: string;
  title: string;
  subject: string;
  topic: string;
  engine: string;
  kind: string;
  pageNumbers?: string;
  chapters: number;
  fallback: boolean;
}

/** Mirror of apps/web/scripts/scene-index.ts SceneIndexEntry. */
interface SceneIndexEntry {
  file: string;
  title: string;
  subject: string;
  engine: string;
  generated: boolean;
}

export const LESSON_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LESSONS_CACHE = "pv-lessons";
/** Above this many lessons the search box appears. */
const SEARCH_FROM = 8;
const MAX_TITLE = 120;

export const lessonsApi = (path = "") => new URL(`api/lessons${path ? `/${path}` : ""}`, document.baseURI).href;

const THEATRES = ["map", "battle", "timeline", "diorama", "process", "concept", "sky", "lab", "chart", "stage", "art", "solid", "earth", "music", "workshop", "card", "facade", "storybook"];
export const theatreName = (engine: string) => t(THEATRES.includes(engine) ? (`theatre.${engine}` as MessageKey) : "theatre.default");

/** Circle as a path: lets every glyph be one `d` string. */
const c = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const GLYPHS: Record<string, string> = {
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  battle: "M4 4l12 12M20 4L8 16M6 14l4 4M18 14l-4 4",
  timeline: "M3 12h18M6 9v6M12 9v6M18 9v6",
  diorama: "M4 10l8-6 8 6v10H4zM9 20v-6h6v6",
  process: "M20 12a8 8 0 1 1-3-6.2M20 4v4h-4",
  concept: `${c(12, 5, 2)}${c(5, 18, 2)}${c(19, 18, 2)}M11 7l-5 9M13 7l5 9M7 18h10`,
  sky: `${c(12, 12, 3)}M3 12a9 4 0 1 0 18 0a9 4 0 1 0-18 0`,
  lab: "M9 3h6M10 3v6l-5 10h14l-5-10V3",
  chart: "M4 20h16M7 20v-6M12 20V8M17 20V10",
  stage: "M3 4h18M4 4v16M20 4v16M4 4c2 6 4 8 6 8M20 4c-2 6-4 8-6 8M4 20h16",
  art: "M4 4h16v16H4zM7 16l4-5 3 3 2-2 2 4",
  solid: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  earth: `${c(12, 12, 8)}${c(12, 12, 4)}M12 4v8h8`,
  music: `M9 18V6l10-2v12${c(7, 18, 2)}${c(17, 16, 2)}`,
  workshop: `${c(12, 12, 3)}M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1`,
  card: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  storybook: "M12 6c-2-2-5-2.5-8-2v14c3-.5 6 0 8 2M12 6c2-2 5-2.5 8-2v14c-3-.5-6 0-8 2M12 6v14",
  facade: "M3 20h18M5 20v-9h14v9M4 11l8-6 8 6M8 20v-6h3v6M13 14h3v3h-3z",
};

function glyph(engine: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("glyph");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", GLYPHS[engine] ?? GLYPHS.card!);
  svg.append(path);
  return svg;
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(uiLanguage()) + s.slice(1);
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(uiLanguage(), { day: "numeric", month: "short", year: "numeric" });

/** Drops the offline copy of a lesson and refreshes the cached list (best effort). */
async function forget(id: string): Promise<void> {
  try {
    if ("caches" in window) await (await caches.open(LESSONS_CACHE)).delete(lessonsApi(id));
    await fetch(lessonsApi(), { cache: "no-store" });
  } catch {
    /* offline or no Cache API: the copy is refreshed next time */
  }
}

// ---------- Le mie lezioni ----------

export function lessonsSection(el: El): HTMLElement {
  const section = el("section", "archive");
  section.setAttribute("aria-labelledby", "pv-my-lessons");
  const h2 = el("h2", "section-title", t("archive.mine"));
  h2.id = "pv-my-lessons";
  const search = el("input", "search");
  search.type = "search";
  search.placeholder = t("archive.searchPlaceholder");
  search.setAttribute("aria-label", t("archive.searchAria"));
  search.hidden = true;
  const list = el("ul", "lessons");
  const note = el("p", "note archive-note", t("archive.loading"));
  section.append(h2, search, list, note);

  let lessons: LessonMeta[] = [];
  let openMenu: (() => void) | null = null;
  const closeMenu = () => {
    openMenu?.();
    openMenu = null;
  };
  document.addEventListener("click", (e) => {
    if (openMenu && !(e.target as Element).closest?.(".lesson-menu, .more")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  const searchText = (l: LessonMeta) => fold(`${l.title} ${l.subject} ${l.topic} ${theatreName(l.engine)}`);

  const refresh = () => {
    search.hidden = lessons.length <= SEARCH_FROM;
    const q = search.hidden ? "" : fold(search.value.trim());
    const shown = q ? lessons.filter((l) => searchText(l).includes(q)) : lessons;
    list.replaceChildren(...shown.map(card));
    note.hidden = shown.length > 0;
    note.textContent = t(lessons.length ? "archive.noMatch" : "archive.empty");
  };
  search.oninput = refresh;

  function card(l: LessonMeta): HTMLLIElement {
    const li = el("li", "lesson");
    showCard(li, l);
    return li;
  }

  function showCard(li: HTMLLIElement, l: LessonMeta): void {
    const open = el("a", "lesson-open");
    open.href = `?lesson=${encodeURIComponent(l.id)}`;
    const text = el("span", "lesson-text");
    const facts = [formatDate(l.createdAt), l.pageNumbers ? t("archive.page", { n: l.pageNumbers }) : null, l.fallback ? t("archive.cardOnly") : null];
    text.append(
      el("b", undefined, l.title),
      el("span", undefined, `${capitalize(l.subject)} · ${theatreName(l.engine)}`),
      el("span", "lesson-date", facts.filter(Boolean).join(" · ")),
    );
    open.append(glyph(l.engine), text);

    const more = el("button", "more", "⋯");
    more.type = "button";
    more.setAttribute("aria-label", t("archive.actions", { title: l.title }));
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    const menu = el("div", "lesson-menu");
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    const item = (label: string, act: () => void) => {
      const b = el("button", undefined, label);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.onclick = () => {
        closeMenu();
        act();
      };
      return b;
    };
    menu.append(
      item(t("archive.open"), () => location.assign(open.href)),
      item(t("archive.rename"), () => showRename(li, l)),
      item(t("archive.delete"), () => showDelete(li, l)),
    );
    more.onclick = () => {
      const wasOpen = !menu.hidden;
      closeMenu();
      if (wasOpen) return;
      menu.hidden = false;
      more.setAttribute("aria-expanded", "true");
      (menu.querySelector("button") as HTMLButtonElement).focus();
      openMenu = () => {
        menu.hidden = true;
        more.setAttribute("aria-expanded", "false");
      };
    };
    li.className = "lesson";
    li.replaceChildren(open, more, menu);
  }

  function showRename(li: HTMLLIElement, l: LessonMeta): void {
    const form = el("form", "lesson-edit");
    const input = el("input");
    input.value = l.title;
    input.maxLength = MAX_TITLE;
    input.required = true;
    input.setAttribute("aria-label", t("archive.newTitle"));
    const msg = el("p", "edit-msg");
    msg.setAttribute("aria-live", "polite");
    const save = el("button", "small-btn", t("archive.save"));
    save.type = "submit";
    const cancel = el("button", "small-btn secondary", t("common.cancel"));
    cancel.type = "button";
    cancel.onclick = () => showCard(li, l);
    const row = el("div", "edit-row");
    row.append(save, cancel);
    form.append(el("label", "edit-label", t("archive.newTitle")), input, row, msg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const title = input.value.replace(/\s+/g, " ").trim();
      if (!title) return void (msg.textContent = t("archive.needTitle"));
      if (title === l.title) return showCard(li, l);
      save.disabled = true;
      try {
        const res = await fetch(lessonsApi(l.id), {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-animapage": "1" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "");
        const meta = (await res.json()) as LessonMeta;
        lessons = lessons.map((x) => (x.id === meta.id ? meta : x));
        void forget(l.id);
        showCard(li, meta);
      } catch (err) {
        save.disabled = false;
        msg.textContent = (err as Error).message || t("archive.renameFail");
      }
    };
    li.className = "lesson editing";
    li.replaceChildren(form);
    input.focus();
    input.select();
  }

  function showDelete(li: HTMLLIElement, l: LessonMeta): void {
    const box = el("div", "lesson-edit");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-label", t("archive.confirmDelete"));
    const msg = el("p", "edit-msg");
    msg.setAttribute("aria-live", "polite");
    const yes = el("button", "small-btn danger", t("archive.delete"));
    yes.type = "button";
    const no = el("button", "small-btn secondary", t("common.cancel"));
    no.type = "button";
    no.onclick = () => showCard(li, l);
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        const res = await fetch(lessonsApi(l.id), { method: "DELETE", headers: { "x-animapage": "1" } });
        if (!res.ok && res.status !== 404) throw new Error();
        lessons = lessons.filter((x) => x.id !== l.id);
        void forget(l.id);
        refresh();
      } catch {
        yes.disabled = false;
        msg.textContent = t("archive.deleteFail");
      }
    };
    const row = el("div", "edit-row");
    row.append(yes, no);
    box.append(el("p", "edit-question", t("archive.deleteQuestion", { title: l.title })), row, msg);
    li.className = "lesson editing";
    li.replaceChildren(box);
    no.focus();
  }

  void (async () => {
    try {
      const res = await fetch(lessonsApi());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lessons = (await res.json()) as LessonMeta[];
      refresh();
    } catch {
      note.textContent = t(navigator.onLine ? "archive.loadFail" : "archive.offline");
    }
  })();
  return section;
}

// ---------- Esempi ----------

export function examplesSection(el: El): HTMLElement {
  const section = el("section", "examples");
  section.append(el("h2", "section-title", t("archive.examples")));
  const body = el("div");
  section.append(body);
  void (async () => {
    let entries: SceneIndexEntry[];
    try {
      const res = await fetch(new URL("scenes/index.json", document.baseURI));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      entries = (await res.json()) as SceneIndexEntry[];
    } catch {
      body.append(el("p", "note", t("archive.examplesFail")));
      return;
    }
    // Groups by subject, in the order of the index (hand-written scenes first, then generated ones).
    const groups = new Map<string, SceneIndexEntry[]>();
    for (const e of entries) {
      const key = fold(e.subject);
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    for (const group of groups.values()) {
      body.append(el("h3", "group-title", group[0]!.subject));
      const ul = el("ul", "scenes");
      for (const s of group) {
        const a = el("a");
        a.href = `?scene=${encodeURIComponent(s.file)}`;
        const text = el("span", "lesson-text");
        const sub = el("span", undefined, theatreName(s.engine));
        if (s.generated) sub.append(" · ", el("em", "badge", t("archive.generated")));
        text.append(el("b", undefined, s.title), sub);
        a.append(glyph(s.engine), text);
        const li = el("li");
        li.append(a);
        ul.append(li);
      }
      body.append(ul);
    }
  })();
  return section;
}
