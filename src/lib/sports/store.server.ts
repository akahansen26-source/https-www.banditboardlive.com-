/**
 * Server: regelsæt, turneringer, kampe og hændelser.
 * Alle ændringer valideres her med regelmotoren og rettighederne – klienten bestemmer intet selv.
 */
import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { ensureProfile, type Profile } from "@/lib/board-store.server";
import { hasPermission, type Permission } from "@/lib/roles";
import { writeAudit } from "@/lib/audit.server";
import { defaultValues, resolveValues, sportById, summarize, replayProblem, validateEvent, validateRuleSet } from "./engine.ts";
import { computeStandings, groupsOf, knockoutFirstRound, roundRobin, ROUND_NAME } from "./standings.ts";
import { str } from "./common.ts";
import type { CustomEvent, MatchEvent, Participant, RuleValues, Summary, TournamentFormat } from "./types.ts";

const id = (p: string) => p + randomBytes(9).toString("base64url");
// eslint-disable-next-line no-control-regex
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const parse = <T>(s: string | null | undefined, fb: T): T => { try { return s ? (JSON.parse(s) as T) : fb; } catch { return fb; } };
const asText = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

export class Forbidden extends Error { status = 403; }
function need(p: Profile, perm: Permission, what: string) {
  if (!p.active || p.accountStatus !== "approved") throw new Forbidden("Kontoen er ikke aktiv.");
  if (!hasPermission(p.role, perm)) throw new Forbidden(`Din rolle har ikke rettighed til at ${what}.`);
}
const isAdmin = (p: Profile) => hasPermission(p.role, "MANAGE_USERS");
const actor = (p: Profile) => p.contactName || p.accountName || p.venueName || p.email;

/* ---------------- deltagere og hændelser ---------------- */
export function cleanParticipants(list: unknown, max = 200): Participant[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Participant[] = [];
  for (const raw of list.slice(0, max)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = clip(r.name, 80);
    if (!name) continue;
    let pid = clip(r.id, 40).replace(/[^\w-]/g, "") || id("p_");
    if (pid.startsWith("tbd") || pid.startsWith("__")) pid = id("p_");
    while (seen.has(pid)) pid = id("p_");
    seen.add(pid);
    const members = Array.isArray(r.members) ? r.members.map((m) => clip(m, 60)).filter(Boolean).slice(0, 40) : undefined;
    const handicap = r.handicap === undefined || r.handicap === "" ? undefined : Number(r.handicap);
    out.push({ id: pid, name, team: clip(r.team, 60) || undefined, members: members?.length ? members : undefined, lane: Number(r.lane) || undefined, bib: clip(r.bib, 12) || undefined, handicap: Number.isFinite(handicap) ? Math.max(-10, Math.min(60, handicap as number)) : undefined });
  }
  return out;
}

export function cleanCustomEvents(list: unknown): CustomEvent[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 60).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      id: clip(r.id, 30).replace(/[^\w-]/g, "") || id("ev"),
      name: clip(r.name, 60),
      description: clip(r.description, 200),
      value: Math.max(0, Math.min(10000, Math.round(Number(r.value) || 0))),
      sign: Number(r.sign) < 0 ? -1 : 1,
      target: r.target === "opponents" ? "opponents" : "self",
      repeatable: r.repeatable !== false,
      needsApproval: Boolean(r.needsApproval),
      show: r.show !== false,
    } as CustomEvent;
  });
}

function cleanRules(sportId: string, raw: unknown): RuleValues {
  const sport = sportById(sportId);
  if (!sport) throw new Error("Ukendt sportsgren.");
  const src = (raw && typeof raw === "object" ? raw : {}) as RuleValues;
  const out: RuleValues = {};
  for (const r of sport.rules) {
    if (!(r.id in src)) continue;
    const v = src[r.id];
    if (r.kind === "bool") out[r.id] = Boolean(v);
    else if (r.kind === "choice" || r.kind === "text") out[r.id] = clip(v, 200);
    else if (r.kind === "table") out[r.id] = Array.isArray(v) ? v.slice(0, 100).map((x) => Number(x)) : [];
    else out[r.id] = Number(v);
  }
  return resolveValues(sport, out);
}

/* ---------------- regelsæt ---------------- */
type RuleSetRow = { id: string; owner_id: string; sport_id: string; level: string; name: string; variant: string; status: string; current_version: number; created_at: unknown; updated_at: unknown };
export type RuleSetInfo = { id: string; sportId: string; level: string; name: string; variant: string; status: string; version: number; updatedAt: string; mine: boolean };
const mapRS = (r: RuleSetRow, me: string): RuleSetInfo => ({ id: r.id, sportId: r.sport_id, level: r.level, name: r.name, variant: r.variant, status: r.status, version: Number(r.current_version) || 0, updatedAt: asText(r.updated_at), mine: r.owner_id === me });

