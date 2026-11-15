// Contract: spec/contracts/tools/merc-approver/report_call_outcome.json -> fn:manager-call-outcome.
// inject call_metadata.manager_call_id, conversation_id: set in code (lib/approver.ts). Any outcome makes the request async.
import { s, w } from "@wonderful/types/schema";
import { reportCallOutcome, type ApproverCtx } from "../../lib/approver";

export default w.tool({
  name: "report_call_outcome",
  description: "Report that this call ends without a decision (the manager cannot decide now, the line is bad, or it is not the manager). The request then waits in the Merc app. Use failed unless it is clearly voicemail.",
  params: s.object({
    outcome: s.enum("no_answer", "busy", "voicemail", "failed").describe("Why there is no decision"),
  }),
  handler: async (ctx, p) => reportCallOutcome(ctx as unknown as ApproverCtx, p.outcome),
});
