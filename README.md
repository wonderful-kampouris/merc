# Merc · the CRM that fills itself

**GenAI Summit Hackathon 2026 · Wonderful track · Team Delta**

Field sales reps hate CRMs. They spend the day in shops and the evening typing. Merc lets them talk instead. A rep tells a Greek-speaking voice buddy what happened at a visit. Merc writes the notes, tasks, deals, orders and competitor signals, drafts the follow-up email in the rep's style, and asks before anything leaves the company.

Managers and the CEO get the truth without chasing anyone: who is going quiet, which deals are stuck, what the competition is doing, and whether the team is on target.

Everything runs on the **Wonderful platform**: Agents V2 voice agents, Functions, Tables, Apps, Procedures, Integration Hub, Context Hub and Model Profiles.

## What it does

| | Feature | Built on |
|---|---|---|
| 🎤 | **Voice debrief.** Free Greek speech becomes CRM rows in under 20 s, with a result card and one-tap undo per action | `merc-buddy` voice agent, `debrief-process`, autonomy engine |
| ☀️ | **Morning briefing.** A 90-second spoken plan: stops with reasons, promises due, at-risk customers, targets | `briefing-generate` cron, `merc-write` profile |
| 🤝 | **Before and after every meeting.** 30 minutes before a visit Merc WhatsApps the rep a few bullets: why this visit, the open problem, one product to push and one to avoid, each with a reason drawn from the company's own values. "Call me" gets the same brief by voice. After the visit Merc asks how it went, logs the debrief and sends a summary to confirm or fix; every fix becomes feedback that changes the next brief and grows the eval set | `previsit-briefs-due`, `visit-brief-get`, `debrief-confirm-send`, KB `merc-company`, `product_guidance` |
| 🗂️ | **Visit card.** Everything about a customer before walking in. Prospects get a researched dossier and a pitch | `visit-card-get`, Context Hub playbook |
| 💸 | **Discounts in 3 tiers.** Within the limit, allowed instantly. Above it, the buddy phones the manager live and relays the answer during the visit. No answer, async with an SLA and escalation | `discount-check`, `merc-approver` outbound agent |
| 🔎 | **Prospecting.** "Find bakeries in Chalandri": open data, dedupe against the CRM, website research with sources, ICP scoring | Procedure + `merc-research` backoffice agent |
| 🚨 | **Alerts.** Going quiet, stuck deals, promises due, competition waves | `alerts-engine` cron |
| 📅 | **Weekly plan.** Suggested every Sunday, editable by voice | `visit-plan-suggest` |
| 📊 | **Management.** KPIs with drilldown, targets, campaigns, territories, AI import, settings, GDPR | Wonderful App `merc` |

## Rules we never break
1. **The LLM never invents a number.** It extracts what was said, with an evidence quote that code re-checks. Numbers come from queries.
2. **One business layer.** Voice tools and functions run the same handler code from the workspace Shared Library.
3. **AI autonomy by class.** Internal actions apply with undo. External ones (emails) need approval. Destructive ones are never done by AI.
4. **Identity comes from the platform**, never from a request body or the model.

## How it was built
Merc was built **spec-first by coding agents** within the hackathon window.

1. [`spec/SPEC.md`](spec/SPEC.md) holds 114 numbered requirements, each with an acceptance check.
2. [`spec/contracts/`](spec/contracts/INDEX.md) holds machine-readable contracts for 64 tables, 96 functions, 39 agent tools, 5 agents, LLM schemas, events and seed data. They are generated and cross-validated by [`spec/_build/build.py`](spec/_build/build.py).
3. [`PROGRESS.md`](PROGRESS.md) is the work-package queue. Each package was built by one agent and checked by an independent verifier agent that re-ran its acceptance checks.
4. Platform spikes answered the risky questions first. See [`docs/spikes/`](docs/spikes/).

## Repo map
| Path | What |
|---|---|
| `spec/` | Normative spec, contracts, generator and validator |
| `shared/core` | `@merc/core`: typed table access, `me()`, scopes, errors, contract validation |
| `shared/handlers` | One business handler per function, shared by functions and voice tools |
| `shared/autonomy`, `shared/llm`, `shared/live` | AI action engine with undo, structured LLM calls with evidence checks, WebSocket push |
| `functions/<slug>/` | Thin Wonderful Function wrappers |
| `agents/` | `merc-buddy`, `merc-approver`, `merc-research`, `merc-ops` (Agents V2) |
| `app/` | Wonderful App `merc`: rep mobile shell and management shell |
| `infra/` | Table creation, seed loader, deploy scripts |
| `packages/contracts` | Generated TypeScript types, validators and mocks |
| `docs/` | Architecture, data model (3NF), needs analysis, methodology, spike reports |

## Run it
```
make check                                         # contracts + every package's tests + secret scan
infra/tables/apply.sh --workspace <id>             # create the 64 tables
infra/seed/load.sh --workspace <id> --demo-day YYYY-MM-DD
infra/deploy/deploy.sh <component> --env dev       # plan; add --push to deploy
```

## Demo journeys
- **J1** Nikos's day: briefing, visit card at Café Miltos, spoken debrief, result card with undo, follow-up email approved by voice.
- **J2** A manager's campaign appears in briefings and cards, and the funnel moves.
- **J3** A customer asks for 8% off. The buddy calls the manager live, she counters 6%, and Nikos hears it in the same conversation.
- **J4** "Find bakeries in Chalandri": 18 found, 5 duplicates removed, dossiers and scores, the top one added to the route.

Current build status per package is in [`PROGRESS.md`](PROGRESS.md). Steps that need a person (secrets, phone numbers, OAuth) are in [`docs/HUMAN-STEPS.md`](docs/HUMAN-STEPS.md).
