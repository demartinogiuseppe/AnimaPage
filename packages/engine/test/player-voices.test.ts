import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkScene, SceneSpec } from "@pv/scene-spec";
import { assignVoices, chooseVoice, FakeTts, isForeign, langTag, NARRATOR_RATE, voiceGender, type VoiceSpec } from "../src/player/tts.ts";
import { Playback } from "../src/player/playback.ts";
import { DEFAULT_THEME, readTheme, themeById, themeCss, THEMES, writeTheme } from "../src/player/themes.ts";
import { entryPopAt, ENTRY_POP_DELAY, POP_WINDOW, popAt } from "../src/book/popup.ts";

const v = (name: string, lang = "it-IT") => ({ name, lang });
const WIN = [
  v("Microsoft Elsa - Italian (Italy)"),
  v("Microsoft Cosimo - Italian (Italy)"),
  v("Microsoft Isabella Online (Natural) - Italian (Italy)"),
  v("Microsoft Diego Online (Natural) - Italian (Italy)"),
  v("Microsoft Zira - English", "en-US"),
];
const NARRATOR = WIN[2]!;

describe("dialogue voices", () => {
  it("guesses the gender of known Italian voices", () => {
    expect(voiceGender("Microsoft Elsa - Italian")).toBe("female");
    expect(voiceGender("Alice")).toBe("female");
    expect(voiceGender("Microsoft Diego Online (Natural)")).toBe("male");
    expect(voiceGender("Luca")).toBe("male");
    expect(voiceGender("it-it-x-itb-local")).toBe("any");
  });

  it("gives each character a distinct Italian voice of the preferred gender, never the narrator's", () => {
    const specs: VoiceSpec[] = [
      { id: "antonio", name: "Antonio", prefer: "male" },
      { id: "maria", name: "Maria", prefer: "female" },
      { id: "luigi", name: "Luigi", prefer: "male" },
    ];
    const cast = assignVoices(WIN, specs, NARRATOR);
    const a = cast.get("antonio")!;
    const m = cast.get("maria")!;
    const l = cast.get("luigi")!;
    expect(voiceGender(a.voice!.name)).toBe("male");
    expect(a.voice!.name).toMatch(/Diego/); // natural voices first
    expect(m.voice!.name).toMatch(/Elsa/);
    expect(l.voice!.name).toMatch(/Cosimo/);
    const names = [a, m, l].map((c) => c.voice!.name);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain(NARRATOR.name);
    expect(a.rate).toBe(NARRATOR_RATE);
  });

  it("varies pitch and pace when there are not enough voices", () => {
    const one = [v("Google italiano")];
    const cast = assignVoices(one, [{ id: "a", name: "A", prefer: "male" }, { id: "b", name: "B" }], one[0]!);
    expect(cast.get("a")!.pitch).toBeLessThan(1);
    expect(cast.get("b")!.pitch).not.toBe(1);
    expect(cast.get("a")!.voice).not.toBeNull();
    // Explicit pitch/rate win.
    const c2 = assignVoices(one, [{ id: "x", name: "X", pitch: 1.5, rate: 1.2 }], one[0]!);
    expect(c2.get("x")).toMatchObject({ pitch: 1.5, rate: 1.2 });
    // No Italian voice at all: still a choice (the browser default) with a variation.
    expect(assignVoices([], [{ id: "x", name: "X" }], null).get("x")!.voice).toBeNull();
  });

  it("speaks each character in its language, distinct voices by gender, falling back to the base language", () => {
    const voices = [
      ...WIN,
      v("Microsoft Hazel - English (United Kingdom)", "en-GB"),
      v("Microsoft George - English (United Kingdom)", "en-GB"),
      v("Microsoft Ryan Online (Natural) - English (United Kingdom)", "en-GB"),
      v("Microsoft David - English (United States)", "en-US"),
    ];
    const specs: VoiceSpec[] = [
      { id: "anna", name: "Anna", prefer: "female", lang: "en-GB" },
      { id: "tom", name: "Tom", prefer: "male", lang: "en-GB" },
      { id: "sam", name: "Sam", prefer: "male", lang: "en-GB" },
      { id: "nonna", name: "Nonna", prefer: "female" },
    ];
    const cast = assignVoices(voices, specs, NARRATOR);
    expect(cast.get("anna")).toMatchObject({ lang: "en-GB" });
    expect(cast.get("anna")!.voice!.name).toMatch(/Hazel/);
    expect(cast.get("tom")!.voice!.name).toMatch(/Ryan/); // natural first
    expect(cast.get("sam")!.voice!.name).toMatch(/George/);
    expect(cast.get("nonna")!.voice!.lang).toBe("it-IT");
    expect(cast.get("nonna")!.lang).toBe("it-IT");
    // en-AU not installed: any English voice; a language with no voice at all: default voice, lang set.
    const au = chooseVoice(voices, { prefer: "male" }, "en-AU", new Set(), 0, NARRATOR);
    expect(au.voice!.lang.startsWith("en")).toBe(true);
    expect(au.lang).toBe("en-AU");
    const fr = chooseVoice(voices, {}, "fr-FR", new Set(), 0, NARRATOR);
    expect(fr.voice).toBeNull();
    expect(fr.lang).toBe("fr-FR");
    expect(isForeign("en-GB")).toBe(true);
    expect(isForeign("it-IT")).toBe(false);
    expect(isForeign(undefined)).toBe(false);
    expect(langTag("en-GB")).toBe("EN");
  });

  it("the dialogue scene's English voices validate", () => {
    const spec = SceneSpec.parse(
      JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/public/scenes/palcoscenico-dialogo.scene.json"), "utf8")),
    );
    expect(spec.voices?.every((x) => x.lang === "en-GB")).toBe(true);
    expect(checkScene(spec)).toEqual([]);
  });

  it("playback passes each sentence's speaker to the voice", () => {
    const tts = new FakeTts();
    const pb = new Playback(tts);
    pb.load({
      duration: 3,
      narration: [
        { at: 0, text: "C'era una volta.", highlight: [], sourceIds: [] },
        { at: 1, text: "Ciao!", highlight: [], sourceIds: [], speaker: "maria" },
      ],
    });
    pb.play();
    for (let k = 0; k < 40; k++) {
      pb.tick(0.1);
      tts.tick(0.1);
    }
    expect(tts.spoken).toEqual(["C'era una volta.", "Ciao!"]);
    expect(tts.speakers).toEqual([undefined, "maria"]);
  });
});