export async function listRuleSets(userId: string, sportId?: string): Promise<RuleSetInfo[]> {
  const p = await ensureProfile(userId);
  const sql = await getSql();
  const rows = isAdmin(p)
    ? await sql.query<RuleSetRow>(`select * from sport_rulesets where status <> 'archived' ${sportId ? "and sport_id = $1" : ""} order by updated_at desc limit 300`, sportId ? [sportId] : [])
    : await sql.query<RuleSetRow>(`select * from sport_rulesets where owner_id = $1 and status <> 'archived' ${sportId ? "and sport_id = $2" : ""} order by updated_at desc limit 300`, sportId ? [userId, sportId] : [userId]);
  return rows.map((r) => mapRS(r, userId));
}

export async function readRuleSet(userId: string, rsId: string) {
  const p = await ensureProfile(userId);
  const sql = await getSql();
  const rs = (await sql.query<RuleSetRow>(`select * from sport_rulesets where id = $1`, [rsId]))[0];
  if (!rs || (rs.owner_id !== userId && !isAdmin(p))) throw new Forbidden("Regelsættet findes ikke, eller du har ikke adgang.");
  const versions = await sql.query<{ id: string; version: number; rules: string; custom_events: string; note: string; created_by_name: string; created_at: unknown }>(`select id, version, rules, custom_events, note, created_by_name, created_at from sport_ruleset_versions where ruleset_id = $1 order by version desc`, [rsId]);
  return {
    ...mapRS(rs, userId),
    versions: versions.map((v) => ({ id: v.id, version: Number(v.version), rules: parse<RuleValues>(v.rules, {}), customEvents: parse<CustomEvent[]>(v.custom_events, []), note: v.note, by: v.created_by_name, at: asText(v.created_at) })),
  };
}

