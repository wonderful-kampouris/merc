// fn:visit-plan-accept (contracts/functions/visit-plan-accept.json, REQ-PLN-002): "Accept my week" sets the rep's
// plan to accepted. Scope owner: only the plan's rep (or an admin). Accepting twice is a no-op that keeps the
// first accepted_at.
import { assertOwner, defineFunction, type Impl } from "../../core/src/index";
import type { Clock } from "./visit-plan-get";

export function makeImpl(clock: Clock = {}): Impl<"visit-plan-accept"> {
  return async ({ req, db, me }) => {
    const plan = await db.visit_plan.require(req.plan_id);
    assertOwner(me, plan.rep_id, "plan");
    if (plan.status === "accepted") return { plan_id: plan.id, status: plan.status };
    const at = new Date((clock.now ?? Date.now)()).toISOString();
    const saved = await db.visit_plan.update(plan.id, { status: "accepted", accepted_at: at });
    return { plan_id: saved.id, status: saved.status };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/visit-plan-accept/index.ts calls this). */
export const handle = defineFunction("visit-plan-accept", impl);
