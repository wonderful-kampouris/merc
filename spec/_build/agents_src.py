"""Agents, tools, procedures, integrations, model profiles, knowledge bases, monitors."""
from dsl import Fn, Tool
from functions_src import FUNCTIONS

# ---------------------------------------------------------------- internal functions used by procedures / backoffice agents
def ifn(*a, **k):
    k.setdefault("callers", ["procedure"])
    FUNCTIONS.append(Fn(*a, **k))

ifn("candidate-dedupe", "POST", None, req={"candidate_id": "uuid"},
    res={"duplicate": "bool", "matched_account_id": "uuid?", "matched_candidate_id": "uuid?", "rule": "str?"},
    reads=["candidate", "account"], writes=["candidate"],
    notes="Rules in order: VAT exact; website domain; phone E.164; normalized name + postal code (trigram >= 0.85).")
ifn("candidate-get", "GET", None, callers=["merc-research", "procedure"], req={"candidate_id": "uuid"},
    res={"candidate": "$CandidateCard", "website": "str?", "vat_number": "str?"}, reads=["candidate"])
ifn("dossier-save", "POST", None, callers=["merc-research"],
    req={"candidate_id": "uuid?", "account_id": "uuid?", "summary": "str", "price_level": "e:low|mid|premium?",
         "facts": [{"fact_type": "str", "value": "str", "source_url": "str", "competitor_name": "str?"}],
         "research_task_id": "str?"},
    res={"dossier_id": "uuid", "facts_saved": "int", "facts_rejected": "int"},
    writes=["dossier", "dossier_fact", "candidate"], reads=["competitor"],
    notes="Rejects facts without source_url, or whose source host is a maps service (REQ-PRS-005).")
ifn("search-finalize", "POST", None, req={"search_id": "uuid"}, res={"found": "int", "duplicates": "int", "scored": "int"},
    reads=["candidate"], writes=["prospect_search"], notes="Pushes candidates.ready to the requester.")
ifn("directory-search", "POST", None, req={"search_id": "uuid"}, res={"candidates_created": "int"},
    writes=["candidate"], integrations=["integration:business-directory.search"],
    notes="Source decided by spike S5 (OPEN-05). CSV fallback reads contracts/seed/prospect_list_*.json.")
ifn("import-analyze", "POST", None, req={"import_id": "uuid"}, res={"status": "str", "rows_total": "int", "issues": "int"},
    reads=["data_import", "account", "contact", "product"], writes=["data_import", "import_column_mapping", "import_row_issue"],
    llm=["import_mapping"], timeout_ms=300000, wave=3, priority="P1",
    notes="Parse, map columns with confidence, clean phones (E.164) / VAT (EL 9 digits) / addresses, find duplicates, build preview.")
ifn("import-apply", "POST", None, req={"import_id": "uuid"}, res={"rows_imported": "int", "rows_with_issues": "int"},
    reads=["data_import", "import_column_mapping"], writes=["account", "contact", "sales_order", "order_line", "product", "visit", "data_import"],
    timeout_ms=300000, wave=3, priority="P1")
ifn("message-send", "POST", None, callers=["internal"], req={"approval_id": "uuid"},
    res={"status": "e:sent|failed", "external_message_id": "str?", "failure_reason": "str?"},
    reads=["approval", "message_approval", "app_user"], writes=["approval", "message_approval", "ai_action", "activity", "usage_event"],
    integrations=["integration:gmail.google_workspace_gmail_message_send", "integration:outlook.send_mail"],
    notes="Library call made inside approval-resolve, in the caller's identity (S3: per-user Hub connections need a user identity; procedures/crons have none). Idempotent on approval_id.")
ifn("summary-data", "GET", None, callers=["merc-ops"], req={"kind": "e:weekly|monthly", "scope_user_id": "uuid", "from": "date", "to": "date"},
    res={"facts": "obj"}, reads=["kpi_daily", "deal", "alert", "sales_target", "organization"], wave=3, priority="P1")

