// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneSpec, type Chapter, type Sentence } from "@pv/scene-spec";
import { createCardEngine } from "../src/engines/card/index.ts";
import type { Engine } from "../src/types.ts";
import { AudioDirector, type AudioOut, type EngineSounds } from "../src/player/audio/director.ts";
import { FakeTts, mountPlayer, type PlayerHandle } from "../src/player/index.ts";
import { Playback } from "../src/player/playback.ts";
import { WebSpeechTts } from "../src/player/tts.ts";
import { wordAtChar, wordTimes } from "../src/util/words.ts";

class Out implements AudioOut {
  played: string[] = [];
  setLoops() {}
  setMusic() {}
  setDuck() {}
  play(sound: string) {
    this.played.push(sound);
  }
  note() {}
  stopNotes() {}
  preload() {}
}

const sentence = (at: number, text: string, extra: Partial<Sentence> = {}): Sentence => ({ at, text, highlight: [], sourceIds: [], ...extra });
const chapter: Chapter = {
  id: "c",
  title: "c",
  chip: "c",
  kind: "history",
  duration: 10,
  narration: [sentence(0, "Uno due tre quattro."), sentence(5, "Cinque sei.")],
  camera: [],
  pins: [],
  deep: [],
  quiz: [],
};
const words: EngineSounds = {
  ambience: [],
  cues: [],
  words: [{ sentence: 0, word: 2, cue: { at: 2, sound: "sb:ding" } }],
};

function director() {
  const out = new Out();
  const d = new AudioDirector(out, undefined);
  d.load(chapter, words);
  return { out, d };
}
const frame = (d: AudioDirector, t: number) => d.update({ t, playing: true, speaking: true });

describe("word cues and boundaries", () => {
  it("a boundary before the estimate fires the cue early, and the estimate does not fire it again", () => {
    const { out, d } = director();
    frame(d, 0);
    frame(d, 0.2);
    expect(out.played).toEqual([]);
    d.wordReached(0, 2);
    expect(out.played).toEqual(["sb:ding"]);
    d.wordReached(0, 2);
    for (let t = 0.4; t < 3; t += 0.2) frame(d, t);
    expect(out.played).toEqual(["sb:ding"]);
  });

  it("a boundary after the estimate does not fire it again", () => {
    const { out, d } = director();
    for (let t = 0; t < 2.5; t += 0.1) frame(d, t);
    expect(out.played).toEqual(["sb:ding"]);
    d.wordReached(0, 2);
    expect(out.played).toEqual(["sb:ding"]);
  });

  it("no boundaries: the estimate fires it", () => {
    const { out, d } = director();
    for (let t = 0; t < 3; t += 0.1) frame(d, t);
    expect(out.played).toEqual(["sb:ding"]);
  });

  it("a seek makes the cue fire again, by boundary or by the clock", () => {
    const { out, d } = director();
    frame(d, 0);
    frame(d, 0.2);
    d.wordReached(0, 2);
    d.update({ t: 0, playing: false, speaking: false }); // seek back
    d.wordReached(0, 2);
    expect(out.played).toEqual(["sb:ding", "sb:ding"]);
  });

  it("after a seek the clock fires the cue again too", () => {
    const { out, d } = director();
    for (let t = 0; t < 2.5; t += 0.1) frame(d, t);
    expect(out.played).toEqual(["sb:ding"]);
    d.update({ t: 0, playing: false, speaking: false }); // seek back
    for (let t = 0; t < 2.5; t += 0.1) frame(d, t);
    expect(out.played).toEqual(["sb:ding", "sb:ding"]);
  });

  it("load (chapter change) forgets what was played", () => {
    const { out, d } = director();
    frame(d, 0);
    d.wordReached(0, 2);
    d.load(chapter, words);
    d.wordReached(0, 2);
    expect(out.played).toEqual(["sb:ding", "sb:ding"]);
  });

  it("resetWords lets a cue sound again without any change of t", () => {
    const { out, d } = director();
    frame(d, 0);
    frame(d, 0.2);
    d.wordReached(0, 2);
    d.resetWords();
    d.wordReached(0, 2);
    expect(out.played).toEqual(["sb:ding", "sb:ding"]);
  });

  it("a boundary of another word or sentence fires nothing, and sounds off stays silent", () => {
    const { out, d } = director();
    d.wordReached(0, 1);
    d.wordReached(1, 2);
    d.soundsOn = false;
    d.wordReached(0, 2);
    expect(out.played).toEqual([]);
  });
});

