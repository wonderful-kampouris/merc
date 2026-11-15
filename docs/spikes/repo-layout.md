# Repo layout decision (WP-OPS-01)

**Decision: the monorepo is the source of truth. `infra/deploy/deploy.sh` syncs each component into its Wonderful platform git repo and pushes.** Platform repos are deploy targets, not places where people edit.

## Why not clone each platform repo under `functions/` and `agents/`
- The platform does not have one repo per function by default. The workspace's HTTP functions share one repo (`<vcs>/workspaces/<ws>/functions.git`, folders `functions/<slug>/`). Apps and agents each have their own repo, and their URLs carry platform ids (`apps/<app_id>.git`, `tenants/<t>/workspaces/<ws>/agents/<agent_id>.git`). Nested clones would mean nested git repos, submodules and ids in paths, and each one would change per workspace (dev vs demo).
- Builders work in git worktrees of the monorepo (docs/06). Nested platform clones do not survive worktrees cleanly.
- `make check` (contracts build + all package tests + secret scan) needs one tree to run on before anything ships.
- Demo promotion stays available. The same sync can target the demo workspace (`--env demo`), and so can the platform's own `wful <kind> promote --from <profile> --env <profile>` / `wful export hcl` once demo is its own profile.

## Mapping (infra/deploy/components.json)
| component | monorepo folder | platform repo | what is replaced |
|---|---|---|---|
| `fn:<slug>` | `functions/<slug>/` (`config.json` + `index.ts`) | workspace shared `functions.git` | only `functions/<slug>/`; repo-mates are untouched |
| `agent:<slug>` | `agents/<slug>/` (full Agents V2 repo tree) | agent repo (`wful agents clone`) | whole tree except `.git`, `.agents`, `.wonderful`, `node_modules`, `dist` |
| `app[:<slug>]` (default `merc`) | `app/` (full app repo tree) | `apps/<app_id>.git` (id from `wful apps get`) | whole tree, same excludes |

The shared function code (`shared/`) is bundled into each function or agent by its owning WP's build. deploy.sh copies folders and does not build.

## Environments (infra/deploy/environments.json)
The only place where workspace ids live. `dev` = `7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464` (profile `hackathon`). `demo` is empty until WP-DEMO-01 creates it. deploy.sh refuses demo while its id is empty or equal to dev.

## Safety rules enforced by deploy.sh
- `--env` is required. There is no default and no environment-variable fallback, so demo is reached only by typing `--env demo`.
- The default run is a plan: clone, sync, show the diff, push nothing. `--push` commits and pushes to the target branch.
- Every wful call is `wful --profile <p> --workspace <w>` from the config file.
- Each synced tree is secret-scanned before commit (REQ-OPS-005). Secrets live in Wonderful secrets only.
- deploy.sh never deletes platform resources. Function deletion is out of scope; removing a component folder in the monorepo does nothing.

## Commands
```
make check                                   # build.py + all package tests + deploy tests + secret scan
infra/deploy/deploy.sh fn:debrief-process --env dev          # plan
infra/deploy/deploy.sh fn:debrief-process --env dev --push   # deploy
make deploy C=agent:merc-buddy ENV=dev
```

## Open
- No real git history yet in the monorepo. Commit messages record the source SHA once commits exist.
- Agent repo branch protection or required MRs on demo: if `main` is protected there, use `wful agents promote --from <dev-profile> --env <demo-profile>` (MR mode) instead of `--push`.
