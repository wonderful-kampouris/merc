# Context Hub content (WP-CRD-01)

Source documents for the three Context Hub knowledge bases in `spec/contracts/platform/platform.json`:

| KB | folder | used by |
|---|---|---|
| `merc-catalog` | `merc-catalog/` | `fn:visit-card-get` (pitch grounding), merc-buddy |
| `merc-playbook` | `merc-playbook/` | `fn:visit-card-get` (objections, how to talk), merc-buddy (rehearsal) |
| `merc-company` | `merc-company/` | `fn:visit-brief-get` (values, push/avoid framing), `fn:visit-card-get`, merc-buddy |

Prices and units here are descriptive copies of the demo catalog (`spec/contracts/seed/product.json`).
Numbers shown or spoken by Merc always come from tables via code (REQ-CORE-003), never from these documents.
`infra/kb/apply.sh` creates the knowledge bases, uploads these files, runs the pipelines and smoke-asks them.
