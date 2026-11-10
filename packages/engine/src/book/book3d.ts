// Procedural open book on a desk (decision D12). Cheap on phones: a handful of meshes, unlit
// materials with baked shading, canvas textures for the printed pages.
import * as THREE from "three";
import { clamp, rng } from "../util/math.ts";
import { INK_HEX } from "./ink.ts";
import { pageY, type BookLayout } from "./layout.ts";
import { drawBlankPage, drawTextPage, PALETTES, type BookStyle, type PageText, type Palette } from "./page.ts";
import { sheetProfile } from "./popup.ts";

const SEGMENTS = 28;

interface StyleColors {
  cover: number;
  coverEdge: number;
  desk: string;
  deskEdge: string;
  edges: number;
}

const STYLE: Record<BookStyle, StyleColors> = {
  color: { cover: 0x6e2a1d, coverEdge: 0x4a1a12, desk: "#c19a72", deskEdge: "#7b5b40", edges: 0xeee4cf },
  ink: { cover: 0xf4f4f2, coverEdge: 0x1a1a1a, desk: "#e7e8ea", deskEdge: "#c3c7cc", edges: 0xffffff },
};

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

/** Curved page surface: x from the spine (u = 0) outwards along `dir` (+1 right page, -1 left page). */
function pageGeometry(L: BookLayout, dir: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, SEGMENTS, 1);
  g.rotateX(-Math.PI / 2); // lie in xz, normal up; uv.v = 1 at z = -0.5 (far edge)
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) + 0.5; // 0..1 left to right
    const u = dir === 1 ? t : 1 - t; // distance from the spine
    pos.setXYZ(i, dir * u * L.pageW, pageY(u, L), pos.getZ(i) * L.pageD);
    uv.setX(i, t);
    // Baked shading: darker where the paper turns down into the gutter.
    const shade = 1 - 0.22 * (1 - clamp(u / (L.curl * 1.3))) ** 2;
    colors.push(shade, shade, shade);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Side walls of the page block (paper edges) following the page profile, both pages. */
