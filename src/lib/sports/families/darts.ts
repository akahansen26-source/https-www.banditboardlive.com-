/** Dart: x01 (301/501/…) med bust, double-in/out og checkout – og Cricket. Legs og sets. */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent, ScoreLine } from "../types.ts";
import { bool, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, str } from "../common.ts";

/** Kast-totaler, der ikke kan opnås med tre pile. */
export const IMPOSSIBLE = new Set([163, 166, 169, 172, 173, 175, 176, 178, 179]);
/** Scores mellem 2 og 170, der ikke kan lukkes med double-out ("bogey numbers"). */
export const BOGEY = new Set([159, 162, 163, 165, 166, 168, 169]);

export type Dart = { seg: number; mult: 1 | 2 | 3 };
export function dartValue(d: Dart) {
  if (d.seg === 25) return d.mult === 2 ? 50 : 25;
  return d.seg * d.mult;
}

/** Enkel checkout-hjælp (største første pil). */
export function checkout(score: number, darts = 3, outMode = "double"): string {
  if (outMode !== "double" || score > 170 || score < 2 || BOGEY.has(score)) return "";
  const singles: [string, number][] = [];
  for (let n = 20; n >= 1; n--) singles.push([`T${n}`, 3 * n]);
  singles.push(["BULL", 50], ["25", 25]);
  for (let n = 20; n >= 1; n--) singles.push([`D${n}`, 2 * n]);
  for (let n = 20; n >= 1; n--) singles.push([`${n}`, n]);
  const doubles: [string, number][] = [["BULL", 50]];
  for (let n = 20; n >= 1; n--) doubles.push([`D${n}`, 2 * n]);
  const fin = (s: number) => doubles.find((d) => d[1] === s);
  if (darts >= 1 && fin(score)) return fin(score)![0];
  if (darts >= 2) for (const a of singles) { const f = fin(score - a[1]); if (f) return `${a[0]} ${f[0]}`; }
  if (darts >= 3) for (const a of singles) for (const b of singles) { const f = fin(score - a[1] - b[1]); if (f) return `${a[0]} ${b[0]} ${f[0]}`; }
  return "";
}

interface LegState { rem: Record<string, number>; opened: Record<string, boolean>; visits: Record<string, number>; darts: Record<string, number>; turn: string; starter: string }

