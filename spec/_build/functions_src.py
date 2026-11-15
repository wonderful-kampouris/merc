"""Merc API: every Wonderful Function (HTTP, cron, WebSocket). Source of spec/contracts/functions/*.json.
Common rules (SPEC CORE):
- Caller identity is never a request field. It comes from the platform (app session / tool session metadata)
  and is resolved to app_user by shared `me()`.
- Every response is wrapped by the platform as {"result": <response>, "logs": [...]}; schemas below describe <response>.
- Errors: HTTP 4xx/5xx with body {"error": $Error}.
"""
from dsl import Fn

DEFS = {
    "Error": {"code": "e:not_found|forbidden|validation_failed|needs_confirmation|conflict|upstream_failed|timeout|blocked_by_policy",
              "message": "str", "details": "obj?"},
    "AccountRef": {"id": "uuid", "name": "str", "account_type": "e:prospect|customer|lost",
                   "postal_code": "str?", "city": "str?", "distance_m": "num?", "reason": "str?"},
    "ActionLine": {"ai_action_id": "uuid", "action_type": "str", "action_class": "e:internal|draft|external|structural|destructive",
                   "status": "e:suggested|applied|undone|rejected", "summary": "str", "target_table": "str?",
                   "target_id": "str?", "undoable": "bool", "approval_id": "uuid?"},
    "MissingField": {"field": "str", "question": "str"},
    "ApprovalCard": {"approval_id": "uuid", "kind": "e:customer_message|discount|terms|conversion",
                     "status": "e:pending|approved|countered|sent|failed|rejected|expired|escalated",
                     "mode": "e:live|async", "account": "$AccountRef?", "requested_by": "$UserRef",
                     "approver": "$UserRef", "preview": "str", "channel": "str?", "recipient": "str?",
                     "subject": "str?", "body": "str?", "requested_pct": "num?", "policy_limit_pct": "num?",
                     "approved_pct": "num?", "decision_note": "str?", "due_at": "datetime?", "expires_at": "datetime?",
                     "created_at": "datetime"},
    "UserRef": {"id": "uuid", "full_name": "str", "role": "e:rep|manager|admin"},
    "ResultCard": {"voice_log_id": "uuid", "account": "$AccountRef", "lines": ["$ActionLine"],
                   "missing_fields": ["$MissingField"], "pending_approvals": ["$ApprovalCard"],
                   "spoken_summary": "str", "processing_ms": "int"},
    "VisitSummary": {"visit_id": "uuid", "account": "$AccountRef", "planned_date": "date", "route_position": "int?",
                     "status": "e:planned|done|skipped", "purpose": "str?", "reason": "str?", "lat": "num?", "lng": "num?"},
    "BriefingItem": {"position": "int", "item_type": "str", "display_text": "str", "ref_table": "str?", "ref_id": "str?"},
    "Briefing": {"briefing_id": "uuid", "date": "date", "status": "e:generated|delivered|read",
                 "script_text": "str", "items": ["$BriefingItem"]},
    "OrderSummary": {"order_id": "uuid", "order_date": "date", "status": "e:draft|confirmed|cancelled",
                     "total_minor": "int", "lines": [{"product_id": "uuid", "name": "str", "quantity": "num", "unit": "str"}]},
    "Pitch": {"opening_line": "str", "arguments": ["str"], "products": [{"product_id": "uuid", "name": "str", "why": "str"}],
              "objections": [{"objection": "str", "answer": "str"}]},
    "DossierView": {"summary": "str?", "price_level": "e:low|mid|premium?",
                    "facts": [{"fact_type": "str", "value": "str", "source_url": "str", "retrieved_at": "datetime"}],
                    "competitor_brands": ["str"]},
    "VisitCard": {"kind": "e:customer|prospect", "account": "$AccountRef",
                  "contacts": [{"contact_id": "uuid", "full_name": "str", "role_title": "str?", "is_decision_maker": "bool", "phone": "str?"}],
                  "open_problems": [{"problem_id": "uuid", "description": "str", "status": "str", "due_date": "date?"}],
                  "open_tasks": [{"task_id": "uuid", "title": "str", "due_at": "datetime?", "is_customer_promise": "bool"}],
                  "recent_orders": ["$OrderSummary"],
                  "metrics": {"avg_order_interval_days": "num?", "days_since_last_order": "num?", "risk_score": "num?",
                              "risk_reasons": ["str"]},
                  "alerts": [{"alert_id": "uuid", "type": "str", "message": "str"}],
                  "suggested_products": [{"product_id": "uuid", "name": "str", "why": "str"}],
                  "campaigns": [{"campaign_id": "uuid", "title": "str", "message": "str"}],
                  "how_to_talk": "str?", "dossier": "$DossierView?", "pitch": "$Pitch?",
                  "spoken_summary": "str"},
    "VisitBrief": {"visit_brief_id": "uuid", "visit": "$VisitSummary", "planned_start_at": "datetime?",
                   "bullets": [{"text": "str", "ref_table": "str?", "ref_id": "str?"}],
                   "push": {"product_id": "uuid", "name": "str", "reason": "str"}, "avoid": {"product_id": "uuid", "name": "str", "reason": "str"},
                   "spoken_script": "str", "status": "e:generated|sent|called|failed|skipped", "channel": "e:whatsapp|call|app?"},
    "AlertCard": {"alert_id": "uuid", "type": "str", "severity": "e:low|medium|high", "status": "e:open|done|dismissed",
                  "message": "str", "account": "$AccountRef?", "suggested_action": "str?", "created_at": "datetime"},
    "CandidateCard": {"candidate_id": "uuid", "business_name": "str", "status": "str", "postal_code": "str?",
                      "website": "str?", "score": "num?", "reasons": ["str"], "dossier": "$DossierView?",
                      "duplicate_of": "$AccountRef?", "assigned_rep": "$UserRef?"},
    "TargetProgress": {"target_id": "uuid", "metric": "e:revenue|volume|visits|new_customers", "period_start": "date",
                       "period_end": "date", "target_value": "num", "actual_value": "num", "pct": "num",
                       "days_left": "int"},
    "Page": {"page": "int", "limit": "int", "total": "int"},
    "KpiSet": {"visits_per_rep_day": "num", "pipeline_by_stage": [{"stage_code": "str", "amount_minor": "int", "count": "int"}],
               "weighted_pipeline_minor": "int", "revenue_minor": "int", "new_customers": "int", "at_risk_customers": "int",
               "at_risk_value_minor": "int", "customers_saved": "int", "lost_customers": "int",
               "crm_completeness_pct": "num", "voice_logs_per_rep_day": "num", "voice_logs_within_1h_pct": "num",
               "ai_actions_applied": "int", "ai_actions_undone": "int", "approvals_approved": "int", "approvals_rejected": "int",
               "discount_requests": "int", "discounts_approved": "int", "targets": ["$TargetProgress"],
               "baseline": "obj?"},
}

