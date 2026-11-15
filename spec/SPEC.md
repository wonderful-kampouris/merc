# Merc · Product specification (normative)

Version 1.1 · 2026-11-15 · GenAI Summit Hackathon, Wonderful track, Team Delta. 1.1 adds the meeting loop (MTG, journey J5) and the freeze scope.

This file states **what must be true** of Merc. Each requirement has an ID, a priority, an acceptance check, and links to the contracts that make it concrete. Builder agents implement work packages (in `../docs/03-progress.md`) that cite these IDs. Independent verifiers check the acceptance column.

- **Normative words.** MUST, MUST NOT and SHOULD are binding. Text outside the tables is context.
- **Contracts win on shape.** Exact request, response, column and event shapes live in `contracts/` (see `contracts/README.md`). When this file and a contract disagree, raise an OPEN item. Do not pick one silently.
- **Notation.** `fn:<slug>` is a Wonderful Function, `tbl:<name>` is a table in schema `merc`, and `metrics.md#x` is `contracts/metrics.md`.
- **Priorities.** P0 is the demo (journeys J1 to J4). P1 is the pilot. P2 comes after the pilot.
- **Who builds.** Every component is built by builder agents from this spec, including the voice buddy `merc-buddy` and the approver `merc-approver`. No component is hand-built outside the work-package flow.
- **Sources.** `../merc-business-spec/merc-business-en/` (business), `../docs/00` to `06` (architecture, data model, needs, methodology).

## 1. Scope and demo

Merc is an AI field-sales CRM for small B2B distributors. Reps talk and Merc does the CRM work. Managers and the CEO see the truth without chasing anyone.

| Journey | Story | Must show |
|---|---|---|
| J1 | Nikos's day: morning briefing, visit card at Café Miltos, spoken debrief, result card with undo, follow-up email approved by voice | BRF, CRD, DEB, APR, BUD |
| J2 | Eleni pushes Espresso Nuovo to cafés. It appears in briefings and cards, Nikos pitches it, the funnel moves | CMP, BRF, CRD, DEB |
| J3 | The customer asks for 8% off. Above Nikos's limit, the buddy phones Eleni live, she counters 6%, Nikos hears it in the same conversation. Variant: no answer, async with SLA | DSC, APV, BUD |
| J4 | "Find bakeries in Chalandri": 18 found, 5 duplicates removed, dossiers and scores, top one added to the route | PRS, PLN |
| J5 | **Merc before and after the meeting.** 30 minutes before Café Miltos, Nikos gets a WhatsApp brief: why this visit, the grinder problem, his usual 12 kg, push Espresso Nuovo and avoid Frappé Instant, each with a reason. He taps "Call me" and hears it while driving. After the visit Merc asks how it went, he talks a debrief, and a WhatsApp summary arrives. He taps "Fix", corrects one item, and the correction is stored as feedback | MTG, BUD, DEB, CRD |

**Freeze scope (code freeze 2026-11-15 18:00 Athens).** The demo is J5, plus the J1 pieces it reuses: visit card, spoken debrief, result card with undo, buddy by app, phone and WhatsApp. Out of freeze scope: discounts and the approver (DSC, APV, J3), prospecting (PRS, J4), AI import (IMP) and the management screens. Their requirements stay valid for the pilot. Builds already running may finish, but they gate nothing before the freeze. The work queue marks the cut packages.

## 2. Requirements

### CORE · Platform rules

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-CORE-001 | P0 | One Wonderful workspace MUST be one organization. All data MUST live in schema `merc`, created from `contracts/tables/_order.json`. | A clean workspace gets every table from the contracts with no manual edits. | contracts/tables/_order.json |
| REQ-CORE-002 | P0 | Caller identity MUST come from the platform (app session, tool session, call metadata) and be resolved by the shared `me()`. It MUST NOT be a request field. | Passing another user's id in any body changes nothing. A spoofing test gets `forbidden` or is ignored. | `fn:me` |
| REQ-CORE-003 | P0 | **Rule A.** A number that is stored or spoken as fact MUST come from code or a query. The LLM only extracts what was said, with an evidence quote, or rates, routes and words things. | On the debrief eval set, every number absent from the utterance comes back null, with a missing-field question, 100% of the time. | contracts/metrics.md, contracts/llm/debrief_extraction.json |
| REQ-CORE-004 | P0 | **Rule B.** There MUST be one business layer, a shared library used by both functions and agent tools (OPEN-10). Tools MUST NOT reimplement rules. | Each tool's handler calls the same library function as its backing Wonderful Function. A code search finds no duplicated rule. | contracts/tools/merc-buddy/log_visit.json |
| REQ-CORE-005 | P0 | Every AI write MUST be an `tbl:ai_action` with action type, class, mode, before snapshot and source. The mode comes from `tbl:ai_permission` for the user's role. internal is auto with undo, draft creates a draft, external and structural ask, destructive never. | For every seeded action type, an AI attempt follows its mode. No external send happens without an approved `tbl:approval`. | contracts/tables/ai_action.json, contracts/tables/action_type.json |
| REQ-CORE-006 | P0 | Undo MUST restore the before snapshot exactly and delete rows the action created. | A round-trip test for each internal action type leaves the touched rows byte-identical. | `fn:ai-action-undo` |
| REQ-CORE-007 | P0 | Money MUST be integer minor units in the org currency. Percentages MUST be 0-100, except signed deltas (`*_delta_pct`), which are -100 to 100. Dates MUST use the org timezone. | The validator and a unit test reject floats in `*_minor` fields. | contracts/README.md |
| REQ-CORE-008 | P0 | Errors MUST use the `Error` schema with a stable code. | Contract tests check the error shape for 404, 403, 422 and 409. | contracts/_defs.json |
| REQ-CORE-009 | P0 | Visibility MUST follow roles. A rep sees owned and territory records, a manager sees the team, an admin sees everything. App relations and function queries both enforce it. | Rep A cannot read rep B's account outside a shared territory, by app or by voice. | contracts/app/app.json |
| REQ-CORE-010 | P1 | Human admin actions (GDPR, settings, transfers, targets, permissions, users) MUST write `tbl:audit_event`. | Each admin function writes exactly one audit row. | contracts/tables/audit_event.json |
| REQ-CORE-011 | P0 | Live updates MUST go over `fn:merc-live` using the event contracts. Screens MUST still work by polling if the socket is down. | With WebSocket blocked, the result card still appears within 10 s of processing. | contracts/events/result_card.ready.json |
| REQ-CORE-012 | P0 | Greek is the default language and English is supported. Merc answers in the language the user speaks and never translates proper names. | The buddy eval runs in both languages and code-switching cases pass. | contracts/agents/merc-buddy.json |

