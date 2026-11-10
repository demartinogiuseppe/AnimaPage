// Open book drawn with CSS for the `card` engine (no 3D): text on both pages.
import { t } from "@pv/scene-spec/i18n";
import type { PageText } from "../book/page.ts";
import { h } from "./dom.ts";

/** Writes a formula into an element (Accademico: KaTeX); default plain text. */
type FormulaWriter = (el: HTMLElement, text: string) => void;

function page(p: PageText, side: "left" | "right", formula?: FormulaWriter): HTMLElement {
  const f = p.formula ? h("div", { class: "pv-b2-formula" }, p.formula) : null;
  if (f && p.formula) formula?.(f, p.formula);
  const lines = p.lines.map((l, i) => {
    const li = h("p", {}, l);
    if (i === p.lines.length - 1 && p.marks.length) li.append(h("sup", { class: "pv-bmark" }, p.marks.map((m) => `[${m}]`).join("")));
    return li;
  });
  return h(
    "div",
    { class: `pv-b2-page ${side}` },
    h("div", { class: "pv-b2-header" }, p.header),
    p.heading ? h("div", { class: "pv-b2-heading" }, p.heading) : null,
    f,
    ...lines,
    p.question ? h("div", { class: "pv-b2-question" }, h("b", {}, t("act.predict")), p.question) : null,
    h("div", { class: "pv-b2-folio" }, p.folio),
  );
}

export function renderBook2d(el: HTMLElement, left: PageText, right: PageText, formula?: FormulaWriter): void {
  el.replaceChildren(h("div", { class: "pv-b2-spread" }, page(left, "left", formula), page(right, "right", formula)));
}
