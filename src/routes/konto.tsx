import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  Clapperboard,
  History,
  LayoutGrid,
  MonitorPlay,
  Settings,
  Shield,
  Smartphone,
  Trophy,
  Tv,
  Users,
} from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { Field, inputClass } from "@/components/auth-card";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMe, getOverlayKey, saveMyProfile, deleteMyAccount, setMyPublicLive, type PublicProfile } from "@/lib/venues";
import { ACCOUNT_STATUS_LABEL, ROLE_LABEL, canOpenAdmin, canOpenBoard, canRunLiveBoard, hasPermission } from "@/lib/roles";
import { signOut } from "@/lib/auth/client";

export const Route = createFileRoute("/konto")({ component: AccountPage });

const tools = [
  { href: "/board.html", icon: Trophy, title: "Scoreboard", text: "Spil, point, skæve og aktiv spiller." },
  { href: "/board.html#players", icon: Users, title: "Kartotek", text: "Spillere, hold og import." },
  { href: "/board.html#tour", icon: LayoutGrid, title: "Turneringer", text: "Gem, åbn og kør turneringen." },
  { href: "/board.html#matrix", icon: LayoutGrid, title: "Oversigt", text: "Hold, borde og kampprogram." },
  { href: "/board.html#tv", icon: Tv, title: "TV", text: "Storskærm til bord 1." },
  { href: "/board.html#overlay/1", icon: MonitorPlay, title: "OBS", text: "Overlay i 1920×1080." },
  { href: "/board.html#turnering", icon: Clapperboard, title: "Turneringsskærm", text: "Oversigten til storskærm." },
  { href: "/board.html#sponsor", icon: Clapperboard, title: "Sponsorer", text: "Sponsorboardet alene." },
  { href: "/board.html#history", icon: History, title: "Historik", text: "Kampe, point og eksport." },
  { href: "/board.html#settings", icon: Settings, title: "Indstillinger", text: "Design, timer, borde og remote." },
  { href: "/board.html#remote", icon: Smartphone, title: "Remote", text: "Koder til telefonen på aftenen." },
  { href: "/board.html#mig", icon: Users, title: "Spillernes side", text: "QR, så spillerne kan se sig selv." },
];

