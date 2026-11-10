// In-memory jobs: one per uploaded photo. Holds progress events and the final result,
// never the photo. Only the most recent jobs are kept.
import { randomUUID } from "node:crypto";
import type { PipelineResult } from "../pipeline/run.ts";
import type { ProgressEvent, SceneSpec } from "../pipeline/types.ts";

/** "chapter" (D22): the first chapter alone, while the rest of the lesson is being prepared. */
export type JobMessage =
  | { event: "progress"; data: ProgressEvent }
  | { event: "chapter"; data: { scene: SceneSpec } }
  | { event: "result"; data: PublicResult };

/** The result as sent over SSE: without the scene, which is fetched separately. */
export type PublicResult =
  | { status: "scene"; summary: string; fallback: boolean; cached: boolean; lessonId?: string }
  | { status: "retake"; hint: string; summary?: string; cached: boolean }
  | { status: "error"; message: string };

export function publicResult(r: PipelineResult): PublicResult {
  switch (r.status) {
    case "scene":
      return { status: "scene", summary: r.summary, fallback: r.fallback, cached: r.cached, ...(r.lessonId ? { lessonId: r.lessonId } : {}) };
    case "retake":
      return { status: "retake", hint: r.hint, summary: r.summary, cached: r.cached };
    case "error":
      return { status: "error", message: r.message };
  }
}

export interface Job {
  id: string;
  events: ProgressEvent[];
  /** First chapter sent ahead of the lesson (D22). */
  first?: SceneSpec;
  result?: PipelineResult;
  listeners: Set<(m: JobMessage) => void>;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly max = 100) {}

  create(): Job {
    const job: Job = { id: randomUUID(), events: [], listeners: new Set() };
    this.jobs.set(job.id, job);
    while (this.jobs.size > this.max) this.jobs.delete(this.jobs.keys().next().value!);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  progress(job: Job, e: ProgressEvent): void {
    job.events.push(e);
    for (const l of job.listeners) l({ event: "progress", data: e });
  }

  firstChapter(job: Job, scene: SceneSpec): void {
    job.first = scene;
    for (const l of job.listeners) l({ event: "chapter", data: { scene } });
  }

  finish(job: Job, r: PipelineResult): void {
    job.result = r;
    for (const l of job.listeners) l({ event: "result", data: publicResult(r) });
    job.listeners.clear();
  }
}
