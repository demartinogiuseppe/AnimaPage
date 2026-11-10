// M3 enrichment: unit tests (offline, no fixtures needed).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageAnalysis } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../src/enrich/config.ts";
import { claimFor, crossCheck, parseBookNumber, roundingTolerance, toDiscrepancy, valuesMatch } from "../src/enrich/crosscheck.ts";
import { factsFor, wikidataFact } from "../src/enrich/facts.ts";
import { HttpClient, HttpError, urlKey, type FetchLike } from "../src/enrich/http.ts";
import { judgeRequest, parseJudgement } from "../src/enrich/judge.ts";
import { bookQuantities, cleanTopic, expandName, quantityKind, selectLookups } from "../src/enrich/select.ts";
import { leadSentences, stripParens } from "../src/enrich/text.ts";
import { parseCommons } from "../src/enrich/videos/commons.ts";
import { blockedTerm, licenseAllowed, prefilter } from "../src/enrich/videos/filter.ts";
import { parseIsoDuration, parseSearchIds, parseVideos, youtubeSearchUrl, youtubeVideosUrl } from "../src/enrich/videos/youtube.ts";
import { appendEnrichLedger, pickCandidates } from "../src/enrich/index.ts";
import type { VideoCandidate } from "../src/enrich/videos/types.ts";
import { bestValue, formatTimeIt, parseEntities, parseTime, slimEntities } from "../src/enrich/wikidata.ts";
import { leadNumbers, parseSearch, parseTitles } from "../src/enrich/wikipedia.ts";

const cfg = loadConfig({});

const base: PageAnalysis = {
  readable: true,
  confidence: 0.9,
  language: "it",
  pages: { visible: 1, numbers: [84] },
  orientation: "upright",
  subject: "geografia",
  topic: "Campania",
  contentType: "explanation",
  literary: { isLiterary: false },
  summary: "La Campania, il Vesuvio e Napoli.",
  concepts: ["Vesuvio, vulcano attivo", "territorio collinoso"],
  entities: [
    { name: "Campania", type: "place", onPage: true },
    { name: "Vesuvio", type: "place", onPage: true },
    { name: "Napoli", type: "place", onPage: true },
    { name: "M. Cervati", type: "place", value: "1899", onPage: true },
    { name: "Abitanti", type: "quantity", value: "5590076", onPage: true },
    { name: "Superficie", type: "quantity", value: "13668 km²", onPage: true },
    { name: "collina", type: "quantity", value: "51%", onPage: true },
  ],
  claims: [
    { text: "Il Vesuvio è un vulcano attivo vicino a Napoli.", kind: "fact", onPage: true },
    { text: "Abitanti 5590076, superficie 13668 km², densità 409 ab./km².", kind: "fact", onPage: true },
  ],
  exercises: [],
  illustrations: [{ kind: "map", description: "Carta fisica.", labels: ["Napoli", "Vesuvio", "M. Cervati 1899"] }],
  suggestedEngine: "map",
  engineReason: "Una regione.",
};