export async function saveRuleSet(userId: string, input: { id?: string; sportId: string; name: string; level: string; variant: string; rules: unknown; customEvents: unknown; note: string; publish: boolean }) {
  const p = await ensureProfile(userId);
  need(p, "MANAGE_RULES", "ændre sportsregler");
  const sport = sportById(input.sportId);
  if (!sport) throw new Error("Ukendt sportsgren.");
  const rules = cleanRules(sport.id, input.rules);
  const events = cleanCustomEvents(input.customEvents);
  const check = validateRuleSet(sport, rules, sport.family === "custom" ? events : []);
  if (check.errors.length) throw new Error(check.errors.join(" "));
  const name = clip(input.name, 80) || `${sport.name} – eget regelsæt`;
  const level = input.level === "custom" ? "custom" : "tournament";
  const sql = await getSql();
  let rsId = input.id ? clip(input.id, 40) : "";
  let version = 1;
  if (rsId) {
    const rs = (await sql.query<RuleSetRow>(`select * from sport_rulesets where id = $1`, [rsId]))[0];
    if (!rs || (rs.owner_id !== userId && !isAdmin(p))) throw new Forbidden("Du kan kun ændre dine egne regelsæt.");
    if (rs.sport_id !== sport.id) throw new Error("Regelsættet tilhører en anden sportsgren.");
    version = Number(rs.current_version) + 1;
    await sql.query(`update sport_rulesets set name = $2, level = $3, variant = $4, status = $5, current_version = $6, updated_at = now() where id = $1`, [rsId, name, level, clip(input.variant, 30), input.publish ? "published" : rs.status === "published" ? "published" : "draft", version]);
  } else {
    rsId = id("rs_");
    await sql.query(`insert into sport_rulesets (id, owner_id, sport_id, level, name, variant, status, current_version) values ($1,$2,$3,$4,$5,$6,$7,1)`, [rsId, userId, sport.id, level, name, clip(input.variant, 30), input.publish ? "published" : "draft"]);
  }
  await sql.query(`insert into sport_ruleset_versions (id, ruleset_id, version, rules, custom_events, note, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id("rv_"), rsId, version, JSON.stringify(rules), JSON.stringify(events), clip(input.note, 300), userId, actor(p)]);
  await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: `Gemte regelsæt (${sport.name})`, detail: `${name} · version ${version}${input.publish ? " · offentliggjort" : ""}` });
  return { id: rsId, version, warnings: check.warnings };
}

export async function archiveRuleSet(userId: string, rsId: string) {
  const p = await ensureProfile(userId);
  need(p, "MANAGE_RULES", "ændre sportsregler");
  const sql = await getSql();
  const rs = (await sql.query<RuleSetRow>(`select * from sport_rulesets where id = $1`, [rsId]))[0];
  if (!rs || (rs.owner_id !== userId && !isAdmin(p))) throw new Forbidden("Du kan kun arkivere dine egne regelsæt.");
  await sql.query(`update sport_rulesets set status = 'archived', updated_at = now() where id = $1`, [rsId]);
  await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: "Arkiverede regelsæt", detail: rs.name });
  return { ok: true };
}

/** Find reglerne der skal låses fast: et gemt regelsæt (seneste version) eller standard + variant. */
async function frozenRules(userId: string, p: Profile, sportId: string, rulesetId: string | null, variant: string) {
  const sport = sportById(sportId);
  if (!sport) throw new Error("Ukendt sportsgren.");
  if (!rulesetId) {
    const v = sport.variants?.find((x) => x.id === variant);
    return { rules: defaultValues(sport, v?.id), events: sport.customEvents ?? [], label: `Standard${v ? ` · ${v.label}` : ""} (${sport.source.body})`, versionId: null as string | null };
  }
  const sql = await getSql();
  const rs = (await sql.query<RuleSetRow>(`select * from sport_rulesets where id = $1`, [rulesetId]))[0];
  if (!rs || rs.sport_id !== sportId || (rs.owner_id !== userId && !isAdmin(p))) throw new Forbidden("Regelsættet findes ikke, eller du har ikke adgang.");
  const v = (await sql.query<{ id: string; rules: string; custom_events: string; version: number }>(`select id, rules, custom_events, version from sport_ruleset_versions where ruleset_id = $1 order by version desc limit 1`, [rulesetId]))[0];
  if (!v) throw new Error("Regelsættet har ingen gemt version.");
  return { rules: resolveValues(sport, parse(v.rules, {})), events: parse<CustomEvent[]>(v.custom_events, []), label: `${rs.name} · v${v.version}`, versionId: v.id };
}

/* ---------------- kampe ---------------- */
type MatchRow = { id: string; owner_id: string; tournament_id: string | null; sport_id: string; rule_label: string; rules_snapshot: string; custom_events: string; title: string; round_label: string; round_no: number; group_label: string; participants: string; status: string; summary: string; approved: boolean; approved_by: string; approved_at: unknown; is_public: boolean; view_key: string; next_match_id: string | null; next_slot: number | null; created_at: unknown; updated_at: unknown; finished_at: unknown };
type EventRow = { id: string; seq: number; at: number | string; type: string; side: string | null; player: string | null; minute: number | null; data: string; by_name: string; voided_at: number | string | null; voided_by: string; void_reason: string };

export type MatchView = {
  id: string; sportId: string; ruleLabel: string; rules: RuleValues; customEvents: CustomEvent[]; title: string; round: string; group: string; participants: Participant[];
  status: string; approved: boolean; approvedBy: string; isPublic: boolean; tournamentId: string | null; viewKey?: string; updatedAt: string; events: MatchEvent[]; summary: Summary;
  can: { score: boolean; decide: boolean; manage: boolean };
};

function mapEvents(rows: EventRow[]): MatchEvent[] {
  return rows.map((e) => ({ id: e.id, seq: Number(e.seq), at: Number(e.at), type: e.type, side: e.side ?? undefined, player: e.player ?? undefined, minute: e.minute ?? undefined, data: parse<Record<string, unknown>>(e.data, {}), byName: e.by_name, voided: e.voided_at ? { at: Number(e.voided_at), byName: e.voided_by, reason: e.void_reason } : undefined }));
}

async function loadMatch(matchId: string) {
  const sql = await getSql();
  const m = (await sql.query<MatchRow>(`select * from sport_matches where id = $1`, [matchId]))[0];
  if (!m) return null;
  const ev = await sql.query<EventRow>(`select * from sport_events where match_id = $1 order by seq`, [matchId]);
  return { m, events: mapEvents(ev) };
}

const matchInput = (m: MatchRow) => ({ sportId: m.sport_id, rules: parse<RuleValues>(m.rules_snapshot, {}), participants: parse<Participant[]>(m.participants, []), customEvents: parse<CustomEvent[]>(m.custom_events, []) });

function view(m: MatchRow, events: MatchEvent[], perms: { score: boolean; decide: boolean; manage: boolean }, showKey: boolean): MatchView {
  const input = matchInput(m);
  return {
    id: m.id, sportId: m.sport_id, ruleLabel: m.rule_label, rules: input.rules, customEvents: input.customEvents, title: m.title, round: m.round_label, group: m.group_label, participants: input.participants,
    status: m.status, approved: Boolean(m.approved), approvedBy: m.approved_by, isPublic: Boolean(m.is_public), tournamentId: m.tournament_id, viewKey: showKey ? m.view_key : undefined, updatedAt: asText(m.updated_at),
    events, summary: summarize(input, events), can: perms,
  };
}

async function permsFor(userId: string | null, m: MatchRow) {
  if (!userId) return { p: null, owner: false, perms: { score: false, decide: false, manage: false } };
  const p = await ensureProfile(userId);
  const open = p.active && p.accountStatus === "approved";
  const owner = m.owner_id === userId || isAdmin(p);
  return { p, owner, perms: { score: open && owner && hasPermission(p.role, "EDIT_SCORE"), decide: open && owner && hasPermission(p.role, "APPROVE_RESULTS"), manage: open && owner && hasPermission(p.role, "EDIT_MATCH") } };
}

export async function readMatch(userId: string | null, matchId: string, key?: string): Promise<MatchView> {
  const L = await loadMatch(clip(matchId, 40));
  if (!L) throw new Forbidden("Kampen findes ikke.");
  const { owner, perms } = await permsFor(userId, L.m);
  const keyOk = Boolean(key) && key === L.m.view_key;
  if (!L.m.is_public && !owner && !keyOk) throw new Forbidden("Kampen er ikke offentlig.");
  return view(L.m, owner ? L.events : L.events.map((e) => ({ ...e, byName: undefined })), perms, owner);
}

export async function createMatch(userId: string, input: { sportId: string; rulesetId: string | null; variant: string; title: string; participants: unknown; isPublic: boolean }) {
  const p = await ensureProfile(userId);
  need(p, "EDIT_MATCH", "oprette kampe");
  const sport = sportById(input.sportId);
  if (!sport) throw new Error("Ukendt sportsgren.");
  const parts = cleanParticipants(input.participants, sport.maxParticipants);
  if (parts.length < sport.minParticipants) throw new Error(`${sport.name} kræver mindst ${sport.minParticipants} deltagere.`);
  if (sport.family === "golf" || sport.family === "race" || sport.family === "custom" || sport.family === "bowling" || sport.family === "attempts") { /* feltkonkurrence – flere deltagere er ok */ }
  else if (parts.length !== 2 && !(sport.family === "x01" || sport.family === "cricket")) throw new Error(`${sport.name} spilles mellem to deltagere/hold.`);
  const fr = await frozenRules(userId, p, sport.id, input.rulesetId, clip(input.variant, 30));
  const check = validateRuleSet(sport, fr.rules, sport.family === "custom" ? fr.events : []);
  if (check.errors.length) throw new Error(check.errors.join(" "));
  if (sport.family === "golf" && str(fr.rules, "format", "stroke") === "match" && parts.length !== 2) throw new Error("Hulspil kræver præcis to spillere.");
  const sql = await getSql();
  const mid = id("m_");
  const title = clip(input.title, 120) || parts.map((x) => x.name).slice(0, 3).join(" – ") + (parts.length > 3 ? " m.fl." : "");
  const s = summarize({ sportId: sport.id, rules: fr.rules, participants: parts, customEvents: fr.events }, []);
  await sql.query(`insert into sport_matches (id, owner_id, sport_id, rule_label, rules_snapshot, custom_events, title, participants, status, summary, is_public, view_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [mid, userId, sport.id, fr.label, JSON.stringify(fr.rules), JSON.stringify(fr.events), title, JSON.stringify(parts), s.status, JSON.stringify(s), Boolean(input.isPublic), randomBytes(12).toString("base64url")]);
  await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: `Oprettede kamp (${sport.name})`, detail: `${title} · ${fr.label}` });
  return { id: mid };
}

