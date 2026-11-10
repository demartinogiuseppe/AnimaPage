// @vitest-environment happy-dom
// The chosen photo is shown for confirmation before anything is sent (camera, gallery, paste).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTts } from "@pv/engine";
import { confirmPhoto, type PhotoFlowUi } from "../src/photo.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let app: HTMLElement;
let opened: string[];
let revoked: string[];
let sent: number;
let n = 0;

beforeEach(() => {
  app = document.createElement("div");
  document.body.replaceChildren(app);
  opened = [];
  revoked = [];
  sent = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const u = `blob:test/${++n}`;
    opened.push(u);
    return u;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => void revoked.push(u));
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => void sent++);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
});
afterEach(() => vi.restoreAllMocks());

const ui = (): PhotoFlowUi => ({
  app,
  tts: new FakeTts(),
  el,
  photoButtons: () => el("div"),
  exportMenu: () => el("span", "export-menu"),
  showScene: async () => {
    throw new Error("not in this test");
  },
});
const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "pagina.jpg", { type: "image/jpeg" });
const button = (text: string) => [...app.querySelectorAll("button")].find((b) => b.textContent === text)!;
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("photo confirmation", () => {
  it("shows the photo with 'Crea la lezione' and 'Cambia foto', and sends nothing yet", () => {
    confirmPhoto(photo(), ui(), () => {});
    expect(app.querySelector<HTMLImageElement>("img.photo-preview")!.getAttribute("src")).toBe(opened[0]);
    expect(button("Crea la lezione")).toBeDefined();
    expect(button("Cambia foto")).toBeDefined();
    expect(sent).toBe(0);
  });

  it("says the photo goes to the AI service and is not stored", () => {
    confirmPhoto(photo(), ui(), () => {});
    expect(app.querySelector(".photo-privacy")?.textContent).toBe(
      "La foto viene inviata al servizio AI configurato per creare la lezione e non viene salvata.",
    );
  });

  it("'Cambia foto' and Esc go back and release the image", () => {
    const back = vi.fn();
    confirmPhoto(photo(), ui(), back);
    button("Cambia foto").click();
    expect(back).toHaveBeenCalledTimes(1);
    expect(revoked).toContain(opened[0]);
    confirmPhoto(photo(), ui(), back);
    key("Escape");
    expect(back).toHaveBeenCalledTimes(2);
    expect(revoked).toContain(opened[1]);
    key("Enter"); // the listener is gone with the screen
    expect(sent).toBe(0);
  });

  it("'Crea la lezione' (or Enter) starts the upload with the language", async () => {
    const append = vi.spyOn(FormData.prototype, "append");
    confirmPhoto(photo(), ui(), () => {});
    key("Enter");
    expect(revoked).toContain(opened[0]);
    expect(app.querySelector(".flow-title")!.textContent).toBe("Sto preparando la lezione");
    await vi.waitFor(() => expect(sent).toBe(1));
    expect(append.mock.calls.map((c) => c[0])).toContain("locale");
  });
});
