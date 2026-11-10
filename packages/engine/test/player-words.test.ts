// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneSpec } from "@pv/scene-spec";
import { createCardEngine } from "../src/engines/card/index.ts";
import type { Engine } from "../src/types.ts";
import { FakeTts, mountPlayer, type PlayerHandle } from "../src/player/index.ts";
import { storyLook } from "../src/player/player.ts";
import { wordTimes } from "../src/util/words.ts";

const card = SceneSpec.parse(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/public/scenes/card-esempio.scene.json"), "utf8")),
);

let handle: PlayerHandle | null = null;
afterEach(() => {
  vi.useRealTimers();
  handle?.dispose();
  handle = null;
  document.body.replaceChildren();
});
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

/** The card engine with a word timeline, like the storybook one. */
function timedCard(): Engine {
  const e = createCardEngine();
  return { ...e, words: (id) => card.chapters.find((c) => c.id === id)!.narration.map((s) => wordTimes(s.text, s.lang ?? card.lang, 0.98)) };
}

async function mount(spec: SceneSpec, engine: Engine) {
  const host = document.createElement("div");
  document.body.append(host);
  handle = await mountPlayer(host, spec, engine, { tts: new FakeTts(() => 60) });
}

describe("word highlight", () => {
  it("wraps the words of every sentence when the engine times them, and leaves the text intact", async () => {
    await mount(card, timedCard());
    const sentences = $$(".pv-narr > span");
    expect(sentences.length).toBeGreaterThan(0);
    for (const [i, s] of sentences.entries()) {
      expect(s.querySelectorAll(".pv-word").length, `sentence ${i}`).toBeGreaterThan(0);
      expect(s.textContent).toContain(card.chapters[0]!.narration[i]!.text);
    }
  });

  it("engines without a word timeline render the text as before", async () => {
    await mount(card, createCardEngine());
    expect($$(".pv-word")).toHaveLength(0);
  });

  it("the highlighted word follows t and never moves backwards while playing", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    await mount(card, timedCard());
    const first = $$(".pv-narr > span")[0]!;
    const words = [...first.querySelectorAll(".pv-word")];
    const offs = wordTimes(card.chapters[0]!.narration[0]!.text, card.lang, 0.98);
    const range = document.querySelector(".pv-tl-track input") as HTMLInputElement;
    $$("button")
      .find((b) => b.className.includes("pv-tl-play"))!
      .click();
    const seen: number[] = [];
    for (let i = 0; i < 150; i++) {
      vi.advanceTimersByTime(16);
      const t = Number(range.value);
      const lit = words.findIndex((w) => w.classList.contains("pv-word-on"));
      expect(first.querySelectorAll(".pv-word-on").length).toBeLessThanOrEqual(1);
      // exactly the last word whose start has passed
      if (t > 0) expect(lit).toBe(offs.filter((o) => o <= t).length - 1);
      seen.push(lit);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(Number(range.value)).toBeGreaterThan(1);
    expect(seen.at(-1)!).toBeGreaterThan(0);
  });
});

describe("storyLook", () => {
  it("a storybook always gets the pop-up book with the story look, whatever the presentation", () => {
    expect(storyLook("storybook", "academic")).toEqual({ story: true, academic: false });
    expect(storyLook("storybook", "book")).toEqual({ story: true, academic: false });
  });

  it("other engines are unchanged", () => {
    expect(storyLook("diorama", "academic")).toEqual({ story: false, academic: true });
    expect(storyLook("card", "book")).toEqual({ story: false, academic: false });
  });
});
