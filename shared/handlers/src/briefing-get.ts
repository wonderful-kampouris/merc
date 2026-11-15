// fn:briefing-get (contracts/functions/briefing-get.json, REQ-BRF-003): the caller's briefing for a date (default:
// today in the org timezone). The buddy reads script_text as is, then offers items[0] (the first stop).
// Missing for today or a future date -> generated on demand with the same builder as the cron; regenerate=true
// rebuilds it in place (same briefing_id). Past dates are never invented.
import { defineFunction, invalid, notFound, today, type Impl } from "../../core/src/index";
import { generateForRep, loadBriefing, type GenerateDeps } from "./briefing-generate";

export function makeImpl(deps: GenerateDeps = {}): Impl<"briefing-get"> {
  return async ({ req, db, me }) => {
    const now = today(me.org, deps.now?.() ?? Date.now());
    const date = req.date ?? now;
    const existing = await loadBriefing(db, me.id, date);
    if (existing && !req.regenerate) return existing;
    if (date < now) {
      if (existing) throw invalid(`only today's or a future briefing can be regenerated, not ${date}`, { date });
      throw notFound(`no briefing for ${date}`, { date });
    }
    return (await generateForRep(db, me.org, me.user, date, deps, { regenerate: !!req.regenerate })).briefing;
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/briefing-get/index.ts calls this). */
export const handle = defineFunction("briefing-get", impl);
