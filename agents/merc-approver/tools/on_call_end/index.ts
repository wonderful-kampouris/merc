// Trigger tool for the merc-approver contract trigger "OnEnd without decision -> report_call_outcome(failed)".
// No-op when a decision was recorded or the request is already async.
import { s, w } from "@wonderful/types/schema";
import { onCallEnded, type ApproverCtx } from "../../lib/approver";

export default w.tool({
  name: "on_call_end",
  description: "Runs automatically when the call ends. Not for the model.",
  trigger: "OnEnd",
  params: s.object({}),
  handler: async (ctx) => onCallEnded(ctx as unknown as ApproverCtx),
});
