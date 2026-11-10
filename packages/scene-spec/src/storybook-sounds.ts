// Sound variant *groups* of the storybook theatre (Storie). The generator sees only these groups (an
// id, a theme, a short description and the words that trigger it), never the sound files: the engine
// picks one variant of the group at random-but-seeded, so a story never sounds the same twice.
// A cue lands ON a word of the narration; `wordMatchesGroup` is how the checker (and the player)
// decide that the word really belongs to the group: a sound that does not match its word is worse
// than nothing.

export const STORY_THEMES = ["sea", "transport", "animals", "cartoon", "nature", "home", "music", "people", "magic", "weather"] as const;
export type StoryTheme = (typeof STORY_THEMES)[number];

export interface StoryGroup {
  id: string;
  theme: StoryTheme;
  /** ambience loops under a whole chapter; sfx is a one-shot on a word or an entrance. */
  kind: "ambience" | "sfx";
  /** Short description for the generator, in Italian and English. */
  it: string;
  en: string;
  /** Every form a story may use for this sound. */
  words: { it: string[]; en: string[] };
}

const g = (id: string, theme: StoryTheme, kind: StoryGroup["kind"], it: string, en: string, wi: string, we: string): StoryGroup => ({
  id,
  theme,
  kind,
  it,
  en,
  words: { it: wi.split(/\s*,\s*/), en: we.split(/\s*,\s*/) },
});

export const STORY_SOUND_GROUPS: readonly StoryGroup[] = [
  g("waves", "sea", "ambience", "onde del mare che sciabordano", "sea waves lapping", "mare, onde, onda, spiaggia, riva, oceano", "sea, waves, wave, beach, shore, ocean"),
  g("whale-spout", "sea", "sfx", "sbuffo d'acqua della balena", "whale spouting water", "balena, balene, balenottera, soffio, spruzzo, sbuffo", "whale, whales, spout, blow, spray"),
  g("boat-creak", "sea", "sfx", "scricchiolio di una barca di legno", "wooden boat creaking", "barca, barche, barchetta, veliero, nave, scricchiola, scricchiolio", "boat, boats, sailboat, ship, creak, creaks"),
  g("splash", "sea", "sfx", "tuffo e splash nell'acqua", "splash in the water", "splash, tuffo, tuffa, spruzza, spruzzi, plof, acqua", "splash, splashes, dive, plop, water"),
  g("seagull-call", "sea", "sfx", "verso del gabbiano", "seagull cry", "gabbiano, gabbiani, gabbianella", "seagull, seagulls, gull"),
  g("train-whistle", "transport", "sfx", "fischio del trenino", "train whistle", "fischio, fischia, fischiare, treno, trenino, treni, locomotiva", "whistle, whistles, train, locomotive"),
  g("train-chug", "transport", "sfx", "ciuf ciuf del treno in marcia", "chuffing train", "ciuf, sbuffa, sbuffo, vapore, rotaie, binari", "chuff, puff, steam, rails, tracks"),
  g("train-bell", "transport", "sfx", "campanella del treno", "train bell", "campana, campanella, din, dindon, ding", "bell, ding, dong"),
  g("cat-meow", "animals", "sfx", "miagolio del gatto", "cat meow", "gatto, gatta, gattino, gatti, miao, miagola, miagolio", "cat, cats, kitten, meow, meows"),
  g("chick-peep", "animals", "sfx", "pigolio del pulcino", "chick peeping", "pulcino, pulcini, pulcina, pio, pigola, pigolio, pigolare", "chick, chicks, peep, peeps, cheep"),
  g("dog-woof", "animals", "sfx", "abbaio del cane", "dog bark", "cane, cani, cagnolino, bau, abbaia, abbaio, abbaiare", "dog, dogs, puppy, woof, bark, barks"),
  g("cow-moo", "animals", "sfx", "muggito della mucca", "cow moo", "mucca, mucche, vacca, muu, muggisce, muggito", "cow, cows, moo, moos"),
  g("birds", "animals", "ambience", "cinguettio di uccellini", "birds chirping", "uccello, uccelli, uccellino, uccellini, cinguetta, cinguettio, canta, canto", "bird, birds, chirp, chirps, sing, sings"),
  g("wind-soft", "weather", "ambience", "vento leggero", "soft wind", "vento, venticello, soffia, brezza, folata", "wind, breeze, blows, gust"),
  g("boing", "cartoon", "sfx", "boing elastico", "springy boing", "boing, salta, salto, saltella, molla, rimbalza", "boing, jump, jumps, spring, bounce"),
  g("pop", "cartoon", "sfx", "pop di comparsa", "pop of appearing", "pop, bolla, bolle, appare, spunta, ecco", "pop, bubble, bubbles, appears, pops"),
  g("slide-whistle", "cartoon", "sfx", "fischio scivolato in su o in giù", "slide whistle", "scivola, scivolo, scivolata, vola, volare, uiii", "slides, slide, slip, whee, flies"),
  g("sparkle", "magic", "sfx", "scintillio magico", "magic sparkle", "magia, magico, scintilla, scintille, brilla, brillano, luccica, stella, stelle", "magic, magical, sparkle, sparkles, shines, twinkle, star, stars"),
  g("ball-bounce", "home", "sfx", "palla che rimbalza", "ball bouncing", "palla, palle, pallone, rimbalza, rimbalzo, ping", "ball, balls, bounces, bounce"),
  g("hammer-tap", "home", "sfx", "colpi di martello", "hammer taps", "martello, martella, toc, tic, tac, chiodo, chiodi", "hammer, hammers, tap, knock, nail, nails"),
  g("cup-clink", "home", "sfx", "tintinnio di una tazza", "cup clink", "tazza, tazze, tazzina, tintinna, tin, brindisi", "cup, cups, mug, clink, cheers"),
  g("apple-crunch", "home", "sfx", "morso croccante a una mela", "crunchy apple bite", "mela, mele, morde, morso, sgranocchia, crunch", "apple, apples, bite, bites, crunch"),
  g("umbrella-open", "weather", "sfx", "ombrello che si apre", "umbrella opening", "ombrello, ombrelli, apre, aperto, ombrellino", "umbrella, umbrellas, opens, open"),
  g("xylophone-up", "music", "sfx", "xilofono che sale", "xylophone going up", "sale, salgono, salita, su, xilofono, scala", "up, climbs, rises, rise, xylophone"),
  g("xylophone-down", "music", "sfx", "xilofono che scende", "xylophone going down", "scende, scendono, discesa, giu, cade, cadono", "down, falls, descends, drops"),
  g("ta-da", "magic", "sfx", "fanfara ta-da di festa", "ta-da fanfare", "tada, evviva, bravo, brava, bravi, festa, finalmente, hurra", "tada, hooray, bravo, party, finally, yay"),
];

