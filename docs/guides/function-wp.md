# Builder guide: one Merc function, end to end (WP-CORE-01b)

Every wave 2+ function WP follows these steps. The worked examples are `fn:me` (GET, no secrets) and
`fn:merc-chat-token` (POST, gated, secrets, outbound fetch, degrades while blocked).

Workspace for every command: `W="wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464"` (dev).
Never use another profile or workspace. Never `--force`. In zsh use a function: `W(){ wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464 "$@"; }`.

## 0. What goes where

| Piece | Path | Owner |
|---|---|---|
| Contract (law) | `spec/contracts/functions/<slug>.json` | spec; report changes, never edit |
| Business layer | `shared/core/src` (`@merc/core`): table repos, `me()`, scope, errors, validation, dates | WP-CORE-01/01b |
| Handler (the impl) | `shared/handlers/src/<slug>.ts`, one file per function, **no barrel/index** | your WP |
| Handler tests | `shared/handlers/test/<slug>.test.ts` | your WP |
| Test helpers | `shared/handlers/src/_lib/testkit.ts` (seeded in-memory db, principals, contexts) | WP-CORE-01b |
| Function folder | `functions/<slug>/{config.json,index.ts,handler.gen.js}` | your WP |
| Buddy tool | `agents/merc-buddy/tools/<tool>/index.ts`, calls the **same** impl via `runAsTool` | the agent WP |

Rule B (REQ-CORE-004): a rule lives once, in the handler or in `@merc/core`. Tools and functions import it.

## 1. Write the handler

`shared/handlers/src/<slug>.ts`:

```ts
import { defineFunction, requireAccount, type Impl } from "../../core/src/index";

export const impl: Impl<"visit-card-get"> = async ({ req, db, me, platform }) => {
  const account = await requireAccount(db, me, req.account_id);   // scope (REQ-CORE-009)
  // ... build the contract response; throw notFound()/forbidden()/invalid()/conflict()/blocked()
  return { /* exactly the response schema */ } as any;
};

export const handle = defineFunction("visit-card-get", impl);      // Wonderful Function entry
```

What `defineFunction` already does for you, in this order: validates the body/query against the contract
request schema (GET params coerced), drops any `caller` field from the body, resolves the caller from
`context.metadata.user.id` to `app_user` (`forbidden` if absent or inactive), checks the contract `gate`
permission, runs the impl with an org-scoped `db`, validates the response against the contract, and
turns any thrown error into `{error: {code, message, details?}}` (REQ-CORE-008). Do not repeat these.

Rules:
- Identity is only `me` (REQ-CORE-002). Never read a user id from `req`.
- `db.<table>` is org-filtered and org-stamped. Writes are validated (types, enums, `*_minor` integers,
  0-100 pct). Unique natural keys are pre-checked (`conflict`); a platform 500 becomes `conflict` only after a
  re-read confirms the clash, otherwise `upstream_failed`.
- Scope: `requireAccount`, `requireAccountRow`, `listAccounts` (rep: owned + territory, manager: team, admin: all),
  `assertOwner`, `assertOwnerOrTeam`, `assertTeam`, `assertApprover`, `assertRequesterOrApprover`, `dashboardRepIds`.
  `listAccounts(db, me, where)` keeps your own conditions (eq and `{op, value}`) on top of the scope.
- Dates (REQ-CORE-007): always in the org timezone, from `@merc/core` dates:
  `today(me.org)`, `dayRange(me.org, date)`, `weekRange`, `monthRange`, `lastDaysRange(me.org, 30)`,
  `zonedInstant(me.org, date, "09:30")`, `localDate(me.org, isoInstant)`, `nextWeekday(date, 4)`,
  `withinLocalHours(me.org, "08:00", "20:00")`. Never `new Date().toISOString().slice(0, 10)`.
- Secrets and globals: `secretString(platform, "<NAME>")` and `globalString(platform, "<NAME>")` return
  `null` when unset. While a human step is pending, throw `blocked("<fn> is blocked: secret <NAME> is not set",
  {missing, kind, how})` so the app and the tool can say exactly what is missing (see merc-chat-token.ts).
  Keep the secret's *name* in a constant whose identifier has no `secret`/`token`/`api_key` in it
  (e.g. `NAME_CHAT_KEY`), or the repo secret scan flags it.
- Outbound HTTP: inject `fetch` through a `makeImpl(deps)` factory so tests can fake it (merc-chat-token.ts).
- Scheduler / procedure callers: `defineCron(slug, impl)` runs the impl once per organization with
  `systemPrincipal(api, orgId)` (kind `system`, admin-wide inside that org, `user: null`). Use
  `runAsSystem(slug, impl, {tables, data, orgId, caller: "procedure"})` only from a trusted entry, never with an
  org id taken from a request. Type such impls as `Impl<slug, Principal>`; use `actorUserId(me)` (null for
  system) for `created_by`-style columns and `assertNotSystem(me)` before any customer message.

## 2. Test it

`shared/handlers/test/<slug>.test.ts` with the kit:

```ts
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { handle, impl } from "../src/<slug>";
import { runAsTool } from "../../core/src/index";

const t = kit({ secrets: { SOME_NAME: "x" }, globals: {} });       // fresh seeded fake (demo day 2026-11-16)
const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos })));   // through the deployed entry
expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
expect(await runAsTool("<slug>", impl, t.toolCtx("nikos"), params, t.key)).toEqual(r);   // same by voice
```

