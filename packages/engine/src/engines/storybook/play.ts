// The activity of a storybook chapter (a StoryPlay): what the child has done so far and what a touch
// means. Pure given its inputs: no timers, no randomness, nothing about sounds or the 3D scene. The
// engine owns one run per chapter for the whole lesson session (never saved or exported) and applies
// the result (bounce, wobble, colour, sound).
import type { StoryPlay } from "@pv/scene-spec";

/** The activity is live in the last moments of a chapter: from `duration - PLAY_SLACK` seconds on (engine and player agree). */
export const PLAY_SLACK = 0.05;

/** The six bright colours of the colouring (red, orange, yellow, green, blue, purple). */
export const PALETTE: readonly string[] = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7"];

/**
 * What a touch on a character did to the activity:
 * "good" = it counted, "again" = right but already done, "wobble" = not this one, "ignore" = the play
 * does not concern that character (touch to hear takes it).
 */
export type Verdict = "good" | "again" | "wobble" | "ignore";

export interface PlayMark {
  id: string;
  text: string;
}

export class PlayRun {
  /** Letter/touch: the characters found; order: the characters numbered so far, in order; colour: the parts painted. */
  private done_ = new Set<string>();
  private order_: string[] = [];
  /** The letter hunt's targets and the order's sequence that can be reached: distinct, and on stage at the end. */
  private goals: readonly string[];

  /**
   * @param stage the characters on stage when the chapter ends (the touchable ones)
   * @param parts the colourable parts of `play.who` (colour plays)
   */
  constructor(
    readonly play: StoryPlay,
    private stage: readonly string[],
    private parts: readonly string[] = [],
  ) {
    const p = play;
    const reach = (ids: readonly string[]) => [...new Set(ids)].filter((id) => stage.includes(id));
    this.goals = p.kind === "letter" ? reach(p.targets) : p.kind === "order" ? reach(p.order) : [];
  }

  get kind(): StoryPlay["kind"] {
    return this.play.kind;
  }

  get total(): number {
    switch (this.play.kind) {
      case "touch":
        return this.stage.length;
      case "letter":
      case "order":
        return this.goals.length;
      case "color":
        return this.parts.length;
    }
  }

  get done(): number {
    return this.play.kind === "order" ? this.order_.length : this.done_.size;
  }

  get complete(): boolean {
    return this.done >= this.total;
  }

  /** Does a touch on `id` belong to the activity (it takes the touch instead of touch-to-hear)? */
  concerns(id: string): boolean {
    switch (this.play.kind) {
      case "touch":
      case "letter":
        return this.stage.includes(id);
      case "order":
        return this.goals.includes(id);
      case "color":
        return this.play.who === id;
    }
  }

  /** A touch on a character (not the colouring: see paint). Nothing after completion. */
  tap(id: string): Verdict {
    const p = this.play;
    if (this.complete || !this.concerns(id)) return "ignore";
    switch (p.kind) {
      case "touch":
        return this.mark(id);
      case "letter":
        return this.goals.includes(id) ? this.mark(id) : "wobble";
      case "order": {
        if (this.order_.includes(id)) return "again";
        if (this.goals[this.order_.length] !== id) return "wobble";
        this.order_.push(id);
        return "good";
      }
      case "color":
        return "ignore";
    }
  }

  /** The colouring: a part of `who` was painted. Unknown parts never count. */
  paint(part: string): Verdict {
    if (this.play.kind !== "color" || this.complete) return "ignore";
    if (!this.parts.includes(part)) return "wobble";
    const fresh = !this.done_.has(part);
    this.done_.add(part);
    return fresh ? "good" : "again";
  }

  /**
   * Which part a touch paints: the one under the finger, unless that is already painted and another is not
   * (a small finger misses a thin belly: the colouring always moves on). A touch that hit no part counts as a miss.
   */
  target(hit: string | undefined): string | undefined {
    if (hit !== undefined && !this.done_.has(hit)) return hit;
    return this.parts.find((p) => !this.done_.has(p)) ?? hit;
  }

  /** The badges over the characters: a star for each one found, the numbers 1, 2, 3... for an order. */
  marks(): PlayMark[] {
    if (this.play.kind === "order") return this.order_.map((id, i) => ({ id, text: String(i + 1) }));
    if (this.play.kind === "color") return [];
    return [...this.done_].map((id) => ({ id, text: "★" }));
  }

  private mark(id: string): Verdict {
    if (this.done_.has(id)) return "again";
    this.done_.add(id);
    return "good";
  }
}
