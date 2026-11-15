// J4 offline: interprets the deployed Procedure graphs (procedures/prospecting-pipeline/graphs/*.json) over the seeded
// in-memory tables, with the real shared handlers for every function step and the merc-research tool chain for the
// agent step. Proves the graph wiring (templates, table filter, serial dedupe, status branch) gives 18 / 5 / 13.
import { describe, expect, it } from "vitest";
import { createDb, runAsSystem } from "../../../shared/core/src/index";
import type { ModelFactory } from "../../../shared/llm/src/index";
import { kit, IDS, USERS } from "../../../shared/handlers/src/_lib/testkit";
import { makeImpl as directoryImpl } from "../../../shared/handlers/src/directory-search";
import { impl as dedupeImpl } from "../../../shared/handlers/src/candidate-dedupe";
import { makeImpl as scoreImpl } from "../../../shared/handlers/src/candidate-score";
import { makeImpl as finalizeImpl } from "../../../shared/handlers/src/search-finalize";
// @ts-expect-error plain ESM helper without types
import { PROCEDURES, renderGraph } from "../../../procedures/prospecting-pipeline/scripts/deploy.mjs";
import { getCandidate, saveDossier, scrapeWebsite, type ToolDeps } from "../lib/research";

const model: ModelFactory = () => ({ withStructuredOutput: () => ({ invoke: async () => ({ ratings: ["category_fit", "size_activity", "replaceable_brands", "reviews_traffic"].map((criterion) => ({ criterion, rating: 0.7, reason: `${criterion} ok` })) }) }) });
const noNet = async () => { throw new Error("no network"); };

type Graph = { nodes: Array<{ id: string; kind: string; config: any }>; edges: Array<{ from: string; to: string; port?: string }> };
const get = (scope: Record<string, any>, path: string) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), scope);
function resolve(v: any, scope: Record<string, any>): any {
  if (typeof v === "string") {
    const whole = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(v);
    if (whole) { const r = get(scope, whole[1]!); if (r === undefined) throw new Error(`missing ${whole[1]}`); return r; }
    return v.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => String(get(scope, p)));
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, scope));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, scope)]));
  return v;
}

describe("prospecting-pipeline graphs, simulated (J4)", () => {
  it("18 found, 5 duplicates, 13 researched + scored, search done", async () => {
    const t = kit();
    const db = createDb(t.tables, IDS.org);
    const search = await db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "Chalandri", origin: "manual", status: "running" } as any);
    const vars = { AGENT_MERC_RESEARCH_ID: "merc-research", CHILD_DEDUPE_ID: "dedupe", CHILD_RESEARCH_ID: "research" };
    const g: Record<string, Graph> = Object.fromEntries(PROCEDURES.map((p: any) => [p.name, renderGraph(p.file, vars)]));
    const children: Record<string, Graph> = { dedupe: g["merc-prospecting-dedupe-one"]!, research: g["merc-prospecting-research-one"]! };
    const fns: Record<string, any> = { "directory-search": directoryImpl({ fetch: noNet }), "candidate-dedupe": dedupeImpl, "candidate-score": scoreImpl({ model }), "search-finalize": finalizeImpl() };
    const agentTasks: string[] = [];

    async function run(graph: Graph, input: Record<string, unknown>): Promise<any> {
      const scope: Record<string, any> = {};
      let node = graph.nodes.find((n) => n.kind === "trigger")!;
      scope[node.id] = input;
      for (;;) {
        let port: string | undefined;
        const c = node.config;
        if (node.kind === "function") {
          const out = await runAsSystem(c.slug, fns[c.slug], { tables: t.tables, data: resolve(c.params, scope), orgId: IDS.org, caller: "procedure" });
          if (out && (out as any).error) throw new Error(`${c.slug}: ${JSON.stringify((out as any).error)}`);
          scope[node.id] = out;
        } else if (node.kind === "table") {
          const f = resolve(c.filter, scope);
          const rows = (await (db as any)[c.table_name.replace(/^merc\./, "")].all({ [f.column]: f.value })).slice(0, c.limit);
          scope[node.id] = { rows: rows.map((r: any) => ({ row_id: r.id, row: r })), count: rows.length };
        } else if (node.kind === "for_each") {
          const results = [];
          for (const item of resolve(c.items, scope)) results.push(await run(children[c.procedure_id]!, { [c.item_input]: item, ...c.inputs }));
          scope[node.id] = { count: results.length, results };
        } else if (node.kind === "branch") {
          const ok = c.conditions.every((x: any) => resolve(x.left, scope) === x.right);
          scope[node.id] = { result: ok }; port = ok ? "yes" : "no";
        } else if (node.kind === "agent") {
          const id = /candidate_id=([0-9a-f-]{36})/.exec(resolve(c.message, scope))![1]!;
          agentTasks.push(id);
          const kv = new Map<string, unknown>();
          const deps: ToolDeps = { tables: t.tables, kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) }, metadata: { contextType: "task", contextId: `task-${id}` }, fetch: noNet as any };
          const card: any = await getCandidate(deps, id);
          if (card.website) await scrapeWebsite(deps, card.website);
          await saveDossier(deps, { summary: card.website ? "website unreachable" : "no website", facts: [] });
          scope[node.id] = { status: "completed", task_id: `task-${id}` };
        } else if (node.kind === "return") {
          return resolve(c.output_mappings, scope);
        }
        const next = graph.edges.filter((e) => e.from === node.id && (port ? e.port === port : !e.port));
        if (!next.length) return scope;
        node = graph.nodes.find((n) => n.id === next[0]!.to)!;
      }
    }

    const scope = await run(g["merc-prospecting-pipeline"]!, { search_id: search.id });
    expect(scope["function-7"]).toEqual({ found: 18, duplicates: 5, scored: 13 });
    expect(agentTasks).toHaveLength(13);
    const cands = await db.candidate.all({ search_id: search.id });
    expect(cands.filter((c) => c.status === "duplicate")).toHaveLength(5);
    expect(cands.filter((c) => c.status === "scored")).toHaveLength(13);
    const dossiers = await db.dossier.all({ candidate_id: cands.map((c) => c.id) });
    expect(dossiers).toHaveLength(13);
    expect(dossiers.every((d) => d.research_task_id === `task-${d.candidate_id}`)).toBe(true);
    expect((await db.prospect_search.require(search.id)).status).toBe("done");
  });
});
