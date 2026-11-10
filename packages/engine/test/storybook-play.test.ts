import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SceneSpec, type StoryPlay } from "@pv/scene-spec";
import type { EngineContext } from "../src/index.ts";
import { createStorybookEngine } from "../src/engines/storybook/index.ts";
import { PALETTE, PlayRun } from "../src/engines/storybook/play.ts";
import { SOUND_GAP_MS, WOBBLE_SECONDS } from "../src/engines/storybook/touch.ts";

const raw = readFileSync(new URL("../../../fixtures/public/scenes/_dev-storie.scene.json", import.meta.url), "utf8");
const spec = (mutate?: (d: any) => void): SceneSpec => {
  const d = JSON.parse(raw);
  mutate?.(d);
  return SceneSpec.parse(d);
};

async function built(opts: Partial<EngineContext> = {}, mutate?: (d: any) => void) {
  const engine = createStorybookEngine();
  const ctx: EngineContext = { root: new THREE.Group(), scene: new THREE.Scene(), loadAsset: async () => new ArrayBuffer(0), ...opts };
  await engine.build(ctx, spec(mutate));
  // The group of a character is named after its catalogue model.
  const sp = spec(mutate);
  const models = new Map((sp.engine === "storybook" ? sp.engineData.characters : []).map((c) => [c.id, c.model]));
  const char = (id: string) => ctx.root.getObjectByName(models.get(id)!) as THREE.Group;
  return { engine, root: ctx.root, char };
}

/** A ray falling straight down on where `id` stands at (chapter, t). */
function above(engine: ReturnType<typeof createStorybookEngine>, id: string, ch: string, t: number): THREE.Ray {
  const v = new THREE.Vector3();
  engine.update(ch, t);
  expect(engine.resolveAnchor({ entity: id } as never, ch, t, v)).toBe(true);
  return new THREE.Ray(new THREE.Vector3(v.x, 30, v.z), new THREE.Vector3(0, -1, 0));
}

/** Makes `who` (renamed to start with B) appear in chapter `k` an instant before its end: not yet on stage at the end. */
function late(d: any, k: number, who: string): void {
  d.engineData.characters.find((c: { id: string }) => c.id === who).name = "Bolla";
  d.engineData.chapters[k].acts.push({ do: "appear", who, at: d.chapters[k].duration - 1e-6, sound: false });
}

const END = { mare: 20, tuffo: 20, prato: 15, cielo: 15 } as const;
let clock = 10_000;
/** Taps `id` at the end of the chapter, a second after the previous tap (no rate limit in the way). */
function tapAt(engine: ReturnType<typeof createStorybookEngine>, ch: keyof typeof END, id: string) {
  clock += 1000;
  return engine.tap!(ch, END[ch], above(engine, id, ch, END[ch]), clock);
}

describe("PlayRun", () => {
  const letter: StoryPlay = { kind: "letter", prompt: "p", targets: ["a", "b"], stamp: "s" };
  const order: StoryPlay = { kind: "order", prompt: "p", order: ["a", "b", "c"], stamp: "s" };

  it("letter hunt completes when every target is found; non-targets never count", () => {
    const r = new PlayRun(letter, ["a", "b", "x"]);
    expect(r.tap("x")).toBe("wobble");
    expect(r.done).toBe(0);
    expect(r.tap("a")).toBe("good");
    expect(r.tap("a")).toBe("again");
    expect(r.done).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.tap("b")).toBe("good");
    expect(r.complete).toBe(true);
    expect(r.marks()).toEqual([{ id: "a", text: "★" }, { id: "b", text: "★" }]);
    // Nothing counts once it is done.
    expect(r.tap("x")).toBe("ignore");
  });

  it("big to small accepts only the next in order and completes at the end", () => {
    const r = new PlayRun(order, ["a", "b", "c", "z"]);
    expect(r.tap("b")).toBe("wobble");
    expect(r.tap("c")).toBe("wobble");
    expect(r.tap("z")).toBe("ignore");
    expect(r.tap("a")).toBe("good");
    expect(r.tap("a")).toBe("again");
    expect(r.tap("b")).toBe("good");
    expect(r.marks()).toEqual([{ id: "a", text: "1" }, { id: "b", text: "2" }]);
    expect(r.complete).toBe(false);
    expect(r.tap("c")).toBe("good");
    expect(r.complete).toBe(true);
  });

  it("colouring completes when every part is coloured; touch counts every character once", () => {
    const c = new PlayRun({ kind: "color", prompt: "p", who: "w", stamp: "s" }, ["w", "q"], ["body", "belly"]);
    expect(c.paint("body")).toBe("good");
    expect(c.paint("body")).toBe("again");
    // The finger lands on the painted body again: the colouring moves on to the belly. A miss does too.
    expect(c.target("body")).toBe("belly");
    expect(c.target(undefined)).toBe("belly");
    expect(c.target("belly")).toBe("belly");
    expect(c.complete).toBe(false);
    expect(c.paint("belly")).toBe("good");
    expect(c.complete).toBe(true);
    const t = new PlayRun({ kind: "touch", prompt: "p", stamp: "s" }, ["x", "y"]);
    expect(t.tap("x")).toBe("good");
    expect(t.tap("x")).toBe("again");
    expect(t.complete).toBe(false);
    t.tap("y");
    expect(t.complete).toBe(true);
  });
});

