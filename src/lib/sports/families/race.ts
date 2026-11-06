/**
 * Tidskonkurrencer: motorsport, cykling, løb (atletik) og svømning.
 * Omgangstider eller sluttider indtastes manuelt (der er ingen automatisk tidtagning tilsluttet).
 * Straffe har status (foreslået → godkendt/afsonet/annulleret) og tæller kun én gang:
 * en tidsstraf lægges til tiden, en placeringsstraf flytter placeringen – aldrig begge for samme straf.
 */
import type { ActionDef, FamilyModule, MatchCtx, MatchEvent, ParticipantResult } from "../types.ts";
import { bool, clockOf, decideSpecial, emptySummary, lifeActions, lifecycle, lifeValidate, live, nameOf, num, statusLabel, str, table } from "../common.ts";

export type PenaltyKind = "time" | "drive_through" | "stop_go" | "penalty_lap" | "positions" | "lap_time" | "dq" | "warning" | "points";
export const PENALTY_LABEL: Record<PenaltyKind, string> = {
  time: "Tidsstraf (sek.)",
  drive_through: "Drive-through",
  stop_go: "Stop-and-go",
  penalty_lap: "Strafomgang",
  positions: "Placeringstab",
  lap_time: "Tilføjet omgangstid (sek.)",
  dq: "Diskvalifikation",
  warning: "Advarsel",
  points: "Strafpoint (rangliste)",
};

export interface Penalty { id: string; seq: number; side: string; kind: PenaltyKind; value: number; reason: string; status: "proposed" | "approved" | "served" | "annulled"; byName?: string; at: number }

export function fmtTime(ms: number, precision = "ms"): string {
  if (!Number.isFinite(ms)) return "–";
  const neg = ms < 0;
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), f = ms % 1000;
  const frac = precision === "tenths" ? `.${Math.floor(f / 100)}` : precision === "hundredths" ? `.${String(Math.floor(f / 10)).padStart(2, "0")}` : `.${String(Math.round(f)).padStart(3, "0")}`;
  const core = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : m ? `${m}:${String(s).padStart(2, "0")}` : `${s}`;
  return `${neg ? "-" : ""}${core}${frac}`;
}

