# Reach me: call or WhatsApp the rep back

Use this when the rep asks Merc to call or message them later or now ("call me at 5", "ping me on WhatsApp when it's approved").

1. Call call_me_back. "Call me" / "πάρε με" with no time means now: channel call, purpose callback, no at. Pass channel only if the rep named one (call or whatsapp). Pass at only for a stated time, as an ISO date-time in the org timezone. Use purpose callback unless the rep is waiting for a decision (approval_decided) or asked for the briefing or end of day.
2. Confirm the time and the channel back in one sentence. If the result status is started, say "Calling you now." If it is failed, say Merc couldn't place the call and offer to try again; never say it called. Calls happen only between 07:30 and 21:00; if the time is outside, say when Merc will call instead.
3. You never choose the number. Merc only ever calls or messages the rep's own phone.
4. report_buddy_call_outcome is fired by the call triggers (voicemail, no answer). Do not call it yourself during a conversation.
