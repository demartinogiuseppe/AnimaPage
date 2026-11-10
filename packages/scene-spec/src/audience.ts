// SceneBase.audience from the analysis' free-text reader level (decision D24). The analysis writes
// `gradeLevel` in the user's language ("scuola primaria, classe 5", "università, corso di fisica
// generale", "primary school, years 4-5", "小学校5年生"); the server derives the audience from it until
// the model writes `audience` itself. Unclear = undefined (the player keeps the pop-up book).
export type Audience = "child" | "teen" | "adult";

// Checked in this order: "scuola secondaria di secondo grado / università" is an adult reader.
const ADULT = /univers|facolt|laurea|college|hochschule|studium|faculdade|faculté|facultad|bachelor|master|adult|erwachsen|大学/i;
const CHILD = /primari|primary|elementar|grundschule|infanzia|kindergarten|maternelle|小学/i;
const TEEN = /secondari|secondary|middle school|high school|liceo|lycée|lycee|collège|gymnasium|realschule|mittelschule|bachillerato|ensino médio|ensino fundamental|instituto|中学|高校|高等学校/i;

export function audienceFromGrade(gradeLevel: string | undefined | null): Audience | undefined {
  if (!gradeLevel) return undefined;
  if (ADULT.test(gradeLevel)) return "adult";
  if (CHILD.test(gradeLevel)) return "child";
  if (TEEN.test(gradeLevel)) return "teen";
  return undefined;
}
