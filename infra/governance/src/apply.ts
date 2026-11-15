// Creates or updates the Merc external-send policy in one environment. Idempotent by name; never deletes.
//   node --experimental-strip-types infra/governance/src/apply.ts --env dev            # plan only
//   node --experimental-strip-types infra/governance/src/apply.ts --env dev --push     # create/update + verify
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_NAME, policyBody, verifyPolicy } from "./policy.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export function envOf(name: string): { profile: string; workspace: string } {
  if (name !== "dev" && name !== "demo") throw new Error(`--env must be dev or demo (got ${JSON.stringify(name)}); there is no default`);
  const e = JSON.parse(readFileSync(join(ROOT, "infra/deploy/environments.json"), "utf8"))[name];
  if (!e?.workspace) throw new Error(`env ${name} has no workspace id`);
  return e;
}

function main(argv: string[]) {
  const envName = argv[argv.indexOf("--env") + 1] ?? "";
  const env = envOf(argv.includes("--env") ? envName : "");
  const run = (a: string[]) => execFileSync("wful", ["--profile", env.profile, "--workspace", env.workspace, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const body = policyBody(JSON.parse(run(["integrations", "schema", "--json"])));
  const existing = (JSON.parse(run(["governance", "policy-list", "--json"])) as any[]).filter((p) => p.name === POLICY_NAME);
  if (existing.length > 1) throw new Error(`more than one policy named ${POLICY_NAME}`);
  const stable = existing[0]?.policy_id as string | undefined;
  console.log(`${argv.includes("--push") ? "" : "plan: "}${stable ? `update ${stable}` : "create"} ${POLICY_NAME}: ${body.definition.effect.outcome} on ${body.definition.selectors.action_targets.map((t) => `${t.action_key}@${t.connection_id}`).join(", ")}`);
  if (!argv.includes("--push")) return;
  const file = join(mkdtempSync(join(tmpdir(), "merc-gov-")), "policy.json");
  if (stable) {
    // policy_target cannot change and stored channel fields must not be resent; update the rest.
    const { policy_target: _t, scope: _s, ...changes } = body;
    writeFileSync(file, JSON.stringify(changes, null, 1));
    run(["governance", "policy-update", stable, "--value-file", file, "--json"]);
  } else {
    writeFileSync(file, JSON.stringify(body, null, 1));
    run(["governance", "policy-create", "--value-file", file, "--json"]);
  }
  const now = (JSON.parse(run(["governance", "policy-list", "--json"])) as any[]).find((p) => p.name === POLICY_NAME);
  const got = JSON.parse(run(["governance", "policy-latest", now.policy_id, "--json"]));
  const bad = verifyPolicy(body, got);
  console.log(`${POLICY_NAME} policy_id=${now.policy_id} version=${got.version} ${bad.length ? `MISMATCH ${bad.join("; ")}` : "verified"}`);
  if (bad.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
