// CLI: analyse book-page photos live with the Claude Code CLI and record the responses
// into fixtures/llm/ so tests replay them offline.
//
//   pnpm --filter @pv/server analyze [--model <alias>] [--no-cache] [--no-record] [--mock] [--out <dir>] <photos...>
//
// Relative photo paths are resolved against the directory pnpm was started from.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { AnalysisError, analyzePage, type AnalyzeResult } from "../analyze/index.ts";
import { ClaudeCliProvider } from "../llm/claude-cli.ts";
import { MockProvider, RecordingProvider } from "../llm/mock.ts";
import type { LlmProvider } from "../llm/types.ts";

interface Args {
  model?: string;
  cache: boolean;
  record: boolean;
  mock: boolean;
  /** Also write each analysis as <label>.<model>.json into this folder. */
  out?: string;
  photos: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cache: true, record: true, mock: false, photos: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "--model") a.model = argv[++i];
    else if (v === "--no-cache") a.cache = false;
    else if (v === "--no-record") a.record = false;
    else if (v === "--mock") a.mock = true;
    else if (v === "--out") a.out = argv[++i];
    else if (v === "--") continue;
    else if (v.startsWith("--")) throw new Error(`Unknown option ${v}`);
    else a.photos.push(v);
  }
  return a;
}

function line(name: string, r: AnalyzeResult): string {
  const a = r.analysis;
  const l = r.ledger;
  const tokens = l.tokensOut === undefined ? "-" : `in ${(l.tokensIn ?? 0) + (l.cacheCreationTokens ?? 0) + (l.cacheReadTokens ?? 0)} / out ${l.tokensOut}`;
  return [
    `${name}`,
    `  ${a.subject} | ${a.topic} | engine ${a.suggestedEngine} | confidence ${a.confidence}`,
    `  pages ${a.pages.visible} ${JSON.stringify(a.pages.numbers)} | ${a.orientation} | ${a.contentType}${a.literary.isLiterary ? " | literary" : ""}${a.readable ? "" : " | UNREADABLE"}`,
    `  ${r.validation} | ${l.model ?? "-"} | ${((l.phasesMs.total ?? 0) / 1000).toFixed(1)} s | tokens ${tokens} | claims ${a.claims.length}, entities ${a.entities.length}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.photos.length === 0) {
    console.error("usage: analyze [--model <alias>] [--no-cache] [--no-record] [--mock] [--out <dir>] <photos...>");
    process.exit(2);
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  let label = "";
  let provider: LlmProvider = args.mock ? new MockProvider() : new ClaudeCliProvider({ model: args.model });
  if (!args.mock && args.record) provider = new RecordingProvider(provider, () => label);

  let failures = 0;
  for (const p of args.photos) {
    const file = resolve(base, p);
    label = basename(file, extname(file));
    try {
      const r = await analyzePage(file, { provider, cacheDir: args.cache ? undefined : null });
      console.log(line(label, r));
      if (args.out) {
        const dir = resolve(base, args.out);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${label}.${r.ledger.model ?? "model"}.json`), JSON.stringify(r.analysis, null, 2) + "\n");
      }
    } catch (e) {
      failures++;
      const msg = e instanceof AnalysisError ? `${e.message} (${(((e.ledger.phasesMs.total ?? 0) / 1000)).toFixed(1)} s)` : String(e);
      console.log(`${label}\n  FAILED: ${msg}`);
    }
  }
  process.exit(failures ? 1 : 0);
}

await main();
