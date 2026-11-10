// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { SceneSpec, storyCharacter } from "@pv/scene-spec";
import { disposeTree } from "../src/engines/storybook/index.ts";
import { sentenceWordTimes, tapGroupOf } from "../src/engines/storybook/sounds.ts";
import { WebAudioOut } from "../src/player/audio/webaudio.ts";
import { wordTimes } from "../src/util/words.ts";
import { NARRATOR_RATE } from "../src/player/tts.ts";

const trenino = () => SceneSpec.parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/public/scenes/storie-trenino.scene.json"), "utf8")));

describe("tap sound group", () => {
  it("falls back to boing without a group or with an ambience loop", () => {
    expect(tapGroupOf(storyCharacter("cow"))).toBe("cow-moo");
    expect(tapGroupOf(storyCharacter("cloud"))).toBe("boing");
    expect(tapGroupOf(storyCharacter("parrot"))).toBe("boing");
    expect(tapGroupOf(undefined)).toBe("boing");
    expect(tapGroupOf({ ...storyCharacter("cow")!, sound: "wind-soft" })).toBe("boing");
  });
});

describe("word timeline of a speaker line", () => {
  it("uses the speaker voice's rate, not the narrator's", () => {
    const s = trenino();
    const ch = s.chapters[0]!;
    const idx = ch.narration.findIndex((n) => n.speaker === "mucca");
    const slow = sentenceWordTimes(s, ch, idx);
    const narrator = wordTimes(ch.narration[idx]!.text, s.lang, NARRATOR_RATE);
    expect(slow.at(-1)!).toBeGreaterThan(narrator.at(-1)!);
  });
});

describe("disposeTree", () => {
  it("frees the textures of a material too", () => {
    const tex = new THREE.Texture();
    const spy = vi.spyOn(tex, "dispose");
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: tex })));
    disposeTree(g);
    expect(spy).toHaveBeenCalled();
  });
});

describe("WebAudioOut one-shots", () => {
  it("stopNotes also cuts one-shot effects still sounding", async () => {
    const stops: number[] = [];
    let started = 0;
    class Ctx {
      state = "running";
      currentTime = 1;
      destination = {};
      createGain() {
        return { gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start: () => void started++, stop: (t: number) => void stops.push(t), onended: null as null | (() => void) };
      }
      close() {
        return Promise.resolve();
      }
      resume() {
        return Promise.resolve();
      }
      decodeAudioData() {
        return Promise.resolve({ duration: 1 } as unknown as AudioBuffer);
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = Ctx;
    const out = new WebAudioOut("http://x/", () => Promise.resolve(new ArrayBuffer(0)));
    out.unlock();
    out.preload(["sb:boing-1"]);
    await vi.waitFor(() => {
      out.play("sb:boing-1", 0.4);
      expect(started).toBeGreaterThan(0);
    });
    out.stopNotes();
    expect(stops.length).toBeGreaterThan(0);
    out.dispose();
  });
});
