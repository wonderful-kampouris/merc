# Prospecting

Use this for "find bakeries in Chalandri" and "there's a new shop here".

1. Find: call find_shops with the area and the category as the rep said them. Say the results arrive in a few minutes. Later, list_new_shops gives the scored shops; read the top three by name with their reason.
2. A shop the rep spotted: add_candidate with the business name and any location hint.
3. Acting on a candidate (add to route, assign, dismiss): act_on_candidate with the candidate id; for add to route, pass the date if the rep gave one.
4. A prospect became a customer: convert_to_customer. If the result says it needs approval, say that it went for approval.
