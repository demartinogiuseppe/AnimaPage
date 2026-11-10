// Decision D21: voice by lesson language (and never a voice of another language), engine number
// formats and labels in the lesson's locale, Italian unchanged.
import { setDisplayLocale } from "@pv/scene-spec/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatIt } from "../src/engines/chart/format.ts";
import { fmt } from "../src/engines/earth/util.ts";
import { num } from "../src/engines/lab/physics.ts";
import { italianDate } from "../src/engines/sky/astro.ts";
import { num as solidNum } from "../src/engines/solid/text.ts";
import { feedbackSpeech } from "../src/player/quiz.ts";
import { statusAt } from "../src/player/timing.ts";
import { assignVoices, isForeign, lacksVoice, pickVoice, timedDurationMs, TimerTts, WebSpeechTts } from "../src/player/tts.ts";

const v = (name: string, lang: string) => ({ name, lang });
const VOICES = [v("Elsa", "it-IT"), v("Google italiano", "it-IT"), v("Microsoft Hazel", "en-GB"), v("Google US English", "en-US"), v("Haruka", "ja-JP"), v("Kyoko Enhanced", "ja-JP")];

afterEach(() => {
  setDisplayLocale(null);
  vi.unstubAllGlobals();
});

describe("voice by language", () => {
  it("picks the best voice of the lesson's language", () => {
    expect(pickVoice(VOICES, "it-IT")?.name).toBe("Google italiano");
    expect(pickVoice(VOICES, "ja")?.name).toBe("Kyoko Enhanced");
    expect(pickVoice(VOICES, "en-GB")?.name).toBe("Microsoft Hazel");
    expect(pickVoice(VOICES, "en-AU")?.name).toBe("Google US English");
    expect(pickVoice(VOICES, "ar")).toBeNull();
  });

  it("no voice of the language means no voice at all (unless the list is not loaded yet)", () => {
    expect(lacksVoice(VOICES, pickVoice(VOICES, "ar"))).toBe(true);
    expect(lacksVoice([], null)).toBe(false);
    expect(lacksVoice(VOICES, pickVoice(VOICES, "ja"))).toBe(false);
  });

  it("characters default to the narrator's language; foreign tags are relative to it", () => {
    const cast = assignVoices(VOICES, [{ id: "a", name: "A" }], pickVoice(VOICES, "ja"), "ja-JP");
    expect(cast.get("a")!.lang).toBe("ja-JP");
    expect(cast.get("a")!.voice?.lang).toBe("ja-JP");
    expect(isForeign("en-GB")).toBe(true);
    expect(isForeign("en-GB", "en-US")).toBe(false);
    expect(isForeign("it-IT", "en-US")).toBe(true);
  });

  it("times CJK text by characters when there is no voice", () => {
    expect(timedDurationMs("uno due tre quattro cinque sei")).toBe(2040);
    const ja = "富士山は日本で一番高い山で、三七七六メートルあります。";
    expect(timedDurationMs(ja)).toBe(1500);
    expect(timedDurationMs(ja, "ja")).toBeGreaterThan(2500);
  });

  it("WebSpeechTts shows the text without a voice when the device lacks the language", () => {
    vi.useFakeTimers();
    const spoken: { text: string; lang: string; voice: unknown }[] = [];
    class Utterance {
      lang = "";
      voice: unknown = null;
      rate = 1;
      pitch = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const synth = {
      getVoices: () => VOICES,
      addEventListener: () => {},
      speak: (u: Utterance) => spoken.push({ text: u.text, lang: u.lang, voice: u.voice }),
      cancel: () => {},
    };
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    vi.stubGlobal("document", { addEventListener: () => {} });
    const tts = new WebSpeechTts(new TimerTts());
    const missing: string[] = [];
    tts.onNoVoice = (lang) => missing.push(lang);
    tts.setLanguage("ar-EG");
    let ended = false;
    tts.speak("مرحبا بكم في الدرس", () => (ended = true));
    expect(spoken).toEqual([]); // never read by an Italian or English voice
    expect(missing).toEqual(["ar-EG"]);
    vi.advanceTimersByTime(timedDurationMs("مرحبا بكم في الدرس", "ar-EG") + 10);
    expect(ended).toBe(true);
    // The English analysis summary of an Italian lesson is read by an English voice.
    tts.setLanguage("it-IT");
    tts.speak("The page is about volcanoes.", () => {}, undefined, "en");
    expect(spoken.at(-1)).toMatchObject({ lang: "en", voice: VOICES[3] });
    tts.speak("La pagina parla di vulcani.", () => {});
    expect(spoken.at(-1)).toMatchObject({ lang: "it-IT", voice: VOICES[1] });
    tts.stop();
    vi.useRealTimers();
  });
});

describe("engine formats follow the lesson locale", () => {
  it("Italian output is unchanged", () => {
    expect(formatIt(5590076)).toBe("5.590.076");
    expect(formatIt(13.5, 1)).toBe("13,5");
    expect(fmt(12345.6, 1)).toBe("12.345,6");
    expect(num(9.81)).toBe("9,81");
    expect(solidNum(62.832)).toBe("62,83");
    expect(italianDate(Date.UTC(2026, 5, 21, 14, 30), true)).toBe("21 giugno 2026 · ore 14:30 UTC");
    expect(statusAt([{ from: 0, to: 10, text: "{n} abitanti", counter: { from: 0, to: 5590076 } }], 10)).toBe("5.590.076 abitanti");
    expect(feedbackSpeech({ ok: true, text: "Bravo." })).toBe("Giusto! Bravo.");
  });

  it("English, German, Japanese", () => {
    setDisplayLocale("en-GB");
    expect(formatIt(5590076)).toBe("5,590,076");
    expect(formatIt(13.5, 1)).toBe("13.5");
    expect(num(9.81)).toBe("9.81");
    expect(italianDate(Date.UTC(2026, 5, 21, 14, 30), true)).toBe("21 June 2026 · 14:30 UTC");
    expect(feedbackSpeech({ ok: true, text: "Well done." })).toBe("Right! Well done.");
    setDisplayLocale("de-DE");
    expect(fmt(12345.6, 1)).toBe("12.345,6");
    setDisplayLocale("ja");
    expect(italianDate(Date.UTC(2026, 5, 21))).toBe("2026年6月21日");
    expect(statusAt([{ from: 0, to: 10, text: "{n}人", counter: { from: 0, to: 5590076 } }], 10)).toBe("5,590,076人");
  });
});
