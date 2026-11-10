// @vitest-environment happy-dom
// The player's wiring of a storybook touch activity: the panel at the chapter's end, the stamp, and the guided
// tour / "Avanti da sola" waiting for it. The 3D stage (WebGL) and the engine are fakes; the engine's own
// behaviour is covered by storybook-play.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneSpec } from "@pv/scene-spec";
import { sceneKey, StampStore } from "../src/book/activity.ts";
import type { Engine, TouchPlayView } from "../src/types.ts";
import { FakeTts, mountPlayer, type PlayerHandle } from "../src/player/index.ts";

const { canvas } = vi.hoisted(() => ({ canvas: document.createElement("canvas") }));
vi.mock("../src/player/stage.ts", async (orig) => {
  const real = await orig<typeof import("../src/player/stage.ts")>();
  const fake = new Proxy(
    {
      renderer: { domElement: canvas },
      width: 800,
      height: 600,
      narrow: false,
      inside: 1,
      contentShown: true,
      contentGrids: () => ({}),
      pickRay: () => new THREE.Ray(),
      project: (v: THREE.Vector3) => v,
      resolveWorld: () => false,
      anchorShown: () => true,
      occluded: () => false,
    } as Record<string, unknown>,
    { get: (t, k: string) => (k in t ? t[k] : k === "then" ? undefined : () => {}) },
  );
  return { ...real, Stage: { ...real.Stage, create: async () => fake } };
});

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/public/scenes/_dev-storie.scene.json"), "utf8"));

/** The dev story cut down to two short chapters (a letter hunt, then an order), so the end comes quickly. */
function shortSpec(): SceneSpec {
  const d = structuredClone(raw);
  const keep = ["mare", "tuffo"];
  d.chapters = d.chapters
    .filter((c: { id: string }) => keep.includes(c.id))
    .map((c: { narration: unknown[] }) => ({ ...c, duration: 1, narration: [{ ...(c.narration[0] as object), at: 0 }], pins: [], quiz: [], camera: [] }));
  d.engineData.chapters = d.engineData.chapters.filter((c: { chapter: string }) => keep.includes(c.chapter)).map((c: object) => ({ ...c, acts: [] }));
  return SceneSpec.parse(d);
}

/** An engine with a letter hunt in "mare" and an order in "tuffo"; one touch finishes the chapter's play. */
function fakeEngine() {
  const state = { complete: { mare: false, tuffo: false } as Record<string, boolean>, taps: 0 };
  const views = new Map<string, TouchPlayView>();
  const view = (id: "mare" | "tuffo"): TouchPlayView => ({
    kind: id === "mare" ? "letter" : "order",
    prompt: id === "mare" ? "Tocca le B." : "In fila.",
    ...(id === "mare" ? { letter: "B" } : {}),
    progress: { done: state.complete[id] ? 1 : 0, total: 1 },
    stamp: id === "mare" ? "Cercatore di B" : "Maestro delle misure",
    complete: state.complete[id]!,
    marks: [],
  });
  const engine: Engine = {
    build: async () => {},
    update: () => {},
    resolveAnchor: () => false,
    bounds: () => ({ center: new THREE.Vector3(), radius: 5 }),
    play: (id) => {
      if (id !== "mare" && id !== "tuffo") return null;
      let v = views.get(id);
      if (!v) views.set(id, (v = view(id)));
      return v;
    },
    tap: (id) => {
      state.taps++;
      if (state.complete[id]) return { sound: "sb:boing-1" };
      state.complete[id] = true;
      views.delete(id);
      return { sound: "sb:ta-da-1", complete: true };
    },
    dispose: () => {},
  };
  return { engine, state };
}

let handle: PlayerHandle | null = null;
afterEach(() => {
  handle?.dispose();
  handle = null;
  document.body.replaceChildren();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const current = () => $(".pv-chips button[aria-current='true']").textContent;

function memStore(): { store: StampStore; data: Map<string, string> } {
  const data = new Map<string, string>();
  const store = new StampStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) });
  return { store, data };
}

async function mount(opts: { stamps?: StampStore; autoNext?: boolean; tour?: boolean } = {}) {
  if (opts.autoNext) localStorage.setItem("pv.player.autonext", "1");
  const spec = shortSpec();
  const { engine, state } = fakeEngine();
  const tts = new FakeTts();
  const host = document.createElement("div");
  document.body.append(host);
  const stamps = opts.stamps ?? memStore().store;
  handle = await mountPlayer(host, spec, engine, { tts, stamps });
  const finishVoice = setInterval(() => tts.finish(), 20);
  const stop = () => clearInterval(finishVoice);
  // Plays the first chapter to its end (the voice is finished as it goes).
  const playToEnd = async () => {
    if (opts.tour) $$("button").find((b) => b.textContent?.includes("Visita guidata"))!.click();
    else $(".pv-tl-play").click();
    for (let i = 0; i < 200 && $(".pv-play").hidden; i++) await sleep(20);
  };
  return { spec, state, engine, stop, playToEnd, key: sceneKey(spec), stamps };
}

