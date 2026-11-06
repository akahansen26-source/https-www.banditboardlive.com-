/** Atletik: spring og kast med forsøg (længde/kast), højde/stang med overliggerhøjder, og mangekamp. */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent, ParticipantResult } from "../types.ts";
import { decideSpecial, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, str, table } from "../common.ts";

export function replayAttempts(ctx: MatchCtx, events: MatchEvent[]) {
  const ids = ctx.participants.map((p) => p.id);
  const mode = str(ctx.rules, "mode", "distance");
  const tries: Record<string, { value: number | null; valid: boolean; height?: number }[]> = Object.fromEntries(ids.map((i) => [i, []]));
  const disc: Record<string, { name: string; points: number; mark: string }[]> = Object.fromEntries(ids.map((i) => [i, []]));
  let bar = 0;
  const out = new Set<string>();
  const consecFail: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "penalty" }[] = [];
  const unit = str(ctx.rules, "unit", "m");
  for (const e of live(events)) {
    const side = e.side ?? "";
    if (e.type === "bar") { bar = Number(e.data?.height) || bar; feed.push({ seq: e.seq, kind: "info", text: `Overlægger: ${bar.toFixed(2)} ${unit}` }); }
    if (e.type === "attempt" && tries[side]) {
      if (mode === "height") {
        const ok = Boolean(e.data?.cleared);
        tries[side].push({ value: ok ? bar : null, valid: ok, height: bar });
        consecFail[side] = ok ? 0 : consecFail[side] + 1;
        if (consecFail[side] >= 3) out.add(side);
        feed.push({ seq: e.seq, side, kind: ok ? "score" : "penalty", text: `${nameOf(ctx, side)}: ${bar.toFixed(2)} ${ok ? "O" : "X"}` });
      } else {
        const valid = e.data?.valid !== false;
        const v = valid ? Number(e.data?.value) : null;
        tries[side].push({ value: v, valid });
        feed.push({ seq: e.seq, side, kind: valid ? "score" : "penalty", text: `${nameOf(ctx, side)}: forsøg ${tries[side].length} – ${valid ? `${Number(v).toFixed(2)} ${unit}` : "ugyldigt (X)"}` });
      }
    }
    if (e.type === "discipline" && disc[side]) {
      const pts = Math.round(Number(e.data?.points) || 0);
      disc[side].push({ name: String(e.data?.name ?? "Disciplin"), points: pts, mark: String(e.data?.mark ?? "") });
      feed.push({ seq: e.seq, side, kind: "score", text: `${nameOf(ctx, side)}: ${e.data?.name ?? "Disciplin"} ${e.data?.mark ?? ""} = ${pts} point` });
    }
  }
  const best = (id: string) => {
    if (mode === "points") return disc[id].reduce((s, d) => s + d.points, 0);
    const v = tries[id].filter((t) => t.valid && t.value !== null).map((t) => t.value as number);
    return v.length ? Math.max(...v) : -1;
  };
  const sortedVals = (id: string) => tries[id].filter((t) => t.valid && t.value !== null).map((t) => t.value as number).sort((a, b) => b - a);
  const failsAt = (id: string, h: number) => tries[id].filter((t) => t.height === h && !t.valid).length;
  const totalFails = (id: string) => tries[id].filter((t) => !t.valid).length;
  const cmp = (a: string, b: string) => {
    const d = best(b) - best(a);
    if (d !== 0) return d;
    if (mode === "height") {
      const h = best(a);
      const f = failsAt(a, h) - failsAt(b, h);
      if (f !== 0) return f;
      return totalFails(a) - totalFails(b);
    }
    if (mode === "distance") {
      const sa = sortedVals(a), sb = sortedVals(b);
      for (let i = 1; i < Math.max(sa.length, sb.length); i++) { const x = (sb[i] ?? -1) - (sa[i] ?? -1); if (x !== 0) return x; }
    }
    return 0;
  };
  const order = ids.slice().sort(cmp);
  const place: Record<string, number> = {};
  order.forEach((id, i) => (place[id] = i > 0 && cmp(order[i - 1], id) === 0 ? place[order[i - 1]] : i + 1));
  return { mode, tries, disc, bar, out, order, place, best, feed, unit };
}