### DEB · Voice visit logging (feature A)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-DEB-001 | P0 | A rep MUST be able to log a visit by talking to the buddy, or by recording in the app (with an offline queue). | Both paths produce one `tbl:voice_log` and one result card. | `fn:debrief-process`, `fn:voice-log-upload` |
| REQ-DEB-002 | P0 | `fn:debrief-process` MUST extract per the debrief LLM contract and apply internal actions automatically. The p95 is under 20 s. | In J1, a 40 s Greek debrief yields a note, a problem update, a task, a deal update and a follow-up draft in under 20 s. | contracts/llm/debrief_extraction.json |
| REQ-DEB-003 | P0 | The result card MUST list each action with undo, the missing-field questions, the pending approvals and a spoken summary. | The card renders in the app and the buddy reads the summary. Undo works from both. | contracts/_defs.json |
| REQ-DEB-004 | P0 | Each extracted item MUST carry evidence that is a normalized substring of the utterance. Items failing this MUST be dropped and asked about. | An eval with planted hallucinations drops 100% of them. | contracts/llm/debrief_extraction.json |
| REQ-DEB-005 | P0 | A follow-up message MUST be drafted in the rep's style as a `customer_message` approval. It MUST NOT be sent without approval. | J1: the draft appears, "yes send it" sends it, and the `tbl:message_approval` status becomes sent. | `fn:draft-message`, `fn:approval-resolve` |
| REQ-DEB-006 | P0 | Promises to the customer MUST become tasks with `is_customer_promise`, and their due dates resolve relative to today. | "I'll bring samples Thursday" creates a task due on the coming Thursday. | `tbl:task` |
| REQ-DEB-007 | P0 | Competitor mentions MUST create `tbl:competitor_signal` rows, linked to known competitors when names match. | "Aroma offered 15% less" stores a signal with delta -15. | `tbl:competitor_signal` |
| REQ-DEB-008 | P1 | A campaign pitched with evidence MUST create a pitched `tbl:campaign_exposure`. | J2 moves the funnel's "pitched" count by one. | contracts/metrics.md |
| REQ-DEB-009 | P0 | Uploads MUST be idempotent on `idempotency_key`. Offline recordings MUST sync when back online. | Uploading the same key twice returns `duplicate=true` with the same voice log. | `fn:voice-log-upload` |
| REQ-DEB-010 | P0 | Order intent MUST create a draft `tbl:sales_order`. Confirming it needs the rep's explicit confirmation. | "Put down 12 kilos" creates a draft order that stays a draft until confirmed. | `fn:order-upsert` |
| REQ-DEB-011 | P1 | Audio MUST be purged after `recording_retention_days`. Transcripts are kept. | After running the purge, recordings past retention have a null audio reference. | `fn:retention-purge` |

### BRF · Morning briefing (feature B)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-BRF-001 | P0 | At the org `briefing_time`, a briefing MUST be generated per rep. It has deterministic items and a spoken script of at most 90 s. | The cron creates exactly one briefing per rep per day, and its numbers are a subset of the items. | `fn:briefing-generate`, contracts/llm/briefing_script.json |
| REQ-BRF-002 | P0 | Items MUST cover: today's stops with the reason, promises due, at-risk customers, pending approvals, the campaign of the week, target progress and new candidates. | The seeded J1 briefing contains each item type that has data. | `tbl:briefing_item` |
| REQ-BRF-003 | P0 | "What's my day" MUST make the buddy read the briefing script as is, then offer the first stop. | Buddy eval J1-open passes. | `fn:briefing-get` |
| REQ-BRF-004 | P0 | The Today screen MUST work offline from the last cached data. | In airplane mode the Today screen still shows today's stops. | `fn:today-get` |

