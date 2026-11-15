#!/usr/bin/env bash
# Merc deploy: sync one monorepo component into its Wonderful platform git repo.
#
#   infra/deploy/deploy.sh <component> --env dev|demo [--push] [--src DIR] [--message MSG] [--print-plan]
#
#   component   fn:<slug> | agent:<slug> | app[:<slug>]
#   --env       REQUIRED. There is no default and no environment-variable fallback,
#               so demo is only ever reached by typing --env demo.
#   --push      commit and push to the target branch (default: plan only, nothing pushed)
#   --src       override the monorepo source folder (tests, smoke deploys)
#   --print-plan  print the resolved plan and exit without touching git or the network
#
# Workspace ids live only in infra/deploy/environments.json. Every wful call uses
# `wful --profile <p> --workspace <w>` from that file.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="${MERC_DEPLOY_ENV_FILE:-$HERE/environments.json}"   # test hook only
COMP_FILE="$HERE/components.json"
CACHE="${MERC_DEPLOY_CACHE:-$HERE/.cache}"
WFUL_BIN="${WFUL_BIN:-wful}"

die() { echo "deploy: $*" >&2; exit "${2:-2}"; }
usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

COMPONENT="" ENV_NAME="" PUSH=0 SRC_OVERRIDE="" MESSAGE="" PLAN_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env) [ $# -ge 2 ] || die "--env needs a value"; ENV_NAME="$2"; shift 2 ;;
    --env=*) ENV_NAME="${1#--env=}"; shift ;;
    --push) PUSH=1; shift ;;
    --src) SRC_OVERRIDE="$2"; shift 2 ;;
    --message) MESSAGE="$2"; shift 2 ;;
    --print-plan) PLAN_ONLY=1; shift ;;
    -h|--help) usage ;;
    -*) die "unknown flag $1" ;;
    *) [ -z "$COMPONENT" ] || die "only one component per run"; COMPONENT="$1"; shift ;;
  esac
done
[ -n "$COMPONENT" ] || { echo "deploy: missing <component>" >&2; usage; }
[ -n "$ENV_NAME" ] || die "missing --env (dev|demo). There is no default environment."
case "$ENV_NAME" in dev|demo) ;; *) die "unknown env '$ENV_NAME' (dev|demo)" ;; esac

jget() { python3 -I -c 'import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2:]: d=d.get(k,"") if isinstance(d,dict) else ""
print(d if not isinstance(d,list) else "\n".join(d))' "$@"; }

PROFILE="$(jget "$ENV_FILE" "$ENV_NAME" profile)"
WORKSPACE="$(jget "$ENV_FILE" "$ENV_NAME" workspace)"
VCS="$(jget "$ENV_FILE" "$ENV_NAME" vcs)"
BRANCH="$(jget "$ENV_FILE" "$ENV_NAME" branch)"; BRANCH="${BRANCH:-main}"
DEV_WS="$(jget "$ENV_FILE" dev workspace)"
[ -n "$PROFILE" ] || die "env '$ENV_NAME' has no profile in $ENV_FILE"
[ -n "$WORKSPACE" ] || die "env '$ENV_NAME' has no workspace id in $ENV_FILE (fill it in before deploying there)"
if [ "$ENV_NAME" = demo ] && [ "$WORKSPACE" = "$DEV_WS" ]; then
  die "demo workspace equals dev workspace in $ENV_FILE; refusing"
fi
if [ "$ENV_NAME" = dev ] && [ "$WORKSPACE" != "$DEV_WS" ]; then die "internal: dev workspace mismatch"; fi

W() { "$WFUL_BIN" --profile "$PROFILE" --workspace "$WORKSPACE" "$@"; }

KIND="${COMPONENT%%:*}"; NAME=""
[ "$KIND" != "$COMPONENT" ] && NAME="${COMPONENT#*:}"
case "$KIND" in
  fn|function) KIND=function; [ -n "$NAME" ] || die "fn:<slug> needs a slug" ;;
  agent) [ -n "$NAME" ] || die "agent:<slug> needs a slug" ;;
  app) NAME="${NAME:-$(jget "$COMP_FILE" app default_name)}" ;;
  *) die "unknown component kind '$KIND' (fn:<slug> | agent:<slug> | app[:<slug>])" ;;
