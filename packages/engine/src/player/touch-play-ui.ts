// DOM of the touch activity of a storybook chapter: the panel (prompt, the page's big letter, the six
// colours, progress dots, the stamp) and the badges over the characters (stars, numbers). The logic is the
// engine's (engines/storybook/play.ts); this only draws a TouchPlayView. Big targets, few buttons, and no
// motion when the user asked for less.
import * as THREE from "three";
import { t } from "@pv/scene-spec/i18n";
import type { MessageKey } from "@pv/scene-spec/i18n";
import type { TouchPlayView } from "../types.ts";
import { stampEl } from "./activity-ui.ts";
import { h } from "./dom.ts";

const COLOUR_NAMES: readonly MessageKey[] = ["story.red", "story.orange", "story.yellow", "story.green", "story.blue", "story.purple"];

export interface TouchPlayHooks {
  /** The child picked a colour (index of the palette). */
  choose(value: number): void;
  reducedMotion: boolean;
}

export class TouchPlayPanel {
  /** A card like the activity card: the stage docks it at the side (desktop) or as a bottom sheet (phones). */
  readonly el = h("section", { class: "pv-act-card pv-play", "aria-live": "polite" });

  constructor(private hooks: TouchPlayHooks) {
    this.el.hidden = true;
    this.el.classList.toggle("calm", hooks.reducedMotion);
  }

  /** The view on screen: the same object again (the engine hands out one until something changes) draws nothing. */
  private shown: TouchPlayView | null = null;

  /** Draws the view; null hides the panel. Redrawing keeps the focus on the swatch that had it. */
  render(view: TouchPlayView | null): void {
    if (view === this.shown) return;
    this.shown = view;
    const focused = [...this.el.querySelectorAll(".pv-play-swatch")].indexOf(document.activeElement as Element);
    this.el.hidden = !view;
    this.el.replaceChildren();
    if (!view) return;
    this.el.dataset.kind = view.kind;
    this.el.classList.toggle("done", view.complete);
    const body: HTMLElement[] = [h("p", { class: "pv-act-q pv-play-prompt" }, view.prompt)];
    if (view.complete) {
      body.push(
        h("div", { class: "pv-play-win" }, h("b", {}, t("story.bravo")), stampEl(view.stamp, this.hooks.reducedMotion ? "" : "landing")),
      );
    } else {
      if (view.kind === "letter" && view.letter) body.push(h("div", { class: "pv-play-letter", role: "img", "aria-label": t("story.letterAria", { letter: view.letter }) }, view.letter));
      if (view.kind === "color" && view.palette) {
        const swatches = view.palette.map((colour, k) => {
          const b = h("button", { type: "button", class: "pv-play-swatch", "aria-label": t(COLOUR_NAMES[k] ?? "story.palette"), "aria-pressed": String(view.picked === k) });
          b.style.background = colour;
          b.onclick = () => this.hooks.choose(k);
          return b;
        });
        body.push(h("div", { class: "pv-play-palette", role: "group", "aria-label": t("story.palette") }, ...swatches));
      }
    }
    const { done, total } = view.progress;
    const dots = Array.from({ length: total }, (_, i) => h("i", { class: `pv-play-dot${i < done ? " on" : ""}` }));
    body.push(h("div", { class: "pv-play-dots", role: "img", "aria-label": t("story.progress", { done, total }) }, ...dots));
    this.el.append(...body);
    if (focused >= 0) this.el.querySelectorAll<HTMLElement>(".pv-play-swatch")[focused]?.focus();
  }
}

/** One badge over a character: a number or a star. */
interface Badge {
  id: string;
  el: HTMLElement;
}

const v = new THREE.Vector3();

/** The badges, projected onto the stage every frame (the same technique as the pin layer's labels). */
export class MarkLayer {
  readonly el = h("div", { class: "pv-play-marks", "aria-hidden": "true" });
  private badges: Badge[] = [];
  private key = "";

  constructor(private reducedMotion: boolean) {}

  /** Replaces the badges; the same list again changes nothing (so a badge's pop plays once). */
  set(marks: readonly { id: string; text: string }[]): void {
    const key = marks.map((m) => `${m.id}:${m.text}`).join("|");
    if (key === this.key) return;
    // Keep the badges that stay as they are; only a new one pops in.
    const old = new Map(this.badges.map((b) => [`${b.id}:${b.el.textContent}`, b]));
    this.badges = marks.map((m) => {
      const kept = old.get(`${m.id}:${m.text}`);
      if (kept) return kept;
      return { id: m.id, el: h("span", { class: `pv-play-badge${this.reducedMotion ? "" : " pop"}` }, m.text) };
    });
    this.key = key;
    this.el.replaceChildren(...this.badges.map((b) => b.el));
  }

  /**
   * `resolve` writes the world position over the character `id` (false = not on stage); `project` turns it
   * into normalised device coordinates. Nothing is allocated here.
   */
  update(resolve: (id: string, out: THREE.Vector3) => boolean, project: (p: THREE.Vector3) => THREE.Vector3, width: number, height: number): void {
    for (const b of this.badges) {
      const ok = resolve(b.id, v);
      const n = ok ? project(v) : null;
      const on = !!n && n.z < 1 && Math.abs(n.x) <= 1.1 && Math.abs(n.y) <= 1.1;
      b.el.hidden = !on;
      if (n && on) b.el.style.transform = `translate(${((n.x + 1) / 2) * width}px,${((1 - n.y) / 2) * height}px) translate(-50%,-50%)`;
    }
  }
}
