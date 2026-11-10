// three.js stage: renderer, camera, OrbitControls, the auto/user camera ownership, and the
// pop-up book (decision D12) the engine content stands on.
//
// Scene graph: scene → world (the book + content; the object AR will place on a table)
//                          ├─ book (desk, covers, pages)
//                          └─ pivot (pop-up hinge) → root (engine content, never scaled)
//              scene → ink overlay (outlines, china style)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Anchor, Chapter, SceneSpec } from "@pv/scene-spec";
import type { Engine } from "../types.ts";
import type { BookTheme } from "./themes.ts";
import { ease } from "../util/math.ts";
import { Book3D } from "../book/book3d.ts";
import { InkStyler, isKeyMaterial, isKeyObject } from "../book/ink.ts";
import { OccupancyGrid } from "./declutter.ts";
import { backdropsOf, bookLayout, contentFootprint, insideBook, keepBookInView, overviewPose, type BookLayout } from "../book/layout.ts";
import type { BookStyle, PageText } from "../book/page.ts";
import { entryJoinAt, entryPopAt, PINS_FROM, popAt, TURN_SECONDS, turnAngleAt, type PopState } from "../book/popup.ts";
import { dampVelocity, minCameraY, moveVelocity, NO_MOVE, softClamp, targetLimits, type BookBounds, type MoveInput } from "./move.ts";
import {
  cameraAt,
  defaultPose,
  engineViewFor,
  engineViewPose,
  lensAt,
  mixPose,
  NARROW_DISTANCE_SCALE,
  NARROW_STAGE_PX,
  poseZoom,
  targetLens,
  type CameraPose,
  type Lens,
  viewOffsetY,
} from "./camera.ts";

/** Player-level camera tween (chapter entry, "Centra"), seconds. */
const TWEEN_SECONDS = 1.0;
const FOV = 40;
/** Scene camera keys are pulled back a little in book mode, so the page around the content stays in view. */
const BOOK_KEY_PULLBACK = 1.2;
/** Labels wait for the camera to start leaving the book overview (they crowd on the small overview). */
const LABELS_FROM_JOIN = 0.3;
/**
 * Accademico (decision D24): a narrower field of view with the camera moved back so the framing is the
 * same: a flatter, nearly orthographic picture with little perspective distortion.
 */
const ACADEMIC_FOV = 22;
const ACADEMIC_ZOOM = Math.tan((FOV * Math.PI) / 360) / Math.tan((ACADEMIC_FOV * Math.PI) / 360);
const STANDING: PopState = { p: 1, rise: 1, lean: 0, shadow: 0 };

export interface StageOptions {
  loadAsset(path: string): Promise<ArrayBuffer>;
  reducedMotion: boolean;
  /**
   * Accademico presentation (decision D24): no paper book or pop-up (the content stands from the start,
   * no page turn, no opening zoom), a plain background, the narrow-FOV camera, thin ink outlines, and
   * formulas on the engines' boards typeset (EngineContext.typesetFormulas).
   */
  academic?: boolean;
}

export interface StageFrame {
  /** A "pick" question is running: content fully up, labels visible. */
  picking: boolean;
  /** Anchors of the pins highlighted by the current sentence (key elements in china style). */
  keyAnchors: readonly Anchor[];
  /** performance.now() of this frame, ms, for the engine's transient reactions (Engine.animate). Default: now. */
  now?: number;
}

export interface ChapterPages {
  left: PageText;
  /** Null = blank right page under the pop-up. */
  right: PageText | null;
  rightFolio: string;
}

/**
 * The stage area not covered by overlays, in px. Insets are capped so the picture never gets smaller
 * than 55% of the stage in either direction. Pure.
 */
