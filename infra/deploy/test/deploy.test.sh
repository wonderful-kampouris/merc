#!/usr/bin/env bash
# Offline tests for infra/deploy/deploy.sh. No network: plans use --print-plan,
# pushes go to a local bare repo via a test environments file.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="$HERE/../deploy.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; echo "$2" | sed 's/^/       /'; fail=$((fail+1)); }
expect_fail() { local name="$1" pat="$2"; shift 2; local out; if out="$("$@" 2>&1)"; then bad "$name (exit 0)" "$out"; elif echo "$out" | grep -q -- "$pat"; then ok "$name"; else bad "$name (msg)" "$out"; fi; }
expect_ok()   { local name="$1" pat="$2"; shift 2; local out; if out="$("$@" 2>&1)" && echo "$out" | grep -q -- "$pat"; then ok "$name"; else bad "$name" "$out"; fi; }

# --- env guard: no default, no env-var fallback, demo only by explicit flag
expect_fail "no --env is refused"                "missing --env"       "$D" fn:merc-x --print-plan
expect_fail "MERC_ENV=demo is ignored"           "missing --env"       env MERC_ENV=demo DEPLOY_ENV=demo ENV=demo "$D" fn:merc-x --print-plan
expect_fail "unknown env refused"                "unknown env"         "$D" fn:merc-x --env prod --print-plan
expect_fail "demo with empty workspace refused"  "no workspace id"     "$D" fn:merc-x --env demo --print-plan
expect_fail "bad component kind"                 "unknown component"   "$D" lambda:x --env dev --print-plan
expect_fail "fn without slug"                    "needs a slug"        "$D" fn: --env dev --print-plan
expect_fail "path traversal in name"             "bad component name"  "$D" "fn:../x" --env dev --print-plan

expect_ok "dev plan uses dev workspace from config" "workspace:  7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464" "$D" fn:merc-x --env dev --print-plan
expect_ok "--env=dev form works"                    "env:        dev"   "$D" agent:merc-buddy --env=dev --print-plan
expect_ok "app defaults to merc"                     "component:  app merc" "$D" app --env dev --print-plan
expect_ok "default mode is plan-only"                "mode:       plan-only" "$D" fn:merc-x --env dev --print-plan

# --- agent plan shows where the clone comes from (agents have no URL template)
expect_ok "agent plan prints the clone target"     "target:     wful agents clone --agent merc-buddy (profile hackathon, workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464)" "$D" agent:merc-buddy --env dev --print-plan
expect_ok "plan prints the local clone dir"        "clone:      .*/dev/agent-merc-buddy" "$D" agent:merc-buddy --env dev --print-plan
expect_ok "function plan target is the shared repo" "target:     https://.*/workspaces/7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464/functions.git :: functions/merc-x/" "$D" fn:merc-x --env dev --print-plan

# --- demo configured: same workspace as dev is refused; a distinct one is used only with --env demo
cat > "$T/envs-same.json" <<J
{"dev":{"profile":"p","workspace":"ws-dev","vcs":"file://$T"},"demo":{"profile":"p","workspace":"ws-dev","vcs":"file://$T"}}
J
expect_fail "demo == dev workspace refused" "equals dev" env MERC_DEPLOY_ENV_FILE="$T/envs-same.json" "$D" fn:merc-x --env demo --print-plan
cat > "$T/envs.json" <<J
{"dev":{"profile":"p","workspace":"ws-dev","vcs":"file://$T"},"demo":{"profile":"p","workspace":"ws-demo","vcs":"file://$T"}}
J
expect_ok "demo plan targets demo workspace" "workspace:  ws-demo" env MERC_DEPLOY_ENV_FILE="$T/envs.json" "$D" fn:merc-x --env demo --print-plan

