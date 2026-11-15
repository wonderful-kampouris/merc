// Deploy the prospecting-pipeline procedure (contracts/procedures/prospecting-pipeline.json) to a workspace.
// Three Procedures: merc-prospecting-dedupe-one and merc-prospecting-research-one (children, typed for_each items),
// then merc-prospecting-pipeline (parent: directory -> dedupe each -> research+score each -> finalize).
//
//   node procedures/prospecting-pipeline/scripts/deploy.mjs --env dev            # plan: show what would change
//   node procedures/prospecting-pipeline/scripts/deploy.mjs --env dev --publish  # create/commit/validate/publish
//   node procedures/prospecting-pipeline/scripts/deploy.mjs --env dev --enable   # + set global MERC_PROSPECTING_PROCEDURE_ID
//     (fn:prospect-search then starts this procedure instead of its inline chain; unset/empty it to fall back)
//
// Workspace ids come from infra/deploy/environments.json (only dev is allowed until demo exists). The ids of the
// procedures are written to deployed.<env>.json. Never deletes anything.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
/** Read by fn:prospect-search (shared/handlers/src/prospect-search.ts GLOBAL_PIPELINE_ID). */
export const GLOBAL_PIPELINE_ID = "MERC_PROSPECTING_PROCEDURE_ID";

export const PROCEDURES = [
  { key: "CHILD_DEDUPE_ID", name: "merc-prospecting-dedupe-one", file: "dedupe-one.json", description: "Merc prospecting: dedupe ONE candidate (fn:candidate-dedupe). Child of merc-prospecting-pipeline." },
  { key: "CHILD_RESEARCH_ID", name: "merc-prospecting-research-one", file: "research-one.json", description: "Merc prospecting: merc-research dossier + fn:candidate-score for ONE new candidate. Child of merc-prospecting-pipeline." },
  { key: "PIPELINE_ID", name: "merc-prospecting-pipeline", file: "pipeline.json", description: "Merc prospecting pipeline (contracts/procedures/prospecting-pipeline.json, REQ-PRS-001): directory-search -> dedupe -> merc-research -> candidate-score -> search-finalize. Started by fn:prospect-search via MERC_PROSPECTING_PROCEDURE_ID." },
];

/** Graph file with ${VARS} substituted. Throws when a placeholder has no value. */
export function renderGraph(file, vars) {
  const text = readFileSync(join(here, "../graphs", file), "utf8").replace(/\$\{([A-Z_]+)\}/g, (_, k) => {
    if (!vars[k]) throw new Error(`${file}: no value for \${${k}}`);
    return vars[k];
  });
  return JSON.parse(text);
}