export const DECISION_TYPES = new Set(["walkover", "disqualify", "reopen", "penalty_status", "approve", "reject", "abandon", "postpone"]);

export async function addEvent(userId: string, matchId: string, raw: { type: string; side?: string; player?: string; minute?: number; data?: Record<string, unknown> }) {
  const L = await loadMatch(clip(matchId, 40));
  if (!L) throw new Forbidden("Kampen findes ikke.");
  const { p, perms } = await permsFor(userId, L.m);
  if (!p || !perms.score) throw new Forbidden("Du har ikke rettighed til at registrere hændelser i denne kamp.");
  const type = clip(raw.type, 30).replace(/[^\w]/g, "");
  if (parse<Participant[]>(L.m.participants, []).some((x) => x.id.startsWith("tbd"))) throw new Error("Kampen afventer, at deltagerne er fundet i tidligere runder.");
  if (DECISION_TYPES.has(type) && !perms.decide) throw new Forbidden("Kun en turneringsleder/dommer med rettighed til at godkende resultater kan træffe denne afgørelse.");
  const input = matchInput(L.m);
  // data: kun simple værdier
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw.data ?? {}).slice(0, 30)) {
    const key = clip(k, 30);
    if (typeof v === "number" || typeof v === "boolean") data[key] = v;
    else if (typeof v === "string") data[key] = clip(v, 200);
    else if (Array.isArray(v)) data[key] = v.slice(0, 60).map((x) => (typeof x === "number" ? x : clip(x, 40)));
    else if (v && typeof v === "object") data[key] = Object.fromEntries(Object.entries(v).slice(0, 20).map(([a, b]) => [clip(a, 10), Number(b) || 0]));
  }
  const seq = (L.events.at(-1)?.seq ?? 0) + 1;
  const ev: MatchEvent = { id: id("e_"), seq, at: Date.now(), type, side: raw.side ? clip(raw.side, 40) : undefined, player: raw.player ? clip(raw.player, 60) : undefined, minute: Number.isFinite(Number(raw.minute)) && raw.minute ? Math.max(0, Math.min(999, Math.round(Number(raw.minute)))) : undefined, data, byName: actor(p) };
  const err = validateEvent(input, L.events, ev);
  if (err) throw new Error(err);
  const before = summarize(input, L.events);
  const events = [...L.events, ev];
  const after = summarize(input, events);
  const sql = await getSql();
  await sql.query(`insert into sport_events (id, match_id, seq, at, type, side, player, minute, data, by_id, by_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [ev.id, L.m.id, seq, ev.at, type, ev.side ?? null, ev.player ?? null, ev.minute ?? null, JSON.stringify(data), userId, ev.byName ?? ""]);
  await persistSummary(L.m, after, before);
  if (DECISION_TYPES.has(type) || (before.status !== "finished" && after.status === "finished")) {
    await sql.query(`insert into sport_result_history (id, match_id, by_id, by_name, action, before, after, reason) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id("h_"), L.m.id, userId, actor(p), DECISION_TYPES.has(type) ? `Afgørelse: ${type}` : "Kampen afsluttet", resultLine(before), resultLine(after), clip(data.reason, 200)]);
    await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: DECISION_TYPES.has(type) ? `Kampafgørelse (${type})` : "Kamp afsluttet", detail: `${L.m.title}: ${resultLine(before)} → ${resultLine(after)}` });
  }
  return view(L.m.status !== after.status ? { ...L.m, status: after.status } : L.m, events, perms, true);
}

