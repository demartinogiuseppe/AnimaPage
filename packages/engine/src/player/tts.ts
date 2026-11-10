// Text-to-speech providers (brief §4.3). The player only sees TtsProvider, so a better
// synthesis can replace Web Speech later without touching playback.
import { speechUnits } from "@pv/scene-spec/i18n";

export interface TtsProvider {
  /**
   * Speaks `text`, cancelling anything in progress. `onEnd` fires once when it finishes (never after stop()).
   * `speaker` = id of a scene voice (dialogues); omitted = the narrator. `lang` = BCP-47 language of this
   * line (overrides the speaker's); omitted = the speaker's language, else Italian.
   * `onWord`: called with the char index in `text` of each word the voice reaches, when the voice reports it.
   */
  speak(text: string, onEnd: () => void, speaker?: string, lang?: string, onWord?: (charIndex: number) => void): void;
  /** Cancels the current utterance; its onEnd will not fire. */
  stop(): void;
  /** The scene's characters (SceneBase.voices). Providers without voices ignore it. */
  setVoices?(voices: readonly VoiceSpec[]): void;
  /** The narrator's language (SceneSpec.lang, BCP-47; decision D21). Default Italian. */
  setLanguage?(lang: string): void;
}

/** A character's voice in a dialogue (SceneBase.voices). */
export interface VoiceSpec {
  id: string;
  name: string;
  prefer?: "female" | "male" | "any";
  pitch?: number;
  rate?: number;
  /** BCP-47, e.g. "en-GB"; omitted = Italian. */
  lang?: string;
}

/** Reading time used when there is no voice: max(1500 ms, 340 ms per word); CJK/Thai by characters/segments. */
export function timedDurationMs(text: string, lang?: string): number {
  const words = lang ? speechUnits(text.trim(), lang) : text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1500, Math.round(words * 340));
}

/** Fallback without audio: "speaks" for the reading time, so the text is still highlighted sentence by sentence. */
export class TimerTts implements TtsProvider {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;

  speak(text: string, onEnd: () => void, _speaker?: string, lang?: string): void {
    this.stop();
    const token = this.token;
    this.timer = setTimeout(() => {
      if (token === this.token) onEnd();
    }, timedDurationMs(text, lang));
  }

  stop(): void {
    this.token++;
    clearTimeout(this.timer);
  }
}

/** Test double: utterances last `duration(text)` seconds of simulated time, advanced with tick(dt). */
export class FakeTts implements TtsProvider {
  readonly spoken: string[] = [];
  /** Speaker of each spoken text (undefined = narrator). */
  readonly speakers: (string | undefined)[] = [];
  stops = 0;
  private current: { text: string; left: number; onEnd: () => void } | null = null;
  /** The current utterance's word callback (undefined when the caller gave none). */
  onWord: ((charIndex: number) => void) | undefined;

  constructor(private duration: (text: string) => number = () => 1) {}

  get speaking(): string | null {
    return this.current?.text ?? null;
  }

  speak(text: string, onEnd: () => void, speaker?: string, _lang?: string, onWord?: (charIndex: number) => void): void {
    this.current = null;
    this.onWord = onWord;
    this.spoken.push(text);
    this.speakers.push(speaker);
    this.current = { text, left: this.duration(text), onEnd };
  }

  stop(): void {
    this.stops++;
    this.current = null;
  }

  tick(dt: number): void {
    const c = this.current;
    if (!c) return;
    c.left -= dt;
    if (c.left <= 1e-9) {
      this.current = null;
      c.onEnd();
    }
  }

  /** The voice reaches the word starting at `charIndex`. */
  boundary(charIndex: number): void {
    if (this.current) this.onWord?.(charIndex);
  }

  /** Ends the current utterance now. */
  finish(): void {
    const c = this.current;
    this.current = null;
    c?.onEnd();
  }
}

interface VoiceLike {
  name: string;
  lang: string;
}

