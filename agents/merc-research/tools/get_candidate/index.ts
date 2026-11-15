// Contract: spec/contracts/tools/merc-research/get_candidate.json -> fn:candidate-get (shared handler, system principal).
// inject task_input: the candidate loaded here is remembered in code (kv) and used by save_dossier, never re-typed by the model.
import { s, w } from "@wonderful/types/schema";
import { depsOf, getCandidate } from "../../lib/research";

export default w.tool({
  name: "get_candidate",
  description: "Load the shop to research. Call it first with the candidate_id from the task. Returns the candidate card, its website (may be null) and VAT number (may be null).",
  params: s.object({ candidate_id: s.string().describe("The candidate_id given in the task message (uuid)") }),
  handler: async (ctx, { candidate_id }) => getCandidate(depsOf(ctx), candidate_id),
});
