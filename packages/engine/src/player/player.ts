// Engine-agnostic player (brief §4.3): stage + narration panel + pins + quiz + deep dives + sources + videos.
// The DOM wiring lives here; the logic it drives (Playback, QuizState, cameraAt, timing) is pure and tested.
import type { Chapter, Pin, SceneKind, SceneSpec, Source, Video } from "@pv/scene-spec";
import { engineText, isRtl, setDisplayLocale, t, uiLanguage, type MessageKey } from "@pv/scene-spec/i18n";
import type * as THREE from "three";
import type { Engine, TouchPlayView } from "../types.ts";
import { ActivityState, readStyle, resolveStyle, sceneKey, StampStore, writeStyle, type VisualStyle } from "../book/activity.ts";
import { leftPageText, rightPageText } from "../book/page.ts";
import { ActivityView, stampEl } from "./activity-ui.ts";
import { renderBook2d } from "./book-2d.ts";
import { AudioDirector, type AudioOut } from "./audio/director.ts";
import { readPref, writePref } from "./audio/prefs.ts";
import { WebAudioOut } from "./audio/webaudio.ts";
import { h, icon } from "./dom.ts";
import type { Rect } from "./declutter.ts";
import { NO_MOVE, type MoveInput } from "./move.ts";
import { PinLayer, type LabelMode } from "./pin-layer.ts";
import { applyTheme, onThemeChange, readTheme, themePicker } from "./themes.ts";
import { Playback } from "./playback.ts";
import { feedbackSpeech, QuizState } from "./quiz.ts";
import { Stage } from "./stage.ts";
import { PLAYER_CSS } from "./styles.ts";
import { formatTime, statusAt } from "./timing.ts";
import { DEFAULT_LANG, isForeign, langTag, speakList, TimerTts, WebSpeechTts, type TtsProvider } from "./tts.ts";
import { ArMode } from "./xr/ar-mode.ts";
import { readPresentationPref, resolvePresentation, type Presentation } from "./presentation.ts";
import { loadKatex, typesetInto } from "./katex.ts";
import { looksLikeFormula } from "../util/math-text.ts";
import { splitWords, wordAtChar } from "../util/words.ts";
import { TapDetector, TapSoundLimiter } from "./tap.ts";
import { PLAY_SLACK } from "../engines/storybook/play.ts";
import { MarkLayer, TouchPlayPanel } from "./touch-play-ui.ts";
import { localAssetUrl } from "../export/assets.ts";

/** Supplies the bytes of an engine asset or sound by its relative path (exported lessons read them from memory). */
export type AssetLoader = (path: string) => Promise<ArrayBuffer>;

/** The pop-up book on the real table needs a stage, and has no place in an exported file. */
export function arEnabled(hasStage: boolean, exported: boolean): boolean {
  return hasStage && !exported;
}

/** Storybook lessons (children's stories) always use the pop-up book with the story look; Accademico is not offered. */
export function storyLook(engine: string, presentation: Presentation): { story: boolean; academic: boolean } {
  const story = engine === "storybook";
  return { story, academic: !story && presentation === "academic" };
}

export interface PlayerOptions {
  /** Voice used when the "Voce" switch is on. Default: Web Speech, in the lesson's language (SceneSpec.lang). */
  tts?: TtsProvider;
  /** Base URL for engine data assets and sounds. Default: the document base. */
  assetBase?: string;
  /** Sound output. Default: WebAudio, started on the first user gesture (autoplay policy). */
  audio?: AudioOut;
  /** Where earned stamps are kept. Default: localStorage. */
  stamps?: StampStore;
  /** Open on this chapter instead of the first, with the guided tour on if `tour` (decision D22). */
  start?: { chapter: string; tour?: boolean };
  /**
   * Decision D22: the scene is the beginning of a lesson still being prepared. A disabled
   * "in preparazione" chip follows the scene's chips until `setFollowing` gives the next chapters.
   */
  following?: FollowingChapters;
  /** Replaces fetching `assetBase`-relative paths, for stage assets and sounds. */
  loadAsset?: AssetLoader;
  /** Lesson exported as a standalone file: no AR, a "Ricomincia" button, notes on what needs internet. */
  exported?: boolean;
  /** Presentation (decision D24); default: the user's "Stile delle lezioni" setting, automatic = from the lesson. */
  presentation?: Presentation;
}

/** Chapters of the complete lesson after this scene's own (D22). */
export interface FollowingChapters {
  /** The user (or the guided tour) moves on to chapter `id` of the complete lesson. */
  onContinue(id: string, tour: boolean): void;
}

export interface FollowingChip {
  id: string;
  chip: string;
  kind: SceneKind;
}

export interface PlayerHandle {
  go(chapterId: string, autoplay?: boolean): void;
  /** D22: the chapters that follow this scene's (null: still being prepared; []: none). */
  setFollowing(chips: readonly FollowingChip[] | null): void;
  dispose(): void;
}

/** Gap between chapters in the guided tour. */
const TOUR_GAP_MS = 1300;
/** Seconds without a word boundary after which the highlight goes back to the estimate (from the last reported word). */
const BOUNDARY_SILENCE = 1.5;

/** Accademico (D24): plain stage background for light and dark UI themes. */
const PLAIN_BG = { light: "#f6f7f9", dark: "#161a20" } as const;
/** Accademico: the "Timbri" switch, remembered across lessons (off by default). */
const ACADEMIC_STAMPS_KEY = "pv.stamps.academic";
/** Accademico: at most this long for KaTeX (formulas on the boards) before the stage is built without it. */
const KATEX_WAIT_MS = 4000;
/** Level of a tap sound and of the activity's completion fanfare: gentle, under the voice. */
const TAP_VOLUME = 0.4;
const DONE_VOLUME = 0.6;

const KIND_LABEL: Partial<Record<SceneKind, MessageKey>> = {
  myth: "kind.myth",
  history: "kind.history",
  geography: "kind.geography",
  science: "kind.science",
  art: "kind.art",
};

/** "Etichette" setting, remembered across lessons. */
const LABELS_KEY = "pv.labels";
const LABEL_MODE_TEXT = (m: LabelMode) => t(`player.labels.${m}`);
function readLabelMode(): LabelMode {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(LABELS_KEY);
    return v === "all" || v === "none" || v === "active" ? v : "active";
  } catch {
    return "active";
  }
}
function writeLabelMode(m: LabelMode): void {
  try {
    localStorage.setItem(LABELS_KEY, m);
  } catch {
    /* this page only */
  }
}

/** Movement hints: touch devices only get the touch gestures. */
export const HINT_DESKTOP = (): string => t("player.hintDesktop");
export const HINT_TOUCH = (): string => t("player.hintTouch");
function isTouchDevice(): boolean {
  return !!window.matchMedia?.("(pointer: coarse)").matches && !window.matchMedia?.("(any-pointer: fine)").matches;
}

/** The movement hint is shown once per browser. */
const HINT_KEY = "pv.hint.move";
function readFlag(key: string): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode: the hint comes back next time */
  }
}