export const attempts: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayAttempts(ctx, events);
    out.status = L.status;
    out.phase = statusLabel(L, r.mode === "height" ? `Højde ${r.bar ? r.bar.toFixed(2) : "–"} ${r.unit}` : r.mode === "points" ? "Mangekamp" : `Højst ${num(ctx.rules, "attempts", 3)} forsøg`);
    out.scores = r.order.map((id) => {
      const b = r.best(id);
      return {
        id,
        name: nameOf(ctx, id),
        main: r.mode === "points" ? `${b} p` : b >= 0 ? `${b.toFixed(2)} ${r.unit}` : "NM",
        sub: r.mode === "points" ? `${r.disc[id].length} discipliner` : r.mode === "height" ? r.tries[id].map((t) => (t.valid ? "O" : "X")).join("") : r.tries[id].map((t) => (t.valid ? (t.value as number).toFixed(2) : "X")).join(" · "),
        place: r.place[id],
        out: r.out.has(id),
      };
    });
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    if (out.status === "finished") {
      out.winnerId = r.order[0] ?? null;
      out.resultType = "Bedste resultat";
      const tab = table(ctx.rules, "placePoints");
      out.results = r.order.map<ParticipantResult>((id) => ({ id, place: r.place[id], scoreFor: Math.max(0, r.best(id)), scoreAgainst: 0, points: tab[r.place[id] - 1] ?? 0, outcome: r.place[id] === 1 ? "W" : "L" }));
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayAttempts(ctx, events);
    if (ev.type === "attempt") {
      if (!ev.side || !r.tries[ev.side]) return "Vælg deltager.";
      if (r.mode === "points") return "Mangekamp registreres pr. disciplin.";
      if (r.mode === "height") {
        if (!r.bar) return "Sæt overliggerhøjden først.";
        if (r.out.has(ev.side)) return `${nameOf(ctx, ev.side)} er ude efter tre fejlforsøg i træk.`;
        if (r.tries[ev.side].some((t) => t.height === r.bar && t.valid)) return `${nameOf(ctx, ev.side)} har allerede klaret ${r.bar.toFixed(2)}.`;
      } else {
        const max = num(ctx.rules, "attempts", 3);
        if (r.tries[ev.side].length >= max) return `${nameOf(ctx, ev.side)} har brugt alle ${max} forsøg.`;
        if (ev.data?.valid !== false) {
          const v = Number(ev.data?.value);
          if (!Number.isFinite(v) || v <= 0 || v > 200) return `Skriv resultatet i ${r.unit} (fx 6.45).`;
        }
      }
    }
    if (ev.type === "bar") {
      const h = Number(ev.data?.height);
      if (!Number.isFinite(h) || h <= 0) return "Skriv højden.";
      if (h <= r.bar) return "Overliggeren må kun hæves.";
    }
    if (ev.type === "discipline") {
      if (!ev.side) return "Vælg deltager.";
      const p = Number(ev.data?.points);
      if (!Number.isInteger(p) || p < 0 || p > 2000) return "Point skal være et helt tal (0–2000) fra den officielle pointtabel.";
    }
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const mode = str(ctx.rules, "mode", "distance");
    const a: ActionDef[] = [];
    if (mode === "distance") {
      a.push({ type: "attempt", label: "Gyldigt forsøg", side: true, tone: "score", group: "Forsøg", preset: { valid: true }, fields: [{ key: "value", label: `Resultat (${str(ctx.rules, "unit", "m")})`, kind: "decimal" }] });
      a.push({ type: "attempt", label: "Ugyldigt forsøg (X)", side: true, tone: "penalty", group: "Forsøg", preset: { valid: false } });
    } else if (mode === "height") {
      a.push({ type: "bar", label: "Sæt overliggerhøjde", tone: "control", group: "Overligger", fields: [{ key: "height", label: "Højde (m)", kind: "decimal" }] });
      a.push({ type: "attempt", label: "Klaret (O)", side: true, tone: "score", group: "Forsøg", preset: { cleared: true } });
      a.push({ type: "attempt", label: "Fejlforsøg (X)", side: true, tone: "penalty", group: "Forsøg", preset: { cleared: false } });
    } else {
      a.push({ type: "discipline", label: "Registrér disciplin", side: true, tone: "score", group: "Discipliner", fields: [{ key: "name", label: "Disciplin", kind: "text" }, { key: "mark", label: "Resultat", kind: "text", optional: true }, { key: "points", label: "Point (fra officiel tabel)", kind: "int", min: 0, max: 2000 }] });
    }
    return [...lifeActions(L, { periods: 1, noClock: true }), ...a];
  },
};
