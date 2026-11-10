// Polite, cached downloads for the geo build (live mode only).
//
// Every request: one at a time, generic User-Agent, cached on disk forever (the data are
// versioned releases or tiles that never change). Sources and policies: docs/data-sources.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const USER_AGENT = "animapage/0.1 (private educational prototype)";

/** Download cache shared by every geo build; never inside the repo (some files are 40 MB). */
export const GEO_CACHE_DIR = join(tmpdir(), "pagina-viva-geo-cache");

/** Public Overpass API instances (wiki.openstreetmap.org/wiki/Overpass_API): the main FOSSGIS one, then Overpass Europe (dresel.systems, free, no key). */
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://ovp.dresel.systems/api/interpreter"];

export async function cachedBytes(name: string, url: string, init?: RequestInit, cacheDir = GEO_CACHE_DIR): Promise<Uint8Array> {
  const file = join(cacheDir, name);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const res = await fetch(url, { signal: AbortSignal.timeout(150_000), ...init, headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, bytes);
  return bytes;
}

export async function cachedText(name: string, url: string, init?: RequestInit, cacheDir = GEO_CACHE_DIR): Promise<string> {
  return new TextDecoder().decode(await cachedBytes(name, url, init, cacheDir));
}

/** Overpass usage policy: identify, no parallel queries, after an HTTP error pause 30 s before the next request. */
export async function overpass(name: string, ql: string, cacheDir = GEO_CACHE_DIR): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await cachedText(
        name,
        OVERPASS_URLS[(attempt - 1) % OVERPASS_URLS.length]!,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(`[out:json][timeout:120];${ql}`),
        },
        cacheDir,
      );
    } catch (e) {
      if (attempt >= 4) throw e;
      console.warn(`${(e as Error).message}; retrying in 30 s`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}
