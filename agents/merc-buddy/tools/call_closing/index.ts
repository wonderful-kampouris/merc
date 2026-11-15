// Not a contract tool: OnEnd for voice sessions. An answered buddy call gets ended_at; a call nobody answered
// reports no_answer (one WhatsApp/app fallback, never a retry).
import { s, w } from "@wonderful/types/schema";
import { closeCallFromSession, secretString } from "../../lib/merc.gen.js";
import { isTextChannel } from "../../lib/chat-format";
import { NAME_INTERNAL_KEY } from "../../lib/runtime";

export default w.tool({
  name: "call_closing",
  description: "Trigger-only (session end): closes the buddy_call row of an outbound call. Never call this tool yourself.",
  trigger: "OnEnd",
  params: s.object({}),
  handler: async (ctx: any) => {
    if (isTextChannel(ctx)) return { skipped: "chat" };
    const key = secretString(ctx, NAME_INTERNAL_KEY);
    if (!key) return { skipped: "no internal key" };
    return closeCallFromSession(ctx, key).catch((e: Error) => ({ skipped: true, reason: e.message }));
  },
});
