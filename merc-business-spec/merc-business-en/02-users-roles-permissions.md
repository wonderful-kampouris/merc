# 02 · Users, Roles, Permissions

## Roles
| Role | Who | Main device | Main use |
|---|---|---|---|
| **Rep** | Field sales rep | Mobile + voice | Briefing, visits, voice logging, approvals, new shops |
| **Manager** | Team/territory lead | Desktop (and mobile) | Team view, territories, assignments, campaigns |
| **Admin** | CEO / management | Desktop | Company dashboard, settings, AI permissions, users, import |

One company = one "organization". **Rule:** an organization never sees another organization's data.

## What each person sees (visibility rules)
| Data | Rep | Manager | Admin |
|---|---|---|---|
| Customers/prospects | Those assigned to them + those in their territory | All in their team's territories | All |
| Deals, visits, notes | Their own | Their team's | All |
| Dashboard | Their personal numbers | The team's | The whole company's |
| Campaigns | The ones that concern them | Creates for their team | Creates for everyone |
| AI settings / users / import | ✗ | Only what concerns the team (suggestion) | ✓ |

**Rules:**
- When a territory or customer assignment changes, visibility changes immediately as well.
- When a rep leaves, their customers are transferred (in bulk) to someone else **together with all the history and memory**.

## AI autonomy (the most important rule)
| Action type | Examples | Default |
|---|---|---|
| **Internal** | Note, task, deal update (stage, amount, next step), competitor signal, customer details update | **Automatic, with undo** |
| **Draft** | Draft order | **Automatic, as a draft** (the rep confirms it) |
| **External** (the customer sees it) | Email, WhatsApp/Viber, call, booking a meeting with a customer | **Only with approval** ("Shall I send it?") |
| **Structural** | Converting a prospect into a customer | **With approval** |
| **Destructive** | Deleting anything | **Never** by the AI |

**Rules:**
- The admin changes the default **per action type and per role** to one of three modes: **Automatic / Ask me / Never**.
- Every AI action is logged: what it did, for whom, why, and whether it was approved or undone.
- An undo restores exactly the previous state.
- An approval can be: **Approve / Edit and approve / Reject**. If it stays unanswered for X hours it expires (suggestion: 48h) and shows up again in the briefing.
- External messages are sent **from the rep's own account** (their own email/number), not from a "robot".
