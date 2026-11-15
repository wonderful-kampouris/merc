// merc-ops tool get_summary_data -> fn:summary-data (spec/contracts/tools/merc-ops/get_summary_data.json).
import { s, w } from "@wonderful/types/schema";
import { getSummaryData } from "../../lib/ops";

export default w.tool({
  name: "get_summary_data",
  description: "Facts for the weekly/monthly summary. The ONLY source of numbers for the email. Call it with the kind, scope_user_id, from and to given in the task context.",
  params: s.object({
    kind: s.enum("weekly", "monthly"),
    scope_user_id: s.string(),
    from: s.string(),
    to: s.string(),
  }),
  handler: async (ctx: any, params) => getSummaryData(ctx, params as any),
});
