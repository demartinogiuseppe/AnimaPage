// "Impostazioni": "Lingua" (decision D21: automatic from the browser, or a chosen language, stored as
// "pv.lang" by src/i18n.ts), "Stile delle lezioni" (decision D24: automatic, pop-up book or Accademico,
// stored as "pv.presentation") and "Modello AI" (decision D20): one selector per pipeline phase, filled from
// GET /api/providers (configured models, availability, vision). The choice stays on this device
// (localStorage) and travels with each photo upload (field "llm", src/photo.ts); the server checks it
// against its own list. Nothing stored = the server's default (Claude for every phase).
import { t, type MessageKey } from "@pv/scene-spec/i18n";
import { PRESENTATION_PREFS, readPresentationPref, writePresentationPref, type PresentationPref } from "@pv/engine";
import { catalogPending, detectLocale, LANGUAGE_CHOICES, nativeLanguageName, setStoredLanguage, storedLanguage } from "./i18n.ts";

type PhaseId = "analyze" | "generate" | "check";
interface PhaseChoice {
  provider: string;
  model: string;
}
interface ProvidersInfo {
  mode: string;
  phases: { id: PhaseId; label: string; needsVision: boolean }[];
  defaults: Record<PhaseId, PhaseChoice | null>;
  providers: {
    id: string;
    label: string;
    vision: boolean;
    available: boolean;
    reason?: string;
    models: { id: string; available: boolean; reason?: string }[];
  }[];
}

const KEY = "pv.llm";


type El = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K];

function readStored(): Partial<Record<PhaseId, PhaseChoice>> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<Record<PhaseId, PhaseChoice>>) : {};
  } catch {
    return {};
  }
}

/** The stored choice as sent with the photo, or null (= the server's default). */
export function storedLlmChoice(): string | null {
  const v = readStored();
  return Object.keys(v).length ? JSON.stringify(v) : null;
}

const enc = (c: PhaseChoice) => `${c.provider}|${c.model}`;
const dec = (v: string): PhaseChoice => {
  const i = v.indexOf("|");
  return { provider: v.slice(0, i), model: v.slice(i + 1) };
};

/** "Lingua": automatic (the browser's language) or one of LANGUAGE_CHOICES; a change reloads the app. */
function languageCard(el: El): HTMLElement {
  const card = el("section", "settings-phase");
  const label = el("label", "settings-label", t("settings.language"));
  label.htmlFor = "pv-lang";
  const sel = el("select", "settings-select");
  sel.id = "pv-lang";
  sel.append(new Option(t("settings.languageAuto", { name: nativeLanguageName(detectLocale()) }), ""));
  for (const tag of LANGUAGE_CHOICES) sel.append(new Option(nativeLanguageName(tag), tag));
  const stored = storedLanguage();
  if (stored && !(LANGUAGE_CHOICES as readonly string[]).includes(stored)) sel.append(new Option(nativeLanguageName(stored), stored));
  sel.value = stored ?? "";
  const note = el("p", "settings-note");
  if (catalogPending()) note.textContent = t("settings.languageWait");
  sel.onchange = () => {
    setStoredLanguage(sel.value || null);
    location.reload();
  };
  card.append(label, el("p", "settings-hint", t("settings.languageHint")), sel, note);
  return card;
}

/** "Stile delle lezioni" (D24): automatic (from the lesson's reader), pop-up book or Accademico. */
function presentationCard(el: El): HTMLElement {
  const card = el("section", "settings-phase");
  const label = el("label", "settings-label", t("settings.presentation"));
  label.htmlFor = "pv-presentation";
  const sel = el("select", "settings-select");
  sel.id = "pv-presentation";
  for (const p of PRESENTATION_PREFS) sel.append(new Option(t(`settings.presentation.${p}`), p));
  sel.value = readPresentationPref();
  sel.onchange = () => writePresentationPref(sel.value as PresentationPref);
  card.append(label, el("p", "settings-hint", t("settings.presentationHint")), sel);
  return card;
}

