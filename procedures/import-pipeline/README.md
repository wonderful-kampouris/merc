# procedure import-pipeline (WP-IMP-01)

Contract: `spec/contracts/procedures/import-pipeline.json`. Dev procedure `merc-import-pipeline`
(id `20a4ce37-acdc-4fb2-81be-cb8541c38956`).

```
trigger (manual, programmatic) {import_id}
  -> function import-analyze      map columns (confidence), clean rows, write import_row_issue, status preview
  -> branch status == preview     (a failed analysis ends the run here)
  -> wait merc.data_import[import_id].status == confirmed   (poll 15 s, timeout 72 h)
  -> function import-apply        write clean rows, final issues, status imported
```

- `fn:import-start` starts it through `context.automations.invoke` when global variable `MERC_IMPORT_PROCEDURE_ID`
  is set; otherwise analyze runs inline and `fn:import-confirm` applies inline (same handlers, same result).
- The admin confirms in the app with `fn:import-confirm`, which only sets `status = confirmed` when a procedure run
  exists; the wait step then resumes and runs `import-apply`.
- Trigger deviation: the contract says `webhook`, but a webhook trigger needs a secret and no external system calls it;
  the only caller is `fn:import-start` (programmatic invocation), so the trigger is `manual`.

Files: `automation.json` (graph), `deploy.sh` (commit draft, validate, `--publish` + global variable),
`smoke-dev.sh` (dev smoke with the fixtures, plus cleanup), `fixtures/` (deterministic messy 200-row ERP export as CSV
and .xlsx with the planted issues, baseline orders; regenerate with
`node --experimental-strip-types procedures/import-pipeline/fixtures/make-fixtures.ts`).
