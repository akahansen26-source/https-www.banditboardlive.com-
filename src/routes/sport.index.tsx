import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getSportsOverview } from "@/lib/sports/api";
import { SPORTS, SPORT_GROUPS } from "@/lib/sports/catalog";
import { Badge, btnGhost, btnPrimary } from "@/components/sports/match-ui";
import { hasPermission, type UserRole } from "@/lib/roles";

export const Route = createFileRoute("/sport/")({ component: SportHome });

type Overview = Awaited<ReturnType<typeof getSportsOverview>>;
const STATUS: Record<string, string> = { scheduled: "Ikke startet", live: "Live", paused: "Pause", break: "Pause", finished: "Slut", abandoned: "Afbrudt", postponed: "Udsat" };

function SportHome() {
  const { user, isPending } = useCurrentUserState();
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!user) return;
    getSportsOverview().then(setOv).catch((e: Error) => setErr(e.message));
  }, [user]);
  const role = (ov?.role ?? "gaest") as UserRole;
  const canRun = hasPermission(role, "EDIT_MATCH");
  const list = SPORTS.filter((s) => !q || `${s.name} ${s.blurb} ${s.group}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10">
        <header className="flex flex-wrap items-end gap-4">
          <div className="mr-auto">
            <p className="font-display text-lg tracking-widest text-primary">SPORTSGRENE OG REGLER</p>
            <h1 className="font-display text-5xl sm:text-6xl">Kontrolpanel</h1>
            <p className="mt-2 max-w-2xl text-muted">Vælg sportsgren, tilpas reglerne, test dem og start en kamp eller turnering. Hver sport har sit eget regelsæt og sin egen beregning.</p>
          </div>
          {canRun ? (
            <div className="flex flex-wrap gap-2">
              <Link to="/kamp/ny" className={btnPrimary}>Ny kamp</Link>
              <Link to="/kamp/ny" search={{ turnering: 1 }} className={btnGhost}>Ny turnering</Link>
            </div>
          ) : null}
          <Link to="/resultater" className={btnGhost}>Resultater</Link>
        </header>
        {!isPending && !user ? <p className="rounded-card border border-line bg-surface p-4 text-sm text-muted">Du kan se regelsættene og prøve dem i testtilstand. <Link to="/login" search={{ next: "/sport" }} className="text-primary underline">Log ind</Link> for at oprette kampe og turneringer.</p> : null}
        {err ? <p className="text-danger">{err}</p> : null}

        {ov && (ov.matches.length || ov.tournaments.length) ? (
          <section className="grid gap-3">
            <h2 className="font-display text-3xl">Mine kampe og turneringer</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ov.tournaments.map((t) => {
                const s = SPORTS.find((x) => x.id === t.sportId);
                return (
                  <Link key={t.id} to="/turneringer/$id" params={{ id: t.id }} className="grid gap-1 rounded-card border border-line bg-surface p-4 hover:border-primary">
                    <span className="text-sm text-muted">{s?.emoji} {s?.name} · turnering · {t.participants} deltagere</span>
                    <span className="font-display text-2xl">{t.name}</span>
                    <span className="text-xs text-muted">{t.ruleLabel}</span>
                  </Link>
                );
              })}
              {ov.matches.slice(0, 12).map((m) => {
                const s = SPORTS.find((x) => x.id === m.sportId);
                return (
                  <Link key={m.id} to="/kamp/$id" params={{ id: m.id }} className="grid gap-1 rounded-card border border-line bg-surface p-4 hover:border-primary">
                    <span className="flex items-center gap-2 text-sm text-muted">{s?.emoji} {s?.name} <Badge tone={m.status === "live" ? "ok" : m.status === "finished" ? "primary" : "info"}>{STATUS[m.status] ?? m.status}</Badge>{m.status === "finished" && !m.approved ? <Badge tone="warn">Foreløbig</Badge> : null}</span>
                    <span className="font-display text-2xl">{m.title}</span>
                    <span className="text-xs text-muted">{m.summary.scores?.map((x) => `${x.name} ${x.main}`).join(" · ")}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto font-display text-3xl">Vælg sportsgren</h2>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søg sport …" className="min-h-11 rounded-xl border border-line bg-deep px-3" aria-label="Søg sportsgren" />
          </div>
          {SPORT_GROUPS.map((g) => {
            const sports = list.filter((s) => s.group === g);
            if (!sports.length) return null;
            return (
              <div key={g} className="grid gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{g}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sports.map((s) => (
                    <Link key={s.id} to="/sport/$sportId" params={{ sportId: s.id }} className="grid gap-1 rounded-card border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-primary">
                      <span className="text-3xl" aria-hidden="true">{s.emoji}</span>
                      <span className="font-display text-2xl">{s.name}</span>
                      <span className="text-sm text-muted">{s.blurb}</span>
                      <span className="mt-1 text-xs text-muted">Regelkilde: {s.source.body} – {s.source.document}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </SiteShell>
  );
}
