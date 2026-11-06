/**
 * BanditBoard Live – fælles regelmotor.
 *
 * Princip: en kamp er en liste af hændelser (event sourcing). Stillingen beregnes
 * altid ved at afspille de gyldige hændelser gennem sportsgrenens modul ("family").
 * En rettelse sletter aldrig noget: hændelsen markeres som annulleret, så historikken
 * bevares. Reglerne er data (RuleDef) – ingen skjulte undtagelser i koden.
 */

export type RuleKind = "bool" | "int" | "decimal" | "seconds" | "minutes" | "points" | "percent" | "choice" | "table" | "text";

/** official = følger en navngiven officiel regelkilde · standard = almindelig standard/branchepraksis · custom = BanditBoard-funktion/lokal regel */
export type Origin = "official" | "standard" | "custom";

export type SectionId =
  | "basis"
  | "format"
  | "points"
  | "penalties"
  | "time"
  | "participants"
  | "result"
  | "tournament"
  | "live"
  | "obs"
  | "advanced";

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "basis", label: "Grundindstillinger" },
  { id: "format", label: "Kampformat" },
  { id: "points", label: "Pointsystem" },
  { id: "penalties", label: "Regler og straffe" },
  { id: "time", label: "Tid og kampforløb" },
  { id: "participants", label: "Deltagere og hold" },
  { id: "result", label: "Resultatberegning" },
  { id: "tournament", label: "Turneringsformat" },
  { id: "live", label: "Live-scoreboard" },
  { id: "obs", label: "OBS-overlay" },
  { id: "advanced", label: "Avancerede indstillinger" },
];

export type RuleValue = boolean | number | string | number[];

export interface RuleDef {
  id: string;
  label: string;
  help?: string;
  kind: RuleKind;
  default: RuleValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  section: SectionId;
  origin: Origin;
  /** Vises som advarsel, før reglen slås fra – reglen er nødvendig for et korrekt resultat. */
  critical?: string;
  advanced?: boolean;
  /** Reglen er kun relevant når en anden regel har en bestemt værdi. */
  when?: { rule: string; is: RuleValue | RuleValue[] };
  /** Kun for tabeller: navne på rækkerne (fx "1. plads"). */
  rowLabel?: string;
}

export type RuleValues = Record<string, RuleValue>;

/** Brugerdefinerede hændelser (skomager, quiz, egne regler). */
export interface CustomEvent {
  id: string;
  name: string;
  description: string;
  value: number;
  /** 1 = lægger point til, -1 = trækker point fra */
  sign: 1 | -1;
  /** Hvem får pointene: den der udførte hændelsen, modstanderne eller alle andre */
  target: "self" | "opponents";
  repeatable: boolean;
  needsApproval: boolean;
  show: boolean;
}

export type Family =
  | "teamscore"
  | "sets"
  | "tennis"
  | "x01"
  | "cricket"
  | "pool"
  | "snooker"
  | "custom"
  | "bowling"
  | "golf"
  | "race"
  | "attempts"
  | "combat"
  | "chess"
  | "esport";

export type TournamentFormat = "league" | "groups" | "knockout" | "individual";

export interface SportSource {
  /** Officiel organisation, fx IFAB */
  body: string;
  /** Dokumentets navn, fx "Laws of the Game" */
  document: string;
  /** Den udgave standardværdierne er sat efter – "kontrollér" hvis ikke verificeret */
  edition: string;
  note?: string;
}

export interface SportVariant {
  id: string;
  label: string;
  values: RuleValues;
}

export interface SportDef {
  id: string;
  name: string;
  emoji: string;
  group: string;
  family: Family;
  blurb: string;
  source: SportSource;
  variants?: SportVariant[];
  rules: RuleDef[];
  formats: TournamentFormat[];
  /** "team": to hold mod hinanden · "duel": to deltagere · "field": mange deltagere i samme konkurrence */
  shape: "team" | "duel" | "field";
  minParticipants: number;
  maxParticipants: number;
  customEvents?: CustomEvent[];
  /** Navne til målenheden i stillingen, fx "mål", "point", "legs" */
  scoreWord: string;
  /** Modulspecifik, fast opsætning (fx hvilke scoringstyper sporten har). Værdier styres af reglerne. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec?: any;
}

export interface Participant {
  id: string;
  name: string;
  /** Holdnavn for individuelle deltagere i holdkonkurrencer */
  team?: string;
  /** Spillere på holdet (navne) */
  members?: string[];
  /** Fx bane, startnummer, handicap */
  lane?: number;
  bib?: string;
  handicap?: number;
}

