// JSON-over-HTTP client for the enrichment sources (Wikipedia, Wikidata, Commons).
//
// - live: disk cache (server/.cache/http/<host>/<key>.json, TTL) -> network; with
//   `record` every response is also written to fixtures/http/ for offline replay.
// - mock: fixtures/http/ only; a missing recording is an error (no network, ever).
//
// Wikimedia rate limits (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits,
// checked 2026-11-03): 10 requests/min for clients identified only by IP, 200/min for
// bots with a compliant User-Agent (contact e-mail or URL). The default User-Agent has
// no contact (no personal data is sent), so requests are serialised and kept under 9 in any
// 60 s window (bursts are allowed by the page); HTTP 429/503 are retried after Retry-After
// (or >= 5 s, as the page says). Other hosts (YouTube) are not throttled here: their limit is
// a daily quota, counted in `quotaUnits` and saved by the cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Mode } from "../pipeline/types.ts";

export const DEFAULT_HTTP_CACHE_DIR = fileURLToPath(new URL("../../.cache/http/", import.meta.url));
export const DEFAULT_HTTP_FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/http/", import.meta.url));

export interface HttpRecord {
  url: string;
  /** ISO time of the real request; Source.accessed is derived from it. */
  fetchedAt: string;
  status: number;
  body: unknown;
}

export interface HttpResult {
  body: unknown;
  fetchedAt: string;
  /** True when no network request was made (cache or fixture). */
  cached: boolean;
}

export class HttpError extends Error {
  constructor(
    readonly code: "fixture_missing" | "http_status" | "network" | "bad_json",
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface HttpClientOptions {
  mode: Mode;
  /** null disables the cache. */
  cacheDir?: string | null;
  fixturesDir?: string;
  /** Write every response (also cache hits) into fixturesDir. Live mode only. */
  record?: boolean;
  userAgent: string;
  requestsPerMinute: number;
  cacheTtlDays: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxRetries?: number;
}

export function urlKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function recordPath(dir: string, url: string): string {
  return join(dir, new URL(url).host, `${urlKey(url)}.json`);
}

function readRecord(dir: string, url: string): HttpRecord | undefined {
  const p = recordPath(dir, url);
  if (!existsSync(p)) return undefined;
  const rec = JSON.parse(readFileSync(p, "utf8")) as HttpRecord;
  return rec.url === url ? rec : undefined;
}

function writeRecord(dir: string, rec: HttpRecord): void {
  const p = recordPath(dir, rec.url);
  mkdirSync(join(dir, new URL(rec.url).host), { recursive: true });
  writeFileSync(p, JSON.stringify(rec, null, 1) + "\n");
}

/** Shared by every client in the process: all Wikimedia hosts count towards one limit (conservative). */
const recent: number[] = [];
const WIKIMEDIA_HOST = /(^|\.)(wikipedia|wikidata|wikimedia)\.org$/;

export interface GetOptions {
  /** Query parameters added only to the network request (e.g. { key: YOUTUBE_API_KEY }). */
  secret?: Record<string, string>;
  /** Quota units a network call costs (YouTube Data API). */
  quotaCost?: number;
}
const WINDOW_MS = 60_000;

export class HttpClient {
  requests = 0;
  cached = 0;
  /** API quota units spent on network calls (YouTube); cache/fixture hits cost nothing. */
  quotaUnits = 0;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly o: HttpClientOptions) {
    this.fetchImpl = o.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? (() => new Date());
  }

  /**
   * GET a JSON document. `slim` reduces the body before it is cached/recorded (e.g. only
   * the Wikidata properties we read); callers always see the slimmed body.
   * `secret` query parameters (API keys) are appended only to the real request: `url`, the
   * cache/fixture key, the recorded url and error messages never contain them.
   */
  async getJson(url: string, slim?: (body: unknown) => unknown, opts: GetOptions = {}): Promise<HttpResult> {
    const fixturesDir = this.o.fixturesDir ?? DEFAULT_HTTP_FIXTURES_DIR;
    if (this.o.mode === "mock") {
      const rec = readRecord(fixturesDir, url);
      if (!rec) throw new HttpError("fixture_missing", `No recorded HTTP response for ${url} (key ${urlKey(url)}).`);
      this.cached++;
      return { body: rec.body, fetchedAt: rec.fetchedAt, cached: true };
    }
    const cacheDir = this.o.cacheDir === undefined ? DEFAULT_HTTP_CACHE_DIR : this.o.cacheDir;
    if (cacheDir) {
      const rec = readRecord(cacheDir, url);
      const ageDays = rec ? (this.now().getTime() - Date.parse(rec.fetchedAt)) / 86_400_000 : Infinity;
      if (rec && ageDays <= this.o.cacheTtlDays) {
        this.cached++;
        if (this.o.record) writeRecord(fixturesDir, rec);
        return { body: rec.body, fetchedAt: rec.fetchedAt, cached: true };
      }
    }
    const rec = await this.fetchLive(url, slim, opts.secret);
    this.quotaUnits += opts.quotaCost ?? 0;
    if (cacheDir) writeRecord(cacheDir, rec);
    if (this.o.record) writeRecord(fixturesDir, rec);
    return { body: rec.body, fetchedAt: rec.fetchedAt, cached: false };
  }

  /** Sliding one-minute window: at most requestsPerMinute requests in any 60 s (bursts allowed). */
  private async throttle(url: string): Promise<void> {
    if (!WIKIMEDIA_HOST.test(new URL(url).host)) return;
    const limit = Math.max(1, this.o.requestsPerMinute);
    for (;;) {
      const t = Date.now();
      while (recent.length && t - recent[0]! >= WINDOW_MS) recent.shift();
      if (recent.length < limit) {
        recent.push(t);
        return;
      }
      await this.sleep(recent[0]! + WINDOW_MS - t + 50);
    }
  }

  private async fetchLive(url: string, slim?: (body: unknown) => unknown, secret?: Record<string, string>): Promise<HttpRecord> {
    const maxRetries = this.o.maxRetries ?? 2;
    const secrets = Object.values(secret ?? {}).filter(Boolean);
    const hide = (s: string): string => secrets.reduce((acc, v) => acc.split(v).join("[redacted]"), s);
    const realUrl = secret ? `${url}&${new URLSearchParams(secret).toString()}` : url;
    for (let attempt = 0; ; attempt++) {
      await this.throttle(url);
      this.requests++;
      let res;
      try {
        res = await this.fetchImpl(realUrl, { headers: { "User-Agent": this.o.userAgent, Accept: "application/json" } });
      } catch (e) {
        throw new HttpError("network", hide(`${url}: ${e instanceof Error ? e.message : String(e)}`));
      }
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt;
        await this.sleep(waitMs);
        continue;
      }
      const text = await res.text();
      if (res.status !== 200) throw new HttpError("http_status", hide(`${url}: HTTP ${res.status} ${text.slice(0, 160)}`));
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError("bad_json", hide(`${url}: response is not JSON (${text.slice(0, 80)})`));
      }
      return { url, fetchedAt: this.now().toISOString(), status: res.status, body: slim ? slim(body) : body };
    }
  }
}

/** Builds a URL with parameters in the given order (stable cache keys). */
export function buildUrl(base: string, params: [string, string | number][]): string {
  const q = new URLSearchParams();
  for (const [k, v] of params) q.append(k, String(v));
  return `${base}?${q.toString()}`;
}
