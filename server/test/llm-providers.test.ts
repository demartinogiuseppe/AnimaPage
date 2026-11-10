// Other LLMs (decision D20): shared structured-output layer, OpenAI-compatible adapter against a fake
// HTTP server, Gemini CLI adapter against a fake `gemini` binary, registry/choice validation and
// availability. No network, no real CLI.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGeminiArgs, buildGeminiStdin, GEMINI_POLICY, GeminiCliProvider, geminiChildEnv, geminiErrorText, parseGeminiOutput } from "../src/llm/gemini-cli.ts";
import { validateJsonSchema } from "../src/llm/jsonschema.ts";
import { OpenAiCompatProvider } from "../src/llm/openai-compat.ts";
import {
  AvailabilityChecker,
  choiceTag,
  DEFAULT_PROVIDERS_FILE,
  defaultChoice,
  loadRegistry,
  parseChoice,
  parseRegistry,
  type ProviderEntry,
} from "../src/llm/registry.ts";
import { extractJson } from "../src/llm/structured.ts";
import type { StructuredRequest } from "../src/llm/types.ts";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["n", "tags"],
  properties: { n: { type: "integer", minimum: 0 }, tags: { type: "array", items: { $ref: "#/definitions/tag" }, maxItems: 3 } },
  definitions: { tag: { anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }] } },
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const req: StructuredRequest = { system: "sys", prompt: "Return n = 7.", images: [{ mediaType: "image/jpeg", data: JPEG }], jsonSchema: SCHEMA };
const VALID = { n: 7, tags: ["a", null] };

describe("JSON Schema validation and JSON extraction", () => {
  it("validates types, required, additionalProperties, $ref, anyOf, enum, bounds", () => {
    expect(validateJsonSchema(VALID, SCHEMA)).toEqual([]);
    const errs = validateJsonSchema({ n: -1.5, tags: ["c", 1, "a", "b"], extra: true }, SCHEMA);
    expect(errs.join("\n")).toMatch(/n: expected integer/);
    expect(errs.join("\n")).toMatch(/tags: more than 3 items/);
    expect(errs.join("\n")).toMatch(/tags\.0: does not match any allowed alternative/);
    expect(errs.join("\n")).toMatch(/unknown property "extra"/);
    expect(validateJsonSchema({ tags: [] }, SCHEMA)).toEqual(['(root): missing required property "n"']);
  });

  it("strips markdown fences and prose around the object", () => {
    expect(extractJson('```json\n{"n":7,"tags":[]}\n```')).toEqual({ ok: true, value: { n: 7, tags: [] } });
    expect(extractJson('Ecco: {"n":1,"tags":["a"]} spero vada bene')).toEqual({ ok: true, value: { n: 1, tags: ["a"] } });
    expect(extractJson("nessun json").ok).toBe(false);
  });
});

// ---------- fake OpenAI-compatible server ----------

type Reply = { status?: number; json?: unknown; text?: string };
let server: Server;
let baseUrl = "";
const seen: { url: string; auth?: string; body: Record<string, unknown> }[] = [];
let script: ((body: Record<string, unknown>) => Reply)[] = [];
let modelsList: string[] = [];
let modelsHits = 0;

const answer = (content: string, model = "fake-model"): Reply => ({
  json: { model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 5 } },
});

async function readBody(r: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  server = createServer(async (r, res) => {
    if (r.method === "GET" && r.url === "/v1/models") {
      modelsHits++;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: modelsList.map((id) => ({ id, object: "model" })) }));
    }
    const body = JSON.parse(await readBody(r)) as Record<string, unknown>;
    seen.push({ url: r.url ?? "", auth: r.headers.authorization, body });
    const next = script.shift();
    const rep = next ? next(body) : { status: 500, text: "no scripted reply" };
    res.writeHead(rep.status ?? 200, { "content-type": "application/json" });
    res.end(rep.text ?? JSON.stringify(rep.json));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

function compat(over: Partial<ConstructorParameters<typeof OpenAiCompatProvider>[0]> = {}) {
  seen.length = 0;
  return new OpenAiCompatProvider({ id: "fake", baseUrl, model: "m1", vision: true, jsonSchema: true, timeoutMs: 5000, ...over });
}

