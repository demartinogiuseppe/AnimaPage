// Fastify app: photo upload -> pipeline job -> progress over Server-Sent Events -> SceneSpec.
//
//   POST /api/pages               multipart field "photo" (+ optional "llm": per-phase model choice,
//                                 "locale": the user's language, BCP-47, D21) -> 202 { id }
//   GET  /api/i18n/:lang          UI catalog of a language: 200 { lang, messages } | 202 being translated | 404
//   GET  /api/providers           configured AI models per phase, with availability (D20)
//   GET  /api/pages/:id/events    text/event-stream: "progress" events, maybe one "chapter" (the first
//                                 chapter ahead of the lesson, D22), then one "result"
//   GET  /api/pages/:id/scene     200 SceneSpec | 202 running | 422 retake/error
//   GET  /api/health              { ok, mode }
//   /api/lessons[/:id]            lesson archive (./lessons.ts)
//   GET  /cache/geo/*             geodata built on demand (live mode)
//   GET  /cache/art/*             public-domain artwork images (server/src/art)
//
// No CORS: the web app reaches the server through the Vite proxy. Every request passes the guard of
// ./guard.ts (Host, Origin, the X-AnimaPage header on state-changing calls; docs/security.md).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { normalizeLocale } from "@pv/scene-spec/i18n";
import type { CatalogTranslator } from "../i18n.ts";
import { checkImage, MAX_INPUT_PIXELS } from "../image.ts";
import { choiceTag, parseChoice, PHASES, type AvailabilityChecker, type LlmChoice, type PhaseChoice, type ProviderEntry } from "../llm/registry.ts";
import { MESSAGES, runPipeline, type PageCache, type PipelineStages } from "../pipeline/run.ts";
import type { Mode } from "../pipeline/types.ts";
import type { LessonStore } from "../lessons/store.ts";
import { clientAddress, registerGuard } from "./guard.ts";
import { JobStore, publicResult, type JobMessage } from "./jobs.ts";
import { lessonRoutes } from "./lessons.ts";

export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Pipelines running at once (each one spawns LLM CLIs and a headless Chrome): PAGINAVIVA_MAX_PIPELINES. */
export const DEFAULT_MAX_PIPELINES = 1;
/** Photo uploads per client address per hour: PAGINAVIVA_PAGES_PER_HOUR. */
export const DEFAULT_PAGES_PER_HOUR = 60;
const HOUR_MS = 3600_000;
const BUSY_RETRY_S = 30;
const KEEPALIVE_MS = 15_000;

export interface ServerOptions {
  mode: Mode;
  stages: PipelineStages;
  cache?: PageCache;
  /** Folder served at /cache/geo/. */
  geoDir: string;
  /** Folder served at /cache/art/ (default: "art" next to geoDir). */
  artDir?: string;
  storePhotosDir?: string | null;
  /** Lesson archive: scenes from photos are saved there and served under /api/lessons. */
  lessons?: LessonStore;
  maxUploadBytes?: number;
  /** At most this many pipelines at once; one more upload gets 429 (default DEFAULT_MAX_PIPELINES). */
  maxPipelines?: number;
  /** POST /api/pages per client address per hour (default DEFAULT_PAGES_PER_HOUR). */
  pagesPerHour?: number;
  logger?: FastifyServerOptions["logger"];
  /** AI models per phase (D20): the configured list, its availability, and stages for a choice. */
  llm?: {
    registry: readonly ProviderEntry[];
    /** What PAGINAVIVA_LLM gives every phase (null: not in the registry). */
    defaults: PhaseChoice | null;
    availability: AvailabilityChecker;
    stagesFor(choice: LlmChoice): PipelineStages;
  };
  /** UI catalogs of languages without a built-in one (D21); absent = built-in catalogs only. */
  i18n?: CatalogTranslator;
  /** Ledger file for the pipeline's own line per lesson (D22: time to the first chapter and to the lesson). */
  ledgerPath?: string;
}

