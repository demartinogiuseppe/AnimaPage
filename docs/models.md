# Models and LLM access

Verified on 2026-11-03 with Claude Code CLI **2.1.304** (`claude --version`), `claude --help`, and the official docs:
[headless / `claude -p`](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference),
[streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs),
[model config](https://code.claude.com/docs/en/model-config), [vision](https://platform.claude.com/docs/en/build-with-claude/vision).

No paid API key is used (decision D3): the server spawns the Claude Code CLI, logged in with the user's subscription. The `system/init` event of every run reports `"apiKeySource":"none"`.

## Model used for page analysis (M2)

| Setting | Value |
|---|---|
| Default | `--model sonnet` → resolved by the CLI to **`claude-sonnet-5-5`** (reported in `system/init.model` and `modelUsage`) |
| Override | `PAGINAVIVA_CLAUDE_MODEL` env var, or `--model <alias>` on the analyze CLI |
| Compared | `opus` → `claude-opus-5-5` (comparison report not published) |

Aliases accepted by `--model` (model-config docs): `default`, `best`, `fable`, `sonnet`, `opus`, `haiku`, `sonnet[1m]`, `opus[1m]`, `opusplan`, or a full model name. On a Pro/Max subscription the docs map `opus` → Opus 5.5, `sonnet` → Sonnet 5.5, `haiku` → Haiku 5.5, `fable`/`best` → Fable 5.1 where available. Observed: `sonnet` → `claude-sonnet-5-5`, `opus` → `claude-opus-5-5`, `haiku` → `claude-haiku-5-5`. All are listed as vision-capable in the vision docs.

## How the server calls the CLI (`server/src/llm/claude-cli.ts`)

```
claude -p --safe-mode --strict-mcp-config --tools "" --disable-slash-commands
       --no-session-persistence --permission-mode dontAsk
       --input-format stream-json --output-format stream-json --verbose
       --model sonnet --system-prompt <text> --json-schema <draft-07 schema>
```

stdin: one line, a stream-json user message:

```json
{"type":"user","message":{"role":"user","content":[
  {"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"<base64>"}},
  {"type":"text","text":"Analyse the book page in this photo and return the PageAnalysis object."}
]},"parent_tool_use_id":null}
```

| Need | Flag / field | Verified how |
|---|---|---|
| Non-interactive | `-p/--print` | `--help` |
| Image input | `--input-format stream-json`; image content blocks with base64 `source` (streaming-input docs: single-message input does not support images) | docs + live run |
| stream-json input constraint | requires `--output-format stream-json` (CLI error: "--input-format=stream-json requires output-format=stream-json") and `--verbose` | live run |
| Structured output | `--json-schema '<JSON Schema>'`; the CLI adds a `StructuredOutput` tool, validates (draft-07) and re-prompts on mismatch; result has `structured_output` | docs + live run |
| Schema from zod | `z.toJSONSchema(PageAnalysis, { target: "draft-07" })` (the SDK validates draft-07; zod defaults to 2020-12) | docs + zod 4.6.7 types |
| Result / errors | last event `{"type":"result","subtype":"success"|"error_max_structured_output_retries"|…,"is_error",…}`; success without `structured_output` must be treated as failure | docs |
| Usage | `result.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`, `result.total_cost_usd` (client-side list-price estimate, not billed on a subscription), `result.modelUsage[<model>]` | live run |
| Model actually used | `system/init.model` (first event) | live run |
| No tools | `--tools ""` disables all built-in tools; only `StructuredOutput` remains (`"tools":["StructuredOutput"]` in init) | `--help` + live run |

### Isolation from the user's personal configuration

The user has many hooks (e.g. GateGuard), plugins, skills and MCP servers. They must not run inside the analysis call.

- `--safe-mode`: CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands/agents, output styles, auto memory are not loaded; **authentication works normally** (unlike `--bare`, which never reads the OAuth login and requires `ANTHROPIC_API_KEY` — so `--bare` is not usable with a subscription). Observed: `skills: []`, `slash_commands: []`, `mcp_servers: []`, `plugin_full_loads: 0`. The init event still *lists* installed plugins by name, but none is loaded.
- `--strict-mcp-config` (no `--mcp-config`): no MCP servers.
- `--tools ""`, `--disable-slash-commands`, `--permission-mode dontAsk` (anything that would prompt is denied).
- `--no-session-persistence`: sessions are not written to disk.
- Working directory: an empty folder in the OS temp dir (`pagina-viva-claude-cli`), not the repo.
- Environment: the variables a parent Claude Code session sets (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`, messaging socket/token, …) are removed, and **`ANTHROPIC_API_KEY` is removed** so the CLI cannot switch to paid API billing.
- Not used: `--restricted` (would also ignore user settings, but not needed with `--safe-mode`), `--setting-sources`.

### Limits

- Image size: up to 10 MB base64 per image on the Claude API (vision docs); the server refuses files over 7 MB (no resizing library in v0.1). Phone photos (~3 MB) pass.
- Resolution: models from 4.7 on use the high-resolution tier, long edge up to 2576 px / 4784 visual tokens; a 4080×3072 photo is downscaled server-side (~4.8k image tokens).
- Piped stdin in print mode is capped at 10 MB (headless docs); one photo is ~4 MB base64.

### Environment variables (server)

| Name | Meaning |
|---|---|
| `PAGINAVIVA_MODE` | `live` enables real providers; anything else = mock |
| `PAGINAVIVA_LLM` | `claude-cli` (default in live) / `gemini-cli` / `mock` / `local`; the app can override it per phase (D20) |
| `PAGINAVIVA_CLAUDE_MODEL` | model alias for the CLI (default `sonnet`) |
| `PAGINAVIVA_CLAUDE_BIN` | path of the `claude` executable (default `claude` on PATH) |
| `PAGINAVIVA_LEDGER` | ledger path (default `server/ledger.jsonl`) |
| `PAGINAVIVA_LOCAL_LLM_URL` | OpenAI-compatible endpoint of the `local` provider (default Ollama, `http://localhost:11434/v1`) |
| `PAGINAVIVA_LOCAL_LLM_MODEL` | model of the `local` provider (required for it) |
| `PAGINAVIVA_GEMINI_BIN` | path of the `gemini` executable, or a `.js`/`.mjs` file run with Node (tests); empty = `gemini` on PATH |
| `PAGINAVIVA_GEMINI_MODEL` | `-m` value for `PAGINAVIVA_LLM=gemini-cli` (default `auto`) |

## Other providers (D20)

Configured in `server/config/llm_providers.yaml`; chosen per phase in the app.

### Gemini CLI (`server/src/llm/gemini-cli.ts`)

Verified on 2026-11-05 with Gemini CLI **0.63.0** (`gemini --version`, `gemini --help`, and the bundled source in `node_modules/@google/gemini-cli/bundle`):

- `-p/--prompt <text>`: headless mode; the text is *appended to stdin*. The server sends the whole prompt on stdin and a constant `-p`.
- `-o/--output-format json`: one object `{ session_id, response, stats: { models: { <name>: { tokens: { prompt, candidates, cached, thoughts } } } }, error? }` (`JsonFormatter`).
- `-m/--model`: aliases `auto`, `pro`, `flash`, `flash-lite` or a model name.
- `--skip-trust`: headless runs refuse untrusted folders without it (or `GEMINI_CLI_TRUST_WORKSPACE=true`).
- Images: `@file` references are expanded in headless mode too (`handleAtCommand` in `runNonInteractive`); files must be inside the working folder. The server writes them to a dedicated temp folder and deletes them after the call.
- `GEMINI_SYSTEM_MD=<file>` replaces the CLI's built-in (coding agent) system prompt.
- No JSON-schema flag: schema in the prompt + shared validation/repair (`server/src/llm/structured.ts`).
- The CLI records each session (images included) in `~/.gemini/tmp/<project>/chats/`: the server deletes the files its call created.
- `GEMINI_API_KEY` / `GOOGLE_API_KEY` are removed from the child environment, so the Google-account login is used.
- On Windows the npm shim is `gemini.cmd`: started through the shell with arguments checked to need no escaping (`server/src/llm/bin.ts`).
- Live result 2026-11-05: the user's personal account is refused (`IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals`), so no Gemini answer was obtained yet.

### OpenAI-compatible endpoints (`server/src/llm/openai-compat.ts`)

- `POST <baseUrl>/chat/completions`, images as `image_url` with `data:<mime>;base64,…` URLs (Ollama accepts only base64: docs.ollama.com/api/openai-compatibility).
- `jsonSchema: true` → `response_format: { type: "json_schema", json_schema: { name, schema } }` (OpenAI; LM Studio, lmstudio.ai/docs/developer/openai-compat/structured-output; Ollama). `false` → `{ type: "json_object" }` + schema in the prompt.
- `Authorization: Bearer <value of apiKeyEnv>` only when the entry names a key variable; the key is scrubbed from error messages.
- Local vision models that fit 8 GB of VRAM (ollama.com/library, 2026-11-05): `gemma3:4b` (3.4 GB), `qwen2.5vl:3b` (3.2 GB); LM Studio `google/gemma-3-4b`.
