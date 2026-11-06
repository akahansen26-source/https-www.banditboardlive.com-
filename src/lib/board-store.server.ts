import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { getSql } from "@/lib/db";
import {
  canAssignRoles,
  canEditSiteSettings,
  canManageVenues,
  canOpenBoard,
  canRunLiveBoard,
  hasPermission,
  normalizeAccountStatus,
  normalizeRole,
  type AccountStatus,
  type UserRole,
} from "@/lib/roles";
import { writeAudit } from "@/lib/audit.server";

export type { UserRole };

export type Profile = {
  userId: string;
  email: string;
  accountName: string;
  role: UserRole;
  venueName: string;
  contactName: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  notes: string;
  accessCode: string;
  active: boolean;
  accountStatus: AccountStatus;
  publicLive: boolean;
  createdAt: string;
};

export type SiteSettings = {
  facebook: string;
  instagram: string;
  youtube: string;
  contactEmail: string;
  contactPhone: string;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
  account_name: string | null;
  role: string;
  venue_name: string;
  contact_name: string;
  phone: string;
  address: string;
  postal_code: string;
  city: string;
  notes: string;
  access_code: string;
  active: boolean;
  account_status: string | null;
  public_live: boolean | null;
  created_at: string | Date;
};

function asText(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapProfile(row: ProfileRow): Profile {
  return {
    userId: row.user_id,
    email: row.email ?? "",
    accountName: row.account_name ?? "",
    role: normalizeRole(row.role),
    venueName: row.venue_name,
    contactName: row.contact_name,
    phone: row.phone,
    address: row.address,
    postalCode: row.postal_code,
    city: row.city,
    notes: row.notes,
    accessCode: row.access_code,
    active: Boolean(row.active),
    accountStatus: normalizeAccountStatus(row.account_status),
    publicLive: Boolean(row.public_live),
    createdAt: asText(row.created_at),
  };
}

function accountOpen(profile: Profile): boolean {
  return profile.active && profile.accountStatus === "approved";
}

function accountClosedMessage(profile: Profile): string {
  if (profile.accountStatus === "pending") return "Kontoen afventer godkendelse.";
  if (profile.accountStatus === "rejected") return "Kontoen er afvist.";
  if (profile.accountStatus === "suspended") return "Kontoen er midlertidigt deaktiveret.";
  return "Adgangen er lukket.";
}

const PROFILE_SELECT = `
  select p.user_id, u.email, u.name as account_name, p.role, p.venue_name, p.contact_name,
         p.phone, p.address, p.postal_code, p.city, p.notes, p.access_code, p.active,
         p.account_status, p.public_live, p.created_at::text as created_at
  from profiles p
  join "user" u on u.id = p.user_id
`;

export async function readProfile(userId: string): Promise<Profile | null> {
  const sql = await getSql();
  const rows = await sql.query<ProfileRow>(`${PROFILE_SELECT} where p.user_id = $1`, [userId]);
  return rows[0] ? mapProfile(rows[0]) : null;
}

export async function ensureProfile(userId: string): Promise<Profile> {
  const existing = await readProfile(userId);
  if (existing) return existing;
  const sql = await getSql();
  const users = await sql.query<{ email: string; name: string }>(
    `select email, name from "user" where id = $1`,
    [userId],
  );
  const user = users[0];
  if (!user) throw new Error("Brugeren blev ikke fundet.");
  const bosses = await sql<{ n: number }>`
    select count(*) as n from profiles where role in ('admin', 'administrator_manager')
  `;
  // A brand-new site still needs one manager. Every later signup is a guest.
  const role = Number(bosses[0]?.n ?? 0) === 0 ? "administrator_manager" : "gaest";
  const accountStatus = role === "gaest" ? "pending" : "approved";
  await sql`
    insert into profiles (user_id, role, venue_name, contact_name, account_status)
    values (${userId}, ${role}, ${user.name || "Min klub"}, ${user.name || ""}, ${accountStatus})
  `;
  const created = await readProfile(userId);
  if (!created) throw new Error("Profilen kunne ikke oprettes.");
  return created;
}

export async function saveOwnDetails(
  userId: string,
  input: {
    venueName: string;
    contactName: string;
    phone: string;
    address: string;
    postalCode: string;
    city: string;
  },
): Promise<Profile> {
  await ensureProfile(userId);
  const sql = await getSql();
  await sql`
    update profiles set
      venue_name = ${input.venueName},
      contact_name = ${input.contactName},
      phone = ${input.phone},
      address = ${input.address},
      postal_code = ${input.postalCode},
      city = ${input.city}
    where user_id = ${userId}
  `;
  if (input.venueName) {
    await sql`update "user" set name = ${input.venueName}, "updatedAt" = now() where id = ${userId}`;
  }
  const profile = await readProfile(userId);
  if (!profile) throw new Error("Profilen kunne ikke gemmes.");
  return profile;
}

async function requireRole(
  userId: string,
  allowed: (role: UserRole) => boolean,
  message: string,
): Promise<Profile> {
  const profile = await ensureProfile(userId);
  if (!allowed(profile.role)) throw new Error(message);
  return profile;
}

async function requireAdmin(userId: string): Promise<Profile> {
  return requireRole(userId, canAssignRoles, "Kun en administrator kan gøre det.");
}

async function requireStaff(userId: string): Promise<Profile> {
  return requireRole(userId, canManageVenues, "Kun en administrator kan gøre det.");
}

export function makeAccessCode(venueName: string): string {
  const letters = venueName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  const prefix = (letters.slice(0, 4) || "BAND").padEnd(4, "X");
  const n = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${n}`;
}

export function isValidCode(code: string): boolean {
  return /^[A-Za-z0-9-]{8,40}$/.test(code);
}

export async function createVenueAccount(
  adminId: string,
  input: {
    venueName: string;
    contactName: string;
    email: string;
    phone: string;
    address: string;
    postalCode: string;
    city: string;
    notes: string;
    accessCode: string;
  },
): Promise<{ profile: Profile; accessCode: string }> {
  const actor = await requireStaff(adminId);
  const code = input.accessCode || makeAccessCode(input.venueName);
  if (!isValidCode(code)) throw new Error("Adgangskoden skal være 8–40 tegn: bogstaver, tal og bindestreg.");
  const sql = await getSql();
  const existing = await sql.query<{ id: string }>(`select id from "user" where lower(email) = lower($1)`, [input.email]);
  if (existing[0]) throw new Error("Der findes allerede en bruger med den e-mail.");
  const userId = randomBytes(24).toString("base64url");
  const hash = await hashPassword(code);
  await sql`
    insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values (${userId}, ${input.venueName}, ${input.email}, true, now(), now())
  `;
  await sql`
    insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    values (${randomBytes(24).toString("base64url")}, ${userId}, 'credential', ${userId}, ${hash}, now(), now())
  `;
  await sql`
    insert into profiles (
      user_id, role, venue_name, contact_name, phone, address, postal_code, city, notes, access_code, created_by
    ) values (
      ${userId}, 'bruger', ${input.venueName}, ${input.contactName}, ${input.phone},
      ${input.address}, ${input.postalCode}, ${input.city}, ${input.notes}, ${code}, ${adminId}
    )
  `;
  const profile = await readProfile(userId);
  if (!profile) throw new Error("Profilen kunne ikke gemmes.");
  await writeAudit({
    actorId: actor.userId,
    actorName: actor.venueName || actor.accountName || actor.email,
    actorRole: actor.role,
    action: "Oprettede bruger",
    detail: `${input.venueName} · ${input.email}`,
  });
  return { profile, accessCode: code };
}

export async function setUserRole(
  adminId: string,
  userId: string,
  role: UserRole,
): Promise<Profile> {
  const admin = await requireAdmin(adminId);
  if (!normalizeRole(role) || role !== normalizeRole(role)) throw new Error("Ukendt rolle.");
  const target = await readProfile(userId);
  if (!target) throw new Error("Brugeren blev ikke fundet.");
  if (userId === admin.userId && role !== admin.role) {
    throw new Error("Du kan ikke ændre din egen rolle her.");
  }
  if (admin.role !== "administrator_manager" && !hasPermission(admin.role, "MANAGE_MANAGERS")) {
    if (role === "administrator_manager" || target.role === "administrator_manager") {
      throw new Error("Kun en administrator-manager kan ændre den rolle.");
    }
  }
  const protectedRole = role !== "admin" && role !== "administrator_manager";
  if (protectedRole && (target.role === "admin" || target.role === "administrator_manager")) {
    const sql = await getSql();
    const admins = await sql<{ n: number }>`
      select count(*) as n from profiles where role in ('admin', 'administrator_manager')
    `;
    if (Number(admins[0]?.n ?? 0) <= 1) throw new Error("Der skal være mindst én administrator.");
  }
  const sql = await getSql();
  await sql`update profiles set role = ${role} where user_id = ${userId}`;
  const profile = await readProfile(userId);
  if (!profile) throw new Error("Brugeren blev ikke fundet.");
  await writeAudit({
    actorId: admin.userId,
    actorName: admin.venueName || admin.accountName || admin.email,
    actorRole: admin.role,
    action: "Ændrede rolle",
    detail: `${target.venueName || target.email}: ${target.role} → ${role}`,
  });
  return profile;
}

export async function deleteOwnAccount(userId: string, password: string): Promise<{ ok: true }> {
  const profile = await ensureProfile(userId);
  const sql = await getSql();
  if (profile.role === "admin" || profile.role === "administrator_manager") {
    const admins = await sql<{ n: number }>`
      select count(*) as n from profiles where role in ('admin', 'administrator_manager')
    `;
    if (Number(admins[0]?.n ?? 0) <= 1) {
      throw new Error("Du er den eneste administrator. Giv rollen til en anden, før du sletter dig selv.");
    }
  }
  const accounts = await sql.query<{ password: string | null }>(
    `select password from account where "userId" = $1 and "providerId" = 'credential'`,
    [userId],
  );
  const hash = accounts[0]?.password;
  if (!hash) throw new Error("Kontoen har ingen adgangskode.");
  const ok = await verifyPassword({ hash, password });
  if (!ok) throw new Error("Adgangskoden passer ikke.");
  await sql`delete from "user" where id = ${userId}`;
  return { ok: true };
}

export async function listVenues(adminId: string): Promise<Profile[]> {
  await requireStaff(adminId);
  const sql = await getSql();
  const rows = await sql.query<ProfileRow>(`${PROFILE_SELECT} order by p.created_at desc`);
  return rows.map(mapProfile);
}

export async function updateVenue(
  adminId: string,
  input: {
    userId: string;
    venueName: string;
    contactName: string;
    phone: string;
    address: string;
    postalCode: string;
    city: string;
    notes: string;
  },
): Promise<Profile> {
  const actor = await requireStaff(adminId);
  const current = await readProfile(input.userId);
  if (!current) throw new Error("Brugeren blev ikke fundet.");
  if ((current.role === "admin" || current.role === "administrator_manager") && !canAssignRoles(actor.role)) {
    throw new Error("Kun administratoren kan rette en administrator.");
  }
  const sql = await getSql();
  await sql`
    update profiles set
      venue_name = ${input.venueName},
      contact_name = ${input.contactName},
      phone = ${input.phone},
      address = ${input.address},
      postal_code = ${input.postalCode},
      city = ${input.city},
      notes = ${input.notes}
    where user_id = ${input.userId}
  `;
  if (input.venueName) {
    await sql`update "user" set name = ${input.venueName}, "updatedAt" = now() where id = ${input.userId}`;
  }
  const profile = await readProfile(input.userId);
  if (!profile) throw new Error("Brugeren blev ikke fundet.");
  return profile;
}

export async function setVenueActive(adminId: string, userId: string, active: boolean): Promise<Profile> {
  const actor = await requireStaff(adminId);
  if (userId === actor.userId && !active) throw new Error("Du kan ikke lukke din egen adgang.");
  const current = await readProfile(userId);
  if (!current) throw new Error("Brugeren blev ikke fundet.");
  if ((current.role === "admin" || current.role === "administrator_manager") && !canAssignRoles(actor.role)) {
    throw new Error("Kun administratoren kan lukke en administrator.");
  }
  const sql = await getSql();
  await sql`update profiles set active = ${active} where user_id = ${userId}`;
  const profile = await readProfile(userId);
  if (!profile) throw new Error("Brugeren blev ikke fundet.");
  return profile;
}

export async function setAccountStatus(adminId: string, userId: string, status: AccountStatus): Promise<Profile> {
  const actor = await requireStaff(adminId);
  if (!["pending", "approved", "rejected", "suspended", "disabled"].includes(status)) {
    throw new Error("Ukendt status.");
  }
  if (userId === actor.userId) throw new Error("Du kan ikke ændre din egen godkendelse.");
  const current = await readProfile(userId);
  if (!current) throw new Error("Brugeren blev ikke fundet.");
  if ((current.role === "admin" || current.role === "administrator_manager") && !canAssignRoles(actor.role)) {
    throw new Error("Kun administratoren kan ændre en administrators status.");
  }
  const sql = await getSql();
  await sql`update profiles set account_status = ${status} where user_id = ${userId}`;
  const profile = await readProfile(userId);
  if (!profile) throw new Error("Brugeren blev ikke fundet.");
  await writeAudit({
    actorId: actor.userId,
    actorName: actor.venueName || actor.accountName || actor.email,
    actorRole: actor.role,
    action: "Ændrede kontostatus",
    detail: `${current.venueName || current.email}: ${current.accountStatus} → ${status}`,
  });
  return profile;
}

export async function setPublicLive(userId: string, on: boolean): Promise<Profile> {
  const profile = await ensureProfile(userId);
  if (!canRunLiveBoard(profile.role)) throw new Error("Kun scoreboard-admin kan vise tavlen offentligt.");
  if (!accountOpen(profile)) throw new Error(accountClosedMessage(profile));
  const sql = await getSql();
  await sql`update profiles set public_live = ${on} where user_id = ${userId}`;
  const next = await readProfile(userId);
  if (!next) throw new Error("Profilen kunne ikke gemmes.");
  return next;
}

export type PublicSide = {
  name: string;
  club: string;
  score: number;
  photo: string;
  playing: boolean;
};

export type PublicPoint = {
  name: string;
  delta: string;
  detail: string;
  time: string;
  tone: "plus" | "minus" | "undo";
};

export type PublicMatch = {
  venue: string;
  tour: string;
  table: string;
  title: string;
  subtitle: string;
  live: boolean;
  paused: boolean;
  updatedAt: string | null;
  sponsors: string[];
  sides: PublicSide[];
  history: PublicPoint[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function playerName(player: Record<string, unknown> | null): string {
  if (!player) return "";
  return `${String(player.first || "")} ${String(player.last || "")}`.trim();
}

function signed(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function publicHistory(game: Record<string, unknown>): PublicPoint[] {
  const rows = Array.isArray(game.plog) ? game.plog : [];
  return rows
    .slice(-24)
    .reverse()
    .map((item) => {
      const entry = asRecord(item) || {};
      const change = Number(entry.d) || 0;
      const skew = Number(entry.sk) || 0;
      const value = skew && !change ? skew : change;
      const undone = entry.undone === true || entry.undo === true;
      const who = String(entry.playerName || "");
      const side = String(entry.name || "Spiller");
      const when = Number(entry.at);
      return {
        name: (who && who !== side ? `${who} · ${side}` : side).slice(0, 80),
        delta: `${entry.undo ? "↶ " : ""}${signed(value)}`,
        detail: String(skew && !change ? (entry.manual ? "Minuspoint" : "Skæve") : `${entry.old ?? "–"} → ${entry.nw ?? "–"}`).slice(0, 40),
        time: when ? new Date(when).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }) : "",
        tone: undone ? "undo" : value < 0 ? "minus" : "plus",
      };
    });
}

export async function listPublicMatches(): Promise<PublicMatch[]> {
  const sql = await getSql();
  const rows = await sql.query<{ venue_name: string; state: string | null; updated_at: string | null }>(
    `select p.venue_name, b.state, b.updated_at::text as updated_at
     from profiles p
     left join board_state b on b.user_id = p.user_id
     where p.public_live = true and p.active = true and p.account_status = 'approved'`,
  );
  const matches: PublicMatch[] = [];
  for (const row of rows) {
    const venue = (row.venue_name || "Klub").slice(0, 80);
    let data: Record<string, unknown> = {};
    if (row.state) {
      try {
        const parsed = JSON.parse(row.state) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") data = parsed;
      } catch {
        data = {};
      }
    }
    const settings = asRecord(data.settings) || {};
    const tour = String(settings.tourName || "Turnering").slice(0, 80);
    const title = String(settings.ovTitle || "Finale bord").slice(0, 40);
    const subtitle = String(settings.ovSub || "Livestream").slice(0, 40);
    const sponsors = (Array.isArray(settings.sponsors) ? settings.sponsors : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 6);
    const players = Array.isArray(data.players) ? data.players.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item) : [];
    const teams = Array.isArray(data.teams) ? data.teams.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item) : [];
    const tables = Array.isArray(data.tables) ? data.tables : data.game ? [{ name: settings.table || "Bord 1", game: data.game }] : [];
    let any = false;
    for (const item of tables) {
      const table = asRecord(item);
      if (!table) continue;
      const game = asRecord(table.game);
      if (!game || game.over) continue;
      const rawSides = Array.isArray(game.sides) ? game.sides : [];
      const active = asRecord(game.active);
      const turn = Number(game.turn) || 0;
      matches.push({
        venue,
        tour,
        table: String(table.name || "Bord").slice(0, 40),
        title,
        subtitle,
        live: true,
        paused: game.paused === true,
        updatedAt: row.updated_at,
        sponsors,
        history: publicHistory(game),
        sides: rawSides.slice(0, 8).map((side, index) => {
          const entry = asRecord(side) || {};
          const pids = Array.isArray(entry.pids) ? entry.pids.map((id) => String(id)) : [];
          const playing = active ? String(active.teamId || "") === String(entry.id || "") : index === turn;
          const playerId = playing && active?.playerId ? String(active.playerId) : pids[0] || "";
          const person = players.find((player) => String(player.id) === playerId) || null;
          const team = teams.find((item) => String(item.id) === String(entry.teamId || "")) || null;
          const names = Array.isArray(entry.names) ? entry.names.map((name) => String(name)).filter(Boolean) : [];
          const photo = String(person?.photo || team?.photo || "");
          return {
            name: (playerName(person) || String(entry.team || names.join(" / ") || "Spiller")).slice(0, 80),
            club: String(person?.club || team?.name || "").slice(0, 60),
            score: Number(entry.score) || 0,
            photo: photo.startsWith("data:image/") || photo.startsWith("http") ? photo.slice(0, 120000) : "",
            playing,
          };
        }),
      });
      any = true;
    }
    if (!any) {
      matches.push({
        venue,
        tour,
        table: "",
        title,
        subtitle,
        live: false,
        paused: false,
        updatedAt: row.updated_at,
        sponsors: [],
        history: [],
        sides: [],
      });
    }
  }
  return matches;
}

export async function regenerateAccessCode(adminId: string, userId: string, custom?: string): Promise<Profile> {
  const actor = await requireStaff(adminId);
  const current = await readProfile(userId);
  if (!current) throw new Error("Brugeren blev ikke fundet.");
  if ((current.role === "admin" || current.role === "administrator_manager") && !canAssignRoles(actor.role)) {
    throw new Error("Kun administratoren kan skifte en administrators kode.");
  }
  const code = (custom || "").trim() || makeAccessCode(current.venueName || current.accountName);
  if (!isValidCode(code)) throw new Error("Adgangskoden skal være 8–40 tegn: bogstaver, tal og bindestreg.");
  const hash = await hashPassword(code);
  const sql = await getSql();
  const accounts = await sql.query<{ id: string }>(
    `select id from account where "userId" = $1 and "providerId" = 'credential'`,
    [userId],
  );
  if (!accounts[0]) throw new Error("Brugeren har ikke en adgangskode. Opret en ny bruger med e-mail.");
  await sql`update account set password = ${hash}, "updatedAt" = now() where id = ${accounts[0].id}`;
  await sql`update profiles set access_code = ${code} where user_id = ${userId}`;
  const profile = await readProfile(userId);
  if (!profile) throw new Error("Koden kunne ikke gemmes.");
  return profile;
}

export async function removeVenue(adminId: string, userId: string): Promise<{ ok: true }> {
  const admin = await requireAdmin(adminId);
  if (userId === admin.userId) throw new Error("Du kan ikke slette din egen konto her.");
  const sql = await getSql();
  await sql`delete from "user" where id = ${userId}`;
  await writeAudit({
    actorId: admin.userId,
    actorName: admin.venueName || admin.accountName || admin.email,
    actorRole: admin.role,
    action: "Slettede bruger",
    detail: userId,
  });
  return { ok: true };
}

export async function readSettings(): Promise<SiteSettings> {
  const sql = await getSql();
  const rows = await sql<{
    facebook: string;
    instagram: string;
    youtube: string;
    contact_email: string;
    contact_phone: string;
  }>`select facebook, instagram, youtube, contact_email, contact_phone from site_settings where id = 1`;
  const row = rows[0];
  return {
    facebook: row?.facebook ?? "",
    instagram: row?.instagram ?? "",
    youtube: row?.youtube ?? "",
    contactEmail: row?.contact_email ?? "",
    contactPhone: row?.contact_phone ?? "",
  };
}

export async function writeSettings(adminId: string, input: SiteSettings): Promise<SiteSettings> {
  const actor = await requireRole(adminId, canEditSiteSettings, "Kun den, der administrerer indstillinger, kan gøre det.");
  const sql = await getSql();
  await sql`
    insert into site_settings (id, facebook, instagram, youtube, contact_email, contact_phone)
    values (1, ${input.facebook}, ${input.instagram}, ${input.youtube}, ${input.contactEmail}, ${input.contactPhone})
    on conflict (id) do update set
      facebook = excluded.facebook,
      instagram = excluded.instagram,
      youtube = excluded.youtube,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone
  `;
  await writeAudit({
    actorId: actor.userId,
    actorName: actor.venueName || actor.accountName || actor.email,
    actorRole: actor.role,
    action: "Ændrede indstillinger",
    detail: "Bund og sociale medier",
  });
  return readSettings();
}

export async function readBoardState(userId: string): Promise<{ state: string | null; updatedAt: string | null }> {
  const profile = await ensureProfile(userId);
  if (!accountOpen(profile)) throw new Error(accountClosedMessage(profile));
  if (!canOpenBoard(profile.role)) throw new Error("Du har ikke rettigheder til at tilgå scoreboardet.");
  const sql = await getSql();
  const rows = await sql.query<{ state: string; updated_at: string }>(
    `select state, updated_at::text as updated_at from board_state where user_id = $1`,
    [userId],
  );
  if (!rows[0]) return { state: null, updatedAt: null };
  return { state: rows[0].state, updatedAt: rows[0].updated_at };
}

function scoreLine(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const data = JSON.parse(raw) as {
      settings?: { tourName?: string };
      game?: { sides?: { score?: number }[] };
    };
    const sides = data.game?.sides;
    if (!Array.isArray(sides) || sides.length === 0) return "";
    const scores = sides.map((side) => Number(side.score) || 0).join("–");
    const tour = data.settings?.tourName?.trim() || "Scoreboard";
    return `${tour}: ${scores}`;
  } catch {
    return "";
  }
}

export async function writeBoardState(userId: string, state: string): Promise<{ updatedAt: string }> {
  const profile = await ensureProfile(userId);
  if (!accountOpen(profile)) throw new Error(accountClosedMessage(profile));
  if (!canOpenBoard(profile.role)) throw new Error("Du har ikke rettigheder til at tilgå scoreboardet.");
  if (state.length > 2_000_000) throw new Error("Scoreboardet er for stort til at gemme.");
  const sql = await getSql();
  const previous = await sql.query<{ state: string }>(`select state from board_state where user_id = $1`, [userId]);
  const before = scoreLine(previous[0]?.state);
  const after = scoreLine(state);
  const rows = await sql<{ updated_at: string }>`
    insert into board_state (user_id, state, updated_at)
    values (${userId}, ${state}, now())
    on conflict (user_id) do update set state = excluded.state, updated_at = now()
    returning updated_at::text as updated_at
  `;
  if (after && after !== before) {
    await writeAudit({
      actorId: profile.userId,
      actorName: profile.venueName || profile.accountName || profile.email,
      actorRole: profile.role,
      action: "Ændrede score",
      detail: before ? `Fra ${before}. Til ${after}.` : after,
    });
  }
  return { updatedAt: rows[0]?.updated_at ?? new Date().toISOString() };
}

export async function ensureOverlayKey(userId: string): Promise<string> {
  const profile = await ensureProfile(userId);
  if (!accountOpen(profile)) throw new Error(accountClosedMessage(profile));
  if (!canRunLiveBoard(profile.role)) throw new Error("Kun scoreboard-admin kan lave et OBS-link.");
  const sql = await getSql();
  const rows = await sql.query<{ overlay_key: string | null }>(
    `select overlay_key from profiles where user_id = $1`,
    [userId],
  );
  const existing = rows[0]?.overlay_key?.trim();
  if (existing) return existing;
  const key = randomBytes(18).toString("base64url");
  await sql`update profiles set overlay_key = ${key} where user_id = ${userId}`;
  return key;
}

export async function readBoardByOverlayKey(key: string): Promise<{ state: string | null; updatedAt: string | null }> {
  const row = await boardByOverlayKey(key);
  return { state: row.state, updatedAt: row.updatedAt };
}

type JoinPlayer = {
  id: string;
  first: string;
  last: string;
  club: string;
  sponsor: string;
  photo: string;
  hasPin: boolean;
};

function clip(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function publicPlayers(raw: string | null, venueName: string) {
  let data: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") data = parsed;
    } catch {
      data = {};
    }
  }
  const settings = (data.settings && typeof data.settings === "object" ? data.settings : {}) as Record<string, unknown>;
  const players = Array.isArray(data.players) ? data.players : [];
  const signups = Array.isArray(data.signups) ? data.signups.map((id) => String(id)) : [];
  return {
    venue: clip(settings.venue, 80) || venueName,
    tourName: clip(settings.tourName, 80) || "Klubaften",
    signups,
    players: players
      .map((item) => {
        const player = item as Record<string, unknown>;
        const id = clip(player.id, 40);
        if (!id) return null;
        const photo = typeof player.photo === "string" && player.photo.startsWith("data:image/") ? player.photo.slice(0, 140000) : "";
        return {
          id,
          first: clip(player.first, 40),
          last: clip(player.last, 40),
          club: clip(player.club, 60),
          sponsor: clip(player.sponsor, 60),
          photo,
          hasPin: Boolean(player.pin),
        } satisfies JoinPlayer;
      })
      .filter((player): player is JoinPlayer => Boolean(player)),
  };
}

async function boardByOverlayKey(key: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(key)) throw new Error("Linket er ugyldigt.");
  const sql = await getSql();
  const rows = await sql.query<{
    user_id: string;
    active: boolean;
    account_status: string | null;
    role: string;
    venue_name: string;
    state: string | null;
    updated_at: string | null;
  }>(
    `select p.user_id, p.active, p.account_status, p.role, p.venue_name, b.state, b.updated_at::text as updated_at
     from profiles p
     left join board_state b on b.user_id = p.user_id
     where p.overlay_key = $1`,
    [key],
  );
  const row = rows[0];
  if (!row || !row.active || normalizeAccountStatus(row.account_status) !== "approved" || !canRunLiveBoard(normalizeRole(row.role))) throw new Error("Linket er ugyldigt.");
  return {
    userId: row.user_id,
    venueName: row.venue_name || "",
    state: row.state,
    updatedAt: row.updated_at,
  };
}

export async function readBoardJoin(key: string) {
  const row = await boardByOverlayKey(key);
  return { updatedAt: row.updatedAt, ...publicPlayers(row.state, row.venueName) };
}

export async function saveBoardJoin(
  key: string,
  input: { id?: string; first?: string; last?: string; club?: string; sponsor?: string; pin?: string; photo?: string; sign?: boolean },
) {
  const row = await boardByOverlayKey(key);
  let data: Record<string, unknown> = {};
  if (row.state) {
    try {
      data = JSON.parse(row.state) as Record<string, unknown>;
    } catch {
      throw new Error("Scoreboardet kunne ikke læses.");
    }
  }
  if (!data || typeof data !== "object") data = {};
  const players = Array.isArray(data.players) ? [...(data.players as Record<string, unknown>[])] : [];
  const signups = Array.isArray(data.signups) ? (data.signups as unknown[]).map((id) => String(id)) : [];
  const first = clip(input.first, 40);
  const last = clip(input.last, 40);
  if (!first) throw new Error("Skriv mindst dit fornavn.");
  const photo = typeof input.photo === "string" && input.photo.startsWith("data:image/") && input.photo.length <= 140000 ? input.photo : "";
  const wantedId = clip(input.id, 40);
  const index = wantedId ? players.findIndex((player) => clip(player.id, 40) === wantedId) : -1;
  let id = wantedId;
  let created = false;
  if (index < 0) {
    id = randomBytes(6).toString("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 8) || randomBytes(4).toString("hex");
    players.push({
      id,
      first,
      last,
      club: clip(input.club, 60),
      sponsor: clip(input.sponsor, 60),
      pin: clip(input.pin, 8),
      photo,
    });
    created = true;
  } else {
    const current = players[index];
    const storedPin = clip(current.pin, 8);
    if (storedPin && storedPin !== clip(input.pin, 8)) throw new Error("Forkert PIN.");
    players[index] = {
      ...current,
      first,
      last,
      club: clip(input.club, 60),
      sponsor: clip(input.sponsor, 60),
      pin: storedPin,
      photo: photo || (typeof current.photo === "string" ? current.photo : ""),
    };
  }
  const nextSignups = input.sign ? (signups.includes(id) ? signups : [...signups, id]) : signups.filter((item) => item !== id);
  const audit = Array.isArray(data.audit) ? [...(data.audit as unknown[])] : [];
  audit.push({
    id: randomBytes(8).toString("hex"),
    at: Date.now(),
    user: `${first} ${last}`.trim(),
    action: created ? "Oprettede sig selv" : "Redigerede egen profil",
    obj: "BanditBoard Live",
  });
  data.players = players;
  data.signups = nextSignups;
  data.audit = audit.slice(-400);
  const saved = await writeBoardState(row.userId, JSON.stringify(data));
  const name = `${first} ${last}`.trim();
  await writeAudit({
    actorId: row.userId,
    actorName: name,
    actorRole: "spiller",
    action: created ? "Spiller oprettede sig via link" : "Spiller opdaterede sin profil via link",
    detail: name,
  });
  return {
    updatedAt: saved.updatedAt,
    player: publicPlayers(JSON.stringify(data), row.venueName).players.find((player) => player.id === id),
  };
}
