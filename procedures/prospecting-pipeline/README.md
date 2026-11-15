# prospecting-pipeline (WP-PRS-02)

Contract: `spec/contracts/procedures/prospecting-pipeline.json` (REQ-PRS-001/003/005). Three Wonderful Procedures:

| Procedure | Graph | What it does |
|---|---|---|
| `merc-prospecting-pipeline` | `graphs/pipeline.json` | trigger `{search_id}` (programmatic, started by `fn:prospect-search`) -> `fn:directory-search` -> read the search's candidates -> for each (serial) dedupe -> read again -> for each (parallel, 16) research + score -> `fn:search-finalize` (pushes `candidates.ready`) |
| `merc-prospecting-dedupe-one` | `graphs/dedupe-one.json` | `fn:candidate-dedupe` for one candidate. Serial on purpose: two rows of one search that match each other must give exactly one duplicate |
| `merc-prospecting-research-one` | `graphs/research-one.json` | still `new`? -> agent `merc-research` (task `candidate_research`, wait for result; the agent's task timeout is 5 min) -> `fn:candidate-score`. Duplicates return `researched:false` |

Ids on dev: `deployed.dev.json`. The agent lives in `agents/merc-research/`.

```
node procedures/prospecting-pipeline/scripts/deploy.mjs --env dev            # plan
node procedures/prospecting-pipeline/scripts/deploy.mjs --env dev --publish  # create/commit/validate/publish
node procedures/prospecting-pipeline/scripts/deploy.mjs --env dev --enable   # + global MERC_PROSPECTING_PROCEDURE_ID
node procedures/prospecting-pipeline/scripts/j4.mjs --env dev                # J4: 18 found / 5 dup / 13 scored < 5 min, then cleanup
node --test procedures/prospecting-pipeline/test/graphs.test.mjs              # structure vs the contract
```

## Fallback (function chain)
Procedures are beta. `fn:prospect-search` starts this procedure only when global `MERC_PROSPECTING_PROCEDURE_ID`
names it and `context.automations.invoke` works; otherwise it runs its inline chain (directory -> dedupe -> score ->
finalize, no research dossier) inside the function call (shared/handlers/src/prospect-search.ts). Clearing the global
variable switches back to the inline chain.

## Platform notes (learned on dev)
- Table read `filter` takes ONE condition `{column, op, value}`; extra keys (`and`, `conditions`) are ignored or
  rejected. So the loops read all candidates of the search and the child branches on `row.status == "new"`.
- A webhook trigger needs a `secret_ref`; the pipeline uses a manual trigger with `programmatic_invocation_enabled`,
  since its only caller is `fn:prospect-search` (contract change reported).
- Dedupe compares against every live candidate of the org, so a kept J4 search makes the next J4 run see its shops as
  duplicates. `j4.mjs` deletes the rows it created unless `--keep`.
