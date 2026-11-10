// Grammar -> building. `facadeLayout` is the pure arithmetic (where every floor, bay and member
// stands); `buildModel` turns it into a group of merged, inked geometry in building-local metres:
// x along the façade (0 on the axis), y up from the ground, the wall face at z = 0, the body at z < 0.
import * as THREE from "three";
import { bodyDepth, buildingSize, floorLayout, type FacadeBuilding, type FacadeCell, type FacadeFloor } from "@pv/scene-spec";
import {
  bandHeight,
  base,
  bodyFloor,
  floorSlab,
  gable,
  groundSlab,
  lightOpening,
  openingPath,
  Part,
  portico,
  rectOpening,
  roundOpening,
  rusticBlocks,
  wallWithHoles,
  WALL,
  type MemberSite,
  type Opening,
} from "./catalogue/basic.ts";
import { entablature, friezeBand, stringCourse } from "./catalogue/bands.ts";
import { attic, balustrade, gable as gableCoping, pediment, volute } from "./catalogue/crown.ts";
import { archOpening, archRadius, archSpring, nicheTrim, oculusTrim, panelTrim, portalTrim, windowTrim } from "./catalogue/openings.ts";
import { memberSet } from "./catalogue/orders.ts";
import { aisleSlopes, gallery, galleryLayout, splayedPortal } from "./catalogue/romanesque.ts";
import { domeShell, nicheLayout, rotundaFrame, rotundaWall } from "./catalogue/rotunda.ts";
import { colonnade, DORIC_FRIEZE, stylobate, triglyphFrieze } from "./catalogue/temple.ts";
import type { FacadeInk } from "./ink.ts";

/** How far a floor's wall slab reaches below its floor level (hidden by the plinth or the band below). */
export const SINK = 0.05;

export interface FacadeModel {
  /** Building-local metres; `userData.inkSelf` so the app's ink styler leaves it alone. */
  group: THREE.Group;
  /** building id, floor ids, bay ids, "<floorId>.members", "crown", "base" (plinth + shell), "body" (empty, its solids are in "base"), "rotunda" and "dome" (when the building has them). */
  parts: Map<string, THREE.Group>;
  size: { width: number; height: number; depth: number };
  /** Max z of the front, including avant-corps and free-standing columns. */
  front: number;
  /** Where everything stands (floor ranges, bay boxes, member sites): what the bay parts' outlines come from. */
  layout: FacadeLayout;
}

export interface BayBox {
  id: string;
  x0: number;
  x1: number;
  cx: number;
  forward: number;
  /** Width between the members on both sides. */
  clear: number;
  cell: FacadeCell;
}

export interface FloorBox {
  floor: FacadeFloor;
  id: string;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  /** Max z of this floor's front (avant-corps, free-standing columns). */
  front: number;
  /** Height of the string course or entablature at the top of the floor. */
  band: number;
  /** Springing height (absolute) of the arches of this floor, and of its portico vault. */
  spring: number;
  bays: BayBox[];
  sites: MemberSite[];
}

export interface FacadeLayout {
  baseHeight: number;
  floors: FloorBox[];
  /** Top of the last floor (the crown stands on it). */
  top: number;
  /** Depth includes the rotunda. */
  size: { width: number; height: number; depth: number };
  /** Depth of the body behind the façade, the rotunda not included. */
  bodyDepth: number;
  front: number;
  /** Axis, wall top, springing and crown of the rotunda, if there is one. */
  rotunda?: ReturnType<typeof rotundaFrame>;
}

/** Where a cell's centre is above the floor, for anchors. */
export function cellCentre(cell: FacadeCell, floorHeight: number): number {
  if (cell.el === "portal") return cell.h / 2;
  if (cell.el === "window" || cell.el === "niche" || cell.el === "panel" || cell.el === "gallery") return cell.sill + cell.h / 2;
  if (cell.el === "oculus") return cell.y;
  return floorHeight / 2;
}

