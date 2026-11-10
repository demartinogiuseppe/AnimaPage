// Decision D21: locale helpers, message catalogs and their validation, engine labels.
import { afterEach, describe, expect, it } from "vitest";
import { formatNum, formatPoint } from "../src/math/format.ts";
import {
  CATALOGS,
  defaultNoteNames,
  engineText,
  ENGLISH,
  isItalian,
  isRtl,
  languageName,
  MESSAGE_KEYS,
  normalizeLocale,
  numberMarks,
  placeholders,
  setDisplayLocale,
  setUiLanguage,
  speechUnits,
  t,
  textIn,
  validateCatalog,
} from "../src/i18n/index.ts";
import { SceneSpec } from "../src/index.ts";

afterEach(() => {
  setDisplayLocale(null);
  setUiLanguage("it-IT");
});

describe("locale validation", () => {
  it("accepts plain BCP-47 tags and canonicalises them", () => {
    expect(normalizeLocale("en-GB")).toBe("en-GB");
    expect(normalizeLocale("en_gb")).toBe("en-GB");
    expect(normalizeLocale("JA")).toBe("ja");
    expect(normalizeLocale("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(normalizeLocale("es-419")).toBe("es-419");
  });

  it("rejects free text, extensions and odd input", () => {
    for (const bad of ["", "english", "en GB", "en-GB; drop", "en-GB-u-ca-buddhist", "x-private", "<script>", "a".repeat(25), 42, null, undefined])
      expect(normalizeLocale(bad)).toBeNull();
  });

  it("derives a safe English language name, RTL and Italian flags", () => {
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("en-GB")).toBe("British English");
    expect(languageName("ar")).toBe("Arabic");
    expect(languageName("ja")).toMatch(/^[A-Za-z ()',-]+$/);
    expect(isRtl("ar-EG") && isRtl("he") && isRtl("fa") && isRtl("ur")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isItalian(undefined) && isItalian("it-CH") && !isItalian("en")).toBe(true);
  });
});

describe("numbers and reading time", () => {
  it("marks per locale, Italian fixed", () => {
    expect(numberMarks()).toEqual({ group: ".", decimal: "," });
    expect(numberMarks("en-US")).toEqual({ group: ",", decimal: "." });
    expect(numberMarks("de-DE")).toEqual({ group: ".", decimal: "," });
    expect(numberMarks("ar").decimal).toBe(".");
  });

  it("maths display follows the lesson locale", () => {
    expect(formatNum(-1.5)).toBe("−1,5");
    expect(formatPoint("V", 2, -1.5)).toBe("V(2; −1,5)");
    setDisplayLocale("en-GB");
    expect(formatNum(-1.5)).toBe("−1.5");
    expect(formatPoint("V", 2, -1.5)).toBe("V(2, −1.5)");
  });

  it("counts CJK and Thai text", () => {
    expect(speechUnits("uno due tre")).toBe(3);
    expect(speechUnits("富士山は日本で一番高い山です", "ja")).toBeCloseTo(14 * 0.4, 5);
    expect(speechUnits("富士山是日本最高的山", "zh")).toBeCloseTo(10 * 0.6, 5);
    expect(speechUnits("ภูเขาไฟฟูจิสูงที่สุด", "th")).toBeGreaterThan(1);
  });
});

describe("message catalogs", () => {
  it("every built-in catalog has all the keys with the English placeholders", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual(["de", "en", "es", "fr", "it", "pt"]);
    for (const [lang, cat] of Object.entries(CATALOGS)) {
      expect(Object.keys(cat).sort(), lang).toEqual([...MESSAGE_KEYS].sort());
      for (const k of MESSAGE_KEYS) {
        expect(cat[k].trim().length, `${lang} ${k}`).toBeGreaterThan(0);
        expect(placeholders(cat[k]), `${lang} ${k}`).toEqual(placeholders(ENGLISH[k]));
      }
      expect(validateCatalog(cat).ok, lang).toBe(true);
    }
  });

  it("keeps the original Italian texts", () => {
    expect(t("home.shoot")).toBe("Scatta una foto");
    expect(textIn(undefined, "lesson.aiDisclaimer")).toBe(
      "Lezione generata automaticamente con l'intelligenza artificiale a partire dalla pagina fotografata: può contenere errori, controlla sempre sul libro.",
    );
    setUiLanguage("en-US");
    expect(t("photo.uploading", { pct: 5, sent: "1 MB", total: "2 MB" })).toBe("Sending the photo… 5% (1 MB of 2 MB)");
    setUiLanguage("ja"); // no built-in catalog, none given: English
    expect(t("home.shoot")).toBe("Take a photo");
  });

  it("validates a translated catalog", () => {
    const good = Object.fromEntries(MESSAGE_KEYS.map((k) => [k, `X ${ENGLISH[k]}`]));
    expect(validateCatalog(good).ok).toBe(true);
    const errors = (c: unknown) => {
      const v = validateCatalog(c);
      return v.ok ? [] : v.errors;
    };
    const { ["home.shoot"]: _, ...missing } = good;
    expect(errors(missing)).toEqual(["home.shoot: missing"]);
    expect(errors({ ...good, "photo.elapsed": "Time: {time}" })[0]).toMatch(/placeholders/);
    expect(errors({ ...good, extra: "x" })).toEqual(["extra: unknown key"]);
    expect(errors({ ...good, "home.shoot": "y".repeat(200) })).toEqual(["home.shoot: too long"]);
    expect(errors({ ...good, "home.shoot": "<b>Foto</b>" })).toEqual(["home.shoot: markup"]);
    expect(errors(["a"])).toEqual(["not an object"]);
  });
});

describe("engine labels and the lesson language", () => {
  it("Italian table by default, English for other languages", () => {
    expect(engineText("solid.frustum")).toBe("Tronco di cono");
    expect(engineText("lab.floats", { p: 40 })).toBe("galleggia: immerso il 40%");
    expect(defaultNoteNames()).toBe("it");
    setDisplayLocale("ja");
    expect(engineText("solid.frustum")).toBe("Frustum");
    expect(defaultNoteNames()).toBe("en");
    setDisplayLocale("fr-FR");
    expect(defaultNoteNames()).toBe("it"); // Do Ré Mi
  });

  it("SceneSpec.lang is an optional, strict tag", () => {
    const base = SceneSpec.options.find((o) => o.shape.engine.value === "card")!;
    expect(base.shape.lang.safeParse("ja").success).toBe(true);
    expect(base.shape.lang.safeParse("zh-Hant-TW").success).toBe(true);
    expect(base.shape.lang.safeParse("japanese").success).toBe(false);
    expect(base.shape.lang.safeParse(undefined).success).toBe(true);
  });
});
