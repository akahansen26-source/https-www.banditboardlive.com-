import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";

export const Route = createFileRoute("/live")({ component: LivePage });

type Side = { name: string; club: string; score: number; photo: string; playing: boolean };
type Point = { name: string; delta: string; detail: string; time: string; tone: "plus" | "minus" | "undo" };
type Match = {
  venue: string;
  tour: string;
  table: string;
  title: string;
  subtitle: string;
  live: boolean;
  paused: boolean;
  updatedAt: string | null;
  sponsors: string[];
  sides: Side[];
  history: Point[];
};

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function Face({ side }: { side: Side }) {
  return (
    <span className={`grid size-16 shrink-0 place-items-center overflow-hidden rounded-full p-1 sm:size-20 ${side.playing ? "bg-gradient-to-br from-[#f6cfa9] to-[#b8734a] shadow-[0_0_0_3px_rgba(255,214,176,.85)]" : "bg-[#243556]"}`}>
      {side.photo ? (
        <img src={side.photo} alt="" className="size-full rounded-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center rounded-full bg-[#10203b] font-display text-xl text-[#e7b48c]">{initials(side.name)}</span>
      )}
    </span>
  );
}

function Player({ side, align }: { side: Side; align: "left" | "right" }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      {side.playing ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#1f8a4c] font-display text-lg text-white" title="Spiller nu">S</span>
      ) : (
        <span className="size-8 shrink-0" />
      )}
      <Face side={side} />
      <div className="min-w-0">
        <p className="font-display text-2xl uppercase leading-none text-white sm:text-4xl">{side.name}</p>
        <p className="mt-1 text-sm text-[#d6e0f0]">{side.club || (side.playing ? "Spiller nu" : " ")}</p>
      </div>
    </div>
  );
}

function Seat({ side }: { side: Side }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-[#16284a] px-3 py-3">
      {side.playing ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#1f8a4c] font-display text-lg text-white" title="Spiller nu">S</span>
      ) : null}
      <Face side={side} />
      <div className="min-w-0 flex-1">
        <p className="break-words font-display text-xl uppercase leading-tight text-white sm:text-2xl">{side.name}</p>
        <p className="mt-1 truncate text-sm text-[#d6e0f0]">{side.club || (side.playing ? "Spiller nu" : "")}</p>
      </div>
      <div className={`grid h-16 w-14 shrink-0 place-items-center rounded-xl border-2 bg-gradient-to-b from-[#0f1c33] to-[#070f1e] ${side.playing ? "border-[#f3c9a2] shadow-[0_0_18px_rgba(243,190,140,.45)]" : "border-[#b8734a]"}`}>
        <span className="bg-gradient-to-b from-[#ffe3ca] to-[#9a5a34] bg-clip-text font-display text-4xl text-transparent">{side.score}</span>
      </div>
    </div>
  );
}

function Score({ value, on }: { value: number; on: boolean }) {
  return (
    <div className={`grid h-20 w-16 shrink-0 place-items-center rounded-xl border-2 bg-gradient-to-b from-[#0f1c33] to-[#070f1e] sm:h-24 sm:w-20 ${on ? "border-[#f3c9a2] shadow-[0_0_18px_rgba(243,190,140,.45)]" : "border-[#b8734a]"}`}>
      <span className="bg-gradient-to-b from-[#ffe3ca] to-[#9a5a34] bg-clip-text font-display text-5xl text-transparent sm:text-6xl">{value}</span>
    </div>
  );
}

