// REQ-CORE-002: the caller comes only from the platform, never from a request field.
// Functions: context.metadata.user.id (Wonderful user id) -> app_user.wonderful_user_id.
// Agent tools: metadata.user is undefined there (S9), so identity is a signed claim in
// communication.metadata (minted by a gated Function, HMAC-verified here with MERC_INTERNAL_CALL_KEY).
import { createDb, type TablesApi, type Row } from "./tables";
import { forbidden, notFound } from "./errors";
import { hmacSha256Hex, safeEqual } from "./hmac";
import { ROLE_PERMISSIONS, type RoleCode } from "./generated/tables";
import type { FunctionResponseMap } from "./generated/contracts/types";

export type CallerSource =
  | { kind: "wonderful_user"; wonderfulUserId: string }
  | { kind: "app_user"; appUserId: string; orgId: string }
  /** Phone / WhatsApp session: the platform-set channel number (REQ-BUD-013). Never from a request field or model output. */
  | { kind: "channel_number"; number: string; channel: "phone" | "whatsapp" };

export interface FunctionContextLike {
  metadata?: { user?: { id?: string | null } | null } | null;
}
export interface ToolContextLike {
  metadata?: {
    communication?: {
      metadata?: Record<string, unknown> | null;
      type?: string | null;
      direction?: string | null;
      fromNumber?: string | null;
      toNumber?: string | null;
    } | null;
  } | null;
}

/** E.164 normalisation for Greek-first numbers: "+30 697 123 4567", "00306971234567", "6971234567" -> "+306971234567". */
export function normalizePhone(raw: string | null | undefined, defaultCc = "30"): string | null {
  if (!raw) return null;
  let v = String(raw).trim().replace(/^(tel:|sip:|whatsapp:)/i, "").split("@")[0].replace(/[\s().-]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (!v.startsWith("+")) v = /^\d{10}$/.test(v) ? `+${defaultCc}${v}` : `+${v}`;
  return /^\+\d{8,15}$/.test(v) ? v : null;
}

/** The rep's number on a phone/WhatsApp session: inbound = fromNumber, outbound = toNumber. Null for browser/chat sessions. */
export function channelNumberFromTool(ctx: ToolContextLike): { number: string; channel: "phone" | "whatsapp" } | null {
  const c = ctx?.metadata?.communication;
  if (!c) return null;
  const type = String(c.type ?? "").toLowerCase();
  const channel = type.includes("whatsapp") ? "whatsapp" : /voice|phone|call|sip|pstn/.test(type) ? "phone" : null;
  if (!channel) return null;
  const outbound = String(c.direction ?? "").toLowerCase() === "outbound";
  const number = normalizePhone(outbound ? c.toNumber : c.fromNumber);
  return number ? { number, channel } : null;
}

interface PrincipalBase {
  /** app_user.id for users; `system:<org_id>` for system callers (never write it into an FK column, see actorUserId). */
  id: string;
  role: RoleCode;
  org_id: string;
  org: Row<"organization">;
  /** Territories the user works in (territory_rep). */
  territory_ids: string[];
  /** Manager only: direct and indirect reports. */
  team_user_ids: string[];
  /** Manager only: territories they manage plus their team's territories. */
  team_territory_ids: string[];
  /** Union of role permission keys from contracts/app/app.json (row checks still apply). */
  permissions: string[];
}
/** A signed-in Merc user (app session or verified buddy-tool claim). */
export interface UserPrincipal extends PrincipalBase {
  kind: "user";
  user: Row<"app_user">;
  manager: Row<"app_user"> | null;
}
/** Scheduler (cron) or procedure caller acting for one org (contracts README "System callers"). Sees the whole org. */
export interface SystemPrincipal extends PrincipalBase {
  kind: "system";
  role: "admin";
  caller: SystemCaller;
  user: null;
  manager: null;
}
export type SystemCaller = "scheduler" | "procedure";
export type Principal = UserPrincipal | SystemPrincipal;

export const IDENTITY_KEYS = { uid: "merc_uid", org: "merc_org", exp: "merc_exp", sig: "merc_sig" } as const;
/** Platform-set customer user keys of a token-started session (S9 §4). If present they must match merc_uid. */
export const PLATFORM_USER_KEYS = ["wonderful.customer_user.id", "wonderful.web_sdk.entity_id"] as const;

const claimMessage = (uid: string, org: string, exp: string) => `${uid}|${org}|${exp}`;

/** For the token-minting Function: the metadata claims to embed in the Chat SDK user token. */
export function signIdentity(key: string, claim: { app_user_id: string; org_id: string; ttlSeconds?: number; now?: number }): Record<string, string> {
  if (!key) throw new Error("signing key missing");
  const exp = String(Math.floor((claim.now ?? Date.now()) / 1000) + (claim.ttlSeconds ?? 3600));
  return {
    [IDENTITY_KEYS.uid]: claim.app_user_id,
    [IDENTITY_KEYS.org]: claim.org_id,
    [IDENTITY_KEYS.exp]: exp,
    [IDENTITY_KEYS.sig]: hmacSha256Hex(key, claimMessage(claim.app_user_id, claim.org_id, exp)),
  };
}

function lookup(md: Record<string, unknown>, path: string): unknown {
  if (path in md) return md[path];
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), md);
}

