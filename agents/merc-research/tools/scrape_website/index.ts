// Contract: spec/contracts/tools/merc-research/scrape_website.json (integration:firecrawl.scrape).
// Plain fetch + HTML->text (spike S6), Firecrawl when secret FIRECRAWL_API_KEY exists. Only the candidate's own site;
// maps and review platforms are refused (REQ-PRS-005, same rule as fn:dossier-save).
import { s, w } from "@wonderful/types/schema";
import { depsOf, scrapeWebsite } from "../../lib/research";

export default w.tool({
  name: "scrape_website",
  description: "Read a page of the shop's own public website (menu, catalog, brands, prices, opening hours). Only the candidate's website and its sub-pages; never maps or review sites. Returns content and the source_url to cite.",
  params: s.object({ url: s.string().describe("Full http(s) URL on the shop's own website") }),
  handler: async (ctx, { url }) => scrapeWebsite(depsOf(ctx), url),
});
