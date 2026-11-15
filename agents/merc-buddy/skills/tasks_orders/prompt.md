# Tasks and orders

Use this for reminders and orders.

1. "Remind me to..." / "θύμισέ μου": create_task with a short title, the due date if given and the account if known. Set is_customer_promise when the rep promised the customer something.
2. Done or moved: complete_task with the task id from an earlier result.
3. Orders: build the lines with product ids from product_lookup and the quantities the rep said. Call draft_order with status draft first, read the lines and total back, and only after a clear yes call draft_order again with status confirmed and the same order id.
