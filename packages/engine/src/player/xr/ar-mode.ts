// AR mode UI (docs/m5/ar.md): the "Vedi sul tavolo (AR)" button, the AR control bar and hints.
// The player's own stage UI (timeline, HUD style switch, activity cards and sliders, info card,
// labels) stays in the stage element, which is the DOM overlay root while presenting.
import { t } from "@pv/scene-spec/i18n";
import { h } from "../dom.ts";
import type { Stage } from "../stage.ts";
import { arSupported, ArSession } from "./ar-session.ts";
import type { ReticlePhase } from "./reticle.ts";

export interface ArModeHost {
  stage: Stage;
  /** The stage element: DOM overlay root in AR. */
  stageEl: HTMLElement;
  /** Where the AR button goes (HUD, next to "Centra"). */
  buttonSlot: HTMLElement;
  /** The player's frame function (ms). */
  loop(now: number): void;
  pauseLoop(): void;
  resumeLoop(): void;
  prevChapter(): void;
  nextChapter(): void;
  touch(): void;
}

const TXT = {
  get button() {
    return t("ar.button");
  },
  get seeking() {
    return t("ar.seeking");
  },
  get found() {
    return t("ar.found");
  },
  get placed() {
    return t("ar.placed");
  },
  get noOverlay() {
    return t("ar.noOverlay");
  },
  get fail() {
    return t("ar.fail");
  },
};
/** The gesture tip after placing fades out after this long. */
const PLACED_TIP_MS = 4000;

export class ArMode {
  readonly button: HTMLButtonElement;
  private bar: HTMLElement;
  private msg: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private replaceBtn: HTMLButtonElement;
  private session: ArSession | null = null;
  private starting = false;
  private msgTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private host: ArModeHost) {
    this.button = h("button", { class: "pv-icon-btn pv-ar-btn", type: "button", "aria-label": TXT.button }, h("span", { class: "long" }, t("ar.buttonLong")), "(AR)");
    this.button.hidden = true;
    this.button.onclick = () => void this.start();
    host.buttonSlot.prepend(this.button);

    this.replaceBtn = h("button", { type: "button" }, t("ar.reposition"));
    this.replaceBtn.onclick = () => this.session?.reposition();
    const exit = h("button", { type: "button", class: "exit" }, t("ar.exit"));
    exit.onclick = () => this.session?.end();
    this.prevBtn = h("button", { type: "button", "aria-label": t("ar.prev") }, "‹");
    this.nextBtn = h("button", { type: "button", "aria-label": t("ar.next") }, "›");
    this.prevBtn.onclick = () => host.prevChapter();
    this.nextBtn.onclick = () => host.nextChapter();
    this.bar = h(
      "div",
      { class: "pv-arbar", role: "group", "aria-label": t("ar.group") },
      exit,
      this.replaceBtn,
      h("div", { class: "pv-arbar-ch" }, this.prevBtn, this.nextBtn),
    );
    this.msg = h("div", { class: "pv-ar-msg", role: "status" });
    this.bar.hidden = this.msg.hidden = true;
    host.stageEl.append(this.bar, this.msg);

    // Shown only where an immersive-ar session can really start (Android Chrome with ARCore).
    void arSupported().then((ok) => {
      if (!this.disposed) this.button.hidden = !ok;
    });
  }

  get active(): boolean {
    return this.session !== null;
  }

  /** Once per frame, before Stage.frame. */
  update(): void {
    this.session?.update();
  }

  /** Chapter arrows follow the player's chapter. */
  chapter(hasPrev: boolean, hasNext: boolean): void {
    this.prevBtn.disabled = !hasPrev;
    this.nextBtn.disabled = !hasNext;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.msgTimer);
    this.session?.end();
    this.button.remove();
    this.bar.remove();
    this.msg.remove();
  }

  private async start(): Promise<void> {
    if (this.session || this.starting) return;
    this.starting = true;
    const host = this.host;
    try {
      this.session = await ArSession.start(host.stage, host.stageEl, {
        loop: host.loop,
        takeLoop: host.pauseLoop,
        phase: (p) => this.showPhase(p),
        touch: host.touch,
        ended: () => {
          this.session = null;
          this.bar.hidden = this.msg.hidden = true;
          if (!this.disposed) host.resumeLoop();
        },
      });
      this.bar.hidden = !this.session.overlay;
      this.showPhase(this.session.phase);
    } catch (e) {
      console.warn("[player] AR session failed:", e);
      this.session = null;
      if (this.disposed) return;
      host.resumeLoop();
      this.say(TXT.fail, 7000);
    } finally {
      this.starting = false;
    }
  }

  private showPhase(p: ReticlePhase): void {
    this.replaceBtn.disabled = p !== "placed";
    if (this.session && !this.session.overlay) return this.say(TXT.noOverlay);
    if (p === "placed") this.say(TXT.placed, PLACED_TIP_MS);
    else this.say(p === "found" ? TXT.found : TXT.seeking);
  }

  private say(text: string, ms = 0): void {
    clearTimeout(this.msgTimer);
    this.msg.textContent = text;
    this.msg.hidden = false;
    if (ms > 0) this.msgTimer = setTimeout(() => (this.msg.hidden = true), ms);
  }
}
