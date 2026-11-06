import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { archiveRuleSet, getRuleSet, getRuleSets, saveRuleSet, getSportsOverview } from "@/lib/sports/api";
import { actionsFor, defaultValues, eventLabels, resolveValues, ruleVisible, sportById, summarize, validateEvent, validateRuleSet, valueOrigin } from "@/lib/sports/engine";
import { computeStandings } from "@/lib/sports/standings";
import { SECTIONS, type CustomEvent, type MatchEvent, type Participant, type RuleDef, type RuleValue, type RuleValues, type SectionId } from "@/lib/sports/types";
import { ActionPanel, Badge, btn, btnGhost, btnPrimary, EventLog, inputCls, ScoreView } from "@/components/sports/match-ui";
import { hasPermission, type UserRole } from "@/lib/roles";

export const Route = createFileRoute("/sport/$sportId")({ component: SportPage });

type RS = Awaited<ReturnType<typeof getRuleSet>>;
type Tab = SectionId | "events" | "test" | "versions";

const ORIGIN: Record<string, { label: string; tone: "info" | "ok" | "warn" | "primary" }> = {
  official: { label: "Officiel regel", tone: "ok" },
  standard: { label: "Standard", tone: "info" },
  adapted: { label: "Turneringstilpasning", tone: "warn" },
  custom: { label: "BanditBoard-funktion", tone: "primary" },
};

function defaultParticipants(shape: string, n: number): Participant[] {
  const names = shape === "team" ? ["Hjemmehold", "Udehold", "Hold 3", "Hold 4"] : ["Testspiller 1", "Testspiller 2", "Testspiller 3", "Testspiller 4", "Testspiller 5", "Testspiller 6"];
  return names.slice(0, n).map((name, i) => ({ id: `t${i + 1}`, name, members: shape === "team" ? Array.from({ length: 5 }, (_, k) => `${name.slice(0, 4)} ${k + 1}`) : undefined, handicap: 0, lane: i + 1 }));
}

