import { describe, expect, it } from "vitest";
import { assembleHtml, LICENCE_NOTICES, payloadOf, type ExportInput } from "../src/export/assemble.ts";
import { buildWgt } from "../src/export/wgt.ts";
import { readStoredZip } from "../src/export/zip-read.ts";

function input(over: Partial<ExportInput["payload"]> = {}, rest: Partial<ExportInput> = {}): ExportInput {
  return {
    payload: {
      format: 1,
      app: "AnimaPage 1.0",
      uiLang: "it",
      catalog: null,
      presentation: { mode: "lesson" } as never,
      spec: { title: "Lezione", scenes: [] },
      assets: { "a/b.png": "AAEC" },
      ...over,
    },
    runtimeJs: "(function(){var a=1,b=2;if(a<b){}})();",
    runtimeCss: "body{margin:0}",
    title: "Lezione <1> & \"co\"",
    ...rest,
  };
}

const closings = (html: string) => html.match(/<\/script>/gi)?.length ?? 0;

describe("assembleHtml", () => {
  it("round-trips the payload", () => {
    const x = input();
    expect(payloadOf(assembleHtml(x))).toEqual(x.payload);
  });

  it("assembleHtml escapes script terminators", () => {
    const evil = "</script><!-- x </SCRIPT>";
    const x = input({ spec: { title: evil, narration: evil } }, {
      runtimeJs: 'var s = "</script>"; var c = "<!--"; if (a<b) {}',
      runtimeCss: "a::after{content:'</style>'}",
      title: evil,
    });
    const html = assembleHtml(x);
    expect(payloadOf(html)).toEqual(x.payload);
    expect(closings(html)).toBe(2);
    expect(html).toContain("a<b");
    expect(html).toContain('"<\\/script>"');
    expect(html.match(/<\/style>/gi)?.length).toBe(2); // the base layout and the runtime stylesheet
    expect(html).toContain("<title>&lt;/script&gt;&lt;!-- x &lt;/SCRIPT&gt;</title>");
  });

  it("escapes the title as HTML text", () => {
    const html = assembleHtml(input());
    expect(html).toContain("<title>Lezione &lt;1&gt; &amp; &quot;co&quot;</title>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="generator" content="AnimaPage 1.0">');
    expect(html).toContain('id="pv-export"');
  });

  it("has the app's base layout, so the player fills the window and the page does not scroll", () => {
    const html = assembleHtml(input());
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain("<style>html,body{height:100%;margin:0}body{overflow:hidden}</style>");
    // Before the runtime stylesheet, which may override it.
    expect(head.indexOf("overflow:hidden")).toBeLessThan(head.indexOf("body{margin:0}"));
  });

  it("payload carries a non-built-in catalog", () => {
    const x = input({ uiLang: "ja", catalog: { "player.buildFail": "失敗 <b>" } as never });
    expect(payloadOf(assembleHtml(x))).toEqual(x.payload);
  });

  it("payload has only the allowed keys", () => {
    const p = payloadOf(assembleHtml(input()));
    expect(Object.keys(p).sort()).toEqual(["app", "assets", "catalog", "format", "presentation", "spec", "uiLang"]);
  });
});

describe("licence notices in the exported file", () => {
  const notices = (html: string) => /<!-- licences\n([\s\S]*?)\n-->/.exec(html)?.[1];

  it("the .html carries the notices of the bundled code right after the doctype", () => {
    const html = assembleHtml(input());
    expect(html.startsWith("<!doctype html>\n<!-- licences\n")).toBe(true);
    const block = notices(html)!;
    for (const lib of ["AnimaPage: MIT License", "three.js", "KaTeX: MIT License", "KaTeX fonts: SIL Open Font License 1.1", "zod: MIT License"]) {
      expect(block).toContain(lib);
    }
    expect(block).toContain("The above copyright notice and this permission notice shall be included");
    // A valid HTML comment (no "--" inside), and the payload still parses.
    expect(block).not.toContain("--");
    expect(payloadOf(html)).toEqual(input().payload);
  });

  it("the .wgt's index.html carries the same notices", () => {
    const html = assembleHtml(input());
    const index = new TextDecoder().decode(readStoredZip(buildWgt(html, { id: "x", title: "T", version: "1" })).get("index.html"));
    expect(notices(index)).toBe(LICENCE_NOTICES.join("\n"));
  });
});

