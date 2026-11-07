import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { CmsBlocks } from "@/components/cms-blocks";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { canOpenBoard, canRunLiveBoard, normalizeRole } from "@/lib/roles";
import { getMe } from "@/lib/venues";
import { getPublishedPage } from "@/lib/cms/api";
import { HOME_SLUG, defaultHomeBlocks } from "@/lib/cms/schema";
import { SPORTS } from "@/lib/sports/catalog";

/** Forsiden er en CMS-side: den udgivne "forside" vises, ellers standardindholdet. */
export const Route = createFileRoute("/")({
  loader: async () => {
    const page = await getPublishedPage({ data: { slug: HOME_SLUG } }).catch(() => null);
    return { blocks: page?.blocks.length ? page.blocks : defaultHomeBlocks() };
  },
  component: Home,
});

const btnPrimary = "inline-flex min-h-12 items-center rounded-full bg-primary px-6 text-base font-semibold text-primary-fg transition hover:opacity-90";
const btnGhost = "inline-flex min-h-12 items-center rounded-full border border-line bg-surface px-6 text-base font-semibold text-fg transition hover:border-primary";

function InstallApp() {
  const [prompt, setPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);

  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as unknown as { prompt: () => Promise<void> });
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!prompt) {
    return (
      <p className="max-w-xl text-sm text-muted">
        På telefonen kan du <Link to="/app" className="text-primary">hente appen</Link> og lægge BanditBoard Live på hjemmeskærmen.
      </p>
    );
  }

  return (
    <button
      type="button"
      className={btnGhost}
      onClick={() => void prompt.prompt()}
    >
      Installer BanditBoard Live
    </button>
  );
}

function AccountButtons() {
  const { user, isPending } = useCurrentUserState();
  const [role, setRole] = useState<string | null>(null);
  const [approved, setApproved] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setApproved(true);
      return;
    }
    getMe()
      .then((profile) => {
        setRole(profile.role);
        setApproved(profile.accountStatus === "approved");
      })
      .catch(() => setRole("gaest"));
  }, [user]);

  if (isPending) return <div className="h-12 w-64 animate-pulse rounded-full bg-surface-2" />;
  if (user) {
    return (
      <>
        {role && approved && canOpenBoard(normalizeRole(role)) ? (
          <a href="/board.html" className={btnPrimary}>{canRunLiveBoard(normalizeRole(role)) ? "Åbn scoreboard" : "Min tavle"}</a>
        ) : (
          <Link to="/turnering" className={btnPrimary}>Se turnering</Link>
        )}
        <Link to="/live" className={btnGhost}>Se live</Link>
        <Link to="/konto" className={btnGhost}>Min konto</Link>
      </>
    );
  }
  return (
    <>
      <Link to="/opret" className={btnPrimary}>Opret bruger</Link>
      <Link to="/live" className={btnGhost}>Se live</Link>
      <Link to="/login" search={{ next: "/konto" }} className={btnGhost}>Log ind</Link>
      <div className="basis-full"><InstallApp /></div>
    </>
  );
}

/** Illustration: en fiktiv demokamp, tydeligt mærket, så ingen tror det er et rigtigt resultat. */
function Showcase() {
  return (
    <figure className="arena-glow rounded-[1.5rem] border border-line bg-surface p-5" aria-label="Demo-scoreboard med en fiktiv kamp">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary-fg">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary-fg" />Live · Demo
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-accent">Fodbold</span>
      </div>
      <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center text-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Hjemme</p>
          <p className="mt-1 font-display text-7xl text-primary">2</p>
        </div>
        <span aria-hidden="true" className="font-display text-4xl text-fg">:</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Ude</p>
          <p className="mt-1 font-display text-7xl text-accent">1</p>
        </div>
      </div>
      <p className="mt-2 text-center font-display text-2xl tracking-wide text-heading">67:24</p>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
        <Stat value={String(SPORTS.length)} label="sportsgrene" />
        <Stat value="1920×1080" label="TV og OBS" />
        <Stat value="Live" label="på nettet" />
      </dl>
      <figcaption className="mt-4 text-center text-xs text-muted">Illustration — kamp og resultat er fiktive.</figcaption>
    </figure>
  );
}

function Home() {
  const { blocks } = Route.useLoaderData();
  return (
    <SiteShell>
      <CmsBlocks blocks={blocks} extras={{ accountButtons: <AccountButtons />, heroShowcase: <Showcase /> }} />
    </SiteShell>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-3">
      <dt className="sr-only">{label}</dt>
      <dd className="font-display text-2xl text-heading">{value}</dd>
      <dd className="text-xs text-muted">{label}</dd>
    </div>
  );
}