const userText = (body: Record<string, unknown>): string => {
  const msgs = body.messages as { role: string; content: unknown }[];
  const c = msgs[1]!.content;
  return typeof c === "string" ? c : (c as { type: string; text?: string }[]).filter((p) => p.type === "text").map((p) => p.text).join("");
};

describe("OpenAI-compatible adapter (fake server)", () => {
  it("native schema: response_format json_schema, image as data URL, key only in the header", async () => {
    script = [() => answer(JSON.stringify(VALID))];
    const res = await compat({ apiKey: "sk-test-123" }).generateStructured(req);
    expect(res.data).toEqual(VALID);
    expect(res.model).toBe("fake-model");
    expect(res.usage).toEqual({ inputTokens: 11, outputTokens: 5 });
    expect(seen).toHaveLength(1);
    const { body, url, auth } = seen[0]!;
    expect(url).toBe("/v1/chat/completions");
    expect(auth).toBe("Bearer sk-test-123");
    expect(body.model).toBe("m1");
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "answer", schema: SCHEMA } });
    const parts = (body.messages as { content: { type: string; image_url?: { url: string } }[] }[])[1]!.content;
    expect(parts[0]).toEqual({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${JPEG.toString("base64")}` } });
    // Native schema: the prompt is the shared one, untouched.
    expect(userText(body)).toBe(req.prompt);
  });

  it("JSON mode: json_object, schema and 'JSON only' in the prompt, fenced answer accepted", async () => {
    script = [() => answer("```json\n" + JSON.stringify(VALID) + "\n```")];
    const res = await compat({ jsonSchema: false }).generateStructured(req);
    expect(res.data).toEqual(VALID);
    const body = seen[0]!.body;
    expect(body.response_format).toEqual({ type: "json_object" });
    expect((body.messages as { content: string }[])[0]!.content).toMatch(/exactly one JSON object/);
    expect(userText(body)).toContain(JSON.stringify(SCHEMA));
  });

  it("one repair round with the schema errors, then the corrected answer", async () => {
    script = [() => answer('{"n":"sette","tags":[]}'), () => answer(JSON.stringify(VALID))];
    const res = await compat().generateStructured(req);
    expect(res.data).toEqual(VALID);
    expect(seen).toHaveLength(2);
    const repair = userText(seen[1]!.body);
    expect(repair).toMatch(/n: expected integer, got string/);
    expect(repair).toContain('{"n":"sette","tags":[]}');
    expect(res.usage).toEqual({ inputTokens: 22, outputTokens: 10 });
  });

  it("a still-invalid but parseable repair is returned for the caller's own validation; never JSON fails", async () => {
    script = [() => answer('{"n":"x"}'), () => answer('{"n":"y"}')];
    expect((await compat().generateStructured(req)).data).toEqual({ n: "y" });
    script = [() => answer("Non so."), () => answer("Ancora niente.")];
    await expect(compat().generateStructured(req)).rejects.toMatchObject({ code: "no_structured_output" });
    expect(seen).toHaveLength(2); // exactly one repair
  });

  it("HTTP errors are http_failed and never contain the key", async () => {
    script = [() => ({ status: 401, text: '{"error":"invalid key sk-secret-999"}' })];
    const err = (await compat({ apiKey: "sk-secret-999" }).generateStructured(req).catch((e: unknown) => e)) as Error & { code: string };
    expect(err.code).toBe("http_failed");
    expect(err.message).toMatch(/HTTP 401/);
    expect(err.message).not.toContain("sk-secret-999");
  });

  it("unreachable server and images for a text-only model fail clearly", async () => {
    const down = new OpenAiCompatProvider({ id: "down", baseUrl: "http://127.0.0.1:9/v1", model: "m", vision: true, jsonSchema: true, timeoutMs: 3000 });
    await expect(down.generateStructured(req)).rejects.toMatchObject({ code: "http_failed" });
    await expect(compat({ vision: false }).generateStructured(req)).rejects.toMatchObject({ code: "not_configured" });
    expect(seen).toHaveLength(0);
  });
});

// ---------- fake gemini binary ----------

const FAKE_GEMINI = fileURLToPath(new URL("./fixtures/fake-gemini.mjs", import.meta.url));

function geminiEnv(mode: string, extra: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "pv-gemini-home-"));
  const log = join(home, "calls.jsonl");
  return { home, log, env: { ...process.env, PAGINAVIVA_GEMINI_BIN: FAKE_GEMINI, GEMINI_CLI_HOME: home, FAKE_GEMINI_MODE: mode, FAKE_GEMINI_LOG: log, GEMINI_API_KEY: "should-be-removed", OPENAI_API_KEY: "should-be-removed", ...extra } };
}
const calls = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

describe("Gemini CLI adapter (fake binary via PAGINAVIVA_GEMINI_BIN)", () => {
  it("builds headless args and an @-reference stdin", () => {
    expect(buildGeminiArgs("flash", "pv-1.policy.toml")).toEqual([
      "-p", "Answer the request above.", "-o", "json", "--skip-trust", "-m", "flash",
      // docs/security.md (M3): no extensions, no MCP servers, every tool denied by a policy file in the call's folder.
      "-e", "none", "--allowed-mcp-server-names", "__none__", "--policy", "pv-1.policy.toml", "--admin-policy", "pv-1.policy.toml",
    ]);
    expect(GEMINI_POLICY).toMatch(/\[\[rule\]\]\s*toolName = "\*"\s*decision = "deny"\s*priority = 999/);
    expect(geminiChildEnv({ PATH: "x", OPENAI_API_KEY: "k", YOUTUBE_API_KEY: "k", GEMINI_API_KEY: "k", GH_TOKEN: "t" })).toEqual({ PATH: "x" });
    expect(buildGeminiStdin("P", ["a.jpg", "b.png"])).toBe("Attached images, in order:\nImage 1: @a.jpg\nImage 2: @b.png\n\nP");
    expect(parseGeminiOutput('Warning: x\n{\n "response": "ok",\n "stats": { "models": { "gemini-flash-lite": { "tokens": { "prompt": 5, "candidates": 1 } }, "gemini-3-flash": { "tokens": { "prompt": 100, "candidates": 20, "cached": 40, "thoughts": 3 } } } }\n}')).toEqual({
      response: "ok",
      model: "gemini-3-flash",
      usage: { inputTokens: 65, outputTokens: 24, cacheReadInputTokens: 40 },
    });
    expect(geminiErrorText("Warning: Windows 10 detected.\nError authenticating: IneligibleTierError: no longer supported\n  at x")).toBe(
      "Error authenticating: IneligibleTierError: no longer supported",
    );
  });

  it("answers through the shared layer; images and system prompt as files, deleted afterwards; session removed", async () => {
    const { home, log, env } = geminiEnv("ok");
    const cwd = mkdtempSync(join(tmpdir(), "pv-gemini-cwd-"));
    const p = new GeminiCliProvider({ env, cwd, model: "flash", timeoutMs: 20_000 });
    const res = await p.generateStructured(req);
    expect(res.data).toEqual(VALID);
    expect(res.model).toBe("gemini-fake");
    const [c] = calls(log);
    const policy = (c!.args as string[])[(c!.args as string[]).indexOf("--policy") + 1]!;
    expect(policy.startsWith("pv-") && policy.endsWith(".policy.toml")).toBe(true); // one per call: parallel calls never share it
    expect(c!.args).toEqual(buildGeminiArgs("flash", policy));
    expect(c!.system).toMatch(/^sys\n\nAnswer with exactly one JSON object/);
    expect(c!.imageBytes).toEqual([JPEG.length]);
    expect(c!.stdin).toContain(JSON.stringify(SCHEMA));
    expect(c!.apiKey).toBe(null); // GEMINI_API_KEY removed from the child env
    expect(c!.openaiKey).toBe(null); // other providers' keys too
    expect(c!.policy).toBe(GEMINI_POLICY); // the deny-all tool policy exists during the call (then deleted)
    expect(readdirSync(cwd)).toEqual([]); // images + system file deleted
    expect(readdirSync(join(home, "tmp", basename(cwd).toLowerCase(), "chats"))).toEqual([]);
  });

  it("removes photos left behind by a killed run (older than an hour), keeps other files (docs/security.md, L6)", async () => {
    const { env } = geminiEnv("ok");
    const cwd = mkdtempSync(join(tmpdir(), "pv-gemini-cwd-"));
    const old = Date.now() / 1000 - 2 * 3600;
    for (const f of ["pv-dead1-1.jpg", "pv-dead1.system.md", "notes.txt"]) {
      writeFileSync(join(cwd, f), "x");
      utimesSync(join(cwd, f), old, old);
    }
    writeFileSync(join(cwd, "pv-fresh-1.jpg"), "x"); // another call running right now
    await new GeminiCliProvider({ env, cwd, timeoutMs: 20_000 }).generateStructured(req);
    expect(readdirSync(cwd).sort()).toEqual(["notes.txt", "pv-fresh-1.jpg"]);
  });

  it("repairs once", async () => {
    const { log, env } = geminiEnv("repair");
    const res = await new GeminiCliProvider({ env, cwd: mkdtempSync(join(tmpdir(), "pv-gemini-cwd-")), timeoutMs: 20_000 }).generateStructured(req);
    expect(res.data).toEqual(VALID);
    const all = calls(log);
    expect(all).toHaveLength(2);
    expect(all[1]!.stdin).toMatch(/Your previous answer cannot be used/);
  });

  it("reports CLI errors and a missing binary; an empty PAGINAVIVA_GEMINI_BIN means 'gemini'", async () => {
    const { env } = geminiEnv("auth");
    const err = (await new GeminiCliProvider({ env, cwd: mkdtempSync(join(tmpdir(), "pv-gemini-cwd-")), timeoutMs: 20_000 }).generateStructured(req).catch((e: unknown) => e)) as Error & { code: string };
    expect(err.code).toBe("cli_failed");
    expect(err.message).toMatch(/Error authenticating/);
    expect(err.message).not.toMatch(/Warning/);
    const missing = new GeminiCliProvider({ env: { PAGINAVIVA_GEMINI_BIN: "", PATH: "", Path: "" }, cwd: mkdtempSync(join(tmpdir(), "pv-gemini-cwd-")) });
    await expect(missing.generateStructured(req)).rejects.toMatchObject({ code: "cli_missing", message: expect.stringContaining("'gemini'") });
  });
});

// ---------- registry, choice, availability ----------

const REG: ProviderEntry[] = parseRegistry(`
providers:
  - { id: claude, label: Claude, kind: claude-cli, models: [opus, sonnet], vision: true, jsonSchema: true }
  - { id: textonly, label: Testo, kind: openai, baseUrl: "http://localhost:1/v1", models: [t1], vision: false, jsonSchema: false }
  - { id: cloud, label: Cloud, kind: openai, baseUrl: "https://api.example.com/v1", apiKeyEnv: PV_TEST_KEY, models: [c1], vision: true, jsonSchema: true }
`);

describe("provider registry and the browser's choice", () => {
  it("loads the shipped config: Claude first, Gemini CLI, local Ollama and LM Studio", () => {
    const reg = loadRegistry(DEFAULT_PROVIDERS_FILE);
    expect(reg.map((r) => r.id)).toEqual(["claude", "gemini", "ollama", "lmstudio"]);
    expect(reg.find((r) => r.id === "ollama")!.baseUrl).toBe("http://localhost:11434/v1");
    expect(defaultChoice({}, reg)).toEqual({ provider: "claude", model: "opus" });
    expect(defaultChoice({ PAGINAVIVA_LLM: "local" }, reg)).toBeNull();
  });

  it("rejects bad config: unknown kind, key values instead of names, missing baseUrl", () => {
    expect(() => parseRegistry("providers: [{ id: x, kind: magic, models: [m] }]")).toThrow(/kind/);
    expect(() => parseRegistry("providers: [{ id: x, kind: openai, baseUrl: 'http://h/v1', apiKeyEnv: 'sk-abc123', models: [m] }]")).toThrow(/NAME/);
    expect(() => parseRegistry("providers: [{ id: x, kind: openai, models: [m] }]")).toThrow(/baseUrl/);
  });

  it("accepts only listed providers and models, vision models for vision phases", () => {
    const def = { provider: "claude", model: "opus" };
    const ok = parseChoice(JSON.stringify({ analyze: { provider: "cloud", model: "c1" }, generate: { provider: "textonly", model: "t1" } }), REG, def);
    expect(ok).toEqual({ ok: true, choice: { analyze: { provider: "cloud", model: "c1" }, generate: { provider: "textonly", model: "t1" } } });
    const bad = (v: unknown) => parseChoice(JSON.stringify(v), REG, def).ok;
    expect(bad({ analyze: { provider: "evil", model: "c1" } })).toBe(false);
    expect(bad({ analyze: { provider: "cloud", model: "gpt-whatever" } })).toBe(false);
    expect(bad({ analyze: { provider: "textonly", model: "t1" } })).toBe(false); // no vision
    expect(bad({ check: { provider: "textonly", model: "t1" } })).toBe(false);
    expect(bad({ enrich: { provider: "claude", model: "opus" } })).toBe(false);
    expect(bad({ generate: { provider: "cloud", model: "c1", baseUrl: "http://169.254.169.254/" } })).toBe(false);
    expect(parseChoice("not json", REG, def).ok).toBe(false);
    // The server default is dropped: same cache key and stages as before D20.
    expect(parseChoice(JSON.stringify({ analyze: def, generate: def, check: def }), REG, def)).toEqual({ ok: true, choice: {} });
    expect(choiceTag({})).toBe("");
    expect(choiceTag({ generate: { provider: "cloud", model: "c1" }, analyze: { provider: "claude", model: "sonnet" } })).toBe("analyze=claude/sonnet;generate=cloud/c1");
  });

  it("availability: CLI on PATH, env key present, local server reachable and models pulled; cached briefly", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "pv-bin-"));
    const reg = parseRegistry(`
providers:
  - { id: claude, label: Claude, kind: claude-cli, models: [opus], vision: true, jsonSchema: true }
  - { id: gemini, label: Gemini, kind: gemini-cli, models: [flash], vision: true, jsonSchema: false }
  - { id: local, label: Locale, kind: openai, baseUrl: "${baseUrl}", models: [gemma3:4b, qwen2.5vl:3b, llava], vision: true, jsonSchema: true }
  - { id: down, label: Spento, kind: openai, baseUrl: "http://127.0.0.1:9/v1", models: [m], vision: true, jsonSchema: true }
  - { id: cloud, label: Cloud, kind: openai, baseUrl: "https://api.example.com/v1", apiKeyEnv: PV_TEST_KEY, models: [c1], vision: true, jsonSchema: true }
`);
    modelsList = ["gemma3:4b", "llava:latest"];
    modelsHits = 0;
    let now = 1000;
    const env = { PATH: binDir, Path: binDir, PAGINAVIVA_CLAUDE_BIN: join(binDir, "no-claude.exe"), PAGINAVIVA_GEMINI_BIN: FAKE_GEMINI };
    const checker = new AvailabilityChecker({ env, timeoutMs: 1000, ttlMs: 10_000, now: () => now });
    const st = await checker.status(reg);
    const by = Object.fromEntries(st.map((s) => [s.id, s]));
    expect(by.claude).toMatchObject({ available: false, reason: expect.stringMatching(/Claude Code/) });
    expect(by.gemini).toMatchObject({ available: true });
    expect(by.local!.available).toBe(true);
    expect(by.local!.models).toEqual([
      { id: "gemma3:4b", available: true },
      { id: "qwen2.5vl:3b", available: false, reason: "Modello non scaricato." },
      { id: "llava", available: true },
    ]);
    expect(by.down).toMatchObject({ available: false, reason: "Il server locale non è avviato." });
    expect(by.cloud).toMatchObject({ available: false, reason: "Manca la chiave PV_TEST_KEY in server/.env." });
    expect(JSON.stringify(st)).not.toMatch(/https?:\/\//); // no URLs to the browser
    await checker.status(reg);
    expect(modelsHits).toBe(1);
    now += 20_000;
    await checker.status(reg);
    expect(modelsHits).toBe(2);
    const withKey = await new AvailabilityChecker({ env: { ...env, PV_TEST_KEY: "k" } }).status(reg.filter((r) => r.id === "cloud"));
    expect(withKey[0]).toMatchObject({ available: true });
  });
});
