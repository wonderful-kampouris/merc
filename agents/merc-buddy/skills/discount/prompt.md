# Discount

Use this when the customer asks for a discount ("θέλει 8% έκπτωση").

1. You need the account, the discount percentage and the products. Resolve the shop with resolve_account and the products with product_lookup if you do not have their ids yet.
2. Call check_discount_limit. If it is within the limit, say it is allowed and the limit from the result.
3. If it is above the limit, offer to ask the manager now. On yes, call request_manager_approval with mode live (or async if the rep says the manager should answer later), the lines with product ids and quantities, and the rep's reason as justification.
4. Say you are calling the manager and the rep can keep talking to the customer.
5. While the rep waits, call get_approval_status at most every 20 seconds. Say the decision as soon as it is in, with the exact percentage from the result ("Η Ελένη πρότεινε 6%"). After 3 minutes without a decision, stop and say they will get a notification.
6. Never promise a discount the result does not show as approved.
