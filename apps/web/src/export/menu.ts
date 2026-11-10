// "Esporta" menu of a complete lesson: interactive .html or OpenBoard .wgt, with progress and a size warning.
import { localAssetUrl, readPresentationPref, resolvePresentation, sceneKey } from "@pv/engine";
import type { SceneSpec } from "@pv/scene-spec";
import { t, uiLanguage } from "@pv/scene-spec/i18n";
import { currentCatalog, uiDecimal } from "../i18n.ts";
import { assembleHtml } from "./assemble.ts";
import { collectExport, exportFileName, ExportError, SIZE_WARN_BYTES, type Fetcher } from "./collect.ts";
import { buildWgt } from "./wgt.ts";

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** Default fetcher: same-origin GET. A dead AnimaPage server (the dev proxy answers 502/503/504) on /cache/ is a TypeError;
 * an HTML page for a path that is not .html (the SPA fallback for a missing file) is an Error naming the path. */
export const appFetcher: Fetcher = async (path) => {
  const res = await fetch(localAssetUrl(path, document.baseURI));
  if (!res.ok) {
    if ((res.status === 502 || res.status === 503 || res.status === 504) && path.startsWith("/cache/")) {
      throw new TypeError(`server unreachable: HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  // Vite answers a missing file with index.html (status 200): never take that for a script, model or sound.
  if (!path.endsWith(".html") && /^\s*text\/html\b/i.test(res.headers.get("content-type") ?? "")) {
    throw new Error(`${path}: got an HTML page instead of the file (missing on the server?)`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

function saveBlob(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "340 kB", "1,4 MB" (decimal mark of the UI language); MB from 1024 kB after rounding. */
export function formatSize(n: number): string {
  const kb = Math.max(1, Math.round(n / 1024));
  return kb < 1024 ? `${kb} kB` : `${uiDecimal((n / 1024 / 1024).toFixed(1))} MB`;
}

function button(cls: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  return b;
}

export function exportMenu(spec: SceneSpec, deps: { fetch?: Fetcher; download?: (name: string, data: Blob) => void } = {}): HTMLElement {
  const fetcher = deps.fetch ?? appFetcher;
  const download = deps.download ?? saveBlob;
  const root = document.createElement("span");
  root.className = "export-menu";
  const toggle = button("export-toggle", t("export.menu"));
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.className = "export-list";
  list.hidden = true;
  const status = document.createElement("span");
  status.className = "note export-status";
  status.setAttribute("role", "status");
  let isOpen = false;
  const setOpen = (open: boolean) => {
    isOpen = open;
    list.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setOpen(!isOpen));

  let busy = false;
  async function run(ext: "html" | "wgt"): Promise<void> {
    if (busy) return;
    busy = true;
    setOpen(false);
    status.textContent = t("export.working");
    try {
      const input = await collectExport(spec, {
        fetch: fetcher,
        uiLang: uiLanguage(),
        catalog: currentCatalog(),
        presentation: resolvePresentation(readPresentationPref(), spec),
        app: `AnimaPage ${APP_VERSION}`,
      });
      const html = assembleHtml(input);
      const name = exportFileName(spec.title, ext);
      const blob =
        ext === "html"
          ? new Blob([html], { type: "text/html;charset=utf-8" })
          : new Blob([buildWgt(html, { id: sceneKey(spec), title: spec.title, version: APP_VERSION }) as BlobPart], { type: "application/widget" });
      const done = t("export.done", { name, size: formatSize(blob.size) });
      status.textContent = blob.size > SIZE_WARN_BYTES ? `${done} ${t("export.tooBig", { size: formatSize(blob.size) })}` : done;
      download(name, blob);
    } catch (e) {
      status.textContent =
        e instanceof ExportError && e.kind === "server" ? t("export.serverDown") : t("export.failed", { reason: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
  }

  const html = button("export-item", t("export.html"));
  html.addEventListener("click", () => void run("html"));
  const wgt = button("export-item", t("export.wgt"));
  wgt.addEventListener("click", () => void run("wgt"));
  list.append(html, wgt);
  root.append(toggle, list, status);
  return root;
}
