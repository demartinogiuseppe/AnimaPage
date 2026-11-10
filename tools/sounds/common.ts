// Shared paths and types of the storybook sound pipeline (fetch -> process -> listen -> accept).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOUNDS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SOUNDS_DIR, "..", "..");
export const CACHE_DIR = join(SOUNDS_DIR, "cache");
export const CANDIDATES_DIR = join(SOUNDS_DIR, "candidates");

export interface SourceFile {
  /** Local name in the cache (no extension). */
  id: string;
  /** STORY_SOUND_GROUPS id this file is meant to fill. */
  group: string;
  title: string;
  /** The page where the licence was read. */
  page: string;
  url: string;
  bytes: number;
}
export interface Source {
  id: string;
  name: string;
  author: string;
  licence: string;
  licenceUrl: string;
  licenceText: string;
  files: SourceFile[];
}
export interface Manifest {
  checked: string;
  sources: Source[];
}

/** One row of candidates/<theme>.json. `file` is relative to candidates/ and empty when rejected. */
export interface CandidateRow {
  group: string;
  file: string;
  source: string;
  author: string;
  licence: string;
  dur: number;
  peakDb: number;
  rmsDb: number;
  reason?: string;
}
export type Decisions = Record<string, "keep" | "discard">;

/** True when this module is the script being run (not imported by a test). */
export function isMain(metaUrl: string): boolean {
  const run = process.argv[1];
  return run !== undefined && resolve(fileURLToPath(metaUrl)).toLowerCase() === resolve(run).toLowerCase();
}
