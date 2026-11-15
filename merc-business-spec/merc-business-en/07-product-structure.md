# 07 · Product structure (logical architecture)

> Logical parts and information flows. The technologies are the technical team's choice.

## The 5 parts
```
┌─────────────── MANAGEMENT (desktop) ─────────────┐
│ Dashboard · Territories · Campaigns · Settings ·  │
│ Users · Import                                    │
└───────────────────────┬──────────────────────────┘
                        │ instructions ↓   picture ↑
┌─────────────── REP (mobile + voice) ─────────────┐      ┌──── VOICE BUDDY ─────────┐
│ Today · Customers · 🎤 · Approvals · Alerts ·     │◄────►│ talks, remembers,        │
│ New shops    (also works offline)                │      │ asks "Shall I send it?"  │
└───────────────────────┬──────────────────────────┘      └───────────┬─────────────┘
                        ▼                                             ▼
┌──────────────────────────── AGENT TEAM ───────────────────────────────────────────┐
│ Debrief · Briefing · Card · Research · Scoring · Alerts · Email · Import · Summary │
│ + Autonomy rules + Action logging + Undo                                           │
└───────────────────────────────────────┬────────────────────────────────────────────┘
                                        ▼
┌──────────────────────────── CRM CORE (data) ──────────────────────────────────────┐
│ Customers · Contacts · Deals · Orders · Visits · Tasks · Problems ·               │
│ Competition · Memory · Approvals   (isolation per organization + visibility per role)│
└───────────────────────────────────────┬────────────────────────────────────────────┘
                                        ▼
┌──────────────────────────── CONNECTIONS TO THE OUTSIDE WORLD ─────────────────────┐
│ Email · Calendar · WhatsApp/Viber · Business directories · Company data ·          │
│ Web research on sites · ERP (file) · Excel/CSV                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Information flows
| Flow | From → To |
|---|---|
| **Signals go up** | Rep's voice → agents → CRM → management dashboard/alerts |
| **Instructions come down** | Management campaigns/territories → rep's briefing & cards |
| **The outside world comes in** | Directories/sites → research → candidates → route |
| **Messages go out** | Agent → rep approval → email/message from their account |

## Screen map
**Rep (mobile, bottom menu):**
| Screen | Content |
|---|---|
| Today | Briefing (text + ▶ voice), stops in order, map |
| Customers | Search, customer/prospect card |
| 🎤 (central button) | Recording → result card with undo |
| Approvals | "Shall I send it?": Approve / Edit / Reject |
| Alerts | Feed with one-tap actions |
| New shops | List/map of candidates, dossier, score, "add to route" |

**Management (desktop):**
| Screen | Content |
|---|---|
| Dashboard | Company/team/rep KPIs |
| Territories | Map, assignments, bulk transfer |
| Campaigns | Creation, targets, uptake metrics |
| Customers/Pipeline | Full CRM in table/kanban view |
| Settings | AI permissions, briefing, alerts, ICP, recording retention, connections |
| Users | Invitations, roles, territories |
| Import | Upload → mapping → preview → report |

## Non-functional requirements (business terms)
| Topic | Requirement |
|---|---|
| Speed | From voice to updated CRM: a few seconds (target < 20 seconds) |
| Offline | Recording and today's plan without signal, automatic sync |
| Ease of use | Every rep screen is usable with one hand. The basics can also be done by voice |
| Language | Greek by default, English everywhere |
| Privacy | Data in the EU, GDPR, organization isolation, deletion of recordings after X days |
| Transparency | Every AI action is visible, explainable and reversible |
| Scale | From 20 to 200 reps per organization, many organizations |
