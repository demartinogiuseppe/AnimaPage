// Lesson presentation (decision D24): the pop-up book (D12) for children and teens, or "Accademico" for
// university and adult readers: no paper book, a clean background, thin lines, measured motion, typeset
// formulas, stamps and sound effects off by default. "Impostazioni → Stile delle lezioni" stores the
// user's choice (automatic / pop-up book / Accademico) on this device; automatic follows the lesson.
import type { SceneSpec } from "@pv/scene-spec";

export type Presentation = "book" | "academic";
export const PRESENTATION_PREFS = ["auto", "book", "academic"] as const;
export type PresentationPref = (typeof PRESENTATION_PREFS)[number];

const KEY = "pv.presentation";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPresentationPref(store: StorageLike | null = storage()): PresentationPref {
  try {
    const v = store?.getItem(KEY);
    return v === "book" || v === "academic" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function writePresentationPref(p: PresentationPref, store: StorageLike | null = storage()): void {
  try {
    if (p === "auto") store?.removeItem(KEY);
    else store?.setItem(KEY, p);
  } catch {
    /* private mode: this page only */
  }
}

/** Maths and physics, as the analysis names the subject (lowercase, in the user's language). */
const MATH_PHYSICS = /^(matemat|mathemat|maths?\b|fisica|física|physi|analisi|analysis|calcul|cálculo|algebra|álgebra|geometria analitica|statistic|estatística)/i;
/** Topics that only appear at university level (or the last years before it). */
const ADVANCED =
  /derivat|integral|limiti\b|limits? of|matric|matrix|eigen|autovalor|differenzial|differential|gradiente|gradient|divergen|termodinamic|thermodynam|entropi|entropy|quantist|quantum|relativit|tensor|fourier|laplace|lagrang|hamilton/i;

/**
 * Presentation chosen for a lesson when the user leaves it on automatic: "adult" lessons get Accademico,
 * "child" and "teen" the pop-up book. Without an audience (older lessons), maths/physics pages on
 * university topics (derivatives, integrals, thermodynamics, ...) get Accademico. Pure.
 */
export function autoPresentation(spec: Pick<SceneSpec, "audience" | "title"> & { page: Pick<SceneSpec["page"], "subject" | "topic"> }): Presentation {
  if (spec.audience === "adult") return "academic";
  if (spec.audience) return "book";
  if (MATH_PHYSICS.test(spec.page.subject.trim()) && ADVANCED.test(`${spec.page.topic} ${spec.title}`)) return "academic";
  return "book";
}

export function resolvePresentation(pref: PresentationPref, spec: Parameters<typeof autoPresentation>[0]): Presentation {
  return pref === "auto" ? autoPresentation(spec) : pref;
}
