// Facts and Source objects from the chosen Wikipedia articles and Wikidata items.
import type { Source } from "@pv/scene-spec";
import type { Fact } from "../pipeline/types.ts";
import type { Lookup } from "./select.ts";
import { formatNumberIt, leadSentences, slug } from "./text.ts";
import { WIKIDATA_LICENSE, PROPERTIES, formatTimeIt, type PropertyId, type WdItem, type WdValue } from "./wikidata.ts";
import { WIKIPEDIA_LICENSE, leadNumbers, type WpArticle } from "./wikipedia.ts";

export interface Resolved {
  lookup: Lookup;
  article: WpArticle;
  item?: WdItem;
}

export const day = (iso: string): string => iso.slice(0, 10);

export function wikipediaSource(a: WpArticle): Source {
  return {
    id: `wp-${slug(a.title)}`,
    kind: "wikipedia",
    title: `Wikipedia: ${a.title}`,
    url: a.url,
    publisher: `Wikipedia (${a.lang ?? "it"})`,
    accessed: day(a.fetchedAt),
    ...(a.wikibaseItem ? { wikidataId: a.wikibaseItem } : {}),
    license: WIKIPEDIA_LICENSE,
  };
}

export function wikidataSource(item: WdItem, fetchedAt: string): Source {
  return {
    id: `wd-${item.id}`,
    kind: "wikidata",
    title: `Wikidata: ${item.label ?? item.labelIt ?? item.labelEn ?? item.id} (${item.id})`,
    url: `https://www.wikidata.org/wiki/${item.id}`,
    publisher: "Wikidata",
    accessed: day(fetchedAt),
    wikidataId: item.id,
    license: WIKIDATA_LICENSE,
  };
}

/** Wikidata properties worth showing for each kind of entity. */
const BY_TYPE: Record<Lookup["type"], PropertyId[]> = {
  topic: ["P1082", "P2046", "P2044", "P2043", "P625", "P585", "P580", "P582", "P571", "P577", "P569", "P570"],
  place: ["P1082", "P2046", "P2044", "P2043", "P625"],
  person: ["P569", "P570"],
  event: ["P585", "P580", "P582"],
  group: ["P571"],
  object: ["P571", "P577"],
  term: ["P571", "P577"],
  quantity: [],
  date: [],
};

type Draft = Omit<Fact, "id">;

function coordText(lat: number, lon: number): string {
  const f = (v: number): string => formatNumberIt(Math.round(Math.abs(v) * 1000) / 1000);
  return `${f(lat)}° ${lat >= 0 ? "N" : "S"}, ${f(lon)}° ${lon >= 0 ? "E" : "O"}`;
}

export function wikidataFact(entity: string, label: string, p: PropertyId, v: WdValue, sourceId: string, qid: string): Draft | undefined {
  const base = { entity, wikidataId: qid, property: p, sourceId };
  if (v.kind === "coord") {
    return { ...base, text: `${label}: coordinate ${coordText(v.lat, v.lon)}.`, value: `${v.lat},${v.lon}`, unit: "lat,lon" };
  }
  if (v.kind === "time") {
    const date = formatTimeIt(v.time);
    return { ...base, text: `${label}: ${PROPERTIES[p]} ${date}${date.endsWith(".") ? "" : "."}`, value: v.time.year, unit: "anno" };
  }
  const n = formatNumberIt(v.amount);
  switch (p) {
    case "P1082":
      return {
        ...base,
        text: `${label}: ${n} abitanti${v.pointInTime ? ` (dato ${v.pointInTime.year})` : ""}.`,
        value: v.amount,
        unit: "abitanti",
      };
    case "P2046":
    case "P2044":
    case "P2043":
      if (!v.unit) return undefined;
      return { ...base, text: `${label}: ${PROPERTIES[p]} ${n} ${v.unit}.`, value: v.amount, unit: v.unit };
    default:
      return undefined;
  }
}

/** Facts for one resolved entity, most useful first. */
export function factsFor(r: Resolved, wdFetchedAt: string | undefined): { facts: Draft[]; sources: Source[] } {
  const wp = wikipediaSource(r.article);
  const sources: Source[] = [wp];
  // Non-Italian lessons (D21): the label in the user's language; the fact templates stay Italian and the
  // generator writes them in the lesson's language.
  const label = r.item?.label ?? r.item?.labelIt ?? r.article.title.replace(/\s*\([^)]*\)$/, "");
  const facts: Draft[] = [];
  const lead = leadSentences(r.article.extract);
  if (lead) facts.push({ text: lead, entity: r.lookup.name, sourceId: wp.id, ...(r.item ? { wikidataId: r.item.id } : {}) });

  // Population stated in the Wikipedia lead: usually more recent than Wikidata's P1082.
  const leadPop = leadNumbers(r.article.extract).population;
  const wantsPop = BY_TYPE[r.lookup.type].includes("P1082");
  if (wantsPop && leadPop !== undefined) {
    facts.push({
      text: `${label}: ${formatNumberIt(leadPop)} abitanti (secondo Wikipedia).`,
      entity: r.lookup.name,
      value: leadPop,
      unit: "abitanti",
      property: "P1082",
      sourceId: wp.id,
      ...(r.item ? { wikidataId: r.item.id } : {}),
    });
  }

  if (r.item && wdFetchedAt) {
    const wd = wikidataSource(r.item, wdFetchedAt);
    let used = false;
    const dates = new Set<string>();
    for (const p of BY_TYPE[r.lookup.type]) {
      if (p === "P1082" && leadPop !== undefined) continue;
      // Elevation of a town or region is a reference point (town hall, centroid), not a height.
      if (p === "P2044" && (r.item.values.P1082 || r.item.values.P2046 || leadPop !== undefined)) continue;
      const v = r.item.values[p];
      if (!v) continue;
      // "data 24 agosto 410" and "inizio 24 agosto 410": keep the first only.
      if (v.kind === "time") {
        const k = formatTimeIt(v.time);
        if (dates.has(k)) continue;
        dates.add(k);
      }
      const f = wikidataFact(r.lookup.name, label, p, v, wd.id, r.item.id);
      if (f) {
        facts.push(f);
        used = true;
      }
    }
    if (used) sources.push(wd);
  }
  return { facts, sources };
}
