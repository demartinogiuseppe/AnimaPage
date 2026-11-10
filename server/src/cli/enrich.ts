// CLI: enrich analysed pages (facts, discrepancies, videos) and save each EnrichResult.
//
//   pnpm --filter @pv/server enrich [--mock] [--no-record] [--no-cache] [--out <dir>] <analysis.json | page name>...
//
// A page name is the label of a recorded analysis in fixtures/llm/ (e.g. geografia_campania_p84).
// Live (default): network + Claude Code CLI; HTTP responses are recorded into fixtures/http/ and the
// judge's answers into fixtures/enrich/llm/, so `--mock` (and the tests) replay them offline.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageAnalysis } from "@pv/scene-spec";
import { enrichDetailed } from "../enrich/index.ts";
import { DEFAULT_FIXTURES_DIR, readRecordings } from "../llm/mock.ts";

// server/.env holds YOUTUBE_API_KEY (optional); it is only read into the environment, never printed.
const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const DEFAULT_ENRICH_OUT = fileURLToPath(new URL("../../../fixtures/enrich/", import.meta.url));

interface Args {
  mock: boolean;
  record: boolean;
  cache: boolean;
  out: string;
  inputs: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { mock: false, record: true, cache: true, out: DEFAULT_ENRICH_OUT, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "--mock") a.mock = true;
    else if (v === "--no-record") a.record = false;
    else if (v === "--no-cache") a.cache = false;
    else if (v === "--out") a.out = argv[++i]!;
    else if (v === "--") continue;
    else if (v.startsWith("--")) throw new Error(`Unknown option ${v}`);
    else a.inputs.push(v);
  }
  return a;
}

/** A recorded analysis by page label (latest recording wins). */
function recordedAnalysis(label: string, dir = DEFAULT_FIXTURES_DIR): PageAnalysis | undefined {
  const recs = readRecordings(dir)
    .filter((r) => r.label === label)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return recs[0]?.response.data as PageAnalysis | undefined;
}

function loadInput(input: string, base: string): { label: string; analysis: PageAnalysis } {
  const file = resolve(base, input);
  if (input.endsWith(".json") && existsSync(file)) {
    const j = JSON.parse(readFileSync(file, "utf8")) as { response?: { data?: unknown }; label?: string };
    const analysis = (j.response?.data ?? j) as PageAnalysis;
    const label = j.label ?? basename(file, ".json").split(".")[0]!;
    return { label, analysis };
  }
  const analysis = recordedAnalysis(input);
  if (!analysis) throw new Error(`No recorded analysis labelled '${input}' in ${DEFAULT_FIXTURES_DIR}`);
  return { label: input, analysis };
}

const mmss = (s?: number): string => (s === undefined ? "-" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.inputs.length === 0) {
    console.error("usage: enrich [--mock] [--no-record] [--no-cache] [--out <dir>] <analysis.json | page name>...");
    process.exit(2);
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  const out = resolve(base, args.out);
  let failures = 0;
  for (const input of args.inputs) {
    try {
      const { label, analysis } = loadInput(input, base);
      const { result, details } = await enrichDetailed(analysis, {
        mode: args.mock ? "mock" : "live",
        record: !args.mock && args.record,
        label,
        cacheDir: args.cache ? undefined : null,
      });
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${label}.json`), JSON.stringify(result, null, 2) + "\n");
      const s = result.stats;
      console.log(`${label}  (${(s.durationMs / 1000).toFixed(1)} s, requests ${s.requests}, cached ${s.cached}, judged ${details.judged}, YouTube quota ${details.ledger?.videoQuota ?? 0})`);
      for (const l of details.lookups) console.log(`  lookup ${l.name} [${l.type}] -> ${l.chosen ?? "none"} ${l.qid ?? ""}  (${l.candidates.join(" | ")})`);
      console.log(`  facts ${result.facts.length}, sources ${result.sources.length}`);
      for (const c of details.checks) console.log(`  check ${c.name}: book ${c.bookValue} vs ${c.source.value} (${c.source.sourceId}) ${c.match ? "ok" : "DIFFERENT"}`);
      for (const d of result.discrepancies) console.log(`  discrepancy: ${d.bookValue} vs ${d.sourceValue} [${d.sourceId}] ${d.note ?? ""}`);
      console.log(`  video candidates ${details.videoCandidates}, rejected by pre-filter ${details.prefilter.length}, judged ${details.verdicts.length}`);
      for (const r of details.prefilter) console.log(`    - ${r.reason}${r.detail ? ` (${r.detail})` : ""}: ${r.ref}`);
      for (const v of details.verdicts) console.log(`    ? ${v.relevance.toFixed(2)} ${v.childSafe ? "safe" : "UNSAFE"} ${v.ref} — ${v.reason}`);
      for (const v of result.videos) {
        const src = result.sources.find((x) => x.id === `${v.provider}-${v.id}`);
        console.log(`  VIDEO ${v.id} "${v.title}" ${mmss(v.durationSec)} ${src?.license ?? ""} ${src?.url ?? v.ref}`);
      }
      for (const e of details.errors) console.log(`  ERROR ${e}`);
      if (details.errors.length) failures++;
    } catch (e) {
      failures++;
      console.log(`${input}\n  FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  process.exit(failures ? 1 : 0);
}

await main();
