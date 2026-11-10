// Art resolver: offline replay of recorded Wikidata / Wikipedia / Commons responses (fixtures/art/http)
// and image bytes (fixtures/art/files). The public-domain gate must never download a protected work.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Source } from "@pv/scene-spec";
import { describe, expect, it } from "vitest";
import { commonsIsPublicDomain, currentPlace, parsePct, resolveArtwork, type ResolveOptions } from "../src/art/resolve.ts";
import { HttpClient, HttpError } from "../src/enrich/http.ts";

const FIXTURES = fileURLToPath(new URL("../../fixtures/art/", import.meta.url));
const UA = "animapage/0.1 (test)";

function options(over: Partial<ResolveOptions> = {}): ResolveOptions & { cacheDir: string } {
  const http = new HttpClient({ mode: "mock", fixturesDir: join(FIXTURES, "http"), userAgent: UA, requestsPerMinute: 9, cacheTtlDays: 30 });
  const cacheDir = mkdtempSync(join(tmpdir(), "pv-art-"));
  // The fixtures were recorded with maxSize 960 (the size is part of the Commons request).
  return { mode: "mock", http, userAgent: UA, filesDir: join(FIXTURES, "files"), cacheDir, maxSize: 960, ...over };
}

describe("resolveArtwork (mock replay)", () => {
  it("resolves the Last Supper by Italian Wikipedia title and stores a resized public-domain copy", async () => {
    const o = options();
    const r = await resolveArtwork({ title: "Ultima Cena (Leonardo)" }, o);
    expect(r.wikidataId).toBe("Q128910");
    expect(r.author).toBe("Leonardo da Vinci");
    expect(r.date).toBe("1494-1498");
    expect(r.location).toBe("chiesa di Santa Maria delle Grazie");
    expect(r.publicDomain).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.image?.asset).toMatch(/^\/cache\/art\/Q128910\/[a-z0-9.-]+\.jpg$/);
    expect(Math.max(r.image!.width, r.image!.height)).toBeLessThanOrEqual(960);
    const file = join(o.cacheDir, "Q128910", r.image!.asset.split("/").pop()!);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG
    for (const s of r.sources) expect(Source.safeParse(s).success).toBe(true);
    const commons = r.sources.find((s) => s.id === r.image!.sourceId)!;
    expect(commons.license).toBe("Public domain");
    expect(commons.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    // Wikidata depicts + relative position (P180 / P2677): the 13 figures
    expect(r.regions).toHaveLength(13);
    const jesus = r.regions.find((x) => x.wikidataId === "Q302")!;
    expect(jesus.rect[0]).toBeCloseTo(0.429375, 6);
  });

  it("public-domain gate: a protected work is never downloaded", async () => {
    const calls: string[] = [];
    const o = options({
      mode: "live", // bytes would come from the network: the gate must stop before
      fetchBytes: async (url) => {
        calls.push(url);
        throw new Error("must not download");
      },
    });
    const r = await resolveArtwork({ title: "Guernica (Picasso)" }, o);
    expect(r.wikidataId).toBe("Q175036");
    expect(r.publicDomain).toBe(false);
    expect(r.location).toBe("Museo Nacional Centro de Arte Reina Sofía");
    expect(r.image).toBeUndefined();
    expect(r.reasons.join(" ")).toMatch(/copyright status/);
    expect(r.link).toBe("https://www.wikidata.org/wiki/Q175036");
    expect(calls).toEqual([]);
    expect(readdirSync(o.cacheDir)).toEqual([]);
  });

  it("downloads exactly once for a public-domain work in live mode", async () => {
    const bytes = readFileSync(join(FIXTURES, "files", readdirSync(join(FIXTURES, "files"))[0]!));
    const calls: string[] = [];
    const o = options({
      mode: "live",
      fetchBytes: async (url) => {
        calls.push(url);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    });
    const r = await resolveArtwork({ wikidataId: "Q128910" }, o);
    expect(r.publicDomain).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^https:\/\/(upload|thumb)\.wikimedia\.org\//);
  });

  it("mock mode never touches the network: a missing recording is an error", async () => {
    await expect(resolveArtwork({ title: "Una pagina che non esiste" }, options())).rejects.toBeInstanceOf(HttpError);
  });
});

describe("resolver helpers", () => {
  it("currentPlace keeps only the current collection", () => {
    const item = (id: string) => ({ value: { id } });
    const year = (y: number) => [{ datavalue: { value: { time: `+${y}-00-00T00:00:00Z`, precision: 9 } } }];
    const claim = (id: string, q: Record<string, unknown> = {}, rank = "normal") => ({ rank, mainsnak: { datavalue: item(id) }, qualifiers: q });
    const labels = new Map([["Q1", "Palazzo Medici Riccardi"], ["Q2", "Galleria degli Uffizi"], ["Q3", "Villa di Castello"]]);
    const e = { claims: { P195: [claim("Q1", { P580: year(1499), P582: year(1503) }), claim("Q3", { P580: year(1550), P582: year(1815) }), claim("Q2", { P580: year(1919) })] } };
    expect(currentPlace(e, "P195", labels)).toBe("Galleria degli Uffizi");
    expect(currentPlace({ claims: { P195: [claim("Q1", { P582: year(1503) })] } }, "P195", labels)).toBeUndefined();
    expect(currentPlace({ claims: { P276: [claim("Q3"), claim("Q2", {}, "preferred")] } }, "P276", labels)).toBe("Galleria degli Uffizi");
  });

  it("parses P2677 relative positions", () => {
    expect(parsePct("pct:42.9375,42.6207,16.0253,27.4268")).toEqual([0.429375, 0.426207, 0.160253, 0.274268]);
    expect(parsePct("pct:10,10,0,5")).toBeNull();
    expect(parsePct("xywh=1,2,3,4")).toBeNull();
  });

  it("reads the Commons licence metadata conservatively", () => {
    const v = (value: string) => ({ value });
    expect(commonsIsPublicDomain({ Copyrighted: v("False") })).toBe(true);
    expect(commonsIsPublicDomain({ License: v("pd"), LicenseShortName: v("Public domain") })).toBe(true);
    expect(commonsIsPublicDomain({ License: v("cc0"), LicenseShortName: v("CC0") })).toBe(true);
    expect(commonsIsPublicDomain({ License: v("cc-by-sa-4.0"), LicenseShortName: v("CC BY-SA 4.0"), Copyrighted: v("True") })).toBe(false);
    expect(commonsIsPublicDomain({})).toBe(false);
  });
});