describe("page numbers and cross-check", () => {
  it("parses Italian book numbers", () => {
    expect(parseBookNumber("5590076")).toBe(5590076);
    expect(parseBookNumber("5.590.076")).toBe(5590076);
    expect(parseBookNumber("5 590 076")).toBe(5590076);
    expect(parseBookNumber("13668 km²")).toBe(13668);
    expect(parseBookNumber("13.668,5 km²")).toBe(13668.5);
    expect(parseBookNumber("410 d.C.")).toBe(410);
    expect(parseBookNumber("753 a.C.")).toBe(-753);
    expect(parseBookNumber("IV secolo d.C.")).toBeUndefined();
  });

  it("tolerates rounding only where the book rounded", () => {
    expect(roundingTolerance(5590076)).toBe(0);
    expect(roundingTolerance(5600000)).toBe(50000);
    expect(valuesMatch("population", 5590076, 5561912)).toBe(false);
    expect(valuesMatch("population", 5600000, 5561912)).toBe(true);
    expect(valuesMatch("area", 13668, 13670.95)).toBe(true); // 0.02 %
    expect(valuesMatch("area", 13668, 13800)).toBe(false);
    expect(valuesMatch("elevation", 1899, 1898)).toBe(true);
    expect(valuesMatch("elevation", 1899, 1880)).toBe(false);
    expect(valuesMatch("year", 476, 476)).toBe(true);
    expect(valuesMatch("year", 476, 475)).toBe(false);
  });

  it("emits a discrepancy with both values, the page claim and a reason, never a correction", () => {
    const q = bookQuantities(base, "Campania").find((x) => x.kind === "population")!;
    const c = crossCheck(q, { value: 5561912, sourceId: "wp-campania", from: "wikipedia" })!;
    expect(c.match).toBe(false);
    const d = toDiscrepancy(base, q, c);
    expect(d).toEqual({
      claim: "Abitanti 5590076, superficie 13668 km², densità 409 ab./km².",
      bookValue: "5590076",
      sourceValue: "5.561.912 abitanti",
      sourceId: "wp-campania",
      note: expect.stringContaining("dato più recente"),
    });
    const withYear = toDiscrepancy(base, q, { ...c, source: { ...c.source, year: 2019 } });
    expect(withYear.note).toContain("2019");
  });

  it("finds the claim stating a number, or falls back to name: value", () => {
    expect(claimFor(base, { name: "Superficie", value: "13668 km²" })).toContain("13668");
    expect(claimFor(base, { name: "M. Cervati", value: "1899" })).toBe("M. Cervati: 1899");
    // "409" must not match inside other digits
    expect(claimFor({ ...base, claims: [{ text: "Abitanti 5590076.", kind: "fact", onPage: true }] }, { name: "Densità", value: "409" })).toBe("Densità: 409");
  });

  it("knows which page values are quantities, and who owns them", () => {
    expect(quantityKind({ name: "Abitanti", type: "quantity", value: "1" })).toBe("population");
    expect(quantityKind({ name: "collina", type: "quantity", value: "51%" })).toBeUndefined();
    expect(quantityKind({ name: "Sacco di Roma", type: "event", value: "410 d.C." })).toBe("year");
    expect(quantityKind({ name: "IV secolo d.C.", type: "date", value: "IV secolo d.C." })).toBeUndefined();
    const qs = bookQuantities(base, "Campania");
    expect(qs.map((q) => [q.owner, q.kind])).toEqual([
      ["M. Cervati", "elevation"],
      ["Campania", "population"],
      ["Campania", "area"],
    ]);
    expect(bookQuantities({ ...base, literary: { isLiterary: true } }, "Campania")).toEqual([]);
  });
});

describe("entity selection", () => {
  it("puts the topic first, prefers entities with page values, skips quantities", () => {
    const l = selectLookups(base, 12);
    expect(l[0]).toMatchObject({ name: "Campania", isTopic: true });
    expect(l.map((x) => x.name)).not.toContain("Abitanti");
    expect(l.findIndex((x) => x.name === "M. Cervati")).toBeLessThan(l.findIndex((x) => x.name === "Napoli"));
    expect(selectLookups(base, 2)).toHaveLength(2);
  });

  it("looks up only the author and the work of literary pages", () => {
    const lit: PageAnalysis = {
      ...base,
      topic: "L'elettricista pasticcione",
      literary: { isLiterary: true, author: "Stefano Benni", work: "Bar Sport" },
      entities: [{ name: "Antonio", type: "person", onPage: true }, { name: "Stefano Benni", type: "person", onPage: true }],
    };
    expect(selectLookups(lit, 12).map((x) => x.name)).toEqual(["Stefano Benni", "Bar Sport"]);
  });

  it("cleans topics and expands map abbreviations", () => {
    expect(cleanTopic("Il modo indicativo")).toBe("modo indicativo");
    expect(cleanTopic("I sensi: la vista, il tatto")).toBe("sensi");
    expect(cleanTopic("L'elettricista")).toBe("elettricista");
    expect(expandName("M. Cervati")).toBe("Monte Cervati");
    const g = { ...base, topic: "I Germani e la fine dell'impero romano", entities: [{ name: "Germani", type: "group" as const, onPage: true as const }] };
    expect(selectLookups(g, 5)[0]).toMatchObject({ name: "Germani", isTopic: true });
  });
});

