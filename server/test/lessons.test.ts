import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/http/app.ts";
import { LessonStore, type Lesson, type LessonMeta } from "../src/lessons/store.ts";
import { PageCache, runPipeline } from "../src/pipeline/run.ts";
import { fakeStages, SCENE, syntheticPhoto } from "./pipeline-fakes.ts";

const tmpStore = () => new LessonStore(mkdtempSync(join(tmpdir(), "pv-lessons-")));

describe("lesson store", () => {
  it("saves, lists newest first, gets, renames and deletes", () => {
    const store = tmpStore();
    const a = store.save(SCENE, { fallback: false, now: new Date("2026-11-01T10:00:00Z") });
    const b = store.save({ ...SCENE, title: "Seconda" }, { fallback: true, now: new Date("2026-11-02T10:00:00Z") });

    expect(a).toMatchObject({
      createdAt: "2026-11-01T10:00:00.000Z",
      title: SCENE.title,
      subject: SCENE.page.subject,
      topic: SCENE.page.topic,
      engine: SCENE.engine,
      kind: SCENE.kind,
      chapters: SCENE.chapters.length,
      fallback: false,
    });
    expect(store.list().map((l) => l.id)).toEqual([b.id, a.id]);
    expect(store.list()[0]).not.toHaveProperty("scene");
    expect(store.list()[0]!.fallback).toBe(true);
    expect(store.get(a.id)!.scene).toEqual(SCENE);

    const renamed = store.rename(a.id, "  Il   mio titolo ");
    expect(renamed!.title).toBe("Il mio titolo");
    expect(store.get(a.id)!.scene.title).toBe("Il mio titolo");
    expect(store.rename(a.id, "   ")).toBeUndefined();
    expect(store.rename(a.id, "x".repeat(121))).toBeUndefined();

    expect(store.delete(a.id)).toBe(true);
    expect(store.delete(a.id)).toBe(false);
    expect(store.get(a.id)).toBeUndefined();
    expect(store.list().map((l) => l.id)).toEqual([b.id]);
  });

  it("stores only the lesson: no photo, no hash, no temp files left", () => {
    const store = tmpStore();
    const l = store.save(SCENE, { fallback: false });
    expect(readdirSync(store.dir)).toEqual([`${l.id}.json`]);
    const saved = JSON.parse(readFileSync(join(store.dir, `${l.id}.json`), "utf8")) as Lesson;
    expect(Object.keys(saved).sort()).toEqual(
      ["chapters", "createdAt", "engine", "fallback", "id", "kind", "scene", "subject", "title", "topic"].sort(),
    );
  });

  it("skips corrupted or invalid files", () => {
    const store = tmpStore();
    const ok = store.save(SCENE, { fallback: false });
    const broken = "11111111-1111-4111-8111-111111111111";
    const invalid = "22222222-2222-4222-8222-222222222222";
    writeFileSync(join(store.dir, `${broken}.json`), "{ not json");
    writeFileSync(join(store.dir, `${invalid}.json`), JSON.stringify({ id: invalid, createdAt: "x", title: "t", scene: { nope: 1 } }));
    writeFileSync(join(store.dir, "notes.json"), "{}");
    expect(store.list().map((l) => l.id)).toEqual([ok.id]);
    expect(store.get(broken)).toBeUndefined();
    expect(store.get(invalid)).toBeUndefined();
    expect(store.rename(broken, "Nuovo")).toBeUndefined();
    expect(store.delete(broken)).toBe(true); // the user can still remove it
  });

  it("refuses ids that are not lesson ids (no path traversal)", () => {
    const store = tmpStore();
    const outside = join(store.dir, "..", "victim.json");
    writeFileSync(outside, "{}");
    for (const id of ["../victim", "..\\victim", "victim", "", "a/b", "%2e%2e"]) {
      expect(store.get(id)).toBeUndefined();
      expect(store.has(id)).toBe(false);
      expect(store.delete(id)).toBe(false);
      expect(store.rename(id, "x")).toBeUndefined();
    }
    expect(existsSync(outside)).toBe(true);
  });
});

describe("pipeline saves lessons", () => {
  it("saves each new scene once; the same page again reuses the lesson; fallbacks are marked", async () => {
    const lessons = tmpStore();
    const cache = new PageCache(null);
    const photo = await syntheticPhoto(1);
    const first = await runPipeline(photo, { mode: "mock", stages: fakeStages(), cache, lessons });
    expect(first.status).toBe("scene");
    const id = (first as { lessonId?: string }).lessonId!;
    expect(lessons.get(id)!.scene).toEqual(SCENE);

    const again = await runPipeline(photo, { mode: "mock", stages: fakeStages(), cache, lessons });
    expect(again).toMatchObject({ cached: true, lessonId: id });
    expect(lessons.list()).toHaveLength(1);

    lessons.delete(id);
    const afterDelete = await runPipeline(photo, { mode: "mock", stages: fakeStages(), cache, lessons });
    const newId = (afterDelete as { lessonId?: string }).lessonId!;
    expect(newId).not.toBe(id);
    expect(lessons.has(newId)).toBe(true);

    const fb = await runPipeline(await syntheticPhoto(2), { mode: "mock", stages: fakeStages({ fallback: true }), cache, lessons });
    const fbId = (fb as { lessonId?: string }).lessonId!;
    expect(lessons.get(fbId)!.fallback).toBe(true);
  });
});

