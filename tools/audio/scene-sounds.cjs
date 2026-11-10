// Inserts/replaces only the `sounds` (per chapter) and `music` (scene) fields of the 4 fixture scenes,
// keeping the rest of each file byte-for-byte.
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2];

const amb = (sound, volume, window) => ({ sound, ...(volume !== undefined ? { volume } : {}), ...(window ? { window } : {}) });
const cue = (at, sound, volume) => ({ at, sound, ...(volume !== undefined ? { volume } : {}) });

const DESIGN = {
  campania: {
    music: { track: "music-calm", volume: 0.7 },
    chapters: {
      intro: { ambience: [amb("sea", 0.5), amb("wind", 0.25)], cues: [cue(0.2, "whoosh-soft", 0.6), cue(14.4, "chime", 0.5)] },
      rilievi: { ambience: [amb("wind", 0.6), amb("sea", 0.45, [20.5, 29.2])], cues: [cue(9.3, "chime", 0.5), cue(16.2, "chime", 0.5)] },
      vesuvio: {
        ambience: [amb("wind", 0.3), amb("rumble", 0.8, [5.5, 18]), amb("forest", 0.45, [14, 25.8])],
        cues: [cue(9, "eruption", 1), cue(14.6, "sparkle", 0.5)],
      },
      pianure: { ambience: [amb("forest", 0.35, [0, 20.5]), amb("river", 0.5, [20, 33.7]), amb("sea", 0.5, [28.5, 33.7])], cues: [] },
      isole: { ambience: [amb("sea", 0.7), amb("wind", 0.2)], cues: [cue(1.5, "seagull", 0.45), cue(10.5, "seagull", 0.35)] },
      eco: {
        ambience: [amb("forest", 0.35, [0, 19]), amb("sea", 0.5, [18.5, 23]), amb("machine", 0.35, [22.5, 30]), amb("crowd", 0.25, [33.5, 43])],
        cues: [cue(11.4, "sheep", 0.5), cue(19.5, "seagull", 0.4), cue(23.2, "metal-clank", 0.35), cue(43.2, "pop", 0.4)],
      },
      pop: { ambience: [amb("city", 0.35), amb("crowd", 0.25, [12.5, 24.7])], cues: [cue(9.6, "pop", 0.5), cue(13.3, "chime", 0.5)] },
    },
  },
  troia: {
    music: { track: "music-history", volume: 0.7 },
    chapters: {
      micenei: {
        ambience: [amb("wind", 0.3), amb("horses", 0.5, [25.5, 30])],
        cues: [cue(11.2, "whoosh", 0.5), cue(15.2, "metal-clank", 0.45), cue(21.2, "shield-hit", 0.6)],
      },
      sbarco: {
        ambience: [amb("sea", 0.7), amb("wind", 0.3), amb("marching", 0.5, [11, 16])],
        cues: [cue(1, "war-horn", 0.45), cue(7.5, "seagull", 0.4), cue(21.5, "wood-hit", 0.5), cue(22.4, "wood-hit", 0.45)],
      },
      assedio: {
        ambience: [amb("sea", 0.25), amb("marching", 0.5, [0, 6]), amb("battle", 0.35, [17, 24])],
        cues: [4.5, 7.5, 10.5, 13.6, 16.8, 20].map((t) => cue(t, "arrows", 0.6)),
      },
      scontro: {
        ambience: [amb("wind", 0.25), amb("marching", 0.5, [4, 10]), amb("horses", 0.6, [8.5, 15.5]), amb("battle", 0.7, [14, 20.5]), amb("marching", 0.4, [20, 23])],
        cues: [
          cue(4, "war-horn", 0.6),
          cue(14, "battle-clash", 0.9),
          cue(15.5, "sword-clash", 0.6),
          cue(16.2, "shield-hit", 0.5),
          cue(17, "sword-clash", 0.55),
          cue(18.6, "sword-clash", 0.6),
          cue(33.6, "sword-clash", 0.7),
          cue(34.2, "shield-hit", 0.6),
        ],
      },
      cavallo: {
        ambience: [amb("sea", 0.4, [0, 20]), amb("crowd", 0.35, [14, 19]), amb("night", 0.5, [19.5, 29]), amb("marching", 0.4, [26, 31]), amb("fire", 0.85, [28.5, 41]), amb("crowd", 0.3, [29.5, 36])],
        cues: [
          cue(1.5, "wood-hit", 0.5),
          cue(2.6, "wood-hit", 0.45),
          cue(3.8, "wood-hit", 0.5),
          cue(15, "door-creak", 0.5),
          cue(23.2, "door-creak", 0.55),
          cue(23.6, "footsteps", 0.5),
        ],
      },
      storia: {
        ambience: [amb("wind", 0.3)],
        cues: [cue(4.2, "page-turn", 0.6), ...Array.from({ length: 9 }, (_, k) => cue(Math.round((11.5 + 0.6 * k) * 10) / 10, "pop", 0.35)), cue(18.1, "sparkle", 0.5)],
      },
    },
  },
  "timeline-esempio": {
    music: { track: "music-history", volume: 0.6 },
    chapters: {
      re: { ambience: [], cues: [cue(4.5, "whoosh-soft", 0.6), cue(4.7, "chime", 0.45), cue(24, "pop", 0.4), cue(31.5, "whoosh-soft", 0.6)] },
      repubblica: {
        ambience: [amb("sea", 0.3, [25.5, 33])],
        cues: [cue(1, "whoosh-soft", 0.6), cue(1.2, "chime", 0.45), cue(13.5, "whoosh-soft", 0.6), cue(25.5, "whoosh-soft", 0.6), cue(33.5, "whoosh-soft", 0.6), cue(40.5, "whoosh-soft", 0.6)],
      },
      impero: {
        ambience: [],
        cues: [cue(1, "whoosh-soft", 0.6), cue(1.2, "chime", 0.45), cue(15.5, "whoosh-soft", 0.6), cue(24.5, "whoosh-soft", 0.6), cue(32.5, "whoosh-soft", 0.6), cue(32.7, "chime", 0.45)],
      },
    },
  },
  "card-esempio": { music: { track: "music-calm", volume: 0.6 }, chapters: {} },
};