### CRD · Visit card and questions (features C, M)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-CRD-001 | P0 | A customer card MUST show contacts, open problems, tasks, recent orders, metrics with risk reasons, alerts, suggested products, campaigns, how to talk to them, and a spoken summary of at most 30 s. | Café Miltos's card mentions the grinder problem and the 12 kg usual order. | `fn:visit-card-get`, contracts/_defs.json |
| REQ-CRD-002 | P0 | A prospect card MUST show dossier facts with sources, a pitch with exactly 3 arguments, objections with answers, and the competitor brands seen. | Café Avra's card lists BlueBean as its current brand, with a source URL. | contracts/llm/visit_card_pitch.json |
| REQ-CRD-003 | P0 | Account resolution MUST try an exact or fuzzy name in scope, then today's visits, then the nearest account. The buddy MUST ask when the match is ambiguous. | "I'm at Miltos" resolves. "The café" with 2 matches makes the buddy ask. | `fn:account-resolve` |
| REQ-CRD-004 | P0 | `fn:ask-crm` MUST answer factual questions only through safe templates. When no template fits, the buddy says it doesn't know. | "When did Lofos last order?" returns the seeded date. An off-template question gets "I don't know". | contracts/llm/ask_crm_route.json |
| REQ-CRD-005 | P0 | Product questions MUST be answered from the catalog (price, unit, availability). | "How much is Espresso Nuovo?" returns 21.50. | `fn:product-lookup` |
| REQ-CRD-006 | P1 | Pitch rehearsal: the buddy plays the owner using the card's objections, then gives 3 feedback points. | Buddy eval rehearsal passes. | contracts/agents/merc-buddy.json |

### MTG · Meeting loop: brief before, capture and confirm after (J5)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-MTG-001 | P0 | Every 5 minutes, `fn:previsit-briefs-due` MUST create one `tbl:visit_brief` for each planned visit whose `planned_start_at` is within the org's `previsit_lead_minutes` (default 30), and deliver it on the rep's `notify_channel`. WhatsApp bullets are the default; `call` places one outbound buddy call. Each visit gets exactly one brief. Outside call hours only WhatsApp is used. | Café Miltos at 10:45: at 10:15 Nikos gets one WhatsApp brief. Running the cron again sends nothing. | `fn:previsit-briefs-due`, `fn:buddy-call-start` |
| REQ-MTG-002 | P0 | The brief MUST have at most 6 bullets in this order: why this visit, the open problem or promise, orders against usual, the product to push with its reason, the product to avoid with its reason, and how to talk to them. Every number MUST come from rows (Rule A). The spoken script is at most 45 s. | The Miltos brief names the grinder, 12 kg, Espresso Nuovo to push and Frappé Instant to avoid. On the visit-brief eval set, 100% of numbers are grounded. | `fn:visit-brief-get`, contracts/llm/visit_brief_bullets.json |
| REQ-MTG-003 | P0 | Code MUST choose the push and avoid products from `tbl:product_guidance`, active campaigns and open problems, as metrics.md#visit-brief-hints says. The company profile in the Context Hub KB `merc-company` (values, positioning, what we never do) shapes the wording only. The LLM MUST NOT add or swap a product. | On the seed the Miltos brief pushes Espresso Nuovo and avoids Frappé Instant. Deactivating Nuovo's guidance row makes the next brief push Hot Chocolate, because plant milk and syrup were ordered in the last 30 days. An LLM output naming another product is rejected. | `tbl:product_guidance`, contracts/metrics.md |
| REQ-MTG-004 | P0 | The rep MUST be able to get the same brief three ways: tap "Call me" on the WhatsApp brief (one outbound call that reads the script), call the Merc number (the buddy offers the brief when a visit starts within 60 minutes), or ask the buddy in the app. | Tapping "Call me" rings Nikos's phone in under 30 s and the buddy reads the Miltos script. | `fn:visit-brief-get`, contracts/tools/merc-buddy/get_visit_brief.json |
| REQ-MTG-005 | P0 | When a visit's planned end plus `postvisit_prompt_minutes` (default 10) passes with no debrief, `fn:postvisit-prompts-due` MUST prompt the rep once: "How did it go at Café Miltos?". The rep answers by calling back, by "Call me" or by typing. Merc MUST NOT record or listen to the customer meeting. It only hears the rep. | At 11:25 one prompt arrives. A visit already debriefed gets none. | `fn:postvisit-prompts-due` |
| REQ-MTG-006 | P0 | Within 60 s of a debrief completing, Merc MUST send one confirmation per voice log. It has at most 6 bullets built in code from the result card lines (no LLM) and the quick replies Correct, Fix and "Brief did not help". It goes on WhatsApp when the rep has it, else to the app. | The J5 debrief yields one WhatsApp summary in under 60 s whose bullets match the result card. | `fn:debrief-confirm-send`, `fn:debrief-confirm-due`, `tbl:debrief_confirmation` |
| REQ-MTG-007 | P0 | Correct MUST mark the confirmation confirmed. Fix MUST let the rep say what is wrong. The buddy undoes the named actions and logs the correction as a new debrief linked to the original. Every reply MUST write one `tbl:rep_feedback`. No reply within 4 h means no_reply, and the actions stay applied and undoable. | "Fix: it was 10 kg, not 12" undoes the draft order line, logs the corrected one and stores debrief_corrected with the rep's words. | `fn:feedback-record`, `fn:ai-action-undo` |
| REQ-MTG-008 | P0 | Feedback MUST change what Merc does, in code. A push product marked "Brief did not help" is not pushed again at that account for 30 days. Corrected debriefs are exported as eval cases (utterance, wrong fields, corrected fields) into `evals/debrief/field/`. | After "Brief did not help", the next Miltos brief pushes Hot Chocolate instead of Espresso Nuovo. The export adds one case per correction. | `tbl:rep_feedback`, contracts/metrics.md |
| REQ-MTG-009 | P1 | Outside the 24 h WhatsApp window, briefs and confirmations MUST use the approved templates `merc_previsit_brief` and `merc_debrief_confirm`. Inside it they are interactive free-form messages with the same buttons. Without WhatsApp they fall back to push and the app (OPEN-21). | With the window closed the template is used. With no WhatsApp the result card appears in the app. | contracts/platform/platform.json |

