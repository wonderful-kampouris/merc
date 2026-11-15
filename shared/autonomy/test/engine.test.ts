import { describe, expect, it } from "vitest";
import { TABLES, createDb, isMercError, principalFromFunction, type Db, type TableName, type UserPrincipal } from "../../core/src/index";
import { FakeTables, seeded, IDS, DEMO_DAY } from "../../core/testing/fake-tables";
import { applySuggested, businessColumns, propose, resolveMode, undo, type Proposal, type Writer } from "../src/index";

const NOW = Date.parse(`${DEMO_DAY}T08:00:00Z`);
const AT = new Date(NOW).toISOString();

async function setup(who: "nikos" | "eleni" | "thanasis" = "nikos") {
  const tables = seeded();
  const db = createDb(tables, IDS.org);
  const me = await principalFromFunction(tables, { metadata: { user: { id: `wuid-${who}` } } });
  return { tables, db, me };
}

/** Every row of every table except ai_action, business columns only, keyed by table and pk. */
async function dump(tables: FakeTables): Promise<string> {
  const all = createDb(tables);
  const out: Record<string, Record<string, unknown>> = {};
  for (const t of Object.keys(TABLES) as TableName[]) {
    if (t === "ai_action") continue;
    const rows = (await (all as any)[t].all({}, { cap: 100000 })) as Record<string, unknown>[];
    out[t] = Object.fromEntries(rows.map((r) => [String(r[TABLES[t].pk]), businessColumns(r)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  }
  return JSON.stringify(out);
}

const first = async <N extends TableName>(db: Db, t: N, where: Record<string, unknown> = {}) => {
  const r = (await (db as any)[t].findOne(where)) as any;
  if (!r) throw new Error(`seed has no ${t} ${JSON.stringify(where)}`);
  return r;
};

type Apply = (w: Writer, db: Db, me: UserPrincipal) => Promise<{ table: string; id: string }>;
/** One realistic write per internal (and draft) action type, on the demo seed. */
const APPLY: Record<string, Apply> = {
  create_note: async (w, _db, me) => ({ table: "activity", id: (await w.insert("activity", { account_id: IDS.miltos, actor_user_id: me.id, activity_type: "note", source: "ai", body: "Ο Μιλτος θελει δειγματα", occurred_at: AT })).id }),
  create_task: async (w, _db, me) => ({ table: "task", id: (await w.insert("task", { account_id: IDS.miltos, owner_id: me.id, title: "Bring samples", is_customer_promise: true, due_at: AT, status: "open", source: "ai" })).id }),
  update_task: async (w, db) => { const t = await first(db, "task", { status: "open" }); await w.update("task", t.id, { status: "done", title: `${t.title} (done)` }); return { table: "task", id: t.id }; },
  create_problem: async (w) => ({ table: "problem", id: (await w.insert("problem", { account_id: IDS.miltos, description: "Late delivery", status: "open" })).id }),
  update_problem: async (w, db) => { const p = await first(db, "problem"); await w.update("problem", p.id, { status: "resolved", resolved_at: AT }); return { table: "problem", id: p.id }; },
  create_deal: async (w, _db, me) => {
    const d = await w.insert("deal", { account_id: IDS.miltos, owner_id: me.id, stage_code: "new", title: "Christmas flour", amount_minor: 120000 });
    await w.insert("deal_stage_history", { deal_id: d.id, from_stage_code: null, to_stage_code: "new", changed_by: me.id, changed_at: AT });
    return { table: "deal", id: d.id };
  },
  update_deal: async (w, db, me) => {
    const d = await first(db, "deal");
    const stages = await db.deal_stage.all();
    const to = stages.find((s) => s.code !== d.stage_code)!.code;
    await w.update("deal", d.id, { stage_code: to, amount_minor: 99900, next_step: "send offer" });
    await w.insert("deal_stage_history", { deal_id: d.id, from_stage_code: d.stage_code, to_stage_code: to, changed_by: me.id, changed_at: AT });
    return { table: "deal", id: d.id };
  },
  create_competitor_signal: async (w, db, me) => {
    const c = await first(db, "competitor");
    return { table: "competitor_signal", id: (await w.insert("competitor_signal", { account_id: IDS.miltos, competitor_id: c.id, reported_by: me.id, statement: "Aroma offered 15% less", price_delta_pct: -15, observed_at: AT })).id };
  },
  update_account: async (w) => { await w.update("account", IDS.miltos, { phone: "+302101234567", email: "info@miltos.test" }); return { table: "account", id: IDS.miltos }; },
  create_contact: async (w) => ({ table: "contact", id: (await w.insert("contact", { account_id: IDS.miltos, full_name: "Μαρία Παπα", is_decision_maker: false })).id }),
  update_contact: async (w, db) => { const c = await first(db, "contact"); await w.update("contact", c.id, { role_title: "Owner", is_decision_maker: !c.is_decision_maker }); return { table: "contact", id: c.id }; },
  mark_visit_done: async (w, db) => { const v = await first(db, "visit", { status: "planned" }); await w.update("visit", v.id, { status: "done", completed_at: AT, outcome: "ok" }); return { table: "visit", id: v.id }; },
  log_campaign_pitch: async (w, db, me) => {
    const c = await first(db, "campaign");
    return { table: "campaign_exposure", id: (await w.insert("campaign_exposure", { campaign_id: c.id, account_id: IDS.miltos, rep_id: me.id, stage: "pitched", evidence_quote: "the new flour", occurred_at: AT })).id };
  },
  reschedule_visit: async (w, db) => { const v = await first(db, "visit", { status: "planned" }); await w.update("visit", v.id, { planned_date: "2026-11-20" }); return { table: "visit", id: v.id }; },
  add_candidate: async (w, _db, me) => ({ table: "account", id: (await w.insert("account", { name: "Φουρνος Χαλανδρι", account_type: "prospect", source: "prospecting", owner_rep_id: me.id, territory_id: IDS.north })).id }),
  discount_within_limit: async (w, _db, me) => {
    const ap = await w.insert("approval", { kind: "discount", requested_by: me.id, approver_id: me.id, mode: "async", status: "approved", decided_by: me.id, decided_at: AT, decision_note: "within limit" });
    return { table: "discount_request", id: (await w.insert("discount_request", { approval_id: ap.id, account_id: IDS.miltos, requested_pct: 5, policy_limit_pct: 8 })).id };
  },
  mark_account_lost: async (w) => { await w.update("account", IDS.miltos, { account_type: "lost" }); return { table: "account", id: IDS.miltos }; },
  create_draft_order: async (w, db, me) => {
    const o = await w.insert("sales_order", { account_id: IDS.miltos, rep_id: me.id, status: "draft", source: "voice", order_date: DEMO_DAY });
    const p = await first(db, "product");
    await w.insert("order_line", { order_id: o.id, line_no: 1, product_id: p.id, quantity: 12, unit_price_minor: p.list_price_minor ?? 100 });
    return { table: "sales_order", id: o.id };
  },
};

const proposal = (code: string, db: Db, me: UserPrincipal, extra: Partial<Proposal> = {}): Proposal =>
  ({ code, agent: "debrief", summary: `test ${code}`, payload: { code }, apply: (w) => APPLY[code]!(w, db, me), ...extra });

describe("resolveMode (REQ-CORE-005)", () => {
  it("reads ai_permission for the role, falls back to action_type.default_mode, destructive is always never", async () => {
    const { db } = await setup();
    expect(await resolveMode(db, "rep", "create_task")).toEqual({ mode: "auto", action_class: "internal", source: "ai_permission" });
    expect(await resolveMode(db, "rep", "send_email")).toMatchObject({ mode: "ask", action_class: "external" });
    const perm = (await db.ai_permission.findOne({ role_code: "rep", action_type_code: "delete_record" }))!;
    await db.ai_permission.update(perm.id, { mode: "auto" });
    expect(await resolveMode(db, "rep", "delete_record")).toEqual({ mode: "never", action_class: "destructive", source: "destructive" });
    for (const p of await db.ai_permission.all({ role_code: "rep", action_type_code: "create_note" })) await db.ai_permission.delete(p.id);
    expect(await resolveMode(db, "rep", "create_note")).toMatchObject({ mode: "auto", source: "default" });
    await expect(resolveMode(db, "rep", "launch_rocket")).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("propose: every seeded action type follows its mode", () => {
  it("covers every seeded action type", async () => {
    const { db } = await setup();
    const codes = (await db.action_type.all()).map((a) => a.code);
    const internal = (await db.action_type.all({ action_class: ["internal", "draft"] })).map((a) => a.code);
    expect(internal.sort()).toEqual(Object.keys(APPLY).sort());
    expect(codes.length).toBeGreaterThan(internal.length);
  });

  it("auto -> writes + applied ai_action with before/after snapshots", async () => {
    const { db, me } = await setup();
    const out = await propose(db, me, proposal("create_task", db, me, { voice_log_id: null }), { now: NOW });
    expect(out).toMatchObject({ mode: "auto", applied: true, approval: null, target: { table: "task" } });
    expect(out.ai_action).toMatchObject({ status: "applied", on_behalf_of: me.id, agent: "debrief", action_type_code: "create_task", target_table: "task", applied_at: AT });
    expect(JSON.parse(out.ai_action.before_snapshot_json!).rows).toEqual([{ table: "task", id: out.target!.id, row: null }]);
    expect(out.line).toMatchObject({ status: "applied", action_class: "internal", undoable: true, approval_id: null, summary: "test create_task" });
    expect(await db.task.get(out.target!.id)).not.toBeNull();
  });

  it("ask -> nothing written, suggested ai_action + pending approval for the manager", async () => {
    const { db, me } = await setup();
    let called = false;
    const out = await propose(db, me, { code: "send_email", agent: "email", summary: "email Miltos", target: { table: "account", id: IDS.miltos }, apply: async () => { called = true; return null; } });
    expect(called).toBe(false);
    expect(out).toMatchObject({ mode: "ask", applied: false });
    expect(out.ai_action.status).toBe("suggested");
    expect(out.approval).toMatchObject({ ai_action_id: out.ai_action.id, kind: "customer_message", status: "pending", requested_by: me.id, approver_id: me.manager!.id });
    expect(out.line).toMatchObject({ status: "suggested", undoable: false, approval_id: out.approval!.id });
  });

  it("no external send happens without an approved approval; it applies once approved", async () => {
    const { db, me } = await setup();
    const out = await propose(db, me, { code: "send_email", agent: "email", summary: "email Miltos", apply: async () => null });
    const send = async (w: Writer) => ({ table: "activity", id: (await w.insert("activity", { account_id: IDS.miltos, actor_user_id: me.id, activity_type: "email", source: "ai", occurred_at: AT })).id });
    await expect(applySuggested(db, out.ai_action.id, send)).rejects.toMatchObject({ code: "blocked_by_policy" });
    await db.approval.update(out.approval!.id, { status: "approved", decided_by: me.manager!.id, decided_at: AT });
    const applied = await applySuggested(db, out.ai_action.id, send, { now: NOW });
    expect(applied).toMatchObject({ status: "applied", target_table: "activity" });
    await expect(applySuggested(db, out.ai_action.id, send)).rejects.toMatchObject({ code: "conflict" });
  });

  it("never / destructive -> suggested only, no approval, apply never called (even if ai_permission says auto)", async () => {
    const { db, me } = await setup();
    const perm = (await db.ai_permission.findOne({ role_code: "rep", action_type_code: "delete_record" }))!;
    await db.ai_permission.update(perm.id, { mode: "auto" });
    let called = false;
    const before = await dump((db as any).api);
    const out = await propose(db, me, { code: "delete_record", agent: "buddy", summary: "delete Miltos", target: { table: "account", id: IDS.miltos }, apply: async () => { called = true; return null; } });
    expect(called).toBe(false);
    expect(out).toMatchObject({ mode: "never", action_class: "destructive", applied: false, approval: null });
    expect(out.ai_action.status).toBe("suggested");
    expect(await dump((db as any).api)).toBe(before);
    await expect(applySuggested(db, out.ai_action.id, async () => null)).rejects.toMatchObject({ code: "blocked_by_policy" });
  });

  it("an internal type switched to never in ai_permission is only suggested", async () => {
    const { db, me } = await setup();
    const perm = (await db.ai_permission.findOne({ role_code: "rep", action_type_code: "create_task" }))!;
    await db.ai_permission.update(perm.id, { mode: "never" });
    const out = await propose(db, me, proposal("create_task", db, me));
    expect(out).toMatchObject({ mode: "never", applied: false });
    expect(await db.task.count({ title: "Bring samples" })).toBe(0);
  });

  it("system callers must name on_behalf_of and use that user's role", async () => {
    const { tables, db } = await setup();
    const { systemPrincipal } = await import("../../core/src/index");
    const sys = await systemPrincipal(tables, IDS.org);
    await expect(propose(db, sys, { code: "mark_account_lost", agent: "lifecycle", summary: "x", apply: async () => null })).rejects.toMatchObject({ code: "validation_failed" });
    const out = await propose(db, sys, { code: "mark_account_lost", agent: "lifecycle", summary: "lost", on_behalf_of: IDS.nikos, role: "rep", apply: async (w) => { await w.update("account", IDS.miltos, { account_type: "lost" }); return { table: "account", id: IDS.miltos }; } });
    expect(out.ai_action).toMatchObject({ status: "applied", on_behalf_of: IDS.nikos, agent: "lifecycle" });
  });
});

describe("undo (REQ-CORE-006): round-trip for every internal action type", () => {
  for (const code of Object.keys(APPLY)) {
    it(`${code}: apply then undo leaves every touched row identical`, async () => {
      const { tables, db, me } = await setup();
      const before = await dump(tables);
      const out = await propose(db, me, proposal(code, db, me), { now: NOW });
      expect(out.applied).toBe(true);
      expect(await dump(tables)).not.toBe(before);
      const r = await undo(db, me, out.ai_action.id, { now: NOW + 1000 });
      expect(r).toEqual({ ai_action_id: out.ai_action.id, status: "undone", restored: out.target });
      expect(await dump(tables)).toBe(before);
      expect(await db.ai_action.get(out.ai_action.id)).toMatchObject({ status: "undone", undone_by: me.id, undone_at: new Date(NOW + 1000).toISOString() });
    });
  }

  it("refuses a second undo, a suggested action, and another rep's action; admin may undo", async () => {
    const { tables, db, me } = await setup();
    const out = await propose(db, me, proposal("create_task", db, me));
    const dimitra = await principalFromFunction(tables, { metadata: { user: { id: "wuid-dimitra" } } });
    await expect(undo(db, dimitra, out.ai_action.id)).rejects.toMatchObject({ code: "forbidden" });
    const admin = await principalFromFunction(tables, { metadata: { user: { id: "wuid-thanasis" } } });
    await undo(db, admin, out.ai_action.id);
    await expect(undo(db, me, out.ai_action.id)).rejects.toMatchObject({ code: "conflict" });
    const sug = await propose(db, me, { code: "send_email", agent: "email", summary: "x", apply: async () => null });
    await expect(undo(db, me, sug.ai_action.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(undo(db, me, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "not_found" });
  });

  it("a row changed after the action is a conflict and nothing is written", async () => {
    const { tables, db, me } = await setup();
    const out = await propose(db, me, proposal("update_account", db, me));
    await db.account.update(IDS.miltos, { phone: "+30999" });
    const mid = await dump(tables);
    const err = await undo(db, me, out.ai_action.id).catch((e) => e);
    expect(isMercError(err) && err.code).toBe("conflict");
    expect(await dump(tables)).toBe(mid);
    expect((await db.ai_action.get(out.ai_action.id))!.status).toBe("applied");
  });

  it("undoes ai_actions written by other handlers in the same snapshot format (account-convert style)", async () => {
    const { tables, db, me } = await setup();
    const before = await dump(tables);
    const acc = (await db.account.get(IDS.miltos))!;
    const upd = await db.account.update(IDS.miltos, { account_type: "lost" });
    const { encode } = await import("../src/snapshot");
    const ai = await db.ai_action.insert({ on_behalf_of: me.id, agent: "lifecycle", action_type_code: "mark_account_lost", target_table: "account", target_id: acc.id, status: "applied", applied_at: AT,
      before_snapshot_json: encode([{ table: "account", id: acc.id, row: { ...acc } }]), after_snapshot_json: encode([{ table: "account", id: acc.id, row: { ...upd } }]) });
    await undo(db, me, ai.id);
    expect(await dump(tables)).toBe(before);
  });
});
