# 05 · Domain Model (business entities)

> A description of the product's "world". How it is stored is decided by the technical team.

## Entities
| Entity | What it is | Key elements |
|---|---|---|
| **Organization** | The company that is our customer | Name, language, time zone, plan, settings, ICP |
| **User** | Rep / manager / admin | Role, territory, manager, phone, voice on/off |
| **Territory** | Geographic area of responsibility | Boundaries or postal codes, manager, reps |
| **Customer (account)** | Shop/business | Type (customer / prospect / lost), category, VAT number, address+location, contact details, website, territory, responsible rep, order frequency, last order, risk, source |
| **Contact** | Person at the customer | Role, contact details, whether they decide |
| **Deal** | Sales opportunity | Stage, amount, close date, next step |
| **Product** | Whatever the organization sells | Code, category, price |
| **Order** | Actual or draft | Lines (product, quantity, price), source (manual / voice / ERP) |
| **Visit** | Planned or completed | Time, order in the route, status, outcome |
| **Voice log** | Recording + text | Rep, customer, language, processing status |
| **Activity** | Anything that happened | Visit / call / email / message / note, source (human / AI / connection) |
| **Task** | Something to be done | Owner, due date, source |
| **Problem** | Customer's open issue | Status, due date |
| **Competitor signal** | Information about a competitor | Competitor, what was said, price difference |
| **Candidate** | New shop from prospecting | Details, dossier, score + reasons, status |
| **Briefing** | The rep's plan for today | Date, content, whether delivered |
| **Alert** | Notification | Type, severity, suggested action |
| **AI action** | Something the AI did or suggested | Type, target, whether applied, how to undo |
| **Approval** | AI action waiting for a human | Channel, preview, status |
| **AI permission** | Autonomy rule | Action type × role → automatic / ask / never |
| **Campaign** | Instruction to reps | Message, products, targets, dates, metrics |
| **Import** | File upload | Data type, column mapping, result |
| **Customer memory** | What the buddy "remembers" about the customer | Belongs to the organization, not the rep |

## Relationships (simply)
- Organization → has users, territories, customers, products, campaigns, settings.
- Territory → has reps and customers.
- Customer → has contacts, deals, orders, visits, activities, tasks, problems, competitor signals, memory.
- Voice log → produces AI actions → which are either applied (with undo) or become approvals.
- Candidate → can become a customer (prospect → customer).

## Lifecycles (states)
| Entity | States |
|---|---|
| Customer | prospect → customer → (lost) |
| Deal | new → qualified → proposal → negotiation → won / lost |
| Visit | planned → done / skipped |
| Voice log | on the phone (offline) → uploaded → transcription → processing → completed / failed |
| Approval | pending → approved → sent / failed · or rejected / expired |
| AI action | suggested → applied → (undone) |
| Alert | open → done / dismissed |
| Candidate | new → added (became customer/prospect) / dismissed |
| Problem | open → in progress → resolved |
