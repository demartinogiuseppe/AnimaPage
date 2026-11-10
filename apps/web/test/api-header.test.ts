// @vitest-environment happy-dom
// docs/security.md (M1): the server refuses state-changing calls (and GET /api/i18n) without X-AnimaPage: 1.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTts } from "@pv/engine";
import { initI18n, setStoredLanguage } from "../src/i18n.ts";
import { confirmPhoto, type PhotoFlowUi } from "../src/photo.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setStoredLanguage(null);
});

describe("X-AnimaPage header", () => {
  it("is sent with the photo upload", async () => {
    const headers: [string, string][] = [];
    vi.spyOn(XMLHttpRequest.prototype, "setRequestHeader").mockImplementation((k, v) => void headers.push([k, v]));
    const send = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
    const app = document.createElement("div");
    document.body.append(app);
    const ui = { app, tts: new FakeTts(), el, photoButtons: () => el("div"), exportMenu: () => el("span"), showScene: vi.fn() } as unknown as PhotoFlowUi;
    confirmPhoto(new File([new Uint8Array([1])], "p.jpg", { type: "image/jpeg" }), ui, () => {});
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(headers).toContainEqual(["X-AnimaPage", "1"]);
  });

  it("is sent with the catalog request of a translated language", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 404 }));
    setStoredLanguage("ko");
    initI18n();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = fetch.mock.calls[0]![1];
    expect(new Headers(init?.headers).get("x-animapage")).toBe("1");
  });
});