describe("Wikipedia parsing", () => {
  const body = {
    query: {
      normalized: [{ from: "vesuvio", to: "Vesuvio" }],
      redirects: [{ from: "Alarico", to: "Alarico I" }],
      pages: [
        { title: "Vesuvio", fullurl: "https://it.wikipedia.org/wiki/Vesuvio", extract: "Il Vesuvio (AFI: /x/) è uno stratovulcano.", pageprops: { wikibase_item: "Q524" } },
        { title: "Alarico I", fullurl: "https://it.wikipedia.org/wiki/Alarico_I", extract: "Re visigoto.", pageprops: { wikibase_item: "Q102371" } },
        { title: "Capri", fullurl: "https://it.wikipedia.org/wiki/Capri", extract: "", pageprops: { disambiguation: "", wikibase_item: "Q858285" } },
        { title: "Nonesiste", missing: true },
      ],
    },
  };
  it("maps requested titles through normalisation and redirects; flags disambiguation", () => {
    const m = parseTitles(body, ["vesuvio", "Alarico", "Capri", "Nonesiste"], "2026-11-03T10:00:00Z");
    expect(m.get("vesuvio")?.wikibaseItem).toBe("Q524");
    expect(m.get("Alarico")?.title).toBe("Alarico I");
    expect(m.get("Capri")?.disambiguation).toBe(true);
    expect(m.has("Nonesiste")).toBe(false);
  });
  it("orders search results by rank", () => {
    const s = parseSearch({ query: { pages: [{ title: "B", index: 2, fullurl: "https://x.org/B" }, { title: "A", index: 1, fullurl: "https://x.org/A" }] } }, "t");
    expect(s.map((a) => a.title)).toEqual(["A", "B"]);
  });
  it("reads numbers stated in a lead", () => {
    expect(leadNumbers("Con 5 561 912 abitanti è la regione più popolosa. Superficie di 13 670,95 km².")).toEqual({
      population: 5561912,
      area: 13670.95,
      elevation: undefined,
    });
    expect(leadNumbers("Alto 1 281 m s.l.m., nel 1944 eruttò.").elevation).toBe(1281);
  });
  it("keeps short lead sentences without parentheses", () => {
    expect(stripParens("Alarico I (Isola di Peuce, 370 – Cosenza, 410), è stato un re.")).toBe("Alarico I, è stato un re.");
    const lead = leadSentences("Nel 476 d.C. Odoacre depose Romolo Augustolo. Fu re d'Italia. " + "Altro testo molto lungo. ".repeat(20));
    expect(lead.startsWith("Nel 476 d.C. Odoacre depose Romolo Augustolo.")).toBe(true);
    expect(lead.length).toBeLessThanOrEqual(260);
  });
});

