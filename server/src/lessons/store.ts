// Lesson archive (D18): every lesson generated from a user photo is saved as one JSON file,
// server/data/lessons/<id>.json. Only the lesson (SceneSpec + a few derived fields) is stored:
// never the photo, never its hash. The folder is git-ignored (copyrighted page content).
//
// Writes are atomic (temp file + rename); unreadable or invalid files are skipped, not fatal.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SceneSpec } from "@pv/scene-spec";

export const DEFAULT_LESSONS_DIR = fileURLToPath(new URL("../../data/lessons/", import.meta.url));
export const MAX_TITLE_LENGTH = 120;

/** Lesson ids are UUIDs: anything else (e.g. "../x") never reaches the file system. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isLessonId = (id: string): boolean => ID_RE.test(id);

/** What the archive list shows (no scene body). */
export interface LessonMeta {
  id: string;
  /** ISO 8601. */
  createdAt: string;
  title: string;
  subject: string;
  topic: string;
  engine: SceneSpec["engine"];
  kind: SceneSpec["kind"];
  /** The book's page numbers, as printed ("116-117"). */
  pageNumbers?: string;
  /** Number of chapters. */
  chapters: number;
  /** True when generation fell back to a card (no 3D scene). */
  fallback: boolean;
}

export interface Lesson extends LessonMeta {
  scene: SceneSpec;
}

function metaOf(l: Lesson): LessonMeta {
  const { scene: _scene, ...meta } = l;
  return meta;
}

/** Trimmed, single-line title, or null when empty / too long. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= MAX_TITLE_LENGTH ? t : null;
}

export class LessonStore {
  constructor(readonly dir: string = DEFAULT_LESSONS_DIR) {}

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private write(l: Lesson): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = join(this.dir, `.${l.id}.${randomUUID().slice(0, 8)}.tmp`);
    writeFileSync(tmp, JSON.stringify(l));
    renameSync(tmp, this.file(l.id));
  }

  private read(id: string): Lesson | undefined {
    const file = this.file(id);
    if (!existsSync(file)) return undefined;
    try {
      const l = JSON.parse(readFileSync(file, "utf8")) as Lesson;
      if (l?.id !== id || typeof l.createdAt !== "string" || typeof l.title !== "string") return undefined;
      const scene = SceneSpec.safeParse(l.scene);
      return scene.success ? { ...l, scene: scene.data } : undefined;
    } catch {
      return undefined; // corrupted file: skipped
    }
  }

  save(scene: SceneSpec, opts: { fallback: boolean; now?: Date }): Lesson {
    const lesson: Lesson = {
      id: randomUUID(),
      createdAt: (opts.now ?? new Date()).toISOString(),
      title: scene.title,
      subject: scene.page.subject,
      topic: scene.page.topic,
      engine: scene.engine,
      kind: scene.kind,
      ...(scene.page.bookPage ? { pageNumbers: scene.page.bookPage } : {}),
      chapters: scene.chapters.length,
      fallback: opts.fallback,
      scene,
    };
    this.write(lesson);
    return lesson;
  }

  has(id: string): boolean {
    return isLessonId(id) && existsSync(this.file(id));
  }

  get(id: string): Lesson | undefined {
    return isLessonId(id) ? this.read(id) : undefined;
  }

  /** Newest first. */
  list(): LessonMeta[] {
    if (!existsSync(this.dir)) return [];
    const out: LessonMeta[] = [];
    for (const name of readdirSync(this.dir)) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      const l = isLessonId(id) ? this.read(id) : undefined;
      if (l) out.push(metaOf(l));
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** Renames the lesson (also the scene's title, shown by the player). */
  rename(id: string, title: string): LessonMeta | undefined {
    const l = this.get(id);
    const t = cleanTitle(title);
    if (!l || !t) return undefined;
    const next: Lesson = { ...l, title: t, scene: { ...l.scene, title: t } };
    this.write(next);
    return metaOf(next);
  }

  delete(id: string): boolean {
    if (!this.has(id)) return false;
    rmSync(this.file(id), { force: true });
    return true;
  }
}
