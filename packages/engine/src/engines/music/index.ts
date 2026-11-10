// `music` engine (Musica): a 3D staff standing on the page with the chapter's score, a playhead
// moving with the timeline, notes that light up and bounce as they sound, a keyboard whose keys
// press down in sync, beat tiles and note-length blocks (rhythm), procedural instrument models
// (timbre), a metronome with the tempo and a harmonic-spectrum panel (pitch, loudness, timbre).
// Schema, layout and anchors: packages/scene-spec/src/engines/music.ts.
//
// update(chapterId, t) is pure given the slider overrides: the score is musicScore(entry, overrides),
// the position in it comes from scorePosition(score, t) and everything is posed from that.
// The sound itself is the chapter's cues (musicCues); soundCues(chapterId) returns the cues for the
// current slider values so the player can play what the sliders show.
import * as THREE from "three";
import {
  FIGURES,
  figureName,
  keyboardRange,
  MUSIC_INSTRUMENTS,
  musicCues,
  musicScore,
  noteName,
  paramRange,
  pitchToFrequency,
  pitchToMidi,
  repStart,
  scorePosition,
  type Anchor,
  type MusicChapter,
  type MusicData,
  type MusicInstrument,
  type MusicOverrides,
  type MusicShowItem,
  type Score,
  type ScoreNote,
  type SceneSpec,
  type SoundCue,
} from "@pv/scene-spec";
import { decimalMark, defaultNoteNames } from "@pv/scene-spec/i18n";
import type { Engine, EngineContext, EngineParam } from "../../types.ts";
import { clamp, ease, seg } from "../../util/math.ts";
import { box, INK, mat, mesh, noteColor, TextPlane } from "./draw.ts";
import { drumModel, envelope, instrumentModel, metronomeModel, SPECTRA } from "./instruments.ts";
import { BOTTOM_STEP, bassClef, flat, lineY, noteGlyph, sharp, SHARED_GEOMETRIES, STAFF, stepOf, stepY, trebleClef, type NoteGlyph } from "./notation.ts";

const PAPER = "#f4efe6";
const BOARD = "#fbf8f0";
/** Space before the first note head, in scene units. */
const PAD = 0.5;
const NOTES_W = STAFF.notesX1 - STAFF.notesX0;
const Y = { names: 6.3, lyrics: 2.55, tiles: 1.78, blocks: 1.28, board0: 0.95, board1: 6.9 } as const;
const KEY = { w: 0.62, z0: 0.6, z1: 2.9, h: 0.3 } as const;
const INSTR_Z = 4.7;
const WAVE = { x: 4.3, y: 8.0, w: 7.2, h: 2.1, n: 180 } as const;
const PLAYHEAD = "#ff7a1a";

const key = <T extends THREE.Object3D>(o: T, on: boolean) => ((o.userData.key = on), o);

interface NoteView {
  note: ScoreNote;
  glyph: NoteGlyph;
  /** Rest scale of the head (it grows while sounding). */
  headBase: THREE.Vector3;
  headMat: THREE.MeshStandardMaterial;
  /** Score-space x of the head and y on the staff. */
  x: number;
  y: number;
  name: TextPlane | null;
  lyric: TextPlane | null;
  block: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; x0: number; x1: number } | null;
}

interface TileView {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  label: TextPlane | null;
  x0: number;
  x1: number;
  downbeat: boolean;
}

interface Layout {
  key: string;
  score: Score;
  /** Scene units per quarter beat. */
  S: number;
  group: THREE.Group;
  notes: NoteView[];
  bars: { mesh: THREE.Mesh; x: number }[];
  tiles: TileView[];
  width: number;
  /** Text planes owned by this layout (disposed when it is rebuilt). */
  texts: TextPlane[];
}

interface KeyView {
  pivot: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  base: string;
  x: number;
  white: boolean;
}

interface View {
  entry: MusicChapter;
  group: THREE.Group;
  bottom: number;
  shows: Map<MusicShowItem, [number, number][]>;
  layout: Layout | null;
  playhead: THREE.Mesh;
  keys: Map<number, KeyView> | null;
  instruments: Map<MusicInstrument, { group: THREE.Group; x: number; label: TextPlane }>;
  drum: THREE.Group | null;
  tempo: { group: THREE.Group; arm: THREE.Group; text: TextPlane; figure: TextPlane } | null;
  wave: { group: THREE.Group; line: THREE.Line; bars: THREE.Mesh[]; text: TextPlane } | null;
  state: { beat: number; playing: boolean; rep: number; sounding: NoteView | null; playheadX: number; off: number };
}

