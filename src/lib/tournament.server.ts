import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { ensureProfile } from "@/lib/board-store.server";
import { canManageTournament, hasPermission } from "@/lib/roles";

export type PublicTournament = {
  name: string;
  plan: string;
  players: { userId: string; name: string; note: string; createdAt: string }[];
  ranking: { id: string; name: string; points: number; wins: number }[];
  history: { id: string; playedAt: string; title: string; detail: string }[];
};

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

export async function readPublicTournament(): Promise<PublicTournament> {
  const sql = await getSql();
  const info = await sql<{ name: string; plan: string }>`
    select name, plan from public_tournament where id = 1
  `;
  const players = await sql<{ user_id: string; name: string; note: string; created_at: string }>`
    select user_id, name, note, created_at::text as created_at
    from tournament_players order by created_at
  `;
  const ranking = await sql<{ id: string; name: string; points: number; wins: number }>`
    select id, name, points, wins from ranking_rows order by points desc, wins desc, name
  `;
  const history = await sql<{ id: string; played_at: string; title: string; detail: string }>`
    select id, played_at::text as played_at, title, detail
    from match_history order by played_at desc
  `;
  return {
    name: info[0]?.name || "Klubaften",
    plan: info[0]?.plan || "",
    players: players.map((row) => ({
      userId: row.user_id,
      name: row.name,
      note: row.note,
      createdAt: String(row.created_at ?? ""),
    })),
    ranking: ranking.map((row) => ({
      id: row.id,
      name: row.name,
      points: Number(row.points) || 0,
      wins: Number(row.wins) || 0,
    })),
    history: history.map((row) => ({
      id: row.id,
      playedAt: String(row.played_at ?? ""),
      title: row.title,
      detail: row.detail,
    })),
  };
}

async function requireTournamentEditor(userId: string) {
  const profile = await ensureProfile(userId);
  if (!canManageTournament(profile.role)) throw new Error("Kun den, der administrerer scoreboardet, kan rette turneringen.");
  return profile;
}

async function requireTournamentDelete(userId: string) {
  const profile = await ensureProfile(userId);
  if (!hasPermission(profile.role, "DELETE_TOURNAMENT")) throw new Error("Du må ikke slette turneringsdata.");
  return profile;
}

export async function saveTournamentInfo(userId: string, name: string, plan: string): Promise<PublicTournament> {
  await requireTournamentEditor(userId);
  const sql = await getSql();
  await sql`
    insert into public_tournament (id, name, plan, updated_at)
    values (1, ${clip(name, 120) || "Klubaften"}, ${clip(plan, 4000)}, now())
    on conflict (id) do update set name = excluded.name, plan = excluded.plan, updated_at = now()
  `;
  return readPublicTournament();
}

export async function joinTournament(userId: string, name: string, note: string): Promise<PublicTournament> {
  const profile = await ensureProfile(userId);
  const playerName = clip(name, 120) || profile.contactName || profile.venueName || profile.accountName;
  if (!playerName) throw new Error("Skriv dit navn.");
  const sql = await getSql();
  await sql`
    insert into tournament_players (user_id, name, note)
    values (${userId}, ${playerName}, ${clip(note, 240)})
    on conflict (user_id) do update set name = excluded.name, note = excluded.note
  `;
  return readPublicTournament();
}

export async function leaveTournament(userId: string): Promise<PublicTournament> {
  await ensureProfile(userId);
  const sql = await getSql();
  await sql`delete from tournament_players where user_id = ${userId}`;
  return readPublicTournament();
}

export async function addRanking(userId: string, name: string, points: number, wins: number): Promise<PublicTournament> {
  await requireTournamentEditor(userId);
  const player = clip(name, 120);
  if (!player) throw new Error("Skriv navnet.");
  const sql = await getSql();
  await sql`
    insert into ranking_rows (id, name, points, wins, sort)
    values (${randomBytes(12).toString("base64url")}, ${player}, ${Math.max(0, Math.round(points))}, ${Math.max(0, Math.round(wins))}, 0)
  `;
  return readPublicTournament();
}

export async function removeRanking(userId: string, id: string): Promise<PublicTournament> {
  await requireTournamentDelete(userId);
  const sql = await getSql();
  await sql`delete from ranking_rows where id = ${clip(id, 80)}`;
  return readPublicTournament();
}

export async function addHistory(userId: string, title: string, detail: string): Promise<PublicTournament> {
  await requireTournamentEditor(userId);
  const heading = clip(title, 160);
  if (!heading) throw new Error("Skriv hvad kampen hed.");
  const sql = await getSql();
  await sql`
    insert into match_history (id, title, detail)
    values (${randomBytes(12).toString("base64url")}, ${heading}, ${clip(detail, 400)})
  `;
  return readPublicTournament();
}

export async function removeHistory(userId: string, id: string): Promise<PublicTournament> {
  await requireTournamentDelete(userId);
  const sql = await getSql();
  await sql`delete from match_history where id = ${clip(id, 80)}`;
  return readPublicTournament();
}