function resultLine(s: Summary): string {
  return `${s.scores.map((x) => `${x.name} ${x.main}`).join(" – ")}${s.resultType ? ` (${s.resultType})` : ""}`;
}

async function persistSummary(m: MatchRow, s: Summary, before?: Summary) {
  const sql = await getSql();
  const finishedNow = s.status === "finished" && before?.status !== "finished";
  const requireApproval = Boolean(parse<RuleValues>(m.rules_snapshot, {}).requireApproval);
  await sql.query(`update sport_matches set status = $2, summary = $3, updated_at = now(), finished_at = case when $4 then now() else finished_at end, approved = case when $5 then false else approved end where id = $1`, [m.id, s.status, JSON.stringify(s), finishedNow, s.status !== "finished" || requireApproval]);
  if (!requireApproval && s.status === "finished") await sql.query(`update sport_matches set approved = true where id = $1`, [m.id]);
  if (finishedNow && m.next_match_id && s.winnerId) await advance(m, s.winnerId);
}

/** Knockout: vinderen går videre til næste kamp. */
async function advance(m: MatchRow, winnerId: string) {
  const sql = await getSql();
  const next = (await sql.query<MatchRow>(`select * from sport_matches where id = $1`, [m.next_match_id]))[0];
  if (!next) return;
  const parts = parse<Participant[]>(next.participants, []);
  const w = parse<Participant[]>(m.participants, []).find((x) => x.id === winnerId);
  if (!w) return;
  const slot = Number(m.next_slot) || 0;
  const filled = parts.filter((x) => !x.id.startsWith("tbd")).length;
  parts[slot] = w;
  if (parts.length < 2) parts.length = 2;
  for (let i = 0; i < 2; i++) if (!parts[i]) parts[i] = { id: `tbd${i}`, name: "Afventer" };
  void filled;
  const s = summarize(matchInput({ ...next, participants: JSON.stringify(parts) }), []);
  await sql.query(`update sport_matches set participants = $2, summary = $3, updated_at = now() where id = $1`, [next.id, JSON.stringify(parts), JSON.stringify(s)]);
}

export async function voidEvent(userId: string, matchId: string, eventId: string, reason: string) {
  const L = await loadMatch(clip(matchId, 40));
  if (!L) throw new Forbidden("Kampen findes ikke.");
  const { p, perms } = await permsFor(userId, L.m);
  if (!p || !perms.score) throw new Forbidden("Du har ikke rettighed til at rette i denne kamp.");
  const ev = L.events.find((e) => e.id === eventId);
  if (!ev) throw new Error("Hændelsen findes ikke.");
  if (ev.voided) throw new Error("Hændelsen er allerede annulleret.");
  const why = clip(reason, 200);
  if (!why) throw new Error("Skriv hvorfor hændelsen annulleres.");
  const input = matchInput(L.m);
  const before = summarize(input, L.events);
  if ((before.status === "finished" || DECISION_TYPES.has(ev.type)) && !perms.decide) throw new Forbidden("Kampen er afsluttet. Kun en turneringsleder kan rette resultatet.");
  const now = Date.now();
  const events = L.events.map((e) => (e.id === eventId ? { ...e, voided: { at: now, byName: actor(p), reason: why } } : e));
  // en annullering må ikke efterlade senere hændelser, som ikke længere giver mening (fx mål før kampstart)
  const broken = replayProblem(input, events);
  if (broken) throw new Error(`Kan ikke annulleres: hændelse #${broken.event.seq} bygger på den (${broken.error}) Annullér de senere hændelser først.`);
  const after = summarize(input, events);
  const sql = await getSql();
  await sql.query(`update sport_events set voided_at = $3, voided_by = $4, void_reason = $5 where id = $1 and match_id = $2`, [eventId, L.m.id, now, actor(p), why]);
  await persistSummary(L.m, after, before);
  await sql.query(`insert into sport_result_history (id, match_id, by_id, by_name, action, before, after, reason) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id("h_"), L.m.id, userId, actor(p), `Annullerede hændelse #${ev.seq} (${ev.type})`, resultLine(before), resultLine(after), why]);
  if (before.status === "finished" || resultLine(before) !== resultLine(after)) await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: "Rettede score", detail: `${L.m.title}: ${resultLine(before)} → ${resultLine(after)} · ${why}` });
  return view(L.m, events, perms, true);
}