esac
case "$NAME" in *[!a-zA-Z0-9_-]*) die "bad component name '$NAME'" ;; esac

fill() { local s="$1"; s="${s//\{name\}/$NAME}"; s="${s//\{vcs\}/$VCS}"; s="${s//\{workspace\}/$WORKSPACE}"; s="${s//\{app_id\}/${APP_ID:-<app_id>}}"; echo "$s"; }
SRC_REL="$(fill "$(jget "$COMP_FILE" "$KIND" src)")"
SRC="${SRC_OVERRIDE:-$ROOT/$SRC_REL}"
SUBDIR="$(fill "$(jget "$COMP_FILE" "$KIND" subdir)")"
TARGET="$CACHE/$ENV_NAME/$KIND-$NAME"

# Where the platform clone comes from. Agents have no repo URL template (their URL carries the
# platform agent id), so show the clone command, plus the real remote once a clone is cached.
clone_target() {
  if [ "$KIND" = agent ]; then
    local remote=""
    [ -d "$TARGET/.git" ] && remote="$(git -C "$TARGET" remote get-url origin 2>/dev/null || true)"
    echo "${remote:-$(fill "$(jget "$COMP_FILE" agent clone)") --agent $NAME} (profile $PROFILE, workspace $WORKSPACE)"
  else
    fill "$(jget "$COMP_FILE" "$KIND" repo)"
  fi
}

plan() {
  echo "plan:"
  echo "  env:        $ENV_NAME"
  echo "  profile:    $PROFILE"
  echo "  workspace:  $WORKSPACE"
  echo "  component:  $KIND $NAME"
  echo "  source:     $SRC"
  echo "  target:     ${1:-$(clone_target)}${SUBDIR:+ :: $SUBDIR/}"
  echo "  clone:      $TARGET"
  echo "  branch:     $BRANCH"
  echo "  mode:       $([ $PUSH = 1 ] && echo push || echo plan-only)"
}

if [ "$PLAN_ONLY" = 1 ]; then plan; exit 0; fi
[ -d "$SRC" ] || die "source folder $SRC does not exist" 3

# ---- resolve + refresh the platform clone (the cache is disposable, owned by this script)
mkdir -p "$CACHE/$ENV_NAME"
REPO_URL=""
case "$KIND" in
  function) REPO_URL="$(fill "$(jget "$COMP_FILE" function repo)")" ;;
  app)
    APP_ID="$(W apps get "$NAME" --json 2>/dev/null | python3 -I -c 'import json,sys
d=json.load(sys.stdin); d=d.get("data",d); print(d.get("id",""))' 2>/dev/null || true)"
    [ -n "$APP_ID" ] || die "app '$NAME' not found in $ENV_NAME; create it first: wful --profile $PROFILE --workspace $WORKSPACE apps create ..." 3
    REPO_URL="$(fill "$(jget "$COMP_FILE" app repo)")" ;;
esac
plan "$REPO_URL"

fn_exists() {  # is <slug> registered in this workspace? HTTP: slug + method; cron: slug alone
  W functions "$FN_GROUP" list --json 2>/dev/null | python3 -I -c 'import json,sys
d=json.load(sys.stdin); d=d if isinstance(d,list) else (d.get("data") or d.get("items") or [])
grp,slug,method=sys.argv[1:4]
print(any((f.get("path_slug") or f.get("slug"))==slug and (grp=="cron" or f.get("method","").upper()==method.upper()) for f in d))' "$FN_GROUP" "$NAME" "$FN_METHOD"
}
if [ "$KIND" = function ]; then
  [ -f "$SRC/config.json" ] || die "function source $SRC has no config.json" 3
  FN_METHOD="$(jget "$SRC/config.json" method)"; FN_METHOD="${FN_METHOD:-POST}"
  FN_DESC="$(jget "$SRC/config.json" description)"
  # config.json kind "cron" is a scheduled function (wful functions cron); anything else is HTTP.
  FN_GROUP=api; [ "$(jget "$SRC/config.json" kind)" = cron ] && FN_GROUP=cron
  if [ "$(fn_exists)" != True ]; then
    if [ "$PUSH" != 1 ]; then echo "function $NAME ($FN_GROUP $FN_METHOD) does not exist in $ENV_NAME: --push will provision it (wful functions $FN_GROUP create)"; exit 0; fi
    # Provision first: a folder pushed without a function record is not registered and blocks create (409).
    rm -rf "$TARGET"
    if [ "$FN_GROUP" = cron ]; then
      FN_DATA="$(python3 -I -c 'import json,sys
