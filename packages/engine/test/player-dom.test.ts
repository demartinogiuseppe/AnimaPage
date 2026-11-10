// @vitest-environment happy-dom
// Thin smoke test of the DOM wiring; the logic itself is covered by the other player tests.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneSpec } from "@pv/scene-spec";
import { sceneKey, StampStore } from "../src/book/activity.ts";
import { arEnabled } from "../src/player/player.ts";
import { createCardEngine } from "../src/engines/card/index.ts";
import { FakeTts, mountPlayer, type PlayerHandle, type PlayerOptions } from "../src/player/index.ts";

const card = SceneSpec.parse(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/public/scenes/card-esempio.scene.json"), "utf8")),
);

let handle: PlayerHandle | null = null;
afterEach(() => {
  vi.unstubAllGlobals();
  handle?.dispose();
  handle = null;
  document.body.replaceChildren();
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const button = (text: string) => $$("button").find((b) => b.textContent?.includes(text))!;
const off = (el: HTMLElement) => el.classList.contains("off");

async function mount(spec: SceneSpec, tts: FakeTts, extra: Partial<PlayerOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  handle = await mountPlayer(host, spec, createCardEngine(), { tts, ...extra });
}

describe("player DOM (card)", () => {
  it("renders a single column with chapters, narration, deep dives, quiz, sources and disclaimers", async () => {
    await mount(card, new FakeTts());
    expect($(".pv-app").classList.contains("pv-nostage")).toBe(true);
    expect($(".pv-stage")).toBeNull();
    expect($$(".pv-chips button").map((b) => b.textContent)).toEqual(["Che cos'è", "Casi particolari"]);
    expect($$(".pv-narr > span")).toHaveLength(5);
    expect($(".pv-narr-card .pv-timeline")).not.toBeNull();
    expect($$(".pv-tl-marks i")).toHaveLength(5);
    expect($(".pv-sources a").getAttribute("href")).toBe("https://it.wikipedia.org/wiki/Complemento_oggetto");
    expect($(".pv-sources .meta").textContent).toContain("consultata il 3 novembre 2026");
    expect($$(".pv-src")[0]!.textContent).toBe("[1]");
    expect($$(".pv-foot p")).toHaveLength(2);
    expect($("iframe")).toBeNull();
  });

  it("tap on a sentence speaks it; quiz feedback is shown and spoken", async () => {
    const tts = new FakeTts();
    await mount(card, tts);
    $$(".pv-narr > span")[1]!.click();
    await new Promise((r) => setTimeout(r, 50)); // let the frame loop tick
    expect(tts.spoken).toContain("Di norma lo regge un verbo transitivo attivo.");

    button("Luca legge un libro.").click();
    expect($(".pv-fb").textContent).toContain("Giusto!");
    expect(tts.spoken.at(-1)).toMatch(/^Giusto! /);
    expect($$(".pv-opts button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    button("Domanda successiva").click();
    button("Dove? Quando?").click();
    expect($(".pv-fb").textContent).toContain("Non proprio.");
    button("Vedi il risultato").click();
    expect($(".pv-quiz").textContent).toContain("Hai risposto bene a 1 domande su 2.");
    button("Capitolo successivo: Casi particolari").click();
    expect($("h2").textContent).toBe("Partitivo e interno");
  });

  it("timeline arrows move between chapters, start the voice, and keep their place at the ends", async () => {
    const tts = new FakeTts();
    await mount(card, tts);
    const prev = $(".pv-tl-prev") as HTMLButtonElement;
    const next = $(".pv-tl-next") as HTMLButtonElement;
    expect(off(prev)).toBe(true);
    expect(off(next)).toBe(false);
    expect(next.getAttribute("aria-label")).toBe("Capitolo successivo: Casi particolari");

    next.focus();
    next.click();
    expect($("h2").textContent).toBe("Partitivo e interno");
    await new Promise((r) => setTimeout(r, 50)); // let the frame loop tick
    expect($(".pv-tl-play").getAttribute("aria-label")).toBe("Pausa");
    // Last chapter: "next" stays in the bar (nothing shifts under a second tap), invisible and out of the tab order.
    expect(next.isConnected && !next.hidden).toBe(true);
    expect(off(next)).toBe(true);
    expect(next.tabIndex).toBe(-1);
    expect(next.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(prev);
    expect(off(prev)).toBe(false);
    expect(prev.getAttribute("aria-label")).toBe("Capitolo precedente: Che cos'è");

    $(".pv-tl-play").click(); // pause, so the next check proves "previous" starts the voice
    await new Promise((r) => setTimeout(r, 50));
    expect($(".pv-tl-play").getAttribute("aria-label")).toBe("Avvia");
    prev.click();
    expect($(".pv-chips button[aria-current='true']").textContent).toBe("Che cos'è");
    await new Promise((r) => setTimeout(r, 50));
    expect($(".pv-tl-play").getAttribute("aria-label")).toBe("Pausa");
    expect(off(prev)).toBe(true);
    expect(off(next)).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it("the guided tour goes on from the chapter the arrows lead to", async () => {
    await mount(card, new FakeTts());
    button("Visita guidata").click();
    ($(".pv-tl-next") as HTMLButtonElement).click();
    expect($("h2").textContent).toBe("Partitivo e interno");
    expect($(".pv-head .pv-btn.primary").textContent).toBe("Ferma la visita");
  });
});

describe("player DOM: Avanti da sola", () => {
  const KEY = "pv.player.autonext";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const run = async (on: boolean) => {
    localStorage.setItem(KEY, "0");
    const tts = new FakeTts();
    await mount(card, tts);
    const sw = $$("label.pv-switch").find((l) => l.textContent === "Avanti da sola")!.querySelector("input") as HTMLInputElement;
    expect(sw.checked).toBe(false);
    if (on) {
      sw.click();
      expect(localStorage.getItem(KEY)).toBe("1");
    }
    // Seek to just before the end of the chapter, then let it play out.
    const range = $(".pv-tl-track input") as HTMLInputElement;
    range.value = String(Number(range.max) - 0.3);
    range.dispatchEvent(new Event("input"));
    ($(".pv-tl-play") as HTMLButtonElement).click();
    for (let i = 0; i < 30; i++) {
      await sleep(20);
      tts.tick(10);
    }
    await sleep(1500);
  };
  afterEach(() => localStorage.setItem(KEY, "0"));

  it("at the end of a chapter it goes on to the next one", async () => {
    await run(true);
    expect($("h2").textContent).toBe("Partitivo e interno");
  });

  it("off (the default) it stops at the end of the chapter", async () => {
    await run(false);
    expect($("h2").textContent).not.toBe("Partitivo e interno");
  });
});

describe("player DOM (3D engine without WebGL)", () => {
  it("falls back to text only, never turns pick mode on by itself", async () => {
    const ch = card.chapters[0]!;
    const spec = {
      ...card,
      engine: "map",
      chapters: [
        {
          ...ch,
          camera: [{ at: 0, target: { pos: [0, 0, 0] }, distance: 5, azimuth: 0, elevation: 30 }],
          pins: [{ id: "p", name: "Punto", info: "Un punto.", kind: "city", anchor: { pos: [0, 0, 0] }, sourceIds: [] }],
          quiz: [{ type: "pick", q: "Dov'è il punto?", answerPins: ["p"], explain: "Qui." }],
        },
      ],
    } as unknown as SceneSpec;
    await mount(spec, new FakeTts());
    await new Promise((r) => setTimeout(r, 50));
    expect($(".pv-fail").textContent).toMatch(/Spiegazioni, voce e domande funzionano comunque/);
    expect($(".pv-stage").classList.contains("pv-picking")).toBe(false);
    expect($(".pv-pickbar").hidden).toBe(true);
    expect(button("Rispondi sulla scena")).toBeUndefined();
    button("Mostra la risposta").click();
    expect($(".pv-fb").textContent).toBe("Qui.");
  });
});

describe("player DOM: first chapter ahead of the lesson (D22)", () => {
  const firstOnly = { ...card, chapters: [card.chapters[0]!] };
  const rest = [{ id: "dopo", chip: "Dopo", kind: "history" as const }];

  async function mountFirst(onContinue: (id: string, tour: boolean) => void) {
    const host = document.createElement("div");
    document.body.append(host);
    handle = await mountPlayer(host, firstOnly, createCardEngine(), { tts: new FakeTts(), following: { onContinue } });
    return handle;
  }

  it("shows a disabled 'in preparazione' chip until the next chapters are known, then moves on through them", async () => {
    const moves: [string, boolean][] = [];
    const h = await mountFirst((id, tour) => moves.push([id, tour]));
    const pending = $(".pv-chips .pv-pending") as HTMLButtonElement;
    expect(pending.textContent).toBe("Altri capitoli in preparazione…");
    expect(pending.disabled).toBe(true);
    expect(button("Capitolo successivo")).toBeUndefined();

    h.setFollowing(rest);
    expect($(".pv-chips .pv-pending")).toBeNull();
    expect($$(".pv-chips button").map((b) => b.textContent)).toEqual(["Che cos'è", "Dopo"]);
    // The user is still where they were: chapter 1, nothing swapped.
    expect($(".pv-chips button[aria-current='true']").textContent).toBe("Che cos'è");
    expect(moves).toEqual([]);
    button("Dopo").click();
    expect(moves).toEqual([["dopo", false]]);
  });

  it("the timeline's next arrow waits for the following chapters, then leads into them, tour or not", async () => {
    const moves: [string, boolean][] = [];
    const h = await mountFirst((id, tour) => moves.push([id, tour]));
    const next = $(".pv-tl-next") as HTMLButtonElement;
    expect(off(next)).toBe(true);
    h.setFollowing(rest);
    expect(off(next)).toBe(false);
    expect(next.getAttribute("aria-label")).toBe("Capitolo successivo: Dopo");
    next.click();
    button("Visita guidata").click();
    next.click();
    expect(moves).toEqual([
      ["dopo", false],
      ["dopo", true],
    ]);
  });

  it("the quiz's 'next chapter' leads into the complete lesson once it is there", async () => {
    const moves: string[] = [];
    const h = await mountFirst((id) => moves.push(id));
    h.setFollowing(rest);
    for (let i = 0; i < 5 && !button("Capitolo successivo"); i++) {
      $$(".pv-opts button")[0]?.click();
      (button("Domanda successiva") ?? button("Vedi il risultato"))?.click();
    }
    button("Capitolo successivo: Dopo").click();
    expect(moves).toEqual(["dopo"]);
  });

  it("no following chapters ([]): no pending chip, nothing to continue to", async () => {
    const h = await mountFirst(() => {});
    h.setFollowing([]);
    expect($$(".pv-chips button").map((b) => b.textContent)).toEqual(["Che cos'è"]);
  });

  it("the complete lesson opens on the chapter the user moved to, with the tour still on", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    handle = await mountPlayer(host, card, createCardEngine(), { tts: new FakeTts(), start: { chapter: card.chapters[1]!.id, tour: true } });
    expect($(".pv-chips button[aria-current='true']").textContent).toBe("Casi particolari");
    expect($(".pv-head .pv-btn.primary").textContent).toBe("Ferma la visita");
  });

  it("exported lesson shows Ricomincia and no AR button", async () => {
    await mount(card, new FakeTts(), { exported: true });
    expect(button("Ricomincia")).toBeDefined();
    expect($$(".pv-note").some((n) => n.textContent === "Serve internet")).toBe(true);
  });

  it("AR is off in an exported lesson and needs a stage", () => {
    expect(arEnabled(true, false)).toBe(true);
    expect(arEnabled(true, true)).toBe(false);
    expect(arEnabled(false, false)).toBe(false);
  });

  it("Ricomincia clears this lesson's stamps and resets the visible state", async () => {
    const m = new Map<string, string>();
    const store = new StampStore({
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    });
    const act = {
      predict: { q: "Che cosa succede?", options: ["A", "B", "C"], answer: 1 },
      test: { prompt: "Guarda.", params: ["a"] },
      prove: { text: "Perché sì.", sourceIds: [] },
      stamp: "Esploratore",
    };
    const spec = { ...card, chapters: card.chapters.map((c, i) => (i === 0 ? { ...c, activity: act } : c)) } as SceneSpec;
    const key = sceneKey(spec);
    store.add(key, spec.chapters[0]!.id, "Esploratore");
    vi.stubGlobal("confirm", () => true);
    await mount(spec, new FakeTts(), { exported: true, stamps: store });
    expect($(".pv-stamps").textContent).toContain("Esploratore");
    button("Luca legge un libro.").click();
    expect($(".pv-fb")).not.toBeNull();
    button("Visita guidata").click();
    expect($(".pv-head .pv-btn.primary").textContent).toBe("Ferma la visita");

    button("Ricomincia").click();
    expect(store.load(key)).toEqual({});
    expect($(".pv-stamps").textContent).not.toContain("Esploratore");
    expect($(".pv-fb")).toBeNull();
    expect($$(".pv-opts button").some((b) => (b as HTMLButtonElement).disabled)).toBe(false);
    expect($(".pv-head .pv-btn.primary").textContent).toBe("Visita guidata");
  });
});
