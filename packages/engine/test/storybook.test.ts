import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, checkStorybookData, SceneSpec, storyGroup, wordMatchesGroup } from "@pv/scene-spec";
import type { EngineContext } from "../src/index.ts";
import { createStorybookEngine } from "../src/engines/storybook/index.ts";
import { storySoundsOf } from "../src/engines/storybook/sounds.ts";
import { splitWords } from "../src/util/words.ts";

const raw = (): any => JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/storie-trenino.scene.json", import.meta.url), "utf8"));
const spec = (): SceneSpec => SceneSpec.parse(raw());

async function built() {
  const s = spec();
  const engine = createStorybookEngine();
  const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0) };
  await engine.build(ctx, s);
  return { s, engine };
}

describe("storie-trenino scene fixture", () => {
  it("passes SceneSpec, checkScene and the storybook cross-checks with zero issues", () => {
    const s = spec();
    expect(s.engine).toBe("storybook");
    expect(checkScene(s)).toEqual([]);
    if (s.engine !== "storybook") throw new Error("unreachable");
    expect(checkStorybookData(s.engineData, s)).toEqual([]);
    expect(s.chapters.map((c) => c.id)).toEqual(["parte", "cielo", "grande", "caccia-t", "colora"]);
    expect(s.engineData.letter).toBe("T");
    expect(s.sources.map((x) => x.id)).toEqual(["page"]);
  });

  it("gives the train and the cow their own voices", () => {
    const s = spec();
    const voices = new Map((s.voices ?? []).map((v) => [v.id, v]));
    const train = voices.get("treno");
    const cow = voices.get("mucca");
    expect(train?.pitch).toBeGreaterThan(1);
    expect(cow?.pitch).toBeLessThan(1);
    expect(cow?.rate).toBeLessThan(train?.rate ?? 0);
    const speakers = new Set(s.chapters.flatMap((c) => c.narration.map((n) => n.speaker)));
    expect(speakers.has("treno")).toBe(true);
    expect(speakers.has("mucca")).toBe(true);
  });

  it("covers the four activities, the whistle on 'trenino' and birds in the sky", () => {
    const s = spec();
    if (s.engine !== "storybook") throw new Error("unreachable");
    expect(s.engineData.chapters.map((c) => c.play?.kind)).toEqual(["touch", undefined, "order", "letter", "color"]);
    const first = s.engineData.chapters[0]!;
    const whistle = first.acts?.find((a) => a.do === "sound" && a.group === "train-whistle");
    expect(whistle).toMatchObject({ sentence: 0, word: 1 });
    expect(s.chapters[0]!.narration[0]!.text.split(" ")[1]).toBe("trenino");
    expect(s.engineData.chapters[1]!.ambience).toContain("birds");
  });

  it("every word cue lands on a word of its group", () => {
    const s = spec();
    if (s.engine !== "storybook") throw new Error("unreachable");
    let cues = 0;
    for (const c of s.engineData.chapters) {
      const ch = s.chapters.find((x) => x.id === c.chapter)!;
      for (const a of c.acts ?? []) {
        if (a.do !== "sound") continue;
        cues++;
        const word = ch.narration[a.sentence]!.text.split(/\s+/)[a.word]!;
        expect(wordMatchesGroup(word, storyGroup(a.group)!, "it"), `${c.chapter}: ${a.group} on "${word}"`).toBe(true);
      }
    }
    expect(cues).toBeGreaterThanOrEqual(10);
    const sounds = storySoundsOf(s);
    for (const c of s.engineData.chapters) expect(sounds.get(c.chapter)!.words.length).toBeGreaterThan(0);
  });

  it("counts words the same for the checker (spaces) and the voice timeline (letters)", () => {
    for (const c of spec().chapters) for (const n of c.narration) expect(splitWords(n.text).length, n.text).toBe(n.text.split(/\s+/).length);
  });

  it("builds, and every chapter updates from 0 to its duration in 0.5 s steps", async () => {
    const { s, engine } = await built();
    for (const ch of s.chapters) {
      for (let t = 0; t <= ch.duration; t += 0.5) engine.update(ch.id, t);
    }
    engine.dispose();
  });

  it("every pin anchor resolves at mid-chapter", async () => {
    const { s, engine } = await built();
    const out = new THREE.Vector3();
    for (const ch of s.chapters) {
      expect(ch.pins.length, ch.id).toBeGreaterThan(0);
      const mid = ch.duration / 2;
      engine.update(ch.id, mid);
      for (const p of ch.pins) expect(engine.resolveAnchor(p.anchor, ch.id, mid, out), `${ch.id}/${p.id}`).toBe(true);
    }
    engine.dispose();
  });

  it("the activity is live at the chapter end: the last sentence invites the touch, close to the end", () => {
    const s = spec();
    if (s.engine !== "storybook") throw new Error("unreachable");
    for (const c of s.engineData.chapters) {
      if (!c.play) continue;
      const ch = s.chapters.find((x) => x.id === c.chapter)!;
      const last = ch.narration.at(-1)!;
      expect(last.text, c.chapter).toMatch(/Tocca|Metti|Scegli/);
      expect(last.speaker, c.chapter).toBeUndefined();
      expect(ch.duration - last.at, c.chapter).toBeLessThanOrEqual(6);
      // No praise or thanks in the narration: the panel says "Bravo!" when the activity is done.
      expect(ch.narration.map((n) => n.text).join(" "), c.chapter).not.toMatch(/Bravi|Evviva|Grazie|Bravo/);
    }
    expect(s.engineData.chapters[0]!.play).toMatchObject({ prompt: "Tocca il trenino e la mucca!" });
  });
});
