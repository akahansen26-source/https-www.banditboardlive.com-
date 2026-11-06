import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { createSportMatch, createSportTournament, getRuleSets } from "@/lib/sports/api";
import { SPORTS, SPORT_GROUPS } from "@/lib/sports/catalog";
import { sportById } from "@/lib/sports/engine";
import type { TournamentFormat } from "@/lib/sports/types";
import { btnGhost, btnPrimary, inputCls } from "@/components/sports/match-ui";

type Search = { sport?: string; rs?: string; v?: string; turnering?: number };

export const Route = createFileRoute("/kamp/ny")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    sport: typeof s.sport === "string" ? s.sport : undefined,
    rs: typeof s.rs === "string" ? s.rs : undefined,
    v: typeof s.v === "string" ? s.v : undefined,
    turnering: s.turnering ? 1 : undefined,
  }),
  component: NewMatch,
});

const FORMAT_LABEL: Record<TournamentFormat, string> = { league: "Liga / alle mod alle", groups: "Puljer", knockout: "Knockout / cup", individual: "Individuel konkurrence (alle i samme felt)" };

/** Én deltager pr. linje. Hold: "Navn: spiller1, spiller2". Handicap: "Navn (hcp 12)". */
function parseParticipants(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line, i) => {
    let name = line, members: string[] | undefined, handicap: number | undefined;
    const hcp = name.match(/\((?:hcp|handicap)\s*(-?\d+(?:[.,]\d+)?)\)/i);
    if (hcp) { handicap = Number(hcp[1].replace(",", ".")); name = name.replace(hcp[0], "").trim(); }
    const c = name.indexOf(":");
    if (c > 0) { members = name.slice(c + 1).split(",").map((x) => x.trim()).filter(Boolean); name = name.slice(0, c).trim(); }
    return { id: `p${i + 1}`, name: name.slice(0, 60), members, handicap, lane: i + 1 };
  });
}

