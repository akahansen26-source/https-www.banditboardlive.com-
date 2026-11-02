import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SiteShell } from "@/components/site-shell";
import { Field, inputClass } from "@/components/auth-card";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  createVenueAccount,
  deleteVenueAccount,
  getMe,
  getSiteSettings,
  listVenueAccounts,
  listAuditLog,
  newAccessCode,
  saveSiteSettings,
  setUserRole,
  setAccountStatus,
  setVenueActive,
  updateVenueAccount,
  type PublicProfile,
  type PublicSettings,
  type VenueDraft,
} from "@/lib/venues";
import { ACCOUNT_STATUS_LABEL, ASSIGNABLE_ROLES, ROLE_BLURB, ROLE_LABEL, canAssignRoles, canEditSiteSettings, canManageVenues, canOpenAdmin, hasPermission } from "@/lib/roles";

export const Route = createFileRoute("/admin")({ component: AdminPage });

const blank: VenueDraft = {
  venueName: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  postalCode: "",
  city: "",
  notes: "",
  accessCode: "",
};

function AdminPage() {
  const { user, isPending } = useCurrentUserState();
  const [me, setMe] = useState<PublicProfile | null>(null);
  const [venues, setVenues] = useState<PublicProfile[]>([]);
  const [draft, setDraft] = useState<VenueDraft>(blank);
  const [created, setCreated] = useState<{ name: string; email: string; code: string } | null>(null);
  const [settings, setSettings] = useState<PublicSettings>({
    facebook: "",
    instagram: "",
    youtube: "",
    contactEmail: "",
    contactPhone: "",
  });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof listAuditLog>>>([]);

  async function reload() {
    const profile = await getMe();
    setMe(profile);
    const site = await getSiteSettings();
    setSettings(site);
    if (canManageVenues(profile.role)) setVenues(await listVenueAccounts());
    else setVenues([]);
    if (hasPermission(profile.role, "MANAGE_USERS") || hasPermission(profile.role, "MANAGE_ROLES")) {
      setAudit(await listAuditLog());
    }
  }

  useEffect(() => {
    if (!user) return;
    reload().catch((err: Error) => setError(err.message || "Admin kunne ikke åbnes."));
  }, [user]);

  if (isPending || (user && !me && !error)) {
    return (
      <SiteShell>
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="h-12 w-72 animate-pulse rounded-xl bg-surface-2" />
        </div>
      </SiteShell>
    );
  }
  if (!user) return <RedirectToSignIn />;
  if (!me || !canOpenAdmin(me.role)) {
    return (
      <SiteShell>
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="font-display text-5xl">Kun administrator</h1>
          <p className="mt-3 text-muted">{error || "Kun en administrator kan bruge den her side."}</p>
          <Link to="/konto" className="mt-6 inline-flex min-h-11 items-center text-primary">
            Tilbage til kontoen
          </Link>
        </div>
      </SiteShell>
    );
  }

  function patch<K extends keyof VenueDraft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNote("");
    setPending(true);
    try {
      const result = await createVenueAccount({ data: draft });
      setCreated({ name: result.profile.venueName, email: result.profile.email, code: result.accessCode });
      setDraft(blank);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Brugeren kunne ikke oprettes.");
    } finally {
      setPending(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setNote("Koden er kopieret.");
    } catch {
      setNote("Markér koden og kopiér den selv.");
    }
  }

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10">
        <div>
          <p className="font-display text-lg tracking-widest text-accent">ADMIN</p>
          <h1 className="font-display text-5xl sm:text-6xl">Pubber og klubber</h1>
          <p className="mt-2 max-w-2xl text-muted">
            {canAssignRoles(me.role)
              ? "Søg en bruger frem og vælg rollen. Gæster kan ikke åbne scoreboardet."
              : "Du kan det, din rolle giver adgang til."}
          </p>
          {canAssignRoles(me.role) ? (
            <ul className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
              {ASSIGNABLE_ROLES.map((role) => (
                <li key={role} className="rounded-xl border border-line bg-surface px-3 py-2">
                  <span className="text-primary">{ROLE_LABEL[role]}</span>
                  <span className="mt-1 block">{ROLE_BLURB[role]}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <form onSubmit={onCreate} className={`grid gap-4 rounded-card border border-line bg-surface p-5 ${canManageVenues(me.role) ? "" : "hidden"}`}>
          <h2 className="font-display text-3xl">Ny bruger</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pub, klub eller sted">
              <input className={inputClass} required value={draft.venueName} onChange={(e) => patch("venueName", e.target.value)} placeholder="Sanderum Pubben" />
            </Field>
            <Field label="Kontaktperson">
              <input className={inputClass} value={draft.contactName} onChange={(e) => patch("contactName", e.target.value)} />
            </Field>
            <Field label="E-mail">
              <input className={inputClass} type="email" required value={draft.email} onChange={(e) => patch("email", e.target.value)} placeholder="kontakt@sanderumpubben.dk" />
            </Field>
            <Field label="Telefon">
              <input className={inputClass} value={draft.phone} onChange={(e) => patch("phone", e.target.value)} />
            </Field>
            <Field label="Adresse">
              <input className={inputClass} value={draft.address} onChange={(e) => patch("address", e.target.value)} />
            </Field>
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Field label="Postnr.">
                <input className={inputClass} value={draft.postalCode} onChange={(e) => patch("postalCode", e.target.value)} />
              </Field>
              <Field label="By">
                <input className={inputClass} value={draft.city} onChange={(e) => patch("city", e.target.value)} />
              </Field>
            </div>
          </div>
          <Field label="Note">
            <input className={inputClass} value={draft.notes} onChange={(e) => patch("notes", e.target.value)} placeholder="Udlånt til klubaften, hentes fredag…" />
          </Field>
          <Field label="Adgangskode — lad feltet stå tomt, så laves den selv">
            <input className={inputClass} value={draft.accessCode} onChange={(e) => patch("accessCode", e.target.value)} placeholder="SAND-4821" autoComplete="off" />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button type="submit" disabled={pending} className="min-h-12 rounded-xl bg-primary font-display text-2xl text-primary-fg disabled:opacity-60">
            {pending ? "Opretter…" : "Opret bruger og kode"}
          </button>
        </form>

        {created ? (
          <section className="rounded-card border border-primary bg-deep p-5">
            <p className="text-sm text-muted">{created.name} kan logge ind med</p>
            <p className="mt-1 text-sm">{created.email}</p>
            <p className="mt-2 font-display text-6xl text-primary">{created.code}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-xl bg-surface-2 px-4" onClick={() => void copy(created.code)}>
                Kopiér kode
              </button>
              <button type="button" className="min-h-11 rounded-xl px-4 text-muted" onClick={() => setCreated(null)}>
                Skjul
              </button>
            </div>
          </section>
        ) : null}

        {canManageVenues(me.role) ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-3xl">Brugere</h2>
            <label className="grid min-w-64 flex-1 gap-1 text-sm">
              <span className="text-muted">Søg</span>
              <input
                className={inputClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Navn eller e-mail, f.eks. bror"
              />
            </label>
          </div>
          {note ? <p className="text-sm text-ok">{note}</p> : null}
          {venues
            .filter((venue) => {
              const q = query.trim().toLowerCase();
              if (!q) return true;
              return [venue.venueName, venue.accountName, venue.email, venue.contactName, venue.phone]
                .join(" ")
                .toLowerCase()
                .includes(q);
            })
            .map((venue) => (
            <article key={venue.userId} className="rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-3xl">{venue.venueName || venue.accountName}</h3>
                  <p className="text-sm text-muted">
                    {venue.email}
                    {venue.contactName ? ` · ${venue.contactName}` : ""}
                    {venue.phone ? ` · ${venue.phone}` : ""}
                  </p>
                  <p className="text-sm text-muted">
                    {[venue.address, venue.postalCode, venue.city].filter(Boolean).join(", ") || "Ingen adresse endnu"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs tracking-wide text-muted">
                    {ROLE_LABEL[venue.role]}
                    {venue.accountStatus !== "approved" ? ` · ${ACCOUNT_STATUS_LABEL[venue.accountStatus]}` : ""}
                    {venue.role !== "admin" && venue.role !== "administrator_manager" && !venue.active ? " · LUKKET" : ""}
                  </p>
                  <p className="font-display text-3xl text-primary">{venue.accessCode || "—"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {canAssignRoles(me.role) && venue.userId !== me.userId ? (
                  <label className="grid gap-1 text-xs text-muted">
                    <span>Rolle</span>
                    <select
                      className={inputClass}
                      value={venue.role}
                      onChange={(event) => {
                        const role = event.target.value as (typeof ASSIGNABLE_ROLES)[number];
                        const label = venue.venueName || venue.email;
                        void setUserRole({ data: { userId: venue.userId, role } })
                          .then(async () => {
                            setNote(`${label} er nu ${ROLE_LABEL[role]}.`);
                            await reload();
                          })
                          .catch((err: Error) => setError(err.message));
                      }}
                    >
                      {ASSIGNABLE_ROLES.filter((role) => hasPermission(me.role, "MANAGE_MANAGERS") || role !== "administrator_manager").map((role) => (
                        <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                      ))}
                    </select>
                  </label>
                ) : venue.userId === me.userId ? (
                  <span className="inline-flex min-h-11 items-center px-3 text-sm text-muted">Det er dig</span>
                ) : null}
                {canManageVenues(me.role) && venue.userId !== me.userId && venue.accountStatus !== "approved" ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-xl bg-primary px-3 font-display text-xl text-primary-fg"
                    onClick={() => {
                      void setAccountStatus({ data: { userId: venue.userId, status: "approved" } })
                        .then(async () => {
                          setNote(`${venue.venueName || venue.email} er godkendt.`);
                          await reload();
                        })
                        .catch((err: Error) => setError(err.message));
                    }}
                  >
                    Godkend
                  </button>
                ) : null}
                {canManageVenues(me.role) && venue.userId !== me.userId && venue.accountStatus === "pending" ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-xl border border-line px-3 text-sm"
                    onClick={() => {
                      void setAccountStatus({ data: { userId: venue.userId, status: "rejected" } })
                        .then(async () => {
                          setNote(`${venue.venueName || venue.email} er afvist.`);
                          await reload();
                        })
                        .catch((err: Error) => setError(err.message));
                    }}
                  >
                    Afvis
                  </button>
                ) : null}
                {venue.accessCode ? (
                  <button type="button" className="min-h-11 rounded-xl border border-line px-3 text-sm" onClick={() => void copy(venue.accessCode)}>
                    Kopiér kode
                  </button>
                ) : null}
                <button type="button" className="min-h-11 rounded-xl border border-line px-3 text-sm" onClick={() => setOpenId(openId === venue.userId ? null : venue.userId)}>
                  {openId === venue.userId ? "Luk" : "Ret"}
                </button>
                {venue.role !== "admin" && venue.role !== "administrator_manager" && canManageVenues(me.role) ? (
                  <>
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border border-line px-3 text-sm"
                      onClick={() => {
                        void newAccessCode({ data: { userId: venue.userId } })
                          .then(async (next) => {
                            setNote(`Ny kode til ${next.venueName}: ${next.accessCode}`);
                            setCreated({ name: next.venueName, email: next.email, code: next.accessCode });
                            await reload();
                          })
                          .catch((err: Error) => setError(err.message));
                      }}
                    >
                      Ny kode
                    </button>
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border border-line px-3 text-sm"
                      onClick={() => {
                        void setVenueActive({ data: { userId: venue.userId, active: !venue.active } })
                          .then(() => reload())
                          .catch((err: Error) => setError(err.message));
                      }}
                    >
                      {venue.active ? "Luk adgang" : "Åbn adgang"}
                    </button>
                    {canAssignRoles(me.role) ? (
                    <button
                      type="button"
                      className="min-h-11 rounded-xl px-3 text-sm text-danger"
                      onClick={() => {
                        if (!window.confirm(`Slet ${venue.venueName || venue.email}? Deres tavle slettes også.`)) return;
                        void deleteVenueAccount({ data: { userId: venue.userId } })
                          .then(() => reload())
                          .catch((err: Error) => setError(err.message));
                      }}
                    >
                      Slet
                    </button>
                    ) : null}
                  </>
                ) : null}
              </div>
              {openId === venue.userId ? <VenueEditor venue={venue} onSaved={() => void reload().then(() => setNote("Oplysningerne er gemt."))} /> : null}
            </article>
          ))}
          {query.trim() &&
          !venues.some((venue) =>
            [venue.venueName, venue.accountName, venue.email, venue.contactName, venue.phone]
              .join(" ")
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          ) ? (
            <p className="text-sm text-muted">Ingen brugere matcher søgningen.</p>
          ) : null}
        </section>
        ) : null}

        {hasPermission(me.role, "MANAGE_USERS") || hasPermission(me.role, "MANAGE_ROLES") ? (
        <section className="grid gap-2 rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-3xl">Log</h2>
          <ul className="grid gap-2">
            {audit.length === 0 ? <li className="text-sm text-muted">Ingen handlinger endnu.</li> : null}
            {audit.map((row) => (
              <li key={row.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                <p className="text-muted">{new Date(row.at).toLocaleString("da-DK")} · {ROLE_LABEL[row.actorRole as keyof typeof ROLE_LABEL] || row.actorRole}</p>
                <p><span className="font-semibold">{row.actorName || "Bruger"}</span> · {row.action}</p>
                {row.detail ? <p className="text-muted">{row.detail}</p> : null}
              </li>
            ))}
          </ul>
        </section>
        ) : null}

        {canEditSiteSettings(me.role) ? (
        <form
          className="grid gap-4 rounded-card border border-line bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            void saveSiteSettings({ data: settings })
              .then((next) => {
                setSettings(next);
                setNote("Bunden af siden er opdateret.");
              })
              .catch((err: Error) => setError(err.message));
          }}
        >
          <h2 className="font-display text-3xl">Bund og sociale medier</h2>
          <p className="text-sm text-muted">Links skal starte med https://. Ikonerne vises altid nederst — de bliver klikbare, når der står et link.</p>
          <Field label="Facebook">
            <input className={inputClass} value={settings.facebook} onChange={(e) => setSettings({ ...settings, facebook: e.target.value })} placeholder="https://facebook.com/…" />
          </Field>
          <Field label="Instagram">
            <input className={inputClass} value={settings.instagram} onChange={(e) => setSettings({ ...settings, instagram: e.target.value })} placeholder="https://instagram.com/…" />
          </Field>
          <Field label="YouTube">
            <input className={inputClass} value={settings.youtube} onChange={(e) => setSettings({ ...settings, youtube: e.target.value })} placeholder="https://youtube.com/…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Telefon i bunden">
              <input className={inputClass} value={settings.contactPhone} onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })} />
            </Field>
            <Field label="Mail i bunden">
              <input className={inputClass} value={settings.contactEmail} onChange={(e) => setSettings({ ...settings, contactEmail: e.target.value })} />
            </Field>
          </div>
          <button type="submit" className="min-h-12 rounded-xl bg-surface-2 font-display text-2xl">
            Gem bunden
          </button>
        </form>
        ) : null}
      </div>
    </SiteShell>
  );
}

