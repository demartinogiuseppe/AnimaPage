// Fake `gemini` for server/test/llm-providers.test.ts (PAGINAVIVA_GEMINI_BIN points here).
// Logs what it received to FAKE_GEMINI_LOG and answers like `gemini -p … -o json`.
// FAKE_GEMINI_MODE: ok | repair (invalid first answer) | auth (login error, exit 1).
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const stdin = Buffer.concat(chunks).toString("utf8");
const cwd = process.cwd();
const log = process.env.FAKE_GEMINI_LOG;
const previous = log && existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0;

// The real CLI records the session (with the images) under ~/.gemini/tmp/<project>/chats.
const chats = join(process.env.GEMINI_CLI_HOME, "tmp", basename(cwd).toLowerCase(), "chats");
mkdirSync(chats, { recursive: true });
writeFileSync(join(chats, `session-${Date.now()}-${previous}.jsonl`), "{}\n");

const refs = [...stdin.matchAll(/@(\S+)/g)].map((m) => m[1]);
if (log)
  appendFileSync(
    log,
    JSON.stringify({
      args: process.argv.slice(2),
      system: process.env.GEMINI_SYSTEM_MD ? readFileSync(process.env.GEMINI_SYSTEM_MD, "utf8") : null,
      stdin,
      imageBytes: refs.map((f) => statSync(join(cwd, f)).size),
      apiKey: process.env.GEMINI_API_KEY ?? null,
      openaiKey: process.env.OPENAI_API_KEY ?? null,
      // The tool policy file named by --policy (relative to the call's folder), read while the call runs.
      policy: (() => {
        const i = process.argv.indexOf("--policy");
        const f = i > 0 ? join(cwd, process.argv[i + 1]) : null;
        return f && existsSync(f) ? readFileSync(f, "utf8") : null;
      })(),
    }) + "\n",
  );

const mode = process.env.FAKE_GEMINI_MODE || "ok";
if (mode === "auth") {
  process.stderr.write("Warning: Windows 10 detected. Some UI features may be degraded.\nError authenticating: IneligibleTierError: This client is no longer supported\n    at x (bundle.js:1)\n");
  process.exit(1);
}
const valid = '```json\n{"n": 7, "tags": ["a", null]}\n```';
const response = mode === "repair" && previous === 0 ? '{"n": "sette"}' : valid;
process.stdout.write("Warning: true color not detected.\n");
process.stdout.write(
  JSON.stringify({ session_id: "s1", response, stats: { models: { "gemini-fake": { tokens: { prompt: 10, candidates: 5, cached: 0, thoughts: 0 } } } } }, null, 2) + "\n",
);