PAGE_REQ = {"page": "int?", "limit": "int?"}

F = []
def fn(*a, **k):
    F.append(Fn(*a, **k))

# ---------------------------------------------------------------- identity & today
fn("me", "GET", None, ["app"], {}, {"user": "$UserRef", "org_id": "uuid", "language": "str", "territory_ids": ["uuid"],
   "manager": "$UserRef?", "settings": {"briefing_time": "str", "timezone": "str", "currency": "str"},
   "permissions": ["str"]}, reads=["app_user", "territory_rep", "organization"], wave=1)
fn("today-get", "GET", "plan.read", ["app", "buddy"], {"date": "date?"},
   {"date": "date", "visits": ["$VisitSummary"], "briefing_id": "uuid?", "pending_recordings_hint": "int"},
   reads=["visit", "account", "briefing"])
fn("briefing-get", "GET", "plan.read", ["app", "buddy"], {"date": "date?", "regenerate": "bool?"}, "$Briefing",
   reads=["briefing", "briefing_item"], writes=["briefing", "briefing_item"], llm=["briefing_script"], timeout_ms=45000)
fn("eod-summary", "GET", "plan.read", ["app", "buddy"], {"date": "date?"},
   {"date": "date", "visits_done": "int", "offers_sent": "int", "new_customers": "int", "pending": ["str"],
    "tomorrow_start_with": "str?", "learned": "str?", "target_progress": ["$TargetProgress"], "spoken_summary": "str"},
   reads=["visit", "activity", "approval", "task", "sales_target"], llm=["eod_summary"], priority="P1", wave=3)

# ---------------------------------------------------------------- accounts & CRM CRUD
fn("visit-card-get", "GET", "accounts.read", ["app", "buddy"], {"account_id": "uuid"}, "$VisitCard",
   reads=["account", "contact", "problem", "task", "sales_order", "order_line", "account_metrics", "alert", "campaign",
          "campaign_product", "dossier", "dossier_fact", "product"], writes=["campaign_exposure"],
   llm=["visit_card_pitch"], scope="account", timeout_ms=40000)
fn("account-resolve", "GET", "accounts.read", ["buddy", "app"], {"hint": "str?", "lat": "num?", "lng": "num?"},
   {"status": "e:resolved|ambiguous|not_found", "account": "$AccountRef?", "candidates": ["$AccountRef"]},
   reads=["account", "visit", "postal_area"], scope="account",
   notes="Order of evidence: exact/fuzzy name in rep scope -> today's scheduled visits -> nearest (lat/lng, never stored).")
fn("accounts-list", "GET", "accounts.read", ["app"],
   {"q": "str?", "account_type": "e:prospect|customer|lost?", "territory_id": "uuid?", "owner_id": "uuid?",
    "at_risk": "bool?", **PAGE_REQ}, {"items": ["$AccountRef"], "page": "$Page"}, reads=["account", "account_metrics"], scope="account")
fn("account-get", "GET", "accounts.read", ["app"], {"account_id": "uuid"},
   {"account": "obj", "contacts": ["obj"], "deals": ["obj"], "activities": ["obj"]}, reads=["account", "contact", "deal", "activity"], scope="account")
fn("account-upsert", "POST", "accounts.write", ["app"], {"account_id": "uuid?", "fields": "obj"},
   {"account_id": "uuid", "audit": "str?"}, writes=["account"], scope="account",
   notes="Human edit. account_type changes to/from customer go through account-convert.")
fn("contact-upsert", "POST", "accounts.write", ["app"], {"contact_id": "uuid?", "account_id": "uuid", "fields": "obj"},
   {"contact_id": "uuid"}, writes=["contact"], scope="account")
fn("deal-upsert", "POST", "deals.write", ["app"], {"deal_id": "uuid?", "account_id": "uuid", "fields": "obj"},
   {"deal_id": "uuid"}, writes=["deal", "deal_stage_history"], scope="account")
fn("deals-list", "GET", "deals.read", ["app"], {"owner_id": "uuid?", "stage_code": "str?", "account_id": "uuid?", **PAGE_REQ},
   {"items": ["obj"], "page": "$Page"}, reads=["deal"], scope="account")
fn("order-upsert", "POST", "orders.write", ["app", "buddy"],
   {"order_id": "uuid?", "account_id": "uuid", "status": "e:draft|confirmed|cancelled",
    "lines": [{"product_id": "uuid", "quantity": "num", "unit_price_minor": "int?", "discount_pct": "num?"}]},
   {"order": "$OrderSummary"}, writes=["sales_order", "order_line"], scope="account",
   notes="Confirming requires the rep's explicit confirmation (draft -> confirmed). Prices default to list price; discount_pct above the rep limit is rejected unless an approved discount_request exists.")
fn("orders-list", "GET", "orders.read", ["app"], {"account_id": "uuid?", "rep_id": "uuid?", "from": "date?", "to": "date?", **PAGE_REQ},
   {"items": ["$OrderSummary"], "page": "$Page"}, reads=["sales_order", "order_line"], scope="account")
