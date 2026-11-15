# infra/kb (WP-CRD-01)

Context Hub knowledge bases from `spec/contracts/platform/platform.json` `knowledge_bases`:
`merc-catalog` and `merc-playbook`. Content: `content/kb/<kb>/*.md`.

```
infra/kb/apply.sh --env dev --plan    # what would change
infra/kb/apply.sh --env dev           # create if missing, upload new files, commit evals, run --wait, smoke ask
```

- `pipeline.json`: upload -> convert (needed even for Markdown) -> chunk 800/160 -> custom table store; semantic retrieval, top 4.
- `evals.<kb>.json`: non-gating evals (`wful kb eval-run <id> --all`).
- `fn:visit-card-get` finds the KBs by name through `context.api` (`GET /v1/knowledge-bases`, `POST /v1/knowledge-bases/{id}/ask`),
  or by id from global variables `MERC_KB_CATALOG_ID` / `MERC_KB_PLAYBOOK_ID`. Without a service account on the function it
  skips the KBs, logs why, and still answers (the pitch is grounded in dossier facts only).