describe("Wikidata parsing", () => {
  const pop = (amount: string, time: string | undefined, rank = "normal") => ({
    rank,
    mainsnak: { datavalue: { type: "quantity", value: { amount, unit: "1" } } },
    ...(time ? { qualifiers: { P585: [{ datavalue: { value: { time, precision: 9 } } }] } } : {}),
  });
  it("picks preferred statements, then the latest point in time, never deprecated", () => {
    expect(bestValue([pop("+1", "+2013-00-00T00:00:00Z"), pop("+2", "+2019-00-00T00:00:00Z")])).toMatchObject({ amount: 2, pointInTime: { year: 2019 } });
    expect(bestValue([pop("+1", "+2013-00-00T00:00:00Z", "preferred"), pop("+2", "+2019-00-00T00:00:00Z")])).toMatchObject({ amount: 1 });
    expect(bestValue([pop("+9", "+2025-00-00T00:00:00Z", "deprecated")])).toBeUndefined();
  });
  it("parses units, times and coordinates and slims the response", () => {
    const raw = {
      entities: {
        Q524: {
          id: "Q524",
          labels: { it: { value: "Vesuvio" }, en: { value: "Mount Vesuvius" } },
          claims: {
            P2044: [{ rank: "preferred", mainsnak: { datavalue: { type: "quantity", value: { amount: "+1281", unit: "http://www.wikidata.org/entity/Q11573" } } }, references: [{}] }],
            P625: [{ rank: "normal", mainsnak: { datavalue: { type: "globecoordinate", value: { latitude: 40.8, longitude: 14.4, globe: "http://www.wikidata.org/entity/Q2" } } } }],
            P31: [{ rank: "normal", mainsnak: {} }],
          },
        },
      },
    };
    const slim = slimEntities(raw) as { entities: { Q524: { claims: Record<string, unknown> } } };
    expect(Object.keys(slim.entities.Q524.claims).sort()).toEqual(["P2044", "P625"]);
    const item = parseEntities(slim).get("Q524")!;
    expect(item.labelEn).toBe("Mount Vesuvius");
    expect(item.values.P2044).toEqual({ kind: "quantity", amount: 1281, unit: "m" });
    expect(item.values.P625).toEqual({ kind: "coord", lat: 40.8, lon: 14.4 });
  });
  it("formats dates in Italian", () => {
    expect(formatTimeIt(parseTime({ time: "+0410-08-24T00:00:00Z", precision: 11 })!)).toBe("24 agosto 410 d.C.");
    expect(formatTimeIt(parseTime({ time: "+1947-08-12T00:00:00Z", precision: 11 })!)).toBe("12 agosto 1947");
    expect(formatTimeIt(parseTime({ time: "-0753-00-00T00:00:00Z", precision: 9 })!)).toBe("753 a.C.");
    expect(formatTimeIt(parseTime({ time: "+0500-00-00T00:00:00Z", precision: 7 })!)).toBe("V secolo d.C.");
  });
  it("builds facts with source, property and value; no elevation for towns", () => {
    expect(wikidataFact("Vesuvio", "Vesuvio", "P2044", { kind: "quantity", amount: 1281, unit: "m" }, "wd-Q524", "Q524")).toEqual({
      entity: "Vesuvio",
      wikidataId: "Q524",
      property: "P2044",
      sourceId: "wd-Q524",
      text: "Vesuvio: altitudine 1281 m.",
      value: 1281,
      unit: "m",
    });
    const { facts, sources } = factsFor(
      {
        lookup: { name: "Napoli", type: "place", isTopic: false, score: 1, mentions: 1 },
        article: { title: "Napoli", url: "https://it.wikipedia.org/wiki/Napoli", extract: "Napoli è un comune di 902 705 abitanti.", wikibaseItem: "Q2634", disambiguation: false, fetchedAt: "2026-11-03T10:00:00Z" },
        item: { id: "Q2634", labelIt: "Napoli", values: { P2044: { kind: "quantity", amount: 17, unit: "m" }, P2046: { kind: "quantity", amount: 119.02, unit: "km²" } } },
      },
      "2026-11-03T10:00:00Z",
    );
    expect(facts.map((f) => f.property)).toEqual([undefined, "P1082", "P2046"]);
    expect(sources.map((s) => s.id)).toEqual(["wp-napoli", "wd-Q2634"]);
    expect(sources[0]).toMatchObject({ kind: "wikipedia", accessed: "2026-11-03", wikidataId: "Q2634", license: "CC BY-SA 4.0" });
  });
});

const video = (over: Partial<VideoCandidate>): VideoCandidate => ({
  provider: "commons",
  ref: "File:Vesuvio.webm",
  title: "Vesuvio from Napoli",
  description: "Il Vesuvio visto da Napoli",
  categories: ["Videos of Mount Vesuvius"],
  durationSec: 120,
  license: "CC BY-SA 4.0",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Vesuvio.webm",
  mediaType: "VIDEO",
  mime: "video/webm",
  fetchedAt: "2026-11-03T10:00:00Z",
  ...over,
});

