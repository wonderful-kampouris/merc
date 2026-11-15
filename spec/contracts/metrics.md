# Metrics and rules (normative)

Every number that Merc stores, shows or speaks is computed by the code below, never by an LLM (SPEC REQ-CORE-003).
All dates are in the organization timezone. "Confirmed order" means `sales_order.status = 'confirmed'`.
Money is integer minor units. Percentages are 0-100.

## usual-frequency
Average order interval of one account, stored in `account_metrics.avg_order_interval_days`.
```
dates = distinct order_date of confirmed orders of the account, last 180 days, ascending
if len(dates) < 3: avg = account.visit_frequency_days ?? category.default_visit_frequency_days ?? 14
else:              avg = median(diff(dates))            # median, robust to one-off orders
days_since_last_order = today - max(dates)              # null when no orders
```

## risk
Risk score 0-100 in `account_metrics.risk_score`, with reasons in `risk_reasons` (pipe-separated codes).
```
r = 0; reasons = []
ratio = days_since_last_order / avg
if ratio >= 1.5: r += min(60, round(40 * (ratio - 1)));  reasons += ["order_gap"]
if open competitor_signal in last 30 days:  r += 20;     reasons += ["competitor"]
if open problem older than 7 days:          r += 10;     reasons += ["open_problem"]
if last visit older than 2 x avg:           r += 10;     reasons += ["no_visit"]
risk_score = min(100, r)
```

## going-quiet
Alert `going_quiet` when `days_since_last_order >= alert_rule.threshold_value (1.5) x avg` for a customer.
Dedupe key: `going_quiet:{account_id}:{last_order_date}`.

## discount-limit
```
policies = active discount_policy of the org
pick the first match, most specific first:
  1. user_id = requester
  2. role_code = requester.role AND product_category_id = line.category AND account_category_id = account.category
  3. role_code = requester.role AND product_category_id = line.category AND account_category_id is null
  4. role_code = requester.role AND both category ids null
none -> 0 (every discount needs approval)
request limit = min(limit of each line)     # a multi-line request is limited by its strictest line
allowed = requested_pct <= request limit
```
The approver's own limit uses the same resolution with the approver as requester.
A counter-offer must satisfy `approved_pct < requested_pct` and `approved_pct <= approver limit`.

## crm-completeness
Per rep per day in `kpi_daily.crm_completeness_pct`.
```
active = accounts owned by the rep with account_type in (customer, prospect)
complete(a) = a.category_id and (a.phone or a.email) and a.postal_code and a.owner_rep_id
              and exists contact(is_decision_maker) and every open deal has amount_minor and expected_close_date
pct = 100 x count(complete) / count(active)
```

## customers-saved
A `going_quiet` alert opened at t, followed by a confirmed order of the same account within 30 days.
Counted once, in the day of the order.

## campaign-funnel
- **shown**: the account's visit card was opened, or the campaign was a briefing item, inside the campaign window. Max one per account per rep per day.
- **pitched**: the debrief extraction returned the campaign id with an evidence quote that passed validation.
- **ordered**: a confirmed order line with a campaign product, for an account with a pitched exposure, between the pitch date and `ends_on + 7 days`.

## lost
A customer with no confirmed order for more than `max(60, lost_after_multiplier x avg)` days becomes `lost`.
`account-lifecycle` does this through an `ai_action mark_account_lost`, which the owner can undo.

## weighted-pipeline
`sum(deal.amount_minor x deal_stage.probability)` over deals whose stage `is_closed = false`.

## target-progress
| metric | actual value in the period and scope |
|---|---|
| revenue | sum of quantity x unit_price_minor x (1 - discount_pct/100) of confirmed order lines |
| volume | sum of order line quantity |
| visits | count of visits with status done |
| new_customers | count of accounts with customer_since in the period |

Scope is the user, the territory (accounts in it), or the org. `pct = 100 x actual / target_value`.

## visit-overdue
`today - last done visit > account.visit_frequency_days ?? category.default_visit_frequency_days`.

## rep-not-logging
A rep with at least one planned visit and zero voice logs for 2 working days (Mon-Fri). The alert goes to the rep's manager.

## voice-log-within-1h
A voice log counts as "within 1 h" when `voice_log.created_at - visit.completed_at <= 60 min` (or the visit is marked done by the debrief itself).

## visit-plan
`visit-plan-suggest` builds the next week (Mon-Fri) per rep. It is deterministic, and the same input gives the same plan.
```
candidates = owned accounts, scored:
  + 50 if visit overdue (see visit-overdue), + 10 per day overdue (cap 30)
  + 40 if an open customer-promise task is due that week (placed on or before its due day)
  + 30 x risk_score/100
  + 15 if an active campaign targets the account's territory/category
  + 10 for prospects added to route in the last 14 days (max 2 per day)
fill days in score order, max organization.visits_per_day per day
group each day by postal_area proximity (greedy nearest neighbour from the first stop)
route_position = order in the greedy path
reason = top contributor in plain words (e.g. "Hasn't ordered in 12 days")
```

## before-after
The same metric over `baseline_start .. go_live_date` against the same-length period after go-live. Imports flagged `is_baseline` feed the baseline.

## approval-sla
Async discount approval: `due_at = created_at + organization.approval_sla_minutes`.
When `now > due_at` and the approval is still pending, the status becomes `escalated`.
The approver becomes the approver's manager, or an admin when there is none. Both the old and new approver get an SMS.

## visit-brief-hints
Used by `visit-brief-get` (REQ-MTG-003). Code picks the products; the LLM only words them.

1. Candidates are `product_guidance` rows with `active = true`, `valid_from <= today` (or null), `valid_to >= today` (or null), whose `category_id` equals the account's category or is null, and whose product is active.
2. **Push** = the push candidate with the highest score, where score = `priority` + 50 if the product is in an active campaign that targets this rep, account category or territory, + 25 if it pairs with an open problem of the account (product named in the problem's linked deal or task). Ties break on product name.
3. Skip a push candidate when this account has a `rep_feedback` row of kind `brief_not_useful` for that product in the last 30 days (REQ-MTG-008), or when the account ordered that product in the last 30 days.
4. **Avoid** = the avoid candidate with the highest `priority`, ties on product name. A product cannot be both push and avoid; avoid wins.
5. No candidate -> the bullet is omitted; the brief never invents one.

