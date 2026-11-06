import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { CmsPage, MediaInfo, NavPage } from "./schema";

/* Offentlige læsninger (kun udgivne sider). */

export const getPublishedPage = createServerFn({ method: "GET" })
  .validator((input: { slug?: string }) => ({ slug: String(input?.slug ?? "").slice(0, 60) }))
  .handler(async ({ data }): Promise<CmsPage | null> => {
    const { cmsDb } = await import("./server");
    const { readPublishedPage } = await import("./core");
    return readPublishedPage(await cmsDb(), data.slug);
  });

export const getNavPages = createServerFn({ method: "GET" }).handler(async (): Promise<NavPage[]> => {
  const { cmsDb } = await import("./server");
  const { listNav } = await import("./core");
  return listNav(await cmsDb());
});

/* Redaktør: rollen tjekkes på serveren i hvert kald. */

export const cmsListPages = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CmsPage[]> => {
    const { cmsDb, editorFor } = await import("./server");
    const { listPages } = await import("./core");
    return listPages(await cmsDb(), await editorFor(context.userId));
  });

export const cmsSavePage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: Record<string, unknown>) => input)
  .handler(async ({ context, data }): Promise<CmsPage> => {
    const { cmsDb, editorFor, auditCms } = await import("./server");
    const { savePage } = await import("./core");
    const editor = await editorFor(context.userId);
    const page = await savePage(await cmsDb(), editor, data);
    await auditCms(editor, "Hjemmeside: side gemt", `${page.title} (/${page.slug}, ${page.status === "published" ? "udgivet" : "kladde"})`);
    return page;
  });

export const cmsDeletePage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: String(input?.id ?? "").slice(0, 40) }))
  .handler(async ({ context, data }) => {
    const { cmsDb, editorFor, auditCms } = await import("./server");
    const { deletePage } = await import("./core");
    const editor = await editorFor(context.userId);
    const result = await deletePage(await cmsDb(), editor, data.id);
    await auditCms(editor, "Hjemmeside: side slettet", data.id);
    return result;
  });

export const cmsReorderNav = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids?: string[] }) => ({ ids: Array.isArray(input?.ids) ? input.ids.slice(0, 200).map(String) : [] }))
  .handler(async ({ context, data }) => {
    const { cmsDb, editorFor } = await import("./server");
    const { reorderNav } = await import("./core");
    return reorderNav(await cmsDb(), await editorFor(context.userId), data.ids);
  });

export const cmsListMedia = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MediaInfo[]> => {
    const { cmsDb, editorFor } = await import("./server");
    const { listMedia } = await import("./core");
    return listMedia(await cmsDb(), await editorFor(context.userId));
  });

export const cmsUploadMedia = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name?: string; alt?: string; dataUrl?: string }) => {
    const dataUrl = String(input?.dataUrl ?? "");
    // 2 MB binært er ca. 2,8 MB base64: afvis tidligt, før noget dekodes.
    if (dataUrl.length > 2_900_000) throw new Error("Billedet må højst fylde 2 MB.");
    return { name: String(input?.name ?? "").slice(0, 120), alt: String(input?.alt ?? "").slice(0, 200), dataUrl };
  })
  .handler(async ({ context, data }): Promise<MediaInfo> => {
    const { cmsDb, editorFor, auditCms } = await import("./server");
    const { uploadMedia } = await import("./core");
    const editor = await editorFor(context.userId);
    const media = await uploadMedia(await cmsDb(), editor, data);
    await auditCms(editor, "Hjemmeside: billede uploadet", `${media.name} (${Math.round(media.size / 1024)} KB)`);
    return media;
  });

export const cmsDeleteMedia = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id?: string }) => ({ id: String(input?.id ?? "").slice(0, 40) }))
  .handler(async ({ context, data }) => {
    const { cmsDb, editorFor, auditCms } = await import("./server");
    const { deleteMedia } = await import("./core");
    const editor = await editorFor(context.userId);
    const result = await deleteMedia(await cmsDb(), editor, data.id);
    await auditCms(editor, "Hjemmeside: billede slettet", data.id);
    return result;
  });