/** Name of a language in the UI language ("giapponese", "Japanese"). */
function langName(lang: string): string {
  try {
    return new Intl.DisplayNames([uiLanguage()], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

function kindPill(el: HTMLElement, kind: SceneKind): void {
  const key = KIND_LABEL[kind];
  const label = key ? t(key) : undefined;
  el.hidden = !label;
  el.textContent = label ?? "";
  el.className = `pv-kind ${kind === "myth" ? "myth" : "hist"}`;
}

function injectCss(): void {
  if (document.getElementById("pv-player-css")) return;
  document.head.append(h("style", { id: "pv-player-css" }, PLAYER_CSS));
}

function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString(uiLanguage(), { day: "numeric", month: "long", year: "numeric" });
}

/** Official embed URL. Never called before the user asks for the video. */
export function videoEmbedUrl(v: Pick<Video, "provider" | "ref">): string {
  if (v.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.ref)}?rel=0`;
  const name = v.ref.replace(/^File:/i, "").replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}?embedplayer=yes`;
}

export async function mountPlayer(
  container: HTMLElement,
  spec: SceneSpec,
  engine: Engine | null,
  opts: PlayerOptions = {},
): Promise<PlayerHandle> {
  injectCss();
  // Lesson language (D21): numbers, dates and default labels of the engines, and the narrator's voice.
  const lessonLang = spec.lang ?? DEFAULT_LANG;
  setDisplayLocale(lessonLang);
  let theme = readTheme();
  applyTheme(theme);
  const offTheme = onThemeChange((t) => {
    theme = t;
    stage?.setTheme(t.book);
    if (academic) {
      app.classList.toggle("pv-dark", t.dark);
      stage?.setPlainBackground(t.dark ? PLAIN_BG.dark : PLAIN_BG.light);
    }
  });
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // Presentation (D24): the pop-up book, or the sober Accademico for university and adult readers.
  // Storybook lessons (children's stories) always use the pop-up book, whatever the audience or the setting.
  const { story, academic } = storyLook(spec.engine, opts.presentation ?? resolvePresentation(readPresentationPref(), spec));
  /** Accademico: label names, info cards and key formulas that read as formulas are typeset with KaTeX. */
  const formulaInto = (el: HTMLElement, text: string): boolean => {
    if (!academic || !looksLikeFormula(text)) return false;
    typesetInto(el, text);
    return true;
  };
  const chapters = spec.chapters;
  const hasStage = spec.engine !== "card";

  // ---------- Voice ----------
  const voice = opts.tts ?? new WebSpeechTts();
  const timer = new TimerTts();
  let voiceOn = true;
  // True while the voice is audible: music and ambience duck under it.
  let speaking = false;
  let speakToken = 0;
  const audibleVoice = () => voiceOn && (!(voice instanceof WebSpeechTts) || voice.supported);
  const tts: TtsProvider = {
    speak: (text, onEnd, speaker, lang, onWord) => {
      timer.stop();
      voice.stop();
      const id = ++speakToken;
      speaking = audibleVoice();
      (voiceOn ? voice : timer).speak(
        text,
        () => {
          if (id === speakToken) speaking = false;
          onEnd();
        },
        speaker,
        lang,
        onWord,
      );
    },
    stop: () => {
      speakToken++;
      speaking = false;
      voice.stop();
      timer.stop();
    },
  };

  // Dialogues: each character speaks with its own voice (SceneBase.voices).
  voice.setLanguage?.(lessonLang);
  voice.setVoices?.(spec.voices ?? []);
  const speakerName = new Map((spec.voices ?? []).map((v) => [v.id, v.name] as const));
  const speakerLang = new Map((spec.voices ?? []).map((v) => [v.id, v.lang] as const));

  // ---------- Sound ----------
  const webAudio = opts.audio ? null : new WebAudioOut(opts.assetBase ?? document.baseURI, opts.loadAsset);
  const audioOut: AudioOut = opts.audio ?? webAudio!;
  const audio = new AudioDirector(audioOut, spec.music);
  /** Engines that compute their own instrument cues (music engine) override the chapter's ones. */
  const refreshEngineCues = () => audio.setInstrumentCues(engine?.soundCues?.(ch.id) ?? null);
  /** One-shot effect outside the chapter cues (page turn, stamp), respecting the "Suoni" switch. */
  const sfx = (sound: string, volume: number) => {
    if (audio.soundsOn) audioOut.play(sound, volume);
  };
  // Accademico: its own "Suoni" switch, off until the user turns it on (D24).
  const soundsPref = academic ? "academicSounds" : "sounds";
  audio.soundsOn = readPref(soundsPref);
  audio.musicOn = readPref("music");
  /** "Avanti da sola": at the end of a chapter the player goes on to the next one, like the guided tour. */
  let autoNext = readPref("autoNext");
  // Autoplay policy: the audio context can only start inside a user gesture.
  const unlockAudio = () => webAudio?.unlock();
  const onVisibility = () => webAudio?.setHidden(document.hidden);
  const GESTURES = ["pointerdown", "keydown", "touchend"] as const;
  for (const g of GESTURES) document.addEventListener(g, unlockAudio, { capture: true });
  document.addEventListener("visibilitychange", onVisibility);
  let cancelList: (() => void) | null = null;
  const stopVoice = () => {
    cancelList?.();
    cancelList = null;
    tts.stop();
  };

  // ---------- State ----------
  let shownWord = { sentence: -1, word: -1 };
  /** Word start offsets (s) per sentence of the current chapter, and the spans of those words. */
  let wordOffsets: number[][] = [];
  let wordEls: HTMLElement[][] = [];
  let ch: Chapter = chapters.find((c) => c.id === opts.start?.chapter) ?? chapters[0]!;
  let tour = false;
  /** D22: chapters after this scene's (null = being prepared; [] without opts.following). */
  let following: readonly FollowingChip[] | null = opts.following ? null : [];
  /** The guided tour reached the end of this scene while the rest was being prepared. */
  let tourWaits = false;
  let tourTimer: ReturnType<typeof setTimeout> | undefined;
  let dragging = false;
  const quizzes = new Map<string, QuizState>();
  const quizOf = (c: Chapter) => {
    let q = quizzes.get(c.id);
    if (!q) quizzes.set(c.id, (q = new QuizState(c.quiz)));
    return q;
  };
  // Pop-up book style and Prevedi -> Prova -> Dimostra (decisions D12, D13).
  let style: VisualStyle = resolveStyle(readStyle(), spec.style);
  const stamps = opts.stamps ?? new StampStore();
  /** Stamps after each proof: always in the pop-up book; in Accademico only if the user turns them on. */
  let stampsOn = !academic || readFlag(ACADEMIC_STAMPS_KEY);
  const lessonKey = sceneKey(spec);
  const activities = new Map<string, ActivityState>();
  const actOf = (c: Chapter): ActivityState | null => {
    if (!c.activity) return null;
    let a = activities.get(c.id);
    if (!a) activities.set(c.id, (a = new ActivityState(c.activity, stamps.has(lessonKey, c.id))));
    return a;
  };
  const playback = new Playback(tts, {
    onSentence: (i) => pins?.pulse(ch.narration[i]?.highlight ?? []),
    onSeek: () => audio.resetWords(),
    onWord: (i, char) => {
      const k = wordAtChar(ch.narration[i]?.text ?? "", char);
      if (k >= 0) audio.wordReached(i, k);
    },
    onEnd: () => {
      // Activity: the end of the scene opens the flap; the guided tour waits for the stamp.
      if (actOf(ch)?.finishTest()) {
        renderActivity();
        return;
      }
      // A storybook touch activity: the panel opens and the guided tour / "Avanti da sola" wait for its stamp.
      if (playWaits()) {
        renderPlay();
        return;
      }
      if (tour || autoNext) tourNext();
    },
  });
  const sourceIndex = new Map(spec.sources.map((s, i) => [s.id, i] as const));

  // ---------- DOM: stage ----------
  // The lesson's own language and direction (an Italian lesson stays left-to-right in an Arabic UI, D21).
  const app = h("div", {
    class: `pv-app${hasStage ? "" : " pv-nostage"}${story ? " pv-story" : ""}${style === "ink" ? " pv-ink" : ""}${academic ? ` pv-academic${theme.dark ? " pv-dark" : ""}` : ""}`,
    lang: lessonLang,
    dir: isRtl(lessonLang) ? "rtl" : "ltr",
  });
  const labelsEl = h("div", { class: "pv-labels" });
  const pageFrame = h("div", { class: "pv-pageframe", "aria-hidden": "true" });
  const hudDates = h("b");
  const hudKind = h("span", { class: "pv-kind" });
  const centerBtn = h("button", { class: "pv-icon-btn pv-center", type: "button" }, t("player.center"));
  const styleBtns = (["color", "ink"] as const).map((s) => {
    const b = h("button", { type: "button", "data-style": s }, t(s === "color" ? "player.style.color" : "player.style.ink"));
    b.onclick = () => setStyle(s);
    return b;
  });
  const styleCtl = h("div", { class: "pv-style", role: "group", "aria-label": t("player.style") }, h("span", {}, t("player.style")), ...styleBtns);
  // "Etichette": Tutte / Solo attive / Nascoste (one button cycling through them).
  let labelMode: LabelMode = readLabelMode();
  const labelsBtn = h("button", { class: "pv-icon-btn pv-labels-btn", type: "button" });
  const showLabelMode = () => {
    labelsBtn.replaceChildren(h("span", { class: "lbl" }, t("player.labelsBtn")), LABEL_MODE_TEXT(labelMode));
    labelsBtn.setAttribute("aria-label", t("player.labelsAria", { mode: LABEL_MODE_TEXT(labelMode) }));
  };
  showLabelMode();
  labelsBtn.onclick = () => {
    labelMode = labelMode === "active" ? "all" : labelMode === "all" ? "none" : "active";
    writeLabelMode(labelMode);
    showLabelMode();
  };
  const statusEl = h("div", { class: "pv-status", role: "status" });
  const pickbar = h("div", { class: "pv-pickbar" });
  const icTitle = h("h4");
  const icText = h("p");
  const icSpeak = h("button", { class: "pv-btn soft small", type: "button" }, t("player.listen"));
  const icClose = h("button", { class: "pv-btn soft small", type: "button" }, t("player.close"));
  const infocard = h("div", { class: "pv-infocard" }, icTitle, icText, h("div", { class: "pv-row" }, icSpeak, icClose));
  statusEl.hidden = pickbar.hidden = infocard.hidden = true;

  const tlPlay = h("button", { class: "pv-tl-play", type: "button", "aria-label": t("player.play") }, icon("play"));
  const tlMarks = h("div", { class: "pv-tl-marks" });
  const tlRange = h("input", { type: "range", min: "0", max: "1", step: "0.01", value: "0", "aria-label": t("player.moment") });
  const tlTime = h("span", { class: "pv-tl-time" }, "0:00 / 0:00");
  const tlPrev = h("button", { class: "pv-tl-step pv-tl-prev", type: "button" }, icon("prev"));
  const tlNext = h("button", { class: "pv-tl-step pv-tl-next", type: "button" }, icon("next"));
  const timeline = h("div", { class: "pv-timeline" }, tlPlay, h("div", { class: "pv-tl-track" }, tlMarks, tlRange), tlTime, tlPrev, tlNext);

  let stageEl: HTMLElement | null = null;
  if (hasStage) {
    stageEl = h(
      "section",
      { class: "pv-stage", "aria-label": t("player.stage") },
      pageFrame,
      labelsEl,
      h(
        "div",
        { class: "pv-hud" },
        h("span", { class: "pv-badge" }, h("span", { class: "dot" }), hudDates, hudKind),
        h("div", { class: "pv-hud-r" }, labelsBtn, styleCtl, centerBtn),
      ),
      statusEl,
      pickbar,
      infocard,
      timeline,
    );
    app.append(stageEl);
  }

  // ---------- DOM: panel ----------
  const tourBtn = h("button", { class: "pv-btn primary", type: "button" });
  const restartBtn = opts.exported ? h("button", { class: "pv-btn soft", type: "button" }, t("player.restart")) : null;
  const chipsEl = h("nav", { class: "pv-chips", "aria-label": t("player.chapters") });
  const kicker = h("div", { class: "pv-kicker" });
  const cardKind = h("span", { class: "pv-kind" });
  const cardChip = h("span");
  const cardDates = h("span");
  kicker.append(cardKind, cardChip, cardDates);
  const chTitle = h("h2");
  const narrEl = h("p", { class: "pv-narr" });
  const playBtn = h("button", { class: "pv-btn soft small", type: "button" });
  const voiceInput = h("input", { type: "checkbox" });
  voiceInput.checked = true;
  const voiceNote = h("p", { class: "pv-note" }, t("player.voiceNote"));
  voiceNote.hidden = !(voice instanceof WebSpeechTts) || voice.supported;
  if (voice instanceof WebSpeechTts) {
    voice.onUnavailable = () => {
      playback.dropBoundary();
      voiceNote.textContent = t("player.voiceNote");
      voiceNote.hidden = false;
    };
    // No voice for the lesson's language on this device: subtitles only, with a small notice (D21).
    voice.onNoVoice = (lang) => {
      voiceNote.textContent = t("player.noVoice", { lang: langName(lang) });
      voiceNote.hidden = false;
    };
  }
  const autoInput = h("input", { type: "checkbox" });
  autoInput.checked = autoNext;
  const soundsInput = h("input", { type: "checkbox" });
  soundsInput.checked = audio.soundsOn;
  const musicInput = h("input", { type: "checkbox" });
  musicInput.checked = audio.musicOn;
  const musicSwitch = h("label", { class: "pv-switch" }, musicInput, t("player.music"));
  musicSwitch.hidden = !spec.music;
  const stampsInput = h("input", { type: "checkbox" });
  stampsInput.checked = stampsOn;
  const stampsSwitch = h("label", { class: "pv-switch" }, stampsInput, t("player.stamps"));
  stampsSwitch.hidden = !academic || !chapters.some((c) => c.activity);
  const narrCard = h(
    "article",
    { class: "pv-card pv-narr-card" },
    kicker,
    chTitle,
    narrEl,
    h(
      "div",
      { class: "pv-ctrls" },
      playBtn,
      h(
        "div",
        { class: "pv-switches" },
        h("label", { class: "pv-switch" }, voiceInput, t("player.voice")),
        h("label", { class: "pv-switch" }, soundsInput, t("player.sounds")),
        h("label", { class: "pv-switch" }, autoInput, t("player.autoNext")),
        musicSwitch,
        stampsSwitch,
      ),
    ),
    voiceNote,
  );
  if (!hasStage) narrCard.append(timeline);
  if (!hasStage) narrCard.querySelector(".pv-ctrls")!.after(styleCtl);
  // Card engine: the open book is drawn with CSS, text on both pages.
  const book2d = hasStage ? null : h("section", { class: "pv-book2d", "aria-label": t("player.book") });
  // Accademico: no printed left page on the stage, so its heading, key formula and lines go in the panel.
  const keyPoints = academic && hasStage ? h("section", { class: "pv-card pv-keypoints", "aria-label": t("player.keyPoints") }) : null;

  const activity = new ActivityView({
    choose: (k) => {
      if (!actOf(ch)?.choose(k)) return;
      renderActivity();
      setPlaying(true);
    },
    prove: () => {
      if (!actOf(ch)?.finishTest()) return;
      playback.pause();
      stopVoice();
      renderActivity();
    },
    lifted: () => {
      const act = actOf(ch);
      if (!act?.lift()) return;
      say(`${act.correct ? engineText("say.predictRight") : ""}${act.activity.prove.text}`);
    },
    stamp: () => {
      const act = actOf(ch);
      if (!act?.collect()) return;
      if (!stampsOn) return;
      stamps.add(lessonKey, ch.id, act.activity.stamp);
      sfx("wood-hit", 0.8);
      renderStamps(ch.id);
    },
    close: () => {
      renderActivity();
      renderStamps();
      if (tour || autoNext) tourNext();
    },
    params: () => engine?.params?.(ch.id) ?? [],
    setParams: (v) => {
      engine?.setParams?.(v);
      refreshEngineCues();
    },
    sourceMarks: (ids) => sourceMarks(ids),
    reducedMotion,
    stamps: () => stampsOn,
  });
  const stampsEl = h("section", { class: "pv-card pv-stamps", "aria-label": t("player.stamps") });
  // Storybook touch activity: the panel at the chapter's end and the badges over the characters.
  const playPanel = new TouchPlayPanel({
    choose: (k) => {
      engine?.choose?.(ch.id, k);
      renderPlay();
    },
    reducedMotion,
  });
  const marks = new MarkLayer(reducedMotion);
  const markAnchor = { entity: "", part: "top", offset: [0, 0.5, 0] as [number, number, number] };
  // The badge callbacks are made once; the frame hands them the chapter time through these two.
  let markShown = false;
  let markT = 0;
  const markResolve = (id: string, out: THREE.Vector3): boolean => {
    markAnchor.entity = id;
    return markShown && !!stage?.resolveWorld(markAnchor, ch.id, markT, out);
  };
  const markProject = (v: THREE.Vector3): THREE.Vector3 => (stage ? stage.project(v) : v);

  const deepList = h("ul");
  const deepSpeak = h("button", { class: "pv-btn soft small", type: "button" }, t("player.deepListen"));
  const deepEl = h("details", { class: "pv-card pv-deep" }, h("summary", {}, t("player.deep")), h("div", { class: "pv-body" }, deepList, deepSpeak));
  // Numbered list of the chapter's labels (the numbers of the dots on the stage).
  const pinList = h("ol", { class: "pv-pinlist" });
  const pinListEl = h("details", { class: "pv-card pv-pins-card" }, h("summary", {}, t("player.labels")), h("div", { class: "pv-body" }, pinList));
  const quizEl = h("section", { class: "pv-card pv-quiz", "aria-live": "polite" });

  const panel = h(
    "aside",
    { class: "pv-panel", "aria-label": t("player.panel") },
    h(
      "div",
      { class: "pv-head" },
      h("div", {}, h("div", { class: "pv-eyebrow" }, `${spec.page.subject} · ${spec.page.topic}`), h("h1", {}, spec.title)),
      tourBtn,
      restartBtn,
    ),
    h("div", { class: "pv-meander", "aria-hidden": "true" }),
    chipsEl,
    book2d,
    narrCard,
    keyPoints,
    hasStage ? null : activity.el,
    deepEl,
    hasStage ? pinListEl : null,
    quizEl,
    stampsEl,
  );
  if (stageEl) stageEl.append(activity.el, marks.el, playPanel.el);
  const videosEl = buildVideos(spec.videos, !!opts.exported);
  if (videosEl) panel.append(videosEl);
  const sources = buildSources(spec, !!opts.exported);
  panel.append(sources.el);
  panel.append(themePicker(theme));
  if (spec.disclaimers.length) panel.append(h("footer", { class: "pv-foot" }, ...spec.disclaimers.map((d) => h("p", {}, d))));
  app.append(panel);
  container.replaceChildren(app);

  // ---------- Stage (async: engine build) ----------
  let stage: Stage | null = null;
  let pins: PinLayer | null = null;
  if (stageEl) {
    if (engine) {
      // Accademico: the boards draw formulas with the KaTeX fonts, so they load first (bounded wait).
      if (academic) await Promise.race([loadKatex(), new Promise((r) => setTimeout(r, KATEX_WAIT_MS))]);
      try {
        stage = await Stage.create(stageEl, engine, spec, {
          reducedMotion,
          academic,
          loadAsset: opts.loadAsset ?? (async (path) => {
            const res = await fetch(localAssetUrl(path, opts.assetBase ?? document.baseURI));
            if (!res.ok) throw new Error(`asset ${path}: HTTP ${res.status}`);
            return res.arrayBuffer();
          }),
        });
        stage.setStyle(style);
        stage.setTheme(theme.book);
        stage.setPlainBackground(theme.dark ? PLAIN_BG.dark : PLAIN_BG.light);
        pins = new PinLayer(labelsEl, onPin, formulaInto);
        const canvas = stage.renderer.domElement;
        const taps = new TapDetector();
        const tapSounds = new TapSoundLimiter();
        canvas.addEventListener("pointerdown", (e) => {
          pins?.collapse();
          dismissHint();
          taps.down(e, performance.now());
        });
        canvas.addEventListener("pointermove", (e) => taps.move(e));
        canvas.addEventListener("pointercancel", () => taps.cancel());
        // A release outside the canvas never reaches it: forget the press, or it would swallow the next tap.
        canvas.addEventListener("pointerleave", () => taps.cancel());
        canvas.addEventListener("lostpointercapture", () => taps.cancel());
        // A short, still press on a character (engines with `tap`): it bounces and sounds. Orbit drags never get here.
        canvas.addEventListener("pointerup", (e) => {
          const at = taps.up(e, performance.now());
          const ray = at && engine?.tap && stage?.pickRay(at.x, at.y);
          if (!ray || !engine?.tap) return;
          // The engine asks the global limit only when its own per-character limit lets a sound through.
          const hit = engine.tap(ch.id, playback.t, ray, performance.now(), (now) => tapSounds.allow(now));
          if (!hit) return;
          if (hit.sound) sfx(hit.sound, hit.complete ? DONE_VOLUME : TAP_VOLUME);
          renderPlay();
          if (hit.complete) playDone();
        });
      } catch (e) {
        console.error("[player] 3D stage unavailable:", e);
        const webgl = /webgl/i.test(String(e));
        stageEl.prepend(h("div", { class: "pv-fail" }, t(webgl ? "player.webglFail" : "player.buildFail")));
      }
    } else {
      stageEl.prepend(h("div", { class: "pv-fail" }, t("player.buildFail")));
    }
    centerBtn.hidden = !stage;
  }
  setStyle(style, false);

  // ---------- Actions ----------
  function say(text: string): void {
    playback.pause();
    stopVoice();
    tts.speak(text, () => {});
  }

  function stopTour(): void {
    tour = false;
    tourWaits = false;
    clearTimeout(tourTimer);
    tourBtn.replaceChildren(icon("play"), h("span", {}, t("player.tour")));
  }

  /** The chapter after the current one: this scene's, else the first following one (`later`, D22). */
  function nextChip(): { id: string; chip: string; later: boolean } | undefined {
    const own = chapters[chapters.indexOf(ch) + 1];
    if (own) return { id: own.id, chip: own.chip, later: false };
    const f = following?.[0];
    return f ? { ...f, later: true } : undefined;
  }

  /** Moves on to a chapter of this scene, or (`later`) of the complete lesson that follows it (D22). */
  function advance(next: { id: string; later: boolean }, keepTour: boolean): void {
    if (!next.later) return go(next.id, true);
    clearTimeout(tourTimer);
    playback.pause();
    stopVoice();
    opts.following?.onContinue(next.id, keepTour);
  }

  /**
   * Timeline arrows: previous/next chapter; "next" also reaches the following chapters (D22).
   * At the ends an arrow turns invisible but keeps its slot, so a second tap never lands on the other one;
   * focus on a vanishing arrow moves to the other one.
   */
  function renderSteps(): void {
    const prev = chapters[chapters.indexOf(ch) - 1];
    const next = nextChip();
    const set = (el: HTMLButtonElement, text: string | null, other: HTMLButtonElement) => {
      const on = text !== null;
      if (!on && document.activeElement === el) (other.classList.contains("off") ? tlPlay : other).focus();
      el.classList.toggle("off", !on);
      el.tabIndex = on ? 0 : -1;
      if (on) {
        el.removeAttribute("aria-hidden");
        el.setAttribute("aria-label", text);
        el.title = text;
      } else el.setAttribute("aria-hidden", "true");
    };
    const prevText = prev ? t("player.prevChapter", { chip: prev.chip }) : null;
    const nextText = next ? t("quiz.nextChapter", { chip: next.chip }) : null;
    // Turn the arrow that stays on first, so focus can move onto it.
    if (prevText) set(tlPrev, prevText, tlNext);
    if (nextText) set(tlNext, nextText, tlPrev);
    if (!prevText) set(tlPrev, null, tlNext);
    if (!nextText) set(tlNext, null, tlPrev);
  }
  tlPrev.onclick = () => {
    const prev = chapters[chapters.indexOf(ch) - 1];
    if (prev) go(prev.id, true);
  };
  tlNext.onclick = () => {
    const next = nextChip();
    if (next) advance(next, tour);
  };

  /** Guided tour: next chapter after a pause; waits while the rest of the lesson is prepared (D22). */
  function tourNext(): void {
    const next = nextChip();
    if (next) tourTimer = setTimeout(() => (tour || autoNext) && advance(next, tour), TOUR_GAP_MS);
    else if (tour && following === null && ch === chapters.at(-1)) tourWaits = true;
    else stopTour();
  }

  function setPlaying(on: boolean): void {
    if (on) {
      stopVoice();
      playback.play();
    } else playback.pause();
  }

  function onPin(p: Pin): void {
    const q = quizOf(ch);
    if (q.picking) {
      const r = q.pick(p.id);
      if (r === "right") {
        audio.feedback(true);
        renderQuiz();
        say(feedbackSpeech(q.feedback!));
      } else if (r === "wrong") {
        audio.feedback(false);
        pins?.shake(p.id);
        say(engineText("say.wrongPin", { name: p.name }));
      }
      return;
    }
    stopTour();
    infoPin = p.id;
    icTitle.textContent = p.name + (p.sub ? ` · ${p.sub}` : "");
    if (!p.sub) formulaInto(icTitle, p.name);
    icText.textContent = p.info;
    infocard.hidden = false;
    say(`${p.name}. ${p.info}`);
  }

  function setStyle(s: VisualStyle, save = true): void {
    style = s;
    if (save) writeStyle(s);
    app.classList.toggle("pv-ink", s === "ink");
    for (const b of styleBtns) b.setAttribute("aria-pressed", String(b.dataset.style === s));
    stage?.setStyle(s);
  }

  function renderActivity(): void {
    const act = actOf(ch);
    activity.render(ch, act);
    stageEl?.classList.toggle("pv-act-on", !!act && act.phase !== "stamped" && act.phase !== "test");
  }

  function renderStamps(fresh?: string): void {
    const withAct = chapters.filter((c) => c.activity || engine?.play?.(c.id));
    stampsEl.hidden = withAct.length === 0 || !stampsOn;
    if (withAct.length === 0 || !stampsOn) return;
    const got = stamps.load(lessonKey);
    const n = withAct.filter((c) => c.id in got).length;
    const items = withAct.map((c) => {
      const name = got[c.id];
      if (!name) return h("div", { class: "pv-stamp empty", title: t("player.toEarn", { chip: c.chip }) }, h("small", {}, c.chip));
      return stampEl(name, c.id === fresh && !reducedMotion ? "fresh" : "");
    });
    const body: HTMLElement[] = [
      h("div", { class: "qhead" }, h("h3", {}, t("player.stamps")), h("span", { class: "prog" }, t("player.ofTotal", { n, total: withAct.length }))),
      h("div", { class: "pv-stamp-row" }, ...items),
    ];
    const act = actOf(ch);
    if (act?.phase === "stamped") {
      const redo = h("button", { class: "pv-btn soft small", type: "button" }, t("player.redo"));
      redo.onclick = () => {
        stopTour();
        act.restart();
        playback.pause();
        stopVoice();
        playback.seek(0);
        renderActivity();
        renderStamps();
      };
      body.push(h("div", { class: "pv-qnav" }, redo));
    }
    stampsEl.replaceChildren(...body);
  }

  // ---------- Storybook touch activity ----------
  /** The chapter's activity is live from the end of the scene: the panel is there and touches go to it. */
  const playAtEnd = () => playback.t >= ch.duration - PLAY_SLACK;
  let playShown = false;
  let playView: TouchPlayView | null = null;
  const playWaits = () => {
    const v = engine?.play?.(ch.id);
    return !!v && !v.complete && !stamps.has(lessonKey, ch.id);
  };
  /**
   * Phones (the CSS phone breakpoint): the panel sits below the stage, above the lesson title, so the whole
   * scene stays visible and touchable; elsewhere it overlays the stage. Moved only when the place changes,
   * so a focused swatch keeps its focus.
   */
  function placePlay(): void {
    const phone = !!window.matchMedia?.("(max-width: 600px)").matches && !!stageEl;
    playPanel.el.classList.toggle("below", phone);
    const home: Element | null = phone ? panel : stageEl;
    if (!home || playPanel.el.parentElement === home) return;
    if (phone) panel.prepend(playPanel.el);
    else home.append(playPanel.el);
  }
  function renderPlay(): void {
    placePlay();
    playView = engine?.play?.(ch.id) ?? null;
    const was = playShown;
    playShown = !!playView && playAtEnd();
    // Below the stage on a phone: bring it into view when it opens.
    if (playShown && !was && playPanel.el.classList.contains("below")) panel.scrollTop = 0;
    // While the activity is live the label pins let touches through to the characters under them.
    stageEl?.classList.toggle("pv-playing", playShown);
    playPanel.render(playShown ? playView : null);
    marks.set(playShown ? (playView?.marks ?? []) : []);
  }
  /** The touch that finished the activity: the stamp is awarded and the tour goes on. */
  function playDone(): void {
    if (stampsOn && playView?.complete) {
      stamps.add(lessonKey, ch.id, playView.stamp);
      renderStamps(ch.id);
    }
    if (tour || autoNext) tourNext();
  }

  let entered = false;
  function go(id: string, autoplay = false): void {
    const next = chapters.find((c) => c.id === id);
    if (!next) return;
    const dir: 1 | -1 = chapters.indexOf(next) < chapters.indexOf(ch) ? -1 : 1;
    clearTimeout(tourTimer);
    tourWaits = false;
    quizOf(ch).stopPick();
    stopVoice();
    ch = next;
    playback.load(ch);
    audio.load(ch, engine?.sounds?.(ch.id));
    infocard.hidden = true;

    for (const b of chipsEl.children) {
      const on = (b as HTMLElement).dataset.id === id;
      b.setAttribute("aria-current", String(on));
      if (on) b.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    }
    const k = chapters.indexOf(ch);
    ar?.chapter(k > 0, k < chapters.length - 1);
    renderSteps();
    kindPill(hudKind, ch.kind);
    kindPill(cardKind, ch.kind);
    hudDates.textContent = ch.dates ?? ch.chip;
    cardChip.textContent = ch.chip;
    cardDates.textContent = ch.dates ? `· ${ch.dates}` : "";
    chTitle.textContent = ch.title;

    // Engines with a word timeline (storybook): each word of the sentence is a span, the spoken one lit.
    wordOffsets = engine?.words?.(ch.id) ?? [];
    wordEls = [];
    shownWord = { sentence: -1, word: -1 };
    narrEl.replaceChildren(
      ...ch.narration.map((s, i) => {
        const lineLang = s.lang ?? (s.speaker ? speakerLang.get(s.speaker) : undefined);
        const tag = isForeign(lineLang, lessonLang) ? langTag(lineLang!) : null;
        const name = s.speaker ? speakerName.get(s.speaker) : undefined;
        // "Anna · EN: ..." for lines in another language.
        const who = name || tag ? [name, tag].filter(Boolean).join(" · ") : undefined;
        const span = h(
          "span",
          { title: t("player.jump"), tabindex: "0", role: "button" },
          who ? h("b", { class: "pv-speaker" }, `${who}: `) : null,
          ...sentenceNodes(s.text, i),
          ...sourceMarks(s.sourceIds),
          " ",
        );
        const jump = () => {
          stopTour();
          stopVoice();
          playback.jumpTo(i);
        };
        span.addEventListener("click", jump);
        span.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jump();
          }
        });
        return span;
      }),
    );

    deepEl.hidden = ch.deep.length === 0;
    deepEl.open = false;
    deepList.replaceChildren(...ch.deep.map((d) => h("li", {}, d.text, ...sourceMarks(d.sourceIds))));

    tlRange.max = String(ch.duration);
    tlRange.value = "0";
    tlMarks.replaceChildren(
      ...ch.narration.map((s) => {
        const m = h("i");
        m.style.left = `${(s.at / ch.duration) * 100}%`;
        return m;
      }),
    );

    pins?.setPins(ch.pins);
    pinListEl.hidden = ch.pins.length === 0;
    pinList.replaceChildren(
      ...ch.pins.map((p) => {
        const b = h("button", { type: "button" }, p.name, p.sub ? h("small", {}, ` · ${p.sub}`) : null);
        b.onclick = () => onPin(p);
        return h("li", {}, b);
      }),
    );
    engine?.setParams?.(null);
    refreshEngineCues();
    activity.resetValues();
    const left = leftPageText(spec, ch);
    stage?.setChapter(ch, { left, right: null, rightFolio: String(Number(left.folio) + 1) }, true, dir);
    if (book2d) renderBook2d(book2d, left, rightPageText(spec, ch), (el, text) => void formulaInto(el, text));
    if (keyPoints) renderKeyPoints(keyPoints, ch);
    if (entered && stage && !academic) sfx("page-turn", 0.35);
    entered = true;
    renderQuiz();
    renderActivity();
    renderPlay();
    renderStamps();
    if (autoplay && !actOf(ch)?.blocksPlayback) setPlaying(true);
    sync(true);
  }

  /** Accademico: the chapter's printed page (heading, key formula, lines) as a panel card. */
  function renderKeyPoints(el: HTMLElement, c: Chapter): void {
    el.hidden = !c.book;
    if (!c.book) return;
    // The "formula" line is sometimes a date or a short phrase: only real formulas are typeset.
    const formula = c.book.formula ? h("div", { class: "pv-kp-formula" }, c.book.formula) : null;
    if (formula && c.book.formula) formulaInto(formula, c.book.formula);
    const lines = c.book.lines.map((l, i, all) => h("li", {}, l, ...(i === all.length - 1 ? sourceMarks(c.book!.sourceIds) : [])));
    el.replaceChildren(
      ...[h("div", { class: "pv-kp-label" }, t("player.keyPoints")), h("h3", {}, c.book.heading), formula, lines.length ? h("ul", {}, ...lines) : null].filter(
        (x): x is NonNullable<typeof x> => x !== null,
      ),
    );
  }

  function sourceMarks(ids: readonly string[]): HTMLElement[] {
    return ids.flatMap((id) => {
      const n = sourceIndex.get(id);
      if (n === undefined) return [];
      const src = spec.sources[n]!;
      const a = h("a", { class: "pv-src", href: `#pv-src-${n}`, title: t("player.sourceOf", { title: src.title }) }, `[${n + 1}]`);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sources.reveal(n, reducedMotion);
      });
      return [h("sup", {}, a)];
    });
  }

  // ---------- Quiz ----------
  function renderQuiz(): void {
    const st = quizOf(ch);
    const Q = ch.quiz;
    quizEl.hidden = Q.length === 0;
    stageEl?.classList.toggle("pv-picking", st.picking);
    pickbar.hidden = !st.picking;
    pins?.markRight(st.rightPins);
    if (Q.length === 0) return;
    const head = (prog: string) => h("div", { class: "qhead" }, h("h3", {}, t("quiz.title")), h("span", { class: "prog" }, prog));

    if (st.done) {
      const nextCh = nextChip();
      const restart = h("button", { class: "pv-btn soft small", type: "button" }, t("quiz.restart"));
      restart.onclick = () => {
        st.restart();
        renderQuiz();
      };
      const nav = h("div", { class: "pv-qnav" }, restart);
      if (nextCh) {
        const nb = h("button", { class: "pv-btn primary small", type: "button" }, t("quiz.nextChapter", { chip: nextCh.chip }));
        nb.onclick = () => {
          stopTour();
          advance(nextCh, false);
        };
        nav.append(nb);
      }
      quizEl.replaceChildren(head(`${st.score}/${Q.length}`), h("p", { class: "q" }, t("quiz.score", { score: st.score, total: Q.length })), nav);
      return;
    }

    const q = st.current!;
    const body: HTMLElement[] = [head(t("player.ofTotal", { n: st.i + 1, total: Q.length })), h("p", { class: "q" }, q.q)];
    const nav = h("div", { class: "pv-qnav" });

    if (q.type === "choice") {
      body.push(
        h(
          "div",
          { class: "pv-opts" },
          ...q.options.map((o, k) => {
            const b = h("button", { type: "button" }, o);
            if (st.answered) {
              b.disabled = true;
              if (k === q.answer) b.classList.add("right");
              else if (k === st.chosen) b.classList.add("wrong");
            }
            b.onclick = () => {
              const ok = st.answerChoice(k);
              if (ok === null) return;
              audio.feedback(ok);
              stopTour();
              renderQuiz();
              say(feedbackSpeech(st.feedback!));
            };
            return b;
          }),
        ),
      );
    } else if (!st.answered) {
      const hint = t(st.picking ? "quiz.picking" : pins ? "quiz.pickHint" : "quiz.noStage");
      body.push(h("div", { class: "pv-pickhint" }, hint));
      if (pins && !st.picking) {
        const start = h("button", { class: "pv-btn primary small", type: "button" }, t("quiz.pickStart"));
        start.onclick = () => {
          stopTour();
          playback.pause();
          stopVoice();
          infocard.hidden = true;
          st.startPick();
          pickbar.textContent = q.q;
          renderQuiz();
        };
        nav.append(start);
      }
      const show = h("button", { class: "pv-btn soft small", type: "button" }, t("quiz.show"));
      show.onclick = () => {
        stopTour();
        st.showAnswer();
        renderQuiz();
        say(feedbackSpeech(st.feedback!));
      };
      nav.append(show);
    }

    if (st.feedback) {
      const f = st.feedback;
      const fb = h("p", { class: "pv-fb" });
      if (f.ok === true) fb.append(h("b", { class: "ok" }, t("quiz.right")), " ");
      if (f.ok === false) fb.append(h("b", { class: "bad" }, t("quiz.wrong")), " ");
      fb.append(f.text);
      body.push(fb);
      const nb = h("button", { class: "pv-btn soft small", type: "button" }, t(st.i < Q.length - 1 ? "quiz.next" : "quiz.result"));
      nb.onclick = () => {
        st.next();
        renderQuiz();
      };
      nav.append(nb);
    }
    quizEl.replaceChildren(...body, nav);
  }

  // ---------- Wiring ----------
  const chipButton = (c: { id: string; chip: string; kind: SceneKind }, later = false) => {
    const b = h("button", { type: "button", ...(later ? {} : { "data-id": c.id }) }, h("i", { class: c.kind === "myth" ? "myth" : "hist" }), c.chip);
    b.onclick = () => {
      stopTour();
      advance({ id: c.id, later }, false);
    };
    return b;
  };
  /** D22: the following chapters' chips, or one disabled "in preparazione" chip while they are prepared. */
  const followEl = h("span", { class: "pv-chips-next" });
  function renderFollowing(): void {
    if (following === null) {
      const b = h("button", { type: "button", class: "pv-pending", disabled: "", "aria-disabled": "true" }, h("i"), t("player.pending"));
      followEl.replaceChildren(b);
    } else followEl.replaceChildren(...following.map((c) => chipButton(c, true)));
  }
  chipsEl.append(...chapters.map((c) => chipButton(c)), followEl);
  renderFollowing();
  const togglePlay = () => {
    if (playback.playing) {
      setPlaying(false);
      stopTour();
    } else setPlaying(true);
  };
  tlPlay.onclick = togglePlay;
  playBtn.onclick = togglePlay;
  tlRange.addEventListener("input", () => {
    dragging = true;
    setPlaying(false);
    stopTour();
    playback.seek(Number(tlRange.value));
  });
  tlRange.addEventListener("change", () => (dragging = false));
  centerBtn.onclick = () => {
    keys.clear();
    stage?.setMove(NO_MOVE);
    stage?.recenter();
  };
  icSpeak.onclick = () => say(`${icTitle.textContent}. ${icText.textContent}`);
  icClose.onclick = () => {
    infocard.hidden = true;
    stopVoice();
  };
  deepSpeak.onclick = () => {
    stopTour();
    playback.pause();
    stopVoice();
    cancelList = speakList(tts, ch.deep.map((d) => d.text));
  };
  voiceInput.onchange = () => {
    voiceOn = voiceInput.checked;
    // Re-speak the current sentence with the new mode (voice or timed highlight).
    if (playback.playing) {
      playback.pause();
      playback.play();
    } else stopVoice();
  };
  soundsInput.onchange = () => {
    audio.setSounds(soundsInput.checked);
    writePref(soundsPref, soundsInput.checked);
  };
  autoInput.onchange = () => {
    autoNext = autoInput.checked;
    writePref("autoNext", autoNext);
    if (!autoNext && !tour) clearTimeout(tourTimer);
  };
  stampsInput.onchange = () => {
    stampsOn = stampsInput.checked;
    try {
      localStorage.setItem(ACADEMIC_STAMPS_KEY, stampsOn ? "1" : "0");
    } catch {
      /* this page only */
    }
    renderActivity();
    renderStamps();
  };
  musicInput.onchange = () => {
    audio.setMusic(musicInput.checked);
    writePref("music", musicInput.checked);
  };
  if (restartBtn) {
    restartBtn.onclick = () => {
      if (!confirm(t("player.restartConfirm"))) return;
      stopTour();
      stamps.clear(lessonKey);
      quizzes.clear();
      activities.clear();
      go(chapters[0]!.id, false);
    };
  }
  tourBtn.onclick = () => {
    if (tour) {
      stopTour();
      setPlaying(false);
      return;
    }
    startTour();
    go(chapters[0]!.id, true);
  };
  function startTour(): void {
    tour = true;
    tourBtn.replaceChildren(icon("pause"), h("span", {}, t("player.tourStop")));
  }
  stopTour();
  if (opts.start?.tour) startTour();

  // ---------- Loop ----------
  let shownPlaying: boolean | null = null;
  let shownSentence = -2;
  /** A sentence's text with its words wrapped in spans when the engine times them. */
  function sentenceNodes(text: string, i: number): (string | HTMLElement)[] {
    const offs = wordOffsets[i];
    const words = splitWords(text);
    if (!offs || offs.length !== words.length || words.length === 0) return [text];
    const nodes: (string | HTMLElement)[] = [];
    const els: HTMLElement[] = [];
    let pos = 0;
    for (const w of words) {
      if (w.start > pos) nodes.push(text.slice(pos, w.start));
      const el = h("span", { class: "pv-word" }, w.word);
      els.push(el);
      nodes.push(el);
      pos = w.end;
    }
    if (pos < text.length) nodes.push(text.slice(pos));
    wordEls[i] = els;
    return nodes;
  }
  /** The word being read: the last one of the highlighted sentence that has started. */
  function syncWord(): void {
    const i = playback.highlighted;
    const els = wordEls[i];
    const offs = wordOffsets[i];
    let k = -1;
    if (els && offs) for (let j = 0; j < offs.length; j++) if (ch.narration[i]!.at + offs[j]! <= playback.t) k = j;
    const live = playback.boundary;
    if (els && live && live.sentence === i) {
      // The voice reports its words: they drive the highlight, which never goes back within the pass.
      // If it stops reporting for a while, the estimate carries on from the last reported word.
      const reported = Math.max(wordAtChar(ch.narration[i]!.text, live.char), 0, shownWord.sentence === i ? shownWord.word : -1);
      k = playback.sinceBoundary > BOUNDARY_SILENCE ? Math.max(k, reported) : reported;
    }
    if (shownWord.sentence === i && shownWord.word === k) return;
    wordEls[shownWord.sentence]?.[shownWord.word]?.classList.remove("pv-word-on");
    if (els && k >= 0) els[k]!.classList.add("pv-word-on");
    shownWord = { sentence: els ? i : -1, word: els ? k : -1 };
  }
  function sync(force = false): void {
    if (!dragging) tlRange.value = String(playback.t);
    tlTime.textContent = `${formatTime(playback.t)} / ${formatTime(playback.duration)}`;
    if (force || shownPlaying !== playback.playing) {
      shownPlaying = playback.playing;
      tlPlay.replaceChildren(icon(playback.playing ? "pause" : "play"));
      tlPlay.setAttribute("aria-label", t(playback.playing ? "player.pause" : "player.play"));
      playBtn.replaceChildren(
        icon(playback.playing ? "pause" : "play"),
        h("span", {}, t(playback.playing ? "player.pause" : hasStage ? "player.watch" : "player.listen")),
      );
    }
    if (force || shownSentence !== playback.highlighted) {
      shownSentence = playback.highlighted;
      [...narrEl.children].forEach((e, j) => e.classList.toggle("on", j === shownSentence));
    }
    syncWord();
    const st = statusAt(ch.status, playback.t);
    const picking = quizOf(ch).picking;
    statusEl.hidden = !st || picking;
    if (st && statusEl.textContent !== st) statusEl.textContent = st;
  }

  // Labels: content footprint, "Etichette" mode.
  let grids: ReturnType<Stage["contentGrids"]> | null = null;
  let gridsIn = 0;

  // Stage areas the labels avoid (HUD, timeline, cards), refreshed a few times per second.
  let infoPin: string | null = null;
  let blocked: Rect[] = [];
  let blockedIn = 0;
  function blockedRects(): Rect[] {
    if (!stageEl) return [];
    const base = labelsEl.getBoundingClientRect();
    const els = [
      ...stageEl.querySelectorAll<HTMLElement>(".pv-hud > *, .pv-timeline, .pv-status, .pv-pickbar, .pv-infocard, .pv-act > *, .pv-arbar, .pv-ar-msg"),
    ];
    return els
      .filter((e) => !e.hidden && e.offsetParent !== null)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      })
      .filter((r) => r.w > 0 && r.h > 0);
  }

  // ---------- Free movement (keyboard, on-screen pad, first-time hint) ----------
  const keys = new Set<keyof MoveInput>();
  let stageHot = false;
  let hintEl: HTMLElement | null = null;
  const KEYMAP: Record<string, keyof MoveInput> = {
    ArrowUp: "forward",
    KeyW: "forward",
    ArrowDown: "back",
    KeyS: "back",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    KeyE: "up",
    KeyQ: "down",
  };
  const pushMove = () => stage?.setMove({ ...NO_MOVE, ...Object.fromEntries([...keys].map((k) => [k, true])) });
  function releaseKeys(): void {
    keys.clear();
    pushMove();
  }
  function onKey(e: KeyboardEvent): void {
    const k = KEYMAP[e.code];
    if (!k || !stage) return;
    const tgt = e.target as HTMLElement | null;
    const typing = !!tgt && (/^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) || tgt.isContentEditable);
    if (e.type === "keydown") {
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const focusIn = !!stageEl && stageEl.contains(document.activeElement);
      if (!stageHot && !focusIn) return;
      e.preventDefault(); // arrows would scroll the page
      keys.add(k);
      dismissHint();
    } else keys.delete(k);
    pushMove();
  }
  function dismissHint(): void {
    if (!hintEl) return;
    hintEl.remove();
    hintEl = null;
    writeFlag(HINT_KEY);
  }
  function setupMovement(st: Stage, el: HTMLElement): void {
    el.addEventListener("pointerenter", () => (stageHot = true));
    el.addEventListener("pointerleave", () => (stageHot = false));
    st.renderer.domElement.tabIndex = 0;
    st.renderer.domElement.setAttribute("aria-label", t("player.stageAria"));
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    window.addEventListener("blur", releaseKeys);
    // On-screen pad for touch devices: hold an arrow to move.
    const touch = isTouchDevice();
    if (touch) {
      const pad = h("div", { class: "pv-movepad", role: "group", "aria-label": t("move.pad") });
      const toggle = h("button", { type: "button", class: "pv-movepad-toggle", "aria-label": t("move.toggle"), "aria-expanded": "false" }, "✥");
      const buttons: Array<[keyof MoveInput, string, string]> = [
        ["forward", "▲", t("move.forward")],
        ["left", "◀", t("move.left")],
        ["right", "▶", t("move.right")],
        ["back", "▼", t("move.back")],
        ["up", "⤒", t("move.up")],
        ["down", "⤓", t("move.down")],
      ];
      const grid = h("div", { class: "pv-movepad-grid" });
      for (const [k, glyph, label] of buttons) {
        const b = h("button", { type: "button", class: `mv-${k}`, "aria-label": label }, glyph);
        const on = (e: PointerEvent) => {
          e.preventDefault();
          b.setPointerCapture?.(e.pointerId);
          keys.add(k);
          pushMove();
        };
        const off = () => {
          keys.delete(k);
          pushMove();
        };
        b.addEventListener("pointerdown", on);
        for (const ev of ["pointerup", "pointercancel", "lostpointercapture"] as const) b.addEventListener(ev, off);
        grid.append(b);
      }
      grid.hidden = true;
      toggle.onclick = () => {
        grid.hidden = !grid.hidden;
        toggle.setAttribute("aria-expanded", String(!grid.hidden));
        if (grid.hidden) releaseKeys();
        dismissHint();
      };
      pad.append(grid, toggle);
      el.append(pad);
    }
    if (!readFlag(HINT_KEY)) {
      const ok = h("button", { type: "button", class: "pv-btn soft small" }, t("player.gotIt"));
      ok.onclick = dismissHint;
      hintEl = h(
        "div",
        { class: "pv-hint", role: "note" },
        h("span", {}, touch ? HINT_TOUCH() : HINT_DESKTOP()),
        ok,
      );
      el.append(hintEl);
    }
  }

  if (stage && stageEl) setupMovement(stage, stageEl);

  // ---------- AR: the pop-up book on the real table (player/xr, docs/m5/ar.md) ----------
  let ar: ArMode | null = null;
  if (stage && stageEl && arEnabled(true, !!opts.exported)) {
    ar = new ArMode({
      stage,
      stageEl,
      buttonSlot: stageEl.querySelector<HTMLElement>(".pv-hud-r")!,
      loop: (now) => frame(now),
      pauseLoop: () => {
        windowLoop = false;
        cancelAnimationFrame(raf);
        releaseKeys();
      },
      resumeLoop: () => {
        if (windowLoop) return;
        windowLoop = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      },
      prevChapter: () => {
        const prev = chapters[chapters.indexOf(ch) - 1];
        if (prev) go(prev.id, true);
      },
      nextChapter: () => {
        const next = chapters[chapters.indexOf(ch) + 1];
        if (next) go(next.id, true);
      },
      touch: () => {
        pins?.collapse();
        dismissHint();
      },
    });
  }

  /** A docked activity card shifts the 3D picture so the book stays in the free part of the stage. */
  function dockInsets(): void {
    if (!stage || !stageEl) return;
    const s = stageEl.getBoundingClientRect();
    const vis = (e: Element | null): e is HTMLElement => !!e && (e as HTMLElement).offsetParent !== null && !(e as HTMLElement).hidden;
    // Top: the HUD bar. Bottom: the highest of timeline, PROVA bar and the phone's bottom sheet.
    let top = 0;
    for (const e of stageEl.querySelectorAll(".pv-hud > *")) if (vis(e)) top = Math.max(top, e.getBoundingClientRect().bottom - s.top);
    // The Prevedi card starts below the HUD, however many rows it wraps to (small widgets, OpenBoard).
    const hud = `${Math.round(top)}px`;
    if (stageEl.style.getPropertyValue("--pv-hud-h") !== hud) stageEl.style.setProperty("--pv-hud-h", hud);
    let bottomEdge = s.bottom;
    for (const sel of [".pv-timeline", ".pv-act-ribbon"]) {
      const e = stageEl.querySelector(sel);
      if (vis(e)) bottomEdge = Math.min(bottomEdge, e.getBoundingClientRect().top);
    }
    // Docked card: a bottom sheet (phones) lifts the picture; docked at the side (desktop) it lies on the
    // left page in the book overview, which prints the same question, and moves the chapter's view beside
    // it once the camera joins it (stage.setInsets). A folded card is only a small tab: no inset.
    const pad = 6;
    let left = 0;
    let right = 0;
    // The storybook activity panel (.pv-play) lies over the stage on purpose: it must not push the camera back.
    const card = stageEl.querySelector(".pv-act-card:not(.pv-play)");
    if (vis(card)) {
      const r = card.getBoundingClientRect();
      if (r.width > s.width * 0.7) bottomEdge = Math.min(bottomEdge, r.top);
      else if (!card.classList.contains("min")) {
        if (r.left + r.width / 2 < s.left + s.width / 2) left = r.right - s.left + pad;
        else right = s.right - r.left + pad;
      }
    }
    stage.setInsets(left, Math.max(0, s.bottom - bottomEdge + pad), top > 0 ? top + pad : 0, right);
  }

  let last = performance.now();
  let raf = 0;
  /** False while an AR session drives frame() from XR frames (renderer.setAnimationLoop). */
  let windowLoop = true;
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    playback.tick(dt);
    audio.update({ t: playback.t, playing: playback.playing, speaking });
    if (stage && pins) {
      const t = playback.t;
      const picking = quizOf(ch).picking;
      const hi = ch.narration[playback.highlighted]?.highlight;
      const keyAnchors = style === "ink" && hi?.length ? ch.pins.filter((p) => hi.includes(p.id)).map((p) => p.anchor) : [];
      ar?.update();
      stage.frame(dt, ch.id, t, { picking, keyAnchors, now });
      // Labels wait until the pop-up content stands on the page.
      const shown = picking || stage.contentShown;
      const q = quizOf(ch);
      const focused = picking && q.current?.type === "pick" ? [...q.current.answerPins] : [];
      if (!infocard.hidden && infoPin) focused.push(infoPin);
      if (--blockedIn <= 0) {
        blockedIn = 12;
        blocked = blockedRects();
        dockInsets();
        activity.syncSliders();
      }
      // Content footprint for the labels, a few times per second.
      if (--gridsIn <= 0) {
        gridsIn = 6;
        grids = stage.contentGrids();
      }
      const inside = Math.round(stage.inside * 20) / 20;
      if (pageFrame.style.opacity !== String(inside)) pageFrame.style.opacity = String(inside);
      pins.update(t, picking, (p, out) => shown && (picking || stage!.anchorShown(p.anchor, ch.id, t)) && stage!.resolveWorld(p.anchor, ch.id, t, out), (v) => stage!.project(v), stage.width, stage.height, {
        highlighted: playback.highlighted >= 0 ? (ch.narration[playback.highlighted]?.highlight ?? []) : [],
        focused,
        blocked,
        narrow: stage.narrow,
        dt,
        occluded: (w) => stage!.occluded(w),
        content: grids?.content,
        keys: grids?.keys,
        onContent: (grids?.fill ?? 0) > 0.55,
        mode: labelMode,
      });
      markShown = shown;
      markT = t;
      marks.update(markResolve, markProject, stage.width, stage.height);
    }
    // The activity opens when the scene reaches its end (or the child drags there) and closes when it leaves it.
    if (engine?.play && playAtEnd() !== playShown && playView) renderPlay();
    sync();
    if (windowLoop) raf = requestAnimationFrame(frame);
  };

  go(ch.id, false);
  raf = requestAnimationFrame(frame);

  return {
    go,
    setFollowing(chips) {
      following = chips;
      renderFollowing();
      // The quiz's "next chapter" button and the timeline arrow may now have somewhere to go.
      renderQuiz();
      renderSteps();
      if (tourWaits && tour) {
        tourWaits = false;
        tourNext();
      }
    },
    dispose() {
      windowLoop = false;
      cancelAnimationFrame(raf);
      ar?.dispose();
      clearTimeout(tourTimer);
      stopVoice();
      activity.dispose();
      offTheme();
      for (const g of GESTURES) document.removeEventListener(g, unlockAudio, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", releaseKeys);
      webAudio?.dispose();
      if (stage) stage.dispose();
      else engine?.dispose();
      app.remove();
    },
  };
}

