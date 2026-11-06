/**
 * Egne pointregler: skomager, quiz og helt brugerdefinerede discipliner.
 * Hændelserne (navn, værdi, plus/minus, hvem får pointene) defineres i regelsættet –
 * der er ingen faste skomagerregler i koden.
 */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent, ParticipantResult } from "../types.ts";
import { bool, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, str, table } from "../common.ts";

export function replayCustom(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const score: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const used = new Set<string>();
  const pending: { id: string; seq: number; text: string }[] = [];
  const approved = new Set<string>(), rejected = new Set<string>();
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "penalty" }[] = [];
  let round = 1;
  const evs = live(events);
  for (const e of evs) {
    if (e.type === "approve") approved.add(String(e.data?.ref));
    if (e.type === "reject") rejected.add(String(e.data?.ref));
  }
  const allowNeg = bool(ctx.rules, "allowNegative", true);
  const add = (id: string, d: number) => {
    score[id] = (score[id] ?? 0) + d;
    if (!allowNeg && score[id] < 0) score[id] = 0;
  };
  for (const e of evs) {
    const side = e.side ?? "";
    if (e.type === "round_next") { round += 1; feed.push({ seq: e.seq, kind: "info", text: `Runde ${round}` }); continue; }
    if (e.type === "custom") {
      const def = ctx.customEvents.find((c) => c.id === e.data?.eventId);
      if (!def) continue;
      const count = Math.max(1, Math.min(50, Math.round(Number(e.data?.count) || 1)));
      if (def.needsApproval && !approved.has(e.id)) {
        if (!rejected.has(e.id)) pending.push({ id: e.id, seq: e.seq, text: `${def.name} – ${nameOf(ctx, side)}` });
        continue;
      }
      used.add(`${side}|${def.id}`);
      const v = def.value * def.sign * count;
      if (def.target === "self") add(side, v);
      else ids.filter((i) => i !== side).forEach((i) => add(i, Math.abs(v)));
      if (def.target === "opponents" && bool(ctx.rules, "offenderLoses", true)) add(side, -Math.abs(v));
      feed.push({ seq: e.seq, side, kind: def.sign < 0 || def.target === "opponents" ? "penalty" : "score", text: `${def.name}${count > 1 ? ` ×${count}` : ""} – ${nameOf(ctx, side)} (${def.target === "self" ? (v >= 0 ? "+" : "") + v : `${Math.abs(v)} til ${ids.length > 2 ? "hver modstander" : nameOf(ctx, ids.find((i) => i !== side))}`})` });
      continue;
    }
    if (e.type === "answer") {
      const ok = Boolean(e.data?.correct);
      const v = (ok ? num(ctx.rules, "pointsCorrect", 1) : -num(ctx.rules, "pointsWrong", 0)) + (Number(e.data?.bonus) || 0);
      add(side, v);
      feed.push({ seq: e.seq, side, kind: ok ? "score" : "penalty", text: `${nameOf(ctx, side)}: ${ok ? "rigtigt" : "forkert"} svar (${v >= 0 ? "+" : ""}${v})` });
      continue;
    }
    if (e.type === "adjust") {
      const d = Math.round(Number(e.data?.delta) || 0);
      add(side, d);
      feed.push({ seq: e.seq, side, kind: "info", text: `Korrektion ${nameOf(ctx, side)}: ${d >= 0 ? "+" : ""}${d}${e.data?.reason ? ` (${e.data.reason})` : ""}` });
    }
  }
  const tgt = num(ctx.rules, "targetScore", 0);
  const reached = tgt > 0 ? ids.filter((i) => score[i] >= tgt) : [];
  const rounds = num(ctx.rules, "rounds", 0);
  const doneByRounds = rounds > 0 && round > rounds;
  return { score, used, pending, feed, round, reached, doneByRounds };
}

function ranking(ids: string[], score: Record<string, number>, lowWins: boolean) {
  const sorted = ids.slice().sort((a, b) => (lowWins ? score[a] - score[b] : score[b] - score[a]));
  const place: Record<string, number> = {};
  sorted.forEach((id, i) => (place[id] = i > 0 && score[id] === score[sorted[i - 1]] ? place[sorted[i - 1]] : i + 1));
  return { sorted, place };
}