# ---------------------------------------------------------------- tools
T = []
def tool(*a, **k):
    T.append(Tool(*a, **k))

B = "merc-buddy"
tool("get_today", B, "today-get", "Today's stops in order with the reason for each.", {"date": "date?"})
tool("get_briefing", B, "briefing-get", "The morning briefing script. Read script_text as is.", {"date": "date?"},
     say="Read the script; do not add numbers.")
tool("get_visit_card", B, "visit-card-get", "Everything about one customer or prospect before a visit.", {"account_id": "uuid"},
     side_effects=["customers.attach(account_id)"])
tool("resolve_account", B, "account-resolve", "Find which customer the rep means. Ask when ambiguous.",
     {"hint": "str?"}, inject=["caller", "device_location?"], side_effects=["customers.attach(account.id) when resolved"])
tool("log_visit", B, "debrief-process",
     "Log what happened in a visit from the rep's own words. Pass the words verbatim, never paraphrase.",
     {"utterance": "str", "account_id": "uuid?", "corrects_voice_log_id": "uuid?"}, inject=["caller", "conversation_id", "device_location?", "language"],
     say="Read spoken_summary, then ask each missing_fields question, then offer pending approvals. "
         "For a correction of a debrief already logged, pass only the correction words as utterance and that debrief's voice_log_id as corrects_voice_log_id; code undoes and re-logs it.")
tool("get_debrief_result", B, "debrief-result-get", "Re-read the result of a logged visit.", {"voice_log_id": "uuid"})
tool("undo_action", B, "ai-action-undo", "Undo one thing the AI did.", {"ai_action_id": "uuid"})
tool("list_approvals", B, "approvals-list", "Pending 'Shall I send it?' items and discount requests.",
     {"kind": "e:customer_message|discount|terms|conversion?"})
tool("resolve_approval", B, "approval-resolve", "Approve, edit-and-approve or reject a customer message.",
     {"approval_id": "uuid", "decision": "e:approve|edit_approve|reject", "final_body": "str?"},
     say="Always read back recipient + first line before approving.")
tool("check_discount_limit", B, "discount-check", "Is this discount within the rep's limit?",
     {"account_id": "uuid", "discount_pct": "num", "product_ids": ["uuid"]})
tool("request_manager_approval", B, "discount-request", "Ask the manager to approve a discount above the limit. mode=live calls the manager now.",
     {"account_id": "uuid", "discount_pct": "num", "lines": [{"product_id": "uuid", "quantity": "num"}],
      "justification": "str?", "mode": "e:live|async", "deal_id": "uuid?"}, inject=["caller", "conversation_id"],
     say="Say you are calling the manager and the rep can keep talking to the customer.")
tool("get_approval_status", B, "approval-status", "Check whether the manager has decided.", {"approval_id": "uuid"},
     say="Re-check at most every 20 s while the rep waits; stop after 3 minutes and say they'll be notified.")
tool("call_me_back", B, "buddy-call-start", "Call or WhatsApp the rep back later or now ('call me at 5', 'ping me when Eleni decides').",
     {"channel": "e:call|whatsapp?", "purpose": "e:callback|briefing|approval_decided|alert|eod|pre_visit|post_visit|debrief_confirm", "reason": "str?", "at": "datetime?",
      "ref_table": "str?", "ref_id": "str?"}, inject=["caller"],
     say="Confirm the time and channel back in one sentence.")
tool("report_buddy_call_outcome", B, "buddy-call-outcome", "Trigger-only: record how an outbound buddy call ended.",
     {"buddy_call_id": "uuid", "outcome": "e:answered|no_answer|busy|voicemail|failed"}, inject=["conversation_id"])
tool("get_visit_brief", B, "visit-brief-get", "The pre-meeting brief for a visit: bullets, one product to push and one to avoid, each with a reason.",
     {"visit_id": "uuid?", "account_id": "uuid?"},
     say="On a call read spoken_script as is. On WhatsApp send the bullets as is. Never add numbers or products.")
