"""Work-package queue. Source of PROGRESS.md and wp/WP-*.md. Only the orchestrator edits this file.
Run: python3 -I wp/queue.py
"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464"   # hackathon tenant, personal workspace  = dev
DEMO = "6f6d70c8-6864-40f6-8b70-19ddf8b8923c"  # hackathon tenant, Team Delta workspace = demo

# id, title, wave, prio, reqs, owns, depends_on, acceptance, status, replaces(old progress ids)
W = []
def wp(id, title, wave, prio, reqs, owns, deps, acc, status="todo", old="", contracts=""):
    W.append(dict(id=id, title=title, wave=wave, prio=prio, reqs=reqs, owns=owns, deps=deps, acc=acc,
                  status=status, old=old, contracts=contracts, owner="", evidence=""))

# ---------------------------------------------------------------- wave 0: spikes
wp("WP-SPK-01", "Spikes S1+S2: Wonderful App in a phone browser; Chat SDK voice widget inside the App", 0, "P0",
   "REQ-APP-002, REQ-BUD-001", "spikes/s1-s2/**, docs/spikes/S1-S2.md", [],
   ["hello-world App deployed to dev with a public/internal URL", "a test voice agent embedded with @wonderful/chat (voice) in that App",
    "report: URL, auth model on mobile, mic permission behaviour, decision internal vs external app (progress 0.8)",
    "human step listed: open the URL on a real phone and talk"], old="S1, S2, 0.8")
wp("WP-SPK-02", "Spikes S3+S4: per-user Gmail send from a Function vs from a tool; offline audio transcription", 0, "P0",
   "REQ-APR-002, REQ-DEB-001, OPEN-03, OPEN-04", "spikes/s3-s4/**, docs/spikes/S3-S4.md", [],
   ["documented answer for OPEN-03 with doc citations and a test function/tool in dev that attempts the send path (no real customer address)",
    "documented transcription path for an uploaded recording (OPEN-04) with a working call on a short Greek clip if any STT API exists",
    "human steps listed (OAuth a test Gmail)"], old="S3, S4")
wp("WP-SPK-03", "Spikes S5+S6: prospect source for Greek shops; website scraping quality", 0, "P0",
   "REQ-PRS-003, REQ-PRS-005, REQ-PRS-007, OPEN-05", "spikes/s5-s6/**, docs/spikes/S5-S6.md", [],
   ["ranked list of allowed sources (registries such as GEMI, open data, directory APIs) with terms-of-use notes; maps/review scraping excluded",
    "for the best source: a sample query for bakeries in Chalandri (15231-15234) or the reason it is impossible, plus CSV fallback confirmed",
    "3 real Greek cafe/bakery websites fetched and the dossier facts extractable from them listed; Firecrawl key presence checked"], old="S5, S6")
wp("WP-SPK-04", "Spikes S7+S8: start one outbound call to the manager from a Function; relay the decision into the live buddy conversation", 0, "P0",
   "REQ-DSC-002, REQ-DSC-005, REQ-APV-001, OPEN-07", "spikes/s7-s8/**, docs/spikes/S7-S8.md", [],
   ["documented API path: campaign + consumer created from code, phone numbers available in the tenant, call metadata passing, outcome hook",
    "dry-run proof up to (not including) dialing a real number; NO real calls",
    "S8 options compared (polling tool, hold/wait, push+SMS) with a recommendation", "human step listed: one real test call to a team phone"],
   old="S7, S8")
wp("WP-SPK-05", "Spikes S9+S10: identity injection, shared lib in tools, nested bodies; exact Tables/Function/Tool payload shapes", 0, "P0",
   "REQ-CORE-002, REQ-CORE-004, REQ-BUD-002, OPEN-08, OPEN-09, OPEN-10, REQ-OPS-006", "spikes/s9-s10/**, docs/spikes/S9-S10.md", [],
   ["a test table created in schema merc_spike with an auto_uuid PK, a FK and a unique index, then deleted (only that spike table)",
    "a test function receiving a nested JSON POST body; how the caller identity reaches a function called from an App",
    "how an Agents V2 tool gets session metadata and whether it can import the workspace shared lib",
    "report lists the exact create payloads so build.py writers can be corrected"], old="S9")

# ---------------------------------------------------------------- wave 1: foundations
wp("WP-QA-01", "Contracts package: TS types + JSON-schema validators + mock handlers generated from spec/contracts", 1, "P0",
   "REQ-OPS-006, REQ-CORE-008", "packages/contracts/**", [],
   ["`pnpm -C packages/contracts build` generates types for every function request/response, _defs, events, llm schemas",
    "validator `validateRequest(slug, body)` / `validateResponse(slug, body)` with tests on 5 functions",
    "mock handler per function returning schema-valid sample data (seed-backed where possible)",
    "`pnpm -C packages/contracts test` passes; regeneration is one command after build.py"], old="0.5")
wp("WP-INF-01", "Table creation script: schema merc + 64 tables from contracts, idempotent, run on dev", 1, "P0",
   "REQ-CORE-001", "infra/tables/**", ["WP-SPK-05"],
   ["`infra/tables/apply.sh --workspace <id>` creates all tables in _order.json, adds deferred self-refs, re-run is a no-op",
    "dev workspace lists 64 tables in schema merc with FKs and indexes", "writer mismatches vs contracts reported (for build.py fix)"],
   old="1.1-1.9")
wp("WP-INF-02", "Seed loader: resolve tokens, load contracts/seed in order, reset mode", 1, "P0",
   "REQ-OPS-002", "infra/seed/**", ["WP-INF-01"],
   ["unit tests for token resolution (@D, @D-3@09:30, @WEEK_START, @MONTH_*, @wuid)",
    "`infra/seed/load.sh --workspace <id> --demo-day YYYY-MM-DD [--reset]` loads all seed rows on dev",
    "check query: Bistro Lofos days since last order = 12 on demo day"], old="1.10, 7.13")
wp("WP-CORE-01", "Shared lib @merc/core: table data access, me(), scope checks, errors, contract validation", 1, "P0",
   "REQ-CORE-002, REQ-CORE-004, REQ-CORE-007, REQ-CORE-008, REQ-CORE-009", "shared/core/**", ["WP-QA-01", "WP-SPK-05"],
   ["typed CRUD per table (from contracts) over the Wonderful tables API, with org/scope filters",
    "me() resolves the platform caller to app_user; scope helpers owner/territory/team",
    "unit tests with an in-memory table fake; packaging decided per S9 (workspace shared lib or bundled)"], old="1.12, 2.1, 2.2")
wp("WP-CORE-02", "LLM helper + model profiles: structured calls validated against contracts/llm, evidence check helper", 1, "P0",
   "REQ-CORE-003, REQ-DEB-004", "shared/llm/**", ["WP-QA-01"],
   ["model profiles merc-extract / merc-write / merc-decide exist on dev", "`callStructured(name, input)` validates input+output against contracts/llm/<name>.json and retries once",
    "evidence-substring + numbers-in-evidence validator with unit tests", "hello-world structured call from a dev function works"], old="0.6")
wp("WP-APP-01", "App scaffold: Wonderful App merc, rep + management shells, routes from app.json, i18n el/en, typed client with mock mode", 1, "P0",
   "REQ-APP-001, REQ-APP-002, REQ-APP-005, REQ-CORE-011", "app/**", ["WP-QA-01", "WP-SPK-01"],
   ["App created on dev, deployed, opens; role-based routing to every screen route in contracts/app/app.json (placeholder screens)",
    "client `call(slug, body)` uses api.invokeFunction, validates with packages/contracts, mock mode on by flag",
    "Greek default, English toggle", "mobile layout for rep shell"], old="3.1")
wp("WP-OPS-01", "Repo layout + deploy scripts: monorepo -> platform repos sync, dev/demo workspace config, check script", 1, "P0",
   "REQ-OPS-001, REQ-OPS-005, REQ-OPS-006", "infra/deploy/**, scripts/**, Makefile", [],
   ["decision on monorepo vs platform repos documented (docs/spikes/repo-layout.md)",
    "`make check` runs build.py + all package tests", "`infra/deploy/deploy.sh <component> --env dev|demo` skeleton for functions/agents/app with workspace ids from one config file",
    "never deploys to demo without --env demo explicitly"], old="0.3, 0.4, 0.7")

# ---------------------------------------------------------------- function ownership (every contract function has exactly one owner)
def fn_owns(slugs):
    return ", ".join([f"shared/handlers/src/{x}.ts, shared/handlers/test/{x}.test.ts, functions/{x}/**" for x in slugs])

FN_ACC = ["handler impl in shared/handlers/src/<slug>.ts runs through @merc/core runFunction; thin wrapper functions/<slug>/ (defineFunction) deployable by infra/deploy",
          "unit tests per handler on the in-memory table fake with seed data; contract tests: request/response validate against spec/contracts/functions/<slug>.json",
          "deployed to dev and attached to app merc (app-callable ones); smoke call on dev seed data meets each listed REQ acceptance (or the exact blocker is reported)"]

def fwp(id, title, wave, prio, reqs, slugs, deps, extra_owns="", extra_acc=(), old=""):
    owns = fn_owns(slugs) + (", " + extra_owns if extra_owns else "")
    wp(id, title, wave, prio, reqs, owns, deps, list(extra_acc) + FN_ACC, old=old, contracts=" ".join(slugs))
    W[-1]["slugs"] = slugs

# ---------------------------------------------------------------- wave 1b: follow-ups from the wave 1 gate
wp("WP-QA-01b", "Contracts package follow-ups: regenerate for 95 functions, counts derived from contracts, export llm purpose/rules/eval_set, validate mock fallbacks", 1, "P0",
   "REQ-OPS-006", "packages/contracts/**", ["WP-QA-01"],
   ["tests derive counts from spec/contracts", "llm export includes purpose, rules, eval_set", "app/app/src/contracts and shared/core generated copies re-synced via their own sync/generate scripts (run them, do not hand-edit)", "make check green"])
wp("WP-INF-03", "build.py emits the verified Tables payload; infra/tables applies it without translation; dry-run reads the platform; apply new column discount_request.buddy_conversation_id on dev", 1, "P0",
   "REQ-CORE-001, REQ-OPS-006", "infra/tables/**, spec/_build/build.py (function table_payload and the table checks only)", ["WP-INF-01"],
   ["contracts/tables/*.json create blocks equal the platform payload (per-column primary_key, reference merc.<t>, index type, names <= 49)",
    "infra/tables applies them; re-run on dev is a no-op apart from the new column", "python3 -I spec/_build/build.py exits 0", "dry-run compares against the platform; temp files cleaned"])
wp("WP-CORE-01b", "Shared lib follow-ups + function pattern: systemPrincipal, org-timezone dates, scope fix, 500 mapping, merge merc-core to shared_lib main, @merc/handlers package skeleton, functions me + merc-chat-token deployed, builder guide", 1, "P0",
   "REQ-CORE-002, REQ-CORE-004, REQ-CORE-007, REQ-CORE-009, REQ-BUD-002",
   "shared/core/**, shared/handlers/package.json, shared/handlers/tsconfig.json, shared/handlers/src/_lib/**, " + fn_owns(["me", "merc-chat-token"]) + ", docs/guides/function-wp.md",
   ["WP-CORE-01"],
   ["systemPrincipal(orgId) for scheduler/procedure callers; today()/range helpers in org timezone, with tests",
    "op-conditions on scoped lists kept; 500 only mapped to conflict after a confirmed unique clash",
    "merc-core merged to shared_lib main on dev; shared/handlers package (impl per file, no barrel) with test helpers in src/_lib (seeded in-memory db, principal builders)",
    "functions me and merc-chat-token deployed to dev and attached to app merc; merc-chat-token returns a clear blocked error while MERC_CHAT_API_KEY is missing",
    "docs/guides/function-wp.md: exact steps to add a handler, wrapper, deploy, attach to the app, smoke-call; every wave 2 builder follows it"])
wp("WP-OPS-01b", "Deploy follow-ups: Makefile ignores ENV from the shell, agent plan shows target, check.sh tolerant of packages without tests and includes shared/handlers", 1, "P1",
   "REQ-OPS-001", "infra/deploy/**, scripts/**, Makefile", ["WP-OPS-01"],
   ["`ENV=demo make plan` does not target demo", "agent plan prints the clone target", "make check covers shared/handlers and stays green"])
wp("WP-APP-01b", "App screen registry: route -> lazy screen module with placeholder fallback; one folder per screen; per-screen i18n dictionaries", 1, "P0",
   "REQ-APP-001, REQ-APP-005", "app/app/src/App.tsx, app/app/src/shell/**, app/app/src/lib/**, app/app/src/screens/registry.ts, app/app/src/screens/README.md", ["WP-APP-01"],
   ["screens/registry.ts maps every app.json route to app/app/src/screens/<shell>/<screen>/index.tsx when present, else the placeholder",
    "a screen can register its own i18n strings from its folder; README explains the contract a screen WP follows (props, client via forScreen, live events)",
    "app tests + build pass; redeployed to dev"])

# ---------------------------------------------------------------- wave 2: core engines (functions)
W1B = ["WP-QA-01b", "WP-CORE-01b", "WP-INF-03", "WP-OPS-01b"]
fwp("WP-CORE-03", "Autonomy engine (propose/apply/undo, ai_permission modes) as shared/autonomy + ai-action-undo, ai-actions-list", 2, "P0",
    "REQ-CORE-005, REQ-CORE-006", ["ai-action-undo", "ai-actions-list"], W1B, extra_owns="shared/autonomy/**",
    extra_acc=["shared/autonomy: propose(action) reads ai_permission -> auto (snapshot + apply + ai_action) / ask (approval row) / never (suggested); destructive always blocked; undo round-trips every internal action type"], old="2.3, 2.4")
fwp("WP-LIVE-01", "merc-live WebSocket + push helper shared/live (rep:{id}, team:{id} channels, event validation)", 2, "P0",
    "REQ-CORE-011", ["merc-live"], W1B, extra_owns="shared/live/**", extra_acc=["shared/live push(event, to) validates against contracts/events and posts to /v1/function-sockets/messages (degrades to no-op with a log when the service account is missing)"], old="2.11")
W2D = W1B + ["WP-CORE-03", "WP-LIVE-01"]
fwp("WP-CRM-01", "Accounts, contacts, problems, account resolution and conversion", 2, "P0", "REQ-CRD-003, REQ-APR-004, REQ-CORE-009",
    ["accounts-list", "account-get", "account-upsert", "account-convert", "contact-upsert", "problem-update", "account-resolve"], W2D, old="2.7")
fwp("WP-CRM-02", "Deals, orders, tasks, escalation", 2, "P0", "REQ-DEB-010, REQ-BUD-011",
    ["deal-upsert", "deals-list", "order-upsert", "orders-list", "task-create", "task-update", "tasks-list", "escalate"], W2D)
fwp("WP-DEB-01", "Debrief: debrief-process + debrief-result-get + golden set evals/debrief", 2, "P0",
    "REQ-DEB-002, REQ-DEB-003, REQ-DEB-004, REQ-DEB-005, REQ-DEB-006, REQ-DEB-007, REQ-DEB-008, REQ-CORE-003, REQ-NFR-001, REQ-NFR-004",
    ["debrief-process", "debrief-result-get"], W2D, extra_owns="evals/debrief/**",
    extra_acc=["golden set of >= 15 utterances (el, en, mixed, noise, half sentence, unknown customer, planted hallucinations); 100% no invented numbers; >= 80% field-level pass",
               "note text and non-numeric fields (e.g. follow_up.channel) grounded: unsupported values dropped and asked", "p95 < 20 s over 10 dev runs"], old="2.5, 2.6, 2.8, 2.12, 3b.4, 3b.5")
fwp("WP-DEB-02", "Voice log upload with inline transcription (merc-transcribe) + retention purge", 2, "P0", "REQ-DEB-001, REQ-DEB-009, REQ-DEB-011",
    ["voice-log-upload", "retention-purge"], W2D, old="2.10, 7.4")
fwp("WP-APR-01", "Customer-message approvals and synchronous send in the rep's identity", 2, "P0", "REQ-APR-001, REQ-APR-002, REQ-APR-003, REQ-DEB-005",
    ["approvals-list", "approval-resolve", "approval-status", "approvals-expire", "draft-message", "message-send"], W2D, old="2.9, 3.9-3.11")
fwp("WP-DSC-01", "Discounts in 3 tiers: check, request (single outbound call), outcome, approver brief, decide, manager list, SLA watch", 2, "P0",
    "REQ-DSC-001, REQ-DSC-002, REQ-DSC-003, REQ-DSC-004, REQ-DSC-005, REQ-DSC-006, REQ-DSC-007, REQ-DSC-009, REQ-APV-003",
    ["discount-check", "discount-request", "manager-call-outcome", "approver-brief", "approval-decide", "manager-approvals-list", "approval-sla-watch"], W2D,
    extra_acc=["live path degrades to async with a clear reason while no caller id / service account exists; never dials a non-team number"], old="3b.1a-f")
fwp("WP-CRD-01", "Visit card (customer + prospect, pitch via merc-write) + Context Hub KBs merc-catalog and merc-playbook", 2, "P0", "REQ-CRD-001, REQ-CRD-002",
    ["visit-card-get"], W2D, extra_owns="content/kb/**, infra/kb/**", extra_acc=["KB content written for the demo catalog and playbook, created in Context Hub on dev, searchable"], old="1.11, 3.4, 3.5")
fwp("WP-CRD-02", "ask-crm safe templates, product lookup, my-performance", 2, "P0", "REQ-CRD-004, REQ-CRD-005, REQ-TGT-002",
    ["ask-crm", "product-lookup", "my-performance"], W2D, extra_owns="evals/ask-crm/**", old="3b.3")
fwp("WP-BRF-01", "Briefing generation and read, today, end of day", 2, "P0", "REQ-BRF-001, REQ-BRF-002, REQ-BRF-003, REQ-BUD-010",
    ["briefing-generate", "briefing-get", "today-get", "eod-summary"], W2D, old="3.15, 3.16")
fwp("WP-ALR-01", "Metrics rollup, alerts engine, alerts list/act, account lifecycle", 2, "P0", "REQ-ALR-001, REQ-ALR-002, REQ-ALR-003, REQ-ALR-004, REQ-ALR-005",
    ["metrics-rollup", "alerts-engine", "alerts-list", "alert-act", "account-lifecycle"], W2D, old="3.12-3.14, 3b.2c")
fwp("WP-PLN-01", "Weekly visit planner, plan get/accept, visit updates, manager assignment", 2, "P0", "REQ-PLN-001, REQ-PLN-002, REQ-PLN-003, REQ-PLN-004",
    ["visit-plan-suggest", "visit-plan-get", "visit-plan-accept", "visit-update", "visit-assign", "task-assign"], W2D, old="3b.2a, 3b.2b, 6b.4")
fwp("WP-PRS-01", "Prospecting functions (Overpass/GEMI/CSV source, dedupe, scoring, candidate actions)", 2, "P0",
    "REQ-PRS-001, REQ-PRS-002, REQ-PRS-004, REQ-PRS-005, REQ-PRS-006, REQ-PRS-007, REQ-PRS-008",
    ["prospect-search", "candidate-add", "candidate-dedupe", "candidate-get", "candidate-score", "candidates-list", "candidate-act", "directory-search", "dossier-save", "search-finalize"], W2D,
    extra_acc=["egress from a deployed function to overpass-api.de tested (OPEN-18)"], old="5.3, 5.5, 5.7, 5.10")

# ---------------------------------------------------------------- wave 3: management functions, agents, procedures, screens
W2ALL = [w["id"] for w in W if w["wave"] == 2]
fwp("WP-MTG-01", "Company profile + pre-meeting brief: product_guidance table, KB merc-company, visit-brief-get with push/avoid in code, visit_brief_bullets evals", 2, "P0",
    "REQ-MTG-002, REQ-MTG-003, REQ-MTG-008", ["visit-brief-get"], W2D + ["WP-CRD-01"],
    extra_owns="content/kb/merc-company/**, evals/visit-brief/**",
    extra_acc=["apply tables product_guidance, visit_brief, debrief_confirmation, rep_feedback and the new visit/organization/buddy_call columns on dev with infra/tables; load the new seed rows",
               "KB merc-company created in Context Hub on dev from content/kb/merc-company with infra/kb/apply.sh (if the script cannot take a third KB, report a change request to WP-CRD-01)",
               "push/avoid chosen exactly as metrics.md#visit-brief-hints, unit-tested: campaign boost, category match, 30-day brief_not_useful skip, recent-order skip, avoid wins",
               "visit facts reused from the visit-card-get handler (import, do not re-implement); LLM output with a product other than push/avoid is rejected; ungrounded numbers drop the bullet",
               "evals/visit-brief: >= 10 cases (el, en, no guidance, out-of-stock avoid, feedback skip); 100% numbers grounded; Miltos brief names grinder, 12 kg, Espresso Nuovo push, Frappe Instant avoid"])
fwp("WP-DSH-01", "KPI rollup, dashboard KPIs, drilldown, rep detail, competitor signals", 3, "P1", "REQ-DSH-001, REQ-DSH-002, REQ-DSH-003, REQ-DSH-004, REQ-DSH-006",
    ["kpi-rollup", "dashboard-kpis", "kpi-drilldown", "rep-detail", "competitor-signals-list", "team-list"], W2ALL, old="6.1-6.4, 6b.2, 6b.3, 6b.5, 6b.7, 6b.8")
fwp("WP-TGT-01", "Sales targets list/upsert", 3, "P0", "REQ-TGT-001, REQ-TGT-002", ["targets-list", "target-upsert"], W2ALL, old="3b.8")
fwp("WP-CMP-01", "Campaigns: list, upsert, draft from text, funnel", 3, "P1", "REQ-CMP-001, REQ-CMP-002, REQ-CMP-003, REQ-DEB-008",
    ["campaigns-list", "campaign-upsert", "campaign-draft-from-text", "campaign-funnel"], W2ALL, old="6.5, 6.6, 6b.1, 6b.12")
fwp("WP-IMP-01", "AI import functions + import-pipeline procedure", 3, "P1", "REQ-IMP-001, REQ-IMP-002, REQ-IMP-003",
    ["import-start", "import-get", "import-confirm", "import-analyze", "import-apply"], W2ALL, extra_owns="procedures/import-pipeline/**", old="6.11")
fwp("WP-SET-01", "Settings, users, territories, transfers, GDPR, usage", 3, "P1", "REQ-SET-001, REQ-SET-002, REQ-SET-003, REQ-SET-004, REQ-SET-005, REQ-CORE-010",
    ["settings-get", "settings-update", "users-list", "user-upsert", "territories-list", "territory-upsert", "assignments-transfer", "contact-export", "contact-erase", "usage-flush"], W2ALL, old="6.7-6.10, 6b.9-6b.11")
fwp("WP-OPS-02", "merc-ops backoffice agent + weekly summary + monthly report + summary data", 3, "P1", "REQ-DSH-005",
    ["weekly-summary", "monthly-report", "summary-data"], W2ALL, extra_owns="agents/merc-ops/**", old="6.12, 6b.6")
AG_ACC = ["agent created/updated in dev via wful agents (V2 repo under agents/<name>/), server validation passes, attached to the shared lib on main",
          "every tool from spec/contracts/tools/<agent>/ implemented through the shared handler (runAsTool) with injected values from code, never from the model",
          "evals in the agent repo run on dev with the listed thresholds; failures reported with transcripts"]
wp("WP-BUD-01", "merc-buddy: prompt, skills, 30 tools, customer memory, signed-token identity, Chat SDK key", 3, "P0",
   "REQ-BUD-001, REQ-BUD-002, REQ-BUD-003, REQ-BUD-004, REQ-BUD-005, REQ-BUD-006, REQ-BUD-007, REQ-BUD-008, REQ-BUD-010, REQ-BUD-011, REQ-BUD-012, REQ-CORE-012",
   "agents/merc-buddy/** (except agents/merc-buddy/evals/**)", W2ALL, AG_ACC, old="4.1-4.7, 4.9")
wp("WP-BUD-02", "merc-buddy evals J1-J4, el/en, adversarial + pitch rehearsal skill (only J1 + adversarial gate the freeze)", 3, "P0", "REQ-BUD-009, REQ-CRD-006",
   "agents/merc-buddy/evals/**, agents/merc-buddy/skills/pitch_rehearsal/**", ["WP-BUD-01"], ["eval suite >= 90% pass on dev; 'invent a price' fails closed 100%"], old="4.10, 4.11")
fwp("WP-BUD-03", "merc-buddy phone + WhatsApp channels: inbound Merc number, outbound call/WhatsApp to the rep, channel-number identity, call_me_back", 4, "P0",
    "REQ-BUD-012, REQ-BUD-013, REQ-BUD-014, REQ-BUD-015, REQ-BUD-016",
    ["buddy-call-start", "buddy-call-outcome", "buddy-callbacks-due"], ["WP-BUD-01"],
    extra_owns="agents/merc-buddy/tools/call_me_back*, agents/merc-buddy/tools/report_buddy_call_outcome*, agents/merc-buddy/skills/reach_me/**, agents/merc-buddy/evals/channels/**, docs/guides/telephony-whatsapp.md",
    extra_acc=["apply table buddy_call and the new app_user columns (phone_channel_enabled, notify_channel, whatsapp_window_until) on dev with infra/tables",
               "shared/core channel-number identity (me.ts callerFromTool -> channel_number) used unchanged; unit tests for inbound, outbound, WhatsApp, unknown and duplicate numbers",
               "merc-buddy prompt gets the channel_rules from contracts/agents/merc-buddy.json; triggers OnVoicemailDetected/OnEnd wired to report_buddy_call_outcome",
               "evals: phone-style short answers, unknown-number refusal, 'call me at 5' -> call_me_back with the right time",
               "live: if MERC_BUDDY_NUMBER is set, place ONE outbound test call to the team test phone only; otherwise stop at the request body and record it in evidence",
               "WhatsApp: if the number is attached to merc-buddy, send one template to the team test phone; otherwise record what is missing in human_steps",
               "purposes pre_visit, post_visit and debrief_confirm supported (REQ-MTG-001/005/006): WhatsApp template or interactive free-form inside the 24 h window, with the quick replies from the platform contract"])
fwp("WP-MTG-02", "Meeting loop delivery: pre-visit trigger, post-visit prompt, WhatsApp debrief confirmation with Correct/Fix, feedback record + eval export, buddy meeting_loop skill", 4, "P0",
    "REQ-MTG-001, REQ-MTG-004, REQ-MTG-005, REQ-MTG-006, REQ-MTG-007, REQ-MTG-008, REQ-MTG-009",
    ["previsit-briefs-due", "postvisit-prompts-due", "debrief-confirm-send", "debrief-confirm-due", "feedback-record"], ["WP-MTG-01", "WP-BUD-03", "WP-DEB-01"],
    extra_owns="agents/merc-buddy/tools/get_visit_brief*, agents/merc-buddy/tools/send_debrief_confirmation*, agents/merc-buddy/tools/record_feedback*, agents/merc-buddy/skills/meeting_loop/**, agents/merc-buddy/evals/meeting_loop/**, evals/debrief/field/**",
    extra_acc=["crons idempotent: re-running previsit-briefs-due / postvisit-prompts-due / debrief-confirm-due on the same state sends nothing new (unit tests with a fixed clock)",
               "debrief confirmation bullets built in code from the voice log's ai_actions; sent within 60 s of completion on dev",
               "merc-buddy gets the meeting_loop skill, 3 tools and the new channel_rules from contracts/agents/merc-buddy.json; evals: Call me -> call_me_back pre_visit, Correct, Fix with undo + log_visit + debrief_corrected, Not useful",
               "feedback export: evals/debrief/field/export.py turns debrief_corrected rows into eval cases and sets exported_to_evals; one case per correction",
               "live: messages and calls go only to the team test phone; without WhatsApp/number, stop at the request body and list the human steps"])

wp("WP-APV-01", "merc-approver: outbound voice agent, 3 tools, OnVoicemailDetected/OnEnd triggers, evals", 3, "P0",
   "REQ-APV-001, REQ-APV-002, REQ-APV-003, REQ-DSC-003, REQ-DSC-008", "agents/merc-approver/**", W2ALL, AG_ACC, old="3b.1c")
wp("WP-PRS-02", "prospecting-pipeline procedure (function-chain fallback) + merc-research backoffice agent + evals", 3, "P0",
   "REQ-PRS-001, REQ-PRS-003, REQ-PRS-005", "agents/merc-research/**, procedures/prospecting-pipeline/**", W2ALL,
   AG_ACC + ["J4 on dev: 18 found, 5 duplicates, 13 scored in < 5 min (CSV source)"], old="5.1, 5.2, 5.4, 5.6")
SCR_ACC = ["screens live in app/app/src/screens/<shell>/<screen>/ and plug into the registry; only functions listed for the screen in app.json are called",
           "Greek default + English; phone layout for rep screens; loading/empty/error states; mock mode works", "component tests pass; app rebuilt and deployed to dev; screenshots at phone size in the WP evidence folder"]
for id, t, prio, reqs, screens, old in [
    ("WP-APP-02", "Rep Today + Customers screens + offline plan cache", "P0", "REQ-BRF-004, REQ-CRD-001, REQ-CRD-002", ["rep/today", "rep/customers"], "3.2, 3.3, 3.8"),
    ("WP-APP-03", "Rep Record screen: offline queue, buddy voice widget with signed token, result card with undo", "P0", "REQ-DEB-001, REQ-DEB-003, REQ-APP-003, REQ-BUD-001", ["rep/record"], "3.6, 3.7, 4.8"),
    ("WP-APP-04", "Rep Approvals, Alerts, New shops, Week, AI log screens", "P0", "REQ-APR-001, REQ-ALR-002, REQ-PRS-006, REQ-PLN-002, REQ-APP-004", ["rep/approvals", "rep/alerts", "rep/new_shops", "rep/week", "rep/ai_log"], "3.9, 3.14, 5.8, 7.2"),
    ("WP-APP-05", "Management approvals (mobile) + team screens", "P0", "REQ-DSC-009, REQ-PLN-004", ["management/approvals", "management/team"], "3b.1f"),
    ("WP-APP-06", "Management dashboard, pipeline, targets, competition screens", "P1", "REQ-DSH-001, REQ-DSH-002, REQ-TGT-001, REQ-DSH-006", ["management/dashboard", "management/pipeline", "management/targets", "management/competition"], "6.2-6.4"),
    ("WP-APP-07", "Management campaigns, territories, settings, users, import, GDPR, AI log screens", "P1", "REQ-CMP-001, REQ-SET-001, REQ-SET-002, REQ-SET-003, REQ-SET-004, REQ-IMP-001", ["management/campaigns", "management/territories", "management/settings", "management/users", "management/import", "management/gdpr", "management/ai_log"], "6.5, 6.7, 6.9-6.11"),
]:
    wp(id, t, 3, prio, reqs, ", ".join(f"app/app/src/screens/{x}/**" for x in screens) + f", evidence/{id}/**", W2ALL + ["WP-APP-01b"], SCR_ACC, old=old)

wp("WP-APP-09", "Screen contract follow-up: Record uses merc-chat-token for the buddy; Team/Dashboard/Pipeline/Targets/Competition use team-list + territories-list for names; drilldown on every KPI", 3, "P0",
   "REQ-BUD-001, REQ-DSH-002, REQ-PLN-004",
   "app/app/src/screens/rep/record/**, app/app/src/screens/management/team/**, app/app/src/screens/management/dashboard/**, app/app/src/screens/management/pipeline/**, app/app/src/screens/management/targets/**, app/app/src/screens/management/competition/**",
   ["WP-APP-03", "WP-APP-05", "WP-APP-06"], ["screen tests match the updated app.json function lists", "app/app pnpm test + build green", "no deploy (WP-APP-08 deploys)"])
wp("WP-APP-08", "App integration: one deploy of all screens with live functions attached, mock off, smoke every screen on dev", 3, "P0",
   "REQ-APP-001, REQ-APP-002, REQ-APP-003, REQ-CORE-011", "app/app/package.json, app/app/vite.config.ts, evidence/WP-APP-08/**",
   ["WP-APP-02", "WP-APP-03", "WP-APP-04", "WP-APP-05", "WP-APP-06", "WP-APP-07", "WP-APP-09"] + W2ALL,
   ["app merc rebuilt and deployed once to dev with every screen", "all app-callable functions attached as app resources",
    "each screen opens with live data for a rep and a manager test principal (or the exact blocker is listed)", "phone-size screenshots of every screen in evidence/WP-APP-08/"])

# ---------------------------------------------------------------- wave 4: journeys, quality, demo
W3ALL = [w["id"] for w in W if w["wave"] == 3]
for id, t, reqs, owns, acc, old in [
 ("WP-E2E-01", "J1 end to end (API + browser) on dev from reseed", "J1: BRF, CRD, DEB, APR, BUD", "tests/e2e/j1/**", ["scripted run twice from reseed passes; voice steps simulated by tool calls where audio is impossible; real-phone run listed as a human step"], "7.6"),
 ("WP-E2E-02", "J2 end to end", "J2: CMP, BRF, CRD, DEB", "tests/e2e/j2/**", ["scripted run passes"], "7.7"),
 ("WP-E2E-03", "J3 end to end incl. no-answer async variant", "J3: DSC, APV, BUD", "tests/e2e/j3/**", ["async variant passes; live-call variant runs if caller id exists, else reported blocked"], "7.8"),
 ("WP-E2E-04", "J4 end to end", "J4: PRS, PLN", "tests/e2e/j4/**", ["scripted run passes"], "7.9"),
 ("WP-E2E-05", "J5 end to end: brief 30 min before, Call me, post-visit prompt, debrief, WhatsApp confirm, Fix stored as feedback", "J5: MTG, BUD, DEB, CRD", "tests/e2e/j5/**",
  ["scripted run twice from reseed passes with a fixed clock; WhatsApp and calls simulated by tool calls when the channel is not live", "the second Miltos brief after 'Brief did not help' pushes a different product",
   "real-phone run (WhatsApp brief, Call me, confirmation) listed as a human step with the exact order"], ""),
 ("WP-QA-02", "Monitors, governance policy for external sends, visibility tests, performance", "REQ-OPS-003, REQ-OPS-004, REQ-CORE-009, REQ-NFR-001, REQ-NFR-002, REQ-NFR-003, REQ-NFR-005, REQ-NFR-006", "tests/visibility/**, tests/perf/**, infra/monitors/**, infra/governance/**", ["monitors from platform.json exist on dev", "rep A cannot read rep B outside shared territory", "debrief p95 measured", "CI eval gate script"], "7.1, 7.3, 7.5"),
 ("WP-DEMO-01", "Demo kit: reset script, promotion runbook to Team Delta, demo script with timings", "REQ-OPS-001, REQ-OPS-002", "infra/demo/**, docs/demo/**", ["reset-demo reseeds dev in < 1 min and supports --next-visit-in <minutes> (shifts the Miltos visit so the pre-meeting brief fires live)", "promotion runbook + dry-run plan for demo (no deploy until the human fills environments.json demo)", "3-minute demo script for J5 with timings, plus a recorded fallback video plan"], "7.10-7.13"),
]:
    J5DEPS = {"WP-E2E-05": ["WP-MTG-02", "WP-BUD-01", "WP-BUD-03", "WP-DEB-01", "WP-APP-03", "WP-APP-08"],
              "WP-DEMO-01": ["WP-MTG-02", "WP-E2E-05", "WP-BUD-01", "WP-APP-08"]}  # J5 does not wait on management-only functions
    wp(id, t, 4, "P0", reqs, owns, J5DEPS.get(id, W3ALL), acc, old=old)

# ---------------------------------------------------------------- freeze scope (code freeze 2026-11-15 18:00, SPEC §1)
FREEZE_CUT = {"WP-DSC-01": "discounts", "WP-APV-01": "discounts", "WP-E2E-03": "discounts",
              "WP-PRS-01": "prospecting", "WP-PRS-02": "prospecting", "WP-E2E-04": "prospecting",
              "WP-IMP-01": "import", "WP-APP-05": "management screens", "WP-APP-06": "management screens", "WP-APP-07": "management screens"}
for w in W:
    w["freeze"] = "cut: " + FREEZE_CUT[w["id"]] if w["id"] in FREEZE_CUT else "in"
    if w["id"] not in FREEZE_CUT:
        w["deps"] = [d for d in w["deps"] if d not in FREEZE_CUT]

# coverage: every contract function owned exactly once
_fns = sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, "spec", "contracts", "functions")))
_owned = [x for w in W for x in w.get("slugs", [])] + ["me", "merc-chat-token"]
_dup = sorted({x for x in _owned if _owned.count(x) > 1}); _miss = sorted(set(_fns) - set(_owned)); _extra = sorted(set(_owned) - set(_fns))
if _dup or _miss or _extra:
    raise SystemExit(f"function ownership broken: dup={_dup} missing={_miss} unknown={_extra}")

ICON = {"todo": "⬜", "claimed": "🟦", "building": "🟨", "blocked": "⛔", "in_review": "🔍", "done": "✅", "partial": "🟧"}

def load_status():
    p = os.path.join(ROOT, "wp", "status.tsv")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if not line.strip() or line.startswith("#"): continue
            id, status, owner, evidence = (line.rstrip("\n").split("\t") + ["", "", ""])[:4]
            for w in W:
                if w["id"] == id: w.update(status=status, owner=owner, evidence=evidence)

def write():
    load_status()
    L = ["# Merc · PROGRESS (work-package queue)", "",
         "> Generated by `wp/queue.py` from the queue + `wp/status.tsv`. Only the orchestrator edits them. "
         "Spec: [`spec/SPEC.md`](spec/SPEC.md) · Contracts: [`spec/contracts/INDEX.md`](spec/contracts/INDEX.md) · "
         "Method: [`docs/06-build-methodology.md`](docs/06-build-methodology.md) · Decisions, questions, risks: [`docs/03-progress.md`](docs/03-progress.md) §9-11.", "",
         f"**Environments** (wful profile `hackathon`): dev = personal workspace `{DEV}` · demo = Team Delta `{DEMO}` (promotion only after a wave gate).", "",
         "**States:** ⬜ todo · 🟦 claimed · 🟨 building · ⛔ blocked · 🔍 in review · 🟧 partial · ✅ done", "", "## Snapshot", "",
         "**Freeze scope** (code freeze 2026-11-15 18:00, [`spec/SPEC.md`](spec/SPEC.md) §1): journey J5 plus the J1 pieces it reuses. "
         "Cut from freeze: " + ", ".join(f"{k} ({v})" for k, v in FREEZE_CUT.items()) + ". Cut packages gate nothing before the freeze; their deps are dropped from in-scope packages.", "",
         "| Wave | WPs | ✅ | 🔍 | 🟧 | ⛔ | ⬜ | cut |", "|---|---|---|---|---|---|---|---|"]
    names = {0: "0 · Spikes", 1: "1 · Foundations", 2: "2 · Core engines", 3: "3 · Surfaces + agents", 4: "4 · Journeys + demo"}
    for wv in range(5):
        ws = [w for w in W if w["wave"] == wv]
        c = lambda s: sum(1 for w in ws if w["status"] == s)
        L.append(f"| {names[wv]} | {len(ws)} | {c('done')} | {c('in_review')} | {c('partial')} | {c('blocked')} | {c('todo')} | {sum(1 for w in ws if w['id'] in FREEZE_CUT)} |")
    for wv in range(5):
        L += ["", f"## Wave {names[wv]}", "", "| ID | Title | P | Requirements | Depends on | Status | Freeze | Owner | Evidence | Replaces |", "|---|---|---|---|---|---|---|---|---|---|"]
        for w in [w for w in W if w["wave"] == wv]:
            link = f"[{w['id']}](wp/{w['id']}.md)"
            L.append(f"| {link} | {w['title']} | {w['prio']} | {w['reqs']} | {', '.join(w['deps']) or '-'} | {ICON.get(w['status'], w['status'])} | {w['freeze']} | {w['owner']} | {w['evidence']} | {w['old']} |")
    L += ["", "## Gates", "", "- **Wave gate:** every WP of the wave ✅ (builder evidence + independent verifier pass), integration smoke on dev with seed data, no open P0 defect, `make check` green.",
          "- **Spikes:** results go to `docs/spikes/`, resolved OPEN items update `spec/SPEC.md` §3 and the `_build` sources, then build.py must exit 0.", ""]
    open(os.path.join(ROOT, "PROGRESS.md"), "w", encoding="utf-8").write("\n".join(L))
    for w in W:
        Y = ["```yaml", f"id: {w['id']}", f"title: {w['title']}", f"wave: {w['wave']}", f"priority: {w['prio']}",
             f"requirements: [{w['reqs']}]", f"freeze: {w['freeze']}", f"owns: [{w['owns']}]", f"depends_on: [{', '.join(w['deps'])}]",
             "environment: {wful_profile: hackathon, dev_workspace: " + DEV + "}", "acceptance:"]
        Y += [f"  - {a}" for a in w["acc"]] + [f"status: {w['status']}", "```"]
        rules = ["", "## Rules", "- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.",
                 "- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.",
                 f"- Platform: always `wful --profile hackathon --workspace {DEV}`. Never touch the demo workspace or other teams' workspaces.",
                 "- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.",
                 "- Report evidence: commands run with their output, resource ids created, failing checks."]
        open(os.path.join(ROOT, "wp", f"{w['id']}.md"), "w", encoding="utf-8").write(f"# {w['id']} · {w['title']}\n\n" + "\n".join(Y + rules) + "\n")

if __name__ == "__main__":
    write()
    print(f"{len(W)} work packages -> PROGRESS.md, wp/WP-*.md")