function pointer(type: string, id = 1): Event {
  return Object.assign(new Event(type), { pointerId: id, clientX: 10, clientY: 10, button: 0, isPrimary: true, pointerType: "mouse" });
}
const tapCanvas = () => {
  canvas.dispatchEvent(pointer("pointerdown"));
  canvas.dispatchEvent(pointer("pointerup"));
};

describe("pins during the activity", () => {
  it("the stage lets pins through only while the activity is live", async () => {
    const m = await mount();
    expect($(".pv-stage").classList.contains("pv-playing")).toBe(false);
    await m.playToEnd();
    expect($(".pv-stage").classList.contains("pv-playing")).toBe(true);
    m.stop();
  });
});

describe("the touch activity on a phone", () => {
  it("sits in the lesson panel, above the title, not over the stage; on a wide screen it overlays the stage", async () => {
    const mq = (matches: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: matches && q.includes("max-width: 600px"), media: q, addEventListener() {}, removeEventListener() {} }));
    mq(true);
    const m = await mount();
    await m.playToEnd();
    const el = $(".pv-play");
    expect(el.hidden).toBe(false);
    expect(el.closest(".pv-stage")).toBeNull();
    expect(el.parentElement).toBe($(".pv-panel"));
    expect(el.nextElementSibling).toBe($(".pv-head"));
    expect(el.classList.contains("below")).toBe(true);
    m.stop();
    vi.unstubAllGlobals();
  });

  it("stays over the stage with a wide screen", async () => {
    const m = await mount();
    await m.playToEnd();
    expect($(".pv-play").closest(".pv-stage")).not.toBeNull();
    expect($(".pv-play").classList.contains("below")).toBe(false);
    m.stop();
  });
});

describe("the touch activity in the player", () => {
  it("shows the panel at the chapter's end, and the guided tour waits there", async () => {
    const m = await mount({ tour: true });
    await m.playToEnd();
    expect($(".pv-play").hidden).toBe(false);
    expect($(".pv-play").textContent).toContain("Tocca le B.");
    await sleep(1600);
    expect(current()).toBe("Mare");
    m.stop();
  });

  it("'Avanti da sola' waits for the play too, and the next-chapter button still works", async () => {
    const m = await mount({ autoNext: true });
    await m.playToEnd();
    await sleep(1600);
    expect(current()).toBe("Mare");
    $(".pv-tl-next").click();
    expect(current()).toBe("Tuffo");
    m.stop();
  });

  it("completing the play awards the stamp through the StampStore and the tour goes on after the gap", async () => {
    const { store, data } = memStore();
    const m = await mount({ tour: true, stamps: store });
    await m.playToEnd();
    tapCanvas();
    expect(m.state.complete.mare).toBe(true);
    expect(store.load(m.key)).toEqual({ mare: "Cercatore di B" });
    expect([...data.keys()]).toEqual([`pv.stamps.${m.key}`]);
    expect($(".pv-play .pv-stamp")?.textContent).toContain("Cercatore di B");
    // The stamps card lists the storybook chapters that have a play, the earned one filled.
    expect($$(".pv-stamps .pv-stamp")).toHaveLength(2);
    expect($$(".pv-stamps .pv-stamp.empty")).toHaveLength(1);
    expect(current()).toBe("Mare");
    for (let i = 0; i < 100 && current() === "Mare"; i++) await sleep(30);
    expect(current()).toBe("Tuffo");
    m.stop();
  });

  it("'Avanti da sola' goes on after the completing touch, after the gap", async () => {
    const m = await mount({ autoNext: true });
    await m.playToEnd();
    tapCanvas();
    expect(current()).toBe("Mare");
    for (let i = 0; i < 100 && current() === "Mare"; i++) await sleep(30);
    expect(current()).toBe("Tuffo");
    m.stop();
  });

  it("a chapter whose stamp is already in the store (reload) does not make the tour wait", async () => {
    const { store } = memStore();
    const spec = shortSpec();
    store.add(sceneKey(spec), "mare", "Cercatore di B");
    const m = await mount({ tour: true, stamps: store });
    await m.playToEnd();
    for (let i = 0; i < 100 && current() === "Mare"; i++) await sleep(30);
    expect(current()).toBe("Tuffo");
    m.stop();
  });

  it("the stamps card lists the storybook chapters with a play before anything is earned", async () => {
    const m = await mount();
    expect($$(".pv-stamps .pv-stamp.empty")).toHaveLength(2);
    expect($(".pv-stamps").hidden).toBe(false);
    m.stop();
  });

  it("a press that leaves the canvas, or loses its capture, does not swallow the next tap", async () => {
    const m = await mount();
    await m.playToEnd();
    for (const reset of ["pointerleave", "lostpointercapture"]) {
      const before = m.state.taps;
      canvas.dispatchEvent(pointer("pointerdown"));
      canvas.dispatchEvent(pointer(reset));
      tapCanvas();
      expect(m.state.taps, reset).toBe(before + 1);
    }
    // Without a reset in between, a stale press turns the next one into a gesture: no tap.
    const before = m.state.taps;
    canvas.dispatchEvent(pointer("pointerdown"));
    tapCanvas();
    expect(m.state.taps).toBe(before);
    m.stop();
  });
});