describe("video safety and relevance pre-filter", () => {
  const kw = new Set(["vesuvio", "napoli", "campania"]);
  it("blocks adult/violent terms on word starts only", () => {
    expect(blockedTerm("Killing of the boar", cfg.videos.blockedTerms)).toBeDefined();
    expect(blockedTerm("Killers", ["kill"])).toBe("kill");
    expect(blockedTerm("Nudità nell'arte", cfg.videos.blockedTerms)).toBe("nudita");
    expect(blockedTerm("Essex coast, Sussex downs", cfg.videos.blockedTerms)).toBeUndefined();
    expect(blockedTerm("Scuola di Napoli", cfg.videos.blockedTerms)).toBeUndefined();
  });
  it("accepts only free licences", () => {
    expect(licenseAllowed("CC BY-SA 3.0", cfg.videos.commons.licenses)).toBe(true);
    expect(licenseAllowed("Public domain", cfg.videos.commons.licenses)).toBe(true);
    expect(licenseAllowed("CC0", cfg.videos.commons.licenses)).toBe(true);
    expect(licenseAllowed("CC BY-NC 4.0", cfg.videos.commons.licenses)).toBe(false);
    expect(licenseAllowed(undefined, cfg.videos.commons.licenses)).toBe(false);
    expect(licenseAllowed("All rights reserved", cfg.videos.commons.licenses)).toBe(false);
  });
  it("drops long, unlicensed, unsafe, off-topic and non-video files; ranks the rest", () => {
    const r = prefilter(
      [
        video({ ref: "File:ok.webm" }),
        video({ ref: "File:long.webm", durationSec: 11 * 60 }),
        video({ ref: "File:noduration.webm", durationSec: undefined }),
        video({ ref: "File:nc.webm", license: "CC BY-NC 2.0" }),
        video({ ref: "File:blood.webm", description: "Vesuvio, blood everywhere" }),
        video({ ref: "File:cat.webm", title: "A cat", description: "Cute", categories: ["Cats"] }),
        video({ ref: "File:img.jpg", mediaType: "BITMAP", mime: "image/jpeg" }),
        video({ ref: "File:best.webm", categories: ["Videos of Mount Vesuvius", "Media of the day", "Campania"] }),
      ],
      kw,
      cfg,
    );
    expect(r.kept.map((k) => k.c.ref)).toEqual(["File:best.webm", "File:ok.webm"]);
    expect(Object.fromEntries(r.rejected.map((x) => [x.ref, x.reason]))).toEqual({
      "File:long.webm": "duration",
      "File:noduration.webm": "duration",
      "File:nc.webm": "license",
      "File:blood.webm": "blocked_term",
      "File:cat.webm": "off_topic",
      "File:img.jpg": "not_video",
    });
  });
  it("parses Commons imageinfo (duration, licence, description)", () => {
    const c = parseCommons(
      {
        query: {
          pages: [
            {
              title: "File:V.ogv",
              index: 1,
              imageinfo: [
                {
                  duration: 374.2,
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:V.ogv",
                  mediatype: "VIDEO",
                  mime: "application/ogg",
                  extmetadata: {
                    ObjectName: { value: "Vesuvius in Eruption" },
                    ImageDescription: { value: "<b>Vesuvio</b> in eruzione" },
                    Categories: { value: "Videos of 1944|Vesuvius eruptions" },
                    LicenseShortName: { value: "CC0" },
                    Artist: { value: '<a href="x">NARA</a>' },
                  },
                },
              ],
            },
          ],
        },
      },
      "2026-11-03T10:00:00Z",
    );
    expect(c[0]).toMatchObject({ ref: "File:V.ogv", title: "Vesuvius in Eruption", description: "Vesuvio in eruzione", durationSec: 374.2, license: "CC0", author: "NARA", categories: ["Videos of 1944", "Vesuvius eruptions"] });
  });
});

describe("LLM judgement", () => {
  const articles = [{ entity: "Sele", candidates: [{ title: "Sele", extract: "Fiume." }, { title: "Valle del Sele", extract: "Valle." }] }];
  const vids = [video({ ref: "File:a.webm" })];
  it("builds a deterministic, text-only request", () => {
    const r = judgeRequest(base, articles, vids);
    expect(r.images).toBeUndefined();
    expect(r.prompt).toBe(judgeRequest(base, articles, vids).prompt);
    expect(r.prompt).not.toContain("fetchedAt");
  });
  it("keeps only answers about the given candidates and clamps scores", () => {
    const j = parseJudgement(
      {
        articles: [{ entity: "Sele", title: "Sele (film)" }, { entity: "Ignoto", title: "X" }],
        videos: [
          { ref: "File:a.webm", relevance: 1.7, childSafe: true, titleIt: "Il Vesuvio", reason: "ok" },
          { ref: "File:other.webm", relevance: 1, childSafe: true, titleIt: "x", reason: "x" },
        ],
      },
      articles,
      vids,
    );
    expect(j.articles.size).toBe(0);
    expect(j.videos).toEqual([{ ref: "File:a.webm", relevance: 1, childSafe: true, titleIt: "Il Vesuvio", reason: "ok" }]);
    expect(parseJudgement({ articles: [{ entity: "Sele", title: "" }], videos: [] }, articles, vids).articles.get("Sele")).toBe("");
  });
});

