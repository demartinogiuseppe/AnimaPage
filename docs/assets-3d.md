# 3D assets of the `diorama` engine

All catalog models are **CC0** (public domain dedication). Licenses verified on 2026-11-03 on each
kit page (license field "Creative Commons CC0") and in the `License.txt` shipped in every download
("License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/").
Credit is not required; we credit Kenney anyway.

| Pack id (`DioramaModel.pack`) | Kit (version in License.txt) | Source page | Author | License | Models used |
|---|---|---|---|---|---|
| kenney-mini-characters | Mini Characters (1.0) | https://kenney.nl/assets/mini-characters | Kenney (www.kenney.nl) | CC0 1.0 | 15: 12 adults, boy, girl, wheelchair (skinned, 30+ clips) |
| kenney-cube-pets | Cube Pets (2.0) | https://kenney.nl/assets/cube-pets | Kenney | CC0 1.0 | 22 animals (idle, walk, run, eat, dance, gestures) |
| kenney-city-kit-commercial | City Kit Commercial (2.1) | https://kenney.nl/assets/city-kit-commercial | Kenney | CC0 1.0 | 7: buildings, awnings, parasol |
| kenney-city-kit-suburban | City Kit Suburban (2.0) | https://kenney.nl/assets/city-kit-suburban | Kenney | CC0 1.0 | 6: houses, fence, planter, street tree |
| kenney-city-kit-roads | City Kit Roads (2.2) | https://kenney.nl/assets/city-kit-roads | Kenney | CC0 1.0 | 10: traffic lights, street lamps, signs, cones, dumpster, pole |
| kenney-furniture-kit | Furniture Kit (2.0) | https://kenney.nl/assets/furniture-kit | Kenney | CC0 1.0 | 30: furniture, appliances, coffee machine, walls, doors |
| kenney-food-kit | Food Kit (2.0) | https://kenney.nl/assets/food-kit | Kenney | CC0 1.0 | 19: food, cups, pots, kitchen tools |
| kenney-nature-kit | Nature Kit (2.1) | https://kenney.nl/assets/nature-kit | Kenney | CC0 1.0 | 21: trees, plants, rocks, crops, camping, columns |
| kenney-car-kit | Car Kit (3.1) | https://kenney.nl/assets/car-kit | Kenney | CC0 1.0 | 9: cars, taxi, police, ambulance, trucks, tractor |
| kenney-survival-kit | Survival Kit (2.0) | https://kenney.nl/assets/survival-kit | Kenney | CC0 1.0 | 10: tools, barrel, crate, bucket, chest, workbench |
| procedural | built in code (`engines/diorama/shapes.ts`) | — | AnimaPage | MIT (project) | ladder; shapes box, cylinder, sphere, cone, text, patch, wire, bulb |

The 3D letters of the `text` shape use our own 5x7 dot-matrix font (`engines/diorama/font.ts`): no font files.

## Catalog

- 150 entries (149 GLB-backed + 1 procedural), 147 GLB files (two entries reuse a file at another size:
  `boy` = `man-e`, `girl` = `woman-b`), **10.9 MB** in `fixtures/public/models/` (budget 25 MB, checked by a test).
- The list lives in `packages/scene-spec/src/engines/diorama.ts` (`DIORAMA_CATALOG`, generated block):
  id, Italian and English description, tags, default size in metres, animation clips.
  `dioramaCatalogPrompt()` prints one line per model for an LLM prompt.
- Units: 1 unit = 1 metre. Each model is scaled uniformly so its height equals the catalog height
  (times the item's `scale`); base on y = 0, centred in x/z, facing +z.

## How the files were made (reproducible)

1. Download the kits above (kenney.nl "Download" button; the zip contains `License.txt`), unzip each into
   `<dir>/<kit-slug>/`.
2. `node packages/engine/src/engines/diorama/tools/build-models.mjs <dir> .` (Node >= 24, no dependencies):
   reads `tools/catalog-source.mjs` (id, source file, height, descriptions, tags), copies each GLB into
   `fixtures/public/models/<id>.glb` with its external texture (`Textures/colormap.png`, about 11 kB)
   **embedded**, so every file is self-contained; measures the bounding box and lists the clips; rewrites
   the generated catalog block in `diorama.ts`.
3. No mesh compression (Draco/meshopt): files stay small and need no decoder.

## Runtime notes

- Browser: GLBs are fetched through `EngineContext.loadAsset` and parsed with three's `GLTFLoader`;
  skinned characters are cloned with `SkeletonUtils.clone`; every item gets its own materials and
  `AnimationMixer`. The clip time is set with `mixer.setTime(f(t))` every frame (never accumulated).
- Missing/broken file: a warning in the console and a translucent lilac box of the catalog size.
- Node (tests, no `createCanvas`): GLBs are not loaded (their PNG textures cannot be decoded there);
  every catalog item is a placeholder box of the catalog size. Transforms, anchors and effects are
  computed from the catalog sizes, so they are identical to the browser.
