// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneSpec, STORY_SOUND_GROUPS, storyCharacter, dioramaModel } from "@pv/scene-spec";
import { assetsOf } from "../src/export/assets.ts";
import { STORY_LIBRARY } from "../src/engines/storybook/library.ts";
import { createStorybookEngine } from "../src/engines/storybook/index.ts";
import { lessonSeed, OPEN_AMBIENCE_END, STORY_AMBIENCE_VOLUME, STORY_CUE_VOLUME, pickVariant, storySoundsOf, tapSoundsOf } from "../src/engines/storybook/sounds.ts";
import { soundFile, soundSource, SOUND_LIBRARY } from "../src/player/audio/library.ts";
import { synthesize } from "../src/player/audio/synth.ts";
import { WebAudioOut } from "../src/player/audio/webaudio.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dev = (): any => JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/public/scenes/_dev-storie.scene.json"), "utf8"));
const variantsOf = (group: string) => Object.keys(STORY_LIBRARY).filter((v) => STORY_LIBRARY[v]!.group === group);

describe("storybook sound library", () => {
  it("every group has a variant and every variant a synth fallback", () => {
    for (const g of STORY_SOUND_GROUPS) expect(variantsOf(g.id).length, g.id).toBeGreaterThanOrEqual(1);
    for (const [id, v] of Object.entries(STORY_LIBRARY)) {
      expect(STORY_SOUND_GROUPS.some((g) => g.id === v.group), id).toBe(true);
      const data = synthesize(v.synth, 8000, 3);
      expect(data.length, id).toBeGreaterThan(100);
      expect(data.every(Number.isFinite), id).toBe(true);
      expect(data.reduce((m, x) => Math.max(m, Math.abs(x)), 0), id).toBeGreaterThan(0.05);
      expect(Math.abs(data.length / 8000 - v.dur), `${id} dur`).toBeLessThan(0.01);
    }
  });

  it("sb: ids resolve to audio/storybook/<variant>.ogg; other ids unchanged", () => {
    expect(soundFile("sb:pop-1")).toBe("audio/storybook/pop-1.ogg");
    expect(soundFile("whoosh")).toBe("audio/whoosh.ogg");
    expect(soundSource("sb:pop-1")).toEqual({ file: STORY_LIBRARY["pop-1"]!.file, synth: STORY_LIBRARY["pop-1"]!.synth });
    expect(soundSource("whoosh")).toBe(SOUND_LIBRARY["whoosh"]);
    expect(soundSource("sb:nope")).toBeUndefined();
  });
});

