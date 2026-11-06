/**
 * Holdsport med scoring, kampur, perioder og disciplin.
 * Bruges af fodbold, futsal, håndbold, basketball, ishockey og rugby – men hver sport
 * har sin egen opsætning (spec) og sine egne regler. Fodboldens kort bruges ikke i basketball osv.
 */
import type { ActionDef, FamilyModule, FeedItem, MatchCtx, MatchEvent, ScoreLine } from "../types.ts";
import { bool, clockOf, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, other, statusLabel, str } from "../common.ts";

export interface ScoringType {
  id: string;
  label: string;
  /** Regel der angiver værdien (fx "ptsTry"); ellers `value` */
  rule?: string;
  value?: number;
  /** Selvmål: point til modstanderen */
  toOpponent?: boolean;
  /** Regel der skal være slået til for at typen vises */
  enabledBy?: string;
  /** Tæller som "forsøg" i rugbyens bonuspoint */
  isTry?: boolean;
  short?: string;
}
export interface InfoType {
  id: string;
  label: string;
  enabledBy?: string;
  player?: boolean;
}
export interface TeamSpec {
  scoring: ScoringType[];
  info: InfoType[];
  discipline: "football" | "handball" | "rugby" | "hockey" | "basketball" | "none";
  periodWord: string;
  extraWord: string;
  shootoutLabel?: string;
}

type Card = { kind: string; player: string; side: string; minute?: number; seq: number; at: number };

interface TeamState {
  score: Record<string, number>;
  tries: Record<string, number>;
  so: Record<string, { scored: number; taken: number }>;
  scorers: Record<string, string[]>;
  cards: Card[];
  out: Map<string, string>; // "side|player" -> årsag
  fouls: Map<string, number>;
  techs: Map<string, number>;
  unsport: Map<string, number>;
  suspensions: Map<string, number>;
  teamFouls: Record<string, Record<number, number>>;
  timeouts: Record<string, Record<number, number>>;
  subs: Record<string, number>;
  addedMin: Record<number, number>;
  /** Tidsstraffe der kører: side, spiller, slut i kamptid (ms fra kampstart) */
  timed: { side: string; player: string; label: string; endGameMs: number }[];
  feed: FeedItem[];
}

const key = (side: string | undefined, player: string | undefined) => `${side}|${(player ?? "").trim().toLowerCase()}`;

function spec(ctx: MatchCtx): TeamSpec {
  return ctx.sport.spec as TeamSpec;
}

function scoringValue(ctx: MatchCtx, t: ScoringType): number {
  if (t.rule) return num(ctx.rules, t.rule, t.value ?? 1);
  return t.value ?? 1;
}

/** Kamptid i ms for en hændelse ud fra perioder (bruges til 2-minutters udvisninger m.m.). */
function gameMs(ctx: MatchCtx, period: number, elapsedMs: number): number {
  const periods = num(ctx.rules, "periods", 2), plen = num(ctx.rules, "periodMin", 45), elen = num(ctx.rules, "extraMin", 15);
  const before = period <= periods ? (period - 1) * plen : periods * plen + (period - periods - 1) * elen;
  return before * 60000 + elapsedMs;
}

