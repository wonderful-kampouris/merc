#!/bin/sh
# Usage: infra/tables/apply.sh --workspace <id> [--profile hackathon] [--dry-run]
# Creates every table in spec/contracts/tables/_order.json in schema merc, then adds deferred
# self-references. Re-running is a no-op. Writes out/writer-mismatches.json and out/last-run.log.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec node --no-warnings --experimental-strip-types "$here/src/apply.ts" "$@"