export function replayRace(ctx: MatchCtx, events: MatchEvent[], now: number) {
  const ids = ctx.participants.map((p) => p.id);
  const laps: Record<string, number[]> = Object.fromEntries(ids.map((i) => [i, []]));
  const finish: Record<string, number | undefined> = {};
  const state: Record<string, "" | "dnf" | "dns" | "dsq"> = Object.fromEntries(ids.map((i) => [i, ""]));
  const reason: Record<string, string> = {};
  const falseStarts: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const pens: Penalty[] = [];
  let grid: string[] = [];
  let pole: string | undefined;
  const feed: { seq: number; text: string; side?: string; kind?: "score" | "info" | "penalty" }[] = [];
  const L0 = { period: 0, el: 0, since: null as number | null };
  for (const e of live(events)) {
    if (e.type === "start") { L0.period = 1; L0.since = e.at; }
    if (e.type === "pause" && L0.since !== null) { L0.el += e.at - L0.since; L0.since = null; }
    if (e.type === "resume") L0.since = e.at;
    const side = e.side ?? "";
    switch (e.type) {
      case "grid": grid = (Array.isArray(e.data?.order) ? (e.data!.order as string[]) : []).filter((x) => ids.includes(x)); break;
      case "pole": pole = side; feed.push({ seq: e.seq, side, kind: "info", text: `Pole position: ${nameOf(ctx, side)}` }); break;
      case "lap": {
        const ms = Math.round(Number(e.data?.ms) || 0);
        if (ms > 0 && laps[side]) { laps[side].push(ms); feed.push({ seq: e.seq, side, kind: "info", text: `${nameOf(ctx, side)}: omgang ${laps[side].length} – ${fmtTime(ms, str(ctx.rules, "precision", "ms"))}` }); }
        break;
      }
      case "cross": {
        const el = L0.el + (L0.since !== null ? e.at - L0.since : 0);
        finish[side] = el;
        feed.push({ seq: e.seq, side, kind: "score", text: `${nameOf(ctx, side)} i mål: ${fmtTime(el, str(ctx.rules, "precision", "ms"))}` });
        break;
      }
      case "finish_time": {
        const ms = Math.round(Number(e.data?.ms) || 0);
        finish[side] = ms;
        feed.push({ seq: e.seq, side, kind: "score", text: `${nameOf(ctx, side)}: sluttid ${fmtTime(ms, str(ctx.rules, "precision", "ms"))}` });
        break;
      }
      case "status": {
        const v = String(e.data?.value ?? "") as "dnf" | "dns" | "dsq" | "";
        state[side] = v;
        reason[side] = String(e.data?.reason ?? "");
        feed.push({ seq: e.seq, side, kind: "penalty", text: `${nameOf(ctx, side)}: ${{ dnf: "udgået (DNF)", dns: "ikke startet (DNS)", dsq: "diskvalificeret (DSQ)", "": "status nulstillet" }[v]}${reason[side] ? ` – ${reason[side]}` : ""}` });
        break;
      }
      case "false_start": {
        falseStarts[side] += 1;
        const dq = bool(ctx.rules, "falseStartDQ", true) || falseStarts[side] >= 2;
        feed.push({ seq: e.seq, side, kind: "penalty", text: `Tyvstart – ${nameOf(ctx, side)}${dq ? " · diskvalificeret" : " · advarsel"}` });
        if (dq) { state[side] = "dsq"; reason[side] = "tyvstart"; }
        break;
      }
      case "penalty": {
        const kind = String(e.data?.kind ?? "time") as PenaltyKind;
        const needApproval = bool(ctx.rules, "penaltyApproval", true);
        pens.push({ id: e.id, seq: e.seq, side, kind, value: Number(e.data?.value) || 0, reason: String(e.data?.reason ?? ""), status: needApproval ? "proposed" : "approved", byName: e.byName, at: e.at });
        feed.push({ seq: e.seq, side, kind: "penalty", text: `Straf ${needApproval ? "foreslået" : "givet"}: ${PENALTY_LABEL[kind] ?? kind}${Number(e.data?.value) ? ` ${e.data?.value}` : ""} – ${nameOf(ctx, side)}${e.data?.reason ? ` (${e.data.reason})` : ""}` });
        break;
      }
      case "penalty_status": {
        const p = pens.find((x) => x.id === e.data?.ref);
        if (p) {
          p.status = String(e.data?.status) as Penalty["status"];
          feed.push({ seq: e.seq, side: p.side, kind: "penalty", text: `Straf ${{ approved: "godkendt", served: "afsonet", annulled: "annulleret", proposed: "foreslået" }[p.status]}: ${PENALTY_LABEL[p.kind]} – ${nameOf(ctx, p.side)}` });
        }
        break;
      }
    }
  }
  const lapsRule = num(ctx.rules, "laps", 0);
  const unserved = num(ctx.rules, "unservedSec", 30);
  const active = (p: Penalty) => p.status === "approved" || p.status === "served";
  const rows = ids.map((id) => {
    const ps = pens.filter((p) => p.side === id && active(p));
    let addMs = 0, posLoss = 0, stdPts = 0;
    for (const p of ps) {
      if (p.kind === "time" || p.kind === "lap_time") addMs += p.value * 1000;
      if ((p.kind === "drive_through" || p.kind === "stop_go") && p.status === "approved") addMs += unserved * 1000; // ikke afsonet før mål
      if (p.kind === "penalty_lap" && p.status === "approved") addMs += num(ctx.rules, "penaltyLapSec", 0) * 1000;
      if (p.kind === "positions") posLoss += p.value;
      if (p.kind === "points") stdPts += p.value;
    }
    const dq = ps.some((p) => p.kind === "dq") || state[id] === "dsq";
    const lapsDone = finish[id] !== undefined && laps[id].length === 0 ? Math.max(lapsRule, 1) : laps[id].length;
    const raw = finish[id] ?? (laps[id].length ? laps[id].reduce((s, x) => s + x, 0) : undefined);
    const done = finish[id] !== undefined || (lapsRule > 0 && laps[id].length >= lapsRule);
    return { id, lapsDone, raw, total: raw === undefined ? undefined : raw + addMs, addMs, posLoss, stdPts, best: laps[id].length ? Math.min(...laps[id]) : undefined, st: dq ? "dsq" : state[id], done };
  });
  const rank = (s: string) => (s === "" ? 0 : s === "dnf" ? 1 : s === "dns" ? 2 : 3);
  let order = rows.slice().sort((a, b) => {
    const ra = a.st === "" && !a.done ? 0 : 0;
    void ra;
    if (rank(a.st) !== rank(b.st)) return rank(a.st) - rank(b.st);
    if (b.lapsDone !== a.lapsDone) return b.lapsDone - a.lapsDone;
    return (a.total ?? Infinity) - (b.total ?? Infinity);
  });
  // placeringstab flytter kun placeringen (efter tidsberegningen)
  for (const r of rows.filter((x) => x.posLoss > 0 && x.st === "")) {
    const i = order.indexOf(r);
    const classified = order.filter((x) => x.st === "").length;
    const j = Math.min(classified - 1, i + r.posLoss);
    order = [...order.slice(0, i), ...order.slice(i + 1, j + 1), r, ...order.slice(j + 1)];
  }
  const place: Record<string, number> = {};
  order.forEach((r, i) => {
    if (r.st === "dsq" || r.st === "dns") return;
    const prev = order[i - 1];
    place[r.id] = prev && bool(ctx.rules, "tieShared", true) && prev.st === r.st && prev.total === r.total && prev.lapsDone === r.lapsDone && place[prev.id] ? place[prev.id] : i + 1;
  });
  const fastest = rows.filter((r) => r.best !== undefined).sort((a, b) => (a.best ?? 0) - (b.best ?? 0))[0];
  const clockEl = L0.el + (L0.since !== null ? now - L0.since : 0);
  return { rows, order, place, pens, grid, pole, fastest, feed, clockEl, lapsRule };
}

