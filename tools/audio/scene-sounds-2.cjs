// Sets only `sounds` (per chapter) and `music` (scene) of racconto-elettricista and scienze-sensi.
// Both files round-trip exactly through JSON.stringify with their indent, so we parse, set, re-stringify.
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2];

const amb = (sound, volume, window) => ({ sound, ...(volume !== undefined ? { volume } : {}), ...(window ? { window } : {}) });
const cue = (at, sound, volume) => ({ at, sound, ...(volume !== undefined ? { volume } : {}) });
const many = (ats, sound, volume) => ats.map((t) => cue(Math.round(t * 100) / 100, sound, volume));

const DESIGN = {
  "racconto-elettricista": {
    indent: 1,
    music: { track: "music-playful", volume: 0.65 },
    chapters: {
      mattina: {
        ambience: [amb("city", 0.3), amb("crowd", 0.12)],
        cues: [
          cue(0.6, "footsteps", 0.4),
          cue(7.2, "wood-hit", 0.4),
          cue(10.8, "spark", 0.5),
          cue(11, "pop", 0.5),
          cue(13.2, "whistle", 0.55),
          cue(13.6, "spark", 0.4),
          cue(15.5, "explosion", 0.7),
          cue(15.55, "glass-break", 0.6),
          cue(16.4, "dog-bark", 0.4),
          cue(20, "spark", 0.4),
          ...many([20.2, 20.65, 21.1, 21.55], "beep", 0.35),
          cue(25.4, "spark", 0.4),
          cue(25.8, "pop", 0.4),
          cue(30.8, "spark", 0.4),
          cue(31, "pop", 0.5),
        ],
      },
      mezzogiorno: {
        ambience: [amb("city", 0.3), amb("crowd", 0.12), amb("electric-hum", 0.5, [10, 15.4])],
        cues: [
          cue(3, "footsteps", 0.4),
          cue(5.6, "footsteps", 0.35),
          cue(13.5, "spark", 0.5),
          cue(14.4, "short-circuit", 0.5),
          cue(15, "whoosh-soft", 0.8),
          cue(15.3, "sparkle", 0.5),
          cue(20.2, "footsteps", 0.4),
          cue(28.2, "wood-hit", 0.4),
          cue(33.2, "wood-hit", 0.7),
          cue(33.3, "metal-clank", 0.4),
        ],
      },
      pomeriggio: {
        ambience: [amb("city", 0.3), amb("electric-hum", 0.45, [1, 8.5])],
        cues: [
          cue(1, "spark", 0.4),
          ...many([2.1, 3.4, 4.6, 6.2], "click", 0.3),
          cue(8.5, "switch", 0.5),
          cue(9, "whoosh", 0.35),
          cue(9.6, "whoosh", 0.35),
          cue(10.8, "spark", 0.4),
          cue(11, "pop", 0.5),
          ...many([27, 27.45, 27.9, 28.35, 28.8, 29.25, 29.7, 30.15, 30.6], "pop", 0.3),
        ],
      },
      notte: {
        ambience: [amb("night", 0.5), amb("city", 0.12, [0, 20]), amb("electric-hum", 0.3, [5, 13.5]), amb("forest", 0.4, [36, 44])],
        cues: [
          cue(5.6, "phone-ring", 0.5),
          cue(12.9, "short-circuit", 0.55),
          cue(14.5, "switch", 0.5),
          cue(19.5, "switch", 0.5),
          cue(19.8, "chime", 0.4),
          cue(23.2, "footsteps", 0.35),
          cue(26, "door-creak", 0.35),
          cue(27.3, "spark", 0.4),
          cue(27.6, "switch", 0.4),
          cue(38.5, "switch", 0.45),
          cue(38.7, "sparkle", 0.4),
        ],
      },
    },
  },
  "scienze-sensi": {
    indent: 2,
    music: { track: "music-curious", volume: 0.6 },
    chapters: {
      vista: {
        ambience: [],
        cues: [
          cue(25.6, "whoosh-soft", 0.4),
          cue(29, "pop", 0.35),
          cue(32, "chime", 0.3),
          cue(33.5, "chime", 0.3),
          cue(44, "pop", 0.35),
          cue(52, "sparkle", 0.4),
          cue(58, "chime", 0.4),
        ],
      },
      udito: {
        ambience: [amb("bubbling", 0.15, [54, 66])],
        cues: [cue(6.2, "bell", 0.4), cue(41, "sparkle", 0.4)],
      },
      tatto: {
        ambience: [amb("heartbeat", 0.2)],
        cues: [cue(18.5, "whoosh-soft", 0.35), ...many([28, 28.4, 28.8, 29.2], "pop", 0.25), cue(34.3, "pop", 0.35), cue(35.5, "sparkle", 0.4)],
      },
    },
  },
};

for (const [name, design] of Object.entries(DESIGN)) {
  const file = path.join(ROOT, "fixtures/public/scenes", `${name}.scene.json`);
  const before = fs.readFileSync(file, "utf8");
  const spec = JSON.parse(before);
  if (JSON.stringify(spec, null, design.indent) + "\n" !== before) throw new Error(`${name}: file does not round-trip, refusing to rewrite`);
  // Keep key order: `music` right after the top-level `kind`; `sounds` stays where it is or goes last.
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k === "music") continue;
    out[k] = v;
    if (k === "kind") out.music = design.music;
  }
  for (const ch of out.chapters) {
    const want = design.chapters[ch.id];
    if (!want) throw new Error(`${name}: no design for chapter ${ch.id}`);
    ch.sounds = want;
  }
  fs.writeFileSync(file, JSON.stringify(out, null, design.indent) + "\n");
  console.log("updated", name);
}
