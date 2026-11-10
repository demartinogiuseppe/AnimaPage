// Claude Code CLI provider for scene generation with an explicit `--effort` level.
//
// Measured on the Germani page (timeline, same request, 2026-11-03): opus default 170 s /
// 21.5k output tokens (mostly thinking); opus `--effort low` 67 s / 8.3k, valid first time;
// sonnet 78 s; haiku 129 s / 32.7k. `--effort <low|medium|high|xhigh|max>` is listed by
// `claude --help` (2.1.304). MAX_THINKING_TOKENS=0 had no effect (155 s).
//
// TEMPORARY: server/src/llm/claude-cli.ts has no effort option and is owned by another stage, so
// this file reuses its exported helpers (same flags, isolation and environment scrubbing) and adds
// `--effort`. Once ClaudeCliOptions gets `effort`, replace this class with ClaudeCliProvider.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeArgs, buildStdinMessage, childEnv, DEFAULT_CLAUDE_MODEL, parseStreamOutput, StructuredDeltaReader } from "../llm/claude-cli.ts";
import { LlmError, type LlmProvider, type StreamOptions, type StructuredRequest, type StructuredResponse } from "../llm/types.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const DEFAULT_GENERATE_EFFORT: Effort = "low";
const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

export interface EffortCliOptions {
  model?: string;
  effort?: Effort;
  bin?: string;
  timeoutMs?: number;
}

export function effortFromEnv(v: string | undefined): Effort {
  if (!v) return DEFAULT_GENERATE_EFFORT;
  if (!EFFORTS.includes(v)) throw new Error(`Unknown effort '${v}' (expected ${EFFORTS.join(" | ")})`);
  return v as Effort;
}

const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

export class EffortCliProvider implements LlmProvider {
  readonly name = "claude-cli" as const;
  readonly model: string;
  readonly effort: Effort;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly cwd = join(tmpdir(), "pagina-viva-claude-cli");

  constructor(opts: EffortCliOptions = {}) {
    this.model = opts.model ?? (process.env.PAGINAVIVA_CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL);
    this.effort = opts.effort ?? effortFromEnv(process.env.PAGINAVIVA_GENERATE_EFFORT);
    this.bin = opts.bin ?? (process.env.PAGINAVIVA_CLAUDE_BIN || "claude");
    this.timeoutMs = opts.timeoutMs ?? 400_000;
  }

  async generateStructured(req: StructuredRequest, stream?: StreamOptions): Promise<StructuredResponse> {
    mkdirSync(this.cwd, { recursive: true });
    const started = performance.now();
    // Streaming (D22): partial messages carry the JSON of the answer while it is written.
    const args = [...buildClaudeArgs(req, this.model), "--effort", this.effort, ...(stream ? ["--include-partial-messages"] : [])];
    const reader = stream ? new StructuredDeltaReader(stream) : undefined;
    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn(this.bin, args, { cwd: this.cwd, env: childEnv(process.env), windowsHide: true });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill();
        reject(new LlmError("timeout", `claude did not answer within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        out.push(d);
        reader?.push(d);
      });
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(new LlmError(e.code === "ENOENT" ? "cli_missing" : "cli_failed", `cannot start claude: ${e.message}`));
      });
      child.on("close", (c) => {
        clearTimeout(timer);
        resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code: c });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(buildStdinMessage(req));
    });
    const durationMs = Math.round(performance.now() - started);
    const parsed = parseStreamOutput(stdout);
    if (parsed.subtype === undefined) throw new LlmError("cli_failed", `claude exited with code ${code} and no result. ${short(stderr || stdout)}`);
    if (parsed.isError || parsed.subtype !== "success") throw new LlmError("cli_failed", `claude result ${parsed.subtype}: ${short(parsed.resultText ?? stderr)}`);
    if (parsed.structuredOutput == null) throw new LlmError("no_structured_output", `claude returned no structured_output. ${short(parsed.resultText ?? "")}`);
    return { data: parsed.structuredOutput, usage: parsed.usage, durationMs, model: parsed.model ?? this.model };
  }
}
