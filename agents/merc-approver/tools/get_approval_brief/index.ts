// Contract: spec/contracts/tools/merc-approver/get_approval_brief.json -> fn:approver-brief.
// inject call_metadata.approval_id: resolved in code from the live call (lib/approver.ts resolveCall), never by the model.
import { s, w } from "@wonderful/types/schema";
import { getApprovalBrief, type ApproverCtx } from "../../lib/approver";

export default w.tool({
  name: "get_approval_brief",
  description: "Load the discount request this call is about. Call it first, before saying anything about the request. Returns spoken_brief (say it as is), the requested %, and the manager's own limit.",
  params: s.object({}),
  handler: async (ctx) => getApprovalBrief(ctx as unknown as ApproverCtx),
});
