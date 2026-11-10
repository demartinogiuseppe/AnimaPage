// M3 enrichment: PageAnalysis -> verified facts, sources, discrepancies and videos.
//
// Steps (≤ ~8 HTTP requests per page, serialised; see http.ts for the rate limits):
//  1. select the page entities worth looking up (select.ts);
//  2. it.wikipedia: one batched exact-title request + a few searches (wikipedia.ts);
//  3. Wikidata: one wbgetentities request for every candidate item (wikidata.ts);
//  4. Commons: video search with the items' labels (videos/commons.ts), heuristic pre-filter;
//  5. one LLM call: right article per entity + video relevance/child safety (judge.ts);
//     without it (error, no recording) articles fall back to a heuristic and videos to none;
//  6. facts, sources, cross-check of the page numbers (facts.ts, crosscheck.ts); ledger.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SOURCE_ID, type Source, type Video } from "@pv/scene-spec";
import { isItalian, regionOf } from "@pv/scene-spec/i18n";
import { DEFAULT_LEDGER_PATH, sanitizeEntry, type LedgerEntry } from "../ledger.ts";
import { createProvider } from "../llm/index.ts";
import { MockProvider, RecordingProvider } from "../llm/mock.ts";
import type { LlmProvider } from "../llm/types.ts";
import type { Discrepancy, EnrichResult, Fact, Mode, PageAnalysis } from "../pipeline/types.ts";
import { loadConfig, type EnrichConfig } from "./config.ts";
import { crossCheck, toDiscrepancy, type CrossCheck, type SourceNumber } from "./crosscheck.ts";
import { day, factsFor, wikidataSource, wikipediaSource, type Resolved } from "./facts.ts";
import { HttpClient, HttpError, type FetchLike } from "./http.ts";
import { judge, type ArticleChoice, type VideoVerdict } from "./judge.ts";
import { bookQuantities, expandName, selectLookups, type Lookup } from "./select.ts";
import { keywordSet, overlap, tokens } from "./text.ts";
import { commonsProvider } from "./videos/commons.ts";
import { prefilter, type Prefiltered } from "./videos/filter.ts";
import type { VideoCandidate, VideoProvider } from "./videos/types.ts";
import { youtubeProvider } from "./videos/youtube.ts";
import { fetchEntities, type WdItem } from "./wikidata.ts";
import { fetchTitles, leadNumbers, search, wikiLang, type WpArticle } from "./wikipedia.ts";

export const DEFAULT_ENRICH_LLM_DIR = fileURLToPath(new URL("../../../fixtures/enrich/llm/", import.meta.url));
export const VIDEO_PROVIDERS: VideoProvider[] = [commonsProvider, youtubeProvider];

export interface EnrichOptions {
  mode: Mode;
  /** null disables the cache. */
  cacheDir?: string | null;
  /** null disables the ledger. */
  ledgerPath?: string | null;
  /** Default: mock -> recordings in fixtures/enrich/llm; live -> Claude Code CLI (config judge_model). */
  provider?: LlmProvider;
  /** Live only: write HTTP responses to fixtures/http and LLM answers to fixtures/enrich/llm. */
  record?: boolean;
  /** Label of the LLM recording (e.g. the page name). */
  label?: string;
  httpFixturesDir?: string;
  config?: EnrichConfig;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** User's language (validated BCP-47, D21): Wikipedia edition, Wikidata labels, YouTube language. */
  locale?: string;
}

/** What happened, for the CLI and the report (not part of the pipeline contract). */
export interface EnrichDetails {
  lookups: { name: string; type: string; candidates: string[]; chosen?: string; qid?: string }[];
  checks: CrossCheck[];
  videoCandidates: number;
  prefilter: Prefiltered["rejected"];
  verdicts: VideoVerdict[];
  judged: boolean;
  errors: string[];
  ledger?: LedgerEntry;
}

export async function enrich(analysis: PageAnalysis, opts: EnrichOptions): Promise<EnrichResult> {
  return (await enrichDetailed(analysis, opts)).result;
}

const MAX_CANDIDATES = 4;

function pageSource(a: PageAnalysis): Source {
  return { id: PAGE_SOURCE_ID, kind: "page", title: `${a.subject} · ${a.topic}` };
}

