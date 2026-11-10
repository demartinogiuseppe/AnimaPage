// 5x7 dot-matrix font for the diorama "text" shape (procedural, no font files).
// Each glyph is 7 rows of 5 columns, top row first, "#" = lit dot.

const G: Record<string, string> = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: ".###.|..#..|..#..|..#..|..#..|..#..|.###.",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
  N: "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
  "3": "####.|....#|....#|.###.|....#|....#|####.",
  "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  "5": "#####|#....|####.|....#|....#|#...#|.###.",
  "6": "..##.|.#...|#....|####.|#...#|#...#|.###.",
  "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
  "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
  ".": ".....|.....|.....|.....|.....|.##..|.##..",
  ",": ".....|.....|.....|.....|.##..|..#..|.#...",
  "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..",
  "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
  "'": "..#..|..#..|.#...|.....|.....|.....|.....",
  "-": ".....|.....|.....|.###.|.....|.....|.....",
  ":": ".....|.##..|.##..|.....|.##..|.##..|.....",
  "/": "....#|....#|...#.|..#..|.#...|#....|#....",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
};

/** Accented vowels: base letter plus one dot above (column). */
const ACCENTS: Record<string, [string, number]> = {
  À: ["A", 1], È: ["E", 1], É: ["E", 3], Ì: ["I", 1], Ò: ["O", 1], Ù: ["U", 1],
};

export const GLYPH_ROWS = 7;
const ADVANCE = 6; // 5 columns + 1 gap
const SPACE = 4;

/** Dots of a character as [col, row] with row 0 at the bottom (an accent is row 7). Unknown characters render as "?". */
export function glyphDots(ch: string): [number, number][] {
  const up = ch.toUpperCase();
  if (up === " ") return [];
  const acc = ACCENTS[up];
  const rows = (G[acc ? acc[0] : up] ?? G["?"]!).split("|");
  const dots: [number, number][] = [];
  rows.forEach((r, i) => {
    for (let c = 0; c < 5; c++) if (r[c] === "#") dots.push([c, GLYPH_ROWS - 1 - i]);
  });
  if (acc) dots.push([acc[1], GLYPH_ROWS]);
  return dots;
}

/** Horizontal layout in dot cells: x of each character's left edge, and the total width (text centred on 0). */
export function textLayout(text: string): { left: number[]; width: number } {
  const left: number[] = [];
  let x = 0;
  for (const ch of text) {
    left.push(x);
    x += ch === " " ? SPACE : ADVANCE;
  }
  const width = Math.max(1, x - 1);
  return { left: left.map((l) => l - width / 2), width };
}

/** Centre x (metres) of character `i` for a text of letter height `height`. */
export function letterCenter(text: string, i: number, height: number): number {
  const cell = height / GLYPH_ROWS;
  const { left } = textLayout(text);
  const chars = [...text];
  const l = left[Math.min(i, left.length - 1)] ?? 0;
  return (l + (chars[i] === " " ? SPACE - 1 : 5) / 2) * cell;
}

export function textSize(text: string, height: number, depth?: number): [number, number, number] {
  const cell = height / GLYPH_ROWS;
  return [textLayout(text).width * cell, height, depth ?? cell * 0.8];
}