fn("task-create", "POST", "tasks.create", ["app", "buddy"],
   {"title": "str", "due_at": "datetime?", "account_id": "uuid?", "deal_id": "uuid?", "is_customer_promise": "bool?"},
   {"task_id": "uuid", "ai_action_id": "uuid?"}, writes=["task", "ai_action"])
fn("tasks-list", "GET", "tasks.read", ["app", "buddy"], {"status": "e:open|done|cancelled?", "owner_id": "uuid?", "due_before": "datetime?", **PAGE_REQ},
   {"items": ["obj"], "page": "$Page"}, reads=["task"], scope="owner_or_team")
fn("task-update", "POST", "tasks.create", ["app", "buddy"], {"task_id": "uuid", "status": "e:open|done|cancelled?", "due_at": "datetime?", "title": "str?"},
   {"task_id": "uuid"}, writes=["task"], scope="owner_or_team")
fn("task-assign", "POST", "team.assign", ["mgmt"], {"rep_id": "uuid", "title": "str", "due_at": "datetime?", "account_id": "uuid?"},
   {"task_id": "uuid"}, writes=["task"], scope="team", wave=3)
fn("problem-update", "POST", "accounts.write", ["app"], {"problem_id": "uuid", "status": "e:open|in_progress|resolved", "due_date": "date?"},
   {"problem_id": "uuid"}, writes=["problem"], scope="account")
fn("account-convert", "POST", "accounts.convert", ["app", "buddy"], {"account_id": "uuid"},
   {"approval_id": "uuid", "status": "str"}, writes=["ai_action", "approval"], scope="account",
   notes="Structural action: always creates an approval unless ai_permission says otherwise.")

# ---------------------------------------------------------------- voice debrief & autonomy
fn("voice-log-upload", "POST", "voicelog.create", ["app"],
   {"idempotency_key": "str", "recorded_at": "datetime", "account_id": "uuid?", "visit_id": "uuid?",
    "audio_base64": "str?", "audio_mime": "str?", "transcript": "str?", "language": "str?"},
   {"voice_log_id": "uuid", "status": "str", "duplicate": "bool"}, writes=["voice_log"], timeout_ms=60000,
   notes="Body <= 1 MB (platform limit). Same idempotency_key returns the existing voice_log (duplicate=true). Triggers transcription (OPEN-04) then debrief-process.")
fn("debrief-process", "POST", "voicelog.create", ["buddy", "internal"],
   {"voice_log_id": "uuid?", "utterance": "str?", "account_id": "uuid?", "conversation_id": "str?",
    "lat": "num?", "lng": "num?", "language": "str?", "corrects_voice_log_id": "uuid?"},
   {"status": "e:completed|needs_confirmation|failed", "result": "$ResultCard?", "candidates": ["$AccountRef"],
    "question": "str?"},
   reads=["account", "problem", "deal", "product", "campaign", "contact", "visit", "ai_permission", "action_type"],
   writes=["voice_log", "activity", "task", "problem", "deal", "deal_stage_history", "sales_order", "order_line",
           "competitor_signal", "contact", "campaign_exposure", "visit", "ai_action", "approval", "message_approval"],
   llm=["debrief_extraction", "draft_message"], timeout_ms=60000, wave=2,
   notes="Exactly one of voice_log_id / utterance. corrects_voice_log_id (with utterance = the correction words): code undoes every applied line of that completed debrief, then processes its transcript + ' Correction: ' + utterance for the same account, so a fix never creates a second visit. Target p95 < 20 s. Pushes events result_card.ready.")
fn("debrief-result-get", "GET", "voicelog.read", ["app", "buddy"], {"voice_log_id": "uuid"}, "$ResultCard",
   reads=["voice_log", "ai_action", "approval"], scope="owner")
fn("ai-action-undo", "POST", "aiaction.undo", ["app", "buddy"], {"ai_action_id": "uuid"},
   {"ai_action_id": "uuid", "status": "e:undone", "restored": {"table": "str", "id": "str"}},
   reads=["ai_action"], writes=["ai_action", "*"], scope="owner",
   notes="Restores before_snapshot exactly; rows created by the action are deleted by the engine (the only delete path, internal rows only).")
fn("ai-actions-list", "GET", "aiaction.read", ["app", "mgmt"],
   {"voice_log_id": "uuid?", "user_id": "uuid?", "status": "str?", "from": "datetime?", "to": "datetime?", **PAGE_REQ},
   {"items": ["$ActionLine"], "page": "$Page"}, reads=["ai_action"], scope="owner_or_team", wave=3)

# ---------------------------------------------------------------- customer-message approvals
fn("draft-message", "POST", None, ["internal"],
   {"account_id": "uuid", "contact_id": "uuid?", "intent": "str", "channel": "e:email|whatsapp|viber",
    "context": "str?", "on_behalf_of": "uuid", "voice_log_id": "uuid?"},
   {"approval_id": "uuid", "ai_action_id": "uuid"}, reads=["account", "contact", "activity"],
   writes=["ai_action", "approval", "message_approval"], llm=["draft_message"],
   notes="Internal only (called by debrief-process, alert-act). Never sends.")
fn("approvals-list", "GET", "approvals.read", ["app", "buddy"],
   {"kind": "e:customer_message|discount|terms|conversion?", "status": "str?", "role": "e:requester|approver?"},
   {"items": ["$ApprovalCard"]}, reads=["approval", "message_approval", "discount_request"], scope="requester_or_approver")
fn("approval-resolve", "POST", "approvals.decide", ["app", "buddy"],
   {"approval_id": "uuid", "decision": "e:approve|edit_approve|reject", "final_body": "str?"},
   {"approval": "$ApprovalCard"}, reads=["approval", "message_approval"], writes=["approval", "message_approval", "ai_action"],
   scope="approver", integrations=["integration:gmail.google_workspace_gmail_message_send"],
   notes="For kind customer_message / conversion. Approve sends synchronously via message-send in the caller's (rep's) identity (S3/OPEN-03). Failed sends keep status failed with failure_reason; the rep can retry by approving again.")