### ALR · Alerts (feature E)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-ALR-001 | P0 | Every hour, `fn:alerts-engine` MUST evaluate each enabled `tbl:alert_rule` for 8 alert types, dedupe on the dedupe key, and push `alert.created`. | Running it twice on the seed creates no duplicates. Lofos raises going_quiet. | contracts/metrics.md, `tbl:alert` |
| REQ-ALR-002 | P0 | Each alert MUST carry a suggested action. Acting on it can draft a message, plan a visit or create a task. | "Plan a visit" on the Lofos alert adds a visit tomorrow. | `fn:alert-act` |
| REQ-ALR-003 | P0 | `fn:metrics-rollup` MUST compute account usual frequency and risk exactly as metrics.md says. | Unit tests on seeded accounts match hand-computed values. | contracts/metrics.md |
| REQ-ALR-004 | P1 | Manager alerts (rep not logging, competition wave, approval overdue) MUST go to the rep's manager. | 3 seeded Aroma signals in the North raise one competition_wave alert for Eleni. | `fn:alerts-list` |
| REQ-ALR-005 | P1 | Customers past the lost rule MUST become `lost` through an undoable AI action. | Old Mill Café becomes lost, and undo restores it to customer. | `fn:account-lifecycle` |

### APR · Approvals for customer messages and conversions (feature F)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-APR-001 | P0 | External and structural actions MUST create a `tbl:approval` with a preview. The rep approves, edits or rejects it in the app or by voice. | "Yes send it" approves. "Change Thursday to Friday" edits, then approves. | `fn:approval-resolve`, `fn:approvals-list` |
| REQ-APR-002 | P0 | An approved message MUST be sent synchronously by `fn:approval-resolve`, in the rep's own identity through the per-user Gmail connection (OPEN-03, spike S3), idempotently on the approval. The status becomes sent or failed. Procedures and crons MUST NOT send customer messages, because they have no user identity. | One approval gives exactly one sent email, even when approved twice. | `fn:message-send`, `fn:approval-resolve` |
| REQ-APR-003 | P0 | Pending customer-message approvals MUST expire after `approval_expiry_hours`. | The cron moves stale approvals to expired. | `fn:approvals-expire` |
| REQ-APR-004 | P0 | Converting a prospect to a customer MUST go through an approval unless `tbl:ai_permission` allows it. | Converting Café Avra creates a conversion approval. | `fn:account-convert` |

### DSC · Discount approval in 3 tiers

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-DSC-001 | P0 | **Tier 1.** `fn:discount-check` MUST resolve the limit as metrics.md#discount-limit says. Within the limit, it records an automatic `discount_within_limit` AI action. | 3% for Nikos on coffee is allowed. 5% on bakery supplies to a bakery is allowed. 8% is not. | contracts/metrics.md, `tbl:discount_policy` |
| REQ-DSC-002 | P0 | **Tier 2 (live).** Above the limit, `fn:discount-request` with mode live MUST start one outbound call to the approver through `merc-approver`, using the single-call API with `call_purpose` carrying the approval id (spike S7). The phone rings in under 30 s. | J3: Eleni's phone rings in under 30 s. | contracts/agents/merc-approver.json, `tbl:manager_call` |
| REQ-DSC-003 | P0 | The approver call MUST: brief in one sentence built from rows, accept only approve, counter-offer or reject, read the decision back, and record it. | Approver eval: approve, counter and reject paths pass. Off-topic talk is deflected. | `fn:approver-brief`, `fn:approval-decide` |
| REQ-DSC-004 | P0 | A counter-offer MUST be below the requested % and within the approver's own limit. The function enforces this. | A 9% counter on an 8% request is rejected with `validation_failed`. | `fn:approval-decide` |
| REQ-DSC-005 | P0 | The rep MUST hear the decision inside the same buddy conversation (status polling), with push and SMS as the fallback (spike S8). | J3: Nikos hears "Eleni offered 6%" without leaving the call. | `fn:approval-status`, contracts/events/approval.decided.json |
| REQ-DSC-006 | P0 | **Tier 3 (async).** On no answer, busy, voicemail, failure, outside call hours, no caller id, or `manager_call_enabled=false`, the request MUST become async. `due_at` is set from the SLA, the approver gets push and an inbox item (and SMS once an SMS sender exists), and the requester gets a task. No outcome within 90 s counts as no answer. | The J3 variant: no answer leads to async within 2 minutes, and the approver sees the request in the inbox. | `fn:manager-call-outcome` |
| REQ-DSC-007 | P0 | Async approvals past `due_at` MUST escalate as metrics.md#approval-sla says. | Seeding an overdue request and running the watch escalates it to Thanasis. | `fn:approval-sla-watch` |
| REQ-DSC-008 | P0 | Voicemail MUST NOT contain commercial details. | Approver eval voicemail passes: no %, no customer name. | contracts/agents/merc-approver.json |
| REQ-DSC-009 | P0 | Managers MUST be able to decide from a mobile approvals screen in one tap, with an optional counter %. | Eleni approves from a phone browser. | `fn:manager-approvals-list` |

