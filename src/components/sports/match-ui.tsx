import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActionDef, ActionField, MatchEvent, Participant, Summary } from "@/lib/sports/types";
import { fmtClock, minuteOf } from "@/lib/sports/common";

export const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50";
export const btnPrimary = `${btn} bg-primary text-primary-fg`;
export const btnGhost = `${btn} border border-line bg-surface hover:border-primary`;
export const inputCls = "min-h-11 w-full rounded-xl border border-line bg-deep px-3 text-base text-fg outline-none focus-visible:border-primary";

const TONE: Record<string, string> = {
  score: "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25",
  card: "bg-amber-400/10 text-amber-300 border-amber-400/40 hover:bg-amber-400/20",
  penalty: "bg-accent/10 text-accent border-accent/40 hover:bg-accent/20",
  info: "bg-surface-2 text-fg border-line hover:border-primary",
  control: "bg-ok/10 text-ok border-ok/40 hover:bg-ok/20",
  danger: "bg-danger/10 text-danger border-danger/40 hover:bg-danger/20",
};

export function Badge({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "ok" | "warn" | "danger" | "primary" }) {
  const c = { info: "bg-surface-2 text-muted", ok: "bg-ok/15 text-ok", warn: "bg-amber-400/15 text-amber-300", danger: "bg-danger/15 text-danger", primary: "bg-primary/15 text-primary" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>{children}</span>;
}

/** Tikker uret lokalt mellem serveropdateringer. */
export function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [active, ms]);
  return now;
}

export function ClockView({ s, big }: { s: Summary; big?: boolean }) {
  const now = useNow(Boolean(s.clock?.running));
  if (!s.clock) return null;
  return <span className={`font-display tabular-nums ${big ? "text-6xl sm:text-8xl" : "text-3xl"}`}>{fmtClock(s.clock, now)}</span>;
}

const statusTone = (st: string) => (st === "live" ? "ok" : st === "finished" ? "primary" : st === "abandoned" || st === "postponed" ? "danger" : "info") as "ok" | "primary" | "danger" | "info";