tool("send_debrief_confirmation", B, "debrief-confirm-send", "Send the rep a short summary of what Merc logged, to confirm or fix.",
     {"voice_log_id": "uuid"}, inject=["caller"], say="On a call say: I'll WhatsApp you the summary to confirm.")
tool("record_feedback", B, "feedback-record", "Record the rep's reaction: brief useful or not, debrief summary correct or fixed.",
     {"kind": "e:brief_useful|brief_not_useful|debrief_confirmed|debrief_corrected", "visit_brief_id": "uuid?",
      "debrief_confirmation_id": "uuid?", "detail": "str?", "correction_voice_log_id": "uuid?"}, inject=["caller"],
     say="For a fix: undo the named actions, log the correction with log_visit, then record debrief_corrected with the rep's words.")
tool("list_alerts", B, "alerts-list", "Open alerts for the rep.", {"status": "e:open|done|dismissed?"})
tool("act_on_alert", B, "alert-act", "Turn an alert into a task or draft, or close it.",
     {"alert_id": "uuid", "action": "e:create_task|create_draft|done|dismiss"})
tool("get_week_plan", B, "visit-plan-get", "This week's visit plan.", {"week_start": "date?"})
tool("accept_week_plan", B, "visit-plan-accept", "Accept the proposed week plan.", {"plan_id": "uuid"})
tool("update_visit", B, "visit-update", "Move, skip, add, reorder or complete a visit.",
     {"visit_id": "uuid?", "account_id": "uuid?", "action": "e:move|skip|add|reorder|done", "date": "date?",
      "position": "int?", "reason": "str?"})
tool("ask_crm", B, "ask-crm", "Answer a factual question about customers, orders, deals from the CRM.",
     {"question": "str", "account_id": "uuid?"}, say="Answer only with the returned facts. If no_data, say you don't know.")
tool("product_lookup", B, "product-lookup", "Product price, unit and active campaigns.", {"query": "str"})
tool("create_task", B, "task-create", "Create a reminder/task.",
     {"title": "str", "due_at": "datetime?", "account_id": "uuid?", "is_customer_promise": "bool?"})
tool("complete_task", B, "task-update", "Mark a task done or change its date.",
     {"task_id": "uuid", "status": "e:open|done|cancelled?", "due_at": "datetime?"})
tool("draft_order", B, "order-upsert", "Create or confirm a draft order. Confirm only after the rep says yes.",
     {"order_id": "uuid?", "account_id": "uuid", "status": "e:draft|confirmed|cancelled",
      "lines": [{"product_id": "uuid", "quantity": "num"}]})
tool("my_performance", B, "my-performance", "How the rep is doing against targets.", {"period": "e:week|month|custom"})
tool("find_shops", B, "prospect-search", "Find new shops in an area and category.",
     {"area_text": "str", "category_text": "str?"}, inject=["caller", "origin=manual", "device_location?"], say="Say results arrive in a few minutes.")
tool("add_candidate", B, "candidate-add", "Add a shop the rep spotted.", {"business_name": "str", "location_hint": "str?"}, priority="P1")
tool("list_new_shops", B, "candidates-list", "Scored new shops.", {"search_id": "uuid?"})
tool("act_on_candidate", B, "candidate-act", "Add a new shop to the route, assign or dismiss it.",
     {"candidate_id": "uuid", "action": "e:add_to_route|assign|dismiss", "date": "date?"})
tool("convert_to_customer", B, "account-convert", "Prospect became a customer (needs approval).", {"account_id": "uuid"})
tool("escalate_to_manager", B, "escalate", "Escalate a customer issue to the manager.", {"account_id": "uuid", "reason": "str"}, priority="P1")
tool("end_of_day", B, "eod-summary", "End-of-day summary.", {}, priority="P1")