function MatchBoard({ match }: { match: Match }) {
  const [left, right] = match.sides;
  const many = match.sides.length > 2;
  return (
    <article className="theme-dark overflow-hidden rounded-2xl border border-[#e7b48c]/35 bg-[#0c172d] shadow-[0_18px_50px_-28px_rgba(0,0,0,.8)]">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#10182a] px-4 py-2 text-xs font-semibold uppercase tracking-widest text-[#d6e0f0]">
        <span>{match.tour}</span>
        <span className="text-[#b8734a]">·</span>
        <span>{match.table || "Bord"}</span>
        <span className="text-[#b8734a]">·</span>
        <span>{match.venue}</span>
        {match.paused ? <span className="rounded-full bg-[#3a2a12] px-2 py-0.5 text-[#ffd9b8]">Pause</span> : <span className="rounded-full bg-[#3a1218] px-2 py-0.5 text-[#ff8d8d]">Live</span>}
      </div>
      {many ? (
        <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
          {match.sides.map((side, index) => (
            <Seat key={`${side.name}-${index}`} side={side} />
          ))}
        </div>
      ) : (
        <div className="grid items-center gap-4 px-4 py-5 lg:grid-cols-[1fr_auto_1fr]">
          {left ? <Player side={left} align="left" /> : <div />}
          <div className="flex items-center justify-center gap-3">
            {left ? <Score value={left.score} on={left.playing} /> : null}
            <div className="min-w-28 text-center">
              <p className="font-display text-2xl uppercase text-white">{match.title || match.table}</p>
              <p className="mt-1 bg-gradient-to-b from-[#ffd9b8] to-[#c27a4c] bg-clip-text font-display text-sm uppercase tracking-widest text-transparent">{match.subtitle}</p>
            </div>
            {right ? <Score value={right.score} on={right.playing} /> : null}
          </div>
          {right ? <Player side={right} align="right" /> : <div />}
        </div>
      )}
      {match.sponsors.length ? (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-[#b8734a]/40 bg-[#1a140f] px-4 py-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-[#e0a070]">Sponsorer</span>
          {match.sponsors.map((name) => (
            <span key={name} className="rounded-full border border-[#b8734a]/40 px-3 py-1 text-xs font-semibold uppercase text-[#f2e7dc]">{name}</span>
          ))}
        </div>
      ) : null}
      <div className="border-t border-white/10 bg-[#09111f] px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="font-display text-xl uppercase text-white">Point-historik</p>
          <p className="text-xs text-[#9aabc4]">{(match.history || []).length ? "Seneste slag" : "Ingen slag endnu"}</p>
        </div>
        {(match.history || []).length ? (
          <ol className="grid gap-1.5">
            {(match.history || []).map((point, index) => (
              <li key={`${point.time}-${point.name}-${index}`} className={`grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 ${point.tone === "undo" ? "opacity-55" : "bg-white/[0.03]"}`}>
                <span className={`font-display text-2xl ${point.tone === "minus" ? "text-[#ff8d8d]" : point.tone === "undo" ? "text-[#9aabc4]" : "text-[#7dffa8]"}`}>{point.delta}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">{point.name}</span>
                  <span className="block text-xs text-[#9aabc4]">{point.detail}</span>
                </span>
                <time className="text-xs text-[#9aabc4]">{point.time}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[#9aabc4]">Historikken kommer frem, når det første stød er registreret.</p>
        )}
      </div>
    </article>
  );
}

function LivePage() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [seenAt, setSeenAt] = useState("");

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const response = await fetch("/api/board/state?offentlig=1", { cache: "no-store" });
        if (!response.ok) throw new Error("offline");
        const data = (await response.json()) as { matches?: Match[] };
        if (stop) return;
        setMatches(Array.isArray(data.matches) ? data.matches : []);
        setOffline(false);
        setSeenAt(new Date().toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }));
      } catch {
        if (!stop) setOffline(true);
      }
    }
    void pull();
    const timer = setInterval(() => void pull(), 3000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const live = (matches || []).filter((match) => match.live);
  const idle = (matches || []).filter((match) => !match.live);

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="font-display text-lg tracking-widest text-primary">OFFENTLIG</p>
        <h1 className="mt-1 font-display text-5xl sm:text-6xl">Live</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Her kan alle se, hvem der spiller. Navn, foto, klub og score opdateres af sig selv.
        </p>
        {offline ? (
          <p className="mt-4 rounded-xl border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
            Forbindelsen er mistet. Tallene kan være forældede.{seenAt ? ` Sidst opdateret: ${seenAt}.` : ""}
          </p>
        ) : seenAt ? (
          <p className="mt-4 text-sm text-muted">Opdateret {seenAt}. Siden henter selv nye point.</p>
        ) : null}

        {matches === null ? <div className="mt-8 h-40 animate-pulse rounded-card bg-surface-2" /> : null}

        {matches && live.length === 0 && idle.length === 0 ? (
          <div className="mt-8 rounded-card border border-line bg-surface p-6">
            <h2 className="font-display text-3xl">Ingen offentlig tavle endnu</h2>
            <p className="mt-2 text-muted">
              Når en scoreboard-admin slår “Vis tavlen offentligt” til under Konto, kommer kampene herind.
            </p>
            <Link to="/opret" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-display text-2xl text-primary-fg">
              Opret bruger
            </Link>
          </div>
        ) : null}

        <div className="mt-8 grid gap-5">
          {live.map((match) => (
            <MatchBoard key={`${match.venue}-${match.table}`} match={match} />
          ))}
          {idle.map((match) => (
            <article key={match.venue} className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="font-display text-3xl">{match.venue}</h2>
              <p className="mt-1 text-muted">{match.tour}. Ingen live kamp lige nu.</p>
            </article>
          ))}
        </div>
      </div>
    </SiteShell>
  );
}
