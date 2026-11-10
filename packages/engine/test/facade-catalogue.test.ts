import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { floorLayout, FacadeBuilding, type FacadeCell, type FacadeFloor, type FacadeMember } from "@pv/scene-spec";
import { entablature } from "../src/engines/facade/catalogue/bands.ts";
import { attic, balustrade, gable, pediment, volute, voluteSpiral } from "../src/engines/facade/catalogue/crown.ts";
import { archOpening, nicheTrim, oculusTrim, panelTrim, portalTrim, voussoirs, windowTrim } from "../src/engines/facade/catalogue/openings.ts";
import { aisleSlopes, gallery, splayedPortal } from "../src/engines/facade/catalogue/romanesque.ts";
import { colonnade, colonnadeAxes, triglyphFrieze } from "../src/engines/facade/catalogue/temple.ts";
import { FacadeInk } from "../src/engines/facade/ink.ts";
import { buildModel } from "../src/engines/facade/model.ts";
import { FACADE_ORDER_RATIO, memberAxisZ, orderDims, orderMember } from "../src/engines/facade/catalogue/orders.ts";

type Cell<K extends FacadeCell["el"]> = Extract<FacadeCell, { el: K }>;

const box = (g: THREE.BufferGeometry): THREE.Box3 => {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
};

/** Connected pieces of a mesh (vertices that share a position belong together), as bounding boxes. */
function pieces(g: THREE.BufferGeometry): THREE.Box3[] {
  const flat = g.index ? g.toNonIndexed() : g;
  const p = flat.getAttribute("position");
  const key = (i: number) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (let i = 0; i < p.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
  for (let i = 0; i < p.count; i += 3) {
    const a = find(key(i));
    for (const j of [i + 1, i + 2]) parent.set(find(key(j)), a);
  }
  const boxes = new Map<string, THREE.Box3>();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const r = find(key(i));
    if (!boxes.has(r)) boxes.set(r, new THREE.Box3());
    boxes.get(r)!.expandByPoint(v.fromBufferAttribute(p, i));
  }
  return [...boxes.values()];
}

function finite(g: THREE.BufferGeometry): boolean {
  const p = g.getAttribute("position").array;
  const n = g.getAttribute("normal").array;
  return [...p, ...n].every(Number.isFinite) && p.length > 0;
}

/** Bounding box mirrored about x = cx matches itself (within a millimetre). */
function symmetric(g: THREE.BufferGeometry, cx = 0): boolean {
  const b = box(g);
  return Math.abs(b.min.x + b.max.x - 2 * cx) < 1e-3;
}

const member = (type: FacadeMember["type"], order: NonNullable<FacadeMember["order"]>, width = 0.5): FacadeMember => ({ type, order, width });

describe("orders", () => {
  it("order members keep Vignola proportions", () => {
    for (const order of ["tuscan", "doric", "ionic", "corinthian", "composite"] as const) {
      const dims = orderDims(order, 7, 3);
      const want = 7 / FACADE_ORDER_RATIO[order];
      expect(Math.abs(dims.d - want) / want).toBeLessThan(0.02);
      // measured on the geometry: the widest point of the shaft's bottom ring
      const g = orderMember(member("column", order, 3), 7, 1, 2);
      const pos = g.getAttribute("position");
      let r = 0;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - dims.shaftY0) < 1e-4) r = Math.max(r, Math.hypot(pos.getX(i) - 1, pos.getZ(i) - 2));
      expect(Math.abs(2 * r - want) / want, order).toBeLessThan(0.02);
      expect(finite(g), order).toBe(true);
      expect(box(g).max.y).toBeCloseTo(7, 1);
    }
    expect([FACADE_ORDER_RATIO.tuscan, FACADE_ORDER_RATIO.doric, FACADE_ORDER_RATIO.ionic, FACADE_ORDER_RATIO.corinthian, FACADE_ORDER_RATIO.composite]).toEqual([7, 8, 9, 10, 10]);
  });

  it("a pilaster projects less than a half-column, which projects less than a column", () => {
    for (const order of ["tuscan", "doric", "ionic", "corinthian", "composite"] as const) {
      // real projection from the wall, in lower diameters, with each member on its own axis z
      const proj = (type: FacadeMember["type"]) => box(orderMember(member(type, order), 4, 0, memberAxisZ(member(type, order), 4))).max.z / orderDims(order, 4, 0.5).d;
      expect(proj("pilaster"), order).toBeGreaterThan(0.1);
      expect(proj("pilaster"), order).toBeLessThan(0.5);
      expect(proj("half-column"), order).toBeGreaterThan(0.5);
      expect(proj("half-column"), order).toBeLessThan(0.75);
      // a column without a colonnade stands clear of the wall; one on a colonnade goes further still
      expect(proj("column"), order).toBeGreaterThan(1.1);
      expect(box(orderMember(member("column", order), 4, 0, memberAxisZ(member("column", order), 4, 2))).max.z).toBeGreaterThan(2);
    }
  });

  it("members are symmetric about their axis and have no NaN", () => {
    for (const type of ["pilaster", "half-column", "column"] as const) for (const order of ["tuscan", "ionic", "composite"] as const) {
      const g = orderMember(member(type, order), 4, 2, 0);
      expect(finite(g)).toBe(true);
      expect(symmetric(g, 2), `${type} ${order}`).toBe(true);
    }
  });
});

