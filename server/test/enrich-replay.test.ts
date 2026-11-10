// M3 enrichment: offline replay of the 5 evaluation pages (recorded HTTP in fixtures/http,
// recorded judge answers in fixtures/enrich/llm, analyses in fixtures/llm) + ledger fields.
// The live test runs only with PAGINAVIVA_MODE=live (network + Claude Code CLI).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PageAnalysis, Source, Video } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/enrich/config.ts";
import { urlKey } from "../src/enrich/http.ts";
import { enrich, enrichDetailed } from "../src/enrich/index.ts";
import { youtubeSearchUrl, youtubeVideosUrl } from "../src/enrich/videos/youtube.ts";
import { readRecordings } from "../src/llm/mock.ts";
import type { LlmProvider } from "../src/llm/types.ts";
import type { EnrichResult } from "../src/pipeline/types.ts";

const HTTP_FIXTURES = fileURLToPath(new URL("../../fixtures/http/", import.meta.url));
const ENRICH_DIR = fileURLToPath(new URL("../../fixtures/enrich/", import.meta.url));
const PAGES = [
  "geografia_campania_p84",
  "grammatica_modo-indicativo_p44",
  "racconto_elettricista-pasticcione",
  "scienze_sensi_p38-39",
  "storia_germani-fine-impero_p116-117",
];

function analysisOf(label: string): PageAnalysis {
  const rec = readRecordings()
    .filter((r) => r.label === label)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  if (!rec) throw new Error(`no recorded analysis ${label}`);
  return PageAnalysis.parse(rec.response.data);
}

const expected = (label: string): EnrichResult => JSON.parse(readFileSync(join(ENRICH_DIR, `${label}.json`), "utf8")) as EnrichResult;
const withoutStats = ({ stats: _s, ...rest }: EnrichResult) => rest;
const tmpLedger = (): string => join(mkdtempSync(join(tmpdir(), "pv-ledger-")), "ledger.jsonl");

// The recorded analyses/enrichments of the evaluation pages are left out of the public copy
// (tools/publish/exclude.txt, protected book pages): these replay tests skip when they are absent.
const ready = PAGES.every((p) => existsSync(join(ENRICH_DIR, `${p}.json`)));

describe.skipIf(!ready).each(PAGES)("mock replay: %s", (label) => {
  it("reproduces the recorded EnrichResult offline, with valid and complete sources", async () => {
    const ledgerPath = tmpLedger();
    const { result, details } = await enrichDetailed(analysisOf(label), { mode: "mock", ledgerPath });
    expect(details.errors).toEqual([]);
    expect(details.judged).toBe(true);
    expect(result.stats.requests).toBe(0);
    expect(result.stats.cached).toBeGreaterThan(0);
    expect(withoutStats(result)).toEqual(withoutStats(expected(label)));

    for (const s of result.sources) expect(() => Source.parse(s)).not.toThrow();
    for (const v of result.videos) expect(() => Video.parse(v)).not.toThrow();
    const ids = new Set(result.sources.map((s) => s.id));
    expect(ids.size).toBe(result.sources.length);
    expect(ids.has("page")).toBe(true);
    for (const f of result.facts) expect(ids.has(f.sourceId), f.id).toBe(true);
    for (const d of result.discrepancies) expect(ids.has(d.sourceId)).toBe(true);
    for (const s of result.sources.filter((x) => x.kind !== "page")) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.license).toBeTruthy();
    }
    expect(result.facts.length).toBeLessThanOrEqual(loadConfig().maxFacts);
    expect(new Set(result.facts.map((f) => f.id)).size).toBe(result.facts.length);
    expect(result.videos.length).toBeLessThanOrEqual(3);
    for (const v of result.videos) {
      // Pages recorded with a YouTube key also carry YouTube videos (decision D15).
      expect(["commons", "youtube"]).toContain(v.provider);
      if (v.provider === "commons") expect(v.ref.startsWith("File:")).toBe(true);
      else expect(v.ref).toMatch(/^[\w-]{11}$/);
      expect(v.durationSec).toBeLessThanOrEqual(600);
      const verdict = details.verdicts.find((x) => x.ref === v.ref)!;
      expect(verdict.childSafe).toBe(true);
      expect(verdict.relevance).toBeGreaterThanOrEqual(0.6);
    }

    const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ kind: "enrich", externalRequests: 0, cached: true, llmCalls: 1, provider: "mock", validation: "ok" });
    expect(entry.phasesMs.total).toBeGreaterThanOrEqual(0);
    expect(Object.keys(entry.phasesMs).sort()).toEqual(["build", "judge", "total", "videos", "wikidata", "wikipedia"]);
    expect(entry.error).toBeUndefined();
    expect(JSON.stringify(entry)).not.toMatch(/@|api[_-]?key|token"/i);
  });
});