export function callerFromFunction(context: FunctionContextLike): CallerSource {
  const id = context?.metadata?.user?.id;
  if (!id) throw forbidden("no authenticated platform user on this call");
  return { kind: "wonderful_user", wonderfulUserId: id };
}

export function callerFromTool(ctx: ToolContextLike, key: string, now: number = Date.now()): CallerSource {
  const md = ctx?.metadata?.communication?.metadata ?? {};
  const s = (k: string) => { const v = lookup(md, k); return typeof v === "string" ? v : typeof v === "number" ? String(v) : ""; };
  const uid = s(IDENTITY_KEYS.uid), org = s(IDENTITY_KEYS.org), exp = s(IDENTITY_KEYS.exp), sig = s(IDENTITY_KEYS.sig);
  if (!uid && !org && !exp && !sig) {
    // No signed claim: phone / WhatsApp sessions identify by the platform channel number (REQ-BUD-013).
    const ch = channelNumberFromTool(ctx);
    if (ch) return { kind: "channel_number", ...ch };
  }
  if (!key) throw forbidden("identity verification key missing");
  if (!uid || !org || !exp || !sig) throw forbidden("no signed Merc identity in this session");
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) throw forbidden("session identity expired");
  if (!safeEqual(hmacSha256Hex(key, claimMessage(uid, org, exp)), sig.toLowerCase())) throw forbidden("session identity signature invalid");
  for (const k of PLATFORM_USER_KEYS) {
    const p = s(k);
    if (p && p !== uid) throw forbidden("session user does not match signed identity");
  }
  return { kind: "app_user", appUserId: uid, orgId: org };
}

export function rolePermissions(role: RoleCode): string[] {
  const r = ROLE_PERMISSIONS[role];
  return [...new Set([...r.all, ...Object.values(r.relation).flat()])].sort();
}

const ROLES: readonly RoleCode[] = ["rep", "manager", "admin"];