const isItalian = (v: VoiceLike) => /^it([-_]|$)/i.test(v.lang);
export const DEFAULT_LANG = "it-IT";
const norm = (l: string) => l.replace("_", "-").toLowerCase();
const baseLang = (l: string) => norm(l).split("-")[0]!;
/** Same language and region ("en-GB"), or any voice of the base language ("en") when none matches exactly. */
function voicesFor<V extends VoiceLike>(available: readonly V[], lang: string): V[] {
  const exact = available.filter((v) => norm(v.lang) === norm(lang));
  return exact.length ? exact : available.filter((v) => baseLang(v.lang) === baseLang(lang));
}

/** True for lines that are not in the narrator's language (Italian by default): they get a small language tag. */
export function isForeign(lang: string | undefined, narrator: string = DEFAULT_LANG): boolean {
  return !!lang && baseLang(lang) !== baseLang(narrator);
}

/** "en-GB" -> "EN". */
export function langTag(lang: string): string {
  return baseLang(lang).toUpperCase();
}
const GOOD = /natural|neural|premium|enhanced|google/i;

/** Italian voice, preferring the good-sounding ones (natural/neural/premium/enhanced/google names). */
export function pickItalianVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const it = voices.filter(isItalian);
  return it.find((v) => GOOD.test(v.name)) ?? it[0] ?? null;
}

/**
 * Narrator voice for any language (D21): same preference as pickItalianVoice, among the voices of the
 * exact locale ("en-GB") or else of its base language ("en"). Null when the device has none: the player
 * then shows the text without a voice instead of reading it with a voice of another language.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  if (baseLang(lang) === "it") return pickItalianVoice(voices);
  const pool = voicesFor(voices, lang);
  return pool.find((v) => GOOD.test(v.name)) ?? pool[0] ?? null;
}

/**
 * True when an utterance must not be spoken: the voices are known (the list is not empty) and none
 * speaks its language. An empty list means "not loaded yet": the browser then picks by `lang`.
 */
export function lacksVoice<V extends VoiceLike>(available: readonly V[], chosen: V | null): boolean {
  return available.length > 0 && chosen === null;
}

/** Known Italian system voices (Windows, macOS/iOS, Google); unknown names are "any". */
const FEMALE =
  /\b(elsa|isabella|alice|federica|paola|emma|giulia|bianca|carla|lucia|chiara|francesca|elena|sara|female|donna|google italiano|zira|hazel|susan|libby|sonia|maisie|samantha|karen|serena|kate|emily|aria|jenny|mia|moira|tessa|fiona|victoria)\b/i;
const MALE =
  /\b(cosimo|diego|giuseppe|luca|giorgio|roberto|marco|paolo|riccardo|alessandro|benigno|calogero|male|uomo|david|george|ryan|thomas|daniel|guy|mark|james|oliver|arthur|alex|fred|tom)\b/i;

export function voiceGender(name: string): "female" | "male" | "any" {
  if (FEMALE.test(name)) return "female";
  if (MALE.test(name)) return "male";
  return "any";
}

export interface VoiceChoice<V> {
  voice: V | null;
  pitch: number;
  rate: number;
  /** BCP-47 language the utterance is spoken in. */
  lang: string;
}

/** Default reading rate. */
export const NARRATOR_RATE = 0.98;

/**
 * Gives each character its own voice in its language (Italian unless `lang` says otherwise) when the
 * system has enough of them (by preferred gender, never the narrator's), otherwise a recognisable
 * pitch/rate variation of an available voice of that language; with no voice of the language at all,
 * the browser default speaks with `lang` set. Pure.
 */
export function assignVoices<V extends VoiceLike>(
  available: readonly V[],
  specs: readonly VoiceSpec[],
  narrator: V | null,
  narratorLang: string = DEFAULT_LANG,
): Map<string, VoiceChoice<V>> {
  const used = new Set<string>(narrator ? [narrator.name] : []);
  const out = new Map<string, VoiceChoice<V>>();
  specs.forEach((spec, i) => out.set(spec.id, chooseVoice(available, spec, spec.lang ?? narratorLang, used, i, narrator, narratorLang)));
  return out;
}

