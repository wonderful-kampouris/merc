// Creates the TEMPORARY eval rep for run-dev.ts: an app_user mapped to the signed-in platform user (so `wful call`
// reaches fn:debrief-process as a Merc rep) plus a territory_rep row for the golden account's territory.
//   evals/debrief/run.sh setup-dev            -> prints the temp app_user id (pass it to run-dev / cleanup-dev)
// Safety: no phone, phone channel off, notify_channel app, no manager (ask-mode approvals stay with the temp rep,
// nobody is notified). Remove everything afterwards with cleanup-dev.ts --rep <id>.
// While the temp rep exists, EVERY `wful call` made with the same platform key (other builders' smokes too) runs as
// this rep, and crons (briefing-generate) treat it as a real rep. Keep the window short: setup, run, cleanup.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { insert, rows, wfulJson } from "./dev";

const HERE = dirname(fileURLToPath(import.meta.url)).includes("/tmp") ? join(process.cwd(), "evals/debrief") : dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(readFileSync(join(HERE, "golden.json"), "utf8")) as { account_keys: Record<string, string> };
const me = wfulJson<{ id: string; name: string }>(["whoami", "--json"]);
const existing = rows("app_user").find((u) => u.wonderful_user_id === me.id);
if (existing) { console.log(`platform user ${me.id} is already app_user ${existing.id} (${existing.full_name}); reuse it only if it is a temp eval rep`); process.exit(existing.full_name?.startsWith("Eval Rep") ? 0 : 1); }
const accs = rows("account").filter((a) => Object.values(g.account_keys).includes(a.id));
if (!accs.length) throw new Error("golden accounts not found on dev");
const org = accs[0]!.org_id as string;
const u: any = insert("app_user", {
  org_id: org, wonderful_user_id: me.id, role_code: "rep", manager_id: null, full_name: "Eval Rep (WP-DEB-01 temp)", email: "eval-rep-deb01@merc-demo.example",
  phone: null, preferred_language: "el", voice_enabled: false, status: "active", phone_channel_enabled: false, notify_channel: "app",
});
const id = u.id ?? u.data?.id;
for (const t of new Set(accs.map((a) => a.territory_id).filter(Boolean))) insert("territory_rep", { territory_id: t, user_id: id });
console.log(id);
