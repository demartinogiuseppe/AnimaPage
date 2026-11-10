// "Suoni" / "Musica" switches, remembered across lessons. Storage may be missing or blocked: then
// the switches still work for the current page.

/** "academicSounds": the "Suoni" switch of the Accademico presentation (decision D24), off by default. */
export type AudioPref = "sounds" | "music" | "academicSounds" | "autoNext";

const KEY: Record<AudioPref, string> = { sounds: "pv.audio.sounds", music: "pv.audio.music", academicSounds: "pv.audio.sounds.academic", autoNext: "pv.player.autonext" };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Defaults when the user never chose: sounds on, music off; sounds off in the Accademico presentation. */
const DEFAULT: Record<AudioPref, boolean> = { sounds: true, music: false, academicSounds: false, autoNext: false };

export function readPref(pref: AudioPref, store: StorageLike | null = storage()): boolean {
  try {
    const v = store?.getItem(KEY[pref]);
    return v === "1" ? true : v === "0" ? false : DEFAULT[pref];
  } catch {
    return DEFAULT[pref];
  }
}

export function writePref(pref: AudioPref, on: boolean, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(KEY[pref], on ? "1" : "0");
  } catch {
    /* private mode or quota: keep the value for this page only */
  }
}
