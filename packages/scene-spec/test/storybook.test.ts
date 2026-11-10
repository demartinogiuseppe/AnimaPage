import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScene, dioramaModel, SceneSpec, STORY_CHARACTERS, STORY_SOUND_GROUPS, storyGroup, wordMatchesGroup } from "../src/index.ts";

const dev = (): any => JSON.parse(readFileSync(new URL("../../../fixtures/public/scenes/_dev-storie.scene.json", import.meta.url), "utf8"));
const issuesOf = (raw: any) => checkScene(SceneSpec.parse(raw)).map((i) => `${i.path}: ${i.message}`);

describe("storybook", () => {
  it("the dev scene parses and checks clean", () => {
    expect(issuesOf(dev())).toEqual([]);
  });

  it("word cues must match their group", () => {
    const ok = dev();
    ok.engineData.chapters[0].acts = [{ do: "sound", group: "train-whistle", sentence: 0, word: 0 }];
    ok.chapters[0].narration[0].text = "Il fischio forte";
    ok.engineData.chapters[0].acts[0].word = 1;
    expect(issuesOf(ok)).toEqual([]);
    ok.chapters[0].narration[0].text = "Una macchina forte";
    ok.engineData.chapters[0].acts[0].word = 1;
    expect(issuesOf(ok).join("\n")).toMatch(/macchina.*train-whistle/);
  });

  it("wordMatchesGroup handles forms and accents", () => {
    const train = storyGroup("train-whistle")!;
    expect(wordMatchesGroup("trenino", train, "it")).toBe(true);
    expect(wordMatchesGroup("Treno,", train, "it")).toBe(true);
    expect(wordMatchesGroup("macchina", train, "it")).toBe(false);
    expect(wordMatchesGroup("città", { ...train, words: { it: ["citta"], en: [] } }, "it")).toBe(true);
    expect(wordMatchesGroup("uccellini", storyGroup("birds")!, "it")).toBe(true);
    expect(wordMatchesGroup("train", train, "en")).toBe(true);
  });

  it("the catalogues are consistent", () => {
    for (const g of STORY_SOUND_GROUPS) expect(g.words.it.length).toBeGreaterThan(0);
    for (const c of STORY_CHARACTERS) {
      if (c.sound) expect(storyGroup(c.sound), c.id).toBeDefined();
      if ("model" in c.source) {
        expect(dioramaModel(c.source.model), c.id).toBeDefined();
        expect(c.parts).toBeUndefined();
      }
    }
  });

  it("letter targets must start with the letter", () => {
    const raw = dev();
    raw.engineData.characters.push({ id: "gatto", model: "cat", at: [1, 1] });
    raw.engineData.chapters[0].play.targets.push("gatto");
    const out = issuesOf(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/gatto.*B/);
  });

  it("order must go from biggest to smallest", () => {
    const raw = dev();
    raw.engineData.chapters[1].play.order = ["barca", "balena", "bruco"];
    expect(issuesOf(raw).join("\n")).toMatch(/biggest/);
  });

  it("color needs a character with parts", () => {
    const raw = dev();
    raw.engineData.characters.push({ id: "micio", model: "cat", at: [1, 1] });
    raw.engineData.chapters[3].play.who = "micio";
    expect(issuesOf(raw).join("\n")).toMatch(/colourable parts/);
  });

  it("word index out of range is reported", () => {
    const raw = dev();
    raw.engineData.chapters[0].acts.push({ do: "sound", group: "whale-spout", sentence: 0, word: 40 }, { do: "sound", group: "whale-spout", sentence: 9, word: 0 });
    const out = issuesOf(raw).join("\n");
    expect(out).toMatch(/word 40 is out of range/);
    expect(out).toMatch(/sentence 9 does not exist/);
  });

  it("unknown group and model ids are reported", () => {
    const raw = dev();
    raw.engineData.characters.push({ id: "x", model: "dragon", at: [0, 0] });
    raw.engineData.chapters[0].ambience = ["nope"];
    raw.engineData.chapters[0].acts.push({ do: "appear", who: "ghost", at: 2 });
    const out = issuesOf(raw).join("\n");
    expect(out).toMatch(/unknown character model "dragon"/);
    expect(out).toMatch(/unknown sound group "nope"/);
    expect(out).toMatch(/unknown character "ghost"/);
  });

  it("reports duplicate ids, voice-less speakers and late acts", () => {
    const raw = dev();
    raw.engineData.characters.push({ id: "balena", model: "whale", at: [0, 0] });
    raw.chapters[0].narration[0].speaker = "nessuno";
    raw.engineData.chapters[0].acts.push({ do: "appear", who: "balena", at: 99 });
    const out = issuesOf(raw).join("\n");
    expect(out).toMatch(/duplicate character id "balena"/);
    expect(out).toMatch(/unknown speaker "nessuno"/);
    expect(out).toMatch(/starts after the chapter ends/);
  });

  it("uses the speaker's voice language when the sentence has no lang", () => {
    const raw = dev();
    raw.voices = [{ id: "balena", name: "Balena", lang: "en-GB" }];
    raw.chapters[0].narration[0] = { ...raw.chapters[0].narration[0], text: "Look at the whale", speaker: "balena" };
    raw.engineData.chapters[0].acts = [{ do: "sound", group: "whale-spout", sentence: 0, word: 3 }];
    expect(issuesOf(raw)).toEqual([]);
    raw.engineData.chapters[0].acts[0].word = 0;
    expect(issuesOf(raw).join(" | ")).toMatch(/"Look" does not match/);
  });

  it("uses English when the sentence says so", () => {
    const raw = dev();
    raw.chapters[0].narration[0] = { ...raw.chapters[0].narration[0], text: "The whale", lang: "en-GB" };
    raw.engineData.chapters[0].acts = [{ do: "sound", group: "whale-spout", sentence: 0, word: 1 }];
    expect(issuesOf(raw)).toEqual([]);
  });

  it("matches elided Italian words", () => {
    expect(wordMatchesGroup("l'onda", storyGroup("waves")!, "it")).toBe(true);
    expect(wordMatchesGroup("dell’acqua", storyGroup("splash")!, "it")).toBe(true);
    expect(wordMatchesGroup("l'albero", storyGroup("waves")!, "it")).toBe(false);
  });

  it("reports a voice-less speaker exactly once", () => {
    const raw = dev();
    raw.chapters[0].narration[0].speaker = "nessuno";
    expect(issuesOf(raw).filter((m) => m.includes("nessuno"))).toHaveLength(1);
  });

  it("reports duplicate and unknown chapter entries", () => {
    const raw = dev();
    raw.engineData.chapters.push({ ...raw.engineData.chapters[2] }, { chapter: "fantasma", place: "sea" });
    const out = issuesOf(raw).join(" | ");
    expect(out).toMatch(/duplicate storybook entry for chapter "prato"/);
    expect(out).toMatch(/unknown chapter "fantasma"/);
  });

  it("a letter play needs engineData.letter", () => {
    const raw = dev();
    delete raw.engineData.letter;
    expect(issuesOf(raw).join(" | ")).toMatch(/needs engineData.letter/);
  });
});

