import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site-shell";
import { CmsBlocks, NotFoundPage } from "@/components/cms-blocks";
import { getPublishedPage } from "@/lib/cms/api";

export const Route = createFileRoute("/side/$slug")({
  loader: ({ params }) => getPublishedPage({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: `${loaderData.title} · BanditBoard Live` }, ...(loaderData.description ? [{ name: "description", content: loaderData.description }] : [])]
      : [{ title: "Siden findes ikke · BanditBoard Live" }],
  }),
  component: CmsPageView,
});

function CmsPageView() {
  const page = Route.useLoaderData();
  return (
    <SiteShell>
      {!page ? (
        <NotFoundPage />
      ) : (
        <>
          {page.blocks[0]?.type === "hero" ? null : (
            <header className="border-b border-line bg-surface-2/60">
              <div className="mx-auto max-w-3xl px-5 py-14">
                <h1 className="font-display text-5xl text-fg sm:text-6xl">{page.title}</h1>
                {page.description ? <p className="mt-4 text-lg text-muted">{page.description}</p> : null}
              </div>
            </header>
          )}
          <CmsBlocks blocks={page.blocks} />
        </>
      )}
    </SiteShell>
  );
}
