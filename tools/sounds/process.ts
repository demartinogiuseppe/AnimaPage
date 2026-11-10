// Turns raw CC0 downloads (tools/sounds/cache) into listening candidates (tools/sounds/candidates):
// trim silence, normalise, loop ambience, encode OGG Vorbis mono 32 kHz, reject what is not good enough.
// Usage: pnpm sounds:process [--theme sea]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STORY_SOUND_GROUPS, STORY_THEMES } from "../../packages/scene-spec/src/storybook-sounds.ts";
import { CACHE_DIR, CANDIDATES_DIR, SOUNDS_DIR, isMain, type CandidateRow, type Decisions, type Manifest } from "./common.ts";

const RATE = 32000;
const SILENCE_DB = -50;
const SFX_PEAK_DB = -3;
const SFX_MAX_SEC = 4;
const SFX_FADE_SEC = 0.3;
const SFX_SOURCE_MAX_SEC = 120; // a longer recording is a scene, not an effect: cutting 4 s out of it would be arbitrary
const AMB_RMS_DB = -22;
const AMB_MIN_SEC = 8;
const AMB_MAX_SEC = 20;
const AMB_XFADE_SEC = 1.5;
const AMB_SOURCE_MAX_SEC = 300;
const CLIP_LEVEL = 0.995;
const CLIP_FRACTION = 0.001;
const QUIET_RMS_DB = -40;

export type Kind = "sfx" | "ambience";
export interface ProcessResult {
  dur: number;
  peakDb: number;
  rmsDb: number;
  reason?: string;
}

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round = (x: number, d = 2): number => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : -999);