describe("Playback and boundaries", () => {
  const narrated = { duration: 10, narration: [sentence(0, "Uno due tre."), sentence(5, "Quattro.", { speech: "Altro testo" })] };
  const setup = () => {
    const tts = new FakeTts(() => 30);
    const reached: [number, number][] = [];
    const pb = new Playback(tts, { onWord: (i, c) => reached.push([i, c]) });
    pb.load(narrated);
    return { tts, pb, reached };
  };

  it("reports the char index for the sentence being spoken and remembers the last one", () => {
    const { tts, pb, reached } = setup();
    pb.play();
    pb.tick(0.1);
    tts.boundary(4);
    expect(reached).toEqual([[0, 4]]);
    expect(pb.boundary).toEqual({ sentence: 0, char: 4 });
  });

  it("a sentence with a speech override ignores boundaries", () => {
    const { tts, pb, reached } = setup();
    pb.play();
    pb.tick(0.1);
    tts.finish();
    pb.tick(5);
    pb.tick(0.1);
    expect(tts.speaking).toBe("Altro testo");
    tts.boundary(2);
    expect(reached).toEqual([]);
    expect(pb.boundary).toBeNull();
  });

  it("boundaries after a seek count only for the sentence being spoken", () => {
    const { tts, pb, reached } = setup();
    pb.play();
    pb.tick(0.1);
    const old = tts.onWord!;
    old(4);
    pb.seek(0);
    expect(pb.boundary).toBeNull();
    old(8); // late event of the cancelled utterance
    expect(reached).toEqual([[0, 4]]);
    expect(pb.boundary).toBeNull();
    pb.play();
    pb.tick(0.1);
    tts.boundary(8);
    expect(reached).toEqual([[0, 4], [0, 8]]);
  });

  it("seek and jumpTo announce themselves, so the played words are forgotten", () => {
    const tts = new FakeTts(() => 30);
    let seeks = 0;
    const pb = new Playback(tts, { onSeek: () => seeks++ });
    pb.load(narrated);
    pb.seek(0);
    expect(seeks).toBe(1);
    pb.jumpTo(1);
    expect(seeks).toBe(2);
  });

  it("voices without boundary events behave as before", () => {
    const tts = new FakeTts(() => 1);
    const pb = new Playback(tts);
    pb.load(narrated);
    pb.play();
    pb.tick(0.1);
    expect(pb.boundary).toBeNull();
    expect(tts.speaking).toBe("Uno due tre.");
  });
});

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

describe("highlight and boundaries", () => {
  it("the highlight follows boundaries and never goes back", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const e = createCardEngine();
    const engine: Engine = { ...e, words: (id) => card.chapters.find((c) => c.id === id)!.narration.map((s) => wordTimes(s.text, s.lang ?? card.lang, 0.98)) };
    const tts = new FakeTts(() => 60);
    const host = document.createElement("div");
    document.body.append(host);
    handle = await mountPlayer(host, card, engine, { tts });
    const first = document.querySelector(".pv-narr > span") as HTMLElement;
    const els = [...first.querySelectorAll(".pv-word")];
    const lit = () => els.findIndex((w) => w.classList.contains("pv-word-on"));
    const text = card.chapters[0]!.narration[0]!.text;
    (document.querySelector(".pv-tl-play") as HTMLElement).click();
    vi.advanceTimersByTime(48);
    expect(lit()).toBe(0);
    tts.boundary(text.indexOf("oggetto"));
    vi.advanceTimersByTime(16);
    expect(lit()).toBe(2);
    tts.boundary(text.indexOf("complemento"));
    vi.advanceTimersByTime(16);
    expect(lit()).toBe(2);
    tts.boundary(text.indexOf("persona"));
    vi.advanceTimersByTime(16);
    expect(lit()).toBe(els.findIndex((w) => w.textContent === "persona"));
    expect(first.querySelectorAll(".pv-word-on").length).toBe(1);
  });
});

