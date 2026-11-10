// Entry of the exported lesson (.html): reads the embedded payload and mounts the player offline.
// Built by scripts/build-export-runtime.ts into one inlined script; runs from file://.
import { SceneSpec } from "@pv/scene-spec";
import { isRtl, setUiLanguage, t } from "@pv/scene-spec/i18n";
import { createEngine, mountPlayer } from "@pv/engine";
import { EXPORT_FORMAT, PAYLOAD_ID, type ExportPayload } from "./payload.ts";

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function main(): Promise<void> {
  const node = document.getElementById(PAYLOAD_ID);
  if (!node?.textContent) throw new Error("export payload missing");
  const payload = JSON.parse(node.textContent) as ExportPayload;
  if (payload.format !== EXPORT_FORMAT) throw new Error(`unsupported export format ${String(payload.format)}`);

  setUiLanguage(payload.uiLang, payload.catalog ?? undefined);
  document.documentElement.lang = payload.uiLang;
  document.documentElement.dir = isRtl(payload.uiLang) ? "rtl" : "ltr";

  const spec = SceneSpec.parse(payload.spec);
  const host = document.getElementById("app") ?? document.body;
  const engine = await createEngine(spec.engine);
  await mountPlayer(host, spec, engine, {
    exported: true,
    presentation: payload.presentation,
    loadAsset: async (path) => {
      const b64 = payload.assets[path];
      if (b64 === undefined) throw new Error(`asset ${path}: not in file`);
      return decodeBase64(b64);
    },
  });
  document.documentElement.dataset.pvExport = "ready";
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.textContent = t("player.buildFail");
  document.documentElement.dataset.pvExport = "error";
});