function SportPage() {
  const { sportId } = Route.useParams();
  const sport = sportById(sportId);
  const { user } = useCurrentUserState();
  const [role, setRole] = useState<UserRole>("gaest");
  const [sets, setSets] = useState<Awaited<ReturnType<typeof getRuleSets>>>([]);
  const [active, setActive] = useState<string>("standard"); // "standard" | rs-id | "new"
  const [rs, setRs] = useState<RS | null>(null);
  const [variant, setVariant] = useState("");
  const [values, setValues] = useState<RuleValues>(() => (sport ? defaultValues(sport) : {}));
  const [events, setEvents] = useState<CustomEvent[]>(() => sport?.customEvents ?? []);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<"tournament" | "custom">("tournament");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("basis");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<{ rule: RuleDef; value: RuleValue } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    getSportsOverview().then((o) => setRole(o.role as UserRole)).catch(() => undefined);
    getRuleSets({ data: { sportId } }).then(setSets).catch(() => undefined);
  }, [user, sportId]);

  const canEdit = hasPermission(role, "MANAGE_RULES");
  const canRun = hasPermission(role, "EDIT_MATCH");
  const readOnly = active === "standard" || !canEdit || (rs ? !rs.mine && !hasPermission(role, "MANAGE_USERS") : false);
  const check = useMemo(() => (sport ? validateRuleSet(sport, resolveValues(sport, values), sport.family === "custom" ? events : []) : { errors: [], warnings: [] }), [sport, values, events]);

  if (!sport) return <SiteShell><div className="mx-auto max-w-3xl px-4 py-16"><h1 className="font-display text-5xl">Ukendt sportsgren</h1><Link to="/sport" className="text-primary underline">Tilbage</Link></div></SiteShell>;

  const sectionTabs = SECTIONS.filter((s) => sport.rules.some((r) => r.section === s.id));
  const tabs: { id: Tab; label: string }[] = [...sectionTabs, ...(sport.family === "custom" && sport.id !== "quiz" ? [{ id: "events" as Tab, label: "Hændelser og point" }] : []), { id: "test", label: "Test af regler" }, { id: "versions", label: "Gem og versioner" }];

  function pickStandard(v = variant) {
    setActive("standard"); setRs(null); setVariant(v);
    setValues(defaultValues(sport!, v || undefined)); setEvents(sport!.customEvents ?? []); setMsg(""); setErr("");
  }
  async function pickSet(id: string) {
    setErr(""); setMsg("");
    try {
      const r = await getRuleSet({ data: { id } });
      setActive(id); setRs(r); setName(r.name); setLevel(r.level === "custom" ? "custom" : "tournament"); setVariant(r.variant);
      const v = r.versions[0];
      setValues(resolveValues(sport!, v?.rules ?? {})); setEvents(v?.customEvents ?? []);
    } catch (e) { setErr((e as Error).message); }
  }
  function startNew(kind: "tournament" | "custom") {
    setActive("new"); setRs(null); setLevel(kind);
    setName(kind === "custom" ? `${sport!.name} – eget regelsæt` : `${sport!.name} – turneringsregler`);
    if (kind === "custom" && sport!.family === "custom") setEvents([]);
    setTab(sectionTabs[0]?.id ?? "basis"); setMsg("Nyt regelsæt – en kopi af standarden. Ret det til, og gem."); setErr("");
  }
  function setRule(r: RuleDef, v: RuleValue) {
    if (readOnly) return;
    if (r.kind === "bool" && v === false && values[r.id] === true && r.critical) { setConfirm({ rule: r, value: v }); return; }
    setValues((x) => ({ ...x, [r.id]: v }));
  }
  async function save(publish: boolean) {
    setErr(""); setMsg(""); setSaving(true);
    try {
      const r = await saveRuleSet({ data: { id: active !== "new" && active !== "standard" ? active : undefined, sportId, name, level, variant, rules: values, customEvents: events, note, publish } });
      setMsg(`Gemt som version ${r.version}${publish ? " og offentliggjort" : ""}.${r.warnings.length ? ` Bemærk: ${r.warnings.join(" ")}` : ""}`);
      setNote("");
      setSets(await getRuleSets({ data: { sportId } }));
      await pickSet(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  const visibleRules = (sec: SectionId) => sport.rules.filter((r) => r.section === sec && ruleVisible(r, values));

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
        <header className="flex flex-wrap items-start gap-4">
          <span className="text-5xl" aria-hidden="true">{sport.emoji}</span>
          <div className="mr-auto min-w-0">
            <Link to="/sport" className="text-sm text-muted hover:text-fg">← Alle sportsgrene</Link>
            <h1 className="font-display text-5xl">{sport.name}</h1>
            <p className="max-w-2xl text-muted">{sport.blurb}</p>
          </div>
          {canRun ? (
            <div className="flex flex-wrap gap-2">
              <Link to="/kamp/ny" search={{ sport: sport.id, rs: active !== "standard" && active !== "new" ? active : undefined, v: variant || undefined }} className={btnPrimary}>Start kamp</Link>
              <Link to="/kamp/ny" search={{ sport: sport.id, rs: active !== "standard" && active !== "new" ? active : undefined, v: variant || undefined, turnering: 1 }} className={btnGhost}>Start turnering</Link>
            </div>
          ) : null}
        </header>

        <section className="grid gap-2 rounded-card border border-line bg-surface p-4 text-sm">
          <p><b>Regelkilde:</b> {sport.source.body} – {sport.source.document} · udgave: {sport.source.edition}</p>
          {sport.source.note ? <p className="text-muted">{sport.source.note}</p> : null}
          <p className="flex flex-wrap gap-2 text-muted">Mærker: {Object.values(ORIGIN).map((o) => <Badge key={o.label} tone={o.tone}>{o.label}</Badge>)}</p>
        </section>

        <section className="grid gap-3 lg:grid-cols-[18rem_1fr]">
          <aside className="grid content-start gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Regelsæt</p>
            <button type="button" onClick={() => pickStandard()} className={`grid gap-0.5 rounded-xl border p-3 text-left ${active === "standard" ? "border-primary bg-primary/10" : "border-line bg-surface"}`}>
              <span className="font-semibold">A · Standardregelsæt</span>
              <span className="text-xs text-muted">{sport.source.body} – kan ikke ændres</span>
            </button>
            {sport.variants?.length && active === "standard" ? (
              <select className={inputCls} value={variant} onChange={(e) => pickStandard(e.target.value)} aria-label="Variant">
                <option value="">Standard</option>
                {sport.variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            ) : null}
            {sets.map((s) => (
              <button key={s.id} type="button" onClick={() => void pickSet(s.id)} className={`grid gap-0.5 rounded-xl border p-3 text-left ${active === s.id ? "border-primary bg-primary/10" : "border-line bg-surface"}`}>
                <span className="font-semibold">{s.level === "custom" ? "C" : "B"} · {s.name}</span>
                <span className="text-xs text-muted">{s.level === "custom" ? "Brugerdefineret" : "Turneringsregelsæt"} · v{s.version} · {s.status === "published" ? "offentliggjort" : "kladde"}</span>
              </button>
            ))}
            {canEdit ? (
              <>
                <button type="button" className={btnGhost} onClick={() => startNew("tournament")}>+ Turneringsregelsæt (B)</button>
                <button type="button" className={btnGhost} onClick={() => startNew("custom")}>+ Brugerdefineret regelsæt (C)</button>
              </>
            ) : user ? <p className="text-xs text-muted">Din rolle kan se og teste reglerne. Ændringer kræver rollen Administrer scoreboard.</p> : <p className="text-xs text-muted">Log ind for at gemme egne regelsæt.</p>}
          </aside>

          <div className="grid min-w-0 content-start gap-4">
            {msg ? <p className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm">{msg}</p> : null}
            {err ? <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{err}</p> : null}
            {readOnly && active === "standard" ? <p className="text-sm text-muted">Du ser standardregelsættet. Lav et turneringsregelsæt for at tilpasse reglerne til jeres turnering – standarden for alle andre ændres ikke.</p> : null}
            <nav className="flex flex-wrap gap-1 border-b border-line pb-2" aria-label="Sektioner">
              {tabs.map((t) => <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === t.id ? "bg-primary text-primary-fg" : "text-muted hover:text-fg"}`}>{t.label}</button>)}
            </nav>

            {SECTIONS.some((s) => s.id === tab) ? (
              <div className="grid gap-2">
                {visibleRules(tab as SectionId).map((r) => <RuleRow key={r.id} rule={r} value={values[r.id]} onChange={(v) => setRule(r, v)} disabled={readOnly} />)}
                {sport.rules.filter((r) => r.section === tab && !ruleVisible(r, values)).length ? <p className="text-xs text-muted">{sport.rules.filter((r) => r.section === tab && !ruleVisible(r, values)).length} indstilling(er) er skjult, fordi den regel de hører til er slået fra.</p> : null}
              </div>
            ) : null}

            {tab === "events" ? <EventsEditor events={events} setEvents={setEvents} readOnly={readOnly} /> : null}
            {tab === "test" ? <TestMode sportId={sport.id} values={values} events={events} /> : null}
            {tab === "versions" ? (
              <div className="grid gap-4">
                {check.errors.length ? <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><b>Regelsættet kan ikke bruges endnu:</b><ul className="mt-1 list-disc pl-5">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul></div> : <p className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok">Regelsættet er gyldigt.</p>}
                {check.warnings.length ? <ul className="list-disc pl-5 text-sm text-amber-200">{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
                {!readOnly || active === "new" ? (
                  <div className="grid gap-3 rounded-card border border-line bg-surface p-4">
                    <label className="grid gap-1 text-sm"><span>Navn</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
                    <label className="grid gap-1 text-sm"><span>Niveau</span><select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value as "tournament" | "custom")}><option value="tournament">B · Turneringsregelsæt (kopi af standard)</option><option value="custom">C · Brugerdefineret regelsæt</option></select></label>
                    <label className="grid gap-1 text-sm"><span>Note til versionen (hvad er ændret?)</span><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                    <p className="text-xs text-muted">Hver gemning laver en ny, låst version. Turneringer og kampe bruger den version, der gjaldt da de blev oprettet – senere ændringer ændrer ikke spillede kampe.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnPrimary} disabled={saving || check.errors.length > 0} onClick={() => void save(false)}>Gem ny version</button>
                      <button type="button" className={btnGhost} disabled={saving || check.errors.length > 0} onClick={() => void save(true)}>Gem og offentliggør</button>
                      {rs ? <button type="button" className={`${btn} text-danger`} onClick={() => void archiveRuleSet({ data: { id: rs.id } }).then(() => getRuleSets({ data: { sportId } }).then(setSets)).then(() => pickStandard())}>Arkivér</button> : null}
                    </div>
                  </div>
                ) : canEdit ? <button type="button" className={btnPrimary} onClick={() => startNew("tournament")}>Kopiér til eget turneringsregelsæt</button> : null}
                {rs?.versions.length ? (
                  <div className="grid gap-2">
                    <h3 className="font-display text-2xl">Versionshistorik</h3>
                    {rs.versions.map((v) => (
                      <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                        <b>v{v.version}</b><span className="text-muted">{new Date(v.at).toLocaleString("da-DK")} · {v.by}</span>{v.note ? <span>– {v.note}</span> : null}
                        <button type="button" className="ml-auto rounded-lg border border-line px-2 py-1 text-xs" onClick={() => { setValues(resolveValues(sport, v.rules)); setEvents(v.customEvents); setMsg(`Version ${v.version} er hentet ind i editoren. Gem for at gøre den til en ny version.`); }}>Hent ind</button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
      {confirm ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="grid max-w-md gap-3 rounded-card border border-amber-400/40 bg-surface p-5">
            <h3 className="font-display text-3xl">Slå "{confirm.rule.label}" fra?</h3>
            <p className="text-sm text-amber-200">⚠ {confirm.rule.critical}</p>
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} onClick={() => { setValues((x) => ({ ...x, [confirm.rule.id]: confirm.value })); setConfirm(null); }}>Slå fra alligevel</button>
              <button type="button" className={btnGhost} onClick={() => setConfirm(null)}>Behold</button>
            </div>
          </div>
        </div>
      ) : null}
    </SiteShell>
  );
}

function RuleRow({ rule, value, onChange, disabled }: { rule: RuleDef; value: RuleValue | undefined; onChange: (v: RuleValue) => void; disabled: boolean }) {
  const o = ORIGIN[valueOrigin(rule, value ?? rule.default)];
  const [text, setText] = useState(String(value ?? ""));
  useEffect(() => setText(Array.isArray(value) ? value.join(", ") : String(value ?? "")), [value]);
  const num = (s: string) => {
    const n = Number(s.replace(",", "."));
    setText(s);
    if (s.trim() !== "" && Number.isFinite(n)) onChange(n);
  };
  const err = rule.kind !== "bool" && rule.kind !== "choice" && rule.kind !== "text" && rule.kind !== "table" && (typeof value !== "number" || (rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max));
  return (
    <div className={`grid gap-2 rounded-xl border bg-surface p-3 sm:grid-cols-[1fr_16rem] sm:items-center ${err ? "border-danger" : "border-line"}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-semibold">{rule.label}<Badge tone={o.tone}>{o.label}</Badge>{rule.critical ? <Badge tone="warn">Nødvendig for resultatet</Badge> : null}</p>
        {rule.help ? <p className="text-xs text-muted">{rule.help}</p> : null}
        {err ? <p className="text-xs text-danger">Skal være et tal{rule.min !== undefined ? ` mellem ${rule.min} og ${rule.max}` : ""}.</p> : null}
      </div>
      <div>
        {rule.kind === "bool" ? (
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-6 accent-[var(--color-primary)]" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={rule.label} /><span className="text-sm">{value ? "Aktiveret" : "Deaktiveret"}</span></label>
        ) : rule.kind === "choice" ? (
          <select className={inputCls} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={rule.label}>{rule.options?.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select>
        ) : rule.kind === "text" ? (
          <input className={inputCls} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={rule.label} />
        ) : rule.kind === "table" ? (
          <input className={inputCls} value={text} disabled={disabled} aria-label={rule.label} placeholder="fx 25, 18, 15, 12" onChange={(e) => { setText(e.target.value); const parts = e.target.value.split(/[,;\s]+/).filter(Boolean).map((x) => Number(x.replace(",", "."))); if (parts.every((x) => Number.isFinite(x))) onChange(parts); }} />
        ) : (
          <div className="flex items-center gap-2"><input className={inputCls} inputMode="decimal" value={text} disabled={disabled} onChange={(e) => num(e.target.value)} aria-label={rule.label} />{rule.unit ? <span className="text-sm text-muted">{rule.unit}</span> : null}</div>
        )}
      </div>
    </div>
  );
}

function EventsEditor({ events, setEvents, readOnly }: { events: CustomEvent[]; setEvents: (e: CustomEvent[]) => void; readOnly: boolean }) {
  const upd = (i: number, p: Partial<CustomEvent>) => setEvents(events.map((e, k) => (k === i ? { ...e, ...p } : e)));
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">Opret jeres egne hændelser – fx væltet kegle, bestemt kugle i hul, kombinationer, bonus- og minuspoint. Der er ingen faste regler: kun det I opretter her bruges.</p>
      {events.map((e, i) => (
        <div key={e.id} className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm"><span>Navn</span><input className={inputCls} value={e.name} disabled={readOnly} onChange={(x) => upd(i, { name: x.target.value })} /></label>
          <label className="grid gap-1 text-sm"><span>Pointværdi</span><input className={inputCls} inputMode="numeric" value={String(e.value)} disabled={readOnly} onChange={(x) => upd(i, { value: Math.max(0, Math.round(Number(x.target.value) || 0)) })} /></label>
          <label className="grid gap-1 text-sm sm:col-span-2"><span>Beskrivelse</span><input className={inputCls} value={e.description} disabled={readOnly} onChange={(x) => upd(i, { description: x.target.value })} /></label>
          <label className="grid gap-1 text-sm"><span>Effekt</span><select className={inputCls} disabled={readOnly} value={`${e.target}|${e.sign}`} onChange={(x) => { const [t, s] = x.target.value.split("|"); upd(i, { target: t as CustomEvent["target"], sign: Number(s) as 1 | -1 }); }}><option value="self|1">Lægger point til udøveren</option><option value="self|-1">Trækker point fra udøveren</option><option value="opponents|1">Giver pointene til modstanderne</option></select></label>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" disabled={readOnly} checked={e.repeatable} onChange={(x) => upd(i, { repeatable: x.target.checked })} />Må registreres flere gange</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={readOnly} checked={e.needsApproval} onChange={(x) => upd(i, { needsApproval: x.target.checked })} />Kræver godkendelse</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={readOnly} checked={e.show} onChange={(x) => upd(i, { show: x.target.checked })} />Vis på scoreboardet</label>
            {!readOnly ? <button type="button" className="ml-auto text-danger" onClick={() => setEvents(events.filter((_, k) => k !== i))}>Fjern</button> : null}
          </div>
        </div>
      ))}
      {!readOnly ? <button type="button" className={btnGhost} onClick={() => setEvents([...events, { id: `ev${Date.now().toString(36)}`, name: "Ny hændelse", description: "", value: 1, sign: 1, target: "self", repeatable: true, needsApproval: false, show: true }])}>+ Tilføj hændelse</button> : null}
    </div>
  );
}

/** Testtilstand: kører i browseren med regelmotoren – gemmer intet og rører ingen rigtige turneringer. */
function TestMode({ sportId, values, events }: { sportId: string; values: RuleValues; events: CustomEvent[] }) {
  const sport = sportById(sportId)!;
  const [n, setN] = useState(sport.shape === "field" ? Math.min(4, sport.maxParticipants) : 2);
  const [names, setNames] = useState(() => defaultParticipants(sport.shape, n).map((p) => p.name).join("\n"));
  const participants = useMemo<Participant[]>(() => {
    const base = defaultParticipants(sport.shape, 8);
    return names.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, sport.maxParticipants).map((name, i) => ({ ...base[i % base.length], id: `t${i + 1}`, name }));
  }, [names, sport]);
  const [log, setLog] = useState<MatchEvent[]>([]);
  const input = { sportId, rules: values, participants, customEvents: events };
  const summary = summarize(input, log);
  const actions = actionsFor(input, log);
  const standings = summary.results.length ? computeStandings(participants, [{ id: "test", results: summary.results }], String(values.tiebreak ?? "points")) : [];
  const submit = async (ev: { type: string; side?: string; player?: string; minute?: number; data?: Record<string, unknown> }) => {
    const e: MatchEvent = { id: `x${log.length + 1}`, seq: log.length + 1, at: Date.now(), ...ev, byName: "Test" };
    const err = validateEvent(input, log, e);
    if (err) return err;
    setLog([...log, e]);
    return null;
  };
  return (
    <div className="grid gap-4">
      <p className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm">Testtilstand: alt her kører kun i din browser. Der gemmes intet, og rigtige turneringer og resultater påvirkes ikke.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="grid gap-1 text-sm"><span>Testdeltagere (én pr. linje)</span><textarea className={`${inputCls} min-h-24 py-2`} value={names} onChange={(e) => { setNames(e.target.value); setLog([]); }} /></label>
        <div className="flex gap-2">
          {sport.shape === "field" ? <button type="button" className={btnGhost} onClick={() => { const k = Math.min(sport.maxParticipants, n + 1); setN(k); setNames(defaultParticipants(sport.shape, k).map((p) => p.name).join("\n")); setLog([]); }}>+ Deltager</button> : null}
          <button type="button" className={btnGhost} onClick={() => setLog([])}>Nulstil test</button>
        </div>
      </div>
      <div className="rounded-card border border-line bg-deep p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Forhåndsvisning af scoreboardet</p><ScoreView s={summary} shape={sport.shape} /></div>
      <ActionPanel actions={actions} participants={participants} shape={sport.shape} summary={summary} onSubmit={submit} />
      {standings.length ? (
        <div className="grid gap-2"><h3 className="font-display text-2xl">Rangliste (beregnet fra testkampen)</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th>#</th><th>Navn</th><th>K</th><th>V</th><th>U</th><th>T</th><th>Score</th><th>Point</th></tr></thead><tbody>{standings.map((r) => <tr key={r.id} className="border-t border-line"><td>{r.place}</td><td>{r.name}</td><td>{r.played}</td><td>{r.won}</td><td>{r.drawn}</td><td>{r.lost}</td><td>{r.scoreFor}–{r.scoreAgainst}</td><td className="font-semibold">{r.points}</td></tr>)}</tbody></table>
        </div>
      ) : null}
      <div className="grid gap-2"><h3 className="font-display text-2xl">Hændelser</h3><EventLog labels={eventLabels(input, log)} events={log} participants={participants} canVoid onVoid={(e) => setLog(log.map((x) => (x.id === e.id ? { ...x, voided: { at: Date.now(), reason: "Test" } } : x)))} /></div>
    </div>
  );
}
