import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Facebook, Instagram, Youtube } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { signOut } from "@/lib/auth/client";
import { getSiteSettings, getMe, type PublicSettings } from "@/lib/venues";
import { canOpenBoard, canRunLiveBoard, hasPermission, type UserRole } from "@/lib/roles";
import { getNavPages } from "@/lib/cms/api";
import type { NavPage } from "@/lib/cms/schema";

const emptySettings: PublicSettings = {
  facebook: "",
  instagram: "",
  youtube: "",
  contactEmail: "",
  contactPhone: "",
};

/** Huskes mellem sideskift, så menuen ikke blinker, mens rolle og indstillinger hentes igen. */
const cache: { nav: NavPage[] | null; settings: PublicSettings | null; userId: string | null; role: UserRole | null; status: string } = { nav: null, settings: null, userId: null, role: null, status: "approved" };

type NavItem = { to?: string; href?: string; label: string; search?: Record<string, string> };

export function SiteShell({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [settings, setSettings] = useState<PublicSettings>(cache.settings ?? emptySettings);
  const [signingOut, setSigningOut] = useState(false);
  const [role, setRole] = useState<UserRole | null>(cache.role);
  const [accountStatus, setAccountStatus] = useState(cache.status);
  const [open, setOpen] = useState(false);
  const gate = typeof document !== "undefined" && hasGateSessionMarker();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const knownUser = user ?? (isPending && cache.userId ? { id: cache.userId } : null);

  const [navPages, setNavPages] = useState<NavPage[]>(cache.nav ?? []);

  useEffect(() => {
    getNavPages()
      .then((x) => { cache.nav = x; setNavPages(x); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getSiteSettings()
      .then((x) => { cache.settings = x; setSettings(x); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isPending) return;
    if (!user) {
      cache.userId = null; cache.role = null; cache.status = "approved";
      setRole(null); setAccountStatus("approved");
      return;
    }
    if (cache.userId !== user.id) { cache.userId = user.id; cache.role = null; }
    getMe()
      .then((profile) => {
        cache.role = profile.role; cache.status = profile.accountStatus;
        setRole(profile.role); setAccountStatus(profile.accountStatus);
      })
      .catch(() => setRole((r) => r ?? "gaest"));
  }, [user, isPending]);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const socials = [
    { href: settings.facebook, label: "Facebook", icon: Facebook },
    { href: settings.instagram, label: "Instagram", icon: Instagram },
    { href: settings.youtube, label: "YouTube", icon: Youtube },
  ];

  const approved = accountStatus === "approved";
  const board = knownUser && role && canOpenBoard(role) && approved ? { href: "/board.html", label: canRunLiveBoard(role) ? "Scoreboard" : "Min tavle" } : null;
  const main: NavItem[] = [{ to: "/sport", label: "Sport" }, ...navPages.map((p) => ({ href: `/side/${p.slug}`, label: p.title })), { to: "/resultater", label: "Resultater" }, { to: "/live", label: "Live" }, ...(knownUser ? [{ to: "/turnering", label: "Turnering" }] : []), { to: "/app", label: "App" }];
  const extra: NavItem[] = knownUser
    ? [
        { to: "/konto", label: "Min konto" },
        ...(role && canRunLiveBoard(role) && approved ? [{ href: "/board.html#remote", label: "Remote" }] : []),
        ...(role && hasPermission(role, "MANAGE_SUPPORT") ? [{ to: "/support-center", label: "Support" }] : []),
        ...(role && hasPermission(role, "MANAGE_USERS") ? [{ to: "/admin", label: "Admin" }] : []),
        ...(role && hasPermission(role, "MANAGE_CONTENT") && approved ? [{ to: "/indhold", label: "Rediger hjemmeside" }] : []),
      ]
    : [{ to: "/kontakt", label: "Kontakt" }, { to: "/login", label: "Log ind", search: { next: "/konto" } }];
  const linkCls = (active: boolean) => `inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold ${active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`;
  const isActive = (it: NavItem) => Boolean(it.to && (pathname === it.to || (it.to !== "/" && pathname.startsWith(it.to + "/"))));
  const Item = ({ it, cls }: { it: NavItem; cls: string }) =>
    it.href ? <a href={it.href} className={cls}>{it.label}</a> : <Link to={it.to!} search={it.search as never} className={cls}>{it.label}</Link>;
  const logout = !gate && knownUser ? (
    <button type="button" disabled={signingOut} onClick={() => { setSigningOut(true); void signOut("/").catch(() => setSigningOut(false)); }} className="inline-flex min-h-11 items-center rounded-xl px-3 text-left text-sm text-muted hover:text-fg disabled:opacity-60">
      {signingOut ? "Logger ud…" : "Log ud"}
    </button>
  ) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-md">
        <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-auto flex shrink-0 items-center" aria-label="BanditBoard Live, forside">
            <img src="/branding/logo-nav.png" alt="BanditBoard Live" className="h-12 w-auto object-contain sm:h-14" />
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Hovedmenu">
            {main.map((it) => <Item key={it.label} it={it} cls={linkCls(isActive(it))} />)}
          </nav>
          {board ? (
            <a href={board.href} className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-primary px-4 font-display text-lg font-bold text-primary-fg">{board.label}</a>
          ) : !knownUser && !isPending ? (
            <Link to="/opret" className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-primary px-4 font-display text-lg font-bold text-primary-fg">Opret bruger</Link>
          ) : null}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-menu" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:border-primary">
            <span aria-hidden="true" className="grid gap-1">
              <span className={`block h-0.5 w-5 bg-current transition ${open ? "translate-y-1.5 rotate-45" : ""}`} />
              <span className={`block h-0.5 w-5 bg-current transition ${open ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-5 bg-current transition ${open ? "-translate-y-1.5 -rotate-45" : ""}`} />
            </span>
            Menu
          </button>
        </div>
        {open ? (
          <>
            <button type="button" aria-label="Luk menu" className="fixed inset-x-0 bottom-0 top-[4.5rem] z-0 h-[calc(100vh-4.5rem)] cursor-default bg-black/50" onClick={() => setOpen(false)} />
            <div id="site-menu" className="relative z-10 border-t border-line bg-bg shadow-xl lg:absolute lg:right-[max(1rem,calc((100vw-72rem)/2+1rem))] lg:top-full lg:w-64 lg:rounded-b-card lg:border">
              <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-1 lg:px-2 lg:py-2">
                <div className="grid content-start gap-1 lg:hidden">
                  <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted">Sider</p>
                  {main.map((it) => <Item key={it.label} it={it} cls={`${linkCls(isActive(it))} w-full`} />)}
                </div>
                <div className="grid content-start gap-1">
                  <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted">{knownUser ? "Din konto" : "Konto"}</p>
                  {extra.map((it) => <Item key={it.label} it={it} cls={`${linkCls(isActive(it))} w-full`} />)}
                  {logout}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-surface-2">
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
              <li><Link to="/sport" className="hover:text-fg">Sportsgrene og regler</Link></li>
              <li><Link to="/resultater" className="hover:text-fg">Resultater</Link></li>
              <li><Link to="/kontakt" className="hover:text-fg">Kontakt</Link></li>
              {navPages.map((p) => <li key={p.slug}><a href={`/side/${p.slug}`} className="hover:text-fg">{p.title}</a></li>)}
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
