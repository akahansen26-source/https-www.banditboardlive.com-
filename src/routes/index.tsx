import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BookOpenCheck,
  Clapperboard,
  History,
  LayoutGrid,
  MonitorPlay,
  ShieldCheck,
  Smartphone,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { CmsBlocks } from "@/components/cms-blocks";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { canOpenBoard, canRunLiveBoard, normalizeRole } from "@/lib/roles";
import { getMe } from "@/lib/venues";
import { getPublishedPage } from "@/lib/cms/api";
import { HOME_SLUG, type Block } from "@/lib/cms/schema";
import { SPORTS, SPORT_GROUPS } from "@/lib/sports/catalog";

export const Route = createFileRoute("/")({ component: Home });

const features = [
  { icon: Trophy, title: "Over 35 sportsgrene", text: "Fra pool, snooker og dart til fodbold, tennis, kampsport og løb. Hver sport har sit eget regelsæt og sin egen pointberegning." },
  { icon: LayoutGrid, title: "Flere borde og baner", text: "Hvert bord har sin egen kamp. Oversigten viser hold, runder, point og placering." },
  { icon: MonitorPlay, title: "TV og OBS-overlay", text: "Storskærmsvisning og overlay til OBS/Streamlabs: scorebar, hjørneboks eller fuld tavle i 1920×1080." },
  { icon: Timer, title: "Ur og fase", text: "Ur der tæller op eller ned, dato, klokkeslæt og sted — vist på TV og i overlayet." },
  { icon: Users, title: "Spillere og hold", text: "Kartotek med spillere, hold og kaptajn, import fra Excel eller CSV, rangliste og historik." },
  { icon: BookOpenCheck, title: "Turneringer og rangliste", text: "Liga, grupper og knockout med automatisk stilling og valgbar placering ved pointlighed." },
  { icon: ShieldCheck, title: "Godkendte resultater", text: "Resultater kan markeres som foreløbige, til en turneringsleder har godkendt dem." },
  { icon: Smartphone, title: "Samme konto overalt", text: "Log ind på telefonen og på TV'et. Tavlen gemmes på kontoen og følger med." },
  { icon: History, title: "Alt gemmes", text: "Kamphistorik, pointhistorik og turneringer, så I kan fortsætte, hvor I slap." },
  { icon: Clapperboard, title: "Klub og sponsorer", text: "Klublogo, bånd og sponsorboard til storskærmen." },
];

const steps = [
  { title: "Opret en bruger", text: "Nye konti kan se live, resultater og turneringer. En administrator giver adgang til scoreboardet." },
  { title: "Vælg sport og regler", text: "Vælg sportsgren og variant, tilpas reglerne, og start en kamp eller turnering." },
  { title: "Vis det på skærmen", text: "Kør tavlen fra telefonen, vis den på TV eller i OBS, og lad publikum følge med live." },
];

const faq = [
  { q: "Er reglerne officielle?", a: "Hver regel er mærket som officiel, almindelig standard eller BanditBoard-funktion. Standardværdierne følger den nævnte regelkilde, men forbund og turneringer kan have egne udgaver — kontrollér altid den gældende udgave, og tilpas reglerne før kampen." },
  { q: "Kan vi bruge vores egne pubregler?", a: "Ja. Skomager og \"Egen sportsgren\" har ingen fælles officielle regler — I opretter selv hændelser, bonus- og minuspoint. Eksemplerne som \"kegle\" og \"skæv\" er kun forslag, der kan rettes." },
  { q: "Skal vi installere noget?", a: "Nej. BanditBoard Live kører i browseren på telefon, tablet, computer og TV. På telefonen kan siden lægges på hjemmeskærmen som en app." },
  { q: "Kan pubben låne tavlen?", a: "Ja. En administrator opretter pubben eller klubben med e-mail og kontaktperson og giver en rolle. De logger ind og bruger kun deres egen tavle." },
];

const sectionTitle = "font-display text-4xl text-fg sm:text-5xl";
const eyebrow = "text-sm font-semibold uppercase tracking-[0.2em] text-primary";
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
      <p className="mt-3 max-w-xl text-sm text-muted">
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