function AccountPage() {
  const { user, isPending } = useCurrentUserState();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [obsKey, setObsKey] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!user) return;
    getMe()
      .then(async (next) => {
        setProfile(next);
        if (canRunLiveBoard(next.role)) setObsKey(await getOverlayKey());
      })
      .catch((err: Error) => setError(err.message || "Kontoen kunne ikke hentes."));
  }, [user]);

  if (isPending) {
    return (
      <SiteShell>
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="h-12 w-64 animate-pulse rounded-xl bg-surface-2" />
        </div>
      </SiteShell>
    );
  }
  if (!user) return <RedirectToSignIn />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setPending(true);
    setSaved("");
    setError("");
    try {
      const next = await saveMyProfile({
        data: {
          venueName: profile.venueName,
          contactName: profile.contactName,
          email: profile.email,
          phone: profile.phone,
          address: profile.address,
          postalCode: profile.postalCode,
          city: profile.city,
          notes: profile.notes,
          accessCode: "",
        },
      });
      setProfile(next);
      setSaved("Oplysningerne er gemt.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gemme.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="font-display text-lg tracking-widest text-primary">LOGGET IND</p>
        <h1 className="mt-1 font-display text-5xl sm:text-6xl">{profile?.venueName || user.displayName || "Din konto"}</h1>
        <p className="mt-2 text-muted">{profile?.email || user.primaryEmail}</p>
        {profile && profile.accountStatus !== "approved" ? (
          <p className="mt-4 rounded-xl border border-primary/40 bg-surface px-4 py-3 text-sm">
            {ACCOUNT_STATUS_LABEL[profile.accountStatus]}. En administrator skal godkende kontoen, før scoreboardet kan åbnes. Du kan stadig se den offentlige live-side.
          </p>
        ) : null}
        {profile && canRunLiveBoard(profile.role) && profile.accountStatus === "approved" ? (
          <div className="mt-4 rounded-card border border-line bg-surface p-4">
            <h2 className="font-display text-3xl">Offentlig live</h2>
            <p className="mt-1 text-sm text-muted">
              Slå det til, hvis gæster uden login må se kampene på Live-siden. E-mail, koder og admin-oplysninger vises ikke.
            </p>
            <button
              type="button"
              className="mt-3 min-h-12 rounded-xl bg-primary px-4 font-display text-2xl text-primary-fg"
              onClick={() => {
                void setMyPublicLive({ data: { on: !profile.publicLive } })
                  .then((next) => {
                    setProfile(next);
                    setSaved(next.publicLive ? "Tavlen vises på Live-siden." : "Tavlen er skjult for gæster.");
                  })
                  .catch((err: Error) => setError(err.message));
              }}
            >
              {profile.publicLive ? "Skjul tavlen" : "Vis tavlen offentligt"}
            </button>
          </div>
        ) : null}
        {profile ? <p className="mt-1 text-sm text-primary">{ROLE_LABEL[profile.role]}</p> : null}
        <Link to="/support" search={{ sag: "", k: "" }} className="mt-3 inline-flex text-sm text-primary">Min support</Link>
        {obsKey ? (
          <div className="mt-6 rounded-card border border-line bg-surface p-4">
            <h2 className="font-display text-3xl">OBS-overlay</h2>
            <p className="mt-1 text-sm text-muted">
              Sæt den her adresse i OBS under Browser. Bredde 1920, højde 1080. OBS er ikke logget ind, derfor virker det almindelige overlay-link ikke der.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                className={inputClass}
                value={`${typeof window === "undefined" ? "" : window.location.origin}/board.html?obs=${obsKey}#overlay`}
              />
              <button
                type="button"
                className="min-h-12 shrink-0 rounded-xl bg-primary px-4 font-display text-2xl text-primary-fg"
                onClick={() => {
                  const url = `${window.location.origin}/board.html?obs=${obsKey}#overlay`;
                  void navigator.clipboard.writeText(url).then(() => {
                    setCopied("Linket er kopieret.");
                    setTimeout(() => setCopied(""), 2000);
                  });
                }}
              >
                Kopiér
              </button>
            </div>
            {copied ? <p className="mt-2 text-sm text-primary">{copied}</p> : null}
          </div>
        ) : null}
        {obsKey ? (
          <div className="mt-4 rounded-card border border-line bg-surface p-4">
            <h2 className="font-display text-3xl">Spiller-link</h2>
            <p className="mt-1 text-sm text-muted">
              Send linket eller vis QR-koden fra scoreboardet. Spilleren opretter sig på BanditBoard Live uden at være på klubbens netværk og uden at logge ind.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                className={inputClass}
                value={`${typeof window === "undefined" ? "" : window.location.origin}/board.html?spiller=${obsKey}#mig`}
              />
              <button
                type="button"
                className="min-h-12 shrink-0 rounded-xl bg-primary px-4 font-display text-2xl text-primary-fg"
                onClick={() => {
                  const url = `${window.location.origin}/board.html?spiller=${obsKey}#mig`;
                  void navigator.clipboard.writeText(url).then(() => {
                    setCopied("Spiller-linket er kopieret.");
                    setTimeout(() => setCopied(""), 2000);
                  });
                }}
              >
                Kopiér
              </button>
            </div>
          </div>
        ) : null}
        {profile?.active === false ? (
          <p className="mt-4 rounded-xl border border-danger/40 bg-surface px-4 py-3 text-sm text-danger">
            Adgangen er lukket. Kontakt administratoren.
          </p>
        ) : null}
        {profile && canOpenAdmin(profile.role) ? (
          <Link to="/admin" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 font-semibold text-primary">
            <Shield className="size-4" aria-hidden="true" />
            {profile.role === "administrer_indstillinger" ? "Indstillinger" : "Admin — brugere og roller"}
          </Link>
        ) : null}

        {profile && (!canOpenBoard(profile.role) || profile.accountStatus !== "approved") ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Turneringsplan", "Se programmet for aftenen.", "/turnering"],
              ["Tilmeld dig", "Opret dig som spiller.", "/turnering"],
              ["Rangliste", "Point og sejre.", "/turnering"],
              ["Historik", "Tidligere kampe.", "/turnering"],
            ].map(([title, text, href]) => (
              <a key={title} href={href} className="rounded-card border border-line bg-surface p-4 transition hover:border-primary">
                <h2 className="font-display text-2xl">{title}</h2>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </a>
            ))}
          </div>
        ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.filter((tool) => {
            if (!profile || profile.accountStatus !== "approved") return false;
            if (tool.href.includes("#remote")) return hasPermission(profile.role, "USE_REMOTE");
            if (tool.href.includes("#overlay") || tool.href.includes("#tv") || tool.href.includes("#turnering") || tool.href.includes("#sponsor")) {
              return canRunLiveBoard(profile.role);
            }
            if (tool.href.includes("#players") || tool.href.includes("#tour") || tool.href.includes("#matrix") || tool.href.includes("#settings")) {
              return hasPermission(profile.role, "EDIT_TOURNAMENT") || hasPermission(profile.role, "IMPORT_PLAYERS") || canRunLiveBoard(profile.role);
            }
            return canOpenBoard(profile.role);
          }).map(({ href, icon: Icon, title, text }) => (
            <a key={href + title} href={href} className="rounded-card border border-line bg-surface p-4 transition hover:border-primary">
              <Icon className="mb-2 size-5 text-primary" aria-hidden="true" />
              <h2 className="font-display text-2xl">{title}</h2>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </a>
          ))}
        </div>
        )}

        <form onSubmit={onSubmit} className="mt-10 grid max-w-2xl gap-4 rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-3xl">Sted og kontakt</h2>
          <Field label="Navn">
            <input className={inputClass} value={profile?.venueName ?? ""} onChange={(e) => setProfile((p) => (p ? { ...p, venueName: e.target.value } : p))} />
          </Field>
          <Field label="Kontaktperson">
            <input className={inputClass} value={profile?.contactName ?? ""} onChange={(e) => setProfile((p) => (p ? { ...p, contactName: e.target.value } : p))} />
          </Field>
          <Field label="Telefon">
            <input className={inputClass} value={profile?.phone ?? ""} onChange={(e) => setProfile((p) => (p ? { ...p, phone: e.target.value } : p))} />
          </Field>
          <Field label="Adresse">
            <input className={inputClass} value={profile?.address ?? ""} onChange={(e) => setProfile((p) => (p ? { ...p, address: e.target.value } : p))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Postnr.">
              <input className={inputClass} value={profile?.postalCode ?? ""} onChange={(e) => setProfile((p) => (p ? { ...p, postalCode: e.target.value } : p))} />
            </Field>
            <Field label="By">
              <input className={inputClass} value={profile?.city ?? ""} onChange={(e) => setProfile((p) => (p ? { ...p, city: e.target.value } : p))} />
            </Field>
          </div>
          {profile?.accessCode ? (
            <p className="text-sm text-muted">
              Jeres adgangskode: <span className="font-display text-2xl text-fg">{profile.accessCode}</span>
            </p>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {saved ? <p className="text-sm text-ok">{saved}</p> : null}
          <button type="submit" disabled={pending || !profile} className="min-h-12 rounded-xl bg-primary font-display text-2xl text-primary-fg disabled:opacity-60">
            {pending ? "Gemmer…" : "Gem oplysninger"}
          </button>
        </form>

        <form
          className="mt-6 grid max-w-2xl gap-3 rounded-card border border-danger/40 bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!window.confirm("Slet kontoen helt? Tavle, tilmelding og login forsvinder.")) return;
            setDeleting(true);
            setError("");
            void deleteMyAccount({ data: { password: deletePassword } })
              .then(() => signOut("/"))
              .catch((err: Error) => {
                setDeleting(false);
                setError(err.message || "Kontoen kunne ikke slettes.");
              });
          }}
        >
          <h2 className="font-display text-3xl">Slet konto</h2>
          <p className="text-sm text-muted">Kontoen fjernes fra brugere, tavle og turnering. Det kan ikke fortrydes.</p>
          <Field label="Adgangskode">
            <input className={inputClass} type="password" autoComplete="current-password" required value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
          </Field>
          <button type="submit" disabled={deleting} className="min-h-12 rounded-xl bg-danger font-display text-2xl text-white disabled:opacity-60">
            {deleting ? "Sletter…" : "Slet min konto"}
          </button>
        </form>
      </div>
    </SiteShell>
  );
}
