import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { checkScene, pitchToFrequency, pitchToMidi, SceneSpec } from "@pv/scene-spec";
import {
  applyMusicCues,
  checkMusicData,
  keyboardRange,
  MusicData,
  musicCues,
  musicScore,
  scoreEnd,
  type MusicChapter,
} from "../../scene-spec/src/engines/music.ts";
import { createMusicEngine } from "../src/engines/music/index.ts";
import { STAFF } from "../src/engines/music/notation.ts";

const scenePath = fileURLToPath(new URL("../../../fixtures/public/scenes/musica-pentagramma.scene.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(scenePath, "utf8"));

async function buildEngine(json = raw()) {
  const spec = SceneSpec.parse(json);
  const engine = createMusicEngine();
  const ctx = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: () => Promise.reject(new Error("no assets")) };
  await engine.build(ctx, spec);
  return { spec, engine, ctx };
}

function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const out: unknown[] = [];
  root.traverseVisible((o) => {
    const entry: unknown[] = [o.name, o.userData.key ?? false, ...o.matrixWorld.elements];
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) entry.push(o.material.color.getHex(), o.material.emissiveIntensity);
    if (o instanceof THREE.Line) entry.push(...(o.geometry.getAttribute("position").array as Float32Array));
    out.push(entry);
  });
  return out;
}

const entry = (over: Partial<MusicChapter> = {}): MusicChapter =>
  MusicData.parse({
    chapters: [{ chapter: "c", tempo: 60, notes: ["C4", "D4", "E4", "F4"].map((pitch) => ({ pitch, beats: 1 })), ...over }],
  }).chapters[0]!;

describe("musica-pentagramma scene fixture", () => {
  it("passes SceneSpec, checkScene and the music cross-checks with zero issues", () => {
    const spec = SceneSpec.parse(raw());
    expect(spec.engine).toBe("music");
    expect(checkScene(spec)).toEqual([]);
    if (spec.engine !== "music") throw new Error("unreachable");
    expect(checkMusicData(spec.engineData, spec)).toEqual([]);
    expect(spec.chapters.map((c) => c.id)).toEqual(["note", "ritmo", "timbro"]);
    for (const ch of spec.chapters) {
      expect(ch.book, ch.id).toBeDefined();
      expect(ch.activity?.test.params?.length, ch.id).toBeGreaterThan(0);
      expect(new Set(ch.quiz.map((q) => q.type)), ch.id).toEqual(new Set(["choice", "pick"]));
      expect(ch.sounds?.cues.some((c) => c.sound.startsWith("instr-") && c.pitch), ch.id).toBe(true);
    }
  });

  it("is a fixed point of applyMusicCues (cues are the ones of the score)", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "music") throw new Error("unreachable");
    expect(applyMusicCues(spec, spec.engineData)).toEqual(spec);
  });

  it("plays the C major scale, the rhythm and Fra Martino on the planned instruments", () => {
    const spec = SceneSpec.parse(raw());
    if (spec.engine !== "music") throw new Error("unreachable");
    const [scale, rhythm, fra] = spec.chapters.map((c) => c.sounds!.cues.filter((q) => q.pitch));
    expect(scale!.slice(0, 8).map((c) => c.pitch)).toEqual(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]);
    expect(scale!.slice(0, 8).map((c) => c.at)).toEqual([17, 18, 19, 20, 21, 22, 23, 24]); // 60 bpm: one beat per second
    expect(rhythm![0]).toMatchObject({ at: 13, pitch: "G4", duration: 3 }); // semibreve = 4 beats * 0.75 s at 80 bpm
    expect(new Set(fra!.map((c) => c.sound))).toEqual(new Set(["instr-piano", "instr-flute", "instr-violin", "instr-xylophone"]));
  });
});

