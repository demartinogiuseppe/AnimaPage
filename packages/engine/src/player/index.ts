// Public API of the common player.
export { mountPlayer, videoEmbedUrl, type AssetLoader, type PlayerHandle, type PlayerOptions } from "./player.ts";
export { Playback, sentenceAt, type PlaybackChapter, type PlaybackEvents } from "./playback.ts";
export {
  assignVoices,
  FakeTts,
  pickItalianVoice,
  pickVoice,
  lacksVoice,
  voiceGender,
  type VoiceSpec,
  speakList,
  timedDurationMs,
  TimerTts,
  WebSpeechTts,
  type TtsProvider,
} from "./tts.ts";
export { CAMERA_BLEND, cameraAt, defaultPose, type AnchorResolver, type CameraPose } from "./camera.ts";
export { feedbackSpeech, QuizState, type Feedback } from "./quiz.ts";
export { formatTime, isTextPin, pinVisibleAt, statusAt } from "./timing.ts";
export * from "./audio/index.ts";
export { applyTheme, DEFAULT_THEME, onThemeChange, readTheme, themeById, themePicker, THEMES, writeTheme, type Theme, type ThemeId } from "./themes.ts";
export { autoPresentation, PRESENTATION_PREFS, readPresentationPref, resolvePresentation, writePresentationPref, type Presentation, type PresentationPref } from "./presentation.ts";
export { sceneKey } from "../book/activity.ts";
