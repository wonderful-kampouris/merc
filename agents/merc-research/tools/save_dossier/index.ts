// Contract: spec/contracts/tools/merc-research/save_dossier.json -> fn:dossier-save (shared handler, system principal).
// inject task_id: research_task_id comes from the task context in code; candidate_id from get_candidate (kv).
import { s, w } from "@wonderful/types/schema";
import { depsOf, saveDossier } from "../../lib/research";

const fact = s.object({
  fact_type: s.enum("product", "brand", "price", "review_theme", "catalog_item", "opening_hours", "size_signal").describe("Kind of fact"),
  value: s.string().describe("The fact, short, as found on the source"),
  source_url: s.string().describe("Exact URL the fact was read from (the shop's site or the registry)"),
  competitor_name: s.string().optional().describe("Competitor brand name when the fact is about a competing supplier brand"),
});

export default w.tool({
  name: "save_dossier",
  description: "Save the dossier for the loaded candidate. Every fact needs the source_url it was read from. Call it exactly once, at the end. With no website, save registry facts only and summary 'no website'.",
  params: s.object({
    candidate_id: s.string().optional().describe("The candidate_id (optional; the loaded candidate is used)"),
    summary: s.string().describe("2-3 sentence summary for a sales rep"),
    price_level: s.enum("low", "mid", "premium").optional().describe("Price level seen on the site"),
    facts: s.array(fact).describe("Sourced facts"),
  }),
  handler: async (ctx, p) => saveDossier(depsOf(ctx), p as any),
});
