import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SiteShell } from "@/components/site-shell";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMe } from "@/lib/venues";
import { canManageContent, normalizeRole } from "@/lib/roles";
import { cmsDeleteMedia, cmsDeletePage, cmsListMedia, cmsListPages, cmsReorderNav, cmsSavePage, cmsUploadMedia } from "@/lib/cms/api";
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  HOME_SLUG,
  MAX_MEDIA_BYTES,
  MEDIA_TYPES,
  defaultHomeBlocks,
  slugify,
  type Block,
  type BlockType,
  type CmsPage,
  type MediaInfo,
  type PageInput,
} from "@/lib/cms/schema";

export const Route = createFileRoute("/indhold")({
  head: () => ({ meta: [{ title: "Rediger hjemmeside · BanditBoard Live" }, { name: "robots", content: "noindex" }] }),
  component: ContentAdmin,
});

const input = "min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-fg outline-none focus-visible:border-primary";
const area = `${input} min-h-28 py-2 leading-relaxed`;
const btn = "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-50";
const btnPrimary = `${btn} bg-primary text-primary-fg hover:opacity-90`;
const btnGhost = `${btn} border border-line bg-surface text-fg hover:border-primary`;
const iconBtn = "grid size-9 place-items-center rounded-lg border border-line bg-surface text-muted hover:text-fg disabled:opacity-40";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function emptyBlock(type: BlockType): Block {
  const id = uid();
  switch (type) {
    case "hero": return { id, type, eyebrow: "", heading: "Overskrift", text: "", imageId: "", ctaLabel: "", ctaHref: "", accountButtons: false };
    case "text": return { id, type, heading: "", body: "" };
    case "image": return { id, type, imageId: "", alt: "", caption: "" };
    case "features": return { id, type, eyebrow: "", heading: "", text: "", items: [{ title: "", text: "" }] };
    case "steps": return { id, type, eyebrow: "", heading: "", text: "", items: [{ title: "", text: "" }] };
    case "sports": return { id, type, eyebrow: "Sportsgrene", heading: "Sportsgrene med egne regler", text: "" };
    case "rules": return { id, type, eyebrow: "", heading: "", text: "", items: [{ tag: "", text: "" }] };
    case "cta": return { id, type, heading: "", text: "", label: "", href: "/" };
    case "faq": return { id, type, eyebrow: "", heading: "Spørgsmål og svar", items: [{ q: "", a: "" }] };
  }
}

const newPage = (): PageInput => ({ slug: "", title: "", description: "", status: "draft", showInNav: false, navOrder: 0, blocks: [] });

function ContentAdmin() {
  const { user, isPending } = useCurrentUserState();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    getMe()
      .then((p) => setAllowed(canManageContent(normalizeRole(p.role)) && p.accountStatus === "approved"))
      .catch(() => setAllowed(false));
  }, [user]);

  if (isPending) return <SiteShell><p className="mx-auto max-w-6xl px-5 py-16 text-muted">Indlæser…</p></SiteShell>;
  if (!user) return <RedirectToSignIn />;
  return (
    <SiteShell>
      {allowed === null ? (
        <p className="mx-auto max-w-6xl px-5 py-16 text-muted">Tjekker adgang…</p>
      ) : allowed ? (
        <Editor />
      ) : (
        <section className="mx-auto max-w-3xl px-5 py-20">
          <h1 className="font-display text-5xl">Ingen adgang</h1>
          <p className="mt-3 text-muted">Kun administratorer med rettigheden til hjemmesidens indhold kan redigere sider.</p>
        </section>
      )}
    </SiteShell>
  );
}

