import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { writeAudit } from "@/lib/audit.server";
import { hasPermission, normalizeRole } from "@/lib/roles";
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, STATUS_LABEL, type SupportStatus } from "@/lib/support-shared";
import { ensureProfile } from "@/lib/board-store.server";

const globalSupport = globalThis as typeof globalThis & { __supportSchema__?: Promise<void> };

/** Opretter supporttabellerne, hvis udgivelsen ikke nåede at køre migrationen. */
async function db() {
  globalSupport.__supportSchema__ ??= (async () => {
    const sql = await getSql();
    const statements = [
      "create sequence if not exists support_ticket_seq start 1048",
      `create table if not exists support_tickets (
        id text primary key,
        number integer not null unique,
        guest_token text not null,
        user_id text,
        name text not null,
        email text not null,
        category text not null,
        subject text not null,
        tournament text not null default '',
        table_name text not null default '',
        status text not null default 'new',
        assignee_id text,
        assignee_name text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      "create index if not exists support_tickets_user_idx on support_tickets (user_id)",
      "create index if not exists support_tickets_status_idx on support_tickets (status, updated_at desc)",
      `create table if not exists support_messages (
        id text primary key,
        ticket_id text not null references support_tickets (id) on delete cascade,
        author_id text,
        author_name text not null,
        author_role text not null default '',
        body text not null,
        internal boolean not null default false,
        attachment_name text not null default '',
        attachment_type text not null default '',
        attachment_data text not null default '',
        created_at timestamptz not null default now()
      )`,
      "create index if not exists support_messages_ticket_idx on support_messages (ticket_id, created_at)",
      `create table if not exists support_rate (
        key text primary key,
        hits integer not null default 0,
        window_start timestamptz not null default now()
      )`,
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
      "insert into _migrations (name) values ('0008_support.sql') on conflict do nothing",
    ];
    for (const statement of statements) await sql.query(statement);
  })().catch((error) => {
    globalSupport.__supportSchema__ = undefined;
    throw error;
  });
  await globalSupport.__supportSchema__;
  return getSql();
}

export type { SupportStatus } from "@/lib/support-shared";
export { SUPPORT_CATEGORIES, STATUS_LABEL };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FILE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function clip(value: unknown, max: number) {
  return String(value ?? "").replace(/\0/g, "").trim().slice(0, max);
}

function statusOf(value: string): SupportStatus {
  return (SUPPORT_STATUSES as readonly string[]).includes(value) ? (value as SupportStatus) : "new";
}

export function ticketCode(number: number) {
  return `BB-${number}`;
}

export function parseTicketCode(value: string) {
  const match = /^BB-(\d{3,8})$/i.exec(value.trim());
  return match ? Number(match[1]) : 0;
}

async function hitRate(key: string, limit: number) {
  const sql = await db();
  const rows = await sql<{ hits: number }>`
    insert into support_rate (key, hits, window_start)
    values (${key}, 1, now())
    on conflict (key) do update set
      hits = case when support_rate.window_start < now() - interval '1 hour' then 1 else support_rate.hits + 1 end,
      window_start = case when support_rate.window_start < now() - interval '1 hour' then now() else support_rate.window_start end
    returning hits
  `;
  if (Number(rows[0]?.hits ?? 1) > limit) throw new Error("For mange henvendelser. Prøv igen om en time.");
}

function cleanFile(file?: { name?: string; type?: string; data?: string } | null) {
  if (!file?.data) return { name: "", type: "", data: "" };
  const type = clip(file.type, 40).toLowerCase();
  const data = String(file.data);
  if (!FILE_TYPES.has(type) || !data.startsWith(`data:${type};base64,`) || data.length > 900000) {
    throw new Error("Vedhæftningen skal være et billede (JPG, PNG, WEBP) eller en PDF under 600 KB.");
  }
  return { name: clip(file.name, 120) || "fil", type, data };
}

type TicketRow = {
  id: string;
  number: number;
  guest_token: string;
  user_id: string | null;
  name: string;
  email: string;
  category: string;
  subject: string;
  tournament: string;
  table_name: string;
  status: string;
  assignee_id: string | null;
  assignee_name: string;
  created_at: string;
  updated_at: string;
};

export type TicketSummary = {
  id: string;
  code: string;
  name: string;
  email: string;
  category: string;
  subject: string;
  tournament: string;
  tableName: string;
  status: SupportStatus;
  statusLabel: string;
  assigneeName: string;
  createdAt: string;
  updatedAt: string;
};

function summarize(row: TicketRow): TicketSummary {
  const status = statusOf(row.status);
  return {
    id: row.id,
    code: ticketCode(Number(row.number)),
    name: row.name,
    email: row.email,
    category: row.category,
    subject: row.subject,
    tournament: row.tournament,
    tableName: row.table_name,
    status,
    statusLabel: STATUS_LABEL[status],
    assigneeName: row.assignee_name,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function isStaff(userId: string) {
  const profile = await ensureProfile(userId);
  return hasPermission(profile.role, "MANAGE_SUPPORT") ? profile : null;
}

export async function createTicket(
  input: {
    name: string;
    email: string;
    category: string;
    subject: string;
    message: string;
    tournament?: string;
    tableName?: string;
    company?: string;
    file?: { name?: string; type?: string; data?: string } | null;
  },
  user: { id: string; email: string | null } | null,
) {
  if (clip(input.company, 80)) throw new Error("Beskeden kunne ikke sendes.");
  const name = clip(input.name, 120);
  const email = clip(input.email, 160).toLowerCase();
  const category = clip(input.category, 40);
  const subject = clip(input.subject, 160);
  const message = clip(input.message, 4000);
  const tournament = clip(input.tournament, 120);
  const tableName = clip(input.tableName, 40);
  if (!name || !EMAIL.test(email) || !subject || message.length < 8) {
    throw new Error("Udfyld navn, e-mail, emne og en besked på mindst 8 tegn.");
  }
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(category)) throw new Error("Vælg en kategori.");
  const file = cleanFile(input.file);
  await hitRate(`ticket:${email}`, 5);
  const sql = await db();
  const id = randomBytes(12).toString("base64url");
  const token = randomBytes(18).toString("base64url");
  const numbers = await sql<{ n: number }>`select nextval('support_ticket_seq')::int as n`;
  const number = Number(numbers[0]?.n ?? 0);
  await sql`
    insert into support_tickets (
      id, number, guest_token, user_id, name, email, category, subject, tournament, table_name
    ) values (
      ${id}, ${number}, ${token}, ${user?.id ?? null}, ${name}, ${email}, ${category}, ${subject}, ${tournament}, ${tableName}
    )
  `;
  await sql`
    insert into support_messages (id, ticket_id, author_id, author_name, author_role, body, attachment_name, attachment_type, attachment_data)
    values (
      ${randomBytes(12).toString("base64url")}, ${id}, ${user?.id ?? null}, ${name}, ${user ? "bruger" : "gaest"},
      ${message}, ${file.name}, ${file.type}, ${file.data}
    )
  `;
  await writeAudit({
    actorId: user?.id || "guest",
    actorName: name,
    actorRole: user ? "bruger" : "gaest",
    action: "Oprettede supportsag",
    detail: `${ticketCode(number)} · ${category}`,
  });
  return { code: ticketCode(number), token };
}

export async function listMyTickets(userId: string): Promise<TicketSummary[]> {
  const sql = await db();
  const rows = await sql<TicketRow>`
    select id, number, guest_token, user_id, name, email, category, subject, tournament, table_name,
           status, assignee_id, assignee_name, created_at::text, updated_at::text
    from support_tickets where user_id = ${userId}
    order by updated_at desc limit 50
  `;
  return rows.map(summarize);
}

export async function supportCounts() {
  const sql = await db();
  const rows = await sql<{ status: string; n: number }>`select status, count(*)::int as n from support_tickets group by status`;
  const counts = { new: 0, open: 0, waiting: 0, solved: 0, closed: 0 };
  rows.forEach((row) => {
    const status = statusOf(row.status);
    counts[status] = Number(row.n);
  });
  return counts;
}

export async function listStaffTickets(userId: string, filter: { status?: string; category?: string; query?: string }) {
  const staff = await isStaff(userId);
  if (!staff) throw new Error("Kun support kan se alle sager.");
  const sql = await db();
  const status = clip(filter.status, 20);
  const category = clip(filter.category, 40);
  const query = clip(filter.query, 80).toLowerCase().replace(/[%_]/g, "");
  const rows = await sql<TicketRow>`
    select id, number, guest_token, user_id, name, email, category, subject, tournament, table_name,
           status, assignee_id, assignee_name, created_at::text, updated_at::text
    from support_tickets
    where (${status} = '' or status = ${status})
      and (${category} = '' or category = ${category})
      and (${query} = '' or lower(name || ' ' || email || ' ' || subject || ' ' || ('BB-' || number::text)) like ${"%" + query + "%"})
    order by updated_at desc
    limit 80
  `;
  return rows.map(summarize);
}

export async function listSupportStaff(userId: string) {
  const staff = await isStaff(userId);
  if (!staff) throw new Error("Kun support kan se medarbejdere.");
  const sql = await db();
  const rows = await sql<{ user_id: string; venue_name: string; email: string }>`
    select p.user_id, p.venue_name, u.email
    from profiles p join "user" u on u.id = p.user_id
    where p.role in ('admin', 'administrator_manager') and p.active = true and p.account_status = 'approved'
    order by p.venue_name
  `;
  return rows.map((row) => ({ userId: row.user_id, name: row.venue_name || row.email }));
}

type MessageRow = {
  id: string;
  author_name: string;
  author_role: string;
  body: string;
  internal: boolean;
  attachment_name: string;
  attachment_type: string;
  attachment_data: string;
  created_at: string;
};

export async function readTicket(userId: string | null, code: string, token: string) {
  const number = parseTicketCode(code);
  if (!number) throw new Error("Sagsnummeret findes ikke.");
  const sql = await db();
  const rows = await sql<TicketRow>`
    select id, number, guest_token, user_id, name, email, category, subject, tournament, table_name,
           status, assignee_id, assignee_name, created_at::text, updated_at::text
    from support_tickets where number = ${number}
  `;
  const ticket = rows[0];
  if (!ticket) throw new Error("Sagsnummeret findes ikke.");
  const staff = userId ? await isStaff(userId) : null;
  const owner = Boolean(userId && ticket.user_id === userId);
  const guest = Boolean(token && token === ticket.guest_token);
  if (!staff && !owner && !guest) throw new Error("Du kan ikke se den sag.");
  const messages = await sql<MessageRow>`
    select id, author_name, author_role, body, internal, attachment_name, attachment_type, attachment_data, created_at::text
    from support_messages where ticket_id = ${ticket.id}
    order by created_at
  `;
  return {
    ticket: summarize(ticket),
    token: owner || staff ? ticket.guest_token : "",
    staff: Boolean(staff),
    messages: messages
      .filter((message) => staff || !message.internal)
      .map((message) => ({
        id: message.id,
        authorName: message.author_name,
        authorRole: message.author_role,
        body: message.body,
        internal: message.internal,
        attachmentName: message.attachment_name,
        attachmentType: message.attachment_type,
        attachmentData: message.attachment_data,
        at: String(message.created_at),
      })),
  };
}

export async function replyTicket(
  userId: string | null,
  input: { code: string; token?: string; body: string; internal?: boolean; file?: { name?: string; type?: string; data?: string } | null },
) {
  const body = clip(input.body, 4000);
  if (body.length < 2) throw new Error("Skriv et svar.");
  const number = parseTicketCode(input.code);
  const sql = await db();
  const rows = await sql<TicketRow>`select * from support_tickets where number = ${number}`;
  const ticket = rows[0];
  if (!ticket) throw new Error("Sagsnummeret findes ikke.");
  const staff = userId ? await isStaff(userId) : null;
  const owner = Boolean(userId && ticket.user_id === userId);
  const guest = Boolean(input.token && input.token === ticket.guest_token);
  if (!staff && !owner && !guest) throw new Error("Du kan ikke svare på den sag.");
  if (input.internal && !staff) throw new Error("Kun support kan skrive interne noter.");
  await hitRate(`reply:${ticket.id}`, 30);
  const file = cleanFile(input.file);
  const profile = userId ? await ensureProfile(userId) : null;
  const authorName = staff ? profile?.venueName || profile?.email || "Support" : ticket.name;
  const authorRole = staff ? profile?.role || "admin" : owner ? "bruger" : "gaest";
  await sql`
    insert into support_messages (id, ticket_id, author_id, author_name, author_role, body, internal, attachment_name, attachment_type, attachment_data)
    values (
      ${randomBytes(12).toString("base64url")}, ${ticket.id}, ${userId}, ${authorName}, ${authorRole},
      ${body}, ${Boolean(input.internal && staff)}, ${file.name}, ${file.type}, ${file.data}
    )
  `;
  const next = input.internal && staff ? ticket.status : staff ? "waiting" : "open";
  await sql`update support_tickets set status = ${next}, updated_at = now() where id = ${ticket.id}`;
  return readTicket(userId, input.code, input.token || "");
}

export async function updateTicket(userId: string, input: { code: string; status?: string; assigneeId?: string }) {
  const staff = await isStaff(userId);
  if (!staff) throw new Error("Kun support kan opdatere sagen.");
  const number = parseTicketCode(input.code);
  const sql = await db();
  if (input.status && (SUPPORT_STATUSES as readonly string[]).includes(input.status)) {
    await sql`update support_tickets set status = ${input.status}, updated_at = now() where number = ${number}`;
  }
  if (input.assigneeId !== undefined) {
    const assigneeId = clip(input.assigneeId, 80);
    let name = "";
    if (assigneeId) {
      const people = await listSupportStaff(userId);
      const person = people.find((item) => item.userId === assigneeId);
      if (!person) throw new Error("Medarbejderen blev ikke fundet.");
      name = person.name;
    }
    await sql`update support_tickets set assignee_id = ${assigneeId || null}, assignee_name = ${name}, updated_at = now() where number = ${number}`;
    await writeAudit({
      actorId: staff.userId,
      actorName: staff.venueName || staff.email,
      actorRole: normalizeRole(staff.role),
      action: "Tildelte supportsag",
      detail: `${input.code} → ${name || "ingen"}`,
    });
  }
  return readTicket(userId, input.code, "");
}

export async function boardHints(userId: string) {
  const sql = await db();
  const rows = await sql<{ state: string | null }>`select state from board_state where user_id = ${userId}`;
  const tournaments = new Set<string>();
  const tables = new Set<string>();
  if (rows[0]?.state) {
    try {
      const data = JSON.parse(rows[0].state) as { settings?: { tourName?: string }; tables?: { name?: string }[]; history?: { tour?: string }[] };
      if (data.settings?.tourName) tournaments.add(String(data.settings.tourName));
      (data.tables || []).forEach((table) => table.name && tables.add(String(table.name)));
      (data.history || []).slice(0, 30).forEach((game) => game.tour && tournaments.add(String(game.tour)));
    } catch {
      /* tavlen kan ikke læses */
    }
  }
  return { tournaments: [...tournaments].slice(0, 20), tables: [...tables].slice(0, 20) };
}