function replay(ctx: MatchCtx, events: MatchEvent[], now: number) {
  const S = spec(ctx);
  const st: TeamState = { score: {}, tries: {}, so: {}, scorers: {}, cards: [], out: new Map(), fouls: new Map(), techs: new Map(), unsport: new Map(), suspensions: new Map(), teamFouls: {}, timeouts: {}, subs: {}, addedMin: {}, timed: [], feed: [] };
  for (const p of ctx.participants) {
    st.score[p.id] = 0;
    st.tries[p.id] = 0;
    st.so[p.id] = { scored: 0, taken: 0 };
    st.scorers[p.id] = [];
    st.teamFouls[p.id] = {};
    st.timeouts[p.id] = {};
    st.subs[p.id] = 0;
  }
  // periode + forløbet tid pr. hændelse (til tidsstraffe)
  let period = 0, elapsed = 0, since: number | null = null;
  const sendOff = (side: string, player: string, why: string) => st.out.set(key(side, player), why);
  const minuteTxt = (e: MatchEvent) => (e.minute ? ` ${e.minute}'` : "");
  const pl = (e: MatchEvent) => (e.player ? ` – ${e.player}` : "");
  for (const e of live(events)) {
    if (e.type === "start") { period = 1; elapsed = 0; since = e.at; }
    else if (e.type === "period_start") { period += 1; elapsed = 0; since = e.at; }
    else if (e.type === "pause" || e.type === "period_end" || e.type === "finish") { if (since !== null) elapsed += e.at - since; since = null; }
    else if (e.type === "resume") since = e.at;
    else if (e.type === "clock_set") { elapsed = Number(e.data?.ms) || 0; if (since !== null) since = e.at; }
    const nowGame = gameMs(ctx, Math.max(1, period), elapsed + (since !== null ? e.at - since : 0));
    const side = e.side ?? "";
    const sc = S.scoring.find((t) => t.id === e.type);
    if (sc) {
      const v = scoringValue(ctx, sc);
      const to = sc.toOpponent ? other(ctx, side) ?? side : side;
      st.score[to] = (st.score[to] ?? 0) + v;
      if (sc.isTry) st.tries[side] = (st.tries[side] ?? 0) + 1;
      const who = e.player ? `${e.player}${minuteTxt(e)}${sc.short ? ` (${sc.short})` : ""}` : `${sc.label}${minuteTxt(e)}`;
      st.scorers[to].push(who);
      st.feed.push({ seq: e.seq, minute: e.minute, side: to, kind: "score", text: `${sc.label}${sc.toOpponent ? "" : v !== 1 ? ` (+${v})` : ""} til ${nameOf(ctx, to)}${pl(e)}` });
      continue;
    }
    switch (e.type) {
      case "yellow": {
        const k = key(side, e.player);
        const prior = st.cards.filter((c) => c.kind === "yellow" && key(c.side, c.player) === k).length;
        st.cards.push({ kind: "yellow", player: e.player ?? "", side, minute: e.minute, seq: e.seq, at: e.at });
        const official = Boolean(e.data?.official);
        st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "card", text: `🟨 Gult kort${official ? " (holdofficial)" : ""} – ${e.player || nameOf(ctx, side)}${e.data?.reason ? ` · ${e.data.reason}` : ""}` });
        if (S.discipline === "football" && prior >= 1 && bool(ctx.rules, "secondYellowRed", true) && e.player) {
          st.cards.push({ kind: "red2", player: e.player, side, minute: e.minute, seq: e.seq, at: e.at });
          sendOff(side, e.player, "2. gule kort");
          st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "card", text: `🟨🟥 Andet gule kort = udvisning – ${e.player}` });
        }
        if (S.discipline === "rugby" && e.player) {
          st.timed.push({ side, player: e.player, label: "Sin bin", endGameMs: nowGame + num(ctx.rules, "sinBinMin", 10) * 60000 });
        }
        break;
      }
      case "red": {
        st.cards.push({ kind: "red", player: e.player ?? "", side, minute: e.minute, seq: e.seq, at: e.at });
        if (e.player) sendOff(side, e.player, "rødt kort");
        st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "card", text: `🟥 Rødt kort – ${e.player || nameOf(ctx, side)}${e.data?.reason ? ` · ${e.data.reason}` : ""}` });
        if (S.discipline === "handball" && e.player) st.timed.push({ side, player: "(holdet)", label: "Rødt kort – holdet spiller med én mindre", endGameMs: nowGame + num(ctx.rules, "suspensionMin", 2) * 60000 });
        if (S.discipline === "rugby" && bool(ctx.rules, "redReplace20", false) && e.player) st.timed.push({ side, player: e.player, label: "Rødt kort (kan erstattes efter 20 min)", endGameMs: nowGame + 20 * 60000 });
        break;
      }
      case "suspension": {
        const k = key(side, e.player);
        const n = (st.suspensions.get(k) ?? 0) + 1;
        st.suspensions.set(k, n);
        st.cards.push({ kind: "susp", player: e.player ?? "", side, minute: e.minute, seq: e.seq, at: e.at });
        const mins = num(ctx.rules, "suspensionMin", 2);
        st.timed.push({ side, player: e.player ?? "", label: `${mins} min`, endGameMs: nowGame + mins * 60000 });
        st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "card", text: `⏱ ${mins} minutters udvisning – ${e.player || nameOf(ctx, side)}` });
        if (n >= num(ctx.rules, "suspensionsToRed", 3) && e.player) {
          sendOff(side, e.player, `${n}. udvisning`);
          st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "card", text: `🟥 ${n}. udvisning giver diskvalifikation – ${e.player}` });
        }
        break;
      }
      case "hockey_pen": {
        const kind = String(e.data?.kind ?? "minor");
        const mins = kind === "minor" ? num(ctx.rules, "minorMin", 2) : kind === "double_minor" ? num(ctx.rules, "minorMin", 2) * 2 : kind === "major" ? num(ctx.rules, "majorMin", 5) : kind === "misconduct" ? num(ctx.rules, "misconductMin", 10) : 0;
        const label = { minor: "Lille straf", double_minor: "Dobbelt lille straf", major: "Stor straf", misconduct: "Misconduct", match: "Matchstraf" }[kind] ?? kind;
        st.cards.push({ kind, player: e.player ?? "", side, minute: e.minute, seq: e.seq, at: e.at });
        if (kind === "match" && e.player) sendOff(side, e.player, "matchstraf");
        if (mins) st.timed.push({ side, player: e.player ?? "", label: `${label} ${mins} min${kind === "misconduct" ? " (holdet ikke i undertal)" : ""}`, endGameMs: nowGame + mins * 60000 });
        st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "penalty", text: `⛔ ${label}${mins ? ` (${mins} min)` : ""} – ${e.player || nameOf(ctx, side)}` });
        break;
      }
      case "foul": {
        const kind = String(e.data?.kind ?? "personal");
        const k = key(side, e.player);
        if (e.player) st.fouls.set(k, (st.fouls.get(k) ?? 0) + 1);
        const tf = st.teamFouls[side] ?? (st.teamFouls[side] = {});
        tf[period] = (tf[period] ?? 0) + 1;
        if (kind === "technical" && e.player) st.techs.set(k, (st.techs.get(k) ?? 0) + 1);
        if (kind === "unsportsmanlike" && e.player) st.unsport.set(k, (st.unsport.get(k) ?? 0) + 1);
        const label = { personal: "Personlig fejl", technical: "Teknisk fejl", unsportsmanlike: "Usportslig fejl", disqualifying: "Diskvalificerende fejl" }[kind] ?? "Fejl";
        st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "penalty", text: `${label} – ${e.player || nameOf(ctx, side)}` });
        if (e.player) {
          const n = st.fouls.get(k) ?? 0;
          if (kind === "disqualifying") sendOff(side, e.player, "diskvalificerende fejl");
          else if (n >= num(ctx.rules, "foulLimit", 5)) sendOff(side, e.player, `${n} fejl`);
          else if ((st.techs.get(k) ?? 0) >= 2 || (st.unsport.get(k) ?? 0) >= 2 || ((st.techs.get(k) ?? 0) >= 1 && (st.unsport.get(k) ?? 0) >= 1)) sendOff(side, e.player, "2 tekniske/usportslige fejl");
          if (st.out.has(k)) st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "card", text: `🚫 ${e.player} må ikke spille videre (${st.out.get(k)})` });
        }
        break;
      }
      case "timeout": {
        const half = ctx.sport.id === "basketball" ? (period <= 2 ? 1 : period <= 4 ? 2 : 3) : 1;
        const t = st.timeouts[side] ?? (st.timeouts[side] = {});
        t[half] = (t[half] ?? 0) + 1;
        st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "info", text: `Timeout – ${nameOf(ctx, side)}` });
        break;
      }
      case "sub":
        st.subs[side] = (st.subs[side] ?? 0) + 1;
        st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "info", text: `Udskiftning ${nameOf(ctx, side)}: ${e.data?.out ?? "?"} ud, ${e.data?.in ?? "?"} ind` });
        break;
      case "added_time":
        st.addedMin[period] = Number(e.data?.minutes) || 0;
        st.feed.push({ seq: e.seq, minute: e.minute, kind: "info", text: `Tillægstid: +${Number(e.data?.minutes) || 0} min` });
        break;
      case "so": {
        const r = st.so[side] ?? (st.so[side] = { scored: 0, taken: 0 });
        r.taken += 1;
        if (e.data?.scored) r.scored += 1;
        st.feed.push({ seq: e.seq, side, kind: "score", text: `${S.shootoutLabel ?? "Straffe"}: ${nameOf(ctx, side)} ${e.data?.scored ? "scorer" : "brænder"}${pl(e)}` });
        break;
      }
      default: {
        const info = S.info.find((i) => i.id === e.type);
        if (info) st.feed.push({ seq: e.seq, minute: e.minute, side, kind: "info", text: `${info.label}${side ? ` – ${nameOf(ctx, side)}` : ""}${pl(e)}` });
        else if (e.type === "note") st.feed.push({ seq: e.seq, kind: "info", text: String(e.data?.text ?? "") });
      }
    }
  }
  const nowGame = gameMs(ctx, Math.max(1, period), elapsed + (since !== null ? now - since : 0));
  st.timed = st.timed.filter((t) => t.endGameMs > nowGame);
  return { st, nowGame, period };
}