c=json.load(open(sys.argv[1])); print(json.dumps({k:c[k] for k in ("cron_schedules","timeout_ms") if k in c}))' "$SRC/config.json")"
      W --no-interactive functions cron create --slug "$NAME" --name "$NAME" \
        ${FN_DESC:+--description "$FN_DESC"} --data "$FN_DATA" --dir "$TARGET" --skip-install >/dev/null \
        || die "wful functions cron create failed for $NAME" 1
      echo "provisioned cron function $NAME in $ENV_NAME"
    else
      W --no-interactive functions api create --slug "$NAME" --method "$FN_METHOD" --name "$NAME" \
        ${FN_DESC:+--description "$FN_DESC"} --dir "$TARGET" --skip-install >/dev/null \
        || die "wful functions api create failed for $NAME" 1
      echo "provisioned function $NAME $FN_METHOD in $ENV_NAME"
    fi
  elif [ ! -d "$TARGET/.git" ]; then
    if [ "$FN_GROUP" = cron ]; then
      W functions cron clone "$NAME" --dir "$TARGET" --skip-install >/dev/null \
        || die "wful functions cron clone failed for $NAME" 1
    else
      W functions api clone "$NAME" --method "$FN_METHOD" --dir "$TARGET" --skip-install >/dev/null \
        || die "wful functions api clone failed for $NAME" 1
    fi
  fi
fi
if [ ! -d "$TARGET/.git" ]; then
  rm -rf "$TARGET"
  if [ "$KIND" = agent ]; then
    W agents clone --agent "$NAME" --dir "$TARGET" --skip-install >/dev/null \
      || die "agent '$NAME' not found in $ENV_NAME; create it first (wful agents create) or promote it" 3
  else
    git clone --quiet "$REPO_URL" "$TARGET"
  fi
fi
[ "$KIND" = agent ] && echo "  remote:     $(git -C "$TARGET" remote get-url origin 2>/dev/null || echo '?')"
git -C "$TARGET" fetch --quiet origin
if git -C "$TARGET" rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
  git -C "$TARGET" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
  git -C "$TARGET" reset --quiet --hard "origin/$BRANCH"
fi
git -C "$TARGET" clean -fdq -e node_modules

# ---- sync monorepo source into the clone
EXCL=(); while IFS= read -r e; do [ -n "$e" ] && EXCL+=(--exclude "$e"); done < <(jget "$COMP_FILE" sync_excludes)
DEST="$TARGET${SUBDIR:+/$SUBDIR}"
mkdir -p "$DEST"
rsync -a --delete "${EXCL[@]}" "$SRC/" "$DEST/"

python3 -I "$ROOT/scripts/secret-scan.py" --root "$DEST" >/dev/null \
  || die "secret scan failed on $DEST; refusing to deploy (REQ-OPS-005)" 4

# Excluded paths are never staged, even if the platform clone left them untracked
# (e.g. `wful agents clone` writes .wonderful/ schemas) and the source has no .gitignore.
NOADD=(); while IFS= read -r e; do [ -n "$e" ] && [ "$e" != .git ] && NOADD+=(":(exclude)${SUBDIR:+$SUBDIR/}$e" ":(exclude)${SUBDIR:+$SUBDIR/}**/$e"); done < <(jget "$COMP_FILE" sync_excludes)
git -C "$TARGET" add -A -- . "${NOADD[@]}"
if git -C "$TARGET" diff --cached --quiet; then echo "no changes: $ENV_NAME already matches $SRC"; exit 0; fi
echo "changes:"; git -C "$TARGET" diff --cached --stat | sed 's/^/  /'

if [ "$PUSH" != 1 ]; then echo "plan only; re-run with --push to deploy"; exit 0; fi
SHA_SRC="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo uncommitted)"
git -C "$TARGET" commit --quiet -m "${MESSAGE:-deploy $KIND $NAME from merc monorepo ($SHA_SRC)}"
git -C "$TARGET" push --quiet origin "HEAD:$BRANCH"
echo "pushed $(git -C "$TARGET" rev-parse --short HEAD) to $ENV_NAME $BRANCH"
