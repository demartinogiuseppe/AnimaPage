// Gathers everything an exported lesson needs: the runtime, every asset as base64, the UI catalog.
import { assetsOf, type Presentation } from "@pv/engine";
import type { SceneSpec } from "@pv/scene-spec";
import type { Catalog } from "@pv/scene-spec/i18n";
import type { ExportInput } from "./assemble.ts";
import { EXPORT_FORMAT, RUNTIME_CSS, RUNTIME_JS, RUNTIME_MARKER } from "./payload.ts";

/** Warn above this size: browsers and OpenBoard get slow with very large single files. */
export const SIZE_WARN_BYTES = 30 * 1024 * 1024;

/** In the app: fetch(new URL(path, document.baseURI)); in the e2e check: reads from disk. */
export type Fetcher = (path: string) => Promise<Uint8Array>;

export class ExportError extends Error {
  constructor(
    public kind: "server" | "runtime" | "asset",
    message: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

export interface CollectDeps {
  fetch: Fetcher;
  uiLang: string;
  catalog: Catalog | null;
  presentation: Presentation;
  app: string;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** Chunked so a large file never exceeds the argument limit of String.fromCharCode.apply. */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(bin);
}

const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function load(fetcher: Fetcher, path: string): Promise<Uint8Array> {
  try {
    return await fetcher(path);
  } catch (e) {
    if (path === RUNTIME_JS || path === RUNTIME_CSS) throw new ExportError("runtime", `${path}: ${detail(e)}`);
    if (e instanceof TypeError && path.startsWith("/cache/")) throw new ExportError("server", `${path}: ${detail(e)}`);
    throw new ExportError("asset", `${path}: ${detail(e)}`);
  }
}

export async function collectExport(spec: SceneSpec, deps: CollectDeps): Promise<ExportInput> {
  const dec = new TextDecoder();
  const runtimeJs = dec.decode(await load(deps.fetch, RUNTIME_JS));
  if (!runtimeJs.startsWith(RUNTIME_MARKER)) throw new ExportError("runtime", `${RUNTIME_JS}: not the export runtime (run \`pnpm --filter @pv/web export-runtime\`)`);
  const runtimeCss = dec.decode(await load(deps.fetch, RUNTIME_CSS));
  const refs = assetsOf(spec);
  const bytes = new Map<string, Uint8Array>();
  const get = async (path: string) => {
    if (!bytes.has(path)) bytes.set(path, await load(deps.fetch, path));
  };
  for (const path of refs.files) await get(path);
  for (const path of refs.terrainHeaders) {
    let grid: string;
    try {
      grid = (JSON.parse(dec.decode(bytes.get(path)!)) as { data: string }).data;
    } catch (e) {
      throw new ExportError("asset", `${path}: ${detail(e)}`);
    }
    await get(dirOf(path) + grid);
  }
  const assets: Record<string, string> = {};
  for (const [path, b] of bytes) assets[path] = toBase64(b);
  return {
    payload: { format: EXPORT_FORMAT, app: deps.app, uiLang: deps.uiLang, catalog: deps.catalog, presentation: deps.presentation, spec, assets },
    runtimeJs,
    runtimeCss,
    title: spec.title,
  };
}

/** Lesson title -> `slug.ext`: ASCII-folded, lowercase, max 60 characters, `lezione` when empty. */
export function exportFileName(title: string, ext: "html" | "wgt"): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "lezione"}.${ext}`;
}
