import { getSql } from "@/lib/db";
import { ensureProfile } from "@/lib/board-store.server";
import { writeAudit } from "@/lib/audit.server";
import { ensureCmsSchema, requireEditor, type Actor, type CmsSql } from "./core";

const globalCms = globalThis as typeof globalThis & { __cmsSchema__?: Promise<void> };

/** Databasen med CMS-tabellerne sikret (også hvis migrationen ikke er kørt endnu). */
export async function cmsDb(): Promise<CmsSql> {
  globalCms.__cmsSchema__ ??= getSql()
    .then((sql) => ensureCmsSchema(sql))
    .catch((error) => {
      globalCms.__cmsSchema__ = undefined;
      throw error;
    });
  await globalCms.__cmsSchema__;
  return getSql();
}

/** Rolle og kontostatus slås op i databasen, aldrig noget klienten selv påstår. */
export async function editorFor(userId: string): Promise<Actor & { name: string }> {
  const profile = await ensureProfile(userId);
  const actor = { id: profile.userId, role: profile.role, accountStatus: profile.accountStatus, name: profile.accountName || profile.email };
  requireEditor(actor);
  return actor;
}

export async function auditCms(actor: Actor & { name: string }, action: string, detail: string) {
  await writeAudit({ actorId: actor.id, actorName: actor.name, actorRole: actor.role, action, detail }).catch(() => undefined);
}
