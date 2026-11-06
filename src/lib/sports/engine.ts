/** Indgangen til regelmotoren: modulregister, regelværdier og validering af regelsæt. */
import type { ActionDef, CustomEvent, FamilyModule, MatchCtx, MatchEvent, Participant, RuleDef, RuleValue, RuleValues, SportDef, Summary } from "./types.ts";
import { sportById, SPORTS } from "./catalog.ts";
import { teamscore } from "./families/teamscore.ts";
import { sets } from "./families/sets.ts";
import { tennis } from "./families/tennis.ts";
import { cricket, x01 } from "./families/darts.ts";
import { pool, snooker } from "./families/cue.ts";
import { custom } from "./families/custom.ts";
import { bowling } from "./families/bowling.ts";
import { golf } from "./families/golf.ts";
import { race } from "./families/race.ts";
import { attempts } from "./families/attempts.ts";
import { combat } from "./families/combat.ts";
import { chess, esport } from "./families/series.ts";
import { lifecycle } from "./common.ts";

export const FAMILIES: Record<SportDef["family"], FamilyModule> = { teamscore, sets, tennis, x01, cricket, pool, snooker, custom, bowling, golf, race, attempts, combat, chess, esport };

export { SPORTS, sportById };

export function defaultValues(sport: SportDef, variantId?: string): RuleValues {
  const v: RuleValues = {};
  for (const r of sport.rules) v[r.id] = Array.isArray(r.default) ? [...r.default] : r.default;
  const variant = sport.variants?.find((x) => x.id === variantId);
  if (variant) Object.assign(v, variant.values);
  return v;
}

/** Fylder manglende værdier med standard og kaster ukendte nøgler væk. */
export function resolveValues(sport: SportDef, values: RuleValues | undefined): RuleValues {
  const out = defaultValues(sport);
  for (const r of sport.rules) if (values && r.id in values) out[r.id] = values[r.id];
  return out;
}

export function ruleVisible(rule: RuleDef, values: RuleValues): boolean {
  if (!rule.when) return true;
  const cur = values[rule.when.rule];
  return Array.isArray(rule.when.is) ? (rule.when.is as RuleValue[]).includes(cur as never) : cur === rule.when.is;
}

/** Hvor stammer en værdi fra? Officiel/standard (uændret) eller turneringstilpasning. */
export function valueOrigin(rule: RuleDef, value: RuleValue): "official" | "standard" | "custom" | "adapted" {
  const same = JSON.stringify(value) === JSON.stringify(rule.default);
  if (!same && rule.origin !== "custom") return "adapted";
  return rule.origin;
}