// Strip editor-assigned fields so the plan diff compares only authored content.
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const norm = (g) => JSON.stringify(canon({ nodes: (g?.nodes ?? []).map(({ ref, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id)), edges: (g?.edges ?? []).map((e) => ({ from: e.from, to: e.to, port: e.port || "" })) }));

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const envName = args[args.indexOf("--env") + 1];
  if (!args.includes("--env") || !["dev", "demo"].includes(envName)) { console.error("usage: deploy.mjs --env dev|demo [--publish]"); process.exit(2); }
  const ENABLE = args.includes("--enable");
  const PUBLISH = args.includes("--publish") || ENABLE;
  const envs = JSON.parse(readFileSync(join(ROOT, "infra/deploy/environments.json"), "utf8"));
  const env = envs[envName];
  if (!env?.workspace) { console.error(`env ${envName} has no workspace id`); process.exit(2); }
  if (envName === "demo" && env.workspace === envs.dev.workspace) { console.error("demo equals dev; refusing"); process.exit(2); }

  const wful = (...a) => execFileSync("wful", ["--profile", env.profile, "--workspace", env.workspace, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const call = (method, path, body) => {
    const a = ["call", method, path, "--json"];
    if (body !== undefined) a.push("--data", JSON.stringify(body));
    const out = wful(...a);
    const j = out.trim() ? JSON.parse(out) : null;
    return j && typeof j === "object" && "data" in j && "status" in j ? j.data : j;
  };

  function agentId(slug) {
    const list = JSON.parse(wful("agents", "list", "--json"));
    const rows = Array.isArray(list) ? list : list.data ?? list.items ?? [];
    const a = rows.find((r) => r.agent_slug === slug || r.slug === slug);
    if (!a?.id) throw new Error(`agent ${slug} not found in ${envName}`);
    return a.id;
  }
  
  const existing = () => { const r = call("get", "/api/v1/automations"); return Array.isArray(r) ? r : r?.items ?? []; };

  const vars = { AGENT_MERC_RESEARCH_ID: agentId("merc-research") };
  const out = { env: envName, workspace: env.workspace, agent_merc_research_id: vars.AGENT_MERC_RESEARCH_ID, procedures: {} };
  for (const p of PROCEDURES) {
    const graph = renderGraph(p.file, vars);
    let a = existing().find((x) => x.name === p.name);
    if (!a) {
      if (!PUBLISH) { console.log(`plan: create ${p.name}`); vars[p.key] = `<new ${p.name}>`; continue; }
      a = call("post", "/api/v1/automations", { name: p.name, description: p.description, graph });
      console.log(`created ${p.name} ${a.id}`);
    }
    vars[p.key] = a.id;
    const draft = call("get", `/api/v1/automations/${a.id}/draft`);
    const same = norm(draft.graph) === norm(graph);
    if (!PUBLISH) { console.log(`plan: ${p.name} ${a.id} ${same ? "unchanged" : "would commit + publish"}`); out.procedures[p.name] = a.id; continue; }
    let d = draft;
    if (!same) {
      const c = call("post", `/api/v1/automations/${a.id}/draft/commit`, { graph, expected_commit_sha: draft.commit_sha, commit_message: "deploy from merc monorepo (procedures/prospecting-pipeline)" });
      const errs = c?.validation_result?.errors ?? [];
      if (errs.length) throw new Error(`${p.name}: commit validation errors ${JSON.stringify(errs)}`);
      const warns = c?.validation_result?.warnings ?? [];
      if (warns.length) console.log(`${p.name}: warnings ${JSON.stringify(warns)}`);
      d = call("get", `/api/v1/automations/${a.id}/draft`);
    }
    const v = call("post", `/api/v1/automations/${a.id}/draft/validate`, {});
    if (v?.errors?.length) throw new Error(`${p.name}: validate errors ${JSON.stringify(v.errors)}`);
    try {
      call("post", `/api/v1/automations/${a.id}/draft/publish`, { expected_variant_commit_sha: d.variant_commit_sha, expected_draft_commit_sha: d.commit_sha, commit_message: "publish from merc monorepo" });
      console.log(`published ${p.name} ${a.id}`);
    } catch (e) {
      const msg = String(e.stderr ?? e.message);
      if (/nothing to publish|no changes|already published/i.test(msg)) console.log(`${p.name} ${a.id} already published`);
      else throw new Error(`${p.name}: publish failed: ${msg}`);
    }
    out.procedures[p.name] = a.id;
  }
  if (ENABLE) {
    const id = out.procedures["merc-prospecting-pipeline"];
    const list = JSON.parse(wful("global-variables", "list", "--json"));
    const rows = Array.isArray(list) ? list : list.data ?? list.items ?? [];
    const g = rows.find((r) => r.name === GLOBAL_PIPELINE_ID);
    if (g) wful("global-variables", "update", g.id, "--type", "string", "--value", JSON.stringify(id));
    else wful("global-variables", "create", "--name", GLOBAL_PIPELINE_ID, "--type", "string", "--value", JSON.stringify(id), "--description", "WP-PRS-02: procedure merc-prospecting-pipeline started by fn:prospect-search");
    console.log(`${GLOBAL_PIPELINE_ID} = ${id}`);
  }
  if (PUBLISH) {
    writeFileSync(join(here, `../deployed.${envName}.json`), JSON.stringify(out, null, 2) + "\n");
    console.log(`wrote procedures/prospecting-pipeline/deployed.${envName}.json`);
  }
}