export function facadeLayout(b: FacadeBuilding): FacadeLayout {
  const { width, height } = buildingSize(b);
  const baseHeight = b.base?.height ?? 0;
  let y = baseHeight;
  let front = 0;
  const floors = b.floors.map((floor): FloorBox => {
    const lay = floorLayout(floor);
    const x0 = -lay.width / 2;
    const x1 = lay.width / 2;
    const m = floor.members;
    const used = m ? m.width * (m.paired ? 2 : 1) : 0;
    const bays = floor.bays.map((bay, i): BayBox => {
      const l = lay.bays[i]!;
      return { id: bay.id, x0: l.x0, x1: l.x1, cx: l.cx, forward: l.forward, clear: bay.width - used, cell: bay.cell };
    });
    const sites: MemberSite[] = [];
    if (m) {
      const end = m.paired || (m.type === "column" && floor.colonnade) ? m.width : m.width / 2;
      sites.push({ x: x0 + end / 2, w: end, pair: false });
      for (let i = 1; i < bays.length; i++) sites.push({ x: bays[i]!.x0, w: m.width, pair: !!m.paired });
      sites.push({ x: x1 - end / 2, w: end, pair: false });
    }
    const colonnadeFront = floor.colonnade && m ? floor.colonnade.depth + m.width / 2 : 0;
    const floorFront = Math.max(colonnadeFront, ...bays.map((x) => x.forward));
    front = Math.max(front, floorFront);
    const y0 = y;
    y += floor.height;
    const arch = bays.find((x) => x.cell.el === "arch");
    const springRel = arch && arch.cell.el === "arch" ? archSpring(arch.cell.spring, arch.clear, floor.height) : 0.55 * floor.height;
    return { floor, id: floor.id, y0, y1: y, x0, x1, front: floorFront, band: bandHeight(floor.top, floor.height, !!m && m.type !== "pier"), spring: y0 + springRel, bays, sites };
  });
  const body = bodyDepth(b);
  return { baseHeight, floors, top: y, size: { width, height, depth: buildingSize(b).depth }, bodyDepth: body, front, ...(b.rotunda ? { rotunda: rotundaFrame(b.rotunda, body) } : {}) };
}

/** Highest point of a hole. */
function holeTop(o: Opening): number {
  return o.kind === "rect" ? o.y1 : o.kind === "round" ? o.spring + o.r : o.cy + o.r;
}

/** The holes a bay's cell cuts through the wall. */
function openingsOf(f: FloorBox, bay: BayBox): Opening[] {
  const c = bay.cell;
  const { y0 } = f;
  switch (c.el) {
    case "arch":
      return c.open === false ? [] : [roundOpening(bay.cx, archRadius(bay.clear, f.floor.height), y0, y0 + archSpring(c.spring, bay.clear, f.floor.height))];
    case "portal":
      return [lightOpening(bay.cx, c.w, y0, y0 + c.h, c.top === "round")];
    case "window": {
      if (!c.mullion) return [lightOpening(bay.cx, c.w, y0 + c.sill, y0 + c.sill + c.h, c.top === "round")];
      const post = 0.12;
      const w = (c.w - post) / 2;
      return [-1, 1].map((s) => lightOpening(bay.cx + (s * (w + post)) / 2, w, y0 + c.sill, y0 + c.sill + c.h, c.top === "round"));
    }
    case "niche":
      return [rectOpening(bay.cx - c.w / 2, bay.cx + c.w / 2, y0 + c.sill, y0 + c.sill + c.h)];
    case "oculus":
      return [{ kind: "circle", cx: bay.cx, cy: y0 + c.y, r: c.r }];
    case "gallery": {
      const { total, pitch, w } = galleryLayout(c.columns, bay.clear);
      if (w < 0.1) return [];
      return [...Array(c.columns - 1)].map((_, i) => lightOpening(bay.cx - total / 2 + pitch * (i + 0.5), w, y0 + c.sill, y0 + c.sill + c.h, true));
    }
    default:
      return [];
  }
}