describe("deterministic choice", () => {
  it("same lesson, same variants; different lessons, different variants", () => {
    const a = dev();
    expect(lessonSeed(a)).toBe(lessonSeed(dev()));
    const three = STORY_SOUND_GROUPS.map((g) => g.id).filter((g) => variantsOf(g).length === 3);
    expect(three.length).toBeGreaterThan(0);
    // Not luck: across 20 differently titled lessons the seeds differ, and so do the variants somewhere.
    const others = Array.from({ length: 20 }, (_, i) => ({ ...dev(), title: `${a.title} (${i})` }));
    expect(new Set(others.map((o) => lessonSeed(o))).size).toBe(others.length);
    for (const g of three) expect(new Set(others.map((o) => pickVariant(g, lessonSeed(o), 0))).size, g).toBeGreaterThan(1);
    for (const g of three) expect(pickVariant(g, 7, 2)).toBe(pickVariant(g, 7, 2));
  });

  it("a group used twice in a row gets two different variants", () => {
    for (const g of STORY_SOUND_GROUPS) {
      const n = variantsOf(g.id).length;
      if (n < 2) continue;
      for (const seed of [0, 1, 12345]) {
        expect(pickVariant(g.id, seed, 0), g.id).not.toBe(pickVariant(g.id, seed, 1));
        expect(new Set(Array.from({ length: n }, (_, k) => pickVariant(g.id, seed, k))).size).toBe(n);
      }
    }
  });

  it("storySoundsOf lists the cues of every chapter with sb: ids", () => {
    const m = storySoundsOf(SceneSpec.parse(dev()));
    expect(m.size).toBeGreaterThan(0);
    const ids = [...m.values()].flatMap((c) => [...c.ambience.map((a) => a.sound), ...c.cues.map((q) => q.sound), ...c.words.map((w) => w.cue.sound)]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(STORY_LIBRARY[id.replace(/^sb:/, "")], id).toBeDefined();
    expect(storySoundsOf(SceneSpec.parse(dev()))).toEqual(m);
  });

  it("word cues get their time: inside the sentence, before the next one", () => {
    const spec = SceneSpec.parse(dev());
    const mare = storySoundsOf(spec).get("mare")!;
    const w = mare.words.find((x) => x.sentence === 0 && x.word === 2)!;
    expect(w.cue.at).toBeGreaterThan(0);
    expect(w.cue.at).toBeLessThanOrEqual(5 - 0.05);
    const late = mare.words.find((x) => x.sentence === 1 && x.word === 3)!;
    expect(late.cue.at).toBeGreaterThan(5);
    expect(late.cue.at).toBeLessThanOrEqual(10 - 0.05);
  });

  it("an overlong sentence: the highlight offsets are clamped like the cues, so both agree", async () => {
    const d = dev();
    const long = Array.from({ length: 30 }, (_, i) => `parola${i}`).join(" ") + ".";
    d.chapters[0].narration[0].text = long; // ~10 s of reading in a 5 s slot
    d.engineData.chapters[0].acts = [{ do: "sound", group: "whale-spout", sentence: 0, word: 25 }];
    const spec = SceneSpec.parse(d);
    const engine = createStorybookEngine();
    await engine.build({ root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("none")) }, spec);
    const offs = engine.words!("mare")![0]!;
    expect(offs).toHaveLength(30);
    expect(Math.max(...offs)).toBeLessThanOrEqual(5 - 0.05 + 1e-9);
    for (let i = 1; i < offs.length; i++) expect(offs[i]!).toBeGreaterThanOrEqual(offs[i - 1]!);
    const cue = storySoundsOf(spec).get("mare")!.words[0]!;
    expect(cue.cue.at).toBeCloseTo(offs[25]!, 9);
    // at the cue's time the lit word (last started) is the last word of the sentence: it does get lit
    expect(offs.filter((o) => o <= cue.cue.at).length - 1).toBe(29);
  });

  it("story ambience plays at the fixed low level", () => {
    expect(STORY_AMBIENCE_VOLUME).toBe(0.2);
    const m = storySoundsOf(SceneSpec.parse(dev()));
    const all = [...m.values()].flatMap((c) => c.ambience);
    expect(all.length).toBeGreaterThan(0);
    for (const a of all) expect(a.volume).toBe(STORY_AMBIENCE_VOLUME);
  });

  it("word and entrance sounds play under the voice, never at full level", () => {
    expect(STORY_CUE_VOLUME).toBe(0.4);
    const m = storySoundsOf(SceneSpec.parse(dev()));
    const cues = [...m.values()].flatMap((c) => [...c.cues, ...c.words.map((w) => w.cue)]);
    expect(cues.length).toBeGreaterThan(0);
    for (const q of cues) expect(q.volume).toBe(STORY_CUE_VOLUME);
  });

  it("an ambience act without `until` plays to the named open end", () => {
    const d = dev();
    d.engineData.chapters[0].acts = [{ do: "ambience", group: "waves", at: 2 }];
    d.engineData.chapters[0].ambience = [];
    const amb = storySoundsOf(SceneSpec.parse(d)).get("mare")!.ambience;
    expect(amb.map((a) => a.window)).toEqual([[2, OPEN_AMBIENCE_END]]);
  });

  it("variants rotate in play order, not in act-list order", () => {
    const d = dev();
    d.engineData.chapters[0].ambience = [];
    d.engineData.chapters[0].acts = [
      { do: "react", who: "balena", at: 9, how: "laugh", sound: "splash" },
      { do: "react", who: "balena", at: 3, how: "laugh", sound: "splash" },
    ];
    const spec = SceneSpec.parse(d);
    const seed = lessonSeed(spec);
    const cues = storySoundsOf(spec).get("mare")!.cues;
    expect(cues.find((c) => c.at === 3)!.sound).toBe(pickVariant("splash", seed, 0));
    expect(cues.find((c) => c.at === 9)!.sound).toBe(pickVariant("splash", seed, 1));
    expect(pickVariant("splash", seed, 0)).not.toBe(pickVariant("splash", seed, 1));
  });
});