export const MODEL_REJECTED = "Il modello AI scelto non è disponibile su questo server: apri Impostazioni e scegline un altro.";
export const LOCALE_REJECTED = "La lingua scelta non è valida: apri Impostazioni e scegline un'altra.";
export const PIPELINES_BUSY = "Sto già preparando un'altra lezione. Riprova tra un minuto.";
export const RATE_LIMITED = "Hai inviato molte foto in poco tempo. Riprova più tardi.";
export const TOO_MANY_PIXELS = `La foto ha troppi pixel (massimo ${MAX_INPUT_PIXELS / 1_000_000} megapixel).`;

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const maxUploadBytes = opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  // JSON bodies (lesson renames) stay small; photo uploads have their own multipart limits below.
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  const jobs = new JobStore();
  registerGuard(app);
  const maxPipelines = opts.maxPipelines ?? DEFAULT_MAX_PIPELINES;
  const pagesPerHour = opts.pagesPerHour ?? DEFAULT_PAGES_PER_HOUR;
  let running = 0;
  /** Upload times per client address within the last hour. */
  const uploads = new Map<string, number[]>();

  await app.register(multipart);
  mkdirSync(opts.geoDir, { recursive: true });
  await app.register(fastifyStatic, { root: opts.geoDir, prefix: "/cache/geo/", decorateReply: false });
  const artDir = opts.artDir ?? join(opts.geoDir, "..", "art");
  mkdirSync(artDir, { recursive: true });
  await app.register(fastifyStatic, { root: artDir, prefix: "/cache/art/", decorateReply: false });

  app.get("/api/health", async () => ({ ok: true, mode: opts.mode }));
  if (opts.lessons) lessonRoutes(app, opts.lessons);

  app.get("/api/providers", async () => {
    const llm = opts.llm;
    return {
      mode: opts.mode,
      phases: PHASES,
      defaults: Object.fromEntries(PHASES.map((p) => [p.id, llm?.defaults ?? null])),
      providers: llm ? await llm.availability.status(llm.registry) : [],
    };
  });

  app.get<{ Params: { lang: string } }>("/api/i18n/:lang", async (req, reply) => {
    const lang = normalizeLocale(req.params.lang);
    if (!lang) return reply.code(400).send({ error: LOCALE_REJECTED });
    const r = opts.i18n?.get(lang) ?? { status: "unavailable" as const, reason: "no translator" };
    if (r.status === "ready") return { lang, messages: r.catalog };
    return reply.code(r.status === "pending" ? 202 : 404).send({ status: r.status });
  });

  app.post("/api/pages", async (req, reply) => {
    // Caps (docs/security.md, H2): uploads per address per hour; below, the number of running pipelines.
    const now = Date.now();
    const who = clientAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"]);
    const times = (uploads.get(who) ?? []).filter((t) => now - t < HOUR_MS);
    if (times.length >= pagesPerHour) {
      reply.header("retry-after", String(Math.ceil((times[0]! + HOUR_MS - now) / 1000)));
      return reply.code(429).send({ error: RATE_LIMITED });
    }
    times.push(now);
    uploads.set(who, times);
    let data: Buffer | undefined;
    let llmRaw: string | undefined;
    let localeRaw: string | undefined;
    try {
      // Optional text field "llm" (the per-phase model choice, D20) and the file field "photo".
      for await (const part of req.parts({ limits: { fileSize: maxUploadBytes, files: 1, fields: 4, fieldSize: 4096 } })) {
        if (part.type === "file") data = await part.toBuffer();
        else if (part.fieldname === "llm" && typeof part.value === "string") llmRaw = part.value;
        else if (part.fieldname === "locale" && typeof part.value === "string") localeRaw = part.value;
      }
      if (!data) return reply.code(400).send({ error: "Nessuna foto ricevuta." });
    } catch (e) {
      if (e instanceof app.multipartErrors.RequestFileTooLargeError) {
        const mb = Math.round(maxUploadBytes / 1024 / 1024);
        return reply.code(413).send({ error: `La foto è troppo grande (massimo ${mb} MB).` });
      }
      if (e instanceof app.multipartErrors.InvalidMultipartContentTypeError)
        return reply.code(400).send({ error: "Nessuna foto ricevuta." });
      throw e;
    }
    const image = await checkImage(data);
    if (image === "tooBig") return reply.code(413).send({ error: TOO_MANY_PIXELS });
    if (image === "bad") return reply.code(415).send({ error: MESSAGES.badImage });
    // The user's language (D21): a strict BCP-47 tag or nothing; it reaches the prompts only as the tag
    // and its Intl.DisplayNames English name.
    const locale = localeRaw === undefined || localeRaw === "" ? undefined : normalizeLocale(localeRaw);
    if (locale === null) return reply.code(400).send({ error: LOCALE_REJECTED });

    // Mock mode replays recordings whatever the choice; live mode accepts only configured entries.
    let stages = opts.stages;
    let llmTag = "";
    if (opts.mode === "live" && opts.llm && llmRaw) {
      const parsed = parseChoice(llmRaw, opts.llm.registry, opts.llm.defaults);
      if (!parsed.ok) {
        req.log.warn(`rejected model choice: ${parsed.error}`);
        return reply.code(400).send({ error: MODEL_REJECTED });
      }
      llmTag = choiceTag(parsed.choice);
      if (llmTag) stages = opts.llm.stagesFor(parsed.choice);
    }

    if (running >= maxPipelines) {
      reply.header("retry-after", String(BUSY_RETRY_S));
      return reply.code(429).send({ error: PIPELINES_BUSY });
    }
    const job = jobs.create();
    running++;
    runPipeline(data, {
      mode: opts.mode,
      stages,
      llmTag,
      ...(locale ? { locale } : {}),
      cache: opts.cache,
      storePhotosDir: opts.storePhotosDir,
      lessons: opts.lessons,
      ...(opts.ledgerPath ? { ledgerPath: opts.ledgerPath } : {}),
      onProgress: (e) => jobs.progress(job, e),
      onFirstChapter: (scene) => jobs.firstChapter(job, scene),
    })
      .then((r) => jobs.finish(job, r))
      .catch((e: unknown) => {
        req.log.error(`pipeline crashed: ${e instanceof Error ? e.message : String(e)}`);
        jobs.finish(job, { status: "error", stage: "generate", message: MESSAGES.generateFail });
      })
      .finally(() => running--);
    return reply.code(202).send({ id: job.id });
  });

  app.get<{ Params: { id: string } }>("/api/pages/:id/events", (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "Lezione non trovata." });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (m: JobMessage) => res.write(`event: ${m.event}\ndata: ${JSON.stringify(m.data)}\n\n`);
    for (const e of job.events) send({ event: "progress", data: e });
    if (job.first) send({ event: "chapter", data: { scene: job.first } });
    if (job.result) {
      send({ event: "result", data: publicResult(job.result) });
      res.end();
      return;
    }
    const keepalive = setInterval(() => res.write(": ping\n\n"), KEEPALIVE_MS);
    const listener = (m: JobMessage) => {
      send(m);
      if (m.event === "result") cleanup(true);
    };
    const cleanup = (end: boolean) => {
      clearInterval(keepalive);
      job.listeners.delete(listener);
      if (end) res.end();
    };
    job.listeners.add(listener);
    req.raw.on("close", () => cleanup(false));
  });

  app.get<{ Params: { id: string } }>("/api/pages/:id/scene", async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "Lezione non trovata." });
    const r = job.result;
    if (!r) return reply.code(202).send({ status: "running" });
    if (r.status === "scene") return r.scene;
    return reply.code(422).send(publicResult(r));
  });

  return app;
}