export function buildModel(b: FacadeBuilding, ink: FacadeInk): FacadeModel {
  const L = facadeLayout(b);
  const group = new THREE.Group();
  group.name = b.id;
  group.userData.inkSelf = true;
  const parts = new Map<string, THREE.Group>([[b.id, group]]);
  const part = (id: string): THREE.Group => {
    const g = new THREE.Group();
    g.name = id;
    group.add(g);
    parts.set(id, g);
    return g;
  };
  const { width } = L.size;
  const depth = L.bodyDepth;

  // base (plinth and steps) and body (the closed block behind the façade) share one merged part:
  // the draw-call budget leaves no room for a third object set, and neither is ever drawn alone.
  const baseG = part("base");
  const shell = new Part();
  const first = L.floors[0]!;
  if (L.baseHeight > 0) {
    // a temple's stylobate reaches under the columns, whatever stands in front of the wall
    if (first.floor.colonnade) stylobate(shell, width, depth, L.baseHeight, b.base?.steps ?? 0, first.front + 0.5);
    else base(shell, width, depth, L.baseHeight, b.base?.steps ?? 0);
  }

  for (const f of L.floors) {
    const fl = f.floor;
    const holes = f.bays.flatMap((bay) => openingsOf(f, bay));
    const colonnadeZ = fl.colonnade?.depth;
    // how far the entablature stands out: over a colonnade it rests on the columns
    const bandFront = colonnadeZ !== undefined && fl.members ? colonnadeZ + fl.members.width / 2 : 0;
    const doric = fl.members?.order === "doric" && fl.top === "entablature";
    const doricFrieze = fl.cornice === undefined || fl.cornice === "plain" ? DORIC_FRIEZE : 0.28;

    // floor: the wall with its holes, rustication, string course or entablature, portico
    const p = new Part();
    // The slab starts a little below the floor so no opening touches its outline (earcut makes slivers there).
    // under the entablature of a colonnade the wall stops: the entablature is one solid that takes its place in the band
    const solidBand = bandFront > 0 && fl.top === "entablature" && holes.every((h) => holeTop(h) <= f.y1 - f.band - 0.05);
    wallWithHoles(p, f.x0, f.x1, f.y0 - SINK, solidBand ? f.y1 - f.band : f.y1, holes, -WALL, 0);
    if (fl.wall === "rusticated") rusticBlocks(p, f.x0, f.x1, f.y0, f.y1 - f.band, fl.course ?? 0.5, holes, 0.08);
    const lw = f.x1 - f.x0;
    if (fl.top === "string-course") p.add(stringCourse(lw, f.band, f.y1 - f.band));
    else if (fl.top === "entablature") {
      p.add(entablature(lw, f.band, fl.cornice ?? "plain", f.y1 - f.band, bandFront, { ...(doric ? { frieze: doricFrieze } : {}), ...(solidBand ? { into: WALL } : {}) }));
      if (doric) {
        // triglyphs over every member axis and between them (metopes blank)
        const fb = friezeBand(f.band, f.y1 - f.band, doricFrieze);
        const axes = f.sites.flatMap((site) => (site.pair ? [site.x - site.w / 2, site.x + site.w / 2] : [site.x]));
        p.add(triglyphFrieze(lw, fb.y1 - fb.y0, fb.y0, axes).translate(0, 0, bandFront + fb.out));
      }
    }
    const lower = L.floors[L.floors.indexOf(f) - 1];
    if (fl.shoulders === "volutes" && lower && lower.x1 - f.x1 > 0.3) {
      const out = lower.x1 - f.x1;
      for (const side of [-1, 1] as const) p.add(volute(side, side * f.x1, f.y0, out, Math.min(1.6 * out, 0.7 * fl.height)));
    }
    if (fl.shoulders === "slopes" && lower && lower.x1 - f.x1 > 0.3) {
      // aisle roofs at the pitch of the nave's, kept under the top of this floor
      const out = lower.x1 - f.x1;
      const pitch = Math.min(b.crown?.pitch ?? 22, (Math.atan((0.9 * fl.height) / out) * 180) / Math.PI);
      p.add(aisleSlopes(lower.x1 - lower.x0, f.x1 - f.x0, f.y0, pitch, depth, 0.002));
    }
    if (fl.portico) portico(p, f.x0, f.x1, f.y0, f.y1, f.spring, fl.portico.depth, fl.portico.vault ?? "barrel");
    p.flush(part(f.id), ink, f.id);

    // members
    const mg = part(`${f.id}.members`);
    const m = fl.members;
    if (m) {
      const mp = new Part();
      if (colonnadeZ !== undefined) mp.add(colonnade(fl, floorLayout(fl), f.y0));
      else for (const site of f.sites) memberSet(mp, m, site, f.y0, f.y1 - f.band, { course: fl.course ?? 0.5 });
      mp.flush(mg, ink, `${f.id}.members`);
    }

    // bays: only what is not just a hole in the floor's wall
    for (const bay of f.bays) {
      const bp = new Part();
      const c = bay.cell;
      if (bay.forward > 0) {
        const s = new THREE.Shape();
        s.moveTo(bay.x0, f.y0 - SINK).lineTo(bay.x1, f.y0 - SINK).lineTo(bay.x1, f.y1).lineTo(bay.x0, f.y1).lineTo(bay.x0, f.y0 - SINK);
        for (const h of openingsOf(f, bay)) s.holes.push(openingPath(h));
        bp.slab(s, 0, bay.forward);
      }
      // trim stands on the bay's front face (avant-corps move it out)
      const trim = (g: THREE.BufferGeometry, dy = f.y0): void => bp.add(g.translate(0, dy, bay.forward));
      if (c.el === "arch") {
        trim(archOpening(c, bay, fl.height, 0).trim, f.y0);
      } else if (c.el === "window") {
        trim(windowTrim(c, bay.cx));
      } else if (c.el === "portal") {
        // a splayed portal's rings fill the hole through the wall: they stay on the wall, not on an avant-corps front
        if (c.splay) bp.add(splayedPortal(c, bay.cx).trim.translate(0, f.y0, 0));
        else trim(portalTrim(c, bay.cx));
      } else if (c.el === "gallery") {
        trim(gallery(c, bay, fl.height));
      } else if (c.el === "oculus") {
        trim(oculusTrim(c, bay.cx));
      } else if (c.el === "niche") {
        bp.box(bay.cx - c.w / 2 - 0.05, bay.cx + c.w / 2 + 0.05, f.y0 + c.sill - 0.05, f.y0 + c.sill + c.h + 0.05, -0.36, -0.3);
        trim(nicheTrim(c, bay.cx));
      } else if (c.el === "panel") {
        trim(panelTrim(c, bay.cx));
        const s = new THREE.Shape();
        s.moveTo(bay.cx - c.w / 2, f.y0 + c.sill).lineTo(bay.cx + c.w / 2, f.y0 + c.sill).lineTo(bay.cx + c.w / 2, f.y0 + c.sill + c.h).lineTo(bay.cx - c.w / 2, f.y0 + c.sill + c.h);
        s.closePath();
        bp.slab(s, 0, 0.05, 0.01);
      }
      const bg = part(bay.id);
      bp.flush(bg, ink, bay.id);
      bg.add(bayOutline(f, bay, openingsOf(f, bay), ink));
    }
  }

  // crown
  const crownG = part("crown");
  const crown = b.crown;
  if (crown) {
    const top = L.floors[L.floors.length - 1]!;
    const range = crown.bays && crownRange(top, crown.bays);
    const x0 = range ? range[0] : top.x0;
    const x1 = range ? range[1] : top.x1;
    const rise = ((x1 - x0) / 2) * Math.tan(((crown.pitch ?? 22) * Math.PI) / 180);
    const p = new Part();
    if (crown.type === "pediment") {
      p.add(pediment(crown.shape ?? "triangular", x0, x1, L.top, crown.pitch ?? 22, top.floor.colonnade && top.floor.members ? top.floor.colonnade.depth + top.floor.members.width / 2 : 0));
      // the roof of a temple runs back behind its pediment (the tympanum is the front of it)
      if (b.style === "temple" && (crown.shape ?? "triangular") === "triangular") gable(p, x0, x1, L.top, rise, depth, -0.1);
    } else if (crown.type === "gable") {
      gable(p, x0, x1, L.top, rise, depth);
      p.add(gableCoping(x1 - x0, L.top, crown.pitch ?? 22).translate((x0 + x1) / 2, 0, 0));
    }
    else if (crown.type === "attic") {
      if ((crown.height ?? 0) > 0.2) p.add(attic(x0, x1, L.top, crown.height!));
    } else if ((crown.height ?? 0) > 0.2) {
      // a pedestal about every 2.6 m, the end ones just inside the corners
      const n = Math.max(1, Math.round((x1 - x0) / 2.6));
      p.add(balustrade(x0, x1, L.top, crown.height!, [...Array(n + 1)].map((_, i) => x0 + 0.2 + ((x1 - x0 - 0.4) * i) / n)));
    }
    p.flush(crownG, ink, "crown");
  }

  // rotunda and dome: two merged solids of their own, behind the body
  const rot = b.rotunda;
  if (rot && L.rotunda) {
    const wall = new Part();
    wall.add(rotundaWall(rot, L.rotunda.zc));
    wall.flush(part("rotunda"), ink, "rotunda");
    const dome = new Part();
    dome.add(domeShell(rot, L.rotunda.zc));
    dome.flush(part("dome"), ink, "dome");
  }

  // body: side and back walls, flat roof and a ground slab (into the shared base part); with a rotunda the back wall
  // of the ground floor is open where the rotunda's entrance faces it
  part("body");
  {
    groundSlab(shell, first.x0, first.x1, depth);
    for (const f of L.floors) {
      bodyFloor(shell, f.x0, f.x1, f.y0, f.y1, depth, f === first && rot ? { half: nicheLayout(rot)[0]!.half, height: Math.min(0.7 * (f.y1 - f.y0), 0.55 * rot.height) } : undefined);
      floorSlab(shell, f.x0, f.x1, f.y1, depth);
    }
    shell.flush(baseG, ink, "base");
  }

  return { group, parts, size: L.size, front: L.front, layout: L };
}

