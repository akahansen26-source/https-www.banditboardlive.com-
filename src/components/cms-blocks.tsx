import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { mediaUrl, safeHref, type Block } from "@/lib/cms/schema";
import { SPORTS, SPORT_GROUPS } from "@/lib/sports/catalog";

/**
 * Viser CMS-sektioner. Alt indhold er ren tekst, som React escaper; der bruges
 * aldrig dangerouslySetInnerHTML. Links køres gennem safeHref igen ved visning.
 */
type Extras = { accountButtons?: ReactNode; heroShowcase?: ReactNode };

export function CmsBlocks({ blocks, extras = {} }: { blocks: Block[]; extras?: Extras }) {
  // Hver anden "brede" sektion får en sandfarvet baggrund, så siden får rytme.
  let band = 0;
  return (
    <>
      {blocks.map((block) => {
        const wide = ["features", "steps", "sports", "rules", "faq"].includes(block.type);
        const tinted = wide && band++ % 2 === 1;
        return <CmsBlock key={block.id} block={block} extras={extras} tinted={tinted} />;
      })}
    </>
  );
}

function SmartLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return null;
  if (safe.startsWith("/")) return <a href={safe} className={className}>{children}</a>;
  return <a href={safe} className={className} rel="noopener noreferrer nofollow" target={safe.startsWith("mailto:") ? undefined : "_blank"}>{children}</a>;
}

