// fn:feedback-record (contracts/functions/feedback-record.json, REQ-MTG-007 / REQ-MTG-008).
// The rep's reaction to a pre-meeting brief or to a debrief confirmation, stored as one rep_feedback row.
// - brief_useful / brief_not_useful set visit_brief.rating and copy the brief's push product, so the
//   not-repeat rule in metrics.md#visit-brief-hints (30 days, per account) can skip it next time.
//   The "Brief did not help" button on a debrief confirmation passes only debrief_confirmation_id; the brief is
//   then found through the confirmation's visit.
// - debrief_confirmed / debrief_corrected set the confirmation status. A correction keeps the rep's words verbatim
//   and links the follow-up debrief that carried the fix (the buddy undoes and re-logs before calling this).
// Only the owner rep (admin sees all), REQ-CORE-009.
import { assertOwner, defineFunction, invalid, notFound, type Db, type Impl, type Row } from "../../core/src/index";

export interface FeedbackDeps { now?: () => number }

const briefOfConfirmation = async (db: Db, dc: Row<"debrief_confirmation">): Promise<Row<"visit_brief"> | null> =>
  dc.visit_id ? db.visit_brief.findOne({ visit_id: dc.visit_id }) : null;

export function makeImpl(deps: FeedbackDeps = {}): Impl<"feedback-record"> {
  return async ({ req, db, me }) => {
    const at = new Date(deps.now?.() ?? Date.now()).toISOString();
    const detail = req.detail?.trim() || null;

    if (req.kind === "brief_useful" || req.kind === "brief_not_useful") {
      if (!req.visit_brief_id && !req.debrief_confirmation_id) throw invalid("brief feedback needs visit_brief_id (or the debrief_confirmation_id of that visit)");
      let brief: Row<"visit_brief"> | null = null;
      if (req.visit_brief_id) brief = await db.visit_brief.get(req.visit_brief_id);
      else {
        const dc = await db.debrief_confirmation.require(req.debrief_confirmation_id!);
        assertOwner(me, dc.rep_id, "debrief confirmation");
        brief = await briefOfConfirmation(db, dc);
      }
      if (!brief) throw notFound("no pre-meeting brief found for this feedback", { visit_brief_id: req.visit_brief_id ?? null, debrief_confirmation_id: req.debrief_confirmation_id ?? null });
      assertOwner(me, brief.rep_id, "visit brief");
      const rating = req.kind === "brief_useful" ? "useful" : "not_useful";
      await db.visit_brief.update(brief.id, { rating });
      const fb = await db.rep_feedback.insert({
        rep_id: brief.rep_id, account_id: brief.account_id, kind: req.kind, visit_brief_id: brief.id,
        debrief_confirmation_id: req.debrief_confirmation_id ?? null, product_id: brief.push_product_id ?? null, detail, exported_to_evals: false,
      });
      return { feedback_id: fb.id, status: rating };
    }

    if (!req.debrief_confirmation_id && req.kind === "debrief_corrected" && req.correction_voice_log_id) {
      // Fix said in a call or chat, no WhatsApp confirmation to close: one feedback row on the corrected debrief.
      if (!detail) throw invalid("say what was wrong: detail is required for debrief_corrected");
      const fix = await db.voice_log.require(req.correction_voice_log_id);
      assertOwner(me, fix.rep_id, "voice log");
      const fb = await db.rep_feedback.insert({
        rep_id: fix.rep_id, account_id: fix.account_id ?? null, kind: req.kind, visit_brief_id: null,
        debrief_confirmation_id: null, product_id: null, detail, exported_to_evals: false,
      });
      return { feedback_id: fb.id, status: "corrected" };
    }
    if (!req.debrief_confirmation_id) throw invalid(`${req.kind} needs debrief_confirmation_id`);
    const dc = await db.debrief_confirmation.require(req.debrief_confirmation_id);
    assertOwner(me, dc.rep_id, "debrief confirmation");
    if (req.kind === "debrief_corrected" && !detail) throw invalid("say what was wrong: detail is required for debrief_corrected");
    if (req.correction_voice_log_id) {
      const fix = await db.voice_log.require(req.correction_voice_log_id);
      assertOwner(me, fix.rep_id, "voice log");
    }
    const status = req.kind === "debrief_confirmed" ? "confirmed" : "corrected";
    await db.debrief_confirmation.update(dc.id, {
      status, reply_text: detail ?? (status === "confirmed" ? "Correct" : null), replied_at: at,
      ...(req.correction_voice_log_id ? { correction_voice_log_id: req.correction_voice_log_id } : {}),
    });
    const [vl, brief] = await Promise.all([db.voice_log.get(dc.voice_log_id), briefOfConfirmation(db, dc)]);
    const fb = await db.rep_feedback.insert({
      rep_id: dc.rep_id, account_id: vl?.account_id ?? brief?.account_id ?? null, kind: req.kind, visit_brief_id: brief?.id ?? null,
      debrief_confirmation_id: dc.id, product_id: null, detail, exported_to_evals: false,
    });
    return { feedback_id: fb.id, status };
  };
}

export const impl = makeImpl();
export const handle = defineFunction("feedback-record", impl);
