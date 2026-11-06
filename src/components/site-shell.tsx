import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Facebook, Instagram, Youtube } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { signOut } from "@/lib/auth/client";
import { getSiteSettings, getMe, type PublicSettings } from "@/lib/venues";
import { canOpenBoard, canRunLiveBoard, hasPermission, type UserRole } from "@/lib/roles";

const emptySettings: PublicSettings = {
  facebook: "",
  instagram: "",
  youtube: "",
  contactEmail: "",
  contactPhone: "",
};

export function SiteShell({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [settings, setSettings] = useState<PublicSettings>(emptySettings);
  const [signingOut, setSigningOut] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [accountStatus, setAccountStatus] = useState("approved");
  const gate = typeof document !== "undefined" && hasGateSessionMarker();

  useEffect(() => {
    getSiteSettings()
      .then(setSettings)
      .catch(() => setSettings(emptySettings));
  }, []);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setAccountStatus("approved");
      return;
    }
    getMe()
      .then((profile) => {
        setRole(profile.role);
        setAccountStatus(profile.accountStatus);
      })
      .catch(() => setRole("gaest"));
  }, [user]);

  const socials = [
    { href: settings.facebook, label: "Facebook", icon: Facebook },
    { href: settings.instagram, label: "Instagram", icon: Instagram },
    { href: settings.youtube, label: "YouTube", icon: Youtube },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
          <Link to="/" className="mr-auto flex items-center" aria-label="BanditBoard Live, forside">
            <img src="/branding/logo-nav.png" alt="BanditBoard Live" className="h-14 w-auto object-contain sm:h-16" />
          </Link>
          <Link to="/app" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
            App
          </Link>
          <Link to="/live" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
            Live
          </Link>
          {isPending ? (
            <div className="h-11 w-36 animate-pulse rounded-xl bg-surface-2" />
          ) : user ? (
            <nav className="flex flex-wrap items-center gap-2">
              <ShellLink to="/konto">Konto</ShellLink>
              <Link to="/turnering" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
                Turnering
              </Link>
              {role && canOpenBoard(role) && accountStatus === "approved" ? (
                <a href="/board.html" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-display text-lg font-bold text-primary-fg">
                  {canRunLiveBoard(role) ? "Scoreboard" : "Min tavle"}
                </a>
              ) : null}
              {role && canRunLiveBoard(role) && accountStatus === "approved" ? (
                <a href="/board.html#remote" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
                  Remote
                </a>
              ) : null}
              {role && hasPermission(role, "MANAGE_SUPPORT") ? (
                <Link to="/support-center" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
                  Support
                </Link>
              ) : null}
              {role && hasPermission(role, "MANAGE_USERS") ? (
                <Link to="/admin" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
                  Admin
                </Link>
              ) : null}
              {!gate ? (
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => {
                    setSigningOut(true);
                    void signOut("/").catch(() => setSigningOut(false));
                  }}
                  className="inline-flex min-h-11 items-center px-3 text-sm text-muted disabled:opacity-60"
                >
                  {signingOut ? "Logger ud…" : "Log ud"}
                </button>
              ) : null}
            </nav>
          ) : (
            <nav className="flex flex-wrap items-center gap-2">
              <Link to="/kontakt" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
                Kontakt
              </Link>
              <Link to="/login" search={{ next: "/konto" }} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
                Log ind
              </Link>
              <Link
                to="/opret"
                className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-display text-lg font-bold text-primary-fg"
              >
                Opret bruger
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-deep">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <img src="/branding/logo-nav.png" alt="" className="mb-3 h-14 w-auto object-contain" />
            <p className="max-w-sm text-sm text-muted">
              Live scoreboard til billard, dart og turneringer. Samme tavle på telefon, TV og storskærm.
            </p>
          </div>
          <div>
            <h2 className="mb-3 font-display text-xl text-fg">Sider</h2>
            <ul className="space-y-2 text-sm text-muted">
              <li><Link to="/" className="hover:text-fg">Forside</Link></li>
              <li><Link to="/login" search={{ next: "/konto" }} className="hover:text-fg">Log ind</Link></li>
              <li><Link to="/opret" className="hover:text-fg">Opret bruger</Link></li>
              <li><Link to="/konto" className="hover:text-fg">Min konto</Link></li>
              <li><Link to="/app" className="hover:text-fg">App</Link></li>
              <li><Link to="/kontakt" className="hover:text-fg">Kontakt</Link></li>
              <li><Link to="/support" search={{ sag: "", k: "" }} className="hover:text-fg">Min support</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="mb-3 font-display text-xl text-fg">Følg med</h2>
            <div className="flex gap-2">
              {socials.map(({ href, label, icon: Icon }) =>
                href ? (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={label}
                    className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-primary"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </a>
                ) : (
                  <span
                    key={label}
                    title={`${label} tilføjes under Admin`}
                    className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-muted"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    <span className="sr-only">{label}</span>
                  </span>
                ),
              )}
            </div>
            <p className="mt-4 text-sm text-muted">
              {settings.contactPhone ? <span className="block">{settings.contactPhone}</span> : null}
              {settings.contactEmail ? <span className="block">{settings.contactEmail}</span> : null}
              {!settings.contactPhone && !settings.contactEmail ? "Kontakt og sociale medier sættes i admin-panelet." : null}
            </p>
          </div>
        </div>
        <div className="border-t border-line px-4 py-4 text-center text-xs text-muted">BanditBoard Live</div>
      </footer>
    </div>
  );
}

function ShellLink({ to, children }: { to: "/" | "/opret" | "/konto"; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
      {children}
    </Link>
  );
}
