// merc-ops tool deliver_whatsapp -> context.outbound.whatsapp (spec/contracts/tools/merc-ops/deliver_whatsapp.json).
// Sends one relayed buddy_call row; the message text is built in code, never by the model.
import { s, w } from "@wonderful/types/schema";
import { deliverWhatsApp } from "../../lib/ops";

export default w.tool({
  name: "deliver_whatsapp",
  description: "Send the waiting relayed WhatsApp messages (briefs, post-visit prompts, debrief confirmations). Call it with no arguments. Returns each row status (sent, failed or skipped).",
  params: s.object({
    buddy_call_id: s.optional(s.string().describe("Only if TASK_CONTEXT.json has a buddy_call_id; otherwise leave it out")),
  }),
  handler: async (ctx: any, params) => deliverWhatsApp(ctx, params as any),
});
