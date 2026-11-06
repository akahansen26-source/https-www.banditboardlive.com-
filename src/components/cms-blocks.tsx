import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { mediaUrl, safeHref, type Block } from "@/lib/cms/schema";

/**
 * Viser CMS-sektioner. Alt indhold er ren tekst, som React escaper; der bruges
 * aldrig dangerouslySetInnerHTML. Links køres gennem safeHref igen ved visning.
 */
export function CmsBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block) => (
        <CmsBlock key={block.id} block={block} />
      ))}
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

function CmsBlock({ block }: { block: Block }) {
  switch (block.type) {
    case "hero":
      return (
        <section className="border-b border-line bg-surface-2/60">
          <div className={`mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 sm:py-24 ${block.imageId ? "lg:grid-cols-2" : ""}`}>
            <div>
              {block.eyebrow ? <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">{block.eyebrow}</p> : null}
              <h1 className="font-display text-5xl text-fg sm:text-6xl">{block.heading}</h1>
              {block.text ? <p className="mt-5 max-w-xl text-lg text-muted">{block.text}</p> : null}
              {block.ctaLabel && block.ctaHref ? <div className="mt-8"><SmartLink href={block.ctaHref} className={btn}>{block.ctaLabel}</SmartLink></div> : null}
            </div>
            {block.imageId ? <img src={mediaUrl(block.imageId)} alt="" className="w-full rounded-card border border-line object-cover shadow-sm" loading="lazy" /> : null}
          </div>
        </section>
      );
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
        <section className="mx-auto max-w-6xl px-5 py-14">
          {block.heading ? <h2 className="mb-8 font-display text-4xl text-fg">{block.heading}</h2> : null}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {block.items.map((item, i) => (
              <article key={i} className="rounded-card border border-line bg-surface p-6">
                <h3 className="font-display text-2xl text-fg">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
              </article>
            ))}
          </div>
        </section>
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
        <section className="mx-auto max-w-3xl px-5 py-12">
          {block.heading ? <h2 className="mb-6 font-display text-4xl text-fg">{block.heading}</h2> : null}
          <div className="divide-y divide-line rounded-card border border-line bg-surface">
            {block.items.map((item, i) => (
              <details key={i} className="group px-5 py-4">
                <summary className="cursor-pointer list-none font-semibold text-fg">{item.q}</summary>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
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
