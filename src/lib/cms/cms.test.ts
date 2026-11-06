import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  deleteMedia, deletePage, ensureCmsSchema, listMedia, listNav, listPages, readMedia,
  readPublishedPage, reorderNav, requireEditor, savePage, uploadMedia, type Actor, type CmsSql,
} from "./core.ts";
import { CmsError, safeHref, sanitizeBlocks, sanitizePageInput, slugify, sniffImage } from "./schema.ts";
import { hasPermission } from "../roles.ts";

const admin: Actor = { id: "u-admin", role: "admin", accountStatus: "approved" };
const manager: Actor = { id: "u-man", role: "administrator_manager", accountStatus: "approved" };
const user: Actor = { id: "u-user", role: "bruger", accountStatus: "approved" };
const scorer: Actor = { id: "u-score", role: "scoreboard_admin", accountStatus: "approved" };
const pendingAdmin: Actor = { id: "u-pend", role: "admin", accountStatus: "pending" };

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082", "hex");
const pngUrl = `data:image/png;base64,${PNG.toString("base64")}`;

let sql: CmsSql;
before(async () => {
  const db = new PGlite();
  sql = { query: async (text, params) => (await db.query(text, params as unknown[])).rows as never };
  await ensureCmsSchema(sql);
});

describe("CMS-adgang", () => {
  it("kun godkendte konti med MANAGE_CONTENT må redigere", () => {
    assert.equal(requireEditor(admin), admin);
    assert.equal(requireEditor(manager), manager);
    for (const actor of [user, scorer, pendingAdmin, null]) assert.throws(() => requireEditor(actor), CmsError);
    assert.equal(hasPermission("administrer_indstillinger", "MANAGE_CONTENT"), true);
    assert.equal(hasPermission("gaest", "MANAGE_CONTENT"), false);
  });

  it("afviser skrivning og læsning af kladder for andre roller", async () => {
    await assert.rejects(savePage(sql, user, { title: "Hack", slug: "hack", blocks: [] }), CmsError);
    await assert.rejects(listPages(sql, scorer), CmsError);
    await assert.rejects(uploadMedia(sql, user, { dataUrl: pngUrl }), CmsError);
    await assert.rejects(deletePage(sql, pendingAdmin, "abcdefgh"), CmsError);
  });
});

describe("Sider", () => {
  it("opretter kladde, udgiver, viser i menu og sletter", async () => {
    const draft = await savePage(sql, admin, {
      title: "Om os & regler", description: "Klubben", showInNav: true,
      blocks: [{ type: "text", heading: "Hej", body: "Første afsnit" }, { type: "evil", html: "<script>" }],
    });
    assert.equal(draft.slug, "om-os-regler");
    assert.equal(draft.status, "draft");
    assert.equal(draft.blocks.length, 1, "ukendte sektionstyper fjernes");
    assert.equal(await readPublishedPage(sql, "om-os-regler"), null, "kladder er ikke offentlige");
    assert.deepEqual(await listNav(sql), []);

    const published = await savePage(sql, admin, { ...draft, status: "published" });
    assert.equal((await readPublishedPage(sql, "om-os-regler"))?.title, "Om os & regler");
    assert.deepEqual(await listNav(sql), [{ slug: "om-os-regler", title: "Om os & regler" }]);

    await assert.rejects(savePage(sql, admin, { title: "Dublet", slug: "om-os-regler" }), /allerede/);
    await deletePage(sql, admin, published.id);
    assert.equal(await readPublishedPage(sql, "om-os-regler"), null);
  });

  it("gemmer menuens rækkefølge", async () => {
    const a = await savePage(sql, admin, { title: "Alfa", status: "published", showInNav: true });
    const b = await savePage(sql, admin, { title: "Beta", status: "published", showInNav: true });
    await reorderNav(sql, admin, [b.id, a.id]);
    assert.deepEqual((await listNav(sql)).map((p) => p.slug), ["beta", "alfa"]);
  });

  it("afviser appens egne adresser og forsiden i menuen", async () => {
    await assert.rejects(savePage(sql, admin, { title: "Admin", slug: "admin" }), CmsError);
    await assert.rejects(savePage(sql, admin, { title: "x", slug: "../etc" }), CmsError);
    const home = await savePage(sql, admin, { title: "Forside", slug: "forside", showInNav: true });
    assert.equal(home.showInNav, false);
  });
});

describe("Sikkert indhold", () => {
  it("fjerner farlige links", () => {
    assert.equal(safeHref("javascript:alert(1)"), "");
    assert.equal(safeHref("data:text/html,x"), "");
    assert.equal(safeHref("//evil.example"), "");
    assert.equal(safeHref("/opret"), "/opret");
    assert.equal(safeHref("https://banditboardlive.com/x"), "https://banditboardlive.com/x");
    assert.equal(safeHref("mailto:info@example.com"), "mailto:info@example.com");
    const [cta] = sanitizeBlocks([{ type: "cta", heading: "h", label: "l", href: "javascript:alert(1)" }]);
    assert.equal(cta.type === "cta" && cta.href, "");
  });

  it("begrænser længder og antal sektioner og laver pæne adresser", () => {
    const page = sanitizePageInput({ title: "x".repeat(500), blocks: [] });
    assert.equal(page.title.length, 120);
    assert.throws(() => sanitizeBlocks(Array.from({ length: 41 }, () => ({ type: "text", body: "a" }))), CmsError);
    assert.equal(slugify("Ærø Påske Øl"), "aeroe-paaske-oel");
  });
});

describe("Billeder", () => {
  it("uploader, viser og sletter et rigtigt PNG", async () => {
    const media = await uploadMedia(sql, admin, { name: "logo<script>.png", alt: "Logo", dataUrl: pngUrl });
    assert.equal(media.mime, "image/png");
    assert.ok(!media.name.includes("<"));
    assert.match(media.url, /^\/api\/media\//);
    const stored = await readMedia(sql, media.id);
    assert.deepEqual(Buffer.from(stored!.bytes), PNG);
    assert.equal((await listMedia(sql, admin)).length, 1);
    await deleteMedia(sql, admin, media.id);
    assert.equal(await readMedia(sql, media.id), null);
  });

  it("afviser SVG, forfalsket type og for store filer", async () => {
    const svg = Buffer.from("<svg onload=alert(1)></svg>").toString("base64");
    await assert.rejects(uploadMedia(sql, admin, { dataUrl: `data:image/svg+xml;base64,${svg}` }), CmsError);
    await assert.rejects(uploadMedia(sql, admin, { dataUrl: `data:image/jpeg;base64,${PNG.toString("base64")}` }), CmsError);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]).toString("base64");
    await assert.rejects(uploadMedia(sql, admin, { dataUrl: `data:image/png;base64,${big}` }), /2 MB/);
    assert.equal(sniffImage(new Uint8Array(Buffer.from("GIF89a"))), "image/gif");
    assert.equal(await readMedia(sql, "../../x"), null);
  });
});
