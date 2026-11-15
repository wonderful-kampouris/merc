#!/usr/bin/env node
// WP-APP-08: link every deployed app-callable function (contract callers include app|mgmt) to app merc
// with its contract gate. Idempotent: skips functions already linked, reports contract functions not on dev.
// Usage: node evidence/WP-APP-08/attach-resources.mjs [--dry-run]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = ["--profile", "hackathon", "--workspace", "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464"];
const dry = process.argv.includes("--dry-run");
const wful = (...args) => execFileSync("wful", [...BASE, ...args], { encoding: "utf8" });

const dir = join(ROOT, "spec/contracts/functions");
const contracts = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
  .filter((c) => (c.callers ?? []).some((x) => x === "app" || x === "mgmt"));

const deployed = new Map(JSON.parse(wful("functions", "api", "list", "--json")).map((f) => [f.path_slug ?? f.name, f]));
const linked = new Set(JSON.parse(wful("apps", "resources-list", "--app", "merc", "--json")).map((r) => r.resource_ref));

const missing = [];
let attached = 0;
for (const c of contracts) {
  const fn = deployed.get(c.slug);
  if (!fn) { missing.push(c.slug); continue; }
  if (linked.has(fn.id)) { console.log(`linked   ${c.slug} (${fn.id})`); continue; }
  const gate = c.gate ? ["--required-permission", c.gate] : ["--all-app-callers"];
  const args = ["apps", "resources-attach", "merc", "--function", fn.id, "--mode", "linked", ...gate];
  if (dry) { console.log(`would    wful ${args.join(" ")}`); continue; }
  wful(...args);
  attached++;
  console.log(`attached ${c.slug} (${fn.id}) gate=${c.gate ?? "all-app-callers"}`);
}
console.log(`\napp-callable in contracts: ${contracts.length}; newly attached: ${attached}; not deployed on dev: ${missing.length}`);
if (missing.length) console.log(`not deployed: ${missing.join(", ")}`);
