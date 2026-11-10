// Thin WebAudio layer behind AudioOut. All decisions are made by AudioDirector; this file only
// loads buffers, starts/stops sources and moves gains smoothly.
//
// Graph: music bus ─┐
//                   ├─ duck ─┐
//     ambience bus ─┘        ├─ master ─ destination
//           sfx bus ─────────┘
import type { AssetLoader } from "../player.ts";
import type { AudioOut } from "./director.ts";
import { INSTRUMENTS, noteParams, renderNote } from "./instruments.ts";
import { soundFile, soundSource } from "./library.ts";
import { synthesize } from "./synth.ts";

const BUS = { master: 0.9, music: 0.32, ambience: 0.5, sfx: 0.75 };
/** Time constants (s) for setTargetAtTime: loops/music fade, duck attack and release. */
const FADE = 0.35;
const MUSIC_FADE = 0.8;
const DUCK_ATTACK = 0.08;
const DUCK_RELEASE = 0.45;
/** A one-shot whose buffer is not ready within this delay is dropped (better silent than late). */
const LATE_LIMIT = 0.5;
const SYNTH_RATE = 22050;
/** Notes are rendered at a higher rate so high pitches keep their overtones. */
const NOTE_RATE = 32000;
/** Rendered notes kept for reuse (a melody repeats the same few pitches). */
const NOTE_CACHE = 256;