describe("storybook activities in the engine", () => {
  it("the letter hunt on the real scene: found marks, completion with the ta-da", async () => {
    const { engine } = await built();
    // Not yet at the chapter's end: the play is not active, touch-to-hear as in Task 7.
    const early = engine.tap!("mare", 5, above(engine, "balena", "mare", 5), 500);
    expect(early?.sound).toMatch(/^sb:/);
    expect(engine.play!("mare")!.progress).toEqual({ done: 0, total: 3 });
    const first = tapAt(engine, "mare", "balena");
    expect(first?.sound).toMatch(/^sb:xylophone-up/);
    const v = engine.play!("mare")!;
    expect(v.kind).toBe("letter");
    expect(v.letter).toBe("B");
    expect(v.progress).toEqual({ done: 1, total: 3 });
    expect(v.marks).toEqual([{ id: "balena", text: "★" }]);
    expect(tapAt(engine, "mare", "barca")?.complete).toBeUndefined();
    const last = tapAt(engine, "mare", "bruco");
    expect(last?.complete).toBe(true);
    expect(last?.sound).toMatch(/^sb:ta-da/);
    expect(engine.play!("mare")!.complete).toBe(true);
    // After completion touch-to-hear works again.
    expect(tapAt(engine, "mare", "balena")?.sound).toMatch(/^sb:/);
    expect(engine.play!("mare")!.progress.done).toBe(3);
  });

  it("order: the right next one is numbered with a rising note, a wrong one wobbles softly", async () => {
    const { engine, char } = await built();
    const wrong = tapAt(engine, "tuffo", "pesce");
    expect(wrong?.sound).toMatch(/^sb:boing/);
    expect(engine.play!("tuffo")!.progress.done).toBe(0);
    // The wobble turns the fish a little, and ends exactly where it began.
    engine.update("tuffo", 20);
    const base = char("pesce").rotation.z;
    engine.animate!(clock + 100);
    expect(char("pesce").rotation.z).not.toBe(base);
    engine.update("tuffo", 20);
    engine.animate!(clock + WOBBLE_SECONDS * 1000 + 50);
    expect(char("pesce").rotation.z).toBe(base);
    expect(tapAt(engine, "tuffo", "balena")?.sound).toMatch(/^sb:xylophone-up/);
    expect(engine.play!("tuffo")!.marks).toEqual([{ id: "balena", text: "1" }]);
    tapAt(engine, "tuffo", "barca");
    expect(tapAt(engine, "tuffo", "pesce")?.complete).toBe(true);
    expect(engine.play!("tuffo")!.marks!.map((m) => m.text)).toEqual(["1", "2", "3"]);
  });

  it("order: a character the play does not concern still answers with its own sound", async () => {
    const { engine } = await built();
    expect(tapAt(engine, "tuffo", "granchio")?.sound).toMatch(/^sb:/);
    expect(engine.play!("tuffo")!.progress.done).toBe(0);
  });

  it("colouring fills the tapped part with the picked colour and completes when every part is coloured", async () => {
    const { engine, char } = await built();
    const v0 = engine.play!("cielo")!;
    expect(v0.kind).toBe("color");
    expect(v0.palette).toEqual(PALETTE);
    expect(v0.palette).toHaveLength(6);
    expect(v0.picked).toBeUndefined();
    const part = (id: string, name: string) => char(id).getObjectByName(name) as THREE.Mesh;
    const colour = (m: THREE.Mesh) => (m.material as THREE.MeshToonMaterial).color.getHexString();
    const bodyBefore = colour(part("balena", "body"));
    const bellyBefore = colour(part("balena", "belly"));
    const sunBefore = colour(part("sole", "disc"));
    // Nothing picked yet: the whale just answers with its own sound, nothing is painted.
    expect(tapAt(engine, "cielo", "balena")?.sound).toMatch(/^sb:/);
    expect(colour(part("balena", "body"))).toBe(bodyBefore);
    engine.choose!("cielo", 0);
    expect(engine.play!("cielo")!.picked).toBe(0);
    // From above the ray meets the back (body).
    const r = tapAt(engine, "cielo", "balena");
    expect(r?.sound).toBeTruthy();
    expect(colour(part("balena", "body"))).toBe(PALETTE[0]!.slice(1));
    expect(colour(part("balena", "belly"))).toBe(bellyBefore);
    expect(engine.play!("cielo")!.progress).toEqual({ done: 1, total: 2 });
    // From the side, low: the belly.
    engine.update("cielo", END.cielo);
    char("balena").updateWorldMatrix(true, true);
    const belly = new THREE.Box3().setFromObject(part("balena", "belly")).getCenter(new THREE.Vector3());
    engine.choose!("cielo", 4);
    clock += 1000;
    const side = engine.tap!("cielo", END.cielo, new THREE.Ray(new THREE.Vector3(belly.x, belly.y, belly.z + 30), new THREE.Vector3(0, 0, -1)), clock);
    expect(side?.complete).toBe(true);
    expect(colour(part("balena", "belly"))).toBe(PALETTE[4]!.slice(1));
    expect(colour(part("balena", "body"))).toBe(PALETTE[0]!.slice(1));
    // Nothing else was recoloured.
    expect(colour(part("sole", "disc"))).toBe(sunBefore);
    expect(engine.play!("cielo")!.complete).toBe(true);
  });

  it("colours survive a chapter change and are not in any saved state", async () => {
    const before = JSON.parse(raw);
    const { engine, char } = await built();
    engine.choose!("cielo", 2);
    tapAt(engine, "cielo", "balena");
    const body = () => ((char("balena").getObjectByName("body") as THREE.Mesh).material as THREE.MeshToonMaterial).color.getHexString();
    expect(body()).toBe(PALETTE[2]!.slice(1));
    engine.update("mare", 3);
    engine.update("tuffo", 3);
    engine.update("cielo", 1);
    expect(body()).toBe(PALETTE[2]!.slice(1));
    expect(engine.play!("cielo")!.progress.done).toBe(1);
    expect(engine.play!("cielo")!.picked).toBe(2);
    // The lesson itself is untouched.
    expect(JSON.parse(raw)).toEqual(before);
  });

  it("a mistaken touch never plays the quiz 'wrong' sound", async () => {
    const { engine } = await built();
    const sounds: (string | undefined)[] = [];
    for (const [ch, ids] of [["tuffo", ["pesce", "barca", "pesce", "granchio"]], ["mare", ["balena", "balena", "bruco"]]] as const) {
      for (const id of ids) sounds.push(tapAt(engine, ch, id)?.sound);
    }
    expect(sounds.length).toBeGreaterThan(5);
    for (const s of sounds) {
      if (s === undefined) continue;
      expect(s).toMatch(/^sb:/);
      expect(s).not.toMatch(/wrong|buzz|correct/);
    }
  });

  it("progress is kept per lesson session and play is null in a chapter without one", async () => {
    const { engine } = await built();
    expect(engine.play!("treno")).toBeNull();
    tapAt(engine, "mare", "balena");
    engine.update("tuffo", 1);
    expect(engine.play!("mare")!.progress.done).toBe(1);
  });

  it("a tap sound dropped by the global limiter does not use up the character's slot", async () => {
    const { engine } = await built();
    const ray = above(engine, "balena", "mare", 5);
    // Not at the end, so touch-to-hear. The global limit says no: no sound, and the slot stays free.
    expect(engine.tap!("mare", 5, ray, 1000, () => false)).toEqual({});
    expect(engine.tap!("mare", 5, ray, 1000 + SOUND_GAP_MS / 2, () => true)?.sound).toMatch(/^sb:/);
    // And the other way round: a character still inside its own gap does not ask the global limiter at all.
    let asked = 0;
    engine.tap!("mare", 5, ray, 1000 + SOUND_GAP_MS / 2 + 10, () => (asked++, true));
    expect(asked).toBe(0);
  });

  it("reduced motion makes the bounce smaller", async () => {
    const peak = async (reducedMotion: boolean) => {
      const { engine, char } = await built(reducedMotion ? { reducedMotion } : {});
      const ray = above(engine, "balena", "mare", 5);
      engine.update("mare", 5);
      const base = char("balena").scale.y;
      engine.tap!("mare", 5, ray, 100);
      let max = 1;
      for (let now = 100; now < 500; now += 10) {
        engine.update("mare", 5);
        engine.animate!(now);
        max = Math.max(max, char("balena").scale.y / base);
      }
      return max;
    };
    const full = await peak(false);
    const calm = await peak(true);
    expect(full).toBeGreaterThan(1.1);
    expect(calm).toBeLessThan(full);
    expect(calm).toBeLessThan(1.1);
  });

  it("targets that are not on stage at the end do not count: the hunt can still be finished", async () => {
    // "sole" is named Bolla (starts with B) but only appears in the chapter's last instant; "balena" is listed twice.
    const { engine } = await built({}, (d) => {
      late(d, 0, "sole");
      d.engineData.chapters[0].play.targets = ["balena", "barca", "sole", "bruco", "balena"];
    });
    expect(engine.play!("mare")!.progress).toEqual({ done: 0, total: 3 });
    tapAt(engine, "mare", "balena");
    tapAt(engine, "mare", "barca");
    expect(tapAt(engine, "mare", "bruco")?.complete).toBe(true);
    expect(engine.play!("mare")!.complete).toBe(true);
  });

  it("an order character that is not on stage at the end is left out of the sequence", async () => {
    const { engine } = await built({}, (d) => {
      late(d, 1, "sole");
      d.engineData.chapters[1].play.order = ["balena", "barca", "sole", "pesce"];
    });
    expect(engine.play!("tuffo")!.progress).toEqual({ done: 0, total: 3 });
    tapAt(engine, "tuffo", "balena");
    tapAt(engine, "tuffo", "barca");
    expect(tapAt(engine, "tuffo", "pesce")?.complete).toBe(true);
    expect(engine.play!("tuffo")!.marks!.map((m) => m.text)).toEqual(["1", "2", "3"]);
  });

  it("a play with nothing reachable is not offered", async () => {
    const { engine } = await built({}, (d) => {
      late(d, 0, "sole");
      d.engineData.chapters[0].play.targets = ["sole"];
    });
    expect(engine.play!("mare")).toBeNull();
  });

  it("the same view object is handed out until a touch or a choice changes it", async () => {
    const { engine } = await built();
    const a = engine.play!("cielo")!;
    expect(engine.play!("cielo")).toBe(a);
    engine.choose!("cielo", 1);
    const b = engine.play!("cielo")!;
    expect(b).not.toBe(a);
    expect(engine.play!("cielo")).toBe(b);
    tapAt(engine, "cielo", "balena");
    expect(engine.play!("cielo")).not.toBe(b);
    const mare = engine.play!("mare")!;
    tapAt(engine, "mare", "balena");
    expect(engine.play!("mare")).not.toBe(mare);
  });

  it("a finished colouring no longer paints, and a finished chapter goes back to touch-to-hear", async () => {
    const { engine, char } = await built();
    engine.choose!("cielo", 0);
    tapAt(engine, "cielo", "balena");
    tapAt(engine, "cielo", "balena");
    expect(engine.play!("cielo")!.complete).toBe(true);
    const colour = (name: string) => ((char("balena").getObjectByName(name) as THREE.Mesh).material as THREE.MeshToonMaterial).color.getHexString();
    const before = [colour("body"), colour("belly")];
    engine.choose!("cielo", 5);
    const again = tapAt(engine, "cielo", "balena");
    expect(again?.complete).toBeUndefined();
    expect(again?.sound).toMatch(/^sb:whale-spout/);
    expect([colour("body"), colour("belly")]).toEqual(before);
    expect(engine.play!("cielo")!.progress).toEqual({ done: 2, total: 2 });
    // The same for the order: after the end, touches change nothing and nothing wobbles.
    for (const id of ["balena", "barca", "pesce"]) tapAt(engine, "tuffo", id);
    const marks = engine.play!("tuffo")!.marks;
    const replay = tapAt(engine, "tuffo", "barca");
    expect(replay?.sound).not.toMatch(/boing|xylophone|ta-da/);
    expect(engine.play!("tuffo")!.marks).toEqual(marks);
  });
});
