// End-to-end in mock mode: each dataset photo goes through the real pipeline (analysis, enrichment,
// geo, generation replayed from fixtures) and must give its full lesson, never the card fallback.
// A failure here usually means a recording is stale: re-record with
//   pnpm --filter @pv/server generate --live <label>
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkScene } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { defaultStages, runPipeline } from "../src/pipeline/run.ts";

const PAGES = fileURLToPath(new URL("../../fixtures/pages/", import.meta.url));
const LABELS = [
  ["geografia_campania_p84", "map"],
  ["grammatica_modo-indicativo_p44", "concept"],
  ["racconto_elettricista-pasticcione", "diorama"],
  ["scienze_sensi_p38-39", "process"],
  ["storia_germani-fine-impero_p116-117", "timeline"],
] as const;

describe("mock pipeline on the dataset photos", () => {
  for (const [label, engine] of LABELS) {
    const photo = `${PAGES}${label}.jpg`;
    it.skipIf(!existsSync(photo))(`${label}: full ${engine} lesson, no fallback`, { timeout: 60_000 }, async () => {
      const env = { PAGINAVIVA_MODE: "mock", PAGINAVIVA_LEDGER: join(mkdtempSync(join(tmpdir(), "pv-e2e-")), "ledger.jsonl") };
      const r = await runPipeline(readFileSync(photo), { mode: "mock", stages: defaultStages(env, "mock") });
      expect(r.status).toBe("scene");
      if (r.status !== "scene") return;
      expect(r.fallback).toBe(false);
      expect(r.scene.engine).toBe(engine);
      expect(checkScene(r.scene)).toEqual([]);
    });
  }
});
