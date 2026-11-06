/** Bowling (10 kegler): frames, strike/spare-bonus, 10. frame, serier, handicap og holdresultat. */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent, ParticipantResult } from "../types.ts";
import { bool, decideSpecial, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, table } from "../common.ts";

/** Beregner én serie ud fra kast. Returnerer kumulativ score pr. frame og om serien er færdig. */
export function scoreGame(rolls: number[]) {
  const frames: { rolls: number[]; total?: number }[] = [];
  let i = 0;
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    if (f < 9) {
      if (rolls[i] === 10) { frames.push({ rolls: [10] }); i += 1; }
      else { frames.push({ rolls: rolls.slice(i, i + 2) }); i += 2; }
    } else frames.push({ rolls: rolls.slice(i, i + 3) });
  }
  let cum = 0;
  let idx = 0;
  for (let f = 0; f < frames.length; f++) {
    const fr = frames[f];
    if (f < 9) {
      const a = rolls[idx], b = rolls[idx + 1], c = rolls[idx + 2];
      if (a === 10) { if (b !== undefined && c !== undefined) { cum += 10 + b + c; fr.total = cum; } idx += 1; }
      else if (b !== undefined && a + b === 10) { if (c !== undefined) { cum += 10 + c; fr.total = cum; } idx += 2; }
      else if (b !== undefined) { cum += a + b; fr.total = cum; idx += 2; }
      else idx += 1;
    } else {
      const r = fr.rolls;
      const need = r[0] === 10 || (r.length >= 2 && r[0] + r[1] === 10) ? 3 : 2;
      if (r.length >= need) { cum += r.reduce((s, x) => s + x, 0); fr.total = cum; }
    }
  }
  const last = frames[9];
  const complete = !!last && last.total !== undefined;
  return { frames, total: cum, complete };
}

/** Hvor mange kegler står der, før næste kast? */
export function pinsStanding(rolls: number[]): number {
  let i = 0;
  for (let f = 0; f < 9; f++) {
    if (i >= rolls.length) return 10;
    if (rolls[i] === 10) { i += 1; continue; }
    if (i + 1 >= rolls.length) return 10 - rolls[i];
    i += 2;
  }
  const r = rolls.slice(i);
  if (r.length === 0) return 10;
  if (r.length === 1) return r[0] === 10 ? 10 : 10 - r[0];
  if (r.length === 2) {
    if (r[0] === 10) return r[1] === 10 ? 10 : 10 - r[1];
    return r[0] + r[1] === 10 ? 10 : 0;
  }
  return 0;
}

const sym = (rolls: number[]) => {
  const out: string[] = [];
  let i = 0;
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    if (f < 9) {
      if (rolls[i] === 10) { out.push("X"); i += 1; }
      else { const a = rolls[i], b = rolls[i + 1]; out.push(`${a || "-"}${b === undefined ? "" : a + b === 10 ? "/" : b || "-"}`); i += 2; }
    } else {
      const r = rolls.slice(i);
      out.push(r.map((x, k) => (x === 10 ? "X" : k > 0 && r[k - 1] !== 10 && r[k - 1] + x === 10 ? "/" : x || "-")).join(""));
      i = rolls.length;
    }
  }
  return out.join(" ");
};

export function replayBowling(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const games = num(ctx.rules, "games", 1);
  const rolls: Record<string, number[][]> = Object.fromEntries(ids.map((i) => [i, [[]]]));
  for (const e of live(events)) {
    if (e.type !== "roll" || !e.side) continue;
    const g = rolls[e.side];
    if (!g) continue;
    let cur = g[g.length - 1];
    if (scoreGame(cur).complete) { if (g.length >= games) continue; cur = []; g.push(cur); }
    cur.push(e.data?.spare ? pinsStanding(cur) : Number(e.data?.pins) || 0);
  }
  const hcp = (id: string) => {
    if (!bool(ctx.rules, "handicap", false)) return 0;
    const p = ctx.participants.find((x) => x.id === id);
    if (typeof p?.handicap === "number") return p.handicap;
    return 0;
  };
  const series = Object.fromEntries(ids.map((id) => {
    const gs = rolls[id].map(scoreGame);
    const scratch = gs.reduce((s, g) => s + g.total, 0);
    const done = gs.length >= games && gs.every((g) => g.complete);
    return [id, { gs, scratch, total: scratch + hcp(id) * gs.filter((g) => g.complete || g.frames.length).length, done }];
  }));
  return { rolls, series, games };
}

