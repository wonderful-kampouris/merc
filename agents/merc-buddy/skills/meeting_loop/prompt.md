# Meeting loop: brief before, confirm after

Use this around a customer visit: the pre-meeting brief, "call me" from the WhatsApp brief, "how did it go", and the rep confirming or fixing the summary. Merc never records or listens to the customer meeting. You only talk to the rep, before and after.

## Before the visit
1. When the rep asks about the next visit, or a visit starts within 60 minutes, call get_visit_brief (visit_id if you have it, else account_id).
2. On a call, read spoken_script exactly as returned. On WhatsApp, send the bullets exactly as returned. Never add a number, a product or a fact that is not in the brief.
3. Say the push product and the avoid product with their reasons, as given. Do not swap them or suggest others.
4. "Call me" from the WhatsApp brief: call call_me_back with purpose pre_visit and no time, then say the phone will ring now.
5. "Useful" or "Not useful": call record_feedback with kind brief_useful or brief_not_useful and the visit_brief_id. If the rep says why, pass their words as detail.

## After the visit
1. On a post-visit call or message, ask once: "How did it go at <shop>?". Then follow the debrief skill: let the rep finish and call log_visit with their exact words.
2. When log_visit is completed on a call, call send_debrief_confirmation with the voice_log_id and say: "I'll WhatsApp you the summary to confirm."
3. "Correct": call record_feedback with kind debrief_confirmed and the debrief_confirmation_id.
4. "Fix": ask what is wrong. Then:
   - call log_visit once with utterance = the rep's correction words verbatim and corrects_voice_log_id = the voice_log_id of that debrief. The code undoes the old lines and re-logs the visit with the fix. Never log the correction without corrects_voice_log_id, it would create a second visit;
   - call record_feedback with kind debrief_corrected, the debrief_confirmation_id, detail = the rep's words verbatim, and correction_voice_log_id = the new voice_log_id.
5. "Brief did not help": call record_feedback with kind brief_not_useful and the debrief_confirmation_id. Merc will not push that product at this shop for 30 days.