/** Scene units per beat so the shortest value still gets ~0.7 units. */
const spacingOf = (score: Score) => clamp(0.7 / Math.min(...score.notes.map((n) => n.beats)), 0.9, 2.6);

export type MusicEngine = Engine & {
  /** Instrument and metronome cues of the chapter for the current slider values (the chapter's own cues without overrides). */
  soundCues(chapterId: string): SoundCue[];
};

export function createMusicEngine(): MusicEngine {
  let ctx: EngineContext | null = null;
  let spec: SceneSpec | null = null;
  let world: THREE.Group | null = null;
  let lights: THREE.Light[] = [];
  let prevBackground: THREE.Scene["background"] = null;
  let views = new Map<string, View>();
  let texts: TextPlane[] = [];
  let overrides: Record<string, number> | null = null;
  let last = { chapter: "", t: Number.NaN, key: "" };
  let bound = { center: new THREE.Vector3(), radius: 1 };
  const inkMat = mat(INK, { roughness: 0.5 });
  const tmp = new THREE.Vector3();

  const text = (h: number, ink = INK, weight = 700, bg: string | null = null) => {
    const l = new TextPlane(ctx!, h, ink, weight, bg);
    texts.push(l);
    return l;
  };

  function ovOf(entry: MusicChapter): MusicOverrides {
    const ov: MusicOverrides = {};
    if (overrides) for (const p of entry.params ?? []) if (overrides[p.id] !== undefined) ov[p.kind] = overrides[p.id]!;
    return ov;
  }

  const ovKey = (entry: MusicChapter) => JSON.stringify(ovOf(entry));
  const visibleAt = (view: View, item: MusicShowItem, t: number) => (view.shows.get(item) ?? []).some(([a, b]) => t >= a && t < b);
  const durationOf = (chapterId: string) => spec?.chapters.find((c) => c.id === chapterId)?.duration ?? Infinity;

  // ------------------------------------------------------------ build

  function buildStaff(view: View): void {
    const g = view.group;
    const board = mat(BOARD, { roughness: 0.85 });
    g.add(box(STAFF.x1 - STAFF.x0 + 0.6, Y.board1 - Y.board0, 0.1, 0, (Y.board0 + Y.board1) / 2, -1.05, board, "board"));
    for (const x of [-6, 6]) g.add(box(0.12, Y.board1 - 0.3, 0.12, x, (Y.board1 - 0.3) / 2, -1.18, mat("#8a6a4a")));
    for (let k = 1; k <= 5; k++) g.add(box(STAFF.x1 - STAFF.x0, 0.03, 0.02, 0, lineY(k), -0.99, inkMat, `line-${k}`));
    for (const x of [STAFF.x0, STAFF.x1]) g.add(box(0.05, lineY(5) - lineY(1), 0.02, x, (lineY(1) + lineY(5)) / 2, -0.99, inkMat));
    const clef = view.entry.clef === "bass" ? bassClef(inkMat) : trebleClef(inkMat);
    clef.position.set(-7.25, view.entry.clef === "bass" ? lineY(4) : lineY(2), STAFF.z);
    g.add(clef);
    const [n, d] = view.entry.time ?? [4, 4];
    for (const [v, y] of [[n, (lineY(4) + lineY(5)) / 2 - 0.25], [d, (lineY(1) + lineY(2)) / 2 + 0.25]] as const) {
      const l = text(1.05, INK, 900);
      l.set(String(v));
      l.object.position.set(-6.25, y, -0.97);
      g.add(l.object);
    }
    view.playhead = key(box(0.07, 5.5, 0.02, 0, 0, 0, new THREE.MeshBasicMaterial({ color: PLAYHEAD, transparent: true, opacity: 0.75 }), "playhead"), true);
    view.playhead.position.set(0, 3.85, -0.93);
    g.add(view.playhead);
  }

  function buildKeyboard(view: View): void {
    const [lo, hi] = keyboardRange(view.entry);
    const g = new THREE.Group();
    g.name = "keyboard";
    const whites: number[] = [];
    for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
    const x0 = (-(whites.length - 1) * KEY.w) / 2;
    const keys = new Map<number, KeyView>();
    const depth = KEY.z1 - KEY.z0;
    whites.forEach((m, i) => {
      const material = mat("#fbfbf7", { roughness: 0.4 });
      const pivot = new THREE.Group();
      pivot.position.set(x0 + i * KEY.w, 0.05, KEY.z0);
      pivot.add(box(KEY.w - 0.04, KEY.h, depth, 0, KEY.h / 2, depth / 2, material, `key:${m}`));
      g.add(pivot);
      keys.set(m, { pivot, mat: material, base: "#fbfbf7", x: pivot.position.x, white: true });
      const l = text(0.22, "#5d6d7e", 700);
      l.set(noteName(`${"CDEFGAB"[[0, 2, 4, 5, 7, 9, 11].indexOf(m % 12)]}`, (view.entry.names ?? defaultNoteNames()) === "en" ? "en" : "it"));
      l.object.rotation.x = -Math.PI / 2;
      l.object.position.set(0, KEY.h + 0.01, depth - 0.3);
      pivot.add(l.object);
    });
    for (let m = lo; m <= hi; m++) {
      if (![1, 3, 6, 8, 10].includes(m % 12)) continue;
      const left = keys.get(m - 1);
      if (!left) continue;
      const material = mat("#1d1f24", { roughness: 0.35 });
      const pivot = new THREE.Group();
      pivot.position.set(left.x + KEY.w / 2, 0.05 + KEY.h, KEY.z0);
      pivot.add(box(KEY.w * 0.56, 0.22, depth * 0.6, 0, 0.11, (depth * 0.6) / 2, material, `key:${m}`));
      g.add(pivot);
      keys.set(m, { pivot, mat: material, base: "#1d1f24", x: pivot.position.x, white: false });
    }
    const w = whites.length * KEY.w + 0.5;
    g.add(box(w, 0.12, depth + 0.6, 0, 0.0, KEY.z0 + depth / 2 - 0.15, mat("#3b2f2a")));
    g.add(box(w, 0.6, 0.35, 0, 0.3, KEY.z0 - 0.2, mat("#3b2f2a")));
    view.group.add(g);
    view.keys = keys;
  }

  function buildInstruments(view: View): void {
    const palette = view.entry.instruments ?? ["piano"];
    palette.forEach((id, k) => {
      if (view.instruments.has(id)) return;
      const x = (k - (palette.length - 1) / 2) * 3.1;
      const group = instrumentModel(id);
      group.position.set(x, 0, INSTR_Z);
      const info = MUSIC_INSTRUMENTS[id];
      const label = text(0.34, INK, 750, "rgba(255,255,255,0.92)");
      label.set(`${info.it} · ${info.family}`);
      label.object.position.set(x, 0.3, INSTR_Z + 1.0);
      label.object.rotation.x = -0.7;
      view.group.add(group, label.object);
      view.instruments.set(id, { group, x, label });
    });
  }

  function buildTempo(view: View): void {
    const group = new THREE.Group();
    group.name = "tempo";
    group.add(box(2.2, 0.08, 0.9, -7.0, Y.board1 + 0.04, -0.9, mat("#8a6a4a")));
    const { group: met, arm } = metronomeModel();
    met.position.set(-7.0, Y.board1 + 0.08, -0.9);
    met.scale.setScalar(0.85);
    group.add(met);
    group.add(box(3.4, 1.1, 0.06, -4.3, Y.board1 + 0.65, -1.02, mat("#fffdf6")));
    const t = text(0.5, INK, 850);
    t.object.position.set(-4.3, Y.board1 + 0.85, -0.98);
    const f = text(0.34, "#5d6d7e", 700);
    f.object.position.set(-4.3, Y.board1 + 0.38, -0.98);
    group.add(t.object, f.object);
    view.group.add(group);
    view.tempo = { group, arm, text: t, figure: f };
  }

  function buildWave(view: View): void {
    const group = new THREE.Group();
    group.name = "wave";
    group.position.set(WAVE.x, WAVE.y, -1.0);
    group.add(box(WAVE.w, WAVE.h, 0.06, 0, 0, -0.03, mat("#1f2a36", { roughness: 0.9 })));
    group.add(box(3.6, 0.015, 0.01, -1.6, -0.15, 0.01, mat("#4a5a6a")));
    const line = key(new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(WAVE.n * 3), 3)), new THREE.LineBasicMaterial({ color: "#8dffa8" })), true);
    line.name = "waveform";
    line.frustumCulled = false;
    group.add(line);
    const bars = SPECTRA.piano.map((_, h) => {
      const b = key(box(0.22, 1, 0.04, 0, 0.5, 0.02, mat("#ffd166", { emissive: new THREE.Color("#ffd166"), emissiveIntensity: 0.3 }), `harmonic-${h + 1}`), true);
      b.position.set(1.0 + h * 0.33, -0.85, 0);
      group.add(b);
      return b;
    });
    const t = text(0.3, "#e8eef5", 700);
    t.object.position.set(0, WAVE.h / 2 - 0.25, 0.02);
    const sub = text(0.2, "#9fb0c0", 600);
    sub.set("armonici");
    sub.object.position.set(2.15, -0.95 + 0.0, 0.02);
    group.add(t.object, sub.object);
    view.group.add(group);
    view.wave = { group, line, bars, text: t };
  }

  function buildView(entry: MusicChapter): View {
    const group = new THREE.Group();
    group.name = `music:${entry.chapter}`;
    world!.add(group);
    const shows = new Map<MusicShowItem, [number, number][]>();
    for (const s of entry.show ?? []) {
      const w = shows.get(s.item) ?? [];
      w.push([s.at ?? 0, s.until ?? Infinity]);
      shows.set(s.item, w);
    }
    const view: View = {
      entry, group, bottom: BOTTOM_STEP[entry.clef ?? "treble"], shows, layout: null, playhead: null!, keys: null,
      instruments: new Map(), drum: null, tempo: null, wave: null,
      state: { beat: -1, playing: false, rep: 0, sounding: null, playheadX: 0, off: 0 },
    };
    buildStaff(view);
    if (shows.has("keyboard")) buildKeyboard(view);
    if (shows.has("instruments")) buildInstruments(view);
    if (shows.has("tempo")) buildTempo(view);
    if (shows.has("wave")) buildWave(view);
    if (shows.has("beats") && entry.metronome) {
      view.drum = drumModel();
      view.drum.position.set(-6.9, 0, 1.9);
      group.add(view.drum);
    }
    return view;
  }

  /** Notes, bar lines, labels, beat tiles and blocks of the score (rebuilt when transpose/value change). */
  function layoutScore(view: View, score: Score, k: string): Layout {
    if (view.layout?.key === k) {
      view.layout.score = score;
      return view.layout;
    }
    if (view.layout) {
      view.group.remove(view.layout.group);
      disposeTree(view.layout.group);
      for (const l of view.layout.texts) l.dispose();
    }
    const firstText = texts.length;
    const group = new THREE.Group();
    group.name = "score";
    const S = spacingOf(score);
    const middle = lineY(3);
    // Do Re Mi for Italian (and the other solfège languages), C D E otherwise (D21).
    const names = view.entry.names ?? defaultNoteNames();
    const notes: NoteView[] = score.notes.map((note) => {
      const x = PAD + note.beat * S;
      const step = note.pitch ? stepOf(note.pitch) : view.bottom + 4;
      const y = note.pitch ? stepY(step, view.bottom) : middle;
      const headMat = mat(INK, { roughness: 0.45, emissive: new THREE.Color("#000000") });
      const glyph = noteGlyph(note.beats, !note.pitch, step < view.bottom + 4, headMat, inkMat, middle, y);
      glyph.group.position.set(x, y, STAFF.z);
      glyph.group.name = `note:${note.index}`;
      if (note.pitch) {
        // Ledger lines below and above the staff.
        for (let s = view.bottom - 2; s >= step; s -= 2) glyph.group.add(box(0.9, 0.04, 0.02, 0, stepY(s, view.bottom) - y, -0.01, inkMat));
        for (let s = view.bottom + 10; s <= step; s += 2) glyph.group.add(box(0.9, 0.04, 0.02, 0, stepY(s, view.bottom) - y, -0.01, inkMat));
        const acc = note.pitch[1] === "#" ? sharp(inkMat) : note.pitch[1] === "b" ? flat(inkMat) : null;
        if (acc) {
          acc.position.set(-0.5, 0, 0);
          glyph.group.add(acc);
        }
      }
      group.add(glyph.group);
      let name: TextPlane | null = null;
      let lyric: TextPlane | null = null;
      if (note.pitch && view.shows.has("names")) {
        name = text(0.34, noteColor(note.pitch), 800);
        name.set(noteName(note.pitch, names));
        name.object.position.set(x, Y.names, -0.97);
        group.add(name.object);
      }
      if (note.lyric && view.shows.has("lyrics")) {
        lyric = text(0.32, "#3d4a58", 650);
        lyric.set(note.lyric);
        lyric.object.position.set(x, Y.lyrics, -0.97);
        group.add(lyric.object);
      }
      let block: NoteView["block"] = null;
      if (view.shows.has("beats")) {
        const bm = mat(noteColor(note.pitch), { roughness: 0.5, transparent: !note.pitch, opacity: note.pitch ? 1 : 0.35, emissive: new THREE.Color(noteColor(note.pitch)), emissiveIntensity: 0 });
        const m = mesh(new THREE.BoxGeometry(1, 0.26, 0.05).translate(0.5, 0, 0), bm, `block:${note.index}`);
        m.position.set(0, Y.blocks, -0.97);
        group.add(m);
        block = { mesh: m, mat: bm, x0: note.beat * S + 0.04, x1: (note.beat + note.beats) * S - 0.04 };
      }
      return { note, glyph, headBase: glyph.head.scale.clone(), headMat, x, y, name, lyric, block };
    });
    const bars: Layout["bars"] = [];
    for (let b = score.bar; b <= score.beats + 1e-9; b += score.bar) {
      const end = Math.abs(b - score.beats) < 1e-9;
      const m = box(end ? 0.1 : 0.04, lineY(5) - lineY(1), 0.02, 0, (lineY(1) + lineY(5)) / 2, -0.985, inkMat, end ? "final-bar" : "bar");
      group.add(m);
      bars.push({ mesh: m, x: b * S + 0.1 });
    }
    const tiles: TileView[] = [];
    if (view.shows.has("beats")) {
      const perBar = Math.round(score.bar / score.unit);
      for (let k = 0; k * score.unit < score.beats - 1e-9; k++) {
        const downbeat = k % perBar === 0;
        const tm = mat(downbeat ? "#e7dccb" : "#f1ebe0", { roughness: 0.7, emissive: new THREE.Color(PLAYHEAD), emissiveIntensity: 0 });
        const m = mesh(new THREE.BoxGeometry(1, 0.42, 0.06).translate(0.5, 0, 0), tm, `beat:${k}`);
        m.position.set(0, Y.tiles, -0.97);
        group.add(m);
        const label = text(0.26, "#5d6d7e", 800);
        label.set(String((k % perBar) + 1));
        label.object.position.set(0, Y.tiles, -0.93);
        group.add(label.object);
        tiles.push({ mesh: m, mat: tm, label, x0: k * score.unit * S + 0.05, x1: (k + 1) * score.unit * S - 0.05, downbeat });
      }
    }
    view.group.add(group);
    view.layout = { key: k, score, S, group, notes, bars, tiles, width: PAD * 2 + score.beats * S, texts: texts.splice(firstText) };
    return view.layout;
  }

  // ------------------------------------------------------------ pose

  /** Fits [x0, x1] (score space) into the note area at scroll `off`; hides it when outside. */
  function clipBar(m: THREE.Object3D, x0: number, x1: number, off: number): void {
    const a = Math.max(STAFF.notesX0 - 0.3, STAFF.notesX0 + x0 - off);
    const b = Math.min(STAFF.notesX1 + 0.2, STAFF.notesX0 + x1 - off);
    m.visible = b - a > 0.02;
    m.position.x = a;
    m.scale.x = Math.max(1e-3, b - a);
  }

  function pose(view: View, t: number): void {
    const entry = view.entry;
    const score = musicScore(entry, ovOf(entry));
    const L = layoutScore(view, score, JSON.stringify({ tr: ovOf(entry).transpose, v: ovOf(entry).value }));
    const pos = scorePosition(score, t);
    let beat = Math.max(0, pos.beat);
    // In the gap between repetitions the playhead sweeps back to the start.
    if (!pos.playing && pos.beat >= score.beats && pos.rep < score.repeat - 1 && score.gap > 0) {
      const end = repStart(score, pos.rep) + score.beats * score.spb;
      beat = score.beats * (1 - ease.inOutCubic(seg(t, end, end + score.gap * score.spb)));
    }
    const px = PAD + beat * L.S;
    const off = clamp(px - NOTES_W * 0.45, 0, Math.max(0, L.width - NOTES_W));
    const sounding = pos.playing ? (L.notes.find((n) => pos.beat >= n.note.beat && pos.beat < n.note.beat + n.note.beats) ?? null) : null;
    view.state = { beat: pos.beat, playing: pos.playing, rep: pos.rep, sounding, playheadX: STAFF.notesX0 + px - off, off };
    view.playhead.position.x = STAFF.notesX0 + px - off;
    view.playhead.visible = t >= score.start - 1 || pos.playing;

    const showNames = visibleAt(view, "names", t);
    const showLyrics = visibleAt(view, "lyrics", t);
    const showBeats = visibleAt(view, "beats", t);
    for (const nv of L.notes) {
      const wx = STAFF.notesX0 + nv.x - off;
      const inside = wx >= STAFF.notesX0 - 0.2 && wx <= STAFF.notesX1 + 0.2;
      const on = nv === sounding;
      const since = on ? (pos.beat - nv.note.beat) * score.spb : 1;
      const bump = on ? Math.sin(clamp(since / 0.32) * Math.PI) : 0;
      nv.glyph.group.visible = inside;
      nv.glyph.group.position.set(wx, nv.y + 0.18 * bump, STAFF.z + 0.25 * bump);
      nv.glyph.head.scale.copy(nv.headBase).multiplyScalar(1 + 0.4 * bump);
      const c = noteColor(nv.note.pitch);
      nv.headMat.color.set(on ? c : INK);
      nv.headMat.emissive.set(on ? c : "#000000");
      nv.headMat.emissiveIntensity = on ? 0.55 : 0;
      key(nv.glyph.group, on);
      if (nv.name) {
        nv.name.object.visible = inside && showNames;
        nv.name.object.position.set(wx, Y.names + 0.12 * bump, -0.97);
        key(nv.name.object, on);
      }
      if (nv.lyric) {
        nv.lyric.object.visible = inside && showLyrics;
        nv.lyric.object.position.x = wx;
      }
      if (nv.block) {
        clipBar(nv.block.mesh, nv.block.x0, nv.block.x1, off);
        nv.block.mesh.visible &&= showBeats;
        nv.block.mat.emissiveIntensity = on ? 0.5 : 0;
        key(nv.block.mesh, on);
      }
    }
    for (const b of L.bars) {
      const wx = STAFF.notesX0 + b.x - off;
      b.mesh.position.x = wx;
      b.mesh.visible = wx >= STAFF.notesX0 - 0.1 && wx <= STAFF.notesX1 + 0.3;
    }
    const tick = pos.playing ? Math.floor(pos.beat / score.unit + 1e-9) : -1;
    L.tiles.forEach((tile, k) => {
      clipBar(tile.mesh, tile.x0, tile.x1, off);
      tile.mesh.visible &&= showBeats;
      const on = k === tick;
      const since = on ? (pos.beat - k * score.unit) * score.spb : 1;
      tile.mat.emissiveIntensity = on ? 0.7 * (1 - clamp(since / 0.45)) + 0.2 : 0;
      tile.mesh.position.y = Y.tiles + (on ? 0.08 * Math.sin(clamp(since / 0.25) * Math.PI) : 0);
      key(tile.mesh, on);
      if (tile.label) {
        const cx = STAFF.notesX0 + (tile.x0 + tile.x1) / 2 - off;
        tile.label.object.position.x = cx;
        tile.label.object.visible = tile.mesh.visible && cx > STAFF.notesX0 && cx < STAFF.notesX1;
      }
    });
    if (view.drum) {
      view.drum.visible = showBeats;
      const since = tick >= 0 ? (pos.beat - tick * score.unit) * score.spb : 1;
      const hit = tick >= 0 ? 1 - clamp(since / 0.2) : 0;
      view.drum.scale.set(1 + 0.04 * hit, 1 - 0.03 * hit, 1 + 0.04 * hit);
      key(view.drum, hit > 0);
    }

    // Keyboard: the sounding key presses down and takes the note's colour.
    if (view.keys) {
      const visible = visibleAt(view, "keyboard", t);
      const midi = sounding?.note.pitch ? pitchToMidi(sounding.note.pitch) : null;
      for (const [m, k] of view.keys) {
        const on = m === midi;
        k.pivot.visible = visible;
        k.pivot.rotation.x = on ? 0.07 : 0;
        k.mat.color.set(on ? noteColor(sounding!.note.pitch) : k.base);
        key(k.pivot, on);
      }
      view.keys.values().next().value!.pivot.parent!.visible = visible;
    }

    // Instruments: the one playing this repetition stands raised and pulses with the notes.
    const active = score.instruments[pos.rep] ?? score.instruments[0]!;
    if (view.instruments.size) {
      const visible = visibleAt(view, "instruments", t);
      const since = sounding ? (pos.beat - sounding.note.beat) * score.spb : 1;
      const bump = sounding ? Math.sin(clamp(since / 0.25) * Math.PI) : 0;
      for (const [id, iv] of view.instruments) {
        const on = id === active;
        iv.group.visible = visible;
        iv.label.object.visible = visible;
        iv.group.position.set(iv.x, on ? 0.25 + 0.08 * bump : 0, INSTR_Z);
        iv.group.scale.setScalar(on ? 1.05 + 0.04 * bump : 0.78);
        iv.group.rotation.z = on && pos.playing ? 0.03 * Math.sin(pos.beat * Math.PI) : 0;
        key(iv.group, on);
      }
    }

    if (view.tempo) {
      const visible = visibleAt(view, "tempo", t);
      view.tempo.group.visible = visible;
      view.tempo.arm.rotation.z = pos.playing ? 0.42 * Math.cos(Math.PI * (pos.beat / score.unit)) : 0;
      key(view.tempo.arm, pos.playing);
      view.tempo.text.set(`♩ = ${Math.round(score.tempo)} bpm`);
      const shown = sounding ?? L.notes[0]!;
      view.tempo.figure.set(`${shown.note.pitch ? "" : "pausa · "}${figureName(shown.note.beats)} · ${num(shown.note.beats * score.spb)} s`);
    }

    if (view.wave) poseWave(view, t, score, active, sounding);
  }

  function poseWave(view: View, t: number, score: Score, instr: MusicInstrument, sounding: NoteView | null): void {
    const w = view.wave!;
    const visible = visibleAt(view, "wave", t);
    w.group.visible = visible;
    const spectrum = SPECTRA[instr];
    const pitch = sounding?.note.pitch ?? null;
    const f = pitch ? (pitchToFrequency(pitch) ?? 0) : 0;
    const tau = sounding ? (view.state.beat - sounding.note.beat) * score.spb : 0;
    const amp = sounding ? envelope(instr, tau, sounding.note.beats * score.spb) : 0;
    const cycles = clamp(f / 130.81, 0.5, 8);
    const norm = spectrum.reduce((s, a) => s + a, 0);
    const arr = (w.line.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < WAVE.n; i++) {
      const u = i / (WAVE.n - 1);
      let y = 0;
      spectrum.forEach((a, h) => (y += a * Math.sin(2 * Math.PI * (h + 1) * (cycles * u + t * 0.6))));
      arr[i * 3] = -3.4 + 3.6 * u;
      arr[i * 3 + 1] = -0.15 + (0.7 * amp * y) / norm;
      arr[i * 3 + 2] = 0.03;
    }
    w.line.geometry.getAttribute("position").needsUpdate = true;
    w.bars.forEach((b, h) => {
      b.scale.y = Math.max(0.02, spectrum[h]! * 1.3 * (sounding ? 0.35 + 0.65 * amp : 0.35));
      key(b, !!sounding);
    });
    const name = MUSIC_INSTRUMENTS[instr].it;
    w.text.set(pitch ? `${noteName(pitch, defaultNoteNames())}${pitch[pitch.length - 1]} · ${num(f, 1)} Hz · ${name}` : name);
  }

  function apply(chapterId: string, t: number): View | undefined {
    const view = views.get(chapterId);
    for (const [id, v] of views) v.group.visible = id === chapterId;
    if (!view) return undefined;
    last = { chapter: chapterId, t, key: ovKey(view.entry) };
    pose(view, t);
    return view;
  }

  function disposeTree(o: THREE.Object3D): void {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.geometry && !SHARED_GEOMETRIES.has(m.geometry)) geos.add(m.geometry);
      if (m.material) for (const y of Array.isArray(m.material) ? m.material : [m.material]) if (y !== inkMat) mats.add(y);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }

  // ------------------------------------------------------------ anchors

  function anchorOf(view: View, a: Extract<Anchor, { entity: string }>, out: THREE.Vector3): boolean {
    const L = view.layout!;
    const off = view.state.off;
    switch (a.entity) {
      case "note": {
        const nv = L.notes[Math.min(L.notes.length - 1, a.index ?? 0)];
        if (!nv) return false;
        out.copy(nv.glyph.group.position);
        out.x = STAFF.notesX0 + nv.x - off;
        return true;
      }
      case "staff": {
        const p = a.part;
        if (!p) out.set(0, lineY(3), STAFF.z);
        else if (p === "clef") out.set(-7.25, view.entry.clef === "bass" ? lineY(4) : lineY(2), STAFF.z);
        else if (p === "time") out.set(-6.25, lineY(3), STAFF.z);
        else if (p === "playhead") out.set(view.state.playheadX, lineY(5) + 0.6, STAFF.z);
        else if (p.startsWith("line-")) out.set(-4.6, lineY(Number(p.slice(5))), STAFF.z);
        else if (p.startsWith("space-")) out.set(-4.6, lineY(Number(p.slice(6))) + STAFF.gap / 2, STAFF.z);
        else return false;
        return true;
      }
      case "key": {
        const m = a.part ? pitchToMidi(a.part) : null;
        const k = m === null ? undefined : view.keys?.get(m);
        if (!k) return false;
        out.set(k.x, 0.05 + KEY.h * (k.white ? 1 : 2), KEY.z0 + (KEY.z1 - KEY.z0) * (k.white ? 0.75 : 0.35));
        return true;
      }
      case "beat": {
        const tile = L.tiles[a.index ?? 0];
        if (!tile) return false;
        out.set(STAFF.notesX0 + (tile.x0 + tile.x1) / 2 - off, Y.tiles, STAFF.z);
        return true;
      }
      case "instrument": {
        const iv = view.instruments.get(a.part as MusicInstrument);
        if (!iv) return false;
        out.set(iv.x, iv.group.position.y + 2.5, INSTR_Z);
        return true;
      }
      case "panel":
        if (a.part === "tempo" && view.tempo) out.set(-4.3, Y.board1 + 1.2, -1.0);
        else if (a.part === "wave" && view.wave) out.set(WAVE.x, WAVE.y + WAVE.h / 2, -1.0);
        else return false;
        return true;
    }
    return false;
  }

  return {
    async build(c, s) {
      if (s.engine !== "music") throw new Error(`music engine got a "${s.engine}" scene`);
      ctx = c;
      spec = s;
      const data: MusicData = s.engineData;
      world = new THREE.Group();
      world.name = "music";
      c.root.add(world);
      prevBackground = c.scene.background;
      c.scene.background = new THREE.Color(data.background ?? PAPER);
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
      keyLight.position.set(5, 12, 12);
      const rim = new THREE.DirectionalLight(0xffe8d0, 0.3 * Math.PI);
      rim.position.set(-10, 6, -8);
      lights = [new THREE.HemisphereLight(0xffffff, 0xcdbfae, 0.75 * Math.PI), keyLight, rim];
      for (const l of lights) c.scene.add(l);
      views = new Map(data.chapters.map((e) => [e.chapter, buildView(e)]));
      for (const v of views.values()) pose(v, 0);
      world.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(world);
      const sphere = bb.getBoundingSphere(new THREE.Sphere());
      bound = { center: sphere.center, radius: Math.max(1, sphere.radius) };
    },

    update(chapterId, t) {
      apply(chapterId, t);
    },

    resolveAnchor(anchor: Anchor, chapterId, t, out) {
      if ("pos" in anchor) {
        out.set(...anchor.pos);
        return true;
      }
      if (!("entity" in anchor)) return false;
      const view = views.get(chapterId);
      if (!view) return false;
      if (last.chapter !== chapterId || last.t !== t || last.key !== ovKey(view.entry)) apply(chapterId, t);
      const ok = anchorOf(view, anchor, out);
      if (ok && anchor.offset) out.add(tmp.set(...anchor.offset));
      return ok;
    },

    bounds() {
      return { center: bound.center.clone(), radius: bound.radius };
    },

    params(chapterId): EngineParam[] {
      const view = views.get(chapterId);
      const ids = spec?.chapters.find((c) => c.id === chapterId)?.activity?.test.params ?? [];
      if (!view) return [];
      const entry = view.entry;
      return ids.flatMap((id) => {
        const p = entry.params?.find((q) => q.id === id);
        if (!p) return [];
        const r = paramRange(entry, p);
        const st = view.state;
        const palette = entry.instruments ?? ["piano"];
        const own =
          p.kind === "tempo" ? entry.tempo
          : p.kind === "transpose" ? 0
          : p.kind === "instrument" ? palette.indexOf(view.layout?.score.instruments[st.rep] ?? palette[0]!) + 1
          : figureIndex((st.sounding ?? view.layout?.notes[0])?.note.beats ?? 1);
        return [{ id, label: p.label, min: r.min, max: r.max, step: r.step, value: overrides?.[id] ?? own }];
      });
    },

    setParams(values) {
      if (!values) {
        overrides = null;
        return;
      }
      overrides = {};
      for (const v of views.values())
        for (const p of v.entry.params ?? []) {
          const x = values[p.id];
          if (x === undefined || !Number.isFinite(x)) continue;
          const r = paramRange(v.entry, p);
          overrides[p.id] = clamp(x, r.min, r.max);
        }
    },

    soundCues(chapterId) {
      const view = views.get(chapterId);
      return view ? musicCues(view.entry, ovOf(view.entry), durationOf(chapterId)) : [];
    },

    dispose() {
      if (!ctx || !world) return;
      disposeTree(world);
      inkMat.dispose();
      for (const l of texts) l.dispose();
      for (const v of views.values()) for (const l of v.layout?.texts ?? []) l.dispose();
      ctx.root.remove(world);
      for (const l of lights) ctx.scene.remove(l);
      ctx.scene.background = prevBackground;
      ctx = null;
      spec = null;
      world = null;
      lights = [];
      texts = [];
      views = new Map();
      overrides = null;
    },
  };
}

/** FIGURES index (1-based) of a value; dotted values count as their base figure. */
function figureIndex(beats: number): number {
  const i = FIGURES.findIndex((f) => f.beats === beats || f.beats * 1.5 === beats);
  return i < 0 ? 3 : i + 1;
}

/** Decimal in the lesson's locale (Italian: 0.75 -> "0,75", 261.63 -> "261,6" with digits = 1). */
function num(x: number, digits = 2): string {
  return (Math.round(x * 10 ** digits) / 10 ** digits).toString().replace(".", decimalMark());
}

