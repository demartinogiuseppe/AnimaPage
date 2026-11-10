// Render mode for the server's visual check (`?render=1`, server/src/check/render.ts).
//
// The headless browser hands the scene in with `window.pvRender.mount(spec)`, then calls
// `shot(chapterId, t)` for each picture: the player jumps to that chapter and moment, waits for the
// page turn and the pop-up to settle and resolves once the frame is drawn. UI chrome (panel, HUD,
// timeline, hints, activity cards) is hidden so the screenshot shows only the 3D stage and its labels.
// Silent: timer voice and no WebAudio.
import { SceneSpec } from "@pv/scene-spec";
import { createEngine, mountPlayer, TimerTts, type AudioOut, type Engine, type PlayerHandle } from "@pv/engine";

/** Page turn + pop-up of a chapter, with margin (the labels show once the content stands). */
export const CHAPTER_SETTLE_MS = 2600;
/** A seek within the same chapter: the scene follows the timeline at once. */
export const SEEK_SETTLE_MS = 400;

export interface RenderApi {
  mount(spec: unknown): Promise<{ ok: true; chapters: { id: string; duration: number }[] } | { ok: false; error: string }>;
  shot(chapterId: string, t: number): Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    pvRender?: RenderApi;
  }
}

const RENDER_CSS = `
.pv-app{grid-template-columns:minmax(0,1fr) !important;grid-template-rows:minmax(0,1fr) !important;padding:0 !important;gap:0 !important}
.pv-panel,.pv-hud,.pv-timeline,.pv-hint,.pv-movepad,.pv-movepad-toggle,.pv-act-card,.pv-act-ribbon,.pv-infocard,.pv-status,.pv-pickbar,.pv-arbar,.pv-ar-btn{display:none !important}
`;

const silentAudio: AudioOut = {
  setLoops: () => {},
  setMusic: () => {},
  setDuck: () => {},
  play: () => {},
  note: () => {},
  stopNotes: () => {},
  preload: () => {},
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frames = (n: number) =>
  new Promise<void>((r) => {
    const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

export function installRenderMode(app: HTMLElement): void {
  document.title = "Render · AnimaPage";
  const style = document.createElement("style");
  style.textContent = RENDER_CSS;
  document.head.append(style);

  let player: PlayerHandle | null = null;
  let current: string | null = null;

  window.pvRender = {
    async mount(json) {
      const parsed = SceneSpec.safeParse(json);
      if (!parsed.success) return { ok: false, error: `invalid scene: ${parsed.error.issues[0]?.message ?? "?"}` };
      const spec = parsed.data;
      const host = document.createElement("div");
      host.style.height = "100%";
      app.replaceChildren(host);
      let engine: Engine | null = null;
      try {
        engine = await createEngine(spec.engine);
      } catch (e) {
        return { ok: false, error: `engine "${spec.engine}" unavailable: ${e instanceof Error ? e.message : String(e)}` };
      }
      player = await mountPlayer(host, spec, engine, { tts: new TimerTts(), audio: silentAudio });
      current = spec.chapters[0]?.id ?? null;
      await wait(CHAPTER_SETTLE_MS);
      return { ok: true, chapters: spec.chapters.map((c) => ({ id: c.id, duration: c.duration })) };
    },

    async shot(chapterId, t) {
      if (!player) return { ok: false, error: "no scene mounted" };
      const changed = chapterId !== current;
      if (changed) {
        player.go(chapterId, false);
        current = chapterId;
      }
      // The timeline slider is the player's own seek control (paused, no voice).
      const range = app.querySelector<HTMLInputElement>(".pv-timeline input[type=range]");
      if (!range) return { ok: false, error: "no timeline" };
      range.value = String(t);
      range.dispatchEvent(new Event("input"));
      range.dispatchEvent(new Event("change"));
      await wait(changed ? CHAPTER_SETTLE_MS : SEEK_SETTLE_MS);
      await frames(2);
      return { ok: true };
    },
  };
  document.documentElement.dataset.pvRender = "ready";
}
