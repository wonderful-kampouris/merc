// Dev smoke for fn:visit-card-get (WP-CRD-01, REQ-CRD-001/002) on the real dev tables and the real Context Hub KBs.
// Runs the SAME makeImpl that is bundled into functions/visit-card-get, through defineFunction, with:
//   - context.tables over the wful CLI (the app gate answers 403 to `wful call`, and the CLI user is no Merc user),
//   - the KBs through kbFromApi over `wful call` (/api/v1/knowledge-bases, /ask), exactly as context.api would,
//   - the caller set to seeded rep Dimitra (North, same territory as Miltos/Avra; no phone path anywhere),
//   - the pitch LLM via shared/llm callStructured (no ModelProfiles outside the runtime -> deterministic fallback).
// Read-only except campaign_exposure `shown` rows, which it deletes again (only the ids it created).
//
//   infra/kb/card-smoke.sh
import { execFileSync } from "node:child_process";
import { defineFunction, testFilter, type Filter, type OrderBy, type RowEnvelope, type TablesApi } from "../../shared/core/src/index";
import { callStructured } from "../../shared/llm/src/index";
import { kbFromApi, makeImpl, MAX_SPOKEN_WORDS, PITCH_INSTRUCTIONS } from "../../shared/handlers/src/visit-card-get";

const WS = "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464";
const WUID = "merc-demo-wuid-dimitra";
const MILTOS = "59b5e454-cc4b-5fab-939b-a50c78e8aa9b";
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";

const run = (args: string[]) => execFileSync("wful", ["--profile", "hackathon", "--workspace", WS, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const tbl = (args: string[]): any => { const o = run(["tables", ...args, "--json"]).trim(); return o ? JSON.parse(o) : null; };
const env = (r: any): RowEnvelope => ({ id: r.id, data: { ...r.data, created_at: r.created_at, updated_at: r.updated_at } });
const unwrap = (res: any) => (res && "id" in res ? res : res?.data ?? res);

const cache = new Map<string, RowEnvelope[]>();
const cli: TablesApi = {
  async getRow(t, id) { return env(unwrap(tbl(["row-get", t, id]))); },
  async filter(t, filters: Filter[], limit = 100, offset = 0, orderBy?: OrderBy) {
    let all = cache.get(t);
    if (!all || t.endsWith("campaign_exposure")) {
      all = [];
      for (let page = 1; ; page++) {
        const res = tbl(["row-list", t, "--limit", "100", "--page", String(page)]);
        all.push(...(res.data as any[]).map(env));
        if (!res.pagination?.has_next_page) break;
      }
      cache.set(t, all);
    }
    const rows = all.filter((r) => filters.every((f) => testFilter(r.data, f)));
    for (const o of [...(orderBy ?? [])].reverse()) {
      const d = o.direction === "desc" ? -1 : 1;
      rows.sort((a, b) => (a.data[o.column] > b.data[o.column] ? d : a.data[o.column] < b.data[o.column] ? -d : 0));
    }
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
  async insert(t, data) { const r = env(unwrap(tbl(["row-insert", t, "--data", JSON.stringify(data)]))); created.push([t, r.id]); return r; },
  async update() { throw new Error("card smoke must not update rows"); },
  async deleteRow() { throw new Error("card smoke must not delete rows"); },
  async count(t, filters = []) { return (await this.filter(t, filters, 100000)).total; },
};
const created: Array<[string, string]> = [];

/** context.api as the function runtime would give it, over `wful call` (paths /v1/... -> /api/v1/...). */
const api = {
  async get(path: string) { return JSON.parse(run(["call", "get", `/api${path}`, "--raw"])); },
  async post(path: string, o?: { body?: unknown }) { return JSON.parse(run(["call", "post", `/api${path}`, "--data", JSON.stringify(o?.body ?? {}), "--raw"])); },
};

async function card(accountId: string, logs: string[]) {
  const log = (m: string) => logs.push(m);
  let kbHits = 0;
  const kb = kbFromApi(api, { globals: null } as any, log);
  const counting = makeImpl({ pitch: (input) => callStructured("visit_card_pitch", input, { instructions: PITCH_INSTRUCTIONS }), kb: async (n, q) => { const r = await kb(n, q); kbHits += r.length; return r; }, log });
  const res: any = await defineFunction("visit-card-get", counting)({ tables: cli, data: { account_id: accountId }, query: { account_id: accountId }, metadata: { user: { id: WUID } } } as any);
  return { res, kbHits };
}

async function main() {
  try {
    const logs: string[] = [];
    const m = await card(MILTOS, logs);
    if (m.res.error) throw new Error(`Miltos card error ${JSON.stringify(m.res.error)}`);
    const r = m.res;
    console.log("miltos", JSON.stringify({
      kind: r.kind, contacts: r.contacts.map((c: any) => c.full_name), open_problems: r.open_problems.map((p: any) => p.description),
      open_tasks: r.open_tasks.length, recent_orders: r.recent_orders.map((o: any) => o.order_date), metrics: r.metrics,
      alerts: r.alerts.map((a: any) => a.type), campaigns: r.campaigns.map((c: any) => c.title), suggested: r.suggested_products.map((p: any) => p.name),
      how_to_talk: r.how_to_talk, kb_passages: m.kbHits,
    }));
    console.log("miltos spoken", JSON.stringify(r.spoken_summary), `words=${r.spoken_summary.split(/\s+/).length}/${MAX_SPOKEN_WORDS}`);
    console.log("miltos checks", JSON.stringify({ grinder: /grinder/i.test(r.spoken_summary), usual_12kg: /12 kg/.test(r.spoken_summary) }));

    const a = await card(AVRA, logs);
    if (a.res.error) throw new Error(`Avra card error ${JSON.stringify(a.res.error)}`);
    const p = a.res;
    console.log("avra", JSON.stringify({
      kind: p.kind, competitor_brands: p.dossier?.competitor_brands, facts: p.dossier?.facts.map((f: any) => `${f.fact_type}: ${f.value} <${f.source_url}>`),
      pitch_arguments: p.pitch?.arguments.length, objections: p.pitch?.objections.map((o: any) => o.objection), kb_passages: a.kbHits,
    }));
    console.log("logs", JSON.stringify([...new Set(logs)]));
  } finally {
    for (const [t, id] of created) { run(["tables", "row-delete", t, id, "--force"]); }
    console.log("cleanup deleted", JSON.stringify(created));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
