import { describe, expect, it } from "vitest";
import { buildingSize, checkFacadeData, checkScene, FacadeData, floorLayout, SceneSpec } from "../src/index.ts";

type Raw = Record<string, any>;

const palazzo = (): Raw => ({
  buildings: [
    {
      id: "palazzo",
      name: "Palazzo",
      style: "renaissance",
      base: { height: 1 },
      floors: [
        {
          id: "f0",
          height: 6,
          wall: "rusticated",
          top: "string-course",
          members: { type: "pier", width: 0.8, rusticated: true },
          bays: [
            { id: "b0", width: 4, cell: { el: "arch" } },
            { id: "b1", width: 5, cell: { el: "arch" } },
            { id: "b2", width: 4, cell: { el: "arch" } },
          ],
        },
        {
          id: "f1",
          height: 5,
          top: "entablature",
          cornice: "dentils",
          members: { type: "pilaster", order: "ionic", width: 0.5 },
          bays: [
            { id: "c0", width: 4, cell: { el: "window", w: 1.2, h: 2.4, sill: 1, pediment: "triangular" } },
            { id: "c1", width: 5, cell: { el: "window", w: 1.2, h: 2.4, sill: 1, pediment: "triangular" } },
            { id: "c2", width: 4, cell: { el: "window", w: 1.2, h: 2.4, sill: 1, pediment: "triangular" } },
          ],
        },
      ],
      crown: { type: "balustrade", height: 1 },
    },
  ],
  chapters: [{ chapter: "c1", building: "palazzo", views: [{ at: 0, view: "prospetto" }], acts: [{ do: "draw", target: "palazzo", at: 1 }] }],
});

const scene = (engineData: Raw, extra: Raw = {}): Raw => ({
  version: "0.1",
  engine: "facade",
  title: "Palazzo rinascimentale",
  page: { subject: "Arte", topic: "Facciate", language: "it" },
  kind: "art",
  chapters: [
    {
      id: "c1",
      title: "Il palazzo",
      chip: "Palazzo",
      kind: "art",
      duration: 10,
      narration: [{ at: 0, text: "Un palazzo rinascimentale.", highlight: [], sourceIds: ["page"] }],
      camera: [],
      pins: [],
      deep: [],
      quiz: [],
      ...extra,
    },
  ],
  sources: [{ id: "page", kind: "page", title: "Pagina del libro" }],
  videos: [],
  disclaimers: [],
  engineData,
});

const issues = (data: Raw, extra: Raw = {}) => {
  const s = SceneSpec.parse(scene(data, extra));
  return checkFacadeData(s.engineData as FacadeData, s);
};

const only = (list: { path: string; message: string }[], text: string) => {
  expect(list).toHaveLength(1);
  expect(list[0]!.message).toContain(text);
  return list[0]!;
};

describe("facade grammar", () => {
  it("parses a valid palazzo and finds no issues", () => {
    FacadeData.parse(palazzo());
    expect(issues(palazzo())).toEqual([]);
    expect(checkScene(SceneSpec.parse(scene(palazzo())))).toEqual([]);
  });

  it("floorLayout centres the bays", () => {
    const d = palazzo();
    d.buildings[0].floors[0].bays[0].width = 4;
    d.buildings[0].floors[0].bays[1].width = 5;
    const l = floorLayout(FacadeData.parse(d).buildings[0]!.floors[0]!);
    expect(l.width).toBe(13);
    expect(l.bays[0]!.x0).toBe(-6.5);
    expect(l.bays[2]!.x1).toBe(6.5);
    expect(l.bays[1]!.cx).toBe(0);
  });

  it("buildingSize adds base, floors and a pediment", () => {
    const d = palazzo();
    d.buildings[0].crown = { type: "pediment", shape: "triangular", pitch: 22 };
    const size = buildingSize(FacadeData.parse(d).buildings[0]!);
    expect(size.width).toBe(13);
    expect(size.height).toBeCloseTo(12 + 6.5 * Math.tan((22 * Math.PI) / 180), 3);
  });

  it("accepts a 1-bay and a 15-bay floor", () => {
    const d = palazzo();
    d.buildings[0].floors = [{ id: "f", height: 4, bays: [{ id: "x", width: 3, cell: { el: "wall" } }] }];
    expect(FacadeData.safeParse(d).success).toBe(true);
    d.buildings[0].floors[0].bays = Array.from({ length: 15 }, (_, i) => ({ id: `x${i}`, width: 3, cell: { el: "wall" } }));
    expect(FacadeData.safeParse(d).success).toBe(true);
  });

  it("rejects 16 bays and 7 floors at parse time", () => {
    const d = palazzo();
    d.buildings[0].floors[0].bays = Array.from({ length: 16 }, (_, i) => ({ id: `x${i}`, width: 3, cell: { el: "wall" } }));
    expect(FacadeData.safeParse(d).success).toBe(false);
    const e = palazzo();
    e.buildings[0].floors = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, height: 3, bays: [{ id: `x${i}`, width: 3, cell: { el: "wall" } }] }));
    expect(FacadeData.safeParse(e).success).toBe(false);
  });
});