function defaultProvider(opts: EnrichOptions, cfg: EnrichConfig): LlmProvider {
  if (opts.mode !== "live") return new MockProvider(DEFAULT_ENRICH_LLM_DIR);
  const live = createProvider({ ...process.env, PAGINAVIVA_MODE: "live" }, { fixturesDir: DEFAULT_ENRICH_LLM_DIR, claudeCli: { model: cfg.judgeModel } });
  return opts.record ? new RecordingProvider(live, () => `enrich_${opts.label ?? "page"}`, DEFAULT_ENRICH_LLM_DIR) : live;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function enrichDetailed(analysis: PageAnalysis, opts: EnrichOptions): Promise<{ result: EnrichResult; details: EnrichDetails }> {
  const t0 = Date.now();
  const phases: Record<string, number> = {};
  const lap = (k: string, since: number): number => {
    const now = Date.now();
    phases[k] = now - since;
    return now;
  };
  const base = opts.config ?? loadConfig();
  const locale = isItalian(opts.locale) ? undefined : opts.locale;
  const lang = wikiLang(locale);
  // YouTube for another language (D21): that language and the locale's region (none: no region filter);
  // the approved channels exist only for Italian, so the LLM judge alone decides on quality.
  const cfg: EnrichConfig = locale
    ? { ...base, videos: { ...base.videos, youtube: { ...base.videos.youtube, relevanceLanguage: lang, regionCode: regionOf(locale) ?? "", channels: [], allowlistOnly: false } } }
    : base;
  const http = new HttpClient({
    mode: opts.mode,
    cacheDir: opts.cacheDir,
    fixturesDir: opts.httpFixturesDir,
    record: opts.mode === "live" && opts.record,
    userAgent: cfg.userAgent,
    requestsPerMinute: cfg.requestsPerMinute,
    cacheTtlDays: cfg.cacheTtlDays,
    fetch: opts.fetch,
    sleep: opts.sleep,
  });
  const details: EnrichDetails = { lookups: [], checks: [], videoCandidates: 0, prefilter: [], verdicts: [], judged: false, errors: [] };

  // 1-2. Entities -> Wikipedia candidates.
  let t = Date.now();
  const lookups = selectLookups(analysis, cfg.maxLookups);
  const context = keywordSet(analysis.subject, analysis.topic, ...analysis.concepts);
  const contextOf = (l: Lookup): Set<string> => {
    const own = new Set(tokens(l.name));
    return new Set([...context].filter((k) => !own.has(k)));
  };
  const candidates = new Map<Lookup, WpArticle[]>();
  try {
    const exact = await fetchTitles(http, lookups.map((l) => expandName(l.name)), locale);
    const searchNeed = lookups
      .map((l) => ({ l, a: exact.get(expandName(l.name)) }))
      .filter(({ l, a }) => !a || a.disambiguation || ["term", "object", "group", "topic"].includes(l.type))
      .sort((x, y) => Number(Boolean(x.a && !x.a.disambiguation)) - Number(Boolean(y.a && !y.a.disambiguation)))
      .slice(0, cfg.maxSearches);
    const searched = new Map<Lookup, WpArticle[]>();
    for (const { l } of searchNeed) searched.set(l, await search(http, l.query ?? expandName(l.name), 4, locale));
    for (const l of lookups) {
      const list: WpArticle[] = [];
      const add = (a: WpArticle | undefined): void => {
        if (a && !a.disambiguation && !list.some((x) => x.title === a.title) && list.length < MAX_CANDIDATES) list.push(a);
      };
      add(exact.get(expandName(l.name)));
      for (const a of searched.get(l) ?? []) add(a);
      if (list.length) candidates.set(l, list);
    }
  } catch (e) {
    details.errors.push(`wikipedia: ${errText(e)}`);
  }
  t = lap("wikipedia", t);

  // 3. Wikidata for every candidate item.
  let items = new Map<string, WdItem>();
  let wdFetchedAt: string | undefined;
  const qids = [...candidates.values()].flat().map((a) => a.wikibaseItem).filter((q): q is string => !!q);
  if (qids.length) {
    try {
      ({ items, fetchedAt: wdFetchedAt } = await fetchEntities(http, qids, lang));
    } catch (e) {
      details.errors.push(`wikidata: ${errText(e)}`);
    }
  }
  t = lap("wikidata", t);

  // 4. Videos: queries from the labels of the best-guess articles of the top entities.
  const ranked = lookups.filter((l) => candidates.has(l));
  // Before the judge, the heuristic choice stands in for the article (see step 6).
  const heuristic = (l: Lookup): WpArticle | undefined =>
    (candidates.get(l) ?? []).find((a) => overlap(a.extract.slice(0, 600), contextOf(l)) > 0);
  const guessItem = (l: Lookup): WdItem | undefined => {
    const q = heuristic(l)?.wikibaseItem;
    return q ? items.get(q) : undefined;
  };
  // The topic first, then natural features (a height but no population/area: volcanoes,
  // mountains) and events, which film better than towns; then the page ranking.
  const visual = (l: Lookup): number => {
    const v = guessItem(l)?.values;
    return l.type === "event" || (v?.P2044 && !v.P1082 && !v.P2046) ? 1 : 0;
  };
  const queryLookups = ranked
    .filter((l) => heuristic(l))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => Number(b.l.isTopic) - Number(a.l.isTopic) || visual(b.l) - visual(a.l) || b.l.mentions - a.l.mentions || a.i - b.i)
    .map((x) => x.l);
  const itLabel = (l: Lookup): string => heuristic(l)?.title.replace(/\s*\([^)]*\)$/, "") ?? expandName(l.name);
  const lit = analysis.literary;
  const queries = queryLookups.slice(0, Math.max(cfg.videos.commons.maxQueries, cfg.videos.youtube.maxQueries)).map((l, i) => ({
    text: guessItem(l)?.labelEn ?? guessItem(l)?.labelIt ?? expandName(l.name),
    // YouTube (Italian): the topic plus the subject ("Campania geografia"); for fiction, work + author.
    textIt: i > 0 ? itLabel(l) : lit.isLiterary ? [lit.work, lit.author].filter(Boolean).join(" ") || itLabel(l) : `${itLabel(l)} ${analysis.subject}`,
  }));
  const videoKeywords = keywordSet(
    analysis.topic,
    ...analysis.concepts,
    ...lookups.map((l) => expandName(l.name)),
    ...ranked.flatMap((l) => [guessItem(l)?.labelEn ?? "", guessItem(l)?.labelIt ?? ""]),
  );
  let rawVideos: VideoCandidate[] = [];
  for (const p of VIDEO_PROVIDERS) {
    if (!p.enabled(cfg) || queries.length === 0) continue;
    // YouTube live needs the key; without it the provider is simply off (no error).
    if (p.name === "youtube" && opts.mode === "live" && !cfg.videos.youtube.apiKey) continue;
    const provQueries = p.name === "commons" ? queries.slice(0, cfg.videos.commons.maxQueries) : queries;
    try {
      rawVideos = rawVideos.concat(await p.search(http, provQueries, cfg));
    } catch (e) {
      // Mock: a page recorded before YouTube was enabled has no YouTube recording: not an error.
      if (p.name === "youtube" && opts.mode === "mock" && e instanceof HttpError && e.code === "fixture_missing") continue;
      details.errors.push(`videos/${p.name}: ${errText(e)}`);
    }
  }
  const pre = prefilter(rawVideos, videoKeywords, cfg);
  const videoCands = pickCandidates(pre.kept.map((k) => k.c), cfg.videos.maxCandidates);
  details.videoCandidates = rawVideos.length;
  details.prefilter = pre.rejected;
  t = lap("videos", t);

  // 5. LLM judgement.
  const choices: ArticleChoice[] = ranked.map((l) => ({
    entity: l.name,
    candidates: (candidates.get(l) ?? []).map((a) => ({ title: a.title, extract: a.extract.split("\n")[0] ?? "" })),
  }));
  let chosenTitles: Map<string, string> | undefined;
  let verdicts: VideoVerdict[] = [];
  let usage: { provider?: string; model?: string; tokensIn?: number; tokensOut?: number; cacheRead?: number; cacheCreation?: number; cost?: number } = {};
  if (choices.length || videoCands.length) {
    const provider = opts.provider ?? defaultProvider(opts, cfg);
    try {
      const j = await judge(provider, analysis, choices, videoCands, locale);
      chosenTitles = j.articles;
      verdicts = j.videos;
      details.judged = true;
      usage = {
        provider: provider.name,
        model: j.model,
        tokensIn: j.usage?.inputTokens,
        tokensOut: j.usage?.outputTokens,
        cacheRead: j.usage?.cacheReadInputTokens,
        cacheCreation: j.usage?.cacheCreationInputTokens,
        cost: j.usage?.costUsdEstimate,
      };
    } catch (e) {
      details.errors.push(`judge: ${errText(e)}`);
      usage = { provider: provider.name, model: provider.model };
    }
  }
  t = lap("judge", t);

  // 6. Facts, sources, discrepancies, videos.
  const resolved: Resolved[] = [];
  for (const l of ranked) {
    const list = candidates.get(l) ?? [];
    let article: WpArticle | undefined;
    if (chosenTitles) {
      const title = chosenTitles.get(l.name);
      article = title ? list.find((a) => a.title === title) : undefined;
    } else {
      // Heuristic fallback: the first candidate whose lead shares a keyword with the page.
      article = heuristic(l);
    }
    details.lookups.push({
      name: l.name,
      type: l.type,
      candidates: list.map((a) => a.title),
      chosen: article?.title,
      qid: article?.wikibaseItem,
    });
    if (article) resolved.push({ lookup: l, article, item: article.wikibaseItem ? items.get(article.wikibaseItem) : undefined });
  }

  const sources = new Map<string, Source>([[PAGE_SOURCE_ID, pageSource(analysis)]]);
  const drafts: Omit<Fact, "id">[] = [];
  for (const r of resolved) {
    const f = factsFor(r, wdFetchedAt);
    for (const s of f.sources) sources.set(s.id, s);
    // Two page entities can resolve to the same article ("tempi semplici", "tempi composti").
    for (const d of f.facts) if (!drafts.some((x) => x.text === d.text && x.sourceId === d.sourceId)) drafts.push(d);
  }
  const facts: Fact[] = drafts.slice(0, cfg.maxFacts).map((f, i) => ({ id: `f${i + 1}`, ...f }));

  const topic = lookups.find((l) => l.isTopic)?.name;
  const discrepancies: Discrepancy[] = [];
  for (const q of bookQuantities(analysis, topic)) {
    const r = resolved.find((x) => x.lookup.name === q.owner);
    if (!r) continue;
    const c = crossCheck(q, sourceNumber(r, q.kind, wdFetchedAt));
    if (!c) continue;
    details.checks.push(c);
    if (!c.match) {
      const src = c.source.from === "wikipedia" ? wikipediaSource(r.article) : wikidataSource(r.item!, wdFetchedAt!);
      sources.set(src.id, src);
      discrepancies.push(toDiscrepancy(analysis, q, c));
    }
  }

  details.verdicts = verdicts;
  // Best first across providers; audio in the user's language (Italian by default) and listed channels get a small bonus.
  const rank = (v: VideoVerdict): number => {
    const y = videoCands.find((x) => x.ref === v.ref)?.youtube;
    return v.relevance + (y?.language?.toLowerCase().startsWith(lang) ? 0.1 : 0) + (y?.preferredChannel ? 0.05 : 0);
  };
  const accepted = verdicts
    .filter((v) => v.childSafe && v.relevance >= cfg.videos.minRelevance)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, cfg.videos.maxVideos);
  const videos: Video[] = [];
  for (const v of accepted) {
    const c = videoCands.find((x) => x.ref === v.ref)!;
    const id = `v${videos.length + 1}`;
    videos.push({
      id,
      provider: c.provider,
      ref: c.ref,
      title: v.titleIt || c.title,
      ...(c.author ? { channel: c.author } : {}),
      ...(c.durationSec ? { durationSec: Math.round(c.durationSec) } : {}),
    });
    // Convention until Video gets a sourceId: the video's Source id is "<provider>-<video id>".
    sources.set(`${c.provider}-${id}`, {
      id: `${c.provider}-${id}`,
      kind: "web",
      title: c.provider === "youtube" ? `YouTube: ${c.title}${c.author ? ` (${c.author})` : ""}` : `Wikimedia Commons: ${c.title}`,
      url: c.pageUrl,
      publisher: c.provider === "youtube" ? (c.author ?? "YouTube") : "Wikimedia Commons",
      accessed: day(c.fetchedAt),
      ...(c.license ? { license: c.license } : {}),
    });
  }
  lap("build", t);
  phases.total = Date.now() - t0;

  const result: EnrichResult = {
    sources: [...sources.values()],
    facts,
    discrepancies,
    videos,
    stats: { requests: http.requests, cached: http.cached, durationMs: phases.total },
  };

  if (opts.ledgerPath !== null) {
    details.ledger = appendEnrichLedger(
      {
        time: new Date().toISOString(),
        kind: "enrich",
        provider: usage.provider,
        model: usage.model,
        phasesMs: phases,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cacheReadTokens: usage.cacheRead,
        cacheCreationTokens: usage.cacheCreation,
        costUsdEstimate: usage.cost,
        llmCalls: usage.provider ? 1 : 0,
        externalRequests: http.requests,
        videoQuota: http.quotaUnits,
        cached: http.requests === 0,
        engine: analysis.suggestedEngine,
        validation: details.errors.length ? "error" : "ok",
        error: details.errors.length ? details.errors.join(" | ") : undefined,
      },
      opts.ledgerPath ?? (process.env.PAGINAVIVA_LEDGER || DEFAULT_LEDGER_PATH),
    );
  }
  return { result, details };
}

