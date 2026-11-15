# Merc: Business & Product Spec

> This pack describes **what** we are building, **for whom** and **under which rules**. The **how** (technologies, backend, frontend, infrastructure) is decided and built by the technical team.
> Source: discovery/grill session, 14/11/2026 (Team Delta, GenAI Summit Hackathon, Wonderful track).

## Files
| # | File | What it answers |
|---|---|---|
| 01 | `01-vision-positioning.md` | What Merc is, what problem it solves, for whom, how it makes money |
| 02 | `02-users-roles-permissions.md` | Who uses it, what each person sees, what the AI does on its own |
| 03 | `03-features.md` | All features (MVP and later) with their business rules |
| 04 | `04-user-journeys.md` | A day with Merc, step by step, for each role |
| 05 | `05-domain-model.md` | The "entities" of our world, their relationships and their states |
| 06 | `06-ai-agents-logic.md` | The AI agents: when they activate, what they take in, what they produce, which rules they follow |
| 07 | `07-product-structure.md` | The product structure: modules, apps, information flows, screen map |
| 08 | `08-decisions-open-questions.md` | Locked decisions, open questions, what we do NOT do |

## For the technical team
- Anything marked "rule" is mandatory. Anything marked "suggestion" you are free to change.
- Numbers (days, hours, limits) are **defaults that the admin can configure**, unless stated otherwise.
- Commitments already in place (so they don't get re-researched): the voice assistant will be built on the **Wonderful** platform (by a separate dev). We look for new shops in **business directories/maps**, **company data sources** and **the customer's own lists**. Research is done by **web scraping the shop's website** (Firecrawl). The product is a **mobile web app + voice** for the rep and **desktop** for management. Everything else is your call.
