// Lesson archive routes (D18):
//
//   GET    /api/lessons        200 LessonMeta[] (newest first, without the scene)
//   GET    /api/lessons/:id    200 Lesson (with the scene) | 404
//   PATCH  /api/lessons/:id    { title } -> 200 LessonMeta | 400 | 404
//   DELETE /api/lessons/:id    204 | 404
//
// Ids that are not lesson ids answer 404 before touching the file system.
import type { FastifyInstance } from "fastify";
import { cleanTitle, isLessonId, MAX_TITLE_LENGTH, type LessonStore } from "../lessons/store.ts";

const NOT_FOUND = { error: "Lezione non trovata." };
const BAD_TITLE = { error: `Scrivi un titolo (al massimo ${MAX_TITLE_LENGTH} caratteri).` };
/** A rename body is a short JSON object. */
const PATCH_BODY_LIMIT = 2048;

type IdParams = { Params: { id: string } };

export function lessonRoutes(app: FastifyInstance, store: LessonStore): void {
  app.get("/api/lessons", async (_req, reply) => {
    reply.header("cache-control", "no-cache");
    return store.list();
  });

  app.get<IdParams>("/api/lessons/:id", async (req, reply) => {
    const lesson = isLessonId(req.params.id) ? store.get(req.params.id) : undefined;
    if (!lesson) return reply.code(404).send(NOT_FOUND);
    reply.header("cache-control", "no-cache");
    return lesson;
  });

  app.patch<IdParams & { Body: unknown }>("/api/lessons/:id", { bodyLimit: PATCH_BODY_LIMIT }, async (req, reply) => {
    if (!isLessonId(req.params.id) || !store.has(req.params.id)) return reply.code(404).send(NOT_FOUND);
    const body = req.body;
    const title = body && typeof body === "object" ? cleanTitle((body as { title?: unknown }).title) : null;
    if (!title) return reply.code(400).send(BAD_TITLE);
    const meta = store.rename(req.params.id, title);
    return meta ?? reply.code(404).send(NOT_FOUND);
  });

  app.delete<IdParams>("/api/lessons/:id", async (req, reply) => {
    if (!isLessonId(req.params.id) || !store.delete(req.params.id)) return reply.code(404).send(NOT_FOUND);
    return reply.code(204).send();
  });
}
