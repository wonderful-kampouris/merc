#!/bin/sh
# Usage: infra/tables/verify.sh --workspace <id> [--profile hackathon]   (read-only)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec node --no-warnings --experimental-strip-types "$here/src/verify.ts" "$@"
