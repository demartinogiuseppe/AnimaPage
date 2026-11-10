import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANALYSIS_ENGINES, EngineId, PageAnalysis, pageAnalysisJsonSchema } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { AnalysisError, analyzePage, detectMediaType } from "../src/analyze/index.ts";
import { sanitizeEntry, type LedgerEntry } from "../src/ledger.ts";
import { MockProvider, readRecordings } from "../src/llm/mock.ts";
import type { LlmProvider, StructuredRequest, StructuredResponse } from "../src/llm/types.ts";

const PAGES_DIR = fileURLToPath(new URL("../../fixtures/pages/", import.meta.url));
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("not really a photo")]);

const sample: PageAnalysis = {
  readable: true,
  confidence: 0.9,
  language: "it",
  pages: { visible: 1, numbers: [84] },
  orientation: "upright",
  subject: "geografia",
  topic: "La Campania",
  contentType: "explanation",
  literary: { isLiterary: false },
  summary: "La Campania.",
  concepts: ["territorio"],
  entities: [{ name: "Vesuvio", type: "place", onPage: true }],
  claims: [{ text: "Il Vesuvio è un vulcano attivo.", kind: "fact", onPage: true }],
  exercises: [],
  illustrations: [{ kind: "map", description: "Carta fisica.", labels: ["Napoli"] }],
  suggestedEngine: "map",
  engineReason: "Una regione.",
};