describe("lesson routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function server(lessons: LessonStore) {
    app = await buildServer({
      mode: "mock",
      stages: fakeStages(),
      cache: new PageCache(null),
      geoDir: mkdtempSync(join(tmpdir(), "pv-geo-")),
      lessons,
    });
    return app;
  }

  it("lists, gets, renames and deletes", async () => {
    const store = tmpStore();
    const older = store.save(SCENE, { fallback: false, now: new Date("2026-01-01T00:00:00Z") });
    const newer = store.save(SCENE, { fallback: true, now: new Date("2026-02-01T00:00:00Z") });
    const s = await server(store);

    const list = await s.inject({ method: "GET", url: "/api/lessons" });
    expect(list.statusCode).toBe(200);
    const metas = list.json() as LessonMeta[];
    expect(metas.map((m) => m.id)).toEqual([newer.id, older.id]);
    expect(metas[0]).not.toHaveProperty("scene");

    const one = await s.inject({ method: "GET", url: `/api/lessons/${older.id}` });
    expect(one.statusCode).toBe(200);
    expect((one.json() as Lesson).scene).toEqual(SCENE);

    const ren = await s.inject({ method: "PATCH", url: `/api/lessons/${older.id}`, headers: { "x-animapage": "1" }, payload: { title: "Rinominata" } });
    expect(ren.statusCode).toBe(200);
    expect(ren.json()).toMatchObject({ id: older.id, title: "Rinominata" });
    expect(store.get(older.id)!.title).toBe("Rinominata");

    for (const payload of [{ title: "" }, { title: 3 }, {}, { title: "x".repeat(121) }]) {
      const bad = await s.inject({ method: "PATCH", url: `/api/lessons/${older.id}`, headers: { "x-animapage": "1" }, payload });
      expect(bad.statusCode).toBe(400);
      expect((bad.json() as { error: string }).error).toMatch(/titolo/);
    }
    const huge = await s.inject({ method: "PATCH", url: `/api/lessons/${older.id}`, headers: { "x-animapage": "1" }, payload: { title: "x".repeat(5000) } });
    expect(huge.statusCode).toBe(413);

    const del = await s.inject({ method: "DELETE", url: `/api/lessons/${older.id}`, headers: { "x-animapage": "1" } });
    expect(del.statusCode).toBe(204);
    expect((await s.inject({ method: "GET", url: `/api/lessons/${older.id}` })).statusCode).toBe(404);
    expect((await s.inject({ method: "DELETE", url: `/api/lessons/${older.id}`, headers: { "x-animapage": "1" } })).statusCode).toBe(404);
  });

  it("answers 404 to unknown or unsafe ids", async () => {
    const s = await server(tmpStore());
    for (const id of ["nope", "..%2F..%2Fpackage", "%2e%2e", "11111111-1111-4111-8111-111111111111"]) {
      for (const method of ["GET", "DELETE"] as const) {
        expect((await s.inject({ method, url: `/api/lessons/${id}`, headers: { "x-animapage": "1" } })).statusCode).toBe(404);
      }
      expect((await s.inject({ method: "PATCH", url: `/api/lessons/${id}`, headers: { "x-animapage": "1" }, payload: { title: "x" } })).statusCode).toBe(404);
    }
  });

  it("an uploaded photo becomes a lesson and its result carries the id", async () => {
    const store = tmpStore();
    const s = await server(store);
    const BOUNDARY = "----pvlessons";
    const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const up = await s.inject({
      method: "POST",
      url: "/api/pages",
      headers: { "x-animapage": "1", "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      payload: Buffer.concat([Buffer.from(head), await syntheticPhoto(3), Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    });
    const { id } = up.json() as { id: string };
    const ev = await s.inject({ method: "GET", url: `/api/pages/${id}/events` });
    const result = JSON.parse(/event: result\ndata: (.*)/.exec(ev.body)![1]!) as { lessonId: string };
    expect(store.get(result.lessonId)!.scene).toEqual(SCENE);
    expect(((await s.inject({ method: "GET", url: "/api/lessons" })).json() as LessonMeta[]).map((m) => m.id)).toEqual([result.lessonId]);
  });
});
