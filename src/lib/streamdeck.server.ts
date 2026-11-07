import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { ensureProfile } from "@/lib/board-store.server";
import { canRunLiveBoard } from "@/lib/roles";
import { writeAudit } from "@/lib/audit.server";

/**
 * Stream Deck / fjernbetjening.
 * Plugin → POST kommando (med nøgle) → kø i databasen → brugerens åbne scoreboard henter den
 * (long-poll), klikker på den tilsvarende knap og melder resultatet tilbage.
 */

const TOKEN_PREFIX = "bbsd_";
const COMMAND_TTL_SECONDS = 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class RemoteError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function allowed(userId: string) {
  const p = await ensureProfile(userId);
  if (!p.active || p.accountStatus !== "approved") throw new RemoteError("Kontoen er ikke aktiv.", 403);
  if (!canRunLiveBoard(p.role)) throw new RemoteError("Din rolle må ikke styre scoreboardet. Det kræver Scoreboard-admin eller højere.", 403);
  return p;
}

async function row(userId: string) {
  const sql = await getSql();
  const rows = await sql.query<{ token_hint: string; seen_at: string | null; token_hash: string | null }>(
    `select token_hint, seen_at::text as seen_at, token_hash from board_remote where user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function remoteInfo(userId: string) {
  await allowed(userId);
  const r = await row(userId);
  return { hasToken: Boolean(r?.token_hash), hint: r?.token_hint ?? "", seenAt: r?.seen_at ?? null };
}

/** Laver en ny nøgle (den gamle holder op med at virke). Nøglen vises kun denne ene gang. */
export async function newToken(userId: string) {
  const p = await allowed(userId);
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const sql = await getSql();
  await sql.query(
    `insert into board_remote (user_id, token_hash, token_hint) values ($1, $2, $3)
     on conflict (user_id) do update set token_hash = excluded.token_hash, token_hint = excluded.token_hint`,
    [userId, hash(token), token.slice(-4)],
  );
  await writeAudit({ actorId: p.userId, actorName: p.venueName || p.accountName || p.email, actorRole: p.role, action: "Ny Stream Deck-nøgle", detail: `Slutter på …${token.slice(-4)}` });
  return { token, hint: token.slice(-4) };
}

export async function revokeToken(userId: string) {
  await allowed(userId);
  const sql = await getSql();
  await sql.query(`update board_remote set token_hash = null, token_hint = '' where user_id = $1`, [userId]);
}

export async function userByToken(token: string | null | undefined): Promise<string> {
  const t = (token ?? "").trim();
  if (!t.startsWith(TOKEN_PREFIX) || t.length > 80) throw new RemoteError("Ugyldig nøgle. Lav en ny under Stream Deck på scoreboardet.", 401);
  const sql = await getSql();
  const rows = await sql.query<{ user_id: string }>(`select user_id from board_remote where token_hash = $1`, [hash(t)]);
  if (!rows[0]) throw new RemoteError("Nøglen findes ikke længere. Lav en ny under Stream Deck på scoreboardet.", 401);
  await allowed(rows[0].user_id);
  return rows[0].user_id;
}

type BoardStatus = { online: boolean; seenAt: string | null; statusAt: string | null; catalog: unknown[]; status: Record<string, unknown> };

export async function readStatus(userId: string, since?: string | null, waitMs = 0): Promise<BoardStatus> {
  const sql = await getSql();
  const end = Date.now() + Math.min(Math.max(waitMs, 0), 8000);
  for (;;) {
    const rows = await sql.query<{ catalog: string; status: string; status_at: string | null; seen_at: string | null; online: boolean }>(
      `select catalog, status, status_at::text as status_at, seen_at::text as seen_at,
              coalesce(seen_at > now() - interval '20 seconds', false) as online
       from board_remote where user_id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r || !since || r.status_at !== since || Date.now() >= end) {
      let catalog: unknown[] = [];
      let status: Record<string, unknown> = {};
      try { catalog = JSON.parse(r?.catalog ?? "[]"); } catch { /* tom */ }
      try { status = JSON.parse(r?.status ?? "{}"); } catch { /* tom */ }
      return { online: Boolean(r?.online), seenAt: r?.seen_at ?? null, statusAt: r?.status_at ?? null, catalog, status };
    }
    await sleep(300);
  }
}

