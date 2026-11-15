#!/bin/sh
# Usage: infra/seed/load.sh --workspace <id> --demo-day YYYY-MM-DD [--reset] [--profile hackathon] [--wuid-file f] [--dry-run]
# Resolves seed tokens and loads spec/contracts/seed in _order.json order. Re-running converges (no-op when unchanged).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec node --no-warnings --experimental-strip-types "$here/src/load.ts" "$@"
