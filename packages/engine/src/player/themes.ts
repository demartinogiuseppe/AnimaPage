// UI themes ("Tema"): CSS token sets for the app shell and the player, plus the tint of the 3D book
// (desk, cover, paper) in the "Colori" style. Persisted in localStorage, shared by home and player.
import { t, type MessageKey } from "@pv/scene-spec/i18n";
import { h } from "./dom.ts";

export type ThemeId = "quaderno" | "notte" | "laboratorio" | "lavagna" | "pergamena";

export interface BookTheme {
  /** Desk colour, desk edge (also the room colour behind it), book cover. */
  desk: string;
  deskEdge: string;
  cover: number;
  /** Paper and the accent printed on the left page. */
  paper: string;
  accent: string;
}

export interface Theme {
  id: ThemeId;
  /** Italian name (the picker shows the UI catalog's "theme.<id>.name"). */
  name: string;
  /** Short description for the picker's tooltip. */
  hint: string;
  dark: boolean;
  /** Swatch colours: background, surface, accent. */
  swatch: [string, string, string];
  /** CSS custom properties; empty = the stylesheet's own values (Pergamena, with automatic dark mode). */
  vars: Record<string, string>;
  book: BookTheme | null;
}

/** Player tokens (--pv-*) and app-shell tokens derived from the same palette. */
function vars(p: {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  link: string;
  hl: string;
  ok: string;
  bad: string;
  myth: string;
  hist: string;
  stage: string;
  pattern?: string;
  dark: boolean;
}): Record<string, string> {
  return {
    "--pv-bg": p.bg,
    "--pv-surface": p.surface,
    "--pv-surface-2": p.surface2,
    "--pv-ink": p.ink,
    "--pv-muted": p.muted,
    "--pv-line": p.line,
    "--pv-clay": p.accent,
    "--pv-clay-ink": p.accentInk,
    "--pv-aegean": p.link,
    "--pv-hl": p.hl,
    "--pv-ok": p.ok,
    "--pv-bad": p.bad,
    "--pv-myth": p.myth,
    "--pv-hist": p.hist,
    "--pv-stage-bg": p.stage,
    "--pv-pattern": p.pattern ?? "none",
    "--bg": p.bg,
    "--surface": p.surface,
    "--ink": p.ink,
    "--muted": p.muted,
    "--line": p.line,
    "--clay": p.accent,
    "--clay-ink": p.accentInk,
    "--bad": p.bad,
    "color-scheme": p.dark ? "dark" : "light",
  };
}

export const THEMES: readonly Theme[] = [
  {
    id: "quaderno",
    name: "Quaderno",
    hint: "Chiaro e fresco, a quadretti, con il verde",
    dark: false,
    swatch: ["#eef3ef", "#ffffff", "#17855a"],
    vars: vars({
      bg: "#eef3ef",
      surface: "#ffffff",
      surface2: "#f2f7f3",
      ink: "#16241c",
      muted: "#53655a",
      line: "#d2dfd5",
      accent: "#17855a",
      accentInk: "#ffffff",
      link: "#2160c4",
      hl: "#d6efc2",
      ok: "#1d7a43",
      bad: "#c0392b",
      myth: "#8a4fd0",
      hist: "#17855a",
      stage: "#a9bfaf",
      pattern:
        "linear-gradient(rgba(40,110,80,.07) 1px,transparent 1px) 0 0/22px 22px,linear-gradient(90deg,rgba(40,110,80,.07) 1px,transparent 1px) 0 0/22px 22px",
      dark: false,
    }),
    book: { desk: "#dcc8a4", deskEdge: "#a9bfaf", cover: 0x1f6b4c, paper: "#ffffff", accent: "#17855a" },
  },
  {
    id: "notte",
    name: "Notte stellata",
    hint: "Blu notte con l'oro: riposante per gli occhi",
    dark: true,
    swatch: ["#0e1630", "#172345", "#ffc247"],
    vars: vars({
      bg: "#0e1630",
      surface: "#172345",
      surface2: "#1d2b52",
      ink: "#eef2ff",
      muted: "#a6b2d6",
      line: "#2c3b66",
      accent: "#ffc247",
      accentInk: "#1a1406",
      link: "#8cc8ff",
      hl: "#3a4a7c",
      ok: "#6fdc9a",
      bad: "#ff8a7a",
      myth: "#c9a2ff",
      hist: "#5fd0c0",
      stage: "#0a1024",
      pattern:
        "radial-gradient(1.2px 1.2px at 24px 30px,rgba(255,255,255,.4),transparent 70%) 0 0/170px 130px,radial-gradient(1px 1px at 110px 90px,rgba(255,236,180,.35),transparent 70%) 0 0/170px 130px",
      dark: true,
    }),
    book: { desk: "#26305a", deskEdge: "#0a1024", cover: 0x1a2a66, paper: "#f8f5ec", accent: "#b06f00" },
  },
  {
    id: "laboratorio",
    name: "Laboratorio",
    hint: "Bianco e grigio, contrasto alto, un blu acceso",
    dark: false,
    swatch: ["#f2f4f7", "#ffffff", "#2445ff"],
    vars: vars({
      bg: "#f2f4f7",
      surface: "#ffffff",
      surface2: "#f5f7fa",
      ink: "#0b1220",
      muted: "#4d5869",
      line: "#d5dbe4",
      accent: "#2445ff",
      accentInk: "#ffffff",
      link: "#2445ff",
      hl: "#fff0a0",
      ok: "#0f8a4a",
      bad: "#d0302a",
      myth: "#7a3fd0",
      hist: "#0b7d77",
      stage: "#cdd4de",
      dark: false,
    }),
    book: { desk: "#e3e7ed", deskEdge: "#c3cad5", cover: 0x23304a, paper: "#ffffff", accent: "#2445ff" },
  },
  {
    id: "lavagna",
    name: "Lavagna",
    hint: "Verde ardesia scuro e gesso giallo",
    dark: true,
    swatch: ["#1d2420", "#252e29", "#f5d061"],
    vars: vars({
      bg: "#1d2420",
      surface: "#252e29",
      surface2: "#2c3631",
      ink: "#f2eee3",
      muted: "#b5baad",
      line: "#3c4842",
      accent: "#f5d061",
      accentInk: "#1d2420",
      link: "#9fd3ff",
      hl: "#4b5b3f",
      ok: "#8be0a4",
      bad: "#ff8f80",
      myth: "#d8b4ff",
      hist: "#7fd3b8",
      stage: "#141a17",
      dark: true,
    }),
    book: { desk: "#4a3526", deskEdge: "#141a17", cover: 0x2f3d35, paper: "#f4f0e4", accent: "#2f6b4f" },
  },
  {
    id: "pergamena",
    name: "Pergamena",
    hint: "Lo stile originale: carta antica e terracotta",
    dark: false,
    swatch: ["#ecebe6", "#ffffff", "#9b4a22"],
    vars: {},
    book: null,
  },
];

