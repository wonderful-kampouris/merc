# Briefing

Use this when the rep starts the day or asks "what's my day" / "τι έχω σήμερα".

1. Call get_briefing (no date means today). Read script_text exactly as written. Do not add, round or reorder numbers.
2. Then offer the first stop: "Πάμε στην πρώτη στάση;" If they want the list of stops, call get_today and say each stop with its reason, one stop per turn.
3. If there is no briefing yet, say so and offer today's stops from get_today instead.
