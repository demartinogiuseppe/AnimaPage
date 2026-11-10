// Tiny DOM helper: no innerHTML with data, so spec text can never inject markup.

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Static inline SVG icons (constant markup, never data). */
const ICONS = {
  play: "M4 2.5v11l9-5.5z",
  pause: "M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z",
  prev: "M13 2.5v11L5 8zM2.5 2.5h2v11h-2z",
  next: "M3 2.5v11L11 8zM11.5 2.5h2v11h-2z",
} as const;

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}