describe("checkFacadeData", () => {
  it("reports a window taller than its floor", () => {
    const d = palazzo();
    d.buildings[0].floors[1].bays[1].cell.h = 5;
    const i = only(issues(d), "taller than the floor");
    expect(i.path.endsWith("cell")).toBe(true);
  });

  it("reports a cell wider than its bay minus the members", () => {
    const d = palazzo();
    d.buildings[0].floors[1].bays[0].cell.w = 3.8;
    only(issues(d), "wider than the bay");
  });

  it("reports an upper floor wider than the one below", () => {
    const d = palazzo();
    d.buildings[0].floors[1].bays[1].width = 5.5;
    only(issues(d), "wider than the floor below");
    d.buildings[0].floors[1].bays[1].width = 5.1;
    expect(issues(d)).toEqual([]);
  });

  it("reports a colonnade without columns", () => {
    const d = palazzo();
    d.buildings[0].floors[1].colonnade = { depth: 2 };
    only(issues(d), "colonnade");
  });

  it("reports paired members on a colonnade", () => {
    const d = palazzo();
    d.buildings[0].floors[1].members = { type: "column", order: "doric", width: 0.4, paired: true };
    d.buildings[0].floors[1].colonnade = { depth: 2 };
    only(issues(d), "cannot have paired members");
  });

  it("reports an order missing on a pilaster", () => {
    const d = palazzo();
    delete d.buildings[0].floors[1].members.order;
    only(issues(d), "needs an order");
  });

  it("reports a crown over unknown bays", () => {
    const d = palazzo();
    d.buildings[0].crown = { type: "pediment", bays: ["c0", "zz"] };
    only(issues(d), "unknown bays");
  });

  it("reports an unknown building in a chapter", () => {
    const d = palazzo();
    d.chapters[0].building = "castello";
    only(issues(d), 'unknown building "castello"');
  });

  it("reports an act after the chapter ends", () => {
    const d = palazzo();
    d.chapters[0].acts.push({ do: "eye", at: 12 });
    only(issues(d), "after the chapter ends");
  });

  it("reports an unknown act target", () => {
    const d = palazzo();
    d.chapters[0].acts.push({ do: "highlight", target: "f9", at: 2 });
    only(issues(d), 'unknown target "f9"');
    const e = palazzo();
    e.chapters[0].acts.push({ do: "cut", bay: "zz", at: 2 });
    only(issues(e), 'unknown bay "zz"');
  });

  it("accepts the documented act targets", () => {
    const d = palazzo();
    d.chapters[0].acts.push({ do: "highlight", target: "f1.members", at: 2 }, { do: "highlight", target: "crown", at: 3 }, { do: "cut", bay: "c1", at: 4 });
    expect(issues(d)).toEqual([]);
  });

  it("reports a test param that is not eye-height or eye-x", () => {
    only(issues(palazzo(), { activity: { predict: { q: "?", options: ["a", "b"], answer: 0 }, test: { prompt: "Muovi", params: ["eye-height", "zoom"] }, prove: { text: "ok", sourceIds: [] }, stamp: "Architetto" } }), 'unknown facade param "zoom"');
  });

  it("reports duplicate floor or bay ids inside a building", () => {
    const d = palazzo();
    d.buildings[0].floors[1].bays[2].id = "c0";
    only(issues(d), 'duplicate floor or bay id "c0"');
  });

  it("reports a pin on an unknown bay", () => {
    const pin = (part: string) => ({ id: "p", name: "Pin", info: "i", kind: "place", anchor: { entity: "bay", part }, sourceIds: [] });
    expect(issues(palazzo(), { pins: [pin("c1")] })).toEqual([]);
    only(issues(palazzo(), { pins: [pin("nope")] }), 'unknown bay "nope"');
  });
});

