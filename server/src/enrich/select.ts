// Which page entities are worth looking up, and which page numbers can be cross-checked.
import type { PageAnalysis, PageEntity } from "@pv/scene-spec";
import { countMentions, fold, tokens } from "./text.ts";

export interface Lookup {
  /** Name as on the page (the Fact.entity value). */
  name: string;
  type: PageEntity["type"] | "topic";
  /** Page value attached to this entity, e.g. "1899" for "M. Cervati". */
  value?: string;
  isTopic: boolean;
  score: number;
  /** Mentions in the page text (summary, concepts, claims, labels). */
  mentions: number;
  /** Text for a full-text search, when different from the name (the whole topic). */
  query?: string;
}

const LOOKUP_TYPES = new Set<PageEntity["type"]>(["place", "person", "group", "event", "object", "term"]);

/** "Il modo indicativo" -> "modo indicativo"; "I sensi: la vista, ..." -> "sensi". */
export function cleanTopic(topic: string): string {
  const head = topic.split(/[:;,(–—-]/)[0] ?? topic;
  return head.replace(/^\s*(il|lo|la|i|gli|le|l'|un|una|uno)\s*(?=\S)/i, "").replace(/^l'/i, "").trim();
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const same = (a: string, b: string): boolean => fold(a).trim() === fold(b).trim();

/** Common abbreviations in book maps/labels, expanded for title lookups. */
export function expandName(name: string): string {
  return name.replace(/^M\.\s*/, "Monte ").replace(/^F\.\s*/, "Fiume ").replace(/^L\.\s*/, "Lago ").trim();
}

export function selectLookups(a: PageAnalysis, max: number): Lookup[] {
  const context = [a.topic, a.summary, ...a.concepts, ...a.claims.map((c) => c.text), ...a.illustrations.flatMap((i) => i.labels)].join("\n");
  const topic = cleanTopic(a.topic);
  const seen = new Set<string>();
  const out: Lookup[] = [];
  const push = (l: Lookup): void => {
    const k = fold(l.name).trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(l);
  };

  if (a.literary.isLiterary) {
    // Fiction: never look up characters or story places; only the author and the work.
    if (a.literary.author) push({ name: a.literary.author, type: "person", isTopic: false, score: 100, mentions: 1 });
    if (a.literary.work) push({ name: a.literary.work, type: "object", isTopic: true, score: 99, mentions: 1 });
    return out.slice(0, max);
  }

  const candidates = a.entities.filter((e) => LOOKUP_TYPES.has(e.type));
  const startsWith = (e: PageEntity): boolean => new RegExp(`^${escapeRe(fold(e.name))}(?![a-z])`).test(fold(topic));
  const topicEntity =
    candidates.find((e) => same(e.name, topic) || same(e.name, a.topic)) ?? candidates.find((e) => e.type !== "term" && startsWith(e));
  // "I sensi: la vista, il tatto, l'udito": the title lookup uses "sensi", the search all the words.
  const query = tokens(a.topic).join(" ");
  if (!topicEntity && topic) push({ name: topic, type: "topic", isTopic: true, score: 1000, mentions: 1000, query });

  const scored = candidates.map((e, i) => ({
    e,
    i,
    mentions: countMentions(context, e.name) + (e === topicEntity ? 1000 : 0),
    score:
      countMentions(context, e.name) +
      (e.value ? 5 : 0) + // page numbers are cross-checked
      (e === topicEntity ? 1000 : 0) +
      (e.type === "event" || e.type === "person" ? 1 : 0),
  }));
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  for (const { e, score, mentions } of scored) {
    push({ name: e.name, type: e.type, value: e.value, isTopic: e === topicEntity, score, mentions });
  }
  return out.slice(0, max);
}

/** Kind of quantity a page value is about, from the entity name/type. */
export type QuantityKind = "population" | "area" | "elevation" | "length" | "year";

export function quantityKind(e: Pick<PageEntity, "name" | "type" | "value">): QuantityKind | undefined {
  const n = fold(e.name);
  if (e.type === "event" || e.type === "date") return /\d/.test(e.value ?? "") ? "year" : undefined;
  if (/abitant|popolazion|residenti/.test(n)) return "population";
  if (/superficie|estensione/.test(n)) return "area";
  if (/lunghezza/.test(n)) return "length";
  if (/altitudine|altezza|quota/.test(n)) return "elevation";
  if (e.type === "place" && /^\s*\d[\d.\s]*(m|metri)?\s*$/.test(e.value ?? "")) return "elevation";
  return undefined;
}

export interface BookQuantity {
  /** Entity the quantity belongs to: the place itself, or the topic for "Abitanti", "Superficie". */
  owner: string;
  kind: QuantityKind;
  /** Name and value as written on the page. */
  name: string;
  value: string;
}

/** Page numbers that can be compared with the sources. */
export function bookQuantities(a: PageAnalysis, topicLookup: string | undefined): BookQuantity[] {
  const out: BookQuantity[] = [];
  if (a.literary.isLiterary) return out; // numbers in fiction are not facts
  for (const e of a.entities) {
    if (!e.value) continue;
    const kind = quantityKind(e);
    if (!kind) continue;
    const owner = e.type === "quantity" ? topicLookup : e.name;
    if (owner) out.push({ owner, kind, name: e.name, value: e.value });
  }
  return out;
}
