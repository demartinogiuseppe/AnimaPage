// docs/security.md (M2): the visual check's Chrome loads only the web app; art models only from local asset paths.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SceneSpec } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { allowedRequest } from "../src/check/render.ts";
import { postprocess } from "../src/generate/checks.ts";
import { ANALYSIS, ENRICH } from "./pipeline-fakes.ts";

const ART = fileURLToPath(new URL("../../fixtures/public/scenes/gen-art_primavera-botticelli.scene.json", import.meta.url));

describe("visual check requests", () => {
  const base = "http://localhost:5173";
  it("allows the web app's own origin and inline data", () => {
    for (const u of ["http://localhost:5173/?render=1", "http://localhost:5173/models/a.glb", "http://localhost:5173/cache/art/Q1.jpg", "data:image/png;base64,AA", "blob:http://localhost:5173/1"])
      expect(allowedRequest(u, base), u).toBe(true);
  });
  it("blocks everything else: internet, LAN, other loopback ports", () => {
    for (const u of ["https://evil.example/x.glb", "http://127.0.0.1:8787/api/lessons", "http://localhost:8787/api/lessons", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data"])
      expect(allowedRequest(u, base), u).toBe(false);
  });
});

describe("art model asset", () => {
  const withModel = (asset: string) => {
    const scene = SceneSpec.parse(JSON.parse(readFileSync(ART, "utf8")));
    if (scene.engine !== "art") throw new Error("not an art scene");
    scene.engineData.model = { asset, sourceId: "page", height: 1 };
    postprocess(scene, { analysis: ANALYSIS, enrich: ENRICH });
    return scene.engineData.model?.asset;
  };
  it("keeps local asset paths", () => {
    for (const a of ["models/vase.glb", "/models/statues/venus_1.glb", "cache/art/Q1.glb"]) expect(withModel(a), a).toBe(a);
  });
  it("drops URLs and paths outside the asset folders", () => {
    for (const a of ["https://evil.example/x.glb", "//evil.example/x.glb", "http://127.0.0.1:8787/api/lessons", "models/../../server/.env", "api/lessons", "models//x.glb", "models/x.glb?x=1"])
      expect(withModel(a), a).toBeUndefined();
  });
});
