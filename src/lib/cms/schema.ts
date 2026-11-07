/**
 * CMS-indhold: typer og validering. Ren TypeScript uden server-afhængigheder,
 * så både editor, visning og server bruger præcis de samme regler.
 *
 * Sikkerhed: Indhold gemmes og vises KUN som tekst (React escaper det). Der er
 * ingen rå HTML. Links tillades kun som interne stier, https/http eller mailto.
 */

export const BLOCK_TYPES = ["hero", "text", "image", "features", "steps", "sports", "rules", "cta", "faq"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABEL: Record<BlockType, string> = {
  hero: "Topbanner",
  text: "Tekstafsnit",
  image: "Billede",
  features: "Punkter / kort",
  steps: "Trin (1-2-3)",
  sports: "Sportsgrene (automatisk liste)",
  rules: "Regler / mærkater",
  cta: "Opfordring med knap",
  faq: "Spørgsmål og svar",
};

export type HeroBlock = { id: string; type: "hero"; eyebrow: string; heading: string; text: string; imageId: string; ctaLabel: string; ctaHref: string; accountButtons: boolean };
export type TextBlock = { id: string; type: "text"; heading: string; body: string };
export type ImageBlock = { id: string; type: "image"; imageId: string; alt: string; caption: string };
export type FeaturesBlock = { id: string; type: "features"; eyebrow: string; heading: string; text: string; items: { title: string; text: string }[] };
export type StepsBlock = { id: string; type: "steps"; eyebrow: string; heading: string; text: string; items: { title: string; text: string }[] };
export type SportsBlock = { id: string; type: "sports"; eyebrow: string; heading: string; text: string };
export type RulesBlock = { id: string; type: "rules"; eyebrow: string; heading: string; text: string; items: { tag: string; text: string }[] };
export type CtaBlock = { id: string; type: "cta"; heading: string; text: string; label: string; href: string };
export type FaqBlock = { id: string; type: "faq"; eyebrow: string; heading: string; items: { q: string; a: string }[] };
export type Block = HeroBlock | TextBlock | ImageBlock | FeaturesBlock | StepsBlock | SportsBlock | RulesBlock | CtaBlock | FaqBlock;

export type PageStatus = "draft" | "published";

export type PageInput = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  status: PageStatus;
  showInNav: boolean;
  navOrder: number;
  blocks: Block[];
};

export type CmsPage = PageInput & { id: string; updatedAt: string; updatedBy: string };
export type NavPage = { slug: string; title: string };
export type MediaInfo = { id: string; name: string; mime: string; size: number; alt: string; createdAt: string; url: string };

/** Forsiden kan suppleres med sektioner fra siden med denne adresse. */
export const HOME_SLUG = "forside";

/** Adresser, der allerede bruges af appen, kan ikke vælges til egne sider. */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "kamp", "kontakt", "konto", "live", "login", "opret", "resultater", "sport",
  "support", "support-center", "tavle", "turnering", "turneringer", "indhold", "side", "board", "medier", "branding",
]);

export const MAX_BLOCKS = 40;
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export class CmsError extends Error {}