function buildVideos(videos: readonly Video[], exported: boolean): HTMLElement | null {
  if (videos.length === 0) return null;
  const body = h("div", { class: "pv-body" });
  for (const v of videos) {
    const meta = [v.channel, v.durationSec ? formatTime(v.durationSec) : undefined, v.provider === "youtube" ? "YouTube" : "Wikimedia Commons"]
      .filter(Boolean)
      .join(" · ");
    const load = h("button", { class: "pv-btn soft small", type: "button" }, icon("play"), h("span", {}, t("player.loadVideo")));
    const item = h("div", { class: "pv-video" }, h("b", {}, v.title), h("span", { class: "meta" }, meta), h("div", {}, load));
    load.onclick = () => {
      // Click-to-load: no request to the video provider until the user asks.
      const iframe = h("iframe", {
        src: videoEmbedUrl(v),
        title: v.title,
        allow: "encrypted-media; picture-in-picture; fullscreen",
        referrerpolicy: "strict-origin-when-cross-origin",
        allowfullscreen: "",
      });
      load.parentElement!.replaceWith(h("div", { class: "frame" }, iframe));
    };
    body.append(item);
  }
  body.append(h("p", { class: "pv-note" }, t("player.videoNote")));
  if (exported) body.append(h("p", { class: "pv-note" }, t("player.needsInternet")));
  return h("details", { class: "pv-card" }, h("summary", {}, t("player.videos")), body);
}

