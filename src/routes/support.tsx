import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SiteShell } from "@/components/site-shell";
import { inputClass } from "@/components/auth-card";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { STATUS_LABEL, SUPPORT_STATUSES, type SupportStatus } from "@/lib/support-shared";
import { answerSupportTicket, changeSupportTicket, mySupportTickets, openSupportTicket } from "@/lib/support";

export const Route = createFileRoute("/support")({
  validateSearch: (search: Record<string, unknown>) => ({
    sag: typeof search.sag === "string" ? search.sag.slice(0, 20) : "",
    k: typeof search.k === "string" ? search.k.slice(0, 80) : "",
  }),
  component: SupportPage,
});

type Opened = Awaited<ReturnType<typeof openSupportTicket>>;

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("da-DK");
}

function SupportPage() {
  const { sag, k } = Route.useSearch();
  const { user } = useCurrentUserState();
  const [mine, setMine] = useState<Awaited<ReturnType<typeof mySupportTickets>>>([]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user) { setMine([]); return; }
    mySupportTickets().then(setMine).catch(() => setMine([]));
  }, [user]);

  useEffect(() => {
    if (!sag) { setOpened(null); return; }
    setError("");
    openSupportTicket({ data: { code: sag, token: k } })
      .then(setOpened)
      .catch((err: Error) => { setOpened(null); setError(err.message); });
  }, [sag, k]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!opened) return;
    setPending(true);
    setError("");
    try {
      const next = await answerSupportTicket({ data: { code: opened.ticket.code, token: k, body, internal } });
      setOpened(next);
      setBody("");
      setInternal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Svaret kunne ikke sendes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 lg:grid-cols-[280px_1fr]">
        <aside>
          <p className="font-display text-lg tracking-widest text-primary">MIN SUPPORT</p>
          <h1 className="font-display text-4xl">Mine sager</h1>
          <Link to="/kontakt" className="mt-3 inline-flex min-h-11 items-center text-sm text-primary">Ny besked</Link>
          <div className="mt-4 grid gap-2">
            {mine.map((ticket) => (
              <Link key={ticket.code} to="/support" search={{ sag: ticket.code, k: "" }} className="rounded-xl border border-line bg-surface px-3 py-2">
                <b>{ticket.code}</b>
                <span className="mt-1 block text-sm">{ticket.subject}</span>
                <span className="text-xs text-muted">{ticket.statusLabel}</span>
              </Link>
            ))}
            {user && mine.length === 0 ? <p className="text-sm text-muted">Du har ingen sager endnu.</p> : null}
            {!user ? <p className="text-sm text-muted">Log ind for at se dine sager, eller åbn linket fra kvitteringen.</p> : null}
          </div>
        </aside>
        <section className="rounded-card border border-line bg-surface p-5">
          {!sag ? <p className="text-muted">Vælg en sag, eller send en ny besked.</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {opened ? (
            <>
              <p className="text-sm text-primary">{opened.ticket.code} · {opened.ticket.category}</p>
              <h2 className="font-display text-4xl">{opened.ticket.subject}</h2>
              <p className="mt-1 text-sm text-muted">
                {opened.ticket.statusLabel}
                {opened.ticket.tournament ? ` · ${opened.ticket.tournament}` : ""}
                {opened.ticket.tableName ? ` · ${opened.ticket.tableName}` : ""}
                {opened.ticket.assigneeName ? ` · Tildelt ${opened.ticket.assigneeName}` : ""}
              </p>
              {opened.staff ? (
                <label className="mt-4 grid gap-1 text-sm text-muted">
                  Status
                  <select className={inputClass} value={opened.ticket.status} onChange={(event) => {
                    const status = event.target.value as SupportStatus;
                    void changeSupportTicket({ data: { code: opened.ticket.code, status } }).then(setOpened).catch((err: Error) => setError(err.message));
                  }}>
                    {SUPPORT_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="mt-5 grid gap-3">
                {opened.messages.map((message) => (
                  <article key={message.id} className={`rounded-xl border px-4 py-3 ${message.internal ? "border-primary/40 bg-bg" : "border-line"}`}>
                    <p className="text-sm text-muted">{message.authorName} · {when(message.at)}{message.internal ? " · Intern note" : ""}</p>
                    <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
                    {message.attachmentData.startsWith("data:image/") ? <img src={message.attachmentData} alt="" className="mt-2 max-h-64 rounded-lg" /> : null}
                    {message.attachmentType === "application/pdf" ? <a className="mt-2 inline-block text-primary" href={message.attachmentData} download={message.attachmentName}>{message.attachmentName}</a> : null}
                  </article>
                ))}
              </div>
              <form className="mt-4 grid gap-3" onSubmit={send}>
                <textarea className={`${inputClass} min-h-28`} value={body} onChange={(event) => setBody(event.target.value)} placeholder={opened.staff && internal ? "Intern note. Brugeren kan ikke se den." : "Skriv et svar"} />
                {opened.staff ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />Intern note</label> : null}
                <button type="submit" disabled={pending} className="min-h-12 rounded-xl bg-primary font-display text-2xl text-primary-fg disabled:opacity-60">{pending ? "Sender…" : internal ? "Gem note" : "Send svar"}</button>
              </form>
            </>
          ) : null}
        </section>
      </div>
    </SiteShell>
  );
}
