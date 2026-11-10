// Sets only `sounds` (per chapter) and `music` (scene) of grammatica-indicativo.scene.json.
// The file does not round-trip through JSON.stringify (it has literals like 3.0 and CRLF line ends),
// so the fields are replaced textually and the rest of the file stays byte-for-byte.
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2];
const FILE = path.join(ROOT, "fixtures/public/scenes/grammatica-indicativo.scene.json");

const amb = (sound, volume, window) => ({ sound, ...(volume !== undefined ? { volume } : {}), ...(window ? { window } : {}) });
const cue = (at, sound, volume) => ({ at: Math.round(at * 100) / 100, sound, ...(volume !== undefined ? { volume } : {}) });
const seq = (from, step, n, sound, volume) => Array.from({ length: n }, (_, k) => cue(from + k * step, sound, volume));
void amb;

// One row of "ausiliare + participio": aux appears, participle appears, moves and snaps, result appears.
const row = (aux) => [
  cue(aux, "pop", 0.35),
  cue(aux + 0.9, "pop", 0.35),
  cue(aux + 1.5, "whoosh", 0.35),
  cue(aux + 2.5, "click", 0.5),
  cue(aux + 2.8, "pop", 0.3),
  cue(aux + 3.5, "chime", 0.3),
];

const MUSIC = { track: "music-playful", volume: 0.55 };
const SOUNDS = {
  "otto-tempi": {
    ambience: [],
    cues: [
      cue(0.1, "pop", 0.4),
      cue(5, "whoosh-soft", 0.5),
      ...seq(8, 0.3, 2, "pop", 0.4),
      cue(12, "whoosh", 0.4),
      ...seq(12.2, 0.3, 4, "pop", 0.3),
      cue(19, "chime", 0.3),
      cue(24, "whoosh", 0.4),
      ...seq(24.2, 0.3, 4, "pop", 0.3),
      cue(33, "chime", 0.3),
      cue(40, "chime", 0.3),
      cue(40.4, "pop", 0.3),
      cue(46, "pop", 0.35),
      cue(47.6, "pop", 0.35),
    ],
  },
  "come-si-forma": {
    ambience: [],
    cues: [
      ...seq(0, 0.35, 3, "pop", 0.4),
      cue(7, "whoosh", 0.35),
      cue(7.7, "click", 0.5),
      cue(11, "sparkle", 0.35),
      cue(12.5, "pop", 0.4),
      ...row(16),
      ...row(23),
      ...row(30),
      ...row(37),
      cue(45, "sparkle", 0.3),
      cue(45.6, "pop", 0.3),
      cue(45.9, "pop", 0.3),
      cue(46.8, "chime", 0.3),
      cue(52, "sparkle", 0.3),
      cue(54, "chime", 0.35),
    ],
  },
  analisi: {
    ambience: [],
    cues: [
      cue(0, "pop", 0.4),
      ...seq(6.5, 0.35, 5, "pop", 0.3),
      cue(12, "whoosh", 0.4),
      cue(19, "wrong", 0.35),
      cue(22.5, "correct", 0.4),
      cue(26, "wrong", 0.35),
      cue(27, "pop", 0.3),
      cue(27.5, "chime", 0.25),
      cue(31, "correct", 0.4),
      cue(34, "wrong", 0.35),
      cue(37.5, "correct", 0.4),
      cue(40.6, "sparkle", 0.4),
      cue(46, "whoosh", 0.4),
      ...seq(46.5, 0.3, 3, "pop", 0.25),
      cue(47.1, "click", 0.45),
      cue(52, "whoosh", 0.4),
      cue(53.5, "wrong", 0.35),
      cue(58, "correct", 0.4),
      cue(59, "sparkle", 0.4),
    ],
  },
};

/** Pretty JSON at a given base indent, 2 spaces per level, with the file's line end. */
function pretty(value, base, nl) {
  return JSON.stringify(value, null, 2).split("\n").map((l, i) => (i ? base + l : l)).join(nl);
}

let s = fs.readFileSync(FILE, "utf8");
const nl = s.includes("\r\n") ? "\r\n" : "\n";
const spec = JSON.parse(s);
const chapterAt = [];
const reCh = /"id": "([^"]+)",[ \t\r\n]*"title"/g;
for (let m; (m = reCh.exec(s)); ) chapterAt.push({ id: m[1], at: m.index });

// Replace each chapter's `"sounds": {...}` value (the block ends at the first line with its own indent + "}").
const reSounds = /^([ \t]*)"sounds": \{/gm;
const edits = [];
for (let m; (m = reSounds.exec(s)); ) {
  const indent = m[1];
  const owner = chapterAt.filter((c) => c.at < m.index).at(-1);
  if (!owner || !SOUNDS[owner.id]) throw new Error(`sounds block at ${m.index}: unknown chapter`);
  const valStart = m.index + m[0].length - 1;
  const close = s.indexOf(`${nl}${indent}}`, valStart);
  if (close < 0) throw new Error(`${owner.id}: end of sounds block not found`);
  edits.push({ from: valStart, to: close + nl.length + indent.length + 1, text: pretty(SOUNDS[owner.id], indent, nl), id: owner.id });
}
for (const e of edits.reverse()) s = s.slice(0, e.from) + e.text + s.slice(e.to);

// Scene music: replace if present, else insert after the top-level "kind" line.
if (/^  "music": /m.test(s)) throw new Error("music already present: edit by hand");
const km = /^  "kind": [^\r\n]*,\r?\n/m.exec(s);
const at = km.index + km[0].length;
s = s.slice(0, at) + `  "music": ${pretty(MUSIC, "  ", nl)},${nl}` + s.slice(at);

const check = JSON.parse(s);
for (const ch of check.chapters) {
  if (JSON.stringify(ch.sounds) !== JSON.stringify(SOUNDS[ch.id])) throw new Error(`${ch.id}: sounds not applied`);
}
if (JSON.stringify(check.music) !== JSON.stringify(MUSIC)) throw new Error("music not applied");
if (check.chapters.length !== spec.chapters.length) throw new Error("chapters changed");
fs.writeFileSync(FILE, s);
console.log("updated grammatica-indicativo:", edits.map((e) => e.id).join(", "));
