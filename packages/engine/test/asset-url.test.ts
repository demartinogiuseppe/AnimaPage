// docs/security.md (M2): a scene's asset paths are model-written; the player and the export fetch them only from the app.
import { describe, expect, it } from "vitest";
import { localAssetUrl } from "../src/index.ts";

const BASE = "https://192.168.1.10:5443/?lesson=x";

describe("localAssetUrl", () => {
  it("resolves paths of the app's own origin", () => {
    expect(localAssetUrl("models/vase.glb", BASE).href).toBe("https://192.168.1.10:5443/models/vase.glb");
    expect(localAssetUrl("/cache/art/Q1.jpg", BASE).href).toBe("https://192.168.1.10:5443/cache/art/Q1.jpg");
  });
  it("refuses other origins (beacons, SSRF to the LAN or loopback)", () => {
    for (const p of ["https://evil.example/x.glb", "//evil.example/x.glb", "http://127.0.0.1:8787/api/lessons", "http://192.168.1.1/admin", "data:text/plain,x", "javascript:alert(1)"])
      expect(() => localAssetUrl(p, BASE), p).toThrow(/not an asset of this app/);
  });
});
