# Analysis of `micenei-troia.html` (reference for the `battle` engine and the common player)

Source: `docs/reference/prototypes/micenei-troia.html` (961 lines, ~73 KB, single file, no build).
All line references (`L123`) point to that file. The prototype was read in full and was not modified.

---

## 1. Tech

| Item | Detail | Lines |
|---|---|---|
| three.js | **r128**, UMD global build `three.min.js` from cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`) | L204 |
| Addons | `OrbitControls` from the legacy non-module `examples/js` folder on jsDelivr (`three@0.128.0/examples/js/controls/OrbitControls.js`), attaches `THREE.OrbitControls`. That folder was removed in r148: the port must use `three/addons/controls/OrbitControls.js` | L205 |
| Loading style | Plain `<script>` tags, no importmap, no modules, no bundler; one inline `"use strict"` script | L204–961 |
| Other libs | None | – |
| Fonts | Google Fonts CSS: Atkinson Hyperlegible (400/700, italic 400), Cinzel (600/800), IBM Plex Mono (500), with `preconnect` | L3–5 |
| Runtime network fetches | None. No `fetch`, no XHR, no `Math.random`, no `navigator.xr`. Textures are drawn on `<canvas>` at startup (hide L376, sail L380, fire sprite L561) | – |
| Speech | Web Speech API `speechSynthesis` | L342–364 |
| AR | **None.** Despite the CSS comment "3D 'AR' diorama" (L7) and the "Pagina riconosciuta" badge (L155), there is no WebXR, no camera, no page recognition. The badge text is overwritten with the chapter dates on the first `go()` (L880) | L7, L155 |
| Doc shell | No `<!DOCTYPE>`/`<html>`/`<head>`/`<body>`: starts with `<title>` and a `claude:viewport-fit-sides` meta (artifact-style page) | L1–2 |

Renderer: `WebGLRenderer({antialias:true})`, `setPixelRatio(min(dpr,2))`, no shadows, no tone mapping, r128 legacy (linear) color/light handling; `MeshLambertMaterial` almost everywhere, `MeshPhongMaterial` for the sea (L459–473). Port note: three ≥ r152 defaults to sRGB output and physically-correct light units, so colors and intensities (0.65 / 0.8 / 0.35) must be retuned or legacy mode used to keep the look (Appendix B).

---

## 2. Overall architecture

### 2.1 Building blocks

| Block | What | Lines |
|---|---|---|
| Math helpers | `clamp`; `seg(t,a,b)` = progress of t in [a,b] clamped 0..1; `E` = quadratic ease-in-out; `R(i,k)` = deterministic sin-hash pseudo-random in [0,1); `lerp` | L208–213 |
| World constants | `TROY={x:13,z:0}`, `TOP=1.4` hill-top height, `WALL_R=4.3`, `WALL_H=0.95`; `hY(x,z)` terrain height (flat top r≤4.6, linear slope to 0 at r=6.6); `GATE` (Scaean gate, x=8.7, z=0); `GATE_OUT={x:6.4,z:0}` | L214–218 |
| Content | `CHAPTERS` (6 chapters: narration, camera keys, deep dives, quiz, optional `status(t)`), `CH` index, `PINS` (23) | L221–338 |
| State | Single global `S` | L341 |
| Voice | `Voice` wrapper (token cancellation, timed fallback), `spoken()` text rewriter | L342–364 |
| Scene construction | `init()` builds every object of every chapter once (shared world); builders `buildWarrior`, `buildHorse`, `buildChariot`, `buildShip`; canvas textures | L366–576 |
| Formations / poses | `campA`, `lineA`, `lineT`, `wallT`, `BEACH`, `shipState`, `onShip`, `walk`, `poseA`, `poseT`, `horsePos`, `shipsAt` | L586–674 |
| Scene application | `applyScene(ch,t)` sets every transform / visibility / material for (chapter, time) | L678–766 |
| Pins | `pinPos` (hard-coded switch), `buildPins`, `updatePins`, `pulse`, `onPin` | L769–828 |
| Playback | `play`, `pause`, `seek`, `highlight`, `speakSentence`, `tick(dt)`, `onEnd`, scrubber, "Centra" | L831–869 |
| Panel | chips, `go(id,autoplay)`, deep-dive speech, voice toggle, guided tour | L872–898 |
| Quiz | `renderQuiz`, `feedback`, `setPicking`, `answerPick` | L901–945 |
| Loop | `frame(now)`: `tick(dt)` → camera tween → `applyScene` → `controls.update()` → render → `updatePins()` | L948–960 |

### 2.2 State `S` (L341)
```js
S = { ch:"micenei", t:0, playing:false, si:-1, speaking:false, tour:false,
    picking:false, userCam:false, camKey:-1, voice:true, quiz:{} }
```
`t` is chapter-local (each chapter 0..dur); `si` = last sentence started; `speaking` true while voice or its fallback timer runs; `userCam` true after the user touches OrbitControls; `camKey` current camera key; `quiz[chId]={i,score,answered,done}` persists across chapter switches.

### 2.3 Render loop and time
`frame(now)` (L949): `dt=min(0.05,(now-last)/1000)`; `tick(dt)`; camera tween `+= dt/1.8`; `applyScene(S.ch,S.t)`; OrbitControls damping update; render; `updatePins()` (after render, because pins read positions written by `applyScene`). Always running, also when paused.

`tick(dt)` (L848):
1. if playing, the next sentence's `at` is reached and the voice is idle → `speakSentence(si+1)`;
2. `hold = speaking && nextSentence && t >= nextSentence.at`; if not holding, `t=min(dur,t+dt)`;
3. if `t>=dur && !speaking && all sentences started` → stop, clear highlight, `onEnd()` (tour);
4. sync scrubber (unless dragging), time label, status pill, camera key (§3.8).

### 2.4 Timeline scrubber (L164–167, L831–867, L887–888)
`<input type=range min=0 max=dur step=0.01>`, `max` set per chapter; tick marks = one 2 px bar per sentence at `at/dur·100%` (`.tl-marks`, L64–65); `input` → `dragging=true; pause(); stopTour(); seek(v)`; `change` → `dragging=false`; label `m:ss / m:ss` (`fmt`, L833).

### 2.5 Is the scene a pure function of t? (hard requirement)
**Mostly yes.** `applyScene(ch,t)` recomputes *everything* from `(ch,t)` every frame (ships, horse, gate, 270 soldiers, display, chariots, heroes, arrows, city opacity, strata, fire, sky/fog/lights). No integration, no velocities, no `Math.random`; all randomness is `R(i,k)=fract(sin(i*127.1+k*311.7)*43758.5453)` (L212). Ship headings come from finite differences of the pure function (`shipState(t±0.05)`, L687); the horse-chapter disembark origin uses `shipsAt(26)` (L634, L674) rather than remembered state. Scrubbing back/forth reproduces frames.

Exceptions / hidden dependencies:

| # | Issue | Lines |
|---|---|---|
| D1 | **Camera is not a function of t.** Keys are step-selected (`camFor` = last key with `at<=t`); on a key change `flyTo` tweens 1.8 s **from the current camera pose**. Pose depends on history (previous chapter, scrub path, user orbit). Scrubbing across a key re-triggers a fly-in | L579–584, L861, L952–953 |
| D2 | Pins read side-channel positions: `SOLD[]` (written in `applyScene`) and live Object3D positions (chariot, ships, heroes, horse). Correct only because `updatePins` runs after `applyScene` | L710, L773–786 |
| D3 | Pin `cond` of `carro` and `campo` read global `S.ch` | L319, L323 |
| D4 | Narration state is event-driven: after `seek(t)` the sentence covering t counts as spoken (`si` = last with `at<=t-0.001`), so play mid-sentence is silent until the next boundary; only tap-sentence re-speaks (`si=i-1`). Pause kills the utterance; resume does not repeat it | L841–842, L885 |
| D5 | Pin pulse is a one-shot CSS animation fired when a sentence starts, not derived from t | L818, L845 |
| D6 | Sea color steps at `night>0.5` (deterministic but a jump) | L683 |
| D7 | Frame-rate dependence only in `tick` (dt clamp) and the camera tween | L950 |
| D8 | Walk bounce `|sin(11t+i)|`, melee jitter `sin(6t+i)` etc. are functions of t (fine) | L622, L707 |

Recommendation: keep `update(t)` as pure as `applyScene`; make the camera pure (blend key k-1→k over `[at_k, at_k+1.8]` with the same cubic ease); treat chapter entry and "Centra" as **player-level transitions outside `update(t)`** (short tween from current pose to `camera(t)`). Pins resolve declared anchors (entity id + index + offset) after `update(t)`.

---

## 3. Player mechanics

### 3.1 Narration storage and timing
`narr: [[at, text, highlightPinIds], …]` per chapter (L223–300), `dur` seconds, `at` absolute chapter seconds. Rendered as `<span>`s (text + space) inside `<p class="narr">`, `title="Vai a questo momento"` (L884–885).

### 3.2 TTS (Web Speech API) (L342–364)
- `Voice.ok = "speechSynthesis" in window`.
- **Voice selection** `pick()`: voices with `lang` matching `/^it([-_]|$)/i`; prefer name `/natural|neural|premium|enhanced|google/i`; else first Italian; else null (only `u.lang` set). Re-picked on `speechSynthesis.onvoiceschanged` (L359).
- **Utterance**: `spoken(text)`, `lang="it-IT"`, `voice` if any, `rate=0.98`, default pitch/volume.
- **Events**: `onend` → callback; `onerror` → ignored if stale token or `interrupted`/`canceled`, else show voice note and fall back to timer.
- **Cancellation**: `stop()` increments token `tok`, clears timer, `speechSynthesis.cancel()`; every callback checks its token.
- **Timed fallback** (no API, voice switched off, or error): `setTimeout(done, max(1500, words·340 ms))` → scene still waits per sentence.
- **Unlock**: first `pointerdown` (and every play/tour/chip/sentence handler) speaks a silent `" "` with `volume=0` (iOS gesture requirement) (L360–362).
- **`spoken()`** (L363): `a.C.`→`avanti Cristo`; `VIIa`→`sette A`; `VIII secolo`→`ottavo secolo`; `Troia I|VI|IX`→`Troia uno|sei|nove` (prototype of the spec's `speech` field).
- `Voice.list(arr)` speaks items sequentially (deep dives) (L357).
- `#voiceOn` switch toggles `S.voice` and cancels speech (L893); voice note shown at start if `!Voice.ok` (L898).

