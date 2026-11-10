// AR reticle state machine (docs/m5/ar.md). Pure.
//
// seeking: no table found yet (the user moves the phone slowly);
// found:   a horizontal surface is under the screen centre, the reticle shows, a tap places the book;
// placed:  the book stands on the table, hit-testing stops until "Riposiziona".
export type ReticlePhase = "seeking" | "found" | "placed";

/** Frames without a hit before the reticle disappears (hit-test results flicker at plane edges). */
export const RETICLE_GRACE_FRAMES = 10;

export class ReticleState {
  phase: ReticlePhase = "seeking";
  private misses = 0;

  constructor(private grace = RETICLE_GRACE_FRAMES) {}

  /** One XR frame of hit-testing: `hit` = a horizontal surface under the screen centre. */
  frame(hit: boolean): ReticlePhase {
    if (this.phase === "placed") return this.phase;
    if (hit) {
      this.misses = 0;
      this.phase = "found";
    } else if (this.phase === "found" && ++this.misses > this.grace) {
      this.phase = "seeking";
    }
    return this.phase;
  }

  /** A tap: places the book only while a surface is found. */
  place(): boolean {
    if (this.phase !== "found") return false;
    this.phase = "placed";
    return true;
  }

  /** "Riposiziona": look for a surface again. */
  reset(): void {
    this.phase = "seeking";
    this.misses = 0;
  }

  get reticleVisible(): boolean {
    return this.phase === "found";
  }
}