fn("approval-status", "GET", "approvals.read", ["buddy", "app"], {"approval_id": "uuid"}, {"approval": "$ApprovalCard"},
   reads=["approval", "discount_request", "manager_call"], scope="requester_or_approver")

# ---------------------------------------------------------------- discounts (3 tiers)
fn("discount-check", "POST", "discounts.request", ["buddy", "app"],
   {"account_id": "uuid", "discount_pct": "num", "product_ids": ["uuid"]},
   {"allowed": "bool", "limit_pct": "num", "policy_id": "uuid?", "approver": "$UserRef?", "manager_call_available": "bool",
    "ai_action_id": "uuid?"},
   reads=["discount_policy", "account", "product", "app_user"], writes=["ai_action"], scope="account",
   notes="Resolution order in metrics.md#discount-limit. allowed=true writes ai_action discount_within_limit (internal log).")
fn("discount-request", "POST", "discounts.request", ["buddy", "app"],
   {"account_id": "uuid", "deal_id": "uuid?", "discount_pct": "num",
    "lines": [{"product_id": "uuid", "quantity": "num"}], "justification": "str?", "mode": "e:live|async",
    "voice_log_id": "uuid?", "conversation_id": "str?"},
   {"approval_id": "uuid", "status": "str", "mode": "e:live|async", "manager_call_id": "uuid?", "approver": "$UserRef",
    "due_at": "datetime?"},
   reads=["discount_policy", "app_user", "organization"], writes=["approval", "discount_request", "discount_request_line", "manager_call", "task"],
   integrations=["outbound_call:merc-approver"],
   notes="live: POST /v1/agents/outbound {from: merc-approver caller id, to: approver phone, call_purpose: 'merc_approval:<approval_id>'} via service account merc-platform-api (S7). Call hours 08:00-20:00 org time are checked here. If outside hours, manager_call_enabled=false, no caller id, or the start fails -> async. async: due_at = now + approval_sla_minutes, push + inbox to approver, task for requester; SMS only when an SMS sender exists. Stores conversation_id on discount_request for relaying the decision (S8).")
fn("manager-call-outcome", "POST", None, ["internal", "merc-approver"],
   {"manager_call_id": "uuid", "outcome": "e:answered|no_answer|busy|voicemail|failed", "conversation_id": "str?"},
   {"approval_id": "uuid", "fallback": "e:none|async"}, writes=["manager_call", "approval", "task"],
   notes="Called by merc-approver triggers OnVoicemailDetected / OnEnd (no decision recorded), and lazily by approval-status / approval-sla-watch when a live call has no outcome after 90 s. Non-answered outcome switches the approval to async.")
fn("approver-brief", "GET", None, ["merc-approver"], {"approval_id": "uuid"},
   {"approval_id": "uuid", "callee": "$UserRef", "requester": "$UserRef", "account": "$AccountRef",
    "requested_pct": "num", "policy_limit_pct": "num", "approver_limit_pct": "num?",
    "lines": [{"name": "str", "quantity": "num", "unit": "str"}], "context_facts": ["str"], "spoken_brief": "str"},
   reads=["approval", "discount_request", "discount_request_line", "account_metrics", "competitor_signal", "sales_order"],
   notes="spoken_brief is one sentence built from rows only (no LLM numbers).")
fn("approval-decide", "POST", "discounts.approve", ["mgmt", "merc-approver", "sms_link"],
   {"approval_id": "uuid", "decision": "e:approve|counter|reject", "approved_pct": "num?", "note": "str?",
    "via": "e:app|phone_call|sms_link", "link_token": "str?"},
   {"approval": "$ApprovalCard", "requester_notified": "bool"},
   reads=["approval", "discount_request", "discount_policy"], writes=["approval", "discount_request", "ai_action", "task"],
   scope="approver",
   notes="counter requires approved_pct < requested_pct. approved_pct must be <= approver's own limit. Pushes approval.decided to the requester (merc-live + SMS).")
fn("manager-approvals-list", "GET", "discounts.approve", ["mgmt"], {"status": "str?"}, {"items": ["$ApprovalCard"]},
   reads=["approval", "discount_request"], scope="approver", wave=3)

# ---------------------------------------------------------------- alerts
fn("alerts-list", "GET", "alerts.read", ["app", "buddy", "mgmt"], {"status": "e:open|done|dismissed?", "scope": "e:mine|team?", **PAGE_REQ},
   {"items": ["$AlertCard"], "page": "$Page"}, reads=["alert"], scope="owner_or_team")
fn("alert-act", "POST", "alerts.act", ["app", "buddy"],
   {"alert_id": "uuid", "action": "e:create_task|create_draft|done|dismiss"},
   {"alert": "$AlertCard", "task_id": "uuid?", "approval_id": "uuid?"}, writes=["alert", "task", "approval"], scope="owner")

# ---------------------------------------------------------------- planning
fn("visit-plan-get", "GET", "plan.read", ["app", "buddy"], {"week_start": "date?", "rep_id": "uuid?"},
   {"plan_id": "uuid?", "week_start": "date", "status": "str", "days": [{"date": "date", "visits": ["$VisitSummary"]}]},
   reads=["visit_plan", "visit", "account"], scope="owner_or_team")
fn("visit-plan-accept", "POST", "plan.edit", ["app", "buddy"], {"plan_id": "uuid"},
   {"plan_id": "uuid", "status": "str"}, writes=["visit_plan"], scope="owner")
fn("visit-update", "POST", "plan.edit", ["app", "buddy"],
   {"visit_id": "uuid?", "account_id": "uuid?", "action": "e:move|skip|add|reorder|done", "date": "date?",
    "position": "int?", "reason": "str?"},
   {"visit": "$VisitSummary", "day_count": "int", "warning": "str?"}, writes=["visit", "visit_change"], scope="owner",
   notes="add requires account_id + date. warning when the day exceeds visits_per_day.")
fn("visit-assign", "POST", "team.assign", ["mgmt"], {"rep_id": "uuid", "account_id": "uuid", "date": "date", "purpose": "str?"},
   {"visit": "$VisitSummary"}, writes=["visit", "visit_change"], scope="team", wave=3)