# --- function sync + push into a local bare "shared functions repo"
mkdir -p "$T/workspaces/ws-dev" "$T/seed/functions/other"
git init -q --bare -b main "$T/workspaces/ws-dev/functions.git"
echo '{"kind":"http"}' > "$T/seed/functions/other/config.json"
( cd "$T/seed" && git init -q -b main && git add -A && git -c user.email=t@t -c user.name=t commit -qm seed && git push -q "$T/workspaces/ws-dev/functions.git" main )
mkdir -p "$T/src" "$T/state"; : > "$T/state/functions.txt"
echo '{"kind":"http","method":"POST","description":"t"}' > "$T/src/config.json"
echo 'async function userFunction() { return 1 }' > "$T/src/index.ts"; mkdir -p "$T/src/node_modules"; echo x > "$T/src/node_modules/junk.js"
RUN=(env WFUL_BIN="$HERE/fake-wful.sh" FAKE_WFUL_STATE="$T/state" FAKE_WFUL_REPO="$T/workspaces/ws-dev/functions.git" MERC_DEPLOY_ENV_FILE="$T/envs.json" MERC_DEPLOY_CACHE="$T/cache" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t "$D")
expect_ok "plan for a new function says it will provision" "will provision" "${RUN[@]}" fn:merc-x --env dev --src "$T/src"
grep -q "functions api create" "$T/state/calls.log" && bad "plan provisioned a function" "" || ok "plan never provisions"
[ "$(git -C "$T/workspaces/ws-dev/functions.git" rev-list --count main)" = 1 ] && ok "bare repo untouched after plan" || bad "bare repo changed after plan" ""
expect_ok "push provisions then deploys" "provisioned function merc-x POST" "${RUN[@]}" fn:merc-x --env dev --src "$T/src" --push
grep -qx "merc-x POST" "$T/state/functions.txt" && ok "create used slug + method from config.json" || bad "create args" "$(cat "$T/state/calls.log")"
files="$(git -C "$T/workspaces/ws-dev/functions.git" ls-tree -r --name-only main)"
echo "$files" | grep -qx "functions/merc-x/index.ts" && ok "function lands in functions/<slug>/" || bad "function path" "$files"
echo "$files" | grep -qx "functions/other/config.json" && ok "repo-mates untouched" || bad "repo-mates" "$files"
echo "$files" | grep -q node_modules && bad "node_modules synced" "$files" || ok "excludes node_modules"
expect_ok "re-deploy is a no-op" "no changes" "${RUN[@]}" fn:merc-x --env dev --src "$T/src" --push
[ -z "$(git -C "$T/workspaces/ws-demo" 2>/dev/null ls-remote . 2>/dev/null)" ] && ok "dev deploy never touched demo" || bad "demo touched" ""

echo 'async function userFunction() { return 2 }' > "$T/src/index.ts"
expect_ok "plan on existing function shows changes, pushes nothing" "plan only" "${RUN[@]}" fn:merc-x --env dev --src "$T/src"
expect_ok "update existing function" "pushed" "${RUN[@]}" fn:merc-x --env dev --src "$T/src" --push
[ "$(grep -c "functions api create" "$T/state/calls.log")" = 1 ] && ok "existing function is not re-created" || bad "re-created" "$(cat "$T/state/calls.log")"
expect_fail "function without config.json refused" "no config.json" "${RUN[@]}" fn:merc-y --env dev --src "$T/state" --push

# --- agent: plan clones via `wful agents clone` and then shows the real remote
mkdir -p "$T/agentseed"; git init -q --bare -b main "$T/agent.git"
( cd "$T/agentseed" && git init -q -b main && echo '{}' > agent.json && git add -A && git -c user.email=t@t -c user.name=t commit -qm seed && git push -q "$T/agent.git" main )
mkdir -p "$T/asrc"; echo '{"x":1}' > "$T/asrc/agent.json"
expect_ok "agent plan after clone shows remote"   "remote:     $T/agent.git" env FAKE_WFUL_AGENT_REPO="$T/agent.git" "${RUN[@]}" agent:merc-a --env dev --src "$T/asrc"
mkdir -p "$T/cache/dev/agent-merc-a/.wonderful"; echo '{}' > "$T/cache/dev/agent-merc-a/.wonderful/schema.json"
expect_ok "agent plan never stages .wonderful/"   "plan only" env FAKE_WFUL_AGENT_REPO="$T/agent.git" "${RUN[@]}" agent:merc-a --env dev --src "$T/asrc"
git -C "$T/cache/dev/agent-merc-a" diff --cached --name-only | grep -q wonderful && bad ".wonderful staged" "$(git -C "$T/cache/dev/agent-merc-a" diff --cached --name-only)" || ok ".wonderful not staged"
expect_ok "cached agent plan target is the remote" "target:     $T/agent.git (profile p" env FAKE_WFUL_AGENT_REPO="$T/agent.git" "${RUN[@]}" agent:merc-a --env dev --src "$T/asrc"
[ "$(git -C "$T/agent.git" rev-list --count main)" = 1 ] && ok "agent plan pushed nothing" || bad "agent plan pushed" ""
expect_fail "missing agent is reported"           "not found in dev"     "${RUN[@]}" agent:merc-none --env dev --src "$T/asrc"

# --- secret in source blocks the deploy
echo "const k = \"$(printf 'sk-%s' ant-a1b2c3d4e5f6g7h8i9j0k1l2)\"" > "$T/src/leak.ts"
expect_fail "secret blocks deploy" "secret scan failed" "${RUN[@]}" fn:merc-x --env dev --src "$T/src" --push

echo "deploy tests: $pass passed, $fail failed"
[ "$fail" = 0 ]
