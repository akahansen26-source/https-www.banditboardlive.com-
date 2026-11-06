/**
 * Sætbaserede sportsgrene med "rally point" (hver bold giver point): volleyball, beachvolley,
 * badminton, bordtennis, squash. Tennis har sin egen pointmodel (tennis.ts).
 */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent } from "../types.ts";
import { bool, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, other, statusLabel } from "../common.ts";

interface SetScore { a: number; b: number; winner?: string }

function target(ctx: MatchCtx, setIndex: number) {
  const setsToWin = num(ctx.rules, "setsToWin", 2);
  const decider = setIndex === setsToWin * 2 - 2;
  return {
    to: decider && num(ctx.rules, "decidingSetPoints", 0) > 0 ? num(ctx.rules, "decidingSetPoints", 0) : num(ctx.rules, "pointsToWin", 21),
    by: num(ctx.rules, "winBy", 2),
    cap: decider && num(ctx.rules, "decidingSetCap", 0) > 0 ? num(ctx.rules, "decidingSetCap", 0) : num(ctx.rules, "pointCap", 0),
    decider,
  };
}

function setDone(ctx: MatchCtx, s: SetScore, i: number): boolean {
  const t = target(ctx, i);
  const hi = Math.max(s.a, s.b), lo = Math.min(s.a, s.b);
  if (t.cap > 0 && hi >= t.cap) return true;
  return hi >= t.to && hi - lo >= t.by;
}

export function replaySets(ctx: MatchCtx, events: MatchEvent[]) {
  const [A, B] = ctx.participants;
  const sets: SetScore[] = [{ a: 0, b: 0 }];
  const won: Record<string, number> = { [A.id]: 0, [B.id]: 0 };
  let server: string | undefined = undefined;
  let done = false;
  const timeouts: Record<string, number> = { [A.id]: 0, [B.id]: 0 };
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" }[] = [];
  const setsToWin = num(ctx.rules, "setsToWin", 2);
  const serveEvery = num(ctx.rules, "serveEvery", 0);
  let setFirst: string | undefined = undefined;
  for (const e of live(events)) {
    if (e.type === "serve") { server = e.side; if (sets[sets.length - 1].a + sets[sets.length - 1].b === 0) setFirst = e.side; }
    if (e.type === "timeout" && e.side) {
      timeouts[e.side] += 1;
      feed.push({ seq: e.seq, side: e.side, kind: "info", text: `Timeout – ${nameOf(ctx, e.side)}` });
    }
    if (e.type !== "point" || !e.side || done) continue;
    const cur = sets[sets.length - 1];
    if (e.side === A.id) cur.a += 1;
    else cur.b += 1;
    if (serveEvery > 0) {
      // fast serveskifte (fx bordtennis: hver 2. bold, og hver bold fra 10-10)
      const first = setFirst ?? A.id;
      const n = cur.a + cur.b, t = target(ctx, sets.length - 1);
      const deuceFrom = (t.to - 1) * 2;
      const changes = n < deuceFrom ? Math.floor(n / serveEvery) : Math.floor(deuceFrom / serveEvery) + (n - deuceFrom);
      server = changes % 2 === 0 ? first : first === A.id ? B.id : A.id;
    } else if (bool(ctx.rules, "rallyServe", true)) server = e.side;
    if (setDone(ctx, cur, sets.length - 1)) {
      cur.winner = cur.a > cur.b ? A.id : B.id;
      won[cur.winner] += 1;
      feed.push({ seq: e.seq, side: cur.winner, kind: "score", text: `Sæt ${sets.length} til ${nameOf(ctx, cur.winner)} (${cur.a}-${cur.b})` });
      if (won[cur.winner] >= setsToWin) done = true;
      else {
        sets.push({ a: 0, b: 0 });
        timeouts[A.id] = 0;
        timeouts[B.id] = 0;
        if (serveEvery > 0) { setFirst = (setFirst ?? A.id) === A.id ? B.id : A.id; server = setFirst; }
      }
    }
  }
  return { sets, won, server, done, timeouts, feed };
}