describe("score -> cues", () => {
  it("times notes from tempo and start, one cue per note, durations = note lengths", () => {
    const cues = musicCues(entry({ start: 2, tempo: 120 }));
    expect(cues.map((c) => [c.at, c.pitch, c.duration, c.sound])).toEqual([
      [2, "C4", 0.5, "instr-piano"],
      [2.5, "D4", 0.5, "instr-piano"],
      [3, "E4", 0.5, "instr-piano"],
      [3.5, "F4", 0.5, "instr-piano"],
    ]);
  });

  it("repeats with gaps on the instruments in turn, skips rests, drops cues after the chapter", () => {
    const e = entry({ repeat: 3, gap: 2, instruments: ["flute", "violin"], notes: [{ pitch: "C4", beats: 2 }, { pitch: "rest", beats: 2 }] });
    const cues = musicCues(e);
    expect(cues.map((c) => [c.at, c.sound])).toEqual([[0, "instr-flute"], [6, "instr-violin"], [12, "instr-flute"]]);
    expect(scoreEnd(musicScore(e))).toBe(16);
    expect(musicCues(e, {}, 12)).toHaveLength(2);
  });

  it("metronome ticks every beat unit with the accent on the downbeat", () => {
    const e = entry({ time: [2, 4], metronome: {} });
    const ticks = musicCues(e).filter((c) => !c.pitch);
    expect(ticks.map((c) => [c.at, c.sound])).toEqual([[0, "instr-drum"], [1, "instr-hihat"], [2, "instr-drum"], [3, "instr-hihat"]]);
  });

  it("applies the sliders: tempo, transpose, instrument and note value", () => {
    const e = entry({ instruments: ["piano", "bell"] });
    expect(musicCues(e, { tempo: 30 }).map((c) => c.at)).toEqual([0, 2, 4, 6]);
    expect(musicCues(e, { transpose: 2 }).map((c) => c.pitch)).toEqual(["D4", "E4", "F#4", "G4"]);
    expect(new Set(musicCues(e, { instrument: 2 }).map((c) => c.sound))).toEqual(new Set(["instr-bell"]));
    // 4 beats of semibreve / croma: 1 semibreve = 8 crome.
    expect(musicCues(e, { value: 1 }).map((c) => c.duration)).toEqual([4]);
    expect(musicCues(e, { value: 4 })).toHaveLength(8);
  });

  it("uses A4 = 440 Hz equal temperament (C4 = 261.63 Hz)", () => {
    expect(pitchToFrequency("A4")).toBe(440);
    expect(pitchToFrequency("C4")).toBeCloseTo(261.6256, 3);
    expect(pitchToFrequency("C5")).toBeCloseTo(523.2511, 3);
  });

  it("keyboard covers whole octaves of the score and of the transpose slider", () => {
    expect(keyboardRange(entry())).toEqual([60, 71]);
    expect(keyboardRange(entry({ params: [{ id: "t", kind: "transpose", label: "T", min: 0, max: 5 }] }))).toEqual([60, 71]);
    expect(keyboardRange(entry({ notes: [{ pitch: "G3", beats: 1 }, { pitch: "C5", beats: 1 }] }))).toEqual([48, 83]);
  });
});