for (const [name, design] of Object.entries(DESIGN)) {
  const file = path.join(ROOT, "fixtures/public/scenes", `${name}.scene.json`);
  let s = fs.readFileSync(file, "utf8");
  const nl = s.includes("\r\n") ? "\r\n" : "\n";
  // Drop previously inserted fields (idempotent).
  s = s.replace(/^[ \t]*"sounds": \{.*\},?\r?\n/gm, "").replace(/^  "music": \{.*\},?\r?\n/gm, "");
  const spec = JSON.parse(s);
  // Chapter fields: insert `sounds` right after the chapter's own "duration" line.
  const chStart = s.indexOf('"chapters": [');
  for (const ch of spec.chapters) {
    const sounds = design.chapters[ch.id];
    if (!sounds) continue;
    const re = new RegExp('"id": "' + ch.id + '",[ \\t\\r\\n]*"title"', "g");
    re.lastIndex = chStart;
    const idm = re.exec(s);
    const idAt = idm ? idm.index : -1;
    const m = /^([ \t]*)"duration": [^\r\n]*,\r?\n/m.exec(s.slice(idAt));
    if (idAt < 0 || !m) throw new Error(`${name}/${ch.id}: duration line not found`);
    const at = idAt + m.index + m[0].length;
    s = s.slice(0, at) + `${m[1]}"sounds": ${JSON.stringify(sounds)},${nl}` + s.slice(at);
  }
  // Scene field: after the top-level "kind" line.
  const km = /^  "kind": [^\r\n]*,\r?\n/m.exec(s);
  if (!km) throw new Error(`${name}: top-level kind not found`);
  const at = km.index + km[0].length;
  s = s.slice(0, at) + `  "music": ${JSON.stringify(design.music)},${nl}` + s.slice(at);
  const check = JSON.parse(s);
  for (const ch of check.chapters) {
    const want = design.chapters[ch.id];
    if (JSON.stringify(ch.sounds) !== JSON.stringify(want)) throw new Error(`${name}/${ch.id}: sounds landed in the wrong place`);
  }
  if (JSON.stringify(check.music) !== JSON.stringify(design.music)) throw new Error(`${name}: music`);
  fs.writeFileSync(file, s);
  console.log("updated", name);
}
