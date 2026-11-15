---
name: whatsapp_send
description: Use for every whatsapp_send task - send the waiting relayed WhatsApp messages (pre-visit brief, post-visit prompt, debrief confirmation) with deliver_whatsapp.
---

# WhatsApp send (task type whatsapp_send)

1. Call `deliver_whatsapp` once with no arguments. Only if `/workspace/task/TASK_CONTEXT.json` has a `buddy_call_id`, pass exactly that. Do not write or change any message text.
2. Finish with `task_set_status`:
   - `completed` when every delivered row is `sent` or `skipped`, or when nothing was waiting (another task already sent it).
   - `failed` with the `failure_reason` values when any row is `failed`.