export async function resolvePrincipal(api: TablesApi, source: CallerSource): Promise<UserPrincipal> {
  const root = createDb(api);
  let user: Row<"app_user"> | null | undefined;
  if (source.kind === "wonderful_user") user = await root.app_user.findOne({ wonderful_user_id: source.wonderfulUserId });
  else if (source.kind === "app_user") user = await root.app_user.get(source.appUserId);
  else {
    const matches = (await root.app_user.all({ phone: source.number }))
      .filter((u) => u.status === "active" && u.phone_channel_enabled !== false);
    if (matches.length !== 1) throw forbidden(matches.length ? "phone number matches more than one Merc user" : "Merc does not know this number");
    user = matches[0];
  }
  if (!user || (source.kind === "app_user" && user.org_id !== source.orgId)) throw forbidden("caller is not a Merc user");
  if (user.status !== "active") throw forbidden("Merc user is not active");
  if (!ROLES.includes(user.role_code as RoleCode)) throw forbidden(`unknown role ${user.role_code}`);
  const role = user.role_code as RoleCode;
  const db = createDb(api, user.org_id);
  const org = await db.organization.get(user.org_id);
  if (!org) throw notFound("organization not found", { org_id: user.org_id });

  const territory_ids = [...new Set((await db.territory_rep.all({ user_id: user.id })).map((r) => r.territory_id))];
  const manager = user.manager_id ? await db.app_user.get(user.manager_id) : null;

  let team_user_ids: string[] = [], team_territory_ids: string[] = [];
  if (role === "manager") {
    const seen = new Set<string>([user.id]);
    let frontier = [user.id];
    for (let depth = 0; depth < 5 && frontier.length; depth++) {
      const next = (await db.app_user.all({ manager_id: frontier })).map((u) => u.id).filter((id) => !seen.has(id));
      next.forEach((id) => seen.add(id));
      team_user_ids.push(...next);
      frontier = next;
    }
    const managed = (await db.territory.all({ manager_id: user.id })).map((t) => t.id);
    const teamTerr = (await db.territory_rep.all({ user_id: team_user_ids })).map((r) => r.territory_id);
    team_territory_ids = [...new Set([...managed, ...teamTerr])];
  }
  return { kind: "user", id: user.id, role, org_id: user.org_id, user, org, manager, territory_ids, team_user_ids, team_territory_ids, permissions: rolePermissions(role) };
}

/**
 * Principal for scheduler/procedure callers of one org: admin-wide scope inside that org, no user row.
 * Only build it from a trusted entry (a cron entry point, or a verified internal call), never from a request field.
 */
export async function systemPrincipal(api: TablesApi, orgId: string, caller: SystemCaller = "scheduler"): Promise<SystemPrincipal> {
  if (!orgId) throw forbidden("system principal needs an org id");
  const org = await createDb(api, orgId).organization.get(orgId);
  if (!org) throw notFound("organization not found", { org_id: orgId });
  return { kind: "system", caller, id: `system:${orgId}`, role: "admin", org_id: orgId, org, user: null, manager: null, territory_ids: [], team_user_ids: [], team_territory_ids: [], permissions: rolePermissions("admin") };
}

export const isSystem = (p: Principal): p is SystemPrincipal => p.kind === "system";
/** The app_user id to store in created_by/requested_by-style columns: null for system callers. */
export const actorUserId = (p: Principal): string | null => (p.kind === "user" ? p.id : null);
/** Narrow to a user principal (functions that only humans may call). */
export function requireUser(p: Principal, what = "this action"): UserPrincipal {
  if (p.kind !== "user") throw forbidden(`${what} needs a signed-in Merc user`);
  return p;
}
/** System callers never send customer messages (contracts README). Call before any external send. */
export function assertNotSystem(p: Principal, what = "customer messages"): void {
  if (p.kind === "system") throw forbidden(`system callers cannot send ${what}`, { caller: p.caller });
}

export const principalFromFunction = (api: TablesApi, context: FunctionContextLike) => resolvePrincipal(api, callerFromFunction(context));
export const principalFromTool = (api: TablesApi, ctx: ToolContextLike, key: string, now?: number) => resolvePrincipal(api, callerFromTool(ctx, key, now));

const userRef = (u: Row<"app_user">) => ({ id: u.id, full_name: u.full_name, role: u.role_code as RoleCode });

/** fn:me response (contracts/functions/me.json). */
export function meResponse(p: UserPrincipal): FunctionResponseMap["me"] {
  return {
    user: userRef(p.user),
    org_id: p.org_id,
    language: p.user.preferred_language || p.org.default_language,
    territory_ids: p.territory_ids,
    manager: p.manager ? userRef(p.manager) : null,
    settings: { briefing_time: p.org.briefing_time, timezone: p.org.timezone, currency: p.org.currency },
    permissions: p.permissions,
  };
}

/** fn:me for a Function context: platform caller -> app_user. */
export async function me(api: TablesApi, context: FunctionContextLike): Promise<FunctionResponseMap["me"]> {
  return meResponse(await principalFromFunction(api, context));
}
