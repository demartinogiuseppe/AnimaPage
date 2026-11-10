// WebXR immersive-ar session (docs/m5/ar.md): the pop-up book on a real table (Android Chrome + ARCore).
//
// APIs checked against the specs (WebXR Device API, Hit Test, DOM Overlays, Anchors) and three r187's
// WebXRManager / ARButton sources; see docs/m5/ar.md "API notes".
// Flow: requestSession → renderer.xr.setSession → viewer-space hit-test source → reticle on horizontal
// surfaces → tap places Stage.world (anchored when "anchors" is granted) → drag / pinch / twist.
import * as THREE from "three";
import type { Stage } from "../stage.ts";
import { applyPinchTwist, isTap, pinchTwist, rayPlaneY, toNdc, type Pt } from "./gestures.ts";
import { AR_BOOK_WIDTH_M, faceViewer, isHorizontal, worldPose, type ArTransform } from "./placement.ts";
import { ReticleState, type ReticlePhase } from "./reticle.ts";

/** XR framebuffer scale (1 = the device's recommended size): phones draw the scene a bit smaller. */
export const AR_FRAMEBUFFER_SCALE = 0.75;
/** A drag never takes the book further than this from the phone (rays near the horizon). */
const MAX_DRAG_M = 4;

/** True only where an immersive-ar session can start (secure context, WebXR, AR-capable device). */
export async function arSupported(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.xr || typeof window === "undefined" || !window.isSecureContext) return false;
  try {
    return await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    // SecurityError: blocked by the xr-spatial-tracking permissions policy.
    return false;
  }
}

export interface ArCallbacks {
  /** The player's frame, driven by the XR session while presenting (ms, performance.now()). */
  loop(now: number): void;
  /** Called right before the renderer takes over the loop: the player stops its window loop. */
  takeLoop(): void;
  /** Reticle / placement phase changed (UI hint). */
  phase(p: ReticlePhase): void;
  /** Session over (Esci, system back, error): the player resumes its window loop. */
  ended(): void;
  /** Any touch on the scene (the player collapses fanned-out labels). */
  touch(): void;
}

export class ArSession {
  /** A DOM overlay was granted: the player's controls and labels are on screen, gestures work. */
  overlay = false;
  private state = new ReticleState();
  private reticle: THREE.Mesh;
  private hitSource: XRHitTestSource | null = null;
  private anchor: XRAnchor | null = null;
  private anchorRef: THREE.Vector3 | null = null;
  private anchorToken = 0;
  private drift = new THREE.Vector3();
  private hitPos = new THREE.Vector3();
  private placeRequested = false;
  private t: ArTransform;
  private eff: ArTransform;
  private base: THREE.Vector3;
  private bookWidth: number;
  private done = false;
  // Gestures (DOM overlay only).
  private touchEl: HTMLElement;
  private pointers = new Map<number, Pt>();
  private drag: { start: Pt; last: Pt; ms: number; tap: boolean } | null = null;
  private pinch: { a: Pt; b: Pt; t: ArTransform } | null = null;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private p0 = new THREE.Vector3();
  private p1 = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  private constructor(
    private stage: Stage,
    private session: XRSession,
    private root: HTMLElement,
    private cb: ArCallbacks,
    widthM: number,
  ) {
    const L = stage.layout;
    // Bottom of the covers under the spine, in world-group units: this point touches the table.
    this.base = new THREE.Vector3(L.origin.x, L.origin.y - L.stackH - L.coverT, L.origin.z);
    this.bookWidth = 2 * L.halfWidth;
    this.t = { position: new THREE.Vector3(), yaw: 0, width: widthM };
    this.eff = { position: new THREE.Vector3(), yaw: 0, width: widthM };
    const ring = new THREE.RingGeometry(0.05, 0.065, 40).rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.reticle.renderOrder = 10;
    this.touchEl = Object.assign(document.createElement("div"), { className: "pv-ar-touch" });
  }

