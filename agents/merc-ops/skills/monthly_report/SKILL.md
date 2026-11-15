---
name: monthly_report
description: Use for every monthly_report task - write and email one admin's monthly report (before/after baseline, CRM completeness, new customers, customers saved) with get_summary_data and send_internal_email.
---

# Monthly report (task type monthly_report)

1. Read `/workspace/task/TASK_CONTEXT.json`. It holds `kind`, `scope_user_id`, `from`, `to` and `recipient` (`name`, `email`, `role`, `language`).
2. Call `get_summary_data` with `kind="monthly"` and exactly that `scope_user_id`, `from` and `to`.
3. Write a plain-text report in the recipient's language (`el` = Greek, `en` = English) for the CEO:
   - Subject: "Merc monthly report <from> to <to>" (translated).
   - **Before / after**: `monthly.before_after.baseline` against `monthly.before_after.after` (visits per day, revenue, new customers) and `monthly.before_after.change_pct`. If `before_after` is null, say the baseline is not set.
   - **CRM completeness**: `monthly.crm_completeness_pct` (say "not measured yet" when null).
   - **New customers**: `monthly.new_customers`. **Customers saved**: `monthly.customers_saved`.
   - **Pipeline**: `deals.won_amount`, `deals.open_amount`, `deals.weighted_pipeline`, `deals.stuck_count`.
4. Call `send_internal_email` with `to` = `recipient.email`.
5. Finish with `task_set_status` `completed`, summarising what was sent (or that sending is off when the tool answers `mode: "log"`).
