// Mock provider: replays responses recorded in fixtures/llm/ (no network, no CLI).
//
// A recording is keyed by a SHA-256 of the request: system prompt, user prompt,
// JSON schema and the SHA-256 of each image. Images themselves are never stored.
// File name: `<label>.<key first 16 hex>.json`; the full key is inside.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LlmError,
  type LlmProvider,
  type StreamOptions,
  type StructuredRequest,
  type StructuredResponse,
} from "./types.ts";

export const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/llm/", import.meta.url));

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface RequestFingerprint {
  systemSha256: string;
  promptSha256: string;
  schemaSha256: string;
  imageSha256: string[];
}

export function fingerprint(req: StructuredRequest): RequestFingerprint {
  return {
    systemSha256: sha256(req.system),
    promptSha256: sha256(req.prompt),
    schemaSha256: sha256(JSON.stringify(req.jsonSchema)),
    imageSha256: (req.images ?? []).map((i) => sha256(i.data)),
  };
}

export function requestKey(req: StructuredRequest): string {
  return sha256(JSON.stringify(fingerprint(req)));
}

export interface Recording {
  key: string;
  label: string;
  recordedAt: string;
  provider: string;
  request: RequestFingerprint;
  response: StructuredResponse;
}

function findRecordingFile(dir: string, key: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const suffix = `.${key.slice(0, 16)}.json`;
  return readdirSync(dir).find((f) => f.endsWith(suffix));
}

export function readRecordings(dir = DEFAULT_FIXTURES_DIR): Recording[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Recording);
}

/** Chunked replay of a recording to a streaming caller (decision D22). */
export interface MockStreamOptions {
  /** Characters per chunk. Default 400. */
  chunkChars?: number;
  /** Pause between chunks. Default 0 (one macrotask). */
  chunkDelayMs?: number;
}

export class MockProvider implements LlmProvider {
  readonly name = "mock" as const;
  constructor(
    private readonly dir = DEFAULT_FIXTURES_DIR,
    private readonly replay: MockStreamOptions = {},
  ) {}

  async generateStructured(req: StructuredRequest, stream?: StreamOptions): Promise<StructuredResponse> {
    const key = requestKey(req);
    const file = findRecordingFile(this.dir, key);
    if (!file) {
      throw new LlmError(
        "mock_missing",
        `No recorded LLM response for request ${key.slice(0, 16)} in ${this.dir}. ` +
          "Record it live with `pnpm --filter @pv/server analyze <photo>`.",
      );
    }
    const rec = JSON.parse(readFileSync(join(this.dir, file), "utf8")) as Recording;
    if (rec.key !== key) throw new LlmError("mock_missing", `Recording ${file} does not match key ${key}.`);
    if (stream) await replayChunks(JSON.stringify(rec.response.data), stream, this.replay);
    return rec.response;
  }
}

/** Sends `text` to the stream in chunks, as a streaming provider would while the model writes. */
export async function replayChunks(text: string, stream: StreamOptions, opts: MockStreamOptions = {}): Promise<void> {
  const size = Math.max(1, opts.chunkChars ?? 400);
  stream.onJsonDelta("", true);
  for (let i = 0; i < text.length; i += size) {
    await new Promise((r) => setTimeout(r, opts.chunkDelayMs ?? 0));
    stream.onJsonDelta(text.slice(i, i + size), false);
  }
}

function safeLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "request";
}

/** Wraps a live provider and writes every successful response as a recording. */
export class RecordingProvider implements LlmProvider {
  readonly name: string;
  constructor(
    private readonly inner: LlmProvider,
    private readonly label: () => string,
    private readonly dir = DEFAULT_FIXTURES_DIR,
  ) {
    this.name = inner.name;
  }

  async generateStructured(req: StructuredRequest, stream?: StreamOptions): Promise<StructuredResponse> {
    const res = await this.inner.generateStructured(req, stream);
    const key = requestKey(req);
    const rec: Recording = {
      key,
      label: this.label(),
      recordedAt: new Date().toISOString(),
      provider: this.inner.name,
      request: fingerprint(req),
      response: res,
    };
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${safeLabel(rec.label)}.${key.slice(0, 16)}.json`), JSON.stringify(rec, null, 2) + "\n");
    return res;
  }
}
