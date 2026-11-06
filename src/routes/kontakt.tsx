import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SiteShell } from "@/components/site-shell";
import { Field, inputClass } from "@/components/auth-card";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMe } from "@/lib/venues";
import { SUPPORT_CATEGORIES } from "@/lib/support-shared";
import { sendSupportMessage, supportBoardHints } from "@/lib/support";

export const Route = createFileRoute("/kontakt")({ component: ContactPage });

function readUpload(file: File) {
  return new Promise<{ name: string; type: string; data: string }>((resolve, reject) => {
    if (file.size > 600000) {
      reject(new Error("Filen må højst være 600 KB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Filen kunne ikke læses."));
    reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result || "") });
    reader.readAsDataURL(file);
  });
}

function ContactPage() {
  const { user } = useCurrentUserState();
  const [form, setForm] = useState({
    name: "",
    email: "",
    category: "Teknisk hjælp",
    subject: "",
    tournament: "",
    tableName: "",
    message: "",
    company: "",
  });
  const [file, setFile] = useState<{ name: string; type: string; data: string } | null>(null);
  const [hints, setHints] = useState<{ tournaments: string[]; tables: string[] }>({ tournaments: [], tables: [] });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ code: string; token: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    getMe()
      .then((profile) => {
        setForm((current) => ({
          ...current,
          name: current.name || profile.contactName || profile.venueName,
          email: current.email || profile.email,
        }));
      })
      .catch(() => undefined);
    supportBoardHints()
      .then(setHints)
      .catch(() => undefined);
  }, [user]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await sendSupportMessage({ data: { ...form, file } });
      setDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beskeden kunne ikke sendes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SiteShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="font-display text-lg tracking-widest text-primary">SUPPORT</p>
        <h1 className="mt-1 font-display text-5xl">Kontakt BanditBoard Live</h1>
        <p className="mt-3 text-muted">Har du spørgsmål, problemer eller forslag? Send os en besked, så vender vi tilbage hurtigst muligt.</p>
        {done ? (
          <div className="mt-8 rounded-card border border-line bg-surface p-6">
            <h2 className="font-display text-3xl">Tak for din besked. Din henvendelse er modtaget.</h2>
            <p className="mt-3 text-lg">Din sag: <b className="text-primary">{done.code}</b></p>
            <p className="mt-2 text-sm text-muted">Gem nummeret. Svaret ligger på sagen. E-mail og push sendes, når de er koblet på.</p>
            <Link to="/support" search={{ sag: done.code, k: done.token }} className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-display text-2xl text-primary-fg">
              Åbn sagen
            </Link>
          </div>
        ) : (
          <form className="mt-8 grid gap-4" onSubmit={onSubmit}>
            <input className="hidden" tabIndex={-1} autoComplete="off" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} aria-hidden="true" />
            <Field label="Navn"><input className={inputClass} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="E-mail"><input className={inputClass} type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
            <Field label="Kategori">
              <select className={inputClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {SUPPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            </Field>
            <Field label="Emne"><input className={inputClass} required value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></Field>
            <Field label="Turnering (valgfri)">
              <input className={inputClass} list="tours" value={form.tournament} onChange={(event) => setForm({ ...form, tournament: event.target.value })} />
              <datalist id="tours">{hints.tournaments.map((name) => <option key={name} value={name} />)}</datalist>
            </Field>
            <Field label="Kamp eller bord (valgfri)">
              <input className={inputClass} list="tables" placeholder="Bord 1" value={form.tableName} onChange={(event) => setForm({ ...form, tableName: event.target.value })} />
              <datalist id="tables">{hints.tables.map((name) => <option key={name} value={name} />)}</datalist>
            </Field>
            <Field label="Besked">
              <textarea className={`${inputClass} min-h-36`} required value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
            </Field>
            <Field label="Vedhæft fil (valgfri)">
              <input className={inputClass} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => {
                const next = event.target.files?.[0];
                if (!next) { setFile(null); return; }
                readUpload(next).then(setFile).catch((err: Error) => { setFile(null); setError(err.message); });
              }} />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button type="submit" disabled={pending} className="min-h-12 rounded-xl bg-primary font-display text-2xl text-primary-fg disabled:opacity-60">
              {pending ? "Sender…" : "Send besked"}
            </button>
          </form>
        )}
      </div>
    </SiteShell>
  );
}