function VenueEditor({ venue, onSaved }: { venue: PublicProfile; onSaved: () => void }) {
  const [form, setForm] = useState(venue);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  return (
    <form
      className="mt-4 grid gap-3 border-t border-line pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setLocalError("");
        void updateVenueAccount({
          data: {
            userId: venue.userId,
            venueName: form.venueName,
            contactName: form.contactName,
            email: form.email,
            phone: form.phone,
            address: form.address,
            postalCode: form.postalCode,
            city: form.city,
            notes: form.notes,
            accessCode: "",
          },
        })
          .then(() => onSaved())
          .catch((err: Error) => setLocalError(err.message))
          .finally(() => setBusy(false));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Navn">
          <input className={inputClass} value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} />
        </Field>
        <Field label="Kontaktperson">
          <input className={inputClass} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </Field>
        <Field label="Telefon">
          <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Adresse">
          <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Postnr.">
          <input className={inputClass} value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
        </Field>
        <Field label="By">
          <input className={inputClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
      </div>
      <Field label="Note">
        <input className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
      {localError ? <p className="text-sm text-danger">{localError}</p> : null}
      <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-primary px-4 font-display text-xl text-primary-fg disabled:opacity-60">
        {busy ? "Gemmer…" : "Gem ændringer"}
      </button>
    </form>
  );
}
