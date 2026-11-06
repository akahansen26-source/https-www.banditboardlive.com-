import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { approveSportMatch, deleteSportMatch, fetchMatch, getSportMatchHistory, postEvent, postVoid, type MatchView } from "@/lib/sports/api";
import { actionsFor, eventLabels, sportById } from "@/lib/sports/engine";
import { ActionPanel, Badge, btnGhost, btnPrimary, EventLog, inputCls, ScoreView, type Submit } from "@/components/sports/match-ui";
import type { MatchEvent } from "@/lib/sports/types";

export const Route = createFileRoute("/kamp/$id")({ component: MatchConsole });

type History = Awaited<ReturnType<typeof getSportMatchHistory>>;

function MatchConsole() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [m, setM] = useState<MatchView | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<MatchEvent | null>(null);
  const [reason, setReason] = useState("");
  const [hist, setHist] = useState<History | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    try { setM(await fetchMatch(id)); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, [id]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  if (!m) return <SiteShell><div className="mx-auto max-w-3xl px-4 py-16">{err ? <p className="text-danger">{err}</p> : <p className="text-muted">Henter kamp …</p>}</div></SiteShell>;
  const sport = sportById(m.sportId)!;
  const input = { sportId: m.sportId, rules: m.rules, participants: m.participants, customEvents: m.customEvents };
  const actions = m.can.score ? actionsFor(input, m.events).filter((a) => m.can.decide || !["walkover", "disqualify", "reopen", "penalty_status", "approve", "reject", "abandon", "postpone"].includes(a.type)) : [];
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const keyQ = m.isPublic ? "" : `?k=${m.viewKey ?? ""}`;
  const liveUrl = `${origin}/tavle/${m.id}${keyQ}`;
  const obsUrl = `${origin}/tavle/${m.id}?obs=1${m.isPublic ? "" : `&k=${m.viewKey ?? ""}`}`;

  const submit: Submit = async (ev) => {
    busyRef.current = true; setBusy(true);
    try { setM(await postEvent({ matchId: m.id, ...ev })); return null; }
    catch (e) { return (e as Error).message; }
    finally { busyRef.current = false; setBusy(false); }
  };
  async function doVoid() {
    if (!voiding) return;
    if (reason.trim().length < 3) return setErr("Skriv en begrundelse for rettelsen.");
    busyRef.current = true;
    try { setM(await postVoid({ matchId: m!.id, eventId: voiding.id, reason })); setVoiding(null); setReason(""); setErr(""); }
    catch (e) { setErr((e as Error).message); }
    finally { busyRef.current = false; }
  }

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-8">
        <header className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            {m.tournamentId ? <Link to="/turneringer/$id" params={{ id: m.tournamentId }} className="text-sm text-muted hover:text-fg">← Turneringen</Link> : <Link to="/sport" className="text-sm text-muted hover:text-fg">← Kontrolpanel</Link>}
            <h1 className="font-display text-4xl sm:text-5xl">{sport.emoji} {m.title}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">{sport.name}{m.round ? ` · ${m.round}` : ""}{m.group ? ` · ${m.group}` : ""} · {m.ruleLabel}
              {m.status === "finished" ? m.approved ? <Badge tone="ok">Godkendt resultat</Badge> : <Badge tone="warn">Foreløbigt resultat</Badge> : null}
              {!m.isPublic ? <Badge tone="info">Privat</Badge> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={liveUrl} target="_blank" rel="noreferrer" className={btnGhost}>Live-tavle ↗</a>
            <button type="button" className={btnGhost} onClick={() => void navigator.clipboard?.writeText(obsUrl)}>Kopiér OBS-link</button>
          </div>
        </header>

        {err ? <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{err}</p> : null}
        {m.summary.warnings.length ? <ul className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-200">{m.summary.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul> : null}

        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <div className="grid min-w-0 content-start gap-5">
            <div className="rounded-card border border-line bg-deep p-4"><ScoreView s={m.summary} shape={sport.shape} big /></div>
            {m.can.score ? <ActionPanel actions={actions} participants={m.participants} shape={sport.shape} summary={m.summary} onSubmit={submit} busy={busy} /> : <p className="text-sm text-muted">Du kan følge kampen, men ikke registrere hændelser.</p>}
            {m.status === "finished" && !m.approved && m.can.decide ? (
              <div className="flex flex-wrap items-center gap-3 rounded-card border border-primary/40 bg-primary/10 p-4">
                <p className="mr-auto text-sm">Resultatet er foreløbigt. Godkend det, når det er kontrolleret – så tæller det som endeligt i stillingen.</p>
                <button type="button" className={btnPrimary} onClick={() => void approveSportMatch({ data: { id: m.id } }).then(load).catch((e: Error) => setErr(e.message))}>Godkend resultat</button>
              </div>
            ) : null}
          </div>
          <aside className="grid content-start gap-3">
            <h2 className="font-display text-2xl">Hændelser</h2>
            <EventLog labels={eventLabels(input, m.events)} events={m.events} participants={m.participants} canVoid={m.can.score && (m.status !== "finished" || m.can.decide)} onVoid={(e) => { setVoiding(e); setReason(""); }} />
            {m.can.manage ? (
              <div className="grid gap-2 border-t border-line pt-3">
                <button type="button" className={btnGhost} onClick={() => void getSportMatchHistory({ data: { id: m.id } }).then(setHist).catch((e: Error) => setErr(e.message))}>Vis resultathistorik</button>
                {!m.tournamentId ? <button type="button" className={`${btnGhost} text-danger`} onClick={() => { if (window.confirm("Slet kampen permanent?")) void deleteSportMatch({ data: { id: m.id } }).then(() => navigate({ to: "/sport" })).catch((e: Error) => setErr(e.message)); }}>Slet kamp</button> : null}
              </div>
            ) : null}
            {hist ? (
              <div className="grid gap-1 text-xs">
                {hist.length ? hist.map((h, i) => <p key={i} className="rounded-lg border border-line px-2 py-1"><b>{new Date(h.at).toLocaleString("da-DK")}</b> · {h.by} · {h.action}{h.before || h.after ? ` · ${h.before} → ${h.after}` : ""}{h.reason ? ` · "${h.reason}"` : ""}</p>) : <p className="text-muted">Ingen ændringer endnu.</p>}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
      {voiding ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="grid w-full max-w-md gap-3 rounded-card border border-line bg-surface p-5">
            <h3 className="font-display text-3xl">Annullér hændelse</h3>
            <p className="text-sm text-muted">Hændelsen slettes ikke – den markeres som annulleret, og resultatet genberegnes. Rettelsen logges med dit navn.</p>
            <label className="grid gap-1 text-sm"><span>Begrundelse</span><input autoFocus className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Fx forkert spiller registreret" /></label>
            <div className="flex gap-2"><button type="button" className={btnPrimary} onClick={() => void doVoid()}>Annullér hændelsen</button><button type="button" className={btnGhost} onClick={() => setVoiding(null)}>Fortryd</button></div>
          </div>
        </div>
      ) : null}
    </SiteShell>
  );
}