describe("MusicData schema and cross-checks", () => {
  const base = () => raw().engineData;

  it("rejects bad pitches, values, sliders and duplicates", () => {
    const cases: ((d: any) => void)[] = [
      (d) => (d.chapters[0].notes[0].pitch = "H4"),
      (d) => (d.chapters[0].notes[0].beats = 1.25),
      (d) => (d.chapters[0].tempo = 500),
      (d) => (d.chapters[1].params[0].min = 100), // own tempo 80 outside the slider
      (d) => (d.chapters[2].instruments = ["piano"]), // instrument slider with one instrument
      (d) => (d.chapters[1].params[1].min = 1), // value slider has a fixed range
      (d) => d.chapters[0].params.push({ id: "tr1", kind: "tempo", label: "x" }), // duplicate id
      (d) => d.chapters.push({ ...d.chapters[0], params: [] }), // duplicate chapter
      (d) => (d.chapters[0].instruments = ["kazoo"]),
      (d) => d.chapters[0].show.push({ item: "names", at: 5, until: 2 }),
    ];
    for (const mutate of cases) {
      const d = base();
      mutate(d);
      expect(MusicData.safeParse(d).success, mutate.toString()).toBe(false);
    }
  });

  it("finds cues that do not match the score", () => {
    const json = raw();
    const cues = json.chapters[0].sounds.cues;
    cues.find((c: any) => c.pitch === "G4").pitch = "A4";
    json.chapters[2].sounds.cues = json.chapters[2].sounds.cues.filter((c: any) => c.sound !== "instr-flute");
    const spec = SceneSpec.parse(json);
    if (spec.engine !== "music") throw new Error("unreachable");
    const issues = checkMusicData(spec.engineData, spec);
    expect(issues.map((i) => i.path)).toEqual(["chapters[0].sounds.cues", "chapters[2].sounds.cues"]);
    expect(issues[0]!.message).toMatch(/missing .*G4.*extra .*A4/);
  });

  it("finds bad anchors, unknown sliders, bar-crossing notes and scores longer than the chapter", () => {
    const json = raw();
    json.chapters[0].pins[2].anchor = { entity: "note", index: 40 };
    json.chapters[0].pins[4].anchor = { entity: "key", part: "C7" };
    json.chapters[1].camera[2].target = { entity: "panel", part: "wave" };
    json.chapters[2].pins[0].anchor = { entity: "instrument", part: "clarinet" };
    json.chapters[2].activity.test.params.push("nope");
    json.engineData.chapters[0].notes[0].beats = 1.5; // the dotted note pushes the scale across bar lines
    json.engineData.chapters[2].repeat = 8;
    const spec = SceneSpec.parse(applyMusicCues(json, MusicData.parse(json.engineData)));
    if (spec.engine !== "music") throw new Error("unreachable");
    const msgs = checkMusicData(spec.engineData, spec).map((i) => `${i.path}: ${i.message}`);
    expect(msgs.some((m) => m.includes("pins[2].anchor") && m.includes("note index 40"))).toBe(true);
    expect(msgs.some((m) => m.includes("pins[4].anchor") && m.includes("not on the keyboard"))).toBe(true);
    expect(msgs.some((m) => m.includes("camera[2].target") && m.includes("not shown"))).toBe(true);
    expect(msgs.some((m) => m.includes("chapters[2].pins[0]") && m.includes("clarinet"))).toBe(true);
    expect(msgs.some((m) => m.includes('unknown music param "nope"'))).toBe(true);
    expect(msgs.some((m) => m.includes("crosses the bar line"))).toBe(true);
    expect(msgs.some((m) => m.includes("after the chapter"))).toBe(true);
  });
});