function Editor() {
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [media, setMedia] = useState<MediaInfo[]>([]);
  const [draft, setDraft] = useState<PageInput | null>(null);
  const [tab, setTab] = useState<"pages" | "media">("pages");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [p, m] = await Promise.all([cmsListPages(), cmsListMedia()]);
    setPages(p);
    setMedia(m);
  }, []);

  useEffect(() => { reload().catch((e: Error) => setError(e.message)); }, [reload]);

  async function run(work: () => Promise<void>, ok: string) {
    setBusy(true); setError(""); setNote("");
    try { await work(); setNote(ok); } catch (e) { setError((e as Error).message || "Noget gik galt."); }
    finally { setBusy(false); }
  }

  const save = (status?: PageInput["status"]) => draft && run(async () => {
    const saved = await cmsSavePage({ data: { ...draft, status: status ?? draft.status } });
    setDraft(saved);
    await reload();
  }, status === "published" ? "Siden er udgivet." : "Ændringerne er gemt.");

  const remove = () => draft?.id && window.confirm(`Slet siden "${draft.title}"? Det kan ikke fortrydes.`) && run(async () => {
    await cmsDeletePage({ data: { id: draft.id } });
    setDraft(null);
    await reload();
  }, "Siden er slettet.");

  const navPages = pages.filter((p) => p.showInNav && p.slug !== HOME_SLUG);
  const moveNav = (index: number, dir: -1 | 1) => run(async () => {
    const ids = navPages.map((p) => p.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await cmsReorderNav({ data: { ids } });
    await reload();
  }, "Menuens rækkefølge er gemt.");

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Administration</p>
          <h1 className="mt-2 font-display text-5xl">Rediger hjemmeside</h1>
          <p className="mt-2 max-w-2xl text-muted">Opret sider, byg dem op af sektioner, upload billeder, og vælg hvad der vises i menuen. Siden med adressen <code className="rounded bg-surface-2 px-1">{HOME_SLUG}</code> vises som ekstra sektioner på forsiden.</p>
        </div>
        <div className="flex gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "pages"} className={tab === "pages" ? btnPrimary : btnGhost} onClick={() => setTab("pages")}>Sider</button>
          <button type="button" role="tab" aria-selected={tab === "media"} className={tab === "media" ? btnPrimary : btnGhost} onClick={() => setTab("media")}>Billeder ({media.length})</button>
        </div>
      </div>

      <div aria-live="polite" className="mt-4 min-h-6 text-sm">
        {error ? <p className="text-danger">{error}</p> : note ? <p className="text-ok">{note}</p> : null}
      </div>

      {tab === "media" ? (
        <MediaLibrary media={media} busy={busy} run={run} reload={reload} />
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="grid content-start gap-5">
            <button type="button" className={btnPrimary} onClick={() => { setDraft(newPage()); setNote(""); setError(""); }}><Plus className="size-4" />Ny side</button>
            <button type="button" className={btnGhost} onClick={() => {
              const home = pages.find((p) => p.slug === HOME_SLUG);
              setDraft(home ?? { ...newPage(), slug: HOME_SLUG, title: "Forside", blocks: defaultHomeBlocks() });
              setNote(home ? "" : "Forsiden er indlæst med standardindholdet. Ret det, og tryk Udgiv."); setError("");
            }}>Rediger forsiden</button>
            <div className="rounded-card border border-line bg-surface p-3">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Alle sider</p>
              {pages.length === 0 ? <p className="px-2 text-sm text-muted">Ingen sider endnu.</p> : null}
              <ul className="grid gap-1">
                {pages.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setDraft(p)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm ${draft?.id === p.id ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                      <span className="truncate font-semibold">{p.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${p.status === "published" ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted"}`}>{p.status === "published" ? "Udgivet" : "Kladde"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {navPages.length ? (
              <div className="rounded-card border border-line bg-surface p-3">
                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Rækkefølge i menuen</p>
                <ol className="grid gap-1">
                  {navPages.map((p, i) => (
                    <li key={p.id} className="flex items-center gap-2 px-2 py-1 text-sm">
                      <span className="mr-auto truncate">{p.title}{p.status !== "published" ? " (kladde)" : ""}</span>
                      <button type="button" className={iconBtn} disabled={busy || i === 0} onClick={() => moveNav(i, -1)} aria-label={`Flyt ${p.title} op`}><ArrowUp className="size-4" /></button>
                      <button type="button" className={iconBtn} disabled={busy || i === navPages.length - 1} onClick={() => moveNav(i, 1)} aria-label={`Flyt ${p.title} ned`}><ArrowDown className="size-4" /></button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </aside>

          {draft ? (
            <PageForm draft={draft} setDraft={setDraft} media={media} busy={busy} onSave={save} onDelete={remove} />
          ) : (
            <div className="grid place-items-center rounded-card border border-dashed border-line bg-surface p-12 text-center text-muted">Vælg en side, eller opret en ny.</div>
          )}
        </div>
      )}
    </div>
  );
}

function L({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-fg">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

function PageForm({ draft, setDraft, media, busy, onSave, onDelete }: {
  draft: PageInput;
  setDraft: (p: PageInput) => void;
  media: MediaInfo[];
  busy: boolean;
  onSave: (status?: PageInput["status"]) => void;
  onDelete: () => void;
}) {
  const [addType, setAddType] = useState<BlockType>("text");
  const set = (patch: Partial<PageInput>) => setDraft({ ...draft, ...patch });
  const setBlock = (i: number, block: Block) => set({ blocks: draft.blocks.map((b, j) => (j === i ? block : b)) });
  const move = (i: number, dir: -1 | 1) => {
    const blocks = [...draft.blocks];
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    set({ blocks });
  };
  const publicUrl = draft.slug === HOME_SLUG ? "/" : `/side/${draft.slug}`;

  return (
    <form className="grid gap-6" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <div className="grid gap-4 rounded-card border border-line bg-surface p-6 sm:grid-cols-2">
        <L label="Titel"><input className={input} value={draft.title} maxLength={120} required onChange={(e) => set({ title: e.target.value, slug: draft.id || draft.slug ? draft.slug : "" })} onBlur={() => !draft.slug && set({ slug: slugify(draft.title) })} /></L>
        <L label="Adresse" hint={`Vises på ${publicUrl}. Kun a-z, 0-9 og bindestreg.`}><input className={input} value={draft.slug} maxLength={60} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></L>
        <L label="Kort beskrivelse (til søgemaskiner)"><input className={input} value={draft.description} maxLength={300} onChange={(e) => set({ description: e.target.value })} /></L>
        <div className="grid content-end gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.showInNav} disabled={draft.slug === HOME_SLUG} onChange={(e) => set({ showInNav: e.target.checked })} />Vis i menuen</label>
          <p className="text-muted">Status: <strong className="text-fg">{draft.status === "published" ? "Udgivet" : "Kladde (kun synlig her)"}</strong></p>
        </div>
      </div>

      <div className="grid gap-4">
        {draft.blocks.map((block, i) => (
          <section key={block.id} className="rounded-card border border-line bg-surface p-5">
            <div className="mb-4 flex items-center gap-2">
              <h3 className="mr-auto font-display text-2xl">{i + 1}. {BLOCK_LABEL[block.type]}</h3>
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Flyt sektion op"><ArrowUp className="size-4" /></button>
              <button type="button" className={iconBtn} disabled={i === draft.blocks.length - 1} onClick={() => move(i, 1)} aria-label="Flyt sektion ned"><ArrowDown className="size-4" /></button>
              <button type="button" className={iconBtn} onClick={() => set({ blocks: draft.blocks.filter((_, j) => j !== i) })} aria-label="Fjern sektion"><Trash2 className="size-4" /></button>
            </div>
            <BlockFields block={block} media={media} onChange={(b) => setBlock(i, b)} />
          </section>
        ))}
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-dashed border-line p-4">
          <select className={`${input} w-auto`} value={addType} onChange={(e) => setAddType(e.target.value as BlockType)} aria-label="Sektionstype">
            {BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_LABEL[t]}</option>)}
          </select>
          <button type="button" className={btnGhost} onClick={() => set({ blocks: [...draft.blocks, emptyBlock(addType)] })}><Plus className="size-4" />Tilføj sektion</button>
        </div>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-bg/95 py-4 backdrop-blur">
        <button type="submit" className={btnGhost} disabled={busy}>Gem {draft.status === "published" ? "ændringer" : "kladde"}</button>
        {draft.status === "published" ? (
          <button type="button" className={btnGhost} disabled={busy} onClick={() => onSave("draft")}>Gør til kladde</button>
        ) : (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => onSave("published")}>Udgiv</button>
        )}
        {draft.id && draft.status === "published" ? <a href={publicUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary">Se siden</a> : null}
        {draft.id ? <button type="button" className={`${btn} ml-auto text-danger`} disabled={busy} onClick={onDelete}><Trash2 className="size-4" />Slet side</button> : null}
      </div>
    </form>
  );
}

function ImagePick({ value, media, onChange }: { value: string; media: MediaInfo[]; onChange: (id: string) => void }) {
  return (
    <L label="Billede" hint={media.length ? undefined : "Upload først billeder under fanen Billeder."}>
      <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Intet billede</option>
        {media.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </L>
  );
}

function BlockFields({ block, media, onChange }: { block: Block; media: MediaInfo[]; onChange: (b: Block) => void }) {
  switch (block.type) {
    case "hero":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Lille overskrift"><input className={input} value={block.eyebrow} maxLength={60} onChange={(e) => onChange({ ...block, eyebrow: e.target.value })} /></L>
          <L label="Overskrift"><input className={input} value={block.heading} maxLength={140} onChange={(e) => onChange({ ...block, heading: e.target.value })} /></L>
          <div className="sm:col-span-2"><L label="Tekst"><textarea className={area} value={block.text} maxLength={600} onChange={(e) => onChange({ ...block, text: e.target.value })} /></L></div>
          <ImagePick value={block.imageId} media={media} onChange={(imageId) => onChange({ ...block, imageId })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <L label="Knaptekst"><input className={input} value={block.ctaLabel} maxLength={40} onChange={(e) => onChange({ ...block, ctaLabel: e.target.value })} /></L>
            <L label="Knaplink" hint="Fx /opret eller https://…"><input className={input} value={block.ctaHref} maxLength={500} onChange={(e) => onChange({ ...block, ctaHref: e.target.value })} /></L>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={block.accountButtons} onChange={(e) => onChange({ ...block, accountButtons: e.target.checked })} />Vis login-knapper (Opret bruger / Åbn scoreboard) og scoreboard-eksemplet, når der ikke er valgt billede</label>
        </div>
      );
    case "text":
      return (
        <div className="grid gap-3">
          <L label="Overskrift (valgfri)"><input className={input} value={block.heading} maxLength={140} onChange={(e) => onChange({ ...block, heading: e.target.value })} /></L>
          <L label="Tekst" hint="Tom linje = nyt afsnit. Linjer der starter med “- ” bliver punkter."><textarea className={`${area} min-h-48`} value={block.body} maxLength={8000} onChange={(e) => onChange({ ...block, body: e.target.value })} /></L>
        </div>
      );
    case "image":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ImagePick value={block.imageId} media={media} onChange={(imageId) => onChange({ ...block, imageId, alt: block.alt || media.find((m) => m.id === imageId)?.alt || "" })} />
          <L label="Alternativ tekst" hint="Beskriv billedet for skærmlæsere."><input className={input} value={block.alt} maxLength={200} onChange={(e) => onChange({ ...block, alt: e.target.value })} /></L>
          <div className="sm:col-span-2"><L label="Billedtekst (valgfri)"><input className={input} value={block.caption} maxLength={300} onChange={(e) => onChange({ ...block, caption: e.target.value })} /></L></div>
        </div>
      );
    case "features":
    case "steps":
      return (
        <div className="grid gap-3">
          <HeadFields block={block} onChange={onChange} />
          {block.items.map((item, i) => (
            <div key={i} className="grid gap-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-[1fr_2fr_auto]">
              <input className={input} placeholder="Titel" value={item.title} maxLength={80} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <input className={input} placeholder="Tekst" value={item.text} maxLength={400} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <button type="button" className={iconBtn} onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })} aria-label="Fjern punkt"><Trash2 className="size-4" /></button>
            </div>
          ))}
          {block.items.length < 12 ? <button type="button" className={`${btnGhost} justify-self-start`} onClick={() => onChange({ ...block, items: [...block.items, { title: "", text: "" }] })}><Plus className="size-4" />Tilføj punkt</button> : null}
        </div>
      );
    case "sports":
      return (
        <div className="grid gap-3">
          <HeadFields block={block} onChange={onChange} />
          <p className="text-sm text-muted">Listen over sportsgrene hentes automatisk fra appens sportskatalog.</p>
        </div>
      );
    case "rules":
      return (
        <div className="grid gap-3">
          <HeadFields block={block} onChange={onChange} long />
          {block.items.map((item, i) => (
            <div key={i} className="grid gap-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-[1fr_2fr_auto]">
              <input className={input} placeholder="Mærkat, fx Officiel" value={item.tag} maxLength={30} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)) })} />
              <input className={input} placeholder="Forklaring" value={item.text} maxLength={400} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <button type="button" className={iconBtn} onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })} aria-label="Fjern punkt"><Trash2 className="size-4" /></button>
            </div>
          ))}
          {block.items.length < 12 ? <button type="button" className={`${btnGhost} justify-self-start`} onClick={() => onChange({ ...block, items: [...block.items, { tag: "", text: "" }] })}><Plus className="size-4" />Tilføj punkt</button> : null}
        </div>
      );
    case "cta":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Overskrift"><input className={input} value={block.heading} maxLength={140} onChange={(e) => onChange({ ...block, heading: e.target.value })} /></L>
          <L label="Tekst"><input className={input} value={block.text} maxLength={400} onChange={(e) => onChange({ ...block, text: e.target.value })} /></L>
          <L label="Knaptekst"><input className={input} value={block.label} maxLength={40} onChange={(e) => onChange({ ...block, label: e.target.value })} /></L>
          <L label="Knaplink" hint="Fx /kontakt, https://… eller mailto:…"><input className={input} value={block.href} maxLength={500} onChange={(e) => onChange({ ...block, href: e.target.value })} /></L>
        </div>
      );
    case "faq":
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <L label="Lille overskrift"><input className={input} value={block.eyebrow} maxLength={60} onChange={(e) => onChange({ ...block, eyebrow: e.target.value })} /></L>
            <L label="Overskrift"><input className={input} value={block.heading} maxLength={140} onChange={(e) => onChange({ ...block, heading: e.target.value })} /></L>
          </div>
          {block.items.map((item, i) => (
            <div key={i} className="grid gap-2 rounded-xl bg-surface-2 p-3">
              <div className="flex gap-2">
                <input className={input} placeholder="Spørgsmål" value={item.q} maxLength={200} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
                <button type="button" className={iconBtn} onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })} aria-label="Fjern spørgsmål"><Trash2 className="size-4" /></button>
              </div>
              <textarea className={area} placeholder="Svar" value={item.a} maxLength={1500} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
            </div>
          ))}
          <button type="button" className={`${btnGhost} justify-self-start`} onClick={() => onChange({ ...block, items: [...block.items, { q: "", a: "" }] })}><Plus className="size-4" />Tilføj spørgsmål</button>
        </div>
      );
  }
}

