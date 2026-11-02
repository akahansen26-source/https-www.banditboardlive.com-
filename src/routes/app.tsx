import { createFileRoute, Link } from "@tanstack/react-router";
import { History, MonitorPlay, Smartphone, Trophy, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site-shell";

export const Route = createFileRoute("/app")({ component: AppPage });

const canDo = [
  { icon: Trophy, title: "Live og turnering", text: "Se kampe, turneringsplan, rangliste og historik. Det samme som på hjemmesiden, samlet på telefonen." },
  { icon: Smartphone, title: "Samme konto", text: "Log ind én gang. Tavlen, spillerne og indstillingerne følger med på telefon, TV og computer." },
  { icon: MonitorPlay, title: "Scoreboard og remote", text: "Har du adgang til tavlen, kan du køre kampen og styre den fra telefonen, mens storskærmen viser resultatet." },
  { icon: Users, title: "Spillere", text: "Find dig selv, opret dig via klubbens link, og se din plads. En gæst kan se det offentlige, men ikke styre tavlen." },
  { icon: History, title: "Support", text: "Skriv til BanditBoard Live inde fra appen, og følg svaret på din sag." },
];

function AppPage() {
  const [prompt, setPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));
    setInstalled(standalone);
    function onPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as unknown as { prompt: () => Promise<void> });
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function updateApp() {
    setUpdating(true);
    setNote("");
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.update()));
      }
      await fetch(`/app?v=${Date.now()}`, { cache: "reload" });
      setNote("Den nyeste udgave er hentet. Luk appen helt, og åbn den igen.");
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      window.location.reload();
    } finally {
      setUpdating(false);
    }
  }

  return (
    <SiteShell>
      <div className="mx-auto max-w-5xl px-4 py-12">
        <img src="/branding/logo.png" alt="BanditBoard Live" className="mb-6 h-auto w-full max-w-[280px] object-contain" />
        <p className="font-display text-lg tracking-widest text-primary">APP</p>
        <h1 className="mt-1 font-display text-5xl sm:text-6xl">BanditBoard Live på telefonen</h1>
        <p className="mt-4 max-w-2xl text-muted">
          Appen er BanditBoard Live, lagt på hjemmeskærmen. Den bruger den samme konto og den samme tavle som hjemmesiden.
          Google Play og App Store kommer senere. Indtil da henter du appen her.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          {installed ? (
            <p className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 font-display text-2xl">Appen er installeret</p>
          ) : prompt ? (
            <button type="button" className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-display text-2xl text-primary-fg" onClick={() => void prompt.prompt()}>
              Download app
            </button>
          ) : (
            <a href="#saadan" className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-display text-2xl text-primary-fg">
              Download app
            </a>
          )}
          <button type="button" disabled={updating} className="inline-flex min-h-12 items-center rounded-xl border border-line bg-surface px-5 font-display text-2xl disabled:opacity-60" onClick={() => void updateApp()}>
            {updating ? "Henter…" : "Opdater app"}
          </button>
          <Link to="/login" search={{ next: "/konto" }} className="inline-flex min-h-12 items-center rounded-xl border border-line px-5 font-display text-2xl">
            Log ind
          </Link>
        </div>
        {note ? <p className="mt-3 text-sm text-primary">{note}</p> : null}

        <h2 className="mt-14 font-display text-4xl">Det appen kan</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {canDo.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-card border border-line bg-surface p-4">
              <Icon className="mb-3 size-6 text-primary" aria-hidden="true" />
              <h3 className="font-display text-2xl">{title}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </article>
          ))}
        </div>

        <h2 id="saadan" className="mt-14 font-display text-4xl">Sådan henter du appen</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <article className="rounded-card border border-line bg-surface p-5">
            <h3 className="font-display text-2xl">iPhone</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Åbn banditboardlive.com i Safari.</li>
              <li>Tryk på del-knappen.</li>
              <li>Vælg Føj til hjemmeskærm.</li>
              <li>Tryk Tilføj. Ikonet hedder BanditBoard.</li>
            </ol>
          </article>
          <article className="rounded-card border border-line bg-surface p-5">
            <h3 className="font-display text-2xl">Android</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Åbn banditboardlive.com i Chrome.</li>
              <li>Tryk Download app her, hvis knappen vises.</li>
              <li>Ellers åbn menuen og vælg Installer app eller Føj til startskærm.</li>
            </ol>
          </article>
        </div>
        <p className="mt-6 max-w-2xl text-sm text-muted">
          Opdater app henter den nyeste udgave fra hjemmesiden. Ser noget stadig gammelt ud, så luk appen helt og åbn den fra ikonet igen.
        </p>
      </div>
    </SiteShell>
  );
}
