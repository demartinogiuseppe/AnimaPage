// CLI: generate SceneSpecs for dataset pages (fixtures/pages/<label>.jpg).
//
//   pnpm --filter @pv/server generate [--live] [--model <alias>] [--effort <level>] [--no-record] [--no-save] <labels...>
//
// The analysis is always replayed from fixtures/llm/ (recorded in M2). Enrichment comes from
// fixtures/enrich/<label>.json when present (else only the page source), geo from fixtures/public/geo/.
// Default is mock: generation responses are replayed from fixtures/llm/generate/. With --live the
// Claude Code CLI is called and every response is recorded into fixtures/llm/generate/ (gen_<label>).
// Output: fixtures/public/scenes/gen-<label>.scene.json (open with ?scene=gen-<label>).
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATE_FIXTURES_DIR, generateScene, type GenerateOutcome } from "../generate/index.ts";
import { loadPageInputs } from "../generate/inputs.ts";
import { EffortCliProvider, effortFromEnv, type Effort } from "../generate/provider.ts";
import { MockProvider, RecordingProvider } from "../llm/mock.ts";
import type { LlmProvider } from "../llm/types.ts";

const GENERATED_SCENES_DIR = fileURLToPath(new URL("../../../fixtures/public/scenes/", import.meta.url));

interface Args {
  live: boolean;
  model?: string;
  effort?: Effort;
  record: boolean;
  save: boolean;
  labels: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { live: false, record: true, save: true, labels: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "--live") a.live = true;
    else if (v === "--model") a.model = argv[++i];
    else if (v === "--effort") a.effort = effortFromEnv(argv[++i]);
    else if (v === "--no-record") a.record = false;
    else if (v === "--no-save") a.save = false;
    else if (v === "--") continue;
    else if (v.startsWith("--")) throw new Error(`Unknown option ${v}`);
    else a.labels.push(basename(v, extname(v)).replace(/\.expected$/, ""));
  }
  return a;
}

const s = (ms: number | undefined) => `${((ms ?? 0) / 1000).toFixed(1)} s`;

function summary(label: string, r: GenerateOutcome): string {
  const u = r.usage;
  const tokensIn = (u.inputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0);
  const ch = r.scene.chapters;
  return [
    label,
    `  engine ${r.engine}${r.engineOverride ? ` (${r.engineOverride})` : ""} -> ${r.scene.engine} | ${r.validation}${r.fallbackReason ? `: ${r.fallbackReason.slice(0, 200)}` : ""}`,
    `  ${ch.length} chapters, ${ch.reduce((n, c) => n + c.narration.length, 0)} sentences, ${ch.reduce((n, c) => n + c.pins.length, 0)} pins, ${ch.reduce((n, c) => n + c.quiz.length, 0)} quiz, ${r.scene.videos.length} videos, ${r.scene.sources.length} sources`,
    `  ${r.model ?? "-"} | ${r.llmCalls} call(s) | LLM ${s(r.llmReportedMs)} | total ${s(r.durationMs)} | tokens in ${tokensIn} / out ${u.outputTokens ?? 0}`,
    `  issues ${r.issues.length}, warnings ${r.warnings.length}, fixes ${r.fixes.length}`,
    ...r.repairProblems.slice(0, 8).map((p) => `    repaired: ${p.slice(0, 160)}`),
    ...r.issues.slice(0, 8).map((i) => `    ! ${i.path}: ${i.message.slice(0, 160)}`),
    ...r.warnings.slice(0, 8).map((i) => `    ~ ${i.path}: ${i.message.slice(0, 160)}`),
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.labels.length === 0) {
    console.error("usage: generate [--live] [--model <alias>] [--effort low|medium|high] [--no-record] [--no-save] <page labels...>");
    process.exit(2);
  }
  let label = "";
  let provider: LlmProvider = args.live ? new EffortCliProvider({ model: args.model, effort: args.effort }) : new MockProvider(GENERATE_FIXTURES_DIR);
  if (args.live && args.record) provider = new RecordingProvider(provider, () => `gen_${label}`, GENERATE_FIXTURES_DIR);

  let failures = 0;
  for (const l of args.labels) {
    label = l;
    try {
      const { input, enrichOrigin } = await loadPageInputs(l, undefined, args.live ? "live" : "mock");
      if (input.art) console.log(`  artwork ${input.art.wikidataId} ${input.art.title} | public domain ${input.art.publicDomain} | image ${input.art.image?.asset ?? "none"} | regions ${input.art.regions.length}`);
      console.log(`${l}: enrichment ${enrichOrigin}, geo ${input.geo ? input.geo.focus : "none"}`);
      const r = await generateScene(input, { provider });
      console.log(summary(l, r));
      if (args.save) {
        mkdirSync(GENERATED_SCENES_DIR, { recursive: true });
        writeFileSync(join(GENERATED_SCENES_DIR, `gen-${l}.scene.json`), JSON.stringify(r.scene, null, 2) + "\n");
      }
    } catch (e) {
      failures++;
      console.log(`${l}\n  FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  process.exit(failures ? 1 : 0);
}

await main();