### PLN · Visit planning

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-PLN-001 | P0 | Every Sunday at 18:00, `fn:visit-plan-suggest` MUST propose next week's plan per rep, deterministically, as metrics.md#visit-plan says. | The same seed gives the same plan. No day has more than `visits_per_day` visits. | contracts/metrics.md, `tbl:visit_plan` |
| REQ-PLN-002 | P0 | The rep MUST be able to accept or edit the plan in the app or by voice. | "Accept my week" sets the plan to accepted. | `fn:visit-plan-accept`, `fn:visit-plan-get` |
| REQ-PLN-003 | P0 | Moving, skipping, adding or reordering a visit MUST record a `tbl:visit_change` with the reason and source. Exceeding the daily cap returns a warning. | "Move Lofos to Friday" logs a moved change made via the buddy. | `fn:visit-update` |
| REQ-PLN-004 | P0 | Managers MUST be able to assign visits and tasks to their reps. | Eleni assigns a visit to Dimitra, and it appears on Dimitra's Today screen. | `fn:visit-assign`, `fn:task-assign` |

### PRS · Prospecting (feature D)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-PRS-001 | P0 | `fn:prospect-search` MUST start the prospecting pipeline. The requester gets `candidates.ready` within 5 minutes for about 20 shops. | J4: 18 found, 5 duplicates, 13 scored, in under 5 minutes. | contracts/procedures/prospecting-pipeline.json |
| REQ-PRS-002 | P0 | Dedupe MUST apply, in order: VAT, website domain, phone, then normalized name plus postal code. | The seeded prospect list flags exactly the 5 expected duplicates with the right rule. | `fn:candidate-dedupe`, contracts/seed/prospect_list_chalandri_bakeries.json |
| REQ-PRS-003 | P0 | `merc-research` MUST build a dossier from the shop's own website and official registries or directories. Every fact keeps its source URL and retrieval time. | Each dossier fact has a source URL. A shop with no website gets a registry-only dossier. | contracts/agents/merc-research.json, `fn:dossier-save` |
| REQ-PRS-004 | P0 | Scoring MUST combine the LLM's per-criterion ratings with weights in code, and store the top 3 reasons. The near-route rating comes from distance. | Re-scoring the same dossier gives the same score within ±1. | contracts/llm/candidate_score.json, `fn:candidate-score` |
| REQ-PRS-005 | P0 | Research MUST NOT scrape maps or review platforms. Facts from such hosts are rejected. | `fn:dossier-save` rejects a google.com/maps source. | `fn:dossier-save` |
| REQ-PRS-006 | P0 | Adding a candidate to the route MUST create a prospect account, move the dossier to it, and offer a visit. | The top J4 bakery appears in this week's plan. | `fn:candidate-act` |
| REQ-PRS-007 | P0 | Until spike S5 picks a source (OPEN-05), the CSV fallback MUST work. | The pipeline runs on the seeded CSV. | `fn:directory-search` |
| REQ-PRS-008 | P1 | A rep MUST be able to add a shop they spotted, by voice or in the app. | "New bakery next to Miltos" creates a candidate. | `fn:candidate-add` |

### CMP · Campaigns (feature J)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-CMP-001 | P1 | A manager MUST be able to create a campaign from free text. Names resolve against products, territories, categories and reps, and unresolved names are listed. | "Push Espresso Nuovo to cafés in North and Center this week" fills the form. | `fn:campaign-draft-from-text`, contracts/llm/campaign_from_text.json |
| REQ-CMP-002 | P1 | Active campaigns MUST appear in the targeted reps' briefings and visit cards. | J2: Nikos's briefing and Café Miltos's card show the campaign. | `fn:campaign-upsert` |
| REQ-CMP-003 | P1 | The campaign funnel (shown, pitched, ordered) MUST follow metrics.md#campaign-funnel. | J2 shows the funnel moving from 0 to 1 pitched. | `fn:campaign-funnel` |

### TGT · Sales targets

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-TGT-001 | P0 | Managers MUST be able to set targets per rep, territory or org for revenue, volume, visits or new customers over a period. | Targets are created for the seed, and an overlapping duplicate is rejected. | `fn:target-upsert`, `tbl:sales_target` |
| REQ-TGT-002 | P0 | Progress MUST follow metrics.md#target-progress and show in the briefing, `fn:my-performance` and the dashboard. | "How am I doing this month?" returns pct and days left from the query. | `fn:targets-list`, `fn:my-performance` |

