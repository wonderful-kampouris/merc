import { s, w } from "@wonderful/types/schema";
import { MERC_SPIKE_CORE_VERSION, sumLinesMinor } from "../../shared_lib/utils/merc_spike_core";

// WP-SPK-05 spike: what identity does a V2 tool see, and can it import the shared lib?
const params = s.object({ qty: s.number(), unit_price_minor: s.number() });

export default w.tool({
  name: "merc_spike_whoami",
  description: "Spike only: echo session identity sources and a shared-lib computation.",
  params,
  handler: async (ctx: any, { qty, unit_price_minor }) => {
    const md = ctx?.metadata ?? {};
    const cm = md?.communication?.metadata ?? {};
    return {
      core: MERC_SPIKE_CORE_VERSION,
      total_minor: sumLinesMinor([{ qty, unit_price_minor }]),
      metadata_user: md.user ?? null,
      session_user: typeof ctx?.session?.getUser === "function" ? ctx.session.getUser() : "n/a",
      customer_user_id: cm["wonderful.customer_user.id"] ?? null,
      auth_mode: cm["wonderful.web_sdk.auth_mode"] ?? null,
      context_id: md.contextId ?? null,
      context_type: md.contextType ?? null,
    };
  },
});