/** Afsnit adskilles af en tom linje; linjer der starter med "- " bliver punktopstilling. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-4 text-base leading-relaxed text-muted">
      {parts.map((part, i) => {
        const lines = part.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => <li key={j}>{l.replace(/^\s*[-•]\s+/, "")}</li>)}
            </ul>
          );
        }
        return <p key={i} className="whitespace-pre-line">{part}</p>;
      })}
    </div>
  );
}

const btn = "inline-flex min-h-12 items-center rounded-full bg-primary px-6 text-base font-semibold text-primary-fg transition hover:opacity-90";

const eyebrowCls = "text-sm font-semibold uppercase tracking-[0.2em] text-primary";
const titleCls = "font-display text-4xl text-fg sm:text-5xl";

function Head({ eyebrow, heading, text }: { eyebrow?: string; heading: string; text?: string }) {
  return (
    <>
      {eyebrow ? <p className={eyebrowCls}>{eyebrow}</p> : null}
      {heading ? <h2 className={`${eyebrow ? "mt-3 " : ""}${titleCls}`}>{heading}</h2> : null}
      {text ? <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{text}</p> : null}
    </>
  );
}

function Band({ tinted, children, narrow }: { tinted: boolean; children: ReactNode; narrow?: boolean }) {
  return (
    <section className={tinted ? "border-y border-line bg-surface-2/60" : ""}>
      <div className={`mx-auto px-5 py-20 ${narrow ? "max-w-3xl" : "max-w-6xl"}`}>{children}</div>
    </section>
  );
}

function CmsBlock({ block, extras, tinted }: { block: Block; extras: Extras; tinted: boolean }) {
  switch (block.type) {
    case "hero": {
      const side = block.imageId
        ? <img src={mediaUrl(block.imageId)} alt="" className="w-full rounded-card border border-line object-cover shadow-sm" />
        : block.accountButtons ? extras.heroShowcase ?? null : null;
      return (
        <section className="border-b border-line">
          <div className={`mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-24 ${side ? "lg:grid-cols-[1.1fr_0.9fr]" : ""}`}>
            <div>
              {block.eyebrow ? <p className={eyebrowCls}>{block.eyebrow}</p> : null}
              <h1 className="mt-4 max-w-xl font-display text-5xl text-fg sm:text-7xl">{block.heading}</h1>
              {block.text ? <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{block.text}</p> : null}
              {(block.ctaLabel && block.ctaHref) || block.accountButtons ? (
                <div className="mt-9 flex min-h-12 flex-wrap gap-3">
                  {block.ctaLabel && block.ctaHref ? <SmartLink href={block.ctaHref} className={btn}>{block.ctaLabel}</SmartLink> : null}
                  {block.accountButtons ? extras.accountButtons : null}
                </div>
              ) : null}
            </div>
            {side}
          </div>
        </section>
      );
    }
    case "text":
      return (
        <section className="mx-auto max-w-3xl px-5 py-12">
          {block.heading ? <h2 className="mb-4 font-display text-4xl text-fg">{block.heading}</h2> : null}
          <RichText text={block.body} />
        </section>
      );
    case "image":
      return block.imageId ? (
        <figure className="mx-auto max-w-5xl px-5 py-10">
          <img src={mediaUrl(block.imageId)} alt={block.alt} className="w-full rounded-card border border-line object-cover" loading="lazy" />
          {block.caption ? <figcaption className="mt-3 text-center text-sm text-muted">{block.caption}</figcaption> : null}
        </figure>
      ) : null;
    case "features":
      return (
        <Band tinted={tinted}>
          <Head eyebrow={block.eyebrow} heading={block.heading} text={block.text} />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {block.items.map((item, i) => (
              <article key={i} className="rounded-card border border-line bg-surface p-6">
                <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full bg-primary/70" />
                <h3 className="font-display text-2xl text-fg">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
              </article>
            ))}
          </div>
        </Band>
      );
    case "steps":
      return (
        <Band tinted={tinted}>
          <Head eyebrow={block.eyebrow} heading={block.heading} text={block.text} />
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {block.items.map((item, i) => (
              <li key={i} className="rounded-card border border-line bg-surface p-6">
                <span className="font-display text-4xl text-primary">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 font-display text-2xl text-fg">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
              </li>
            ))}
          </ol>
        </Band>
      );
    case "sports":
      return (
        <Band tinted={tinted}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Head eyebrow={block.eyebrow} heading={block.heading} text={block.text} />
              <p className="mt-3 text-sm text-muted">{SPORTS.length} sportsgrene i kataloget.</p>
            </div>
            <Link to="/sport" className="inline-flex min-h-12 items-center rounded-full border border-line bg-surface px-6 font-semibold text-fg hover:border-primary">Se alle sportsgrene og regler</Link>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SPORT_GROUPS.map((group) => (
              <article key={group} className="rounded-card border border-line bg-surface p-6">
                <h3 className="font-display text-2xl text-fg">{group}</h3>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {SPORTS.filter((sp) => sp.group === group).map((sp) => (
                    <li key={sp.id}>
                      <Link to="/sport/$sportId" params={{ sportId: sp.id }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-bg px-3 text-sm text-fg hover:border-primary">
                        <span aria-hidden="true">{sp.emoji}</span>
                        {sp.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Band>
      );
    case "rules":
      return (
        <Band tinted={tinted}>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              {block.eyebrow ? <p className={eyebrowCls}>{block.eyebrow}</p> : null}
              {block.heading ? <h2 className={`mt-3 ${titleCls}`}>{block.heading}</h2> : null}
              {block.text ? <div className="mt-5"><RichText text={block.text} /></div> : null}
            </div>
            <ul className="grid content-start gap-4">
              {block.items.map((item, i) => (
                <li key={i} className="rounded-card border border-line bg-surface p-5">
                  {item.tag ? <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">{item.tag}</span> : null}
                  <p className="mt-3 text-sm leading-relaxed text-muted">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </Band>
      );
    case "cta":
      return (
        <section className="mx-auto max-w-6xl px-5 py-12">
          <div className="flex flex-col items-start gap-5 rounded-card border border-line bg-surface-2 p-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-3xl text-fg">{block.heading}</h2>
              {block.text ? <p className="mt-2 max-w-xl text-muted">{block.text}</p> : null}
            </div>
            {block.label && block.href ? <SmartLink href={block.href} className={btn}>{block.label}</SmartLink> : null}
          </div>
        </section>
      );
    case "faq":
      return (
        <Band tinted={tinted} narrow>
          <Head eyebrow={block.eyebrow} heading={block.heading} />
          <div className="mt-8 divide-y divide-line rounded-card border border-line bg-surface">
            {block.items.map((item, i) => (
              <details key={i} className="px-6 py-5">
                <summary className="cursor-pointer list-none font-semibold text-fg">{item.q}</summary>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </Band>
      );
  }
}

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-24 text-center">
      <h1 className="font-display text-5xl text-fg">Siden findes ikke</h1>
      <p className="mt-4 text-muted">Den er måske flyttet eller ikke udgivet endnu.</p>
      <Link to="/" className="mt-8 inline-flex min-h-12 items-center rounded-full bg-primary px-6 font-semibold text-primary-fg">Til forsiden</Link>
    </section>
  );
}