### DSH · Manager and CEO views (feature H)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-DSH-001 | P1 | `fn:dashboard-kpis` MUST return the KPI set by period, territory and rep, computed from `tbl:kpi_daily` and the live tables. | The seed's KPIs match a hand query. | `fn:dashboard-kpis`, contracts/metrics.md |
| REQ-DSH-002 | P1 | Every KPI MUST drill down to the list of records behind it. | Clicking at-risk lists exactly the accounts counted. | `fn:kpi-drilldown` |
| REQ-DSH-003 | P1 | Rep detail MUST show activity, logging discipline, pipeline and alerts. Transcripts show only if OPEN-13 allows. | Eleni opens Nikos's detail. | `fn:rep-detail` |
| REQ-DSH-004 | P1 | Before/after against the baseline MUST be shown, as metrics.md#before-after defines it. | The dashboard shows completeness before and after go-live. | `fn:kpi-rollup` |
| REQ-DSH-005 | P1 | A weekly summary (to managers and admins) and a monthly report (to admins) MUST be emailed by `merc-ops`, with numbers only from summary data. | The Monday 07:00 email arrives with figures matching the dashboard. | `fn:weekly-summary`, `fn:monthly-report`, `fn:summary-data` |
| REQ-DSH-006 | P1 | A competition view MUST list competitor signals by competitor, territory and time. | It shows 3 Aroma signals in the North. | `fn:competitor-signals-list` |

### IMP · AI import (feature K)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-IMP-001 | P1 | An admin MUST be able to upload a spreadsheet. AI maps the columns with a confidence score, and anything below 0.6 asks for confirmation. A preview comes before apply. | A messy 200-row Excel file maps correctly with at most 2 confirmations. | `fn:import-start`, `fn:import-confirm`, contracts/procedures/import-pipeline.json |
| REQ-IMP-002 | P1 | Import MUST clean phones (E.164), VAT (9 digits), duplicates and addresses, and report row issues. | Row issues list each bad row with the reason. | `fn:import-analyze`, `tbl:import_row_issue` |
| REQ-IMP-003 | P1 | An import flagged baseline MUST feed the before/after metrics. | A baseline import shows up in the before period. | `tbl:data_import` |

### SET · Settings and administration (features I, L)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-SET-001 | P1 | Admins MUST be able to edit org settings, AI permissions per role and action, alert rules, ICP and discount policies. | Changing rep `send_email` to never blocks drafts from becoming approvals. | `fn:settings-get`, `fn:settings-update` |
| REQ-SET-002 | P1 | Admins MUST be able to manage users, roles and managers. | Inviting a rep gives them the Rep app. | `fn:users-list`, `fn:user-upsert` |
| REQ-SET-003 | P1 | Territories and bulk transfers MUST move open visits and tasks. Customer memory follows the account. | Transferring Lofos to Dimitra moves its open task too. | `fn:territory-upsert`, `fn:assignments-transfer` |
| REQ-SET-004 | P1 | GDPR export and erase MUST be human-only and audited. No agent tool may call them. | No tool contract references `contact-erase`. | `fn:contact-export`, `fn:contact-erase` |
| REQ-SET-005 | P1 | Usage (voice minutes, LLM calls, research runs, SMS, call minutes, emails) MUST be counted per user per day. | `tbl:usage_event` matches the platform counters within 5%. | `fn:usage-flush` |

### BUD · Voice buddy `merc-buddy` (built by agents)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-BUD-001 | P0 | `merc-buddy` MUST be a Wonderful Agents V2 conversational voice agent, embedded in the Rep app through the Chat SDK in voice mode (spike S2). | The rep talks to it from the Today screen on a phone. | contracts/agents/merc-buddy.json |
| REQ-BUD-002 | P0 | The rep's identity MUST reach the buddy as a signed Chat SDK user token minted by `fn:merc-chat-token`, whose HMAC-signed claims the tools verify (OPEN-08). It is never asked for and never taken from model output. | The tool logs show `caller` set by code in every tool call. | contracts/agents/merc-buddy.json |
| REQ-BUD-003 | P0 | The buddy MUST have exactly the tools in `contracts/tools/merc-buddy/` and the skills in its agent contract. Every tool calls the shared library. | The agent's tool list matches INDEX.md. | contracts/INDEX.md |
| REQ-BUD-004 | P0 | The buddy MUST NOT say a number, date or price that is not in a tool result. | The eval "invent a price" fails closed 100% of the time. | contracts/agents/merc-buddy.json |
| REQ-BUD-005 | P0 | Before any external or structural action, the buddy MUST read the draft or summary and get an explicit yes. | Eval: "send it" without a draft makes the buddy ask which one. | `fn:approval-resolve` |
| REQ-BUD-006 | P0 | The buddy MUST use short turns (at most 2 sentences unless reading a script), allow barge-in, and answer in the rep's language. | Voice eval transcript review passes. First audio comes in under 1.5 s (REQ-NFR-002). | contracts/agents/merc-buddy.json |
| REQ-BUD-007 | P0 | When an account is resolved, the buddy MUST attach customer memory. Memories hold tone and context, never numbers. | The second visit's card mentions a preference stated in the first. | contracts/tools/merc-buddy/resolve_account.json |
| REQ-BUD-008 | P0 | The log-visit tool MUST pass the rep's words verbatim. | An eval compares the tool argument to the transcript segment. | contracts/tools/merc-buddy/log_visit.json |
| REQ-BUD-009 | P0 | Buddy evals MUST cover J1 to J4, both languages and adversarial cases. | The eval suite passes at 90% or more before the demo freeze. | contracts/agents/merc-buddy.json |
| REQ-BUD-010 | P1 | End of day: a spoken summary of what got done and what is open tomorrow. | "Wrap up" gives a summary of at most 45 s. | `fn:eod-summary` |
| REQ-BUD-011 | P1 | "Tell my manager" MUST create a task for the manager with context. | Eleni gets a task linked to the account. | `fn:escalate` |
| REQ-BUD-012 | P0 | The rep MUST reach the same `merc-buddy` by calling the Merc number (`MERC_BUDDY_NUMBER`, Wonderful SIP over a Twilio trunk) and by WhatsApp, with the same skills and tools as browser voice. | Nikos calls the Merc number while driving and logs a visit; he WhatsApps "τι έχω σήμερα;" and gets today's stops. | contracts/agents/merc-buddy.json |
| REQ-BUD-013 | P0 | On phone and WhatsApp the rep's identity MUST come from the platform channel number (`communication.fromNumber` inbound, `toNumber` outbound) matched to exactly one active `app_user.phone` with `phone_channel_enabled`. An unknown number gets no data. It is never taken from what the caller says. | A call from an unknown number hears "Merc doesn't know this number" and no tool returns data. | `fn:buddy-call-start` |
| REQ-BUD-014 | P0 | The buddy MUST be able to call the rep (`call_me_back`, approval decided, morning briefing if `notify_channel=call`, pre-visit brief and post-visit prompt per MTG) through one outbound call per request, from `MERC_BUDDY_NUMBER`, only to the rep's own number, between 07:30 and 21:00 org time. | "Call me when Eleni decides" -> the rep's phone rings with the decision. | `fn:buddy-call-start` |
| REQ-BUD-015 | P1 | If an outbound buddy call is not answered, Merc MUST send one WhatsApp template ping (`merc_buddy_ping`) when the rep has WhatsApp, else push and inbox. No call retries. | Voicemail -> one WhatsApp message "Merc: Eleni approved 8% for Fournos Kostas. Reply or call back." | `fn:buddy-call-outcome` |
| REQ-BUD-016 | P1 | On phone the buddy MUST keep answers to at most 2 sentences and offer to WhatsApp long content (lists, drafts). External actions still need the read-back and an explicit yes (REQ-APR-002). | "Read me the draft" on a call -> the first line, then "I'll WhatsApp you the full text." | contracts/agents/merc-buddy.json |

