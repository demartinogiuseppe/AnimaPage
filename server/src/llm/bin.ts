// Finding and starting a CLI (Gemini CLI; availability checks of /api/providers).
//
// On Windows npm installs CLIs as `.cmd` shims, which Node can only start through the shell; the
// command line is then built here from arguments that were checked to need no escaping. A path to
// a `.js`/`.mjs` file runs with this Node (the tests' fake CLIs, PAGINAVIVA_GEMINI_BIN).
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

const isFile = (p: string) => {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Absolute path of `bin` (a name looked up in PATH, with PATHEXT on Windows, or a path), or undefined. */
export function findOnPath(bin: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const win = process.platform === "win32";
  const pathExts = win ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [];
  // On Windows a bare extensionless file (npm's sh shim) cannot be started: only PATHEXT names,
  // unless the name already has an extension.
  const exts = !win ? [""] : extname(bin) ? ["", ...pathExts] : pathExts;
  const tryExts = (base: string) => {
    for (const e of exts) if (isFile(base + e)) return base + e;
    return undefined;
  };
  if (isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) return tryExts(bin) ?? (isFile(bin) ? bin : undefined);
  const path = env.PATH ?? env.Path ?? "";
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const hit = tryExts(join(dir, bin));
    if (hit) return hit;
  }
  return undefined;
}

/** Names of secrets (API keys, tokens, passwords) in an environment. */
const SECRET_NAME = /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD)$/i;

/**
 * The environment without the server's secrets (docs/security.md, M3/L3): a CLI child gets no API key or
 * token of other providers or services; `keep` names what its own login needs.
 */
export function withoutSecrets(env: NodeJS.ProcessEnv, keep: readonly string[] = []): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (keep.includes(k) || !SECRET_NAME.test(k)) out[k] = v;
  return out;
}

const SAFE_ARG = /^[A-Za-z0-9 ._:\/=,+@-]*$/;

export interface Command {
  file: string;
  args: string[];
  shell: boolean;
}

/** How to start `bin` with `args` on this platform. Throws ENOENT-like errors as `{ code: "ENOENT" }`. */
export function resolveCommand(bin: string, args: string[], env: Record<string, string | undefined> = process.env): Command {
  if (/\.(c|m)?js$/i.test(bin)) return { file: process.execPath, args: [bin, ...args], shell: false };
  const found = findOnPath(bin, env);
  if (!found) throw Object.assign(new Error(`'${bin}' not found`), { code: "ENOENT" });
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(found)) {
    for (const a of args) if (!SAFE_ARG.test(a)) throw new Error(`argument not safe for the Windows shell: ${a.slice(0, 40)}`);
    return { file: [found, ...args].map((a) => `"${a}"`).join(" "), args: [], shell: true };
  }
  return { file: found, args, shell: false };
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Runs a command with stdin, a time cap and no window; `timeout` rejects with { code: "ETIMEDOUT" }. */
export function runCommand(cmd: Command, opts: { stdin: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.file, cmd.args, { cwd: opts.cwd, env: opts.env, windowsHide: true, shell: cmd.shell });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Through cmd.exe the CLI is a grandchild: kill the whole tree.
      if (cmd.shell && process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }).on("error", () => {});
      else child.kill();
      reject(Object.assign(new Error(`no answer within ${opts.timeoutMs} ms`), { code: "ETIMEDOUT" }));
    }, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
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
    child.stdin.end(opts.stdin);
  });
}
