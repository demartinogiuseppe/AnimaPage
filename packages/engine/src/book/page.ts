// What the printed pages say, and how they are drawn on a canvas (crisp text textures).
import type { Chapter, SceneSpec } from "@pv/scene-spec";
import { t, uiLanguage } from "@pv/scene-spec/i18n";
import { rng } from "../util/math.ts";

export type BookStyle = "color" | "ink";

export interface PageText {
  /** Small running header, e.g. "Geografia · La Campania". */
  header: string;
  heading: string;
  formula?: string;
  lines: string[];
  /** Source numbers (1-based, as in the "Fonti" list). */
  marks: number[];
  /** "Prevedi" question printed at the bottom, when the chapter has an activity. */
  question?: string;
  folio: string;
}

/** Fallback lines when a chapter has no `book`: its first sentences, kept short. */
const FALLBACK_LINES = 3;
const FALLBACK_CHARS = 150;

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${cut.slice(0, sp > max * 0.6 ? sp : max).trimEnd()}…`;
}

/** Left page content for a chapter (spec.book, or title + first sentences). Pure. */
export function leftPageText(spec: Pick<SceneSpec, "page" | "sources" | "chapters">, ch: Chapter): PageText {
  const index = new Map(spec.sources.map((s, i) => [s.id, i + 1] as const));
  const k = spec.chapters.findIndex((c) => c.id === ch.id);
  const header = `${spec.page.subject} · ${spec.page.topic}`;
  const folio = String(2 * Math.max(0, k) + 1 + (Number.parseInt(spec.page.bookPage ?? "", 10) || 0));
  const question = ch.activity?.predict.q;
  let ids: string[];
  let page: PageText;
  if (ch.book) {
    ids = ch.book.sourceIds;
    page = { header, heading: ch.book.heading, formula: ch.book.formula, lines: [...ch.book.lines], marks: [], question, folio };
  } else {
    const first = ch.narration.slice(0, FALLBACK_LINES);
    ids = first.flatMap((s) => s.sourceIds);
    page = { header, heading: ch.title, lines: first.map((s) => shorten(s.text, FALLBACK_CHARS)), marks: [], question, folio };
  }
  page.marks = [...new Set(ids.map((id) => index.get(id)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  return page;
}

/** Right page text for the `card` engine (no 3D): the rest of the narration. */
export function rightPageText(spec: Pick<SceneSpec, "page" | "sources" | "chapters">, ch: Chapter): PageText {
  const left = leftPageText(spec, ch);
  const skip = ch.book ? 0 : FALLBACK_LINES;
  const rest = ch.narration.slice(skip, skip + 5);
  const index = new Map(spec.sources.map((s, i) => [s.id, i + 1] as const));
  const marks = [...new Set(rest.flatMap((s) => s.sourceIds).map((id) => index.get(id)).filter((n): n is number => n !== undefined))];
  return {
    header: ch.chip,
    heading: ch.activity ? t("book.tryIt") : "",
    lines: (ch.activity ? [ch.activity.test.prompt] : []).concat(rest.map((s) => shorten(s.text, 170))),
    marks: marks.sort((a, b) => a - b),
    folio: String(Number(left.folio) + 1),
  };
}

// ---------- Canvas drawing ----------

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

export interface Palette {
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  mark: string;
}

export const PALETTES: Record<BookStyle, Palette> = {
  color: { paper: "#fbf6ea", ink: "#2a211b", muted: "#7a6d60", accent: "#9b4a22", mark: "#1f5d86" },
  ink: { paper: "#ffffff", ink: "#141414", muted: "#5c5c5c", accent: "#d9502b", mark: "#141414" },
};

type Ctx = CanvasRenderingContext2D;

/** Paper: base colour, deterministic fibre noise, gutter shading on the spine side. */
export function drawPaper(c: Ctx, w: number, h: number, pal: Palette, spine: "left" | "right" | "none"): void {
  c.fillStyle = pal.paper;
  c.fillRect(0, 0, w, h);
  const r = rng(7);
  c.globalAlpha = 0.035;
  for (let i = 0; i < 1400; i++) {
    c.fillStyle = r() < 0.5 ? "#000" : "#8a6a3a";
    c.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1);
  }
  c.globalAlpha = 1;
  if (spine !== "none") {
    const x0 = spine === "left" ? 0 : w;
    const g = c.createLinearGradient(x0, 0, spine === "left" ? w * 0.22 : w * 0.78, 0);
    g.addColorStop(0, "rgba(60,40,20,0.28)");
    g.addColorStop(0.35, "rgba(60,40,20,0.08)");
    g.addColorStop(1, "rgba(60,40,20,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  // Soft darkening at the outer edge.
  const ox = spine === "left" ? w : 0;
  const g2 = c.createLinearGradient(ox, 0, spine === "left" ? w * 0.94 : w * 0.06, 0);
  g2.addColorStop(0, "rgba(60,40,20,0.08)");
  g2.addColorStop(1, "rgba(60,40,20,0)");
  c.fillStyle = g2;
  c.fillRect(0, 0, w, h);
}

function wrap(c: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > maxW && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Draws a page of text. `spine` = side of the spine (gutter shading, wider inner margin). */
export function drawTextPage(c: Ctx, w: number, h: number, page: PageText, style: BookStyle, spine: "left" | "right", palette?: Palette): void {
  const pal = palette ?? PALETTES[style];
  drawPaper(c, w, h, pal, spine);
  const s = w / 1000;
  const inner = 120 * s;
  const outer = 84 * s;
  const left = spine === "left" ? inner : outer;
  const right = w - (spine === "left" ? outer : inner);
  const maxW = right - left;
  let y = 96 * s;
  c.textBaseline = "alphabetic";

  // Running header with a thin rule.
  c.fillStyle = pal.muted;
  c.font = `600 ${22 * s}px ${SANS}`;
  c.fillText(fit(c, page.header.toUpperCase(), maxW), left, y);
  y += 18 * s;
  c.fillStyle = pal.muted;
  c.fillRect(left, y, maxW, 2 * s);
  y += 78 * s;

  if (page.heading) {
    c.fillStyle = style === "ink" ? pal.ink : pal.accent;
    let size = 78;
    c.font = `800 ${size * s}px ${SERIF}`;
    let lines = wrap(c, page.heading, maxW);
    while (lines.length > 2 && size > 50) {
      size -= 4;
      c.font = `800 ${size * s}px ${SERIF}`;
      lines = wrap(c, page.heading, maxW);
    }
    for (const l of lines.slice(0, 3)) {
      c.fillText(l, left, y);
      y += size * 1.12 * s;
    }
    y += 22 * s;
  }

  if (page.formula) {
    let size = 84;
    c.font = `italic 700 ${size * s}px ${SERIF}`;
    while (c.measureText(page.formula).width > maxW - 60 * s && size > 34) {
      size -= 4;
      c.font = `italic 700 ${size * s}px ${SERIF}`;
    }
    const boxH = size * 1.75 * s;
    c.strokeStyle = pal.ink;
    c.lineWidth = 3 * s;
    roundRect(c, left, y, maxW, boxH, 18 * s);
    c.stroke();
    c.fillStyle = style === "ink" ? pal.accent : pal.ink;
    c.textAlign = "center";
    c.fillText(page.formula, left + maxW / 2, y + boxH / 2 + size * 0.34 * s);
    c.textAlign = "left";
    y += boxH + 46 * s;
  }

  const bottomLimit = h - (page.question ? 300 : 120) * s;
  // Largest body size (40 down to 26) at which every line fits above the bottom limit.
  let size = 40;
  const heightAt = (sz: number) => {
    c.font = `400 ${sz * s}px ${SERIF}`;
    return page.lines.reduce((acc, t) => acc + wrap(c, t, maxW - 34 * s).length * sz * 1.35 * s + 14 * s, 0);
  };
  while (size > 26 && y + heightAt(size) - size * 1.35 * s > bottomLimit) size -= 2;
  c.font = `400 ${size * s}px ${SERIF}`;
  const lh = size * 1.35 * s;
  page.lines.forEach((text, i) => {
    if (y > bottomLimit) return;
    const rows = wrap(c, text, maxW - 34 * s);
    c.fillStyle = pal.accent;
    c.beginPath();
    c.arc(left + 8 * s, y - 13 * s, 7 * s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = pal.ink;
    rows.forEach((r, j) => {
      if (y > bottomLimit) return;
      c.fillText(r, left + 34 * s, y);
      if (i === page.lines.length - 1 && j === rows.length - 1 && page.marks.length) {
        const x = left + 34 * s + c.measureText(r).width + 6 * s;
        c.save();
        c.font = `600 ${24 * s}px ${SANS}`;
        c.fillStyle = pal.mark;
        c.fillText(page.marks.map((m) => `[${m}]`).join(""), x, y - 14 * s);
        c.restore();
      }
      y += lh;
    });
    y += 14 * s;
  });

  if (page.question) {
    const qTop = h - 270 * s;
    c.setLineDash([12 * s, 9 * s]);
    c.strokeStyle = pal.ink;
    c.lineWidth = 2.5 * s;
    roundRect(c, left, qTop, maxW, 170 * s, 16 * s);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = pal.accent;
    c.font = `800 ${22 * s}px ${SANS}`;
    c.fillText(t("act.predict").toLocaleUpperCase(uiLanguage()), left + 22 * s, qTop + 40 * s);
    c.fillStyle = pal.ink;
    c.font = `italic 400 ${30 * s}px ${SERIF}`;
    wrap(c, page.question, maxW - 44 * s)
      .slice(0, 3)
      .forEach((r, j) => c.fillText(r, left + 22 * s, qTop + 82 * s + j * 38 * s));
    c.fillStyle = pal.muted;
    c.font = `600 ${21 * s}px ${SANS}`;
    c.textAlign = "right";
    c.fillText(t("book.liftFlap"), right, qTop + 205 * s);
    c.textAlign = "left";
  }

  c.fillStyle = pal.muted;
  c.font = `500 ${24 * s}px ${SERIF}`;
  c.textAlign = spine === "left" ? "right" : "left";
  c.fillText(page.folio, spine === "left" ? right : left, h - 50 * s);
  c.textAlign = "left";
}

/** Blank right page under the pop-up (paper + folio). */
export function drawBlankPage(c: Ctx, w: number, h: number, style: BookStyle, folio: string, palette?: Palette): void {
  const pal = palette ?? PALETTES[style];
  drawPaper(c, w, h, pal, "left");
  const s = w / 1000;
  c.fillStyle = pal.muted;
  c.font = `500 ${24 * s}px ${SERIF}`;
  c.textAlign = "right";
  c.fillText(folio, w - 84 * s, h - 50 * s);
  c.textAlign = "left";
}

function fit(c: Ctx, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 4 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
