/** Skak (resultat + valgfrit skakur) og e-sport (bedst af N maps/runder). */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent } from "../types.ts";
import { bool, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, str } from "../common.ts";

// ---------------- Skak ----------------
export function replayChess(ctx: MatchCtx, events: MatchEvent[], now: number) {
  const [W, Bk] = ctx.participants.map((p) => p.id);
  const base = num(ctx.rules, "baseMin", 90) * 60000, inc = num(ctx.rules, "incrementSec", 30) * 1000;
  const left: Record<string, number> = { [W]: base, [Bk]: base };
  let running: string | null = null, since = 0, moves = 0;
  let result: string | null = null;
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "result" }[] = [];
  for (const e of live(events)) {
    if (e.type === "start" && bool(ctx.rules, "useClock", false)) { running = W; since = e.at; }
    if (e.type === "pause" && running) { left[running] -= e.at - since; running = null; }
    if (e.type === "move" && e.side && running === e.side) {
      left[e.side] -= e.at - since;
      left[e.side] += inc;
      moves += 1;
      running = e.side === W ? Bk : W;
      since = e.at;
    }
    if (e.type === "result") {
      result = String(e.data?.value ?? "");
      if (running) { left[running] -= e.at - since; running = null; }
      feed.push({ seq: e.seq, kind: "result", text: `Resultat: ${result}${e.data?.how ? ` (${e.data.how})` : ""}` });
    }
  }
  if (running) left[running] -= now - since;
  const flagged = bool(ctx.rules, "useClock", false) ? [W, Bk].find((id) => left[id] <= 0) : undefined;
  return { W, Bk, left, running, moves, result, flagged, feed };
}

