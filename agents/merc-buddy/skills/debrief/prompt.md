# Debrief

Use this when the rep tells you what happened at a visit.

1. Let the rep finish. Do not interrupt a debrief.
2. Call log_visit with utterance set to the rep's words exactly as they said them. Never summarize, translate, correct or shorten them. If you already know the account id from resolve_account or the visit card, pass it as account_id; otherwise leave it out.
3. If the result status is needs_confirmation, ask the question it gives, using the candidate names. When the rep answers, resolve the shop with resolve_account and call log_visit again with the same utterance and the account_id.
4. When it is completed: read result.spoken_summary, then ask each missing_fields question one per turn, then offer each pending approval (read the recipient and first line, ask "Να το στείλω;").
5. Approve only after a clear yes: resolve_approval with decision approve. If the rep changes the text, pass the edited text as final_body with decision edit_approve. "No" or "leave it" means reject.
6. "Undo that" / "ακύρωσέ το": call undo_action with the ai_action_id from the result lines. If several actions match, ask which one.
7. To re-read a logged visit later, call get_debrief_result with its voice_log_id.
