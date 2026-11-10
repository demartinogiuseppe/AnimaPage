// DOM for Prevedi → Prova → Dimostra → Timbro (decision D13). The logic is ActivityState (book/activity.ts).
import type { Chapter } from "@pv/scene-spec";
import { decimalMark, t } from "@pv/scene-spec/i18n";
import type { EngineParam } from "../types.ts";
import type { ActivityState } from "../book/activity.ts";
import { h } from "./dom.ts";

export interface ActivityHooks {
  choose(k: number): void;
  /** "Dimostra": end the test now. */
  prove(): void;
  /** Flap lifted (speak the proof, etc.). */
  lifted(): void;
  /** The stamp lands: collect it (sound, persistence). */
  stamp(): void;
  /** Close the card after the stamp. */
  close(): void;
  params(): EngineParam[];
  setParams(values: Record<string, number> | null): void;
  sourceMarks(ids: readonly string[]): HTMLElement[];
  reducedMotion: boolean;
  /** False = no stamp after the proof (Accademico default, D24): "Continua" only; `stamp` is still called to close the step. */
  stamps?(): boolean;
}

const LABEL = { predict: "act.predict", test: "act.test", prove: "act.prove" } as const;

function tag(phase: keyof typeof LABEL): HTMLElement {
  return h("span", { class: `pv-act-tag ${phase}` }, t(LABEL[phase]));
}

/** One round ink stamp. */
export function stampEl(name: string, extra = ""): HTMLElement {
  return h("div", { class: `pv-stamp ${extra}`.trim(), role: "img", "aria-label": t("act.stampAria", { name }) }, h("small", {}, t("act.stamp")), h("b", {}, name));
}

