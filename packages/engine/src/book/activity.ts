// Prevedi → Prova → Dimostra → Timbro (decision D13): pure state machine + stamp persistence.
import type { Activity } from "@pv/scene-spec";

/**
 * predict: the question is shown, the scene waits;
 * test:    the scene plays ("Prova"), sliders if the engine has parameters;
 * prove:   the flap is closed, waiting to be lifted;
 * revealed: the flap is open (explanation + whether the prediction was right);
 * stamped: the stamp is collected.
 */
export type ActivityPhase = "predict" | "test" | "prove" | "revealed" | "stamped";

export class ActivityState {
  phase: ActivityPhase = "predict";
  /** Index of the predicted option (kept, judged only when the flap is lifted). */
  choice: number | null = null;

  constructor(
    readonly activity: Activity,
    /** The stamp was earned in an earlier visit: start as done (the user can redo it). */
    alreadyStamped = false,
  ) {
    if (alreadyStamped) this.phase = "stamped";
  }

  /** The scene must not autoplay while the question waits for an answer. */
  get blocksPlayback(): boolean {
    return this.phase === "predict";
  }

  /** Right/wrong, known only once the flap is lifted. */
  get correct(): boolean | null {
    if (this.choice === null || (this.phase !== "revealed" && this.phase !== "stamped")) return null;
    return this.choice === this.activity.predict.answer;
  }

  choose(k: number): boolean {
    if (this.phase !== "predict" || k < 0 || k >= this.activity.predict.options.length) return false;
    this.choice = k;
    this.phase = "test";
    return true;
  }

  /** End of the test (the chapter finished, or "Dimostra" was tapped). */
  finishTest(): boolean {
    if (this.phase !== "test") return false;
    this.phase = "prove";
    return true;
  }

  lift(): boolean {
    if (this.phase !== "prove") return false;
    this.phase = "revealed";
    return true;
  }

  /** Returns true when the stamp is earned now. */
  collect(): boolean {
    if (this.phase !== "revealed") return false;
    this.phase = "stamped";
    return true;
  }

  restart(): void {
    this.phase = "predict";
    this.choice = null;
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Stable key of a lesson (scenes have no id): subject, topic and title. */
export function sceneKey(spec: { title: string; page: { subject: string; topic: string } }): string {
  const raw = `${spec.page.subject}|${spec.page.topic}|${spec.title}`.toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/** Collected stamps per lesson: chapter id -> stamp name. Storage may be missing or blocked. */
export class StampStore {
  private mem = new Map<string, Record<string, string>>();

  constructor(private store: StorageLike | null = defaultStorage()) {}

  load(scene: string): Record<string, string> {
    const cached = this.mem.get(scene);
    if (cached) return { ...cached };
    let rec: Record<string, string> = {};
    try {
      const raw = this.store?.getItem(`pv.stamps.${scene}`);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") rec[k] = v;
      }
    } catch {
      rec = {};
    }
    this.mem.set(scene, rec);
    return { ...rec };
  }

  has(scene: string, chapterId: string): boolean {
    return chapterId in this.load(scene);
  }

  /** Forgets every stamp of a lesson (memory and storage). */
  clear(scene: string): void {
    this.mem.delete(scene);
    try {
      this.store?.removeItem?.(`pv.stamps.${scene}`);
    } catch {
      /* private mode: nothing to remove */
    }
  }

  add(scene: string, chapterId: string, stamp: string): void {
    const rec = this.load(scene);
    rec[chapterId] = stamp;
    this.mem.set(scene, rec);
    try {
      this.store?.setItem(`pv.stamps.${scene}`, JSON.stringify(rec));
    } catch {
      /* private mode or quota: kept for this page only */
    }
  }
}

// ---------- Visual style preference ----------

export type VisualStyle = "color" | "ink";
const STYLE_KEY = "pv.style";

/** The user's choice wins; otherwise the scene's default; otherwise colour. */
export function resolveStyle(saved: string | null, sceneDefault: VisualStyle | undefined): VisualStyle {
  if (saved === "color" || saved === "ink") return saved;
  return sceneDefault ?? "color";
}

export function readStyle(store: StorageLike | null = defaultStorage()): string | null {
  try {
    return store?.getItem(STYLE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStyle(style: VisualStyle, store: StorageLike | null = defaultStorage()): void {
  try {
    store?.setItem(STYLE_KEY, style);
  } catch {
    /* see StampStore.add */
  }
}
