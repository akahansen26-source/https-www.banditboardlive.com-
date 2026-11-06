/** Serverfunktioner til regelmotoren. Al logik og alle rettighedstjek ligger i store.server.ts. */
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/** Som authMiddleware, men tillader gæster (userId = null) – til offentlige resultater og live-visning. */
const optionalAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    let userId: string | null = null;
    try {
      const { getSessionUser } = await import("@/lib/auth/verify.server");
      userId = (await getSessionUser(context.bearerToken))?.id ?? null;
    } catch {
      userId = null;
    }
    return next({ context: { userId } });
  });

const S = () => import("./store.server");
const str = (v: unknown, n = 200) => String(v ?? "").slice(0, n);

export const getSportsOverview = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => (await S()).myOverview(context.userId));
export const getPublicSports = createServerFn({ method: "GET" }).handler(async () => (await S()).publicOverview());
export const getRuleSets = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d: { sportId?: string }) => ({ sportId: d?.sportId ? str(d.sportId, 40) : undefined })).handler(async ({ context, data }) => (await S()).listRuleSets(context.userId, data.sportId));
export const getRuleSet = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).readRuleSet(context.userId, data.id));
export const saveRuleSet = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: string; sportId: string; name: string; level: string; variant: string; rules: unknown; customEvents: unknown; note: string; publish: boolean }) => ({ id: d?.id ? str(d.id, 40) : undefined, sportId: str(d?.sportId, 40), name: str(d?.name, 80), level: str(d?.level, 20), variant: str(d?.variant, 30), rules: d?.rules, customEvents: d?.customEvents, note: str(d?.note, 300), publish: Boolean(d?.publish) }))
  .handler(async ({ context, data }) => (await S()).saveRuleSet(context.userId, data));
export const archiveRuleSet = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).archiveRuleSet(context.userId, data.id));

export const createSportMatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { sportId: string; rulesetId: string | null; variant: string; title: string; participants: unknown; isPublic: boolean }) => ({ sportId: str(d?.sportId, 40), rulesetId: d?.rulesetId ? str(d.rulesetId, 40) : null, variant: str(d?.variant, 30), title: str(d?.title, 120), participants: d?.participants, isPublic: d?.isPublic !== false }))
  .handler(async ({ context, data }) => (await S()).createMatch(context.userId, data));
export const getSportMatch = createServerFn({ method: "GET" })
  .middleware([optionalAuth])
  .validator((d: { id: string; key?: string }) => ({ id: str(d?.id, 40), key: d?.key ? str(d.key, 40) : undefined }))
  .handler(async ({ context, data }) => JSON.stringify(await (await S()).readMatch(context.userId, data.id, data.key)));
export const addSportEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { matchId: string; type: string; side?: string; player?: string; minute?: number; data?: Record<string, unknown> }) => ({ matchId: str(d?.matchId, 40), ev: { type: str(d?.type, 30), side: d?.side ? str(d.side, 40) : undefined, player: d?.player ? str(d.player, 60) : undefined, minute: typeof d?.minute === "number" ? d.minute : undefined, data: d?.data && typeof d.data === "object" ? d.data : {} } }))
  .handler(async ({ context, data }) => JSON.stringify(await (await S()).addEvent(context.userId, data.matchId, data.ev)));
export const voidSportEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { matchId: string; eventId: string; reason: string }) => ({ matchId: str(d?.matchId, 40), eventId: str(d?.eventId, 40), reason: str(d?.reason, 200) }))
  .handler(async ({ context, data }) => JSON.stringify(await (await S()).voidEvent(context.userId, data.matchId, data.eventId, data.reason)));
export const approveSportMatch = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).approveMatch(context.userId, data.id));
export const getSportMatchHistory = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).matchHistory(context.userId, data.id));
export const deleteSportMatch = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).deleteMatch(context.userId, data.id));

export const createSportTournament = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; sportId: string; rulesetId: string | null; variant: string; format: string; participants: unknown; double: boolean; groups: number; isPublic: boolean }) => ({ name: str(d?.name, 120), sportId: str(d?.sportId, 40), rulesetId: d?.rulesetId ? str(d.rulesetId, 40) : null, variant: str(d?.variant, 30), format: str(d?.format, 20), participants: d?.participants, double: Boolean(d?.double), groups: Number(d?.groups) || 2, isPublic: d?.isPublic !== false }))
  .handler(async ({ context, data }) => (await S()).createTournament(context.userId, data));
export const getSportTournament = createServerFn({ method: "GET" }).middleware([optionalAuth]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).readTournament(context.userId, data.id));
export const addSportTournamentRound = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).addTournamentRound(context.userId, data.id));
export const deleteSportTournament = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d: { id: string }) => ({ id: str(d?.id, 40) })).handler(async ({ context, data }) => (await S()).deleteTournament(context.userId, data.id));

import type { MatchView } from "./store.server";
export type { MatchView };
/** Kampdata sendes som JSON-tekst (hændelsernes data er frie felter). */
export const fetchMatch = async (id: string, key?: string) => JSON.parse(await getSportMatch({ data: { id, key } })) as MatchView;
export const postEvent = async (d: { matchId: string; type: string; side?: string; player?: string; minute?: number; data?: Record<string, unknown> }) => JSON.parse(await addSportEvent({ data: d })) as MatchView;
export const postVoid = async (d: { matchId: string; eventId: string; reason: string }) => JSON.parse(await voidSportEvent({ data: d })) as MatchView;