# ---------------------------------------------------------------- buddy Q&A
fn("ask-crm", "GET", "accounts.read", ["buddy"], {"question": "str", "account_id": "uuid?"},
   {"template": "str", "params": "obj", "facts": [{"label": "str", "value": "str", "source": "str"}],
    "no_data": "bool"},
   reads=["account", "sales_order", "order_line", "product", "task", "problem", "deal", "visit", "competitor_signal"],
   llm=["ask_crm_route"], scope="account",
   notes="LLM only selects a template + params (contracts/llm/ask_crm_route.json). Values come from queries. The buddy phrases the answer.")
fn("product-lookup", "GET", "products.read", ["buddy", "app"], {"query": "str"},
   {"items": [{"product_id": "uuid", "sku": "str", "name": "str", "unit": "str", "list_price_minor": "int",
               "category": "str?", "active_campaigns": ["str"], "stock": "e:unknown|in_stock|out_of_stock"}]},
   reads=["product", "product_category", "campaign_product", "campaign"])
fn("my-performance", "GET", "plan.read", ["buddy", "app"], {"period": "e:week|month|custom", "from": "date?", "to": "date?"},
   {"targets": ["$TargetProgress"], "visits_done": "int", "revenue_minor": "int", "new_customers": "int",
    "spoken_summary": "str"}, reads=["sales_target", "kpi_daily", "sales_order", "visit"])
fn("escalate", "POST", "tasks.create", ["buddy", "app"], {"account_id": "uuid", "reason": "str"},
   {"task_id": "uuid", "alert_id": "uuid"}, writes=["task", "alert"], scope="account", priority="P1", wave=3)

# ---------------------------------------------------------------- prospecting
fn("prospect-search", "POST", "prospects.search", ["app", "buddy"],
   {"area_text": "str", "category_id": "uuid?", "category_text": "str?", "origin": "e:manual|route|list_upload"},
   {"search_id": "uuid", "status": "str"}, writes=["prospect_search"], integrations=["procedure:prospecting-pipeline"])
fn("candidate-add", "POST", "prospects.search", ["buddy", "app"],
   {"business_name": "str", "location_hint": "str?", "website": "str?", "phone": "str?"},
   {"candidate_id": "uuid", "search_id": "uuid", "duplicate_of": "$AccountRef?"}, writes=["prospect_search", "candidate"],
   integrations=["procedure:prospecting-pipeline"], priority="P1", wave=3)
fn("candidates-list", "GET", "prospects.read", ["app", "buddy"], {"search_id": "uuid?", "status": "str?", **PAGE_REQ},
   {"items": ["$CandidateCard"], "page": "$Page"}, reads=["candidate", "candidate_score", "candidate_score_reason", "dossier", "dossier_fact"])
fn("candidate-act", "POST", "prospects.act", ["app", "buddy"],
   {"candidate_id": "uuid", "action": "e:add_to_route|assign|dismiss", "rep_id": "uuid?", "date": "date?"},
   {"candidate": "$CandidateCard", "account_id": "uuid?", "visit_id": "uuid?"},
   writes=["candidate", "account", "visit", "dossier"],
   notes="add_to_route creates account(type=prospect, source=prospecting), moves the dossier to it, creates a visit. assign defaults to territory.default_rep_id.")
fn("candidate-score", "POST", None, ["procedure"], {"candidate_id": "uuid"},
   {"score": "num", "reasons": [{"criterion": "str", "reason": "str"}]},
   reads=["candidate", "dossier", "dossier_fact", "icp_criterion", "icp_category", "visit"],
   writes=["candidate_score", "candidate_score_reason", "candidate"], llm=["candidate_score"])

# ---------------------------------------------------------------- management
fn("dashboard-kpis", "GET", "dashboard.read", ["mgmt", "app"],
   {"scope": "e:me|team|org", "territory_id": "uuid?", "rep_id": "uuid?", "from": "date", "to": "date",
    "compare_baseline": "bool?"},
   {"kpis": "$KpiSet", "by_rep": [{"rep": "$UserRef", "kpis": "obj"}]},
   reads=["kpi_daily", "deal", "account_metrics", "sales_target"], scope="dashboard", wave=3, priority="P1")
fn("kpi-drilldown", "GET", "dashboard.read", ["mgmt"],
   {"kpi": "e:at_risk|new_customers|pipeline|stuck_deals|low_logging|customers_saved|lost|incomplete_accounts|revenue|visits|ai_actions|approvals|discounts",
    "territory_id": "uuid?", "rep_id": "uuid?", "from": "date", "to": "date", **PAGE_REQ},
   {"items": ["obj"], "page": "$Page"}, scope="dashboard", wave=3, priority="P1")
fn("rep-detail", "GET", "team.read", ["mgmt"], {"rep_id": "uuid", "from": "date", "to": "date"},
   {"rep": "$UserRef", "kpis": "obj", "recent_visits": ["$VisitSummary"], "recent_debriefs": ["obj"], "open_alerts": ["$AlertCard"]},
   scope="team", wave=3, priority="P1", notes="Debrief transcripts visible only if OPEN-13 allows.")
fn("competitor-signals-list", "GET", "team.read", ["mgmt"], {"competitor_id": "uuid?", "territory_id": "uuid?", "from": "date?", **PAGE_REQ},
   {"items": ["obj"], "page": "$Page"}, reads=["competitor_signal", "account"], scope="team", wave=3, priority="P1")
fn("team-list", "GET", "team.read", ["mgmt"], {"include_inactive": "bool?"},
   {"items": [{"user": "$UserRef", "manager_id": "uuid?", "territory_ids": ["uuid"], "status": "str"}]},
   reads=["app_user", "territory_rep", "territory"], scope="team", wave=3, priority="P0",
   notes="Roster for manager screens: the caller's direct and indirect reports, plus reps of territories they manage. Admin sees everyone.")