interface Voice {
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  level: number;
  stopTimer?: ReturnType<typeof setTimeout>;
}

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class WebAudioOut implements AudioOut {
  readonly supported: boolean;

  private ctx: AudioContext | null = null;
  private duck: GainNode | null = null;
  private bus: { music: GainNode; ambience: GainNode; sfx: GainNode } | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer>();
  private loops = new Map<string, Voice>();
  private track: { id: string; voice: Voice } | null = null;
  private old: Voice[] = [];
  private noteBuffers = new Map<string, AudioBuffer>();
  private sounding = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>();

  // Last requested state, re-applied when the context is created on the first gesture.
  private wantLoops: ReadonlyMap<string, number> = new Map();
  private wantMusic: { track: string | null; level: number } = { track: null, level: 0 };
  private wantDuck = 1;
  private wantPreload = new Set<string>();

  constructor(
    private base: string,
    private loadFile?: AssetLoader,
  ) {
    this.supported = audioContextCtor() !== null;
  }

  /** Creates or resumes the context. Call it from a user gesture (autoplay policy); safe to repeat. */
  unlock(): void {
    const Ctx = audioContextCtor();
    if (!Ctx) return;
    if (!this.ctx) {
      try {
        this.ctx = new Ctx();
      } catch (e) {
        console.warn("[audio] AudioContext unavailable:", e);
        return;
      }
      const ctx = this.ctx;
      const master = ctx.createGain();
      master.gain.value = BUS.master;
      master.connect(ctx.destination);
      this.duck = ctx.createGain();
      this.duck.gain.value = this.wantDuck;
      this.duck.connect(master);
      const mk = (v: number, to: AudioNode) => {
        const g = ctx.createGain();
        g.gain.value = v;
        g.connect(to);
        return g;
      };
      this.bus = { music: mk(BUS.music, this.duck), ambience: mk(BUS.ambience, this.duck), sfx: mk(BUS.sfx, master) };
      this.preload([...this.wantPreload]);
      this.setLoops(this.wantLoops);
      this.setMusic(this.wantMusic.track, this.wantMusic.level);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
  }

  /** Page hidden: stop the clock (and the sound) until it is visible again. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend().catch(() => {});
    else void this.ctx.resume().catch(() => {});
  }

  preload(sounds: readonly string[]): void {
    for (const s of sounds) this.wantPreload.add(s);
    if (this.ctx) for (const s of sounds) void this.load(s);
  }

  setLoops(levels: ReadonlyMap<string, number>): void {
    this.wantLoops = levels;
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    for (const [id, level] of levels) {
      let v = this.loops.get(id);
      if (!v) {
        v = this.voice(this.bus.ambience);
        this.loops.set(id, v);
        this.startLoop(id, v, () => this.loops.get(id) === v);
      }
      clearTimeout(v.stopTimer);
      this.ramp(v, level, FADE);
    }
    for (const [id, v] of this.loops) {
      if (levels.has(id) || v.level === 0) continue;
      this.ramp(v, 0, FADE);
      v.stopTimer = setTimeout(() => {
        if (v.level !== 0) return;
        this.stop(v);
        if (this.loops.get(id) === v) this.loops.delete(id);
      }, FADE * 6 * 1000);
    }
  }

  setMusic(track: string | null, level: number): void {
    this.wantMusic = { track, level };
    if (!this.ctx || !this.bus) return;
    if (this.track && this.track.id !== track) {
      const v = this.track.voice;
      this.ramp(v, 0, MUSIC_FADE);
      this.old.push(v);
      setTimeout(() => {
        this.stop(v);
        this.old = this.old.filter((o) => o !== v);
      }, MUSIC_FADE * 5 * 1000);
      this.track = null;
    }
    if (!track) return;
    if (!this.track) {
      const v = this.voice(this.bus.music);
      const cur = { id: track, voice: v };
      this.track = cur;
      this.startLoop(track, v, () => this.track === cur);
    }
    this.ramp(this.track.voice, level, MUSIC_FADE);
  }

  setDuck(level: number): void {
    const down = level < this.wantDuck;
    this.wantDuck = level;
    if (!this.ctx || !this.duck) return;
    this.duck.gain.cancelScheduledValues(this.ctx.currentTime);
    this.duck.gain.setTargetAtTime(level, this.ctx.currentTime, down ? DUCK_ATTACK : DUCK_RELEASE);
  }

  play(sound: string, volume: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus || ctx.state !== "running") return;
    const asked = ctx.currentTime;
    const fire = (buf: AudioBuffer) => {
      const g = ctx.createGain();
      g.gain.value = volume;
      g.connect(this.bus!.sfx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      // Tracked with the notes: a pause, a seek or a chapter change cuts it (stopNotes), so a long one-shot never rings on.
      const entry = { src, gain: g };
      this.sounding.add(entry);
      src.onended = () => {
        g.disconnect();
        this.sounding.delete(entry);
      };
      src.start();
    };
    const buf = this.ready.get(sound);
    if (buf) return fire(buf);
    void this.load(sound).then((b) => {
      if (b && ctx.currentTime - asked <= LATE_LIMIT) fire(b);
    });
  }

  note(sound: string, freq: number | null, duration: number | undefined, volume: number): void {
    const ctx = this.ctx;
    const kind = INSTRUMENTS[sound];
    if (!ctx || !this.bus || ctx.state !== "running" || !kind) return;
    const p = noteParams(kind, freq, duration);
    const key = `${kind}|${p.f.toFixed(2)}|${p.duration.toFixed(2)}`;
    let buf = this.noteBuffers.get(key);
    if (!buf) {
      const data = renderNote(kind, p.f, p.duration, NOTE_RATE);
      buf = ctx.createBuffer(1, data.length, NOTE_RATE);
      buf.getChannelData(0).set(data);
      if (this.noteBuffers.size >= NOTE_CACHE) this.noteBuffers.delete(this.noteBuffers.keys().next().value!);
      this.noteBuffers.set(key, buf);
    }
    // Same bus as the effects: follows "Suoni" (via the director) and is not ducked under the voice.
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.bus.sfx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const entry = { src, gain };
    this.sounding.add(entry);
    src.onended = () => {
      gain.disconnect();
      this.sounding.delete(entry);
    };
    src.start();
  }

  stopNotes(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const { src, gain } of this.sounding) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      try {
        src.stop(ctx.currentTime + 0.12);
      } catch {
        /* already stopped */
      }
    }
    this.sounding.clear();
  }

  dispose(): void {
    this.stopNotes();
    for (const v of [...this.loops.values(), ...this.old]) clearTimeout(v.stopTimer);
    this.loops.clear();
    this.track = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // ---------- internals ----------

  private voice(bus: GainNode): Voice {
    const gain = this.ctx!.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    return { gain, src: null, level: 0 };
  }

  private ramp(v: Voice, level: number, tau: number): void {
    const ctx = this.ctx!;
    v.level = level;
    v.gain.gain.cancelScheduledValues(ctx.currentTime);
    v.gain.gain.setTargetAtTime(level, ctx.currentTime, tau);
  }

  private startLoop(id: string, v: Voice, stillWanted: () => boolean): void {
    void this.load(id).then((buf) => {
      const ctx = this.ctx;
      if (!buf || !ctx || !stillWanted() || v.src) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(v.gain);
      // Random start point: the same loop does not always begin identically.
      src.start(0, Math.random() * buf.duration * 0.5);
      v.src = src;
    });
  }

  private stop(v: Voice): void {
    try {
      v.src?.stop();
    } catch {
      /* already stopped */
    }
    v.src = null;
    v.gain.disconnect();
  }

  /** Decoded buffer for a catalog id: the file, else the procedural fallback. Cached. */
  private load(id: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (p) return p;
    const ctx = this.ctx!;
    const entry = soundSource(id);
    if (!entry) {
      console.warn(`[audio] unknown sound "${id}"`);
      return Promise.resolve(null);
    }
    const fallback = (): AudioBuffer => {
      const data = synthesize(entry.synth, SYNTH_RATE, hash(id));
      const buf = ctx.createBuffer(1, data.length, SYNTH_RATE);
      buf.getChannelData(0).set(data);
      return buf;
    };
    p = (async () => {
      if (!entry.file) return fallback();
      try {
        let bytes: ArrayBuffer;
        if (this.loadFile) bytes = await this.loadFile(soundFile(id));
        else {
          const res = await fetch(new URL(soundFile(id), this.base));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          bytes = await res.arrayBuffer();
        }
        return await ctx.decodeAudioData(bytes);
      } catch (e) {
        console.warn(`[audio] "${id}" file unavailable, using the procedural fallback:`, e);
        return fallback();
      }
    })().then((b) => {
      this.ready.set(id, b);
      return b;
    });
    this.buffers.set(id, p);
    return p;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
