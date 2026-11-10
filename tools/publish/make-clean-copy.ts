// Builds a clean copy of the repository for public release:
//   pnpm publish:copy <target-dir> [--ref <git-ref>] [--name <n> --email <e>]
// `git archive` of the ref into <target-dir>, drops every path in tools/publish/exclude.txt, verifies
// none is left, then `git init` + one commit. It never adds a remote and never pushes.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const COMMIT_MESSAGE = "AnimaPage: first public release";

/** Compiles one exclude.txt line to a regex over repo-relative POSIX paths. */
export function patternToRegExp(line: string): RegExp {
  const dirOnly = line.endsWith("/");
  const body = dirOnly ? line.slice(0, -1) : line;
  const anywhere = !body.includes("/");
  const re = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`${anywhere ? "(^|.*/)" : "^"}${re}${dirOnly ? "/.*" : "(/.*)?"}$`);
}

export function loadExcludes(file: string): RegExp[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(patternToRegExp);
}

function listFiles(root: string, dir = root, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(root, p, out);
    else out.push(relative(root, p).split(sep).join("/"));
  }
  return out;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const flagValues = new Set(["--ref", "--name", "--email"].map((f) => argv.indexOf(f) + 1).filter((i) => i > 0));
  const target = argv.find((a, i) => !a.startsWith("--") && !flagValues.has(i));
  if (!target) throw new Error("usage: pnpm publish:copy <target-dir> [--ref <git-ref>] [--name <n> --email <e>]");
  const ref = arg(argv, "--ref") ?? "HEAD";
  const name = arg(argv, "--name");
  const email = arg(argv, "--email");
  if ((name === undefined) !== (email === undefined)) throw new Error("--name and --email must be given together");

  const dest = resolve(target);
  const rel = relative(REPO, dest);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error(`refusing: target is inside the repository (${dest})`);
  if (existsSync(dest) && readdirSync(dest).length > 0) throw new Error(`refusing: target exists and is not empty (${dest})`);
  mkdirSync(dest, { recursive: true });

  // The archive goes inside the target and is extracted there with relative names only: GNU tar reads
  // "C:..." or "G:..." (archive or -C directory) as a remote host.
  const tarName = ".animapage-src.tar";
  try {
    git(REPO, "archive", "--format=tar", "-o", join(dest, tarName), ref);
    execFileSync("tar", ["-xf", tarName], { cwd: dest });
  } finally {
    rmSync(join(dest, tarName), { force: true });
  }

  const excludes = loadExcludes(join(HERE, "exclude.txt"));
  const isExcluded = (p: string) => excludes.some((r) => r.test(p));
  let removed = 0;
  for (const f of listFiles(dest)) {
    if (!isExcluded(f)) continue;
    rmSync(join(dest, f), { force: true });
    removed++;
  }
  const left = listFiles(dest).filter(isExcluded);
  if (left.length) throw new Error(`excluded paths still present: ${left.slice(0, 5).join(", ")}`);

  git(dest, "init", "-q");
  if (name && email) {
    git(dest, "config", "user.name", name);
    git(dest, "config", "user.email", email);
  }
  git(dest, "add", "-A");
  // Without --name/--email nothing is committed: the owner's global git identity must not be picked up silently.
  if (name && email) git(dest, "commit", "-q", "-m", COMMIT_MESSAGE);

  const files = listFiles(dest).filter((f) => !f.startsWith(".git/"));
  const bytes = files.reduce((n, f) => n + statSync(join(dest, f)).size, 0);
  console.log(`Clean copy of ${ref} in ${dest}`);
  console.log(`  files: ${files.length} (${removed} excluded paths removed), size: ${(bytes / 1048576).toFixed(1)} MB`);
  console.log("  no remote configured, nothing pushed.");
  if (!name) console.log(`  git identity not set, files are staged but NOT committed. In the copy: git config user.name ...; git config user.email ...; git commit -m "${COMMIT_MESSAGE}"`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`publish:copy: ${(e as Error).message}`);
    process.exit(1);
  }
}
