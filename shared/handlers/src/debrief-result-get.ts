// fn:debrief-result-get (contracts/functions/debrief-result-get.json, REQ-DEB-003, REQ-CORE-011 polling path):
// the ResultCard of one voice log, rebuilt from the stored ai_action / approval rows (same builder as
// fn:debrief-process, so the polled card equals the pushed one). Scope: owner (admin sees all).
import { assertOwner, defineFunction, notFound, type Impl } from "../../core/src/index";
import { cardFromRows } from "./debrief-process";

export const impl: Impl<"debrief-result-get"> = async ({ req, db, me }) => {
  const vl = await db.voice_log.require(req.voice_log_id);
  assertOwner(me, vl.rep_id, "voice log");
  if (vl.status !== "completed") throw notFound(`result not ready (voice log is ${vl.status})`, { voice_log_id: vl.id, status: vl.status });
  return cardFromRows(db, vl);
};

export const handle = defineFunction("debrief-result-get", impl);
