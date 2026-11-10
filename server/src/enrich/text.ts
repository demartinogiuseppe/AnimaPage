// Small text helpers shared by the enrichment modules (Italian-first, accent-insensitive).

const STOPWORDS = new Set(
  (
    "alla alle allo agli dalla dalle dallo dagli della delle dello degli nella nelle nello negli sulla sulle sullo sugli " +
    "come cosa sono essere anche dove quando quale quali questo questa questi queste quello quella quelli quelle " +
    "molto poco tutto tutti tutte ogni loro nostro vostro della perche pero dopo prima mentre senza sopra sotto " +
    "with from that this these those their there which about into have more most other some such than then very " +
    "file video videos"
  ).split(/\s+/),
);

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Significant tokens (>= 4 letters, no stopwords), accent-folded. */
export function tokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

export function keywordSet(...texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const k of tokens(t)) out.add(k);
  return out;
}

/** Number of keywords of `set` that occur as tokens in `text`. */
export function overlap(text: string, set: Set<string>): number {
  let n = 0;
  for (const t of new Set(tokens(text))) if (set.has(t)) n++;
  return n;
}

export function countMentions(haystack: string, needle: string): number {
  const h = fold(haystack);
  const n = fold(needle).trim();
  if (!n) return 0;
  let count = 0;
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + n.length)) count++;
  return count;
}

/** Removes parenthesised parts (pronunciation, alternative names, dates in the lead). */
export function stripParens(s: string): string {
  let out = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out.replace(/\s+([,.;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** First sentences of a Wikipedia lead, up to maxChars. "d.C." and initials do not end a sentence. */
export function leadSentences(extract: string, maxChars = 260): string {
  const text = stripParens(extract.split("\n")[0] ?? "");
  const parts = text.split(/(?<=[^A-Z.\s][.!?])\s+(?=[A-ZÀ-Ý])/);
  let out = "";
  for (const p of parts) {
    if (out && out.length + p.length + 1 > maxChars) break;
    out = out ? `${out} ${p}` : p;
    if (out.length >= maxChars * 0.6) break;
  }
  return out.length > maxChars ? `${out.slice(0, maxChars - 1).replace(/\s+\S*$/, "")}…` : out;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function slug(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
}

const IT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
export function formatNumberIt(n: number): string {
  return IT.format(n);
}