export function freeRect(
  width: number,
  height: number,
  inset: { left: number; bottom: number; top: number; right: number },
): { x: number; y: number; w: number; h: number } {
  const cap = (a: number, b: number, size: number) => {
    const total = Math.max(0, a) + Math.max(0, b);
    const max = size * 0.45;
    const k = total > max ? max / total : 1;
    return [Math.max(0, a) * k, Math.max(0, b) * k] as const;
  };
  const [l, r] = cap(inset.left, inset.right, width);
  const [t, b] = cap(inset.top, inset.bottom, height);
  return { x: Math.round(l), y: Math.round(t), w: Math.max(1, Math.round(width - l - r)), h: Math.max(1, Math.round(height - t - b)) };
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  /** The book with its content: the object to place (AR) or move as a whole. */
  readonly world = new THREE.Group();
  readonly root = new THREE.Group();
  readonly controls: OrbitControls;
  width = 1;
  height = 1;
  layout!: BookLayout;
  book!: Book3D;
  readonly ink: InkStyler;

  /** auto: camera follows cameraAt(t); user: the user orbited, until "Centra" or chapter change; tween: going back to auto. */
  private mode: "auto" | "user" | "tween" = "auto";
  private tween = { p: 0, from: null as CameraPose | null };
  private keys: Chapter["camera"] = [];
  private firstChapter = true;
  private resize: ResizeObserver;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector2();
  private tmp3 = new THREE.Vector3();
  private tmpInv = new THREE.Matrix4();
  private moveInput: MoveInput = { ...NO_MOVE };
  private velocity = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private pivot = new THREE.Group();
  private turnClock = TURN_SECONDS;
  private turnDir: 1 | -1 = 1;
  /** Overlay safe area in px (HUD on top, PROVA bar and timeline at the bottom, docked cards), smoothed. */
  private insetTarget = { left: 0, bottom: 0, top: 0, right: 0 };
  private inset = { left: 0, bottom: 0, top: 0, right: 0 };
  private pop: PopState = { p: 1, rise: 1, lean: 0, shadow: 1 };
  private join = 1;
  private keyPoints: THREE.Vector3[] = [];
  /** Sky domes and horizon aprons of the engine: the book's desk and room replace them. */
  private backdrops: THREE.Object3D[] = [];
  /** Engine content is cut at the edges of the right page (wide worlds like a battlefield's sea). */
  private clipPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
  private clipped = new WeakSet<THREE.Material>();
  /** AR mode (player/xr): the XR device owns the camera, `world` is placed on a real table. */
  private ar = false;
  private arSaved = { near: 0, far: 0 };
  /** Camera distance multiplier (Accademico's narrow field of view keeps the same framing). */
  private zoom = 1;
  /**
   * Lens: the engine's view (Engine.view) owns it while it returns one, else it is the presentation's
   * own (FOV, ACADEMIC_FOV) with no shift. `lensFrom` is where a camera tween starts.
   */
  private lens: Lens = { fov: FOV, shiftY: 0 };
  private lensFrom: Lens = { fov: FOV, shiftY: 0 };
  /** Current lens shift (fraction of the frame height), kept while the user orbits. */
  private shiftY = 0;
  /** The pose of the last autoPose came from Engine.view: no Accademico distance multiplier. */
  private engineView = false;
  /** Distance multiplier of the last applied pose. */
  private appliedZoom = 1;
  private plainBg = new THREE.Color("#f5f6f8");

  private constructor(
    readonly el: HTMLElement,
    private engine: Engine,
    private opts: StageOptions,
  ) {
    // Throws when WebGL is not available: the player then falls back to text only.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.localClippingEnabled = true;
    this.ray.camera = this.camera;
    this.ray.params.Line = { threshold: 0 };
    this.ray.params.Points = { threshold: 0 };
    el.prepend(this.renderer.domElement);
    this.pivot.add(this.root);
    this.world.add(this.pivot);
    this.scene.add(this.world);
    this.ink = new InkStyler(this.root);
    this.ink.clipping = this.clipPlanes;
    this.scene.add(this.ink.overlay);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.48;
    // Free movement: right-drag / Ctrl|Shift+left-drag / two fingers pan along the page plane,
    // the wheel zooms towards the cursor.
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("start", () => {
      this.mode = "user";
    });
    if (opts.academic) {
      this.zoom = ACADEMIC_ZOOM;
      this.appliedZoom = ACADEMIC_ZOOM;
      this.camera.fov = ACADEMIC_FOV;
      this.ink.outlinePx = 1;
    }
    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(el);
    this.onResize();
  }

  static async create(el: HTMLElement, engine: Engine, spec: SceneSpec, opts: StageOptions): Promise<Stage> {
    const stage = new Stage(el, engine, opts);
    const createCanvas = (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h });
    try {
      await engine.build({ root: stage.root, scene: stage.scene, loadAsset: opts.loadAsset, createCanvas, ...(opts.academic ? { typesetFormulas: true } : {}), ...(opts.reducedMotion ? { reducedMotion: true } : {}) }, spec);
    } catch (e) {
      try {
        stage.dispose();
      } catch {
        /* the engine may not be disposable after a failed build */
      }
      throw e;
    }
    // Book sized to the content as it looks at the start of the lesson.
    const first = spec.chapters[0]!;
    engine.update(first.id, 0);
    const bounds = engine.bounds();
    // Content with its own ground (userData.onPage, storybook places) rests exactly on the paper.
    const onPage = stage.root.children.some((c) => c.userData.onPage === true);
    stage.layout = bookLayout(contentFootprint(stage.root, bounds), onPage ? 0 : undefined);
    stage.backdrops = backdropsOf(stage.root, bounds.radius);
    const L = stage.layout;
    const aniso = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy());
    stage.book = new Book3D(L, createCanvas, aniso, 1024);
    stage.world.add(stage.book.group);
    // Accademico: the book still gives the layout (framing, page-edge clipping) but is not drawn.
    stage.book.group.visible = !opts.academic;
    // Pop-up hinge at the content's base: pivot and root cancel out when the content stands.
    const fp = L.footprint;
    stage.pivot.position.set(fp.center.x, fp.center.y, fp.center.z);
    stage.root.position.set(-fp.center.x, -fp.center.y, -fp.center.z);

    const r = Math.max(bounds.radius, 0.5);
    const bookR = Math.hypot(L.halfWidth, L.halfDepth);
    stage.camera.near = Math.max(0.01, r * 0.005) * stage.zoom;
    stage.camera.far = Math.max(r * 40, bookR * 30) * stage.zoom;
    stage.camera.updateProjectionMatrix();
    stage.controls.minDistance = r * 0.05 * stage.zoom;
    stage.controls.maxDistance = Math.max(r * 12, bookR * 5) * stage.zoom;
    return stage;
  }

  get narrow(): boolean {
    return this.width < NARROW_STAGE_PX;
  }

  /** Pins and labels show once the content stands on the page. */
  get contentShown(): boolean {
    return this.pop.p >= PINS_FROM && this.join >= LABELS_FROM_JOIN;
  }

  /** Chapter entry: new pages (with a page turn unless `turn` is false) and a short camera tween. */
  setChapter(chapter: Chapter, pages: ChapterPages, turn = true, dir: 1 | -1 = 1): void {
    this.keys = chapter.camera;
    this.velocity.set(0, 0, 0);
    const animate = turn && !this.opts.reducedMotion;
    this.turnClock = animate ? 0 : TURN_SECONDS;
    this.turnDir = dir;
    this.book.setPages(pages.left, pages.right, pages.rightFolio, !animate, dir);
    this.startTween();
  }

  /** Accademico: the plain background colour. */
  setPlainBackground(color: string): void {
    this.plainBg.set(color);
  }

  /** UI theme tint of the book and desk ("Colori" style). */
  setTheme(t: BookTheme | null): void {
    this.book.setTheme(t);
  }

  setStyle(style: BookStyle): void {
    this.book.setStyle(style);
    this.ink.setEnabled(style === "ink");
  }

  /**
   * Stage areas covered by a docked card (px): the picture shifts so the book stays in the free part.
   * Applied smoothly in frame(). A card docked at a side (left/right) lies on the left page in the book
   * overview, so it only narrows the picture as the camera joins the chapter's own view.
   */
  setInsets(left: number, bottom: number, top = 0, right = 0): void {
    this.insetTarget.left = left;
    this.insetTarget.bottom = bottom;
    this.insetTarget.top = top;
    this.insetTarget.right = right;
  }

  /** Aspect of the area not covered by overlays (the camera frames this area). */
  get freeAspect(): number {
    const fr = freeRect(this.width, this.height, this.inset);
    return fr.w / fr.h;
  }

  /** 0..1: how far the camera is inside the book (close-up); the player fades in a page frame. */
  get inside(): number {
    if (this.ar || this.opts.academic) return 0;
    return insideBook(this.camera.position.distanceTo(this.controls.target), this.layout.pageW, FOV, this.freeAspect);
  }

  get inAr(): boolean {
    return this.ar;
  }

  /** Scene units per world-group unit (1 outside AR, where the world group is never scaled). */
  get worldScale(): number {
    return this.world.scale.x;
  }

  /**
   * AR mode on/off (player/xr/ar-session.ts). On: the scene camera keys, orbit controls, movement,
   * docked-card offsets, background and fog are ignored; near/far switch to metres; the desk is
   * hidden (the real table replaces it). Off: everything back to the 3D view, camera tween to the keys.
   */
  setAr(on: boolean): void {
    if (on === this.ar) return;
    this.ar = on;
    this.velocity.set(0, 0, 0);
    this.controls.enabled = !on;
    this.book.setDeskVisible(!on);
    if (on) {
      this.arSaved.near = this.camera.near;
      this.arSaved.far = this.camera.far;
      this.camera.near = 0.01;
      this.camera.far = 50;
      this.camera.clearViewOffset();
      this.inset.left = this.inset.bottom = this.inset.top = this.inset.right = 0;
    } else {
      this.camera.near = this.arSaved.near;
      this.camera.far = this.arSaved.far;
      this.world.position.set(0, 0, 0);
      this.world.quaternion.identity();
      this.world.scale.set(1, 1, 1);
      this.world.visible = true;
      this.onResize();
      // Back to the keys with the opening "zoom into the page" shot (the camera still holds the XR pose).
      this.tween.p = 0;
      this.tween.from = null;
      this.mode = this.opts.reducedMotion ? "auto" : "tween";
    }
    this.camera.updateProjectionMatrix();
  }

  /** "Centra". */
  recenter(): void {
    this.velocity.set(0, 0, 0);
    this.startTween();
  }

  /** Keys or on-screen pad held down (see move.ts). Any movement hands the camera to the user. */
  setMove(input: MoveInput): void {
    this.moveInput = { ...input };
  }

  /** Book box in world space (movement limits). */
  private bookBounds(): BookBounds {
    const L = this.layout;
    const m = this.book.group.matrixWorld;
    const box = new THREE.Box3();
    for (const x of [-L.halfWidth, L.halfWidth]) for (const z of [-L.halfDepth, L.halfDepth]) box.expandByPoint(new THREE.Vector3(x, 0, z).applyMatrix4(m));
    return { min: box.min, max: box.max, pageY: new THREE.Vector3().applyMatrix4(m).y, size: L.pageW };
  }

  /** Keyboard/pad movement plus the limits that keep the user over the book. */
  private freeMove(dt: number): void {
    const desired = moveVelocity(this.moveInput, this.camera.position, this.controls.target, this.tmp3);
    if (desired.lengthSq() > 0 && this.mode !== "user") {
      this.mode = "user";
    }
    dampVelocity(this.velocity, desired, dt);
    if (this.mode !== "user") return;
    const b = this.bookBounds();
    const step = this.velocity.clone().multiplyScalar(Math.max(0, dt));
    // Soft limits: the target springs back inside the book's box; the camera follows the same correction.
    const lim = targetLimits(b, this.layout.footprint.height);
    step.add(softClamp(this.controls.target.clone().add(step), lim, dt));
    this.controls.target.add(step);
    this.camera.position.add(step);
    // Never under the table.
    const minY = minCameraY(b);
    if (this.camera.position.y < minY) this.camera.position.y = minY;
    this.camera.lookAt(this.controls.target);
  }

  get userOwnsCamera(): boolean {
    return this.mode === "user";
  }

  /** Engine anchor -> world position at (chapterId, t), following the pop-up. Call after frame()'s engine.update. */
  resolveWorld(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3): boolean {
    if (!this.engine.resolveAnchor(anchor, chapterId, t, out)) return false;
    out.applyMatrix4(this.root.matrixWorld);
    return true;
  }

  /** The ray under a screen point, in `root` local coordinates (Engine.tap); null while the canvas has no size. */
  pickRay(clientX: number, clientY: number): THREE.Ray | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    this.world.updateMatrixWorld(true);
    this.tmp2.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.tmp2, this.camera);
    const out = new THREE.Ray().copy(this.ray.ray);
    return out.applyMatrix4(this.tmpInv.copy(this.root.matrixWorld).invert());
  }

  /** False while the anchor's owner has not appeared yet (labels wait for it; see Engine.anchorShown). */
  anchorShown(anchor: Anchor, chapterId: string, t: number): boolean {
    return this.engine.anchorShown?.(anchor, chapterId, t) ?? true;
  }

  /** Same, with the content standing (camera targets do not bob with the pop-up). */
  private resolveUpright(anchor: Anchor, chapterId: string, t: number, out: THREE.Vector3): boolean {
    if (!this.engine.resolveAnchor(anchor, chapterId, t, out)) return false;
    out.applyMatrix4(this.world.matrixWorld);
    return true;
  }

  /**
   * True when engine geometry hides a world point from the camera (labels are dimmed, not removed).
   * One raycast: the pin layer calls it for a pin or two per frame.
   */
  occluded(world: THREE.Vector3): boolean {
    const origin = this.camera.position;
    const dir = this.tmp.copy(world).sub(origin);
    const dist = dir.length();
    if (dist < 1e-6) return false;
    this.ray.set(origin, dir.multiplyScalar(1 / dist));
    this.ray.far = dist - this.layout.footprint.radius * this.worldScale * 0.03;
    if (this.ray.far <= 0) return false;
    for (const hit of this.ray.intersectObject(this.root, true)) {
      const o = hit.object as THREE.Mesh;
      if (!o.isMesh) continue;
      const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material | undefined;
      if (!m || !m.visible || (m.transparent && m.opacity < 0.5)) continue;
      let shown = true;
      for (let x: THREE.Object3D | null = o; x && shown; x = x.parent) shown = x.visible;
      if (shown) return true;
    }
    return false;
  }

  /**
   * Screen footprint of the content for the labels (call a few times per second): every visible,
   * non-flat engine object projected to a screen box (ground planes, seas and terrains are flat and do
   * not count), plus the footprint of the active things (userData.key, glowing materials).
   */
  contentGrids(cols = 32, rows = 24): { content: OccupancyGrid; keys: OccupancyGrid; fill: number } {
    const content = new OccupancyGrid(this.width, this.height, cols, rows);
    const keys = new OccupancyGrid(this.width, this.height, cols, rows);
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const corner = new THREE.Vector3();
    const skip = new Set(this.backdrops);
    this.root.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (skip.has(o) || !(mesh.isMesh || (o as THREE.Sprite).isSprite)) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const m = mats[0] as THREE.Material | undefined;
      if (!m || !m.visible || (m.transparent && m.opacity < 0.15)) return;
      const g = mesh.geometry as THREE.BufferGeometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) return;
      if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) box.setFromObject(o, false);
      else box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      box.getSize(size);
      const flat = size.y < 0.04 * Math.max(size.x, size.z);
      const key = isKeyObject(o, this.root) || mats.some(isKeyMaterial);
      if (flat && !key) return;
      // Project the 8 corners; skip boxes behind the camera.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
        if (corner.z > 1) return;
        const sx = ((corner.x + 1) / 2) * this.width;
        const sy = ((1 - corner.y) / 2) * this.height;
        x0 = Math.min(x0, sx);
        y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx);
        y1 = Math.max(y1, sy);
      }
      const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (r.w <= 0 || r.h <= 0) return;
      if (!flat) content.fill(r);
      if (key) keys.fill(r);
    });
    return { content, keys, fill: content.fraction() };
  }

  /** World position -> NDC (in place). */
  project(v: THREE.Vector3): THREE.Vector3 {
    return v.project(this.camera);
  }

  frame(dt: number, chapterId: string, t: number, f: StageFrame = { picking: false, keyAnchors: [] }): void {
    this.engine.update(chapterId, t);
    this.engine.animate?.(f.now ?? performance.now());
    for (const o of this.backdrops) o.visible = false;
    this.turnClock += dt;
    if (this.opts.academic) {
      this.pop = STANDING;
      this.join = 1;
    } else {
      this.pop = f.picking ? popAt(1e9, this.layout.upright) : entryPopAt(t, this.turnClock, this.layout.upright, this.opts.reducedMotion);
      this.join = f.picking ? 1 : entryJoinAt(t, this.turnClock);
    }
    this.pivot.scale.set(1, this.pop.rise, 1);
    this.pivot.rotation.x = this.pop.lean;
    this.world.updateMatrixWorld(true);
    this.book.frame({ turn: turnAngleAt(this.turnClock, this.opts.reducedMotion, this.turnDir), shadow: this.pop.shadow });
    this.clipToPage();

    // AR: the user is the camera (renderer.render takes the XR pose); no keys, tweens or offsets.
    if (!this.ar) this.moveCamera(dt, chapterId, t);

    // Book mode: the room colour replaces the engine's sky and fog (both restored right after,
    // engines keep mutating their own objects). AR: no background, the camera image shows through.
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = this.ar ? null : this.opts.academic ? this.plainBg : this.book.background;
    this.scene.fog = null;
    if (this.ink.enabled) {
      this.keyPoints.length = 0;
      for (const a of f.keyAnchors) {
        const v = new THREE.Vector3();
        if (this.resolveWorld(a, chapterId, t, v)) this.keyPoints.push(v);
      }
      const size = this.renderer.getDrawingBufferSize(this.tmp2);
      this.ink.begin({
        keyPoints: this.keyPoints,
        radius: this.layout.footprint.radius * this.worldScale,
        width: size.x,
        height: size.y,
        pixelRatio: this.renderer.getPixelRatio(),
      });
    }
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.ink.end();
      this.scene.background = bg;
      this.scene.fog = fog;
    }
  }

  /** 3D view camera: auto keys / tween / user orbit, free movement and docked-card offsets. */
  private moveCamera(dt: number, chapterId: string, t: number): void {
    const auto = this.autoPose(chapterId, t);
    let lensP = 1;
    if (this.mode === "tween") {
      this.tween.from ??= this.openingFrom(auto);
      this.tween.p = Math.min(1, this.tween.p + dt / TWEEN_SECONDS);
      lensP = ease.inOutCubic(this.tween.p);
      this.apply(mixPose(this.tween.from, auto, lensP));
      if (this.tween.p >= 1) this.mode = "auto";
    } else if (this.mode === "auto") {
      this.apply(auto);
    } else {
      this.controls.update();
    }
    // While the user orbits, the lens stays as it was.
    const now = lensAt(this.lensFrom, this.lens, lensP, this.mode === "user" || this.renderer.xr.isPresenting, { fov: this.camera.fov, shiftY: this.shiftY });
    this.camera.fov = now.fov;
    this.shiftY = now.shiftY;
    this.freeMove(dt);

    // Overlays (HUD, PROVA bar, timeline, docked cards): the camera frames the free area only. The
    // frustum is computed for the free rectangle and the canvas shows a window around it, so camera keys
    // and the book overview fit between the bars (labels follow through project()).
    const ki = this.opts.reducedMotion ? 1 : 1 - Math.exp(-8 * Math.max(dt, 0));
    for (const k of ["left", "bottom", "top", "right"] as const) {
      const target = k === "left" || k === "right" ? this.insetTarget[k] * this.join : this.insetTarget[k];
      this.inset[k] += (target - this.inset[k]) * ki;
    }
    const fr = freeRect(this.width, this.height, this.inset);
    this.camera.aspect = fr.w / fr.h;
    if (fr.x !== 0 || fr.y !== 0 || fr.w !== this.width || fr.h !== this.height || this.shiftY !== 0) {
      this.camera.setViewOffset(fr.w, fr.h, -fr.x, viewOffsetY(fr.y, fr.h, this.shiftY), this.width, this.height);
    } else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    else this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resize.disconnect();
    this.controls.dispose();
    this.engine.dispose();
    this.ink.dispose();
    this.book?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private autoPose(chapterId: string, t: number): CameraPose {
    const base = this.opts.academic ? ACADEMIC_FOV : FOV;
    // The engine may drive the camera itself (façade views): its own framing and lens, not the book's.
    const ev = engineViewFor(this.engine, this.renderer.xr.isPresenting, chapterId, t, this.freeAspect);
    this.lens = targetLens(base, ev, this.join);
    this.engineView = false;
    if (ev) {
      const v = engineViewPose(ev, this.world.matrixWorld);
      const w = this.join;
      this.engineView = true;
      // Far views (a narrow lens from a distance) need room.
      const dist = v.position.distanceTo(v.target);
      this.camera.far = Math.max(this.camera.far, dist * 2);
      this.controls.maxDistance = Math.max(this.controls.maxDistance, dist * 1.5);
      return w >= 1 ? v : mixPose(this.overview(), v, w);
    }
    // A card docked at a side narrows the picture: pull back so the key still spans the same width.
    const side = this.width / Math.max(1, this.width - this.inset.left - this.inset.right);
    const scale = (this.narrow ? NARROW_DISTANCE_SCALE : 1) * BOOK_KEY_PULLBACK * side;
    let pose = cameraAt(this.keys, t, (a, out) => this.resolveUpright(a, chapterId, t, out), scale);
    if (!pose) {
      const b = this.engine.bounds();
      pose = defaultPose(this.tmp.copy(b.center).applyMatrix4(this.world.matrixWorld), b.radius, scale);
    }
    // Same framing in both presentations; Accademico allows low, frontal views (no page to keep visible).
    pose = keepBookInView(pose, this.layout.pageW, FOV, this.freeAspect, undefined, this.opts.academic ? 0 : undefined);
    const w = this.join;
    if (w >= 1) return pose;
    return mixPose(this.overview(), pose, w);
  }

  /** Page-edge clipping planes in world space; engine materials get them once (engines never use clipping). */
  private clipToPage(): void {
    const L = this.layout;
    const m = this.book.group.matrixWorld;
    const x0 = L.pageW * 0.012;
    const corners: Array<[number, number, number, number, number, number]> = [
      [x0, 0, 0, 1, 0, 0],
      [L.pageW, 0, 0, -1, 0, 0],
      [0, 0, -L.pageD / 2, 0, 0, 1],
      [0, 0, L.pageD / 2, 0, 0, -1],
    ];
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    corners.forEach(([px, py, pz, nx, ny, nz], i) => {
      const p = new THREE.Vector3(px, py, pz).applyMatrix4(m);
      const n = new THREE.Vector3(nx, ny, nz).applyMatrix3(nm).normalize();
      this.clipPlanes[i]!.setFromNormalAndCoplanarPoint(n, p);
    });
    this.root.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      for (const x of Array.isArray(mat) ? mat : [mat]) {
        if (this.clipped.has(x)) continue;
        this.clipped.add(x);
        if (!x.clippingPlanes || x.clippingPlanes.length === 0) x.clippingPlanes = this.clipPlanes;
      }
    });
  }

  /** The whole open book seen from the reader's side. */
  private overview(): CameraPose {
    const o = overviewPose(this.layout, this.freeAspect, FOV);
    const m = this.book.group.matrixWorld;
    return { position: o.position.applyMatrix4(m), target: o.target.applyMatrix4(m) };
  }

  private startTween(): void {
    this.tween.p = 0;
    this.lensFrom = { fov: this.camera.fov, shiftY: this.shiftY };
    // Accademico opens on the scene's own view (no "zoom into the page" shot).
    if (this.opts.reducedMotion || (this.opts.academic && this.firstChapter)) {
      this.firstChapter = false;
      this.mode = "auto";
      return;
    }
    this.mode = "tween";
    // First chapter: `from` stays null and frame() starts from a pulled-back copy of the first view
    // (the campania prototype's "zoom into the page" opening shot).
    this.tween.from = this.firstChapter
      ? null
      : { position: this.unzoomed(this.camera.position, this.controls.target), target: this.controls.target.clone() };
    this.firstChapter = false;
  }

  private openingFrom(auto: CameraPose): CameraPose {
    const dir = auto.position.clone().sub(auto.target);
    dir.y = Math.abs(dir.y) + dir.length() * 0.6;
    return { position: auto.target.clone().add(dir.multiplyScalar(1.5)), target: auto.target.clone() };
  }

  /** Camera position without the Accademico distance multiplier (poses are mixed in that space). */
  private unzoomed(position: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    return position.clone().sub(target).divideScalar(this.appliedZoom).add(target);
  }

  private apply(pose: CameraPose): void {
    this.camera.position.copy(pose.position);
    this.appliedZoom = poseZoom(this.engineView, this.zoom);
    if (this.appliedZoom !== 1) this.camera.position.sub(pose.target).multiplyScalar(this.appliedZoom).add(pose.target);
    this.controls.target.copy(pose.target);
    this.camera.lookAt(pose.target);
  }

  private onResize(): void {
    this.width = Math.max(1, this.el.clientWidth);
    this.height = Math.max(1, this.el.clientHeight);
    // While presenting, the XR layer owns the size and the projection (labels still use width/height).
    if (this.renderer.xr.isPresenting) return;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }
}