export async function approveMatch(userId: string, matchId: string) {
  const L = await loadMatch(clip(matchId, 40));
  if (!L) throw new Forbidden("Kampen findes ikke.");
  const { p, perms } = await permsFor(userId, L.m);
  if (!p || !perms.decide) throw new Forbidden("Du har ikke rettighed til at godkende resultater.");
  const s = summarize(matchInput(L.m), L.events);
  if (s.status !== "finished") throw new Error("Kun afsluttede kampe kan godkendes.");
  const sql = await getSql();
  await sql.query(`update sport_matches set approved = true, approved_by = $2, approved_at = now() where id = $1`, [L.m.id, actor(p)]);
  await sql.query(`insert into sport_result_history (id, match_id, by_id, by_name, action, before, after) values ($1,$2,$3,$4,'Resultat godkendt',$5,$5)`, [id("h_"), L.m.id, userId, actor(p), resultLine(s)]);
  await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: "Godkendte resultat", detail: `${L.m.title}: ${resultLine(s)}` });
  return { ok: true };
}

export async function matchHistory(userId: string, matchId: string) {
  const L = await loadMatch(clip(matchId, 40));
  if (!L) throw new Forbidden("Kampen findes ikke.");
  const { owner } = await permsFor(userId, L.m);
  if (!owner) throw new Forbidden("Kun ejeren kan se resultathistorikken.");
  const sql = await getSql();
  const rows = await sql.query<{ at: unknown; by_name: string; action: string; before: string; after: string; reason: string }>(`select at, by_name, action, before, after, reason from sport_result_history where match_id = $1 order by at desc limit 200`, [L.m.id]);
  return rows.map((r) => ({ at: asText(r.at), by: r.by_name, action: r.action, before: r.before, after: r.after, reason: r.reason }));
}

export async function deleteMatch(userId: string, matchId: string) {
  const L = await loadMatch(clip(matchId, 40));
  if (!L) throw new Forbidden("Kampen findes ikke.");
  const { p, perms } = await permsFor(userId, L.m);
  if (!p || !perms.manage || !hasPermission(p.role, "DELETE_TOURNAMENT")) throw new Forbidden("Du har ikke rettighed til at slette kampe.");
  if (L.m.tournament_id) throw new Error("Kampen hører til en turnering. Slet turneringen i stedet.");
  const sql = await getSql();
  await sql.query(`delete from sport_matches where id = $1`, [L.m.id]);
  await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: "Slettede kamp", detail: L.m.title });
  return { ok: true };
}

type MatchListItem = { id: string; sportId: string; title: string; status: string; summary: Summary; approved: boolean; isPublic: boolean; tournamentId: string | null; round: string; group: string; updatedAt: string; ruleLabel: string };
const mapList = (m: MatchRow): MatchListItem => ({ id: m.id, sportId: m.sport_id, title: m.title, status: m.status, summary: parse<Summary>(m.summary, { status: "scheduled" } as Summary), approved: Boolean(m.approved), isPublic: Boolean(m.is_public), tournamentId: m.tournament_id, round: m.round_label, group: m.group_label, updatedAt: asText(m.updated_at), ruleLabel: m.rule_label });

export async function myOverview(userId: string) {
  const p = await ensureProfile(userId);
  const sql = await getSql();
  const matches = await sql.query<MatchRow>(`select * from sport_matches where owner_id = $1 and tournament_id is null order by updated_at desc limit 100`, [userId]);
  const tours = await sql.query<TourRow>(`select * from sport_tournaments where owner_id = $1 and status <> 'archived' order by updated_at desc limit 100`, [userId]);
  return { role: p.role, matches: matches.map(mapList), tournaments: tours.map(mapTour), ruleSets: await listRuleSets(userId) };
}

export async function publicOverview() {
  const sql = await getSql();
  const matches = await sql.query<MatchRow>(`select m.* from sport_matches m left join sport_tournaments t on t.id = m.tournament_id where m.is_public = true and (t.id is null or t.is_public = true) and m.status <> 'scheduled' order by m.updated_at desc limit 60`);
  const tours = await sql.query<TourRow>(`select * from sport_tournaments where is_public = true and status <> 'archived' order by updated_at desc limit 40`);
  return { matches: matches.map(mapList), tournaments: tours.map(mapTour) };
}

/* ---------------- turneringer ---------------- */
type TourRow = { id: string; owner_id: string; name: string; sport_id: string; ruleset_version_id: string | null; rule_label: string; rules_snapshot: string; custom_events: string; format: string; status: string; participants: string; is_public: boolean; created_at: unknown; updated_at: unknown };
const mapTour = (t: TourRow) => ({ id: t.id, name: t.name, sportId: t.sport_id, format: t.format, status: t.status, ruleLabel: t.rule_label, isPublic: Boolean(t.is_public), participants: parse<Participant[]>(t.participants, []).length, updatedAt: asText(t.updated_at) });

