---
name: weekly_summary
description: Use for every weekly_summary task - write and email one manager's or admin's weekly sales summary (what closed, what got stuck, what is coming) with get_summary_data and send_internal_email.
---

# Weekly summary (task type weekly_summary)

1. Read `/workspace/task/TASK_CONTEXT.json`. It holds `kind`, `scope_user_id`, `from`, `to` and `recipient` (`name`, `email`, `role`, `language`).
2. Call `get_summary_data` with `kind="weekly"` and exactly that `scope_user_id`, `from` and `to`.
3. Write a short plain-text email in the recipient's language (`el` = Greek, `en` = English), for a busy sales manager:
   - Subject: "Merc weekly summary <from> to <to>" (translated).
   - **What closed**: `deals.won_count`, `deals.won_amount` and the won deals; `kpi.visits_done`, `kpi.new_customers`, `kpi.revenue`.
   - **What got stuck**: `deals.stuck_count` and the stuck deals (title, account, owner, amount, days without activity); open alerts from `alerts.open_count` / `alerts.open_by_type`.
   - **What's coming**: `deals.coming_count` and the deals expected to close until `deals.coming_until`; target progress from `targets` (pct).
   - One line per rep from `per_rep` if there is more than one rep.
4. Call `send_internal_email` with `to` = `recipient.email`.
5. Finish with `task_set_status` `completed`, summarising what was sent (or that sending is off when the tool answers `mode: "log"`).
