// fn:settings-get (contracts/functions/settings-get.json, REQ-SET-001): the admin settings screen in one read.
// Gate settings.read (managers read, admins edit through fn:settings-update). Everything is org-scoped by db.
// icp = { min_score, criteria: [{criterion, weight}], categories: [{category_id, name}] }.
import { defineFunction, type Db, type Impl } from "../../core/src/index";

const byKey = <T>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));

export async function readIcp(db: Db, minScore: unknown) {
  const [criteria, cats] = await Promise.all([db.icp_criterion.all(), db.icp_category.all()]);
  const names = new Map((await db.account_category.all()).map((c: any) => [c.id, c.name]));
  return {
    min_score: typeof minScore === "number" ? minScore : null,
    criteria: byKey(criteria, (c) => c.criterion).map((c) => ({ id: c.id, criterion: c.criterion, weight: c.weight })),
    categories: cats.map((c) => ({ id: c.id, category_id: c.category_id, name: names.get(c.category_id) ?? null })),
  };
}

export const impl: Impl<"settings-get"> = async ({ db, me }) => {
  const [perms, rules, policies] = await Promise.all([db.ai_permission.all(), db.alert_rule.all(), db.discount_policy.all()]);
  const { created_at, updated_at, ...organization } = me.org as any;
  return {
    organization,
    ai_permissions: byKey(perms, (p) => `${p.role_code}|${p.action_type_code}`).map(({ created_at: _c, updated_at: _u, ...p }: any) => p),
    alert_rules: byKey(rules, (r) => r.alert_type_code).map(({ created_at: _c, updated_at: _u, ...r }: any) => r),
    icp: await readIcp(db, (me.org as any).icp_min_score),
    discount_policies: policies.map(({ created_at: _c, updated_at: _u, ...p }: any) => p),
  };
};

/** Wonderful Function entry (functions/settings-get/index.ts calls this). */
export const handle = defineFunction("settings-get", impl);