/**
 * One voice for `spec` speaking `lang`. `used` holds voice names already taken (updated when a free
 * voice is taken). Shared by the cast (assignVoices) and per-line language overrides.
 */
export function chooseVoice<V extends VoiceLike>(
  available: readonly V[],
  spec: Pick<VoiceSpec, "prefer" | "pitch" | "rate">,
  lang: string,
  used: Set<string>,
  index: number,
  narrator: V | null,
  narratorLang: string = DEFAULT_LANG,
): VoiceChoice<V> {
  const rank = (v: V) => (GOOD.test(v.name) ? 0 : 1);
  const pool = voicesFor(available, lang);
  const want = spec.prefer ?? "any";
  const fits = (v: V) => want === "any" || voiceGender(v.name) === want;
  const free = pool.filter((v) => !used.has(v.name)).sort((a, b) => rank(a) - rank(b));
  const pick = free.find(fits) ?? (want === "any" ? undefined : free.find((v) => voiceGender(v.name) === "any"));
  if (pick) {
    used.add(pick.name);
    return { voice: pick, pitch: spec.pitch ?? 1, rate: spec.rate ?? NARRATOR_RATE, lang };
  }
  // Not enough distinct voices: same voice, different pitch and pace (the narrator's only in the narrator's language).
  const fallback =
    pool.filter(fits).sort((a, b) => rank(a) - rank(b))[0] ?? pool.sort((a, b) => rank(a) - rank(b))[0] ?? (baseLang(lang) === baseLang(narratorLang) ? narrator : null);
  const pitches = want === "female" ? [1.25, 1.4] : want === "male" ? [0.78, 0.68] : [1.2, 0.8, 1.35, 0.7];
  return {
    voice: fallback,
    pitch: spec.pitch ?? pitches[index % pitches.length]!,
    rate: spec.rate ?? (index % 2 ? 0.92 : 1.05),
    lang,
  };
}

/** Web Speech API voice. Falls back to `fallback` (timed) when the API is missing or an utterance fails. */
export class WebSpeechTts implements TtsProvider {
  readonly supported: boolean;
  /** Called once when the voice turns out to be unusable (missing API or a synthesis error). */
  onUnavailable: (() => void) | null = null;
  /** Called when a text is shown without voice because the device has no voice for its language (D21). */
  onNoVoice: ((lang: string) => void) | null = null;

  private voice: SpeechSynthesisVoice | null = null;
  /** Narrator's language (setLanguage). */
  private lang = DEFAULT_LANG;
  private specs: readonly VoiceSpec[] = [];
  private cast = new Map<string, VoiceChoice<SpeechSynthesisVoice>>();
  /** Per-line language overrides: speaker|lang -> voice (filled on demand). */
  private extra = new Map<string, VoiceChoice<SpeechSynthesisVoice>>();
  private token = 0;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  /** Keeps the utterance referenced: Chrome may garbage-collect it and never fire `end`. */
  private current: SpeechSynthesisUtterance | null = null;
  private unlocked = false;

  constructor(private fallback: TtsProvider = new TimerTts()) {
    this.supported = typeof window !== "undefined" && "speechSynthesis" in window;
    if (!this.supported) return;
    const pick = () => {
      this.voice = pickVoice(speechSynthesis.getVoices() ?? [], this.lang);
      this.recast();
    };
    pick();
    // Chrome loads voices asynchronously.
    speechSynthesis.addEventListener("voiceschanged", pick);
    // iOS only speaks after a user gesture: speak a silent utterance on the first one.
    document.addEventListener("pointerdown", () => this.unlock(), { once: true });
    document.addEventListener("keydown", () => this.unlock(), { once: true });
  }

