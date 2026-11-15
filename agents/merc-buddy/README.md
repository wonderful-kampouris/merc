# merc-buddy (WP-BUD-01)

Conversational voice agent (Agents V2) for reps. Dev: agent `merc-buddy`, id `fdf85176-f403-4f1a-82c9-0aa6d3c9cca6`,
workspace `7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Source of truth is this folder; `infra/deploy/deploy.sh agent:merc-buddy --env dev --push` syncs it.

## Layout
| path | what | edited by hand? |
|---|---|---|
| `base.md`, `skills/<skill>/prompt.md`, `internal_prompts/memory_*.md` | prompts | yes |
| `config.json` | el-GR main + en-US (text_detect switching), multi-skill routing, customer memory (manual attach, scope all) | yes |
| `tools/<tool>/index.ts`, `skills/<skill>/skill.json` | the 30 contract tools and 12 contract skills | no: `pnpm gen` (scripts/gen-tools.ts) from `spec/contracts` |
| `lib/merc.gen.js` (+ `.d.ts`) | bundle of `shared/handlers` + `shared/core` + `shared/llm` + `shared/live` | no: `pnpm build-lib` |
| `lib/runtime.ts` | the one tool wrapper: secret, signed identity, injected fields, memory attach, caller log | yes |
| `test/` | vitest acceptance tests (run locally, not by the platform) | yes |
| `shared_lib/` | Shared Library submodule (main `e104d3d`) on the platform; only a `package.json` placeholder here so `pnpm install` works | no |
| `evals/` | owned by WP-BUD-02 | - |

Rebuild after any handler or contract change: `pnpm --dir agents/merc-buddy build && pnpm --dir agents/merc-buddy test`.

## How a tool call runs
1. The model fills only the contract `parameters`. `caller` is never a parameter.
2. `runTool` reads secret `MERC_INTERNAL_CALL_KEY`, verifies the `merc_uid|merc_org|merc_exp` HMAC claim in
   `communication.metadata` (minted by `fn:merc-chat-token` into the Chat SDK user token), and logs
   `{merc_tool, fn, caller, caller_source: "signed_session_claim"}`.
3. Injected values come from the session: `conversation_id` = communication id, `language` = session locale (el/en),
   `lat/lng` from `communication.metadata.merc_lat/merc_lng` (or `device_location`), constants such as `origin=manual`.
4. `runAsTool(slug, impl)` runs the same handler as the Wonderful Function (REQ-CORE-004).
5. `resolve_account` (when resolved), `get_visit_card` and `log_visit` attach the account id as the memory customer.

Failure modes the model sees as `{error}`: `blocked_by_policy` (secret missing or handler not built yet), `forbidden`
(no/invalid/expired claim), and the handler's own errors.

## Why a bundle instead of `shared_lib/utils/merc_core`
The handlers also need `shared/llm` and `shared/live`, which are not in the Shared Library, and the shared_lib copy of
`@merc/core` already lags the monorepo contracts (generated schemas differ). One bundle keeps handler, core and contracts
from the same tree. The Shared Library stays attached on `main` for shared tools later.

## REQ-BUD-012 / OPEN-11 hands-free phone (decision)
Not in the demo. The phone channel needs a phone number on this agent (human step) and a second identity path: the
tools accept only the signed Chat SDK claim, so a phone session would need `fn:merc-chat-token`-equivalent claims
written into communication metadata by an on_start tool that maps the caller id to `app_user.phone` and asks a PIN.
Until then reps use browser voice in the Rep App (works with the phone screen locked only while the page is open).

## TODO / cut
- `undo_action`: `shared/handlers/src/ai-action-undo.ts` does not exist yet; the tool answers `blocked_by_policy`
  naming the missing handler. Re-run `pnpm build` once it lands.
- `get_visit_card` skips Context Hub passages (no `context.api` in tools); the pitch still uses merc-write.
- `find_shops`: contract injects `device_location?` but `fn:prospect-search` has no lat/lng; dropped (change request).
