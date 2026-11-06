import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { getPublicSports } from "@/lib/sports/api";
import { SPORTS } from "@/lib/sports/catalog";
import { Badge } from "@/components/sports/match-ui";

export const Route = createFileRoute("/resultater")({
  head: () => ({ meta: [{ title: "Resultater – BanditBoard Live" }, { name: "description", content: "Live-resultater, kampe og turneringsstillinger fra BanditBoard Live." }] }),
  component: Results,
});

type Data = Awaited<ReturnType<typeof getPublicSports>>;

function Results() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [sport, setSport] = useState("");
  useEffect(() => {
    const tick = () => getPublicSports().then(setD).catch((e: Error) => setErr(e.message));
    void tick();
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, []);
  const matches = (d?.matches ?? []).filter((m) => !sport || m.sportId === sport);
  const live = matches.filter((m) => m.status === "live" || m.status === "paused" || m.status === "break");
  const done = matches.filter((m) => !live.includes(m));
  const tours = (d?.tournaments ?? []).filter((t) => !sport || t.sportId === sport);
  const used = [...new Set([...(d?.matches ?? []).map((m) => m.sportId), ...(d?.tournaments ?? []).map((t) => t.sportId)])];
  const card = (m: Data["matches"][number]) => {
    const s = SPORTS.find((x) => x.id === m.sportId);
    return (
      <Link key={m.id} to="/tavle/$id" params={{ id: m.id }} className="grid gap-1 rounded-card border border-line bg-surface p-4 hover:border-primary">
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">{s?.emoji} {s?.name}{m.round ? ` · ${m.round}` : ""}{m.status === "finished" ? m.approved ? <Badge tone="ok">Endeligt</Badge> : <Badge tone="warn">Foreløbigt</Badge> : <Badge tone="ok">Live</Badge>}</span>
        <span className="font-display text-2xl">{m.title}</span>
        <span className="text-sm">{m.summary.scores?.slice(0, 4).map((x) => `${x.name} ${x.main}`).join(" · ")}</span>
      </Link>
    );
  };
  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10">
        <header className="flex flex-wrap items-end gap-3">
          <div className="mr-auto"><p className="font-display text-lg tracking-widest text-primary">OFFENTLIGE RESULTATER</p><h1 className="font-display text-5xl sm:text-6xl">Resultater</h1></div>
          {used.length > 1 ? <select className="min-h-11 rounded-xl border border-line bg-deep px-3" value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Filtrér sportsgren"><option value="">Alle sportsgrene</option>{used.map((id) => <option key={id} value={id}>{SPORTS.find((s) => s.id === id)?.name ?? id}</option>)}</select> : null}
        </header>
        {err ? <p className="text-danger">{err}</p> : null}
        {!d && !err ? <p className="text-muted">Henter …</p> : null}
        {d && !matches.length && !tours.length ? <p className="rounded-card border border-line bg-surface p-6 text-muted">Der er ingen offentlige kampe endnu.</p> : null}
        {live.length ? <section className="grid gap-3"><h2 className="font-display text-3xl">Live nu</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{live.map(card)}</div></section> : null}
        {tours.length ? (
          <section className="grid gap-3"><h2 className="font-display text-3xl">Turneringer</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tours.map((t) => { const s = SPORTS.find((x) => x.id === t.sportId); return (
              <Link key={t.id} to="/turneringer/$id" params={{ id: t.id }} className="grid gap-1 rounded-card border border-line bg-surface p-4 hover:border-primary">
                <span className="text-sm text-muted">{s?.emoji} {s?.name} · {t.participants} deltagere</span><span className="font-display text-2xl">{t.name}</span><span className="text-xs text-muted">{t.ruleLabel}</span>
              </Link>); })}</div>
          </section>
        ) : null}
        {done.length ? <section className="grid gap-3"><h2 className="font-display text-3xl">Seneste kampe</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{done.map(card)}</div></section> : null}
      </div>
    </SiteShell>
  );
}
