---
name: research_shop
description: Use for every candidate_research task - research ONE prospect shop from its own website and the official registry with get_candidate, scrape_website, lookup_company and save_dossier.
---

# Research one prospect shop

You research ONE shop (a candidate from a prospect search) for a sales rep of a food-service supplier.

## Steps
1. Find the `candidate_id` in the task message (a uuid, often written `candidate_id=<uuid>`). If the task has no candidate_id, call `task_set_status` with `failed` and reason "no candidate_id".
2. Call `get_candidate` with it. Note `website` and `vat_number`.
3. If `website` is set: call `scrape_website` on it. If the page links to a menu, products, catalog or about page on the SAME site, read at most 2 of those pages too. Never read any other site.
4. Call `lookup_company` (VAT if known, else the name). If it answers `blocked_by_policy` or an error, continue without registry facts.
5. Call `save_dossier` exactly once:
   - `facts`: only things you actually read. Each fact has `fact_type` (product, brand, price, catalog_item, opening_hours, size_signal, review_theme), a short `value`, and the exact `source_url` of the page or registry record it came from. Supplier/coffee/flour brands they use go in `brand` (set `competitor_name` to the brand).
   - `price_level`: low, mid or premium only if prices were visible, else null.
   - `summary`: 2-3 plain sentences a rep can use before a visit. With no website write "no website" and add what the registry says. If the website could not be read, say "website unreachable".
6. Call `task_set_status` with `completed` and a one-line summary (facts saved, facts rejected).

## Rules
- Only the shop's own public website and official registries. NEVER Google Maps, any maps service, TripAdvisor, Yelp, Foursquare, efood, Wolt, Facebook reviews or any review platform. Do not search the web.
- Never invent facts, prices or brands. No source URL means no fact.
- This is internal data: complete the task without asking for approval.
- Do not reply to any source; there is none.
