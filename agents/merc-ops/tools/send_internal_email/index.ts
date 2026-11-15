// merc-ops tool send_internal_email -> context.email (spec/contracts/tools/merc-ops/send_internal_email.json).
// Internal recipients only; every number must be in the facts from get_summary_data.
import { s, w } from "@wonderful/types/schema";
import { sendInternalEmail } from "../../lib/ops";

export default w.tool({
  name: "send_internal_email",
  description: "Email the summary to the manager/CEO (internal, no approval needed). Only Merc managers/admins; only numbers from get_summary_data.",
  params: s.object({
    to: s.string(),
    subject: s.string(),
    body: s.string(),
  }),
  handler: async (ctx: any, params) => sendInternalEmail(ctx, params as any),
});