/** Up to `max` candidates, best first; with several providers each gets an equal share first. */
export function pickCandidates(sorted: VideoCandidate[], max: number): VideoCandidate[] {
  const providers = [...new Set(sorted.map((c) => c.provider))];
  if (providers.length <= 1) return sorted.slice(0, max);
  const share = Math.ceil(max / providers.length);
  const first = providers.flatMap((p) => sorted.filter((c) => c.provider === p).slice(0, share));
  const rest = sorted.filter((c) => !first.includes(c));
  return [...sorted.filter((c) => first.includes(c)), ...rest].slice(0, max);
}

/** The source value a page number is compared with. */
function sourceNumber(r: Resolved, kind: CrossCheck["kind"], wdFetchedAt: string | undefined): SourceNumber | undefined {
  const wp = wikipediaSource(r.article);
  const wd = r.item && wdFetchedAt ? wikidataSource(r.item, wdFetchedAt) : undefined;
  const v = r.item?.values;
  const lead = leadNumbers(r.article.extract);
  const q = (p: "P1082" | "P2046" | "P2044" | "P2043", unit?: string): SourceNumber | undefined => {
    const x = v?.[p];
    if (!wd || x?.kind !== "quantity" || (unit && x.unit !== unit)) return undefined;
    return { value: x.amount, sourceId: wd.id, from: "wikidata", ...(x.pointInTime ? { year: x.pointInTime.year } : {}) };
  };
  const fromWp = (n: number | undefined): SourceNumber | undefined => (n === undefined ? undefined : { value: n, sourceId: wp.id, from: "wikipedia" });
  switch (kind) {
    case "population":
      return fromWp(lead.population) ?? q("P1082");
    case "area":
      return q("P2046", "km²") ?? fromWp(lead.area);
    case "elevation":
      return q("P2044", "m") ?? fromWp(lead.elevation);
    case "length":
      return q("P2043", "km");
    case "year": {
      for (const p of ["P585", "P580", "P571"] as const) {
        const x = v?.[p];
        if (wd && x?.kind === "time" && x.time.precision >= 9) return { value: x.time.year, sourceId: wd.id, from: "wikidata" };
      }
      return undefined;
    }
  }
}

/**
 * Writes an "enrich" ledger line. sanitizeEntry() (ledger.ts) used to force
 * kind "analyze" and drop videoQuota; both are still set explicitly after sanitising.
 */
export function appendEnrichLedger(entry: LedgerEntry, path: string): LedgerEntry {
  const quota = entry.videoQuota;
  const clean: LedgerEntry = {
    ...sanitizeEntry(entry),
    kind: "enrich",
    ...(typeof quota === "number" && Number.isFinite(quota) && quota > 0 ? { videoQuota: quota } : {}),
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(clean) + "\n");
  return clean;
}