describe("synth", () => {
  it("an explicit f of 660 is honoured, not read as 'use the kind's default'", () => {
    for (const kind of ["slide", "peep", "meow", "moo", "whistle-train"] as const) {
      const dflt = synthesize({ kind }, 8000, 3);
      const explicit = synthesize({ kind, f: 660 }, 8000, 3);
      expect(explicit, kind).not.toEqual(dflt);
    }
  });
});

describe("export", () => {
  it("assetsOf a storybook scene lists its models and exactly its file variants", () => {
    const spec = SceneSpec.parse(dev());
    if (spec.engine !== "storybook") throw new Error("dev scene is not a storybook");
    const models = spec.engineData.characters.flatMap((c) => {
      const s = storyCharacter(c.model)?.source;
      return s && "model" in s ? [dioramaModel(s.model)!.file] : [];
    });
    expect(models.length).toBeGreaterThan(0);
    const files = assetsOf(spec).files;
    for (const f of models) expect(files).toContain(f);
    const sounds = [...storySoundsOf(spec).values()].flatMap((c) => [...c.ambience.map((a) => a.sound), ...c.cues.map((q) => q.sound), ...c.words.map((w) => w.cue.sound)]).concat(tapSoundsOf(spec));
    expect(sounds.length).toBeGreaterThan(0);
    const played = new Set(sounds.map((s) => s.slice(3)));
    const lib = STORY_LIBRARY as Record<string, { file: boolean }>;
    // The seed library (Task 10): exactly the played variants that have a file are listed.
    const real = [...played].filter((v) => lib[v]?.file).sort().map((v) => `audio/storybook/${v}.ogg`);
    expect(real.length).toBeGreaterThan(0);
    expect(files.filter((f) => f.startsWith("audio/storybook/"))).toEqual(real);
    // With every variant backed by a file, every played variant is listed.
    const saved = new Map([...Object.keys(lib)].map((k) => [k, lib[k]!.file]));
    try {
      for (const k of Object.keys(lib)) lib[k] = { ...lib[k]!, file: true };
      const withFiles = assetsOf(spec).files.filter((f) => f.startsWith("audio/storybook/"));
      expect(withFiles).toEqual([...played].sort().map((v) => `audio/storybook/${v}.ogg`));
    } finally {
      for (const [k, f] of saved) lib[k] = { ...lib[k]!, file: f };
    }
  });
});

class FakeCtx {
  state = "running";
  currentTime = 0;
  destination = {};
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createBuffer(_c: number, len: number) {
    return { length: len, getChannelData: () => new Float32Array(len) };
  }
  close() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.reject(new Error("bad data"));
  }
}

describe("webaudio", () => {
  it("an undecodable sb: file falls back to its synth", async () => {
    vi.stubGlobal("AudioContext", FakeCtx);
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const lib = STORY_LIBRARY as Record<string, { group: string; file: boolean; synth: { kind: string }; dur: number }>;
    const saved = lib["pop-1"]!;
    try {
      lib["pop-1"] = { ...saved, file: true };
      const create = vi.spyOn(FakeCtx.prototype, "createBuffer");
      const loader = vi.fn(() => Promise.resolve(new ArrayBuffer(4)));
      const out = new WebAudioOut("http://x/", loader);
      out.unlock();
      out.preload(["sb:pop-1"]);
      await vi.waitFor(() => expect(create).toHaveBeenCalled());
      expect(loader).toHaveBeenCalledWith("audio/storybook/pop-1.ogg");
      out.dispose();
    } finally {
      lib["pop-1"] = saved;
    }
  });
});