function Home() {
  const { user, isPending } = useCurrentUserState();
  const [role, setRole] = useState<string | null>(null);
  const [approved, setApproved] = useState(true);
  const [cmsBlocks, setCmsBlocks] = useState<Block[]>([]);

  useEffect(() => {
    getPublishedPage({ data: { slug: HOME_SLUG } })
      .then((page) => setCmsBlocks(page?.blocks ?? []))
      .catch(() => setCmsBlocks([]));
  }, []);

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

  const sportsCount = SPORTS.length;

  return (
    <SiteShell>
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className={eyebrow}>Live scoreboard</p>
            <h1 className="mt-4 max-w-xl font-display text-5xl text-fg sm:text-7xl">Scoreboardet til klubben, pubben og storskærmen</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              BanditBoard Live holder styr på point, regler og turneringer i {sportsCount} sportsgrene — fra billard og dart til boldspil og kampsport. Kør kampen fra telefonen, og vis den på TV, i OBS og live på nettet.
            </p>
            <div className="mt-9 flex min-h-12 flex-wrap gap-3">
              {isPending ? (
                <div className="h-12 w-64 animate-pulse rounded-full bg-surface-2" />
              ) : user ? (
                <>
                  {role && approved && canOpenBoard(normalizeRole(role)) ? (
                    <a href="/board.html" className={btnPrimary}>{canRunLiveBoard(normalizeRole(role)) ? "Åbn scoreboard" : "Min tavle"}</a>
                  ) : (
                    <Link to="/turnering" className={btnPrimary}>Se turnering</Link>
                  )}
                  <Link to="/live" className={btnGhost}>Se live</Link>
                  <Link to="/konto" className={btnGhost}>Min konto</Link>
                </>
              ) : (
                <>
                  <Link to="/opret" className={btnPrimary}>Opret bruger</Link>
                  <Link to="/live" className={btnGhost}>Se live</Link>
                  <Link to="/login" search={{ next: "/konto" }} className={btnGhost}>Log ind</Link>
                </>
              )}
            </div>
            <InstallApp />
          </div>
          <div className="rounded-[1.5rem] border border-line bg-surface p-5 shadow-[0_30px_60px_-40px_rgba(31,38,34,0.45)]">
            <div className="theme-dark rounded-2xl p-4">
              <div className="grid grid-cols-2 gap-3">
                <ScoreSample name="Sanderum" score="47" live />
                <ScoreSample name="Ullerslev" score="39" />
              </div>
              <p className="mt-3 text-center font-display text-lg tracking-wide text-muted">BORD 1 · SKOMAGER · RUNDE 4</p>
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
              <Stat value={String(sportsCount)} label="sportsgrene" />
              <Stat value="1920×1080" label="TV og OBS" />
              <Stat value="Live" label="på nettet" />
            </dl>
          </div>
        </div>
      </section>

      {cmsBlocks.length ? <CmsBlocks blocks={cmsBlocks} /> : null}

      <section className="mx-auto max-w-6xl px-5 py-20">
        <p className={eyebrow}>Sådan virker det</p>
        <h2 className={`mt-3 ${sectionTitle}`}>Fra opstilling til storskærm på få minutter</h2>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-card border border-line bg-surface p-6">
              <span className="font-display text-4xl text-primary">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 font-display text-2xl text-fg">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-surface-2/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className={eyebrow}>Funktioner</p>
          <h2 className={`mt-3 ${sectionTitle}`}>Det kan scoreboardet</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-card border border-line bg-surface p-6">
                <Icon className="mb-4 size-6 text-primary" aria-hidden="true" />
                <h3 className="font-display text-2xl text-fg">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={eyebrow}>Sportsgrene</p>
            <h2 className={`mt-3 ${sectionTitle}`}>{sportsCount} sportsgrene med egne regler</h2>
          </div>
          <Link to="/sport" className={btnGhost}>Se alle sportsgrene og regler</Link>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {SPORT_GROUPS.map((group) => (
            <article key={group} className="rounded-card border border-line bg-surface p-6">
              <h3 className="font-display text-2xl text-fg">{group}</h3>
              <ul className="mt-4 flex flex-wrap gap-2">
                {SPORTS.filter((s) => s.group === group).map((s) => (
                  <li key={s.id}>
                    <Link to="/sport/$sportId" params={{ sportId: s.id }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-bg px-3 text-sm text-fg hover:border-primary">
                      <span aria-hidden="true">{s.emoji}</span>
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface-2/60">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2">
          <div>
            <p className={eyebrow}>Regler i korte træk</p>
            <h2 className={`mt-3 ${sectionTitle}`}>Reglerne følger sporten — og jer</h2>
            <p className="mt-5 text-lg leading-relaxed text-muted">
              Hver sportsgren har et standardregelsæt, som tavlen regner efter: point, sæt, legs, frames, tid eller placeringer. Før kampen kan reglerne tilpasses, og der kan vælges varianter — fx 11-, 7- eller 5-mands fodbold eller knockout med forlænget spilletid og straffe.
            </p>
          </div>
          <ul className="grid gap-4">
            <RuleNote tag="Officiel" text="Værdien følger den nævnte officielle regelkilde. Forbund opdaterer reglerne — kontrollér altid nyeste udgave." />
            <RuleNote tag="Standard" text="Almindelig praksis i ligaer og klubber, fx 3-1-0 point for sejr, uafgjort og nederlag. Ikke en officiel spilleregel." />
            <RuleNote tag="Jeres egne" text="Skomager og egne sportsgrene har ingen fælles regler. I bestemmer selv hændelser, bonus- og minuspoint." />
            <RuleNote tag="Placering" text="Ved pointlighed vælger turneringen rækkefølgen, fx point → indbyrdes opgør → målscore." />
          </ul>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 lg:grid-cols-2">
        <div>
          <p className={eyebrow}>Udlån</p>
          <h2 className={`mt-3 ${sectionTitle}`}>Lån tavlen ud til pub eller klub</h2>
          <ol className="mt-8 space-y-5 text-muted">
            <li className="flex gap-4"><span className="font-display text-3xl text-primary">01</span><span>Nye konti starter som gæst og kan se turnering, rangliste og historik.</span></li>
            <li className="flex gap-4"><span className="font-display text-3xl text-primary">02</span><span>I admin søger du dem frem og giver dem en rolle, fx bruger eller scoreboard-admin.</span></li>
            <li className="flex gap-4"><span className="font-display text-3xl text-primary">03</span><span>De logger ind med deres egen konto og bruger kun deres egen tavle.</span></li>
          </ol>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <figure className="overflow-hidden rounded-card border border-line bg-surface">
            <img src="/medier/billard/sponsorer/sanderum-pubben.png" alt="Sanderum Pubben" className="aspect-square w-full object-contain p-6" />
            <figcaption className="border-t border-line px-3 py-3 text-center font-display text-xl text-fg">Sanderum Pubben</figcaption>
          </figure>
          <figure className="overflow-hidden rounded-card border border-line bg-surface">
            <img src="/medier/billard/sponsorer/ullerslev-pub.png" alt="Ullerslev Pub" className="aspect-square w-full object-contain p-6" />
            <figcaption className="border-t border-line px-3 py-3 text-center font-display text-xl text-fg">Ullerslev Pub</figcaption>
          </figure>
        </div>
      </section>

      <section className="border-t border-line bg-surface-2/60">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <p className={eyebrow}>Spørgsmål</p>
          <h2 className={`mt-3 ${sectionTitle}`}>Godt at vide</h2>
          <div className="mt-8 divide-y divide-line rounded-card border border-line bg-surface">
            {faq.map((item) => (
              <details key={item.q} className="px-6 py-5">
                <summary className="cursor-pointer list-none font-semibold text-fg">{item.q}</summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
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

function RuleNote({ tag, text }: { tag: string; text: string }) {
  return (
    <li className="rounded-card border border-line bg-surface p-5">
      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">{tag}</span>
      <p className="mt-3 text-sm leading-relaxed text-muted">{text}</p>
    </li>
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
