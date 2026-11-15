# infra/deploy

`deploy.sh <component> --env dev|demo [--push]` syncs one monorepo component into its Wonderful platform repo. The layout decision and the safety rules are in `docs/spikes/repo-layout.md`.

- `environments.json`: profile, workspace id, VCS base and branch per env. This is the only place for workspace ids.
- `components.json`: component kind → monorepo folder → platform repo and subfolder.
- `.cache/`: disposable platform clones, owned by deploy.sh (git-ignored).
- `test/deploy.test.sh`: offline tests, using a local bare repo. No network.

Test hooks (tests only): `MERC_DEPLOY_ENV_FILE`, `MERC_DEPLOY_CACHE`, `WFUL_BIN`.

## Safety notes
- `make plan|deploy C=... ENV=...` reads C and ENV **only from the make command line**. An exported `ENV=demo` (or `ENV=demo make plan`) is ignored with a notice, so demo is reached only by typing `ENV=demo` after `make`. Tested by `scripts/test/make.test.sh`.
- The plan prints `target:` (shared functions repo, app repo, or for agents the `wful agents clone --agent <slug>` source and, once cached, the real remote URL) and `clone:` (the local cache dir).