A = "merc-approver"
tool("get_approval_brief", A, "approver-brief", "Load the request this call is about. Call first.", {},
     inject=["call_metadata.approval_id"], say="Say spoken_brief, then ask: approve, counter-offer, or reject?")
tool("record_approval_decision", A, "approval-decide", "Record the manager's decision.",
     {"decision": "e:approve|counter|reject", "approved_pct": "num?", "note": "str?"},
     inject=["call_metadata.approval_id", "via=phone_call", "callee"], say="Read the decision back before ending.")
tool("report_call_outcome", A, "manager-call-outcome", "Report that the call ended without a decision. Also fired by the OnVoicemailDetected and OnEnd triggers.",
     {"outcome": "e:no_answer|busy|voicemail|failed"}, inject=["call_metadata.manager_call_id", "conversation_id"])

R = "merc-research"
tool("get_candidate", R, "candidate-get", "Load the shop to research.", {"candidate_id": "uuid"}, inject=["task_input"])
tool("scrape_website", R, "integration:firecrawl.scrape", "Read a public business website (menu, catalog, brands, prices).",
     {"url": "str"}, inject=[])
tool("lookup_company", R, "integration:business-directory.company", "Official company data (registry).", {"vat_number": "str?", "name": "str?"},
     inject=[])
tool("save_dossier", R, "dossier-save", "Save the dossier; every fact needs its source_url.",
     {"candidate_id": "uuid?", "summary": "str", "price_level": "e:low|mid|premium?",
      "facts": [{"fact_type": "str", "value": "str", "source_url": "str", "competitor_name": "str?"}]},
     inject=["task_id"])

O = "merc-ops"
tool("get_summary_data", O, "summary-data", "Facts for the weekly/monthly summary.",
     {"kind": "e:weekly|monthly", "scope_user_id": "uuid", "from": "date", "to": "date"}, inject=[], priority="P1")
tool("send_internal_email", O, "builtin:context.email", "Email the summary to the manager/CEO (internal, no approval needed).",
     {"to": "str", "subject": "str", "body": "str"}, inject=[], priority="P1")
tool("deliver_whatsapp", O, "builtin:context.outbound.whatsapp", "Send the waiting relayed WhatsApp buddy_calls (brief, post-visit prompt, debrief confirmation) through the buddy's WhatsApp connection. Functions have no context.outbound, so they mark the row relayed and fire the whatsapp_send webhook; the webhook body does not reach the task, so the tool sends every waiting relayed row.",
     {"buddy_call_id": "uuid?"}, inject=[], priority="P0")

TOOLS = T

