// Check query: days since last confirmed order of an account on the demo day (metrics.md usual-frequency).
import { resolve } from "node:path";
import { Wful } from "./platform.ts";
import { parseDay } from "./tokens.ts";

export function daysSince(demoDay: string, dates: string[]): number | null {
  if (!dates.length) return null;
  const last = dates.map((d) => d.slice(0, 10)).sort().at(-1)!;
  return Math.round((parseDay(demoDay) - parseDay(last)) / 86400000);
}

async function main(argv: string[]): Promise<number> {
  const a: Record<string, string> = { profile: "hackathon", account: "Bistro Lofos", expect: "12", schema: "merc" };
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "").replace("demo-day", "demoDay")] = argv[i + 1];
  if (!a.workspace || !a.demoDay) throw new Error("--workspace and --demo-day are required");
  const w = new Wful(a.workspace, a.profile);
  const acc = await w.listAll(`${a.schema}.account`, [{ key: "name", operator: "eq", value: a.account }]);
  if (acc.length !== 1) throw new Error(`expected 1 account named ${a.account}, found ${acc.length}`);
  const orders = await w.listAll(`${a.schema}.sales_order`, [
    { key: "account_id", operator: "eq", value: acc[0].id }, { key: "status", operator: "eq", value: "confirmed" }]);
  const n = daysSince(a.demoDay, orders.map((r) => String(r.data.order_date)));
  console.log(`${a.account} (${acc[0].id}): ${orders.length} confirmed orders, last ${orders.map((r) => String(r.data.order_date).slice(0, 10)).sort().at(-1)}, days since last order on ${a.demoDay} = ${n} (expect ${a.expect})`);
  return String(n) === a.expect ? 0 : 1;
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
}
