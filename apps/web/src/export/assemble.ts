// Puts a whole lesson into one self-contained HTML string, and reads the payload back out.
import { PAYLOAD_ID, type ExportPayload } from "./payload.ts";

export interface ExportInput {
  payload: ExportPayload;
  runtimeJs: string;
  runtimeCss: string;
  title: string;
}

const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `<` -> `\u003c` is valid JSON, so `</script` and `<!--` can never appear in the payload. */
const escapeJson = (json: string): string => json.replace(/</g, "\\u003c");

/** Neutralise only what would end or confuse the script element; `a<b` stays intact. */
const escapeScript = (js: string): string =>
  js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

const escapeStyle = (css: string): string => css.replace(/<\/style/gi, "<\\/style");

/** The app's page layout (apps/web/index.html): the player fills the window and scrolls inside its
 * panels, never the page. Without it `.pv-app{height:100%}` resolves to auto and the whole page scrolls. */
const BASE_CSS = "html,body{height:100%;margin:0}body{overflow:hidden}";

/**
 * Licence notices of the code bundled in the runtime (MIT and OFL ask for the notice in every copy;
 * minification drops the libraries' own headers). Keep in sync with the runtime's dependencies and NOTICE.md.
 * Plain ASCII and no double hyphen: it sits inside an HTML comment.
 */
export const LICENCE_NOTICES = [
  "AnimaPage exported lesson. Licences of the code in this file:",
  "AnimaPage: MIT License, Copyright (c) 2026 G. De Martino.",
  "three.js (with its addons): MIT License, Copyright (c) 2010-2026 three.js authors.",
  "KaTeX: MIT License, Copyright (c) 2013-2020 Khan Academy and other contributors.",
  "KaTeX fonts: SIL Open Font License 1.1, Copyright (c) 2009-2010 Design Science, Inc., Copyright (c) 2014-2018 Khan Academy.",
  "zod: MIT License, Copyright (c) 2025 Colin McDonnell.",
  "MIT License: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
  "SIL Open Font License 1.1: https://openfontlicense.org",
  "Models and sounds: CC0. Images, texts and data: see the lesson's Sources list (licence of each source).",
];

export function assembleHtml(input: ExportInput): string {
  const { payload, runtimeJs, runtimeCss, title } = input;
  return [
    "<!doctype html>",
    "<!-- licences\n" + LICENCE_NOTICES.join("\n") + "\n-->",
    '<html lang="' + escapeText(payload.uiLang) + '">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="' + escapeText(payload.app) + '">',
    "<title>" + escapeText(title) + "</title>",
    "<style>" + BASE_CSS + "</style>",
    "<style>" + escapeStyle(runtimeCss) + "</style>",
    "</head>",
    "<body>",
    '<script type="application/json" id="' + PAYLOAD_ID + '">' + escapeJson(JSON.stringify(payload)) + "</script>",
    "<script>" + escapeScript(runtimeJs) + "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Inverse of assembleHtml: parses the payload element back out. */
export function payloadOf(html: string): ExportPayload {
  const m = new RegExp('<script type="application/json" id="' + PAYLOAD_ID + '">([\\s\\S]*?)</script>').exec(html);
  if (!m) throw new Error("export payload missing");
  return JSON.parse(m[1]!) as ExportPayload;
}