type HeadBlock = Extract<Block, { eyebrow: string; heading: string; text: string }>;

function HeadFields<T extends HeadBlock>({ block, onChange, long }: { block: T; onChange: (b: T) => void; long?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <L label="Lille overskrift"><input className={input} value={block.eyebrow} maxLength={60} onChange={(e) => onChange({ ...block, eyebrow: e.target.value })} /></L>
      <L label="Overskrift"><input className={input} value={block.heading} maxLength={140} onChange={(e) => onChange({ ...block, heading: e.target.value })} /></L>
      <div className="sm:col-span-2"><L label="Indledning (valgfri)"><textarea className={area} value={block.text} maxLength={long ? 1500 : 600} onChange={(e) => onChange({ ...block, text: e.target.value })} /></L></div>
    </div>
  );
}

function MediaLibrary({ media, busy, run, reload }: {
  media: MediaInfo[];
  busy: boolean;
  run: (work: () => Promise<void>, ok: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [alt, setAlt] = useState("");

  function upload(file: File | undefined) {
    if (!file) return;
    void run(async () => {
      if (!(MEDIA_TYPES as readonly string[]).includes(file.type)) throw new Error("Vælg et JPG-, PNG-, WEBP- eller GIF-billede.");
      if (file.size > MAX_MEDIA_BYTES) throw new Error("Billedet må højst fylde 2 MB.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Filen kunne ikke læses."));
        reader.readAsDataURL(file);
      });
      await cmsUploadMedia({ data: { name: file.name, alt, dataUrl } });
      setAlt("");
      await reload();
    }, "Billedet er uploadet.");
  }

  return (
    <div className="mt-4 grid gap-6">
      <div className="grid gap-4 rounded-card border border-line bg-surface p-6 sm:grid-cols-[1fr_auto] sm:items-end">
        <L label="Beskrivelse af billedet (alternativ tekst)"><input className={input} value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} /></L>
        <label className={`${btnPrimary} cursor-pointer`}>
          <ImagePlus className="size-4" />Upload billede
          <input type="file" accept={MEDIA_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <p className="text-xs text-muted sm:col-span-2">JPG, PNG, WEBP eller GIF, højst 2 MB. Billederne gemmes i databasen og kan vælges i sektionerne.</p>
      </div>
      {media.length === 0 ? <p className="text-muted">Ingen billeder endnu.</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {media.map((m) => (
          <li key={m.id} className="overflow-hidden rounded-card border border-line bg-surface">
            <img src={m.url} alt={m.alt} className="aspect-video w-full bg-surface-2 object-cover" loading="lazy" />
            <div className="flex items-center gap-2 p-3 text-sm">
              <span className="mr-auto min-w-0">
                <span className="block truncate font-semibold">{m.name}</span>
                <span className="text-xs text-muted">{Math.round(m.size / 1024)} KB</span>
              </span>
              <button type="button" className={iconBtn} disabled={busy} aria-label={`Slet ${m.name}`} onClick={() => window.confirm(`Slet "${m.name}"? Sektioner der bruger billedet, viser det ikke længere.`) && void run(async () => { await cmsDeleteMedia({ data: { id: m.id } }); await reload(); }, "Billedet er slettet.")}>
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted"><Link to="/" className="text-primary">Til forsiden</Link></p>
    </div>
  );
}
