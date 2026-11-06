/** Golf: slagspil, Stableford og hulspil – med par, handicap (slagindeks) og strafslag. */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent, ParticipantResult } from "../types.ts";
import { bool, decideSpecial, duelResults, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, str, table } from "../common.ts";

export function strokesReceived(ctx: MatchCtx, id: string, hole: number): number {
  if (!bool(ctx.rules, "handicap", false)) return 0;
  const p = ctx.participants.find((x) => x.id === id);
  const holes = num(ctx.rules, "holes", 18);
  const ph = Math.round((p?.handicap ?? 0) * num(ctx.rules, "allowance", 100) / 100);
  if (ph <= 0) return 0;
  const idx = table(ctx.rules, "strokeIndex")[hole - 1] ?? hole;
  return Math.floor(ph / holes) + (idx <= ph % holes ? 1 : 0);
}

export function replayGolf(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const holes = num(ctx.rules, "holes", 18);
  const par = table(ctx.rules, "par");
  const card: Record<string, Record<number, { strokes: number; pen: number; gross: number; net: number; pts: number }>> = Object.fromEntries(ids.map((i) => [i, {}]));
  for (const e of live(events)) {
    if (e.type !== "hole" || !e.side || !card[e.side]) continue;
    const h = Number(e.data?.hole), strokes = Number(e.data?.strokes) || 0, pen = Number(e.data?.penalties) || 0;
    const gross = strokes + pen;
    const net = gross - strokesReceived(ctx, e.side, h);
    const pts = Math.max(0, 2 + (par[h - 1] ?? 4) - net);
    card[e.side][h] = { strokes, pen, gross, net, pts };
  }
  const tot = Object.fromEntries(ids.map((id) => {
    const hs = Object.entries(card[id]);
    const gross = hs.reduce((s, [, v]) => s + v.gross, 0), net = hs.reduce((s, [, v]) => s + v.net, 0), pts = hs.reduce((s, [, v]) => s + v.pts, 0), pen = hs.reduce((s, [, v]) => s + v.pen, 0);
    const parPlayed = hs.reduce((s, [h]) => s + (par[Number(h) - 1] ?? 4), 0);
    return [id, { gross, net, pts, pen, played: hs.length, toPar: (bool(ctx.rules, "handicap", false) ? net : gross) - parPlayed }];
  }));
  // hulspil
  let lead = 0, played = 0;
  const [A, B] = ids;
  if (str(ctx.rules, "format", "stroke") === "match" && A && B) {
    for (let h = 1; h <= holes; h++) {
      const a = card[A][h], b = card[B][h];
      if (!a || !b) break;
      played = h;
      if (a.net < b.net) lead += 1; else if (b.net < a.net) lead -= 1;
      if (Math.abs(lead) > holes - h) break;
    }
  }
  return { card, tot, holes, lead, played };
}

export const golf: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayGolf(ctx, events);
    const ids = ctx.participants.map((p) => p.id);
    const fmt = str(ctx.rules, "format", "stroke");
    const allIn = ids.every((i) => r.tot[i].played >= r.holes);
    const matchDone = fmt === "match" && (Math.abs(r.lead) > r.holes - r.played || r.played >= r.holes);
    out.status = (fmt === "match" ? matchDone : allIn) && ids.length ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, fmt === "stableford" ? "Stableford" : fmt === "match" ? `Hulspil · hul ${r.played}` : "Slagspil");
    const val = (id: string) => (fmt === "stableford" ? r.tot[id].pts : bool(ctx.rules, "handicap", false) ? r.tot[id].net : r.tot[id].gross);
    const sorted = ids.slice().sort((a, b) => (fmt === "stableford" ? val(b) - val(a) : val(a) - val(b)));
    const place: Record<string, number> = {};
    sorted.forEach((id, i) => (place[id] = i > 0 && val(id) === val(sorted[i - 1]) ? place[sorted[i - 1]] : i + 1));
    const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));
    out.scores = ctx.participants.map((p) => ({
      id: p.id,
      name: p.name,
      main: fmt === "stableford" ? `${r.tot[p.id].pts} p` : fmt === "match" ? (p.id === ids[0] ? (r.lead > 0 ? `${r.lead} UP` : r.lead === 0 ? "AS" : "") : r.lead < 0 ? `${-r.lead} UP` : r.lead === 0 ? "AS" : "") : toPar(r.tot[p.id].toPar),
      sub: `${r.tot[p.id].gross} slag · ${r.tot[p.id].played}/${r.holes} huller${r.tot[p.id].pen ? ` · ${r.tot[p.id].pen} strafslag` : ""}`,
      place: fmt === "match" ? undefined : place[p.id],
    }));
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    else if (out.status === "finished") {
      if (fmt === "match") {
        out.winnerId = r.lead > 0 ? ids[0] : r.lead < 0 ? ids[1] : null;
        out.draw = r.lead === 0;
        const left = r.holes - r.played;
        out.resultType = out.draw ? "Delt (all square)" : left > 0 ? `${Math.abs(r.lead)} & ${left}` : `${Math.abs(r.lead)} up`;
        out.results = duelResults(ctx, out.winnerId, out.draw, { [ids[0]]: Math.max(0, r.lead), [ids[1]]: Math.max(0, -r.lead) });
      } else {
        const top = ids.filter((i) => place[i] === 1);
        out.winnerId = top.length === 1 ? top[0] : null;
        out.draw = top.length > 1;
        out.resultType = fmt === "stableford" ? "Flest Stableford-point" : "Færrest slag";
        const tab = table(ctx.rules, "placePoints");
        out.results = ids.map<ParticipantResult>((id) => ({ id, place: place[id], scoreFor: val(id), scoreAgainst: 0, points: tab.length ? tab[place[id] - 1] ?? 0 : 0, outcome: place[id] === 1 ? "W" : "L" }));
      }
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    if (ev.type !== "hole") return null;
    const r = replayGolf(ctx, events);
    if (!ev.side || !r.card[ev.side]) return "Vælg spiller.";
    const h = Number(ev.data?.hole), s = Number(ev.data?.strokes), p = Number(ev.data?.penalties ?? 0);
    if (!Number.isInteger(h) || h < 1 || h > r.holes) return `Hul skal være 1–${r.holes}.`;
    if (!Number.isInteger(s) || s < 1 || s > 20) return "Slag skal være 1–20.";
    if (!Number.isInteger(p) || p < 0 || p > 10) return "Strafslag skal være 0–10.";
    if (r.card[ev.side][h]) return `Hul ${h} er allerede registreret for ${nameOf(ctx, ev.side)}. Annullér den gamle registrering først.`;
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const holes = num(ctx.rules, "holes", 18);
    const a: ActionDef[] = [{ type: "hole", label: "Registrér hul", side: true, tone: "score", group: "Scorekort", fields: [{ key: "hole", label: "Hul", kind: "int", min: 1, max: holes }, { key: "strokes", label: "Slag (uden strafslag)", kind: "int", min: 1, max: 20 }, { key: "penalties", label: "Strafslag", kind: "int", min: 0, max: 10, optional: true }] }];
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};
