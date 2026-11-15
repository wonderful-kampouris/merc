#!/bin/sh
# Usage: infra/demo/reset-demo.sh --env dev|demo [--demo-day YYYY-MM-DD] [--next-visit-in <min> --live-phone-ok] [--dry-run] [--no-cleanup]
# Puts the environment back to the J5 start (Café Miltos) in under a minute. See infra/demo/README.md.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec node --no-warnings --experimental-strip-types "$here/src/reset.ts" "$@"