export class ActivityView {
  /** Overlay host (inside the stage, or in the panel when there is no 3D stage). */
  readonly el = h("div", { class: "pv-act", "aria-live": "polite" });
  private values: Record<string, number> = {};
  private rows: Array<{ input: HTMLInputElement; out: HTMLElement; p: EngineParam }> = [];
  /** The card is folded to its header (phones: a small bottom sheet); every chapter starts folded. */
  private minimised = true;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private hooks: ActivityHooks) {}

  /** Full re-render for the current phase. */
  render(ch: Chapter, st: ActivityState | null): void {
    this.clearTimers();
    this.rows = [];
    this.el.replaceChildren();
    this.el.dataset.phase = st?.phase ?? "none";
    if (!st) return;
    const a = st.activity;
    if (st.phase === "predict") {
      const opts = a.predict.options.map((o, k) => {
        const b = h("button", { type: "button", class: "pv-act-opt" }, h("i", {}, String.fromCharCode(65 + k)), o);
        b.onclick = () => this.hooks.choose(k);
        return b;
      });
      const card = h(
        "section",
        { class: "pv-act-card predict", "aria-label": t("act.predict") },
        h("div", { class: "pv-act-head" }, tag("predict"), h("span", { class: "pv-act-step" }, t("act.step1")), this.minButton()),
        h("p", { class: "pv-act-q" }, a.predict.q),
        h("div", { class: "pv-act-opts" }, ...opts),
        h("p", { class: "pv-act-hint" }, t("act.predictHint")),
      );
      this.el.append(this.foldable(card));
    } else if (st.phase === "test") {
      const prove = h("button", { type: "button", class: "pv-btn primary small" }, t("act.proveBtn"));
      prove.onclick = () => this.hooks.prove();
      const ribbon = h(
        "section",
        { class: "pv-act-ribbon", "aria-label": t("act.test") },
        h("div", { class: "pv-act-line" }, tag("test"), h("p", {}, a.test.prompt), prove),
      );
      const sliders = this.sliders(a.test.params ?? []);
      if (sliders) ribbon.append(sliders);
      this.el.append(ribbon);
    } else if (st.phase === "prove" || st.phase === "revealed") {
      this.el.append(this.foldable(this.proveCard(ch, st)));
    }
  }

  dispose(): void {
    this.clearTimers();
  }

  private sliders(wanted: readonly string[]): HTMLElement | null {
    const params = this.hooks.params().filter((p) => wanted.includes(p.id));
    if (params.length === 0) return null;
    const box = h("div", { class: "pv-act-sliders" });
    const rows = params.map((p) => {
      const out = h("output", {}, fmt(this.values[p.id] ?? p.value));
      const input = h("input", {
        type: "range",
        min: String(p.min),
        max: String(p.max),
        step: String(p.step),
        value: String(this.values[p.id] ?? p.value),
        "aria-label": p.label,
      });
      input.addEventListener("input", () => {
        this.values[p.id] = Number(input.value);
        out.textContent = fmt(Number(input.value));
        this.hooks.setParams({ ...this.values });
      });
      return { row: h("label", { class: "pv-act-slider" }, h("b", {}, p.label), input, out), input, out, p };
    });
    const reset = h("button", { type: "button", class: "pv-btn soft small" }, t("act.reset"));
    reset.onclick = () => {
      this.values = {};
      this.hooks.setParams(null);
      const fresh = new Map(this.hooks.params().map((p) => [p.id, p.value] as const));
      for (const r of rows) {
        const v = fresh.get(r.p.id) ?? r.p.value;
        r.input.value = String(v);
        r.out.textContent = fmt(v);
      }
    };
    box.append(h("span", { class: "pv-act-try" }, t("act.try")), ...rows.map((r) => r.row), reset);
    this.rows = rows;
    return box;
  }

  /**
   * Keeps the slider readouts in step with the scene: a parameter the user has not moved follows the
   * engine's own value at the current time (call it every few frames).
   */
  syncSliders(): void {
    if (!this.rows.length || !this.rows[0]!.input.isConnected) return;
    const now = new Map(this.hooks.params().map((p) => [p.id, p.value] as const));
    for (const r of this.rows) {
      const v = this.values[r.p.id] ?? now.get(r.p.id);
      if (v === undefined) continue;
      const txt = fmt(v);
      if (r.out.textContent !== txt) r.out.textContent = txt;
      if (!(r.p.id in this.values) && document.activeElement !== r.input && Number(r.input.value) !== v) r.input.value = String(v);
    }
  }

  /** New chapter: forget slider values (the player also resets the engine) and fold the card. */
  resetValues(): void {
    this.values = {};
    this.minimised = true;
  }

  /** "Riduci / Apri" button in a card header. */
  private minButton(): HTMLElement {
    const b = h("button", { type: "button", class: "pv-act-min", "aria-label": t("act.minimise") }, h("span", { "aria-hidden": "true" }));
    b.onclick = (e) => {
      e.stopPropagation();
      this.minimised = !this.minimised;
      this.applyMin();
    };
    return b;
  }

  /** A folded card opens again with a tap anywhere on it. */
  private foldable(card: HTMLElement): HTMLElement {
    card.addEventListener("click", () => {
      if (!this.minimised) return;
      this.minimised = false;
      this.applyMin();
    });
    queueMicrotask(() => this.applyMin());
    return card;
  }

  private applyMin(): void {
    for (const c of this.el.querySelectorAll<HTMLElement>(".pv-act-card")) {
      c.classList.toggle("min", this.minimised);
      const b = c.querySelector(".pv-act-min");
      b?.setAttribute("aria-label", t(this.minimised ? "act.expand" : "act.minimise"));
      b?.setAttribute("aria-expanded", String(!this.minimised));
    }
  }

  private proveCard(ch: Chapter, st: ActivityState): HTMLElement {
    const a = st.activity;
    const verdict = h("p", { class: "pv-act-verdict" });
    const fillVerdict = () => {
      const ok = st.choice === a.predict.answer;
      const right = a.predict.options[a.predict.answer] ?? "";
      if (st.choice === null) verdict.replaceChildren(h("b", {}, t("act.answer")), right);
      else if (ok) verdict.replaceChildren(h("b", { class: "ok" }, t("act.right")), " ", right);
      else
        verdict.replaceChildren(
          h("b", { class: "bad" }, t("act.wrong")),
          t("act.wrongDetail", { chosen: a.predict.options[st.choice] ?? "", right }),
        );
    };
    const under = h("div", { class: "pv-flap-under" }, verdict, h("p", { class: "pv-act-proof" }, a.prove.text, ...this.hooks.sourceMarks(a.prove.sourceIds)));
    const flap = h(
      "button",
      { type: "button", class: "pv-flap", "aria-label": t("act.flapAria") },
      h("span", { class: "pv-flap-face" }, h("b", {}, t("act.flapTitle")), h("span", {}, t("act.flapSub"))),
      h("span", { class: "pv-flap-tab" }, t("act.flapTab")),
    );
    const wrap = h("div", { class: "pv-flap-wrap" }, under, flap);
    const foot = h("div", { class: "pv-act-foot" });
    const card = h(
      "section",
      { class: "pv-act-card prove", "aria-label": t("act.prove") },
      h("div", { class: "pv-act-head" }, tag("prove"), h("span", { class: "pv-act-step" }, t("act.step3")), this.minButton()),
      h("p", { class: "pv-act-q small" }, a.predict.q),
      wrap,
      foot,
    );

    const open = () => {
      if (wrap.classList.contains("open")) return;
      fillVerdict();
      wrap.classList.add("open");
      flap.tabIndex = -1;
      this.hooks.lifted();
      this.after(this.hooks.reducedMotion ? 0 : 750, () => this.showStamp(ch, a.stamp, foot));
    };
    if (st.phase === "revealed") {
      fillVerdict();
      wrap.classList.add("open", "instant");
      this.showStamp(ch, a.stamp, foot);
    }
    flap.onclick = open;
    // Drag the tab upwards to lift it.
    let y0: number | null = null;
    flap.addEventListener("pointerdown", (e) => (y0 = e.clientY));
    flap.addEventListener("pointermove", (e) => {
      if (y0 !== null && y0 - e.clientY > 18) {
        y0 = null;
        open();
      }
    });
    flap.addEventListener("pointerup", () => (y0 = null));
    return card;
  }

  private showStamp(_ch: Chapter, name: string, foot: HTMLElement): void {
    const close = h("button", { type: "button", class: "pv-btn primary small" }, t("act.continue"));
    close.onclick = () => this.hooks.close();
    if (this.hooks.stamps && !this.hooks.stamps()) {
      foot.replaceChildren(h("div", { class: "pv-act-got" }, close));
      this.hooks.stamp();
      return;
    }
    const s = stampEl(name, this.hooks.reducedMotion ? "" : "landing");
    foot.replaceChildren(s, h("div", { class: "pv-act-got" }, h("b", {}, t("act.earned")), close));
    // The thud plays when the stamp hits the paper (CSS animation, ~0.35 s).
    this.after(this.hooks.reducedMotion ? 0 : 330, () => this.hooks.stamp());
  }

  private after(ms: number, fn: () => void): void {
    if (ms <= 0) fn();
    else this.timers.push(setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 1 ? 2 : 1).replace(".", decimalMark());
}
