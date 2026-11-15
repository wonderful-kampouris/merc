// Read-only dev smoke for WP-CRD-02 (REQ-CRD-004, REQ-CRD-005, REQ-TGT-002). Runs the SAME defineFunction
// entries that are bundled into functions/ask-crm, functions/product-lookup and functions/my-performance,
// with context.tables reached through the wful CLI (dev workspace) and the caller set to seeded rep Nikos
// (the CLI user is not a Merc user, and the app gate answers 403 to `wful call`).
//
// Read-only: every write method throws, so no row is created or changed. Nothing here calls, texts or
// messages anyone. Locally there is no model runtime, so ask-crm uses its keyword fallback router.
//
//   bash evals/ask-crm/dev-smoke.sh
import { execFileSync } from "node:child_process";
import { testFilter, type Filter, type OrderBy, type RowEnvelope, type TablesApi } from "../../shared/core/src/index";
import { handle as askCrm } from "../../shared/handlers/src/ask-crm";
import { handle as productLookup } from "../../shared/handlers/src/product-lookup";
import { handle as myPerformance } from "../../shared/handlers/src/my-performance";

const WS = "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464";
const WUID = "merc-demo-wuid-nikos";

function wful(args: string[]): any {
  const out = execFileSync("wful", ["--profile", "hackathon", "--workspace", WS, "tables", ...args, "--json"], { encoding: "utf8", maxBuffer: 64 << 20 });
  return out.trim() ? JSON.parse(out) : null;
}
const env = (r: any): RowEnvelope => ({ id: r.id, data: { ...r.data, created_at: r.created_at, updated_at: r.updated_at } });
const cache = new Map<string, RowEnvelope[]>();
function allRows(t: string): RowEnvelope[] {
  if (!cache.has(t)) {
    const all: RowEnvelope[] = [];
    for (let page = 1; ; page++) {
      const res = wful(["row-list", t, "--limit", "100", "--page", String(page)]);
      all.push(...(res.data as any[]).map(env));
      if (!res.pagination?.has_next_page) break;
    }
    cache.set(t, all);
  }
  return cache.get(t)!;
}
const readOnly = () => { throw new Error("dev-smoke is read-only"); };
const cli: TablesApi = {
  async getRow(t, id) { const r = allRows(t).find((x) => x.id === id); if (!r) throw new Error(`404 ${t}/${id}`); return r; },
  async filter(t, filters: Filter[], limit = 100, offset = 0, orderBy?: OrderBy) {
    const rows = allRows(t).filter((r) => filters.every((f) => testFilter(r.data, f)));
    for (const o of [...(orderBy ?? [])].reverse()) {
      const d = o.direction === "desc" ? -1 : 1;
      rows.sort((a, b) => (a.data[o.column] > b.data[o.column] ? d : a.data[o.column] < b.data[o.column] ? -d : 0));
    }
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
  insert: readOnly, update: readOnly, deleteRow: readOnly,
  async count(t, filters = []) { return (await this.filter(t, filters, 1e9)).total; },
};
const ctx = (query: Record<string, unknown>) => ({ tables: cli, data: query, metadata: { user: { id: WUID } } });
const log = (step: string, v: unknown) => console.log(`${step}: ${JSON.stringify(v)}`);

async function main() {
  const lofos: any = await askCrm(ctx({ question: "When did Lofos last order?" }) as never);
  log("ask-crm 'When did Lofos last order?'", { template: lofos.template, router: lofos.params?.router, no_data: lofos.no_data, facts: lofos.facts, error: lofos.error });
  const off: any = await askCrm(ctx({ question: "What's the weather in Athens tomorrow?" }) as never);
  log("ask-crm off-template", { template: off.template, no_data: off.no_data, facts: off.facts, error: off.error });
  const price: any = await askCrm(ctx({ question: "How much is Espresso Nuovo?" }) as never);
  log("ask-crm 'How much is Espresso Nuovo?'", { template: price.template, facts: price.facts?.slice(0, 2), error: price.error });
  const pl: any = await productLookup(ctx({ query: "Espresso Nuovo" }) as never);
  log("product-lookup 'Espresso Nuovo'", pl.error ?? pl.items?.map((i: any) => ({ name: i.name, unit: i.unit, list_price_minor: i.list_price_minor, stock: i.stock, active_campaigns: i.active_campaigns })));
  const perf: any = await myPerformance(ctx({ period: "month" }) as never);
  log("my-performance month", perf.error ?? { targets: perf.targets?.map((t: any) => ({ metric: t.metric, actual: t.actual_value, target: t.target_value, pct: t.pct, days_left: t.days_left })), visits_done: perf.visits_done, revenue_minor: perf.revenue_minor, spoken_summary: perf.spoken_summary });
}
main().catch((e) => { console.error(e); process.exit(1); });