function NewMatch() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user, isPending } = useCurrentUserState();
  const [tour, setTour] = useState(Boolean(search.turnering));
  const [sportId, setSportId] = useState(search.sport && sportById(search.sport) ? search.sport : "fodbold");
  const sport = sportById(sportId)!;
  const [sets, setSets] = useState<Awaited<ReturnType<typeof getRuleSets>>>([]);
  const [rule, setRule] = useState(search.rs ? `rs:${search.rs}` : `std:${search.v ?? ""}`);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [format, setFormat] = useState<TournamentFormat>(sport.formats[0]);
  const [double, setDouble] = useState(false);
  const [groups, setGroups] = useState(2);
  const [isPublic, setPublic] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    getRuleSets({ data: { sportId } }).then(setSets).catch(() => setSets([]));
  }, [user, sportId]);
  useEffect(() => {
    if (!sport.formats.includes(format)) setFormat(sport.formats[0]);
  }, [sport, format]);

  const parts = useMemo(() => parseParticipants(text), [text]);
  const isDuel = sport.shape !== "field";
  const needTwo = !tour && isDuel && !(sport.family === "x01" || sport.family === "cricket");
  const placeholder = sport.shape === "team" ? "FC Hjem: Anders, Bo, Carl\nBoldklubben Ude" : sport.family === "golf" ? "Mette (hcp 12)\nJonas (hcp 18)" : "Spiller 1\nSpiller 2\nSpiller 3";

  async function create() {
    setErr("");
    if (needTwo && parts.length !== 2) return setErr(`${sport.name} spilles mellem præcis to ${sport.shape === "team" ? "hold" : "deltagere"}.`);
    if (parts.length < (tour ? 2 : sport.minParticipants)) return setErr(`Skriv mindst ${tour ? 2 : sport.minParticipants} deltagere – én pr. linje.`);
    if (parts.length > (tour ? 128 : sport.maxParticipants)) return setErr(`Højst ${tour ? 128 : sport.maxParticipants} deltagere.`);
    setBusy(true);
    const c = rule.indexOf(":");
    const [kind, rid] = [rule.slice(0, c), rule.slice(c + 1)];
    const rulesetId = kind === "rs" ? rid : null;
    const variant = kind === "std" ? rid : "";
    try {
      if (tour) {
        const r = await createSportTournament({ data: { name: title, sportId, rulesetId, variant, format, participants: parts, double, groups, isPublic } });
        await navigate({ to: "/turneringer/$id", params: { id: r.id } });
      } else {
        const r = await createSportMatch({ data: { sportId, rulesetId, variant, title, participants: parts, isPublic } });
        await navigate({ to: "/kamp/$id", params: { id: r.id } });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!isPending && !user) {
    return <SiteShell><div className="mx-auto grid max-w-xl gap-4 px-4 py-16"><h1 className="font-display text-5xl">Log ind først</h1><p className="text-muted">Du skal være logget ind for at oprette kampe og turneringer.</p><Link to="/login" search={{ next: "/kamp/ny" }} className={btnPrimary}>Log ind</Link></div></SiteShell>;
  }

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-3xl gap-6 px-4 py-10">
        <header>
          <Link to="/sport" className="text-sm text-muted hover:text-fg">← Kontrolpanel</Link>
          <h1 className="font-display text-5xl">{tour ? "Ny turnering" : "Ny kamp"}</h1>
        </header>
        <div className="flex gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={!tour} className={!tour ? btnPrimary : btnGhost} onClick={() => setTour(false)}>Enkelt kamp</button>
          <button type="button" role="tab" aria-selected={tour} className={tour ? btnPrimary : btnGhost} onClick={() => setTour(true)}>Turnering</button>
        </div>
        <div className="grid gap-4 rounded-card border border-line bg-surface p-5">
          <label className="grid gap-1 text-sm"><span>Sportsgren</span>
            <select className={inputCls} value={sportId} onChange={(e) => { setSportId(e.target.value); setRule("std:"); }}>
              {SPORT_GROUPS.map((g) => <optgroup key={g} label={g}>{SPORTS.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm"><span>Regelsæt</span>
            <select className={inputCls} value={rule} onChange={(e) => setRule(e.target.value)}>
              <option value="std:">Standard – {sport.source.body}</option>
              {sport.variants?.map((v) => <option key={v.id} value={`std:${v.id}`}>Standard – {v.label}</option>)}
              {sets.map((s) => <option key={s.id} value={`rs:${s.id}`}>{s.level === "custom" ? "Eget" : "Turnering"}: {s.name} (v{s.version})</option>)}
            </select>
            <span className="text-xs text-muted">Reglerne låses, når {tour ? "turneringen" : "kampen"} oprettes. <Link to="/sport/$sportId" params={{ sportId }} className="text-primary underline">Se eller tilpas reglerne</Link></span>
          </label>
          <label className="grid gap-1 text-sm"><span>{tour ? "Turneringens navn" : "Titel (valgfri)"}</span><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tour ? `${sport.name}-cup` : "Fx Semifinale"} /></label>
          <label className="grid gap-1 text-sm"><span>{sport.shape === "team" ? "Hold" : "Deltagere"} – én pr. linje</span>
            <textarea className={`${inputCls} min-h-40 py-2`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
            <span className="text-xs text-muted">{sport.shape === "team" ? "Skriv evt. spillere efter kolon: \"Holdnavn: spiller1, spiller2\" – så kan mål og kort registreres på spillere." : "Handicap kan skrives som \"Navn (hcp 12)\"."} {parts.length} {parts.length === 1 ? "deltager" : "deltagere"}.</span>
          </label>
          {tour ? (
            <>
              <label className="grid gap-1 text-sm"><span>Format</span>
                <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>{sport.formats.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}</select>
              </label>
              {format === "league" && isDuel ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} />Dobbelt-turnering (ude og hjemme)</label> : null}
              {format === "groups" ? <label className="grid gap-1 text-sm"><span>Antal puljer</span><input className={inputCls} type="number" min={2} max={16} value={groups} onChange={(e) => setGroups(Number(e.target.value))} /></label> : null}
              {sport.shape === "field" && format === "league" ? <p className="text-xs text-muted">Serie: der oprettes afdeling 1 nu – flere afdelinger tilføjes fra turneringssiden, og point lægges sammen i stillingen.</p> : null}
            </>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />Offentlig – vis på Resultater og live-tavlen uden login</label>
          {err ? <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{err}</p> : null}
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create()}>{busy ? "Opretter …" : tour ? "Opret turnering" : "Opret kamp"}</button>
        </div>
      </div>
    </SiteShell>
  );
}
