# Façade theatre (D28)

The `facade` engine draws the front of a building with lines only: paper-white surfaces, grey poché on the cut, fine dark lines, muted red overlays. A building comes from a small grammar (floors, bays, cells, members, crown, rotunda), never from free geometry. Five views, all through `Engine.view`: prospetto, assonometria, prospettiva (one point), sezione, pianta.

- Spec: [superpowers/specs/2026-11-09-facade-theatre-design.md](superpowers/specs/2026-11-09-facade-theatre-design.md)
- Plan: `docs/superpowers/plans/` (façade theatre, Plan A)
- Decision: D28 in [decisions.md](decisions.md)
- Code: `packages/engine/src/engines/facade/`, grammar in `packages/scene-spec/src/engines/facade.ts`

## Grammar (FacadeData)

`engineData = { buildings[1..4], chapters[] }`, one building per chapter (a building may serve several chapters).

- Building: `id`, `name`, `style` (classical, renaissance, baroque, temple, romanesque), `base {height, steps}`, `floors[1..6]` bottom to top, `crown`, `depth`, `rotunda`.
- Floor: `height`, `bays[1..15]`, `members` (pilaster, half-column, column, pier; order tuscan..composite; `paired`, `rusticated`), `wall` (smooth or rusticated, `course`), `top` (string-course, entablature, none), `cornice` (plain, dentils, modillions), `portico`, `colonnade {depth}` (free-standing columns in front, temple front), `shoulders` (volutes or slopes, when a floor is narrower than the one below).
- Bay: `id`, `width` (axis to axis), `forward` (avant-corps: how far the bay projects towards +z, in metres, 0..3), one `cell`: wall, arch, portal, window (`mullion` = bifora), niche, oculus, panel, gallery.
- Crown: pediment (triangular or segmental), attic, balustrade, gable (`pitch`).
- Rotunda (behind the body): `diameter`, `wall`, `height`, `level`, `gap`, `niches`, `dome {type smooth|coffered, coffers [rings, per ring], oculus, drum, lantern, steps}`.
- Chapter: `chapter` (id of the scene chapter; every scene chapter needs exactly one entry), `building`, `views` (keys `{at, view, dur}`; the five views are prospetto, assonometria, prospettiva, sezione, pianta; when a chapter has `views` its scene `camera` keys are ignored, so leave them empty), `acts`, `plan` (cut height of the pianta, default base + 1 m), `eye`.
- Acts: `draw` (building, floor, bay, `crown`, `base`, `rotunda`, `dome`), `highlight` (also `<floor>.members`), `cut` (through a bay), `eye` (moves the perspective eye).
- Sliders of the "Prova tu": `eye-height`, `eye-x` (metres).
- Anchors for pins and camera keys: `building`, `floor`, `bay`, `member` (the floor needs `members`), `vanishing-point` (one-point perspective: a single vanishing point, so no `index`), `horizon`, `rotunda`, `dome`, `oculus`.

`checkFacadeData(data, scene)` cross-checks what the schema cannot: ids, cells inside their bay and floor, a floor not wider than the one below, act targets, times inside the chapter, anchors, sliders, the plan height, a scene chapter with no facade entry, duplicate chapter entries and building ids, `member` anchors on a floor without members, `vanishing-point` with an index, and a chapter with both `views` and camera keys.

## Coordinates and scale

Metres, y up, the façade plane x–y facing +z, x = 0 on the axis, the front wall at z = 0 and the body towards -z. Projecting bays and free-standing columns come out towards +z. The engine uses **one scale for the whole lesson** (the largest building fits `FACADE_FIT`), so buildings keep their proportions from chapter to chapter. `resolveAnchor` and `view` convert to root units.

**Units caveat.** Everything in the grammar is in metres, with two exceptions that are in the engine's root units (the largest building is fitted to `FACADE_FIT` = 6, so one root unit is roughly 2 to 20 metres): `{ pos: [x, y, z] }` anchors and the `distance` of camera keys. Entity anchors are converted from metres; `pos` anchors are not. Use entity anchors. Converting these to metres is deferred to Plan B.

## Catalogue map