describe("music engine", () => {
  it("builds in Node with every chapter and resolves all pin and camera anchors", async () => {
    const { spec, engine } = await buildEngine();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters)
      for (let t = 0; t <= ch.duration; t += 0.5) {
        engine.update(ch.id, t);
        for (const p of ch.pins) expect(engine.resolveAnchor(p.anchor, ch.id, t, out), `${ch.id} ${p.id} @${t}`).toBe(true);
        for (const k of ch.camera) expect(engine.resolveAnchor(k.target, ch.id, t, out), `${ch.id} camera @${t}`).toBe(true);
      }
    const b = engine.bounds();
    expect(b.radius).toBeGreaterThan(5);
    engine.dispose();
  });

  it("note pins stay on visible notes inside the staff during their windows", async () => {
    const { spec, engine, ctx } = await buildEngine();
    const out = new THREE.Vector3();
    for (const ch of spec.chapters)
      for (const p of ch.pins) {
        if (!("entity" in p.anchor) || p.anchor.entity !== "note") continue;
        for (const [a, b] of p.visible ?? [[0, ch.duration]])
          for (let t = a; t <= Math.min(b, ch.duration); t += 0.25) {
            engine.update(ch.id, t);
            engine.resolveAnchor({ ...p.anchor, offset: undefined }, ch.id, t, out);
            expect(out.x, `${ch.id} ${p.id} @${t}`).toBeGreaterThanOrEqual(STAFF.notesX0 - 0.2);
            expect(out.x, `${ch.id} ${p.id} @${t}`).toBeLessThanOrEqual(STAFF.notesX1 + 0.2);
            const note = ctx.root.getObjectByName(`music:${ch.id}`)!.getObjectByName(`note:${p.anchor.index ?? 0}`)!;
            expect(note.visible, `${ch.id} ${p.id} @${t}`).toBe(true);
          }
      }
  });

  it("update is a pure function of (chapter, t): scrubbing gives identical frames", async () => {
    const { engine, ctx } = await buildEngine();
    const frames = new Map<string, unknown[]>();
    for (const [ch, t] of [["note", 19.2], ["ritmo", 22.4], ["timbro", 20.1], ["timbro", 40]] as const) {
      engine.update(ch, t);
      frames.set(`${ch}@${t}`, snapshot(ctx.root));
    }
    for (const [ch, t] of [["timbro", 40], ["note", 3], ["timbro", 20.1], ["ritmo", 40], ["ritmo", 22.4], ["note", 19.2]] as const) {
      engine.update(ch, t);
      const want = frames.get(`${ch}@${t}`);
      if (want) expect(snapshot(ctx.root), `${ch}@${t}`).toEqual(want);
    }
  });

  it("the sounding note glows and its keyboard key presses down exactly when its cue plays", async () => {
    const { spec, engine, ctx } = await buildEngine();
    const ch = spec.chapters[0]!;
    const view = ctx.root.getObjectByName("music:note")!;
    for (const cue of ch.sounds!.cues.filter((c) => c.pitch)) {
      engine.update(ch.id, cue.at + 0.05);
      const keyed = view.getObjectByName(`key:${pitchToMidi(cue.pitch!)}`)!.parent!;
      expect(keyed.rotation.x, `${cue.pitch} @${cue.at}`).toBeGreaterThan(0);
      expect(keyed.userData.key).toBe(true);
      const lit: string[] = [];
      view.traverse((o) => o.name.startsWith("note:") && o.userData.key && lit.push(o.name));
      expect(lit).toHaveLength(1);
    }
    engine.update(ch.id, 5); // before the first note: nothing pressed
    const pressed: string[] = [];
    view.traverse((o) => o.name.startsWith("key:") && o.parent!.rotation.x > 0 && pressed.push(o.name));
    expect(pressed).toEqual([]);
  });

  it("sliders: params(), setParams() and soundCues() follow each other", async () => {
    const { spec, engine, ctx } = await buildEngine();
    expect(engine.params!("note")).toEqual([{ id: "tr1", label: "Sposta la scala (semitoni)", min: 0, max: 7, step: 1, value: 0 }]);
    expect(engine.params!("ritmo").map((p) => [p.id, p.min, p.max, p.value])).toEqual([["bpm2", 40, 160, 80], ["fig2", 1, 5, 1]]);
    engine.update("timbro", 19);
    expect(engine.params!("timbro").find((p) => p.id === "str3")?.value).toBe(2); // the flute's turn
    expect(engine.soundCues("note")).toEqual(spec.chapters[0]!.sounds!.cues.filter((c) => c.sound.startsWith("instr-")));

    engine.setParams!({ tr1: 2, str3: 3 });
    expect(engine.soundCues("note").slice(0, 3).map((c) => c.pitch)).toEqual(["D4", "E4", "F#4"]);
    expect(new Set(engine.soundCues("timbro").filter((c) => c.pitch).map((c) => c.sound))).toEqual(new Set(["instr-violin"]));
    engine.update("note", 19.1); // third note, transposed: F#4
    const view = ctx.root.getObjectByName("music:note")!;
    expect(view.getObjectByName(`key:${pitchToMidi("F#4")}`)!.parent!.rotation.x).toBeGreaterThan(0);

    engine.setParams!({ fig2: 4, bpm2: 999 });
    expect(engine.params!("ritmo").find((p) => p.id === "bpm2")?.value).toBe(160); // clamped
    engine.update("ritmo", 14);
    const notes: string[] = [];
    ctx.root.getObjectByName("music:ritmo")!.traverse((o) => o.name.startsWith("note:") && notes.push(o.name));
    expect(notes).toHaveLength(40); // 20 beats of crome

    engine.setParams!(null);
    expect(engine.soundCues("note")).toEqual(spec.chapters[0]!.sounds!.cues.filter((c) => c.sound.startsWith("instr-")));
    engine.dispose();
    expect(ctx.root.children).toHaveLength(0);
  });
});
