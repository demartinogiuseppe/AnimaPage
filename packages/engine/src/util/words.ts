// Word timeline of a narrated sentence, for the storybook theatre: where each word starts, from the same
// reading-speed model the timed fallback voice uses (tts.ts), so sounds and highlight follow the voice.
import { speechUnits } from "@pv/scene-spec/i18n";
import { splitWords } from "@pv/scene-spec";
import { NARRATOR_RATE, timedDurationMs } from "../player/tts.ts";

export { splitWords };

/** Index of the word starting at or before `char` in `text` (the voice's boundary), -1 when `char` precedes the first word. */
export function wordAtChar(text: string, char: number): number {
  let k = -1;
  const ws = wordsOf(text);
  for (let j = 0; j < ws.length && ws[j]!.start <= char; j++) k = j;
  return k;
}

/** The player asks every frame: one split per sentence, not per frame (a small cache, last sentences only). */
const SPLITS = new Map<string, ReturnType<typeof splitWords>>();
function wordsOf(text: string): ReturnType<typeof splitWords> {
  let ws = SPLITS.get(text);
  if (!ws) {
    if (SPLITS.size >= 64) SPLITS.delete(SPLITS.keys().next().value!);
    SPLITS.set(text, (ws = splitWords(text)));
  }
  return ws;
}

/**
 * Seconds from the start of the sentence to the start of each word. The sentence lasts as long as
 * timedDurationMs says, divided by rate / NARRATOR_RATE, spread over the words by their speech units.
 */
export function wordTimes(text: string, lang: string | undefined, rate: number): number[] {
  const words = splitWords(text);
  const total = timedDurationMs(text, lang) / 1000 / (rate / NARRATOR_RATE);
  const weights = words.map((w) => (lang ? Math.max(speechUnits(w.word, lang), 1e-6) : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w) => {
    const at = (acc / sum) * total;
    acc += w;
    return at;
  });
}