fn("territories-list", "GET", "territories.read", ["mgmt"], {}, {"items": ["obj"]}, reads=["territory", "territory_rep", "territory_postal_code"], wave=3, priority="P1")
fn("territory-upsert", "POST", "territories.manage", ["mgmt"],
   {"territory_id": "uuid?", "name": "str", "manager_id": "uuid?", "default_rep_id": "uuid?", "postal_codes": ["str"],
    "rep_ids": ["uuid"], "boundary_geojson": "str?"}, {"territory_id": "uuid"},
   writes=["territory", "territory_rep", "territory_postal_code", "audit_event"], wave=3, priority="P1")
fn("assignments-transfer", "POST", "territories.manage", ["mgmt"],
   {"from_rep_id": "uuid", "to_rep_id": "uuid", "account_ids": ["uuid"], "all_accounts": "bool?", "reason": "str?"},
   {"moved": "int"}, writes=["account", "account_assignment_history", "visit", "task", "audit_event"], wave=3, priority="P1",
   notes="Moves open visits/tasks too. Customer memory follows automatically (keyed by account.id).")
fn("campaigns-list", "GET", "campaigns.read", ["mgmt", "app"], {"status": "str?"}, {"items": ["obj"]}, reads=["campaign"], wave=3, priority="P1")
fn("campaign-upsert", "POST", "campaigns.manage", ["mgmt"],
   {"campaign_id": "uuid?", "title": "str", "message": "str", "starts_on": "date", "ends_on": "date",
    "status": "e:draft|active|ended", "product_ids": ["uuid"], "territory_ids": ["uuid"], "category_ids": ["uuid"], "rep_ids": ["uuid"]},
   {"campaign_id": "uuid"}, writes=["campaign", "campaign_product", "campaign_territory", "campaign_category", "campaign_rep"], wave=3, priority="P1")
fn("campaign-draft-from-text", "POST", "campaigns.manage", ["mgmt"], {"text": "str"},
   {"draft": "obj", "unresolved": ["str"]}, llm=["campaign_from_text"], wave=3, priority="P1")
fn("campaign-funnel", "GET", "campaigns.read", ["mgmt"], {"campaign_id": "uuid"},
   {"shown": "int", "pitched": "int", "ordered": "int", "by_rep": ["obj"]}, reads=["campaign_exposure"], wave=3, priority="P1")
fn("targets-list", "GET", "targets.read", ["mgmt", "app"], {"period_start": "date?", "rep_id": "uuid?"}, {"items": ["$TargetProgress"]},
   reads=["sales_target"], scope="owner_or_team", wave=3)
fn("target-upsert", "POST", "targets.manage", ["mgmt"],
   {"target_id": "uuid?", "scope": "e:org|territory|user", "territory_id": "uuid?", "user_id": "uuid?",
    "metric": "e:revenue|volume|visits|new_customers", "period_start": "date", "period_end": "date", "target_value": "num"},
   {"target_id": "uuid"}, writes=["sales_target", "audit_event"], scope="team", wave=3)
fn("settings-get", "GET", "settings.read", ["mgmt"], {},
   {"organization": "obj", "ai_permissions": ["obj"], "alert_rules": ["obj"], "icp": "obj", "discount_policies": ["obj"]},
   reads=["organization", "ai_permission", "alert_rule", "icp_criterion", "icp_category", "discount_policy"], wave=3, priority="P1")
fn("settings-update", "PUT", "settings.manage", ["mgmt"],
   {"organization": "obj?", "ai_permissions": ["obj"], "alert_rules": ["obj"], "icp": "obj?", "discount_policies": ["obj"]},
   {"updated": "bool"}, writes=["organization", "ai_permission", "alert_rule", "icp_criterion", "icp_category", "discount_policy", "audit_event"],
   wave=3, priority="P1", notes="Partial updates; arrays replace only the listed rows (matched by natural key).")
fn("users-list", "GET", "users.manage", ["mgmt"], {}, {"items": ["obj"]}, reads=["app_user"], wave=3, priority="P1")
fn("user-upsert", "POST", "users.manage", ["mgmt"],
   {"user_id": "uuid?", "email": "str", "full_name": "str", "role_code": "e:rep|manager|admin", "manager_id": "uuid?",
    "phone": "str?", "territory_ids": ["uuid"], "status": "e:active|left?"},
   {"user_id": "uuid", "invited": "bool"}, writes=["app_user", "territory_rep", "audit_event"], wave=3, priority="P1")
fn("import-start", "POST", "import.manage", ["mgmt"],
   {"data_type": "e:accounts|contacts|orders|products|visits", "filename": "str", "csv_base64": "str?", "file_ref": "str?",
    "is_baseline": "bool?"}, {"import_id": "uuid", "status": "str"}, writes=["data_import"],
   integrations=["procedure:import-pipeline"], wave=3, priority="P1")
fn("import-get", "GET", "import.manage", ["mgmt"], {"import_id": "uuid"},
   {"import": "obj", "mapping": ["obj"], "issues": ["obj"], "preview_rows": ["obj"]},
   reads=["data_import", "import_column_mapping", "import_row_issue"], wave=3, priority="P1")
fn("import-confirm", "POST", "import.manage", ["mgmt"], {"import_id": "uuid", "mapping_overrides": ["obj"]},
   {"import_id": "uuid", "status": "str"}, writes=["data_import", "import_column_mapping"], wave=3, priority="P1")
fn("contact-export", "POST", "gdpr.manage", ["mgmt"], {"contact_id": "uuid"}, {"export": "obj"},
   reads=["contact", "activity", "message_approval"], writes=["audit_event"], wave=3, priority="P1")
fn("contact-erase", "POST", "gdpr.manage", ["mgmt"], {"contact_id": "uuid", "confirm": "bool"}, {"erased": "bool"},
   writes=["contact", "audit_event"], wave=3, priority="P1",
   notes="Human-only delete. References are set null by FK rules. Never callable by any agent tool.")