describe("config", () => {
  it("adds an optional contact to the User-Agent and only then uses the higher rate tier", () => {
    const s = readFileSync(new URL("../config/sources.yaml", import.meta.url), "utf8");
    const c = readFileSync(new URL("../config/video_channels.yaml", import.meta.url), "utf8");
    const plain = parseConfig(s, c, {});
    expect(plain.userAgent).toBe("animapage/0.1 (private educational prototype)");
    expect(plain.requestsPerMinute).toBeLessThan(10);
    const withContact = parseConfig(s, c, { PAGINAVIVA_HTTP_CONTACT: "https://example.org/pv" });
    expect(withContact.userAgent).toBe("animapage/0.1 (private educational prototype; https://example.org/pv)");
    expect(withContact.requestsPerMinute).toBeGreaterThan(10);
    expect(plain.videos.maxDurationSec).toBe(600);
    expect(plain.videos.youtube).toMatchObject({ setting: "auto", apiKey: undefined, safeSearch: "strict", regionCode: "IT", relevanceLanguage: "it", allowlistOnly: false });
    expect(plain.videos.youtube.channels.length).toBeGreaterThan(5);
    for (const ch of plain.videos.youtube.channels) expect(ch.id).toMatch(/^UC[\w-]{22}$/);
    expect(parseConfig(s, c, { YOUTUBE_API_KEY: " k " }).videos.youtube.apiKey).toBe("k");
    expect(parseConfig(s.replace("enabled: auto", "enabled: false"), c, { YOUTUBE_API_KEY: "k" }).videos.youtube.setting).toBe(false);
  });
});

describe("HTTP client", () => {
  const url = "https://it.wikipedia.org/w/api.php?action=query&titles=Vesuvio";
  const fakeFetch = (responses: { status: number; body: string; retryAfter?: string }[]): FetchLike & { calls: number; uas: string[] } => {
    const f = (async (_u: string, init: { headers: Record<string, string> }) => {
      const r = responses[Math.min(f.calls, responses.length - 1)]!;
      f.calls++;
      f.uas.push(init.headers["User-Agent"]!);
      return { status: r.status, headers: { get: (n: string) => (n === "retry-after" ? (r.retryAfter ?? null) : null) }, text: async () => r.body };
    }) as FetchLike & { calls: number; uas: string[] };
    f.calls = 0;
    f.uas = [];
    return f;
  };
  const opts = { userAgent: "animapage/0.1 (private educational prototype)", requestsPerMinute: 1000, cacheTtlDays: 30 };

  it("mock mode never touches the network and fails on a missing recording", async () => {
    const f = fakeFetch([{ status: 200, body: "{}" }]);
    const http = new HttpClient({ ...opts, mode: "mock", fixturesDir: mkdtempSync(join(tmpdir(), "pv-fx-")), fetch: f });
    await expect(http.getJson(url)).rejects.toBeInstanceOf(HttpError);
    expect(f.calls).toBe(0);
  });

  it("live: retries 429 after Retry-After, caches, records, and replays in mock mode", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "pv-cache-"));
    const fixturesDir = mkdtempSync(join(tmpdir(), "pv-fx-"));
    const waits: number[] = [];
    const f = fakeFetch([{ status: 429, body: "slow down", retryAfter: "2" }, { status: 200, body: '{"ok":1}' }]);
    const http = new HttpClient({ ...opts, mode: "live", cacheDir, fixturesDir, record: true, fetch: f, sleep: async (ms) => void waits.push(ms) });
    expect((await http.getJson(url)).body).toEqual({ ok: 1 });
    expect(waits).toContain(2000);
    expect(f.uas[0]).toBe(opts.userAgent);
    expect((await http.getJson(url)).cached).toBe(true);
    expect([http.requests, http.cached, f.calls]).toEqual([2, 1, 2]);
    const rec = JSON.parse(readFileSync(join(fixturesDir, "it.wikipedia.org", `${urlKey(url)}.json`), "utf8"));
    expect(rec).toMatchObject({ url, status: 200, body: { ok: 1 } });
    const mock = new HttpClient({ ...opts, mode: "mock", fixturesDir });
    expect((await mock.getJson(url)).body).toEqual({ ok: 1 });
  });

  it("throws on HTTP errors and non-JSON bodies", async () => {
    const live = (status: number, body: string) =>
      new HttpClient({ ...opts, mode: "live", cacheDir: null, fetch: fakeFetch([{ status, body }]), sleep: async () => {}, maxRetries: 0 });
    await expect(live(404, "nope").getJson(url)).rejects.toThrow(/HTTP 404/);
    await expect(live(200, "<html>").getJson(url)).rejects.toThrow(/not JSON/);
  });
});