describe.skipIf(!ready)("enrichment content on the evaluation pages", () => {
  it("Campania: the book's population differs from the sources and is reported, not corrected", async () => {
    const r = await enrich(analysisOf("geografia_campania_p84"), { mode: "mock", ledgerPath: null });
    const pop = r.discrepancies.find((d) => d.bookValue === "5590076");
    expect(pop).toBeDefined();
    expect(pop!.claim).toContain("5590076");
    expect(pop!.note).toBeTruthy();
    // The area matches within rounding: no discrepancy.
    expect(r.discrepancies.some((d) => d.bookValue.startsWith("13668"))).toBe(false);
    expect(r.facts.some((f) => f.wikidataId === "Q524" && f.property === "P2044" && f.value === 1281)).toBe(true);
  });

  it("literary page: facts only about the author/work, never about the story", async () => {
    const r = await enrich(analysisOf("racconto_elettricista-pasticcione"), { mode: "mock", ledgerPath: null });
    const entities = new Set(r.facts.map((f) => f.entity));
    expect([...entities].every((e) => e === "Stefano Benni" || e === "Bar Sport")).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it("history page: event dates are checked against Wikidata", async () => {
    const { details } = await enrichDetailed(analysisOf("storia_germani-fine-impero_p116-117"), { mode: "mock", ledgerPath: null });
    expect(details.checks.some((c) => c.kind === "year")).toBe(true);
  });

  it("fails closed without the judge: heuristic articles, no videos, error in the ledger", async () => {
    const broken: LlmProvider = { name: "mock", generateStructured: async () => Promise.reject(new Error("offline")) };
    const ledgerPath = tmpLedger();
    const { result, details } = await enrichDetailed(analysisOf("geografia_campania_p84"), { mode: "mock", provider: broken, ledgerPath });
    expect(result.videos).toEqual([]);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(details.errors.join()).toMatch(/judge/);
    const entry = JSON.parse(readFileSync(ledgerPath, "utf8").trim());
    expect(entry).toMatchObject({ kind: "enrich", validation: "error" });
    expect(entry.error).toMatch(/judge/);
  });

  it("YouTube + Commons in mock mode (synthetic YouTube recordings): Italian first, max 3, sources with channel", async () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), "pv-yt-fx-"));
    cpSync(HTTP_FIXTURES, fixturesDir, { recursive: true });
    const config = loadConfig({});
    const searchUrl = youtubeSearchUrl("Campania geografia", config);
    const ids = ["itCampania1", "enCampania2", "ageRestrict"];
    const record = (url: string, body: unknown): void => {
      const dir = join(fixturesDir, "youtube.googleapis.com");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${urlKey(url)}.json`), JSON.stringify({ url, fetchedAt: "2026-11-03T12:00:00.000Z", status: 200, body }));
    };
    const item = (id: string, lang: string, channelId: string, channelTitle: string, extra: object = {}) => ({
      id,
      snippet: { title: `La Campania ${id}`, description: "Geografia della Campania e del Vesuvio", channelId, channelTitle, liveBroadcastContent: "none", defaultAudioLanguage: lang },
      contentDetails: { duration: "PT5M", ...extra },
      status: { embeddable: true, privacyStatus: "public", license: "youtube" },
    });
    record(searchUrl, { items: ids.map((videoId) => ({ id: { kind: "youtube#video", videoId } })) });
    record(youtubeVideosUrl(ids), {
      items: [
        item("itCampania1", "it", "UCx7EWheHmjCW3vX8K2d09vg", "Geopop"),
        item("enCampania2", "en", "UCother0000000000000000", "Some Channel"),
        item("ageRestrict", "it", "UCother0000000000000000", "Other", { contentRating: { ytRating: "ytAgeRestricted" } }),
      ],
    });
    const prompts: string[] = [];
    const judgeStub: LlmProvider = {
      name: "mock",
      async generateStructured(req) {
        prompts.push(req.prompt);
        const p = JSON.parse(req.prompt.slice(req.prompt.indexOf("{"))) as {
          articles: { entity: string; candidates: { title: string }[] }[];
          videos: { ref: string; provider?: string }[];
        };
        const rel: Record<string, number> = { itCampania1: 0.7, enCampania2: 0.75 };
        return {
          data: {
            articles: p.articles.map((a) => ({ entity: a.entity, title: a.candidates[0]?.title ?? "" })),
            videos: p.videos.map((v) => ({ ref: v.ref, relevance: rel[v.ref] ?? 0.65, childSafe: true, titleIt: `Titolo ${v.ref}`, reason: "ok" })),
          },
          durationMs: 1,
          model: "stub",
        };
      },
    };
    const ledgerPath = tmpLedger();
    const { result, details } = await enrichDetailed(analysisOf("geografia_campania_p84"), { mode: "mock", httpFixturesDir: fixturesDir, provider: judgeStub, config, ledgerPath });
    expect(details.errors).toEqual([]);
    expect(details.prefilter.find((r) => r.ref === "ageRestrict")?.reason).toBe("age_restricted");
    expect(prompts[0]).toContain('"provider":"youtube"');
    expect(result.videos.length).toBe(3);
    expect(result.videos[0]).toEqual({ id: "v1", provider: "youtube", ref: "itCampania1", title: "Titolo itCampania1", channel: "Geopop", durationSec: 300 });
    expect(result.videos[1]!.ref).toBe("enCampania2");
    const src = result.sources.find((s) => s.id === "youtube-v1")!;
    expect(src).toMatchObject({ kind: "web", url: "https://www.youtube.com/watch?v=itCampania1", publisher: "Geopop", accessed: "2026-11-03" });
    for (const v of result.videos) expect(() => Video.parse(v)).not.toThrow();
    const entry = JSON.parse(readFileSync(ledgerPath, "utf8").trim());
    expect(entry.videoQuota ?? 0).toBe(0); // replay: no quota spent
    expect(readFileSync(ledgerPath, "utf8")).not.toMatch(/key=/);
  });

  it("all five recorded results exist for the generation stage", () => {
    for (const p of PAGES) expect(existsSync(join(ENRICH_DIR, `${p}.json`)), p).toBe(true);
  });
});

const live = process.env.PAGINAVIVA_MODE === "live";
describe.skipIf(!live)("enrichment (live: Wikipedia, Wikidata, Commons, Claude Code CLI)", () => {
  it(
    "enriches the Campania page from the network",
    async () => {
      const r = await enrich(analysisOf("geografia_campania_p84"), { mode: "live", cacheDir: null, ledgerPath: null });
      expect(r.facts.length).toBeGreaterThan(5);
      expect(r.discrepancies.length).toBeGreaterThan(0);
    },
    300_000,
  );
});

// Live YouTube: only with PAGINAVIVA_MODE=live and YOUTUBE_API_KEY set (spends 2 quota units).
const liveYoutube = live && !!process.env.YOUTUBE_API_KEY?.trim();
describe.skipIf(!liveYoutube)("YouTube provider (live)", () => {
  it(
    "finds embeddable, strict-safe Italian candidates for the Campania page",
    async () => {
      const config = loadConfig();
      const { details } = await enrichDetailed(analysisOf("geografia_campania_p84"), { mode: "live", cacheDir: null, ledgerPath: null, config });
      expect(details.errors.filter((e) => e.startsWith("videos/youtube"))).toEqual([]);
    },
    300_000,
  );
});
