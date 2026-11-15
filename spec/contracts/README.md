# Merc contracts

Machine-readable contracts that every builder agent codes against. `../SPEC.md` says *what* must hold; these files say *exactly how the pieces talk*.

**Do not edit the JSON by hand.** Edit the sources in `../_build/*_src.py` and regenerate:
```
python3 -I spec/_build/build.py
```
The build validates everything, then rewrites this folder. It exits 1 on any error and writes nothing.

| folder | source | content |
|---|---|---|
| `tables/` | `tables_src.py` | `{create, x}` per table: `create` is the Wonderful Tables payload, `x` holds enums, notes and derived flags. `_order.json` gives the creation order and the deferred self-references. |
| `functions/` | `functions_src.py`, `agents_src.py` | One file per Wonderful Function: method, gate, callers, JSON-schema request and response, tables read and written, LLM schemas, integrations. |
| `_defs.json` | `functions_src.py` | Shared JSON-schema definitions such as `ApprovalCard`, `VisitCard` and `ResultCard`. |
| `tools/<agent>/` | `agents_src.py` | Agent tools: parameters the model fills, values injected by code, the backing function. |
| `agents/`, `procedures/`, `platform/` | `agents_src.py` | Agent definitions, procedure graphs, integrations, model profiles, knowledge bases, secrets, monitors. |
| `llm/` | `llm_events_src.py` | Structured LLM input/output schemas with rules and eval set paths. |
| `events/` | `llm_events_src.py` | merc-live WebSocket messages, sent as `{type, at, payload}`. |
| `app/app.json` | `app_src.py` | App permissions, roles, relation scopes, screens. |
| `seed/` | `seed_src.py` | Deterministic demo data, loaded in `_order.json` order. |
| `metrics.md` | hand-written | Every computed number. |
| `INDEX.md` | generated | Overview tables. |

## Conventions
- **Keys.** Every table has surrogate `id auto_uuid`. Lookup tables use a string `code` as the key. Natural keys are unique indexes. FK columns have the referenced key's type.
- **System columns.** `created_at` and `updated_at` are platform columns and are never declared.
- **Units.** Money is `*_minor` integers in the org currency. Percentages are 0-100. Probabilities are 0-1.
- **Identity.** The caller is never a request field. It comes from the app session or the tool session and is resolved by the shared `me()`.
- **Responses.** The platform wraps every function response as `{"result": ..., "logs": [...]}`. Schemas describe `result`. Errors use `{"error": Error}`.
- **GET requests.** GET functions take scalar params only. Nested bodies use POST.
- **Callers.** `app` and `mgmt` are the rep and management screens of the same Wonderful App. `buddy` is the merc-buddy agent tools. `scheduler` is cron. `procedure` is procedure steps.
- **Tool parameters.** Tool `parameters` are what the model fills. `inject` lists values set by code from the session (`caller`, `conversation_id`, `call_metadata.*`, `x=value` constants), never by the model.
- **Seed tokens.** `@D`, `@D-12` and `@D+3@09:30` are relative to the demo day. `@WEEK_START`, `@MONTH_START` and `@MONTH_END` are calendar anchors. `@wuid:<key>` is the Wonderful user id of the invited demo user. The loader resolves them, so the demo always looks "live".
- **Tables payload.** The `create` blocks keep the contract shape. `infra/tables` translates them to the verified platform payload: per-column `primary_key: true`, `reference: {table: "merc.<t>", on_delete}`, index `type`, index names of at most 49 characters (see `docs/spikes/S9-S10.md`). Switching build.py to emit the platform shape directly is queued as WP-INF-03.
- **Function responses.** Responses may arrive wrapped in `{result, logs}` or bare. Clients handle both.
- **Unique violations.** The Tables API returns 500 on a duplicate. `@merc/core` pre-checks natural keys and returns `conflict`.
- **Scopes.** The `scope` field on functions uses: `account`, `owner`, `owner_or_team`, `team`, `approver`, `requester_or_approver`, `dashboard`. Helpers with the same names are in `shared/core/src/scope.ts`. A manager's team is their direct and indirect reports plus the territories they manage.
- **Tool identity.** `inject: caller` in a buddy tool means the claims `merc_uid`, `merc_org`, `merc_exp` and `merc_sig` (HMAC-SHA256 of `uid|org|exp` with `MERC_INTERNAL_CALL_KEY`) are read from the session metadata and verified. They are minted by `fn:merc-chat-token`.
- **System callers.** Crons and procedures run with a system principal for one org. They never send customer messages.

## Validation done by build.py
- Tables: naming, the 50-column and 10-index limits, no system columns, FK targets and on_delete rules, index columns exist, no FK cycles. A warning flags FKs without a leading index.
- Functions: unique slug and method, GET params scalar, `$ref`s resolve, gates exist in the permission catalog, tables, LLM schemas and integrations exist.
- Tools: the function exists and lists the agent as a caller, params are a subset of the request, and every required request field is a param or injected.
- Agents and procedures: skill tools exist, procedure steps reference real functions, agents and tables.
- App: role permissions and relations exist, screen functions are app-callable, screen events exist, every table is used by some function.
- Seed: columns exist, types and enums are right, required fields are present, FKs point to seeded rows, unique indexes hold, lookup codes are complete.
- SPEC.md: REQ ids are unique and every referenced REQ, contract path, `fn:` and `tbl:` exists.
