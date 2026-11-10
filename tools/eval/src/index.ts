// Dataset evaluation (brief §7): runs analyze -> (enrich) -> generate over fixtures/pages/*.expected.yaml
// and writes docs/eval/report-<date>.md.
//
//   npx tsx tools/eval/src/index.ts [--live] [--model <alias>] [--date YYYY-MM-DD] [pages...]
//
// Mock by default: the analysis and the generation are replayed from fixtures/llm/ (recorded live),
// so the timings and token counts in the report are the ones measured when recording. Enrichment
// comes from fixtures/enrich/<page>.json (or only the page source when missing), geo from
// fixtures/public/geo/. With --live the generation calls the Claude Code CLI and records the responses.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkScene, type SceneSpec } from "../../../packages/scene-spec/src/index.ts";
import { chooseEngine, GENERATE_FIXTURES_DIR, generateScene, generationRequest, type GenerateOutcome } from "../../../server/src/generate/index.ts";
import { loadPageInputs, PAGES_DIR, type PageInputs } from "../../../server/src/generate/inputs.ts";
import { shownTexts } from "../../../server/src/generate/checks.ts";
import { EffortCliProvider } from "../../../server/src/generate/provider.ts";
import { MockProvider, readRecordings, RecordingProvider, requestKey } from "../../../server/src/llm/mock.ts";
import type { LlmProvider, LlmUsage } from "../../../server/src/llm/types.ts";
import { factCoverage } from "./facts.ts";
import { parseYamlLite } from "./yaml-lite.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPORT_DIR = join(ROOT, "docs", "eval");

interface Expected {
  label: string;
  subject: string;
  topic: string;
  engine: string;
  acceptable: string[];
  keyFacts: string[];
  mustNot: string[];
  status: string;
}

function loadExpected(): Expected[] {
  return readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".expected.yaml"))
    .sort()
    .map((f) => {
      const y = parseYamlLite(readFileSync(join(PAGES_DIR, f), "utf8")) as Record<string, unknown>;
      return {
        label: f.replace(/\.expected\.yaml$/, ""),
        subject: String(y.subject ?? ""),
        topic: String(y.topic ?? ""),
        engine: String(y.engine ?? ""),
        acceptable: (y.acceptable_engines as string[] | undefined) ?? [],
        keyFacts: ((y.key_facts as unknown[] | undefined) ?? []).map(String),
        mustNot: ((y.must_not as unknown[] | undefined) ?? []).map(String),
        status: String(y.status ?? ""),
      };
    });
}

function sceneText(scene: SceneSpec): string {
  return [
    ...shownTexts(scene).map((t) => t.text),
    ...scene.chapters.flatMap((c) => c.narration.map((s) => s.speech ?? "")),
  ].join("\n");
}

interface PageResult {
  exp: Expected;
  inputs?: PageInputs;
  gen?: GenerateOutcome;
  analysisMs?: number;
  analysisUsage?: LlmUsage;
  analysisModel?: string;
  error?: string;
}

function analysisRecording(label: string) {
  return readRecordings().find((r) => r.label === label);
}

const sec = (ms: number | undefined) => (ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);
const tok = (u: LlmUsage | undefined) =>
  u ? `${(u.inputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0)} / ${u.outputTokens ?? 0}` : "–";