export const teamscore: FamilyModule = {
  summarize(ctx, events, now) {
    const S = spec(ctx);
    const L = lifecycle(events, now);
    const { st, nowGame } = replay(ctx, events, now);
    const out = emptySummary();
    const periods = num(ctx.rules, "periods", 2), plen = num(ctx.rules, "periodMin", 45), elen = num(ctx.rules, "extraMin", 15);
    const extra = bool(ctx.rules, "extraTime", false) ? num(ctx.rules, "extraPeriods", 2) : 0;
    const inExtra = L.period > periods;
    const dir = str(ctx.rules, "clockDirection", "up") === "down" ? "down" : "up";
    const curLen = inExtra ? elen : plen;
    const offset = dir === "up" ? (inExtra ? periods * plen + (L.period - periods - 1) * elen : (Math.max(1, L.period) - 1) * plen) : 0;
    const phase = L.period === 0 ? "Før kampen" : inExtra ? `${S.extraWord} ${L.period - periods}` : `${L.period}. ${S.periodWord}`;
    if (bool(ctx.rules, "useClock", true)) {
      out.clock = clockOf(L, now, curLen, dir, offset, phase);
      const add = st.addedMin[L.period];
      if (add) out.info.push(`Tillægstid +${add}`);
    }
    out.status = L.status;
    out.phase = statusLabel(L, phase);
    const [a, b] = ctx.participants;
    const soOn = Object.values(st.so).some((r) => r.taken > 0);
    out.scores = ctx.participants.map<ScoreLine>((p) => ({
      id: p.id,
      name: p.name,
      main: String(st.score[p.id] ?? 0),
      sub: soOn ? `(${st.so[p.id]?.scored ?? 0})` : undefined,
      detail: [
        ...st.scorers[p.id],
        ...st.cards.filter((c) => c.side === p.id).map((c) => `${{ yellow: "🟨", red: "🟥", red2: "🟨🟥", susp: "⏱", minor: "⛔", major: "⛔", misconduct: "⛔", match: "🟥", double_minor: "⛔" }[c.kind] ?? "•"} ${c.player || "Hold"}${c.minute ? ` ${c.minute}'` : ""}`),
      ],
    }));
    for (const t of st.timed) {
      const left = Math.max(0, t.endGameMs - nowGame), s = Math.ceil(left / 1000);
      out.info.push(`${nameOf(ctx, t.side)}: ${t.player} – ${t.label} (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} tilbage)`);
    }
    if (S.discipline === "basketball" && L.period > 0) {
      for (const p of ctx.participants) {
        const n = st.teamFouls[p.id]?.[L.period] ?? 0;
        const lim = num(ctx.rules, "teamFoulLimit", 4);
        out.info.push(`Holdfejl ${p.name}: ${n}${n >= lim ? " – straffekast (bonus)" : ""}`);
      }
    }
    const scoreFor: Record<string, number> = {};
    for (const p of ctx.participants) scoreFor[p.id] = st.score[p.id] ?? 0;
    out.feed = st.feed.slice().reverse();

    const special = decideSpecial(ctx, L);
    if (L.status === "finished" || special) {
      if (special) {
        out.winnerId = special.winnerId;
        out.resultType = special.resultType;
      } else if (a && b) {
        const sa = scoreFor[a.id], sb = scoreFor[b.id];
        if (sa !== sb) {
          out.winnerId = sa > sb ? a.id : b.id;
          out.resultType = L.period > periods ? `Efter ${S.extraWord.toLowerCase()}` : "Ordinær tid";
        } else if (soOn && st.so[a.id].scored !== st.so[b.id].scored) {
          out.winnerId = st.so[a.id].scored > st.so[b.id].scored ? a.id : b.id;
          out.resultType = `Efter ${(S.shootoutLabel ?? "straffe").toLowerCase()}`;
        } else {
          out.draw = true;
          out.resultType = "Uafgjort";
        }
      }
    } else if (a && b && L.inBreak && L.period >= periods && scoreFor[a.id] === scoreFor[b.id] && !bool(ctx.rules, "allowDraw", true)) {
      if (extra && L.period < periods + extra) out.warnings.push(`Uafgjort – kampen skal afgøres. Start ${S.extraWord.toLowerCase()}.`);
      else if (bool(ctx.rules, "shootout", false)) out.warnings.push(`Uafgjort – kampen afgøres ved ${(S.shootoutLabel ?? "straffe").toLowerCase()}.`);
    }
    if (out.status === "finished" && !special) {
      const extraPts: Record<string, number> = {};
      const afterOT = /Efter/.test(out.resultType);
      if (afterOT && bool(ctx.rules, "otPoints", false)) {
        for (const p of ctx.participants) extraPts[p.id] = (p.id === out.winnerId ? num(ctx.rules, "ptsOTWin", 2) - num(ctx.rules, "ptsWin", 3) : num(ctx.rules, "ptsOTLoss", 1) - num(ctx.rules, "ptsLoss", 0));
      }
      if (S.discipline === "rugby") {
        for (const p of ctx.participants) {
          let x = 0;
          if (bool(ctx.rules, "bonusTry", true) && st.tries[p.id] >= num(ctx.rules, "bonusTryCount", 4)) x += 1;
          const opp = other(ctx, p.id);
          if (bool(ctx.rules, "bonusLosing", true) && opp && out.winnerId === opp && scoreFor[opp] - scoreFor[p.id] <= num(ctx.rules, "bonusLosingMargin", 7)) x += 1;
          extraPts[p.id] = (extraPts[p.id] ?? 0) + x;
        }
      }
      out.results = duelResults(ctx, out.winnerId, out.draw, scoreFor, extraPts, Object.fromEntries(ctx.participants.map((p) => [p.id, { tries: st.tries[p.id] ?? 0, cards: st.cards.filter((c) => c.side === p.id).length }])));
    } else if (special && special.winnerId) {
      out.results = duelResults(ctx, special.winnerId, false, scoreFor);
    }
    return out;
  },

  validate(ctx, events, ev) {
    const S = spec(ctx);
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const { st } = replay(ctx, events, ev.at);
    const sideOk = ev.side && ctx.participants.some((p) => p.id === ev.side);
    const sc = S.scoring.find((t) => t.id === ev.type);
    if (sc || ["yellow", "red", "suspension", "hockey_pen", "foul", "timeout", "sub", "so"].includes(ev.type)) {
      if (!sideOk) return "Vælg hold.";
      if (L.status !== "live" && L.status !== "paused" && !(ev.type === "so" || ev.type === "sub")) {
        if (!(L.inBreak && (ev.type === "yellow" || ev.type === "red"))) return "Kampen er ikke i gang.";
      }
    }
    const playerOut = ev.player && st.out.has(key(ev.side, ev.player));
    if (sc) {
      if (sc.enabledBy && !bool(ctx.rules, sc.enabledBy, true)) return `${sc.label} er slået fra i regelsættet.`;
      if (playerOut) return `${ev.player} er ude af kampen (${st.out.get(key(ev.side, ev.player))}) og kan ikke score.`;
      if (ev.player && st.timed.some((t) => key(t.side, t.player) === key(ev.side, ev.player))) return `${ev.player} afsoner en tidsstraf og kan ikke score.`;
    }
    if (["yellow", "red"].includes(ev.type) && !bool(ctx.rules, "cards", true)) return "Kort er slået fra i regelsættet.";
    if (["yellow", "red", "suspension", "hockey_pen", "foul"].includes(ev.type) && playerOut) return `${ev.player} er allerede ude af kampen.`;
    if (ev.type === "sub") {
      if (!bool(ctx.rules, "substitutions", true)) return "Udskiftninger er slået fra.";
      const max = num(ctx.rules, "maxSubs", 0);
      if (max > 0 && (st.subs[ev.side ?? ""] ?? 0) >= max) return `Holdet har brugt alle ${max} udskiftninger.`;
      const inn = String(ev.data?.in ?? "");
      if (inn && st.out.has(key(ev.side, inn))) return `${inn} er udvist og må ikke komme ind igen.`;
    }
    if (ev.type === "timeout") {
      const max = num(ctx.rules, "timeouts", 0);
      if (max > 0) {
        const half = ctx.sport.id === "basketball" ? (L.period <= 2 ? 1 : L.period <= 4 ? 2 : 3) : 1;
        if ((st.timeouts[ev.side ?? ""]?.[half] ?? 0) >= max) return "Holdet har ikke flere timeouts.";
      }
    }
    if (ev.type === "so") {
      if (!bool(ctx.rules, "shootout", false)) return `${S.shootoutLabel ?? "Straffesparkskonkurrence"} er slået fra.`;
      const periods = num(ctx.rules, "periods", 2), extra = bool(ctx.rules, "extraTime", false) ? num(ctx.rules, "extraPeriods", 2) : 0;
      const [a, b] = ctx.participants;
      if (extra && L.period < periods + extra) return `Spil ${S.extraWord.toLowerCase()} først.`;
      if (!(L.inBreak && L.period >= periods + extra)) return "Straffekonkurrencen starter først, når spilletiden er slut.";
      if (a && b && st.score[a.id] !== st.score[b.id]) return "Kampen er ikke uafgjort.";
    }
    if (ev.type === "finish") {
      const [a, b] = ctx.participants;
      const periods = num(ctx.rules, "periods", 2);
      if (a && b && st.score[a.id] === st.score[b.id] && !bool(ctx.rules, "allowDraw", true)) {
        const soA = st.so[a.id]?.scored ?? 0, soB = st.so[b.id]?.scored ?? 0;
        const extra = bool(ctx.rules, "extraTime", false) ? num(ctx.rules, "extraPeriods", 2) : 0;
        if (extra && L.period < periods + extra) return `Kampen kan ikke ende uafgjort. Spil ${S.extraWord.toLowerCase()}.`;
        if (bool(ctx.rules, "shootout", false) && soA === soB) return `Kampen kan ikke ende uafgjort. Afgør den med ${(S.shootoutLabel ?? "straffe").toLowerCase()}.`;
        if (!bool(ctx.rules, "shootout", false) && !extra) return "Kampen kan ikke ende uafgjort efter regelsættet.";
      }
      if (bool(ctx.rules, "earlyFinish", false) === false && L.period < periods && bool(ctx.rules, "useClock", true)) return `Kampen har ${periods} perioder. Slå "kan afsluttes før tid" til, eller brug "Afbryd kampen".`;
    }
    return null;
  },

  actions(ctx, events, now) {
    const S = spec(ctx);
    const L = lifecycle(events, now);
    const a: ActionDef[] = [];
    const g = "Scoring";
    for (const t of S.scoring) {
      if (t.enabledBy && !bool(ctx.rules, t.enabledBy, true)) continue;
      a.push({ type: t.id, label: t.label, side: true, tone: "score", group: g, fields: [{ key: "player", label: "Spiller (valgfri)", kind: "player", optional: true }] });
    }
    const d = "Disciplin";
    if (S.discipline === "football" || S.discipline === "rugby") {
      if (bool(ctx.rules, "cards", true)) {
        a.push({ type: "yellow", label: "Gult kort", side: true, tone: "card", group: d, fields: [{ key: "player", label: "Spiller", kind: "player" }, { key: "reason", label: "Årsag", kind: "text", optional: true }, ...(S.discipline === "football" && bool(ctx.rules, "officialCards", true) ? [{ key: "official", label: "Til træner/holdofficial", kind: "bool" as const, optional: true }] : [])] });
        a.push({ type: "red", label: "Rødt kort", side: true, tone: "card", group: d, fields: [{ key: "player", label: "Spiller", kind: "player" }, { key: "reason", label: "Årsag", kind: "text", optional: true }] });
      }
    }
    if (S.discipline === "handball") {
      if (bool(ctx.rules, "cards", true)) a.push({ type: "yellow", label: "Advarsel (gult)", side: true, tone: "card", group: d, fields: [{ key: "player", label: "Spiller", kind: "player" }] });
      a.push({ type: "suspension", label: `${num(ctx.rules, "suspensionMin", 2)} min udvisning`, side: true, tone: "card", group: d, fields: [{ key: "player", label: "Spiller", kind: "player" }] });
      if (bool(ctx.rules, "cards", true)) a.push({ type: "red", label: "Rødt kort", side: true, tone: "card", group: d, fields: [{ key: "player", label: "Spiller", kind: "player" }, { key: "reason", label: "Årsag", kind: "text", optional: true }] });
    }
    if (S.discipline === "hockey") {
      a.push({ type: "hockey_pen", label: "Udvisning", side: true, tone: "card", group: d, fields: [{ key: "player", label: "Spiller", kind: "player" }, { key: "kind", label: "Type", kind: "choice", options: [{ value: "minor", label: "Lille straf" }, { value: "double_minor", label: "Dobbelt lille straf" }, { value: "major", label: "Stor straf" }, { value: "misconduct", label: "Misconduct" }, { value: "match", label: "Matchstraf" }] }] });
    }
    if (S.discipline === "basketball") {
      a.push({ type: "foul", label: "Fejl", side: true, tone: "card", group: d, fields: [{ key: "player", label: "Spiller", kind: "player" }, { key: "kind", label: "Type", kind: "choice", options: [{ value: "personal", label: "Personlig" }, { value: "technical", label: "Teknisk" }, { value: "unsportsmanlike", label: "Usportslig" }, { value: "disqualifying", label: "Diskvalificerende" }] }] });
    }
    const info = "Hændelser";
    for (const i of S.info) {
      if (i.enabledBy && !bool(ctx.rules, i.enabledBy, true)) continue;
      a.push({ type: i.id, label: i.label, side: true, tone: "info", group: info, fields: i.player ? [{ key: "player", label: "Spiller (valgfri)", kind: "player", optional: true }] : [] });
    }
    if (num(ctx.rules, "timeouts", 0) > 0 || S.discipline === "basketball" || S.discipline === "handball") a.push({ type: "timeout", label: "Timeout", side: true, tone: "info", group: info });
    if (bool(ctx.rules, "substitutions", true)) a.push({ type: "sub", label: "Udskiftning", side: true, tone: "info", group: info, fields: [{ key: "out", label: "Ud", kind: "player" }, { key: "in", label: "Ind", kind: "text" }] });
    if (bool(ctx.rules, "addedTime", false)) a.push({ type: "added_time", label: "Tillægstid", tone: "info", group: info, fields: [{ key: "minutes", label: "Minutter", kind: "int", min: 0, max: 30 }] });
    if (bool(ctx.rules, "shootout", false)) a.push({ type: "so", label: S.shootoutLabel ?? "Straffe", side: true, tone: "score", group: S.shootoutLabel ?? "Straffekonkurrence", fields: [{ key: "scored", label: "Scoret", kind: "bool" }, { key: "player", label: "Spiller (valgfri)", kind: "player", optional: true }] });
    const periods = num(ctx.rules, "periods", 2), extra = bool(ctx.rules, "extraTime", false) ? num(ctx.rules, "extraPeriods", 2) : 0;
    return [...lifeActions(L, { periods, extraPeriods: extra, periodWord: S.periodWord, noClock: !bool(ctx.rules, "useClock", true) }), ...a];
  },
};
