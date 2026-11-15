# 03 · Features

Priority: **P0** = MVP/demo · **P1** = MVP for pilot · **P2** = after the pilot.

## A. Voice visit logging (P0, the headline)
**What:** After a visit the rep speaks freely for 30–60 seconds. Merc understands and updates everything.

| Extracted from the voice | What happens |
|---|---|
| Visit note | Saved on the customer (automatic) |
| Problems (e.g. "the grinder is making noise") | Open problem with a due date (automatic) |
| Commitments (e.g. "offer by Thursday") | Task with a date + reminder (automatic) |
| Order intent / quantities | Deal update or draft order |
| Competition (e.g. "the competitor is at -20%") | Competitor signal (automatic) |
| Follow-up email | Draft → "Shall I send it?" |

**Rules:**
- If a number/price wasn't said, it **does not make it up**. It leaves it empty and asks.
- If it isn't clear which customer the rep is talking about, it suggests the nearest or the scheduled one and asks for confirmation.
- **Works without signal:** the recording stays on the phone and is processed as soon as there is a connection. The rep sees "3 recordings waiting".
- At the end the rep sees a card: "Done: 1 note, 1 task for Thursday, deal updated. 1 email waiting for you", with undo on every line.
- Greek and English, and mixed.

## B. Morning briefing (P0)
**What:** Every morning (default 07:45, configurable) the buddy "speaks first".

It contains: the day's stops and their order, open problems/commitments, customers who haven't ordered as often as usual, new customers with a ready pitch, a new shop near the route, the week's campaigns, pending approvals.

**Rules:** Read out in ≤ 90 seconds. All numbers come from the data, none are made up. Available as a screen, as voice and as a notification.

## C. Visit card (P0)
| Existing customer | Prospective customer (prospect) |
|---|---|
| Notes, open problems, alerts | Research dossier: what they sell, catalog, price level, themes in reviews |
| Recent orders, frequency, risk | Competitor brands visible on the site/catalog |
| Products that suit them and why (+ campaigns) | Pitch: opening line, 3 arguments, products, objections and answers |
| How to talk to them (from history) | 🎭 Pitch rehearsal: the buddy plays the owner (P1) |

## D. Prospecting: finding new customers (P0)
1. **Search** by area + category (e.g. "bakeries, Chalandri"), or automatically around the rep's route.
2. **Remove duplicates:** excludes those who already exist as customers or prospects.
3. **Research:** reads the shop's website (menu, catalog, brands, prices) and whatever company data exists, and builds a dossier.
4. **Score** against our customer's ICP, with reasoning ("fits because…").
5. **Action:** "Add to route" / "Assign to rep" / "Dismiss".
- Customer lists (Excel/CSV) go through the same steps 2–5.
- **Rule:** we don't scrape maps. We research only public business websites and official sources/directories. For every data point we keep the source and the date.
- The admin defines the ICP: target categories, minimum score, what matters most.

## E. Alerts (P0)
| Alert | Trigger rule (default) | Suggested action |
|---|---|---|
| Customer "going quiet" | Days since last order > 1.5 × their usual frequency | Visit / phone call |
| Deal stuck | No activity for 14 days | Follow-up email |
| Close date passed | Close date < today and the deal is open | Update or close |
| Promise due | Commitment due in ≤ 1 day | Reminder + draft |
| Competition wave | ≥ 3 mentions of the same competitor in a territory within 7 days | Notify the manager |
- With one tap, every alert becomes a task or a draft. Duplicate alerts are merged into one. Alerts appear in the feed, in the briefing and as a notification.

## F. Approvals (P0)
An inbox of "Shall I send it?" cards (preview, recipient, channel). Actions: Approve / Edit / Reject. Also works by voice ("yes, send it").

## G. End of day (P1)
Summary: visits, offers, new customers, pending items, and "tomorrow start with…". It also notes something the system learned (e.g. "with bakeries the sample works").

## H. CEO/Manager dashboard (P1)
Visits/day per rep, pipeline by stage, new customers, at-risk customers, CRM completeness, adoption (logs per rep/day), AI actions approved or rejected. Filters: territory, rep, period.

## I. Territories & assignments (P1)
Defining territories (drawing on the map or postal codes), assigning reps, bulk transfer of customers. New customers from prospecting automatically go to the rep of that territory.

## J. Campaigns to reps (P1)
The manager writes e.g. "This week push product X to bakeries" and sets targets (territories/categories/reps) and dates. The campaign goes into briefings and cards. We measure whether it was **shown → pitched to the customer → ordered** (from the voice logs).

## K. AI import (P1)
Upload any Excel/CSV (customers, contacts, orders, products). The system figures out the columns on its own (e.g. "Company name", "Phone", "VAT number"), cleans phones/VAT numbers/addresses, finds duplicates, shows a preview and imports the data only after you confirm. At the end it produces a report (how many went in, how many have problems).

## L. Settings (P1)
AI permissions (see 02), briefing time, alert thresholds, ICP, recording retention (default 30 days, the text is kept), email/calendar/messaging connections, users and roles, language.

## M. Connections (P1 → P2)
| Connection | Why | Priority |
|---|---|---|
| Email (Gmail, Outlook) | Sending approved emails from the rep, their writing style | P1 |
| Calendar (Google, Outlook) | The day's stops | P1 |
| WhatsApp / Viber | Messages to customers (with approval) | P2 (needs approval from the provider) |
| ERP | Order history | Excel/CSV in the MVP, direct connection P2 |

## N. After the pilot (P2)
Market Radar (the company "brain": competition/price trends from all reps), outbound voice calls to customers, route optimization, quotes/invoicing, the best practices the company "learns", native apps.
