// gemini-cli provider: spawns the Gemini CLI in headless mode, authenticated with the user's Google
// account (decision D20; the equivalent of claude-cli). Verified on Gemini CLI 0.63.0 with
// `gemini --help` and its bundled source (see docs/models.md):
//
// - Headless: `-p <text>` runs non-interactively; the text is appended to stdin, so the long
//   prompt goes through stdin (no Windows command-line limit) and `-p` holds a short constant.
// - Output: `-o json` prints one object { session_id, response, stats: { models: { <name>:
//   { tokens: { prompt, candidates, cached, thoughts } } } }, error? }.
// - Images: `@file` references in the prompt are read by the CLI and sent as inline image parts,
//   in the order they appear. The files are written to a dedicated working folder for the call
//   and deleted afterwards. Headless runs refuse untrusted folders: `--skip-trust`.
// - No JSON-schema flag: the schema goes in the prompt and the answer goes through the shared
//   validation/repair (structured.ts).
// - System prompt: GEMINI_SYSTEM_MD=<file> replaces the CLI's own (coding-agent) system prompt.
// - Isolation: GEMINI_API_KEY / GOOGLE_API_KEY are removed from the child environment so the CLI
//   keeps the Google-account login instead of switching to API-key billing, and so are the server's
//   other secrets (bin.ts withoutSecrets). The page text is untrusted (docs/security.md, M3): `-e none`
//   (no extensions), `--allowed-mcp-server-names __none__` (no MCP server) and a deny-all tool policy
//   (`--policy` / `--admin-policy`, checked in the 0.63.0 bundle: policy/toml-loader.ts, config.ts). The CLI records each
//   session (the images included) under ~/.gemini/tmp/<project>/chats: the files this call created
//   there are deleted afterwards, so the photo is not kept.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { resolveCommand, runCommand, withoutSecrets } from "./bin.ts";
import { completeStructured, type TextAnswer, type TextTurn } from "./structured.ts";
import { LlmError, type LlmProvider, type LlmUsage, type StructuredRequest, type StructuredResponse } from "./types.ts";

export interface GeminiCliOptions {
  /** Executable name, path, or a .js/.mjs file run with Node. Default: `gemini` (PAGINAVIVA_GEMINI_BIN). */
  bin?: string;
  /** `-m` value: an alias (auto, pro, flash, flash-lite) or a model name. Default: PAGINAVIVA_GEMINI_MODEL or auto. */
  model?: string;
  timeoutMs?: number;
  /** Working folder (the CLI's workspace); default: a dedicated folder in the OS temp dir. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_GEMINI_MODEL = "auto";
export const GEMINI_DEFAULT_TIMEOUT_MS = 240_000;
/** Constant `-p` text (the real prompt is on stdin). */
export const HEADLESS_PROMPT = "Answer the request above.";

const STRIPPED_ENV = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GEMINI_SYSTEM_MD", "GEMINI_CLI_TRUST_WORKSPACE"];

export function geminiChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = withoutSecrets(env);
  for (const k of STRIPPED_ENV) delete out[k];
  return out;
}

/** Tool policy of every call (Gemini CLI policy engine, TOML): deny all tools, highest priority. */
export const GEMINI_POLICY = ["[[rule]]", 'toolName = "*"', 'decision = "deny"', "priority = 999", ""].join("\n");
/** Files a call leaves in its folder only if the process was killed: removed by a later call. */
const STALE_MS = 3600_000;

/** `policyFile`: the call's own policy file, relative to its working folder (no Windows shell escaping). */
export function buildGeminiArgs(model: string, policyFile: string): string[] {
  return [
    "-p", HEADLESS_PROMPT, "-o", "json", "--skip-trust", "-m", model,
    // Without the user's extensions and MCP servers (an allow-list naming none), and every tool denied:
    // --policy replaces the user's own policy files, --admin-policy ranks above them.
    "-e", "none", "--allowed-mcp-server-names", "__none__", "--policy", policyFile, "--admin-policy", policyFile,
  ];
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** stdin text: the image references first (in order), then the prompt. */
export function buildGeminiStdin(prompt: string, imageFiles: string[]): string {
  if (imageFiles.length === 0) return prompt;
  const refs = imageFiles.map((f, i) => `Image ${i + 1}: @${f}`).join("\n");
  return `Attached images, in order:\n${refs}\n\n${prompt}`;
}

export interface ParsedGeminiOutput {
  response?: string;
  error?: string;
  model?: string;
  usage?: LlmUsage;
}

type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Reads the `-o json` object (warnings may precede it on stdout). */
export function parseGeminiOutput(stdout: string): ParsedGeminiOutput {
  const t = stdout.trim();
  let obj: Json | undefined;
  for (const start of [0, t.indexOf("\n{") + 1, t.indexOf("{")]) {
    if (start < 0 || obj) continue;
    try {
      const v = JSON.parse(t.slice(start)) as unknown;
      if (v && typeof v === "object") obj = v as Json;
    } catch {
      /* try the next start */
    }
  }
  if (!obj) return {};
  const out: ParsedGeminiOutput = {};
  if (typeof obj.response === "string") out.response = obj.response;
  const err = obj.error as Json | undefined;
  if (err && typeof err === "object") out.error = typeof err.message === "string" ? err.message : JSON.stringify(err);
  const models = ((obj.stats as Json | undefined)?.models ?? {}) as Record<string, Json>;
  let best = -1;
  const usage: LlmUsage = {};
  for (const [name, m] of Object.entries(models)) {
    const tk = (m.tokens ?? {}) as Json;
    usage.inputTokens = (usage.inputTokens ?? 0) + num(tk.prompt) - num(tk.cached);
    usage.outputTokens = (usage.outputTokens ?? 0) + num(tk.candidates) + num(tk.thoughts);
    usage.cacheReadInputTokens = (usage.cacheReadInputTokens ?? 0) + num(tk.cached);
    // Auto mode may route through a small classifier model: the one that wrote most is "the" model.
    if (num(tk.candidates) > best) {
      best = num(tk.candidates);
      out.model = name;
    }
  }
  if (Object.keys(models).length) out.usage = usage;
  return out;
}

const short = (s: string, max = 300) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/**
 * The useful part of the CLI's stderr: its startup warnings (Windows 10, true colour) are dropped and
 * the first error line comes first. Seen live on 0.63.0 with a personal account: "Error
 * authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for
 * individuals…".
 */
export function geminiErrorText(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Warning:/.test(l));
  const err = lines.find((l) => /error/i.test(l));
  return short(err ?? lines.join(" "));
}

