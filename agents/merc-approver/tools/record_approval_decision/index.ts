// Contract: spec/contracts/tools/merc-approver/record_approval_decision.json -> fn:approval-decide.
// inject call_metadata.approval_id, via=phone_call, callee: set in code (lib/approver.ts), never by the model.
// The function enforces REQ-DSC-004 (counter < requested and <= the manager's own limit).
import { s, w } from "@wonderful/types/schema";
import { recordApprovalDecision, type ApproverCtx } from "../../lib/approver";

export default w.tool({
  name: "record_approval_decision",
  description: "Record the manager's decision after you read it back and they confirmed. decision is approve, counter or reject. For counter, approved_pct is the offered % (below the requested %). note is optional and short.",
  params: s.object({
    decision: s.enum("approve", "counter", "reject").describe("approve = the requested %, counter = another lower %, reject = no discount"),
    approved_pct: s.number().optional().describe("Only for counter: the % the manager offers"),
    note: s.string().optional().describe("Optional short reason in the manager's words"),
  }),
  handler: async (ctx, p) => recordApprovalDecision(ctx as unknown as ApproverCtx, p),
});