function buildSources(spec: SceneSpec, exported: boolean): { el: HTMLDetailsElement; reveal(n: number, instant: boolean): void } {
  const items = spec.sources.map((s: Source, n) => {
    const href = safeHref(s.url);
    const title = href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, s.title) : h("span", {}, s.title);
    const meta = [
      s.kind === "page" && spec.page.bookPage ? t("player.sourcePage", { page: spec.page.bookPage }) : undefined,
      s.publisher,
      s.accessed ? t("player.accessed", { date: formatDate(s.accessed) }) : undefined,
      s.license,
      s.wikidataId ? `Wikidata ${s.wikidataId}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return h("li", { id: `pv-src-${n}` }, title, meta ? h("span", { class: "meta" }, meta) : null);
  });
  const el = h("details", { class: "pv-card" }, h("summary", {}, t("player.sources")), h("div", { class: "pv-body" }, h("ol", { class: "pv-sources" }, ...items), exported ? h("p", { class: "pv-note" }, t("player.needsInternet")) : null));
  return {
    el,
    reveal(n, instant) {
      const li = items[n];
      if (!li) return;
      el.open = true;
      li.scrollIntoView({ block: "nearest", behavior: instant ? "auto" : "smooth" });
      li.classList.add("flash");
      setTimeout(() => li.classList.remove("flash"), 1200);
    },
  };
}