/** Scoretavlen: to-side visning til dueller/holdkampe, liste til feltkonkurrencer. */
export function ScoreView({ s, shape, big, showFeed = true }: { s: Summary; shape: "team" | "duel" | "field"; big?: boolean; showFeed?: boolean }) {
  const duel = shape !== "field" && s.scores.length === 2;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-center gap-3 text-center">
        <Badge tone={statusTone(s.status)}>{s.status === "live" ? "● LIVE" : s.phase || s.status}</Badge>
        {s.status === "live" && s.phase ? <span className="text-sm text-muted">{s.phase}</span> : null}
        {s.resultType && s.status === "finished" ? <Badge tone="primary">{s.resultType}</Badge> : null}
      </div>
      {s.clock ? <div className="text-center"><ClockView s={s} big={big} /></div> : null}
      {duel ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {s.scores.map((x, i) => (
            <div key={x.id} className={`grid gap-1 ${i === 0 ? "order-1 text-right" : "order-3 text-left"}`}>
              <p className={`font-display leading-none ${big ? "text-4xl sm:text-6xl" : "text-2xl sm:text-3xl"} ${s.winnerId === x.id ? "text-primary" : ""}`}>
                {x.active ? <span className="mr-1 text-ok">●</span> : null}
                {x.name}
              </p>
              {x.sub ? <p className="text-sm text-muted">{x.sub}</p> : null}
              {x.detail?.length ? <ul className="grid gap-0.5 text-xs text-muted">{x.detail.filter(Boolean).slice(0, big ? 8 : 6).map((d, k) => <li key={k}>{d}</li>)}</ul> : null}
            </div>
          ))}
          <div className={`order-2 flex items-center gap-2 font-display tabular-nums ${big ? "text-7xl sm:text-9xl" : "text-5xl"}`}>
            <span>{s.scores[0].main}</span>
            <span className="text-muted">–</span>
            <span>{s.scores[1].main}</span>
          </div>
        </div>
      ) : (
        <ol className="grid gap-2">
          {s.scores.map((x) => (
            <li key={x.id} className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 ${x.out ? "opacity-60" : ""} ${s.winnerId === x.id ? "border-primary" : ""}`}>
              <span className="font-display text-2xl text-muted">{x.place ?? "–"}</span>
              <div className="min-w-0">
                <p className={`truncate font-display ${big ? "text-3xl" : "text-xl"}`}>{x.active ? <span className="mr-1 text-ok">●</span> : null}{x.name}</p>
                {x.sub ? <p className="truncate text-xs text-muted">{x.sub}</p> : null}
                {x.detail?.filter(Boolean).length ? <p className="truncate text-xs text-muted">{x.detail.filter(Boolean).join(" · ")}</p> : null}
              </div>
              <span className={`font-display tabular-nums ${big ? "text-4xl" : "text-2xl"}`}>{x.main}</span>
            </li>
          ))}
        </ol>
      )}
      {s.info.length ? <div className="flex flex-wrap justify-center gap-2">{s.info.map((i, k) => <Badge key={k}>{i}</Badge>)}</div> : null}
      {s.warnings.length ? <div className="grid gap-1">{s.warnings.map((w, k) => <p key={k} className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">⚠ {w}</p>)}</div> : null}
      {showFeed && s.feed.length ? (
        <ul className="grid max-h-72 gap-1 overflow-auto rounded-xl border border-line bg-surface p-3 text-sm">
          {s.feed.slice(0, big ? 10 : 40).map((f) => <li key={f.seq} className="flex gap-2"><span className="w-10 shrink-0 text-right text-muted tabular-nums">{f.minute ? `${f.minute}'` : ""}</span><span>{f.text}</span></li>)}
        </ul>
      ) : null}
    </div>
  );
}

/** Tid som "1:23.456", "83.4" eller "1:02:03.5" → millisekunder */
export function parseTime(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  let ms = 0;
  for (const n of nums) ms = ms * 60 + n;
  ms = Math.round(ms * 1000);
  return ms > 0 ? ms : null;
}

function FieldInput({ f, value, onChange, participants, members }: { f: ActionField; value: unknown; onChange: (v: unknown) => void; participants: Participant[]; members: string[] }) {
  const listId = `pl-${f.key}`;
  switch (f.kind) {
    case "bool":
      return <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />{f.label}</label>;
    case "choice":
      return <label className="grid gap-1 text-sm"><span>{f.label}</span><select className={inputCls} value={String(value ?? f.options?.[0]?.value ?? "")} onChange={(e) => onChange(e.target.value)}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
    case "side":
      return <label className="grid gap-1 text-sm"><span>{f.label}</span><select className={inputCls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">Vælg …</option>{participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
    case "player":
      return <label className="grid gap-1 text-sm"><span>{f.label}</span><input className={inputCls} list={listId} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder="Navn eller nummer" /><datalist id={listId}>{members.map((m) => <option key={m} value={m} />)}</datalist></label>;
    case "int":
    case "decimal":
      return <label className="grid gap-1 text-sm"><span>{f.label}</span><input className={inputCls} inputMode={f.kind === "int" ? "numeric" : "decimal"} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={f.min !== undefined ? `${f.min}–${f.max}` : ""} /></label>;
    case "time":
      return <label className="grid gap-1 text-sm"><span>{f.label}</span><input className={inputCls} inputMode="decimal" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder="fx 1:23.456 eller 10.52" /></label>;
    default:
      return <label className="grid gap-1 text-sm"><span>{f.label}</span><input className={inputCls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></label>;
  }
}

export type Submit = (ev: { type: string; side?: string; player?: string; minute?: number; data?: Record<string, unknown> }) => Promise<string | null>;

/** Kampstyring: knapper pr. side for dueller, pr. deltager for feltkonkurrencer, og fælles knapper. */
export function ActionPanel({ actions, participants, shape, summary, onSubmit, busy }: { actions: ActionDef[]; participants: Participant[]; shape: "team" | "duel" | "field"; summary: Summary; onSubmit: Submit; busy?: boolean }) {
  const [open, setOpen] = useState<{ a: ActionDef; side?: string } | null>(null);
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const members = useMemo(() => [...new Set(participants.flatMap((p) => p.members ?? []))], [participants]);

  async function fire(a: ActionDef, side?: string, values: Record<string, unknown> = {}) {
    setErr("");
    const data: Record<string, unknown> = { ...(a.preset ?? {}) };
    let player: string | undefined;
    for (const f of a.fields ?? []) {
      const v = values[f.key];
      if (f.kind === "player") { if (v) player = String(v).trim(); if (f.key !== "player" && v) data[f.key] = String(v).trim(); continue; }
      if (v === undefined || v === "") { if (!f.optional && f.kind !== "bool") { setErr(`Udfyld "${f.label}".`); return; } if (f.kind === "bool") data[f.key] = false; continue; }
      if (f.kind === "int") { const n = Number(String(v).replace(",", ".")); if (!Number.isInteger(n)) { setErr(`"${f.label}" skal være et helt tal.`); return; } data[f.key] = n; }
      else if (f.kind === "decimal") { const n = Number(String(v).replace(",", ".")); if (!Number.isFinite(n)) { setErr(`"${f.label}" skal være et tal.`); return; } data[f.key] = n; }
      else if (f.kind === "time") { const ms = parseTime(String(v)); if (!ms) { setErr("Skriv tiden som fx 1:23.456 eller 10.52."); return; } data[f.key] = ms; }
      else data[f.key] = v;
    }
    if (a.type === "player") { /* ingen */ }
    const minute = minuteOf(summary.clock);
    const e = await onSubmit({ type: a.type, side, player, minute, data });
    if (e) setErr(e);
    else { setOpen(null); setVals({}); }
  }
  function click(a: ActionDef, side?: string) {
    if (a.fields?.length) { setOpen({ a, side }); setVals({}); setErr(""); }
    else void fire(a, side);
  }

  const sideActs = actions.filter((a) => a.side);
  const common = actions.filter((a) => !a.side);
  const groups = (list: ActionDef[]) => [...new Set(list.map((a) => a.group))].map((g) => ({ g, list: list.filter((a) => a.group === g) }));
  const Btn = ({ a, side }: { a: ActionDef; side?: string }) => (
    <button type="button" disabled={busy} title={a.hint} onClick={() => click(a, side)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${TONE[a.tone ?? "info"]}`}>{a.label}</button>
  );
  const fieldParts = participants.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="grid gap-4">
      {err && !open ? <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{err}</p> : null}
      {sideActs.length ? (
        shape !== "field" && participants.length === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {participants.map((p) => (
              <section key={p.id} className="grid content-start gap-3 rounded-card border border-line bg-surface p-3">
                <h3 className="font-display text-2xl">{p.name}</h3>
                {groups(sideActs).map(({ g, list }) => (
                  <div key={g} className="grid gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">{g}</p>
                    <div className="flex flex-wrap gap-2">{list.map((a, i) => <Btn key={a.type + i} a={a} side={p.id} />)}</div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="grid gap-2">
            {participants.length > 8 ? <input className={inputCls} placeholder="Find deltager …" value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
            {fieldParts.map((p) => (
              <section key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                <span className="mr-auto min-w-32 font-display text-xl">{p.name}{p.lane ? <span className="ml-2 text-sm text-muted">bane {p.lane}</span> : null}</span>
                {sideActs.map((a, i) => <Btn key={a.type + i} a={a} side={p.id} />)}
              </section>
            ))}
          </div>
        )
      ) : null}
      {groups(common).map(({ g, list }) => (
        <div key={g} className="grid gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{g}</p>
          <div className="flex flex-wrap gap-2">{list.map((a, i) => <Btn key={a.type + i} a={a} />)}</div>
        </div>
      ))}
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <form className="grid w-full max-w-md gap-3 rounded-card border border-line bg-surface p-5" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void fire(open.a, open.side, vals); }}>
            <h3 className="font-display text-3xl">{open.a.label}{open.side ? <span className="text-muted"> · {participants.find((p) => p.id === open.side)?.name}</span> : null}</h3>
            {open.a.hint ? <p className="text-sm text-muted">{open.a.hint}</p> : null}
            {open.a.fields?.map((f) => (
              <FieldInput key={f.key} f={f} value={vals[f.key]} participants={participants} members={open.side ? participants.find((p) => p.id === open.side)?.members ?? members : members} onChange={(v) => setVals((x) => ({ ...x, [f.key]: v }))} />
            ))}
            {err ? <p className="text-sm text-danger" role="alert">{err}</p> : null}
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={busy}>Registrér</button>
              <button type="button" className={btnGhost} onClick={() => setOpen(null)}>Annuller</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { start: "Kampstart", pause: "Ur pauset", resume: "Ur fortsat", period_end: "Periode slut", period_start: "Ny periode", finish: "Kampen afsluttet", walkover: "Walkover", disqualify: "Diskvalifikation", abandon: "Afbrudt", postpone: "Udsat", reopen: "Genåbnet", clock_set: "Ur rettet" };

/** Hændelseslog med annullering (rettelse) – annullerede hændelser bliver stående, overstreget. */
export function EventLog({ events, participants, onVoid, canVoid, labels = {} }: { events: MatchEvent[]; participants: Participant[]; onVoid?: (e: MatchEvent) => void; canVoid?: boolean; labels?: Record<string, string> }) {
  const name = (id?: string) => participants.find((p) => p.id === id)?.name ?? "";
  const list = events.slice().sort((a, b) => b.seq - a.seq);
  if (!list.length) return <p className="text-sm text-muted">Ingen hændelser endnu.</p>;
  return (
    <ul className="grid gap-1 text-sm">
      {list.map((e) => (
        <li key={e.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-1.5 ${e.voided ? "opacity-50" : ""}`}>
          <span className="w-8 text-xs text-muted tabular-nums">#{e.seq}</span>
          <span className={`min-w-0 flex-1 ${e.voided ? "line-through" : ""}`}>
            <b className="font-semibold">{TYPE_LABEL[e.type] ?? labels[e.type] ?? e.type}</b>
            {e.side ? ` · ${name(e.side)}` : ""}
            {e.player ? ` · ${e.player}` : ""}
            {e.minute ? ` · ${e.minute}'` : ""}
            {e.data && Object.keys(e.data).length ? ` · ${Object.entries(e.data).filter(([, v]) => v !== "" && v !== false).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ")}` : ""}
          </span>
          <span className="text-xs text-muted">{new Date(e.at).toLocaleTimeString("da-DK")}{e.byName ? ` · ${e.byName}` : ""}</span>
          {e.voided ? <Badge tone="danger">Annulleret: {e.voided.reason}</Badge> : canVoid && onVoid ? <button type="button" className="rounded-lg border border-line px-2 py-1 text-xs hover:border-danger hover:text-danger" onClick={() => onVoid(e)}>Annullér</button> : null}
        </li>
      ))}
    </ul>
  );
}
