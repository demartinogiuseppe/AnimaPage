// Quiz state machine for one chapter ("choice" and "pick", as in the prototypes). Pure, no DOM.
import type { Quiz } from "@pv/scene-spec";
import { engineText } from "@pv/scene-spec/i18n";

export type Feedback = { ok: boolean | null; text: string };

export class QuizState {
  i = 0;
  score = 0;
  /** The current question has been settled (answered, or answer shown): no more points. */
  answered = false;
  done = false;
  /** Pick mode: the user is answering by tapping a label on the scene. Only on explicit start. */
  picking = false;
  /** Choice index the user clicked, for the current question. */
  chosen: number | null = null;
  /** Pins to mark as right on the scene. */
  rightPins: string[] = [];
  feedback: Feedback | null = null;

  constructor(readonly quizzes: readonly Quiz[]) {
    if (quizzes.length === 0) this.done = true;
  }

  get current(): Quiz | undefined {
    return this.done ? undefined : this.quizzes[this.i];
  }

  answerChoice(k: number): boolean | null {
    const q = this.current;
    if (q?.type !== "choice" || this.answered) return null;
    const ok = k === q.answer;
    this.chosen = k;
    this.settle(ok, q.explain);
    return ok;
  }

  /** "Rispondi sulla scena". */
  startPick(): boolean {
    if (this.current?.type !== "pick" || this.answered) return false;
    this.picking = true;
    return true;
  }

  stopPick(): void {
    this.picking = false;
  }

  /** Tap on a pin while picking. Wrong taps cost nothing and can be retried. */
  pick(pinId: string): "right" | "wrong" | null {
    const q = this.current;
    if (q?.type !== "pick" || !this.picking || this.answered) return null;
    if (!q.answerPins.includes(pinId)) return "wrong";
    this.rightPins = [pinId];
    this.settle(true, q.explain);
    return "right";
  }

  /** "Mostra la risposta": explanation, no point. */
  showAnswer(): void {
    const q = this.current;
    if (q?.type !== "pick" || this.answered) return;
    this.rightPins = [...q.answerPins];
    this.settle(null, q.explain);
  }

  next(): void {
    if (this.done) return;
    this.i++;
    this.resetQuestion();
    if (this.i >= this.quizzes.length) this.done = true;
  }

  restart(): void {
    this.i = 0;
    this.score = 0;
    this.done = this.quizzes.length === 0;
    this.resetQuestion();
  }

  private settle(ok: boolean | null, explain: string): void {
    if (ok === true && !this.answered) this.score++;
    this.answered = true;
    this.picking = false;
    this.feedback = { ok, text: explain };
  }

  private resetQuestion(): void {
    this.answered = false;
    this.picking = false;
    this.chosen = null;
    this.rightPins = [];
    this.feedback = null;
  }
}

/** Text shown and spoken as feedback. */
export function feedbackSpeech(f: Feedback): string {
  return (f.ok === true ? engineText("say.right") : f.ok === false ? engineText("say.wrong") : "") + f.text;
}