# ---------------------------------------------------------------- agents
AGENTS = {
    "merc-buddy": {
        "type": "conversational", "modality": "voice", "agents_version": "v2", "priority": "P0", "wave": 3,
        "channels": ["browser_voice (Chat SDK modalities=[voice]) embedded in Rep App",
                     "phone_inbound: the rep calls the Merc number (Wonderful SIP customer number on a Twilio Elastic SIP trunk, routed to merc-buddy)",
                     "phone_outbound: merc-buddy calls the rep (fn:buddy-call-start -> POST /v1/agents/outbound, from = MERC_BUDDY_NUMBER)",
                     "whatsapp: the rep messages the Merc WhatsApp number (assigned to merc-buddy; if a voice agent cannot hold a WhatsApp number, to the chat twin merc-buddy-chat with the same skills and tools)"],
        "channel_identity": "browser: signed Chat SDK token (REQ-BUD-002). phone/WhatsApp: tool code reads context.metadata.communication.fromNumber (inbound) or toNumber (outbound), normalizes to E.164 and matches exactly one active app_user.phone with phone_channel_enabled. No match -> say Merc does not know this number and end. Never from what the caller says.",
        "channel_rules": ["Phone: answer in at most 2 sentences; never read long lists; offer to WhatsApp the details.",
                          "Phone/WhatsApp: external actions (send a customer email, approve a discount) need a spoken/typed read-back + 'yes' (REQ-APR-002) as in the app.",
                          "Inbound greeting uses the rep's first name and today's first stop (get_today).",
                          "Outbound: open with why Merc is calling (call_purpose), then continue as a normal buddy session.",
                          "Inbound or app: if a visit starts within 60 min, offer its brief first (get_visit_brief).",
                          "Outbound pre_visit: read the brief's spoken_script, then ask if anything is unclear. Outbound post_visit: ask how it went, then run the debrief skill.",
                          "WhatsApp quick replies: 'Call me' -> call_me_back purpose pre_visit now; Useful / Not useful -> record_feedback; Correct -> record_feedback debrief_confirmed; Fix -> ask what is wrong, then the fix flow.",
                          "After a debrief on a call, send_debrief_confirmation and say it is coming on WhatsApp.",
                          "Merc never records or listens to the customer meeting. It only hears the rep, before and after."],
        "triggers": ["OnVoicemailDetected (outbound) -> report_buddy_call_outcome(voicemail)", "OnEnd (outbound, not answered) -> report_buddy_call_outcome(no_answer)"],
        "languages": {"default": "el", "also": ["en"], "rule": "Answer in the language the rep speaks; never translate proper names."},
        "identity": "Rep identity injected by the Rep App into the session (OPEN-08). Never asked from the rep, never taken from model output.",
        "memory": {"enabled": True, "identification": "manual: ctx.customers.attach(account.id) in resolve_account / get_visit_card / log_visit",
                   "access": "all agents' memories for the customer", "strategy": ["recent", "relevant"],
                   "instructions": {"extract": "Preferences, how to talk to them, commitments, objections, family/staff names, ordering habits. Never prices or quantities (those live in tables).",
                                    "use": "Use memories for tone and context only; numbers always come from tools."}},
        "skills": [
            {"name": "briefing", "trigger": "morning / 'what's my day'", "tools": ["get_briefing", "get_today"]},
            {"name": "debrief", "trigger": "rep describes a visit", "tools": ["resolve_account", "log_visit", "get_debrief_result", "undo_action", "resolve_approval", "record_feedback"]},
            {"name": "prepare_visit", "trigger": "'tell me about X' / arriving", "tools": ["resolve_account", "get_visit_card"]},
            {"name": "approvals", "trigger": "'yes send it' / 'what's pending'", "tools": ["list_approvals", "resolve_approval"]},
            {"name": "discount", "trigger": "customer asks for a discount", "tools": ["check_discount_limit", "request_manager_approval", "get_approval_status"]},
            {"name": "planning", "trigger": "'move / skip / add' / 'my week'", "tools": ["get_week_plan", "accept_week_plan", "update_visit", "get_today"]},
            {"name": "ask", "trigger": "factual questions", "tools": ["ask_crm", "product_lookup", "my_performance", "list_alerts", "act_on_alert"]},
            {"name": "tasks_orders", "trigger": "reminders, orders", "tools": ["create_task", "complete_task", "draft_order"]},
            {"name": "prospecting", "trigger": "'find bakeries in X' / 'new shop here'", "tools": ["find_shops", "add_candidate", "list_new_shops", "act_on_candidate", "convert_to_customer"]},
            {"name": "end_of_day", "trigger": "evening / 'wrap up'", "tools": ["end_of_day"], "priority": "P1"},
            {"name": "pitch_rehearsal", "trigger": "'play the owner'", "tools": ["get_visit_card"], "priority": "P1",
             "behavior": "Role-play the prospect's owner using the card's objections; after 2 minutes give 3 feedback points."},
            {"name": "escalation", "trigger": "'tell my manager'", "tools": ["escalate_to_manager"], "priority": "P1"},
            {"name": "meeting_loop", "trigger": "pre-meeting brief, 'call me' from the WhatsApp brief, 'how did it go', confirm or fix the summary",
             "tools": ["get_visit_brief", "call_me_back", "log_visit", "send_debrief_confirmation", "record_feedback", "undo_action", "get_debrief_result"]},
            {"name": "reach_me", "trigger": "'call me at 5' / 'ping me on WhatsApp when it's approved'", "tools": ["call_me_back", "report_buddy_call_outcome"]},
        ],
        "rules": ["REQ-BUD-*"],
        "evals": "evals/merc-buddy/",
    },
    "merc-approver": {
        "type": "conversational", "modality": "voice", "agents_version": "v2", "priority": "P0", "wave": 3,
        "channels": ["single outbound call via POST /v1/agents/outbound started by fn:discount-request (S7). Campaigns are not installed on the tenant; use a campaign only if that changes."],
        "languages": {"default": "el", "also": ["en"]},
        "memory": {"enabled": False},
        "skills": [{"name": "decide_discount", "tools": ["get_approval_brief", "record_approval_decision", "report_call_outcome"]}],
        "behavior": [
            "Greet the manager by name, say who is asking and why in one sentence (spoken_brief).",
            "Accept only approve / counter-offer with a % / reject. Read the decision back, record it, end the call.",
            "Counter-offer must be below the requested % and within the manager's own limit (the function enforces it).",
            "Voicemail: leave no commercial details; say 'Merc has an approval waiting from <rep> in the app' and report voicemail.",
            "No other topics; if asked, say the details are in the Merc app.",
        ],
        "call_rules": {"no_answer": "no outcome within 90 s -> async (lazy check in approval-status / approval-sla-watch), no retry",
                       "busy": "same", "voicemail": "trigger OnVoicemailDetected -> report_call_outcome", "end_without_decision": "trigger OnEnd -> report_call_outcome",
                       "allowed_call_times": "08:00-20:00 org timezone, enforced in fn:discount-request"},
        "triggers": ["OnVoicemailDetected -> report_call_outcome(voicemail)", "OnEnd without decision -> report_call_outcome(failed)"],
        "evals": "evals/merc-approver/",
    },
    "merc-research": {
        "type": "backoffice", "agents_version": "v2", "priority": "P0", "wave": 3,
        "triggers": [{"type": "webhook", "task_type": "candidate_research", "from": "procedure prospecting-pipeline"}],
        "skills": [{"name": "research_shop", "tools": ["get_candidate", "scrape_website", "lookup_company", "save_dossier"]}],
        "behavior": ["Only the shop's own public website and official registries/directories. Never maps or review platforms scraping.",
                     "Every fact keeps source_url and retrieved_at.", "Complete the task without approval (internal data).",
                     "No website -> save a dossier with registry facts only and summary 'no website'."],
        "evals": "evals/merc-research/",
    },
    "merc-ops": {
        "type": "backoffice", "agents_version": "v2", "priority": "P1", "wave": 3,
        "triggers": [{"type": "webhook", "task_type": "weekly_summary"}, {"type": "webhook", "task_type": "monthly_report"}, {"type": "webhook", "task_type": "whatsapp_send"}],
        "skills": [{"name": "weekly_summary", "tools": ["get_summary_data", "send_internal_email"]},
                   {"name": "monthly_report", "tools": ["get_summary_data", "send_internal_email"]},
                   {"name": "whatsapp_send", "tools": ["deliver_whatsapp"]}],
        "behavior": ["Numbers only from get_summary_data facts.", "Weekly: what closed, what got stuck, what's coming.",
                     "Monthly: before/after baseline, completeness, new customers, customers saved."],
    },
    "merc-insights": {
        "type": "conversational", "modality": "chat", "agents_version": "v2", "priority": "P2", "wave": 4,
        "channels": ["Chat SDK embedded in Management app"],
        "skills": [{"name": "explain_numbers", "tools": []}],
        "behavior": ["Read-only. Uses dashboard-kpis / kpi-drilldown via tools added when built (P2)."],
    },
}