describe("bands", () => {
  it("dentils repeat along the cornice", () => {
    const W = 13;
    const small = (g: THREE.BufferGeometry) =>
      pieces(g).filter((b) => b.max.x - b.min.x < 0.3 && b.max.y - b.min.y < 0.2).length;
    const dentils = entablature(W, 1, "dentils", 8);
    expect(small(dentils)).toBeGreaterThanOrEqual(Math.floor(W / 0.4));
    expect(small(entablature(W, 1, "plain", 8))).toBe(0);
    // narrow bands: never below floor(W / 0.4) blocks, and a clean skip when too narrow for one
    for (const w of [0.6, 0.9, 1.3, 2.5]) expect(small(entablature(w, 1, "dentils", 0)), `w=${w}`).toBeGreaterThanOrEqual(Math.floor(w / 0.4));
    expect(small(entablature(0.3, 1, "dentils", 0))).toBe(0);
    expect(symmetric(dentils)).toBe(true);
    expect(box(dentils).min.y).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(box(dentils).max.y).toBeCloseTo(9, 2);
  });

  it("modillions are brackets under the corona", () => {
    const g = entablature(10, 1, "modillions", 0);
    expect(finite(g)).toBe(true);
    expect(pieces(g).filter((b) => b.max.x - b.min.x < 0.3).length).toBeGreaterThanOrEqual(10);
  });
});

describe("openings", () => {
  it("voussoirs: odd count with a keystone that stands out", () => {
    const v = voussoirs(0, 3, 1.3, 0.3);
    expect(v.length % 2).toBe(1);
    expect(v.length).toBeGreaterThanOrEqual(7);
    const mid = (v.length - 1) / 2;
    const zs = v.map((g) => box(g).max.z);
    zs.forEach((z, i) => i !== mid && expect(zs[mid]!).toBeGreaterThan(z));
    expect(box(v[mid]!).max.y).toBeGreaterThan(Math.max(...v.filter((_, i) => i !== mid).map((g) => box(g).max.y)));
  });

  it("an arch has a cut and a trim, voussoired or moulded", () => {
    const bay = { cx: 0, clear: 3.2 };
    const a = archOpening({ el: "arch", archivolt: "voussoirs", keystone: true }, bay, 6, 1);
    expect(a.cut.getPoints(8).length).toBeGreaterThan(4);
    expect(finite(a.trim)).toBe(true);
    expect(box(a.trim).min.y).toBeGreaterThan(1);
    const m = archOpening({ el: "arch", archivolt: "moulded" }, bay, 6, 1);
    expect(finite(m.trim)).toBe(true);
    expect(symmetric(a.trim) && symmetric(m.trim)).toBe(true);
  });

  it("a window with pediment is taller than its opening by the frame and the pediment", () => {
    const plain: Cell<"window"> = { el: "window", w: 1.2, h: 2.4, sill: 1 };
    const top = (c: Cell<"window">) => box(windowTrim(c, 0)).max.y;
    const frame = top(plain) - (plain.sill + plain.h);
    expect(frame).toBeGreaterThan(0.08);
    for (const shape of ["triangular", "segmental"] as const) {
      const rise = top({ ...plain, pediment: shape }) - top(plain);
      expect(rise, shape).toBeGreaterThan(0.2);
    }
    // the sill sits under the opening
    expect(box(windowTrim(plain, 0)).min.y).toBeLessThan(plain.sill);
  });

  it("window, portal, pediment and arch are symmetric about their axis", () => {
    const win: Cell<"window"> = { el: "window", w: 1.2, h: 2.4, sill: 1, pediment: "triangular", corbels: true };
    const por: Cell<"portal"> = { el: "portal", w: 1.6, h: 3, pediment: "segmental" };
    for (const cx of [0, 3]) {
      expect(symmetric(windowTrim(win, cx), cx), "window").toBe(true);
      expect(symmetric(windowTrim({ ...win, mullion: true, balustrade: true, corbels: false }, cx), cx), "window mullion").toBe(true);
      expect(symmetric(windowTrim({ ...win, top: "round", pediment: undefined }, cx), cx), "window round").toBe(true);
      expect(symmetric(portalTrim(por, cx), cx), "portal").toBe(true);
      expect(symmetric(portalTrim({ ...por, top: "round", pediment: "triangular" }, cx), cx), "portal round").toBe(true);
    }
    for (const shape of ["triangular", "segmental"] as const) expect(symmetric(pediment(shape, -3, 3, 5, 22)), shape).toBe(true);
    expect(symmetric(archOpening({ el: "arch" }, { cx: 0, clear: 3 }, 5).trim)).toBe(true);
    expect(symmetric(oculusTrim({ el: "oculus", r: 0.6, y: 2 }, 0))).toBe(true);
    expect(symmetric(nicheTrim({ el: "niche", w: 1, h: 2, sill: 0.5 }, 0))).toBe(true);
    expect(symmetric(panelTrim({ el: "panel", w: 1, h: 2, sill: 0.5 }, 0))).toBe(true);
  });
});

