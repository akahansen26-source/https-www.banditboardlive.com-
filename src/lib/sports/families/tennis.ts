/** Tennis (og padel): point 0-15-30-40, fordel/no-ad, games, sæt, tiebreak og afgørende sæt. */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent } from "../types.ts";
import { bool, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, str } from "../common.ts";

interface TSet { a: number; b: number; tbA?: number; tbB?: number; winner?: string }

export function replayTennis(ctx: MatchCtx, events: MatchEvent[]) {
  const [A, B] = ctx.participants;
  const gamesToWin = num(ctx.rules, "gamesPerSet", 6), setsToWin = num(ctx.rules, "setsToWin", 2);
  const tbAt = num(ctx.rules, "tiebreakAt", 6), tbTo = num(ctx.rules, "tiebreakPoints", 7);
  const noAd = bool(ctx.rules, "noAd", false), tiebreak = bool(ctx.rules, "useTiebreak", true);
  const finalMode = str(ctx.rules, "finalSet", "tiebreak"); // tiebreak | advantage | matchtb
  const mtbTo = num(ctx.rules, "matchTiebreakPoints", 10);
  const sets: TSet[] = [{ a: 0, b: 0 }];
  const won = { [A.id]: 0, [B.id]: 0 } as Record<string, number>;
  let pa = 0, pb = 0; // point i game
  let server = A.id, firstServerOfTb = A.id, tbPoints = 0;
  let done = false;
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" }[] = [];
  const isFinal = () => sets.length === setsToWin * 2 - 1;
  const inTb = () => {
    const s = sets[sets.length - 1];
    if (isFinal() && finalMode === "matchtb") return true;
    if (!tiebreak) return false;
    if (isFinal() && finalMode === "advantage") return false;
    return s.a === tbAt && s.b === tbAt;
  };
  for (const e of live(events)) {
    if (e.type === "serve" && e.side) { server = e.side; continue; }
    if (e.type !== "point" || !e.side || done) continue;
    const s = sets[sets.length - 1];
    const aWon = e.side === A.id;
    if (inTb()) {
      const to = isFinal() && finalMode === "matchtb" ? mtbTo : tbTo;
      if (tbPoints === 0) firstServerOfTb = server;
      s.tbA = (s.tbA ?? 0) + (aWon ? 1 : 0);
      s.tbB = (s.tbB ?? 0) + (aWon ? 0 : 1);
      tbPoints += 1;
      // serv: første spiller 1 point, derefter skift for hver 2.
      if (tbPoints % 2 === 1) server = server === A.id ? B.id : A.id;
      const hi = Math.max(s.tbA, s.tbB), lo = Math.min(s.tbA, s.tbB);
      if (hi >= to && hi - lo >= 2) {
        const w = s.tbA > s.tbB ? A.id : B.id;
        if (w === A.id) s.a += 1; else s.b += 1;
        s.winner = w;
        won[w] += 1;
        feed.push({ seq: e.seq, side: w, kind: "score", text: `Sæt ${sets.length} til ${nameOf(ctx, w)} (${s.a}-${s.b}, tiebreak ${s.tbA}-${s.tbB})` });
        tbPoints = 0;
        server = firstServerOfTb === A.id ? B.id : A.id;
        if (won[w] >= setsToWin) done = true; else sets.push({ a: 0, b: 0 });
      }
      continue;
    }
    if (aWon) pa += 1; else pb += 1;
    let gameWinner: string | undefined;
    if (noAd) {
      if (pa >= 4 && pa > pb) gameWinner = A.id;
      else if (pb >= 4 && pb > pa) gameWinner = B.id;
      if (pa === 4 && pb === 4) gameWinner = aWon ? A.id : B.id;
    } else {
      if (pa >= 4 && pa - pb >= 2) gameWinner = A.id;
      if (pb >= 4 && pb - pa >= 2) gameWinner = B.id;
    }
    if (gameWinner) {
      if (gameWinner === A.id) s.a += 1; else s.b += 1;
      pa = 0; pb = 0;
      server = server === A.id ? B.id : A.id;
      const hi = Math.max(s.a, s.b), lo = Math.min(s.a, s.b);
      const adv = isFinal() && finalMode === "advantage";
      if (hi >= gamesToWin && hi - lo >= 2 || (!adv && tiebreak && hi === tbAt + 1 && lo === tbAt)) {
        s.winner = s.a > s.b ? A.id : B.id;
        won[s.winner] += 1;
        feed.push({ seq: e.seq, side: s.winner, kind: "score", text: `Sæt ${sets.length} til ${nameOf(ctx, s.winner)} (${s.a}-${s.b})` });
        if (won[s.winner] >= setsToWin) done = true; else sets.push({ a: 0, b: 0 });
      }
    }
  }
  const names = ["0", "15", "30", "40"];
  let pts: [string, string];
  const s = sets[sets.length - 1];
  if (inTb()) pts = [String(s.tbA ?? 0), String(s.tbB ?? 0)];
  else if (pa >= 3 && pb >= 3 && !noAd) pts = pa === pb ? ["40", "40"] : pa > pb ? ["AD", "40"] : ["40", "AD"];
  else pts = [names[Math.min(pa, 3)], names[Math.min(pb, 3)]];
  return { sets, won, server, done, pts, inTb: inTb(), feed };
}

export const tennis: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const [A, B] = ctx.participants;
    if (!A || !B) return out;
    const r = replayTennis(ctx, events);
    out.status = r.done ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `Sæt ${r.sets.length}${r.inTb ? " · tiebreak" : ""}`);
    const games = (i: 0 | 1) => r.sets.map((s) => `${i === 0 ? s.a : s.b}${s.winner && s.tbA !== undefined ? `(${i === 0 ? s.tbA : s.tbB})` : ""}`);
    out.scores = [
      { id: A.id, name: A.name, main: r.done ? String(r.won[A.id]) : r.pts[0], sub: `Sæt ${r.won[A.id]}`, detail: games(0), active: r.server === A.id && !r.done },
      { id: B.id, name: B.name, main: r.done ? String(r.won[B.id]) : r.pts[1], sub: `Sæt ${r.won[B.id]}`, detail: games(1), active: r.server === B.id && !r.done },
    ];
    if (!r.done) out.info.push(`Server: ${nameOf(ctx, r.server)}`);
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (r.done) { out.winnerId = r.won[A.id] > r.won[B.id] ? A.id : B.id; out.resultType = r.sets.map((s) => `${s.a}-${s.b}`).join(", "); }
    if (out.winnerId) {
      const g = (id: string) => r.sets.reduce((n, s) => n + (id === A.id ? s.a : s.b), 0);
      out.results = duelResults(ctx, out.winnerId, false, r.won, undefined, { [A.id]: { gamesFor: g(A.id), gamesAgainst: g(B.id) }, [B.id]: { gamesFor: g(B.id), gamesAgainst: g(A.id) } });
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayTennis(ctx, events);
    if (ev.type === "point") {
      if (!ev.side) return "Vælg hvem der vandt pointet.";
      if (r.done) return "Kampen er afgjort.";
    }
    if (ev.type === "finish" && !r.done) return "Kampen er ikke afgjort endnu.";
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const a: ActionDef[] = [
      { type: "point", label: "Point", side: true, tone: "score", group: "Point" },
      { type: "serve", label: "Første server", side: true, tone: "info", group: "Serv" },
    ];
    void ctx;
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};