const usd = (u: LlmUsage | undefined) => (u?.costUsdEstimate === undefined ? "–" : `${u.costUsdEstimate.toFixed(3)}`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function report(results: PageResult[], date: string, mode: string): string {
  const L: string[] = [];
  L.push(`# Eval report — ${date}`, "");
  L.push(
    `Pipeline: analysis (replayed from the M2 recordings) -> enrichment (fixtures/enrich/, page source only when missing) -> generation (${mode}). ` +
      "Timings and tokens are those measured live when the LLM responses were recorded (Claude Code CLI, user subscription: the cost column is the CLI's list-price estimate, not billed). " +
      "Expected values: fixtures/pages/*.expected.yaml (status: draft, to confirm with the user).",
    "",
  );

  L.push("## Topic and engine", "", "| Page | Topic (analysis) | Expected engine | Chosen | Scene | Validation | Chapters | Book / activity |", "|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const g = r.gen;
    const a = r.inputs?.analysis.analysis;
    const ok = g && (g.engine === r.exp.engine || r.exp.acceptable.includes(g.engine)) ? "✔" : "✘";
    L.push(
      `| ${r.exp.label} | ${cell(a?.topic ?? "–")} (exp. ${cell(r.exp.topic)}) | ${r.exp.engine}${r.exp.acceptable.length ? ` (ok: ${r.exp.acceptable.join(", ")})` : ""} | ${g ? `${g.engine} ${ok}` : "–"}${g?.engineOverride ? ` (${g.engineOverride})` : ""} | ${g?.scene.engine ?? "–"} | ${g?.validation ?? `error: ${cell(r.error ?? "")}`} | ${g?.scene.chapters.length ?? "–"} | ${g ? `${g.scene.chapters.filter((c) => c.book).length} / ${g.scene.chapters.filter((c) => c.activity).length}` : "–"} |`,
    );
  }

  L.push("", "## Key facts", "", "Automatic match: content words (stems) and numbers of each expected fact searched in all the scene's shown and spoken text. ✔ ≥ 75 % and all numbers, ~ ≥ 40 %, ✘ below. Check by hand.", "");
  for (const r of results) {
    if (!r.gen) continue;
    const text = sceneText(r.gen.scene);
    L.push(`**${r.exp.label}**`, "");
    for (const f of r.exp.keyFacts) {
      const c = factCoverage(f, text);
      const mark = c.ratio >= 0.75 && c.missingNumbers.length === 0 ? "✔" : c.ratio >= 0.4 ? "~" : "✘";
      const miss = [...c.missingNumbers, ...c.missingWords].slice(0, 8).join(", ");
      L.push(`- ${mark} ${Math.round(c.ratio * 100)} % — ${f}${miss ? ` _(missing: ${miss})_` : ""}`);
    }
    for (const m of r.exp.mustNot) L.push(`- ⚠ must not: ${m} — check by hand`);
    L.push("");
  }

  L.push("## Numbers and sources", "", "| Page | Digits without sourceIds (must be 0) | Numbers not on the page nor in the facts | Sources cited | Facts available | Enrichment |", "|---|---|---|---|---|---|");
  for (const r of results) {
    if (!r.gen) continue;
    const unsourced = checkScene(r.gen.scene).filter((i) => /without source/.test(i.message)).length;
    const unverified = r.gen.issues.filter((i) => i.message.startsWith("number not on the page")).length;
    L.push(`| ${r.exp.label} | ${unsourced} | ${unverified} | ${r.gen.scene.sources.length} | ${r.inputs?.input.enrich.facts.length ?? 0} | ${r.inputs?.enrichOrigin ?? "–"} |`);
  }

  L.push(
    "",
    "## Timings and LLM usage",
    "",
    "First content = the chapter built from the analysis summary (`earlyChapter`, no LLM): available as soon as the analysis is done. Enrichment time from EnrichResult.stats.",
    "",
    "| Page | Analysis | Enrichment | Generation (LLM) | Calls | First content | Full scene | Tokens in/out (analysis) | Tokens in/out (generation) | Est. USD (analysis + generation) | Model |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of results) {
    const g = r.gen;
    const enrichMs = r.inputs?.input.enrich.stats.durationMs ?? 0;
    const gen = g?.llmReportedMs;
    const total = (r.analysisMs ?? 0) + enrichMs + (gen ?? 0);
    L.push(
      `| ${r.exp.label} | ${sec(r.analysisMs)} | ${sec(enrichMs)} | ${sec(gen)} | ${g?.llmCalls ?? "–"} | ${sec(r.analysisMs)} | ${sec(total)} | ${tok(r.analysisUsage)} | ${tok(g?.usage)} | ${usd(r.analysisUsage)} + ${usd(g?.usage)} | ${r.analysisModel ?? "–"} / ${g?.model ?? "–"} |`,
    );
  }

  L.push("", "## Videos proposed", "", "Vote 1–5 (user): relevance and quality for the page.", "", "| Page | Video | Provider | Ref | Vote (1–5) |", "|---|---|---|---|---|");
  for (const r of results) {
    const v = r.gen?.scene.videos ?? [];
    if (v.length === 0) L.push(`| ${r.exp.label} | (none) | | | |`);
    for (const x of v) L.push(`| ${r.exp.label} | ${cell(x.title)} | ${x.provider} | ${cell(x.ref)} | |`);
  }

  L.push("", "## For human review", "", "Automatic findings (content issues, warnings, fallbacks, server-side fixes). Read the generated scenes too: fixtures/public/scenes/gen-<page>.scene.json (open with ?scene=gen-<page>).", "");
  for (const r of results) {
    L.push(`**${r.exp.label}**`, "");
    if (r.error) L.push(`- ERROR: ${r.error}`);
    const g = r.gen;
    if (!g) {
      L.push("");
      continue;
    }
    if (g.fallback) L.push(`- fallback card: ${g.fallbackReason}`);
    for (const p of g.repairProblems) L.push(`- first answer, fixed by the repair call: ${p}`);
    if (g.engineOverride) L.push(`- engine override: ${g.engineOverride}`);
    if (!(g.engine === r.exp.engine || r.exp.acceptable.includes(g.engine))) L.push(`- engine ${g.engine}, expected ${r.exp.engine}`);
    for (const i of g.issues) L.push(`- issue ${i.path}: ${i.message}`);
    for (const i of g.warnings) L.push(`- warning ${i.path}: ${i.message}`);
    if (g.fixes.length) L.push(`- server fixes (${g.fixes.length}): ${g.fixes.slice(0, 12).join("; ")}${g.fixes.length > 12 ? "; …" : ""}`);
    if (!g.issues.length && !g.warnings.length && !g.fallback) L.push("- no automatic findings");
    L.push("");
  }
  return L.join("\n") + "\n";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let live = false;
  let model: string | undefined;
  let date = new Date().toISOString().slice(0, 10);
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "--live") live = true;
    else if (v === "--model") model = argv[++i];
    else if (v === "--date") date = argv[++i]!;
    else if (v.startsWith("--")) throw new Error(`Unknown option ${v}`);
    else only.push(v);
  }
  let label = "";
  const provider: LlmProvider = live ? new RecordingProvider(new EffortCliProvider({ model }), () => `gen_${label}`, GENERATE_FIXTURES_DIR) : new MockProvider(GENERATE_FIXTURES_DIR);

  const results: PageResult[] = [];
  for (const exp of loadExpected().filter((e) => only.length === 0 || only.includes(e.label))) {
    label = exp.label;
    const r: PageResult = { exp };
    try {
      r.inputs = await loadPageInputs(exp.label);
      const rec = analysisRecording(exp.label);
      r.analysisMs = rec?.response.durationMs;
      r.analysisUsage = rec?.response.usage;
      r.analysisModel = rec?.response.model;
      if (!live) {
        const { engine } = chooseEngine(r.inputs.input.analysis, r.inputs.input.geo);
        const key = requestKey(generationRequest(r.inputs.input, engine));
        if (!readRecordings(GENERATE_FIXTURES_DIR).some((x) => x.key === key))
          throw new Error("generation recording stale (prompt, schema or inputs changed since it was recorded): re-record with --live");
      }
      r.gen = await generateScene(r.inputs.input, { provider, ledgerPath: null });
      console.log(`${exp.label}: ${r.gen.engine} -> ${r.gen.scene.engine} ${r.gen.validation} (${sec(r.gen.llmReportedMs)})`);
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
      console.log(`${exp.label}: ERROR ${r.error}`);
    }
    results.push(r);
  }
  mkdirSync(REPORT_DIR, { recursive: true });
  const file = join(REPORT_DIR, `report-${date}.md`);
  writeFileSync(file, report(results, date, live ? "live, recorded" : "mock replay"));
  console.log(`wrote ${file}`);
  if (!existsSync(file)) process.exit(1);
}

await main();

