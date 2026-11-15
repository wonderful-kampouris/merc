#!/usr/bin/env bash
# Demo promotion behind the eval gate (REQ-OPS-004): a failing or missing required eval blocks promotion.
#   infra/governance/promote-demo.sh <component> [--run-evals]
#     <component>   as for infra/deploy/deploy.sh (fn:<slug>, agent:<slug>, app)
#     --run-evals   run the agent eval batches on dev now instead of trusting files on disk
# The gate always runs unrestricted (no --only): promotion needs the whole suite green.
# MERC_EVAL_GATE_OVERRIDE is deliberately not supported: change FREEZE_CUT in src/eval-gate.ts in a reviewed commit.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
[ $# -ge 1 ] || { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
COMPONENT="$1"; shift
GATE_ARGS=()
[ "${1:-}" = "--run-evals" ] && GATE_ARGS=(--run --env dev)
if ! node --experimental-strip-types --no-warnings "$HERE/src/eval-gate.ts" "${GATE_ARGS[@]+"${GATE_ARGS[@]}"}"; then
  echo "promote-demo: eval gate failed; $COMPONENT is NOT promoted to demo" >&2
  exit 1
fi
exec "$ROOT/infra/deploy/deploy.sh" "$COMPONENT" --env demo --push
