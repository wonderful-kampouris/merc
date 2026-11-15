// fn:target-upsert (contracts/functions/target-upsert.json, REQ-TGT-001, gate targets.manage, scope team):
// a manager (or admin) creates or edits a sales target for a rep, a territory or the whole org.
// Exactly one scope (tbl:sales_target): org = both ids null, territory = territory_id only, user = user_id only.
// An overlapping target for the same scope and metric is rejected (conflict). Every write is audited
// (tbl:audit_event action target_change).
import {
  conflict, defineFunction, forbidden, inTeam, invalid, isDate,
  type Db, type Impl, type Row, type UserPrincipal,
} from "../../core/src/index";
import type { FunctionRequestMap } from "../../core/src/generated/contracts/types";

type Req = FunctionRequestMap["target-upsert"];
/** Metrics counted in whole units (revenue in minor units). Volume may be fractional (order line quantity). */
const INTEGER_METRICS = new Set(["revenue", "visits", "new_customers"]);

/** Validate the request shape rules the JSON schema cannot express; returns the normalized scope columns. */
export function parseTarget(req: Req): { territory_id: string | null; user_id: string | null } {
  const errors: string[] = [];
  const territory_id = req.territory_id ?? null, user_id = req.user_id ?? null;
  if (req.scope === "org" && (territory_id || user_id)) errors.push("scope org: territory_id and user_id must be null");
  if (req.scope === "territory" && (!territory_id || user_id)) errors.push("scope territory: territory_id required, user_id must be null");
  if (req.scope === "user" && (!user_id || territory_id)) errors.push("scope user: user_id required, territory_id must be null");
  if (!isDate(req.period_start)) errors.push("period_start: YYYY-MM-DD");
  if (!isDate(req.period_end)) errors.push("period_end: YYYY-MM-DD");
  if (isDate(req.period_start) && isDate(req.period_end) && req.period_start > req.period_end) errors.push("period_start must be on or before period_end");
  if (!Number.isFinite(req.target_value) || req.target_value <= 0) errors.push("target_value: a positive number");
  else if (INTEGER_METRICS.has(req.metric) && !Number.isInteger(req.target_value)) errors.push(`target_value: a whole number for ${req.metric}${req.metric === "revenue" ? " (minor units)" : ""}`);
  if (errors.length) throw invalid(`invalid target: ${errors.slice(0, 3).join("; ")}`, { errors });
  return { territory_id, user_id };
}

/** The caller may set targets for this scope: user in their team, territory they manage; org for any target manager. Admin: anything. */
async function checkScope(db: Db, me: UserPrincipal, s: { territory_id: string | null; user_id: string | null }): Promise<void> {
  if (s.user_id) {
    const u = await db.app_user.get(s.user_id);
    if (!u || u.status !== "active") throw invalid("user_id is not an active user of this organization", { user_id: s.user_id });
    if (me.role !== "admin" && !inTeam(me, s.user_id)) throw forbidden("user is outside your team", { user_id: s.user_id });
  } else if (s.territory_id) {
    const t = await db.territory.get(s.territory_id);
    if (!t) throw invalid("territory_id is not a territory of this organization", { territory_id: s.territory_id });
    if (me.role !== "admin" && !(me.role === "manager" && me.team_territory_ids.includes(s.territory_id))) {
      throw forbidden("territory is outside your team", { territory_id: s.territory_id });
    }
  }
}

/** An existing target of the same scope and metric whose period overlaps [from, to] (excluding `selfId`). */
export async function overlapping(db: Db, s: { territory_id: string | null; user_id: string | null }, metric: Req["metric"], from: string, to: string, selfId: string | null): Promise<Row<"sales_target"> | null> {
  const rows = await db.sales_target.all({ user_id: s.user_id, territory_id: s.territory_id, metric }, {
    and: [{ column: "period_start", operator: "lte", value: to }, { column: "period_end", operator: "gte", value: from }],
  });
  return rows.find((r) => r.id !== selfId && (r.user_id ?? null) === s.user_id && (r.territory_id ?? null) === s.territory_id) ?? null;
}

export interface TargetUpsertDeps { now?: () => number }
export function makeImpl(deps: TargetUpsertDeps = {}): Impl<"target-upsert"> {
  return async ({ req, db, me }) => {
    const scope = parseTarget(req);
    const existing = req.target_id ? await db.sales_target.require(req.target_id) : null;
    if (existing) await checkScope(db, me, { territory_id: existing.territory_id ?? null, user_id: existing.user_id ?? null });
    await checkScope(db, me, scope);

    const clash = await overlapping(db, scope, req.metric, req.period_start, req.period_end, existing?.id ?? null);
    if (clash) {
      throw conflict(`a ${req.metric} target for this ${req.scope} already covers ${clash.period_start}..${clash.period_end}`, {
        target_id: clash.id, period_start: clash.period_start, period_end: clash.period_end,
      });
    }

    const data = { ...scope, metric: req.metric, period_start: req.period_start, period_end: req.period_end, target_value: req.target_value, set_by: me.id };
    const row = existing ? await db.sales_target.update(existing.id, data) : await db.sales_target.insert(data);
    await db.audit_event.insert({
      actor_id: me.id, action: "target_change", target_table: "sales_target", target_id: row.id,
      detail: JSON.stringify({ op: existing ? "update" : "create", scope: req.scope, ...data,
        ...(existing ? { previous: { metric: existing.metric, period_start: existing.period_start, period_end: existing.period_end, target_value: existing.target_value } } : {}) }),
      occurred_at: new Date(deps.now?.() ?? Date.now()).toISOString(),
    });
    return { target_id: row.id };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/target-upsert/index.ts calls this). */
export const handle = defineFunction("target-upsert", impl);
