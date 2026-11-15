# 06 · AI Agents: business logic

> Merc is not a chatbot. It is a **team of agents** behind one buddy. The rep talks only to the buddy. The buddy hands the work to the agents.

## General rules for all agents
1. **They don't make up data.** Numbers, prices and names come only from the data or from what the user said. Anything missing is left empty and flagged.
2. **They respect the AI permissions** (02): internal actions automatic with undo, external ones with approval, or as the admin has set.
3. **They log everything:** what they read, what they decided, what they did.
4. **They speak the user's language** (Greek by default, English when the user speaks English). Proper names are not translated.
5. **They are brief:** the rep is driving, so voice answers are short and practical.
6. **The same logic everywhere:** whether the rep taps a button in the app or talks to the buddy, the result is the same.

## The agents
| Agent | When it runs | What it takes in | What it produces |
|---|---|---|---|
| **Buddy (coordinator)** | When the rep talks or opens the app | The voice/command, the plan, the customer's memory | Answers, and assigns work to the other agents |
| **Debrief** | After a voice log | Recording text, customer, history | Note, problems, tasks, deal/order update, competitor signals, draft email, missing details |
| **Briefing** | Every morning + on request | Calendar, visits, alerts, campaigns, candidates near the route | Day plan (text + voice script ≤ 90 seconds) |
| **Visit card** | Before a visit | Customer, history, products, campaigns, research dossier | Customer card or prospect card with pitch and objections |
| **Research** | New candidate or prospect | The shop's website + public data | Dossier: what they sell, prices, competitor brands, review themes (with sources) |
| **Scoring** | When the dossier is ready / row from a list | Dossier + the organization's ICP | Score 0–100 + 3 reasons |
| **Alerts** | Every hour | Orders, deals, commitments, signals | Alerts with a suggested action (see 03-E) |
| **Email/messages** | From debrief, alert or command | Intent, customer, the rep's style | Draft in the rep's style → approval |
| **Import** | File upload | Excel/CSV | Column mapping with confidence, cleaning, duplicates, preview |
| **Weekly summary** | Every week | Team data | Summary for manager/CEO: what closed, what got stuck, what's coming |
| **Pitch rehearsal** (P1) | When the rep asks | Prospect card | "Owner" role-play + 3 feedback points |

## Decision logic (examples)
**Debrief: what is applied immediately and what waits for approval**
```
for each action extracted from the voice:
  permission = setting(organization, rep's role, action type)
  if permission = automatic → apply + keep undo
  if permission = ask       → create approval "Shall I send it?"
  if permission = never     → keep it as a suggestion only
if quantity/price/customer is missing → ask, don't guess
```

**Customer risk**
```
usual_frequency = average days between orders (last six months)
if days_since_last > 1.5 × usual_frequency → alert "going quiet"
risk ↑ if: open problem, competitor mention, drop in quantities
```

**What goes into the briefing (priority order)**
1. Promises due today/tomorrow
2. The day's stops (with the reason for each one)
3. At-risk customers near the route
4. New customers with a pitch
5. Campaigns
6. Pending approvals

**What makes a candidate "good" (default weights, the admin can change them)**
Category in the ICP · near an existing route · size/activity · competitor brands we can replace · reviews/foot traffic.

## Memory
- The buddy remembers every customer across conversations: what was said, what they prefer, how to talk to them.
- The memory belongs to the **organization**. When the rep changes, the new rep inherits it.
- The buddy also remembers the rep (style, habits), so that it "gets better every day".

## Quality
For each agent we keep a set of real examples (Greek/English, noise, half sentences, unknown customer name) with the correct result. We measure the success rate before every change.