# ---------------------------------------------------------------- buddy session identity (OPEN-08, S2/S9)
fn("merc-chat-token", "POST", "voicelog.create", ["app"], {},
   {"token": "str", "expires_at": "datetime", "agent_id": "str"},
   reads=["app_user", "organization"],
   notes="Resolves the caller with me(), then calls POST /api/v1/jwt/sign (secret MERC_CHAT_API_KEY) with user {id, display_name} and metadata "
         "{merc_uid, merc_org, merc_exp, merc_sig = HMAC-SHA256(MERC_INTERNAL_CALL_KEY, 'uid|org|exp')}. The Rep app passes the token to createChat. "
         "Buddy tools read the claims from communication.metadata and verify merc_sig (shared/core me.ts). TTL 60 min; the app refreshes.")

# ---------------------------------------------------------------- buddy phone + WhatsApp channels (REQ-BUD-012..016)
fn("buddy-call-start", "POST", "voicelog.create", ["buddy", "app", "internal"],
   {"channel": "e:call|whatsapp?", "purpose": "e:callback|briefing|approval_decided|alert|eod|pre_visit|post_visit|debrief_confirm", "reason": "str?",
    "at": "datetime?", "ref_table": "str?", "ref_id": "str?"},
   {"buddy_call_id": "uuid", "status": "e:scheduled|started|sent|failed", "due_at": "datetime", "channel": "e:call|whatsapp"},
   reads=["app_user", "organization"], writes=["buddy_call"],
   integrations=["outbound_call:merc-buddy", "integration:whatsapp.send_template"],
   notes="Target is always the caller's own app_user.phone (never a request field). channel defaults to app_user.notify_channel (app -> call). "
         "at in the future -> status scheduled (buddy-callbacks-due starts it). Now: call -> POST /v1/agents/outbound {from: global MERC_BUDDY_NUMBER, to: phone, "
         "call_purpose: 'merc_buddy:<buddy_call_id>:<purpose>'} via service account merc-platform-api; whatsapp -> template merc_buddy_ping "
         "(free text only inside whatsapp_window_until). Call hours 07:30-21:00 org time; outside -> scheduled for the next allowed slot. "
         "Idempotent on (user, purpose, ref_id) for 10 min. Meeting loop (REQ-MTG-*): pre_visit (ref visit_brief) -> WhatsApp template merc_previsit_brief with the brief bullets "
         "and quick replies Call me / Useful / Not useful, or a call that reads spoken_script; post_visit (ref visit) -> 'How did it go at <account>?'; "
         "debrief_confirm (ref debrief_confirmation) -> template merc_debrief_confirm with quick replies Correct / Fix / Brief did not help. "
         "Inside whatsapp_window_until send the same content as an interactive free-form message instead of a template.")
fn("buddy-call-outcome", "POST", None, ["internal", "merc-buddy"],
   {"buddy_call_id": "uuid", "outcome": "e:answered|no_answer|busy|voicemail|failed", "conversation_id": "str?"},
   {"buddy_call_id": "uuid", "fallback": "e:none|whatsapp|app"}, writes=["buddy_call"], reads=["app_user"],
   integrations=["integration:whatsapp.send_template"],
   notes="merc-buddy triggers OnVoicemailDetected / OnEnd on an outbound call. no_answer/busy/voicemail -> one WhatsApp template ping if the rep has WhatsApp, else push + inbox. No call retry.")

# ---------------------------------------------------------------- meeting loop (REQ-MTG-*)
fn("visit-brief-get", "GET", "plan.read", ["app", "buddy", "internal"], {"visit_id": "uuid?", "account_id": "uuid?", "regenerate": "bool?"},
   "$VisitBrief",
   reads=["visit", "account", "account_metrics", "problem", "task", "sales_order", "order_line", "product", "product_guidance",
          "campaign", "campaign_product", "rep_feedback", "visit_brief", "contact"],
   writes=["visit_brief"], llm=["visit_brief_bullets"], scope="account", timeout_ms=40000, wave=2,
   notes="Exactly one of visit_id / account_id (account_id -> the rep's next planned visit there today). Returns the stored brief unless regenerate. "
         "Facts come from the visit card handler (shared, not re-implemented). Push/avoid are chosen in code per metrics.md#visit-brief-hints; "
         "the LLM only words at most 6 bullets and a spoken script of at most 45 s. Company values come from the Context Hub KB merc-company.")
fn("debrief-confirm-send", "POST", "voicelog.create", ["buddy", "internal"], {"voice_log_id": "uuid", "channel": "e:whatsapp|app?"},
   {"debrief_confirmation_id": "uuid", "status": "e:pending|sent|confirmed|corrected|no_reply|failed", "summary_text": "str"},
   reads=["voice_log", "ai_action", "visit", "app_user", "debrief_confirmation"], writes=["debrief_confirmation", "buddy_call"],
   integrations=["integration:whatsapp.send_template", "integration:whatsapp.send_text"], scope="owner", wave=4,
   notes="Idempotent on voice_log_id. Summary = at most 6 bullets built in code from the applied ai_action summaries of the voice log, plus pending approvals. No LLM. "
         "Channel defaults to whatsapp when the rep has phone_channel_enabled, else app (push + result card). Sends through buddy-call-start purpose debrief_confirm.")
fn("feedback-record", "POST", "voicelog.create", ["buddy", "app"],
   {"kind": "e:brief_useful|brief_not_useful|debrief_confirmed|debrief_corrected", "visit_brief_id": "uuid?",
    "debrief_confirmation_id": "uuid?", "detail": "str?", "correction_voice_log_id": "uuid?"},
   {"feedback_id": "uuid", "status": "str"},
   reads=["visit_brief", "debrief_confirmation"], writes=["rep_feedback", "visit_brief", "debrief_confirmation"], scope="owner", wave=4,
   notes="brief_* needs visit_brief_id and sets visit_brief.rating; debrief_* needs debrief_confirmation_id and sets its status. "
         "debrief_corrected stores detail verbatim and links correction_voice_log_id when the buddy logged the fix as a new debrief; without a confirmation (fix said in a call or chat) it needs correction_voice_log_id. Only the owner rep.")