const ACT_RE = /^[a-zA-Z0-9_]{1,24}$/;

/** Lægger et knaptryk i køen og venter kort på, at scoreboardet melder tilbage. */
export async function sendCommand(userId: string, act: string, v: string, source: string, waitMs = 3000) {
  if (!ACT_RE.test(act)) throw new RemoteError("Ukendt knap.");
  const value = String(v ?? "").slice(0, 60);
  const sql = await getSql();
  const recent = await sql.query<{ n: string }>(
    `select count(*)::text as n from board_commands where user_id = $1 and created_at > now() - interval '10 seconds'`,
    [userId],
  );
  if (Number(recent[0]?.n ?? 0) > 60) throw new RemoteError("For mange tryk på kort tid – vent et øjeblik.", 429);
  if (Math.random() < 0.05) await sql.query(`delete from board_commands where created_at < now() - interval '1 hour'`);
  const ins = await sql.query<{ id: string }>(
    `insert into board_commands (user_id, act, v, source) values ($1, $2, $3, $4) returning id::text as id`,
    [userId, act, value, source.slice(0, 40)],
  );
  const id = ins[0].id;
  const end = Date.now() + Math.min(waitMs, 5000);
  while (Date.now() < end) {
    await sleep(200);
    const r = await sql.query<{ done: boolean; ok: boolean | null; message: string; taken: boolean }>(
      `select done_at is not null as done, ok, message, taken_at is not null as taken from board_commands where id = $1`,
      [id],
    );
    if (r[0]?.done) return { id, done: true, ok: Boolean(r[0].ok), message: r[0].message };
  }
  const online = await sql.query<{ online: boolean }>(
    `select coalesce(seen_at > now() - interval '20 seconds', false) as online from board_remote where user_id = $1`,
    [userId],
  );
  return {
    id,
    done: false,
    ok: false,
    message: online[0]?.online ? "Scoreboardet svarede ikke i tide." : "Scoreboardet er ikke åbent. Åbn scoreboardet på BanditBoard Live.",
  };
}

type Done = { id: string; ok: boolean; message?: string };

/** Scoreboardet: meld status/knapper, aflever resultater og hent nye tryk (venter op til waitMs). */
export async function boardPoll(userId: string, input: { catalog?: unknown; status?: unknown; done?: Done[]; wait?: number }) {
  await allowed(userId);
  const sql = await getSql();
  const catalog = Array.isArray(input.catalog) ? JSON.stringify(input.catalog.slice(0, 300)).slice(0, 60000) : null;
  const status = input.status && typeof input.status === "object" ? JSON.stringify(input.status).slice(0, 8000) : null;
  await sql.query(
    `insert into board_remote (user_id, catalog, status, status_at, seen_at)
     values ($1, coalesce($2, '[]'), coalesce($3, '{}'), case when $3::text is null then null else now() end, now())
     on conflict (user_id) do update set
       catalog = coalesce($2, board_remote.catalog),
       status = coalesce($3, board_remote.status),
       status_at = case when $3::text is null or $3::text = board_remote.status then board_remote.status_at else now() end,
       seen_at = now()`,
    [userId, catalog, status],
  );
  for (const d of (input.done ?? []).slice(0, 50)) {
    if (!/^\d+$/.test(String(d.id))) continue;
    await sql.query(
      `update board_commands set done_at = now(), ok = $3, message = $4 where id = $1 and user_id = $2 and done_at is null`,
      [d.id, userId, Boolean(d.ok), String(d.message ?? "").slice(0, 200)],
    );
  }
  const end = Date.now() + Math.min(Math.max(Number(input.wait) || 0, 0), 8000);
  for (;;) {
    const rows = await sql.query<{ id: string; act: string; v: string }>(
      `update board_commands set taken_at = now()
       where id in (
         select id from board_commands
         where user_id = $1 and taken_at is null and created_at > now() - interval '${COMMAND_TTL_SECONDS} seconds'
         order by id limit 20
       ) and taken_at is null
       returning id::text as id, act, v`,
      [userId],
    );
    if (rows.length || Date.now() >= end) return { commands: rows.sort((a, b) => Number(a.id) - Number(b.id)) };
    await sleep(250);
  }
}
