// claude-cli provider: spawns the Claude Code CLI in print mode, authenticated with the
// user's Claude subscription (decision D3). Flags verified with `claude --help`
// (v2.1.304) and code.claude.com docs; see docs/models.md.
//
// - Images: `--input-format stream-json` with one user message whose content holds
//   base64 `image` blocks (requires `--output-format stream-json` and `--verbose`).
// - Structured output: `--json-schema`; the validated object is `structured_output`
//   on the final `result` event, usage/cost there too, the model on `system/init`.
// - Isolation from the user's personal setup: `--safe-mode` (no CLAUDE.md, skills,
//   plugins, hooks, MCP servers), `--strict-mcp-config`, `--tools ""` (no built-in
//   tools; only the CLI's own StructuredOutput tool remains), `--disable-slash-commands`,
//   `--no-session-persistence`, `--permission-mode dontAsk`, an empty working directory,
//   and an environment without the variables a parent Claude Code session sets.
//   ANTHROPIC_API_KEY is removed too, so the CLI cannot fall back to paid API billing, and so are
//   the server's other secrets (any *_API_KEY, *_TOKEN, *_SECRET...: bin.ts withoutSecrets).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { withoutSecrets } from "./bin.ts";
import { LlmError, type LlmProvider, type LlmUsage, type StreamOptions, type StructuredRequest, type StructuredResponse } from "./types.ts";

export interface ClaudeCliOptions {
  /** Executable name or path. Default: `claude` (PAGINAVIVA_CLAUDE_BIN). */
  bin?: string;
  /** Model alias or full name passed to `--model`. Default: `opus` (PAGINAVIVA_CLAUDE_MODEL). */
  model?: string;
  timeoutMs?: number;
  /** Working directory for the child; default: an empty folder in the OS temp dir. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_CLAUDE_MODEL = "opus";
export const DEFAULT_TIMEOUT_MS = 240_000;

/** Variables set by a parent Claude Code session, or that would switch to paid API billing. */
const STRIPPED_ENV = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_PLUGIN_DIRS",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_EMIT_STARTUP_TIMING",
  "CLAUDE_CODE_STARTUP_FAILURE_RESULTS",
  "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
  "CLAUDE_CODE_QUESTION_PREVIEW_FORMAT",
  "CLAUDE_CODE_ENABLE_TASKS",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "AI_AGENT",
  "ANTHROPIC_API_KEY",
];

/** Also without the server's other secrets; CLAUDE_CODE_OAUTH_TOKEN (a subscription login) is kept. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = withoutSecrets(env, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  for (const k of STRIPPED_ENV) delete out[k];
  return out;
}

export function buildClaudeArgs(req: StructuredRequest, model: string): string[] {
  return [
    "-p",
    "--safe-mode",
    "--strict-mcp-config",
    "--tools",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "dontAsk",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--system-prompt",
    req.system,
    "--json-schema",
    JSON.stringify(req.jsonSchema),
  ];
}

/** The single stream-json user message: images first, then the text prompt. */
export function buildStdinMessage(req: StructuredRequest): string {
  const content = [
    ...(req.images ?? []).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
    })),
    { type: "text", text: req.prompt },
  ];
  return JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null }) + "\n";
}

export interface ParsedCliOutput {
  model?: string;
  subtype?: string;
  isError?: boolean;
  resultText?: string;
  structuredOutput?: unknown;
  usage?: LlmUsage;
  apiDurationMs?: number;
}

type Json = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Reads the newline-delimited events of `--output-format stream-json`. */
export function parseStreamOutput(stdout: string): ParsedCliOutput {
  const out: ParsedCliOutput = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let ev: Json;
    try {
      ev = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init" && typeof ev.model === "string") out.model = ev.model;
    if (ev.type !== "result") continue;
    out.subtype = typeof ev.subtype === "string" ? ev.subtype : undefined;
    out.isError = ev.is_error === true;
    out.resultText = typeof ev.result === "string" ? ev.result : undefined;
    out.structuredOutput = ev.structured_output;
    out.apiDurationMs = num(ev.duration_api_ms);
    const u = (ev.usage ?? {}) as Json;
    out.usage = {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheCreationInputTokens: num(u.cache_creation_input_tokens),
      cacheReadInputTokens: num(u.cache_read_input_tokens),
      costUsdEstimate: num(ev.total_cost_usd),
    };
    const models = Object.keys((ev.modelUsage ?? {}) as Json);
    if (!out.model && models[0]) out.model = models[0];
  }
  return out;
}