describe("crowns", () => {
  it("balusters fill the span between pedestals", () => {
    const posts = [0, 2, 5];
    const g = balustrade(0, 5, 10, 1, posts);
    const total = box(g).max.y - box(g).min.y;
    const balusters = pieces(g).filter((b) => b.max.x - b.min.x < 0.25 && b.max.y - b.min.y < 0.9 * total);
    expect(balusters.length).toBe(Math.floor(2 / 0.3) + Math.floor(3 / 0.3));
    // each baluster stands clear of the pedestals (0.36 wide) on both sides of its span
    for (const b of balusters) expect(posts.slice(1).some((p, i) => b.min.x >= posts[i]! + 0.18 - 1e-3 && b.max.x <= p - 0.18 + 1e-3)).toBe(true);
    expect(symmetric(balustrade(-4, 4, 0, 1, [-4, 0, 4]))).toBe(true);
  });

  it("a pediment rises with its pitch; an attic and a volute build", () => {
    const low = box(pediment("triangular", -3, 3, 0, 15)).max.y;
    const high = box(pediment("triangular", -3, 3, 0, 30)).max.y;
    expect(high).toBeGreaterThan(low + 0.5);
    expect(finite(attic(-4, 4, 10, 1.2))).toBe(true);
    // the scroll's outline winds round the eye for more than a full turn (here about 1.75 each way)
    for (const side of [-1, 1] as const) {
      const { centre, band } = voluteSpiral(side, 4 * side, 3, 1.5, 0.3);
      let turned = 0;
      for (let i = 1; i < band.length / 2; i++) {
        const a = Math.atan2(band[i - 1]!.y - centre.y, band[i - 1]!.x - centre.x);
        const b = Math.atan2(band[i]!.y - centre.y, band[i]!.x - centre.x);
        turned += Math.atan2(Math.sin(b - a), Math.cos(b - a));
      }
      expect(Math.abs(turned), "winding").toBeGreaterThan(2 * Math.PI);
      // radius shrinks towards the eye
      expect(Math.hypot(band[band.length / 2 - 1]!.x - centre.x, band[band.length / 2 - 1]!.y - centre.y)).toBeLessThan(0.1);
    }
    for (const side of [-1, 1] as const) {
      const v = volute(side, 4 * side, 3, 1.5, 2);
      expect(finite(v)).toBe(true);
      expect(box(v).min.y).toBeCloseTo(3, 1);
      expect(box(v).max.y).toBeGreaterThan(4.5);
    }
  });
});

