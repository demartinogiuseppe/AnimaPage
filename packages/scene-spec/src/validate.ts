// Semantic checks that zod cannot express (brief §4.1, §4.6).
import type { z } from "zod";
import { PAGE_SOURCE_ID, type SceneBase } from "./common.ts";

type Scene = z.infer<typeof SceneBase>;

export interface Issue {
  path: string;
  message: string;
}

const HAS_DIGIT = /\d/;

export function checkSemantics(scene: Scene): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const sourceIds = new Set<string>();
  scene.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) add(`sources[${i}]`, `duplicate source id "${s.id}"`);
    sourceIds.add(s.id);
    if (s.kind === "page" && s.id !== PAGE_SOURCE_ID) add(`sources[${i}]`, `page source must have id "${PAGE_SOURCE_ID}"`);
    if (s.kind !== "page" && s.kind !== "computed" && !s.url) add(`sources[${i}]`, "external source needs a url");
  });

  const checkSources = (path: string, ids: string[], text: string) => {
    for (const id of ids) if (!sourceIds.has(id)) add(path, `unknown source id "${id}"`);
    if (HAS_DIGIT.test(text) && ids.length === 0) add(path, `number or date without source: "${text}"`);
  };

  const chapterIds = new Set<string>();
  scene.chapters.forEach((ch, c) => {
    const at = `chapters[${c}]`;
    if (chapterIds.has(ch.id)) add(at, `duplicate chapter id "${ch.id}"`);
    chapterIds.add(ch.id);

    const pinIds = new Set<string>();
    ch.pins.forEach((p, i) => {
      if (pinIds.has(p.id)) add(`${at}.pins[${i}]`, `duplicate pin id "${p.id}"`);
      pinIds.add(p.id);
      checkSources(`${at}.pins[${i}]`, p.sourceIds, `${p.name} ${p.sub ?? ""} ${p.info}`);
      p.visible?.forEach(([from, to], k) => {
        if (from > to) add(`${at}.pins[${i}].visible[${k}]`, "window ends before it starts");
      });
    });

    let prev = -1;
    ch.narration.forEach((s, i) => {
      const sp = `${at}.narration[${i}]`;
      if (s.at < prev) add(sp, "sentence times must be in order");
      if (s.at >= ch.duration) add(sp, "sentence starts after the chapter ends");
      prev = s.at;
      for (const id of s.highlight) if (!pinIds.has(id)) add(sp, `highlight of unknown pin "${id}"`);
      if (s.speaker && !scene.voices?.some((v) => v.id === s.speaker)) add(sp, `unknown speaker "${s.speaker}"`);
      checkSources(sp, s.sourceIds, s.text);
    });

    prev = -1;
    ch.camera.forEach((k, i) => {
      if (k.at < prev) add(`${at}.camera[${i}]`, "camera keys must be in order");
      if (k.at > ch.duration) add(`${at}.camera[${i}]`, "camera key after the chapter ends");
      prev = k.at;
    });

    ch.deep.forEach((d, i) => checkSources(`${at}.deep[${i}]`, d.sourceIds, d.text));

    ch.quiz.forEach((q, i) => {
      const qp = `${at}.quiz[${i}]`;
      if (q.type === "choice" && q.answer >= q.options.length) add(qp, "answer index out of range");
      if (q.type === "pick") for (const id of q.answerPins) if (!pinIds.has(id)) add(qp, `answer of unknown pin "${id}"`);
    });

    if (ch.book) checkSources(`${at}.book`, ch.book.sourceIds, [ch.book.heading, ch.book.formula ?? "", ...ch.book.lines].join(" "));
    if (ch.activity) {
      const a = ch.activity;
      if (a.predict.answer >= a.predict.options.length) add(`${at}.activity.predict`, "answer index out of range");
      checkSources(`${at}.activity.prove`, a.prove.sourceIds, a.prove.text);
    }

    ch.sounds?.cues.forEach((c, i) => {
      if (c.at > ch.duration) add(`${at}.sounds.cues[${i}]`, "sound cue after the chapter ends");
    });

    ch.status?.forEach((s, i) => {
      if (s.from > s.to) add(`${at}.status[${i}]`, "window ends before it starts");
    });
  });

  return issues;
}
