// fn:monthly-report (cron "0 7 1 * *", contracts/functions/monthly-report.json, REQ-DSH-005).
// Creates one merc-ops backoffice task `monthly_report` per active admin for last month (org timezone).
// merc-ops reads fn:summary-data (kind=monthly: before/after baseline, completeness, new customers, customers saved)
// and emails the report. Webhook wiring: global MERC_OPS_MONTHLY_URL + secret MERC_OPS_MONTHLY_HOOK
// (see weekly-summary.ts, which holds the shared ops-task logic).
import { defineCron, type FunctionContext } from "../../core/src/index";
import { cronData } from "./metrics-rollup";
import { makeOpsImpl, type OpsDeps } from "./weekly-summary";

export const makeImpl = (deps: OpsDeps = {}) => makeOpsImpl<"monthly-report">("monthly", deps);
export const impl = makeImpl();
/** Cron entry (functions/monthly-report/index.ts): once per org, system principal; only `dry_run` is read from params. */
export const handle = (context: FunctionContext & { params?: unknown }) => defineCron("monthly-report", impl)({ ...context, data: cronData(context) });