/** Connected pieces merged into x-clusters: pieces whose x ranges are closer than `gap` belong to one group. */
function xGroups(boxes: THREE.Box3[], gap: number): THREE.Box3[] {
  const sorted = [...boxes].sort((a, b) => a.min.x - b.min.x);
  const out: THREE.Box3[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.min.x - last.max.x < gap) last.union(b);
    else out.push(b.clone());
  }
  return out;
}

/** z of the first hit of a ray along -z at (x, y), or undefined. */
function firstZ(g: THREE.BufferGeometry, x: number, y: number): number | undefined {
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1)).intersectObject(mesh)[0]?.point.z;
}

const hexastyle = (): FacadeFloor => ({
  id: "t0",
  height: 9,
  top: "entablature",
  cornice: "plain",
  members: { type: "column", order: "doric", width: 0.9 },
  colonnade: { depth: 3 },
  // five intercolumniations of 3 m between six column axes; the end bays are half a column wider
  bays: [3.45, 3, 3, 3, 3.45].map((width, i) => ({ id: `t${i}`, width, cell: { el: "wall" as const } })),
});

describe("temple front", () => {
  it("a doric hexastyle front has six free-standing columns in front of the wall", () => {
    const f = hexastyle();
    const g = colonnade(f, floorLayout(f), 0);
    const columns = xGroups(pieces(g), 0.05);
    expect(columns).toHaveLength(6);
    const axes = colonnadeAxes(f, floorLayout(f));
    expect(axes).toHaveLength(6);
    columns.forEach((c, i) => {
      expect((c.min.x + c.max.x) / 2, `axis ${i}`).toBeCloseTo(axes[i]!, 2);
      // the wall front is z = 0: the column stands clear of it and its abacus reaches about the colonnade depth
      expect(c.min.z, `column ${i} clear of the wall`).toBeGreaterThan(1.5);
      expect(c.max.z, `column ${i} reach`).toBeGreaterThan(3);
      expect(c.max.z).toBeLessThan(3.7);
      // the column carries the entablature: floor height minus its band (0.2 x 9)
      expect(c.max.y).toBeCloseTo(7.2, 1);
    });
    expect(symmetric(g)).toBe(true);
    expect(finite(g)).toBe(true);
  });

  it("triglyphs sit over every column axis and every intercolumniation", () => {
    const axes = colonnadeAxes(hexastyle(), floorLayout(hexastyle()));
    const g = triglyphFrieze(16, 0.72, 5, axes);
    // rule: one triglyph on each axis and one in the middle of each span between two axes (6 + 5)
    const want = axes.flatMap((a, i) => (i + 1 < axes.length ? [a, (a + axes[i + 1]!) / 2] : [a]));
    const found = xGroups(pieces(g), 0.15);
    expect(found).toHaveLength(want.length);
    found.forEach((b, i) => {
      expect((b.min.x + b.max.x) / 2, `triglyph ${i}`).toBeCloseTo(want[i]!, 2);
      expect(b.min.y).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(b.max.y).toBeLessThanOrEqual(5.72 + 1e-6);
    });
    // the metopes between them are wider than the triglyphs
    for (let i = 0; i + 1 < found.length; i++) expect(found[i + 1]!.min.x - found[i]!.max.x).toBeGreaterThan(found[i]!.max.x - found[i]!.min.x);
  });

  it("triglyphs never crash on narrow end members: the end ones are clamped inside the frieze", () => {
    const f: FacadeFloor = { id: "n", height: 6, top: "entablature", members: { type: "column", order: "doric", width: 0.2 }, colonnade: { depth: 2 }, bays: [{ id: "n0", width: 2, cell: { el: "wall" } }] };
    const axes = colonnadeAxes(f, floorLayout(f));
    const g = triglyphFrieze(2, 0.6, 3, axes);
    expect(finite(g)).toBe(true);
    expect(box(g).min.x).toBeGreaterThanOrEqual(-1 - 1e-6);
    expect(box(g).max.x).toBeLessThanOrEqual(1 + 1e-6);
    expect(() => buildModel(FacadeBuilding.parse({ id: "n", name: "N", style: "temple", floors: [f] }), new FacadeInk())).not.toThrow();
  });

  it("a gable rises with its pitch and is symmetric", () => {
    const low = box(gable(10, 4, 18)).max.y;
    const high = box(gable(10, 4, 30)).max.y;
    expect(high).toBeGreaterThan(low + 1);
    expect(low).toBeGreaterThanOrEqual(4 + 5 * Math.tan((18 * Math.PI) / 180) - 1e-6);
    expect(symmetric(gable(10, 4, 22))).toBe(true);
  });
});

