#!/bin/sh
# Usage: infra/seed/check.sh --workspace <id> --demo-day YYYY-MM-DD [--account "Bistro Lofos"] [--expect 12]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec node --no-warnings --experimental-strip-types "$here/src/check.ts" "$@"