function blockGeometry(L: BookLayout): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const bottom = -L.stackH;
  const quad = (a: number[], b: number[], c: number[], d: number[], v0: number, v1: number) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(0, v0, 0, v1, 1, v1, 0, v0, 1, v1, 1, v0);
  };
  for (const dir of [1, -1] as const) {
    for (const z of [L.pageD / 2, -L.pageD / 2]) {
      for (let i = 0; i < SEGMENTS; i++) {
        const u0 = i / SEGMENTS;
        const u1 = (i + 1) / SEGMENTS;
        const x0 = dir * u0 * L.pageW;
        const x1 = dir * u1 * L.pageW;
        const y0 = pageY(u0, L);
        const y1 = pageY(u1, L);
        quad([x0, bottom, z], [x0, y0, z], [x1, y1, z], [x1, bottom, z], 0, 1);
      }
    }
    const x = dir * L.pageW;
    const y = pageY(1, L);
    quad([x, bottom, -L.pageD / 2], [x, y, -L.pageD / 2], [x, y, L.pageD / 2], [x, bottom, L.pageD / 2], 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function canvasTexture(canvas: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

export interface BookFrame {
  /** Page-turn angle, radians (0 = on the right page, PI = landed on the left). */
  turn: number;
  /** Contact shadow under the content, 0..1. */
  shadow: number;
}

export class Book3D {
  readonly group = new THREE.Group();
  /** Room colour behind the desk (the player draws it as the scene background in book mode). */
  readonly background = new THREE.Color();

  private style: BookStyle = "color";
  private texW: number;
  private texH: number;
  private leftTex: THREE.CanvasTexture | null = null;
  private nextLeftTex: THREE.CanvasTexture | null = null;
  private rightTex: THREE.CanvasTexture | null = null;
  private sheetBackTex: THREE.Texture | null = null;
  private deskTex: THREE.CanvasTexture | null = null;
  private edgeTex: THREE.CanvasTexture | null = null;
  private shadowTex: THREE.CanvasTexture | null = null;

  private pageL: THREE.Mesh;
  private pageR: THREE.Mesh;
  private sheetFront: THREE.Mesh;
  private sheetBack: THREE.Mesh;
  private sheetGeo: THREE.BufferGeometry;
  private block: THREE.Mesh;
  private covers: THREE.Mesh[] = [];
  private desk: THREE.Mesh;
  private shadow: THREE.Mesh;
  private inkLines: THREE.LineSegments;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private left: PageText | null = null;
  private right: PageText | null = null;
  private rightFolio = "2";
  private turnDir: 1 | -1 = 1;
  private theme: { desk: string; deskEdge: string; cover: number; paper: string; accent: string } | null = null;

  constructor(
    readonly layout: BookLayout,
    private canvas: CanvasFactory | undefined,
    private anisotropy = 4,
    textureWidth = 1024,
  ) {
    const L = layout;
    this.texW = textureWidth;
    this.texH = Math.round(textureWidth * (L.pageD / L.pageW));
    this.group.position.copy(L.origin);

    const basic = (opts: THREE.MeshBasicMaterialParameters) => this.track(new THREE.MeshBasicMaterial({ fog: false, ...opts }));
    const geo = <G extends THREE.BufferGeometry>(g: G) => {
      this.geos.push(g);
      return g;
    };

    // Pages.
    this.pageL = new THREE.Mesh(geo(pageGeometry(L, -1)), basic({ vertexColors: true, color: 0xffffff }));
    this.pageR = new THREE.Mesh(geo(pageGeometry(L, 1)), basic({ vertexColors: true, color: 0xffffff }));
    this.block = new THREE.Mesh(geo(blockGeometry(L)), basic({ color: 0xffffff, side: THREE.DoubleSide }));

    // Covers: two boards and a rounded spine under the gutter.
    const coverY = -L.stackH - L.coverT / 2;
    const boardW = L.pageW + L.coverMargin;
    const boardD = L.pageD + 2 * L.coverMargin;
    const coverMat = basic({ color: STYLE.color.cover });
    for (const dir of [1, -1]) {
      const m = new THREE.Mesh(geo(new THREE.BoxGeometry(boardW, L.coverT, boardD)), coverMat);
      m.position.set((dir * boardW) / 2, coverY, 0);
      this.covers.push(m);
    }
    const spineR = L.stackH * 0.9;
    const spine = new THREE.Mesh(geo(new THREE.CylinderGeometry(spineR, spineR, boardD, 16, 1, true, Math.PI / 2, Math.PI)), coverMat);
    spine.rotation.x = -Math.PI / 2;
    spine.position.set(0, -L.stackH - L.coverT * 0.4, 0);
    this.covers.push(spine);

    // Turning sheet: same shape as a page, rebuilt each frame from sheetProfile().
    this.sheetGeo = geo(new THREE.PlaneGeometry(1, 1, SEGMENTS, 1));
    this.sheetGeo.rotateX(-Math.PI / 2);
    this.sheetFront = new THREE.Mesh(this.sheetGeo, basic({ side: THREE.FrontSide }));
    this.sheetBack = new THREE.Mesh(this.sheetGeo, basic({ side: THREE.BackSide }));
    this.sheetFront.visible = this.sheetBack.visible = false;
    this.sheetFront.renderOrder = this.sheetBack.renderOrder = 1;

    // Desk: large plane with wood grain fading into the room colour.
    const deskSize = Math.max(L.halfWidth, L.halfDepth) * 24;
    this.desk = new THREE.Mesh(geo(new THREE.PlaneGeometry(deskSize, deskSize)), basic({ color: 0xffffff }));
    this.desk.rotation.x = -Math.PI / 2;
    this.desk.position.y = -L.stackH - L.coverT - L.pageW * 0.002;

    // Contact shadow under the pop-up content.
    const fp = L.footprint;
    this.shadow = new THREE.Mesh(
      geo(new THREE.PlaneGeometry(fp.halfX * 2.5, fp.halfZ * 2.5)),
      basic({ color: 0x000000, transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(L.contentX, L.pageW * 0.002, fp.center.z - L.origin.z);
    this.shadow.renderOrder = 1;

    // Ink outlines of the book itself (china style only).
    const outline = new THREE.BufferGeometry().setFromPoints(this.outlinePoints());
    this.inkLines = new THREE.LineSegments(geo(outline), this.track(new THREE.LineBasicMaterial({ color: INK_HEX, fog: false })));
    this.inkLines.visible = false;

    this.group.add(this.desk, ...this.covers, this.block, this.pageL, this.pageR, this.shadow, this.sheetFront, this.sheetBack, this.inkLines);
    this.group.traverse((o) => (o.userData.book = true));
    this.setStyle("color");
  }

  /** Book units per page width (used by the player for outline widths and the like). */
  get size(): number {
    return this.layout.pageW;
  }

  /** The desk plane is hidden in AR (the real table replaces it). */
  setDeskVisible(on: boolean): void {
    this.desk.visible = on;
  }

  /** UI theme tint (desk, cover, paper) for the "Colori" style; null = the original look. */
  setTheme(t: { desk: string; deskEdge: string; cover: number; paper: string; accent: string } | null): void {
    this.theme = t;
    this.setStyle(this.style);
  }

  private colors(): StyleColors {
    const t = this.theme;
    if (this.style !== "color" || !t) return STYLE[this.style];
    return { ...STYLE.color, desk: t.desk, deskEdge: t.deskEdge, cover: t.cover };
  }

  private palette(): Palette {
    const t = this.theme;
    if (this.style !== "color" || !t) return PALETTES[this.style];
    return { ...PALETTES.color, paper: t.paper, accent: t.accent };
  }

  setStyle(style: BookStyle): void {
    this.style = style;
    const c = this.colors();
    for (const m of this.covers) (m.material as THREE.MeshBasicMaterial).color.setHex(c.cover);
    (this.block.material as THREE.MeshBasicMaterial).color.setHex(c.edges);
    this.inkLines.visible = style === "ink";
    this.background.set(c.deskEdge);
    this.redrawStatic();
    if (this.left) this.setPages(this.left, this.right, this.rightFolio, true);
  }

  /**
   * New chapter pages. The left page texture switches when the turning sheet lands (`immediate` for
   * the first chapter, a style change or reduced motion). `dir` -1 = going back: the sheet lifts off the
   * left page (showing the old left page) and lands on the right, revealing the new left page under it.
   */
  setPages(left: PageText, right: PageText | null, rightFolio: string, immediate: boolean, dir: 1 | -1 = 1): void {
    this.left = left;
    this.turnDir = dir;
    this.right = right;
    this.rightFolio = rightFolio;
    if (!this.canvas) return;
    const tex = this.pageTexture((c, w, h) => drawTextPage(c, w, h, left, this.style, "right", this.palette()));
    this.nextLeftTex?.dispose();
    this.nextLeftTex = tex;
    const r = this.pageTexture((c, w, h) =>
      right ? drawTextPage(c, w, h, right, this.style, "left", this.palette()) : drawBlankPage(c, w, h, this.style, rightFolio, this.palette()),
    );
    this.rightTex?.dispose();
    this.rightTex = r;
    (this.pageR.material as THREE.MeshBasicMaterial).map = r;
    (this.pageR.material as THREE.MeshBasicMaterial).needsUpdate = true;
    (this.sheetFront.material as THREE.MeshBasicMaterial).map = this.rightTex;
    (this.sheetFront.material as THREE.MeshBasicMaterial).needsUpdate = true;
    this.sheetBackTex?.dispose();
    const backward = dir === -1 && !immediate && !!this.leftTex;
    const back = (backward ? this.leftTex! : tex).clone();
    back.wrapS = THREE.RepeatWrapping;
    back.repeat.x = -1;
    back.offset.x = 1;
    back.needsUpdate = true;
    this.sheetBackTex = back;
    (this.sheetBack.material as THREE.MeshBasicMaterial).map = back;
    (this.sheetBack.material as THREE.MeshBasicMaterial).needsUpdate = true;
    if (immediate || backward || !this.leftTex) this.landLeft();
  }

  frame(f: BookFrame): void {
    const turning = f.turn > 0.002 && f.turn < Math.PI - 0.002;
    this.sheetFront.visible = this.sheetBack.visible = turning;
    if (turning) this.bendSheet(f.turn);
    else if (this.turnDir === 1 && f.turn >= Math.PI - 0.002) this.landLeft();
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    sm.opacity = (this.style === "ink" ? 0.22 : 0.32) * f.shadow;
    this.shadow.visible = sm.opacity > 0.01;
  }

  dispose(): void {
    for (const t of [this.leftTex, this.nextLeftTex, this.rightTex, this.sheetBackTex, this.deskTex, this.edgeTex, this.shadowTex]) t?.dispose();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    this.group.removeFromParent();
  }

  private landLeft(): void {
    if (!this.nextLeftTex) return;
    this.leftTex?.dispose();
    this.leftTex = this.nextLeftTex;
    this.nextLeftTex = null;
    const m = this.pageL.material as THREE.MeshBasicMaterial;
    m.map = this.leftTex;
    m.needsUpdate = true;
    // The sheet's back still shares the image: re-clone from the landed texture on the next setPages.
  }

  private bendSheet(theta: number): void {
    const L = this.layout;
    const prof = sheetProfile(theta, L.pageW, SEGMENTS, 0.9, this.turnDir);
    const pos = this.sheetGeo.getAttribute("position") as THREE.BufferAttribute;
    const lift = L.pageW * 0.004;
    for (let i = 0; i < pos.count; i++) {
      const col = i % (SEGMENTS + 1);
      const row = Math.floor(i / (SEGMENTS + 1));
      const [x, y] = prof[col]!;
      pos.setXYZ(i, x, y + lift, row === 0 ? -L.pageD / 2 : L.pageD / 2);
    }
    pos.needsUpdate = true;
    this.sheetGeo.computeBoundingSphere();
  }

  private outlinePoints(): THREE.Vector3[] {
    const L = this.layout;
    const pts: THREE.Vector3[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a, b);
    const z0 = -L.pageD / 2;
    const z1 = L.pageD / 2;
    for (const dir of [1, -1]) {
      for (let i = 0; i < SEGMENTS; i++) {
        const u0 = i / SEGMENTS;
        const u1 = (i + 1) / SEGMENTS;
        for (const z of [z0, z1]) {
          seg(new THREE.Vector3(dir * u0 * L.pageW, pageY(u0, L) + 1e-4, z), new THREE.Vector3(dir * u1 * L.pageW, pageY(u1, L) + 1e-4, z));
        }
      }
      const x = dir * L.pageW;
      seg(new THREE.Vector3(x, pageY(1, L), z0), new THREE.Vector3(x, pageY(1, L), z1));
      seg(new THREE.Vector3(x, -L.stackH, z0), new THREE.Vector3(x, -L.stackH, z1));
      // Cover board outline.
      const bx = dir * (L.pageW + L.coverMargin);
      const by = -L.stackH;
      const bz = L.pageD / 2 + L.coverMargin;
      seg(new THREE.Vector3(bx, by, -bz), new THREE.Vector3(bx, by, bz));
      seg(new THREE.Vector3(0, by, bz), new THREE.Vector3(bx, by, bz));
      seg(new THREE.Vector3(0, by, -bz), new THREE.Vector3(bx, by, -bz));
      seg(new THREE.Vector3(bx, by - L.coverT, bz), new THREE.Vector3(bx, by, bz));
    }
    return pts;
  }

  private pageTexture(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    const cv = this.canvas!(this.texW, this.texH);
    const c = cv.getContext("2d")!;
    draw(c, this.texW, this.texH);
    return canvasTexture(cv, this.anisotropy);
  }

  /** Desk, page edges and contact shadow textures (depend on the style only). */
  private redrawStatic(): void {
    const s = this.colors();
    const deskMat = this.desk.material as THREE.MeshBasicMaterial;
    if (!this.canvas) {
      deskMat.color.set(s.desk);
      return;
    }
    this.deskTex?.dispose();
    const N = 512;
    const cv = this.canvas(N, N);
    const c = cv.getContext("2d")!;
    c.fillStyle = s.desk;
    c.fillRect(0, 0, N, N);
    if (this.style === "color") {
      const r = rng(11);
      for (let i = 0; i < 160; i++) {
        const y = r() * N;
        c.strokeStyle = `rgba(${r() < 0.5 ? "90,55,25" : "255,235,200"},${0.05 + r() * 0.08})`;
        c.lineWidth = 0.6 + r() * 2.2;
        c.beginPath();
        c.moveTo(0, y);
        for (let x = 0; x <= N; x += 32) c.lineTo(x, y + Math.sin(x * 0.012 + i) * 3 * r());
        c.stroke();
      }
    }
    const g = c.createRadialGradient(N / 2, N / 2, N * 0.04, N / 2, N / 2, N * 0.42);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, s.deskEdge);
    c.fillStyle = g;
    c.fillRect(0, 0, N, N);
    this.deskTex = canvasTexture(cv, this.anisotropy);
    deskMat.color.set(0xffffff);
    deskMat.map = this.deskTex;
    deskMat.needsUpdate = true;

    if (!this.edgeTex) {
      const ev = this.canvas(8, 128);
      const ec = ev.getContext("2d")!;
      for (let y = 0; y < 128; y++) {
        const v = 226 + ((y * 37) % 23);
        ec.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
        ec.fillRect(0, y, 8, 1);
      }
      this.edgeTex = canvasTexture(ev, 1);
      const bm = this.block.material as THREE.MeshBasicMaterial;
      bm.map = this.edgeTex;
      bm.needsUpdate = true;
    }
    if (!this.shadowTex) {
      const sv = this.canvas(128, 128);
      const sc = sv.getContext("2d")!;
      // Opaque grey ramp: alphaMap reads the green channel (transparent canvas pixels upload as white).
      sc.fillStyle = "#000";
      sc.fillRect(0, 0, 128, 128);
      const sg = sc.createRadialGradient(64, 64, 4, 64, 64, 62);
      sg.addColorStop(0, "#fff");
      sg.addColorStop(0.5, "#8c8c8c");
      sg.addColorStop(1, "#000");
      sc.fillStyle = sg;
      sc.fillRect(0, 0, 128, 128);
      this.shadowTex = new THREE.CanvasTexture(sv);
      const sm = this.shadow.material as THREE.MeshBasicMaterial;
      sm.alphaMap = this.shadowTex;
      sm.needsUpdate = true;
    }
  }

  private track<M extends THREE.Material>(m: M): M {
    this.mats.push(m);
    return m;
  }
}
