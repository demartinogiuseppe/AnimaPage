// What counts as a tap on the canvas, and how many tap sounds may overlap. A press that moves, lasts or
// has a second finger is an orbit gesture and never a tap.

export const TAP_MAX_MS = 350;
export const TAP_MAX_PX = 8;
/** A finger (touch, pen) is less precise and slower than a mouse: a child's tap is longer and wobblier. */
export const TAP_TOUCH_MAX_MS = 700;
export const TAP_TOUCH_MAX_PX = 14;
/** Tap sounds sounding at once at most; an extra request is dropped. */
export const TAP_MAX_VOICES = 3;
/** How long a tap sound is counted as sounding, ms. */
const TAP_SOUND_MS = 800;

interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  isPrimary: boolean;
  pointerType: string;
}

export class TapDetector {
  private start: { id: number; x: number; y: number; at: number; maxPx: number; maxMs: number } | null = null;
  private moved = false;

  down(e: PointerLike, now: number): void {
    // Primary mouse button or any touch/pen contact; a second contact turns the gesture into a pinch.
    if (this.start || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) {
      this.start = null;
      this.moved = true;
      return;
    }
    const finger = e.pointerType !== "mouse";
    this.start = { id: e.pointerId, x: e.clientX, y: e.clientY, at: now, maxPx: finger ? TAP_TOUCH_MAX_PX : TAP_MAX_PX, maxMs: finger ? TAP_TOUCH_MAX_MS : TAP_MAX_MS };
    this.moved = false;
  }

  move(e: PointerLike): void {
    const s = this.start;
    if (s && s.id === e.pointerId && Math.hypot(e.clientX - s.x, e.clientY - s.y) > s.maxPx) this.moved = true;
  }

  /** The tap position when this release ends a tap, else null. */
  up(e: PointerLike, now: number): { x: number; y: number } | null {
    const s = this.start;
    if (!s || s.id !== e.pointerId) {
      // A second contact lifting, or a release we do not track: the gesture is over either way.
      if (!s) this.moved = false;
      return null;
    }
    this.start = null;
    const ok = !this.moved && now - s.at <= s.maxMs && Math.hypot(e.clientX - s.x, e.clientY - s.y) <= s.maxPx;
    return ok ? { x: e.clientX, y: e.clientY } : null;
  }

  cancel(): void {
    this.start = null;
    this.moved = false;
  }
}

/** Keeps the tap effects from piling up: at most TAP_MAX_VOICES within the sound's length. */
export class TapSoundLimiter {
  private at: number[] = [];

  allow(now: number): boolean {
    this.at = this.at.filter((t) => now - t < TAP_SOUND_MS);
    if (this.at.length >= TAP_MAX_VOICES) return false;
    this.at.push(now);
    return true;
  }
}
