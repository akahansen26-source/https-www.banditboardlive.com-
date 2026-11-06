import type { ActionDef, ClockInfo, MatchCtx, MatchEvent, MatchStatus, ParticipantResult, RuleValue, RuleValues, Summary } from "./types.ts";

/** Gyldige hændelser i rækkefølge (annullerede tæller ikke). */
export function live(events: MatchEvent[]): MatchEvent[] {
  return events.filter((e) => !e.voided).sort((a, b) => a.seq - b.seq);
}

export function num(rules: RuleValues, id: string, fallback = 0): number {
  const v = rules[id];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
export function bool(rules: RuleValues, id: string, fallback = false): boolean {
  const v = rules[id];
  return typeof v === "boolean" ? v : fallback;
}
export function str(rules: RuleValues, id: string, fallback = ""): string {
  const v = rules[id];
  return typeof v === "string" ? v : fallback;
}
export function table(rules: RuleValues, id: string): number[] {
  const v = rules[id];
  return Array.isArray(v) ? v.map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0)) : [];
}

export function nameOf(ctx: MatchCtx, id: string | undefined): string {
  return ctx.participants.find((p) => p.id === id)?.name ?? "?";
}
export function other(ctx: MatchCtx, id: string | undefined): string | undefined {
  return ctx.participants.find((p) => p.id !== id)?.id;
}

/** Livscyklus: start, pause, perioder, afslutning. Fælles for alle sportsgrene. */
export interface Life {
  status: MatchStatus;
  period: number;
  inBreak: boolean;
  running: boolean;
  elapsedMs: number;
  runningSince: number | null;
  ended: "" | "finish" | "walkover" | "abandoned" | "postponed" | "dq";
  walkoverWinner?: string;
  dqSide?: string;
  dqReason?: string;
  note?: string;
}

export const LIFE_TYPES = new Set(["start", "pause", "resume", "period_end", "period_start", "finish", "abandon", "postpone", "walkover", "disqualify", "clock_set", "reopen"]);

export function lifecycle(events: MatchEvent[], now: number): Life {
  const L: Life = { status: "scheduled", period: 0, inBreak: false, running: false, elapsedMs: 0, runningSince: null, ended: "" };
  const stop = (at: number) => {
    if (L.running && L.runningSince !== null) L.elapsedMs += Math.max(0, at - L.runningSince);
    L.running = false;
    L.runningSince = null;
  };
  for (const e of live(events)) {
    switch (e.type) {
      case "start":
        if (L.period === 0) {
          L.period = 1;
          L.status = "live";
          L.running = true;
          L.runningSince = e.at;
        }
        break;
      case "pause":
        stop(e.at);
        if (L.status === "live") L.status = "paused";
        break;
      case "resume":
        if (!L.running && L.status === "paused") {
          L.running = true;
          L.runningSince = e.at;
          L.status = "live";
        }
        break;
      case "period_end":
        stop(e.at);
        L.inBreak = true;
        L.status = "break";
        break;
      case "period_start":
        stop(e.at);
        L.period += 1;
        L.elapsedMs = 0;
        L.inBreak = false;
        L.running = true;
        L.runningSince = e.at;
        L.status = "live";
        break;
      case "clock_set": {
        const ms = Number(e.data?.ms);
        if (Number.isFinite(ms) && ms >= 0) {
          L.elapsedMs = ms;
          if (L.running) L.runningSince = e.at;
        }
        break;
      }
      case "finish":
        stop(e.at);
        L.status = "finished";
        L.ended = "finish";
        break;
      case "walkover":
        stop(e.at);
        L.status = "finished";
        L.ended = "walkover";
        L.walkoverWinner = String(e.data?.winner ?? "");
        break;
      case "disqualify":
        if (e.data?.ends !== false) {
          stop(e.at);
          L.status = "finished";
          L.ended = "dq";
        }
        L.dqSide = e.side;
        L.dqReason = String(e.data?.reason ?? "");
        break;
      case "abandon":
        stop(e.at);
        L.status = "abandoned";
        L.ended = "abandoned";
        L.note = String(e.data?.reason ?? "");
        break;
      case "postpone":
        stop(e.at);
        L.status = "postponed";
        L.ended = "postponed";
        L.note = String(e.data?.reason ?? "");
        break;
      case "reopen":
        if (L.ended) {
          L.ended = "";
          L.status = L.period ? "paused" : "scheduled";
        }
        break;
    }
  }
  return L;
}

export function clockOf(L: Life, now: number, limitMin: number, direction: "up" | "down", offsetMin: number, label: string): ClockInfo {
  const elapsed = L.elapsedMs + (L.running && L.runningSince !== null ? Math.max(0, now - L.runningSince) : 0);
  return { running: L.running, elapsedMs: elapsed, computedAt: now, limitMs: Math.round(limitMin * 60000), direction, offsetMin, label };
}