export const race: FamilyModule = {
  summarize(ctx, events, now) {
    const out = emptySummary();
    const L = lifecycle(events, now);
    const r = replayRace(ctx, events, now);
    const prec = str(ctx.rules, "precision", "ms");
    const allIn = r.rows.length > 0 && r.rows.every((x) => x.done || x.st);
    out.status = L.status === "finished" ? "finished" : allIn && L.period > 0 && bool(ctx.rules, "autoFinish", false) ? "finished" : L.status;
    out.phase = statusLabel({ ...L, status: out.status }, r.lapsRule ? `${r.lapsRule} omgange` : "Løb");
    if (L.period > 0) out.clock = clockOf(L, now, 0, "up", 0, "Løbstid");
    const winner = r.order.find((x) => x.st === "" && x.total !== undefined);
    out.scores = r.order.map((x) => ({
      id: x.id,
      name: ctx.participants.find((p) => p.id === x.id)?.name ?? "?",
      main: x.st ? x.st.toUpperCase() : x.total !== undefined ? fmtTime(x.total, prec) : "–",
      sub: [r.lapsRule || x.lapsDone ? `${x.lapsDone}${r.lapsRule ? `/${r.lapsRule}` : ""} omg.` : "", winner && x !== winner && x.total !== undefined && x.st === "" ? (x.lapsDone < winner.lapsDone ? `+${winner.lapsDone - x.lapsDone} omg.` : `+${fmtTime(x.total - (winner.total ?? 0), prec)}`) : ""].filter(Boolean).join(" · "),
      detail: [x.best ? `Bedste omgang ${fmtTime(x.best, prec)}` : "", x.addMs ? `Tidsstraf +${x.addMs / 1000} s` : "", x.posLoss ? `Placeringstab ${x.posLoss}` : ""].filter(Boolean),
      place: r.place[x.id],
      out: Boolean(x.st),
    }));
    if (r.fastest?.best) out.info.push(`Hurtigste omgang: ${nameOf(ctx, r.fastest.id)} ${fmtTime(r.fastest.best, prec)}`);
    const proposed = r.pens.filter((p) => p.status === "proposed");
    if (proposed.length) out.warnings.push(`${proposed.length} straf(fe) venter på godkendelse`);
    out.info.push("Tidtagning: manuel indtastning");
    out.feed = r.feed.slice().reverse();
    const special = decideSpecial(ctx, L);
    if (special && ctx.participants.length === 2) { out.winnerId = special.winnerId; out.resultType = special.resultType; }
    if (out.status === "finished") {
      out.winnerId = out.winnerId ?? winner?.id ?? null;
      out.resultType = out.resultType || "Klassifikation";
      const tab = table(ctx.rules, "placePoints");
      const topN = num(ctx.rules, "fastestLapTopN", 10);
      out.results = r.rows.map<ParticipantResult>((x) => {
        const pl = r.place[x.id];
        let pts = x.st === "" && pl ? tab[pl - 1] ?? 0 : 0;
        if (bool(ctx.rules, "bonusFastestLap", false) && r.fastest?.id === x.id && pl && (topN === 0 || pl <= topN)) pts += num(ctx.rules, "fastestLapPoints", 1);
        if (bool(ctx.rules, "bonusPole", false) && r.pole === x.id) pts += num(ctx.rules, "polePoints", 1);
        pts -= x.stdPts;
        return { id: x.id, place: pl, scoreFor: x.total ?? 0, scoreAgainst: 0, points: pts, outcome: pl === 1 ? "W" : "L", extra: { wins: pl === 1 ? 1 : 0, podiums: pl && pl <= 3 ? 1 : 0, dnf: x.st === "dnf" ? 1 : 0, fastest: r.fastest?.id === x.id ? 1 : 0 } };
      });
    }
    return out;
  },
  validate(ctx, events, ev) {
    const L = lifecycle(events, ev.at);
    const life = lifeValidate(L, ev);
    if (life) return life;
    const r = replayRace(ctx, events, ev.at);
    const needSide = ["lap", "cross", "finish_time", "status", "penalty", "false_start", "pole"];
    if (needSide.includes(ev.type) && (!ev.side || !ctx.participants.some((p) => p.id === ev.side))) return "Vælg deltager.";
    const row = r.rows.find((x) => x.id === ev.side);
    if (ev.type === "lap") {
      const ms = Number(ev.data?.ms);
      if (!Number.isFinite(ms) || ms <= 0) return "Skriv en gyldig omgangstid.";
      if (row?.st) return `${nameOf(ctx, ev.side)} er ${row.st.toUpperCase()}.`;
      if (r.lapsRule && row && row.lapsDone >= r.lapsRule) return `${nameOf(ctx, ev.side)} har allerede kørt alle ${r.lapsRule} omgange.`;
    }
    if (ev.type === "finish_time") {
      const ms = Number(ev.data?.ms);
      if (!Number.isFinite(ms) || ms <= 0) return "Skriv en gyldig sluttid.";
    }
    if (ev.type === "cross" && L.period === 0) return "Start løbet først – målgang bruger løbsuret.";
    if (ev.type === "penalty") {
      const k = String(ev.data?.kind ?? "");
      if (!(k in PENALTY_LABEL)) return "Vælg straftype.";
      const v = Number(ev.data?.value ?? 0);
      if (["time", "lap_time", "positions", "points"].includes(k) && (!Number.isFinite(v) || v <= 0)) return "Skriv en strafværdi større end 0.";
      if (!String(ev.data?.reason ?? "").trim()) return "Skriv årsagen til straffen.";
    }
    if (ev.type === "penalty_status") {
      const p = r.pens.find((x) => x.id === ev.data?.ref);
      if (!p) return "Straffen findes ikke.";
      if (!["approved", "served", "annulled"].includes(String(ev.data?.status))) return "Ugyldig status.";
    }
    return null;
  },
  actions(ctx, events, now) {
    const L = lifecycle(events, now);
    const r = replayRace(ctx, events, now);
    const disc = (ctx.sport.spec?.penalties as PenaltyKind[] | undefined) ?? ["time", "positions", "dq", "warning", "points"];
    const a: ActionDef[] = [
      { type: "lap", label: "Omgangstid", side: true, tone: "score", group: "Tider", fields: [{ key: "ms", label: "Tid", kind: "time" }] },
      { type: "cross", label: "I mål nu (løbsuret)", side: true, tone: "score", group: "Tider" },
      { type: "finish_time", label: "Indtast sluttid", side: true, tone: "score", group: "Tider", fields: [{ key: "ms", label: "Sluttid", kind: "time" }] },
      { type: "status", label: "DNF / DNS / DSQ", side: true, tone: "danger", group: "Status", fields: [{ key: "value", label: "Status", kind: "choice", options: [{ value: "dnf", label: "Udgået (DNF)" }, { value: "dns", label: "Ikke startet (DNS)" }, { value: "dsq", label: "Diskvalificeret (DSQ)" }, { value: "", label: "Nulstil status" }] }, { key: "reason", label: "Årsag", kind: "text", optional: true }] },
      { type: "penalty", label: "Straf", side: true, tone: "penalty", group: "Straffe", fields: [{ key: "kind", label: "Type", kind: "choice", options: disc.map((k) => ({ value: k, label: PENALTY_LABEL[k] })) }, { key: "value", label: "Værdi (sek./placeringer/point)", kind: "decimal", optional: true }, { key: "reason", label: "Årsag", kind: "text" }] },
    ];
    if (ctx.sport.spec?.falseStart) a.push({ type: "false_start", label: "Tyvstart", side: true, tone: "penalty", group: "Straffe" });
    if (bool(ctx.rules, "bonusPole", false)) a.push({ type: "pole", label: "Pole position", side: true, tone: "info", group: "Start" });
    for (const p of r.pens.filter((x) => x.status === "proposed" || x.status === "approved")) {
      const label = `${PENALTY_LABEL[p.kind]} – ${nameOf(ctx, p.side)}`;
      if (p.status === "proposed") a.push({ type: "penalty_status", label: `Godkend: ${label}`, tone: "control", group: "Strafafgørelser", preset: { ref: p.id, status: "approved" } });
      if (p.status === "approved" && (p.kind === "drive_through" || p.kind === "stop_go" || p.kind === "penalty_lap")) a.push({ type: "penalty_status", label: `Afsonet: ${label}`, tone: "control", group: "Strafafgørelser", preset: { ref: p.id, status: "served" } });
      a.push({ type: "penalty_status", label: `Annullér: ${label}`, tone: "danger", group: "Strafafgørelser", preset: { ref: p.id, status: "annulled" } });
    }
    return [...lifeActions(L, { periods: 1 }), ...a];
  },
};
