// Shared contract of the exported lesson: the JSON payload embedded in the .html file, and the
// names of the runtime files the assembler inlines next to it.
import type { Presentation } from "@pv/engine";
import type { Catalog } from "@pv/scene-spec/i18n";

export const EXPORT_FORMAT = 1;
/** id of the <script type="application/json"> element that holds the payload. */
export const PAYLOAD_ID = "pv-export";
/** Build output of scripts/build-export-runtime.ts, relative to fixtures/public. */
export const RUNTIME_JS = "export/runtime.js";
export const RUNTIME_CSS = "export/runtime.css";
/** First bytes of a runtime.js written by the build script: anything else (e.g. the dev server's
 * index.html fallback for a missing file) is not the runtime. */
export const RUNTIME_MARKER = "/*! AnimaPage export runtime */";

export interface ExportPayload {
  format: 1;
  app: string;
  uiLang: string;
  /** Catalog for a language that is not built in; null when the built-in one is used. */
  catalog: Catalog | null;
  presentation: Presentation;
  /** The lesson (SceneSpec), validated again by the runtime. */
  spec: unknown;
  /** Asset path -> base64 content. */
  assets: Record<string, string>;
}
