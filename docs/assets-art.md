# Art assets (`art` engine)

Rule (decision D14): an artwork image is shipped or downloaded **only if it is in the public domain**, checked
on both Wikidata (P6216 copyright status = Q19652 "public domain") and the Commons file page (licence /
`Copyrighted = False`). Protected works get a placeholder frame with title, author and a link. Images are
resized to at most 2048 px on the long side (sharp, JPEG quality 84).

## Files

| File | Work | Author | Licence | Source | Notes |
|---|---|---|---|---|---|
| `fixtures/public/art/ultima-cena-leonardo.jpg` (2048 × 1067) | Ultima Cena (Cenacolo), 1494-1498, Milano, Santa Maria delle Grazie | Leonardo da Vinci (1452-1519) | Public domain (Commons: LicenseShortName "Public domain", Copyrighted "False"; Wikidata Q128910 P6216 = public domain, determination method "100 years or more after death of author(s)") | [File:Leonardo da Vinci (1452-1519) - The Last Supper (1495-1498).jpg](https://commons.wikimedia.org/wiki/File:Leonardo_da_Vinci_(1452-1519)_-_The_Last_Supper_(1495-1498).jpg) (Wikidata P18 of [Q128910](https://www.wikidata.org/wiki/Q128910)) | Downloaded 2026-11-04 as the Commons 3840 px thumbnail of the 5076 × 2645 original, resized to 2048 px. Same framing as P18, so Wikidata P2677 region coordinates apply unchanged. |
| `fixtures/art/files/6598edd59f218c72.bin` | same | same | Public domain | Commons thumbnail URL of the same file (960 px request) | Recorded image bytes for the resolver's offline tests. |
| `fixtures/art/http/**` | — | — | Wikidata CC0 1.0; Wikipedia / Commons API metadata | it.wikipedia, Wikidata and Commons API responses, accessed 2026-11-04 | Recordings for mock mode (Q128910 Ultima Cena, PD; Q175036 Guernica, not PD: used to test that nothing is downloaded). |

## Data used by the reference scene (`arte-ultima-cena`)

- Figure rectangles: Wikidata Q128910, P180 "depicts" with qualifier P2677 "relative position within image"
  (`pct:x,y,w,h` on the P18 file), CC0. Group rectangles are their unions.
- Perspective lines: traced on the image for this lesson (tapestry tops, ceiling/wall junctions, two ceiling
  beams); the vanishing point is their least-squares intersection (`vanishingPointOf`, Source kind "computed").
  It falls on Christ's head, which matches it.wikipedia ("Ultima Cena (Leonardo)": the nail hole found at Christ's
  head during the last restoration).
- Size: 460 × 880 cm from it.wikipedia. Note: Wikidata gives height 700 cm (P2048) and width 880 cm; the scene
  uses the Wikipedia value, which also matches the image proportions (5076 / 2645 ≈ 880 / 460).

## Classical orders kit

Column height / lower diameter: doric 7, ionic 9, corinthian 10; flutes doric 20 (sharp edges, no base),
ionic/corinthian 24 with fillets, on a base. Sources: en.wikipedia "Classical order", "Ionic order",
"Corinthian order"; it.wikipedia "Ordine dorico", "Ordine ionico" (accessed 2026-11-04). Capitals are schematic.
No GLB models are shipped yet; `ArtData.model` accepts one only from a verified CC0 / public-domain collection.