  /** Must be called from a user gesture (requestSession needs transient activation). */
  static async start(stage: Stage, root: HTMLElement, cb: ArCallbacks, widthM = AR_BOOK_WIDTH_M): Promise<ArSession> {
    const xr = navigator.xr;
    if (!xr) throw new Error("WebXR not available");
    const session = await xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "anchors"],
      domOverlay: { root },
    });
    const ar = new ArSession(stage, session, root, cb, widthM);
    try {
      await ar.begin();
    } catch (e) {
      ar.end();
      throw e;
    }
    return ar;
  }

  get phase(): ReticlePhase {
    return this.state.phase;
  }

  private async begin(): Promise<void> {
    const r = this.stage.renderer;
    this.session.addEventListener("end", this.onEnd);
    this.stage.setAr(true);
    this.stage.world.visible = false;
    this.stage.scene.add(this.reticle);
    this.root.classList.add("pv-ar");
    r.xr.enabled = true;
    // "local" is always granted to immersive sessions (WebXR §reference spaces); three's ARButton uses it too.
    r.xr.setReferenceSpaceType("local");
    r.xr.setFramebufferScaleFactor(AR_FRAMEBUFFER_SCALE);
    // Set before setSession: three stops its window loop on "sessionstart" and drives this one from XR frames.
    this.cb.takeLoop();
    r.setAnimationLoop(() => this.cb.loop(performance.now()));
    await r.xr.setSession(this.session);
    const viewer = await this.session.requestReferenceSpace("viewer");
    this.hitSource = (await this.session.requestHitTestSource?.({ space: viewer })) ?? null;
    this.overlay = !!this.session.domOverlayState;
    if (this.overlay) {
      this.root.prepend(this.touchEl);
      this.touchEl.addEventListener("pointerdown", this.onDown);
      this.touchEl.addEventListener("pointermove", this.onMove);
      for (const ev of ["pointerup", "pointercancel"] as const) this.touchEl.addEventListener(ev, this.onUp);
    } else {
      // No overlay: the screen tap arrives as an XR "select" (transient "screen" input source).
      this.session.addEventListener("select", this.onSelect);
    }
    this.cb.phase(this.state.phase);
  }

  /** "Esci". */
  end(): void {
    if (this.done) return;
    this.session.end().catch(() => this.cleanup());
  }

  /** "Riposiziona": hide the book and look for a surface again. */
  reposition(): void {
    if (this.done) return;
    this.dropAnchor();
    this.state.reset();
    this.placeRequested = false;
    this.cb.phase(this.state.phase);
  }

  /** Once per XR frame, before Stage.frame: hit-test, reticle, anchor drift, world pose. */
  update(): void {
    if (this.done) return;
    const r = this.stage.renderer;
    const frame = r.xr.getFrame();
    const ref = r.xr.getReferenceSpace();
    if (!frame || !ref) return;

    if (this.anchor && frame.trackedAnchors?.has(this.anchor)) {
      const p = frame.getPose(this.anchor.anchorSpace, ref)?.transform.position;
      if (p) {
        this.anchorRef ??= new THREE.Vector3(p.x, p.y, p.z);
        this.drift.set(p.x, p.y, p.z).sub(this.anchorRef);
      }
    }

    let hit: XRHitTestResult | null = null;
    if (this.state.phase !== "placed" && this.hitSource) {
      for (const res of frame.getHitTestResults(this.hitSource)) {
        const pose = res.getPose(ref);
        if (!pose || !isHorizontal(pose.transform.orientation)) continue;
        hit = res;
        const p = pose.transform.position;
        this.hitPos.set(p.x, p.y, p.z);
        this.reticle.matrix.fromArray(pose.transform.matrix);
        break;
      }
      const before = this.state.phase;
      if (this.state.frame(!!hit) !== before) this.cb.phase(this.state.phase);
    }

    if (this.placeRequested) {
      this.placeRequested = false;
      if (this.state.place()) {
        this.place(frame, ref, hit);
        this.cb.phase(this.state.phase);
      }
    }

    this.reticle.visible = this.state.reticleVisible;
    const w = this.stage.world;
    w.visible = this.state.phase === "placed";
    if (w.visible) {
      this.eff.position.copy(this.t.position).add(this.drift);
      this.eff.yaw = this.t.yaw;
      this.eff.width = this.t.width;
      worldPose(this.eff, this.base, this.bookWidth, w);
    }
  }

  private place(frame: XRFrame, ref: XRReferenceSpace, hit: XRHitTestResult | null): void {
    this.dropAnchor();
    this.drift.set(0, 0, 0);
    this.t.position.copy(this.hitPos);
    const v = frame.getViewerPose(ref)?.transform.position;
    if (v) this.t.yaw = faceViewer(this.hitPos, this.tmp.set(v.x, v.y, v.z));
    // Anchors keep the book still while ARCore refines its map; without them the pose stays fixed.
    const token = ++this.anchorToken;
    let made: Promise<XRAnchor> | undefined;
    try {
      const p = this.hitPos;
      made = hit?.createAnchor?.() ?? frame.createAnchor?.(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }), ref);
    } catch {
      made = undefined;
    }
    made
      ?.then((a) => {
        if (this.done || token !== this.anchorToken) return a.delete();
        this.anchor = a;
        this.anchorRef = null;
      })
      .catch(() => {
        /* "anchors" not granted or tracking lost: fixed pose */
      });
  }

  private dropAnchor(): void {
    this.anchorToken++;
    try {
      this.anchor?.delete();
    } catch {
      /* already gone */
    }
    this.anchor = null;
    this.anchorRef = null;
  }

  // ---------- Gestures ----------
  private point(e: PointerEvent): Pt {
    const b = this.root.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  /** Screen point -> table plane (the XR camera of the last frame). */
  private onPlane(p: Pt, out: THREE.Vector3): boolean {
    const cam = this.stage.camera;
    toNdc(p, this.root.clientWidth, this.root.clientHeight, this.ndc);
    this.ray.setFromCamera(this.ndc, cam);
    if (!rayPlaneY(this.ray.ray.origin, this.ray.ray.direction, this.t.position.y + this.drift.y, out)) return false;
    return out.distanceTo(cam.position) <= MAX_DRAG_M;
  }

  private onDown = (e: PointerEvent): void => {
    this.cb.touch();
    try {
      this.touchEl.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const p = this.point(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) this.drag = { start: p, last: p, ms: e.timeStamp, tap: true };
    else if (this.pointers.size === 2) {
      if (this.drag) this.drag.tap = false;
      const [a, b] = [...this.pointers.values()] as [Pt, Pt];
      this.pinch = { a, b, t: { position: this.t.position.clone(), yaw: this.t.yaw, width: this.t.width } };
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.point(e);
    this.pointers.set(e.pointerId, p);
    const placed = this.state.phase === "placed";
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()] as [Pt, Pt];
      if (placed) applyPinchTwist(this.pinch.t, pinchTwist(this.pinch.a, this.pinch.b, a, b), this.t);
    } else if (this.pointers.size === 1 && this.drag) {
      if (!isTap(this.drag.start, p, 0)) this.drag.tap = false;
      if (placed && !this.drag.tap && this.onPlane(this.drag.last, this.p0) && this.onPlane(p, this.p1)) {
        this.t.position.add(this.p1.sub(this.p0));
      }
      if (!this.drag.tap) this.drag.last = p;
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.point(e);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      if (this.drag?.tap && isTap(this.drag.start, p, e.timeStamp - this.drag.ms)) this.tap();
      this.drag = null;
      this.pinch = null;
    } else if (this.pointers.size === 1) {
      // Pinch over, one finger left: it drags from where it is now (no jump).
      const rest = [...this.pointers.values()][0]!;
      this.pinch = null;
      this.drag = { start: rest, last: rest, ms: e.timeStamp, tap: false };
    }
  };

  private tap(): void {
    if (this.state.phase !== "placed") this.placeRequested = true;
  }

  private onSelect = (): void => this.tap();

  private onEnd = (): void => this.cleanup();

  private cleanup(): void {
    if (this.done) return;
    this.done = true;
    const r = this.stage.renderer;
    this.session.removeEventListener("end", this.onEnd);
    this.session.removeEventListener("select", this.onSelect);
    try {
      this.hitSource?.cancel();
    } catch {
      /* cancelled with the session */
    }
    this.hitSource = null;
    this.dropAnchor();
    this.touchEl.removeEventListener("pointerdown", this.onDown);
    this.touchEl.removeEventListener("pointermove", this.onMove);
    for (const ev of ["pointerup", "pointercancel"] as const) this.touchEl.removeEventListener(ev, this.onUp);
    this.touchEl.remove();
    this.reticle.removeFromParent();
    this.reticle.geometry.dispose();
    (this.reticle.material as THREE.Material).dispose();
    r.setAnimationLoop(null);
    r.xr.enabled = false;
    this.root.classList.remove("pv-ar");
    this.stage.setAr(false);
    this.cb.ended();
  }
}