export function replayX01(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const start = num(ctx.rules, "startScore", 501), outMode = str(ctx.rules, "outMode", "double"), inMode = str(ctx.rules, "inMode", "straight");
  const legsToWin = num(ctx.rules, "legsToWin", 3), setsOn = bool(ctx.rules, "sets", false), setsToWin = num(ctx.rules, "setsToWin", 3);
  const maxRounds = num(ctx.rules, "maxRounds", 0);
  const legs: Record<string, number> = {}, setsW: Record<string, number> = {}, legsTotal: Record<string, number> = {};
  const scored: Record<string, number> = {}, dartsThrown: Record<string, number> = {}, tons: Record<string, number> = {}, max180: Record<string, number> = {};
  ids.forEach((i) => { legs[i] = 0; setsW[i] = 0; legsTotal[i] = 0; scored[i] = 0; dartsThrown[i] = 0; tons[i] = 0; max180[i] = 0; });
  let legStarter = ids[0];
  const newLeg = (starter: string): LegState => ({ rem: Object.fromEntries(ids.map((i) => [i, start])), opened: Object.fromEntries(ids.map((i) => [i, inMode !== "double"])), visits: Object.fromEntries(ids.map((i) => [i, 0])), darts: Object.fromEntries(ids.map((i) => [i, 0])), turn: starter, starter });
  let leg = newLeg(legStarter);
  let legNo = 1, setNo = 1, done = false;
  const last: Record<string, string> = {};
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" }[] = [];
  const next = (id: string) => ids[(ids.indexOf(id) + 1) % ids.length];
  const winLeg = (w: string, seq: number, how: string) => {
    legs[w] += 1; legsTotal[w] += 1;
    feed.push({ seq, side: w, kind: "score", text: `Leg ${legNo} til ${nameOf(ctx, w)} (${how})` });
    if (setsOn) {
      if (legs[w] >= legsToWin) {
        setsW[w] += 1;
        feed.push({ seq, side: w, kind: "score", text: `Sæt ${setNo} til ${nameOf(ctx, w)}` });
        ids.forEach((i) => (legs[i] = 0));
        setNo += 1;
        if (setsW[w] >= setsToWin) done = true;
      }
    } else if (legs[w] >= legsToWin) done = true;
    legNo += 1;
    if (bool(ctx.rules, "alternateStart", true)) legStarter = next(legStarter);
    leg = newLeg(legStarter);
  };
  for (const e of live(events)) {
    if (e.type === "starter" && e.side) { legStarter = e.side; leg = newLeg(legStarter); continue; }
    if (e.type !== "visit" || !e.side || done) continue;
    const id = e.side;
    const total = Number(e.data?.score) || 0;
    const nDarts = Number(e.data?.darts) || 3;
    const r = leg.rem[id];
    let bust = false;
    let counted = total;
    if (!leg.opened[id]) {
      if (e.data?.opened) leg.opened[id] = true; else counted = 0;
    }
    const after = r - counted;
    if (after < 0) bust = true;
    if (outMode === "double" && after === 1) bust = true;
    if (after === 0 && outMode === "double" && e.data?.doubleOut === false) bust = true;
    if (after === 0 && outMode === "master" && e.data?.doubleOut === false && e.data?.tripleOut === false) bust = true;
    leg.visits[id] += 1;
    leg.darts[id] += nDarts;
    dartsThrown[id] += nDarts;
    if (bust) {
      last[id] = `BUST (${total})`;
      feed.push({ seq: e.seq, side: id, kind: "info", text: `${nameOf(ctx, id)}: bust (${total})` });
    } else {
      leg.rem[id] = after;
      scored[id] += counted;
      if (counted >= 100) tons[id] += 1;
      if (counted === 180) max180[id] += 1;
      last[id] = String(counted);
      if (counted === 180) feed.push({ seq: e.seq, side: id, kind: "score", text: `180 – ${nameOf(ctx, id)}!` });
    }
    if (!bust && leg.rem[id] === 0) { winLeg(id, e.seq, `checkout ${counted}`); continue; }
    leg.turn = next(id);
    if (maxRounds > 0 && ids.every((i) => leg.visits[i] >= maxRounds)) {
      const low = Math.min(...ids.map((i) => leg.rem[i]));
      const leaders = ids.filter((i) => leg.rem[i] === low);
      if (leaders.length === 1) winLeg(leaders[0], e.seq, `laveste rest efter ${maxRounds} runder`);
    }
  }
  return { leg, legs, setsW, legsTotal, legNo, setNo, done, last, scored, dartsThrown, tons, max180, feed };
}