export function fmtClock(c: ClockInfo, now = Date.now()): string {
  const el = c.elapsedMs + (c.running ? Math.max(0, now - c.computedAt) : 0);
  let ms = c.direction === "down" ? Math.max(0, c.limitMs - el) : el;
  if (c.direction === "up") ms += c.offsetMin * 60000;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Kampminut til registrering (1-baseret, som i fodbold: 0:30 = 1. minut). */
export function minuteOf(c: ClockInfo | undefined, now = Date.now()): number | undefined {
  if (!c) return undefined;
  const el = c.elapsedMs + (c.running ? Math.max(0, now - c.computedAt) : 0);
  if (c.direction === "down") return Math.floor(el / 60000) + 1 + c.offsetMin;
  return Math.floor(el / 60000) + 1 + c.offsetMin;
}

export function lifeActions(L: Life, opts: { periods: number; extraPeriods?: number; periodWord?: string; noClock?: boolean }): ActionDef[] {
  const g = "Kampforløb";
  const a: ActionDef[] = [];
  if (L.ended) {
    a.push({ type: "reopen", label: "Genåbn kampen", tone: "control", group: g, hint: "Kun ved fejl – handlingen logges" });
    return a;
  }
  if (L.period === 0) a.push({ type: "start", label: "Start kampen", tone: "control", group: g });
  else if (L.inBreak) a.push({ type: "period_start", label: `Start ${L.period + 1}. ${opts.periodWord ?? "periode"}`, tone: "control", group: g });
  else {
    if (!opts.noClock) {
      if (L.running) a.push({ type: "pause", label: "Pause uret", tone: "control", group: g });
      else a.push({ type: "resume", label: "Fortsæt uret", tone: "control", group: g });
    }
    if (opts.periods > 1 || (opts.extraPeriods ?? 0) > 0) a.push({ type: "period_end", label: `Slut ${L.period}. ${opts.periodWord ?? "periode"}`, tone: "control", group: g });
  }
  if (L.period > 0) a.push({ type: "finish", label: "Afslut kampen", tone: "control", group: g });
  a.push({ type: "walkover", label: "Walkover", tone: "danger", group: "Særlige afgørelser", fields: [{ key: "winner", label: "Vinder", kind: "side" }] });
  a.push({ type: "disqualify", label: "Diskvalifikation", tone: "danger", side: true, group: "Særlige afgørelser", fields: [{ key: "reason", label: "Årsag", kind: "text" }] });
  a.push({ type: "abandon", label: "Afbryd kampen", tone: "danger", group: "Særlige afgørelser", fields: [{ key: "reason", label: "Årsag", kind: "text", optional: true }] });
  a.push({ type: "postpone", label: "Udsæt kampen", tone: "danger", group: "Særlige afgørelser", fields: [{ key: "reason", label: "Årsag", kind: "text", optional: true }] });
  return a;
}

export function lifeValidate(L: Life, ev: MatchEvent): string | null {
  if (ev.type === "reopen") return L.ended ? null : "Kampen er ikke afsluttet.";
  if (L.ended && ev.type !== "note") return "Kampen er afsluttet. Genåbn den først, hvis der er en fejl.";
  if (!LIFE_TYPES.has(ev.type) && ev.type !== "note" && L.period === 0 && L.status === "scheduled") return "Start kampen først.";
  if (ev.type === "start" && L.period > 0) return "Kampen er allerede startet.";
  if (ev.type === "resume" && L.running) return "Uret kører allerede.";
  if (ev.type === "pause" && !L.running) return "Uret står allerede stille.";
  if (ev.type === "period_start" && !L.inBreak) return "Afslut den aktuelle periode først.";
  if (ev.type === "period_end" && (L.inBreak || L.period === 0)) return "Der er ingen periode i gang.";
  if (ev.type === "walkover" && !ev.data?.winner) return "Vælg vinderen.";
  if (ev.type === "disqualify" && !ev.side) return "Vælg hvem der diskvalificeres.";
  return null;
}

/** Fælles afslutning: walkover og diskvalifikation overtrumfer stillingen. */
export function decideSpecial(ctx: MatchCtx, L: Life): { winnerId: string | null; resultType: string } | null {
  if (L.ended === "walkover") return { winnerId: L.walkoverWinner || null, resultType: "Walkover" };
  if (L.ended === "dq" && L.dqSide && ctx.participants.length === 2) return { winnerId: other(ctx, L.dqSide) ?? null, resultType: "Diskvalifikation" };
  if (L.ended === "abandoned") return { winnerId: null, resultType: "Afbrudt kamp" };
  if (L.ended === "postponed") return { winnerId: null, resultType: "Udsat kamp" };
  return null;
}

/** Turneringspoint for to-deltager-kampe. */
export function duelResults(ctx: MatchCtx, winnerId: string | null, draw: boolean, scoreFor: Record<string, number>, extraPts?: Record<string, number>, extra?: Record<string, Record<string, number>>): ParticipantResult[] {
  const w = num(ctx.rules, "ptsWin", 2), d = num(ctx.rules, "ptsDraw", 1), l = num(ctx.rules, "ptsLoss", 0);
  return ctx.participants.map((p) => {
    const opp = ctx.participants.find((q) => q.id !== p.id);
    const outcome: "W" | "D" | "L" | undefined = draw ? "D" : winnerId ? (winnerId === p.id ? "W" : "L") : undefined;
    const base = outcome === "W" ? w : outcome === "D" ? d : outcome === "L" ? l : 0;
    return {
      id: p.id,
      outcome,
      scoreFor: scoreFor[p.id] ?? 0,
      scoreAgainst: opp ? scoreFor[opp.id] ?? 0 : 0,
      points: base + (extraPts?.[p.id] ?? 0),
      extra: extra?.[p.id],
    };
  });
}

export function emptySummary(): Summary {
  return { status: "scheduled", phase: "", scores: [], winnerId: null, draw: false, resultType: "", feed: [], warnings: [], results: [], info: [] };
}

export function statusLabel(L: Life, phase: string): string {
  if (L.status === "scheduled") return "Ikke startet";
  if (L.status === "finished") return "Slut";
  if (L.status === "abandoned") return "Afbrudt";
  if (L.status === "postponed") return "Udsat";
  if (L.status === "break") return "Pause";
  if (L.status === "paused") return `${phase} · pause`;
  return phase;
}

export function valueOf(rules: RuleValues, id: string): RuleValue | undefined {
  return rules[id];
}
