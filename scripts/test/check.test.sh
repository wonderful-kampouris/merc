#!/usr/bin/env bash
# Offline tests for scripts/lib/packages.sh (package discovery used by scripts/check.sh).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/packages.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0 fail=0
eq() { if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1)); else echo "FAIL - $1"; printf '       want: %s\n       got:  %s\n' "$3" "$2"; fail=$((fail+1)); fi; }
pkg() { mkdir -p "$T/$1"; echo "$2" > "$T/$1/package.json"; }

pkg shared/core      '{"scripts":{"test":"vitest run"}}';  mkdir -p "$T/shared/core/test"; : > "$T/shared/core/test/a.test.ts"
pkg shared/handlers  '{"scripts":{"test":"vitest run"}}';  mkdir -p "$T/shared/handlers/src/_lib"; : > "$T/shared/handlers/src/_lib/index.ts"
pkg app              '{"scripts":{"build":"vite build"}}'
pkg infra/seed       '{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}'
pkg shared/handlers/node_modules/dep '{"scripts":{"test":"x"}}'
pkg infra/deploy/.cache/dev/fn-x     '{"scripts":{"test":"x"}}'
pkg spikes/s1        '{"scripts":{"test":"x"}}'
mkdir -p "$T/shared/handlers/node_modules/dep/t"; : > "$T/shared/handlers/node_modules/dep/t/x.test.js"

eq "discovers nested shared/handlers, skips node_modules/.cache/spikes" \
   "$(list_pkgs "$T" | tr '\n' ' ')" "app infra/seed shared/core shared/handlers "
eq "package with tests runs"                  "$(pkg_test_kind "$T/shared/core")"     test
eq "test script without test files is skipped" "$(pkg_test_kind "$T/shared/handlers")" no-tests
eq "no test script is skipped"                "$(pkg_test_kind "$T/app")"             no-script
eq "npm placeholder test script is skipped"   "$(pkg_test_kind "$T/infra/seed")"      no-script
: > "$T/shared/handlers/test.spec.ts" 2>/dev/null; mkdir -p "$T/shared/handlers/test"; mv "$T/shared/handlers/test.spec.ts" "$T/shared/handlers/test/me.test.ts"
eq "first handler test flips it to run"       "$(pkg_test_kind "$T/shared/handlers")" test
printf 'include: **/*.test.ts\nNo test files found, exiting with code 1\n' > "$T/out1"; printf ' Test Files  1 failed (1)\n' > "$T/out2"
eq "vitest 'No test files found' recognised"  "$(no_tests_output "$T/out1" && echo y || echo n)" y
eq "real failure not mistaken for no tests"   "$(no_tests_output "$T/out2" && echo y || echo n)" n
eq "shared/handlers is an expected package"   "$(printf '%s\n' "${MERC_EXPECTED_PKGS[@]}" | grep -cx shared/handlers)" 1

echo "check tests: $pass passed, $fail failed"
[ "$fail" = 0 ]
