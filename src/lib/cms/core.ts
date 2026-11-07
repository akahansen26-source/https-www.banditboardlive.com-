/**
 * CMS-forretningslogik. Tager databasen og den handlende bruger som argumenter,
 * så reglerne kan testes direkte mod en rigtig (PGLite) Postgres.
 * Alle skrivninger kræver rollen med MANAGE_CONTENT og en godkendt konto.
 */
import { randomBytes } from "node:crypto";
import { hasPermission, normalizeRole } from "../roles.ts";
import {
  CmsError,
  HOME_SLUG,
  MAX_MEDIA_BYTES,
  clip,
  mediaId,
  mediaUrl,
  sanitizeBlocks,
  sanitizePageInput,
  sniffImage,
  type CmsPage,
  type MediaInfo,
  type NavPage,
} from "./schema.ts";

export type CmsSql = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };
export type Actor = { id: string; role: string; accountStatus: string };

export const CMS_SCHEMA = [
  `create table if not exists cms_pages (
    id text primary key,
    slug text not null unique,
    title text not null,
    description text not null default '',
    status text not null default 'draft',
    show_in_nav boolean not null default false,
    nav_order integer not null default 0,
    blocks text not null default '[]',
    updated_by text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  "create index if not exists cms_pages_nav_idx on cms_pages (status, show_in_nav, nav_order)",
  `create table if not exists cms_media (
    id text primary key,
    name text not null,
    mime text not null,
    size integer not null,
    alt text not null default '',
    data text not null,
    created_by text not null default '',
    created_at timestamptz not null default now()
  )`,
];

export async function ensureCmsSchema(sql: CmsSql) {
  for (const statement of CMS_SCHEMA) await sql.query(statement);
}

/** Den delte udviklerbruger, som appen falder tilbage til uden login. Må aldrig redigere. */
export const FALLBACK_USER_IDS = new Set(["dev-user", ""]);

export function requireEditor(actor: Actor | null | undefined): Actor {
  if (!actor || FALLBACK_USER_IDS.has(String(actor.id ?? "").trim())) throw new CmsError("Du skal være logget ind med en rigtig konto.");
  if (actor.accountStatus !== "approved") throw new CmsError("Din konto er ikke godkendt.");
  if (!hasPermission(normalizeRole(actor.role), "MANAGE_CONTENT")) throw new CmsError("Du har ikke adgang til at redigere hjemmesiden.");
  return actor;
}

const newId = () => randomBytes(12).toString("base64url");

type PageRow = {
  id: string; slug: string; title: string; description: string; status: string;
  show_in_nav: boolean; nav_order: number; blocks: string; updated_by: string; updated_at: string;
};

function toPage(row: PageRow): CmsPage {
  let blocks: unknown = [];
  try { blocks = JSON.parse(row.blocks); } catch { blocks = []; }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status === "published" ? "published" : "draft",
    showInNav: Boolean(row.show_in_nav),
    navOrder: Number(row.nav_order) || 0,
    blocks: sanitizeBlocks(blocks),
    updatedBy: row.updated_by,
    updatedAt: String(row.updated_at),
  };
}

const PAGE_COLS = "id, slug, title, description, status, show_in_nav, nav_order, blocks, updated_by, updated_at";

/* ---------- Offentlig læsning ---------- */

export async function readPublishedPage(sql: CmsSql, slug: string): Promise<CmsPage | null> {
  const rows = await sql.query<PageRow>(`select ${PAGE_COLS} from cms_pages where slug = $1 and status = 'published'`, [clip(slug, 60).toLowerCase()]);
  return rows[0] ? toPage(rows[0]) : null;
}

export async function listNav(sql: CmsSql): Promise<NavPage[]> {
  const rows = await sql.query<{ slug: string; title: string }>(
    "select slug, title from cms_pages where status = 'published' and show_in_nav = true and slug <> $1 order by nav_order, title limit 12",
    [HOME_SLUG],
  );
  return rows.map((r) => ({ slug: r.slug, title: r.title }));
}

export async function readMedia(sql: CmsSql, id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const clean = mediaId(id);
  if (!clean) return null;
  const rows = await sql.query<{ mime: string; data: string }>("select mime, data from cms_media where id = $1", [clean]);
  if (!rows[0]) return null;
  return { mime: rows[0].mime, bytes: new Uint8Array(Buffer.from(rows[0].data, "base64")) };
}

/* ---------- Redaktør ---------- */

export async function listPages(sql: CmsSql, actor: Actor | null): Promise<CmsPage[]> {
  requireEditor(actor);
  const rows = await sql.query<PageRow>(`select ${PAGE_COLS} from cms_pages order by nav_order, title`);
  return rows.map(toPage);
}

export async function savePage(sql: CmsSql, actor: Actor | null, raw: unknown): Promise<CmsPage> {
  const editor = requireEditor(actor);
  const input = sanitizePageInput(raw);
  const clash = await sql.query<{ id: string }>("select id from cms_pages where slug = $1", [input.slug]);
  if (clash[0] && clash[0].id !== input.id) throw new CmsError("Der findes allerede en side med den adresse.");
  const blocks = JSON.stringify(input.blocks);
  if (input.id) {
    const rows = await sql.query<PageRow>(
      `update cms_pages set slug = $2, title = $3, description = $4, status = $5, show_in_nav = $6, nav_order = $7,
        blocks = $8, updated_by = $9, updated_at = now() where id = $1 returning ${PAGE_COLS}`,
      [input.id, input.slug, input.title, input.description, input.status, input.showInNav, input.navOrder, blocks, editor.id],
    );
    if (!rows[0]) throw new CmsError("Siden findes ikke længere.");
    return toPage(rows[0]);
  }
  const rows = await sql.query<PageRow>(
    `insert into cms_pages (id, slug, title, description, status, show_in_nav, nav_order, blocks, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${PAGE_COLS}`,
    [newId(), input.slug, input.title, input.description, input.status, input.showInNav, input.navOrder, blocks, editor.id],
  );
  return toPage(rows[0]);
}

export async function deletePage(sql: CmsSql, actor: Actor | null, id: string): Promise<{ ok: true }> {
  requireEditor(actor);
  const clean = mediaId(id);
  if (!clean) throw new CmsError("Ukendt side.");
  await sql.query("delete from cms_pages where id = $1", [clean]);
  return { ok: true };
}

/** Gem rækkefølgen i menuen: listen er side-id'er i den ønskede rækkefølge. */
export async function reorderNav(sql: CmsSql, actor: Actor | null, ids: unknown): Promise<{ ok: true }> {
  requireEditor(actor);
  const list = (Array.isArray(ids) ? ids : []).slice(0, 200).map(mediaId).filter(Boolean);
  for (const [index, id] of list.entries()) {
    await sql.query("update cms_pages set nav_order = $2, updated_at = now() where id = $1", [id, index]);
  }
  return { ok: true };
}

type MediaRow = { id: string; name: string; mime: string; size: number; alt: string; created_at: string };
const toMedia = (r: MediaRow): MediaInfo => ({ id: r.id, name: r.name, mime: r.mime, size: Number(r.size), alt: r.alt, createdAt: String(r.created_at), url: mediaUrl(r.id) });

export async function listMedia(sql: CmsSql, actor: Actor | null): Promise<MediaInfo[]> {
  requireEditor(actor);
  const rows = await sql.query<MediaRow>("select id, name, mime, size, alt, created_at from cms_media order by created_at desc limit 300");
  return rows.map(toMedia);
}

/** `dataUrl` er "data:<type>;base64,...". Typen kontrolleres mod filens faktiske indhold. */
export async function uploadMedia(sql: CmsSql, actor: Actor | null, input: { name?: unknown; alt?: unknown; dataUrl?: unknown }): Promise<MediaInfo> {
  const editor = requireEditor(actor);
  const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(input?.dataUrl ?? ""));
  if (!match) throw new CmsError("Filen kunne ikke læses. Vælg et billede.");
  const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
  if (bytes.length === 0) throw new CmsError("Filen er tom.");
  if (bytes.length > MAX_MEDIA_BYTES) throw new CmsError("Billedet må højst fylde 2 MB.");
  const sniffed = sniffImage(bytes);
  if (!sniffed || sniffed !== match[1]) throw new CmsError("Kun JPG, PNG, WEBP og GIF er tilladt (SVG og andre filer afvises).");
  const id = newId();
  const name = clip(input?.name, 120).replace(/[^\w .()-]/g, "_") || "billede";
  const rows = await sql.query<MediaRow>(
    "insert into cms_media (id, name, mime, size, alt, data, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id, name, mime, size, alt, created_at",
    [id, name, sniffed, bytes.length, clip(input?.alt, 200), Buffer.from(bytes).toString("base64"), editor.id],
  );
  return toMedia(rows[0]);
}

export async function deleteMedia(sql: CmsSql, actor: Actor | null, id: string): Promise<{ ok: true }> {
  requireEditor(actor);
  const clean = mediaId(id);
  if (!clean) throw new CmsError("Ukendt billede.");
  await sql.query("delete from cms_media where id = $1", [clean]);
  return { ok: true };
}
