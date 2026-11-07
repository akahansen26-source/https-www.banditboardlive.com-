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

function Showcase() {
  return (
    <div className="rounded-[1.5rem] border border-line bg-surface p-5 shadow-[0_30px_60px_-40px_rgba(31,42,55,0.35)]">
      <div className="theme-dark rounded-2xl p-4">
        <div className="grid grid-cols-2 gap-3">
          <ScoreSample name="Sanderum" score="47" live />
          <ScoreSample name="Ullerslev" score="39" />
        </div>
        <p className="mt-3 text-center font-display text-lg tracking-wide text-muted">BORD 1 · SKOMAGER · RUNDE 4</p>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
        <Stat value={String(SPORTS.length)} label="sportsgrene" />
        <Stat value="1920×1080" label="TV og OBS" />
        <Stat value="Live" label="på nettet" />
      </dl>
    </div>
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
      <dd className="font-display text-2xl text-fg">{value}</dd>
      <dd className="text-xs text-muted">{label}</dd>
    </div>
  );
}

function ScoreSample({ name, score, live }: { name: string; score: string; live?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-4 ${live ? "border-accent bg-deep" : "border-line bg-deep"}`}>
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="font-semibold">{name}</span>
        {live ? <span className="text-accent">LIVE</span> : <span>VENTER</span>}
      </div>
      <p className="mt-2 text-center font-display text-6xl text-primary">{score}</p>
    </div>
  );
}
