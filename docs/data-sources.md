# Data sources

Geodata and facts used by the `map` engine and `fixtures/public/scenes/campania.scene.json`. Everything was checked on **2026-11-03**.

## Geodata for any area (`server/src/geo`, M3/M4)

`geoContextFor(analysis, { mode })` picks the area of a page and returns asset paths:

1. **Area choice** (`areas.ts`, offline, same result in mock and live): place entities + labels of the book's own maps (`illustrations[kind=map].labels`) are looked up in the gazetteer. Topic = a region/province/country/admin-1 → that area is the *focus* (bbox of the focus only). Otherwise the bbox is the union of the "hard" places (countries, regions, seas, cities); continents and oceans ("Africa", "Oceano Atlantico") only count when nothing else is known. Historical/school names go through a small hand-written alias table (`Gallia`→Francia, `Costantinopoli`→Istanbul, `Italia settentrionale`→8 regions…): it only sets the extent, never shown as a fact. No map for unreadable pages, stories/poems, or pages with no places (gate in `wantsMap`). Margin 6 %, aspect 0.75–2, edges rounded (1° / 0.25° / 0.05°).
2. **Key** = focus slug (`campania`, `francia`) or `area_<lonMin>_<latMin>_<lonMax>_<latMax>` (`m` = minus). Mock: reads `fixtures/public/geo/<key>/context.json`, paths `/geo/<key>/…`; no pre-built folder → `undefined`. Live: builds once into `server/.cache/geo/<key>/` (served at `/cache/geo/`), paths `/cache/geo/<key>/…`.
3. **Terrain**: Terrarium zoom = ceil(log2(grid × 4 × 360 / (256 × lon span))) ≤ 12, lowered until ≤ 64 tiles (Campania z10, Europe z5). Grid long side 256 nodes (< 600 km) or 384.
4. **Boundaries**: Italian region focus → ISTAT regions; province → ISTAT provinces; country → Natural Earth admin-0 (10m if span < 20°, else 50m); foreign admin-1 → NE admin-1 of that country. Foreign land in an Italian bbox comes from NE 10m countries (Italy excluded). Without a focus (continents, history maps) all countries are drawn in relief and the shared borders are written as `kind: "border"` lines (edges used by two NE polygons, chained, simplified) that the engine draws faint. Neighbours = features touching the focus (vertex within max(0.01°, 5 × tolerance) of their edges).
5. **Rivers**: preset list (Campania); span < 3° → OSM, one Overpass query `rel["waterway"="river"]["name"](bbox);out geom(bbox);`, 8 longest; else NE river centrelines (10m / 50m, English names, ids = slug of `name_en`), 25 longest in the bbox.
6. **Geocoding** (`geocode.ts`, live only, only when the gazetteer knows none of the page's places): Wikidata `wbgetentities&sites=itwiki&titles=<name>&props=claims&normalize=1&maxlag=5` → P625. One request per name, max 8, sequential, cached.

Commands (network, downloads cached in `<os tmpdir>/pagina-viva-geo-cache/`, generic User-Agent `animapage/0.1 (private educational prototype)`):
- `npx tsx server/src/geo/gazetteer.ts` → `server/src/geo/data/gazetteer.json` (7 663 names, ~600 kB).
- `npx tsx server/src/geo/build.ts campania` (preset) or `--analysis fixtures/llm/<file>.json` → `fixtures/public/geo/<key>/` (`--out <dir>` to write elsewhere).

Pre-built for mock mode (2026-11-03): `campania/` (rebuilt: byte-identical to the hand-made files, plus `context.json`) and `area_m14_19_58_64/` (Germani page: lon −14…58, lat 19…64, Terrarium z5, 384 × 321 grid, 79 NE 50m countries + borders, 25 NE 50m rivers).

| Data | URL used | Licence |
|---|---|---|
| Natural Earth `ne_10m_admin_0_countries`, `ne_50m_admin_0_countries`, `ne_10m_admin_1_states_provinces` (40 MB, live only for admin-1 builds), `ne_10m_geography_regions_polys`, `ne_10m_geography_marine_polys`, `ne_50m_lakes`, `ne_10m_populated_places_simple` (scalerank ≤ 4), `ne_10m_rivers_lake_centerlines`, `ne_50m_rivers_lake_centerlines` | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/<layer>.geojson` (maintainer's repo, `VERSION` = 5.2.0-pre) | **Public domain**. https://www.naturalearthdata.com/about/terms-of-use/: "All versions of Natural Earth raster + vector map data found on this website are in the public domain"; "Crediting the authors is unnecessary" (we credit anyway: source `data-naturalearth`). |
| ISTAT provinces (gazetteer, province focus) | `https://raw.githubusercontent.com/guglielmo/geojson-italy/main/geojson/limits_IT_provinces.geojson` | CC BY 4.0, © ISTAT |
| Wikidata coordinates (P625) | `https://www.wikidata.org/w/api.php` (parameters from `?action=help&modules=wbgetentities`) | CC0. Policy: https://www.wikidata.org/wiki/Wikidata:Data_access (User-Agent, few requests, `maxlag`, back off on 429) |

GeoContext `sources` ids (`server/src/geo/sources.ts`): `data-terrain`, `data-istat`, `data-naturalearth`, `data-osm`, `data-wikidata` (only if geocoded).

## Campania assets (hand-made preset, built by `server/src/geo/build.ts campania`)

Run once with network: `npx tsx server/src/geo/build.ts campania`. Outputs in `fixtures/public/geo/campania/`. After that the app and the tests need no network. Downloads are cached in `<os tmpdir>/pagina-viva-geo-cache/`.

| Output | Source | URL used | License / attribution |
|---|---|---|---|
| `terrain.json` + `terrain.bin` (Int16 LE metres, 256 × 255 nodes, bbox lon 13.65–15.90, lat 39.90–41.60, row 0 = north) | Terrain Tiles, Terrarium encoding, zoom 10, bilinear resampling | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Registry: https://registry.opendata.aws/terrain-tiles/ (no key). Required attribution (https://github.com/tilezen/joerd/blob/master/docs/attribution.md): "Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers"; "SRTM and GMTED2010 … courtesy of the U.S. Geological Survey"; "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration" |
| `regions.geojson` (Lazio, Campania, Molise, Puglia, Basilicata, Calabria; clipped to the bbox, Douglas–Peucker 0.002°) | ISTAT administrative boundaries, 1 January 2026 vintage, as GeoJSON | `https://raw.githubusercontent.com/guglielmo/geojson-italy/main/geojson/limits_IT_regions.geojson` (repo formerly `openpolis/geojson-italy`) | **CC BY 4.0**, © ISTAT. README: "The administrative limits are copyrighted by ISTAT and released under CC-BY … Keep the ISTAT attribution when redistributing." |
| `rivers.geojson` (Volturno, Sele, Calore Irpino, Garigliano; merged, clipped, simplified 0.0015°) | OpenStreetMap via Overpass API: relations 2570012 (Volturno), 2569984 (Sele), 2570005 (Calore Irpino), main-stream members only; Garigliano = ways `waterway=river` + `name=Garigliano` | `https://overpass-api.de/api/interpreter`, fallback `https://ovp.dresel.systems/api/interpreter` | **ODbL 1.0**, "© OpenStreetMap contributors" (https://www.openstreetmap.org/copyright). The derived file is itself under ODbL (share-alike). |

Verified details:
- Terrarium URL template, 256 px tiles, zooms 0–15: `docs/use-service.md` in tilezen/joerd. Decoding: `(red * 256 + green + blue / 256) - 32768` metres (`docs/formats.md`).
- Overpass: endpoints and usage policy (identify with User-Agent, pause 30 s after an error, no parallel scripts) from https://wiki.openstreetmap.org/wiki/Overpass_API. QL syntax (`[out:json][timeout:…]`, `rel(id)`, `way(r)`, bbox order south,west,north,east, `out geom`) from https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL. The main instance answered 502 ("at capacity") several times: the script retries after 30 s and alternates with the Europe instance.
- Natural Earth (public domain) was checked first for rivers: `ne_10m_rivers_europe` has only the Volturno, so OSM was used.

Known limits of the data:
- A ~750 m grid smooths summits: in the DEM grid the Vesuvio is ~1200 m (real 1281), Monte Cervati ~1840 m (1899), Monte Miletto ~1930 m (2050). Peak pins sit on the DEM's local maximum. The scene's disclaimers say this.
- Land/sea comes from the boundary polygons. For Campania all land in the bbox is Italian (ISTAT); other Italian areas add Natural Earth 10m countries for foreign land.
- Natural Earth river names are English (`Danube`, `Rhine`); Euphrates appears twice (`euphrates`, `firat`). Country names are Natural Earth's `NAME_IT`.
- Europe at ~14 km per grid node: relief is very smoothed; country borders are modern, only a reference for history maps (say so in the disclaimers).
- The "Tipo di territorio" classes use 150 m / 700 m thresholds on the DEM (prototype values). On the real DEM Campania comes out about 27 % / 52 % / 21 %, not the book's 15 / 51 / 34 (ISTAT zones are per comune). The legend shows the book's percentages with "Percentuali dal libro".

## Facts in the Campania scene

Numbers on the book page (`sourceId: "page"`): four bordering regions; 51 % collina, 34 % montagna, 15 % pianura; 13.668 km², 5.590.076 abitanti, 409 ab./km²; "seconda regione più densamente popolata"; Monte Miletto 2050, Monte Cervati 1899, Vesuvio 1281; cinque isole, principali Ischia, Procida, Capri.

Every other fact was read from it.wikipedia.org through the MediaWiki API (`https://it.wikipedia.org/w/api.php?action=query&prop=extracts|pageprops|info&explaintext=1&redirects=1&format=json&formatversion=2&titles=…`; `prop=extracts` parameters from https://www.mediawiki.org/wiki/Extension:TextExtracts). Wikidata (`wbgetentities`, parameters from https://www.wikidata.org/w/api.php?action=help&modules=wbgetentities) was used to cross-check heights, lengths and populations and to record each source's `wikidataId`. Wikipedia text: CC BY-SA 4.0; Wikidata: CC0.

| Fact in the scene | Source |
|---|---|
| Wikipedia population 5.561.912 and area 13.670,95 km² (shown next to the book's numbers); density 408 vs book 409; Campania felix; five provinces; Napoli metro ~2 534 ab./km², the highest of Italy's metropolitan cities; mountain groups | Campania (Q1438) |
| Province columns: Napoli 2.950.922, Salerno 1.052.157, Caserta 909.873, Avellino 392.305, Benevento 257.161 | the five province articles (Q18241891, Q16271, Q16153, Q16120, Q16134). Wikidata's P1082 values are older and of mixed dates (2016–2021), so Wikipedia's figures were used |
| Last eruption 1944 | Vesuvio (Q524) |
| 79 d.C. destroyed Ercolano and Pompei; Plinio il Giovane, at Miseno, wrote to Tacito | Eruzione del Vesuvio del 79 (Q2411998) |
| Osservatorio Vesuviano founded 1841, oldest volcanological observatory | Osservatorio Vesuviano (Q967776) |
| Volturno 175 km, longest river of southern Italy, rises at Rocchetta a Volturno (Molise), mouth at Castel Volturno | Volturno (Q572191); Wikidata P2043 = 175 km |
| Sele: rises at Caposele (AV), mouth in the Golfo di Salerno; rises in the Picentini | Sele (Q937958), Monti Picentini (Q723327) |
| Garigliano marks the Lazio–Campania border | Garigliano (Q287568) |
| Benevento at the confluence of Calore and Sabato; Calore tributary of the Volturno | Benevento (Q13437), Calore Irpino (Q857589) |
| Ischia ~46 km², volcanic, thermal waters; Epomeo 789 m | Isola d'Ischia (Q189387), Monte Epomeo (Q729764; Wikidata says 787, Wikipedia 789) |
| Capri limestone, Monte Solaro 589 m, Faraglioni, Grotta Azzurra | Isola di Capri (Q173292), Monte Solaro (Q3322117) |
| Procida volcanic, coloured houses, Capitale italiana della cultura 2022; Vivara bridge; Nisida joined to the mainland | Procida (Q72432), Isola di Vivara (Q1073353), Isola di Nisida (Q1192720), Arcipelago Campano (Q768102) |
| Miletto summit on the border, in the province of Isernia (Molise); Punta Giulia della Gallinola 1917 m is higher inside Campania | Monte Miletto (Q3861747), Monte Cervati (Q1139820). **The book says Miletto is Campania's highest peak: both are shown.** |
| Cilento park UNESCO since 1998 | Parco nazionale del Cilento, Vallo di Diano e Alburni (Q867361) |
| Napoli third comune of Italy by population | Napoli (Q2634) |
| Italy 195 ab./km² | Italia (Q38) |
| Pompei excavations > 4 million visitors in 2024 | Scavi archeologici di Pompei (Q18222399) |
| Paestum = Poseidonia, Magna Grecia | Paestum (Q329967) |
| DOP/IGP products, San Gregorio Armeno, Reggia, Vietri, Piana del Sele drained, Campi Flegrei bradisismo, Matese shared with Molise, Ercolano wood finds | the matching articles, listed in the scene's `sources` |

Dropped from the prototype because no fetched source supported them as written: "Plinio … in due lettere" (rewritten as one letter to Tacito), Paestum "più di 2.500 anni fa", Ischia–Procida–Capri "famose" details not in the sources, "Irpinia e Sannio coltivate a vite".