export const bowling: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayBowling(ctx, events);
    const ids = ctx.participants.map((p) => p.id);
    const allDone = ids.length > 0 && ids.every((i) => r.series[i].done);
    out.status = allDone ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `${r.games > 1 ? `${r.games} serier` : "1 serie"}`);
    const sorted = ids.slice().sort((a, b) => r.series[b].total - r.series[a].total);
    const place: Record<string, number> = {};
    sorted.forEach((id, i) => (place[id] = i > 0 && r.series[id].total === r.series[sorted[i - 1]].total ? place[sorted[i - 1]] : i + 1));
    out.scores = ctx.participants.map((p) => {
      const s = r.series[p.id];
      const cur = r.rolls[p.id][r.rolls[p.id].length - 1];
      return { id: p.id, name: p.name, main: String(s.total), sub: bool(ctx.rules, "handicap", false) ? `Scratch ${s.scratch}` : `Serie ${r.rolls[p.id].length}/${r.games}`, detail: [sym(cur)], place: place[p.id], active: !s.done };
    });
    if (bool(ctx.rules, "teamTotals", false)) {
      const teams = new Map<string, number>();
      for (const p of ctx.participants) if (p.team) teams.set(p.team, (teams.get(p.team) ?? 0) + r.series[p.id].total);
      for (const [t, v] of [...teams.entries()].sort((a, b) => b[1] - a[1])) out.info.push(`Hold ${t}: ${v}`);
    }
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (out.status === "finished") {
      out.winnerId = sorted.filter((i) => place[i] === 1).length === 1 ? sorted[0] : null;
      out.draw = !out.winnerId;
      out.resultType = "Samlet kegletal";
      const tab = table(ctx.rules, "placePoints");
      out.results = ids.map<ParticipantResult>((id) => ({ id, place: place[id], scoreFor: r.series[id].total, scoreAgainst: 0, points: tab.length ? tab[place[id] - 1] ?? 0 : 0, outcome: place[id] === 1 ? "W" : "L", extra: { pinfall: r.series[id].total } }));
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    if (ev.type !== "roll") return null;
    const r = replayBowling(ctx, events);
    if (!ev.side || !r.rolls[ev.side]) return "Vælg spiller.";
    const g = r.rolls[ev.side];
    let cur = g[g.length - 1];
    if (scoreGame(cur).complete) { if (g.length >= r.games) return `${nameOf(ctx, ev.side)} har spillet alle serier.`; cur = []; }
    const standing = pinsStanding(cur);
    if (ev.data?.spare) return standing === 10 ? "Spare kræver, at der er væltet kegler i første kast." : null;
    const pins = Number(ev.data?.pins);
    if (!Number.isInteger(pins) || pins < 0 || pins > 10) return "Antal væltede kegler skal være 0–10.";
    if (pins > standing) return `Der står kun ${standing} kegler.`;
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const a: ActionDef[] = [
      { type: "roll", label: "Kast", side: true, tone: "score", group: "Kast", fields: [{ key: "pins", label: "Væltede kegler (0–10)", kind: "int", min: 0, max: 10 }] },
      { type: "roll", label: "Strike (X)", side: true, tone: "score", group: "Kast", preset: { pins: 10 } },
      { type: "roll", label: "Spare (/)", side: true, tone: "score", group: "Kast", preset: { spare: true } },
      { type: "roll", label: "Rendesten (0)", side: true, tone: "info", group: "Kast", preset: { pins: 0 } },
    ];
    void ctx;
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};
