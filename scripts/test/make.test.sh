#!/usr/bin/env bash
# Offline tests for the Makefile env guard: C/ENV count only when typed on the make command line.
# DEPLOY=echo (command line) replaces deploy.sh so nothing touches git or the network.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pass=0 fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; echo "$2" | sed 's/^/       /'; fail=$((fail+1)); }
M() { env -u ENV -u C -u MAKEFLAGS -u MFLAGS "$@"; }   # clean slate, then add what the case wants
mk() { make -s -C "$ROOT" "$@"; }
case_() {  # name expect(ok|fail) must-match must-not-match -- cmd...
  local name="$1" want="$2" pat="$3" notpat="$4"; shift 5; local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ "$want" = ok ] && [ $rc != 0 ]; then bad "$name (exit $rc)" "$out"; return; fi
  if [ "$want" = fail ] && [ $rc = 0 ]; then bad "$name (exit 0)" "$out"; return; fi
  if [ -n "$pat" ] && ! echo "$out" | grep -q -- "$pat"; then bad "$name (missing '$pat')" "$out"; return; fi
  if [ -n "$notpat" ] && echo "$out" | grep -q -- "$notpat"; then bad "$name (has '$notpat')" "$out"; return; fi
  ok "$name"
}

case_ "ENV=demo from the shell is ignored by plan"   fail "ignoring ENV=demo" "--env demo" -- M ENV=demo bash -c "make -s -C '$ROOT' plan C=fn:merc-x DEPLOY=echo"
case_ "ENV=demo from the shell is ignored by deploy" fail "ignoring ENV=demo" "--env demo" -- M ENV=demo bash -c "make -s -C '$ROOT' deploy C=fn:merc-x DEPLOY=echo"
case_ "exported ENV=demo + bare plan prints usage"   fail "usage: make plan" "--env demo" -- M ENV=demo bash -c "make -s -C '$ROOT' plan"
case_ "C from the shell is ignored too"              fail "usage: make plan" "fn:merc-x" -- M C=fn:merc-x bash -c "make -s -C '$ROOT' plan ENV=dev DEPLOY=echo"
case_ "real deploy.sh never sees demo from shell"    fail "ignoring ENV=demo" "env 'demo'" -- M ENV=demo bash -c "make -s -C '$ROOT' plan C=fn:merc-x"
case_ "command-line ENV=dev targets dev"             ok   "fn:merc-x --env dev$" "demo" -- M bash -c "make -s -C '$ROOT' plan C=fn:merc-x ENV=dev DEPLOY=echo"
case_ "command line wins over shell ENV"             ok   "--env dev$" "--env demo" -- M ENV=demo bash -c "make -s -C '$ROOT' plan C=fn:merc-x ENV=dev DEPLOY=echo"
case_ "demo only by typing ENV=demo after make"      ok   "fn:merc-x --env demo$" "" -- M bash -c "make -s -C '$ROOT' plan C=fn:merc-x ENV=demo DEPLOY=echo"
case_ "deploy passes --push"                         ok   "--env dev --push$" "" -- M bash -c "make -s -C '$ROOT' deploy C=fn:merc-x ENV=dev DEPLOY=echo"

echo "make tests: $pass passed, $fail failed"
[ "$fail" = 0 ]
