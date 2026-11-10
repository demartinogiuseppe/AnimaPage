import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildWgt } from "../src/export/wgt.ts";
import { readStoredZip } from "../src/export/zip-read.ts";

describe("buildWgt", () => {
  it("wgt contains config.xml and index.html with valid CRCs", () => {
    const html = "<!doctype html><p>Perché è così – ✓</p>\n";
    const zip = buildWgt(html, { id: "abc123", title: 'A & B <"x">', version: "1.0" });
    const files = readStoredZip(zip);
    expect([...files.keys()].sort()).toEqual(["config.xml", "index.html"]);
    expect(new TextDecoder().decode(files.get("index.html"))).toBe(html);
    const cfg = new TextDecoder().decode(files.get("config.xml"));
    expect(cfg).toContain('<content src="index.html"/>');
    expect(cfg).toContain('id="https://animapage.local/lesson/abc123"');
    expect(cfg).toContain("<name>A &amp; B &lt;&quot;x&quot;&gt;</name>");
    expect(cfg).toContain('width="1024" height="720"');
    // CRCs recorded in the central directory match zlib's.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const crcs: number[] = [];
    for (let i = 0; i + 4 < zip.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) crcs.push(view.getUint32(i + 16, true));
    }
    const expected = [...files.values()].map((b) => crc32(b)).sort();
    expect(crcs.sort()).toEqual(expected);
  });

  it("drops the control characters XML 1.0 forbids from config.xml, keeps tab and newlines", () => {
    const zip = buildWgt("<p></p>", { id: "a\u0000b", title: "Uno\u0001\u0008\u000B\u000C\u000E\u001FDue\tTre\nQuattro\r", version: "1.0\u0007" });
    const cfg = new TextDecoder().decode(readStoredZip(zip).get("config.xml"));
    expect(cfg).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    expect(cfg).toContain("<name>UnoDue\tTre\nQuattro\r</name>");
    expect(cfg).toContain('id="https://animapage.local/lesson/ab"');
    expect(cfg).toContain('version="1.0"');
  });

  it("rejects a zip that is not stored", () => {
    expect(() => readStoredZip(new Uint8Array(30))).toThrow();
  });
});