describe("romanesque", () => {
  it("a gallery has one small arch per intercolumniation", () => {
    // Rule: `columns` colonnettes carry `columns - 1` arches, one between each pair; the two ends are
    // closed by the wall (no half arches), exactly as the wall openings in the model are cut.
    for (const columns of [2, 3, 5, 8]) {
      const cell: Cell<"gallery"> = { el: "gallery", columns, h: 1.6, sill: 1 };
      const g = gallery(cell, { cx: 2, clear: 4 }, 6);
      const parts = pieces(g);
      const pitch = (4 - 0.2) / (columns - 1);
      const colonnettes = parts.filter((b) => b.max.x - b.min.x < 0.2 && b.max.y - b.min.y > 0.3);
      const arches = parts.filter((b) => b.max.x - b.min.x > 0.3 && b.max.x - b.min.x < pitch);
      expect(colonnettes, `${columns} colonnettes`).toHaveLength(columns);
      expect(arches, `${columns} columns`).toHaveLength(columns - 1);
      expect(symmetric(g, 2)).toBe(true);
      expect(box(g).min.y).toBeGreaterThanOrEqual(0.9);
      expect(box(g).max.y).toBeLessThanOrEqual(2.7);
    }
  });

  it("a splayed portal steps back once per splay ring", () => {
    // Independent of the implementation: scan the jamb from the outer edge (x = w/2) inwards, collect the flat
    // faces the ray meets first (runs of equal z at least 8 cm wide: shafts and beads are curved), and expect
    // exactly `splay` of them, each deeper than the one before by the same step, all inside the 0.5 m wall.
    const cell = (splay: number): Cell<"portal"> => ({ el: "portal", w: 3.2, h: 4, top: "round", splay });
    for (const cx of [0, 5]) {
      for (const n of [1, 2, 3, 4]) {
        const { cut, trim } = splayedPortal(cell(n), cx);
        const b = new THREE.Box2().setFromPoints(cut.getPoints(24));
        expect(b.max.x - b.min.x).toBeCloseTo(3.2, 3);
        const faces: number[] = [];
        let run: { z: number; len: number } | undefined;
        for (let x = 1.59; x > 0.2; x -= 0.01) {
          const z = firstZ(trim, cx + x, 1);
          if (z !== undefined && run && Math.abs(z - run.z) < 1e-4) run.len++;
          else {
            if (run && run.len >= 8) faces.push(run.z);
            run = z === undefined ? undefined : { z, len: 1 };
          }
        }
        if (run && run.len >= 8) faces.push(run.z);
        expect(faces, `${n} rings`).toHaveLength(n);
        const drop = faces.slice(1).map((z, i) => faces[i]! - z);
        drop.forEach((d) => expect(d).toBeGreaterThan(0.05));
        drop.forEach((d) => expect(d).toBeCloseTo(drop[0]!, 3));
        expect(faces[0]!).toBeLessThan(0);
        expect(faces[n - 1]!).toBeGreaterThan(-0.5);
        // symmetric about the axis; the doorway stays open
        expect(firstZ(trim, cx - 1.5, 1)).toBeCloseTo(firstZ(trim, cx + 1.5, 1)!, 3);
        expect(firstZ(trim, cx, 1)).toBeUndefined();
      }
    }
  });

  it("aisle slopes meet the upper floor's sides", () => {
    const g = aisleSlopes(20, 10, 7, 22, 6);
    const b = box(g);
    const rise = 5 * Math.tan((22 * Math.PI) / 180);
    expect(b.min.x).toBeCloseTo(-10, 3);
    expect(b.max.x).toBeCloseTo(10, 3);
    expect(b.min.y).toBeCloseTo(7, 3);
    // the slope reaches the upper floor's wall at its full height and falls to the eaves at the outer edge
    expect(b.max.y).toBeCloseTo(7 + rise, 3);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const top = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 50, -1), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0]?.point.y;
    for (const s of [-1, 1]) {
      expect(top(s * 5.001)!).toBeCloseTo(7 + rise, 1);
      expect(top(s * 7.5)!).toBeCloseTo(7 + rise / 2, 2);
      expect(top(s * 9.999)!).toBeCloseTo(7, 1);
      // nothing inside the upper floor's width: no overlap
      expect(top(s * 4.9)).toBeUndefined();
    }
    expect(box(aisleSlopes(20, 10, 7, 30, 6)).max.y).toBeGreaterThan(b.max.y + 0.5);
  });
});