describe("YouTube provider (synthetic responses, no key)", () => {
  const ytCfg = { ...cfg, videos: { ...cfg.videos, youtube: { ...cfg.videos.youtube, apiKey: "SECRET-KEY-123" } } };
  const ytVideo = (id: string, over: { snippet?: object; contentDetails?: object; status?: object } = {}) => ({
    id,
    snippet: {
      title: "La Campania spiegata",
      description: "Geografia della Campania",
      channelId: "UCx7EWheHmjCW3vX8K2d09vg",
      channelTitle: "Geopop",
      liveBroadcastContent: "none",
      defaultAudioLanguage: "it",
      ...over.snippet,
    },
    contentDetails: { duration: "PT4M13S", ...over.contentDetails },
    status: { embeddable: true, privacyStatus: "public", license: "youtube", ...over.status },
  });

  it("parses ISO 8601 durations", () => {
    expect(parseIsoDuration("PT15M33S")).toBe(933);
    expect(parseIsoDuration("PT1H2M")).toBe(3720);
    expect(parseIsoDuration("P1DT2H")).toBe(93600);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("bogus")).toBeUndefined();
  });

  it("asks for strict, embeddable, Italian videos and never puts the key in the URL", () => {
    const u = new URL(youtubeSearchUrl("Campania geografia", ytCfg));
    expect(u.origin + u.pathname).toBe("https://youtube.googleapis.com/youtube/v3/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      part: "snippet",
      q: "Campania geografia",
      type: "video",
      safeSearch: "strict",
      videoEmbeddable: "true",
      relevanceLanguage: "it",
      regionCode: "IT",
      maxResults: "10",
    });
    expect(youtubeVideosUrl(["a", "b"])).toBe("https://youtube.googleapis.com/youtube/v3/videos?part=snippet%2CcontentDetails%2Cstatus&id=a%2Cb");
  });

  it("reads status, duration, language, age and region restrictions, preferred channels", () => {
    expect(parseSearchIds({ items: [{ id: { videoId: "abcdefghijk" } }, { id: { channelId: "UC" } }, { id: { videoId: "bad" } }] })).toEqual(["abcdefghijk"]);
    const [a, b] = parseVideos(
      {
        items: [
          ytVideo("abcdefghijk"),
          ytVideo("bbbbbbbbbbb", {
            snippet: { channelId: "UCother0000000000000000", defaultAudioLanguage: "en" },
            contentDetails: { contentRating: { ytRating: "ytAgeRestricted" }, regionRestriction: { blocked: ["IT"] } },
          }),
        ],
      },
      "2026-11-03T10:00:00Z",
      ytCfg,
    );
    expect(a).toMatchObject({ provider: "youtube", ref: "abcdefghijk", durationSec: 253, author: "Geopop", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk" });
    expect(a!.youtube).toMatchObject({ preferredChannel: true, language: "it", embeddable: true, ageRestricted: false, regionBlocked: false });
    expect(b!.youtube).toMatchObject({ preferredChannel: false, language: "en", ageRestricted: true, regionBlocked: true });
  });

  it("pre-filter drops non-embeddable, non-public, live, age-restricted, region-blocked and (if strict) unlisted channels", () => {
    const vids = parseVideos(
      {
        items: [
          ytVideo("okokokokoko"),
          ytVideo("noembed0000", { status: { embeddable: false } }),
          ytVideo("private0000", { status: { privacyStatus: "unlisted" } }),
          ytVideo("livelive000", { snippet: { liveBroadcastContent: "live" } }),
          ytVideo("agerestrict", { contentDetails: { contentRating: { ytRating: "ytAgeRestricted" } } }),
          ytVideo("regionblock", { contentDetails: { regionRestriction: { allowed: ["US"] } } }),
          ytVideo("toolong0000", { contentDetails: { duration: "PT12M" } }),
          ytVideo("otherchanne", { snippet: { channelId: "UCother0000000000000000" } }),
        ],
      },
      "t",
      ytCfg,
    );
    const kw = new Set(["campania", "geografia"]);
    const r = prefilter(vids, kw, ytCfg);
    expect(r.kept.map((k) => k.c.ref)).toEqual(["okokokokoko", "otherchanne"]); // listed channel first
    expect(Object.fromEntries(r.rejected.map((x) => [x.ref, x.reason]))).toEqual({
      noembed0000: "not_embeddable",
      private0000: "not_public",
      livelive000: "live",
      agerestrict: "age_restricted",
      regionblock: "region",
      toolong0000: "duration",
    });
    const strict = { ...ytCfg, videos: { ...ytCfg.videos, youtube: { ...ytCfg.videos.youtube, allowlistOnly: true } } };
    expect(prefilter(vids, kw, strict).rejected.find((x) => x.ref === "otherchanne")?.reason).toBe("channel");
  });

  it("sends the key only on the wire: not in recordings, cache or errors; counts quota on network calls only", async () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), "pv-fx-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "pv-cache-"));
    const seen: string[] = [];
    let status = 200;
    const f: FetchLike = async (u) => {
      seen.push(u);
      return { status, headers: { get: () => null }, text: async () => (status === 200 ? '{"items":[]}' : '{"error":"bad key SECRET-KEY-123"}') };
    };
    const http = new HttpClient({ mode: "live", cacheDir, fixturesDir, record: true, userAgent: "ua", requestsPerMinute: 1000, cacheTtlDays: 30, fetch: f, sleep: async () => {} });
    const url = youtubeSearchUrl("Campania geografia", ytCfg);
    await http.getJson(url, undefined, { secret: { key: "SECRET-KEY-123" }, quotaCost: 1 });
    await http.getJson(url, undefined, { secret: { key: "SECRET-KEY-123" }, quotaCost: 1 }); // cached: no quota
    expect(seen).toEqual([`${url}&key=SECRET-KEY-123`]);
    expect(http.quotaUnits).toBe(1);
    expect(readFileSync(join(fixturesDir, "youtube.googleapis.com", `${urlKey(url)}.json`), "utf8")).not.toContain("SECRET");
    expect(readFileSync(join(cacheDir, "youtube.googleapis.com", `${urlKey(url)}.json`), "utf8")).not.toContain("SECRET");
    status = 403;
    const err = (await http.getJson(`${url}&x=1`, undefined, { secret: { key: "SECRET-KEY-123" } }).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("[redacted]");
    expect(err.message).not.toContain("SECRET");
  });

  it("gives each provider a share of the judge candidates", () => {
    const c = (provider: "commons" | "youtube", ref: string) => video({ provider, ref });
    const sorted = [c("commons", "c1"), c("commons", "c2"), c("commons", "c3"), c("commons", "c4"), c("youtube", "y1"), c("youtube", "y2")];
    expect(pickCandidates(sorted, 4).map((x) => x.ref)).toEqual(["c1", "c2", "y1", "y2"]);
    expect(pickCandidates(sorted.filter((x) => x.provider === "commons"), 3).map((x) => x.ref)).toEqual(["c1", "c2", "c3"]);
  });

  it("writes videoQuota and kind enrich in the ledger", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pv-l-")), "l.jsonl");
    const e = appendEnrichLedger({ time: "2026-11-03T10:00:00Z", kind: "enrich", phasesMs: { total: 1 }, videoQuota: 2, externalRequests: 3 }, path);
    expect(e).toEqual({ time: "2026-11-03T10:00:00Z", kind: "enrich", phasesMs: { total: 1 }, externalRequests: 3, videoQuota: 2 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(e);
  });
});
