import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchMatch, type MatchView } from "@/lib/sports/api";
import { sportById } from "@/lib/sports/engine";
import { ClockView, ScoreView } from "@/components/sports/match-ui";

type Search = { obs?: number; k?: string };

export const Route = createFileRoute("/tavle/$id")({
  validateSearch: (s: Record<string, unknown>): Search => ({ obs: s.obs ? 1 : undefined, k: typeof s.k === "string" ? s.k : undefined }),
  component: LiveBoard,
});

/** Offentlig live-tavle til storskærm – og med ?obs=1 en gennemsigtig overlay til OBS. Opdateres hvert 2. sekund. */
function LiveBoard() {
  const { id } = Route.useParams();
  const { obs, k } = Route.useSearch();
  const [m, setM] = useState<MatchView | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stop = false;
    const tick = () => fetchMatch(id, k).then((x) => { if (!stop) { setM(x); setErr(""); } }).catch((e: Error) => !stop && setErr(e.message));
    void tick();
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [id, k]);
  useEffect(() => {
    if (!obs) return;
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => { document.body.style.background = prev; };
  }, [obs]);

  if (!m) return <div className={`grid min-h-screen place-items-center ${obs ? "" : "bg-bg text-fg"}`}>{err ? <p className="text-danger">{err}</p> : obs ? null : <p className="text-muted">Henter …</p>}</div>;
  const sport = sportById(m.sportId)!;
  const s = m.summary;

  if (obs) {
    const compact = m.rules.obsStyle === "compact";
    const lines = s.scores.slice(0, sport.shape === "field" ? 8 : 2);
    return (
      <div className="p-4 font-display text-white" style={{ background: "transparent" }}>
        <div className="inline-grid gap-1 rounded-xl bg-black/80 px-4 py-2 shadow-lg">
          {!compact ? <p className="text-xs uppercase tracking-widest text-white/70">{sport.name}{m.round ? ` · ${m.round}` : ""} · {s.phase}</p> : null}
          {sport.shape !== "field" && lines.length === 2 ? (
            <div className="flex items-center gap-4 text-3xl">
              <span className="max-w-[14ch] truncate">{lines[0].name}</span>
              <span className="rounded bg-white px-3 tabular-nums text-black">{lines[0].main}–{lines[1].main}</span>
              <span className="max-w-[14ch] truncate">{lines[1].name}</span>
              {m.rules.obsClock !== false && s.clock ? <span className="text-xl text-white/80"><ClockView s={s} /></span> : null}
            </div>
          ) : (
            <div className="grid gap-0.5 text-xl">{lines.map((l, i) => <p key={l.id} className="flex gap-3"><span className="w-6 text-white/60">{l.place ?? i + 1}</span><span className="mr-auto truncate">{l.name}</span><span className="tabular-nums">{l.main}</span></p>)}</div>
          )}
          {lines.some((l) => l.sub) && !compact && sport.shape !== "field" ? <p className="text-sm text-white/70">{lines.map((l) => l.sub).filter(Boolean).join("  ·  ")}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen content-start gap-6 bg-bg p-6 text-fg sm:p-10">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="font-display text-xl tracking-widest text-primary">BANDITBOARD LIVE · {sport.emoji} {sport.name.toUpperCase()}</p>
          <h1 className="font-display text-4xl sm:text-6xl">{m.title}</h1>
          <p className="text-muted">{[m.round, m.group, m.ruleLabel].filter(Boolean).join(" · ")}</p>
        </div>
        {s.status === "finished" ? <p className={`rounded-xl px-4 py-2 font-display text-2xl ${m.approved ? "bg-ok/20 text-ok" : "bg-amber-400/20 text-amber-200"}`}>{m.approved ? "Endeligt resultat" : "Foreløbigt resultat"}</p> : null}
      </header>
      <div className="rounded-card border border-line bg-deep p-6"><ScoreView s={s} shape={sport.shape} big showFeed={m.rules.showFeed !== false} /></div>
    </div>
  );
}
