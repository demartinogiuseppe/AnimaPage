// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebAudioOut } from "../src/player/audio/webaudio.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

class FakeCtx {
  state = "running";
  currentTime = 0;
  destination = {};
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  close() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  decodeAudioData(b: ArrayBuffer) {
    return Promise.resolve({ duration: 1, length: b.byteLength } as unknown as AudioBuffer);
  }
}

describe("WebAudioOut", () => {
  it("uses the loader instead of fetch", async () => {
    vi.stubGlobal("AudioContext", FakeCtx);
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const loader = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    const out = new WebAudioOut("http://x/", loader);
    out.unlock();
    out.preload(["whoosh-soft"]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledWith("audio/whoosh-soft.ogg"));
    expect(fetchSpy).not.toHaveBeenCalled();
    out.dispose();
  });
});