### APV · Approver agent `merc-approver` (built by agents)

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-APV-001 | P0 | `merc-approver` MUST be an outbound voice agent started by a single outbound call per request (`POST /v1/agents/outbound`, OPEN-07). Campaigns are not installed on the tenant. | `fn:discount-request` starts exactly one call and stores its conversation id. | contracts/agents/merc-approver.json |
| REQ-APV-002 | P0 | It MUST follow the behavior list in its contract and only use its 3 tools. | Approver eval passes all paths. | contracts/tools/merc-approver/record_approval_decision.json |
| REQ-APV-003 | P0 | Calls MUST happen only between 08:00 and 20:00 org time, enforced in `fn:discount-request`. Outside that window, requests go async. | A request at 21:00 becomes async without a call. | contracts/agents/merc-approver.json |

### APP · Wonderful App `merc`

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-APP-001 | P0 | One Wonderful App MUST hold the rep screens (mobile-first) and the management screens, with permissions, roles and relations as in the app contract. | Each screen calls only its listed functions. | contracts/app/app.json |
| REQ-APP-002 | P0 | The Rep app MUST work in a phone browser (spike S1). | Screenshots from a real phone show Today, Record and Approvals. | contracts/app/app.json |
| REQ-APP-003 | P0 | Today and Record MUST work offline. Recordings queue and upload later. | An airplane-mode recording uploads on reconnect. | `fn:voice-log-upload` |
| REQ-APP-004 | P0 | An AI log screen MUST list AI actions with undo, for the rep and the manager. | Undo from the log works. | `fn:ai-actions-list` |
| REQ-APP-005 | P0 | The app MUST be in Greek by default, with English as an option. | A language toggle switches all labels. | contracts/app/app.json |

### OPS · Build, deploy, operate

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-OPS-001 | P0 | Everything MUST deploy from the repo with `wful` or Terraform to a dev workspace and a demo workspace. | A fresh demo workspace comes up with a single command. | contracts/platform/platform.json |
| REQ-OPS-002 | P0 | The seed loader MUST resolve the relative tokens and load in the seed order. The result is deterministic. | Loading twice gives identical rows, and the demo day looks live. | contracts/seed/_order.json |
| REQ-OPS-003 | P0 | The monitors in the platform contract MUST be created. | The debrief latency monitor fires on an injected slow run. | contracts/platform/platform.json |
| REQ-OPS-004 | P0 | Eval suites (buddy, approver, debrief, research, and the other LLM schemas) MUST run in CI and gate demo promotion. | A failing eval blocks promotion. | contracts/llm/debrief_extraction.json |
| REQ-OPS-005 | P0 | Secrets MUST live in Wonderful secrets only, and never in the repo or logs. | A repo scan finds no keys. | contracts/platform/platform.json |
| REQ-OPS-006 | P0 | Contracts MUST validate cleanly before every wave starts. | The build exits 0. | contracts/README.md |

### NFR · Non-functional

