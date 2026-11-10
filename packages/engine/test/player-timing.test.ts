import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTime, isTextPin, ndcVisible, pinVisibleAt, statusAt } from "../src/player/timing.ts";
import { FakeTts, pickItalianVoice, speakList, timedDurationMs, TimerTts } from "../src/player/tts.ts";
import { videoEmbedUrl } from "../src/player/player.ts";

describe("pin visibility windows", () => {
  const pin = { visible: [[2, 4], [8, 9]] as [number, number][] };
  it("is visible only inside its windows (inclusive)", () => {
    expect([0, 2, 3, 4, 5, 8, 9, 9.5].map((t) => pinVisibleAt(pin, t, false))).toEqual([
      false, true, true, true, false, true, true, false,
    ]);
  });
  it("without windows is visible for the whole chapter", () => {
    expect(pinVisibleAt({}, 123, false)).toBe(true);
  });
  it("during a pick question every pin is visible", () => {
    expect(pinVisibleAt(pin, 0, true)).toBe(true);
  });
  it("draws map kinds as atlas text", () => {
    expect(["sea", "region", "river", "island"].every((k) => isTextPin(k as never))).toBe(true);
    expect(isTextPin("city")).toBe(false);
    expect(isTextPin("person")).toBe(false);
  });
  it("culls labels behind the camera or far outside the frame", () => {
    expect(ndcVisible(0, 0, 0.5)).toBe(true);
    expect(ndcVisible(1.1, -1.1, 0.5)).toBe(true);
    expect(ndcVisible(1.2, 0, 0.5)).toBe(false);
    expect(ndcVisible(0, 0, 1.01)).toBe(false);
  });
});

describe("status pill", () => {
  const st = [
    { from: 0, to: 4, text: "Anno {n} dell'assedio", counter: { from: 1, to: 10 } },
    { from: 5, to: 6, text: "Notte" },
  ];
  it("counts {n} over the window and formats Italian numbers", () => {
    expect(statusAt(st, 0)).toBe("Anno 1 dell'assedio");
    expect(statusAt(st, 4)).toBe("Anno 10 dell'assedio");
    expect(statusAt(st, 4.5)).toBeNull();
    expect(statusAt(st, 5.5)).toBe("Notte");
    expect(statusAt([{ from: 0, to: 1, text: "{n} abitanti", counter: { from: 0, to: 12000 } }], 1)).toBe("12.000 abitanti");
    expect(statusAt(undefined, 1)).toBeNull();
  });
});

describe("misc", () => {
  it("formats m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65.9)).toBe("1:05");
  });
  it("builds privacy-friendly embed URLs", () => {
    expect(videoEmbedUrl({ provider: "youtube", ref: "dQw4w9WgXcQ" })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
    expect(videoEmbedUrl({ provider: "commons", ref: "File:Vesuvio eruzione.webm" })).toBe(
      "https://commons.wikimedia.org/wiki/File:Vesuvio_eruzione.webm?embedplayer=yes",
    );
  });
});

describe("tts", () => {
  afterEach(() => vi.useRealTimers());

  it("timed fallback lasts max(1500 ms, 340 ms per word)", () => {
    expect(timedDurationMs("ciao")).toBe(1500);
    expect(timedDurationMs("uno due tre quattro cinque sei")).toBe(2040);
  });

  it("prefers natural/neural/premium/enhanced/google Italian voices", () => {
    const v = (name: string, lang: string) => ({ name, lang });
    expect(pickItalianVoice([v("Alice", "it-IT"), v("Google italiano", "it-IT"), v("Natural", "en-US")])?.name).toBe("Google italiano");
    expect(pickItalianVoice([v("Daniel", "en-GB"), v("Alice", "it_IT")])?.name).toBe("Alice");
    expect(pickItalianVoice([v("Daniel", "en-GB"), v("Itzel", "iu")])).toBeNull();
  });

  it("TimerTts ends after the reading time and is cancellable", () => {
    vi.useFakeTimers();
    const tts = new TimerTts();
    let ended = 0;
    tts.speak("ciao", () => ended++);
    vi.advanceTimersByTime(1499);
    expect(ended).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ended).toBe(1);
    tts.speak("ciao", () => ended++);
    tts.stop();
    vi.advanceTimersByTime(5000);
    expect(ended).toBe(1);
  });

  it("speakList reads items one after another", () => {
    const tts = new FakeTts(() => 1);
    let done = false;
    speakList(tts, ["a", "b"], () => (done = true));
    expect(tts.spoken).toEqual(["a"]);
    tts.tick(1);
    expect(tts.spoken).toEqual(["a", "b"]);
    tts.tick(1);
    expect(done).toBe(true);
  });
});