# ---------------------------------------------------------------- procedures
PROCEDURES = {
    "prospecting-pipeline": {
        "trigger": {"type": "webhook", "payload": {"search_id": "uuid"}}, "priority": "P0", "wave": 3,
        "steps": [
            {"id": "search", "type": "function", "function": "directory-search"},
            {"id": "each", "type": "for_each", "over": "candidates of search_id with status=new", "steps": [
                {"id": "dedupe", "type": "function", "function": "candidate-dedupe"},
                {"id": "if_dup", "type": "if", "condition": "dedupe.duplicate == false", "then": [
                    {"id": "research", "type": "agent_task", "agent": "merc-research", "task_type": "candidate_research",
                     "input": {"candidate_id": "{{candidate_id}}"}, "timeout_minutes": 5, "on_timeout": "mark candidate failed"},
                    {"id": "score", "type": "function", "function": "candidate-score"}]}]},
            {"id": "finalize", "type": "function", "function": "search-finalize"}],
        "notes": "Procedures are beta: fallback is a function chain driven by a cron (documented in SPEC PRS)."},
    "import-pipeline": {
        "trigger": {"type": "webhook", "payload": {"import_id": "uuid"}}, "priority": "P1", "wave": 3,
        "steps": [
            {"id": "analyze", "type": "function", "function": "import-analyze"},
            {"id": "wait_confirm", "type": "wait_table_condition", "table": "data_import", "condition": "status == 'confirmed'",
             "timeout_hours": 72},
            {"id": "apply", "type": "function", "function": "import-apply"}]},
}

