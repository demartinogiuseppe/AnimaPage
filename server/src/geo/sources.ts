// Download URLs and citations of every geodata source. Verified 2026-11-03, see docs/data-sources.md.
import type { Source } from "../pipeline/types.ts";

/** ISTAT boundaries (1 Jan 2026 vintage) as GeoJSON, CC BY 4.0, from github.com/guglielmo/geojson-italy (formerly openpolis/geojson-italy). */
export const ISTAT_URL = (layer: "regions" | "provinces") =>
  `https://raw.githubusercontent.com/guglielmo/geojson-italy/main/geojson/limits_IT_${layer}.geojson`;

/** Natural Earth (public domain) GeoJSON mirror kept by its maintainer: github.com/nvkelso/natural-earth-vector (VERSION 5.2.0-pre). */
export const NE_URL = (layer: string) => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${layer}.geojson`;

const ACCESSED = "2026-11-03";

export type GeoSourceId = "data-terrain" | "data-istat" | "data-naturalearth" | "data-osm" | "data-wikidata";

export const GEO_SOURCES: Record<GeoSourceId, Source> = {
  "data-terrain": {
    id: "data-terrain",
    kind: "dataset",
    title: "Terrain Tiles (Terrarium): rilievo da EU-DEM (Copernicus), SRTM e GMTED2010 (USGS), ETOPO1 (NOAA)",
    url: "https://registry.opendata.aws/terrain-tiles/",
    publisher: "AWS Open Data / Tilezen",
    accessed: ACCESSED,
    license: "Attribuzione richiesta: vedi github.com/tilezen/joerd/blob/master/docs/attribution.md",
  },
  "data-istat": {
    id: "data-istat",
    kind: "dataset",
    title: "Confini amministrativi ISTAT (1 gennaio 2026) in GeoJSON",
    url: "https://github.com/guglielmo/geojson-italy",
    publisher: "ISTAT",
    accessed: ACCESSED,
    license: "CC BY 4.0",
  },
  "data-naturalearth": {
    id: "data-naturalearth",
    kind: "dataset",
    title: "Natural Earth: confini degli Stati, mari e fiumi",
    url: "https://www.naturalearthdata.com/about/terms-of-use/",
    publisher: "Natural Earth",
    accessed: ACCESSED,
    license: "Pubblico dominio",
  },
  "data-osm": {
    id: "data-osm",
    kind: "dataset",
    title: "Fiumi da OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    publisher: "© OpenStreetMap contributors",
    accessed: ACCESSED,
    license: "ODbL 1.0",
  },
  "data-wikidata": {
    id: "data-wikidata",
    kind: "wikidata",
    title: "Wikidata: coordinate dei luoghi (P625)",
    url: "https://www.wikidata.org/wiki/Property:P625",
    publisher: "Wikidata",
    accessed: ACCESSED,
    license: "CC0",
  },
};