export const custom: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayCustom(ctx, events);
    const ids = ctx.participants.map((p) => p.id);
    const lowWins = str(ctx.rules, "winner", "highest") === "lowest";
    const { place } = ranking(ids, r.score, lowWins);
    const auto = (r.reached.length > 0 || r.doneByRounds) && bool(ctx.rules, "autoFinish", true);
    out.status = auto ? "finished" : L.status;
    const rounds = num(ctx.rules, "rounds", 0);
    out.phase = statusLabel({ ...L, status: out.status }, rounds ? `Runde ${Math.min(r.round, rounds)} af ${rounds}` : num(ctx.rules, "targetScore", 0) ? `Først til ${num(ctx.rules, "targetScore", 0)}` : "I gang");
    out.scores = ctx.participants.map((p) => ({ id: p.id, name: p.name, main: String(r.score[p.id]), place: place[p.id] }));
    if (r.pending.length) out.warnings.push(`${r.pending.length} hændelse(r) venter på godkendelse`);
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (out.status === "finished") {
      const top = ids.filter((i) => place[i] === 1);
      out.winnerId = top.length === 1 ? top[0] : null;
      out.draw = top.length > 1;
      out.resultType = out.draw ? "Delt førsteplads" : "Afgjort på point";
    }
    if (out.status === "finished" && !special) {
      if (ids.length === 2) out.results = duelResults(ctx, out.winnerId, out.draw, r.score);
      else {
        const tab = table(ctx.rules, "placePoints");
        out.results = ids.map<ParticipantResult>((id) => ({ id, place: place[id], scoreFor: r.score[id], scoreAgainst: 0, points: tab.length ? tab[place[id] - 1] ?? 0 : r.score[id], outcome: place[id] === 1 ? "W" : "L" }));
      }
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayCustom(ctx, events);
    if (["custom", "answer", "adjust"].includes(ev.type)) {
      if (!ev.side || !ctx.participants.some((p) => p.id === ev.side)) return "Vælg spiller eller hold.";
      if ((r.reached.length || r.doneByRounds) && bool(ctx.rules, "autoFinish", true)) return "Kampen er afgjort.";
    }
    if (ev.type === "custom") {
      const def = ctx.customEvents.find((c) => c.id === ev.data?.eventId);
      if (!def) return "Hændelsen findes ikke i regelsættet.";
      if (!def.repeatable && r.used.has(`${ev.side}|${def.id}`)) return `"${def.name}" kan kun registreres én gang.`;
    }
    if (ev.type === "adjust") {
      const d = Number(ev.data?.delta);
      if (!Number.isInteger(d) || d === 0) return "Skriv et helt tal, fx -6 eller 5.";
      if (Math.abs(d) > 10000) return "Tallet er for stort.";
    }
    if ((ev.type === "approve" || ev.type === "reject") && !r.pending.some((p) => p.id === ev.data?.ref)) return "Der er ingen ventende hændelse at godkende.";
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const r = replayCustom(ctx, events);
    const a: ActionDef[] = [];
    for (const c of ctx.customEvents) a.push({ type: "custom", label: `${c.name} (${c.target === "opponents" ? `${c.value} til modst.` : (c.sign > 0 ? "+" : "−") + c.value})`, side: true, tone: c.sign < 0 || c.target === "opponents" ? "penalty" : "score", group: "Hændelser", preset: { eventId: c.id }, hint: c.description, fields: c.repeatable ? [{ key: "count", label: "Antal", kind: "int", min: 1, max: 50, optional: true }] : [] });
    if (str(ctx.rules, "mode", "") === "quiz") {
      a.push({ type: "answer", label: "Rigtigt svar", side: true, tone: "score", group: "Svar", preset: { correct: true }, fields: [{ key: "bonus", label: "Bonuspoint", kind: "int", optional: true, min: 0, max: 100 }] });
      a.push({ type: "answer", label: "Forkert svar", side: true, tone: "penalty", group: "Svar", preset: { correct: false } });
    }
    if (num(ctx.rules, "rounds", 0) > 0) a.push({ type: "round_next", label: "Næste runde", tone: "control", group: "Runder" });
    a.push({ type: "adjust", label: "Ret score (±)", side: true, tone: "info", group: "Korrektion", fields: [{ key: "delta", label: "Tal (fx -6 eller 5)", kind: "int", min: -10000, max: 10000 }, { key: "reason", label: "Årsag", kind: "text", optional: true }] });
    for (const p of r.pending) {
      a.push({ type: "approve", label: `Godkend: ${p.text}`, tone: "control", group: "Til godkendelse", preset: { ref: p.id } });
      a.push({ type: "reject", label: `Afvis: ${p.text}`, tone: "danger", group: "Til godkendelse", preset: { ref: p.id } });
    }
    return [...lifeActions(L, { periods: 1, noClock: !bool(ctx.rules, "useClock", false) }), ...a];
  },
};