export const x01: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayX01(ctx, events);
    const setsOn = bool(ctx.rules, "sets", false);
    out.status = r.done ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, setsOn ? `Sæt ${r.setNo} · leg ${r.legNo}` : `Leg ${r.legNo}`);
    out.scores = ctx.participants.map<ScoreLine>((p) => {
      const avg = r.dartsThrown[p.id] ? ((r.scored[p.id] / r.dartsThrown[p.id]) * 3).toFixed(1) : "–";
      return { id: p.id, name: p.name, main: String(r.leg.rem[p.id]), sub: setsOn ? `Sæt ${r.setsW[p.id]} · legs ${r.legs[p.id]}` : `Legs ${r.legs[p.id]}`, detail: [`Snit ${avg}`, r.last[p.id] ? `Seneste ${r.last[p.id]}` : "", r.max180[p.id] ? `180: ${r.max180[p.id]}` : ""].filter(Boolean), active: !r.done && r.leg.turn === p.id };
    });
    if (!r.done) {
      out.info.push(`Kaster: ${nameOf(ctx, r.leg.turn)}`);
      const rem = r.leg.rem[r.leg.turn];
      const co = checkout(rem, 3, str(ctx.rules, "outMode", "double"));
      if (co && bool(ctx.rules, "showCheckout", true)) out.info.push(`Checkout ${rem}: ${co}`);
      else if (BOGEY.has(rem) && str(ctx.rules, "outMode", "double") === "double") out.info.push(`${rem} kan ikke lukkes med tre pile`);
    }
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (r.done) {
      const key = setsOn ? r.setsW : r.legsTotal;
      out.winnerId = Object.entries(key).sort((a, b) => b[1] - a[1])[0][0];
      out.resultType = setsOn ? `Sæt ${ctx.participants.map((p) => r.setsW[p.id]).join("-")}` : `Legs ${ctx.participants.map((p) => r.legsTotal[p.id]).join("-")}`;
    }
    if (out.winnerId && ctx.participants.length === 2) out.results = duelResults(ctx, out.winnerId, false, r.legsTotal, undefined, Object.fromEntries(ctx.participants.map((p) => [p.id, { avg: r.dartsThrown[p.id] ? Math.round((r.scored[p.id] / r.dartsThrown[p.id]) * 300) / 100 : 0, s180: r.max180[p.id] }])));
    else if (out.winnerId) out.results = ctx.participants.map((p) => ({ id: p.id, outcome: p.id === out.winnerId ? "W" : "L", scoreFor: r.legsTotal[p.id], scoreAgainst: 0, points: p.id === out.winnerId ? num(ctx.rules, "ptsWin", 2) : num(ctx.rules, "ptsLoss", 0) }));
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    if (ev.type !== "visit") return null;
    const r = replayX01(ctx, events);
    if (r.done) return "Kampen er afgjort.";
    if (!ev.side) return "Vælg spiller.";
    if (bool(ctx.rules, "strictTurn", true) && ev.side !== r.leg.turn) return `Det er ${nameOf(ctx, r.leg.turn)}s tur.`;
    const s = Number(ev.data?.score);
    if (!Number.isInteger(s) || s < 0 || s > 180) return "Et kast med tre pile giver 0–180.";
    if (IMPOSSIBLE.has(s)) return `${s} kan ikke kastes med tre pile.`;
    const d = Number(ev.data?.darts ?? 3);
    if (![1, 2, 3].includes(d)) return "Antal pile skal være 1, 2 eller 3.";
    if (s > d * 60) return `${s} kan ikke kastes med ${d} pil${d > 1 ? "e" : ""}.`;
    const rem = r.leg.rem[ev.side];
    if (rem - s === 0 && str(ctx.rules, "outMode", "double") === "double" && (rem > 170 || BOGEY.has(rem))) return `${rem} kan ikke lukkes med double-out.`;
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const dbl = str(ctx.rules, "outMode", "double") !== "straight";
    const a: ActionDef[] = [
      { type: "visit", label: "Registrér kast", side: true, tone: "score", group: "Kast", fields: [{ key: "score", label: "Score (0–180)", kind: "int", min: 0, max: 180 }, { key: "darts", label: "Antal pile", kind: "int", min: 1, max: 3, optional: true }, ...(dbl ? [{ key: "doubleOut", label: "Lukket på double (ved checkout)", kind: "bool" as const, optional: true }] : []), ...(str(ctx.rules, "inMode", "straight") === "double" ? [{ key: "opened", label: "Ramte double-in", kind: "bool" as const, optional: true }] : [])] },
      { type: "starter", label: "Starter i leg", side: true, tone: "info", group: "Leg" },
    ];
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};

