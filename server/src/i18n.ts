// UI catalogs for languages without a built-in one (decision D21): the English catalog is translated
// ONCE by the configured LLM (one structured call), validated (same keys, same placeholders, sane
// lengths) and kept in server/data/i18n/<lang>.json. Until it exists the app shows English, and the
// lesson texts the server writes (disclaimers, card fallback) are English too.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtInCatalog, ENGLISH, languageName, normalizeLocale, validateCatalog, type Catalog } from "@pv/scene-spec/i18n";
import type { LlmProvider, StructuredRequest } from "./llm/types.ts";

export const I18N_DIR = fileURLToPath(new URL("../data/i18n/", import.meta.url));
/** A failed translation is tried again only after this long (no retry storm on every page load). */
const RETRY_AFTER_MS = 10 * 60_000;
/** At most this many translated catalogs on disk (docs/security.md, H2): PAGINAVIVA_I18N_MAX_CATALOGS. */
export const DEFAULT_MAX_CATALOGS = 40;

const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const SCRIPTS = new Intl.DisplayNames(["en"], { type: "script", fallback: "none" });
/** A catalog key whose language (and script, if any) Intl knows: no translation for invented tags. */
function knownLanguage(key: string): boolean {
  const [lang, script] = key.split("-");
  try {
    return LANGUAGES.of(lang!) !== undefined && (script === undefined || (script !== "Zzzz" && SCRIPTS.of(script) !== undefined));
  } catch {
    return false;
  }
}

/** File name of a language: language + script, without the region ("ja", "zh-Hant", "pt" never: built in). */
export function catalogKey(locale: string): string {
  return locale
    .split("-")
    .filter((p, i) => i === 0 || /^[A-Z][a-z]{3}$/.test(p))
    .join("-");
}

const mem = new Map<string, Catalog>();

function readCatalog(key: string, dir: string): Catalog | undefined {
  const hit = mem.get(`${dir}|${key}`);
  if (hit) return hit;
  const file = join(dir, `${key}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const v = validateCatalog((JSON.parse(readFileSync(file, "utf8")) as { messages?: unknown }).messages);
    if (!v.ok) return undefined;
    mem.set(`${dir}|${key}`, v.catalog);
    return v.catalog;
  } catch {
    return undefined;
  }
}

/** The translated catalog of a locale, if the server has one (built-in languages: undefined). */
export function lessonCatalog(locale: string, dir = I18N_DIR): Catalog | undefined {
  const tag = normalizeLocale(locale);
  if (!tag || builtInCatalog(tag)) return undefined;
  return readCatalog(catalogKey(tag), dir);
}

export const TRANSLATE_SYSTEM =
  "You translate the user-interface texts of an educational app for children and families (it turns a photographed book page into an animated 3D lesson with a voice). Answer only through the structured output.";

export const TRANSLATE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["messages"],
  properties: { messages: { type: "object", additionalProperties: { type: "string" } } },
};

/** One structured call: the whole English catalog, translated value by value. */
export function translationRequest(locale: string): StructuredRequest {
  const name = languageName(locale);
  return {
    system: TRANSLATE_SYSTEM,
    prompt: [
      `Translate every value of this JSON object from English into ${name} (${locale}). Return { "messages": { ... } } with exactly the same keys.`,
      "Rules: keep each {placeholder} exactly as written (same name, in braces); keep the symbols ← ▸ ▲ ✥ · « » and leading or trailing spaces;",
      "keep product and brand names as they are (Pagina Viva, Claude, Gemini, Ollama, LM Studio, YouTube, Wikimedia Commons, Google Play, Chrome, Android, WebGL, Wi-Fi, Ctrl+V, WASD, JPEG, PNG, AR, MB);",
      `short, friendly, natural ${name}, addressing the user informally; keys starting with "lesson." are notes printed inside a lesson; do not add explanations.`,
      "",
      JSON.stringify(ENGLISH),
    ].join("\n"),
    jsonSchema: TRANSLATE_SCHEMA,
  };
}

export type CatalogStatus = { status: "ready"; catalog: Catalog } | { status: "pending" } | { status: "unavailable"; reason: string };

/**
 * Serves translated catalogs. Translations: only for known languages, one at a time (others answer
 * "pending" and start on a later request), and none once `maxCatalogs` catalogs are on disk.
 */
export class CatalogTranslator {
  private readonly running = new Map<string, Promise<void>>();
  private readonly failedAt = new Map<string, number>();

  constructor(
    /** null: no live LLM (mock mode): only catalogs already on disk are served. */
    private readonly provider: (() => LlmProvider) | null,
    private readonly dir = I18N_DIR,
    private readonly log: (msg: string) => void = (m) => console.warn(m),
    private readonly limits: { maxCatalogs: number } = { maxCatalogs: DEFAULT_MAX_CATALOGS },
  ) {}

  /** Built-in or translated catalog; otherwise starts the translation (live) and answers "pending". */
  get(locale: string): CatalogStatus {
    const tag = normalizeLocale(locale);
    if (!tag) return { status: "unavailable", reason: "invalid locale" };
    const built = builtInCatalog(tag);
    if (built) return { status: "ready", catalog: built };
    const key = catalogKey(tag);
    const cached = readCatalog(key, this.dir);
    if (cached) return { status: "ready", catalog: cached };
    if (!this.provider) return { status: "unavailable", reason: "no translation in test mode" };
    if (this.running.has(key)) return { status: "pending" };
    if (!knownLanguage(key)) return { status: "unavailable", reason: "unknown language" };
    if (this.catalogCount() >= this.limits.maxCatalogs) return { status: "unavailable", reason: "catalog limit reached" };
    if (this.running.size > 0) return { status: "pending" };
    if (Date.now() - (this.failedAt.get(key) ?? -Infinity) < RETRY_AFTER_MS) return { status: "unavailable", reason: "translation failed recently" };
    const job = this.translate(tag, key).finally(() => this.running.delete(key));
    this.running.set(key, job);
    return { status: "pending" };
  }

  private catalogCount(): number {
    try {
      return readdirSync(this.dir).filter((f) => f.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  /** Resolves when a running translation ends (tests). */
  async settle(locale: string): Promise<void> {
    const tag = normalizeLocale(locale);
    if (tag) await this.running.get(catalogKey(tag));
  }

  private async translate(tag: string, key: string): Promise<void> {
    const t0 = Date.now();
    try {
      const res = await this.provider!().generateStructured(translationRequest(tag));
      const v = validateCatalog((res.data as { messages?: unknown } | null)?.messages);
      if (!v.ok) throw new Error(`invalid translation: ${v.errors.slice(0, 5).join("; ")}${v.errors.length > 5 ? ` (+${v.errors.length - 5})` : ""}`);
      mkdirSync(this.dir, { recursive: true });
      const out = { lang: key, createdAt: new Date().toISOString(), model: res.model, from: "en", messages: v.catalog };
      writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(out, null, 2));
      mem.set(`${this.dir}|${key}`, v.catalog);
      this.log(`[i18n] ${key}: catalog translated in ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (e) {
      this.failedAt.set(key, Date.now());
      this.log(`[i18n] ${key}: translation failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    }
  }
}