Users: `thanasis` (admin), `eleni` (manager), `nikos` and `dimitra` (reps, North). `t.system()` gives a system
principal. The fake behaves like the platform (FK miss 400, restrict delete 400, unique clash 500); use
`t.tables.failNextWrite = err` to inject a failure. Cover at least: happy path, `forbidden` for another rep's
record (REQ-CORE-009), a spoofed `caller` in the body being ignored, and the tool path.

Add the bundle freshness test (copy the last test of `test/me.test.ts`), so a stale deploy is caught.

```
pnpm --dir shared/handlers typecheck && pnpm --dir shared/handlers test
```

## 3. Function folder (the wrapper)

`functions/<slug>/config.json` (method and slug exactly as the contract; `param_mapping` empty, the contract
schema validates in code):

```json
{ "kind": "http", "name": "<slug>", "description": "Merc fn:<slug> ... Source: shared/handlers/src/<slug>.ts",
  "method": "POST", "path_slug": "<slug>", "param_mapping": {} }
```

`functions/<slug>/index.ts` (the runner calls a top-level `userFunction`; keep it this small):

```ts
import { handle } from "./handler.gen.js";
async function userFunction(context: any): Promise<any> {
  return handle(context);
}
```

Then generate the self-contained bundle (handler + `@merc/core` + contract schemas, ESM, no Node built-ins):

```
pnpm --dir shared/handlers bundle <slug>      # writes functions/<slug>/handler.gen.js
```

Never edit `handler.gen.js` by hand. Re-run `bundle` after any change to the handler or `shared/core`, then
re-run the tests (the freshness test fails on a stale bundle). Why a bundle: `infra/deploy/deploy.sh` copies only
`functions/<slug>/` into the shared workspace `functions.git`, so the folder must not import anything outside itself.

## 4. Deploy to dev

```
infra/deploy/deploy.sh fn:<slug> --env dev            # plan: provisions nothing, shows the diff
infra/deploy/deploy.sh fn:<slug> --env dev --push     # first run provisions the function, then pushes
```

- The first `--push` runs `wful functions api create` and prints `provisioned function <slug> <METHOD> in dev`.
- A push rejected because another builder pushed first: just run the same command again (it refetches and
  resets its cache clone). Never force-push, never touch other folders of functions.git.
- `deploy: secret scan failed ...` means the folder contains something that looks like a secret; fix the source
  (see step 1), re-bundle, re-run.
- Get the function id: `$W functions api list | grep -E "SLUG|<slug>"`.

## 5. Attach it to the app `merc`

Every app-callable function (contract `callers` contains `app` or `mgmt`) is linked to the app with its gate:

```
$W apps resources-attach merc --function <function-id> --mode linked --required-permission <contract gate>
$W apps resources-attach merc --function <function-id> --mode linked --all-app-callers   # gate: null only
$W apps resources-list --app merc
```

The required permission is exactly the contract `gate` (for example `voicelog.create` for merc-chat-token). The
platform checks it before the function runs, and `defineFunction` checks it again.

## 6. Smoke-call it on dev

```
$W call get  "/api/v1/functions/<slug>?param=value"
$W call post /api/v1/functions/<slug> --data '{"field": "value"}'
```

Your own platform user is not a seeded Merc user, so a user-scoped function answers
`{"error":{"code":"forbidden","message":"caller is not a Merc user"}}`. That still proves the deploy: the bundle
ran, read `context.metadata.user` and queried the tables. A blocked function answers its `blocked_by_policy`
error naming the missing secret. Paste the real output into your report as evidence.

Proven on dev by WP-CORE-01b:

| function | id | smoke result |
|---|---|---|
| `me` GET | `98076dfa-fd0d-4e08-9dc0-6d7ed484a643` | `forbidden: caller is not a Merc user` (bundle ran, tables read) |
| `merc-chat-token` POST | `43c84bc3-801f-4544-8eab-c7c8929bf07f` | `blocked_by_policy` naming the missing secret until the human step is done |

## 7. The buddy tool for the same function (agent WPs)

The agent imports the published lib (`wful agents lib add`, then `../../shared_lib/utils/merc_core`) and calls
`runAsTool(slug, impl, ctx, params, internalKey)`. The tool identity is the signed claim minted by
`fn:merc-chat-token`, verified with secret `MERC_INTERNAL_CALL_KEY`. `caller` is injected, never a model
parameter. Republish the lib after `shared/core` changes: `pnpm --dir shared/core publish-lib` (branch
`merc-core`), then open and merge a shared_lib MR into `main` (`$W pr create --lib --source merc-core`), and bump
the agent's `shared_lib` pin.

## 8. Checklist for the report

- [ ] `pnpm --dir shared/handlers test` passes (paste the counts), bundle fresh
- [ ] `make check` passes for your packages
- [ ] `deploy.sh fn:<slug> --env dev --push` output (`pushed <sha> to dev main`)
- [ ] `apps resources-attach` output with the gate
- [ ] smoke-call output
- [ ] anything a human must do (secret values, agent ids, OAuth) listed as human_steps, with the blocked error
      the function returns until then