describe("storybook sound kinds", () => {
  it("no character's own sound is an ambience loop", () => {
    for (const c of STORY_CHARACTERS) if (c.sound) expect(storyGroup(c.sound)?.kind, c.id).toBe("sfx");
  });

  it("act and ambience groups must have the right kind", () => {
    const j = dev();
    j.engineData.chapters[0].ambience = ["boing"]; // sfx in an ambience list
    j.engineData.chapters[0].acts = [
      { do: "ambience", group: "pop", at: 1 },
      { do: "appear", who: "balena", at: 1, sound: "waves" },
      { do: "react", who: "balena", at: 2, how: "jump", sound: "birds" },
      { do: "sound", group: "wind-soft", sentence: 0, word: 0 },
    ];
    const out = issuesOf(j).join("\n");
    expect(out).toMatch(/engineData\.chapters\[0\]\.ambience\[0\].*"boing".*ambience/);
    expect(out).toMatch(/acts\[0\].*"pop".*ambience/);
    expect(out).toMatch(/acts\[1\].*"waves".*one-shot/);
    expect(out).toMatch(/acts\[2\].*"birds".*one-shot/);
    expect(out).toMatch(/acts\[3\].*"wind-soft".*one-shot/);
  });
});

describe("storybook word indices", () => {
  const withText = (text: string, word: number, group = "train-whistle") => {
    const j = dev();
    j.chapters[0].narration[0].text = text;
    j.engineData.chapters[0].acts = [{ do: "sound", group, sentence: 0, word }];
    return issuesOf(j);
  };

  it("dashes, ellipses and hyphens never shift the index (the voice timeline counts letter runs)", () => {
    expect(withText("Ecco — il treno", 2)).toEqual([]);
    expect(withText("Ecco... il treno", 2)).toEqual([]);
    expect(withText("Ecco – il treno", 2)).toEqual([]);
    expect(withText("Ecco il Ta-da treno", 4)).toEqual([]);
    expect(withText("Ecco il Ta-da treno", 3).join("\n")).toMatch(/da.*train-whistle/);
  });

  it("words match in the scene's language", () => {
    const j = dev();
    j.lang = "en";
    j.engineData.chapters.forEach((c: any) => (c.acts = []));
    j.chapters[0].narration[0].text = "Here comes the train";
    j.engineData.chapters[0].acts = [{ do: "sound", group: "train-whistle", sentence: 0, word: 3 }];
    expect(issuesOf(j)).toEqual([]);
  });
});
