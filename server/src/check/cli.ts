// Visual check of a saved scene, outside the pipeline (needs the Vite dev server and Chrome):
//
//   pnpm --filter @pv/server check <scene.json | lesson.json> [--photo page.png] [--analysis a.json]
//                                  [--out dir] [--render-only]
//
// A lesson file's `scene` field is used. The photo is read into memory and processed like an
// upload (server/src/image.ts), never written; --out saves the screenshots for a person to look at.
// One judge call (Claude CLI, subscription), none with --render-only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PageAnalysis, SceneSpec } from "@pv/scene-spec";
import { preparePhoto } from "../image.ts";
import { renderScene, visualCheck, type CheckDeps } from "./index.ts";
import { EffortCliProvider } from "../generate/provider.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!file) {
  console.error("usage: check <scene.json | lesson.json> [--photo page.png] [--analysis a.json] [--out dir] [--render-only]");
  process.exit(2);
}
const json = JSON.parse(readFileSync(file, "utf8")) as { scene?: unknown; analysis?: unknown };
const scene = SceneSpec.parse(json.scene ?? json);
const analysisFile = flag("--analysis");
const analysisJson = analysisFile ? (JSON.parse(readFileSync(analysisFile, "utf8")) as { analysis?: unknown }) : undefined;
const analysis = analysisJson ? PageAnalysis.parse(analysisJson.analysis ?? analysisJson) : undefined;
const photoFile = flag("--photo");
const photo = photoFile ? (await preparePhoto(readFileSync(photoFile))).data : undefined;
const out = flag("--out");
const webUrl = process.env.PAGINAVIVA_WEB_URL || undefined;

const save = (shots: { chapterId: string; moment: string; jpeg: Buffer }[]) => {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  shots.forEach((s, k) => writeFileSync(join(out, `${String(k + 1).padStart(2, "0")}-${s.chapterId}-${s.moment}.jpg`), s.jpeg));
  console.log(`screenshots: ${out} (${shots.length})`);
};

if (args.includes("--render-only")) {
  const t0 = performance.now();
  const shots = await renderScene(scene, { webUrl });
  save(shots);
  console.log(`render ${Math.round(performance.now() - t0)} ms, ${shots.map((s) => `${Math.round(s.jpeg.length / 1024)} kB`).join(" ")}`);
} else {
  const deps: CheckDeps = {
    render: (s, signal) => renderScene(s, { webUrl, signal }),
    judge: new EffortCliProvider({ effort: "low" }),
    onShots: save,
  };
  const r = await visualCheck({ scene, photo, analysis }, deps);
  console.log(JSON.stringify(r, null, 2));
}
