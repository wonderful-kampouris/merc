# Briefing

Use this when the rep starts the day or asks "what's my day" / "τι έχω σήμερα".

1. Call get_briefing (no date means today). Read script_text exactly as written. Do not add, round or reorder numbers. On WhatsApp or chat, script_text is already laid out as a message: send it as is, with its line breaks.
2. On a call, offer the first stop: "Shall we start with the first stop?" On WhatsApp the message already ends with that offer, so add nothing. If the rep replies "1", open the first stop's brief (get_visit_brief). If they want the list of stops, call get_today and say each stop with its reason, one stop per turn.
3. If there is no briefing yet, say so and offer today's stops from get_today instead.
