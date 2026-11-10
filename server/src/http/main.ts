// Server entry (`pnpm --filter @pv/server dev` / `start`). Reads server/.env if present.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMode } from "../index.ts";
import { DEFAULT_GEO_OUT_DIR, DEFAULT_PAGE_CACHE_DIR, defaultStages, PageCache } from "../pipeline/run.ts";
import { DEFAULT_LESSONS_DIR, LessonStore } from "../lessons/store.ts";
import { AvailabilityChecker, defaultChoice, loadRegistry } from "../llm/registry.ts";
import { CatalogTranslator, DEFAULT_MAX_CATALOGS } from "../i18n.ts";
import { createProvider } from "../llm/index.ts";
import { DEFAULT_LEDGER_PATH } from "../ledger.ts";
import { buildServer } from "./app.ts";
import { bindRefusal } from "./guard.ts";

const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
const PHOTOS_DIR = fileURLToPath(new URL("../../.cache/photos/", import.meta.url));

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const env = process.env;
const mode = readMode(env);
// AI models the app may choose per phase (server/config/llm_providers.yaml, D20).
const registry = loadRegistry();

const app = await buildServer({
  mode,
  stages: defaultStages(env, mode),
  // Live results are cached on disk (a live run takes about a minute); mock results only in memory.
  cache: new PageCache(mode === "live" ? DEFAULT_PAGE_CACHE_DIR : null),
  geoDir: DEFAULT_GEO_OUT_DIR,
  storePhotosDir: env.PAGINAVIVA_STORE_PHOTOS === "true" ? PHOTOS_DIR : null,
  // Lesson archive (D18), live and mock: server/data/lessons/ (git-ignored), or PAGINAVIVA_LESSONS_DIR.
  lessons: new LessonStore(env.PAGINAVIVA_LESSONS_DIR || DEFAULT_LESSONS_DIR),
  logger: { level: "info" },
  // Caps (docs/security.md): pipelines at once, uploads per device per hour.
  maxPipelines: Number(env.PAGINAVIVA_MAX_PIPELINES) || undefined,
  pagesPerHour: Number(env.PAGINAVIVA_PAGES_PER_HOUR) || undefined,
  ledgerPath: env.PAGINAVIVA_LEDGER || DEFAULT_LEDGER_PATH,
  llm: {
    registry,
    defaults: defaultChoice(env, registry),
    availability: new AvailabilityChecker({ env }),
    stagesFor: (choice) => defaultStages(env, mode, { registry, choice }),
  },
  // UI catalogs for languages without a built-in one (D21): translated once by the default LLM (live only).
  i18n: new CatalogTranslator(mode === "live" ? () => createProvider(env, { claudeCli: { model: "sonnet" } }) : null, undefined, undefined, {
    maxCatalogs: Number(env.PAGINAVIVA_I18N_MAX_CATALOGS) || DEFAULT_MAX_CATALOGS,
  }),
});

const port = Number(env.PAGINAVIVA_PORT) || 8787;
const host = env.PAGINAVIVA_HOST || "127.0.0.1";
const refusal = bindRefusal(host, env);
if (refusal) {
  app.log.error(refusal);
  process.exit(1);
}
await app.listen({ port, host });
app.log.info(`AnimaPage server in ${mode} mode`);