/** Runs ffmpeg; a missing binary or a failed run becomes a clear Error. */
export function runFfmpeg(args: string[], input?: Buffer, bin = "ffmpeg"): Buffer {
  const r = spawnSync(bin, ["-v", "error", ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
  if (r.error) {
    const missing = (r.error as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(missing ? `ffmpeg not found (looked for "${bin}"): install ffmpeg and put it on the PATH` : `ffmpeg could not run: ${r.error.message}`);
  }
  if (r.status !== 0) throw new Error(`ffmpeg exited with ${r.status}: ${(r.stderr ?? Buffer.alloc(0)).toString().trim().slice(0, 300)}`);
  return r.stdout;
}

/** Decode any audio file to mono float samples (at `rate`, or at the file's own rate). */
export function decode(file: string, rate?: number): Float32Array {
  const buf = runFfmpeg(["-i", file, "-ac", "1", ...(rate ? ["-ar", String(rate)] : []), "-f", "f32le", "-"]);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength - (buf.byteLength % 4)));
}

function encode(samples: Float32Array, out: string): void {
  mkdirSync(dirname(out), { recursive: true });
  runFfmpeg(["-y", "-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", "-", "-c:a", "libvorbis", "-q:a", "2", out], Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
}

function peak(s: Float32Array): number {
  let m = 0;
  for (const v of s) m = Math.max(m, Math.abs(v));
  return m;
}
function rms(s: Float32Array): number {
  if (s.length === 0) return 0;
  let a = 0;
  for (const v of s) a += v * v;
  return Math.sqrt(a / s.length);
}

/** Cuts leading and trailing stretches whose 10 ms RMS is below -50 dBFS. */
function trim(s: Float32Array): Float32Array {
  const win = Math.round(RATE * 0.01);
  const thr = 10 ** (SILENCE_DB / 20);
  const loud = (i: number): boolean => rms(s.subarray(i, Math.min(i + win, s.length))) >= thr;
  let a = 0;
  while (a < s.length && !loud(a)) a += win;
  let b = s.length;
  while (b > a && !loud(Math.max(0, b - win))) b -= win;
  return s.slice(Math.min(a, s.length), Math.max(a, b));
}

/** Equal-power loop: the last `xf` samples of `seg` fade into its head, so the wrap-around is seamless. */
function loopCrossfade(seg: Float32Array, xf: number): Float32Array {
  const n = seg.length - xf;
  const out = seg.slice(0, n);
  for (let i = 0; i < xf; i++) {
    const t = ((i + 0.5) / xf) * (Math.PI / 2);
    out[i] = (seg[i] ?? 0) * Math.sin(t) + (seg[n + i] ?? 0) * Math.cos(t);
  }
  return out;
}

function scale(s: Float32Array, g: number): void {
  for (let i = 0; i < s.length; i++) s[i] = (s[i] ?? 0) * g;
}

/** Processes one file. Writes `output` (OGG) only when the result has no `reason`. */
export function processFile(input: string, kind: Kind, output: string): ProcessResult {
  const fail = (reason: string, s?: Float32Array): ProcessResult => ({
    dur: s ? round(s.length / RATE) : 0,
    peakDb: s ? round(db(peak(s))) : -999,
    rmsDb: s ? round(db(rms(s))) : -999,
    reason,
  });

  // Clipping is judged on the file's own samples, before any resampling smooths the flat tops.
  const raw = decode(input);
  let clipped = 0;
  for (const v of raw) if (Math.abs(v) >= CLIP_LEVEL) clipped++;
  if (raw.length > 0 && clipped / raw.length > CLIP_FRACTION) return fail(`clipped: ${((clipped / raw.length) * 100).toFixed(2)}% of samples at full scale`);

  const body = trim(decode(input, RATE));
  if (body.length < RATE * 0.05) return fail("mono-silent: nothing above -50 dBFS");
  const srcSec = body.length / RATE;

  let out: Float32Array;
  if (kind === "sfx") {
    if (srcSec > SFX_SOURCE_MAX_SEC) return fail(`too long: ${srcSec.toFixed(1)} s for an effect (max ${SFX_SOURCE_MAX_SEC} s)`, body);
    out = body.slice(0, Math.min(body.length, SFX_MAX_SEC * RATE));
    if (srcSec > SFX_MAX_SEC) {
      const f = Math.round(SFX_FADE_SEC * RATE);
      for (let i = 0; i < f; i++) out[out.length - f + i] = (out[out.length - f + i] ?? 0) * (1 - i / f);
    }
    const fin = Math.min(Math.round(0.01 * RATE), out.length); // 10 ms: a cut or trimmed start must not click
    for (let i = 0; i < fin; i++) out[i] = (out[i] ?? 0) * (i / fin);
    scale(out, 10 ** (SFX_PEAK_DB / 20) / peak(out));
  } else {
    if (srcSec > AMB_SOURCE_MAX_SEC) return fail(`too long: ${srcSec.toFixed(0)} s for an ambience (max ${AMB_SOURCE_MAX_SEC} s)`, body);
    const xf = Math.round(AMB_XFADE_SEC * RATE);
    if (body.length < AMB_MIN_SEC * RATE + xf) return fail(`too short: ${srcSec.toFixed(1)} s, a loop needs ${AMB_MIN_SEC + AMB_XFADE_SEC} s`, body);
    const len = Math.min(body.length, AMB_MAX_SEC * RATE);
    const start = Math.floor((body.length - len) / 2); // the middle: intros and fade-outs sit at the ends
    out = loopCrossfade(body.slice(start, start + len), xf);
    // RMS -22 dBFS, but never louder than -3 dBFS at the peak: nothing sharp for children.
    scale(out, Math.min(10 ** (AMB_RMS_DB / 20) / rms(out), 10 ** (SFX_PEAK_DB / 20) / peak(out)));
  }

  const result = { dur: round(out.length / RATE), peakDb: round(db(peak(out))), rmsDb: round(db(rms(out))) };
  if (db(rms(out)) < QUIET_RMS_DB) return { ...result, reason: `too quiet: RMS ${result.rmsDb} dBFS after normalising` };
  encode(out, output);
  return result;
}

const groupById = new Map(STORY_SOUND_GROUPS.map((g) => [g.id, g]));

function findCached(cacheDir: string, theme: string, id: string): string | undefined {
  const dir = join(cacheDir, theme);
  const name = existsSync(dir) ? readdirSync(dir).find((n) => n.startsWith(`${id}.`)) : undefined;
  return name ? join(dir, name) : undefined;
}

/** Only the themes of the story groups are valid: the name is used to build paths that get deleted. */
export function validateTheme(t: string): string {
  if (!(STORY_THEMES as readonly string[]).includes(t)) throw new Error(`unknown theme "${t}" (known: ${STORY_THEMES.join(", ")})`);
  return t;
}

export interface ProcessDirs {
  cacheDir: string;
  candidatesDir: string;
}

/**
 * Processes every cached file of the manifest into `outDir/<theme>/`. Numbers follow the position of the
 * file in the manifest (a rejected file keeps its number), so a candidate name always means the same sound.
 * One broken file is a rejected row, never an abort.
 */
export function processAll(manifest: Manifest, dirs: { cacheDir: string; outDir: string }, only?: string): Record<string, CandidateRow[]> {
  const sheets: Record<string, CandidateRow[]> = {};
  const counters = new Map<string, number>();
  for (const src of manifest.sources) {
    for (const f of src.files) {
      const grp = groupById.get(f.group);
      if (!grp) throw new Error(`sources.json: unknown group ${f.group}`);
      if (only && grp.theme !== only) continue;
      const cached = findCached(dirs.cacheDir, grp.theme, f.id);
      if (!cached) {
        console.warn(`skip ${f.id}: not in the cache (run sounds:fetch --approved)`);
        continue;
      }
      const n = (counters.get(f.group) ?? 0) + 1;
      counters.set(f.group, n);
      const rel = `${grp.theme}/${f.group}-${n}.ogg`;
      let res: ProcessResult;
      try {
        res = processFile(cached, grp.kind, join(dirs.outDir, rel));
      } catch (e) {
        res = { dur: 0, peakDb: -999, rmsDb: -999, reason: `decode failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400) };
      }
      const base = { group: f.group, source: f.page, author: src.author, licence: src.licence, dur: res.dur, peakDb: res.peakDb, rmsDb: res.rmsDb };
      if (res.reason) {
        console.log(`reject ${f.id} (${f.group}): ${res.reason}`);
        (sheets[grp.theme] ??= []).push({ ...base, file: "", reason: res.reason });
      } else {
        console.log(`ok     ${rel}  ${res.dur}s  peak ${res.peakDb}  rms ${res.rmsDb}`);
        (sheets[grp.theme] ??= []).push({ ...base, file: rel });
      }
    }
  }
  return sheets;
}

/**
 * Re-processes the themes that have files in the cache. Work happens in a temp dir inside candidatesDir and
 * is swapped in only when everything succeeded; themes without cached files are not touched; decisions are
 * kept for candidates that still exist.
 */
export function runProcess(manifest: Manifest, dirs: ProcessDirs, only?: string): { ok: number; rejected: number } {
  mkdirSync(dirs.candidatesDir, { recursive: true });
  const tmp = join(dirs.candidatesDir, `.tmp-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const sheets = processAll(manifest, { cacheDir: dirs.cacheDir, outDir: tmp }, only);
    for (const [theme, rows] of Object.entries(sheets)) {
      const dest = join(dirs.candidatesDir, theme);
      rmSync(dest, { recursive: true, force: true });
      if (existsSync(join(tmp, theme))) renameSync(join(tmp, theme), dest);
      else mkdirSync(dest, { recursive: true });
      writeFileSync(join(dirs.candidatesDir, `${theme}.json.new`), JSON.stringify(rows, null, 2) + "\n");
      renameSync(join(dirs.candidatesDir, `${theme}.json.new`), join(dirs.candidatesDir, `${theme}.json`));
      const decPath = join(dirs.candidatesDir, `${theme}.decisions.json`);
      if (existsSync(decPath)) {
        const live = new Set(rows.filter((r) => r.file).map((r) => r.file));
        const old = JSON.parse(readFileSync(decPath, "utf8")) as Decisions;
        writeFileSync(decPath, JSON.stringify(Object.fromEntries(Object.entries(old).filter(([k]) => live.has(k))), null, 2) + "\n");
      }
    }
    const all = Object.values(sheets).flat();
    return { ok: all.filter((r) => !r.reason).length, rejected: all.filter((r) => r.reason).length };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  try {
    const manifest = JSON.parse(readFileSync(join(SOUNDS_DIR, "sources.json"), "utf8")) as Manifest;
    const i = process.argv.indexOf("--theme");
    const only = i >= 0 ? validateTheme(process.argv[i + 1] ?? "") : undefined;
    const r = runProcess(manifest, { cacheDir: CACHE_DIR, candidatesDir: CANDIDATES_DIR }, only);
    console.log(`\n${r.ok} candidates ok, ${r.rejected} rejected`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