const ID = /^[A-Za-z0-9_-]{6,40}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function clip(value: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex -- bevidst: fjern usynlige kontroltegn
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

/** Lav en pæn adresse: "Om os & regler" -> "om-os-regler". */
export function slugify(value: string): string {
  return clip(value, 120)
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}

export function validSlug(slug: string): boolean {
  return SLUG.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Tillad kun sikre links. Alt andet (javascript:, data:, //host) bliver tomt. */
export function safeHref(value: unknown): string {
  const href = clip(value, 500);
  if (!href) return "";
  if (href.startsWith("/") && !href.startsWith("//") && !href.includes("\\")) return href;
  if (/^mailto:[^\s]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    /* ugyldig */
  }
  return "";
}

export function mediaId(value: unknown): string {
  const id = clip(value, 40);
  return ID.test(id) ? id : "";
}

export function mediaUrl(id: string): string {
  return `/api/media/${encodeURIComponent(id)}`;
}

function blockId(value: unknown, index: number): string {
  const id = clip(value, 40);
  return ID.test(id) ? id : `blk${index.toString().padStart(4, "0")}`;
}

function list<T>(value: unknown, max: number, map: (item: Record<string, unknown>) => T, keep: (item: T) => boolean): T[] {
  return (Array.isArray(value) ? value : []).slice(0, max).map((x) => map((x ?? {}) as Record<string, unknown>)).filter(keep);
}

export function sanitizeBlock(raw: unknown, index: number): Block | null {
  const b = (raw ?? {}) as Record<string, unknown>;
  const id = blockId(b.id, index);
  switch (b.type) {
    case "hero":
      return { id, type: "hero", eyebrow: clip(b.eyebrow, 60), heading: clip(b.heading, 140), text: clip(b.text, 600), imageId: mediaId(b.imageId), ctaLabel: clip(b.ctaLabel, 40), ctaHref: safeHref(b.ctaHref), accountButtons: b.accountButtons === true };
    case "text":
      return { id, type: "text", heading: clip(b.heading, 140), body: clip(b.body, 8000) };
    case "image":
      return { id, type: "image", imageId: mediaId(b.imageId), alt: clip(b.alt, 200), caption: clip(b.caption, 300) };
    case "features":
    case "steps":
      return { id, type: b.type, eyebrow: clip(b.eyebrow, 60), heading: clip(b.heading, 140), text: clip(b.text, 600), items: list(b.items, 12, (x) => ({ title: clip(x.title, 80), text: clip(x.text, 400) }), (x) => Boolean(x.title || x.text)) };
    case "sports":
      return { id, type: "sports", eyebrow: clip(b.eyebrow, 60), heading: clip(b.heading, 140), text: clip(b.text, 600) };
    case "rules":
      return { id, type: "rules", eyebrow: clip(b.eyebrow, 60), heading: clip(b.heading, 140), text: clip(b.text, 1500), items: list(b.items, 12, (x) => ({ tag: clip(x.tag, 30), text: clip(x.text, 400) }), (x) => Boolean(x.tag || x.text)) };
    case "cta":
      return { id, type: "cta", heading: clip(b.heading, 140), text: clip(b.text, 400), label: clip(b.label, 40), href: safeHref(b.href) };
    case "faq":
      return { id, type: "faq", eyebrow: clip(b.eyebrow, 60), heading: clip(b.heading, 140), items: list(b.items, 30, (x) => ({ q: clip(x.q, 200), a: clip(x.a, 1500) }), (x) => Boolean(x.q && x.a)) };
    default:
      return null;
  }
}

export function sanitizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_BLOCKS) throw new CmsError(`En side kan højst have ${MAX_BLOCKS} sektioner.`);
  const seen = new Set<string>();
  return raw.map(sanitizeBlock).filter((b): b is Block => b !== null).map((b, i) => {
    const id = seen.has(b.id) ? `blk${i.toString().padStart(4, "0")}x` : b.id;
    seen.add(id);
    return { ...b, id };
  });
}

export function sanitizePageInput(raw: unknown): PageInput {
  const p = (raw ?? {}) as Record<string, unknown>;
  const title = clip(p.title, 120);
  if (!title) throw new CmsError("Siden skal have en titel.");
  const slug = clip(p.slug, 60).toLowerCase() || slugify(title);
  if (!validSlug(slug)) throw new CmsError("Adressen må kun indeholde a-z, 0-9 og bindestreg og må ikke være en af appens egne adresser.");
  const id = p.id === undefined || p.id === "" ? undefined : mediaId(p.id) || undefined;
  if (p.id && !id) throw new CmsError("Ukendt side.");
  const order = Math.trunc(Number(p.navOrder));
  return {
    id,
    slug,
    title,
    description: clip(p.description, 300),
    status: p.status === "published" ? "published" : "draft",
    showInNav: p.showInNav === true && slug !== HOME_SLUG,
    navOrder: Number.isFinite(order) ? Math.max(0, Math.min(999, order)) : 0,
    blocks: sanitizeBlocks(p.blocks),
  };
}

/** Kontrollér billedets "magic bytes", så filtypen ikke kun er en påstand fra browseren. */
export function sniffImage(bytes: Uint8Array): (typeof MEDIA_TYPES)[number] | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => at(i) === v)) return "image/png";
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Startindholdet til forsiden. Bruges, indtil en redaktør udgiver sin egen forside. */
export function defaultHomeBlocks(): Block[] {
  return [
    { id: "home-hero", type: "hero", eyebrow: "Live scoreboard", heading: "Scoreboardet til klubben, pubben og storskærmen", text: "BanditBoard Live holder styr på point, regler og turneringer i over 35 sportsgrene — fra billard og dart til boldspil og kampsport. Kør kampen fra telefonen, og vis den på TV, i OBS og live på nettet.", imageId: "", ctaLabel: "", ctaHref: "", accountButtons: true },
    { id: "home-steps", type: "steps", eyebrow: "Sådan virker det", heading: "Fra opstilling til storskærm på få minutter", text: "", items: [
      { title: "Opret en bruger", text: "Nye konti kan se live, resultater og turneringer. En administrator giver adgang til scoreboardet." },
      { title: "Vælg sport og regler", text: "Vælg sportsgren og variant, tilpas reglerne, og start en kamp eller turnering." },
      { title: "Vis det på skærmen", text: "Kør tavlen fra telefonen, vis den på TV eller i OBS, og lad publikum følge med live." },
    ] },
    { id: "home-features", type: "features", eyebrow: "Funktioner", heading: "Det kan scoreboardet", text: "", items: [
      { title: "Over 35 sportsgrene", text: "Fra pool, snooker og dart til fodbold, tennis, kampsport og løb. Hver sport har sit eget regelsæt og sin egen pointberegning." },
      { title: "Flere borde og baner", text: "Hvert bord har sin egen kamp. Oversigten viser hold, runder, point og placering." },
      { title: "TV og OBS-overlay", text: "Storskærmsvisning og overlay til OBS/Streamlabs: scorebar, hjørneboks eller fuld tavle i 1920×1080." },
      { title: "Ur og fase", text: "Ur der tæller op eller ned, dato, klokkeslæt og sted — vist på TV og i overlayet." },
      { title: "Spillere og hold", text: "Kartotek med spillere, hold og kaptajn, import fra Excel eller CSV, rangliste og historik." },
      { title: "Turneringer og rangliste", text: "Liga, grupper og knockout med automatisk stilling og valgbar placering ved pointlighed." },
      { title: "Godkendte resultater", text: "Resultater kan markeres som foreløbige, til en turneringsleder har godkendt dem." },
      { title: "Samme konto overalt", text: "Log ind på telefonen og på TV'et. Tavlen gemmes på kontoen og følger med." },
      { title: "Alt gemmes", text: "Kamphistorik, pointhistorik og turneringer, så I kan fortsætte, hvor I slap." },
    ] },
    { id: "home-sports", type: "sports", eyebrow: "Sportsgrene", heading: "Sportsgrene med egne regler", text: "" },
    { id: "home-rules", type: "rules", eyebrow: "Regler i korte træk", heading: "Reglerne følger sporten — og jer", text: "Hver sportsgren har et standardregelsæt, som tavlen regner efter: point, sæt, legs, frames, tid eller placeringer. Før kampen kan reglerne tilpasses, og der kan vælges varianter — fx 11-, 7- eller 5-mands fodbold eller knockout med forlænget spilletid og straffe.", items: [
      { tag: "Officiel", text: "Værdien følger den nævnte officielle regelkilde. Forbund opdaterer reglerne — kontrollér altid nyeste udgave." },
      { tag: "Standard", text: "Almindelig praksis i ligaer og klubber, fx 3-1-0 point for sejr, uafgjort og nederlag. Ikke en officiel spilleregel." },
      { tag: "Jeres egne", text: "Skomager og egne sportsgrene har ingen fælles regler. I bestemmer selv hændelser, bonus- og minuspoint." },
      { tag: "Placering", text: "Ved pointlighed vælger turneringen rækkefølgen, fx point → indbyrdes opgør → målscore." },
    ] },
    { id: "home-lending", type: "steps", eyebrow: "Udlån", heading: "Lån tavlen ud til pub eller klub", text: "", items: [
      { title: "Gæst", text: "Nye konti starter som gæst og kan se turnering, rangliste og historik." },
      { title: "Rolle", text: "I admin søger du dem frem og giver dem en rolle, fx bruger eller scoreboard-admin." },
      { title: "Egen tavle", text: "De logger ind med deres egen konto og bruger kun deres egen tavle." },
    ] },
    { id: "home-faq", type: "faq", eyebrow: "Spørgsmål", heading: "Godt at vide", items: [
      { q: "Er reglerne officielle?", a: "Hver regel er mærket som officiel, almindelig standard eller BanditBoard-funktion. Standardværdierne følger den nævnte regelkilde, men forbund og turneringer kan have egne udgaver — kontrollér altid den gældende udgave, og tilpas reglerne før kampen." },
      { q: "Kan vi bruge vores egne pubregler?", a: "Ja. Skomager og \"Egen sportsgren\" har ingen fælles officielle regler — I opretter selv hændelser, bonus- og minuspoint. Eksemplerne som \"kegle\" og \"skæv\" er kun forslag, der kan rettes." },
      { q: "Skal vi installere noget?", a: "Nej. BanditBoard Live kører i browseren på telefon, tablet, computer og TV. På telefonen kan siden lægges på hjemmeskærmen som en app." },
      { q: "Kan pubben låne tavlen?", a: "Ja. En administrator opretter pubben eller klubben med e-mail og kontaktperson og giver en rolle. De logger ind og bruger kun deres egen tavle." },
    ] },
  ];
}
