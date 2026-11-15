// Offline promotion dry-run for the demo workspace (WP-DEMO-01, REQ-OPS-001). Reads infra/demo/promotion.json and
// infra/deploy/environments.json, asks deploy.sh for each component's resolved plan with --print-plan (which exits
// before git or the network), and prints the ordered runbook. It never calls wful and never deploys anything.
//   node --experimental-strip-types infra/demo/src/promote-plan.ts [--env demo] [--out docs/demo/promotion-dry-run.txt]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

export interface Manifest {
  functions: string[]; crons: string[]; agents: string[]; app: boolean;
  globals: Record<string, string>; secrets: string[];
  service_account: { name: string; scopes: string[]; pin_on: string[] }; knowledge_bases: string[];
}
export interface Env { profile: string; workspace: string }

/** Gate: the target env must be filled in and must not be the dev workspace. */
export function gate(envs: Record<string, Partial<Env>>, name: string): { ok: boolean; why: string } {
  const e = envs[name];
  if (!e?.workspace || !e.profile) return { ok: false, why: `environments.json has no ${name} profile/workspace: the human fills it in first` };
  if (name !== "dev" && e.workspace === envs.dev?.workspace) return { ok: false, why: `${name} workspace equals dev; refusing` };
  return { ok: true, why: `${name} = ${e.workspace} (profile ${e.profile})` };
}

/** Every component deploy.sh handles, in promotion order (backend before the agent that calls it, app last). */
export function components(m: Manifest): string[] {
  return [...m.functions.map((f) => `fn:${f}`), ...m.crons.map((f) => `fn:${f}`), ...m.agents.map((a) => `agent:${a}`), ...(m.app ? ["app"] : [])];
}

/** Ordered runbook lines. `planOf(c)` returns deploy.sh --print-plan output for one component. */
export function runbook(m: Manifest, env: string, e: Env, planOf: (c: string) => string): string[] {
  const W = `wful --profile ${e.profile} --workspace ${e.workspace}`;
  const L: string[] = [];
  const step = (n: string, t: string, cmds: string[]) => { L.push(`## ${n}. ${t}`); for (const c of cmds) L.push(`    ${c}`); L.push(""); };
  step("0", "Gate (human): evals green (REQ-OPS-004), owner consent for the real phone, nobody else deploying to " + env, [
    "pnpm -C agents/merc-buddy test   # plus the merc-buddy eval suite on dev",
    "bash scripts/check.sh            # contracts + package tests + secret scan",
  ]);
  step("1", "Tables (schema merc)", [`infra/tables/apply.sh --workspace ${e.workspace} --profile ${e.profile} --dry-run`, `infra/tables/apply.sh --workspace ${e.workspace} --profile ${e.profile}`, `infra/tables/verify.sh --workspace ${e.workspace} --profile ${e.profile}`]);
  step("2", "Seed for the demo day (wuid file with the demo workspace's user ids; phones.json only with consent)", [
    `cp infra/seed/wuid.example.json infra/seed/wuid.${env}.json   # fill the ${env} Wonderful user ids`,
    `infra/demo/reset-demo.sh --env ${env} --wuid-file infra/seed/wuid.${env}.json --dry-run`,
    `infra/demo/reset-demo.sh --env ${env} --wuid-file infra/seed/wuid.${env}.json`,
    `infra/seed/check.sh --workspace ${e.workspace} --profile ${e.profile} --demo-day $(TZ=Europe/Athens date +%F)`,
  ]);
  step("3", "Globals and secrets (human; values never in the repo, REQ-OPS-005)", [
    ...Object.entries(m.globals).map(([k, v]) => `${W} global-variables create --name ${k} --type ${k === "MERC_CHANNELS_LIVE" ? "boolean --value false" : "string --value '\"<value>\"'"}   # ${v}`),
    ...m.secrets.map((s) => `${W} secrets create --name ${s} --type "API Key" --value-file <private file outside the repo>`),
  ]);
  step("4", `Service account ${m.service_account.name} (${m.service_account.scopes.join(", ")}), pinned on`, m.service_account.pin_on.map((f) => `fn:${f}`));
  step("5", `Knowledge bases ${m.knowledge_bases.join(", ")}`, [`infra/kb/apply.sh --env ${env} --plan`, `infra/kb/apply.sh --env ${env}`]);
  const comps = components(m);
  step("6", `Functions, crons, agent, app (${comps.length} components; plan first, then --push)`, comps.map((c) => `make plan C=${c} ENV=${env} && make deploy C=${c} ENV=${env}`));
  step("7", "Monitors", [`node --experimental-strip-types infra/monitors/src/apply.ts --env ${env}`, `node --experimental-strip-types infra/monitors/src/apply.ts --env ${env} --push`]);
  step("8", "Rehearsal (with the phone owner present)", [`infra/demo/reset-demo.sh --env ${env} --next-visit-in 32 --live-phone-ok`, "then docs/demo/demo-script.md, beat by beat"]);
  L.push("## deploy.sh --print-plan per component (offline, nothing pushed)");
  for (const c of comps) { L.push(`### ${c}`); for (const l of planOf(c).trimEnd().split("\n")) L.push(`    ${l}`); }
  return L;
}

function main(argv: string[]): number {
  let env = "demo", out = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env") env = argv[++i];
    else if (argv[i] === "--out") out = resolve(argv[++i]);
    else { console.error(`unknown argument ${argv[i]}`); return 2; }
  }
  const envs = JSON.parse(readFileSync(resolve(ROOT, "infra/deploy/environments.json"), "utf8"));
  const g = gate(envs, env);
  const m = JSON.parse(readFileSync(resolve(ROOT, "infra/demo/promotion.json"), "utf8")) as Manifest;
  const missing = [...m.functions, ...m.crons].filter((f) => !existsSync(resolve(ROOT, "functions", f, "config.json")));
  const header = [`# Merc promotion dry-run to ${env} (generated by infra/demo/src/promote-plan.ts; nothing was deployed)`,
    `gate: ${g.ok ? "ok" : "BLOCKED"}: ${g.why}`, `missing function folders: ${missing.length ? missing.join(", ") : "none"}`, ""];
  if (!g.ok) { console.log(header.join("\n")); return 1; }
  const planOf = (c: string) => execFileSync("bash", [resolve(ROOT, "infra/deploy/deploy.sh"), c, "--env", env, "--print-plan"], { encoding: "utf8" }).split(`${ROOT}/`).join("");
  const text = [...header, ...runbook(m, env, envs[env], planOf)].join("\n") + "\n";
  if (out) writeFileSync(out, text);
  console.log(text);
  return missing.length ? 1 : 0;
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) process.exit(main(process.argv.slice(2)));