export const DEFAULT_THEME: ThemeId = "quaderno";
const KEY = "pv.theme";

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTheme(store: StorageLike | null = storage()): Theme {
  try {
    return themeById(store?.getItem(KEY));
  } catch {
    return themeById(null);
  }
}

export function writeTheme(id: ThemeId, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(KEY, id);
  } catch {
    /* private mode: this page only */
  }
}

/** One CSS rule per theme, keyed on <html data-pv-theme>. More specific than the dark-mode rules. */
export function themeCss(): string {
  return THEMES.filter((t) => Object.keys(t.vars).length)
    .map((t) => `html:root[data-pv-theme="${t.id}"]{${Object.entries(t.vars).map(([k, v]) => `${k}:${v}`).join(";")}}`)
    .join("\n");
}

const listeners = new Set<(t: Theme) => void>();

/** Applies a theme to the document (CSS tokens, browser theme-color) and tells the open player. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  if (!document.getElementById("pv-theme-css")) document.head.append(h("style", { id: "pv-theme-css" }, themeCss() + THEME_PICKER_CSS));
  root.dataset.pvTheme = t.id;
  const meta = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const m of meta) m.content = t.vars["--pv-bg"] ?? (m.media.includes("dark") ? "#15120f" : "#ecebe6");
  for (const fn of listeners) fn(t);
}

/** Called when the theme changes from any picker (the player retints the 3D book). */
export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Theme name and hint in the UI language (the Italian ones in THEMES are the defaults). */
const themeText = (th: Theme, part: "name" | "hint"): string => t(`theme.${th.id}.${part}` as MessageKey);

/** "Tema" picker: one swatch per theme. */
export function themePicker(current: Theme = readTheme()): HTMLElement {
  const buttons = THEMES.map((th) => {
    const sw = h("span", { class: "pv-theme-sw", "aria-hidden": "true" });
    sw.style.background = `linear-gradient(135deg,${th.swatch[0]} 0 50%,${th.swatch[1]} 50% 100%)`;
    sw.style.boxShadow = `inset 0 0 0 3px ${th.swatch[2]}`;
    const b = h("button", { type: "button", "data-theme": th.id, title: themeText(th, "hint"), "aria-pressed": String(th.id === current.id) }, sw, h("span", {}, themeText(th, "name")));
    b.onclick = () => {
      writeTheme(th.id);
      applyTheme(th);
      for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
    };
    return b;
  });
  onThemeChange((th) => {
    for (const x of buttons) x.setAttribute("aria-pressed", String(x.dataset.theme === th.id));
  });
  return h("div", { class: "pv-themes", role: "group", "aria-label": t("theme.label") }, h("span", { class: "pv-themes-label" }, t("theme.label")), ...buttons);
}

/** Picker CSS (shared by home and player; uses the shell/player tokens). */
export const THEME_PICKER_CSS = /* css */ `
.pv-themes{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pv-themes-label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--pv-muted,var(--muted));margin-right:4px}
.pv-themes button{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--pv-line,var(--line));background:var(--pv-surface,var(--surface));color:var(--pv-ink,var(--ink));
  border-radius:999px;padding:4px 10px 4px 4px;font:inherit;font-size:13px;cursor:pointer}
.pv-themes button[aria-pressed="true"]{border-color:var(--pv-clay,var(--clay));box-shadow:0 0 0 1.5px var(--pv-clay,var(--clay));font-weight:700}
.pv-theme-sw{width:22px;height:22px;border-radius:50%;flex:none}
`;
