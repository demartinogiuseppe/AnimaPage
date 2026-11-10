// @vitest-environment happy-dom
// The home page says, next to the photo buttons, where the photo goes (README, "Legal and privacy").
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@pv/scene-spec/i18n";

afterEach(() => vi.restoreAllMocks());

describe("home privacy note", () => {
  it("is rendered with the photo buttons", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    // Lessons, examples and catalogs are not needed here: every request fails quietly.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
    await import("../src/main.ts");
    const note = document.querySelector(".photo-actions .photo-privacy");
    expect(note?.textContent).toBe(t("photo.privacy"));
    expect(note?.textContent).not.toBe("photo.privacy");
  });
});