| ID | P | Requirement | Acceptance | Contracts |
|---|---|---|---|---|
| REQ-NFR-001 | P0 | The debrief p95 MUST be under 20 s, and the result card is visible within 25 s of stopping the recording. | Load test: 20 debriefs, p95 measured. | `fn:debrief-process` |
| REQ-NFR-002 | P0 | Buddy first audio SHOULD come in under 1.5 s. Tool calls during a conversation SHOULD finish in under 3 s, except log-visit. | Measured from the voice eval logs. | contracts/agents/merc-buddy.json |
| REQ-NFR-003 | P0 | Functions MUST respect the 30 s default timeout and the 1 MB body limit. Longer work goes to procedures, crons or async with push. | Only cron and procedure-called functions declare a timeout over 60 s. | contracts/INDEX.md |
| REQ-NFR-004 | P0 | Greek extraction accuracy MUST be at least 90% field-level on the debrief eval set. | The eval report shows it. | contracts/llm/debrief_extraction.json |
| REQ-NFR-005 | P0 | No personal data in function logs. Phone numbers and emails are masked. | A log sample review finds none. | contracts/README.md |
| REQ-NFR-006 | P1 | The app MUST handle 50 reps and 5,000 accounts per org with list p95 under 1 s. | A synthetic seed load test passes. | contracts/tables/_order.json |

## 3. Open items

Each OPEN item is resolved by a spike or a decision, logged in `../docs/03-progress.md`, and then this file is updated.

| ID | Question | Resolution or owner | Default or next step |
|---|---|---|---|
| OPEN-03 | Per-user email send path. | **Resolved by S3.** A function called in the rep's identity can use the per-user Gmail connection; procedures and crons cannot. | Send from `fn:approval-resolve`. One real send still needs a test Gmail OAuth. |
| OPEN-04 | Transcription of recordings made in the app. | **Resolved by S4.** Inline base64 audio to a Gemini model inside `fn:voice-log-upload`: 39 s of Greek in 2.1 s. | Model profile `merc-transcribe`, created in the UI. |
| OPEN-05 | Prospect source. | **Resolved by S5.** OpenStreetMap Overpass works now. GEMI Open Data needs a personal api_key. | Overpass plus the seeded CSV. GEMI once the key exists. |
| OPEN-07 | Outbound call to the manager. | **Partly resolved by S7.** The single-call API works up to dialing. Campaigns are not installed, there is no Greek caller id of ours, and no SMS-capable number. | Async tier with push and inbox until a caller id and a service account exist. |
| OPEN-08 | Rep identity in the voice session. | **Partly resolved by S2/S9.** Tools never see the app user. Use a signed Chat SDK token from `fn:merc-chat-token` with HMAC claims. | Implemented in shared/core. One runtime check of the metadata key is pending. |
| OPEN-09 | Nested JSON bodies. | **Resolved by S9.** Nested POST bodies arrive typed. | Closed. |
| OPEN-10 | Shared library in tools and functions. | **Resolved by S9 and WP-CORE-01.** `@merc/core` lives in the workspace Shared Library and is imported by both. | Closed. |
| OPEN-11 | Hands-free phone access while driving. | **Answered by the team.** Phone (inbound + outbound) and WhatsApp channels on the same buddy (REQ-BUD-012..016), Twilio SIP per Aris's runbook. | Build it; browser voice stays the primary channel in the demo until the number is live. |
| OPEN-12 | Real discount limits per role and category (Q8). | Thanasis | Seed values: rep 3% (5% for bakery supplies to bakeries), manager 10%. |
| OPEN-13 | Can managers read or listen to reps' debriefs (Q13)? | Thanasis | Managers see results, not transcripts. |
| OPEN-14 | When a customer counts as lost (Q14). | Thanasis | max(60 days, 3 x usual frequency). |
| OPEN-15 | Targets set in Merc or imported from the ERP (Q15). | Thanasis | Set in Merc. |
| OPEN-16 | Is the J2 campaign funnel in the demo (Q16)? If yes, CMP becomes P0. | Thanasis | P1. Build it in wave 3 if time allows. |
| OPEN-17 | Reps sign in to Wonderful on their phones, or use the external share link? | Team | Signed-in App for reps and managers; share link only as a demo fallback (S1). |
| OPEN-18 | Do deployed functions have egress to overpass-api.de and the GEMI API? | WP-PRS-01 | Test in the first prospecting deploy. |
| OPEN-19 | WhatsApp setup "in FSM": which tenant/workspace holds the WABA and number, can a voice agent own a WhatsApp number, and is template `merc_buddy_ping` approved? | Team (see HUMAN-STEPS) | Assign the number to merc-buddy; if voice agents can't hold it, a chat twin merc-buddy-chat with the same tools. |
| OPEN-20 | Caller-id spoofing on PSTN: number match alone identifies the rep. | Team | Accept for the hackathon (WhatsApp numbers are Meta-verified). Later: a 4-digit spoken PIN before external actions on inbound calls. |
| OPEN-21 | WhatsApp for the meeting loop: are templates `merc_previsit_brief` and `merc_debrief_confirm` (with quick-reply buttons) approved, and does the WhatsApp channel pass voice notes to the agent? | Team (see HUMAN-STEPS) | Demo opens the 24 h window with a morning message from Nikos, so free-form interactive messages work without templates. Voice notes: P1; the rep calls back or types. |
| OPEN-22 | Where do visit start times come from in the pilot (planner, rep, calendar)? | Thanasis | Seeded times for the demo; `infra/demo` shifts the Miltos visit to start 31 minutes after reset. Calendar sync is P1. |

## 4. Change control
- Changing a requirement means editing this file, the affected `_build` sources, and the work package. Then run the build.
- A new requirement gets the next free ID in its module. IDs are never reused.
- The orchestrator logs each change in the decisions log of `../docs/03-progress.md`.