function crownRange(top: FloorBox, ids: [string, string]): [number, number] | undefined {
  const a = top.bays.find((x) => x.id === ids[0]);
  const z = top.bays.find((x) => x.id === ids[1]);
  return a && z ? [Math.min(a.x0, z.x0), Math.max(a.x1, z.x1)] : undefined;
}

/**
 * The bay's own front outline, so every bay part draws something: the contour of each opening of its
 * cell, or (no opening) the rectangle between the members. Lives on the front face of the bay.
 */
function bayOutline(f: FloorBox, bay: BayBox, holes: Opening[], ink: FacadeInk): THREE.LineSegments {
  const z = bay.forward + 0.003;
  const blind = bay.cell.el === "arch" && bay.cell.open === false;
  const loops: THREE.Vector2[][] = holes.length
    ? holes.map((h) => openingPath(h).getPoints(24))
    : blind
      ? [openingPath(roundOpening(bay.cx, archRadius(bay.clear, f.floor.height), f.y0, f.y0 + archSpring((bay.cell as { spring?: number }).spring, bay.clear, f.floor.height))).getPoints(24)]
      : [[new THREE.Vector2(bay.cx - bay.clear / 2, f.y0), new THREE.Vector2(bay.cx + bay.clear / 2, f.y0), new THREE.Vector2(bay.cx + bay.clear / 2, f.y1 - f.band), new THREE.Vector2(bay.cx - bay.clear / 2, f.y1 - f.band)]];
  const pos: number[] = [];
  for (const pts of loops) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if (a.distanceTo(b) < 1e-9) continue;
      pos.push(a.x, a.y, z, b.x, b.y, z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.name = `${bay.id}.outline`;
  const lines = new THREE.LineSegments(g, ink.lines);
  lines.name = g.name;
  return lines;
}
