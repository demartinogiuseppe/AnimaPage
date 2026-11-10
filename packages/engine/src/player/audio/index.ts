// Player audio: ambience loops, timed cues, background music, ducking under the voice.
export { AudioDirector, DUCK_LEVEL, FEEDBACK_VOLUME, IDLE_MUSIC, type AudioOut, type FrameState } from "./director.ts";
export { ambienceAt, CueTracker, MAX_CONTINUOUS_STEP, WINDOW_FADE } from "./schedule.ts";
export { SOUND_LIBRARY, soundFile, soundSource, type SoundSource } from "./library.ts";
export { isLoopKind, loopify, synthesize, type Synth, type SynthKind } from "./synth.ts";
export { readPref, writePref, type AudioPref } from "./prefs.ts";
export { WebAudioOut } from "./webaudio.ts";
export { DEFAULT_DURATION, DEFAULT_FREQUENCY, INSTRUMENTS, noteParams, releaseTime, renderNote, type InstrumentKind } from "./instruments.ts";