### 3.3 Waiting for the voice (L848–856)
Sentence i+1 starts only when `t>=at[i+1]` **and** sentence i is finished. If sentence i is still speaking when `t` reaches `at[i+1]`, `t` freezes. Slow voice stretches the chapter; fast voice never speeds it up. Overshoot ≤ one dt (≤50 ms). Chapter ends after `t>=dur` and last sentence done.

### 3.4 Highlight and tap-to-jump
`highlight(i)` toggles class `on` (bg `--hl`, 0.25 s transition) (L843, L117); set at sentence start and on `seek`; cleared at chapter end and on `go()`. Tap sentence → `unlockVoice(); stopTour(); seek(at); S.si=i-1; play()` (L885). `play()` at the end (`t>=dur-0.05`) restarts from 0 (L835).

### 3.5 Pins / labels (L314–338, L769–828, CSS L75–89)
- DOM `<button class="pin">` in `.labels` overlay (only pins get pointer events): `<span class="tag">Name <small>sub</small></span><span class="stem"></span>`; sea pins (`k:"sea"`) plain italic uppercase text, centered.
- Side marker: class `a` → 8 px dot `#2c5fa6` (Achaeans); `t` → `#b3342a` (Trojans).
- **Projection** each frame: `pinPos(p,t).project(camera)`; hidden if `v.z>1` or `|v.x|>1.15` or `|v.y|>1.15`; `x=(v.x+1)/2·w, y=(1−v.y)/2·h`; `transform: translate(x,y) translate(-50%,-100%)` (tip of stem on anchor) or `-50%,-50%` for sea. No occlusion test, no collision avoidance.
- **Positions**: hard-coded `switch(p.id)` (L772–793): static coords, local anchors on the display warrior via its `matrixWorld` (`userData.anchors`, L407), or live positions (soldier #12 of each side, chariot 0, ship 6, heroes, horse, strata y). See Appendix A.3.
- **Visibility**: chapter in `p.ch` **and** (`S.picking` **or** no `cond` **or** `cond(t)`) (L809).
- **Pulse when named**: sentence start adds `pulse` (forced reflow `void el.offsetWidth` to restart): `@keyframes pulse{50%{scale:1.22}}`, 1.1 s ease-in-out ×2 (L83–84, L818).
- **Info card** (`onPin`, L819–826): if picking → quiz answer; else `pause(); stopTour();` card bottom-left with title `name · sub` (Cinzel 800 18 px) + `info`, and speak `name + ". " + info`. Buttons "Ascolta" (re-speak) and "Chiudi" (hide + stop voice). Hidden on chapter change.

### 3.6 Quiz (L900–945)
- Per-chapter state persists across chapters; header "Domande" + "i di n".
- **Choice** (`o` options, `a` index, `x` explanation): all buttons disabled, correct `.right` (green), clicked wrong `.wrong` (red); feedback `Giusto! x` / `Non proprio. x`, spoken; +1 only if correct and not yet answered; then "Domanda successiva" / "Vedi il risultato".
- **Pick** (`a`: pin ids): `setPicking(true,q)` → stage class `picking` (dashed 2 px clay outline on every visible tag, white dashed on sea labels), `pickbar` pill (clay bg, white bold) shows the question at top of the stage, status pill hidden, **all pins of the chapter visible regardless of `cond`** (still frustum-culled). Panel hint "Rispondi toccando un'etichetta sulla scena 3D." + "Mostra la risposta".
- right pin → `.right` (3 px green outline, light-green tag), picking off, "Giusto!" (+1);
- wrong pin → `shake` 0.4 s + voice "No, questo è: {name}. Riprova." (no penalty, unlimited tries, later correct still scores);
- "Mostra la risposta" → answer pins `.right`, picking off, explanation only, no point.
- Every feedback pauses playback and stops the tour (L938).
- End: "Hai risposto bene a {score} domande su {n}." + "Ricomincia" + (if not last) "Capitolo successivo: {chip}" (`go(next,true)`).
- Quirk: `renderQuiz()` runs on every `go()`; if the chapter's current question is `pick`, pick mode switches on at chapter open even during narration.

### 3.7 Deep dives (L193–196, L886, L892)
`<details class="card">` "Approfondisci" (closed by default, `+`/`–` marker in clay), bullet list, button "Ascolta l'approfondimento" → pause, stop tour, `Voice.list(deep)`.

### 3.8 Automatic camera, "Centra"
- Keys `cams: [[at,[px,py,pz],[tx,ty,tz]],…]` (position, OrbitControls target).
- `camFor(c,t)` = last key with `at<=t` (step) (L584). On key change and `!S.userCam` → `flyTo` (L861).
- `flyTo`: if stage width < 520 px, position pushed away from target **×1.3**; tween 1.8 s from current pose; **cubic ease-in-out** `q<.5?4q³:1−(−2q+2)³/2` (L579–583, L952–953).
- OrbitControls `start` → `S.userCam=true; tween=null` (user owns the camera for the rest of the chapter) (L572).
- **"Centra"**: `userCam=false`, fly to key for current t (L869). `go()` resets `userCam=false, camKey=-1`.
- OrbitControls: damping 0.08, distance 1.2–60, `maxPolarAngle 1.42` (L571). Camera FOV 40, near 0.05, far 200 (L464). Start pose (-1.4,2.2,15.8) → target (-4.8,0.9,12) (L573).

### 3.9 Chapters, tour, Mito vs Storia, status
- Chips: colored dot (`--myth`/`--hist`) + `chip` short name; current `aria-current=true` (inverted), scrolled into view (L873, L877).
- `go(id,autoplay)` (L874–891): stop voice, t=0, si=-1, camera reset, picking off, info card hidden; update kind tags, HUD dates, kicker, title, sentences, deep list, timeline max + marks, quiz; `playing=autoplay`. Chip click autoplays. Initial `go("micenei",false)` (L959).
- **Tour** (L894–897, L863): "Visita guidata" → `S.tour=true`, label "Ferma la visita", `go(first,true)`; at each chapter end wait **1300 ms**, then next chapter autoplay; stops after last. Any interaction calls `stopTour()` (scrub, sentence tap, chip, pin, quiz feedback, deep listen, pause via tlPlay).
- **Mito/Storia**: `kind:"myth"|"hist"` per chapter; uppercase pill (11 px, ls .12em; `#7a3fa0` "Mito" / `#1f6d5e` "Storia") in HUD badge (with dates) and card kicker (with chip name); dot on chips; permanent footer disclaimer. Note ids swapped in meaning: `#era` gets `c.dates`, `#dates` gets `c.chip` (L880–881).
- **Status pill** (top center, `rgba(20,14,10,.72)`, Cinzel 600 14 px): per-chapter `status(t)` string; hidden while picking (L859–860).

### 3.10 Archaeological strata
Chapter `storia`: 9 stacked cylinders (Troy I..IX) on the hill top: radius `4.2−0.06k`/`4.25−0.06k`, height 0.3, centre `y=TOP+0.15+0.31k`, 40 segments (L508–510). City (walls, towers, gate, houses, palace; not the hill) fades `opacity=1−seg(t,8,11.5)`; each layer grows `scale.y=E(seg(t,11.5+0.6k,12.1+0.6k))` bottom-up; layer 6 (Troy VII, `#c4572e`) pulses emissive `(p,0.25p,0)`, `p=0.25+0.25 sin 4t`, after t>18 (L755–758). Pins l1,l6,l7,l9 on the west edge.

### 3.11 UI layout (L35–147, L151–202)
- Desktop grid `minmax(0,1fr) 420px`, gap 16, safe-area padding. ≤860 px: one column, rows `minmax(300px,52%) minmax(0,1fr)`, gap 12.
- Stage (radius 22, bg `#cfdde6`) overlays: HUD top (badge: green dot + dates + kind; "Centra" right), status/pickbar top-center (`top:56px`), info card bottom-left (`bottom:70px`, ≤330 px), timeline pill bottom (38 px clay play button + range + mono time).
- Panel: eyebrow "Storia · Le civiltà dell'Egeo", H1 "I Micenei" (Cinzel 800, clay) + tour button; meander divider; chips; narration card (kind + chip, H2, sentences, "Guarda e ascolta" + "Voce" switch, voice note); deep `<details>`; quiz (`aria-live=polite`); footer.
- Light/dark via CSS vars + `prefers-color-scheme` / `data-theme` (L8–28); 3D colors theme-independent. `prefers-reduced-motion` disables CSS animations only (L148).

### 3.12 AR
None (§1). No reference exists for WebXR hit-test or the iPhone camera-window fallback.

### 3.13 Fallbacks
- WebGL failure → overlay "Il tuo browser non supporta la grafica 3D (WebGL). Spiegazioni, voce e domande funzionano comunque." (L459–460). three missing → `HAS3=false` (L368). Both → `go("micenei")` + `setInterval(()=>tick(.1),100)` (L960).
- **Latent bug**: in fallback `tick` still calls `flyTo()` on each camera-key change → throws (`THREE`/`camera` undefined); rest of that tick skipped. Pins never built: pick questions only via "Mostra la risposta".
- No voice → note "La voce non è disponibile in questo browser: la simulazione evidenzia il testo frase per frase." + timed highlighting.

---

## 4. Battle rendering techniques

World: x ∈ [−90, 62.5], z ∈ [−55, 55]; +x inland (Troy), −x sea. Yaw everywhere `atan2(dx,dz)`; π/2 faces +x (towards Troy), −π/2 faces −x.

### 4.1 Terrain (L469–484)
Ground 72×110 at x=26.5 `#b8a46c`; beach 3.4×110 at x=−8.3, y=0.004 `#e2d3a2`; sea 80×110 at x=−50, y=−0.02, Phong `#2d6f9c` shininess 70 specular `#6fa8cc` (night `#15324a`). Tenedos hemisphere r5 scaleY 0.42 at (−37,−0.05,18.5) `#8f8a5a`. Mount Ida cones (x,z,r,h) (42,−14,10,7), (50,6,13,9), (38,22,8,5) `#9a9473`. Scamander: Catmull-Rom through (26,−17),(16,−11.5),(6,−9.6),(−2,−10.6),(−9.6,−12.5), 80 samples, flat ribbon half-width 0.45 at y=0.012 (custom BufferGeometry), `#3d7fb3`, double-sided. Troy hill `CylinderGeometry(4.6,6.6,1.4,48)` at (13,0.7,0) `#a8945f`, matched by analytic `hY`. No heightmap, no shadows; `Fog(sky,45,115)`.

### 4.2 Parametric fortified city (L486–505)
Wall ring r=4.3 at y=TOP, 24 segments (length `2πR/24+0.02`, h 0.95, thickness 0.36, `#d3c19a`); segment at angle π (k=12) skipped for the gate → 23. Towers 0.62×1.4×0.62 `#c2ad83` at `k%3==1` or `|a−π|<0.3` → k ∈ {1,4,7,10,11,13,16,19,22}. Gate: 2 leaves `#6b4a2b` 0.12×0.855×0.55 on pivots (8.7,TOP,±0.55), `pivot.rotation.y=−s·open·1.35`. 46 random houses (w 0.35–0.8, h 0.22–0.57, d 0.35–0.8, random yaw) in ring r 0.9–3.5, skipping the gate street (`x<10.4 && |z|<0.9`), 3 stone colors. Palace 1.6×0.8×1.2 `#e9dfcc` at (13.3,TOP+0.4,0) + roof `#9b4a22`. City materials cloned + `transparent` for fading.

### 4.3 Armies (L539–556, L586–666, L704–712)
- **InstancedMesh**: 6 meshes (legs, body, head, helmet cone, shield ellipsoid, spear), **N=270** instances each (NA=150 Achaeans idx 0..149, NT=120 Trojans 150..269); all parts share one matrix per soldier (geometries pre-translated). `DynamicDrawUsage`.
- `setColorAt`: body `#2c5fa6`/`#b3342a`; helmet ivory `#efe6cf` (boar tusk) / bronze `#b98a3e`; shield `#d9c7a3`/`#7d2b22`. Legs `#a7834a`, head `#cf9a6e`, spear `#5a4430`. Soldier ≈0.55 tall (spear tip ≈0.82).
- Hidden = scale 0. Pose `{x,z,y|null,yaw,tilt,vis,moving}` from `poseA`/`poseT`; `y=null` → `hY`; bounce `+|sin(11t+i)|·0.025` when moving; rotation `(tilt,yaw,0,"YXZ")`, `tilt=−π/2` = fallen.
- **Formations**: `campA` 10×15 staggered; `lineA(i,fx)` 6 rows×25, spacing 0.55, front at fx, depth −x; `lineT(j,fx)` 5×24, depth +x; `wallT(j)` arc a ∈ [π−1.25, π+1.25] on the wall walk, angles within 0.09 of π pushed +0.18 (gate; small overlap), y=TOP+WALL_H, facing out; `onShip(i)` ship i%12, slot floor(i/12) along hull `(k−6)·0.14`, side ±0.085, y=0.32+bob.
- **Primitive** `walk(o,a,b,t,t0,t1,faceYaw)`: `lerp(a,b,E(seg(t,t0,t1)))`, `moving=t0<t<t1`, yaw = travel direction while moving else `faceYaw` (L604–608). Staggers `(i%25)/25·spread` produce a ripple.
- **Casualties**: front 2 rows with `R(i,3)<0.18` (Achaeans: i=4,5,14,17,36,37,48) / `R(j,5)<0.18` (Trojans: 11, j=4,5,6,12,17,19,20,22,25,35,38) fall at `15.5+R·4` over 0.4 s.
- **Melee**: front 2 rows after t=14 oscillate ±0.1 sin(6t+i) in x.

### 4.4 Units as groups with keyframes
No generic keyframe system: every movement is hand-written piecewise `seg`+`E`+`lerp`. Effectively each unit (formation, squadron, chariot, hero, horse) follows eased segments `(t0→t1: A→B)` plus attachments (soldiers ride ships; Trojans pull the horse; elite emerge from it). Two special path types: **constant-speed polyline** (`horsePos`, arc-length, eased overall, L667–672) and **orbit** around the city (`θ=π+p·6π`, r=7.4, L737–743). Full schedule in A.6.

### 4.5 Ships (L443–456, L517–518, L591–602, L685–692)
12 procedural ships: pitch hull 2.0×0.26×0.46, 4-sided cone bow, raked stem post, curved stern post, mast 1.5, square sail (red-striped canvas texture), 12 oars ±0.5. Slots: `BEACH(s)=(−11,(s−5.5)·1.55)`, far `(−34−(s%3)·1.4,(s−5.5)·2.2−2)`, hide `(−42.5+(s%4)·0.6, 17.5+(s%3)·0.9)`; hidden in `storia`. Heading by finite difference; **sail visible only while moving**; rest heading π/2; bob `0.03 sin(1.6t+s)` only if `x<−11.2`.

### 4.6 Chariots (L421–442, L526–527, L717–732)
Floor, front/side panels, two 4-spoke torus wheels, axle, pole, 2 box horses with pivot legs, standing driver. 4 battle chariots scale 0.72 (2 Achaean blue/light horses `#e7dfd2`, 2 Trojan red/dark horses `#6b4a33`) + museum chariot `#b3542a`/`#d8d0c4` scale 1.15. Moving: wheels `rotation.x=9t`, legs `0.6 sin(14t+1.7n)`.

### 4.7 Arrows (L558–560, L750–753)
`Points` ×70 (size 0.07, `#2a1d12`); origin `wallT(floor(R(k,30)·120))`, target x 1.6–3.4, z ±6, period `2.2+R(k,31)`, phase `R(k,32)·period`; `p=((t+phase)%period)/period`; lerp + lift `sin(pπ)·2.4`. Visible in `assedio` t>4. Pure in t.

### 4.8 Day / night (L679–683)
`night=seg(t,18,21.5)` in `cavallo`. Sky/fog `#cfdde6`→`#0b1426`; hemi 0.65→0.16; sun 0.8→0.05; moon (`#7f9cff`, from (10,12,−10)) 0→0.35; sea color step at 0.5.

### 4.9 Fire (L561–568, L759–765)
420 additive sprites (size 0.45, radial-gradient canvas, vertex colors `#ff7a1a`/`#ffc23a` by hash, `depthWrite:false`) on disc `r=sqrt(R)·3.6` over the city; rise `TOP+0.2+((0.7t+R)%1)·2.2·fire`, x wobble `0.05 sin(2t+i)`; `fire=seg(t,29,33)`; opacity 0.9·fire. PointLight `#ff7a2a` dist 16 at (13,3.6,0), `fire·(3+0.6 sin 13t)`.

### 4.10 Horse (L533–537, L667–672, L694–697)
Box horse ×3.1 on a wheeled platform (base 0.9×0.1×2.1, 4 wheels). Built: visible t>1, `scale.y=E(seg(t,1,5.5))`. Pulled 16.5–22.2 from (−7,0) via 6.4 and 8.7 to (11.4,0), constant-speed polyline eased overall, `y=hY` (climbs the slope).

### 4.11 Heroes (L529–531, L733–748)
Detailed warriors scale 0.7: Achilles blue/gold crest `#f1c232`, Hector red/gold. Wait, 3 laps on r=7.4 (Hector 0.38 rad ahead), duel with sways, Hector falls t>37 (0.5 s). Hector pin lowers (+0.35) when down.

### 4.12 Museum display (L520–524, L383–409, L714–715)
Podium (r 1.25–1.35, `#e8e2d6`) at (−4.8,0,12); detailed warrior (scale 1.45: bronze greaves, Dendra banded cuirass, pauldrons, boar's-tusk helmet as 4 ivory/dark rings, crest, cheek guards, figure-of-eight shield = 2 scaled spheres + boss with hide texture, 1.7 spear, sword) turning `0.7 sin(0.35t)`; chariot beside it. Pins elmo/armatura/scudo/lancia are local anchors.

### 4.13 Camera choreography
Per-chapter keys (A.2): wide establishing shot, then re-frame (1.8 s cubic) when narration changes subject; horse chapter has 6 keys (horse → sea/Tenedos → plain → gate close-up → high night view → burning city). Portrait ×1.3 distance.

### 4.14 Global phase effects
Gate: `open=max(seg(t,a,b)(1−seg(t,c,d)),…)`, 1 s ramps. City fade + strata (§3.10).

---

## 5. Proposal: declarative `BattleData` vs engine code

### 5.1 Principles
Content (who, where, when, how many, color, text) → data. Technique (meshes, instancing, bounce, particles, arcs, headings, terrain height) → engine code with parameters. `update(t)` evaluates all tracks at t, stateless; randomness only through a seeded hash. Pins and camera live in common `Chapter` fields; pins reference engine entities (`anchor:{entity:"ships",index:6,offset:[0,1.9,0]}`) instead of a switch.

### 5.2 Sketch
```ts
type Vec2 = [number, number];          // x, z
type Vec3 = [number, number, number];
type Ease = "linear" | "inOutQuad" | "inOutCubic";
type Key<T> = { at: number; value: T; ease?: Ease };   // hold until next key; ease = transition into it

interface BattleData {
world: {
  extent: { x: [number, number]; z: [number, number] };
  ground: { color: string };
  sea?: { xMax: number; color: string; nightColor?: string };
  beach?: { x: number; width: number; color: string };
  islands?: { id: string; at: Vec2; radius: number; height: number; color: string }[];
  mountains?: { at: Vec2; radius: number; height: number; color: string }[];
  rivers?: { id: string; points: Vec2[]; halfWidth: number; color: string }[];
  hills?: { id: string; at: Vec2; topRadius: number; footRadius: number; height: number; color: string }[];
};
sides: { id: string; name: string; color: string; helmetColor: string; shieldColor: string; pinClass?: "a" | "t" }[];
cities?: CityParams[];
places: Record<string, Vec2 | Vec3>;            // "gate", "gateOut", "tenedosHide"…
formations: Record<string, Formation>;
armies: Army[];
vehicles: Vehicle[];                             // ships, chariots
figures: Figure[];                               // heroes, display warrior
props: Prop[];                                   // wooden horse, podium, huts
effects: Effect[];                               // arrows, fire, strata, cityFade
lighting: { night: Key<number>[] };              // 0 day .. 1 night, per chapter
status?: { from: number; to: number; text: string; counter?: { from: number; to: number; min: number; max: number } }[];
}

interface CityParams {
id: string; center: Vec2; hillId?: string;
wall: { radius: number; height: number; thickness: number; segments: number; color: string };
towers: { every: number; size: [number, number]; color: string; flankGate: boolean };
gate: { angle: number; width: number; leafColor: string; open: Key<number>[] };
houses: { count: number; innerR: number; outerR: number; seed: number; colors: string[] };
palace?: { offset: Vec2; size: Vec3; color: string; roofColor: string };
}

type Formation =
| { type: "grid"; perRow: number; spacing: number | Vec2; facing: number; rowStagger?: number; anchor: "front" | "center" }
| { type: "arc"; cityId: string; from: number; to: number; skipNear?: { angle: number; width: number } }
| { type: "onVehicles"; vehicles: string; slotsAlong: number; spacingAlong: number; sideOffset: number };

interface Army {
id: string; side: string; count: number;
phases: {
  chapter: string;
  subset?: [number, number];                       // e.g. elite 0..9, pullers 0..29
  track: (
    | { at: number; place: { formation: string; origin: Vec2 } | { onVehicle: string } | "hidden" }
    | { from: number; to: number; move: { formation: string; origin: Vec2 } | { toPlace: string } | { onVehicle: string } | { attachTo: string; offsetFormation: string };
        stagger?: { by: "column" | "row" | "index"; spread: number }; ease?: Ease; thenHidden?: boolean }
  )[];
  melee?: { from: number; to: number; rows: number; amplitude: number };
  casualties?: { rows: number; fraction: number; from: number; to: number; seed: number };
  hideWhenPast?: { x: number };
}[];
}

interface Vehicle {
id: string; type: "ship" | "chariot"; side: string; count: number; scale?: number;
slots?: Record<string, { origin: Vec2; perIndex: Vec2; mod?: Vec2 }>;
tracks: { chapter: string; keys: Key<string | Vec2>[]; visible?: [number, number][] }[];
// engine: heading from path derivative, sail while moving, bob when afloat, wheels/legs while moving
}

interface Figure {
id: string; model: "warrior"; side?: string; tunic: string; crest: string; scale: number;
tracks: { chapter: string; path: Path; visible?: [number, number][]; fallAt?: number }[];
anchors?: Record<string, Vec3>;
spin?: { amplitude: number; freq: number };
}
type Path =
| { type: "keys"; keys: Key<Vec2>[] }
| { type: "polyline"; points: Vec2[]; from: number; to: number; ease?: Ease; constantSpeed: true }
| { type: "orbit"; center: Vec2; radius: number; startAngle: number; turns: number; from: number; to: number; lead?: number }
| { type: "sway"; at: Vec2; amplitude: number; freq: number };

interface Prop { id: string; model: "woodenHorse" | "podium" | "hut" | "chariot"; at?: Vec2; path?: Path; grow?: { from: number; to: number }; visible?: Record<string, [number, number][]> }

type Effect =
| { type: "arrows"; chapter: string; from: number; count: number; source: { cityWall: string }; target: { x: [number, number]; z: [number, number] }; period: [number, number]; arc: number }
| { type: "fire"; chapter: string; ramp: [number, number]; center: Vec2; radius: number; height: number; particles: number; light: boolean }
| { type: "cityFade"; chapter: string; cityId: string; ramp: [number, number] }
| { type: "strata"; chapter: string; cityId: string; layers: { id: string; label: string; color: string }[];
    growFrom: number; growStep: number; growDur: number; glow?: { layer: string; from: number } };
```
Notes: `grid` with `perRow 25, spacing 0.55, facing +x, anchor front` = `lineA`. Hold-last-key + eased transitions reproduce `seg/E/lerp`. Per-soldier stagger must be expressible (it is what makes movement look alive). `status` replaces JS functions ("Anno {n} di assedio" with counter 6→22 over 1..10; "Giro {n} di 3…"). Pins: `Pin.anchor` = static Vec3 or `{entity,index?,anchor?,offset}`, `Pin.visible: [from,to][]` instead of `cond`; support `side` and `style:"sea"` and `sub`. Chapter also needs `chip` (short name) and `dates`.

### 5.3 Stays engine code
Procedural builders (warrior, horse, chariot, ship, city pieces, huts, podium), canvas textures, 6-part instanced soldier and color mapping, `hY` from hills, bounce, melee oscillation, fall animation, derivative headings, sail/bob, wheel/leg animation, arrow parabola, fire particles + flicker, night lerp of sky/fog/lights, city transparency, strata meshes + glow, deterministic hash.

### 5.4 What generalizes to `timeline`
- The whole **player** (voice hold, highlight, tap-to-jump, scrubber with sentence marks, pins with windows + pulse, info card, both quiz types, deep dives, tour, camera keys with userCam/Centra, status pill, Mito/Storia tags, voice fallback) is engine-agnostic.
- The **strata** sequence is already a timeline: ordered events along an axis, appearing one per step, labelled with a date sub-label, one emphasized (glow). Reusable as "events along a line/stack: appear time, symbol mesh, label, date, emphasis".
- `status` counters, `cityFade`-style fades, day/night lighting keys and keyframed props are useful for any engine.

---

## 6. Appendix A — complete content (verbatim)

`t` in chapter seconds; positions `[x,y,z]` in world units; Italian text verbatim.

### A.1 Page-level texts
```json
{
"documentTitle": "Micenei e Troia",
"eyebrow": "Storia · Le civiltà dell'Egeo",
"h1": "I Micenei",
"hudBadgeInitial": "Pagina riconosciuta",
"kindLabels": { "myth": "Mito", "hist": "Storia" },
"buttons": {
  "recenter": "Centra", "tour": "Visita guidata", "tourStop": "Ferma la visita",
  "play": "Guarda e ascolta", "pause": "Pausa", "voiceSwitch": "Voce",
  "infoListen": "Ascolta", "infoClose": "Chiudi",
  "deepSummary": "Approfondisci", "deepListen": "Ascolta l'approfondimento",
  "quizShowAnswer": "Mostra la risposta", "quizNext": "Domanda successiva", "quizResult": "Vedi il risultato",
  "quizRestart": "Ricomincia", "quizNextChapter": "Capitolo successivo: {chip}"
},
"aria": { "stage": "Ricostruzione 3D animata", "panel": "Spiegazione e domande", "chips": "Capitoli",
          "tlPlay": "Avvia", "tlPause": "Pausa", "tlRange": "Momento della simulazione" },
"sentenceTooltip": "Vai a questo momento",
"timeFormat": "m:ss / m:ss (initial '0:00 / 0:30')",
"quiz": { "heading": "Domande", "progress": "{i} di {n}", "doneProgress": "{score}/{n}",
          "pickHint": "Rispondi toccando un'etichetta sulla scena 3D.",
          "done": "Hai risposto bene a {score} domande su {n}.",
          "right": "Giusto!", "wrong": "Non proprio.", "wrongPickSpeech": "No, questo è: {pinName}. Riprova." },
"voiceNote": "La voce non è disponibile in questo browser: la simulazione evidenzia il testo frase per frase.",
"webglFail": "Il tuo browser non supporta la grafica 3D (WebGL). Spiegazioni, voce e domande funzionano comunque.",
"footer": "Ricostruzione didattica semplificata. Le scene sulla guerra di Troia seguono il racconto dei poemi (Iliade, Odissea, Eneide) e sono segnate come «Mito»; non sappiamo come si svolsero davvero le battaglie. Le parti segnate «Storia» si basano sui reperti archeologici.",
"speechRewrites": [["a.C.","avanti Cristo"],["VIIa","sette A"],["VIII secolo","ottavo secolo"],["Troia I","Troia uno"],["Troia VI","Troia sei"],["Troia IX","Troia nove"]],
"infoCardSpeech": "{name}. {info}",
"infoCardTitle": "{name} · {sub}  (or {name})"
}
```

### A.2 Chapters

#### 1 — `micenei`
```json
{
"id": "micenei", "chip": "Chi erano", "kind": "hist", "dates": "1600–1100 a.C. circa",
"title": "Un popolo di guerrieri", "duration": 30,
"narration": [
  { "at": 0,   "text": "I Micenei vissero in Grecia tra il 1600 e il 1100 a.C., nell'età del bronzo.", "highlight": [] },
  { "at": 5.5, "text": "Il loro nome viene da Micene, la città più potente, protetta da mura fatte di massi enormi.", "highlight": [] },
  { "at": 11,  "text": "Erano un popolo di guerrieri: guarda come si armava un soldato miceneo.", "highlight": [] },
  { "at": 15,  "text": "In testa portava un elmo coperto di zanne di cinghiale e sul corpo un'armatura di bronzo.", "highlight": ["elmo","armatura"] },
  { "at": 21,  "text": "Si proteggeva con un grande scudo di pelle a forma di otto e combatteva con la lancia.", "highlight": ["scudo","lancia"] },
  { "at": 26,  "text": "I capi andavano in battaglia su carri a due ruote trainati da cavalli.", "highlight": ["carro"] }
],
"camera": [ { "at": 0, "position": [-2.2, 2.0, 16.6], "target": [-4.2, 0.85, 11.8] } ],
"status": null,
"deep": [
  "Le mura di Micene sono dette «ciclopiche»: i Greci vissuti dopo pensavano che solo i giganti Ciclopi potessero spostare massi così grandi.",
  "All'ingresso di Micene c'è la Porta dei Leoni, costruita intorno al 1250 a.C.",
  "Per un solo elmo servivano le zanne di decine di cinghiali: era un oggetto prezioso, che passava di padre in figlio.",
  "A Dendra, in Grecia, è stata trovata un'armatura di bronzo completa di circa 3.400 anni fa. Era molto pesante.",
  "I Micenei scrivevano su tavolette d'argilla con la Lineare B, una forma antichissima di greco. Alcune tavolette sono elenchi di carri, ruote e armature."
],
"quiz": [
  { "type": "choice", "q": "In quale età vissero i Micenei?", "options": ["Età della pietra","Età del bronzo","Età del ferro"], "answer": 1, "explain": "Usavano il bronzo, una lega di rame e stagno." },
  { "type": "pick", "q": "Tocca lo scudo a forma di otto.", "answerPins": ["scudo"], "explain": "Lo scudo a otto era di pelle di bue su un telaio di legno." },
  { "type": "choice", "q": "Di che cosa era coperto l'elmo miceneo?", "options": ["Piume d'aquila","Zanne di cinghiale","Scaglie di pesce"], "answer": 1, "explain": "File di placchette ricavate da zanne di cinghiale." }
]
}
```

#### 2 — `sbarco`
```json
{
"id": "sbarco", "chip": "Lo sbarco", "kind": "myth", "dates": "circa 1200 a.C., secondo il mito",
"title": "Mille navi verso Troia", "duration": 27,
"narration": [
  { "at": 0,  "text": "Secondo un antico racconto, i Micenei, che Omero chiama Achei, partirono con più di mille navi per attaccare Troia.", "highlight": ["navi"] },
  { "at": 7,  "text": "Troia era una città ricca sulla costa dell'attuale Turchia, vicino allo stretto dei Dardanelli.", "highlight": ["troia"] },
  { "at": 13, "text": "Il motivo della guerra, secondo il mito, fu il rapimento di Elena, moglie del re di Sparta Menelao, da parte del principe troiano Paride.", "highlight": [] },
  { "at": 21, "text": "Le navi arrivarono sulla spiaggia e i guerrieri costruirono un accampamento.", "highlight": ["campo"] }
],
"camera": [
  { "at": 0,  "position": [-4, 10, 22], "target": [-16, 0, 0] },
  { "at": 11, "position": [-1, 7, 13],  "target": [-8, 0, 0] }
],
"status": null,
"deep": [
  "Iliade e Odissea sono attribuite a Omero e furono composte intorno all'VIII secolo a.C., circa 400 anni dopo i fatti che raccontano.",
  "Nel «Catalogo delle navi» dell'Iliade sono elencate più di mille navi, città per città.",
  "Le navi erano lunghe e strette, con molti rematori e una vela quadrata. Arrivate a terra, venivano tirate in secca sulla spiaggia."
],
"quiz": [
  { "type": "choice", "q": "Come chiama Omero i Micenei?", "options": ["Achei","Troiani","Fenici"], "answer": 0, "explain": "Nei poemi li chiama Achei, Danai o Argivi." },
  { "type": "choice", "q": "Secondo il mito, perché scoppiò la guerra?", "options": ["Per il rapimento di Elena","Per una lite sul grano","Per un terremoto"], "answer": 0, "explain": "Paride rapì Elena, moglie di Menelao." },
  { "type": "pick", "q": "Tocca la città di Troia.", "answerPins": ["troia"], "explain": "Troia è la città sulla collina." }
]
}
```

#### 3 — `assedio`
```json
{
"id": "assedio", "chip": "L'assedio", "kind": "myth", "dates": "dieci anni, secondo il mito",
"title": "Dieci anni sotto le mura", "duration": 24,
"narration": [
  { "at": 0,   "text": "Il re di Micene, Agamennone, guidava l'esercito acheo.", "highlight": ["achei"] },
  { "at": 4.5, "text": "Troia però era protetta da mura altissime, e i Troiani lanciavano frecce dall'alto.", "highlight": ["mura"] },
  { "at": 11,  "text": "Gli Achei non riuscivano a entrare: secondo la leggenda, l'assedio durò dieci anni.", "highlight": [] },
  { "at": 17,  "text": "Intorno alla città si combatteva spesso, nella pianura attraversata dal fiume Scamandro.", "highlight": ["scamandro"] }
],
"camera": [
  { "at": 0, "position": [-6, 11, 17], "target": [5, 0.8, 0] },
  { "at": 8, "position": [0, 6, 11],   "target": [8, 1.5, -1] }
],
"status": { "text": "Anno {n} di assedio", "n": "clamp(1 + floor((t-6)/16*10), 1, 10)", "visibleWhen": "t > 6" },
"deep": [
  "Agamennone era il fratello di Menelao, il marito di Elena.",
  "Secondo l'Iliade gli Achei vivevano in capanne vicino alle navi, protette da un muro e da un fossato.",
  "Le mura di Troia scoperte dagli archeologi erano di pietra, con torri, e spesse diversi metri."
],
"quiz": [
  { "type": "choice", "q": "Quanto durò l'assedio, secondo la leggenda?", "options": ["Un anno","Dieci anni","Cento anni"], "answer": 1, "explain": "Dieci anni." },
  { "type": "choice", "q": "Chi guidava l'esercito acheo?", "options": ["Agamennone","Ettore","Paride"], "answer": 0, "explain": "Agamennone, re di Micene." },
  { "type": "pick", "q": "Tocca il fiume della pianura di Troia.", "answerPins": ["scamandro"], "explain": "È lo Scamandro." }
]
}
```

#### 4 — `scontro`
```json
{
"id": "scontro", "chip": "La battaglia", "kind": "myth", "dates": "decimo anno di guerra, secondo l'Iliade",
"title": "Battaglia nella pianura", "duration": 39,
"narration": [
  { "at": 0,  "text": "Ecco come poteva svolgersi una battaglia nella pianura di Troia.", "highlight": [] },
  { "at": 4,  "text": "I Troiani escono dalle Porte Scee e si schierano davanti alla città.", "highlight": ["porte","troiani"] },
  { "at": 9,  "text": "I carri da guerra portano i capi in prima linea; poi gli eroi scendono e combattono a piedi.", "highlight": ["carro"] },
  { "at": 15, "text": "Le file dei fanti si scontrano con lance e scudi.", "highlight": ["achei","troiani"] },
  { "at": 20, "text": "Alla fine i Troiani si ritirano dentro le mura.", "highlight": [] },
  { "at": 24, "text": "Solo Ettore, il principe di Troia, resta fuori ad aspettare Achille, il più forte degli Achei.", "highlight": ["ettore","achille"] },
  { "at": 30, "text": "Nell'Iliade Achille insegue Ettore per tre volte intorno alle mura, poi lo sconfigge in duello.", "highlight": ["ettore","achille"] }
],
"camera": [
  { "at": 0,  "position": [-4, 8.5, 15],   "target": [2, 0.3, 0] },
  { "at": 20, "position": [1, 13, 19],     "target": [10, 0.5, 0] },
  { "at": 34, "position": [2.8, 3.2, 5.2], "target": [6, 0.5, 0] }
],
"status": { "text": "Giro {n} di 3 intorno alle mura", "n": "clamp(1 + floor((t-26)/8*3), 1, 3)", "visibleWhen": "26 <= t < 34" },
"deep": [
  "Nell'Iliade i carri servono soprattutto a portare l'eroe sul campo: lui scende e combatte a piedi, mentre l'auriga aspetta.",
  "Achille era arrabbiato con Agamennone e per molto tempo rifiutò di combattere. Tornò in battaglia dopo la morte dell'amico Patroclo, ucciso da Ettore.",
  "L'Iliade racconta solo poche settimane del decimo anno di guerra e finisce con il funerale di Ettore.",
  "Questa simulazione è una ricostruzione: non sappiamo come fosse schierato davvero un esercito miceneo."
],
"quiz": [
  { "type": "choice", "q": "A che cosa servivano i carri, nei racconti di Omero?", "options": ["A portare i capi in prima linea","A trasportare il cibo","A sfondare le mura"], "answer": 0, "explain": "Portavano gli eroi sul campo di battaglia." },
  { "type": "pick", "q": "Tocca il principe di Troia che affronta Achille.", "answerPins": ["ettore"], "explain": "È Ettore, figlio del re Priamo." },
  { "type": "choice", "q": "Come si chiama il poema di Omero sulla guerra di Troia?", "options": ["Iliade","Eneide","Divina Commedia"], "answer": 0, "explain": "L'Iliade, da Ilio, l'altro nome di Troia." }
]
}
```

#### 5 — `cavallo`
```json
{
"id": "cavallo", "chip": "Il cavallo", "kind": "myth", "dates": "fine della guerra, secondo il mito",
"title": "L'inganno del cavallo", "duration": 41,
"narration": [
  { "at": 0,  "text": "Dopo dieci anni di assedio, Ulisse ebbe un'idea: costruire un enorme cavallo di legno, vuoto all'interno.", "highlight": ["cavallo"] },
  { "at": 7,  "text": "Alcuni guerrieri si nascosero dentro, mentre le navi fingevano di partire e si nascondevano dietro l'isola di Tenedo.", "highlight": ["tenedo","navi"] },
  { "at": 14, "text": "I Troiani pensarono a un dono degli dei e trascinarono il cavallo dentro la città.", "highlight": ["cavallo"] },
  { "at": 23, "text": "Di notte i guerrieri uscirono dal cavallo e aprirono le porte.", "highlight": ["porte"] },
  { "at": 28, "text": "L'esercito acheo, tornato in silenzio, entrò a Troia e la città fu incendiata.", "highlight": ["troia"] },
  { "at": 35, "text": "Questo episodio non è nell'Iliade: lo raccontano l'Odissea e, molto più tardi, il poeta latino Virgilio nell'Eneide.", "highlight": [] }
],
"camera": [
  { "at": 0,  "position": [-1.5, 5, 9],  "target": [-7, 1, 0] },
  { "at": 8,  "position": [-10, 9, 30],  "target": [-28, 0, 12] },
  { "at": 15, "position": [-8, 9, 13],   "target": [0, 0.5, 0] },
  { "at": 22, "position": [3.5, 6.5, 9], "target": [10.5, 1.8, 0] },
  { "at": 27, "position": [-6, 10, 16],  "target": [4, 0.8, 0] },
  { "at": 33, "position": [2, 9, 14],    "target": [12, 1.5, 0] }
],
"status": { "text": "Notte", "visibleWhen": "t >= 20.5" },
"deep": [
  "Nell'Eneide il sacerdote Laocoonte avverte i Troiani: «Temo i Greci anche quando portano doni».",
  "Cassandra, figlia del re Priamo, prediceva il futuro, ma nessuno le credeva.",
  "Ancora oggi «cavallo di Troia» indica un inganno nascosto dentro qualcosa di innocuo, anche un virus per computer."
],
"quiz": [
  { "type": "choice", "q": "Chi ebbe l'idea del cavallo di legno?", "options": ["Achille","Ulisse","Agamennone"], "answer": 1, "explain": "Ulisse, famoso per la sua astuzia." },
  { "type": "pick", "q": "Tocca l'isola dietro cui si nascosero le navi.", "answerPins": ["tenedo"], "explain": "È l'isola di Tenedo." },
  { "type": "choice", "q": "In quale poema di Omero si parla del cavallo?", "options": ["Nell'Iliade","Nell'Odissea","In nessuno dei due"], "answer": 1, "explain": "Nell'Odissea. L'Iliade finisce prima." }
]
}
```

#### 6 — `storia`
```json
{
"id": "storia", "chip": "Mito o storia?", "kind": "hist", "dates": "dal 1870 a oggi",
"title": "Che cosa hanno trovato gli archeologi", "duration": 34,
"narration": [
  { "at": 0,  "text": "Ma la guerra di Troia è davvero avvenuta?", "highlight": [] },
  { "at": 4,  "text": "Nel 1870 l'archeologo tedesco Heinrich Schliemann iniziò a scavare una collina in Turchia, chiamata Hisarlik, e trovò i resti di Troia.", "highlight": ["hisarlik"] },
  { "at": 12, "text": "Sotto terra c'erano tante città costruite una sopra l'altra, in più di tremila anni.", "highlight": ["l1","l9"] },
  { "at": 18, "text": "Uno degli strati, chiamato Troia VIIa, fu distrutto da un incendio intorno al 1180 a.C., più o meno all'epoca del mito.", "highlight": ["l7"] },
  { "at": 26, "text": "Gli storici pensano che dietro la leggenda ci sia forse il ricordo di guerre vere, ma molti dettagli sono stati inventati dai poeti.", "highlight": [] }
],
"camera": [
  { "at": 0,  "position": [2, 6, 11],      "target": [13, 1.6, 0] },
  { "at": 11, "position": [4.2, 4.2, 6.5], "target": [12, 2.7, 0] }
],
"status": { "text": "Strati di Troia, dal più antico (in basso)", "visibleWhen": "t >= 12" },
"deep": [
  "Schliemann scavò in fretta e distrusse parte degli strati più recenti per arrivare a quelli antichi.",
  "A Micene trovò una maschera d'oro che chiamò «maschera di Agamennone», ma è più antica di circa 300 anni rispetto all'epoca della guerra.",
  "Documenti degli Ittiti, un popolo dell'Anatolia, parlano di una città chiamata Wilusa e di un popolo chiamato Ahhiyawa: forse sono Ilio, cioè Troia, e gli Achei.",
  "Intorno al 1200 a.C. i palazzi micenei furono distrutti. Le cause non sono sicure: guerre, terremoti, carestie.",
  "Il sito di Troia è patrimonio dell'UNESCO dal 1998."
],
"quiz": [
  { "type": "choice", "q": "Chi scoprì i resti di Troia?", "options": ["Heinrich Schliemann","Omero","Virgilio"], "answer": 0, "explain": "Schliemann, a partire dal 1870." },
  { "type": "choice", "q": "Come sono disposte le città trovate a Hisarlik?", "options": ["Una accanto all'altra","Una sopra l'altra","Sott'acqua"], "answer": 1, "explain": "Ogni nuova città fu costruita sopra i resti della precedente." },
  { "type": "pick", "q": "Tocca lo strato distrutto all'epoca della guerra di Troia.", "answerPins": ["l7"], "explain": "È Troia VIIa, distrutta intorno al 1180 a.C." }
]
}
```

### A.3 Pins (23, L315–337)
`side` a = Achaean (blue dot), t = Trojan (red dot); `style:"sea"` = centered italic uppercase text; `visible` = extra condition (ignored during pick questions).
```json
[
{ "id": "elmo", "name": "Elmo a zanne di cinghiale", "chapters": ["micenei"], "anchor": { "entity": "displayWarrior", "local": [0, 1.12, 0] },
  "info": "Placchette ricavate da zanne di cinghiale, cucite su un berretto di cuoio. Omero lo descrive nell'Iliade." },
{ "id": "armatura", "name": "Armatura di bronzo", "chapters": ["micenei"], "anchor": { "entity": "displayWarrior", "local": [0.06, 0.74, 0.15] },
  "info": "Armatura a piastre di bronzo, simile a quella trovata a Dendra. Proteggeva il busto, le spalle e il collo." },
{ "id": "scudo", "name": "Scudo a otto", "chapters": ["micenei"], "anchor": { "entity": "displayWarrior", "local": [-0.1, 0.64, 0.28] },
  "info": "Grande scudo di pelle di bue tesa su un telaio di legno. Copriva quasi tutto il corpo." },
{ "id": "lancia", "name": "Lancia", "chapters": ["micenei"], "anchor": { "entity": "displayWarrior", "local": [0.24, 1.6, 0.04] },
  "info": "Lunga lancia con la punta di bronzo: era l'arma principale del guerriero." },
{ "id": "carro", "name": "Carro da guerra", "chapters": ["micenei","scontro"], "visible": "always in micenei; in scontro 8 < t < 17",
  "anchor": "micenei: [-3.2, 1.05, 11.4] (display chariot); scontro: chariots[0] (Achaean, z=-7.6) + [0, 0.75, 0]",
  "info": "Carro leggero a due ruote trainato da due cavalli. Portava un guerriero e un auriga che guidava." },
{ "id": "navi", "name": "Navi achee", "side": "a", "chapters": ["sbarco","cavallo"], "anchor": "ships[6] x,z with y = 1.9 (follows the ship)",
  "info": "Navi lunghe e strette, a remi e con una vela quadrata. Omero le chiama «nere navi»." },
{ "id": "troia", "name": "Troia", "side": "t", "chapters": ["sbarco","assedio","scontro","cavallo"], "anchor": [13.3, 2.9, 0],
  "info": "Città fortificata su una collina vicino al mare, nell'attuale Turchia. I resti si trovano a Hisarlik." },
{ "id": "egeo", "name": "Mar Egeo", "style": "sea", "chapters": ["sbarco"], "anchor": [-22, 0, -4],
  "info": "Il mare tra la Grecia e la Turchia, che i Micenei attraversavano con le loro navi." },
{ "id": "campo", "name": "Accampamento acheo", "side": "a", "chapters": ["sbarco","assedio"], "visible": "sbarco: t > 19; assedio: always", "anchor": [-8.6, 0.8, -7],
  "info": "Secondo l'Iliade gli Achei vivevano in capanne vicino alle navi tirate in secca." },
{ "id": "mura", "name": "Mura di Troia", "chapters": ["assedio"], "anchor": [9.711, 2.5, 2.770], "anchorFormula": "[13+cos(π-0.7)*4.3, TOP+WALL_H+0.15, sin(π-0.7)*4.3]",
  "info": "Mura di pietra con torri, alte e spesse. Dall'alto i Troiani lanciavano frecce." },
{ "id": "achei", "name": "Achei", "side": "a", "chapters": ["assedio","scontro"], "anchor": "Achaean soldier #12 + [0, 0.65, 0] (front row centre; not a casualty)",
  "info": "L'esercito acheo: guerrieri venuti da molte città della Grecia, guidati da Agamennone." },
{ "id": "troiani", "name": "Troiani", "side": "t", "chapters": ["scontro"], "visible": "5 < t < 21", "anchor": "Trojan soldier #12 (global 162) + [0, 0.65, 0]; this soldier falls at t≈17.09",
  "info": "L'esercito troiano con i suoi alleati, guidato da Ettore." },
{ "id": "scamandro", "name": "Scamandro", "chapters": ["assedio"], "anchor": [2, 0.05, -10.1],
  "info": "Il fiume della pianura di Troia. Nell'Iliade si combatte spesso sulle sue rive." },
{ "id": "porte", "name": "Porte Scee", "chapters": ["scontro","cavallo"], "anchor": [8.7, 2.6, 0],
  "info": "La porta principale di Troia nei poemi di Omero." },
{ "id": "ettore", "name": "Ettore", "side": "t", "chapters": ["scontro"], "visible": "t >= 20", "anchor": "hector + [0, 1.0, 0] (+0.35 when fallen)",
  "info": "Figlio del re Priamo e il più forte dei Troiani. Difendeva la sua città e la sua famiglia." },
{ "id": "achille", "name": "Achille", "side": "a", "chapters": ["scontro"], "visible": "t >= 22", "anchor": "achilles + [0, 1.0, 0]",
  "info": "Il più forte degli Achei. Secondo il mito era invulnerabile, tranne che nel tallone." },
{ "id": "cavallo", "name": "Cavallo di legno", "chapters": ["cavallo"], "visible": "t > 2", "anchor": "horse + [0, 3.1*horse.scale.y, 0]",
  "info": "Il cavallo di legno ideato da Ulisse, con i guerrieri nascosti nella pancia." },
{ "id": "tenedo", "name": "Tenedo", "chapters": ["cavallo"], "anchor": [-37, 2.3, 18.5],
  "info": "Piccola isola davanti a Troia. Secondo il mito le navi achee si nascosero dietro di essa." },
{ "id": "hisarlik", "name": "Collina di Hisarlik", "chapters": ["storia"], "visible": "t < 12", "anchor": [7.4, 1.1, 0],
  "info": "La collina in Turchia dove si trovano i resti di Troia." },
{ "id": "l1", "name": "Troia I", "sub": "circa 3000 a.C.", "chapters": ["storia"], "visible": "t > 11.5", "anchor": [8.8, 1.55, 0],
  "info": "Il villaggio fortificato più antico, di circa 5.000 anni fa." },
{ "id": "l6", "name": "Troia VI", "sub": "mura potenti", "chapters": ["storia"], "visible": "t > 15", "anchor": [8.8, 3.10, 0],
  "info": "Una città ricca con mura potenti, danneggiata forse da un terremoto intorno al 1300 a.C." },
{ "id": "l7", "name": "Troia VIIa", "sub": "circa 1180 a.C.", "chapters": ["storia"], "visible": "t > 15.6", "anchor": [8.8, 3.41, 0],
  "info": "Distrutta da un incendio intorno al 1180 a.C.: è una delle candidate principali per la Troia del mito." },
{ "id": "l9", "name": "Troia IX", "sub": "età romana", "chapters": ["storia"], "visible": "t > 16.8", "anchor": [9.0, 4.03, 0],
  "info": "La città greca e poi romana di Ilio, costruita sopra tutte le altre." }
]
```

### A.4 Strata
```json
{
"layers": [
  { "k": 0, "label": "Troia I",    "color": "#7d5b3a", "pin": "l1" },
  { "k": 1, "label": "Troia II",   "color": "#8d6a45" },
  { "k": 2, "label": "Troia III",  "color": "#9c7a51" },
  { "k": 3, "label": "Troia IV",   "color": "#7a6650" },
  { "k": 4, "label": "Troia V",    "color": "#a8865a" },
  { "k": 5, "label": "Troia VI",   "color": "#b39a6e", "pin": "l6" },
  { "k": 6, "label": "Troia VII(a)", "color": "#c4572e", "pin": "l7", "glowFrom": 18 },
  { "k": 7, "label": "Troia VIII", "color": "#8f7b5f" },
  { "k": 8, "label": "Troia IX",   "color": "#cbb68c", "pin": "l9" }
],
"geometry": "cylinder rTop 4.2-0.06k, rBottom 4.25-0.06k, h 0.3, centre y 1.55+0.31k, at (13,·,0), 40 segs",
"grow": "scale.y = inOutQuad(seg(t, 11.5+0.6k, 12.1+0.6k))",
"glow": "layer 6 emissive (p, 0.25p, 0), p = 0.25+0.25 sin(4t), t > 18",
"cityFade": "opacity = 1 - seg(t, 8, 11.5) (walls, towers, gate, houses, palace; hill stays)"
}
```
Labels II–V and VIII never appear on screen (implied by order only).

### A.5 Static world layout
```json
{
"constants": { "TROY": [13,0], "TOP": 1.4, "WALL_R": 4.3, "WALL_H": 0.95, "GATE": [8.7,0], "GATE_OUT": [6.4,0],
               "hY": "r = dist to (13,0): r<=4.6 → 1.4; r<6.6 → 1.4*(6.6-r)/2; else 0" },
"ground": { "size": [72,110], "center": [26.5,0], "color": "#b8a46c" },
"beach": { "size": [3.4,110], "center": [-8.3,0], "y": 0.004, "color": "#e2d3a2" },
"sea": { "size": [80,110], "center": [-50,0], "y": -0.02, "color": "#2d6f9c", "night": "#15324a", "phong": { "shininess": 70, "specular": "#6fa8cc" } },
"tenedos": { "center": [-37,-0.05,18.5], "radius": 5, "scaleY": 0.42, "color": "#8f8a5a" },
"idaCones": [ { "at": [42,-14], "r": 10, "h": 7 }, { "at": [50,6], "r": 13, "h": 9 }, { "at": [38,22], "r": 8, "h": 5 } ], "idaColor": "#9a9473",
"scamander": { "points": [[26,-17],[16,-11.5],[6,-9.6],[-2,-10.6],[-9.6,-12.5]], "halfWidth": 0.45, "y": 0.012, "samples": 80, "color": "#3d7fb3" },
"hill": { "center": [13,0], "topR": 4.6, "footR": 6.6, "height": 1.4, "segments": 48, "color": "#a8945f" },
"city": {
  "wall": { "radius": 4.3, "segments": 24, "skipped": [12], "height": 0.95, "thickness": 0.36, "color": "#d3c19a" },
  "towers": { "segments": [1,4,7,10,11,13,16,19,22], "size": [0.62,1.4,0.62], "color": "#c2ad83" },
  "gate": { "pivots": [[8.7,1.4,-0.55],[8.7,1.4,0.55]], "leaf": [0.12,0.855,0.55], "color": "#6b4a2b", "maxAngle": 1.35 },
  "houses": { "count": 46, "ring": [0.9,3.5], "w": [0.35,0.8], "h": [0.22,0.57], "d": [0.35,0.8], "colors": ["#e7dcc6","#d9c8a8","#efe7d8"], "skip": "x < 10.4 && |z| < 0.9", "rng": "R(i,7..12)" },
  "palace": { "center": [13.3,1.8,0], "size": [1.6,0.8,1.2], "color": "#e9dfcc", "roof": { "size": [1.7,0.06,1.3], "y": 2.23, "color": "#9b4a22" } }
},
"campHuts": { "count": 16, "pos": "x = -9.2+(i%2)*0.5, z = -11+1.45i", "body": [0.6,0.32,0.5], "bodyColor": "#9c8462", "roof": "4-sided cone r0.48 h0.32 #cdb47c" },
"display": { "podium": { "center": [-4.8,0,12], "r": [1.25,1.35], "h": 0.16, "color": "#e8e2d6" },
             "warrior": { "local": [-0.35,0.16,0.1], "scale": 1.45, "tunic": "#2c5fa6", "crest": "#c0392b", "spin": "rotation.y = 0.7 sin(0.35t)" },
             "chariot": { "world": [-3.2,0,11.4], "yaw": "0.62π", "scale": 1.15, "panel": "#b3542a", "horse": "#d8d0c4" } },
"heroes": { "achilles": { "tunic": "#2c5fa6", "crest": "#f1c232", "scale": 0.7 }, "hector": { "tunic": "#b3342a", "crest": "#f1c232", "scale": 0.7 } },
"battleChariots": [ { "k": 0, "panel": "#2c5fa6", "horse": "#e7dfd2" }, { "k": 1, "panel": "#2c5fa6", "horse": "#e7dfd2" }, { "k": 2, "panel": "#b3342a", "horse": "#6b4a33" }, { "k": 3, "panel": "#b3342a", "horse": "#6b4a33" } ],
"lights": { "hemi": ["#fff6e8","#8a7a60",0.65], "sun": ["#fff1d6",0.8,[-10,16,8]], "moon": ["#7f9cff",0,[10,12,-10]], "fireLight": ["#ff7a2a",0,16,[13,3.6,0]] },
"sky": { "day": "#cfdde6", "night": "#0b1426", "fog": [45,115] },
"camera": { "fov": 40, "near": 0.05, "far": 200, "start": [-1.4,2.2,15.8], "startTarget": [-4.8,0.9,12] }
}
```

### A.6 Movement keyframes per chapter
`walk(A→B, t0..t1)` = inOutQuad move facing travel direction. Positions `[x,z]`.
```
campA(i)    = [-8.0 + 0.42*floor(i/15), (i%15-7)*0.62 + (floor(i/15)%2)*0.3]
lineA(i,fx) = [fx - 0.55*floor(i/25), (i%25-12)*0.55]
lineT(j,fx) = [fx + 0.55*floor(j/24), (j%24-11.5)*0.55]
wallT(j)    = a = π-1.25+2.5*j/119 (|a-π|<0.09 → a+=0.18); [13+4.3cos a, 4.3 sin a], y 2.35, yaw atan2(cos a, sin a)
BEACH(s)    = [-11, (s-5.5)*1.55]      FAR(s) = [-34-(s%3)*1.4, (s-5.5)*2.2-2]      HIDE(s) = [-42.5+(s%4)*0.6, 17.5+(s%3)*0.9]
onShip(i)   = ship i%12, k=floor(i/12): along (k-6)*0.14 on heading, side ((k%2)-0.5)*0.17, y 0.32+bob
```
```json
{
"micenei": { "ships": "BEACH(s), sails hidden", "achaeans": "all campA(i)", "trojans": "all wallT(j)", "display": "visible", "gate": "closed" },
"sbarco": {
  "ships": [ { "from": 0, "to": 10, "walk": "FAR(s) → BEACH(s)" } ],
  "achaeans": [ { "until": "st = 11+(i%25)/25*4", "pose": "onShip(i)" }, { "from": "st", "to": "st+3.2", "walk": "onShip(i) → campA(i)", "faceAfter": "+x" } ],
  "trojans": "wallT(j)"
},
"assedio": {
  "ships": "BEACH(s)",
  "achaeans": [ { "from": "(i%25)/25*1.5", "to": "5.5+(i%25)/25*1.5", "walk": "campA(i) → lineA(i,3.0)", "faceAfter": "+x" } ],
  "trojans": "wallT(j)",
  "arrows": { "visibleFrom": 4, "count": 70, "source": "wallT(floor(R(k,30)*120)), y+0.3", "target": "[1.6+R(k,33)*1.8, (R(k,34)-0.5)*12], y 0.2", "period": "2.2+R(k,31)", "phase": "R(k,32)*period", "arc": 2.4 }
},
"scontro": {
  "ships": "BEACH(s)",
  "gate": "open 3.5–4.5, close 12–13, open 19.5–20.5, close 23.5–24.5",
  "achaeans": [
    { "until": 10, "pose": "lineA(i,-3)" },
    { "from": 10, "to": 14, "walk": "lineA(i,-3) → lineA(i,0.75)" },
    { "from": 14, "to": 20, "melee": "rows 0-1: x += 0.1 sin(6t+i)" },
    { "from": 20, "to": 24, "walk": "lineA(i,0.75) → lineA(i,3.6)" },
    { "casualties": "rows 0-1, R(i,3)<0.18 → i=4,5,14,17,36,37,48; fall at 15.5+R(i,4)*4 over 0.4 s; stay at lineA(i,0.75) + frozen jitter" }
  ],
  "trojans": [
    { "until": "te = 4+(j/120)*4.5", "pose": "hidden" },
    { "from": "te", "to": "te+1.6", "walk": "GATE → lineT(j,4.6)", "faceAfter": "-x" },
    { "from": 10, "to": 14, "walk": "lineT(j,4.6) → lineT(j,1.25)" },
    { "from": 14, "to": 20, "melee": "rows 0-1: x -= 0.1 sin(6t+j)" },
    { "casualties": "rows 0-1, R(j,5)<0.18 → j=4,5,6,12,17,19,20,22,25,35,38; fall at 15.5+R(j,6)*4 over 0.4 s; lie at lineT(j,1.25)" },
    { "from": "tr = 20+(j%24)/24*1.5", "to": "tr+2.5", "walk": "lineT(j,1.25) → GATE", "then": "hidden" }
  ],
  "chariots": {
    "achaean": "k0 z=-7.6, k1 z=+7.6: until 9 at [-6,z] facing +x; 9–12.5 → [0.4,z]; 12.5–15.5 → [-5.5,0.9z]; then hold facing +x",
    "trojan": "k2 z=-8.4 start [6.4,-0.8], k3 z=+8.4 start [6.4,0.8]: visible from 8.2; 9–12.5 → [2.2,z]; 12.5–15.5 → [6.2,0.6z]; hold facing -x; 19–20.5 → GATE [8.7,0] facing -x; hidden from 20.5",
    "anim": "moving: wheels rotation.x = 9t; horse legs 0.6 sin(14t+1.7n)"
  },
  "hector": [ "visible from 20", "until 26: [6.2,0.3] facing -x",
              "26–34: orbit centre [13,0] r 7.4, θ = π + seg(t,26,34)*6π + 0.38 (first 4% blended from start pos)",
              "from 34: [6.1+0.06 sin 5t, 0.35] facing -x", "from 37: fall tilt → -π/2 over 0.5 s" ],
  "achilles": [ "visible from 22", "until 22: [3.6,0]", "22–26: → [5.2,0] eased, facing +x",
                "26–34: orbit θ = π + seg*6π (first 4% blended)", "from 34: [5.45+0.15 max(0,sin 5t), 0.35] facing +x" ],
  "orbitYaw": "atan2(-sin θ, cos θ)"
},
"cavallo": {
  "night": "seg(t,18,21.5)",
  "gate": "open 13.5–14.5, close 22.3–23, open 24.6–25.6 and stay open",
  "horse": [ "visible t>1 at [-7,0]", "1–5.5: scale.y inOutQuad 0→1 (min 0.01)",
             "16.5–22.2: constant-speed polyline [-7,0]→[6.4,0]→[8.7,0]→[11.4,0], seg lengths 13.4/2.35/2.7, inOutQuad overall, y = hY" ],
  "ships": [ "until 9: BEACH", "9–14: BEACH → HIDE", "14–21: HIDE", "21–26: HIDE → BEACH" ],
  "achaeansElite_0_9": [ "until 23 hidden (inside horse)",
                         "23–25: [horse.x+((i%5)-2)*0.25, horse.z+(i<5?-0.5:0.5)] → [9.3, ((i%5)-2)*0.25], y 1.4, facing -x; then stay" ],
  "achaeansMain_10_149": [ "until 6: campA(i)", "6–8.6: campA → onShip", "8.6–26: onShip (ride to Tenedos and back)",
                           "t0 = 26+(i%25)/25*1.5 … t0+3.5: onShip(at t=26) → [6.4-0.5*floor(i/25), ((i%25)-12)*0.3]",
                           "t1 = t0+3.5+0.35*floor(i/25) … t1+1.2: → GATE [8.7,0], then hidden" ],
  "trojansPullers_0_29": [ "offset [1.7+0.32*floor(j/6), ((j%6)-2.5)*0.32]", "until 14: wallT(j)",
                           "14–16.5: GATE → [-7+off.x, off.z] (hidden until 14.05)",
                           "16.5–22.2: horse + offset, facing +x, bouncing until 22; hidden once horse.x+off.x > 9.0",
                           "from 22.2 hidden" ],
  "trojansOther_30_119": [ "until 20.5: wallT(j)", "from 20.5 hidden" ],
  "fire": "ramp 29–33; 420 particles; disc r=sqrt(R(i,21))*3.6, a=R(i,22)*2π; y = 1.6 + ((0.7t+R(i,23))%1)*2.2*fire; light fire*(3+0.6 sin 13t)"
},
"storia": { "ships": "hidden", "soldiers": "hidden", "horse": "hidden", "cityFade": [8,11.5], "strata": "A.4" }
}
```
Common per frame: bounce `|sin(11t+i)|*0.025` when moving; ship bob `0.03 sin(1.6t+s)` if `x<-11.2`; sail visible while moving; `y=null` → `hY`.

### A.7 Every number / date shown
| Where | Value |
|---|---|
| micenei | 1600–1100 a.C. circa; "tra il 1600 e il 1100 a.C."; Porta dei Leoni ~1250 a.C.; Dendra ~3.400 anni fa; "decine di cinghiali"; carri "a due ruote" |
| sbarco | circa 1200 a.C.; più di mille navi; VIII secolo a.C.; circa 400 anni dopo |
| assedio | dieci anni; status "Anno 1..10 di assedio" |
| scontro | decimo anno; tre volte; "Giro 1..3 di 3"; poche settimane |
| cavallo | dopo dieci anni |
| storia | dal 1870 a oggi; 1870; più di tremila anni; Troia VIIa ~1180 a.C.; maschera ~300 anni più antica; ~1200 a.C. distruzione dei palazzi; UNESCO dal 1998 |
| pins | Troia I circa 3000 a.C. / circa 5.000 anni fa; Troia VI ~1300 a.C.; Troia VIIa circa 1180 a.C.; Troia IX età romana; carro "due ruote", "due cavalli" |
| quiz | Un anno / Dieci anni / Cento anni; "a partire dal 1870"; ~1180 a.C. |
| UI | durations 0:30, 0:27, 0:24, 0:39, 0:41, 0:34; score x/3 |

---

## 7. Appendix B — quality bar

### B.1 Visual identity (CSS L8–148)
- Palette "Mycenaean pottery on buff clay + Aegean": `--bg #ecebe6`, `--surface #fff`, `--surface-2 #f4f2ee`, `--ink #2a211b`, `--muted #6c625a`, `--line #ddd7cf`, `--clay #9b4a22` (primary), `--aegean #1f5d86`, `--hl #f6dfb0`, `--ok #2e7d46`, `--bad #b8392a`, `--myth #7a3fa0`, `--hist #1f6d5e`; dark variants (clay `#e07a48`, hl `#5b4320`, bg `#15120f`).
- Fonts: **Cinzel** 600/800 for H1/H2, status pill, info-card title, quiz/deep headings; **Atkinson Hyperlegible** body (16/1.5; narration 17/1.6); **IBM Plex Mono** 500 for times, progress, pin sub-labels, kicker.
- Shapes: pills everywhere (999px), cards 18px, stage 22px, soft shadows `0 1px 3px rgba(0,0,0,.15)`; meander divider under H1 (L97–100).
- Labels: white 93% pill, bold 12.5px, shadow, 2px stem 12px, side dot; sea labels italic uppercase `#e8f3fb`, ls .14em, text-shadow.
- Feedback: pulse (scale 1.22, 1.1s ×2), shake (±6px 0.4s), dashed clay outline in pick mode, green outline on right, `color-mix` tinted options.
- A11y: focus-visible 3px clay, aria labels, `aria-live` quiz, reduced motion, tabular numerals, `text-wrap:balance`, safe-area insets, `touch-action:none` on canvas.

### B.2 3D look
Warm soft shadowless low-poly diorama: hemi warm/brown 0.65 + warm sun 0.8 upper-left; Lambert; antialias; DPR ≤2; fog = sky color 45→115 so edges dissolve. Sky `#cfdde6` (also stage bg); night `#0b1426` + bluish moon 0.35, darker sea. Materials: bronze `#b98a3e`, skin `#cf9a6e`, ivory `#efe6cf`, leather `#5a4430`, Achaean blue `#2c5fa6`, Trojan red `#b3342a`, stone `#d3c19a`/`#c2ad83`, clay roof `#9b4a22`, pitch ships `#2b231e`, cream sail with red stripes, sand `#e2d3a2`, plain `#b8a46c`. Canvas textures (hide spots, sail stripes, soft fire sprite), no image assets.

### B.3 Motion
All scene moves inOutQuad, never linear jumps; camera 1.8s inOutCubic. Life details: column/row staggers (ripple), walk bounce, melee jitter, falling soldiers, wheels/gallop only while moving, sails only while sailing, bob only afloat, path-following ship headings, swinging gate leaves, horse rising as "built" and climbing the slope, heroes circling, Hector falling, display warrior turning slowly, city fading, strata growing one by one with VIIa glowing, rising fire with flickering light, arrows arcing continuously. Scene waits for voice at sentence boundaries; labels pulse when named; camera re-frames on subject change.

### B.4 Interaction feel
Tapping a pin pauses and explains (card + voice). The user's orbit always overrides the automatic camera until "Centra". Mobile: stacked layout, stage ≥300px/52%, camera pulled back ×1.3 when the stage is under 520px wide, pins culled 15% outside the viewport. The tour moves chapter to chapter with a 1.3s pause. Quizzes are always reachable and speak their feedback.

---

## 8. Surprises and hacks
1. No AR/WebXR/camera/recognition; "Pagina riconosciuta" badge is fake.
2. three r128 + legacy `examples/js` OrbitControls: not portable as-is (modules; sRGB/light defaults changed in r152+).
3. Scene deterministic in t (sin-hash, no `Math.random`), but **camera history-dependent** (step keys + tween from current pose).
4. Pins: hard-coded `switch`, side-channel positions (`SOLD[]`), `cond` closures read global chapter; no occlusion.
5. Hidden instances = scale-0 matrices; all 270 soldiers processed every frame in every chapter.
6. "troiani" pin follows a soldier who dies at t≈17.1 (label floats over him until t=21).
7. Achaean casualty x uses `lerp(-3,.75,1) - row*.55 + jitter` (= `lineA(i,0.75).x` + frozen jitter) (L624).
8. Wall Trojans near the gate shifted +0.18 rad → overlap (L590).
9. `_shipsCache` declared, never used (L673).
10. No-3D fallback throws in `flyTo` at each camera-key change.
11. After a scrub, resume does not re-speak the current sentence; pause kills the utterance mid-sentence.
12. Entering a chapter whose quiz cursor is on a `pick` question enables pick mode during narration.
13. `#era`/`#dates` ids swapped in meaning.
14. Horse polyline segment length 2.35 approximates the true 2.3 (harmless).
