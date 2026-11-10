// Downloads the CC0 files listed in sources.json into the git-ignored tools/sounds/cache/<theme>/.
//   pnpm sounds:fetch --dry        list files, sources and sizes; downloads nothing
//   pnpm sounds:fetch --approved   download (only after the user approved the --dry list)
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { STORY_SOUND_GROUPS } from "../../packages/scene-spec/src/storybook-sounds.ts";
import { CACHE_DIR, SOUNDS_DIR, isMain, type Manifest } from "./common.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const mb = (n: number): string => (n / 1e6).toFixed(2);

export interface Download {
  source: string;
  id: string;
  theme: string;
  group: string;
  url: string;
  bytes: number;
  dest: string;
}

export function planDownloads(m: Manifest, cacheDir = CACHE_DIR): Download[] {
  const themeOf = new Map(STORY_SOUND_GROUPS.map((g) => [g.id, g.theme]));
  return m.sources.flatMap((s) =>
    s.files.map((f) => {
      const theme = themeOf.get(f.group);
      if (!theme) throw new Error(`sources.json: unknown group ${f.group}`);
      // The id becomes a file name in the cache, the URL is fetched (docs/security.md, L8).
      if (!/^[a-z0-9-]+$/.test(f.id)) throw new Error(`sources.json: id ${JSON.stringify(f.id)} must be lowercase letters, digits and dashes`);
      if (new URL(f.url).protocol !== "https:") throw new Error(`sources.json: ${f.id}: the URL must be https`);
      return { source: s.name, id: f.id, theme, group: f.group, url: f.url, bytes: f.bytes, dest: join(cacheDir, theme, f.id + extname(new URL(f.url).pathname)) };
    }),
  );
}

export function dryReport(m: Manifest): string {
  const plan = planDownloads(m);
  const lines = plan.map((p) => `${p.theme}/${p.group}  ${p.id}  ${mb(p.bytes)} MB  ${p.url}  [${p.source}]`);
  const total = plan.reduce((a, p) => a + p.bytes, 0);
  return `${lines.join("\n")}\n\n${plan.length} files, ${mb(total)} MB total (nothing downloaded)`;
}

/** Downloads one file: timeout, no HTML pages, exact listed size, written to .part and renamed. */
export async function downloadOne(p: Download, fetchFn: typeof fetch = fetch): Promise<number> {
  const res = await fetchFn(p.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${p.url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new Error(`${p.url}: got an html page, not audio`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== p.bytes) throw new Error(`${p.url}: size ${buf.length} differs from the listed ${p.bytes}`);
  mkdirSync(dirname(p.dest), { recursive: true });
  const part = `${p.dest}.part`;
  try {
    writeFileSync(part, buf);
    renameSync(part, p.dest);
  } finally {
    rmSync(part, { force: true });
  }
  return buf.length;
}

/** Returns the process exit code. */
export async function run(args: string[], m: Manifest, fetchFn: typeof fetch = fetch, cacheDir = CACHE_DIR): Promise<number> {
  if (args.includes("--dry")) {
    console.log(dryReport(m));
    return 0;
  }
  if (!args.includes("--approved")) {
    console.error("Refusing to download: pass --approved once the user has approved the list (see `pnpm sounds:fetch --dry`).");
    return 1;
  }
  for (const p of planDownloads(m, cacheDir)) {
    if (existsSync(p.dest)) {
      console.log(`have ${p.dest}`);
      continue;
    }
    console.log(`got  ${p.dest} (${mb(await downloadOne(p, fetchFn))} MB)`);
  }
  return 0;
}

if (isMain(import.meta.url)) {
  const m = JSON.parse(readFileSync(join(SOUNDS_DIR, "sources.json"), "utf8")) as Manifest;
  try {
    process.exitCode = await run(process.argv.slice(2), m);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