export async function renderSettings(app: HTMLElement, el: El): Promise<void> {
  document.title = `${t("settings.docTitle")} · AnimaPage`;
  const main = el("main", "home flow settings");
  const back = el("a", "back", t("common.backHome"));
  back.href = "./";
  main.append(el("h1", "flow-title", t("settings.title")), el("h2", "section-title", t("settings.language")));
  const langBody = el("div", "settings-body");
  langBody.append(languageCard(el));
  const styleBody = el("div", "settings-body");
  styleBody.append(presentationCard(el));
  main.append(langBody, el("h2", "section-title", t("settings.presentation")), styleBody, el("h2", "section-title", t("settings.model")));
  main.append(el("p", "lead", t("settings.lead")));
  const body = el("div", "settings-body");
  body.append(el("p", "loading", t("settings.checking")));
  main.append(body, back);
  app.replaceChildren(main);

  let info: ProvidersInfo;
  try {
    const res = await fetch(new URL("api/providers", document.baseURI));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    info = (await res.json()) as ProvidersInfo;
  } catch {
    body.replaceChildren(el("p", "archive-note", t("settings.serverDown")));
    return;
  }

  const stored = readStored();
  const selects = new Map<PhaseId, HTMLSelectElement>();
  const save = () => {
    const out: Partial<Record<PhaseId, PhaseChoice>> = {};
    for (const [phase, sel] of selects) if (sel.value) out[phase] = dec(sel.value);
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      /* storage disabled: the server default is used */
    }
  };

  const cards = info.phases.map((phase) => {
    const card = el("section", "settings-phase");
    const id = `pv-llm-${phase.id}`;
    const label = el("label", "settings-label", t(`settings.phase.${phase.id}` as MessageKey));
    label.htmlFor = id;
    const sel = el("select", "settings-select");
    sel.id = id;
    const note = el("p", "settings-note");
    const def = info.defaults[phase.id];
    const current = stored[phase.id] ?? def;
    if (!def) sel.append(new Option(t("settings.serverDefault"), ""));

    const reasons = new Map<string, string>();
    for (const p of info.providers) {
      const group = el("optgroup");
      group.label = p.available ? p.label : t("settings.groupUnavailable", { label: p.label });
      for (const m of p.models) {
        const value = enc({ provider: p.id, model: m.id });
        const why = phase.needsVision && !p.vision ? t("settings.noVision") : !m.available ? (m.reason ?? p.reason ?? t("settings.unavailable")).replace(/\.$/, "") : "";
        const isDefault = def && def.provider === p.id && def.model === m.id;
        const opt = new Option(`${p.label} · ${m.id}${isDefault ? ` · ${t("settings.default")}` : ""}${why ? ` (${why})` : ""}`, value);
        // A saved choice that is unavailable now stays selectable, so the user sees what is set.
        opt.disabled = Boolean(why) && !(current && enc(current) === value);
        if (why) reasons.set(value, why);
        group.append(opt);
      }
      sel.append(group);
    }
    if (current) sel.value = enc(current);
    const sync = () => {
      const why = reasons.get(sel.value);
      note.textContent = why ? t("settings.warn", { why: `${why.charAt(0).toLowerCase()}${why.slice(1)}` }) : "";
      note.classList.toggle("bad", Boolean(why));
    };
    sel.onchange = () => {
      save();
      sync();
    };
    sync();
    selects.set(phase.id, sel);
    card.append(label, el("p", "settings-hint", t(`settings.hint.${phase.id}` as MessageKey)), sel, note);
    return card;
  });

  const reset = el("button", "small-btn secondary", t("settings.reset"));
  reset.type = "button";
  reset.onclick = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing stored */
    }
    void renderSettings(app, el);
  };
  const extra: HTMLElement[] = [];
  if (info.mode !== "live")
    extra.push(el("p", "archive-note", t("settings.mock")));
  body.replaceChildren(...extra, ...cards, reset);
}