| File | What it draws |
| --- | --- |
| `catalogue/basic.ts` | walls with holes, rustication, base and steps, floor and ground slabs (`GROUND_SLAB`), portico, gable body |
| `catalogue/bands.ts` | string courses, entablature, cornices (plain, dentils, modillions) |
| `catalogue/orders.ts` | the five orders: shaft, base, capital (`orderMember`, `FACADE_ORDER_RATIO`) |
| `catalogue/openings.ts` | arches, windows (round, mullion, pediment, corbels, balustrade), portals, niches, panels, oculi |
| `catalogue/crown.ts` | pediments, attic, balustrade, volutes, gable |
| `catalogue/temple.ts` | stylobate, colonnade, triglyphs |
| `catalogue/romanesque.ts` | loggetta, splayed portal, aisle slopes |
| `catalogue/rotunda.ts` | cylinder with niches, dome (smooth or coffered), oculus, stepped rings (`DOME_SEAT`) |
| `profiles.ts` | moulding profiles, sweeps, turned solids |
| `model.ts` | grammar to group of inked geometry; `facadeLayout` is the pure arithmetic (`SINK`) |
| `views.ts` | the five views as pure camera functions; blend between view keys (`VIEW_BLEND`) |
| `acts.ts` | draw, highlight, cut, eye as a pure function of (chapter, t) |
| `overlays.ts` | horizon, vanishing point, depth lines, section line A-A, level marks, scale bar |
| `ink.ts` | materials, outlines, section uniform, line weights |

## Line weights and colours

All in `FACADE_LINE` (`ink.ts`): `ink`, `overlay`, `paper`, `poche`, `silhouettePx`, `creaseDeg`, `fineAlpha`. The look is the same in Colori and China: the app's styler skips groups marked `userData.inkSelf`.

## The view hook

`Engine.view(chapterId, t, aspect)` returns the camera (`position`, `target`, `fov`, `shiftY`) or null to fall back to the chapter's camera keys. It is pure. The views are orthographic-like (a 6 degree lens from far away) except the perspective, which is a real lens with a lens shift so a low horizon needs no tilt and verticals stay vertical. Between two view keys the camera blends over `VIEW_BLEND` seconds. The eye sliders override the scene's eye through `setParams`.

## Section and plan

The cut is a uniform on the vertex `position` (`uSection`), not a clipping plane, because geometry is baked in building-local coordinates. Cut (back) faces are painted poché grey, the inside is paper.

Rule for every section solid: **every cut band is one closed solid, with no overlaps and no coplanar opposite-facing contacts.** Where two solids touch face to face, the fragment shader picks the colour by `gl_FrontFacing`, so coplanar contacts z-fight and show a wrong colour in the cut. That is why entablatures, stylobates, floor slabs and the dome are each one closed solid, and why the wall and the dome are two solids with a small gap (`DOME_SEAT`, 2 cm): their faces would otherwise lie in one plane, facing each other, where a plan cut passes above the wall top. `facade.test.ts` and `facade-rotunda.test.ts` check this with rays.

The **pianta** looks straight down at a horizontal cut at the chapter's `plan` height. Seen from above, the underside of a cut solid (the poché) must win over the top of what it rests on (a wall sinks `SINK` = 5 cm into its plinth). So in the plan view only, back faces get a depth bias: `uLift` in the paper vertex shader moves them `PLAN_LIFT` (15 cm) towards the eye along the view ray; the cut test keeps the unmoved position. `PLAN_LIFT` must exceed `SINK` and stay under `GROUND_SLAB` (30 cm, the thinnest slab); `facade-rotunda.test.ts` pins both. The lift fades in with the weight of the pianta.

## How to add an element

1. Grammar: add the field or cell to `packages/scene-spec/src/engines/facade.ts` (schema, then `checkBuilding` if it has a size rule).
2. Geometry: a function in the right `catalogue/` file, building-local metres, one closed solid if it is cut by a section.
3. Model: call it from `model.ts` and register the part id for acts.
4. Tests: a ray test in `packages/engine/test/facade-catalogue.test.ts`, and a section or plan test if the part is cut.
5. Show it in the dev scene (below).

## Scenes

- `fixtures/public/scenes/_dev-facciata.scene.json` and `_dev-facciata-2.scene.json`: dev scenes (palazzo, orders, views, eye; temple, Romanesque, rotunda). Not in the home list (the name starts with `_`).
- `facciata-palazzo-rucellai.scene.json`: reference lesson, four chapters on Palazzo Rucellai (drawing, orders, perspective with the Prova, section).
- `facciata-tempio-chiesa.scene.json`: reference lesson, three buildings (temple at Paestum, San Miniato al Monte, Pantheon).
- The reference lessons are tested in `packages/engine/test/facade.test.ts`; `pnpm export:e2e` exports every scene in the folder, both lessons included.

Simplifications of the reference lessons are listed in each scene's `disclaimers`. The Pantheon pronaos is one row of eight columns.

## Not in v1

Gothic fronts and curved fronts (the `art` engine covers paintings and photographs). The generator that writes FacadeData from a book page is Plan B, with the music theatre's recording batch.
