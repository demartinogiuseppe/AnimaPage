import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClaudeArgs,
  buildStdinMessage,
  childEnv,
  ClaudeCliProvider,
  parseStreamOutput,
} from "../src/llm/claude-cli.ts";
import {
  createProvider,
  LlmError,
  LocalProvider,
  MockProvider,
  providerNameFromEnv,
  RecordingProvider,
  requestKey,
  type LlmProvider,
  type StructuredRequest,
} from "../src/llm/index.ts";

const req: StructuredRequest = {
  system: "sys",
  prompt: "Return n = 7.",
  images: [{ mediaType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) }],
  jsonSchema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
};

describe("provider selection by env", () => {
  it("defaults to mock, and stays mock unless PAGINAVIVA_MODE=live", () => {
    expect(providerNameFromEnv({})).toBe("mock");
    expect(providerNameFromEnv({ PAGINAVIVA_LLM: "claude-cli" })).toBe("mock");
    expect(createProvider({})).toBeInstanceOf(MockProvider);
  });
  it("uses PAGINAVIVA_LLM in live mode, claude-cli by default", () => {
    expect(providerNameFromEnv({ PAGINAVIVA_MODE: "live" })).toBe("claude-cli");
    expect(providerNameFromEnv({ PAGINAVIVA_MODE: "live", PAGINAVIVA_LLM: "local" })).toBe("local");
    expect(providerNameFromEnv({ PAGINAVIVA_MODE: "live", PAGINAVIVA_LLM: "mock" })).toBe("mock");
    expect(createProvider({ PAGINAVIVA_MODE: "live" })).toBeInstanceOf(ClaudeCliProvider);
    expect(createProvider({ PAGINAVIVA_MODE: "live", PAGINAVIVA_LLM: "local" })).toBeInstanceOf(LocalProvider);
    expect(() => providerNameFromEnv({ PAGINAVIVA_MODE: "live", PAGINAVIVA_LLM: "openai" })).toThrow(/PAGINAVIVA_LLM/);
  });
  it("local provider is a stub that says it is not configured", async () => {
    await expect(new LocalProvider().generateStructured(req)).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("mock provider", () => {
  it("fails clearly when nothing is recorded for a request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-llm-"));
    const err = await new MockProvider(dir).generateStructured(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe("mock_missing");
  });

  it("replays what RecordingProvider recorded, keyed by the request hash, without storing images", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pv-llm-"));
    const live: LlmProvider = {
      name: "claude-cli",
      generateStructured: async () => ({ data: { n: 7 }, durationMs: 5, model: "test-model", usage: { outputTokens: 3 } }),
    };
    await new RecordingProvider(live, () => "my page", dir).generateStructured(req);
    const files = readdirSync(dir);
    expect(files).toEqual([`my_page.${requestKey(req).slice(0, 16)}.json`]);
    const replay = await new MockProvider(dir).generateStructured(req);
    expect(replay).toEqual({ data: { n: 7 }, durationMs: 5, model: "test-model", usage: { outputTokens: 3 } });
    // A different image is a different request.
    const other = { ...req, images: [{ mediaType: "image/jpeg" as const, data: Buffer.from([0xff, 0xd8, 0xff, 9]) }] };
    await expect(new MockProvider(dir).generateStructured(other)).rejects.toMatchObject({ code: "mock_missing" });
  });
});

describe("claude-cli provider (offline parts)", () => {
  it("runs print mode isolated from the user's configuration, with no tools", () => {
    const args = buildClaudeArgs(req, "sonnet");
    for (const flag of ["-p", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"])
      expect(args).toContain(flag);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1]!)).toEqual(req.jsonSchema);
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("sys");
  });

  it("sends one stream-json user message with base64 image blocks before the text", () => {
    const msg = JSON.parse(buildStdinMessage(req));
    expect(msg.type).toBe("user");
    expect(msg.message.role).toBe("user");
    expect(msg.message.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: req.images![0]!.data.toString("base64") },
    });
    expect(msg.message.content[1]).toEqual({ type: "text", text: req.prompt });
  });

  it("removes parent-session variables and ANTHROPIC_API_KEY from the child environment", () => {
    const env = childEnv({ PATH: "x", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", ANTHROPIC_API_KEY: "k", HOME: "h" });
    expect(env).toEqual({ PATH: "x", HOME: "h" });
  });

  it("removes the server's other secrets too, keeps the subscription login (docs/security.md, L3)", () => {
    const env = childEnv({ PATH: "x", OPENAI_API_KEY: "k", YOUTUBE_API_KEY: "k", GROQ_API_KEY: "k", GH_TOKEN: "t", ANTHROPIC_AUTH_TOKEN: "t", MY_SECRET: "s", CLAUDE_CODE_OAUTH_TOKEN: "o" });
    expect(env).toEqual({ PATH: "x", CLAUDE_CODE_OAUTH_TOKEN: "o" });
  });

  it("parses model, structured output and usage from the stream", () => {
    const stream = [
      JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-5-5", tools: ["StructuredOutput"] }),
      "not json",
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_api_ms: 1567,
        total_cost_usd: 0.0123,
        usage: { input_tokens: 2, cache_creation_input_tokens: 1573, cache_read_input_tokens: 0, output_tokens: 77 },
        modelUsage: { "claude-sonnet-5-5": {} },
        result: '{"n":7}',
        structured_output: { n: 7 },
      }),
    ].join("\n");
    expect(parseStreamOutput(stream)).toEqual({
      model: "claude-sonnet-5-5",
      subtype: "success",
      isError: false,
      resultText: '{"n":7}',
      structuredOutput: { n: 7 },
      apiDurationMs: 1567,
      usage: { inputTokens: 2, outputTokens: 77, cacheCreationInputTokens: 1573, cacheReadInputTokens: 0, costUsdEstimate: 0.0123 },
    });
  });

  it("reports a missing executable clearly", async () => {
    const p = new ClaudeCliProvider({ bin: "pv-no-such-claude-binary", timeoutMs: 10_000 });
    await expect(p.generateStructured(req)).rejects.toMatchObject({ code: "cli_missing" });
  });
});

// Live: only with PAGINAVIVA_MODE=live and the Claude Code CLI on PATH (uses the subscription).
const cliAvailable = spawnSync("claude", ["--version"], { encoding: "utf8" }).status === 0;
const live = process.env.PAGINAVIVA_MODE === "live" && cliAvailable;

describe.skipIf(!live)("claude-cli provider (live)", () => {
  it("returns schema-validated JSON, the model and usage", async () => {
    const p = new ClaudeCliProvider({ model: "haiku", timeoutMs: 120_000 });
    const res = await p.generateStructured({ ...req, images: [] });
    expect(res.data).toEqual({ n: 7 });
    expect(res.model).toMatch(/haiku/);
    expect(res.usage?.outputTokens).toBeGreaterThan(0);
  }, 150_000);
});