# ---------------------------------------------------------------- push channel
fn("merc-live", "WS", None, ["app"], {"connect_query": {"client": "e:rep|mgmt"}},
   {"channels": ["str"]}, kind="websocket",
   notes="connect: resolve caller -> channels rep:{user_id} and, for managers, team:{user_id}. Messages: contracts/events/*.json.")

# ---------------------------------------------------------------- cron
def cron(slug, schedule, reads, writes, notes, wave=2, priority="P0", llm=(), integrations=()):
    fn(slug, "CRON", None, ["scheduler"], {"dry_run": "bool?"}, {"processed": "int", "created": "int", "details": "obj?"},
       reads=reads, writes=writes, kind="cron", schedule=schedule, notes=notes, wave=wave, priority=priority,
       llm=list(llm), integrations=list(integrations), timeout_ms=300000)

cron("metrics-rollup", "15 * * * *", ["sales_order", "visit", "problem", "competitor_signal"], ["account_metrics"],
     "Recompute account_metrics for all accounts (metrics.md#usual-frequency, #risk).")
cron("alerts-engine", "0 * * * *", ["account_metrics", "deal", "task", "competitor_signal", "visit", "voice_log", "alert_rule"],
     ["alert"], "Evaluate every enabled alert_rule; dedupe by dedupe_key; push alert.created.")
cron("briefing-generate", "*/15 * * * *", ["organization", "visit", "task", "account_metrics", "candidate", "campaign", "approval", "sales_target"],
     ["briefing", "briefing_item"], "For reps whose local time >= briefing_time and no briefing today. Push briefing.ready.",
     llm=["briefing_script"])
cron("approvals-expire", "0 * * * *", ["approval"], ["approval"], "customer_message approvals pending > approval_expiry_hours -> expired.")
cron("approval-sla-watch", "*/5 * * * *", ["approval", "app_user"], ["approval", "alert"],
     "Async discount approvals past due_at -> escalated to approver's manager or admin; SMS both sides.", integrations=["sms"])
cron("buddy-callbacks-due", "*/5 * * * *", ["buddy_call", "app_user", "organization"], ["buddy_call"],
     "Start buddy_call rows with status scheduled and due_at <= now (same path as buddy-call-start 'now').",
     integrations=["outbound_call:merc-buddy", "integration:whatsapp.send_template"], wave=4)
cron("previsit-briefs-due", "*/5 * * * *", ["visit", "app_user", "organization", "visit_brief"], ["visit_brief", "buddy_call"],
     "Visits with status planned and planned_start_at within previsit_lead_minutes, no visit_brief yet -> build the brief (visit-brief-get handler) and deliver it "
     "on notify_channel through buddy-call-start purpose pre_visit (whatsapp default, call if notify_channel=call). Once per visit; outside call hours only WhatsApp.",
     llm=["visit_brief_bullets"], integrations=["outbound_call:merc-buddy", "integration:whatsapp.send_template"], wave=4)
cron("postvisit-prompts-due", "*/5 * * * *", ["visit", "voice_log", "buddy_call", "app_user", "organization"], ["buddy_call"],
     "Visits whose planned_start_at + planned_duration_min + postvisit_prompt_minutes has passed, still planned, with no voice_log for the visit and no post_visit "
     "buddy_call -> one buddy-call-start purpose post_visit. Never records the customer conversation.",
     integrations=["outbound_call:merc-buddy", "integration:whatsapp.send_template"], wave=4)
cron("debrief-confirm-due", "* * * * *", ["voice_log", "debrief_confirmation"], ["debrief_confirmation", "buddy_call"],
     "Completed voice_logs of the last 30 min without a debrief_confirmation -> debrief-confirm-send. Sent confirmations without a reply after 4 h -> no_reply "
     "(the applied actions stay, they are undoable).", integrations=["integration:whatsapp.send_template"], wave=4)
cron("visit-plan-suggest", "0 18 * * 0", ["account", "account_metrics", "task", "campaign", "candidate", "organization", "postal_area"],
     ["visit_plan", "visit"], "Next week's plan per rep (metrics.md#visit-plan).", wave=2)
cron("account-lifecycle", "45 2 * * *", ["account_metrics", "organization"], ["account", "ai_action"],
     "Customers past the lost rule -> lost via ai_action mark_account_lost (internal, undo).", priority="P1", wave=3)
cron("kpi-rollup", "5 0 * * *", ["visit", "voice_log", "account", "ai_action", "approval", "deal", "sales_order", "alert", "discount_request"],
     ["kpi_daily"], "Yesterday per rep (metrics.md).", priority="P1", wave=3)
cron("weekly-summary", "0 7 * * 1", ["kpi_daily", "deal", "alert"], [], "Creates merc-ops task weekly_summary per manager + admin.",
     priority="P1", wave=3, integrations=["backoffice:merc-ops"])
cron("monthly-report", "0 7 1 * *", ["kpi_daily", "organization"], [], "Creates merc-ops task monthly_report for admins.",
     priority="P1", wave=3, integrations=["backoffice:merc-ops"])
cron("retention-purge", "30 2 * * *", ["voice_log", "organization"], ["voice_log"],
     "Clear audio_ref (and delete stored audio) older than recording_retention_days; keep transcript.", priority="P1", wave=3)
cron("usage-flush", "*/30 * * * *", [], ["usage_event"], "Aggregate usage counters into usage_event (atomic increase).",
     priority="P1", wave=3)

# lookup tables read by the functions that validate codes against them
LOOKUP_READS = {
    "role": ["users-list", "user-upsert", "me"], "deal_stage": ["deal-upsert", "deals-list", "dashboard-kpis"],
    "alert_type": ["alerts-engine", "alerts-list"], "channel": ["draft-message", "approval-resolve"],
    "account_category": ["accounts-list", "visit-plan-suggest", "settings-get", "discount-check"],
}
for _t, _slugs in LOOKUP_READS.items():
    for _f in F:
        if _f.slug in _slugs and _t not in _f.reads:
            _f.reads.append(_t)

FUNCTIONS = F