const fmtMs = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`; };

export const chess: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayChess(ctx, events, now);
    out.status = r.result ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `${num(ctx.rules, "baseMin", 90)}+${num(ctx.rules, "incrementSec", 30)} · træk ${Math.floor(r.moves / 2) + 1}`);
    const mark = (id: string) => (r.result === "1-0" ? (id === r.W ? "1" : "0") : r.result === "0-1" ? (id === r.W ? "0" : "1") : r.result === "½-½" ? "½" : "");
    out.scores = [r.W, r.Bk].map((id, i) => ({ id, name: nameOf(ctx, id), main: r.result ? mark(id) : bool(ctx.rules, "useClock", false) ? fmtMs(r.left[id]) : "–", sub: i === 0 ? "Hvid" : "Sort", active: r.running === id }));
    if (r.flagged) out.warnings.push(`${nameOf(ctx, r.flagged)} har overskredet tiden (flag). Registrér resultatet.`);
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (r.result) {
      out.winnerId = r.result === "1-0" ? r.W : r.result === "0-1" ? r.Bk : null;
      out.draw = r.result === "½-½";
      out.resultType = out.draw ? "Remis" : "Sejr";
    }
    if (out.winnerId || out.draw) {
      const val = (id: string) => (out.draw ? 0.5 : id === out.winnerId ? 1 : 0);
      out.results = duelResults(ctx, out.winnerId, out.draw, { [r.W]: val(r.W), [r.Bk]: val(r.Bk) }, undefined, { [r.W]: { white: 1 }, [r.Bk]: { black: 1 } });
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayChess(ctx, events, ev.at);
    if (r.result && ev.type !== "reopen") return "Partiet er afgjort.";
    if (ev.type === "result" && !["1-0", "0-1", "½-½"].includes(String(ev.data?.value))) return "Vælg 1-0, 0-1 eller ½-½.";
    if (ev.type === "move") {
      if (!bool(ctx.rules, "useClock", false)) return "Skakuret er slået fra.";
      if (ev.side !== r.running) return "Det er ikke den spillers ur, der kører.";
    }
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const a: ActionDef[] = [
      { type: "result", label: "Hvid vinder (1-0)", tone: "score", group: "Resultat", preset: { value: "1-0" }, fields: [{ key: "how", label: "Måde (mat, opgivet, tid …)", kind: "text", optional: true }] },
      { type: "result", label: "Remis (½-½)", tone: "score", group: "Resultat", preset: { value: "½-½" }, fields: [{ key: "how", label: "Måde", kind: "text", optional: true }] },
      { type: "result", label: "Sort vinder (0-1)", tone: "score", group: "Resultat", preset: { value: "0-1" }, fields: [{ key: "how", label: "Måde", kind: "text", optional: true }] },
    ];
    if (bool(ctx.rules, "useClock", false)) a.unshift({ type: "move", label: "Tryk uret (træk udført)", side: true, tone: "control", group: "Skakur" });
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};

// ---------------- E-sport ----------------
export function replayEsport(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const maps: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const rounds: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const pen: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const list: { name: string; winner: string; score: string }[] = [];
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "penalty" }[] = [];
  const need = Math.floor(num(ctx.rules, "bestOf", 3) / 2) + 1;
  let done = false;
  for (const e of live(events)) {
    if (done) continue;
    if (e.type === "map" && e.side) {
      maps[e.side] += 1;
      const a = Number(e.data?.scoreWinner) || 0, b = Number(e.data?.scoreLoser) || 0;
      rounds[e.side] += a;
      ids.filter((i) => i !== e.side).forEach((i) => (rounds[i] += b));
      list.push({ name: String(e.data?.name ?? `Map ${list.length + 1}`), winner: e.side, score: a || b ? `${a}-${b}` : "" });
      feed.push({ seq: e.seq, side: e.side, kind: "score", text: `${list[list.length - 1].name} til ${nameOf(ctx, e.side)}${a || b ? ` (${a}-${b})` : ""}` });
      if (maps[e.side] >= need) done = true;
    }
    if (e.type === "epenalty" && e.side) { pen[e.side] += Number(e.data?.points) || 1; feed.push({ seq: e.seq, side: e.side, kind: "penalty", text: `Strafpoint ${Number(e.data?.points) || 1} – ${nameOf(ctx, e.side)}${e.data?.reason ? ` (${e.data.reason})` : ""}` }); }
  }
  return { maps, rounds, pen, list, done, need, feed };
}

export const esport: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayEsport(ctx, events);
    out.status = r.done ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `${str(ctx.rules, "game", "") || "E-sport"} · bedst af ${num(ctx.rules, "bestOf", 3)}`);
    out.scores = ctx.participants.map((p) => ({ id: p.id, name: p.name, main: String(r.maps[p.id]), sub: r.rounds[p.id] ? `Runder ${r.rounds[p.id]}` : undefined, detail: r.list.filter((m) => m.winner === p.id).map((m) => `${m.name} ${m.score}`) }));
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (r.done) { out.winnerId = Object.entries(r.maps).sort((a, b) => b[1] - a[1])[0][0]; out.resultType = `Maps ${ctx.participants.map((p) => r.maps[p.id]).join("-")}`; }
    if (out.winnerId) {
      const extra: Record<string, number> = {};
      for (const p of ctx.participants) extra[p.id] = -(r.pen[p.id] ?? 0);
      out.results = duelResults(ctx, out.winnerId, false, r.maps, extra, Object.fromEntries(ctx.participants.map((p) => [p.id, { roundsFor: r.rounds[p.id] }])));
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayEsport(ctx, events);
    if (ev.type === "map") {
      if (!ev.side) return "Vælg vinderen af mappet.";
      if (r.done) return "Serien er afgjort.";
    }
    if (ev.type === "finish" && !r.done) return `Ingen har vundet ${r.need} maps endnu.`;
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    void ctx;
    return [
      ...lifeActions(L, { periods: 1, noClock: true }),
      { type: "map", label: "Vandt map/runde", side: true, tone: "score", group: "Maps", fields: [{ key: "name", label: "Map", kind: "text", optional: true }, { key: "scoreWinner", label: "Score (vinder)", kind: "int", optional: true, min: 0, max: 999 }, { key: "scoreLoser", label: "Score (taber)", kind: "int", optional: true, min: 0, max: 999 }] },
      { type: "epenalty", label: "Strafpoint", side: true, tone: "penalty", group: "Straffe", fields: [{ key: "points", label: "Point", kind: "int", min: 1, max: 10 }, { key: "reason", label: "Årsag", kind: "text" }] },
    ];
  },
};
