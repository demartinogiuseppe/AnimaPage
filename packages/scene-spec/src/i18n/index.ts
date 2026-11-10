// Message catalogs (decision D21): built-in it (the original texts), en, es, fr, de, pt; any other
// language gets a catalog the server translates once from English (server/src/i18n.ts), and English
// meanwhile. `t()` reads the UI catalog the web app installs at start (Italian until then).
import { de } from "./messages/de.ts";
import { en } from "./messages/en.ts";
import { es } from "./messages/es.ts";
import { fr } from "./messages/fr.ts";
import { it, type MessageKey } from "./messages/it.ts";
import { pt } from "./messages/pt.ts";
import { baseLang, DEFAULT_LOCALE } from "./locale.ts";

export * from "./locale.ts";
export * from "./labels.ts";
export type { MessageKey };

export type Catalog = Record<MessageKey, string>;
export type Vars = Record<string, string | number>;

export const CATALOGS: Readonly<Record<string, Catalog>> = { it, en, es, fr, de, pt };
export const MESSAGE_KEYS = Object.keys(it) as MessageKey[];
export const ENGLISH: Catalog = en;

/** Built-in catalog of a locale's language, if there is one. */
export function builtInCatalog(tag: string): Catalog | undefined {
  return CATALOGS[baseLang(tag)];
}

/** "{name}" placeholders filled from `vars`; unknown ones stay as they are. */
export function format(template: string, vars?: Vars): string {
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
}

let uiCatalog: Catalog = it;
let uiLang = DEFAULT_LOCALE;

/** Installs the UI language: its built-in catalog, the given (translated) one, else English. */
export function setUiLanguage(tag: string, catalog?: Catalog): void {
  uiLang = tag;
  uiCatalog = builtInCatalog(tag) ?? catalog ?? en;
}
export const uiLanguage = (): string => uiLang;

/** UI text in the current UI language. */
export function t(key: MessageKey, vars?: Vars): string {
  return format(uiCatalog[key] ?? en[key], vars);
}

/** Text of a catalog for the given locale (the server's lesson texts): built-in, translated, English. */
export function textIn(tag: string | undefined, key: MessageKey, vars?: Vars, translated?: Catalog): string {
  const cat = (tag ? builtInCatalog(tag) : it) ?? translated ?? en;
  return format(cat[key] ?? en[key], vars);
}

/** Placeholders of a template, sorted ("{a} {b}" -> ["a", "b"]). */
export function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

/**
 * Checks a translated catalog against the English one: an object with exactly the same keys, every
 * value a non-empty string with the same placeholders, no markup, and a sane length.
 */
export function validateCatalog(candidate: unknown, source: Catalog = en): { ok: true; catalog: Catalog } | { ok: false; errors: string[] } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { ok: false, errors: ["not an object"] };
  const c = candidate as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(source) as MessageKey[]) {
    const v = c[k];
    const src = source[k];
    if (typeof v !== "string" || !v.trim()) errors.push(`${k}: missing`);
    else if (placeholders(v).join() !== placeholders(src).join()) errors.push(`${k}: placeholders ${placeholders(v).join() || "none"} instead of ${placeholders(src).join() || "none"}`);
    else if (/[<>]/.test(v) && !/[<>]/.test(src)) errors.push(`${k}: markup`);
    else if (v.length > Math.max(src.length * 3, src.length + 40)) errors.push(`${k}: too long`);
  }
  for (const k of Object.keys(c)) if (!(k in source)) errors.push(`${k}: unknown key`);
  return errors.length ? { ok: false, errors } : { ok: true, catalog: c as Catalog };
}
