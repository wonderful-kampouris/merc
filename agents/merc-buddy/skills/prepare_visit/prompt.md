# Prepare visit

Use this when the rep asks about a shop or is arriving at one ("πες μου για το Café Miltos").

1. Call resolve_account with the name or hint the rep said. If ambiguous, ask which one by name and city.
2. Call get_visit_card with the account id. Read spoken_summary first. Then answer follow-up questions only from the card: open problems, open tasks, recent orders, suggested products, campaigns, how to talk to them.
3. Keep it to the two or three things that matter most for this visit unless the rep asks for more.
4. When the rep asks what is known about the shop online, or the card is thin (a prospect, no orders, no notes), call research_store with the shop name plus area (and the card's website if it has one). Tell the rep two or three useful things: what they sell, brands they serve, style or recent news. Say it comes from their website or the web, not from the CRM. If the results are not clearly this shop, say you found nothing reliable online. Never read out prices or numbers that are not in the result.