describe("wordAtChar", () => {
  it("maps a char index to the word starting at or before it", () => {
    expect(wordAtChar("Il perché è chiaro.", 3)).toBe(1);
    expect(wordAtChar("Il perché è chiaro.", 7)).toBe(1); // inside "perché"
    expect(wordAtChar("Il perché è chiaro.", 9)).toBe(1); // the space after it
    expect(wordAtChar("Il perché è chiaro.", 10)).toBe(2); // "è"
  });

  it("treats an apostrophe as part of the word", () => {
    const text = "Poi l'onda arriva";
    expect(wordAtChar(text, text.indexOf("l'onda"))).toBe(1);
    expect(wordAtChar(text, text.indexOf("onda"))).toBe(1);
    expect(wordAtChar(text, text.indexOf("arriva"))).toBe(2);
  });

  it("copes with double spaces and punctuation", () => {
    const text = "«Ciao»,  disse   lui.";
    expect(wordAtChar(text, 0)).toBe(-1); // before the first word
    expect(wordAtChar(text, 1)).toBe(0);
    expect(wordAtChar(text, 7)).toBe(0); // the gap
    expect(wordAtChar(text, text.indexOf("disse"))).toBe(1);
    expect(wordAtChar(text, text.indexOf("lui"))).toBe(2);
    expect(wordAtChar(text, 99)).toBe(2);
  });
});

describe("WebSpeechTts boundaries", () => {
  let utterances: { onboundary?: (e: { name: string; charIndex: number }) => void; onerror?: (e: { error: string }) => void; onend?: () => void }[] = [];
  const stubSpeech = () => {
    utterances = [];
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [{ name: "Elsa", lang: "it-IT" }],
      addEventListener: () => {},
      speak: (u: (typeof utterances)[number]) => utterances.push(u),
      cancel: () => {},
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
  };
  afterEach(() => vi.unstubAllGlobals());

  it("forwards word boundaries only, and ignores those of a cancelled utterance", () => {
    stubSpeech();
    const tts = new WebSpeechTts();
    expect(tts.supported).toBe(true);
    const got: number[] = [];
    tts.speak("Uno due", () => {}, undefined, undefined, (c) => got.push(c));
    const u = utterances[0]!;
    u.onboundary!({ name: "word", charIndex: 4 });
    u.onboundary!({ name: "sentence", charIndex: 0 });
    expect(got).toEqual([4]);
    tts.speak("Tre", () => {}); // the first utterance is stale now
    u.onboundary!({ name: "word", charIndex: 2 });
    expect(got).toEqual([4]);
  });

  it("sets no boundary handler when the caller wants none", () => {
    stubSpeech();
    new WebSpeechTts().speak("Uno", () => {});
    expect(utterances[0]!.onboundary).toBeUndefined();
  });

  it("the highlight carries on with the estimate when the voice fails over to the timer", async () => {
    stubSpeech();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { els, lit, text } = await mountCard(new WebSpeechTts());
    (document.querySelector(".pv-tl-play") as HTMLElement).click();
    vi.advanceTimersByTime(48);
    utterances.at(-1)!.onboundary!({ name: "word", charIndex: text.indexOf("Il") });
    vi.advanceTimersByTime(16);
    expect(lit()).toBe(0);
    utterances.at(-1)!.onerror!({ error: "network" }); // falls back to the timer, no more boundaries
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(16);
      seen.push(lit());
    }
    expect(seen.at(-1)!).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(els.length).toBeGreaterThan(2);
  });
});

async function mountCard(tts: FakeTts | WebSpeechTts) {
  const e = createCardEngine();
  const engine: Engine = { ...e, words: (id) => card.chapters.find((c) => c.id === id)!.narration.map((s) => wordTimes(s.text, s.lang ?? card.lang, 0.98)) };
  const host = document.createElement("div");
  document.body.append(host);
  handle = await mountPlayer(host, card, engine, { tts });
  const first = document.querySelector(".pv-narr > span") as HTMLElement;
  const els = [...first.querySelectorAll(".pv-word")];
  return { els, lit: () => els.findIndex((w) => w.classList.contains("pv-word-on")), text: card.chapters[0]!.narration[0]!.text };
}

describe("a voice that stops reporting", () => {
  it("keeps the last boundary word for a while, then the estimate carries on and never goes back", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const tts = new FakeTts(() => 60);
    const { lit, text } = await mountCard(tts);
    (document.querySelector(".pv-tl-play") as HTMLElement).click();
    vi.advanceTimersByTime(48);
    tts.boundary(text.indexOf("Il"));
    vi.advanceTimersByTime(1000);
    expect(lit()).toBe(0); // the voice is trusted
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      vi.advanceTimersByTime(16);
      seen.push(lit());
    }
    expect(seen.at(-1)!).toBeGreaterThan(0); // estimate took over
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });
});