describe("facade chapter and anchor checks", () => {
  it("reports a scene chapter with no facade entry", () => {
    const d = palazzo();
    d.chapters = [];
    only(issues(d), 'chapter "c1" has no facade entry');
  });

  it("reports duplicate chapter entries", () => {
    const d = palazzo();
    d.chapters.push(structuredClone(d.chapters[0]));
    only(issues(d), 'duplicate facade entry for chapter "c1"');
  });

  it("reports duplicate building ids", () => {
    const d = palazzo();
    d.buildings.push(structuredClone(d.buildings[0]));
    only(issues(d), 'duplicate building id "palazzo"');
  });

  const pin = (anchor: Raw) => ({ id: "p", name: "Pin", info: "i", kind: "place", anchor, sourceIds: [] });

  it("reports a member anchor on a floor without members", () => {
    const d = palazzo();
    delete d.buildings[0].floors[1].members;
    expect(issues(palazzo(), { pins: [pin({ entity: "member", part: "f1" })] })).toEqual([]);
    only(issues(d, { pins: [pin({ entity: "member", part: "f1" })] }), 'floor "f1" has no members');
  });

  it("reports a vanishing-point anchor with an index", () => {
    expect(issues(palazzo(), { pins: [pin({ entity: "vanishing-point" })] })).toEqual([]);
    only(issues(palazzo(), { pins: [pin({ entity: "vanishing-point", index: 1 })] }), "single vanishing point");
  });

  it("reports a chapter that sets both view keys and camera keys", () => {
    const key = { at: 0, target: { entity: "building" }, distance: 10, azimuth: 0, elevation: 10 };
    only(issues(palazzo(), { camera: [key] }), "camera keys are ignored");
    const d = palazzo();
    delete d.chapters[0].views;
    expect(issues(d, { camera: [key] })).toEqual([]);
  });
});

describe("rotunda and dome", () => {
  const rotunda = (): Raw => ({ diameter: 43.3, height: 21.65, niches: 7, dome: { type: "coffered", coffers: [5, 28], oculus: 8.2, steps: 7 } });
  const withRotunda = (): Raw => {
    const d = palazzo();
    d.buildings[0].rotunda = rotunda();
    return d;
  };

  it("a rotunda with a coffered dome parses and checks clean", () => {
    const d = withRotunda();
    d.chapters[0].acts.push({ do: "draw", target: "rotunda", at: 1 }, { do: "highlight", target: "dome", at: 2 });
    d.chapters[0].plan = 2.2;
    d.chapters[0].views.push({ at: 4, view: "pianta" });
    expect(FacadeData.safeParse(d).success).toBe(true);
    expect(issues(d)).toEqual([]);
  });

  it("buildingSize includes the rotunda: depth and height", () => {
    const b = FacadeData.parse(withRotunda()).buildings[0]!;
    const plain = buildingSize(FacadeData.parse(palazzo()).buildings[0]!);
    const size = buildingSize(b);
    const outer = 43.3 / 2 + 0.14 * 43.3;
    expect(size.depth).toBeCloseTo(plain.depth + 2 * outer, 6);
    expect(size.height).toBeGreaterThan(21.65 + outer - 1e-6);
    // a gap moves the rotunda back
    const d = withRotunda();
    d.buildings[0].rotunda.gap = 3;
    expect(buildingSize(FacadeData.parse(d).buildings[0]!).depth).toBeCloseTo(size.depth + 3, 6);
  });

  it("rotunda checks report readable issues", () => {
    const run = (tweak: (d: Raw) => void, text: string) => {
      const d = withRotunda();
      tweak(d);
      expect(() => issues(d)).not.toThrow();
      only(issues(d), text);
    };
    run((d) => (d.buildings[0].rotunda.wall = 12), "wall");
    run((d) => (d.buildings[0].rotunda.dome.oculus = 20), "oculus");
    run((d) => (d.buildings[0].rotunda.dome = { type: "smooth", oculus: 4, lantern: true }), "lantern");
    run((d) => (d.buildings[0].rotunda.dome = { type: "smooth", coffers: [3, 12] }), "coffers");
    run((d) => (d.chapters[0].plan = 100), "plan");
    const bare = palazzo();
    bare.chapters[0].acts.push({ do: "highlight", target: "dome", at: 2 });
    only(issues(bare), "needs a rotunda");
    const pin = { id: "p", name: "Pin", info: "i", kind: "place", anchor: { entity: "oculus" }, sourceIds: [] };
    only(issues(palazzo(), { pins: [pin] }), "no rotunda");
    expect(issues(withRotunda(), { pins: [pin] })).toEqual([]);
  });

  it("rejects out-of-range rotunda numbers at parse time", () => {
    for (const tweak of [(r: Raw) => (r.niches = 17), (r: Raw) => (r.dome.coffers = [9, 28]), (r: Raw) => (r.dome.coffers = [5, 4]), (r: Raw) => (r.dome.steps = 9)]) {
      const d = withRotunda();
      tweak(d.buildings[0].rotunda);
      expect(FacadeData.safeParse(d).success).toBe(false);
    }
  });
});
