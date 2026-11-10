// Automatic key-fact matching for the eval report: a hint for the human reviewer, not a verdict.
import { statedNumbers } from "../../../server/src/generate/text.ts";

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ");

const STOP = new Set(
  "alla alle allo agli dalla dalle dallo degli della delle dello nella nelle nello negli sulla sulle sullo sugli come anche sono essere hanno quando dove dopo prima poi molto della questa questo quella quello loro tutti tutto ogni altri altre altro sulla carta principali".split(" "),
);

/** Share of the key fact's content words and numbers found in the scene. */
export function factCoverage(fact: string, sceneText: string): { ratio: number; missingNumbers: string[]; missingWords: string[] } {
  const text = norm(sceneText);
  const nums = new Set(statedNumbers(sceneText));
  const words = [...new Set(norm(fact).split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];
  // Compare word stems (first 5 letters) so "saccheggiano" matches "saccheggiarono".
  const stem = (w: string) => w.slice(0, Math.min(w.length, 5));
  const stems = new Set(text.split(/\s+/).map(stem));
  const missingWords = words.filter((w) => !stems.has(stem(w)));
  const missingNumbers = [...new Set(statedNumbers(fact))].filter((n) => !nums.has(n));
  const total = words.length + statedNumbers(fact).length;
  const found = words.length - missingWords.length + (statedNumbers(fact).length - missingNumbers.length);
  return { ratio: total ? found / total : 1, missingNumbers, missingWords };
}