const BY_ID = new Map(STORY_SOUND_GROUPS.map((x) => [x.id, x]));
export const storyGroup = (id: string): StoryGroup | undefined => BY_ID.get(id);

/**
 * Words are runs of letters, digits and apostrophes ("l'acqua" is one word; "Ta-da" is two; a dash or "..."
 * is not a word). ONE definition for the checker (word indices of a cue) and the engine (voice timeline,
 * highlight, cue times), so an index means the same word on both sides.
 */
const WORD = /[\p{L}\p{N}'’]+/gu;

export function splitWords(text: string): { word: string; start: number; end: number }[] {
  return [...text.matchAll(WORD)].map((m) => ({ word: m[0], start: m.index!, end: m.index! + m[0].length }));
}

/** Lower case, no accents, no punctuation. */
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

/**
 * A word matches a group when it equals a listed form or shares a prefix of at least 4 letters with one ("trenino" ~ "treno").
 * An elided word also matches on what follows the apostrophe ("l'onda" ~ "onda").
 */
export function wordMatchesGroup(word: string, g: StoryGroup, lang: "it" | "en"): boolean {
  const parts = word.split(/['’ʼ]/);
  const candidates = [norm(word), norm(parts[parts.length - 1] ?? "")].filter(Boolean);
  return g.words[lang].some((f) => {
    const n = norm(f);
    return candidates.some((w) => n === w || (n.length >= 4 && w.length >= 4 && n.slice(0, 4) === w.slice(0, 4)));
  });
}
