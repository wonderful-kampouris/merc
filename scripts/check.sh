#!/usr/bin/env bash
# `make check`: contracts build (REQ-OPS-006), every package's tests, deploy + scan tests,
# and a repo secret scan (REQ-OPS-005). Exits non-zero if any step fails.
# Packages without a test script, or with one but no test files yet, are reported as SKIP
# and do not fail the run. Expected packages (shared/handlers, ...) that do not exist yet
# are reported as PENDING.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
. "$ROOT/scripts/lib/packages.sh"
results=(); failed=0
step() { local name="$1"; shift; echo; echo "=== $name"; if "$@"; then results+=("PASS  $name"); else results+=("FAIL  $name"); failed=1; fi; }
note() { echo "$2 $1"; results+=("$(printf '%-5s' "$1") $2"); }

run_pkg_tests() {  # pnpm test, but "no test files found" counts as a skip, not a failure
  local dir="$1" log rc; log="$(mktemp)"
  pnpm --dir "$dir" test 2>&1 | tee "$log"; rc=${PIPESTATUS[0]}
  if [ "$rc" != 0 ] && no_tests_output "$log"; then rm -f "$log"; echo "(no test files found: treated as skip)"; return 0; fi
  rm -f "$log"; return "$rc"
}

step "contracts build (spec/_build/build.py)" python3 -I spec/_build/build.py

pkgs="$(list_pkgs "$ROOT")"
for want in "${MERC_EXPECTED_PKGS[@]}"; do
  echo "$pkgs" | grep -qx "$want" || note PEND "$want (expected package not created yet)"
done
for dir in $pkgs; do
  case "$(pkg_test_kind "$dir")" in
    no-script) note SKIP "$dir (no test script)"; continue ;;
    no-tests)  note SKIP "$dir (test script but no test files yet)"; continue ;;
  esac
  if [ ! -d "$dir/node_modules" ]; then
    if [ -f "$dir/pnpm-lock.yaml" ]; then
      step "install $dir" pnpm --dir "$dir" install --frozen-lockfile --silent
    else  # owner has not committed a lockfile yet; install without writing one into their folder
      step "install $dir (no lockfile)" pnpm --dir "$dir" install --lockfile=false --silent
    fi
  fi
  step "test $dir" run_pkg_tests "$dir"
done

step "secret-scan unit tests" python3 -I -m unittest discover -s scripts/test -q
step "check.sh discovery tests" bash scripts/test/check.test.sh
step "Makefile env guard tests" bash scripts/test/make.test.sh
step "deploy.sh tests" bash infra/deploy/test/deploy.test.sh
step "repo secret scan" python3 -I scripts/secret-scan.py --root "$ROOT"

echo; echo "=== summary"; printf '%s\n' "${results[@]}"
exit $failed
