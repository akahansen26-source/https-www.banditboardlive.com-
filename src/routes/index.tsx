import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Clapperboard,
  History,
  LayoutGrid,
  MonitorPlay,
  Smartphone,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { canOpenBoard, canRunLiveBoard, normalizeRole } from "@/lib/roles";
import { getMe } from "@/lib/venues";

export const Route = createFileRoute("/")({ component: Home });

const features = [
  { icon: Trophy, title: "Billard og dart", text: "Skomager, kegle, pointtavle og dart. Skæve, runder, legs og checkout sidder i samme tavle." },
  { icon: LayoutGrid, title: "Flere borde", text: "Hvert bord har sin egen kamp. Oversigten viser hold, runder, point og placering." },
  { icon: MonitorPlay, title: "TV og OBS", text: "Storskærm, overlay til Streamlabs og et sponsorboard i 1920×1080." },
  { icon: Timer, title: "Timer og sted", text: "Fælles nedtælling, dato, klokkeslæt og sted. Det vises på TV og i overlayet." },
  { icon: Users, title: "Kartotek", text: "Spillere, hold, kaptajn og import fra Excel eller CSV. Rangliste og historik følger med." },
  { icon: Smartphone, title: "Samme konto overalt", text: "Log ind på telefonen og på TV'et. Tavlen gemmes på kontoen og følger med." },
  { icon: Clapperboard, title: "Sponsorer", text: "Klublogo, bånd og sponsorer — blandt andet Sanderum Pubben og Ullerslev Pub." },
  { icon: History, title: "Kampene gemmes", text: "Historik, pointhistorik og turneringsfiler, så I kan fortsætte hvor I slap." },
];

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
      <p className="mt-3 max-w-xl text-sm text-muted">
        På telefonen kan du <Link to="/app" className="text-primary">hente appen</Link> og lægge BanditBoard Live på hjemmeskærmen.
      </p>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 font-display text-2xl"
      onClick={() => void prompt.prompt()}
    >
      Installer BanditBoard Live
    </button>
  );
}

function Home() {
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

  return (
    <SiteShell>
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(25,195,255,0.16),transparent_55%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="mb-4 font-display text-lg tracking-widest text-primary">LIVE SCOREBOARD</p>
            <h1 className="max-w-xl font-display text-5xl text-fg sm:text-7xl">
              Tavlen til pubben, klubben og storskærmen
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
              BanditBoard Live er scoreboardet til klubaftenen. Opret en bruger, log ind, og kør kampen.
              Skal tavlen lånes ud — for eksempel til Sanderum Pubben — opretter du dem med mail, kontaktperson og en adgangskode.
            </p>
            <div className="mt-8 flex min-h-12 flex-wrap gap-3">
              {isPending ? (
                <div className="h-12 w-64 animate-pulse rounded-xl bg-surface-2" />
              ) : user ? (
                <>
                  {role && approved && canOpenBoard(normalizeRole(role)) ? (
                    <a href="/board.html" className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-display text-2xl text-primary-fg">
                      {canRunLiveBoard(normalizeRole(role)) ? "Åbn scoreboard" : "Min tavle"}
                    </a>
                  ) : (
                    <Link to="/turnering" className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-display text-2xl text-primary-fg">
                      Se turnering
                    </Link>
                  )}
                  <Link to="/live" className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 font-display text-2xl">
                    Se live
                  </Link>
                  <Link to="/konto" className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 font-display text-2xl">
                    Min konto
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/live" className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-display text-2xl text-primary-fg">
                    Se live
                  </Link>
                  <Link to="/opret" className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 font-display text-2xl">
                    Opret bruger
                  </Link>
                  <Link to="/login" search={{ next: "/konto" }} className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 font-display text-2xl">
                    Log ind
                  </Link>
                </>
              )}
            </div>
            <InstallApp />
          </div>
          <div className="rounded-card border border-line bg-surface p-4 shadow-[0_24px_60px_-30px_rgba(25,195,255,0.45)]">
            <img src="/branding/logo.png" alt="BanditBoard Live" className="mx-auto mb-4 h-auto w-full max-w-[300px] object-contain" />
            <div className="grid grid-cols-2 gap-3">
              <ScoreSample name="Sanderum" score="47" live />
              <ScoreSample name="Ullerslev" score="39" />
            </div>
            <p className="mt-3 text-center font-display text-lg tracking-wide text-muted">BORD 1 · SKOMAGER · RUNDE 4</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-display text-4xl sm:text-5xl">Det scoreboardet kan</h2>
        <p className="mt-3 max-w-2xl text-muted">Samme funktioner som i BanditBoard Live — nu bag login, så hver pub og klub har sin egen tavle.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-card border border-line bg-surface p-4">
              <Icon className="mb-3 size-6 text-primary" aria-hidden="true" />
              <h3 className="font-display text-2xl">{title}</h3>
              <p className="mt-2 text-sm text-muted">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 lg:grid-cols-2">
          <div>
            <p className="font-display text-lg tracking-widest text-accent">UDLÅN</p>
            <h2 className="mt-2 font-display text-4xl sm:text-5xl">Lån tavlen ud med en kode</h2>
            <ol className="mt-6 space-y-4 text-sm text-muted">
              <li><span className="mr-2 font-display text-2xl text-primary">01</span>Nye konti starter som gæst og kan se turnering, rangliste og historik.</li>
              <li><span className="mr-2 font-display text-2xl text-primary">02</span>I admin søger du dem frem og giver dem en rolle, for eksempel bruger eller scoreboard-admin.</li>
              <li><span className="mr-2 font-display text-2xl text-primary">03</span>De får en adgangskode, logger ind og bruger kun deres egen tavle.</li>
            </ol>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <figure className="overflow-hidden rounded-card border border-line bg-deep">
              <img src="/medier/billard/sponsorer/sanderum-pubben.png" alt="Sanderum Pubben" className="aspect-square w-full object-contain p-4" />
              <figcaption className="border-t border-line px-3 py-2 text-center font-display text-xl">Sanderum Pubben</figcaption>
            </figure>
            <figure className="overflow-hidden rounded-card border border-line bg-deep">
              <img src="/medier/billard/sponsorer/ullerslev-pub.png" alt="Ullerslev Pub" className="aspect-square w-full object-contain p-4" />
              <figcaption className="border-t border-line px-3 py-2 text-center font-display text-xl">Ullerslev Pub</figcaption>
            </figure>
          </div>
        </div>
      </section>
    </SiteShell>
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
