import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { startServer } from "../listen.ts";

const dir = mkdtempSync(join(tmpdir(), "sounds-listen-"));
mkdirSync(join(dir, "sea"));
writeFileSync(join(dir, "sea", "waves-1.ogg"), "ogg");
writeFileSync(join(dir, "sea.json"), JSON.stringify([{ group: "waves", file: "sea/waves-1.ogg", source: "s", author: "a", licence: "CC0", dur: 9, peakDb: -3, rmsDb: -22 }]));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("serves candidates on 127.0.0.1 and stores decisions", async () => {
  const server = await startServer(dir, 0);
  try {
    const { address, port } = server.address() as AddressInfo;
    expect(address).toBe("127.0.0.1");
    const base = `http://127.0.0.1:${port}`;
    expect(await (await fetch(`${base}/`)).text()).toContain("Tema successivo");
    const state = (await (await fetch(`${base}/api/state`)).json()) as { theme: string }[];
    expect(state[0]?.theme).toBe("sea");
    const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
      fetch(`${base}/api/decision`, { method: "POST", headers, body: JSON.stringify(body) });
    expect((await post({ theme: "sea", file: "sea/waves-1.ogg", decision: "keep" })).status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "sea.decisions.json"), "utf8"))).toEqual({ "sea/waves-1.ogg": "keep" });
    expect((await post({ theme: "sea", file: "../x.ogg", decision: "keep" })).status).toBe(400);
    expect((await fetch(`${base}/audio/sea/..%2Fx.ogg`)).status).toBe(404);
    const good = { theme: "sea", file: "sea/waves-1.ogg", decision: "discard" };
    expect((await post(good, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(good, { "content-type": "application/json", origin: "http://evil.test" })).status).toBe(403);
    expect((await post(good, { "content-type": "application/json", origin: base })).status).toBe(200);
    // a broken sheet is a 500, not a crash
    writeFileSync(join(dir, "sea.json"), "{not json");
    expect((await fetch(`${base}/api/state`)).status).toBe(500);
    expect((await fetch(`${base}/`)).status).toBe(200);
  } finally {
    server.close();
  }
});
