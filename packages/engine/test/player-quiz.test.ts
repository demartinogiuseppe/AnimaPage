import { describe, expect, it } from "vitest";
import type { Quiz } from "@pv/scene-spec";
import { feedbackSpeech, QuizState } from "../src/player/quiz.ts";

const quizzes: Quiz[] = [
  { type: "choice", q: "Q1", options: ["a", "b", "c"], answer: 2, explain: "Perché c." },
  { type: "pick", q: "Q2", answerPins: ["troia", "hisarlik"], explain: "È Troia." },
  { type: "pick", q: "Q3", answerPins: ["egeo"], explain: "È l'Egeo." },
];

describe("QuizState", () => {
  it("choice: right answer scores once, then the question is settled", () => {
    const s = new QuizState(quizzes);
    expect(s.answerChoice(2)).toBe(true);
    expect(s.score).toBe(1);
    expect(s.answered).toBe(true);
    expect(s.feedback).toEqual({ ok: true, text: "Perché c." });
    expect(s.answerChoice(2)).toBeNull();
    expect(s.score).toBe(1);
  });

  it("choice: wrong answer gives no point and remembers the clicked option", () => {
    const s = new QuizState(quizzes);
    expect(s.answerChoice(0)).toBe(false);
    expect(s.chosen).toBe(0);
    expect(s.score).toBe(0);
    expect(feedbackSpeech(s.feedback!)).toBe("Non proprio. Perché c.");
  });

  it("pick mode is off until the user starts the question", () => {
    const s = new QuizState(quizzes);
    s.next();
    expect(s.current?.type).toBe("pick");
    expect(s.picking).toBe(false);
    expect(s.pick("troia")).toBeNull(); // taps on the scene are ordinary pin taps
    expect(s.startPick()).toBe(true);
    expect(s.picking).toBe(true);
  });

  it("pick: wrong taps can be retried, a later right tap still scores", () => {
    const s = new QuizState(quizzes);
    s.next();
    s.startPick();
    expect(s.pick("egeo")).toBe("wrong");
    expect(s.picking).toBe(true);
    expect(s.pick("hisarlik")).toBe("right");
    expect(s.score).toBe(1);
    expect(s.picking).toBe(false);
    expect(s.rightPins).toEqual(["hisarlik"]);
    expect(feedbackSpeech(s.feedback!)).toBe("Giusto! È Troia.");
  });

  it("'Mostra la risposta' shows all answer pins without a point", () => {
    const s = new QuizState(quizzes);
    s.next();
    s.startPick();
    s.showAnswer();
    expect(s.rightPins).toEqual(["troia", "hisarlik"]);
    expect(s.score).toBe(0);
    expect(s.picking).toBe(false);
    expect(s.feedback).toEqual({ ok: null, text: "È Troia." });
    expect(s.startPick()).toBe(false);
  });

  it("next resets the question, reaches done, restart starts over", () => {
    const s = new QuizState(quizzes);
    s.answerChoice(2);
    s.next();
    expect(s.feedback).toBeNull();
    expect(s.chosen).toBeNull();
    s.startPick();
    s.next();
    expect(s.picking).toBe(false);
    s.next();
    expect(s.done).toBe(true);
    expect(s.current).toBeUndefined();
    expect(s.score).toBe(1);
    s.restart();
    expect(s.done).toBe(false);
    expect(s.i).toBe(0);
    expect(s.score).toBe(0);
  });

  it("stopPick (chapter change) leaves the question open", () => {
    const s = new QuizState(quizzes);
    s.next();
    s.startPick();
    s.stopPick();
    expect(s.picking).toBe(false);
    expect(s.answered).toBe(false);
    expect(s.startPick()).toBe(true);
  });

  it("a chapter without questions is already done", () => {
    expect(new QuizState([]).done).toBe(true);
  });
});
