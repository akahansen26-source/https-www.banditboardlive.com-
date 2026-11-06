/**
 * Kampsport. To scoringsmodeller, styret af regelsættet:
 *  - "judges": dommere giver point pr. runde (fx 10-point must) – boksning, MMA, kickboxing
 *  - "points": tekniske point pr. handling – judo, karate, taekwondo, brydning
 * Pointværdier og afgørelsesregler kommer fra disciplinens regelsæt (spec + regler), ikke fra koden.
 */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent } from "../types.ts";
import { bool, clockOf, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, other, statusLabel, str } from "../common.ts";

export interface ScoreKind { id: string; label: string; rule?: string; value?: number; /** afslutter kampen (fx ippon) */ ends?: boolean; /** antal af denne, der afslutter kampen (fx 2 waza-ari i judo) */ endsAt?: string }
export interface CombatSpec { kinds?: ScoreKind[]; penaltyLabel?: string; methods: { value: string; label: string }[] }

const spec = (ctx: MatchCtx) => (ctx.sport.spec ?? { methods: [] }) as CombatSpec;

export function replayCombat(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const [A, B] = ids;
  const S = spec(ctx);
  const judges = num(ctx.rules, "judges", 3);
  const cards: Record<number, Record<number, { a: number; b: number }>> = {}; // runde -> dommer -> score
  const pts: Record<string, number> = { [A]: 0, [B]: 0 };
  const kindCount: Record<string, Record<string, number>> = { [A]: {}, [B]: {} };
  const kd: Record<string, number> = { [A]: 0, [B]: 0 };
  const warnings: Record<string, number> = { [A]: 0, [B]: 0 };
  const deductions: Record<string, number> = { [A]: 0, [B]: 0 };
  const penalties: Record<string, number> = { [A]: 0, [B]: 0 };
  let stop: { method: string; winner: string } | null = null;
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "penalty" | "result" }[] = [];
  for (const e of live(events)) {
    const side = e.side ?? "";
    switch (e.type) {
      case "round_score": {
        const rnd = Number(e.data?.round) || 1, j = Number(e.data?.judge) || 1;
        (cards[rnd] ??= {})[j] = { a: Number(e.data?.a) || 0, b: Number(e.data?.b) || 0 };
        feed.push({ seq: e.seq, kind: "score", text: `Runde ${rnd}, dommer ${j}: ${nameOf(ctx, A)} ${e.data?.a} – ${e.data?.b} ${nameOf(ctx, B)}` });
        break;
      }
      case "knockdown": kd[side] += 1; feed.push({ seq: e.seq, side, kind: "info", text: `Knockdown – ${nameOf(ctx, side)} i gulvet` }); break;
      case "warning": warnings[side] += 1; feed.push({ seq: e.seq, side, kind: "penalty", text: `Advarsel – ${nameOf(ctx, side)}${e.data?.reason ? ` (${e.data.reason})` : ""}` }); break;
      case "deduction": deductions[side] += Number(e.data?.points) || 1; feed.push({ seq: e.seq, side, kind: "penalty", text: `Pointfradrag ${Number(e.data?.points) || 1} – ${nameOf(ctx, side)}` }); break;
      case "cpenalty": {
        penalties[side] += 1;
        const opp = other(ctx, side);
        if (bool(ctx.rules, "penaltyGivesPoint", false) && opp) pts[opp] += num(ctx.rules, "penaltyPointValue", 1);
        feed.push({ seq: e.seq, side, kind: "penalty", text: `${S.penaltyLabel ?? "Straf"} ${penalties[side]} – ${nameOf(ctx, side)}` });
        const lim = num(ctx.rules, "penaltiesToLose", 0);
        if (lim > 0 && penalties[side] >= lim && opp && !stop) { stop = { method: "dq_penalties", winner: opp }; feed.push({ seq: e.seq, side: opp, kind: "result", text: `${nameOf(ctx, side)} taber på straffe (${lim})` }); }
        break;
      }
      case "score": {
        const k = (S.kinds ?? []).find((x) => x.id === e.data?.kind);
        if (!k) break;
        const v = k.rule ? num(ctx.rules, k.rule, k.value ?? 1) : k.value ?? 1;
        pts[side] += v;
        kindCount[side][k.id] = (kindCount[side][k.id] ?? 0) + 1;
        feed.push({ seq: e.seq, side, kind: "score", text: `${k.label} – ${nameOf(ctx, side)}${v ? ` (+${v})` : ""}` });
        const endsAt = k.endsAt ? num(ctx.rules, k.endsAt, 0) : 0;
        if (!stop && (k.ends || (endsAt > 0 && kindCount[side][k.id] >= endsAt))) stop = { method: k.ends ? k.id : `${k.id}_x${endsAt}`, winner: side };
        const gap = num(ctx.rules, "pointGap", 0);
        const opp = other(ctx, side);
        if (!stop && gap > 0 && opp && pts[side] - pts[opp] >= gap) stop = { method: "point_gap", winner: side };
        break;
      }
      case "stoppage": stop = { method: String(e.data?.method ?? "stopped"), winner: String(e.data?.winner ?? "") }; feed.push({ seq: e.seq, kind: "result", text: `Kampen stoppet: ${String(e.data?.method ?? "")}${e.data?.winner ? ` – vinder ${nameOf(ctx, String(e.data.winner))}` : ""}` }); break;
    }
  }
  // dommerkort: total pr. dommer
  const judgeTotals: { a: number; b: number }[] = [];
  for (let j = 1; j <= judges; j++) {
    let a = 0, b = 0;
    for (const r of Object.values(cards)) if (r[j]) { a += r[j].a; b += r[j].b; }
    judgeTotals.push({ a: a - deductions[A], b: b - deductions[B] });
  }
  return { A, B, cards, pts: { [A]: pts[A] - (str(ctx.rules, "scoring", "judges") === "points" ? 0 : 0), [B]: pts[B] }, kd, warnings, deductions, penalties, stop, judgeTotals, feed };
}