export async function createTournament(userId: string, input: { name: string; sportId: string; rulesetId: string | null; variant: string; format: string; participants: unknown; double: boolean; groups: number; isPublic: boolean }) {
  const p = await ensureProfile(userId);
  need(p, "CREATE_TOURNAMENT", "oprette turneringer");
  const sport = sportById(input.sportId);
  if (!sport) throw new Error("Ukendt sportsgren.");
  const format = (["league", "groups", "knockout", "individual"].includes(input.format) ? input.format : "league") as TournamentFormat;
  if (!sport.formats.includes(format)) throw new Error(`${sport.name} understøtter ikke dette turneringsformat.`);
  const parts = cleanParticipants(input.participants, 128);
  if (parts.length < 2 && format !== "individual") throw new Error("En turnering kræver mindst to deltagere.");
  const fr = await frozenRules(userId, p, sport.id, input.rulesetId, clip(input.variant, 30));
  const check = validateRuleSet(sport, fr.rules, sport.family === "custom" ? fr.events : []);
  if (check.errors.length) throw new Error(check.errors.join(" "));
  const sql = await getSql();
  const tid = id("t_");
  const name = clip(input.name, 120) || `${sport.name}-turnering`;
  await sql.query(`insert into sport_tournaments (id, owner_id, name, sport_id, ruleset_version_id, rule_label, rules_snapshot, custom_events, format, participants, is_public) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [tid, userId, name, sport.id, fr.versionId, fr.label, JSON.stringify(fr.rules), JSON.stringify(fr.events), format, JSON.stringify(parts), Boolean(input.isPublic)]);
  const base = { owner: userId, sport: sport.id, label: fr.label, rules: JSON.stringify(fr.rules), events: JSON.stringify(fr.events), pub: Boolean(input.isPublic) };
  const insert = async (title: string, round: string, roundNo: number, group: string, ps: Participant[], next?: { id: string; slot: number }, mid = id("m_")) => {
    const s = summarize({ sportId: sport.id, rules: fr.rules, participants: ps, customEvents: fr.events }, []);
    await sql.query(`insert into sport_matches (id, owner_id, tournament_id, sport_id, rule_label, rules_snapshot, custom_events, title, round_label, round_no, group_label, participants, status, summary, is_public, view_key, next_match_id, next_slot) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [mid, base.owner, tid, base.sport, base.label, base.rules, base.events, title, round, roundNo, group, JSON.stringify(ps), s.status, JSON.stringify(s), base.pub, randomBytes(12).toString("base64url"), next?.id ?? null, next?.slot ?? null]);
    return mid;
  };
  const byId = new Map(parts.map((x) => [x.id, x]));
  let count = 0;
  if (format === "individual" || sport.shape === "field") {
    // feltkonkurrence: én konkurrence – eller en serie, hvor der tilføjes afdelinger løbende
    await insert(format === "league" ? `${name} – afdeling 1` : name, format === "league" ? "Afdeling 1" : "Konkurrence", 1, "", parts); count = 1;
  } else if (format === "league" || format === "groups") {
    const groups = format === "groups" ? groupsOf(parts.map((x) => x.id), Math.max(2, Math.min(16, Math.round(input.groups) || 2))) : [parts.map((x) => x.id)];
    for (let gi = 0; gi < groups.length; gi++) {
      const label = format === "groups" ? `Pulje ${String.fromCharCode(65 + gi)}` : "";
      const rounds = roundRobin(groups[gi], Boolean(input.double));
      for (let ri = 0; ri < rounds.length; ri++) for (const [a, b] of rounds[ri]) { await insert(`${byId.get(a)!.name} – ${byId.get(b)!.name}`, `Runde ${ri + 1}`, ri + 1, label, [byId.get(a)!, byId.get(b)!]); count++; }
    }
  } else {
    // knockout: byg træet bagfra (finale først), så hver kamp kender næste kamp
    const ko = knockoutFirstRound(parts.map((x) => x.id));
    const roundsN = Math.log2(ko.size);
    let nextIds: string[] = [];
    const TBD = (): Participant[] => [{ id: "tbd0", name: "Afventer" }, { id: "tbd1", name: "Afventer" }];
    for (let r = roundsN; r >= 2; r--) {
      const n = ko.size / Math.pow(2, r);
      const ids: string[] = [];
      for (let i = 0; i < n; i++) { const mid = id("m_"); ids.push(mid); await insert(`${ROUND_NAME(n)} ${n > 1 ? i + 1 : ""}`.trim(), ROUND_NAME(n), r, "", TBD(), nextIds.length ? { id: nextIds[Math.floor(i / 2)], slot: i % 2 } : undefined, mid); count++; }
      nextIds = ids;
    }
    const firstN = ko.size / 2;
    for (let i = 0; i < ko.pairs.length; i++) {
      const [a, b] = ko.pairs[i];
      const next = nextIds.length ? { id: nextIds[Math.floor(i / 2)], slot: i % 2 } : undefined;
      if (!b) {
        // bye: deltageren går direkte videre
        if (next) {
          const nm = (await sql.query<MatchRow>(`select * from sport_matches where id = $1`, [next.id]))[0];
          if (nm) await advance({ ...nm, id: "bye", next_match_id: next.id, next_slot: next.slot, participants: JSON.stringify([byId.get(a)!]) } as MatchRow, a);
        }
        continue;
      }
      await insert(`${byId.get(a)!.name} – ${byId.get(b)!.name}`, ROUND_NAME(firstN), 1, "", [byId.get(a)!, byId.get(b)!], next);
      count++;
    }
  }
  await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: `Oprettede turnering (${sport.name})`, detail: `${name} · ${format} · ${parts.length} deltagere · ${count} kampe · ${fr.label}` });
  return { id: tid, matches: count };
}

