import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SiteShell } from "@/components/site-shell";
import { Field, inputClass } from "@/components/auth-card";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { canManageTournament } from "@/lib/roles";
import { getMe, type PublicProfile } from "@/lib/venues";
import {
  addHistoryRow,
  addRankingRow,
  getTournament,
  joinTournament,
  leaveTournament,
  removeHistoryRow,
  removeRankingRow,
  saveTournamentInfo,
} from "@/lib/tournament";

export const Route = createFileRoute("/turnering")({ component: TournamentPage });

type Board = Awaited<ReturnType<typeof getTournament>>;

function TournamentPage() {
  const { user, isPending } = useCurrentUserState();
  const [me, setMe] = useState<PublicProfile | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [planName, setPlanName] = useState("");
  const [plan, setPlan] = useState("");
  const [rankName, setRankName] = useState("");
  const [points, setPoints] = useState("0");
  const [wins, setWins] = useState("0");
  const [historyTitle, setHistoryTitle] = useState("");
  const [historyDetail, setHistoryDetail] = useState("");

  function apply(next: Board) {
    setBoard(next);
    setPlanName(next.name);
    setPlan(next.plan);
  }

  useEffect(() => {
    getTournament()
      .then(apply)
      .catch((err: Error) => setError(err.message || "Turneringen kunne ikke hentes."));
  }, []);

  useEffect(() => {
    if (!user) return;
    getMe()
      .then((profile) => {
        setMe(profile);
        setName(profile.contactName || profile.venueName || profile.accountName);
      })
      .catch(() => setMe(null));
  }, [user]);

  const editor = me ? canManageTournament(me.role) : false;
  const joined = board?.players.some((player) => player.userId === me?.userId) ?? false;

  async function onJoin(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      apply(await joinTournament({ data: { name, note } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Du kunne ikke tilmeldes.");
    }
  }

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10">
        <div>
          <p className="font-display text-lg tracking-widest text-primary">GÆST</p>
          <h1 className="font-display text-5xl sm:text-6xl">{board?.name || "Turnering"}</h1>
          <p className="mt-2 max-w-2xl text-muted">
            Tilmeld dig som spiller, og se turneringsplan, rangliste og historik.
          </p>
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-3xl">Turneringsplan</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{board?.plan || "Planen er ikke lagt endnu."}</p>
          {editor ? (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTournamentInfo({ data: { name: planName, plan } })
                  .then(apply)
                  .catch((err: Error) => setError(err.message));
              }}
            >
              <Field label="Navn">
                <input className={inputClass} value={planName} onChange={(e) => setPlanName(e.target.value)} />
              </Field>
              <Field label="Plan">
                <textarea className={`${inputClass} min-h-32 py-3`} value={plan} onChange={(e) => setPlan(e.target.value)} />
              </Field>
              <button type="submit" className="min-h-11 rounded-xl bg-primary font-display text-2xl text-primary-fg">
                Gem plan
              </button>
            </form>
          ) : null}
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-3xl">Tilmeld dig som spiller</h2>
          {isPending ? null : !user ? (
            <p className="mt-3 text-sm text-muted">
              <Link to="/opret" className="text-primary">Opret dig som gæst</Link> eller <Link to="/login" search={{ next: "/turnering" }} className="text-primary">log ind</Link> for at tilmelde dig.
            </p>
          ) : joined ? (
            <div className="mt-3">
              <p className="text-sm text-ok">Du er tilmeldt.</p>
              <button
                type="button"
                className="mt-3 min-h-11 rounded-xl border border-line px-4 text-sm"
                onClick={() => {
                  void leaveTournament()
                    .then(apply)
                    .catch((err: Error) => setError(err.message));
                }}
              >
                Afmeld mig
              </button>
            </div>
          ) : (
            <form className="mt-4 grid gap-3" onSubmit={onJoin}>
              <Field label="Navn">
                <input className={inputClass} required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Note">
                <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hold, niveau eller bord" />
              </Field>
              <button type="submit" className="min-h-11 rounded-xl bg-primary font-display text-2xl text-primary-fg">
                Tilmeld
              </button>
            </form>
          )}
          <ul className="mt-4 grid gap-2">
            {(board?.players ?? []).map((player) => (
              <li key={player.userId} className="rounded-xl border border-line px-3 py-2 text-sm">
                <span className="font-semibold">{player.name}</span>
                {player.note ? <span className="text-muted"> · {player.note}</span> : null}
              </li>
            ))}
            {board && board.players.length === 0 ? <li className="text-sm text-muted">Ingen er tilmeldt endnu.</li> : null}
          </ul>
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-3xl">Rangliste</h2>
          <ol className="mt-3 grid gap-2">
            {(board?.ranking ?? []).map((row, index) => (
              <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
                <span>
                  <span className="mr-2 font-display text-2xl text-primary">{index + 1}</span>
                  {row.name}
                </span>
                <span className="text-sm text-muted">{row.points} point · {row.wins} sejre</span>
                {editor ? (
                  <button type="button" className="text-sm text-danger" onClick={() => void removeRankingRow({ data: { id: row.id } }).then(apply).catch((err: Error) => setError(err.message))}>
                    Fjern
                  </button>
                ) : null}
              </li>
            ))}
            {board && board.ranking.length === 0 ? <li className="text-sm text-muted">Ingen rangliste endnu.</li> : null}
          </ol>
          {editor ? (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-[1fr_6rem_6rem_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void addRankingRow({ data: { name: rankName, points: Number(points), wins: Number(wins) } })
                  .then((next) => {
                    apply(next);
                    setRankName("");
                  })
                  .catch((err: Error) => setError(err.message));
              }}
            >
              <input className={inputClass} value={rankName} onChange={(e) => setRankName(e.target.value)} placeholder="Navn" required />
              <input className={inputClass} value={points} onChange={(e) => setPoints(e.target.value)} inputMode="numeric" aria-label="Point" />
              <input className={inputClass} value={wins} onChange={(e) => setWins(e.target.value)} inputMode="numeric" aria-label="Sejre" />
              <button type="submit" className="min-h-12 rounded-xl bg-surface-2 px-4">Tilføj</button>
            </form>
          ) : null}
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-3xl">Historik</h2>
          <ul className="mt-3 grid gap-2">
            {(board?.history ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-line px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">{row.title}</p>
                  {editor ? (
                    <button type="button" className="text-sm text-danger" onClick={() => void removeHistoryRow({ data: { id: row.id } }).then(apply).catch((err: Error) => setError(err.message))}>
                      Fjern
                    </button>
                  ) : null}
                </div>
                {row.detail ? <p className="text-sm text-muted">{row.detail}</p> : null}
              </li>
            ))}
            {board && board.history.length === 0 ? <li className="text-sm text-muted">Ingen kampe i historikken endnu.</li> : null}
          </ul>
          {editor ? (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void addHistoryRow({ data: { title: historyTitle, detail: historyDetail } })
                  .then((next) => {
                    apply(next);
                    setHistoryTitle("");
                    setHistoryDetail("");
                  })
                  .catch((err: Error) => setError(err.message));
              }}
            >
              <input className={inputClass} value={historyTitle} onChange={(e) => setHistoryTitle(e.target.value)} placeholder="Kamp" required />
              <input className={inputClass} value={historyDetail} onChange={(e) => setHistoryDetail(e.target.value)} placeholder="Resultat" />
              <button type="submit" className="min-h-11 rounded-xl bg-surface-2 px-4">Gem i historik</button>
            </form>
          ) : null}
        </section>
      </div>
    </SiteShell>
  );
}
