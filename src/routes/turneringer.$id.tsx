import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { addSportTournamentRound, deleteSportTournament, getSportTournament } from "@/lib/sports/api";
import { sportById } from "@/lib/sports/engine";
import { Badge, btnGhost, btnPrimary } from "@/components/sports/match-ui";

export const Route = createFileRoute("/turneringer/$id")({ component: TournamentPage });

type T = Awaited<ReturnType<typeof getSportTournament>>;
const STATUS: Record<string, string> = { scheduled: "Ikke spillet", live: "Live", paused: "Pause", break: "Pause", finished: "Slut", abandoned: "Afbrudt", postponed: "Udsat" };
const EXTRA: Record<string, string> = { buchholz: "Buchholz", sb: "SB", wins: "Sejre", podiums: "Podier", dnf: "DNF", fastest: "Hurtigste omg.", pinfall: "Kegler", bonus: "Bonus", tries: "Forsøg" };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const FORMAT: Record<string, string> = { league: "Liga", groups: "Puljer", knockout: "Knockout", individual: "Individuel" };

function TournamentPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => getSportTournament({ data: { id } }).then(setT).catch((e: Error) => setErr(e.message)), [id]);
  useEffect(() => {
    void load();
    const i = setInterval(() => void load(), 8000);
    return () => clearInterval(i);
  }, [load]);

  if (!t) return <SiteShell><div className="mx-auto max-w-3xl px-4 py-16">{err ? <p className="text-danger">{err}</p> : <p className="text-muted">Henter turnering …</p>}</div></SiteShell>;
  const sport = sportById(t.sportId)!;
  const rounds = [...new Set(t.matches.map((m) => m.round))];
  const showStandings = t.format !== "knockout";
  const tb = String(t.rules.tiebreak ?? "");
  const extraKeys = [...new Set(t.standings.flatMap((g) => g.rows.flatMap((r) => Object.keys(r.extra ?? {}))))]
    .filter((k) => (k === "buchholz" || k === "sb" ? tb.includes(k) : t.standings.some((g) => g.rows.some((r) => (r.extra?.[k] ?? 0) !== 0))))
    .slice(0, 4);

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
        <header className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <Link to={t.can.owner ? "/sport" : "/resultater"} className="text-sm text-muted hover:text-fg">← {t.can.owner ? "Kontrolpanel" : "Resultater"}</Link>
            <h1 className="font-display text-4xl sm:text-5xl">{sport.emoji} {t.name}</h1>
            <p className="text-sm text-muted">{sport.name} · {FORMAT[t.format] ?? t.format} · {t.participants} deltagere · {t.ruleLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {t.can.edit && sport.shape === "field" && t.format === "league" ? <button type="button" className={btnPrimary} onClick={() => void addSportTournamentRound({ data: { id: t.id } }).then(load).catch((e: Error) => setErr(e.message))}>+ Ny afdeling</button> : null}
            {t.can.delete ? <button type="button" className={`${btnGhost} text-danger`} onClick={() => { if (window.confirm("Arkivér turneringen? Den forsvinder fra oversigterne.")) void deleteSportTournament({ data: { id: t.id } }).then(() => navigate({ to: "/sport" })).catch((e: Error) => setErr(e.message)); }}>Arkivér</button> : null}
          </div>
        </header>
        {err ? <p className="text-danger">{err}</p> : null}

        {showStandings ? t.standings.map((g) => (
          <section key={g.group || "all"} className="grid gap-2">
            <h2 className="flex items-center gap-2 font-display text-3xl">{g.group || "Stilling"}{g.provisional ? <Badge tone="warn">Indeholder foreløbige resultater</Badge> : null}</h2>
            <div className="overflow-x-auto rounded-card border border-line bg-surface">
              <table className="w-full min-w-[32rem] text-sm">
                <thead><tr className="text-left text-muted"><th className="p-2">#</th><th className="p-2">Navn</th><th className="p-2">K</th>{sport.shape !== "field" ? <><th className="p-2">V</th><th className="p-2">U</th><th className="p-2">T</th></> : null}<th className="p-2">{cap(sport.scoreWord ?? "score")}</th>{extraKeys.map((k) => <th key={k} className="p-2">{EXTRA[k] ?? cap(k)}</th>)}<th className="p-2">Point</th></tr></thead>
                <tbody>{g.rows.map((r, i) => (
                  <tr key={r.id} className="border-t border-line"><td className="p-2">{r.place ?? i + 1}</td><td className="p-2 font-semibold">{r.name}</td><td className="p-2">{r.played}</td>{sport.shape !== "field" ? <><td className="p-2">{r.won}</td><td className="p-2">{r.drawn}</td><td className="p-2">{r.lost}</td></> : null}<td className="p-2">{sport.shape === "field" ? r.scoreFor : `${r.scoreFor}–${r.scoreAgainst}`}</td>{extraKeys.map((k) => <td key={k} className="p-2">{r.extra?.[k] ?? 0}</td>)}<td className="p-2 font-display text-lg">{r.points}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )) : null}

        <section className="grid gap-4">
          <h2 className="font-display text-3xl">{t.format === "knockout" ? "Kampprogram" : "Kampe"}</h2>
          {rounds.map((r) => (
            <div key={r} className="grid gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{r}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {t.matches.filter((m) => m.round === r).map((m) => {
                  const waiting = m.summary.scores?.some((s) => s.id.startsWith("tbd"));
                  const body = (
                    <>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">{m.group ? `${m.group} · ` : ""}{STATUS[m.status] ?? m.status}{m.status === "finished" && !m.approved ? <Badge tone="warn">Foreløbig</Badge> : null}</span>
                      <span className="font-semibold">{m.title}</span>
                      <span className="text-sm">{m.status === "scheduled" ? (waiting ? (m.summary.scores?.filter((x) => !x.id.startsWith("tbd")).map((x) => `${x.name} møder vinderen fra forrige runde`).join("") || "Afventer vindere fra forrige runde") : m.summary.scores?.map((x) => x.name).join(" – ") || "–") : m.summary.scores?.slice(0, 4).map((x) => `${x.name} ${x.main}`).join(" · ")}</span>
                    </>
                  );
                  return t.can.owner
                    ? <Link key={m.id} to="/kamp/$id" params={{ id: m.id }} className="grid gap-1 rounded-xl border border-line bg-surface p-3 hover:border-primary">{body}</Link>
                    : <Link key={m.id} to="/tavle/$id" params={{ id: m.id }} className="grid gap-1 rounded-xl border border-line bg-surface p-3 hover:border-primary">{body}</Link>;
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </SiteShell>
  );
}