export async function readTournament(userId: string | null, tid: string) {
  const sql = await getSql();
  const t = (await sql.query<TourRow>(`select * from sport_tournaments where id = $1`, [clip(tid, 40)]))[0];
  if (!t) throw new Forbidden("Turneringen findes ikke.");
  let owner = false, canEdit = false, canDelete = false;
  if (userId) {
    const p = await ensureProfile(userId);
    owner = t.owner_id === userId || isAdmin(p);
    canEdit = owner && hasPermission(p.role, "EDIT_MATCH");
    canDelete = owner && hasPermission(p.role, "DELETE_TOURNAMENT");
  }
  if (!t.is_public && !owner) throw new Forbidden("Turneringen er ikke offentlig.");
  const matches = await sql.query<MatchRow>(`select * from sport_matches where tournament_id = $1 order by round_no, group_label, created_at`, [t.id]);
  const parts = parse<Participant[]>(t.participants, []);
  const rules = parse<RuleValues>(t.rules_snapshot, {});
  const list = matches.map(mapList);
  const groups = [...new Set(list.map((m) => m.group))];
  const standings = groups.map((g) => {
    const ms = list.filter((m) => m.group === g && m.status === "finished");
    const ids = new Set(list.filter((m) => m.group === g).flatMap((m) => m.summary.scores?.map((s) => s.id) ?? []));
    return { group: g, provisional: ms.some((m) => !m.approved), rows: computeStandings(parts.filter((x) => ids.has(x.id) || g === ""), ms.map((m) => ({ id: m.id, results: m.summary.results ?? [] })), str(rules, "tiebreak", "points,diff,for,h2h")) };
  });
  return { ...mapTour(t), rules, participantsList: parts, matches: list, standings, can: { edit: canEdit, delete: canDelete, owner } };
}

/** Serie med feltkonkurrencer (fx motorsport, golf, skomager): tilføj næste afdeling med alle deltagere. */
export async function addTournamentRound(userId: string, tid: string) {
  const p = await ensureProfile(userId);
  need(p, "EDIT_MATCH", "oprette kampe");
  const sql = await getSql();
  const t = (await sql.query<TourRow>(`select * from sport_tournaments where id = $1`, [clip(tid, 40)]))[0];
  if (!t || (t.owner_id !== userId && !isAdmin(p))) throw new Forbidden("Du kan kun ændre dine egne turneringer.");
  const sport = sportById(t.sport_id);
  if (!sport || sport.shape !== "field") throw new Error("Afdelinger bruges kun i feltkonkurrencer.");
  const n = Number((await sql.query<{ n: number }>(`select count(*) as n from sport_matches where tournament_id = $1`, [t.id]))[0]?.n ?? 0) + 1;
  const parts = parse<Participant[]>(t.participants, []);
  const rules = parse<RuleValues>(t.rules_snapshot, {}), events = parse<CustomEvent[]>(t.custom_events, []);
  const s = summarize({ sportId: sport.id, rules, participants: parts, customEvents: events }, []);
  const mid = id("m_");
  await sql.query(`insert into sport_matches (id, owner_id, tournament_id, sport_id, rule_label, rules_snapshot, custom_events, title, round_label, round_no, participants, status, summary, is_public, view_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [mid, t.owner_id, t.id, sport.id, t.rule_label, t.rules_snapshot, t.custom_events, `${t.name} – afdeling ${n}`, `Afdeling ${n}`, n, t.participants, s.status, JSON.stringify(s), t.is_public, randomBytes(12).toString("base64url")]);
  await sql.query(`update sport_tournaments set updated_at = now() where id = $1`, [t.id]);
  return { id: mid };
}

export async function deleteTournament(userId: string, tid: string) {
  const p = await ensureProfile(userId);
  need(p, "DELETE_TOURNAMENT", "slette turneringer");
  const sql = await getSql();
  const t = (await sql.query<TourRow>(`select * from sport_tournaments where id = $1`, [clip(tid, 40)]))[0];
  if (!t || (t.owner_id !== userId && !isAdmin(p))) throw new Forbidden("Du kan kun slette dine egne turneringer.");
  await sql.query(`update sport_tournaments set status = 'archived', updated_at = now() where id = $1`, [t.id]);
  await writeAudit({ actorId: userId, actorName: actor(p), actorRole: p.role, action: "Arkiverede turnering", detail: t.name });
  return { ok: true };
}
