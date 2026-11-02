import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import type { UserRole } from "@/lib/roles";

export async function writeAudit(input: {
  actorId: string;
  actorName: string;
  actorRole: UserRole | string;
  action: string;
  detail?: string;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into audit_log (id, actor_id, actor_name, actor_role, action, detail)
    values (
      ${randomBytes(12).toString("base64url")},
      ${input.actorId},
      ${input.actorName.slice(0, 160)},
      ${String(input.actorRole).slice(0, 80)},
      ${input.action.slice(0, 160)},
      ${(input.detail ?? "").slice(0, 500)}
    )
  `;
}

export type AuditRow = {
  id: string;
  at: string;
  actorName: string;
  actorRole: string;
  action: string;
  detail: string;
};

export async function listAudit(limit = 80): Promise<AuditRow[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    at: string;
    actor_name: string;
    actor_role: string;
    action: string;
    detail: string;
  }>`
    select id, at::text as at, actor_name, actor_role, action, detail
    from audit_log
    order by at desc
    limit ${Math.min(200, Math.max(1, limit))}
  `;
  return rows.map((row) => ({
    id: row.id,
    at: String(row.at ?? ""),
    actorName: row.actor_name,
    actorRole: row.actor_role,
    action: row.action,
    detail: row.detail,
  }));
}
