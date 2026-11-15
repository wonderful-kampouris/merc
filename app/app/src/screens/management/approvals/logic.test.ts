import { describe, expect, it } from "vitest";
import { mockResult, validateRequest, type ApprovalCard } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { findScreen } from "../../../lib/routes";
import { afterDecision, canCounter, decideRequest, dueState, isOpen, pct, sortApprovals, suggestedCounter, upsert, validateCounter, visible } from "./logic";

const base = mockResult("manager-approvals-list").items[0]!;
const card = (o: Partial<ApprovalCard>): ApprovalCard => ({ ...base, kind: "discount", status: "pending", mode: "async", requested_pct: 8, policy_limit_pct: 5, ...o });
const NOW = new Date("2026-11-16T10:00:00Z");

describe("approvals logic", () => {
  it("counter must be below the request (REQ-DSC-004: 9% on an 8% request is refused)", () => {
    const a = card({ requested_pct: 8 });
    expect(validateCounter(9, a)).toBe("not_below_request");
    expect(validateCounter(8, a)).toBe("not_below_request");
    expect(validateCounter(6, a)).toBeNull();
    expect(validateCounter(0, a)).toBe("not_positive");
    expect(validateCounter(null, a)).toBe("required");
  });

  it("suggests a counter between the rep limit and the request, rounded to 0.5", () => {
    expect(suggestedCounter(card({ requested_pct: 8, policy_limit_pct: 5 }))).toBe(6.5);
    expect(suggestedCounter(card({ requested_pct: 1, policy_limit_pct: 1 }))).toBe(0.5);
    expect(suggestedCounter(card({ requested_pct: null }))).toBeNull();
  });

  it("only discounts can be countered", () => {
    expect(canCounter(card({}))).toBe(true);
    expect(canCounter(card({ kind: "customer_message" }))).toBe(false);
  });

  it("builds a contract-valid approval-decide body for every decision, via app", () => {
    for (const [d, o] of [["approve", {}], ["reject", { note: "  " }], ["counter", { pct: 6, note: "Max 6% this month" }]] as const) {
      const body = decideRequest(base, d, o);
      expect(body.via).toBe("app");
      expect(validateRequest("approval-decide", body).ok).toBe(true);
    }
    expect(decideRequest(base, "counter", { pct: 6 }).approved_pct).toBe(6);
    expect(decideRequest(base, "approve", { pct: 6 })).not.toHaveProperty("approved_pct");
    expect(decideRequest(base, "reject", { note: "  " })).not.toHaveProperty("note");
  });

  it("due state follows metrics.md#approval-sla", () => {
    expect(dueState(card({ due_at: "2026-11-16T09:50:00Z" }), NOW)).toBe("overdue");
    expect(dueState(card({ due_at: "2026-11-16T10:10:00Z" }), NOW)).toBe("soon");
    expect(dueState(card({ due_at: "2026-11-16T12:00:00Z" }), NOW)).toBe("ok");
    expect(dueState(card({ due_at: "2026-11-16T09:50:00Z", status: "approved" }), NOW)).toBe("none");
  });

  it("sorts open, then live calls, then soonest due", () => {
    const a = card({ approval_id: "a", status: "approved" });
    const b = card({ approval_id: "b", mode: "async", due_at: "2026-11-16T11:00:00Z" });
    const c = card({ approval_id: "c", mode: "live", due_at: "2026-11-16T12:00:00Z" });
    const d = card({ approval_id: "d", mode: "async", due_at: "2026-11-16T10:30:00Z" });
    expect(sortApprovals([a, b, c, d]).map((x) => x.approval_id)).toEqual(["c", "d", "b", "a"]);
    expect(visible([a, b], "pending").map((x) => x.approval_id)).toEqual(["b"]);
    expect(visible([a, b], "all")).toHaveLength(2);
    expect(isOpen(card({ status: "escalated" }))).toBe(true);
  });

  it("after a decision: the returned card wins, else the local card is patched", () => {
    const local = card({ approval_id: "x" });
    expect(afterDecision(local, "counter", undefined, 6)).toMatchObject({ status: "countered", approved_pct: 6 });
    expect(afterDecision(local, "approve", card({ approval_id: "other" }))).toMatchObject({ approval_id: "x", status: "approved", approved_pct: 8 });
    const ret = card({ approval_id: "x", status: "countered", approved_pct: 6.5 });
    expect(afterDecision(local, "counter", ret, 6)).toBe(ret);
  });

  it("upserts by id (approval.created events)", () => {
    const x = card({ approval_id: "x" });
    expect(upsert([], x)).toEqual([x]);
    expect(upsert([x], { ...x, status: "approved" })[0]!.status).toBe("approved");
  });

  it("formats percentages per language", () => {
    expect(pct(6.5, "el")).toBe("6,5%");
    expect(pct(6.5, "en")).toBe("6.5%");
    expect(pct(null, "en")).toBe("–");
  });

  it("the screen calls only its app.json functions, and works in mock mode", async () => {
    const screen = findScreen("/mgmt/approvals")!;
    expect(screen.functions).toEqual(["manager-approvals-list", "approval-decide"]);
    expect(screen.mobile).toBe(true);
    const client = createClient({ mock: true, invoker: { invokeFunction: () => Promise.reject(new Error("no platform")) } }).forScreen(screen.functions);
    const list = await client.call("manager-approvals-list", { status: "pending" });
    expect(list.items.length).toBeGreaterThan(0);
    const res = await client.call("approval-decide", decideRequest(list.items[0]!, "counter", { pct: 0.5 }));
    expect(typeof res.requester_notified).toBe("boolean");
    await expect(client.call("approvals-list", {})).rejects.toMatchObject({ code: "forbidden" });
  });
});