export interface MatchEvent {
  id: string;
  seq: number;
  at: number;
  type: string;
  /** Deltager-id (hold eller spiller i konkurrencen) */
  side?: string;
  /** Navnet på den enkelte spiller (målscorer, kort osv.) */
  player?: string;
  /** Kampminut ved registrering */
  minute?: number;
  data?: Record<string, unknown>;
  byName?: string;
  voided?: { at: number; byName?: string; reason: string };
}

export interface MatchCtx {
  sport: SportDef;
  rules: RuleValues;
  participants: Participant[];
  customEvents: CustomEvent[];
}

export type MatchStatus = "scheduled" | "live" | "paused" | "break" | "finished" | "abandoned" | "postponed";

export interface ClockInfo {
  running: boolean;
  /** Forløbet tid i den aktuelle periode i ms, beregnet ved `computedAt` */
  elapsedMs: number;
  computedAt: number;
  /** Periodens længde i ms (0 = ingen grænse) */
  limitMs: number;
  direction: "up" | "down";
  /** Minuttal der lægges til (fx 45 i anden halvleg ved fodbold) */
  offsetMin: number;
  label: string;
}

export interface ScoreLine {
  id: string;
  name: string;
  /** Den store værdi på tavlen */
  main: string;
  /** Den lille værdi, fx sæt/legs/omgange */
  sub?: string;
  detail?: string[];
  place?: number;
  active?: boolean;
  out?: boolean;
}

export interface FeedItem {
  seq: number;
  text: string;
  minute?: number;
  side?: string;
  kind?: "score" | "card" | "penalty" | "info" | "result";
}

export interface StandingRow {
  id: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scoreFor: number;
  scoreAgainst: number;
  points: number;
  extra: Record<string, number>;
  place?: number;
}

/** Resultatet af én kamp set fra hver deltagers side – grundlaget for ranglister. */
export interface ParticipantResult {
  id: string;
  outcome?: "W" | "D" | "L";
  /** Placering i feltkonkurrencer */
  place?: number;
  scoreFor: number;
  scoreAgainst: number;
  /** Turneringspoint for kampen (efter regelsættet) */
  points: number;
  extra?: Record<string, number>;
}

export interface Summary {
  status: MatchStatus;
  phase: string;
  clock?: ClockInfo;
  scores: ScoreLine[];
  winnerId: string | null;
  draw: boolean;
  /** Fx "Ordinær tid", "Efter straffesparkskonkurrence", "KO" */
  resultType: string;
  feed: FeedItem[];
  /** Advarsler til scoreføreren, fx "Kampen kan ikke ende uafgjort" */
  warnings: string[];
  results: ParticipantResult[];
  /** Ekstra info til tavlen (fx "Kaster: …", "Server: …", "Checkout: T20 T20 D20") */
  info: string[];
}

/** En knap i kampstyringen. */
export interface ActionDef {
  type: string;
  label: string;
  /** Kræver at der vælges side */
  side?: boolean;
  /** Feltet i data, som brugeren skal udfylde */
  fields?: ActionField[];
  tone?: "score" | "card" | "penalty" | "info" | "control" | "danger";
  group: string;
  /** Data der sendes med uden at spørge */
  preset?: Record<string, unknown>;
  hint?: string;
}

export interface ActionField {
  key: string;
  label: string;
  kind: "player" | "int" | "decimal" | "time" | "text" | "choice" | "side" | "bool";
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  optional?: boolean;
}

export interface FamilyModule {
  actions(ctx: MatchCtx, events: MatchEvent[], now: number): ActionDef[];
  /** Returnerer en fejlbesked, hvis hændelsen ikke er gyldig efter regelsættet */
  validate(ctx: MatchCtx, events: MatchEvent[], ev: MatchEvent): string | null;
  summarize(ctx: MatchCtx, events: MatchEvent[], now: number): Summary;
}
