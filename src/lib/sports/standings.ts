/** Ranglister: point, målscore, indbyrdes opgør, Buchholz/Sonneborn-Berger m.m. – efter regelsættets tie-break. */
import type { ParticipantResult, StandingRow } from "./types.ts";

export interface PlayedMatch { id: string; results: ParticipantResult[] }

export function computeStandings(participants: { id: string; name: string }[], matches: PlayedMatch[], tiebreak = "points,diff,for,h2h"): StandingRow[] {
  const rows = new Map<string, StandingRow & { best: number; opps: string[]; beat: string[]; drew: string[] }>();
  for (const p of participants) rows.set(p.id, { id: p.id, name: p.name, played: 0, won: 0, drawn: 0, lost: 0, scoreFor: 0, scoreAgainst: 0, points: 0, extra: {}, best: Infinity, opps: [], beat: [], drew: [] });
  for (const m of matches) {
    for (const r of m.results) {
      const row = rows.get(r.id);
      if (!row) continue;
      row.played += 1;
      if (r.outcome === "W") row.won += 1;
      if (r.outcome === "D") row.drawn += 1;
      if (r.outcome === "L") row.lost += 1;
      row.scoreFor += r.scoreFor;
      row.scoreAgainst += r.scoreAgainst;
      row.points += r.points;
      if (r.place) row.best = Math.min(row.best, r.place);
      for (const [k, v] of Object.entries(r.extra ?? {})) row.extra[k] = (row.extra[k] ?? 0) + v;
      if (m.results.length === 2) {
        const opp = m.results.find((x) => x.id !== r.id);
        if (opp) {
          row.opps.push(opp.id);
          if (r.outcome === "W") row.beat.push(opp.id);
          if (r.outcome === "D") row.drew.push(opp.id);
        }
      }
    }
  }
  const all = [...rows.values()];
  const pts = (id: string) => rows.get(id)?.points ?? 0;
  const keys = tiebreak.split(",").map((k) => k.trim()).filter(Boolean);
  const val = (row: (typeof all)[number], k: string): number => {
    switch (k) {
      case "points": return row.points;
      case "diff": return row.scoreFor - row.scoreAgainst;
      case "for": return row.scoreFor;
      case "wins": return row.won;
      case "ratio": return row.scoreAgainst ? row.scoreFor / row.scoreAgainst : row.scoreFor ? 1e9 : 0;
      case "pratio": { const f = row.extra.pointsFor ?? 0, a = row.extra.pointsAgainst ?? 0; return a ? f / a : f ? 1e9 : 0; }
      case "buchholz": return row.opps.reduce((s, o) => s + pts(o), 0);
      case "sb": return row.beat.reduce((s, o) => s + pts(o), 0) + row.drew.reduce((s, o) => s + pts(o) / 2, 0);
      case "podiums": return row.extra.podiums ?? 0;
      case "best": return Number.isFinite(row.best) ? -row.best : -1e9;
      default: return 0;
    }
  };
  // indbyrdes opgør: mini-tabel blandt de deltagere, der står lige indtil h2h-nøglen
  const h2h = (group: string[]): Map<string, number> => {
    const set = new Set(group), score = new Map<string, number>();
    group.forEach((g) => score.set(g, 0));
    for (const m of matches) {
      if (m.results.length !== 2 || !m.results.every((r) => set.has(r.id))) continue;
      for (const r of m.results) score.set(r.id, (score.get(r.id) ?? 0) + r.points * 1000 + (r.scoreFor - r.scoreAgainst));
    }
    return score;
  };
  const sortBy = (list: typeof all, ki: number): typeof all => {
    if (ki >= keys.length || list.length <= 1) return list.sort((a, b) => a.name.localeCompare(b.name, "da"));
    const k = keys[ki];
    let score: (r: (typeof all)[number]) => number;
    if (k === "h2h") { const s = h2h(list.map((r) => r.id)); score = (r) => s.get(r.id) ?? 0; }
    else score = (r) => val(r, k);
    const groups = new Map<number, typeof all>();
    for (const r of list) { const v = score(r); groups.set(v, [...(groups.get(v) ?? []), r]); }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]).flatMap(([, g]) => sortBy(g, ki + 1));
  };
  const sorted = sortBy(all, 0);
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.place = prev && keys.every((k) => k === "h2h" || val(prev, k) === val(r, k)) ? prev.place : i + 1;
  });
  return sorted.map((r) => ({ id: r.id, name: r.name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst, points: r.points, place: r.place, extra: { ...r.extra, buchholz: val(r, "buchholz"), sb: val(r, "sb") } }));
}

/** Alle-mod-alle (cirkelmetoden). Returnerer runder med par af deltager-id'er. */
export function roundRobin(ids: string[], double = false): [string, string][][] {
  const list = ids.slice();
  if (list.length % 2) list.push("__bye__");
  const n = list.length, rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a !== "__bye__" && b !== "__bye__") pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  return double ? [...rounds, ...rounds.map((r) => r.map(([a, b]) => [b, a] as [string, string]))] : rounds;
}

/** Puljer: fordel deltagere i N puljer (slangefordeling efter seedning). */
export function groupsOf(ids: string[], groups: number): string[][] {
  const out: string[][] = Array.from({ length: Math.max(1, groups) }, () => []);
  ids.forEach((id, i) => {
    const round = Math.floor(i / out.length), pos = i % out.length;
    out[round % 2 === 0 ? pos : out.length - 1 - pos].push(id);
  });
  return out;
}

/** Knockout: første runde med byes til de højest seedede. */
export function knockoutFirstRound(ids: string[]): { pairs: [string, string | null][]; size: number } {
  let size = 1;
  while (size < ids.length) size *= 2;
  const seeds = seedOrder(size);
  const slot = (i: number) => ids[seeds[i] - 1] ?? null;
  const pairs: [string, string | null][] = [];
  for (let i = 0; i < size; i += 2) {
    const a = slot(i), b = slot(i + 1);
    if (a) pairs.push([a, b]);
    else if (b) pairs.push([b, null]);
  }
  return { pairs, size };
}
function seedOrder(size: number): number[] {
  let o = [1];
  while (o.length < size) {
    const m = o.length * 2 + 1;
    o = o.flatMap((s) => [s, m - s]);
  }
  return o;
}

export const ROUND_NAME = (matchesInRound: number) => (matchesInRound === 1 ? "Finale" : matchesInRound === 2 ? "Semifinale" : matchesInRound === 4 ? "Kvartfinale" : matchesInRound === 8 ? "1/8-finale" : `Runde med ${matchesInRound} kampe`);