# ---------------------------------------------------------------- platform resources
INTEGRATIONS = {
    "gmail": {"hub": "Integration Hub connector google_workspace", "identity": "per-user (needs the rep's identity: app session or buddy tool)",
              "actions": ["google_workspace_gmail_message_send"], "input": "{to:[email], subject, body, cc?, bcc?, html?}", "priority": "P0"},
    "outlook": {"hub": "Integration Hub connector microsoft_graph", "identity": "per-user", "actions": ["send_mail"], "priority": "P1"},
    "google-calendar": {"hub": "Integration Hub curated", "identity": "per-user", "actions": ["list_events"], "priority": "P1"},
    "firecrawl": {"hub": "fetch + markdown conversion; Firecrawl only when secret FIRECRAWL_API_KEY exists (optional)", "identity": "service",
                  "actions": ["scrape"], "secret": "FIRECRAWL_API_KEY", "priority": "P0"},
    "business-directory": {"hub": "function fetch: OpenStreetMap Overpass (no auth, ODbL, attribution) as 'directory'; GEMI Open Data (header api_key = secret DIRECTORY_API_KEY, ODC-BY) as 'registry'; seeded CSV fallback",
                           "identity": "service", "actions": ["search", "company"], "priority": "P0"},
    "sms": {"builtin": "context.telephony.sendSms", "priority": "P1", "note": "No SMS-capable number in the tenant yet (S7). Fallback is push + inbox + task."},
    "outbound-calls": {"builtin": "POST /v1/agents/outbound from fn:discount-request (merc-approver) and fn:buddy-call-start (merc-buddy); needs a caller id on an outbound SIP trunk attached to merc-approver and service account merc-platform-api (agents:edit, communications:edit)",
                       "priority": "P0", "open": "OPEN-07"},
    "email-internal": {"builtin": "context.email", "priority": "P1"},
    "whatsapp": {"builtin": "WhatsApp Business channel (Meta Embedded Signup, set up by the team in FSM); inbound number assigned to merc-buddy. Outbound pings: context.outbound.whatsapp.sendTemplate (template merc_buddy_ping, el+en) from fn:buddy-call-start / buddy-call-outcome; free text only inside the 24 h window",
                 "identity": "service (the Merc WhatsApp number)", "actions": ["send_template", "send_text"], "priority": "P0",
                 "templates": {"merc_buddy_ping": "generic ping (REQ-BUD-015)",
                               "merc_previsit_brief": "pre-meeting bullets; quick replies Call me / Useful / Not useful (REQ-MTG-001)",
                               "merc_debrief_confirm": "debrief summary; quick replies Correct / Fix / Brief did not help (REQ-MTG-006)"},
                 "open": "OPEN-19, OPEN-21", "note": "Customer-facing WhatsApp drafts (follow_up.channel=whatsapp) stay copy-to-clipboard; only rep<->buddy uses this number."},
    "telephony": {"builtin": "Wonderful SIP <-> Twilio Elastic SIP trunk (docs/guides/telephony-whatsapp.md). One customer number = MERC_BUDDY_NUMBER: inbound route -> merc-buddy, outbound caller id for merc-buddy and merc-approver",
                  "priority": "P0", "open": "OPEN-07"},
}
MODEL_PROFILES = {
    "merc-extract": {"use": "structured extraction (debrief, import mapping, ask-crm routing, campaign text)", "needs": ["structured_output", "greek"]},
    "merc-write": {"use": "drafts, briefing/eod scripts, pitches", "needs": ["greek", "style_imitation"]},
    "merc-decide": {"use": "Decision model: criterion ratings for scoring, yes/no gates", "needs": ["decision_model"]},
    "merc-transcribe": {"use": "inline audio transcription in voice-log-upload (S4: gemini-2.5-flash, 39 s Greek in 2.1 s)", "needs": ["audio_input", "greek"],
                        "note": "CLI create returned 500 in the tenant; create in the UI"},
}
KNOWLEDGE_BASES = {
    "merc-catalog": {"content": "Product sheets, pairing suggestions, why-it-fits notes", "used_by": ["visit-card-get", "merc-buddy"]},
    "merc-playbook": {"content": "Sales playbook, objection library, ICP description, pitch examples", "used_by": ["visit-card-get", "merc-buddy"]},
    "merc-company": {"content": "Company profile: who we are, values, positioning, how we sell, what we never do; the why behind product_guidance rows (REQ-MTG-003)",
                     "used_by": ["visit-brief-get", "visit-card-get", "merc-buddy"]},
}
GLOBALS = {"MERC_BUDDY_NUMBER": "E.164 Merc customer number (inbound to merc-buddy, outbound caller id)",
           "MERC_WHATSAPP_CONNECTION": "Name of the WhatsApp connection to send templates through (connectionName)"}