// ---------------- Cricket ----------------
const CR = [20, 19, 18, 17, 16, 15, 25];
/** Markeringer kan sendes som data.marks {20:3} eller som felter m20, m25 … */
function marksOf(data: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const m = (data?.marks ?? {}) as Record<string, number>;
  for (const n of CR) {
    const v = Number(m[String(n)] ?? data?.[`m${n}`] ?? 0) || 0;
    if (v) out[String(n)] = v;
  }
  for (const k of Object.keys(m)) if (!(k in out) && Number(m[k])) out[k] = Number(m[k]);
  return out;
}
export function replayCricket(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const marks: Record<string, Record<number, number>> = {}, pts: Record<string, number> = {}, legs: Record<string, number> = {};
  const reset = () => ids.forEach((i) => { marks[i] = Object.fromEntries(CR.map((n) => [n, 0])); pts[i] = 0; });
  ids.forEach((i) => (legs[i] = 0));
  reset();
  let turn = ids[0], legNo = 1, done = false;
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" }[] = [];
  const noScore = str(ctx.rules, "cricketMode", "standard") === "noscore";
  for (const e of live(events)) {
    if (e.type !== "cricket" || !e.side || done) continue;
    const m = marksOf(e.data);
    for (const n of CR) {
      let hit = Number(m[String(n)]) || 0;
      while (hit > 0) {
        if (marks[e.side][n] < 3) marks[e.side][n] += 1;
        else if (!noScore && ids.some((o) => o !== e.side && marks[o][n] < 3)) pts[e.side] += n;
        hit -= 1;
      }
    }
    const closedAll = CR.every((n) => marks[e.side!][n] >= 3);
    const best = ids.every((o) => o === e.side || pts[e.side!] >= pts[o]);
    if (closedAll && (noScore || best)) {
      legs[e.side] += 1;
      feed.push({ seq: e.seq, side: e.side, kind: "score", text: `Leg ${legNo} til ${nameOf(ctx, e.side)}` });
      legNo += 1;
      if (legs[e.side] >= num(ctx.rules, "legsToWin", 3)) done = true;
      reset();
    }
    turn = ids[(ids.indexOf(e.side) + 1) % ids.length];
  }
  return { marks, pts, legs, turn, legNo, done, feed };
}

export const cricket: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayCricket(ctx, events);
    out.status = r.done ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, `Leg ${r.legNo}`);
    const sym = (k: number) => ["·", "/", "X", "Ⓧ"][Math.min(3, k)];
    out.scores = ctx.participants.map((p) => ({ id: p.id, name: p.name, main: String(r.pts[p.id]), sub: `Legs ${r.legs[p.id]}`, detail: CR.map((n) => `${n === 25 ? "B" : n} ${sym(r.marks[p.id][n])}`), active: !r.done && r.turn === p.id }));
    if (!r.done) out.info.push(`Kaster: ${nameOf(ctx, r.turn)}`);
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (r.done) { out.winnerId = Object.entries(r.legs).sort((a, b) => b[1] - a[1])[0][0]; out.resultType = `Legs ${ctx.participants.map((p) => r.legs[p.id]).join("-")}`; }
    if (out.winnerId && ctx.participants.length === 2) out.results = duelResults(ctx, out.winnerId, false, r.legs);
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    if (ev.type !== "cricket") return null;
    const r = replayCricket(ctx, events);
    if (r.done) return "Kampen er afgjort.";
    if (bool(ctx.rules, "strictTurn", true) && ev.side !== r.turn) return `Det er ${nameOf(ctx, r.turn)}s tur.`;
    const m = marksOf(ev.data);
    let total = 0;
    for (const [k, v] of Object.entries(m)) {
      const n = Number(k), c = Number(v);
      if (!CR.includes(n)) return `${k} bruges ikke i Cricket.`;
      if (!Number.isInteger(c) || c < 0) return "Ugyldigt antal markeringer.";
      if (c > (n === 25 ? 6 : 9)) return `For mange markeringer på ${n === 25 ? "bull" : n}.`;
      total += n === 25 ? Math.ceil(c / 2) : Math.ceil(c / 3);
    }
    if (total > 3) return "Højst tre pile pr. tur.";
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    return [...lifeActions(L, { periods: 1, noClock: true }), { type: "cricket", label: "Registrér tur", side: true, tone: "score", group: "Kast", fields: CR.map((n) => ({ key: `m${n}`, label: n === 25 ? "Bull (markeringer)" : `${n} (markeringer)`, kind: "int" as const, min: 0, max: n === 25 ? 6 : 9, optional: true })) }];
  },
};
