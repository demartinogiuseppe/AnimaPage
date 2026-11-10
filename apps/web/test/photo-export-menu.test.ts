// @vitest-environment happy-dom
// D22: the "Esporta" menu appears on the preview bar only once the complete lesson has arrived.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTts, type PlayerHandle } from "@pv/engine";
import type { SceneSpec } from "@pv/scene-spec";
import { confirmPhoto, type PhotoFlowUi } from "../src/photo.ts";

const PUBLIC = `${import.meta.dirname}/../../../fixtures/public/`;
// "campania" is left out of the public copy (tools/publish/exclude.txt): fall back to another map scene with terrain.
const { existsSync, readFileSync } = await import("node:fs");
// Sample map scene; both are left out of the public copy (tools/publish/exclude.txt), so the tests
// that need one skip when neither is present.
const SAMPLE = ["campania", "_dev-routes"].find((n) => existsSync(PUBLIC + `scenes/${n}.scene.json`));
const full = (SAMPLE ? JSON.parse(readFileSync(PUBLIC + `scenes/${SAMPLE}.scene.json`, "utf8")) : {}) as SceneSpec;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

class FakeEventSource {
  static CLOSED = 2;
  static last: FakeEventSource | undefined;
  readyState = 1;
  handlers: Record<string, (m: MessageEvent<string>) => void> = {};
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener(k: string, f: (m: MessageEvent<string>) => void) {
    this.handlers[k] = f;
  }
  close() {}
  emit(k: string, data: unknown) {
    this.handlers[k]!({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

let app: HTMLElement;
let bars: HTMLElement[];
let onContinue: (cid: string, tour: boolean) => void;
let sceneCalls: HTMLElement[];

const handle = (): PlayerHandle => ({ setFollowing: vi.fn(), go: vi.fn(), dispose: vi.fn() }) as unknown as PlayerHandle;
const ui = (): PhotoFlowUi => ({
  app,
  tts: new FakeTts(),
  el,
  photoButtons: () => el("div"),
  exportMenu: () => el("span", "export-menu"),
  showScene: async (_spec, bar, opts) => {
    if (opts?.following) onContinue = opts.following.onContinue;
    else sceneCalls.push(bar);
    bars.push(bar);
    return handle();
  },
});

beforeEach(() => {
  app = document.createElement("div");
  document.body.replaceChildren(app);
  bars = [];
  FakeEventSource.last = undefined;
  sceneCalls = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(function (this: XMLHttpRequest) {
    Object.defineProperty(this, "status", { value: 201 });
    Object.defineProperty(this, "responseText", { value: JSON.stringify({ id: "p1" }) });
    this.onload?.(new ProgressEvent("load"));
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(full)));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function previewReady(): Promise<FakeEventSource> {
  confirmPhoto(new File([new Uint8Array([1])], "p.jpg", { type: "image/jpeg" }), ui(), () => {});
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(FakeEventSource.last?.handlers.result).toBeDefined());
  const es = FakeEventSource.last!;
  es.emit("chapter", { scene: full });
  await vi.waitFor(() => expect(bars.length).toBe(1));
  return es;
}
const menus = (bar: HTMLElement) => bar.querySelectorAll(".export-menu").length;

describe.skipIf(!SAMPLE)("export menu on the D22 preview", () => {
  it("is absent before completion and appears exactly once when the lesson is complete", async () => {
    const es = await previewReady();
    await new Promise((r) => setTimeout(r, 10));
    expect(menus(bars[0]!)).toBe(0);
    es.emit("result", { status: "scene", summary: "s", fallback: false, cached: false, lessonId: "l1" });
    await vi.waitFor(() => expect(menus(bars[0]!)).toBe(1));
  });

  it("is never added when the rest of the lesson failed", async () => {
    const es = await previewReady();
    es.emit("result", { status: "error", message: "boom" });
    await new Promise((r) => setTimeout(r, 20));
    expect(menus(bars[0]!)).toBe(0);
  });

  it("is not carried into the bar of the swapped-in lesson (showScene adds its own)", async () => {
    const es = await previewReady();
    es.emit("result", { status: "scene", summary: "s", fallback: false, cached: false });
    await vi.waitFor(() => expect(menus(bars[0]!)).toBe(1));
    onContinue(full.chapters[1]!.id, false);
    await vi.waitFor(() => expect(sceneCalls.length).toBe(1));
    expect(menus(sceneCalls[0]!)).toBe(0);
  });
});
