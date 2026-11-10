// Coordinates (Wikidata P625) of place names the offline gazetteer does not know. Live mode only.
//
// Verified 2026-11-03: https://www.wikidata.org/w/api.php?action=help&modules=wbgetentities
// (sites + titles, props=claims, normalize works with one site and one title) and
// https://www.wikidata.org/wiki/Wikidata:Data_access (send a User-Agent, few requests, maxlag,
// back off on 429). Data: CC0. One request per name, sequential, cached on disk.
import { wikiChain } from "../enrich/wikipedia.ts";
import { cachedText } from "./net.ts";
import { slug } from "./areas.ts";

const API = "https://www.wikidata.org/w/api.php";
/** At most this many names per page: a map extent needs only a few points. */
const MAX_NAMES = 8;

interface WbEntities {
  entities?: Record<string, { missing?: string; claims?: { P625?: { mainsnak?: { datavalue?: { value?: { latitude: number; longitude: number } } } }[] } }>;
}

/** Wikipedia sites tried for a place name: it.wikipedia, or for another user language its own, then en, then it (D21). */
export const geoSites = (locale?: string): string[] => wikiChain(locale).map((l) => `${l}wiki`);

/** Point of the Wikipedia article titled `name` (first site of geoSites that has it), if its Wikidata item has coordinates. */
export async function wikidataPoint(name: string, locale?: string): Promise<{ name: string; lon: number; lat: number } | undefined> {
  for (const site of geoSites(locale)) {
    const url = `${API}?${new URLSearchParams({ action: "wbgetentities", sites: site, titles: name, props: "claims", normalize: "1", format: "json", maxlag: "5" })}`;
    const json = JSON.parse(await cachedText(`wd-${site}-${slug(name)}.json`, url)) as WbEntities;
    for (const e of Object.values(json.entities ?? {})) {
      const v = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)) return { name, lon: v.longitude, lat: v.latitude };
    }
  }
  return undefined;
}

export async function geocodeNames(names: string[], locale?: string): Promise<{ name: string; lon: number; lat: number }[]> {
  const out: { name: string; lon: number; lat: number }[] = [];
  for (const name of names.slice(0, MAX_NAMES)) {
    try {
      const p = await wikidataPoint(name, locale);
      if (p) out.push(p);
    } catch (e) {
      console.warn(`geocode ${name}: ${(e as Error).message}`);
    }
  }
  return out;
}
