import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { inputClass } from "@/components/auth-card";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMe } from "@/lib/venues";
import { hasPermission } from "@/lib/roles";
import { STATUS_LABEL, SUPPORT_CATEGORIES, SUPPORT_STATUSES } from "@/lib/support-shared";
import { changeSupportTicket, supportQueue } from "@/lib/support";

export const Route = createFileRoute("/support-center")({ component: SupportCenterPage });

function SupportCenterPage() {
  const { user, isPending } = useCurrentUserState();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof supportQueue>> | null>(null);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  function load(next = { status, category, query }) {
    supportQueue({ data: next }).then(setData).catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    if (!user) return;
    getMe()
      .then((profile) => {
        const ok = hasPermission(profile.role, "MANAGE_SUPPORT");
        setAllowed(ok);
        if (ok) load({ status: "", category: "", query: "" });
      })
      .catch(() => setAllowed(false));
  }, [user]);

  if (isPending || (user && allowed === null)) {
    return <SiteShell><div className="mx-auto max-w-6xl px-4 py-16"><div className="h-12 w-64 animate-pulse rounded-xl bg-surface-2" /></div></SiteShell>;
  }
  if (!user) return <RedirectToSignIn />;
  if (!allowed) {
    return <SiteShell><div className="mx-auto max-w-3xl px-4 py-16"><h1 className="font-display text-5xl">Du har ikke adgang til Support Center.</h1></div></SiteShell>;
  }

  const counts = data?.counts;
  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="font-display text-lg tracking-widest text-primary">ADMINISTRATION</p>
        <h1 className="font-display text-5xl">Support Center</h1>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Nye", counts?.new ?? 0],
            ["Under behandling", counts?.open ?? 0],
            ["Afventer bruger", counts?.waiting ?? 0],
            ["Løste", counts?.solved ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-card border border-line bg-surface p-4">
              <b className="font-display text-4xl text-primary">{value}</b>
              <p className="text-sm text-muted">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <select className={inputClass} value={status} onChange={(event) => { setStatus(event.target.value); load({ status: event.target.value, category, query }); }}>
            <option value="">Alle statusser</option>
            {SUPPORT_STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
          </select>
          <select className={inputClass} value={category} onChange={(event) => { setCategory(event.target.value); load({ status, category: event.target.value, query }); }}>
            <option value="">Alle kategorier</option>
            {SUPPORT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <input className={inputClass} placeholder="Søg navn, e-mail eller sag" value={query} onChange={(event) => setQuery(event.target.value)} onBlur={() => load()} />
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 grid gap-3">
          {(data?.tickets || []).map((ticket) => (
            <article key={ticket.code} className="rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link to="/support" search={{ sag: ticket.code, k: "" }} className="font-display text-3xl text-primary">{ticket.code}</Link>
                  <h2 className="text-lg">{ticket.subject}</h2>
                  <p className="text-sm text-muted">{ticket.name} · {ticket.email} · {ticket.category} · {ticket.statusLabel}</p>
                </div>
                <label className="grid gap-1 text-xs text-muted">
                  Tildel
                  <select className={inputClass} defaultValue="" onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    void changeSupportTicket({ data: { code: ticket.code, assigneeId: value === "none" ? "" : value } }).then(() => load()).catch((err: Error) => setError(err.message));
                    event.target.value = "";
                  }}>
                    <option value="">{ticket.assigneeName || "Ikke tildelt"}</option>
                    <option value="none">Fjern tildeling</option>
                    {(data?.staff || []).map((person) => <option key={person.userId} value={person.userId}>{person.name}</option>)}
                  </select>
                </label>
              </div>
            </article>
          ))}
          {data && data.tickets.length === 0 ? <p className="text-muted">Ingen sager matcher.</p> : null}
        </div>
      </div>
    </SiteShell>
  );
}
