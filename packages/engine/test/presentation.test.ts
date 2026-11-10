// Presentation choice (decision D24): pop-up book or Accademico, from the user's setting or the lesson.
import { describe, expect, it } from "vitest";
import { audienceFromGrade } from "@pv/scene-spec";
import { autoPresentation, readPresentationPref, resolvePresentation, writePresentationPref } from "../src/player/presentation.ts";
import { readPref } from "../src/player/audio/prefs.ts";

const lesson = (subject: string, topic: string, title = topic, audience?: "child" | "teen" | "adult") => ({ page: { subject, topic }, title, ...(audience ? { audience } : {}) });

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("autoPresentation", () => {
  it("follows the lesson's audience", () => {
    expect(autoPresentation(lesson("storia", "I Germani", "x", "adult"))).toBe("academic");
    expect(autoPresentation(lesson("fisica", "Integrali di linea", "x", "teen"))).toBe("book");
    expect(autoPresentation(lesson("matematica", "Derivate", "x", "child"))).toBe("book");
  });

  it("without an audience: maths/physics on university topics only", () => {
    expect(autoPresentation(lesson("matematica", "Derivate e integrali"))).toBe("academic");
    expect(autoPresentation(lesson("fisica", "Principio zero e primo principio della termodinamica"))).toBe("academic");
    expect(autoPresentation(lesson("physics", "Entropy and the second law"))).toBe("academic");
    expect(autoPresentation(lesson("matematica", "Studio di funzione: dominio e simmetria"))).toBe("book");
    expect(autoPresentation(lesson("fisica", "I vasi comunicanti"))).toBe("book");
    expect(autoPresentation(lesson("storia", "Le derivate della lingua latina"))).toBe("book");
  });
});

describe("presentation setting", () => {
  it("automatic unless the user chose, and the choice wins over the lesson", () => {
    const s = memStore();
    expect(readPresentationPref(s)).toBe("auto");
    const adult = lesson("storia", "Roma", "Roma", "adult");
    expect(resolvePresentation(readPresentationPref(s), adult)).toBe("academic");
    writePresentationPref("book", s);
    expect(resolvePresentation(readPresentationPref(s), adult)).toBe("book");
    writePresentationPref("academic", s);
    expect(resolvePresentation(readPresentationPref(s), lesson("scienze", "I sensi", "I sensi", "child"))).toBe("academic");
    writePresentationPref("auto", s);
    expect(s.m.has("pv.presentation")).toBe(false);
    s.setItem("pv.presentation", "garbage");
    expect(readPresentationPref(s)).toBe("auto");
    expect(readPresentationPref(null)).toBe("auto");
  });

  it("Accademico has its own sound switch, off by default", () => {
    const s = memStore();
    expect(readPref("sounds", s)).toBe(true);
    expect(readPref("academicSounds", s)).toBe(false);
    s.setItem("pv.audio.sounds.academic", "1");
    expect(readPref("academicSounds", s)).toBe(true);
    expect(readPref("sounds", s)).toBe(true);
  });
});

describe("audienceFromGrade", () => {
  it("reads the analysis' free-text level in several languages", () => {
    expect(audienceFromGrade("scuola primaria, classe 4-5")).toBe("child");
    expect(audienceFromGrade("primary school, years 4-5")).toBe("child");
    expect(audienceFromGrade("小学校5年生")).toBe("child");
    expect(audienceFromGrade("scuola secondaria di primo grado, classe 3")).toBe("teen");
    expect(audienceFromGrade("scuola secondaria di secondo grado")).toBe("teen");
    expect(audienceFromGrade("lycée, classe de seconde")).toBe("teen");
    expect(audienceFromGrade("università, corso di fisica generale")).toBe("adult");
    expect(audienceFromGrade("scuola secondaria di secondo grado / università")).toBe("adult");
    expect(audienceFromGrade("Hochschule, Grundstudium")).toBe("adult");
    expect(audienceFromGrade("")).toBeUndefined();
    expect(audienceFromGrade(undefined)).toBeUndefined();
    expect(audienceFromGrade("libro di cucina")).toBeUndefined();
  });
});