describe("dev scene temple and romanesque fronts", () => {
  const scene = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/public/scenes/_dev-facciata-2.scene.json", import.meta.url)), "utf8")) as { engineData: { buildings: Array<{ id: string }> } };
  const model = (id: string) => buildModel(FacadeBuilding.parse(scene.engineData.buildings.find((b) => b.id === id)), new FacadeInk());

  it("the temple front stands on a stylobate that reaches the columns, under a pediment", () => {
    const m = model("tempio");
    expect(m.front).toBeGreaterThan(3);
    const base = new THREE.Box3().setFromObject(m.parts.get("base")!);
    expect(base.max.z).toBeGreaterThan(m.front);
    const crown = new THREE.Box3().setFromObject(m.parts.get("crown")!);
    expect(crown.max.z).toBeGreaterThan(3);
    expect(crown.max.y).toBeGreaterThan(m.size.height - 0.5);
  });

  it("the Romanesque front has aisle slopes, a gallery and a gable inside its size", () => {
    const m = model("romanico");
    const all = new THREE.Box3().setFromObject(m.group);
    expect(all.max.y).toBeLessThan(m.size.height + 0.6);
    expect(all.max.y).toBeGreaterThan(m.size.height - 0.6);
    const upper = new THREE.Box3().setFromObject(m.parts.get("r1")!);
    // the aisle slopes belong to the upper register: it is as wide as the lower one
    expect(upper.max.x - upper.min.x).toBeGreaterThan(m.layout.floors[0]!.x1 * 2 - 1);
  });
});