/** Answers with the given payloads in order and records the requests. */
function scripted(...answers: unknown[]): LlmProvider & { calls: StructuredRequest[] } {
  const calls: StructuredRequest[] = [];
  return {
    name: "mock",
    calls,
    async generateStructured(req): Promise<StructuredResponse> {
      calls.push(req);
      const data = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { data, durationMs: 1, model: "scripted", usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
}

const tmp = () => mkdtempSync(join(tmpdir(), "pv-analyze-"));

describe("PageAnalysis schema", () => {
  it("accepts a complete analysis and rejects claims not on the page", () => {
    expect(PageAnalysis.safeParse(sample).success).toBe(true);
    const bad = { ...sample, claims: [{ text: "x", kind: "fact", onPage: false }] };
    expect(PageAnalysis.safeParse(bad).success).toBe(false);
    expect(PageAnalysis.safeParse({ ...sample, extra: 1 }).success).toBe(false);
    expect(PageAnalysis.safeParse({ ...sample, pages: { visible: 3, numbers: [] } }).success).toBe(false);
  });

  it("offers exactly the SceneSpec engines", () => {
    // Engines the pipeline can generate: a subset of all engines (new ones join once the generator supports them).
    for (const e of ANALYSIS_ENGINES) expect(EngineId.options).toContain(e);
  });

  it("exports a draft-07 JSON Schema for the CLI", () => {
    const s = pageAnalysisJsonSchema();
    expect(s.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(s.required).toEqual(expect.arrayContaining(["subject", "topic", "suggestedEngine", "claims", "pages"]));
    expect(s.additionalProperties).toBe(false);
    expect((s.properties as Record<string, { enum?: string[] }>).audience?.enum).toEqual(["child", "teen", "adult"]);
    expect(s.required).not.toContain("audience");
  });

  it("accepts an optional audience (D25)", () => {
    expect(PageAnalysis.safeParse({ ...sample, audience: "adult" }).success).toBe(true);
    expect(PageAnalysis.safeParse({ ...sample, audience: "university" }).success).toBe(false);
  });
});

describe("analyzePage", () => {
  it("detects image types by magic bytes", () => {
    expect(detectMediaType(FAKE_JPEG)).toBe("image/jpeg");
    expect(() => detectMediaType(Buffer.from("hello"))).toThrow(/Unsupported/);
  });

  it("validates, caches by image hash and writes a ledger line", async () => {
    const ledgerPath = join(tmp(), "ledger.jsonl");
    const cacheDir = tmp();
    const provider = scripted(sample);
    const r1 = await analyzePage(FAKE_JPEG, { provider, ledgerPath, cacheDir });
    expect(r1.validation).toBe("ok");
    expect(r1.analysis).toEqual(sample);
    const r2 = await analyzePage(FAKE_JPEG, { provider, ledgerPath, cacheDir });
    expect(r2.validation).toBe("cached");
    expect(provider.calls).toHaveLength(1);
    const lines = readFileSync(ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as LedgerEntry);
    expect(lines.map((l) => l.validation)).toEqual(["ok", "cached"]);
    expect(lines[0]).toMatchObject({ kind: "analyze", engine: "map", tokensIn: 10, tokensOut: 20, llmCalls: 1, cached: false });
    expect(lines[0]!.phasesMs.llm).toBeGreaterThanOrEqual(0);
  });

  it("repairs an invalid answer once, sending the validation problems back", async () => {
    const provider = scripted({ ...sample, suggestedEngine: "globe" }, sample);
    const r = await analyzePage(FAKE_JPEG, { provider, ledgerPath: null, cacheDir: null });
    expect(r.validation).toBe("repaired");
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.prompt).toContain("suggestedEngine");
    expect(provider.calls[1]!.images).toHaveLength(1);
    expect(r.ledger).toMatchObject({ llmCalls: 2, tokensOut: 40, validation: "repaired" });
  });

  it("gives up after one failed repair and logs the failure", async () => {
    const ledgerPath = join(tmp(), "ledger.jsonl");
    const provider = scripted({ nope: true });
    const err = await analyzePage(FAKE_JPEG, { provider, ledgerPath, cacheDir: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect(provider.calls).toHaveLength(2);
    const line = JSON.parse(readFileSync(ledgerPath, "utf8").trim()) as LedgerEntry;
    expect(line.validation).toBe("failed");
  });
});

describe("ledger", () => {
  const allowed = new Set([
    "time", "kind", "pageHash", "provider", "model", "phasesMs", "tokensIn", "tokensOut", "cacheReadTokens",
    "cacheCreationTokens", "costUsdEstimate", "llmCalls", "externalRequests", "cached", "engine", "confidence",
    "validation", "error",
  ]);

  it("never contains the photo, keys, tokens or environment variables", async () => {
    // Built from parts so secret scanners do not flag the source.
    const secret = ["sk", "ant", "THIS-IS-A-FAKE-SECRET-1234567890abcdefghijklmnop"].join("-");
    process.env.PV_TEST_SECRET = secret;
    const ledgerPath = join(tmp(), "ledger.jsonl");
    // A provider failure whose message carries a secret and the image bytes.
    const leaky: LlmProvider = {
      name: "claude-cli",
      generateStructured: async () => {
        throw new Error(`boom ${secret} ${FAKE_JPEG.toString("base64").repeat(4)}`);
      },
    };
    await analyzePage(FAKE_JPEG, { provider: leaky, ledgerPath, cacheDir: null }).catch(() => undefined);
    await analyzePage(FAKE_JPEG, { provider: scripted(sample), ledgerPath, cacheDir: null });
    const text = readFileSync(ledgerPath, "utf8");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(FAKE_JPEG.toString("base64"));
    expect(text).not.toMatch(/PV_TEST_SECRET|ANTHROPIC|PATH/);
    for (const l of text.trim().split("\n")) for (const k of Object.keys(JSON.parse(l))) expect(allowed.has(k)).toBe(true);
    delete process.env.PV_TEST_SECRET;
  });

  it("drops unknown fields even if a caller passes them", () => {
    const dirty = { time: "t", kind: "analyze", phasesMs: { llm: 1 }, photo: "AAAA", env: { KEY: "v" } } as unknown as LedgerEntry;
    expect(sanitizeEntry(dirty)).toEqual({ time: "t", kind: "analyze", phasesMs: { llm: 1 } });
  });
});

describe("recorded analyses (fixtures/llm, offline)", () => {
  const recordings = readRecordings();

  // Recordings of the protected book pages are left out of the public copy (tools/publish/exclude.txt).
  it.skipIf(!["geografia_campania_p84", "grammatica_modo-indicativo_p44", "racconto_elettricista-pasticcione", "scienze_sensi_p38-39", "storia_germani-fine-impero_p116-117"].every((l) => recordings.some((r) => r.label === l)))("has the reference pages", () => {
    expect(recordings.map((r) => r.label).sort()).toEqual([
      "geografia_campania_p84",
      "grammatica_modo-indicativo_p44",
      "racconto_elettricista-pasticcione",
      "scienze_sensi_p38-39",
      "storia_germani-fine-impero_p116-117",
      "vasi-comunicanti",
    ]);
  });

  for (const rec of recordings) {
    it(`${rec.label}: recorded answer is a valid PageAnalysis and replays through analyzePage`, async () => {
      expect(PageAnalysis.safeParse(rec.response.data).success).toBe(true);
      const photo = [".jpg", ".png"].map((ext) => join(PAGES_DIR, `${rec.label}${ext}`)).find((p) => existsSync(p));
      if (!photo) return; // photos are git-ignored (copyright); replay needs them
      const r = await analyzePage(photo, { provider: new MockProvider(), ledgerPath: null, cacheDir: null });
      expect(r.validation).toBe("ok");
      expect(r.analysis).toEqual(rec.response.data);
    });
  }
});