describe("themes", () => {
  it("has five themes with a CSS rule each (Pergamena keeps the stylesheet's own colours)", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["quaderno", "notte", "laboratorio", "lavagna", "pergamena"]);
    const css = themeCss();
    for (const t of THEMES.filter((x) => x.id !== "pergamena")) {
      expect(css).toContain(`[data-pv-theme="${t.id}"]`);
      expect(t.vars["--pv-bg"]).toBe(t.vars["--bg"]);
      expect(t.book).not.toBeNull();
    }
    expect(css).not.toContain("pergamena");
  });

  it("persists the choice and falls back to the default", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, val: string) => void m.set(k, val) };
    expect(readTheme(store).id).toBe(DEFAULT_THEME);
    writeTheme("lavagna", store);
    expect(readTheme(store).id).toBe("lavagna");
    expect(themeById("boh").id).toBe(DEFAULT_THEME);
  });
});

describe("entry pop-up", () => {
  it("stands at rest on chapter entry even while paused at t = 0", () => {
    expect(entryPopAt(0, 0, true).p).toBe(0);
    expect(entryPopAt(0, ENTRY_POP_DELAY + POP_WINDOW[1] + 0.1, true)).toEqual(popAt(99, true));
    // Scrubbing back to 0 after the entry does not fold it again; chapter time can only keep it up.
    expect(entryPopAt(0, 10, false).p).toBe(1);
    expect(entryPopAt(1.0, 0, false)).toEqual(popAt(1.0, false));
  });
});