SECRETS = ["FIRECRAWL_API_KEY (optional)", "DIRECTORY_API_KEY", "MERC_LINK_SIGNING_KEY", "MERC_INTERNAL_CALL_KEY", "MERC_CHAT_API_KEY"]
SERVICE_ACCOUNTS = {"merc-platform-api": {"scopes": ["agents:edit", "communications:edit"], "used_by": ["discount-request", "approval-decide", "merc-live", "buddy-call-start", "buddy-callbacks-due", "previsit-briefs-due", "postvisit-prompts-due", "debrief-confirm-due"]}}
CHAT_SDK_KEYS = {"merc-buddy": {"allowed_domains": ["https://app.<env>.sb.wonderful.ai", "https://default.app.<env>.sb.wonderful.ai"],
                               "require_captcha": False, "auth": "signed user token from fn:merc-chat-token", "created_via": "POST /api/v1/web-chat/agents/{agent_id}/key"}}
MONITORS = {
    "debrief-latency": "p95 debrief-process duration > 20 s over 15 min",
    "function-errors": "any merc function error rate > 5% over 15 min",
    "voice-log-failures": "voice_log status=failed > 3 per hour",
    "approval-sla-breach": "approvals escalated > 0 per day (info)",
    "message-send-failures": "message-send failed > 0 per hour",
    "previsit-brief-missed": "planned visit started with no visit_brief sent > 0 per day (REQ-MTG-001)",
    "debrief-confirm-latency": "debrief_confirmation sent_at - voice_log processed_at p95 > 60 s over 1 h (REQ-MTG-006)",
}