export const sets: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const [A, B] = ctx.participants;
    if (!A || !B) return out;
    const r = replaySets(ctx, events);
    const cur = r.sets[r.sets.length - 1];
    out.status = r.done && L.status !== "finished" ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `${num(ctx.rules, "setsToWin", 2) * 2 - 1 > 1 ? `Sæt ${r.sets.length}` : "Kamp"}`);
    const hist = (side: "a" | "b") => r.sets.filter((s) => s.winner).map((s) => String(s[side]));
    out.scores = [
      { id: A.id, name: A.name, main: String(cur.winner ? 0 : cur.a), sub: `Sæt ${r.won[A.id]}`, detail: hist("a"), active: r.server === A.id },
      { id: B.id, name: B.name, main: String(cur.winner ? 0 : cur.b), sub: `Sæt ${r.won[B.id]}`, detail: hist("b"), active: r.server === B.id },
    ];
    if (r.done) out.scores.forEach((s, i) => (s.main = String(i === 0 ? cur.a : cur.b)));
    if (r.server && bool(ctx.rules, "showServe", true)) out.info.push(`Server: ${nameOf(ctx, r.server)}`);
    const t = target(ctx, r.sets.length - 1);
    if (!r.done) {
      const hi = Math.max(cur.a, cur.b), lo = Math.min(cur.a, cur.b);
      if (hi >= t.to - 1 && hi > lo) out.info.push(`${t.decider ? "Afgørende sæt – " : ""}sætbold til ${cur.a > cur.b ? A.name : B.name}`);
    }
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) {
      out.winnerId = special.winnerId;
      out.resultType = special.resultType;
    } else if (r.done) {
      out.winnerId = r.won[A.id] > r.won[B.id] ? A.id : B.id;
      out.resultType = `${r.won[A.id]}-${r.won[B.id]} i sæt`;
    }
    if (out.winnerId) {
      // Volleyball (FIVB-stil): point afhænger af sætcifrene, hvis slået til
      const extra: Record<string, number> = {};
      if (bool(ctx.rules, "pointsBySets", false) && !special) {
        const loserSets = Math.min(r.won[A.id], r.won[B.id]);
        const close = loserSets === num(ctx.rules, "setsToWin", 3) - 1;
        for (const p of [A, B]) {
          const w = p.id === out.winnerId;
          extra[p.id] = (w ? (close ? num(ctx.rules, "ptsWinClose", 2) : num(ctx.rules, "ptsWin", 3)) : close ? num(ctx.rules, "ptsLossClose", 1) : num(ctx.rules, "ptsLoss", 0)) - (w ? num(ctx.rules, "ptsWin", 3) : num(ctx.rules, "ptsLoss", 0));
        }
      }
      const pointsFor = (id: string) => r.sets.reduce((s, x) => s + (id === A.id ? x.a : x.b), 0);
      out.results = duelResults(ctx, out.winnerId, false, r.won, extra, { [A.id]: { pointsFor: pointsFor(A.id), pointsAgainst: pointsFor(B.id) }, [B.id]: { pointsFor: pointsFor(B.id), pointsAgainst: pointsFor(A.id) } });
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replaySets(ctx, events);
    if (ev.type === "point") {
      if (!ev.side || !ctx.participants.some((p) => p.id === ev.side)) return "Vælg hvem der vandt bolden.";
      if (r.done) return "Kampen er afgjort – der kan ikke gives flere point.";
      if (L.status === "paused") return "Kampen er sat på pause.";
    }
    if (ev.type === "timeout") {
      const max = num(ctx.rules, "timeoutsPerSet", 0);
      if (max === 0) return "Timeouts er slået fra.";
      if (ev.side && r.timeouts[ev.side] >= max) return `${nameOf(ctx, ev.side)} har brugt sine timeouts i dette sæt.`;
    }
    if (ev.type === "finish" && !r.done) return "Kampen er ikke afgjort endnu. Brug Afbryd eller Walkover ved en særlig afgørelse.";
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const a: ActionDef[] = [
      { type: "point", label: "Point", side: true, tone: "score", group: "Point" },
      { type: "serve", label: "Server", side: true, tone: "info", group: "Serv" },
    ];
    if (num(ctx.rules, "timeoutsPerSet", 0) > 0) a.push({ type: "timeout", label: "Timeout", side: true, tone: "info", group: "Hændelser" });
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};

export { other };