/**
 * Live JSON text of the structured answer (decision D22), from the `stream_event` lines that
 * `--include-partial-messages` adds: the CLI's StructuredOutput tool call arrives as
 * `content_block_start` (tool_use) + `content_block_delta` (`input_json_delta.partial_json`).
 * A new StructuredOutput block (the CLI asks again after a schema failure) restarts the text.
 * Stdout chunks may split lines and UTF-8 characters anywhere.
 */
export class StructuredDeltaReader {
  private readonly decoder = new StringDecoder("utf8");
  private rest = "";
  private block = -1;
  constructor(private readonly sink: StreamOptions) {}

  push(chunk: Buffer | string): void {
    const lines = (this.rest + (typeof chunk === "string" ? chunk : this.decoder.write(chunk))).split("\n");
    this.rest = lines.pop() ?? "";
    for (const line of lines) {
      try {
        this.line(line.trim());
      } catch (e) {
        // A failing listener must never break the call: the final answer still arrives.
        console.warn(`[llm] stream listener failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
    }
  }

  private line(line: string): void {
    if (!line.includes("stream_event")) return;
    let ev: Json;
    try {
      ev = JSON.parse(line) as Json;
    } catch {
      return;
    }
    if (ev.type !== "stream_event" || ev.parent_tool_use_id) return;
    const e = (ev.event ?? {}) as Json;
    const cb = (e.content_block ?? {}) as Json;
    if (e.type === "content_block_start") {
      const tool = cb.type === "tool_use" && cb.name === "StructuredOutput";
      this.block = tool && typeof e.index === "number" ? e.index : -1;
      if (tool) this.sink.onJsonDelta("", true);
      return;
    }
    const d = (e.delta ?? {}) as Json;
    if (e.type === "content_block_delta" && e.index === this.block && d.type === "input_json_delta" && typeof d.partial_json === "string" && d.partial_json)
      this.sink.onJsonDelta(d.partial_json, false);
  }
}

function shortText(s: string, max = 300): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export class ClaudeCliProvider implements LlmProvider {
  readonly name = "claude-cli" as const;
  private readonly bin: string;
  readonly model: string;
  private readonly timeoutMs: number;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: ClaudeCliOptions = {}) {
    this.bin = opts.bin ?? (process.env.PAGINAVIVA_CLAUDE_BIN || "claude");
    this.model = opts.model ?? (process.env.PAGINAVIVA_CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cwd = opts.cwd ?? join(tmpdir(), "pagina-viva-claude-cli");
    this.env = childEnv(opts.env ?? process.env);
  }

  async generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
    mkdirSync(this.cwd, { recursive: true });
    const started = performance.now();
    const { stdout, stderr, code } = await this.run(buildClaudeArgs(req, this.model), buildStdinMessage(req));
    const durationMs = Math.round(performance.now() - started);
    const parsed = parseStreamOutput(stdout);

    if (parsed.subtype === undefined) {
      throw new LlmError("cli_failed", `claude exited with code ${code} and no result. ${shortText(stderr || stdout)}`);
    }
    if (parsed.isError || parsed.subtype !== "success") {
      throw new LlmError("cli_failed", `claude result ${parsed.subtype}: ${shortText(parsed.resultText ?? stderr)}`);
    }
    if (parsed.structuredOutput === undefined || parsed.structuredOutput === null) {
      throw new LlmError("no_structured_output", `claude returned no structured_output. ${shortText(parsed.resultText ?? "")}`);
    }
    return { data: parsed.structuredOutput, usage: parsed.usage, durationMs, model: parsed.model ?? this.model };
  }

  private run(args: string[], stdin: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { cwd: this.cwd, env: this.env, windowsHide: true });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new LlmError("timeout", `claude did not answer within ${this.timeoutMs} ms`));
      }, this.timeoutMs);

      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", (e: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          e.code === "ENOENT"
            ? new LlmError("cli_missing", `Claude Code CLI not found ('${this.bin}'). Install it or set PAGINAVIVA_CLAUDE_BIN.`)
            : new LlmError("cli_failed", `cannot start claude: ${e.message}`),
        );
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code });
      });
      child.stdin.on("error", () => {
        /* reported through 'close' / 'error' */
      });
      child.stdin.end(stdin);
    });
  }
}
