"""Merc tables (schema `merc`). Source of truth for spec/contracts/tables/*.json.
Conventions:
- Every table has surrogate PK `id` (auto_uuid) unless pk= is given (lookup tables keyed by a string code).
- Natural keys are enforced with unique indexes (composite generated-key PKs are not allowed by the platform).
- created_at / updated_at are platform system columns: never declared here.
- Money is integer minor units (*_minor). Percentages are 0-100 numbers. Probabilities are 0-1.
"""
from dsl import Table, S, N, B, D, DT, E, FK, U, X, G

SCHEMA = "merc"

ACCOUNT_TYPES = ["prospect", "customer", "lost"]
ACTION_CLASSES = ["internal", "draft", "external", "structural", "destructive"]
MODES = ["auto", "ask", "never"]

TABLES = [
    # ------------------------------------------------------------ lookups
    Table("role", "App roles", [S("code", True), S("name", True)], pk="code", domain="lookup"),
    Table("deal_stage", "Deal pipeline stages", [
        S("code", True), S("name", True), N("sort_order", True), B("is_closed", True), B("is_won", True),
        N("probability", True, "0-1, weighted pipeline")], pk="code", domain="lookup"),
    Table("action_type", "Every kind of AI action and its autonomy class", [
        S("code", True), E("action_class", ACTION_CLASSES, True), E("default_mode", MODES, True), S("description")],
        pk="code", domain="lookup"),
    Table("alert_type", "Alert kinds", [
        S("code", True), E("default_severity", ["low", "medium", "high"], True), S("suggested_action"), S("description")],
        pk="code", domain="lookup"),
    Table("channel", "Outbound channels to customers", [
        S("code", True), S("name", True), B("requires_provider_approval", True)], pk="code", domain="lookup"),
    Table("postal_area", "Postal code -> city/region (keeps account/candidate in 3NF)", [
        S("postal_code", True), S("city", True), S("region"), S("country_code", True), N("lat"), N("lng")],
        pk="postal_code", domain="lookup"),

    # ------------------------------------------------------------ organization & access
    Table("organization", "The customer company (one per workspace)", [
        S("name", True), S("default_language", True, "el | en"), S("timezone", True), S("currency", True),
        S("plan"), S("briefing_time", True, "HH:MM local"), N("approval_expiry_hours", True),
        N("approval_sla_minutes", True), B("manager_call_enabled", True), N("recording_retention_days", True),
        N("icp_min_score"), N("visits_per_day", True), N("lost_after_multiplier", True),
        D("baseline_start"), D("go_live_date"), S("wonderful_workspace_id"),
        N("previsit_lead_minutes", note="Minutes before a visit's planned start when Merc sends the pre-meeting brief (REQ-MTG-001); default 30"),
        N("postvisit_prompt_minutes", note="Minutes after a visit's planned end before Merc asks how it went (REQ-MTG-005); default 10")], domain="org"),
    Table("app_user", "Rep / manager / admin", [
        FK("org_id", "organization", True), S("wonderful_user_id", True), FK("role_code", "role", True),
        FK("manager_id", "app_user", od="set_null"), S("full_name", True), S("email", True), S("phone", note="E.164. Also the rep's identity on phone/WhatsApp channels (REQ-BUD-013)"),
        S("preferred_language"), B("voice_enabled", True), E("status", ["active", "left"], True),
        B("phone_channel_enabled", note="Allow calling/messaging the buddy from this number; default true when phone is set"),
        E("notify_channel", ["app", "whatsapp", "call"], note="How the buddy reaches the rep first; default app"),
        DT("whatsapp_window_until", note="End of the 24 h WhatsApp session window (last inbound message + 24 h)")],
        [U("wonderful_user_id"), X("org_id"), X("manager_id"), X("email"), X("phone")], domain="org"),
    Table("territory", "Geographic area of responsibility", [
        FK("org_id", "organization", True), FK("manager_id", "app_user", od="set_null"),
        FK("default_rep_id", "app_user", od="set_null", note="receives new prospects"), S("name", True),
        S("boundary_geojson")], [X("org_id"), X("manager_id"), U("org_id", "name")], domain="org"),
    Table("territory_rep", "Reps working in a territory (M:N)", [
        FK("territory_id", "territory", True, "cascade"), FK("user_id", "app_user", True, "cascade")],
        [U("territory_id", "user_id"), X("user_id")], domain="org"),
    Table("territory_postal_code", "Postal codes covered by a territory", [
        FK("territory_id", "territory", True, "cascade"), FK("postal_code", "postal_area", True)],
        [U("postal_code"), X("territory_id")], domain="org"),
    Table("account_category", "Shop categories (bakery, cafe...)", [
        FK("org_id", "organization", True), S("name", True), N("default_visit_frequency_days")],
        [U("org_id", "name")], domain="org"),
    Table("ai_permission", "Autonomy mode per org x role x action type", [
        FK("org_id", "organization", True), FK("role_code", "role", True), FK("action_type_code", "action_type", True),
        E("mode", MODES, True)], [U("org_id", "role_code", "action_type_code")], domain="org"),
    Table("alert_rule", "Admin-tunable alert thresholds", [
        FK("org_id", "organization", True), FK("alert_type_code", "alert_type", True), N("threshold_value"),
        N("window_days"), B("enabled", True)], [U("org_id", "alert_type_code")], domain="org"),
    Table("icp_criterion", "ICP scoring weights", [
        FK("org_id", "organization", True),
        E("criterion", ["category_fit", "near_route", "size_activity", "replaceable_brands", "reviews_traffic"], True),
        N("weight", True)], [U("org_id", "criterion")], domain="org"),
    Table("icp_category", "Target categories for prospecting", [
        FK("org_id", "organization", True), FK("category_id", "account_category", True, "cascade")],
        [U("org_id", "category_id")], domain="org"),

    # ------------------------------------------------------------ CRM core
    Table("account", "Shop / business: prospect, customer or lost", [
        FK("org_id", "organization", True), S("name", True), E("account_type", ACCOUNT_TYPES, True),
        FK("category_id", "account_category"), S("vat_number"), S("street"), FK("postal_code", "postal_area"),
        N("lat"), N("lng"), S("phone"), S("email"), S("website"), FK("territory_id", "territory", od="set_null"),
        FK("owner_rep_id", "app_user", od="set_null"),
        E("source", ["manual", "import", "prospecting", "erp"], True), D("customer_since"),
        N("visit_frequency_days", note="overrides category default"), S("external_ref", note="ERP code")],
        [X("owner_rep_id"), X("territory_id"), U("org_id", "vat_number"), X("postal_code"), X("account_type"),
         G("name"), X("external_ref")], domain="crm"),
    Table("contact", "Person at an account", [
        FK("account_id", "account", True, "cascade"), S("full_name", True), S("role_title"), S("phone"), S("email"),
        B("is_decision_maker", True), E("preferred_channel", ["email", "phone", "whatsapp", "viber"])],
        [X("account_id"), X("email"), X("phone")], domain="crm"),
    Table("deal", "Sales opportunity", [
        FK("account_id", "account", True), FK("owner_id", "app_user", True), FK("stage_code", "deal_stage", True),
        S("title", True), N("amount_minor"), D("expected_close_date"), S("next_step"),
        DT("last_activity_at", note="denormalized cache for deal_stuck; see data model 3NF exceptions"),
        DT("closed_at")],
        [X("account_id"), X("owner_id"), X("stage_code", "last_activity_at"), X("expected_close_date")], domain="crm"),
    Table("product_category", "Product categories", [FK("org_id", "organization", True), S("name", True)],
          [U("org_id", "name")], domain="crm"),
    Table("product", "What the organization sells", [
        FK("org_id", "organization", True), FK("category_id", "product_category"), S("sku", True), S("name", True),
        E("unit", ["kg", "piece", "box", "litre", "pack"], True), N("list_price_minor", True), B("active", True)],
        [U("org_id", "sku"), G("name"), X("category_id")], domain="crm"),
    Table("visit_plan", "Weekly suggested plan per rep", [
        FK("rep_id", "app_user", True), D("week_start", True), E("status", ["proposed", "accepted", "edited"], True),
        DT("accepted_at")], [U("rep_id", "week_start")], domain="planning"),
    Table("visit", "Planned or completed visit", [
        FK("account_id", "account", True), FK("rep_id", "app_user", True), FK("plan_id", "visit_plan", od="set_null"),
        E("origin", ["plan", "manual", "buddy", "manager", "calendar", "alert"], True), D("planned_date", True),
        N("route_position"), E("status", ["planned", "done", "skipped"], True), S("purpose"), S("outcome"),
        DT("planned_start_at", note="Planned meeting start; drives the pre-meeting brief and the post-visit prompt (REQ-MTG-001/005)"),
        N("planned_duration_min", note="Planned meeting length; default 30"),
        S("skip_reason"), DT("started_at"), DT("completed_at")],
        [X("rep_id", "planned_date", "route_position"), X("account_id"), X("plan_id")], domain="crm"),
    Table("voice_log", "Recording / utterance + transcript + processing state", [
        FK("rep_id", "app_user", True), FK("account_id", "account"), FK("visit_id", "visit", od="set_null"),
        E("capture_mode", ["live_buddy", "offline_recording", "typed"], True), S("wonderful_conversation_id"),
        S("language"), S("audio_ref"), S("transcript"),
        E("status", ["offline", "uploaded", "transcribing", "processing", "needs_confirmation", "completed", "failed"], True),
        S("error"), S("idempotency_key", True), DT("recorded_at", True), DT("processed_at"), N("processing_ms")],
        [X("rep_id", "status"), U("idempotency_key"), X("account_id")], domain="voice"),
    Table("ai_action", "Everything the AI did or proposed; undo source", [
        FK("org_id", "organization", True), FK("on_behalf_of", "app_user", True),
        E("agent", ["debrief", "briefing", "alerts", "email", "import", "planner", "lifecycle", "discount", "buddy", "research"], True),
        FK("action_type_code", "action_type", True), S("target_table"), S("target_id"),
        FK("voice_log_id", "voice_log", od="set_null"),
        E("status", ["suggested", "applied", "undone", "rejected"], True), S("reason"), S("payload_json"),
        S("before_snapshot_json"), S("after_snapshot_json"), DT("applied_at"), DT("undone_at"),
        FK("undone_by", "app_user", od="set_null")],
        [X("voice_log_id"), X("on_behalf_of", "status"), X("target_id")], domain="voice"),
    Table("deal_stage_history", "Stage transitions", [
        FK("deal_id", "deal", True, "cascade"), FK("from_stage_code", "deal_stage"), FK("to_stage_code", "deal_stage", True),
        FK("changed_by", "app_user", od="set_null"), FK("ai_action_id", "ai_action", od="set_null"), DT("changed_at", True)],
        [X("deal_id")], domain="crm"),
    Table("sales_order", "Actual or draft order", [
        FK("account_id", "account", True), FK("deal_id", "deal", od="set_null"), FK("rep_id", "app_user", True),
        E("status", ["draft", "confirmed", "cancelled"], True), E("source", ["manual", "voice", "erp", "import"], True),
        D("order_date", True), FK("voice_log_id", "voice_log", od="set_null"), S("external_ref")],
        [X("account_id", "order_date"), X("rep_id"), X("status"), X("deal_id")], domain="crm"),
    Table("order_line", "Order lines (unit comes from product)", [
        FK("order_id", "sales_order", True, "cascade"), N("line_no", True), FK("product_id", "product", True),
        N("quantity", True), N("unit_price_minor", True), N("discount_pct")],
        [U("order_id", "line_no"), X("product_id")], domain="crm"),
    Table("activity", "Anything that happened: visit, call, email, message, note", [
        FK("account_id", "account", True), FK("actor_user_id", "app_user", od="set_null"),
        FK("contact_id", "contact", od="set_null"), FK("visit_id", "visit", od="set_null"),
        FK("voice_log_id", "voice_log", od="set_null"),
        E("activity_type", ["visit", "call", "email", "message", "note", "rehearsal"], True),
        E("source", ["human", "ai", "connection"], True), S("body"), DT("occurred_at", True)],
        [X("account_id", "occurred_at"), X("actor_user_id"), X("voice_log_id")], domain="crm"),
    Table("task", "Something to be done", [
        FK("account_id", "account"), FK("owner_id", "app_user", True), FK("deal_id", "deal", od="set_null"),
        S("title", True), B("is_customer_promise", True), DT("due_at"),
        E("status", ["open", "done", "cancelled"], True), E("source", ["human", "ai"], True),
        FK("voice_log_id", "voice_log", od="set_null")],
        [X("owner_id", "status", "due_at"), X("account_id")], domain="crm"),
    Table("problem", "Customer's open issue", [
        FK("account_id", "account", True), S("description", True),
        E("status", ["open", "in_progress", "resolved"], True), D("due_date"), DT("resolved_at"),
        FK("voice_log_id", "voice_log", od="set_null")], [X("account_id", "status")], domain="crm"),
    Table("competitor", "Competitor names", [FK("org_id", "organization", True), S("name", True)],
          [U("org_id", "name")], domain="crm"),
    Table("competitor_signal", "Competition intel from the field", [
        FK("account_id", "account", True), FK("competitor_id", "competitor", True),
        FK("reported_by", "app_user", True), S("statement", True), N("price_delta_pct"), DT("observed_at", True),
        FK("voice_log_id", "voice_log", od="set_null")],
        [X("competitor_id", "observed_at"), X("account_id")], domain="crm"),
    Table("account_assignment_history", "Ownership transfers", [
        FK("account_id", "account", True, "cascade"), FK("from_rep_id", "app_user", od="set_null"),
        FK("to_rep_id", "app_user", True), FK("transferred_by", "app_user", True), DT("transferred_at", True),
        S("reason")], [X("account_id")], domain="crm"),
    Table("account_metrics", "DERIVED rollup, rebuilt hourly by metrics-rollup", [
        FK("account_id", "account", True, "cascade"), N("avg_order_interval_days"), D("last_order_date"),
        N("days_since_last_order"), D("last_visit_date"), N("risk_score", note="0-100"), S("risk_reasons"),
        DT("computed_at", True)], [U("account_id")], domain="crm", derived=True),

    # ------------------------------------------------------------ approvals & discounts
    Table("approval", "Supertype: anything waiting for a human decision", [
        FK("ai_action_id", "ai_action", od="set_null"),
        E("kind", ["customer_message", "discount", "terms", "conversion"], True),
        FK("requested_by", "app_user", True), FK("approver_id", "app_user", True),
        E("mode", ["live", "async"], True),
        E("status", ["pending", "approved", "countered", "sent", "failed", "rejected", "expired", "escalated"], True),
        FK("decided_by", "app_user", od="set_null"), DT("decided_at"), S("decision_note"),
        E("decided_via", ["app", "voice_buddy", "phone_call", "sms_link"]), DT("due_at"), DT("expires_at")],
        [U("ai_action_id"), X("approver_id", "status", "due_at"), X("kind"), X("requested_by")], domain="voice"),
    Table("message_approval", "Subtype: customer-facing message detail", [
        FK("approval_id", "approval", True, "cascade"), FK("channel_code", "channel", True),
        FK("contact_id", "contact", od="set_null"), S("recipient_address", True), S("subject"), S("draft_body", True),
        S("final_body"), DT("sent_at"), S("external_message_id"), S("failure_reason")],
        [U("approval_id")], domain="voice"),
    Table("discount_policy", "Discount limits; most specific active rule wins", [
        FK("org_id", "organization", True), FK("role_code", "role"), FK("user_id", "app_user", od="cascade"),
        FK("product_category_id", "product_category"), FK("account_category_id", "account_category"),
        N("max_discount_pct", True), D("valid_from"), D("valid_to"), B("active", True)],
        [X("org_id", "role_code"), X("user_id"), X("active")], domain="voice"),
    Table("discount_request", "Subtype: discount request detail", [
        FK("approval_id", "approval", True, "cascade"), FK("account_id", "account", True),
        FK("deal_id", "deal", od="set_null"), FK("policy_id", "discount_policy", od="set_null"),
        N("requested_pct", True), N("policy_limit_pct", True, "snapshot at request time"), N("approved_pct"),
        S("justification"), FK("voice_log_id", "voice_log", od="set_null"),
        S("buddy_conversation_id", note="live buddy conversation to relay the decision into (S8)")],
        [U("approval_id"), X("account_id"), X("deal_id")], domain="voice"),
    Table("discount_request_line", "Products and quantities in a discount request", [
        FK("discount_request_id", "discount_request", True, "cascade"), FK("product_id", "product", True),
        N("quantity", True)], [U("discount_request_id", "product_id")], domain="voice"),
    Table("manager_call", "Live outbound call attempts to the approver", [
        FK("approval_id", "approval", True, "cascade"), FK("callee_id", "app_user", True), N("attempt_no", True),
        S("wonderful_conversation_id"),
        E("outcome", ["queued", "ringing", "answered", "no_answer", "busy", "voicemail", "failed"], True),
        DT("started_at", True), DT("ended_at")], [X("approval_id")], domain="voice"),
    Table("buddy_call", "Outbound calls and WhatsApp pings from merc-buddy to a rep (REQ-BUD-014/015)", [
        FK("user_id", "app_user", True, "cascade"), E("channel", ["call", "whatsapp"], True),
        E("purpose", ["callback", "briefing", "approval_decided", "alert", "eod", "pre_visit", "post_visit", "debrief_confirm"], True), S("reason"),
        DT("due_at", True), S("ref_table"), S("ref_id"), S("wonderful_conversation_id"), S("template_name"),
        E("status", ["scheduled", "started", "answered", "no_answer", "busy", "voicemail", "sent", "failed", "cancelled"], True),
        S("failure_reason"), DT("started_at"), DT("ended_at")],
        [X("user_id"), X("status", "due_at")], domain="voice"),

    # ------------------------------------------------------------ prospecting
    Table("prospect_search", "A prospecting run", [
        FK("org_id", "organization", True), FK("requested_by", "app_user", True),
        FK("category_id", "account_category"), S("area_text"),
        E("origin", ["manual", "route", "list_upload", "single_add"], True),
        E("status", ["running", "done", "failed"], True), N("found_count"), N("duplicate_count"),
        S("procedure_run_id")], [X("org_id"), X("requested_by")], domain="prospecting"),
    Table("candidate", "A shop found by prospecting", [
        FK("search_id", "prospect_search", True, "cascade"), S("business_name", True), S("vat_number"), S("street"),
        FK("postal_code", "postal_area"), N("lat"), N("lng"), S("phone"), S("website"),
        E("external_source", ["registry", "directory", "csv", "rep"], True), S("external_ref"),
        E("status", ["new", "duplicate", "researched", "scored", "added", "dismissed", "failed"], True),
        FK("matched_account_id", "account", od="set_null"), FK("converted_account_id", "account", od="set_null"),
        FK("assigned_rep_id", "app_user", od="set_null")],
        [X("search_id"), X("status"), X("vat_number"), X("website"), X("assigned_rep_id")], domain="prospecting"),
    Table("dossier", "Research dossier (exactly one of candidate_id / account_id)", [
        FK("candidate_id", "candidate", od="cascade"), FK("account_id", "account", od="cascade"), S("summary"),
        E("price_level", ["low", "mid", "premium"]), DT("researched_at"), S("research_task_id")],
        [U("candidate_id"), U("account_id")], domain="prospecting"),
    Table("dossier_fact", "One researched fact with its source", [
        FK("dossier_id", "dossier", True, "cascade"),
        E("fact_type", ["product", "brand", "price", "review_theme", "catalog_item", "opening_hours", "size_signal"], True),
        S("value", True), FK("competitor_id", "competitor", od="set_null"), S("source_url", True),
        DT("retrieved_at", True)], [X("dossier_id"), X("fact_type")], domain="prospecting"),
    Table("candidate_score", "ICP score", [
        FK("candidate_id", "candidate", True, "cascade"), N("score", True, "0-100"), S("model_profile"),
        DT("scored_at", True)], [X("candidate_id")], domain="prospecting"),
    Table("candidate_score_reason", "Up to 3 reasons per score", [
        FK("score_id", "candidate_score", True, "cascade"), N("rank", True), S("criterion"), S("reason", True)],
        [U("score_id", "rank")], domain="prospecting"),

    # ------------------------------------------------------------ engagement
    Table("briefing", "The rep's daily plan", [
        FK("rep_id", "app_user", True), D("briefing_date", True), S("script_text"),
        E("status", ["generated", "delivered", "read"], True), DT("delivered_at"),
        E("delivery_channel", ["screen", "voice", "notification"])], [U("rep_id", "briefing_date")], domain="engagement"),
    Table("briefing_item", "Ordered items of a briefing", [
        FK("briefing_id", "briefing", True, "cascade"), N("position", True),
        E("item_type", ["promise_due", "stop", "at_risk", "new_prospect", "nearby_shop", "campaign", "pending_approval",
                        "target_progress", "decision_received"], True),
        S("ref_table"), S("ref_id"), S("display_text", True)], [U("briefing_id", "position")], domain="engagement"),

    # ------------------------------------------------------------ meeting loop (REQ-MTG-*)
    Table("product_guidance", "Company guidance: which product to push or avoid, per account category, and why (REQ-MTG-003)", [
        FK("org_id", "organization", True), FK("product_id", "product", True, "cascade"),
        FK("category_id", "account_category", note="Null = every category"),
        E("stance", ["push", "avoid"], True), S("reason", True, "Short reason the rep can say or act on"),
        N("priority", True, "Higher wins; ties break on product name"), D("valid_from"), D("valid_to"), B("active", True)],
        [X("org_id", "stance", "active"), X("product_id"), X("category_id")], domain="crm"),
    Table("visit_brief", "The pre-meeting brief generated for one visit and how it was delivered (REQ-MTG-001..004)", [
        FK("visit_id", "visit", True, "cascade"), FK("rep_id", "app_user", True), FK("account_id", "account", True),
        S("bullets_text", True, "Bullets exactly as sent, one per line"), S("spoken_script"),
        FK("push_product_id", "product", od="set_null"), S("push_reason"), FK("push_guidance_id", "product_guidance", od="set_null"),
        FK("avoid_product_id", "product", od="set_null"), S("avoid_reason"), FK("avoid_guidance_id", "product_guidance", od="set_null"),
        E("channel", ["whatsapp", "call", "app"]), E("status", ["generated", "sent", "called", "failed", "skipped"], True),
        FK("buddy_call_id", "buddy_call", od="set_null"), DT("generated_at", True), DT("sent_at"),
        E("rating", ["useful", "not_useful"])],
        [U("visit_id"), X("rep_id"), X("account_id"), X("push_product_id"), X("avoid_product_id"), X("push_guidance_id"),
         X("avoid_guidance_id"), X("buddy_call_id")], domain="engagement"),
    Table("debrief_confirmation", "Short summary of a logged visit sent to the rep to confirm or fix (REQ-MTG-006/007)", [
        FK("voice_log_id", "voice_log", True, "cascade"), FK("rep_id", "app_user", True), FK("visit_id", "visit", od="set_null"),
        E("channel", ["whatsapp", "app", "call"], True), S("summary_text", True, "Bullets built in code from the result card lines"),
        E("status", ["pending", "sent", "confirmed", "corrected", "no_reply", "failed"], True),
        FK("buddy_call_id", "buddy_call", od="set_null"), S("reply_text"), DT("sent_at"), DT("replied_at"),
        FK("correction_voice_log_id", "voice_log", od="set_null", note="The follow-up debrief that carried the correction")],
        [U("voice_log_id"), X("rep_id", "status"), X("visit_id"), X("buddy_call_id"), X("correction_voice_log_id")], domain="engagement"),
    Table("rep_feedback", "Every rep reaction to a brief or a debrief summary; the learning signal (REQ-MTG-007/008)", [
        FK("rep_id", "app_user", True, "cascade"), FK("account_id", "account", od="set_null"),
        E("kind", ["brief_useful", "brief_not_useful", "debrief_confirmed", "debrief_corrected"], True),
        FK("visit_brief_id", "visit_brief", od="set_null"), FK("debrief_confirmation_id", "debrief_confirmation", od="set_null"),
        FK("product_id", "product", od="set_null", note="The push product of the brief, copied for the not-repeat rule"),
        S("detail", note="What the rep said was wrong, verbatim"), B("exported_to_evals", True)],
        [X("rep_id"), X("account_id", "kind"), X("visit_brief_id"), X("debrief_confirmation_id"), X("product_id")], domain="engagement"),
    Table("alert", "Notifications with a suggested action", [
        FK("alert_type_code", "alert_type", True), FK("recipient_id", "app_user", True),
        FK("account_id", "account", od="cascade"), FK("deal_id", "deal", od="set_null"), FK("task_id", "task", od="set_null"),
        FK("territory_id", "territory", od="set_null"), FK("competitor_id", "competitor", od="set_null"),
        E("severity", ["low", "medium", "high"], True), E("status", ["open", "done", "dismissed"], True),
        S("dedupe_key", True), S("message", True), DT("resolved_at")],
        [U("dedupe_key"), X("recipient_id", "status"), X("account_id")], domain="engagement"),
    Table("campaign", "Manager instruction to reps", [
        FK("org_id", "organization", True), FK("created_by", "app_user", True), S("title", True), S("message", True),
        D("starts_on", True), D("ends_on", True), E("status", ["draft", "active", "ended"], True)],
        [X("org_id", "status")], domain="engagement"),
    Table("campaign_product", "Products promoted", [
        FK("campaign_id", "campaign", True, "cascade"), FK("product_id", "product", True)],
        [U("campaign_id", "product_id")], domain="engagement"),
    Table("campaign_territory", "Target territories", [
        FK("campaign_id", "campaign", True, "cascade"), FK("territory_id", "territory", True, "cascade")],
        [U("campaign_id", "territory_id")], domain="engagement"),
    Table("campaign_category", "Target account categories", [
        FK("campaign_id", "campaign", True, "cascade"), FK("category_id", "account_category", True, "cascade")],
        [U("campaign_id", "category_id")], domain="engagement"),
    Table("campaign_rep", "Target reps", [
        FK("campaign_id", "campaign", True, "cascade"), FK("user_id", "app_user", True, "cascade")],
        [U("campaign_id", "user_id")], domain="engagement"),
    Table("campaign_exposure", "Funnel events: shown, pitched, ordered", [
        FK("campaign_id", "campaign", True, "cascade"), FK("account_id", "account", True, "cascade"),
        FK("rep_id", "app_user", True), E("stage", ["shown", "pitched", "ordered"], True),
        FK("voice_log_id", "voice_log", od="set_null"), FK("order_id", "sales_order", od="set_null"),
        S("evidence_quote"), DT("occurred_at", True)],
        [X("campaign_id", "stage"), X("account_id")], domain="engagement"),

    # ------------------------------------------------------------ import & rollups & governance
    Table("data_import", "File upload job", [
        FK("org_id", "organization", True), FK("uploaded_by", "app_user", True),
        E("data_type", ["accounts", "contacts", "orders", "products", "visits"], True), S("file_ref"),
        E("status", ["uploaded", "mapping", "preview", "confirmed", "importing", "imported", "failed"], True),
        N("rows_total"), N("rows_imported"), N("rows_with_issues"), B("is_baseline", True), DT("confirmed_at"),
        S("procedure_run_id")], [X("org_id", "status")], domain="import"),
    Table("import_column_mapping", "Detected column mapping", [
        FK("import_id", "data_import", True, "cascade"), S("source_column", True), S("target_field"),
        N("confidence"), B("confirmed", True)], [U("import_id", "source_column")], domain="import"),
    Table("import_row_issue", "Row-level problems found", [
        FK("import_id", "data_import", True, "cascade"), N("row_no", True),
        E("issue_type", ["duplicate", "invalid_vat", "invalid_phone", "invalid_address", "missing_required", "unknown_reference"], True),
        S("detail")], [X("import_id")], domain="import"),
    Table("kpi_daily", "DERIVED daily rollup per rep (dashboards)", [
        FK("rep_id", "app_user", True), D("day", True), N("visits_done"), N("voice_logs"), N("voice_logs_within_1h"),
        N("new_customers"), N("ai_actions_applied"), N("ai_actions_undone"), N("approvals_approved"),
        N("approvals_rejected"), N("pipeline_amount_minor"), N("weighted_pipeline_minor"), N("revenue_minor"),
        N("crm_completeness_pct"), N("customers_saved"), N("discount_requests"), N("discounts_approved")],
        [U("rep_id", "day"), X("day")], domain="rollup", derived=True),
    Table("visit_change", "History of moves/skips/adds", [
        FK("visit_id", "visit", True, "cascade"), FK("changed_by", "app_user", True),
        E("change_type", ["moved", "skipped", "added", "reordered", "assigned"], True), D("from_date"), D("to_date"),
        S("reason"), E("via", ["app", "buddy", "manager", "planner"], True)], [X("visit_id")], domain="planning"),
    Table("sales_target", "Targets; exactly one scope: org (both null), territory or user", [
        FK("org_id", "organization", True), FK("territory_id", "territory", od="cascade"),
        FK("user_id", "app_user", od="cascade"), E("metric", ["revenue", "volume", "visits", "new_customers"], True),
        D("period_start", True), D("period_end", True), N("target_value", True), FK("set_by", "app_user", True)],
        [X("user_id"), X("territory_id"), X("period_start", "period_end")], domain="planning"),
    Table("usage_event", "Daily usage per user (pricing / cost)", [
        FK("user_id", "app_user", True), D("day", True),
        E("kind", ["voice_minutes", "llm_calls", "research_runs", "sms", "outbound_call_minutes", "emails_sent"], True),
        N("quantity", True)], [U("user_id", "day", "kind")], domain="rollup"),
    Table("audit_event", "Human admin actions (GDPR, settings, transfers)", [
        FK("org_id", "organization", True), FK("actor_id", "app_user", True),
        E("action", ["contact_export", "contact_erase", "settings_change", "bulk_transfer", "target_change",
                     "permission_change", "user_change"], True),
        S("target_table"), S("target_id"), S("detail"), DT("occurred_at", True)],
        [X("target_table", "target_id"), X("actor_id")], domain="governance"),
]


# Enum values for lookup seeds that code depends on (also in contracts/seed)
LOOKUP_CODES = {
    "role": ["rep", "manager", "admin"],
    "deal_stage": ["new", "qualified", "proposal", "negotiation", "won", "lost"],
    "alert_type": ["going_quiet", "deal_stuck", "close_date_passed", "promise_due", "competition_wave",
                   "visit_overdue", "rep_not_logging", "approval_overdue"],
    "channel": ["email", "whatsapp", "viber", "call", "meeting"],
}