describe("temple and Romanesque fronts as a section sees them", () => {
  const scene = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/public/scenes/_dev-facciata-2.scene.json", import.meta.url)), "utf8")) as { engineData: { buildings: Array<{ id: string }> } };
  const model = (id: string) => buildModel(FacadeBuilding.parse(scene.engineData.buildings.find((b) => b.id === id)), new FacadeInk());
  const left = new THREE.Vector3(-1, 0, 0);
  /** Hits of a ray over the paper meshes: `back` is true for a face turned away (poché); `distance` along the ray. */
  const hitsAlong = (m: ReturnType<typeof model>, from: THREE.Vector3, dir: THREE.Vector3) => {
    m.group.updateMatrixWorld(true);
    return new THREE.Raycaster(from, dir)
      .intersectObject(m.group, true)
      .filter((h) => h.object instanceof THREE.Mesh && "uPoche" in ((h.object.material as THREE.ShaderMaterial).uniforms ?? {}))
      .map((h) => ({ back: h.face!.normal.dot(dir) > 0, x: h.point.x, distance: h.distance }));
  };
  const hits = (m: ReturnType<typeof model>, x: number, y: number, z: number) => hitsAlong(m, new THREE.Vector3(x, y, z), left);
  /** Poché and nothing else: the first hit is a back face and no front face lies at the same distance (a coplanar pair would z-fight). */
  const pocheOnly = (what: string, h: Array<{ back: boolean; distance: number }>) => {
    expect(h.length, what).toBeGreaterThan(0);
    expect(h[0]!.back, what).toBe(true);
    expect(h.filter((x) => !x.back && Math.abs(x.distance - h[0]!.distance) < 1e-4), `${what}: coplanar front face`).toHaveLength(0);
  };

  it("a cut through the temple's colonnade, cella, stylobate, entablature and pediment is poché; open space is paper", () => {
    const m = model("tempio");
    const f = m.layout.floors[0]!;
    const front = f.front;
    const poche: Array<[string, number, number]> = [
      ["entablature, behind the frieze", f.y1 - f.band / 2, front / 2],
      ["entablature, in the moulding", f.y1 - 0.1, front],
      ["cella wall above the door", f.y0 + 6, -0.25],
      ["stylobate", 0.6, 1],
      ["lowest step", 0.1, front + 0.5 + 0.2],
      ["tympanum", m.layout.top + 1, 1],
      ["roof behind the pediment", m.layout.top + 1, -5],
      ["back wall", f.y0 + 3, -m.size.depth + 0.2],
    ];
    for (const [what, y, z] of poche) {
      pocheOnly(what, hits(m, 0, y, z));
    }
    // every step at its mid-height, just inside its outer edge, and the entablature band at several heights
    const steps = 3;
    for (let j = 1; j <= steps; j++) pocheOnly(`step ${j}`, hits(m, 0, (1.2 * (j - 0.5)) / (steps + 1), front + 0.5 + 0.4 * (steps + 1 - j) - 0.1));
    for (const k of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const z of [-0.3, 0.5, front / 2]) pocheOnly(`entablature ${k} at z ${z}`, hits(m, 0, f.y1 - f.band * k, z));
    // oblique rays, as the camera of the section sees them, through the steps and the entablature band
    const oblique = new THREE.Vector3(-1, -0.3, -0.2).normalize();
    pocheOnly("oblique through the steps", hitsAlong(m, new THREE.Vector3(-6, 0.5, front + 0.5 + 0.7), oblique));
    pocheOnly("oblique through the entablature", hitsAlong(m, new THREE.Vector3(-6, f.y1 - 0.4, front / 2), oblique));
    pocheOnly("oblique through the entablature, in the wall's thickness", hitsAlong(m, new THREE.Vector3(-6, f.y1 - 0.4, -0.1), oblique));
    // the door of the cella is open: the first thing the ray meets is the jamb, a front face
    expect(hits(m, 0, f.y0 + 2, -0.25)[0]!.back).toBe(false);
    // a ray at the depth of the column axes meets the nearest shaft (axis x = -1.5, radius about 0.45) from outside
    const column = hits(m, 0, f.y0 + 3, 3);
    expect(column[0]!.back).toBe(false);
    expect(column[0]!.x).toBeCloseTo(-1.5 + 0.45, 1);
  });

  it("solids behind the colonnade's entablature neither overlap nor share a cut band: a ray along -z alternates front and back faces", () => {
    const m = model("tempio");
    const f = m.layout.floors[0]!;
    m.group.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, 0, -1);
    for (const y of [f.y1 - 0.9, f.y1 - 0.1, f.y1 - f.band + 0.2, f.y0 + 6]) {
      const raw = new THREE.Raycaster(new THREE.Vector3(3.3, y, 50), down)
        .intersectObject(m.group, true)
        .filter((h) => h.object instanceof THREE.Mesh && "uPoche" in ((h.object.material as THREE.ShaderMaterial).uniforms ?? {}))
        .map((h) => ({ z: Math.round(h.point.z * 1e4), back: h.face!.normal.dot(down) > 0 }));
      // faces that meet at one z (a front and a back) are a shared boundary, not a crossing
      const crossings = [...new Set(raw.map((h) => h.z))].sort((a, b) => b - a).flatMap((z) => {
        const at = raw.filter((h) => h.z === z);
        return at.some((h) => h.back) && at.some((h) => !h.back) ? [] : [at[0]!.back];
      });
      crossings.forEach((back, i) => expect(back, `y ${y}, crossing ${i}`).toBe(i % 2 === 1));
      expect(crossings.length % 2, `y ${y}`).toBe(0);
    }
  });

  it("a cut through a Romanesque bay shows wall, slope and gable as poché; the round window is open", () => {
    const m = model("romanico");
    const [r0, r1] = m.layout.floors;
    // r0b is a blind arch, r1a a gallery: x = -4.4 is the middle of both
    const x = -4.4;
    const poche: Array<[string, number, number]> = [
      ["blind arch, in the wall", r0!.y0 + 3, -0.25],
      ["upper wall under the gallery", r1!.y0 + 1, -0.25],
      ["gable roof", m.layout.top + 0.4, -3],
      ["aisle slope", r1!.y0 + 0.3, -3],
      ["base", 0.3, -3],
    ];
    for (const [what, y, z] of poche) {
      pocheOnly(what, hits(m, what === "aisle slope" ? -8 : x, y, z));
    }
    // the stylobate's steps, each at its mid-height
    for (let j = 1; j <= 2; j++) pocheOnly(`step ${j}`, hits(m, x, (0.8 * (j - 0.5)) / 3, m.layout.front + 0.15 + 0.4 * (3 - j) - 0.1));
    // the round window (x = 0) is a hole through the wall: the ray meets its jamb, a front face
    const win = hits(m, 0, r1!.y0 + 2.2, -0.25);
    expect(win[0]!.back).toBe(false);
  });
});