/** Validerer et regelsæt. Fejl = kan ikke bruges. Advarsler = bør kontrolleres. */
export function validateRuleSet(sport: SportDef, values: RuleValues, events: CustomEvent[] = []): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  for (const r of sport.rules) {
    const v = values[r.id];
    const label = `"${r.label}"`;
    if (v === undefined) { errors.push(`${label} mangler.`); continue; }
    switch (r.kind) {
      case "bool": if (typeof v !== "boolean") errors.push(`${label} skal være ja/nej.`); break;
      case "choice": if (typeof v !== "string" || !r.options?.some((o) => o.value === v)) errors.push(`${label}: vælg en af mulighederne.`); break;
      case "text": if (typeof v !== "string" || v.length > 200) errors.push(`${label} skal være tekst (højst 200 tegn).`); break;
      case "table":
        if (!Array.isArray(v) || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) errors.push(`${label} må kun indeholde tal.`);
        else if (v.length > 100) errors.push(`${label} har for mange rækker.`);
        break;
      default: {
        if (typeof v !== "number" || !Number.isFinite(v)) { errors.push(`${label} skal være et tal.`); break; }
        if ((r.kind === "int" || r.kind === "points") && !Number.isInteger(v) && (r.step ?? 1) >= 1) errors.push(`${label} skal være et helt tal.`);
        if (r.min !== undefined && v < r.min) errors.push(`${label} skal være mindst ${r.min}.`);
        if (r.max !== undefined && v > r.max) errors.push(`${label} må højst være ${r.max}.`);
      }
    }
  }
  // modstridende regler
  if (sport.family === "teamscore") {
    if (values.allowDraw === false && values.extraTime === false && values.shootout === false) errors.push("Uafgjort er ikke tilladt, men hverken ekstra spilletid eller straffekonkurrence er slået til – en uafgjort kamp kan ikke afgøres.");
    if (values.useClock === false && values.addedTime === true) warnings.push("Tillægsminutter kræver kampur.");
  }
  if (sport.family === "golf" && values.format === "match") warnings.push("Hulspil kræver præcis to spillere pr. kamp.");
  if (sport.family === "golf") {
    const par = values.par as number[], holes = Number(values.holes);
    if (Array.isArray(par) && par.length < holes) errors.push(`Par mangler for ${holes - par.length} hul(ler).`);
  }
  if (sport.family === "custom" && sport.id !== "quiz") {
    if (!events.length) warnings.push("Der er ingen hændelser endnu. Tilføj jeres pointregler, før regelsættet bruges.");
    const ids = new Set<string>();
    for (const e of events) {
      if (!e.name.trim()) errors.push("En hændelse mangler navn.");
      if (ids.has(e.id)) errors.push(`Hændelsen "${e.name}" findes to gange.`);
      ids.add(e.id);
      if (!Number.isFinite(e.value) || e.value < 0 || e.value > 10000) errors.push(`"${e.name}": pointværdien skal være 0–10000.`);
    }
  }
  if (sport.family === "race") {
    const t = values.placePoints as number[];
    if (Array.isArray(t) && t.some((x, i) => i > 0 && x > t[i - 1])) warnings.push("Pointtabellen giver flere point til en lavere placering end til en højere.");
  }
  return { errors, warnings };
}

export interface MatchInput { sportId: string; rules: RuleValues; participants: Participant[]; customEvents?: CustomEvent[] }

export function ctxOf(m: MatchInput): MatchCtx {
  const sport = sportById(m.sportId);
  if (!sport) throw new Error(`Ukendt sportsgren: ${m.sportId}`);
  return { sport, rules: resolveValues(sport, m.rules), participants: m.participants, customEvents: m.customEvents ?? sport.customEvents ?? [] };
}

export function summarize(m: MatchInput, events: MatchEvent[], now = Date.now()): Summary {
  const ctx = ctxOf(m);
  return FAMILIES[ctx.sport.family].summarize(ctx, events, now);
}

export function validateEvent(m: MatchInput, events: MatchEvent[], ev: MatchEvent): string | null {
  const ctx = ctxOf(m);
  if (ev.side && !ctx.participants.some((p) => p.id === ev.side)) return "Ukendt deltager.";
  return FAMILIES[ctx.sport.family].validate(ctx, events, ev);
}

export function actionsFor(m: MatchInput, events: MatchEvent[], now = Date.now()): ActionDef[] {
  const ctx = ctxOf(m);
  return FAMILIES[ctx.sport.family].actions(ctx, events, now);
}

/** Genafspil alle aktive hændelser: finder den første, der ikke længere er gyldig (fx efter en annullering). */
export function replayProblem(m: MatchInput, events: MatchEvent[]): { event: MatchEvent; error: string } | null {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.voided) continue;
    const error = validateEvent(m, events.slice(0, i), e);
    if (error) return { event: e, error };
  }
  return null;
}

/** Visningsnavne for hændelsestyper (samlet fra handlingerne i forskellige faser af kampen). */
export function eventLabels(m: MatchInput, events: MatchEvent[]): Record<string, string> {
  const out: Record<string, string> = {};
  const t = Date.now();
  const start: MatchEvent = { id: "_s", seq: 1, at: t, type: "start" };
  const states: MatchEvent[][] = [[], [start], [start, { id: "_e", seq: 2, at: t, type: "period_end" }], events];
  for (const st of states) {
    try { for (const a of actionsFor(m, st)) out[a.type] ??= a.label; } catch { /* ignorér */ }
  }
  return out;
}

export function isStarted(events: MatchEvent[]) {
  return lifecycle(events, Date.now()).period > 0;
}

export function newId(prefix = "") {
  const a = new Uint8Array(9);
  globalThis.crypto.getRandomValues(a);
  return prefix + Array.from(a, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 14);
}
