// Not a contract tool (added for the pitch): public web research on one shop, see lib/web-research.ts.
// Firecrawl when secret FIRECRAWL_API_KEY exists, keyless web search + fetch otherwise. No CRM data, no identity needed.
import { s, w } from "@wonderful/types/schema";
import { depsOf, researchStore } from "../../lib/web-research";

export default w.tool({
  name: "research_store",
  description: "Look a shop up on the public web (its own website, news, social pages): what they sell, brands, style, hours, recent news. Use for 'what do we know about X online', a prospect with no CRM history, or when the visit card is thin. Not for CRM facts.",
  params: s.object({
    query: s.string().describe("Shop name plus area, e.g. 'Café Miltos Chalandri'"),
    website: s.optional(s.string().describe("The shop's website from the visit card, if any")),
  }),
  handler: async (ctx: any, input: any) => researchStore(depsOf(ctx), input ?? {}),
});