  setVoices(voices: readonly VoiceSpec[]): void {
    this.specs = voices;
    this.recast();
  }

  setLanguage(lang: string): void {
    this.lang = lang || DEFAULT_LANG;
    if (!this.supported) return;
    this.voice = pickVoice(speechSynthesis.getVoices() ?? [], this.lang);
    this.recast();
  }

  private recast(): void {
    if (!this.supported) return;
    this.cast = assignVoices(speechSynthesis.getVoices() ?? [], this.specs, this.voice, this.lang);
    this.extra.clear();
  }

  unlock(): void {
    if (this.unlocked || !this.supported) return;
    this.unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch {
      /* ignore: unlocking is best effort */
    }
  }

  /** Voice for a line: the speaker's (or the narrator's), switched to the line's language when it differs. */
  private roleFor(speaker: string | undefined, lang: string | undefined): VoiceChoice<SpeechSynthesisVoice> | undefined {
    const role = speaker ? this.cast.get(speaker) : undefined;
    const own = role?.lang ?? this.lang;
    if (!lang || norm(lang) === norm(own)) return role;
    const key = `${speaker ?? ""}|${norm(lang)}`;
    let c = this.extra.get(key);
    if (!c) {
      const spec = this.specs.find((s) => s.id === speaker) ?? {};
      const used = new Set<string>([...this.cast.values()].map((x) => x.voice?.name ?? "").filter(Boolean));
      if (this.voice) used.add(this.voice.name);
      c = chooseVoice(speechSynthesis.getVoices() ?? [], spec, lang, used, this.extra.size, this.voice, this.lang);
      this.extra.set(key, c);
    }
    return c;
  }

  speak(text: string, onEnd: () => void, speaker?: string, lang?: string, onWord?: (charIndex: number) => void): void {
    this.stop();
    const token = this.token;
    if (!this.supported) {
      this.fallback.speak(text, onEnd);
      return;
    }
    const done = () => {
      if (token !== this.token) return;
      this.token++;
      clearTimeout(this.watchdog);
      this.current = null;
      onEnd();
    };
    const role = this.roleFor(speaker, lang);
    const v = role ? role.voice : this.voice;
    const uLang = role?.lang ?? this.lang;
    // No voice for this language on the device: the text stays on screen, timed, never read by a
    // voice of another language (D21).
    if (lacksVoice(speechSynthesis.getVoices() ?? [], v)) {
      this.onNoVoice?.(uLang);
      this.fallback.speak(text, done, speaker, uLang);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = uLang;
    if (v) u.voice = v;
    u.rate = role?.rate ?? NARRATOR_RATE;
    u.pitch = role?.pitch ?? 1;
    u.onend = done;
    if (onWord) {
      u.onboundary = (e) => {
        if (token === this.token && e.name === "word") onWord(e.charIndex);
      };
    }
    u.onerror = (e) => {
      if (token !== this.token || e.error === "interrupted" || e.error === "canceled") return;
      this.onUnavailable?.();
      this.fallback.speak(text, done, speaker, uLang);
    };
    this.current = u;
    // Some engines silently drop `end`; never let the timeline freeze forever.
    this.watchdog = setTimeout(done, Math.max(10_000, timedDurationMs(text, uLang) * 3));
    speechSynthesis.speak(u);
  }

  stop(): void {
    this.token++;
    clearTimeout(this.watchdog);
    this.fallback.stop();
    this.current = null;
    if (this.supported) {
      try {
        speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Speaks texts one after another (deep dives). Returns a function that cancels the rest. */
export function speakList(tts: TtsProvider, texts: readonly string[], onEnd?: () => void): () => void {
  let i = 0;
  let cancelled = false;
  const next = () => {
    if (cancelled) return;
    const text = texts[i++];
    if (text === undefined) onEnd?.();
    else tts.speak(text, next);
  };
  next();
  return () => {
    cancelled = true;
  };
}
