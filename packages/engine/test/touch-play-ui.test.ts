// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { TouchPlayView } from "../src/types.ts";
import { MarkLayer, TouchPlayPanel } from "../src/player/touch-play-ui.ts";

const letter: TouchPlayView = { kind: "letter", prompt: "Tocca le cose che iniziano con la B.", letter: "B", progress: { done: 1, total: 3 }, stamp: "Cercatore di B", complete: false };
const colour: TouchPlayView = { kind: "color", prompt: "Scegli un colore.", palette: ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7"], picked: 4, progress: { done: 1, total: 2 }, stamp: "Pittore", complete: false };

function panel(reducedMotion = false) {
  const chosen: number[] = [];
  const p = new TouchPlayPanel({ choose: (k) => chosen.push(k), reducedMotion });
  return { p, chosen };
}

describe("the touch activity panel", () => {
  it("renders prompt, big letter and progress dots", () => {
    const { p } = panel();
    p.render(letter);
    expect(p.el.hidden).toBe(false);
    expect(p.el.textContent).toContain("Tocca le cose che iniziano con la B.");
    expect(p.el.querySelector(".pv-play-letter")?.textContent).toBe("B");
    const dots = [...p.el.querySelectorAll(".pv-play-dot")];
    expect(dots).toHaveLength(3);
    expect(dots.filter((d) => d.classList.contains("on"))).toHaveLength(1);
    expect(p.el.querySelector(".pv-play-palette")).toBeNull();
    expect(p.el.querySelector(".pv-stamp")).toBeNull();
  });

  it("renders the palette as six big swatches, the picked one pressed, and reports the choice", () => {
    const { p, chosen } = panel();
    p.render(colour);
    const sw = [...p.el.querySelectorAll<HTMLButtonElement>(".pv-play-swatch")];
    expect(sw).toHaveLength(6);
    expect(sw[4]!.getAttribute("aria-pressed")).toBe("true");
    expect(sw[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(sw[2]!.style.background).toBeTruthy();
    expect(sw.every((b) => b.getAttribute("aria-label"))).toBe(true);
    sw[2]!.click();
    expect(chosen).toEqual([2]);
  });

  it("shows the stamp on completion, without the palette; static when motion is reduced", () => {
    const { p } = panel();
    p.render({ ...colour, progress: { done: 2, total: 2 }, complete: true });
    expect(p.el.querySelector(".pv-stamp")?.textContent).toContain("Pittore");
    expect(p.el.querySelector(".pv-stamp")?.classList.contains("landing")).toBe(true);
    expect(p.el.querySelector(".pv-play-palette")).toBeNull();
    const calm = panel(true);
    calm.p.render({ ...colour, progress: { done: 2, total: 2 }, complete: true });
    expect(calm.p.el.querySelector(".pv-stamp")?.classList.contains("landing")).toBe(false);
  });

  it("redraws in place: the same view draws nothing, and the focused swatch keeps focus after a choice", () => {
    const { p } = panel();
    document.body.append(p.el);
    p.render(colour);
    const first = p.el.querySelector(".pv-play-swatch");
    p.render(colour);
    expect(p.el.querySelector(".pv-play-swatch")).toBe(first);
    (p.el.querySelectorAll<HTMLButtonElement>(".pv-play-swatch")[2])!.focus();
    p.render({ ...colour, picked: 2 });
    const sw = p.el.querySelectorAll<HTMLButtonElement>(".pv-play-swatch");
    expect(document.activeElement).toBe(sw[2]);
    expect(sw[2]!.getAttribute("aria-pressed")).toBe("true");
    p.el.remove();
  });

  it("an extra touch after completion does not replay the stamp landing", () => {
    const { p } = panel();
    const done = { ...colour, progress: { done: 2, total: 2 }, complete: true };
    p.render(done);
    const stamp = p.el.querySelector(".pv-stamp");
    p.render(done);
    expect(p.el.querySelector(".pv-stamp")).toBe(stamp);
  });

  it("is hidden without a view", () => {
    const { p } = panel();
    p.render(letter);
    p.render(null);
    expect(p.el.hidden).toBe(true);
  });
});

describe("the badges over the characters", () => {
  it("shows one badge per mark, follows the projection and hides what cannot be placed", () => {
    const layer = new MarkLayer(false);
    layer.set([{ id: "a", text: "1" }, { id: "b", text: "★" }]);
    expect(layer.el.children).toHaveLength(2);
    layer.update((id, out) => (id === "a" ? (out.set(0, 0, 0), true) : false), (v) => v.set(0.5, 0.5, 0.2), 200, 100);
    const [a, b] = [...layer.el.children] as HTMLElement[];
    expect(a!.hidden).toBe(false);
    expect(a!.style.transform).toContain("150px");
    expect(b!.hidden).toBe(true);
    layer.set([]);
    expect(layer.el.children).toHaveLength(0);
  });
});