export function decision(totals: { a: number; b: number }[]) {
  const aw = totals.filter((t) => t.a > t.b).length, bw = totals.filter((t) => t.b > t.a).length, dr = totals.length - aw - bw;
  if (aw === bw) return { winner: 0, label: dr === totals.length ? "Uafgjort (enstemmigt)" : "Uafgjort (split)" };
  const w = aw > bw ? 1 : 2;
  const wn = Math.max(aw, bw), ln = Math.min(aw, bw);
  const label = ln === 0 && dr === 0 ? "Enstemmig dommerafgørelse" : ln === 0 ? "Flertalsafgørelse" : "Split-afgørelse";
  void wn;
  return { winner: w, label };
}

export const combat: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayCombat(ctx, events);
    const scoring = str(ctx.rules, "scoring", "judges");
    const rounds = num(ctx.rules, "rounds", 3);
    const phase = L.period === 0 ? "Før kampen" : L.period > rounds ? "Golden score / ekstra" : `Runde ${L.period} af ${rounds}`;
    if (bool(ctx.rules, "useClock", true)) out.clock = clockOf(L, now, L.period > rounds ? 0 : num(ctx.rules, "roundMin", 3), L.period > rounds ? "up" : "down", 0, phase);
    out.status = r.stop ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, phase);
    const name = (id: string) => nameOf(ctx, id);
    out.scores = [r.A, r.B].map((id, i) => ({
      id,
      name: name(id),
      main: scoring === "points" ? String(r.pts[id]) : r.judgeTotals.length && Object.keys(r.cards).length ? r.judgeTotals.map((t) => (i === 0 ? t.a : t.b)).join(" / ") : "–",
      sub: [r.kd[id] ? `KD ${r.kd[id]}` : "", r.warnings[id] ? `Adv. ${r.warnings[id]}` : "", r.deductions[id] ? `−${r.deductions[id]}` : "", r.penalties[id] ? `${spec(ctx).penaltyLabel ?? "Straf"} ${r.penalties[id]}` : ""].filter(Boolean).join(" · ") || undefined,
    }));
    out.feed = r.feed.slice().reverse();
    if (L.ended === "walkover") { out.winnerId = L.walkoverWinner || null; out.resultType = "Walkover"; }
    else if (L.ended === "dq" && L.dqSide) { out.winnerId = other(ctx, L.dqSide) ?? null; out.resultType = "Diskvalifikation"; }
    else if (L.ended === "abandoned" || L.ended === "postponed") { out.resultType = L.ended === "abandoned" ? "Kampen stoppet" : "Udsat"; }
    else if (r.stop) {
      out.winnerId = r.stop.winner || null;
      out.draw = !r.stop.winner;
      out.resultType = spec(ctx).methods.find((m) => m.value === r.stop!.method)?.label ?? { point_gap: "Sejr på pointforskel", dq_penalties: "Diskvalifikation (straffe)" }[r.stop.method] ?? r.stop.method;
    } else if (L.status === "finished") {
      if (scoring === "points") {
        if (r.pts[r.A] !== r.pts[r.B]) { out.winnerId = r.pts[r.A] > r.pts[r.B] ? r.A : r.B; out.resultType = "Sejr på point"; }
        else if (str(ctx.rules, "tieRule", "draw") === "penalties" && r.penalties[r.A] !== r.penalties[r.B]) { out.winnerId = r.penalties[r.A] < r.penalties[r.B] ? r.A : r.B; out.resultType = "Sejr på færrest straffe"; }
        else { out.draw = true; out.resultType = "Uafgjort"; }
      } else {
        const d = decision(r.judgeTotals);
        out.winnerId = d.winner === 1 ? r.A : d.winner === 2 ? r.B : null;
        out.draw = d.winner === 0;
        out.resultType = d.label;
      }
    }
    if (out.winnerId || out.draw) out.results = duelResults(ctx, out.winnerId, out.draw, scoring === "points" ? r.pts : { [r.A]: r.judgeTotals.filter((t) => t.a > t.b).length, [r.B]: r.judgeTotals.filter((t) => t.b > t.a).length });
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayCombat(ctx, events);
    if (r.stop && !["note", "reopen"].includes(ev.type)) return "Kampen er afgjort.";
    if (ev.type === "round_score") {
      const rnd = Number(ev.data?.round), j = Number(ev.data?.judge), a = Number(ev.data?.a), b = Number(ev.data?.b);
      const rounds = num(ctx.rules, "rounds", 3), judges = num(ctx.rules, "judges", 3);
      if (!Number.isInteger(rnd) || rnd < 1 || rnd > rounds) return `Runde skal være 1–${rounds}.`;
      if (!Number.isInteger(j) || j < 1 || j > judges) return `Dommer skal være 1–${judges}.`;
      const max = num(ctx.rules, "roundMax", 10), min = num(ctx.rules, "roundMin2", 7);
      if (![a, b].every((x) => Number.isInteger(x) && x >= min && x <= max)) return `Point pr. runde skal være ${min}–${max}.`;
      if (bool(ctx.rules, "tenPointMust", true) && Math.max(a, b) !== max) return `10-point must: vinderen af runden skal have ${max}.`;
      if (r.cards[rnd]?.[j]) return `Dommer ${j} har allerede scoret runde ${rnd}. Annullér den først.`;
    }
    if (["knockdown", "warning", "deduction", "cpenalty", "score"].includes(ev.type) && !ev.side) return "Vælg udøver.";
    if (ev.type === "finish" && str(ctx.rules, "scoring", "judges") === "judges") {
      const rounds = num(ctx.rules, "rounds", 3), judges = num(ctx.rules, "judges", 3);
      for (let i = 1; i <= Math.min(rounds, L.period); i++) for (let j = 1; j <= judges; j++) if (!r.cards[i]?.[j]) return `Mangler dommer ${j}s point for runde ${i}.`;
    }
    if (ev.type === "finish" && str(ctx.rules, "scoring", "judges") === "points" && str(ctx.rules, "tieRule", "draw") === "golden" && r.pts[r.A] === r.pts[r.B]) return "Uafgjort – fortsæt i golden score til en udøver scorer.";
    if (ev.type === "stoppage" && !ev.data?.method) return "Vælg afgørelse.";
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const S = spec(ctx);
    const scoring = str(ctx.rules, "scoring", "judges");
    const a: ActionDef[] = [];
    if (scoring === "judges") a.push({ type: "round_score", label: "Dommerpoint for runde", tone: "score", group: "Dommerkort", fields: [{ key: "round", label: "Runde", kind: "int", min: 1, max: num(ctx.rules, "rounds", 3) }, { key: "judge", label: "Dommer nr.", kind: "int", min: 1, max: num(ctx.rules, "judges", 3) }, { key: "a", label: `Point ${ctx.participants[0]?.name ?? "A"}`, kind: "int", min: 0, max: 10 }, { key: "b", label: `Point ${ctx.participants[1]?.name ?? "B"}`, kind: "int", min: 0, max: 10 }] });
    for (const k of S.kinds ?? []) a.push({ type: "score", label: k.label, side: true, tone: "score", group: "Point", preset: { kind: k.id } });
    if (bool(ctx.rules, "knockdowns", scoring === "judges")) a.push({ type: "knockdown", label: "Knockdown (i gulvet)", side: true, tone: "info", group: "Hændelser" });
    a.push({ type: "warning", label: "Advarsel", side: true, tone: "penalty", group: "Straffe", fields: [{ key: "reason", label: "Årsag", kind: "text", optional: true }] });
    if (scoring === "judges") a.push({ type: "deduction", label: "Pointfradrag", side: true, tone: "penalty", group: "Straffe", fields: [{ key: "points", label: "Point", kind: "int", min: 1, max: 3 }] });
    if (S.penaltyLabel) a.push({ type: "cpenalty", label: S.penaltyLabel, side: true, tone: "penalty", group: "Straffe" });
    a.push({ type: "stoppage", label: "Afgør kampen", tone: "danger", group: "Afgørelse", fields: [{ key: "method", label: "Afgørelse", kind: "choice", options: S.methods }, { key: "winner", label: "Vinder", kind: "side" }] });
    return [...lifeActions(L, { periods: num(ctx.rules, "rounds", 3), periodWord: "runde", noClock: !bool(ctx.rules, "useClock", true) }), ...a];
  },
};
