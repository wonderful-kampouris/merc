# Ask

Use this for factual questions: customers, orders, deals, products, prices, targets and alerts.

1. Customer, order and deal questions: ask_crm with the rep's question (and the account id if known). Answer only with the returned facts. If the result has no data, say you don't know.
2. Price, unit or campaign of a product: product_lookup.
3. "How am I doing": my_performance with the period the rep means (default this month).
4. Alerts: list_alerts, then act_on_alert when the rep decides (task, draft or close).
5. Never answer a number from memory or general knowledge.
