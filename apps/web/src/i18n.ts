// Language of the app (decision D21): the first valid tag of navigator.languages, or the choice made in
// Impostazioni ("pv.lang" in localStorage). It sets the UI catalog, <html lang> and dir="rtl", and travels
// with every photo so the lesson is written and read in that language. Built-in catalogs: it, en, es, fr,
// de, pt; any other language asks the server for its translated catalog (GET /api/i18n/<lang>), kept on
// the device, and shows English until it arrives.
import { builtInCatalog, CATALOGS, isRtl, normalizeLocale, numberMarks, setUiLanguage, t, uiLanguage, validateCatalog, type Catalog, type MessageKey } from "@pv/scene-spec/i18n";

const KEY = "pv.lang";
const CACHE_PREFIX = "pv.i18n.";
/** Languages offered in Impostazioni besides "automatic" (any other one still works automatically). */
export const LANGUAGE_CHOICES = ["it", "en", "es", "fr", "de", "pt", "nl", "pl", "ro", "el", "ru", "uk", "tr", "ar", "he", "fa", "hi", "zh", "ja", "ko"] as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage disabled: this page only */
  }
}

/** First valid BCP-47 tag of the browser's languages; Italian when there is none. */
export function detectLocale(langs: readonly string[] = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language])): string {
  for (const l of langs) {
    const tag = normalizeLocale(l);
    if (tag) return tag;
  }
  return "it-IT";
}

/** The language chosen in Impostazioni, or null for "automatic". */
export function storedLanguage(): string | null {
  return normalizeLocale(read(KEY));
}
export function setStoredLanguage(tag: string | null): void {
  write(KEY, tag);
}

/** The locale the app uses and sends with each photo. */
export const appLocale = (): string => storedLanguage() ?? detectLocale();

/** "1,4" in Italian, "1.4" in English: the UI's decimal mark. */
export const uiDecimal = (s: string): string => s.replace(".", numberMarks(uiLanguage()).decimal);

/**
 * A message of the server (always Italian on the wire) in the UI language, through the "server.*"
 * keys of the catalog; unknown messages (e.g. a retake hint written by the model) stay as they are.
 */
export function serverText(message: string): string {
  for (const [k, v] of Object.entries(CATALOGS.it!)) if (k.startsWith("server.") && v === message) return t(k as MessageKey);
  return message;
}

/** The translated catalog of the UI language (for an exported lesson); null for the built-in ones. */
export function currentCatalog(): Catalog | null {
  const tag = uiLanguage();
  return builtInCatalog(tag) ? null : (cached(tag.split("-")[0]!) ?? null);
}

/** True while the app waits for the server's translation of its language (English meanwhile). */
let pending = false;
export const catalogPending = (): boolean => pending;

function cached(tag: string): Catalog | undefined {
  try {
    const v = validateCatalog(JSON.parse(read(CACHE_PREFIX + tag) ?? "null"));
    return v.ok ? v.catalog : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Installs the app language. For a language without a built-in catalog, `onCatalog` is called once
 * the server's translation arrives (the caller re-renders the screen).
 */
export function initI18n(onCatalog?: () => void): void {
  const tag = appLocale();
  const root = document.documentElement;
  root.lang = tag;
  root.dir = isRtl(tag) ? "rtl" : "ltr";
  const base = tag.split("-")[0]!;
  if (builtInCatalog(tag)) return setUiLanguage(tag);
  setUiLanguage(tag, cached(base));
  if (cached(base)) return;
  pending = true;
  void fetchCatalog(tag, base, onCatalog);
}

/** Polls GET /api/i18n/<lang> while the server translates (202), at most ~3 minutes. */
async function fetchCatalog(tag: string, base: string, onCatalog?: () => void, tries = 36): Promise<void> {
  try {
    // The header: the server's request guard wants it here, since this GET may start a translation.
    const res = await fetch(new URL(`api/i18n/${encodeURIComponent(tag)}`, document.baseURI), { headers: { "x-animapage": "1" } });
    if (res.status === 202 && tries > 0) {
      setTimeout(() => void fetchCatalog(tag, base, onCatalog, tries - 1), 5000);
      return;
    }
    if (!res.ok) return void (pending = false);
    const v = validateCatalog(((await res.json()) as { messages?: unknown }).messages);
    pending = false;
    if (!v.ok) return;
    write(CACHE_PREFIX + base, JSON.stringify(v.catalog));
    setUiLanguage(tag, v.catalog);
    onCatalog?.();
  } catch {
    /* offline or no server: English stays */
  }
}

/** Name of a language in that language ("日本語"), for the picker. */
export function nativeLanguageName(tag: string): string {
  try {
    const n = new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
    return n.charAt(0).toLocaleUpperCase(tag) + n.slice(1);
  } catch {
    return tag;
  }
}