/** The CLI's project folder for `cwd` under ~/.gemini/tmp (projects.json maps folders to names). */
function sessionDir(cwd: string, env: NodeJS.ProcessEnv): string {
  const home = env.GEMINI_CLI_HOME || join(homedir(), ".gemini");
  let name = basename(cwd).toLowerCase();
  try {
    const projects = (JSON.parse(readFileSync(join(home, "projects.json"), "utf8")) as { projects?: Record<string, string> }).projects ?? {};
    name = projects[cwd.toLowerCase()] ?? projects[cwd] ?? name;
  } catch {
    /* no projects.json yet */
  }
  return join(home, "tmp", name, "chats");
}

/** Deletes the session recordings created since `since` (they hold the images). Best effort. */
function removeSessions(dir: string, since: number): void {
  try {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).mtimeMs >= since - 1000) rmSync(p, { recursive: true, force: true });
    }
  } catch {
    /* never fails the call */
  }
}

/** Deletes pv-* files (photos, prompts, policies) older than STALE_MS, left by a killed run (docs/security.md, L6). */
function removeStale(dir: string): void {
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f.startsWith("pv-") && Date.now() - statSync(p).mtimeMs > STALE_MS) rmSync(p, { force: true });
    }
  } catch {
    /* best effort */
  }
}

export class GeminiCliProvider implements LlmProvider {
  readonly name = "gemini-cli";
  readonly model: string;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: GeminiCliOptions = {}) {
    const env = opts.env ?? process.env;
    this.bin = opts.bin ?? (env.PAGINAVIVA_GEMINI_BIN || "gemini");
    this.model = opts.model ?? (env.PAGINAVIVA_GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
    this.timeoutMs = opts.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS;
    this.cwd = opts.cwd ?? join(tmpdir(), "pagina-viva-gemini-cli");
    this.env = geminiChildEnv(env);
  }

  generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
    return completeStructured(req, { nativeSchema: false, fallbackModel: this.model }, (turn) => this.complete(turn));
  }

  private async complete(turn: TextTurn): Promise<TextAnswer> {
    mkdirSync(this.cwd, { recursive: true });
    const id = randomUUID().slice(0, 8);
    const files = turn.images.map((img, i) => `pv-${id}-${i + 1}.${EXT[img.mediaType] ?? "jpg"}`);
    const systemFile = join(this.cwd, `pv-${id}.system.md`);
    const policyName = `pv-${id}.policy.toml`;
    const policyFile = join(this.cwd, policyName);
    removeStale(this.cwd);
    const started = Date.now();
    try {
      turn.images.forEach((img, i) => writeFileSync(join(this.cwd, files[i]!), img.data));
      writeFileSync(systemFile, turn.system);
      writeFileSync(policyFile, GEMINI_POLICY);
      let cmd;
      try {
        cmd = resolveCommand(this.bin, buildGeminiArgs(this.model, policyName), this.env);
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT")
          throw new LlmError("cli_missing", `Gemini CLI not found ('${this.bin}'). Install it or set PAGINAVIVA_GEMINI_BIN.`);
        throw new LlmError("cli_failed", `cannot start gemini: ${(e as Error).message}`);
      }
      let run;
      try {
        run = await runCommand(cmd, {
          stdin: buildGeminiStdin(turn.prompt, files),
          cwd: this.cwd,
          env: { ...this.env, GEMINI_SYSTEM_MD: systemFile },
          timeoutMs: this.timeoutMs,
        });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "ETIMEDOUT") throw new LlmError("timeout", `gemini did not answer within ${this.timeoutMs} ms`);
        if (code === "ENOENT") throw new LlmError("cli_missing", `Gemini CLI not found ('${this.bin}').`);
        throw new LlmError("cli_failed", `cannot start gemini: ${(e as Error).message}`);
      }
      const parsed = parseGeminiOutput(run.stdout);
      if (parsed.error) throw new LlmError("cli_failed", `gemini: ${short(parsed.error)}`);
      if (parsed.response === undefined)
        throw new LlmError("cli_failed", `gemini exited with code ${run.code} and no answer. ${geminiErrorText(run.stderr || run.stdout)}`);
      return { text: parsed.response, usage: parsed.usage, model: parsed.model ?? this.model };
    } finally {
      for (const f of [...files.map((f) => join(this.cwd, f)), systemFile, policyFile]) rmSync(f, { force: true });
      removeSessions(sessionDir(this.cwd, this.env), started);
    }
  }
}
